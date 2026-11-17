package input

import (
	"strings"
	"sync"
	"time"
)

// P28f düzeltme 1 (Y-P28f-K1, S-P28f-1 kalıntısı; mimari-p28f §5.2a): macOS monitör kipinde enjeksiyonun iki ek kuralı.
// Windows'taki S-P17-7 kuralı (scope_keys.go unlatchedDrop) yalnız pencere kapsamı yolunda çalışır; macOS'ta kapsam
// yoktur, bu yüzden aynı karar Applier'ın monitör kipi yoluna HostProbe bağlıyken eklenir (Windows'ta nil, davranış
// değişmez).
//
//   - Fare Tuşları açıkken (com.apple.universalaccess mouseDriver; okunamazsa açık sayılır, accessEvery'de bir okunur)
//     Fare Tuşları'nın imlece çevirdiği tuşların basması düşer: tuş takımı (Numpad*, NumLock = Clear) ve tuş takımı
//     olmayan klavyelerdeki karşılıkları (7 8 9 U I O J K L M .). Neden: DropMouseKeys.
//   - İmleç bu sürecin pencerelerinden birinin (oturum penceresi, onay diyalogları; tıklama geçirgen gösterge ve TEST
//     bandı hariç) çerçevesindeyken enjekte fare düğmesi basması ve tuş takımı basması düşer (ikinci katmanın pano
//     anahtarı gibi her zaman görünen denetimlere genişletilmesi). Fare düğmesinde olayın düşeceği nokta (aynı
//     enjeksiyondaki hareketin hedefi), tuş takımında imlecin o anki yeri denetlenir; imleç okunamazsa düşer.
//     Neden: DropOwnWindow.
//
// Bırakmalar (bu alıcının basılı tuttuğu tuş/düğme) ve k.release_all hiç düşmez (S7-13).

// DropOwnWindow P28f: enjekte tıklama/tuş takımı bu sürecin penceresine düşecekti (Y-P28f-K1).
const DropOwnWindow = "OWN_WINDOW"

// HostProbe macOS işletim sistemi sorguları (Y-P28f-K1). Yalnız Applier kilidi altında, akış/Pion goroutine'inden
// çağrılır; ana iş parçacığını ya da olay musluğunu beklemez.
type HostProbe interface {
	// MouseKeys Fare Tuşları açık mı; okunamazsa true (fail-closed).
	MouseKeys() bool
	// Cursor imlecin genel nokta koordinatı (CoreGraphics: birincil ekranın sol üstü 0,0, y aşağı); okunamazsa ok false.
	Cursor() (x, y float64, ok bool)
}

// FRect genel nokta koordinatında (CoreGraphics: sol üst köken, y aşağı) dikdörtgen.
type FRect struct{ X, Y, W, H float64 }

func (r FRect) contains(x, y float64) bool {
	return x >= r.X && x <= r.X+r.W && y >= r.Y && y <= r.Y+r.H
}

// ownWindows bu sürecin girdi alan pencerelerinin son çerçeveleri. Arayüz (ana iş parçacığı) yazar, Applier okur; kendi
// kilidi vardır (Applier kilidi altında alınır, arayüz Applier kilidini hiç almaz → sıra tek yönlü).
var ownWindows struct {
	mu sync.Mutex
	rs []FRect
}

// SetOwnWindows arayüzün görünür pencerelerinin çerçeveleri (pencere açılınca/kapanınca/taşınınca ve 1 sn tikte).
func SetOwnWindows(rs []FRect) {
	ownWindows.mu.Lock()
	ownWindows.rs = append(ownWindows.rs[:0], rs...)
	ownWindows.mu.Unlock()
}

// overOwnWindow nokta pencerelerimizden birinin çerçevesinde mi.
func overOwnWindow(x, y float64) bool {
	ownWindows.mu.Lock()
	defer ownWindows.mu.Unlock()
	for _, r := range ownWindows.rs {
		if r.contains(x, y) {
			return true
		}
	}
	return false
}

// SetHostProbe P28f (macOS): monitör kipinde Fare Tuşları ve kendi pencere kuralları (Windows'ta çağrılmaz).
func (a *Applier) SetHostProbe(p HostProbe) {
	a.mu.Lock()
	a.host = p
	a.accessAt = time.Time{} // bir sonraki basmada yeniden okunur
	a.mu.Unlock()
}

// keypadKey tuş takımı tuşu (NumLock Mac klavyesinde Clear).
func keypadKey(code string) bool { return code == "NumLock" || strings.HasPrefix(code, "Numpad") }

// mouseKeysKey Fare Tuşları açıkken imleç hareketi/tıklama üreten tuşlar: tuş takımı ve tuş takımı olmayan
// klavyelerdeki karşılıkları (Apple: 7 8 9 U O J K L hareket, I tıkla, M basılı tut, . bırak).
func mouseKeysKey(code string) bool {
	switch code {
	case "Digit7", "Digit8", "Digit9", "KeyU", "KeyI", "KeyO", "KeyJ", "KeyK", "KeyL", "KeyM", "Period":
		return true
	}
	return keypadKey(code)
}

// hostDropLocked monitör kipinde HostProbe kuralları; düşerse nedeni sayar ve true döner. a.mu altında.
func (a *Applier) hostDropLocked(m Msg) bool {
	if a.host == nil || m.Down == nil || !*m.Down {
		return false
	}
	why := ""
	switch m.T {
	case "m.btn":
		if x, y, ok := a.point(*m.X, *m.Y); ok && overOwnWindow(x, y) {
			why = DropOwnWindow
		}
	case "k":
		switch {
		case mouseKeysKey(m.Code) && a.hostMouseKeysLocked():
			why = DropMouseKeys
		case keypadKey(m.Code):
			if x, y, ok := a.host.Cursor(); !ok || overOwnWindow(x, y) {
				why = DropOwnWindow
			}
		}
	}
	if why == "" {
		return false
	}
	a.dropLocked(why)
	return true
}

// hostMouseKeysLocked Fare Tuşları durumu; en çok accessEvery'de bir okunur (Windows accessibility() kalıbı). a.mu altında.
func (a *Applier) hostMouseKeysLocked() bool {
	if a.accessAt.IsZero() || a.cur.Sub(a.accessAt) >= accessEvery {
		a.mouseKeys = a.host.MouseKeys()
		a.accessAt = a.cur
	}
	return a.mouseKeys
}

// mouseKeysState Fare Tuşları tercihinin yorumu: değer okunduysa değeri; okunmadıysa alan okunabiliyorsa (anahtar listesi
// boş değil) anahtar hiç yazılmamıştır → kapalı; alan okunamıyorsa açık (fail-closed).
func mouseKeysState(readable, set, val bool) bool {
	if set {
		return val
	}
	return !readable
}
