// Package remember "Bilgilerimi bu bilgisayarda hatırla" dosyasıdır (ADR-0004 r3 + eki; AC-136..138). İstemcinin kendi
// adına diske yazdığı TEK dosya: `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`, içerik `{v:1, name, phone, email?, deviceKey}`
// JSON (≤ 4 KB) DPAPI CurrentUser ile korunur. Açıklama, onay, talep kimliği/sırrı ve ref YAZILMAZ. Depo mantığı
// platformdan bağımsızdır (koruma fonksiyonları enjekte edilir); Windows eşi dpapi_windows.go.
package remember

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"unicode"
	"unicode/utf8"
)

const (
	fileName    = "hatirla.bin"
	tmpName     = fileName + ".tmp"
	plainMax    = 4096
	sealedMax   = 16 * 1024
	formatV1    = 1
	nameMaxRune = 80
	emailMax    = 254
)

var (
	phoneRe     = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	deviceKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)
)

// Data hatırlanan bilgiler.
type Data struct {
	V         int    `json:"v"`
	Name      string `json:"name"`
	Phone     string `json:"phone"` // E.164
	Email     string `json:"email,omitempty"`
	DeviceKey string `json:"deviceKey"`
}

// Store dosya deposu. Dir istemcinin oluşturduğu klasördür (yalnız boşsa silinir).
type Store struct {
	Dir       string
	Protect   func([]byte) ([]byte, error)
	Unprotect func([]byte) ([]byte, error)
}

func (d Data) valid() bool {
	n := utf8.RuneCountInString(d.Name)
	return d.V == formatV1 && n >= 1 && n <= nameMaxRune && phoneRe.MatchString(d.Phone) && len(d.Email) <= emailMax &&
		deviceKeyRe.MatchString(d.DeviceKey) && !hasControl(d.Name) && !hasControl(d.Email)
}

func hasControl(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Cc, unicode.Cf) {
			return true
		}
	}
	return false
}

// Load açılışta bir kez okunur. Dosya yoksa false; çözülemiyor/bozuk/başka kullanıcının ise sessizce silinir, false.
func (s *Store) Load() (Data, bool) {
	f, err := os.Open(filepath.Join(s.Dir, fileName))
	if err != nil {
		return Data{}, false
	}
	sealed, err := io.ReadAll(io.LimitReader(f, sealedMax+1))
	_ = f.Close()
	if err != nil || len(sealed) > sealedMax {
		_ = s.Forget()
		return Data{}, false
	}
	plain, err := s.Unprotect(sealed)
	if err != nil || len(plain) > plainMax {
		_ = s.Forget()
		return Data{}, false
	}
	var d Data
	dec := json.NewDecoder(bytes.NewReader(plain))
	dec.DisallowUnknownFields()
	if dec.Decode(&d) != nil || !d.valid() {
		_ = s.Forget()
		return Data{}, false
	}
	return d, true
}

// Save talep 201 aldıktan sonra yazar: aynı klasörde `.tmp` (O_EXCL) → yeniden adlandırma (Windows'ta
// MoveFileEx(MOVEFILE_REPLACE_EXISTING)). Önceki çalışmadan kalan tmp → silinir ve bir kez yeniden denenir (G-E9-13).
func (s *Store) Save(d Data) error {
	d.V = formatV1
	if !d.valid() {
		return errors.New("remember: geçersiz veri")
	}
	plain, err := json.Marshal(d)
	if err != nil || len(plain) > plainMax {
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

// Forget "Bilgilerimi unut" / kutucuk işaretsiz gönderim (AC-137): dosya, varsa tmp, ardından YALNIZ boşsa klasör.
func (s *Store) Forget() error {
	var errs []error
	for _, n := range []string{fileName, tmpName} {
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
