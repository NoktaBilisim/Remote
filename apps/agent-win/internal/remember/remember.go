// Package remember istemcinin kendi adına diske yazdığı kalıcı veri dosyasıdır (yanında yalnız yakalama sorununda
// yazılan tanılama logu bulunabilir, internal/diag) (ADR-0004 r4; AC-136..138, AC-181, AC-186):
// `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`, DPAPI CurrentUser + sabit entropi ile korunan JSON (≤ 4 KB). İçerik
// format v2: kişisel bilgiler ("Bilgilerimi hatırla") ve/veya bilgisayar kaydı (sunucu kökeni, kayıt anahtarı, firma
// ve müşteri adı). Açıklama, onay, talep kimliği/sırrı ve ref YAZILMAZ. Depo mantığı platformdan bağımsızdır (koruma
// fonksiyonları enjekte edilir); Windows eşi dpapi_windows.go.
package remember

import (
	"errors"
	"io"
	"os"
	"sync"

	"remote-support/agent-win/internal/diag"
)

const (
	fileName  = "hatirla.bin"
	tmpName   = fileName + ".tmp"
	plainMax  = 4096
	sealedMax = 16 * 1024
)

// Store dosya deposu. Dir istemcinin oluşturduğu klasördür (yalnız boşsa silinir). Tüm yazımlar oku-değiştir-yaz
// olarak tek kilit altında yapılır (talep akışı ve oturum aynı depoyu paylaşır).
type Store struct {
	Dir       string
	Protect   func([]byte) ([]byte, error)
	Unprotect func([]byte) ([]byte, error)
	mu        sync.Mutex
}

// Load dosyayı okur. Dosya yoksa false; çözülemiyor/bozuk/başka kullanıcının ise sessizce silinir, false.
func (s *Store) Load() (Data, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

// Persistent kalıcı mod etkin mi: dosyada bilgisayar kaydı veya hatırlanan kişisel bilgi var (0.10.2: tanılama logu
// yalnız bu durumda yazılır; kod modunda/kayıtsızken AC-108/AC-138 gereği iz bırakılmaz).
func (s *Store) Persistent() bool {
	d, ok := s.Load()
	return ok && (d.Personal != nil || d.Binding != nil)
}

// LoadPersonal yalnız kişisel bilgiler (talep formu).
func (s *Store) LoadPersonal() (Personal, bool) {
	d, ok := s.Load()
	if !ok || d.Personal == nil {
		return Personal{}, false
	}
	return *d.Personal, true
}

// load dosyayı klasör zinciri denetimiyle (diag.Dir; Windows'ta handle ile, AC-249) okur. Klasör veya dosya bağlantı/
// reparse noktasıysa okunmaz ve hiçbir şey silinmez.
func (s *Store) load() (Data, bool) {
	dir, err := diag.OpenDir(s.Dir, false)
	if err != nil {
		return Data{}, false
	}
	defer dir.Close()
	f, err := dir.Open(fileName, diag.ModeRead)
	if err != nil {
		return Data{}, false
	}
	sealed, err := io.ReadAll(io.LimitReader(f, sealedMax+1))
	_ = f.Close()
	if err != nil || len(sealed) > sealedMax {
		_ = s.forgetIn(dir)
		return Data{}, false
	}
	plain, err := s.Unprotect(sealed)
	if err != nil || len(plain) > plainMax {
		_ = s.forgetIn(dir)
		return Data{}, false
	}
	d, err := decode(plain)
	if err != nil {
		_ = s.forgetIn(dir)
		return Data{}, false
	}
	return d, true
}

// update mevcut içeriği değiştirip yazar; iki alan da boşaldıysa dosya (ve boşsa klasör) silinir.
func (s *Store) update(fn func(*Data)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, _ := s.load()
	fn(&d)
	if d.Personal == nil && d.Binding == nil {
		return s.forgetAll()
	}
	return s.write(d)
}

// SavePersonal talep 201 aldıktan sonra kişisel bilgileri yazar; varsa kaydı korur.
func (s *Store) SavePersonal(p Personal) error {
	if !p.valid() {
		return errors.New("remember: geçersiz kişisel bilgi")
	}
	return s.update(func(d *Data) { d.Personal = &p })
}

// ClearPersonal "Bilgilerimi unut" (AC-137, AC-186): yalnız ad/telefon/e-posta ve cihaz anahtarı silinir (G-E10-5:
// sonraki hatırlamada yeni anahtar üretilir); kayıt varsa dosya kalır, yoksa dosya silinir.
func (s *Store) ClearPersonal() error {
	return s.update(func(d *Data) { d.Personal = nil })
}

// SaveBinding `binding.issued` sonrası (AC-181, AC-187): tek kayıt — öncekinin üzerine yazar; kişisel alan korunur.
func (s *Store) SaveBinding(b Binding) error {
	if !b.valid() {
		return errors.New("remember: geçersiz kayıt")
	}
	return s.update(func(d *Data) { d.Binding = &b })
}

// ClearBinding geçersiz kayıt (AC-185): kayıt silinir, kişisel bilgiler kalır.
func (s *Store) ClearBinding() error {
	return s.update(func(d *Data) { d.Binding = nil })
}

// ForgetAll "Bu bilgisayarı unut" (AC-186): dosya, varsa tmp, tanılama logu (internal/diag, 0.10.2), ardından YALNIZ
// boşsa klasör.
func (s *Store) ForgetAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.forgetAll()
}

// write aynı klasörde `.tmp` (yalnız yeni dosya) → handle üzerinden yeniden adlandırma (diag.Dir, AC-249; var olan
// hatirla.bin'in üzerine). Önceki çalışmadan kalan tmp → silinir ve bir kez yeniden denenir (G-E9-13). Klasör zinciri,
// tmp veya hedef bağlantı/reparse noktasıysa diag.ErrReparse; hedef dışı dosya değişmez.
func (s *Store) write(d Data) error {
	plain, err := encode(d)
	if err != nil {
		return err
	}
	if len(plain) > plainMax {
		return errors.New("remember: veri çok büyük")
	}
	sealed, err := s.Protect(plain)
	if err != nil {
		return err
	}
	dir, err := diag.OpenDir(s.Dir, true)
	if err != nil {
		return err
	}
	defer dir.Close()
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

// forgetAll klasör yoksa nil; klasör zinciri bağlantıysa diag.ErrReparse (hiçbir şey silinmez).
func (s *Store) forgetAll() error {
	dir, err := diag.OpenDir(s.Dir, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer dir.Close()
	return s.forgetIn(dir)
}

// forgetIn dosyaları handle üzerinden siler (yol ile os.Remove yok, AC-249); bağlantı olan girdi silinmez ve hata
// döner. Hepsi silindiyse klasör yalnız boşsa silinir.
func (s *Store) forgetIn(dir *diag.Dir) error {
	var errs []error
	for _, n := range []string{fileName, tmpName, diag.FileName, diag.OldName} {
		if err := dir.Remove(n); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		dir.RemoveIfEmpty()
	}
	return errors.Join(errs...)
}

// NoticeText AC-188 bilgi satırı (P6 karşılama ve talep formu; kayıt yalnız başarılı oturumdan sonra yazılır).
func NoticeText(firm string) string {
	return "Oturumdan sonra bu bilgisayar " + firm + " için hatırlanır; istediğinizde 'Bu bilgisayarı unut' ile silebilirsiniz."
}
