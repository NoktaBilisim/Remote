package input

import (
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
)

// fakeWin sahte üst düzey pencere.
type fakeWin struct {
	r          Rect
	tid, pid   uint32
	owner      uintptr
	iconic     bool
	menu, gone bool
}

// fakeDesk sahte masaüstü: z sırası (üstteki önce), ön plan ve imleç. RootAt z sırasında noktayı içeren ilk
// görünür pencereyi döner (WindowFromPoint → GA_ROOT eşi).
type fakeDesk struct {
	mu     sync.Mutex
	wins   map[uintptr]*fakeWin
	z      []uintptr
	fg     uintptr
	cx, cy int32
	// S-P17-7: işletim sistemi değiştirici durumu ve erişilebilirlik ayarı.
	osWin, osAlt, osCtrl bool
	sticky, mouseKeys    bool
	accReads             int
}

func (d *fakeDesk) w(h uintptr) *fakeWin {
	d.mu.Lock()
	defer d.mu.Unlock()
	if w, ok := d.wins[h]; ok && !w.gone {
		return w
	}
	return nil
}

func (d *fakeDesk) Exists(h uintptr) bool { return d.w(h) != nil }
func (d *fakeDesk) Iconic(h uintptr) bool { w := d.w(h); return w != nil && w.iconic }
func (d *fakeDesk) Bounds(h uintptr) (Rect, bool) {
	if w := d.w(h); w != nil && !w.iconic {
		return w.r, true
	}
	return Rect{}, false
}
func (d *fakeDesk) RootAt(x, y int32) uintptr {
	for _, h := range d.z {
		if w := d.w(h); w != nil && !w.iconic && x >= w.r.Left && x < w.r.Right && y >= w.r.Top && y < w.r.Bottom {
			return h
		}
	}
	return 0
}
func (d *fakeDesk) ForegroundRoot() uintptr { return d.fg }
func (d *fakeDesk) CursorPos() (int32, int32) {
	return d.cx, d.cy
}
func (d *fakeDesk) Owner(h uintptr) uintptr {
	if w := d.w(h); w != nil {
		return w.owner
	}
	return 0
}
func (d *fakeDesk) ThreadProcess(h uintptr) (uint32, uint32) {
	if w := d.w(h); w != nil {
		return w.tid, w.pid
	}
	return 0, 0
}
func (d *fakeDesk) IsMenu(h uintptr) bool           { w := d.w(h); return w != nil && w.menu }
func (d *fakeDesk) OSModifiers() (bool, bool, bool) { return d.osWin, d.osAlt, d.osCtrl }
func (d *fakeDesk) Accessibility() (bool, bool) {
	d.accReads++
	return d.sticky, d.mouseKeys
}

const (
	hTarget  uintptr = 0x100 // paylaşılan pencere (muhasebe programı)
	hBrowser uintptr = 0x200 // üstte açılmış başka uygulama
	hDialog  uintptr = 0x300 // hedefin sahip olduğu "Farklı kaydet" diyaloğu
	hMenu    uintptr = 0x400 // hedefin açılır menüsü
)

var virtDesk = rect(0, 0, 1920, 1080)

// newScoped hedef (100,100)-(900,700), tarayıcı onun sağ yarısının üstünde (500,100)-(1300,700). Kapı açık, hedef ön planda.
func newScoped(t *testing.T) (*fakeDesk, *fakeInj, *Applier, *[]string) {
	t.Helper()
	d := &fakeDesk{wins: map[uintptr]*fakeWin{
		hTarget:  {r: rect(100, 100, 900, 700), tid: 7, pid: 70},
		hBrowser: {r: rect(500, 100, 1300, 700), tid: 9, pid: 90},
	}, z: []uintptr{hBrowser, hTarget}, fg: hTarget}
	g := &control.Gate{}
	inj := &fakeInj{}
	now := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	a := NewApplier(g, inj, func() time.Time { mu.Lock(); defer mu.Unlock(); now = now.Add(10 * time.Millisecond); return now })
	a.SetTarget(rect(0, 0, 1920, 1080), virtDesk) // önceki monitör modu: pencere kapsamı bunu geçersiz kılmalı
	a.SetWindowTarget(hTarget, virtDesk, d)
	var logs []string
	a.SetDropLog(func(r string) { logs = append(logs, r) })
	g.Open()
	return d, inj, a, &logs
}

// pixel mutlak (0..65535) olayı sanal masaüstü pikseline çevirir.
func pixel(e Event) (int32, int32) {
	x := float64(e.DX)*float64(virtDesk.Right-virtDesk.Left-1)/65535 + float64(virtDesk.Left)
	y := float64(e.DY)*float64(virtDesk.Bottom-virtDesk.Top-1)/65535 + float64(virtDesk.Top)
	return int32(x + 0.5), int32(y + 0.5)
}

func btn(b string, down bool, x, y float64) []byte {
	d := "false"
	if down {
		d = "true"
	}
	return []byte(`{"t":"m.btn","b":"` + b + `","down":` + d + `,"x":` + ftoa(x) + `,"y":` + ftoa(y) + `}`)
}

func TestAC248S171CoordinatesMapToWindowAndClip(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	d.z = []uintptr{hTarget} // örtüşme yok
	for _, c := range []struct {
		x, y   float64
		wx, wy int32
	}{{0, 0, 100, 100}, {1, 1, 899, 699}, {0.5, 0.5, 500, 400}} {
		a.Handle([]byte(`{"t":"m.move","x":` + ftoa(c.x) + `,"y":` + ftoa(c.y) + `}`))
		evs := inj.take()
		if len(evs) != 1 {
			t.Fatalf("%v: %d olay", c, len(evs))
		}
		px, py := pixel(evs[0])
		if px < c.wx-1 || px > c.wx+1 || py < c.wy-1 || py > c.wy+1 {
			t.Errorf("%v → (%d,%d), beklenen ≈(%d,%d)", c, px, py, c.wx, c.wy)
		}
		if px < 100 || px > 899 || py < 100 || py > 699 {
			t.Errorf("%v → (%d,%d) pencere dışında", c, px, py)
		}
	}
	// Pencere taşınınca eşleme yeni konuma uyar (her olayda güncel sınır).
	d.wins[hTarget].r = rect(1000, 300, 1400, 600)
	a.Handle([]byte(`{"t":"m.move","x":1,"y":1}`))
	if px, py := pixel(inj.take()[0]); px > 1399 || py > 599 || px < 1397 || py < 597 {
		t.Errorf("taşınan pencere: (%d,%d)", px, py)
	}
	// Kırpma: en uç nokta pencerenin son pikselidir (sağ/alt hariç).
	if x, y, ok := a.windowPoint(1, 1); !ok || x != 1399 || y != 599 {
		t.Errorf("kırpma: %d,%d,%v", x, y, ok)
	}
}

func TestAC248S171ClickOnOverlappingWindowDropped(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	// Sol yarı (x=0.25 → 300 px) yalnız hedefte; sağ yarı (x=0.75 → 700 px) tarayıcının altında.
	a.Handle(btn("l", true, 0.75, 0.5))
	a.Handle(btn("l", false, 0.75, 0.5))
	a.Handle([]byte(`{"t":"m.move","x":0.75,"y":0.5}`))
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("örtülü noktada tıklama/hareket uygulandı: %+v", evs)
	}
	if a.ScopeDropped() != 2 { // basma + hareket (basılmamış düğmenin bırakılması no-op)
		t.Fatalf("düşen=%d", a.ScopeDropped())
	}
	if len(*logs) != 1 || (*logs)[0] != DropOccluded {
		t.Fatalf("tanılama satırı: %v", *logs)
	}
	a.Handle(btn("l", true, 0.25, 0.5))
	a.Handle(btn("l", false, 0.25, 0.5))
	evs := inj.take()
	if len(evs) != 4 || evs[1].Flags != MouseLeftDown || evs[3].Flags != MouseLeftUp {
		t.Fatalf("görünür kısımda tıklama: %+v", evs)
	}
}

func TestAC248S171WheelUnderOccludingWindowDropped(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	d.cx, d.cy = 700, 400 // imleç tarayıcının üstünde
	a.Handle([]byte(`{"t":"m.wheel","dx":0,"dy":120}`))
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("örtülü tekerlek uygulandı: %+v", evs)
	}
	d.cx = 300
	a.Handle([]byte(`{"t":"m.wheel","dx":0,"dy":120}`))
	if evs := inj.take(); len(evs) != 1 || evs[0].Flags != MouseWheel {
		t.Fatalf("hedef üstünde tekerlek: %+v", evs)
	}
}

func TestAC248S171KeyDroppedWhenFocusInOtherApp(t *testing.T) {
	d, inj, a, logs := newScoped(t)
	d.fg = hBrowser // kullanıcı tarayıcıya geçti
	a.Handle([]byte(`{"t":"k","code":"KeyA","down":true,"key":"a"}`))
	a.Handle([]byte(`{"t":"k","code":"KeyA","down":false,"key":"a"}`))
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("odak başka uygulamadayken tuş uygulandı: %+v", evs)
	}
	if len(*logs) != 1 || (*logs)[0] != DropUnfocused {
		t.Fatalf("tanılama: %v", *logs)
	}
	// Kuyruklanmaz: odak geri gelince eski tuş tekrar oynatılmaz; yalnız yeni tuş gider.
	d.fg = hTarget
	a.Handle([]byte(`{"t":"k","code":"KeyB","down":true,"key":"b"}`))
	evs := inj.take()
	if len(evs) != 1 || evs[0].Scan != 'b' {
		t.Fatalf("odak hedefteyken: %+v", evs)
	}
	// Hedefin sahipli diyaloğu ön plandayken de klavye düşer (mimari: yalnız ön plan kökü hedefse).
	d.wins[hDialog] = &fakeWin{r: rect(300, 300, 600, 500), tid: 7, pid: 70, owner: hTarget}
	d.fg = hDialog
	a.Handle([]byte(`{"t":"k","code":"KeyC","down":true,"key":"c"}`))
	// C basılmaz; yalnız hâlâ basılı B bırakılır (S-P17-1: ön plan değişince basılı tuşlar bırakılır).
	if evs := inj.take(); len(evs) != 1 || evs[0].Scan != 'b' || evs[0].Flags&KeyUp == 0 {
		t.Fatalf("diyalog ön plandayken tuş: %+v", evs)
	}
}

func TestAC248S171HeldKeyReleaseNotDropped(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	a.Handle([]byte(`{"t":"k","code":"ControlLeft","down":true}`))
	a.Handle(btn("l", true, 0.25, 0.5))
	inj.take()
	d.fg = hBrowser
	d.z = []uintptr{hBrowser, hTarget}
	d.wins[hBrowser].r = rect(0, 0, 1920, 1080) // tarayıcı her şeyi örttü
	a.Handle([]byte(`{"t":"k","code":"ControlLeft","down":false}`))
	a.Handle(btn("l", false, 0.25, 0.5))
	evs := inj.take()
	if len(evs) != 2 || evs[0].Flags != KeyUp || evs[1].Flags != MouseLeftUp || evs[1].Flags&MouseMove != 0 {
		t.Fatalf("basılı Ctrl/sol tık bırakılmalı (konumsuz): %+v", evs)
	}
}

func TestAC248S171OwnedDialogAndMenuAccepted(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	d.wins[hDialog] = &fakeWin{r: rect(200, 200, 400, 400), tid: 7, pid: 70, owner: hTarget}
	d.wins[hMenu] = &fakeWin{r: rect(120, 420, 300, 600), tid: 7, pid: 70, menu: true}
	d.z = []uintptr{hMenu, hDialog, hBrowser, hTarget}
	a.Handle(btn("l", true, 0.25, 0.25))  // (300,250) diyalog
	a.Handle(btn("l", false, 0.25, 0.25)) //
	a.Handle(btn("l", true, 0.1, 0.75))   // (180,550) menü
	a.Handle(btn("l", false, 0.1, 0.75))
	if evs := inj.take(); len(evs) != 8 {
		t.Fatalf("sahipli diyalog/menü kabul edilmeli: %d olay", len(evs))
	}
	// Başka süreçten, hedefe sahip olunan pencere (sahte sahiplik) ve başka iş parçacığının menüsü reddedilir.
	d.wins[hDialog].pid = 99
	d.wins[hMenu].tid = 8
	a.Handle(btn("l", true, 0.25, 0.25))
	a.Handle(btn("l", true, 0.1, 0.75))
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("yabancı süreç diyaloğu/menüsü: %+v", evs)
	}
	// İki adımlı zincir (diyaloğun alt diyaloğu) kabul; zincirde başka süreç varsa red.
	d.wins[hDialog].pid = 70
	const hSub uintptr = 0x500
	d.wins[hSub] = &fakeWin{r: rect(220, 220, 380, 380), tid: 7, pid: 70, owner: hDialog}
	d.z = append([]uintptr{hSub}, d.z...)
	a.Handle(btn("r", true, 0.25, 0.25))
	if evs := inj.take(); len(evs) != 2 {
		t.Fatalf("alt diyalog: %+v", evs)
	}
}

func TestAC248S171MinimizedOrClosedDropsAll(t *testing.T) {
	d, inj, a, logs := newScoped(t)
	d.wins[hTarget].iconic = true
	msgs := [][]byte{[]byte(`{"t":"m.move","x":0.1,"y":0.1}`), btn("l", true, 0.1, 0.1), []byte(`{"t":"m.wheel","dx":0,"dy":120}`),
		[]byte(`{"t":"k","code":"KeyA","down":true,"key":"a"}`)}
	for _, m := range msgs {
		a.Handle(m)
	}
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("simge durumunda uygulandı: %+v", evs)
	}
	d.wins[hTarget].iconic = false
	d.wins[hTarget].gone = true
	for _, m := range msgs {
		a.Handle(m)
	}
	if evs := inj.take(); len(evs) != 0 {
		t.Fatalf("kapalı pencerede uygulandı: %+v", evs)
	}
	if a.ScopeDropped() != 8 {
		t.Fatalf("düşen=%d", a.ScopeDropped())
	}
	// 5 sn'de en çok 1 tanılama satırı (sahte saat her çağrıda 10 ms ilerler).
	if len(*logs) != 1 || (*logs)[0] != DropMinimized {
		t.Fatalf("tanılama: %v", *logs)
	}
}

func TestAC248S171DropLogRateLimited(t *testing.T) {
	d, _, a, logs := newScoped(t)
	d.fg = hBrowser
	for range 600 { // 600 × 10 ms = 6 sn → 2 satır
		a.Handle([]byte(`{"t":"k","code":"KeyA","down":true,"key":"a"}`))
	}
	if len(*logs) != 2 {
		t.Fatalf("satır sayısı %d, beklenen 2", len(*logs))
	}
}

func TestAC248S171NilAPIOrZeroHandleDropsAll(t *testing.T) {
	g := &control.Gate{}
	inj := &fakeInj{}
	a := NewApplier(g, inj, nil)
	a.SetTarget(rect(0, 0, 1920, 1080), virtDesk)
	a.SetWindowTarget(0, virtDesk, nil)
	g.Open()
	a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	a.Handle([]byte(`{"t":"k","code":"KeyA","down":true,"key":"a"}`))
	if inj.n.Load() != 0 {
		t.Fatal("geçersiz pencere hedefinde monitör moduna dönülmemeli")
	}
	a.SetTarget(rect(0, 0, 1920, 1080), virtDesk) // monitör moduna dönüş kapsamı kaldırır
	a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	if inj.n.Load() != 1 {
		t.Fatal("monitör modu")
	}
}

// kd tek klavye mesajı (key yalnız yazdırılabilir tek karakterde dolu).
func kd(code string, down bool, key string) []byte {
	d := "false"
	if down {
		d = "true"
	}
	k := ""
	if key != "" {
		k = `,"key":"` + key + `"`
	}
	return []byte(`{"t":"k","code":"` + code + `","down":` + d + k + `}`)
}

// play mesaj dizisini (kod, "+"/"-") oynatır ve enjekte edilen olayları döner.
func play(a *Applier, inj *fakeInj, seq ...string) []Event {
	for _, s := range seq {
		a.Handle(kd(s[1:], s[0] == '+', ""))
	}
	return inj.take()
}

// hasVK olaylarda vk sanal tuşunun BASMASI var mı.
func hasVKDown(evs []Event, vks ...uint16) bool {
	for _, e := range evs {
		for _, vk := range vks {
			if !e.Mouse && e.VK == vk && e.Flags&KeyUp == 0 {
				return true
			}
		}
	}
	return false
}

const (
	vkTab, vkEsc, vkLWin, vkRWin, vkR, vkC, vkF4, vkCtrl, vkAlt, vkSnap = 0x09, 0x1B, 0x5B, 0x5C, 'R', 'C', 0x73, 0xA2, 0xA4, 0x2C
)

// S-P17-1: pencere modunda Win tuşu ve kabuk kısayolları hedef ön plandayken bile iletilmez.
func TestSP171WindowModeShellShortcutsDropped(t *testing.T) {
	for _, c := range []struct {
		name string
		seq  []string
		bad  []uint16
	}{
		{"Win tek", []string{"+MetaLeft", "-MetaLeft"}, []uint16{vkLWin}},
		{"Win+R ve metin", []string{"+MetaLeft", "+KeyR", "-KeyR", "+KeyC", "+Enter", "-MetaLeft"}, []uint16{vkLWin, vkR, vkC, 0x0D}},
		{"sağ Win+E", []string{"+MetaRight", "+KeyE", "-KeyE", "-MetaRight"}, []uint16{vkRWin, 'E'}},
		{"Alt+Tab+Tab", []string{"+AltLeft", "+Tab", "-Tab", "+Tab", "-Tab", "-AltLeft"}, []uint16{vkTab}},
		{"Alt+Shift+Tab", []string{"+AltLeft", "+ShiftLeft", "+Tab", "-Tab", "-ShiftLeft", "-AltLeft"}, []uint16{vkTab}},
		{"Alt+Esc", []string{"+AltLeft", "+Escape", "-Escape", "-AltLeft"}, []uint16{vkEsc}},
		{"Ctrl+Esc", []string{"+ControlLeft", "+Escape", "-Escape", "-ControlLeft"}, []uint16{vkEsc}},
		{"Ctrl+Shift+Esc", []string{"+ControlLeft", "+ShiftLeft", "+Escape", "-Escape", "-ShiftLeft", "-ControlLeft"}, []uint16{vkEsc}},
		{"PrintScreen", []string{"+PrintScreen", "-PrintScreen"}, []uint16{vkSnap}},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, inj, a, logs := newScoped(t)
			evs := play(a, inj, c.seq...)
			if hasVKDown(evs, c.bad...) {
				t.Fatalf("kabuk kısayolu iletildi: %+v", evs)
			}
			if a.ScopeDropped() == 0 || len(*logs) != 1 || (*logs)[0] != DropShell {
				t.Fatalf("düşen=%d tanılama=%v", a.ScopeDropped(), *logs)
			}
			// Değiştiriciler bırakıldıktan sonra bu alıcının bastığı hiçbir tuş basılı kalmaz ve normal yazı geçer.
			if len(a.keys) != 0 {
				t.Fatalf("basılı kalan: %v", a.keys)
			}
			a.Handle(kd("KeyA", true, "a"))
			if evs := inj.take(); len(evs) != 1 || evs[0].Scan != 'a' {
				t.Fatalf("kısayoldan sonra harf: %+v", evs)
			}
		})
	}
}

// S-P17-1: Win/Alt basılıyken gelen sonraki tuşlar da düşer (kilit); kilit değiştiriciler bırakılınca açılır.
func TestSP171ShellLatchUntilModifiersReleased(t *testing.T) {
	_, inj, a, _ := newScoped(t)
	evs := play(a, inj, "+AltLeft", "+Tab", "-Tab", "+KeyA", "-KeyA", "+F4")
	if hasVKDown(evs, vkTab, 'A', vkF4) {
		t.Fatalf("Alt+Tab sonrası Alt basılıyken tuş iletildi: %+v", evs)
	}
	evs = play(a, inj, "-AltLeft", "+KeyA")
	if !hasVKDown(evs, 'A') {
		t.Fatalf("Alt bırakıldıktan sonra tuş geçmeli: %+v", evs)
	}
	// k.release_all kilidi ve uzaktaki Win durumunu sıfırlar.
	play(a, inj, "-KeyA", "+MetaLeft")
	a.Handle([]byte(`{"t":"k.release_all"}`))
	inj.take()
	if evs := play(a, inj, "+KeyB"); !hasVKDown(evs, 'B') {
		t.Fatalf("release_all sonrası: %+v", evs)
	}
}

// S-P17-1: hedef ön plandayken normal harfler, Ctrl+C ve Alt+F4 (yalnız hedefi kapatır) iletilir.
func TestSP171WindowModeOrdinaryKeysPass(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	a.Handle(kd("KeyX", true, "x"))
	a.Handle(kd("KeyX", false, "x"))
	if evs := inj.take(); len(evs) != 2 || evs[0].Scan != 'x' || evs[1].Flags != KeyUnicode|KeyUp {
		t.Fatalf("harf: %+v", evs)
	}
	if evs := play(a, inj, "+ControlLeft", "+KeyC", "-KeyC", "-ControlLeft"); !hasVKDown(evs, vkCtrl) || !hasVKDown(evs, vkC) || len(evs) != 4 {
		t.Fatalf("Ctrl+C: %+v", evs)
	}
	if evs := play(a, inj, "+AltLeft", "+F4", "-F4", "-AltLeft"); !hasVKDown(evs, vkAlt) || !hasVKDown(evs, vkF4) {
		t.Fatalf("Alt+F4: %+v", evs)
	}
	if a.ScopeDropped() != 0 || len(*logs) != 0 {
		t.Fatalf("düşen=%d %v", a.ScopeDropped(), *logs)
	}
}

// S-P17-1: monitör (tüm ekran) modunda davranış değişmez — Win+E, Alt+Tab, Ctrl+Esc, PrintScreen iletilir.
func TestSP171MonitorModeUnchanged(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	for _, c := range []struct {
		seq  []string
		want []uint16
	}{
		{[]string{"+MetaLeft", "+KeyE", "-KeyE", "-MetaLeft"}, []uint16{vkLWin, 'E'}},
		{[]string{"+AltLeft", "+Tab", "-Tab", "-AltLeft"}, []uint16{vkAlt, vkTab}},
		{[]string{"+ControlLeft", "+Escape", "-Escape", "-ControlLeft"}, []uint16{vkCtrl, vkEsc}},
		{[]string{"+PrintScreen", "-PrintScreen"}, []uint16{vkSnap}},
	} {
		evs := play(a, inj, c.seq...)
		for _, vk := range c.want {
			if !hasVKDown(evs, vk) {
				t.Fatalf("%v: 0x%X iletilmedi: %+v", c.seq, vk, evs)
			}
		}
		if len(evs) != len(c.seq) {
			t.Fatalf("%v: %d olay", c.seq, len(evs))
		}
	}
	if a.ScopeDropped() != 0 {
		t.Fatalf("düşen=%d", a.ScopeDropped())
	}
	// Monitör modunda RateBurst (500) geçerli; pencere modu tuş sınırı uygulanmaz.
	for range 100 {
		a.Handle(kd("KeyA", true, "a"))
	}
	if n := len(inj.take()); n != 100 {
		t.Fatalf("monitör modunda tuş patlaması: %d", n)
	}
}

// S-P17-1 (TOCTOU): pencere modunda tuş patlaması WindowKeyBurst ile sınırlanır.
func TestSP171WindowModeKeyBurstLimited(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	for range 100 { // sahte saat mesaj başına 10 ms: 40 + 100×0,4 = en çok 80
		a.Handle(kd("KeyA", true, "a"))
	}
	n := len(inj.take())
	if n < WindowKeyBurst || n > WindowKeyBurst+40 {
		t.Fatalf("iletilen=%d", n)
	}
	if len(*logs) != 1 || (*logs)[0] != DropKeyBurst {
		t.Fatalf("tanılama: %v", *logs)
	}
}

// S-P17-1: ön plan hedeften çıkınca bu alıcının basılı tuttuğu tuşlar bırakılır (yeni pencerede Ctrl takılı kalmaz).
func TestSP171UnfocusReleasesHeldKeys(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	play(a, inj, "+ControlLeft")
	d.fg = hBrowser
	evs := play(a, inj, "+KeyV")
	if len(evs) != 1 || evs[0].VK != vkCtrl || evs[0].Flags&KeyUp == 0 {
		t.Fatalf("Ctrl bırakılmalı, V basılmamalı: %+v", evs)
	}
	if evs := play(a, inj, "-ControlLeft"); len(evs) != 0 {
		t.Fatalf("çift bırakma: %+v", evs)
	}
}

const vkNum5, vkNumLock = 0x65, 0x90

// S-P17-7: Alt/Ctrl/Win kararına işletim sisteminin durumu da girer (yerel Alt + uzak Tab, yerel Win + uzak R).
func TestSP177OSModifierStateCounted(t *testing.T) {
	for _, c := range []struct {
		name          string
		win, alt, ctl bool
		code          string
		bad           uint16
	}{
		{"yerel Alt + Tab", false, true, false, "Tab", vkTab},
		{"yerel Ctrl + Esc", false, false, true, "Escape", vkEsc},
		{"yerel Win + R", true, false, false, "KeyR", vkR},
	} {
		t.Run(c.name, func(t *testing.T) {
			d, inj, a, logs := newScoped(t)
			d.osWin, d.osAlt, d.osCtrl = c.win, c.alt, c.ctl
			if evs := play(a, inj, "+"+c.code); hasVKDown(evs, c.bad) || len(*logs) != 1 || (*logs)[0] != DropShell {
				t.Fatalf("iletildi: %+v %v", evs, *logs)
			}
		})
	}
	d, inj, a, _ := newScoped(t)
	d.osAlt = false
	if evs := play(a, inj, "+Tab", "-Tab"); !hasVKDown(evs, vkTab) {
		t.Fatalf("değiştiricisiz Tab geçmeli: %+v", evs)
	}
}

// S-P17-7: Yapışkan Tuşlar açıkken tek başına Ctrl/Alt basma+bırakmasından sonra gelen Esc/Tab düşer.
func TestSP177StickyKeysLoneModifierThenEscDropped(t *testing.T) {
	d, inj, a, logs := newScoped(t)
	d.sticky = true
	// Oturum başında önceki durum bilinmez: ilk Esc düşer; bir harf kilitli değiştiriciyi tüketir.
	if evs := play(a, inj, "+Escape"); hasVKDown(evs, vkEsc) || len(*logs) != 1 || (*logs)[0] != DropSticky {
		t.Fatalf("oturum başı Esc: %+v %v", evs, *logs)
	}
	play(a, inj, "+KeyA", "-KeyA")
	if evs := play(a, inj, "+Escape", "-Escape"); !hasVKDown(evs, vkEsc) {
		t.Fatalf("harften sonra Esc geçmeli: %+v", evs)
	}
	for _, seq := range [][]string{
		{"+ControlLeft", "-ControlLeft", "+Escape"},
		{"+AltLeft", "-AltLeft", "+Tab"},
		{"+ControlLeft", "-ControlLeft", "+ShiftLeft", "-ShiftLeft", "+Escape"}, // Ctrl+Shift+Esc (Görev Yöneticisi)
	} {
		evs := play(a, inj, seq...)
		if hasVKDown(evs, vkEsc, vkTab) {
			t.Fatalf("%v: %+v", seq, evs)
		}
		play(a, inj, "+KeyB", "-KeyB") // kilidi tüketir
	}
	// Kısayolda kullanılan Ctrl (Ctrl+C) bırakılınca kilitlenmez: sonraki Esc geçer.
	if evs := play(a, inj, "+ControlLeft", "+KeyC", "-KeyC", "-ControlLeft", "+Escape", "-Escape"); !hasVKDown(evs, vkEsc) {
		t.Fatalf("Ctrl+C sonrası Esc: %+v", evs)
	}
}

// S-P17-7: odak kaçınca bırakılan Ctrl de Yapışkan Tuşlar'da kilitlenebilir; odak dönünce ilk Esc düşer.
func TestSP177StickyKeysArmedByUnfocusRelease(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	d.sticky = true
	play(a, inj, "+KeyA", "-KeyA", "+ControlLeft")
	d.fg = hBrowser
	play(a, inj, "+KeyV")
	d.fg = hTarget
	if evs := play(a, inj, "+Escape"); hasVKDown(evs, vkEsc) {
		t.Fatalf("kilitli Ctrl + Esc: %+v", evs)
	}
}

// S-P17-7: Yapışkan Tuşlar kapalıyken Ctrl↓↑ Esc davranışı değişmez.
func TestSP177StickyKeysOffUnchanged(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	if evs := play(a, inj, "+Escape", "-Escape", "+ControlLeft", "-ControlLeft", "+Escape", "-Escape", "+AltLeft", "-AltLeft", "+Tab"); len(evs) != 9 {
		t.Fatalf("Yapışkan Tuşlar kapalı: %+v", evs)
	}
	if len(*logs) != 0 {
		t.Fatalf("%v", *logs)
	}
}

// S-P17-7: art arda 5. Shift (Yapışkan Tuşlar kısayolu) pencere modunda düşer; araya tuş girince sayaç sıfırlanır.
func TestSP177FifthShiftDropped(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	var seq []string
	for range 5 {
		seq = append(seq, "+ShiftLeft", "-ShiftLeft")
	}
	if evs := play(a, inj, seq...); len(evs) != 8 {
		t.Fatalf("4 Shift basma+bırakma beklenir: %d", len(evs))
	}
	if len(*logs) != 1 || (*logs)[0] != DropSticky {
		t.Fatalf("%v", *logs)
	}
	play(a, inj, "+KeyA", "-KeyA")
	if evs := play(a, inj, "+ShiftLeft", "-ShiftLeft"); len(evs) != 2 {
		t.Fatalf("sayaç sıfırlanmalı: %+v", evs)
	}
}

// S-P17-7: Fare Tuşları açıkken Numpad ve NumLock düşer; kapalıyken geçer; Alt+Shift+NumLock her zaman düşer.
func TestSP177MouseKeysNumpadDropped(t *testing.T) {
	_, inj, a, logs := newScoped(t)
	if evs := play(a, inj, "+Numpad5", "-Numpad5", "+NumLock", "-NumLock"); !hasVKDown(evs, vkNum5) || !hasVKDown(evs, vkNumLock) {
		t.Fatalf("Fare Tuşları kapalı: %+v", evs)
	}
	if evs := play(a, inj, "+AltLeft", "+ShiftLeft", "+NumLock", "-NumLock", "-ShiftLeft", "-AltLeft"); hasVKDown(evs, vkNumLock) {
		t.Fatalf("Alt+Shift+NumLock: %+v", evs)
	}
	if len(*logs) != 1 || (*logs)[0] != DropMouseKeys {
		t.Fatalf("%v", *logs)
	}
	d2, inj2, a2, _ := newScoped(t)
	d2.mouseKeys = true
	if evs := play(a2, inj2, "+Numpad5", "+Numpad8", "+NumpadAdd", "+NumLock"); len(evs) != 0 {
		t.Fatalf("Fare Tuşları açık: %+v", evs)
	}
	if evs := play(a2, inj2, "+Digit5"); len(evs) != 1 {
		t.Fatalf("üst sıra rakam geçmeli: %+v", evs)
	}
}

// S-P17-7: erişilebilirlik ayarı oturum başında ve en çok 2 sn'de bir okunur; değişiklik sonraki okumada uygulanır.
func TestSP177AccessibilityRefreshedPeriodically(t *testing.T) {
	d, inj, a, _ := newScoped(t)
	for range 99 { // 198 mesaj × 10 ms < 2 sn: tek okuma
		play(a, inj, "+KeyA", "-KeyA")
	}
	if d.accReads != 1 {
		t.Fatalf("okuma=%d", d.accReads)
	}
	d.mouseKeys = true
	for range 150 { // +3 sn (basma+bırakma = 20 ms) → en az bir yeniden okuma
		play(a, inj, "+KeyA", "-KeyA")
	}
	if d.accReads < 2 {
		t.Fatalf("okuma=%d", d.accReads)
	}
	if evs := play(a, inj, "+Numpad5"); len(evs) != 0 {
		t.Fatalf("yeni ayar uygulanmadı: %+v", evs)
	}
	a.SetWindowTarget(hTarget, virtDesk, d) // yeni oturum: hemen okunur
	reads := d.accReads
	play(a, inj, "+KeyA")
	if d.accReads != reads+1 {
		t.Fatalf("oturum başı okuması yok: %d→%d", reads, d.accReads)
	}
}

// S-P17-7: monitör modunda erişilebilirlik süzgeci yok (Numpad, Ctrl↓↑ Esc, 5×Shift geçer).
func TestSP177MonitorModeUnchanged(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	seq := []string{"+Numpad5", "-Numpad5", "+NumLock", "-NumLock", "+ControlLeft", "-ControlLeft", "+Escape", "-Escape"}
	for range 5 {
		seq = append(seq, "+ShiftLeft", "-ShiftLeft")
	}
	if evs := play(a, inj, seq...); len(evs) != len(seq) {
		t.Fatalf("monitör modu: %d/%d", len(evs), len(seq))
	}
}
