package control

import "time"

// Örtülme kuralı (mimari-p28u §7.3, O-P28u-1, K-P28u-18; Android filterTouchesWhenObscured kalıbı). UIPI yalnız
// enjeksiyonu kapatır: kullanıcı oturumundaki bir süreç diyaloğun üstüne kendi TOPMOST|LAYERED|TRANSPARENT penceresini
// koyup fiziksel tıklamayı "İzin ver"e geçirebilir. Diyalogdan z-sırasında yukarı doğru (GW_HWNDPREV) her pencere
// görünür ve dikdörtgeni kesiyorsa diyalog örtülüdür — katmanlı/saydam pencereler dahil. İstisna yalnız yardımcının
// kendi oluşturduğu pencereler (HWND kümesi, sınıf adı değil). Win32 gezintisi helper/consent_windows.go'dadır.

// ZWindow diyaloğun üstündeki bir üst düzey pencere (z-sırasında diyaloğa yakından uzağa).
type ZWindow struct {
	H       uintptr
	Visible bool // IsWindowVisible (WS_VISIBLE; alfa/saydamlık bakılmaz)
	Rect    Rect
}

// Intersects iki dikdörtgen sıfır olmayan alanda kesişiyor mu (sağ/alt hariç).
func (r Rect) Intersects(o Rect) bool {
	return r.Left < o.Right && o.Left < r.Right && r.Top < o.Bottom && o.Top < r.Bottom
}

func (r Rect) empty() bool { return r.Right <= r.Left || r.Bottom <= r.Top }

// Obscured diyalog dikdörtgenini kesen görünür, sıfır olmayan alanlı ve own kümesinde olmayan bir pencere var mı.
func Obscured(dlg Rect, above []ZWindow, own func(uintptr) bool) bool {
	for _, w := range above {
		if !w.Visible || w.Rect.empty() || (own != nil && own(w.H)) {
			continue
		}
		if dlg.Intersects(w.Rect) {
			return true
		}
	}
	return false
}

// ReasonObscured tıklama anında diyalog örtülüydü ya da imleç altındaki pencere "İzin ver" düğmesi değildi.
const ReasonObscured Reason = 100

// ObscuredWarning örtülüyken diyalogda gösterilen satır.
const ObscuredWarning = "Pencerenin üstünde başka bir pencere var"

// Guard onay diyaloğunun "İzin ver" kuralı: Consent (1,5 sn, Enter/Space yok, enjekte yok) + örtülme + görünürlük.
// Örtülme ya da gizlenme (giriş masaüstü değişti) kalkınca 1,5 sn kilit yeniden başlar. Reddet her zaman etkindir.
// Yalnız diyaloğun iş parçacığından kullanılır.
type Guard struct {
	c        Consent
	obscured bool
	hidden   bool
}

// NewGuard diyalog now'da ilk kez görünür oldu.
func NewGuard(now time.Time) *Guard { return &Guard{c: Consent{ShownAt: now, HotkeyOK: true}} }

// Observe 250 ms taramasının sonucu; örtülme kalkarsa kilit yeniden başlar. Durum değiştiyse true.
func (g *Guard) Observe(now time.Time, obscured bool) bool {
	if g.obscured == obscured {
		return false
	}
	g.obscured = obscured
	if !obscured {
		g.c.ShownAt = now
	}
	return true
}

// Hide diyalog gizlendi (giriş masaüstü Default değil); Show yeniden göründü — kilit yeniden başlar.
func (g *Guard) Hide() { g.hidden = true }

// Show bkz. Hide.
func (g *Guard) Show(now time.Time) {
	g.hidden = false
	g.c.ShownAt = now
}

// Obscured son tarama sonucu.
func (g *Guard) Obscured() bool { return g.obscured }

// Enabled "İzin ver" etkin çizilsin mi.
func (g *Guard) Enabled(now time.Time) bool { return !g.hidden && !g.obscured && g.c.Armed(now) }

// Check tıklama/erişim tuşu anındaki karar. obscuredNow tıklama anı taraması; hitGrant WindowFromPoint(imleç) =
// "İzin ver" düğmesi (yalnız tıklamada anlamlı — erişim tuşunda true verilir).
func (g *Guard) Check(now time.Time, t Trigger, injected, obscuredNow, hitGrant bool) Reason {
	if g.hidden {
		return ReasonTooEarly
	}
	if r := g.c.Check(now, t, injected); r != ReasonOK {
		return r
	}
	if g.obscured || obscuredNow || !hitGrant {
		return ReasonObscured
	}
	return ReasonOK
}
