//go:build windows

package servis

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/diag"
)

// D-P27-K5: yükseltilmiş kaldırıcının geçici kopyası. Klasör `createSecureDir` ile tek çağrıda (sahip BA, korumalı
// DACL SY+BA) oluşturulur, `diag.OpenDir` ile üst klasör + klasör reparse denetimiyle sabitlenir, ACL `verifyDir` ile
// yeniden okunur. Kopya CREATE_NEW + tek bağ denetimiyle yazılır; başlatma bitene dek yalnız FILE_SHARE_READ ile açık
// tutulur (yazma/silme/yeniden adlandırma paylaşımı yok) ve SHA-256'sı kaynakla aynı değilse başlatılmaz.

// heldCopy başlatma sürerken kopyayı ve klasörünü sabit tutar.
type heldCopy struct {
	dir *diag.Dir
	f   *os.File
}

func (h *heldCopy) Close() {
	_ = h.f.Close()
	h.dir.Close()
}

// uninstallTempBase `%SystemRoot%\Temp` (bilinen klasör API'si; ortam değişkeni okunmaz).
func uninstallTempBase() (string, error) {
	win, err := windows.KnownFolderPath(windows.FOLDERID_Windows, 0)
	if err != nil {
		return "", err
	}
	return filepath.Join(win, "Temp"), nil
}

// secureCopy self'i güvenli geçici klasöre kopyalar; dönen heldCopy başlatma sonrası kapatılmalıdır. Hata yolunda
// klasör silinir.
func secureCopy(self string) (string, *heldCopy, error) {
	base, err := uninstallTempBase()
	if err != nil {
		return "", nil, err
	}
	var rnd [uninstallRandLen]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return "", nil, err
	}
	dir := UninstallTempDir(base, rnd)
	if err := createSecureDir(dir, UninstallTempSDDL); err != nil {
		return "", nil, err
	}
	held, err := fillSecureDir(dir, self)
	if err != nil {
		_ = os.RemoveAll(dir) // junction'ı izlemez (Go ≥ 1.23); klasör yeni ve yalnız SY/BA yazabilir
		return "", nil, err
	}
	return filepath.Join(dir, ExeName), held, nil
}

// fillSecureDir klasörü sabitler, ACL'ini doğrular, kopyayı yazar ve içeriğini kaynakla karşılaştırır.
func fillSecureDir(dir, self string) (*heldCopy, error) {
	d, err := diag.OpenDir(dir, false)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFolderUnsafe, err)
	}
	if err := verifyDir(dir, UninstallTempSDDL); err != nil {
		d.Close()
		return nil, err
	}
	if err := writeCopy(d, self); err != nil {
		d.Close()
		return nil, err
	}
	f, err := d.Open(ExeName, diag.ModeRead) // yalnız FILE_SHARE_READ: kapatılana dek kimse yazamaz/silemez
	if err != nil {
		d.Close()
		return nil, err
	}
	held := &heldCopy{dir: d, f: f}
	if err := matchSource(self, f); err != nil {
		held.Close()
		return nil, err
	}
	return held, nil
}

func writeCopy(d *diag.Dir, self string) error {
	in, err := os.Open(self)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := d.Open(ExeName, diag.ModeCreate)
	if err != nil {
		return err
	}
	_, cerr := io.Copy(out, in)
	return errors.Join(cerr, out.Sync(), out.Close())
}

// matchSource açık kopyanın SHA-256'sı kaynakla aynı değilse hata.
func matchSource(self string, cp *os.File) error {
	src, err := os.Open(self)
	if err != nil {
		return err
	}
	defer src.Close()
	same, err := SameContent(src, cp)
	if err != nil {
		return err
	}
	if !same {
		return fmt.Errorf("%w: kopya kaynakla aynı değil", ErrFolderUnsafe)
	}
	return nil
}

// scheduleTempRemoval geçici kopyayı ve klasörünü ilk yeniden başlatmada sildirir (çalışan ikili kendini silemez;
// sıra önemli: önce dosya, sonra boş klasör).
func scheduleTempRemoval(self string) {
	for _, p := range []string{self, filepath.Dir(self)} {
		if u, err := windows.UTF16PtrFromString(p); err == nil {
			_ = windows.MoveFileEx(u, nil, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
		}
	}
}
