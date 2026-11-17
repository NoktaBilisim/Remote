//go:build darwin || linux

package macperm

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// T6 yeniden başlatma kod dosyası: dizin sahibi bu kullanıcı ve 0700; dosya O_CREAT|O_EXCL|O_NOFOLLOW 0600, okuma
// O_NOFOLLOW + fstat (sahip, 0600, normal dosya, tek bağ, ≤ 120 sn), içerik yalnız 8 rakam; okunan dosya her durumda
// silinir.

const (
	filePrefix = "noktadestek-yeniden-"
	maxAge     = 120 * time.Second
)

var (
	// ErrUnsafeDir dizin bu kullanıcıya ait 0700 bir dizin değil.
	ErrUnsafeDir = errors.New("macperm: geçici dizin güvenli değil")
	// ErrBadFile dosya denetimleri (tür, sahip, izin, yaş, içerik) geçmedi.
	ErrBadFile = errors.New("macperm: yeniden başlatma dosyası geçersiz")

	codeRe = regexp.MustCompile(`^[0-9]{8}$`)
)

func checkDir(dir string) error {
	st, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !st.IsDir() || !ok || int(sys.Uid) != os.Getuid() || st.Mode().Perm() != 0o700 {
		return ErrUnsafeDir
	}
	return nil
}

// WriteRestart kodu dir/<önek><belirteç> dosyasına yazar.
func WriteRestart(dir, token, code string) error {
	if !tokenRe.MatchString(token) || !codeRe.MatchString(code) {
		return ErrBadFile
	}
	if err := checkDir(dir); err != nil {
		return err
	}
	fd, err := unix.Open(filepath.Join(dir, filePrefix+token), unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "")
	_, err = f.WriteString(code)
	return errors.Join(err, f.Close())
}

// ReadRestart belirteçle eşleşen dosyayı denetleyip okur ve siler; now yaş denetimi içindir.
func ReadRestart(dir, token string, now time.Time) (string, error) {
	if !tokenRe.MatchString(token) {
		return "", ErrBadFile
	}
	if err := checkDir(dir); err != nil {
		return "", err
	}
	path := filepath.Join(dir, filePrefix+token)
	defer os.Remove(path)
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return "", err
	}
	f := os.NewFile(uintptr(fd), "")
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	age := now.Sub(st.ModTime())
	if !st.Mode().IsRegular() || !ok || int(sys.Uid) != os.Getuid() || st.Mode().Perm() != 0o600 || sys.Nlink != 1 ||
		age > maxAge || age < -5*time.Second {
		return "", ErrBadFile
	}
	b, err := io.ReadAll(io.LimitReader(f, 16))
	if err != nil || !codeRe.Match(b) {
		return "", ErrBadFile
	}
	return string(b), nil
}

// RemoveRestart belirteçli dosyayı siler (başarısız yeniden başlatma).
func RemoveRestart(dir, token string) {
	if tokenRe.MatchString(token) {
		_ = os.Remove(filepath.Join(dir, filePrefix+token))
	}
}

// PurgeRestart belirteçsiz açılışta bekleyen tüm dosyaları okumadan siler (S-P28f-13).
func PurgeRestart(dir string) {
	if checkDir(dir) != nil {
		return
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), filePrefix) {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}
