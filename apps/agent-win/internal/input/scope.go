package input

import "time"

// S17-1 / AC-248 (P17 I4): "Yalnız bir pencere" modunda uzaktan girdi yalnız paylaşılan pencereye gider. WGC yalnız
// hedef pencerenin içeriğini yakalar; dikdörtgen kırpma, onun üstündeki başka pencereyi (tarayıcı, parola yöneticisi)
// dışarıda bırakmaz ve klavye ön plandaki pencereye gider. Kurallar (mimari-e11 §8.1 AC-248, bağlayıcı):
//
//   - Fare: koordinat pencerenin görünen sınırlarına eşlenir ve kırpılır; o noktadaki pencerenin kökü
//     (WindowFromPoint → GA_ROOT) hedef değilse ve hedefin sahip olduğu (GW_OWNER zinciri, aynı süreç) bir
//     diyalog/menü de değilse olay düşer. Tekerlek imlecin altındaki pencereye gittiğinden aynı denetim imleç
//     konumunda yapılır.
//   - Klavye: ön plan penceresinin kökü hedef değilse tuş düşer (kuyruklanmaz, odak çalınmaz); bu anda bu alıcının
//     basılı tuttuğu tuşlar bırakılır (takılı değiştirici yeni ön plan penceresine taşınmaz).
//   - Kabuk kısayolları (S-P17-1): Win tuşu ve Win basılıyken her tuş, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc
//     ve PrintScreen hedef pencereye değil kabuğa gider (Çalıştır kutusu, Başlat, Görev Yöneticisi, pencere geçişi,
//     tüm ekranın panoya alınması); ön plan denetiminden ÖNCE düşer. Böyle bir kısayol görüldükten sonra uzaktaki
//     Win/Alt/Ctrl bırakılana dek gelen bütün basmalar da düşer (Alt+Tab+Tab, Win+R+metin). Alt+F4 iletilir: ön plan
//     hedefken yalnız hedef pencereyi (ya da onun diyaloğunu) kapatır; kapanış paylaşımı WINDOW_CLOSED ile bitirir.
//   - Tuş patlaması (S-P17-1 TOCTOU): denetim SendInput'tan hemen önce kilit altında yapılır, ama tuş sistem girdi
//     kuyruğundan sonra teslim edilir. Pencere modunda tuş basmaları ayrıca WindowKeyPerSec/WindowKeyBurst ile
//     sınırlanır; ön plan değişirse kuyruğa girmiş olabilecek tuş sayısı küçük kalır.
//   - Pencere simge durumunda ya da kapalıysa bütün girdi düşer.
//
// İstisna (S7-13 ile aynı gerekçe): bu alıcının basılı tuttuğu tuş/düğmenin BIRAKILMASI ve k.release_all düşmez;
// fare düğmesi konumsuz bırakılır (imleç taşınmaz). Bırakma yeni etkileşim üretmez, düşürülmesi ise yerel kullanıcıya
// takılı Ctrl/Shift ya da basılı sol tık bırakırdı.

// WindowAPI pencere kapsamı için işletim sistemi sorguları (Windows: WinWindowAPI; testte sahte).
type WindowAPI interface {
	Exists(h uintptr) bool
	Iconic(h uintptr) bool
	// Bounds pencerenin görünen sınırları (WGC karesinin kapsadığı alan), fiziksel masaüstü koordinatı.
	Bounds(h uintptr) (Rect, bool)
	// RootAt noktadaki pencerenin GA_ROOT kökü (yoksa 0).
	RootAt(x, y int32) uintptr
	// ForegroundRoot ön plan penceresinin GA_ROOT kökü (yoksa 0).
	ForegroundRoot() uintptr
	CursorPos() (x, y int32)
	Owner(h uintptr) uintptr
	ThreadProcess(h uintptr) (tid, pid uint32)
	// IsMenu açılır menü penceresi ("#32768").
	IsMenu(h uintptr) bool
}

// Düşürme nedenleri (`input_dropped` tanılama satırı; içerik/koordinat yazılmaz).
const (
	DropClosed    = "WINDOW_CLOSED"
	DropMinimized = "WINDOW_MINIMIZED"
	DropOccluded  = "OCCLUDED"
	DropUnfocused = "UNFOCUSED"
	DropShell     = "SHELL_SHORTCUT" // S-P17-1
	DropKeyBurst  = "KEY_BURST"      // S-P17-1
)

// Pencere modu tuş basma sınırı (S-P17-1): hızlı yazı (~12/sn) ve konsolun tuş tekrarı (~30/sn) sığar; monitör
// modundaki RateBurst (500) patlaması pencere modunda uygulanmaz.
const (
	WindowKeyPerSec = 40
	WindowKeyBurst  = 40
)

// dropLogEvery aynı alıcıda en çok bu aralıkta bir tanılama satırı (mimari: 5 sn'de en çok 1).
const dropLogEvery = 5 * time.Second

// ownerDepth sahip zincirinde en çok bu kadar adım izlenir (döngü/derin zincire karşı).
const ownerDepth = 8

type winScope struct {
	on   bool
	hwnd uintptr
	api  WindowAPI
}

// SetWindowTarget AC-248: koordinatlar ve kapsam hwnd penceresine bağlanır (virt sanal masaüstü). SetTarget
// (monitör modu) kapsamı kaldırır. hwnd 0 ya da api nil ise bütün girdi düşer
// (monitör moduna sessiz dönüş yok).
func (a *Applier) SetWindowTarget(hwnd uintptr, virt Rect, api WindowAPI) {
	a.mu.Lock()
	a.scope, a.virt = winScope{on: true, hwnd: hwnd, api: api}, virt
	a.mu.Unlock()
}

// SetDropLog pencere kapsamı nedeniyle düşen olaylar için tanılama yazıcısı (en çok 5 sn'de bir çağrılır).
func (a *Applier) SetDropLog(fn func(reason string)) {
	a.mu.Lock()
	a.dropLog = fn
	a.mu.Unlock()
}

// ScopeDropped pencere kapsamı nedeniyle düşen olay sayısı (test ve tanı).
func (a *Applier) ScopeDropped() uint64 { return a.scopeDropped.Load() }

// dropLocked düşmeyi sayar; tanılama satırı zamanı geldiyse nedeni pendingDrop'a koyar (Handle kilit dışında
// yazar). a.mu altında.
func (a *Applier) dropLocked(reason string) {
	a.scopeDropped.Add(1)
	now := a.cur
	if a.dropLog == nil || (!a.dropAt.IsZero() && now.Sub(a.dropAt) < dropLogEvery) {
		return
	}
	a.dropAt, a.pendingDrop = now, reason
}

// windowState hedefin girdiye açık olup olmadığı: kapalı/simge durumunda ise neden. a.mu altında.
func (a *Applier) windowState() string {
	s := a.scope
	if s.api == nil || s.hwnd == 0 || !s.api.Exists(s.hwnd) {
		return DropClosed
	}
	if s.api.Iconic(s.hwnd) {
		return DropMinimized
	}
	return ""
}

// acceptsRoot root kökü hedef pencere ya da hedefin sahip olduğu aynı süreçten diyalog/menü mü.
func (a *Applier) acceptsRoot(root uintptr) bool {
	s := a.scope
	if root == 0 {
		return false
	}
	if root == s.hwnd {
		return true
	}
	ttid, tpid := s.api.ThreadProcess(s.hwnd)
	if tpid == 0 {
		return false
	}
	rtid, rpid := s.api.ThreadProcess(root)
	if rpid != tpid {
		return false
	}
	if s.api.IsMenu(root) && rtid == ttid { // açılır menünün sahibi yoktur; hedefin UI iş parçacığına ait olmalı
		return true
	}
	h := root
	for range ownerDepth {
		o := s.api.Owner(h)
		if o == 0 {
			return false
		}
		if o == s.hwnd {
			return true
		}
		if _, pid := s.api.ThreadProcess(o); pid != tpid {
			return false
		}
		h = o
	}
	return false
}

// windowPoint normalize (0..1) koordinatı pencerenin görünen sınırlarına eşler ve içine kırpar.
func (a *Applier) windowPoint(x, y float64) (px, py int32, ok bool) {
	r, ok := a.scope.api.Bounds(a.scope.hwnd)
	if !ok || r.Right <= r.Left || r.Bottom <= r.Top {
		return 0, 0, false
	}
	fx := float64(r.Left) + x*float64(r.Right-r.Left-1)
	fy := float64(r.Top) + y*float64(r.Bottom-r.Top-1)
	return clamp(int32(fx+0.5), r.Left, r.Right-1), clamp(int32(fy+0.5), r.Top, r.Bottom-1), true
}

func clamp(v, lo, hi int32) int32 { return max(lo, min(hi, v)) }

// absolute fiziksel nokta → sanal masaüstü mutlak (0..65535) fare hareketi.
func (a *Applier) absolute(px, py int32) Event {
	ax := float64(px-a.virt.Left) * 65535 / float64(max(1, a.virt.Right-a.virt.Left-1))
	ay := float64(py-a.virt.Top) * 65535 / float64(max(1, a.virt.Bottom-a.virt.Top-1))
	return Event{Mouse: true, DX: int32(ax + 0.5), DY: int32(ay + 0.5), Flags: MouseMove | MouseAbsolute | MouseVirtualDesk}
}

// scopedMove pencere modunda fare noktası: kapalı/simge/örtülü ise düşme nedeni döner.
func (a *Applier) scopedMove(x, y float64) (Event, string) {
	if why := a.windowState(); why != "" {
		return Event{}, why
	}
	px, py, ok := a.windowPoint(x, y)
	if !ok {
		return Event{}, DropClosed
	}
	if !a.acceptsRoot(a.scope.api.RootAt(px, py)) {
		return Event{}, DropOccluded
	}
	return a.absolute(px, py), ""
}

// translateScoped pencere modunda translate. a.mu altında.
func (a *Applier) translateScoped(m Msg) []Event {
	switch m.T {
	case "m.move":
		mv, why := a.scopedMove(*m.X, *m.Y)
		if why != "" {
			a.dropLocked(why)
			return nil
		}
		return []Event{mv}
	case "m.btn":
		if !*m.Down {
			if !a.buttons[m.B] {
				return nil // S7-13
			}
			delete(a.buttons, m.B)
			up := Event{Mouse: true, Flags: buttonFlag(m.B, false)}
			if mv, why := a.scopedMove(*m.X, *m.Y); why == "" {
				return []Event{mv, up}
			}
			return []Event{up} // bırakma düşmez; konumsuz (imleç kapsam dışına taşınmaz)
		}
		mv, why := a.scopedMove(*m.X, *m.Y)
		if why != "" {
			a.dropLocked(why)
			return nil
		}
		a.buttons[m.B] = true
		return []Event{mv, {Mouse: true, Flags: buttonFlag(m.B, true)}}
	case "m.wheel":
		if why := a.windowState(); why != "" {
			a.dropLocked(why)
			return nil
		}
		if !a.acceptsRoot(a.scope.api.RootAt(a.scope.api.CursorPos())) {
			a.dropLocked(DropOccluded)
			return nil
		}
		return a.translate(m)
	case "k":
		if !*m.Down {
			delete(a.scopeMeta, m.Code)
			evs := a.key(m) // yalnız basılı tuşun bırakılması üretilir (key içinde)
			if len(a.scopeMeta) == 0 && !a.modHeld(shellMods...) {
				a.scopeLatch = false
			}
			return evs
		}
		if a.shellShortcut(m.Code) {
			a.dropLocked(DropShell)
			return nil
		}
		if why := a.windowState(); why != "" {
			a.dropLocked(why)
			return nil
		}
		if a.scope.api.ForegroundRoot() != a.scope.hwnd {
			a.dropLocked(DropUnfocused)
			return a.releaseKeysLocked()
		}
		if !a.takeKeyLocked(a.cur) {
			a.dropLocked(DropKeyBurst)
			return nil
		}
		return a.key(m)
	}
	return nil
}

// shellMods kabuk kısayolu kilidini (scopeLatch) ayakta tutan değiştiriciler.
var shellMods = []string{"MetaLeft", "MetaRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight"}

// shellShortcut S-P17-1: basılan tuş pencere modunda kabuğa giden bir kısayol mu (ya da kısayol kilidi açık mı).
// Win basması enjekte edilmez; uzakta basılı olduğu scopeMeta'da izlenir (monitör modunda basılıp a.keys'te kalan
// Win de sayılır). a.mu altında.
func (a *Applier) shellShortcut(code string) bool {
	alt := a.modHeld("AltLeft", "AltRight")
	ctrl := a.modHeld("ControlLeft", "ControlRight")
	switch {
	case code == "MetaLeft" || code == "MetaRight":
		a.scopeMeta[code] = true
	case a.scopeLatch || len(a.scopeMeta) > 0 || a.modHeld("MetaLeft", "MetaRight"):
	case code == "Tab" && alt, code == "Escape" && (alt || ctrl):
	case code == "PrintScreen":
		return true // değiştiricisiz de kabuğa gider (ekran alıntısı); kilit açılmaz
	default:
		return false
	}
	a.scopeLatch = true
	return true
}

// resetShellLocked kabuk kısayolu durumunu sıfırlar (monitör moduna dönüş, k.release_all, kapı kapanışı). a.mu altında.
func (a *Applier) resetShellLocked() {
	clear(a.scopeMeta)
	a.scopeLatch = false
}

// releaseKeysLocked bu alıcının basılı tuttuğu tuşların bırakılması (ön plan hedeften çıktı). a.mu altında.
func (a *Applier) releaseKeysLocked() []Event {
	var evs []Event
	for _, k := range a.keys {
		evs = append(evs, keyEvents(k, false)...)
	}
	clear(a.keys)
	return evs
}

// takeKeyLocked pencere modu tuş basma kovası (WindowKeyPerSec/WindowKeyBurst). a.mu altında.
func (a *Applier) takeKeyLocked(now time.Time) bool {
	if a.keyLast.IsZero() {
		a.keyTokens, a.keyLast = WindowKeyBurst, now
	}
	if el := now.Sub(a.keyLast).Seconds(); el > 0 {
		a.keyTokens = min(WindowKeyBurst, a.keyTokens+el*WindowKeyPerSec)
		a.keyLast = now
	}
	if a.keyTokens < 1 {
		return false
	}
	a.keyTokens--
	return true
}
