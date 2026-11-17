//go:build linux

package files

import (
	"errors"
	"os"
	"syscall"
)

// ReceivedMode alınan dosyanın (ve `.part`'ın) Linux izinleri: rw-r--r--, yürütme biti hiçbir zaman yok (mimari-p28g
// §2, §5.1 T8).
const ReceivedMode os.FileMode = 0o644

// ErrExecBit yürütme biti sökülemedi (ör. fmask'lı vfat/exfat birimi) ya da dosya beklenen türde değil.
var ErrExecBit = errors.New("files: alınan dosyanın yürütme biti kaldırılamadı")

// ClearExec MOTW'nin Linux karşılığı (T8): Linux'ta zorunlu bir indirme işareti yoktur (GNOME/Nautilus xattr
// denetlemez); alınan dosyanın çalıştırılamaz olması tek garantidir. `.part` sembolik bağ izlenmeden açılır (O_NOFOLLOW),
// normal dosya ve bu kullanıcıya ait olmalıdır; kipi 0644'e çekilir ve sonuç yeniden okunur: yürütme biti (ya da
// setuid/setgid/sticky) kalmışsa hata (transfer motw_linux.go: dosya teslim edilmez). Yeniden adlandırma kipi korur.
func ClearExec(path string) error {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return errors.Join(ErrExecBit, err)
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || !fi.Mode().IsRegular() {
		return ErrExecBit
	}
	if st, ok := fi.Sys().(*syscall.Stat_t); !ok || int(st.Uid) != os.Getuid() {
		return ErrExecBit
	}
	if err := f.Chmod(ReceivedMode); err != nil {
		return errors.Join(ErrExecBit, err)
	}
	if fi, err = f.Stat(); err != nil || fi.Mode()&(0o111|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return ErrExecBit
	}
	return nil
}
