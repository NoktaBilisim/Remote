package remember

import (
	"errors"
	"os"

	"remote-support/agent-win/internal/diag"
)

// Hata sınıfları (mimari-e11 §8d.1, G-P20-3/4/18). Adlar diag olaylarında (`load_failed{class}`,
// `store_write_failed{class}`) kullanılır; içerik (ad, telefon, anahtar) taşımaz.
const (
	// ClassFormat sınıf 1 — kesin biçim hatası (katı çözme, bilinmeyen sürüm, boyut aşımı, DPAPI
	// ERROR_INVALID_DATA/NTE_BAD_DATA): dosya silinir.
	ClassFormat = "format"
	// Sınıf 2 — geçici: dosyaya dokunulmaz, açılış salt-okunur.
	ClassIO       = "io"
	ClassKeyState = "key_state" // NTE_BAD_KEY_STATE (ör. parola sıfırlaması sonrası; kalıcı olabilir)
	ClassSharing  = "sharing"   // paylaşım/kilit ihlali (AV)
	ClassDPAPI    = "dpapi"     // DPAPI'nin diğer hataları
	ClassLock     = "lock_timeout"
	ClassReparse  = "reparse" // AC-249: bağlantı/reparse noktası; hiçbir şey okunmaz/silinmez
	// Yalnız yazma.
	ClassUnreadable = "unreadable" // okuma başarısız: boş veriyle üzerine yazılmaz
	ClassLimit      = "limit"      // sayım kuralı (köken başına 5, en çok 2 köken)
	ClassTooLarge   = "too_large"  // düz metin > 32 KB veya mühürlü > 128 KB
	ClassInvalid    = "invalid"
)

var (
	// errCorrupt Unprotect'in kesin biçim hatası (Windows: ERROR_INVALID_DATA, NTE_BAD_DATA; dpapi_windows.go).
	errCorrupt = errors.New("remember: korunan veri bozuk")
	// errKeyState NTE_BAD_KEY_STATE (sınıf 2, G-P20-18).
	errKeyState = errors.New("remember: DPAPI anahtar durumu geçersiz")
	errInvalid  = errors.New("remember: geçersiz veri")
	errTooLarge = errors.New("remember: veri çok büyük")
	// errNoChange güncelleme fonksiyonu değişiklik yapmadı (yazma yok).
	errNoChange = errors.New("remember: değişiklik yok")

	// ErrLimit yazımda sayım ihlali (G-P20-17).
	ErrLimit = errors.New("remember: kayıt sınırı (köken başına 5, en çok 2 köken)")
	// ErrLockTimeout `kayitlar.lock` 2 sn içinde alınamadı (G-P20-2/16).
	ErrLockTimeout = errors.New("remember: kayıt dosyası kilidi alınamadı")
	// ErrUnreadable dosya okunamadığı için yazma reddedildi (G-P20-3).
	ErrUnreadable = errors.New("remember: kayıt dosyası okunamadı; yazılmadı")
	// ErrNoBinding tercih yalnız en az bir kayıt varken yazılır.
	ErrNoBinding = errors.New("remember: kayıt yok")
)

// Error sınıflandırılmış depo hatası. Yazma hataları sessiz değildir (G-P20-4): çağıran bilgi satırı gösterir ve
// `store_write_failed{Class}` yazar.
type Error struct {
	Class string
	Err   error
}

func (e *Error) Error() string { return "remember: " + e.Class + ": " + e.Err.Error() }
func (e *Error) Unwrap() error { return e.Err }

// ErrorClass hatanın sınıfı (nil → "").
func ErrorClass(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Class
	}
	return classify(err)
}

func classed(err error) error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return err
	}
	return &Error{Class: classify(err), Err: err}
}

// classify okuma/yazma hatasının sınıfı.
func classify(err error) string {
	switch {
	case errors.Is(err, errCorrupt), errors.Is(err, errInvalid):
		return ClassFormat
	case errors.Is(err, errTooLarge):
		return ClassTooLarge
	case errors.Is(err, ErrLimit):
		return ClassLimit
	case errors.Is(err, errKeyState):
		return ClassKeyState
	case errors.Is(err, errDPAPI):
		return ClassDPAPI
	case errors.Is(err, ErrLockTimeout):
		return ClassLock
	case errors.Is(err, diag.ErrReparse):
		return ClassReparse
	case isSharing(err):
		return ClassSharing
	default:
		return ClassIO
	}
}

// errDPAPI DPAPI'nin sınıf 1 ve key-state dışındaki hataları (sınıf 2).
var errDPAPI = errors.New("remember: DPAPI hatası")

// counterCode sınıf-2 kodunun sayaç baytındaki karşılığı (yüksek 4 bit; 0 = sayaç yok). Kilit zaman aşımında sayaç
// yazılamaz, bu yüzden kodu yoktur.
func counterCode(class string) byte {
	switch class {
	case ClassIO:
		return 1
	case ClassKeyState:
		return 2
	case ClassSharing:
		return 3
	case ClassDPAPI:
		return 4
	case ClassReparse:
		return 5
	}
	return 0
}

func notExist(err error) bool { return errors.Is(err, os.ErrNotExist) }
