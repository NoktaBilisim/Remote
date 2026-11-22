//go:build darwin

// Package sandbox P33 Opus çözücü yardımcısının macOS sandbox'ı (mimari-p33 §6.6, S-P33-T-1, S-P33-T2-1/2).
// sandbox_init / sandbox_check libSystem'den (izin listesindeki /usr/lib/libSystem.B.dylib) purego ile bağlanır.
//
// Profil: yalnız `(deny default)`. K1 ölçümü (docs/spike-p33-k0s.md §2.7): AudioConverter çözücüleri sandbox'tan ÖNCE
// kurulup ısıtılınca çözme, PLC ve AudioConverterReset hiçbir izin olmadan sürer; file-read*, sysctl-read ve
// AudioComponentRegistrar mach-lookup'ı gerekmez (S-P33-T2-1 m.3, tercih edilen daraltma). socket() çağrısı SBPL ile
// engellenemiyor (ölçüldü: deny default ve `(deny system-socket)` altında da fd dönüyor); ağ çıkışı connect/sendto
// düzeyinde EPERM'dir — öz-test bunu sınar.
package sandbox

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"syscall"

	"remote-support/agent-win/internal/darwin/objc"
)

// Profile çözücü yardımcısının SBPL profili (tam metin; değişiklik güvenlik incelemesi ister).
const Profile = "(version 1)\n(deny default)\n"

var (
	// ErrUnavailable sandbox işlevleri bağlanamadı.
	ErrUnavailable = errors.New("sandbox: sandbox_init bağlanamadı")
	// ErrSelfTest sandbox_init 0 döndü ama yasak işlemler reddedilmedi (S-P33-T2-2: sessizce etkisiz sandbox).
	ErrSelfTest = errors.New("sandbox: öz-test başarısız")
)

var (
	sbInit  func(profile *byte, flags uint64, errbuf *uintptr) int32
	sbFree  func(errbuf uintptr)
	sbCheck func(pid int32, op uintptr, typ int32) int32
)

func bind() error {
	if sbInit != nil {
		return nil
	}
	h, err := objc.Open(objc.LibSystem)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	if err := errors.Join(objc.Func(&sbInit, h, "sandbox_init"), objc.Func(&sbFree, h, "sandbox_free_error"),
		objc.Func(&sbCheck, h, "sandbox_check")); err != nil {
		sbInit = nil
		return errors.Join(ErrUnavailable, err)
	}
	return nil
}

// Enter süreci Profile'a sokar (geri alınamaz). Hata iletisi sandbox'ın metnini taşımaz (yalnız dönüş kodu).
func Enter() error {
	if err := bind(); err != nil {
		return err
	}
	p := append([]byte(Profile), 0)
	var eb uintptr
	rc := sbInit(&p[0], 0, &eb)
	runtime.KeepAlive(p)
	if eb != 0 {
		sbFree(eb)
	}
	if rc != 0 {
		return fmt.Errorf("sandbox: sandbox_init rc=%d", rc)
	}
	return nil
}

// Check pid'li süreç bir sandbox içinde mi (sandbox_check(pid, NULL, SANDBOX_FILTER_NONE) == 1).
func Check(pid int) (bool, error) {
	if err := bind(); err != nil {
		return false, err
	}
	return sbCheck(int32(pid), 0, 0) == 1, nil
}

// selfTestPaths var olduğu bilinen, sandbox dışında okunabilen yollar (EPERM beklenir; ENOENT ölçmemek için var olanlar).
var selfTestPaths = []string{"/Users", "/Library/Keychains"}

// SelfTest Enter'dan sonra çağrılır (S-P33-T2-2 m.1): süreç sandbox'ta görünmeli, kullanıcı dizinleri okunamamalı,
// /tmp'ye yazılamamalı ve ağa bağlanılamamalı (hepsi EPERM). Biri tutmazsa ErrSelfTest.
func SelfTest() error {
	if in, err := Check(os.Getpid()); err != nil || !in {
		return fmt.Errorf("%w: sandbox_check", ErrSelfTest)
	}
	for _, p := range selfTestPaths {
		if err := readProbe(p); !errors.Is(err, syscall.EPERM) {
			return fmt.Errorf("%w: okuma", ErrSelfTest)
		}
	}
	if err := WriteProbe(); !errors.Is(err, syscall.EPERM) {
		return fmt.Errorf("%w: yazma", ErrSelfTest)
	}
	if err := ConnectProbe(); !errors.Is(err, syscall.EPERM) {
		return fmt.Errorf("%w: ağ", ErrSelfTest)
	}
	return nil
}

func readProbe(p string) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	_, err = f.Readdirnames(1)
	_ = f.Close()
	return err
}

// ReadProbe yolu okumayı dener (dizinse ilk girdi, dosyaysa ilk bayt).
func ReadProbe(p string) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	if st, err := f.Stat(); err == nil && st.IsDir() {
		_, err = f.Readdirnames(1)
		return err
	}
	_, err = f.Read(make([]byte, 1))
	return err
}

// WriteProbe /tmp altında yeni dosya açmayı dener; sandbox dışında açılırsa hemen silinir.
func WriteProbe() error {
	p := fmt.Sprintf("/private/tmp/.noktadestek-sb-%d", os.Getpid())
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_ = f.Close()
	_ = os.Remove(p)
	return nil
}

// ConnectProbe 127.0.0.1:9'a TCP ve UDP göndermeyi dener (sandbox dışında ECONNREFUSED/başarı, içinde EPERM).
func ConnectProbe() error {
	addr := &syscall.SockaddrInet4{Port: 9, Addr: [4]byte{127, 0, 0, 1}}
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	if err != nil {
		return err
	}
	err = syscall.Connect(fd, addr)
	_ = syscall.Close(fd)
	if !errors.Is(err, syscall.EPERM) {
		return errors.Join(errors.New("tcp"), errOrNil(err))
	}
	ufd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, 0)
	if err != nil {
		return err
	}
	err = syscall.Sendto(ufd, []byte{0}, 0, addr)
	_ = syscall.Close(ufd)
	if !errors.Is(err, syscall.EPERM) {
		return errors.Join(errors.New("udp"), errOrNil(err))
	}
	return syscall.EPERM
}

var errConnected = errors.New("bağlandı")

func errOrNil(err error) error {
	if err == nil {
		return errConnected
	}
	return err
}
