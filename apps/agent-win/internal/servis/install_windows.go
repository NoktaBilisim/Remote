//go:build windows

package servis

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
)

// Kurulum (`--install`, yönetici; mimari-p27 §5.3, AC-273/274/340). Sıra: güvenli veri klasörü (kayıt kodu
// harcanmadan önce; squatting/yarış durumunda kurulum durur) → kayıt kodu + Ed25519 → POST register → `device.key.tmp`
// (makine DPAPI) → Program Files'a kopya → HKLM kaydı → olay kaynağı → servis (tırnaklı ImagePath, otomatik, 3×10 sn
// kurtarma) → Run + Uninstall → başlat. Kayıt sonrası bir adım başarısız olursa yerel izler geri alınır (sunucudaki
// kayıt panelden iptal edilir). Servis zaten kuruluysa ikili güncellenir, kayıt korunur.

// InstallUI kurulumun kullanıcı arayüzü kancaları (K7 kod iletişim kutusu ve pencere).
type InstallUI interface {
	// AskCode kayıt kodunu sorar; prev boş değilse önceki denemenin hata metnidir. false: vazgeçildi.
	AskCode(prev string) (string, bool)
	ShowError(msg string)
	ShowDone(r Registration)
}

const recoveryDelay = 10 * time.Second

// Install kurulum ya da güncelleme; dönüş süreç çıkış kodudur (0 başarı).
func Install(ctx context.Context, cfg config.Config, ui InstallUI) int {
	if installed() {
		if err := Update(); err != nil {
			ui.ShowError("Güncelleme yapılamadı. Bilgisayarı yeniden başlatıp tekrar deneyin.")
			return 1
		}
		if r, err := ReadRegistration(); err == nil {
			ui.ShowDone(r)
		}
		return 0
	}
	dataDir, err := DataDir()
	if err == nil {
		var moved bool
		moved, err = PrepareDataDir(dataDir)
		if moved {
			OpenEventLog().Write(EvReject(ReasonFolderMoved, "eski klasör kenara alındı"))
		}
	}
	if err != nil {
		ui.ShowError("Klasör güvenli değil. Bilgisayar yöneticinize başvurun.")
		return 1
	}
	reg, err := registerDevice(ctx, cfg, ui, dataDir)
	if err != nil {
		_ = os.RemoveAll(dataDir)
		return 1
	}
	if err := installLocal(cfg); err != nil {
		uninstallLocal()
		ui.ShowError("Kurulum tamamlanamadı. Cihaz kaydı oluştu; destek firmanızdan iptal edip yeni kod isteyin.")
		return 1
	}
	ui.ShowDone(reg)
	return 0
}

// registerDevice kod ister, kaydeder ve geçici anahtarı yazar; kullanıcı vazgeçerse hata.
func registerDevice(ctx context.Context, cfg config.Config, ui InstallUI, dataDir string) (Registration, error) {
	pub, priv, err := GenerateKey()
	if err != nil {
		return Registration{}, err
	}
	req, err := registerBase(cfg, pub)
	if err != nil {
		return Registration{}, err
	}
	httpc := api.New(cfg.ServerURL, cfg.Version).HTTPClient()
	prev := ""
	for {
		raw, ok := ui.AskCode(prev)
		if !ok {
			return Registration{}, errors.New("servis: kurulumdan vazgeçildi")
		}
		code, err := NormalizeCode(raw)
		if err != nil {
			prev = "Kayıt kodu hatalı yazılmış. Kodu destek firmanızdan gelen biçimde girin."
			continue
		}
		req.Code = code
		res, err := Register(ctx, httpc, cfg.ServerURL, cfg.Version, req)
		if err != nil {
			prev = RegisterMessage(err)
			continue
		}
		reg := Registration{DeviceID: res.DeviceID, TenantName: res.TenantName, CustomerName: res.CustomerName}
		return reg, writeKeyAndRegistration(dataDir, priv, reg)
	}
}

func registerBase(cfg config.Config, pub []byte) (RegisterRequest, error) {
	self, err := os.Executable()
	if err != nil {
		return RegisterRequest{}, err
	}
	sum, err := fileSHA256(self)
	if err != nil {
		return RegisterRequest{}, err
	}
	host, _ := os.Hostname()
	name := clean(host, 64)
	if name == "" {
		name = "Windows"
	}
	return RegisterRequest{PublicKey: PublicKeyB64(pub), Name: name, OSVersion: OSVersion(), Version: cfg.Version,
		SHA256: sum, Signed: SelfSigned(self)}, nil
}

func writeKeyAndRegistration(dataDir string, priv []byte, reg Registration) error {
	files, closeFiles, err := OpenKeyFiles(dataDir)
	if err != nil {
		return err
	}
	defer closeFiles()
	if err := WriteInstallKey(files, MachineDPAPI, priv); err != nil {
		return err
	}
	return writeRegistration(reg)
}

// installLocal ikili, olay kaynağı, servis ve uygulama kayıtları.
func installLocal(cfg config.Config) error {
	exe, err := copySelf()
	if err != nil {
		return err
	}
	if err := installEventSource(); err != nil {
		return err
	}
	if err := createService(exe); err != nil {
		return err
	}
	if err := writeAppKeys(exe, cfg.Version); err != nil {
		return err
	}
	return startService()
}

// copySelf çalışan ikiliyi Program Files altına kopyalar (zaten oradaysa dokunmaz).
func copySelf() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	dst, err := InstalledExe()
	if err != nil {
		return "", err
	}
	if strings.EqualFold(filepath.Clean(self), filepath.Clean(dst)) {
		return dst, nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	return dst, copyFile(self, dst)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".yeni"
	out, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, cerr := io.Copy(out, in)
	if err := errors.Join(cerr, out.Sync(), out.Close()); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// createService otomatik başlatmalı LocalSystem servisi; ImagePath tırnaklı olmalı (D-P27-2).
func createService(exe string) error {
	want, err := ImagePath(exe)
	if err != nil {
		return err
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer func() { _ = m.Disconnect() }()
	s, err := m.CreateService(ServiceName, exe, mgr.Config{StartType: mgr.StartAutomatic, DisplayName: ServiceDisplay,
		Description: "Destek firmanızın bu bilgisayara gözetimsiz bağlanmasını sağlar."}, "--service")
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	c, err := s.Config()
	if err != nil {
		return err
	}
	if c.BinaryPathName != want {
		c.BinaryPathName = want
		if err := s.UpdateConfig(c); err != nil {
			return err
		}
	}
	acts, reset := defaultRecoveryActions()
	return s.SetRecoveryActions(acts, reset)
}

func installed() bool {
	m, err := mgr.Connect()
	if err != nil {
		return false
	}
	defer func() { _ = m.Disconnect() }()
	s, err := m.OpenService(ServiceName)
	if err != nil {
		return false
	}
	_ = s.Close()
	return true
}

func startService() error {
	return withService(func(s *mgr.Service) error { return s.Start() })
}

// stopService durdurur ve durana kadar (≤ 20 sn) bekler; çalışmıyorsa hemen döner.
func stopService() error {
	return withService(func(s *mgr.Service) error {
		st, err := s.Query()
		if err != nil || st.State == svc.Stopped {
			return err
		}
		if _, err := s.Control(svc.Stop); err != nil {
			return err
		}
		for i := 0; i < 80; i++ {
			if st, err := s.Query(); err == nil && st.State == svc.Stopped {
				return nil
			}
			time.Sleep(250 * time.Millisecond)
		}
		return fmt.Errorf("servis: %s durmadı", ServiceName)
	})
}

func withService(f func(*mgr.Service) error) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer func() { _ = m.Disconnect() }()
	s, err := m.OpenService(ServiceName)
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	return f(s)
}

// Update ikiliyi değiştirir ve servisi yeniden başlatır (kayıt ve anahtar korunur).
func Update() error {
	if err := stopService(); err != nil {
		return err
	}
	if _, err := copySelf(); err != nil {
		_ = startService()
		return err
	}
	return startService()
}
