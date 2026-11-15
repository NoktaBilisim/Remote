// Package remember istemcinin kendi adına diske yazdığı kalıcı veri dosyasıdır (yanında yalnız kilit dosyası ve
// yakalama sorununda yazılan tanılama logu bulunabilir, internal/diag) (ADR-0004 r6; AC-136..138, AC-181, AC-186,
// AC-254): `%LOCALAPPDATA%\NoktaDestek\kayitlar.bin`, DPAPI CurrentUser + sabit entropi ile korunan JSON v3
// (düz ≤ 32 KB). İçerik: kişisel bilgiler ("Bilgilerimi hatırla"), köken başına ≤ 5 ve en çok 2 kökende bilgisayar
// kaydı (sunucu kökeni, kayıt anahtarı, firma ve müşteri adı, kayıt/son kullanım zamanı) ve tepsi tercihi. Açıklama,
// onay, talep kimliği/sırrı ve ref YAZILMAZ. 0.10.x/0.11.x `hatirla.bin` dosyası Migrate ile taşınır (migrate.go).
// Depo mantığı platformdan bağımsızdır (koruma fonksiyonları enjekte edilir); Windows eşi dpapi_windows.go,
// lock_windows.go.
package remember

import (
	"errors"
	"io"
	"os"
	"sync"
	"time"

	"remote-support/agent-win/internal/diag"
)

const (
	fileName       = "kayitlar.bin"
	tmpName        = fileName + ".tmp"
	legacyName     = "hatirla.bin"
	legacyTmpName  = legacyName + ".tmp"
	lockName       = "kayitlar.lock"
	plainMax       = 32 * 1024  // G-P20-4: en kötü durum ≈ 19 KB (10 öğe × azami alan + kişisel bilgi)
	sealedMax      = 128 * 1024 // DPAPI zarfı + pay
	suggestForgetN = 3          // aynı sınıf-2 kodu ardışık bu kadar açılışta → silme önerisi (G-P20-18)
)

// Kilit yoklama aralığı ve en uzun bekleme (G-P20-2); testler kısaltır.
var (
	lockPoll = 50 * time.Millisecond
	lockWait = 2 * time.Second
)

// Status okuma sonucu.
type Status int

const (
	// StatusAbsent dosya yok (ya da sınıf-1 hatası nedeniyle silindi): kayıtsız.
	StatusAbsent Status = iota
	// StatusOK dosya okundu.
	StatusOK
	// StatusUnreadable sınıf-2 (geçici) hata: dosyaya dokunulmadı. Açılış salt-okunurdur: yazma yok, `-tray`'de Run
	// silinmez, "kayıt yok" kararı verilmez; "Bu bilgisayarı unut" yine sunulur (ForgetAll okumadan bağımsız siler).
	StatusUnreadable
)

// LoadResult okuma durumu (G-P20-3/17/18).
type LoadResult struct {
	Data   Data
	Status Status
	// Class StatusUnreadable'da hata sınıfı (diag `load_failed{class}`); sınıf 1'de (dosya silindi) ClassFormat.
	Class string
	// Trimmed okumada sayım ihlali vardı; fazla öğeler bellekte atıldı, bir sonraki yazımda dosya düzelir. Ana ekranda
	// bir kez bilgi satırı (G-P20-17).
	Trimmed bool
	// SuggestForget aynı sınıf-2 kodu ardışık ≥ 3 açılışta görüldü: kullanıcıya silme önerilir; sessiz silme yok.
	SuggestForget bool
	cause         error // sınıf-2 hatanın kendisi (update yazma reddine sarar; errors.Is ile görülebilir)
}

// Store dosya deposu. Dir istemcinin oluşturduğu klasördür (yalnız boşsa silinir). Her okuma ve oku-değiştir-yaz,
// süreç içinde mu, süreçler arasında `kayitlar.lock` kilidi altında yapılır ve kilit içinde dosyayı yeniden okur
// (tepsi süreci ile kod/ref dosyasıyla açılan süreç aynı dosyayı yazabilir; G-P20-2/16).
type Store struct {
	Dir       string
	Protect   func([]byte) ([]byte, error)
	Unprotect func([]byte) ([]byte, error)
	// UnprotectLegacy `hatirla.bin` çözücüsü (eski entropi); nil ise göç yapılmaz.
	UnprotectLegacy func([]byte) ([]byte, error)
	mu              sync.Mutex
}

// held alınmış kilit: klasör (handle'larıyla sabit, AC-249) ve kilit dosyası.
type held struct {
	dir  *diag.Dir
	lock *os.File // kilit ve sayaç baytı bu handle üzerinden; nil = kilitsiz (ForgetAll zaman aşımı)
}

// acquire klasörü açar (create: yoksa oluşturur), `kayitlar.lock`'u handle kuralıyla açar ve özel kilidi 50 ms
// aralıkla en çok 2 sn yoklar. Klasör yoksa os.ErrNotExist; zaman aşımında ErrLockTimeout.
func (s *Store) acquire(create bool) (*held, error) {
	dir, err := diag.OpenDir(s.Dir, create)
	if err != nil {
		return nil, err
	}
	f, err := dir.Open(lockName, diag.ModeLock)
	if err != nil {
		dir.Close()
		return nil, err
	}
	deadline := time.Now().Add(lockWait)
	for {
		ok, err := tryLock(f)
		if err != nil {
			_ = f.Close()
			dir.Close()
			return nil, err
		}
		if ok {
			return &held{dir: dir, lock: f}, nil
		}
		if time.Now().After(deadline) {
			_ = f.Close()
			dir.Close()
			return nil, ErrLockTimeout
		}
		time.Sleep(lockPoll)
	}
}

// unlock kilidi bırakır ve kilit dosyasını kapatır (klasör açık kalır).
func (h *held) unlock() {
	if h.lock != nil {
		unlock(h.lock)
		_ = h.lock.Close()
		h.lock = nil
	}
}

func (h *held) close() {
	h.unlock()
	h.dir.Close()
}

// counter kilit dosyasındaki tek bayt: yüksek 4 bit sınıf-2 kodu, düşük 4 bit ardışık açılış sayısı (G-P20-18).
// Kişisel veri değildir; yalnız kilit altında okunur/yazılır.
func (h *held) counter() byte {
	if h.lock == nil {
		return 0
	}
	b := make([]byte, 1)
	if n, err := h.lock.ReadAt(b, 0); n != 1 || (err != nil && !errors.Is(err, io.EOF)) {
		return 0
	}
	return b[0]
}

func (h *held) setCounter(v byte) {
	if h.lock != nil && h.counter() != v {
		_, _ = h.lock.WriteAt([]byte{v}, 0)
	}
}

// LoadState dosyayı okur (G-P20-3): sınıf 1'de dosya silinir (StatusAbsent), sınıf 2'de dokunulmaz
// (StatusUnreadable). Kayıtlı/kayıtsız kararı ve salt-okunur açılış bu sonuca göre verilir.
func (s *Store) LoadState() LoadResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, err := s.acquire(false)
	if err != nil {
		if notExist(err) {
			return LoadResult{Status: StatusAbsent}
		}
		return LoadResult{Status: StatusUnreadable, Class: classify(err)}
	}
	defer h.close()
	return s.load(h, false)
}

// Load yalnız başarıyla okunan veri (dosya yok veya okunamıyorsa false). Salt-okunur durum ayrımı için LoadState.
func (s *Store) Load() (Data, bool) {
	r := s.LoadState()
	return r.Data, r.Status == StatusOK
}

// Persistent kalıcı mod etkin mi: dosyada bilgisayar kaydı veya hatırlanan kişisel bilgi var (0.10.2: tanılama logu
// yalnız bu durumda yazılır; kod modunda/kayıtsızken AC-108/AC-138 gereği iz bırakılmaz).
func (s *Store) Persistent() bool {
	d, ok := s.Load()
	return ok && !d.empty()
}

// LoadPersonal yalnız kişisel bilgiler (talep formu).
func (s *Store) LoadPersonal() (Personal, bool) {
	d, ok := s.Load()
	if !ok || d.Personal == nil {
		return Personal{}, false
	}
	return *d.Personal, true
}

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
	code, c := counterCode(class), h.counter()
	n := c & 0x0f
	if c>>4 != code {
		n = 0
	}
	if startup {
		if n < 0x0f {
			n++
		}
		h.setCounter(code<<4 | n)
	}
	r.SuggestForget = n >= suggestForgetN
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

// update mevcut içeriği kilit altında yeniden okur, fn ile değiştirip yazar. Okuma sınıf-2 ise yazmaz
// (ErrUnreadable; boş veriyle üzerine yazma yok). Veri boşaldıysa dosyalar (ve boşsa klasör) silinir. Kayıt
// kalmadıysa tercih düşer. fn errNoChange dönerse yazılmaz.
func (s *Store) update(fn func(*Data) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, err := s.acquire(false)
	if notExist(err) {
		var d Data
		if err := fn(&d); err != nil {
			if errors.Is(err, errNoChange) {
				return nil
			}
			return classed(err)
		}
		if d.empty() {
			return nil
		}
		h, err = s.acquire(true)
	}
	if err != nil {
		return classed(err)
	}
	r := s.load(h, false)
	if r.Status == StatusUnreadable {
		h.close()
		return &Error{Class: ClassUnreadable, Err: errors.Join(ErrUnreadable, r.cause)}
	}
	d := r.Data
	d.Bindings = append([]Binding(nil), d.Bindings...)
	if err := fn(&d); err != nil {
		h.close()
		if errors.Is(err, errNoChange) {
			return nil
		}
		return classed(err)
	}
	if len(d.Bindings) == 0 {
		d.Prefs = nil
	}
	if d.empty() {
		return s.wipe(h)
	}
	defer h.close()
	return classed(s.write(h.dir, d))
}

// SavePersonal talep 201 aldıktan sonra kişisel bilgileri yazar; kayıtlar korunur.
func (s *Store) SavePersonal(p Personal) error {
	if !p.valid() {
		return &Error{Class: ClassInvalid, Err: errors.New("remember: geçersiz kişisel bilgi")}
	}
	return s.update(func(d *Data) error { d.Personal = &p; return nil })
}

// ClearPersonal "Bilgilerimi unut" (AC-137, AC-186): yalnız ad/telefon/e-posta ve cihaz anahtarı silinir (G-E10-5:
// sonraki hatırlamada yeni anahtar üretilir); kayıt varsa dosya kalır, yoksa dosya silinir.
func (s *Store) ClearPersonal() error {
	return s.update(func(d *Data) error {
		if d.Personal == nil {
			return errNoChange
		}
		d.Personal = nil
		return nil
	})
}

// SaveBinding `binding.issued` sonrası (AC-181, AC-254) yuvayı yazar: replaceKey (yenilenen satırın anahtarı, aynı
// köken) ve b.Key ile aynı anahtarlı öğe varsa yerine geçer (son kullanım zamanı korunur), yoksa yeni öğe eklenir.
// Sayım kuralı aşılırsa ErrLimit (yazımda kesin ret, G-P20-17). Kişisel alan ve diğer kayıtlar korunur.
func (s *Store) SaveBinding(b Binding, replaceKey string) error {
	if !b.valid() {
		return &Error{Class: ClassInvalid, Err: errors.New("remember: geçersiz kayıt")}
	}
	return s.update(func(d *Data) error {
		var used time.Time
		out := make([]Binding, 0, len(d.Bindings)+1)
		for _, x := range d.Bindings {
			if x.Key == b.Key || (replaceKey != "" && x.Key == replaceKey && x.Server == b.Server) {
				if used.IsZero() {
					used = x.LastUsedAt
				}
				continue
			}
			out = append(out, x)
		}
		nb := b
		if nb.LastUsedAt.IsZero() {
			nb.LastUsedAt = used
		}
		out = append(out, nb)
		if !countOK(out) {
			return ErrLimit
		}
		d.Bindings = sortBindings(out)
		return nil
	})
}

// RemoveBinding "Bu firmayı unut" ve `BINDING_INVALID` (AC-185, AC-254): yalnız o anahtarlı öğe silinir; kayıt
// kalmazsa tercih düşer, kişisel bilgi de yoksa dosya silinir.
func (s *Store) RemoveBinding(key string) error {
	return s.update(func(d *Data) error {
		out := d.Bindings[:0]
		for _, x := range d.Bindings {
			if x.Key != key {
				out = append(out, x)
			}
		}
		if len(out) == len(d.Bindings) {
			return errNoChange
		}
		d.Bindings = sortBindings(out)
		return nil
	})
}

// TouchBinding kayıtla talep 201 aldığında son kullanım zamanını günceller (yerel sıralama). Öğe yoksa yazılmaz.
func (s *Store) TouchBinding(key string, t time.Time) error {
	t = t.UTC().Truncate(time.Second)
	return s.update(func(d *Data) error {
		for i := range d.Bindings {
			if d.Bindings[i].Key == key {
				d.Bindings[i].LastUsedAt = t
				d.Bindings = sortBindings(d.Bindings)
				return nil
			}
		}
		return errNoChange
	})
}

// SetPrefs tercihleri yazar; kayıt yoksa ErrNoBinding.
func (s *Store) SetPrefs(p Prefs) error {
	return s.update(func(d *Data) error {
		if len(d.Bindings) == 0 {
			return &Error{Class: ClassInvalid, Err: ErrNoBinding}
		}
		d.Prefs = &p
		return nil
	})
}

// ForgetAll "Bu bilgisayarı unut" (AC-186, §8d.4): `kayitlar.bin`, `hatirla.bin`, tmp'ler, tanılama logu, kilit
// bırakıldıktan sonra `kayitlar.lock`, ardından YALNIZ boşsa klasör. Okuma durumundan bağımsızdır (G-P20-18): dosya
// çözülemese de silinir. Kilit 2 sn içinde alınamazsa yine silinir (kullanıcının açık isteği; diğer süreç yazarsa
// dosya yeniden oluşabilir, hata dönmez ama kilit dosyası açık olduğu için kalabilir).
func (s *Store) ForgetAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, err := s.acquire(false)
	if notExist(err) {
		return nil
	}
	if errors.Is(err, ErrLockTimeout) {
		dir, derr := diag.OpenDir(s.Dir, false)
		if notExist(derr) {
			return nil
		}
		if derr != nil {
			return classed(derr)
		}
		h, err = &held{dir: dir}, nil
	}
	if err != nil {
		return classed(err)
	}
	return s.wipe(h)
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

// NoticeText AC-188 bilgi satırı (P6 karşılama ve talep formu; kayıt yalnız başarılı oturumdan sonra yazılır).
func NoticeText(firm string) string {
	return "Oturumdan sonra bu bilgisayar " + firm + " için hatırlanır; istediğinizde 'Bu bilgisayarı unut' ile silebilirsiniz."
}
