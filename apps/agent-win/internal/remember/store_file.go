package remember

import (
	"errors"
	"io"
	"os"

	"remote-support/agent-win/internal/diag"
)

// Dosya işlemleri (hepsi kilit altında, klasör handle'ı üzerinden; AC-249): okuma, bozuk dosyanın atılması, silme, yazma.

// readSealed dosyayı klasör handle'ı üzerinden (AC-249) okur ve çözer. Dosya yoksa os.ErrNotExist; dönen hata
// sınıflandırılabilir (classify).
func readSealed(dir *diag.Dir, name string, unprotect func([]byte) ([]byte, error)) ([]byte, error) {
	f, err := dir.Open(name, diag.ModeRead)
	if err != nil {
		return nil, err
	}
	sealed, err := io.ReadAll(io.LimitReader(f, sealedMax+1))
	_ = f.Close()
	if err != nil {
		return nil, err
	}
	if len(sealed) > sealedMax {
		return nil, errCorrupt
	}
	plain, err := unprotect(sealed)
	if err != nil {
		return nil, err
	}
	if len(plain) > plainMax {
		return nil, errCorrupt
	}
	return plain, nil
}

// load kilit altında `kayitlar.bin`'i okur. startup true ise (açılışta bir kez, Migrate) sınıf-2 sayacı ilerletilir;
// başarılı okumada sayaç sıfırlanır.
func (s *Store) load(h *held, startup bool) LoadResult {
	plain, err := readSealed(h.dir, fileName, s.Unprotect)
	if notExist(err) {
		h.setCounter(0)
		return LoadResult{Status: StatusAbsent}
	}
	var d Data
	var trimmed bool
	if err == nil {
		d, trimmed, err = decode(plain)
		if err != nil {
			err = errCorrupt
		}
	}
	if err == nil {
		h.setCounter(0)
		return LoadResult{Data: d, Status: StatusOK, Trimmed: trimmed}
	}
	class := classify(err)
	if class == ClassFormat {
		h.setCounter(0)
		s.dropBroken(h.dir)
		return LoadResult{Status: StatusAbsent, Class: ClassFormat}
	}
	r := LoadResult{Status: StatusUnreadable, Class: class, cause: err}
	r.SuggestForget = h.unreadable(class, startup)
	return r
}

// dropBroken sınıf-1: bozuk dosya ve tmp silinir (handle ile); kalıcı veri kalmadıysa tanılama logu da (kalıcı mod
// kapandı). `hatirla.bin` ve kilit dosyasına dokunulmaz.
func (s *Store) dropBroken(dir *diag.Dir) {
	_ = dir.Remove(fileName)
	_ = dir.Remove(tmpName)
	if f, err := dir.Open(legacyName, diag.ModeRead); err == nil {
		_ = f.Close()
		return
	}
	_ = dir.Remove(diag.FileName)
	_ = dir.Remove(diag.OldName)
}

// wipe kilit altında veri dosyalarını siler, kilidi bırakıp kilit dosyasını ve (hepsi silindiyse) boş klasörü siler.
// Bağlantı olan girdi silinmez ve hata döner (AC-249). Kilit dosyası başka süreçte açıksa kalır (kişisel veri yok).
func (s *Store) wipe(h *held) error {
	var errs []error
	for _, n := range []string{fileName, tmpName, legacyName, legacyTmpName, diag.FileName, diag.OldName} {
		if err := h.dir.Remove(n); err != nil && !notExist(err) {
			errs = append(errs, err)
		}
	}
	h.unlock()
	if err := h.dir.Remove(lockName); err != nil && !notExist(err) && !isSharing(err) {
		errs = append(errs, err)
	}
	if len(errs) == 0 {
		h.dir.RemoveIfEmpty()
	}
	h.dir.Close()
	return classed(errors.Join(errs...))
}

// write aynı klasörde `.tmp` (yalnız yeni dosya) → handle üzerinden yeniden adlandırma (diag.Dir, AC-249; var olan
// kayitlar.bin'in üzerine). Önceki çalışmadan kalan tmp → silinir ve bir kez yeniden denenir (G-E9-13). Klasör zinciri,
// tmp veya hedef bağlantı/reparse noktasıysa diag.ErrReparse; hedef dışı dosya değişmez.
func (s *Store) write(dir *diag.Dir, d Data) error {
	plain, err := encode(d)
	if err != nil {
		return err
	}
	if len(plain) > plainMax {
		return errTooLarge
	}
	sealed, err := s.Protect(plain)
	if err != nil {
		return &Error{Class: ClassDPAPI, Err: err}
	}
	if len(sealed) > sealedMax {
		return errTooLarge
	}
	f, err := dir.Open(tmpName, diag.ModeCreate)
	if errors.Is(err, os.ErrExist) {
		_ = dir.Remove(tmpName)
		f, err = dir.Open(tmpName, diag.ModeCreate)
	}
	if err != nil {
		return err
	}
	_, werr := f.Write(sealed)
	serr := f.Sync()
	cerr := f.Close()
	if err := errors.Join(werr, serr, cerr); err != nil {
		_ = dir.Remove(tmpName)
		return err
	}
	if err := dir.Rename(tmpName, fileName); err != nil {
		_ = dir.Remove(tmpName)
		return err
	}
	return nil
}
