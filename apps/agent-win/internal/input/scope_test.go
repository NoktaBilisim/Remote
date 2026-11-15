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
func (d *fakeDesk) IsMenu(h uintptr) bool { w := d.w(h); return w != nil && w.menu }

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
	if evs := inj.take(); len(evs) != 0 {
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
