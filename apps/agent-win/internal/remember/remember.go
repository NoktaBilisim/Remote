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
	"path/filepath"
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

func (s *Store) load() (Data, bool) {
	f, err := os.Open(filepath.Join(s.Dir, fileName))
	if err != nil {
		return Data{}, false
	}
	sealed, err := io.ReadAll(io.LimitReader(f, sealedMax+1))
	_ = f.Close()
	if err != nil || len(sealed) > sealedMax {
		_ = s.forgetAll()
		return Data{}, false
	}
	plain, err := s.Unprotect(sealed)
	if err != nil || len(plain) > plainMax {
		_ = s.forgetAll()
		return Data{}, false
	}
	d, err := decode(plain)
	if err != nil {
		_ = s.forgetAll()
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

// write aynı klasörde `.tmp` (O_EXCL) → yeniden adlandırma (Windows'ta MoveFileEx(MOVEFILE_REPLACE_EXISTING)).
// Önceki çalışmadan kalan tmp → silinir ve bir kez yeniden denenir (G-E9-13).
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
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	tmp := filepath.Join(s.Dir, tmpName)
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		_ = os.Remove(tmp)
		f, err = os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	}
	if err != nil {
		return err
	}
	_, werr := f.Write(sealed)
	serr := f.Sync()
	cerr := f.Close()
	if err := errors.Join(werr, serr, cerr); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, filepath.Join(s.Dir, fileName)); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *Store) forgetAll() error {
	var errs []error
	for _, n := range []string{fileName, tmpName, diag.FileName, diag.OldName} {
		if err := os.Remove(filepath.Join(s.Dir, n)); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		if ents, err := os.ReadDir(s.Dir); err == nil && len(ents) == 0 {
			_ = os.Remove(s.Dir)
		}
	}
	return errors.Join(errs...)
}

// NoticeText AC-188 bilgi satırı (P6 karşılama ve talep formu; kayıt yalnız başarılı oturumdan sonra yazılır).
func NoticeText(firm string) string {
	return "Oturumdan sonra bu bilgisayar " + firm + " için hatırlanır; istediğinizde 'Bu bilgisayarı unut' ile silebilirsiniz."
}
