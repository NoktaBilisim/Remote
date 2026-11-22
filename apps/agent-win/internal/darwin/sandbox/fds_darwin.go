//go:build darwin

package sandbox

import (
	"encoding/binary"
	"errors"
	"os"
	"runtime"
	"syscall"

	"remote-support/agent-win/internal/darwin/objc"
)

// S-P33-K-1: fork/exec, purego ile yüklenen Apple çerçevelerinin CLOEXEC'siz açtığı fd'leri yardımcıya geçirir; sandbox
// open/connect anında denetler, zaten açık bir fd üzerindeki read/write/send'i genelde denetlemez. Yardımcı bu yüzden
// her şeyden önce (çözücü ısıtması ve sandbox_init'ten önce) 0/1/2 (IPC: stdin istek, stdout yanıt) dışındaki tüm
// devralınmış fd'leri kapatır. Kqueue'lar fork ile devralınmaz (kqueue(2)); süreçteki kqueue Go çalışma zamanının kendi
// ağ yoklayıcısıdır ve kapatılmaz.

// proc_info.h (macOS SDK): PROC_PIDLISTFDS, struct proc_fdinfo { int32 proc_fd; uint32 proc_fdtype; }.
const (
	procPIDListFDs = 1
	fdInfoSize     = 8
	// FDTypeKqueue PROX_FDTYPE_KQUEUE.
	FDTypeKqueue = 5
	maxListedFDs = 1 << 14
)

// FD bir sürecin açık tanımlayıcısı (proc_fdinfo).
type FD struct {
	Num  int
	Type uint32
}

// ErrFDList süreç fd listesi alınamadı.
var ErrFDList = errors.New("sandbox: fd listesi alınamadı")

var procPIDInfo func(pid int32, flavor int32, arg uint64, buf *byte, size int32) int32

func bindProc() error {
	if procPIDInfo != nil {
		return nil
	}
	h, err := objc.Open(objc.LibSystem)
	if err != nil {
		return errors.Join(ErrFDList, err)
	}
	if err := objc.Func(&procPIDInfo, h, "proc_pidinfo"); err != nil {
		procPIDInfo = nil
		return errors.Join(ErrFDList, err)
	}
	return nil
}

// ListFDs pid'li sürecin açık fd'lerini döndürür (aynı kullanıcının süreci; proc_pidinfo PROC_PIDLISTFDS).
func ListFDs(pid int) ([]FD, error) {
	if err := bindProc(); err != nil {
		return nil, err
	}
	buf := make([]byte, maxListedFDs*fdInfoSize)
	n := procPIDInfo(int32(pid), procPIDListFDs, 0, &buf[0], int32(len(buf)))
	runtime.KeepAlive(buf)
	if n <= 0 || int(n) > len(buf) || n%fdInfoSize != 0 {
		return nil, ErrFDList
	}
	fds := make([]FD, 0, n/fdInfoSize)
	for i := 0; i < int(n); i += fdInfoSize {
		fds = append(fds, FD{Num: int(int32(binary.LittleEndian.Uint32(buf[i:]))), Type: binary.LittleEndian.Uint32(buf[i+4:])})
	}
	return fds, nil
}

// CloseInheritedFDs 0/1/2 ve kqueue dışındaki tüm fd'leri kapatır; liste alınamaz ya da kapatma sonrası fd kalırsa hata
// (çağıran yardımcı çıkar: fail-closed).
func CloseInheritedFDs() error {
	fds, err := ListFDs(os.Getpid())
	if err != nil {
		return err
	}
	for _, fd := range fds {
		if fd.Num > 2 && fd.Type != FDTypeKqueue {
			_ = syscall.Close(fd.Num)
		}
	}
	fds, err = ListFDs(os.Getpid())
	if err != nil {
		return err
	}
	for _, fd := range fds {
		if fd.Num > 2 && fd.Type != FDTypeKqueue {
			return ErrFDList
		}
	}
	return nil
}
