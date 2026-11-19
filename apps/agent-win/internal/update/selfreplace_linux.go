//go:build linux

package update

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
)

// Linux tek ELF yerinde değiştirme (K-P29-11, §14.7 T-12). Yalnız stdlib (imza koşucusu linux; `go list -deps
// ./cmd/update-sign` kapanışı).

// LinuxReplacer çalışan ELF'i aynı klasörde `.<ad>.yeni-<8 hex>` üzerinden rename(2) ile değiştirir.
type LinuxReplacer struct {
	// Exe çalışan ELF'in mutlak yolu (os.Executable, açılışta bir kez).
	Exe string
	// Running çalışan sürecin inode'u (varsayılan /proc/self/exe); testte sahte.
	Running func() (fs.FileInfo, error)
}

func (r LinuxReplacer) running() (fs.FileInfo, error) {
	if r.Running != nil {
		return r.Running()
	}
	return os.Stat("/proc/self/exe")
}

// CleanupPrevious önceki (çökmüş) sürecin geçici dosyalarını siler: yalnız tam desene uyan, düzenli ve sahibi bu süreç
// olan girdiler (AC-484). Hata sessizdir.
func (r LinuxReplacer) CleanupPrevious() {
	dir, base := filepath.Split(r.Exe)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	euid := uint32(os.Geteuid())
	for _, e := range ents {
		if !IsLinuxTemp(base, e.Name()) {
			continue
		}
		p := filepath.Join(dir, e.Name())
		fi, err := os.Lstat(p)
		if err != nil || !fi.Mode().IsRegular() {
			continue
		}
		if st, ok := fi.Sys().(*syscall.Stat_t); ok && st.Uid == euid {
			_ = os.Remove(p)
		}
	}
}

// Prepare konum kararı (CheckPosixLocation) → O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC, 0600 geçici dosya. Açılamazsa
// ErrNotWritable (klasör yazma izninin yoklaması budur).
func (r LinuxReplacer) Prepare() (Staging, error) {
	fi, err := os.Lstat(r.Exe)
	if err != nil {
		return nil, ErrNotWritable
	}
	dir, base := filepath.Split(r.Exe)
	di, err := os.Stat(dir)
	if err != nil {
		return nil, ErrNotWritable
	}
	var sfs syscall.Statfs_t
	if syscall.Statfs(dir, &sfs) != nil {
		return nil, ErrNotWritable
	}
	loc := PosixLocation{ExeRegular: fi.Mode().IsRegular(), Euid: uint32(os.Geteuid()), DirMode: di.Mode(),
		FSFlags: sfs.Flags}
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		loc.ExeOwner = st.Uid
	} else {
		return nil, ErrNotWritable
	}
	if err := CheckPosixLocation(loc); err != nil {
		return nil, err
	}
	var rnd [4]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return nil, err
	}
	tmp := filepath.Join(dir, LinuxTempPrefix(base)+hex.EncodeToString(rnd[:]))
	fd, err := syscall.Open(tmp, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0o600)
	if err != nil {
		return nil, ErrNotWritable
	}
	return &linuxStaging{r: r, f: os.NewFile(uintptr(fd), tmp), tmp: tmp, dir: dir, mode: fi.Mode().Perm()}, nil
}

type linuxStaging struct {
	r        LinuxReplacer
	f        *os.File
	tmp, dir string
	mode     fs.FileMode
	done     bool
}

func (s *linuxStaging) Write(p []byte) (int, error) { return s.f.Write(p) }

var errExeChanged = errors.New("update: çalışan dosya yerinde değil")

// Commit fchmod (asıl kip, u+x korunur) → fsync → kapat → hedef hâlâ çalışan inode mu → rename(2) → klasör fsync.
func (s *linuxStaging) Commit() error {
	if s.done {
		return errors.New("update: hazırlık kapalı")
	}
	s.done = true
	fail := func(err error) error {
		_ = os.Remove(s.tmp)
		return err
	}
	if err := errors.Join(s.f.Chmod(s.mode), s.f.Sync()); err != nil {
		_ = s.f.Close()
		return fail(err)
	}
	if err := s.f.Close(); err != nil {
		return fail(err)
	}
	run, err := s.r.running()
	if err != nil {
		return fail(err)
	}
	cur, err := os.Lstat(s.r.Exe)
	if err != nil || !os.SameFile(run, cur) {
		return fail(errExeChanged)
	}
	if err := os.Rename(s.tmp, s.r.Exe); err != nil {
		return fail(err)
	}
	if d, err := os.Open(s.dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func (s *linuxStaging) Abort() {
	if s.done {
		return
	}
	s.done = true
	_ = s.f.Close()
	_ = os.Remove(s.tmp)
}
