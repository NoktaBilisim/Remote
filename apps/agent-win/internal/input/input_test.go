package input

import (
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
)

// fakeInj sahte enjektör: uygulanan olayları sayar/saklar.
type fakeInj struct {
	mu  sync.Mutex
	evs []Event
	n   atomic.Int64
}

func (f *fakeInj) Inject(evs []Event) error {
	f.mu.Lock()
	f.evs = append(f.evs, evs...)
	f.mu.Unlock()
	f.n.Add(int64(len(evs)))
	return nil
}

func (f *fakeInj) take() []Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.evs
	f.evs = nil
	return e
}

func newApplier() (*control.Gate, *fakeInj, *Applier) {
	g := &control.Gate{}
	inj := &fakeInj{}
	a := NewApplier(g, inj, nil)
	a.SetTarget(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1080))
	return g, inj, a
}

func TestAC101ClosedGateAppliesZeroEvents(t *testing.T) {
	g, inj, a := newApplier()
	for _, m := range []string{`{"t":"m.move","x":0.5,"y":0.5}`, `{"t":"m.btn","b":"l","down":true,"x":0.1,"y":0.1}`,
		`{"t":"k","code":"KeyA","down":true,"key":"a"}`, `{"t":"m.wheel","dx":0,"dy":120}`} {
		a.Handle([]byte(m))
	}
	if n := inj.n.Load(); n != 0 || g.Dropped() != 4 {
		t.Fatalf("kapalı kapıda uygulanan=%d düşen=%d", n, g.Dropped())
	}
}

func TestAC101CloseStopsInputWithin100ms(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // teknisyen sürekli hareket yollar (sunucu/teknisyen kapıyı atlayamaz)
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				a.Handle([]byte(`{"t":"m.move","x":0.3,"y":0.3}`))
			}
		}
	}()
	time.Sleep(20 * time.Millisecond)
	start := time.Now()
	g.Close() // "Kontrolü kapat"
	closedIn := time.Since(start)
	after := inj.n.Load()
	time.Sleep(150 * time.Millisecond)
	close(stop)
	wg.Wait()
	if closedIn > 100*time.Millisecond {
		t.Fatalf("kapanış %v sürdü", closedIn)
	}
	if got := inj.n.Load(); got != after {
		t.Fatalf("Close döndükten sonra %d olay uygulandı", got-after)
	}
	if after == 0 || g.Dropped() == 0 {
		t.Fatal("açıkken olay uygulanmalı, kapanınca düşmeli")
	}
}

func TestAC101CloseReleasesHeldKeysAndButtons(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	a.Handle([]byte(`{"t":"k","code":"ControlLeft","down":true}`))
	a.Handle([]byte(`{"t":"m.btn","b":"l","down":true,"x":0.5,"y":0.5}`))
	inj.take()
	g.Close()
	evs := inj.take()
	var keyUp, btnUp bool
	for _, e := range evs {
		keyUp = keyUp || (!e.Mouse && e.VK == 0xA2 && e.Flags&KeyUp != 0)
		btnUp = btnUp || (e.Mouse && e.Flags == MouseLeftUp)
		if e.Mouse && e.Flags&MouseLeftDown != 0 || !e.Mouse && e.Flags&KeyUp == 0 {
			t.Fatalf("kapanışta basma olayı: %+v", e)
		}
	}
	if !keyUp || !btnUp {
		t.Fatalf("takılı tuş/düğme bırakılmadı: %+v", evs)
	}
}

func TestAC104LocalInputSuspendsRemote(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	g.Suspend(time.Now())
	a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	if inj.n.Load() != 0 {
		t.Fatal("yerel girdi sonrası 1 sn uzaktan girdi uygulanmamalı")
	}
}

func TestAC48TurkishCharsUseUnicode(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	for code, ch := range map[string]string{"Semicolon": "ş", "KeyI": "ı", "Quote": "i", "BracketLeft": "ğ",
		"BracketRight": "ü", "Comma": "ö", "Period": "ç"} {
		a.Handle([]byte(`{"t":"k","code":"` + code + `","down":true,"key":"` + ch + `"}`))
		a.Handle([]byte(`{"t":"k","code":"` + code + `","down":false,"key":"` + ch + `"}`))
		evs := inj.take()
		r := []rune(ch)[0]
		if len(evs) != 2 || evs[0].Flags != KeyUnicode || evs[0].Scan != uint16(r) || evs[1].Flags != KeyUnicode|KeyUp {
			t.Errorf("%s: %+v", ch, evs)
		}
	}
	// Büyük İ: Shift basılıyken de Unicode (Shift bir kısayol değiştiricisi değil).
	a.Handle([]byte(`{"t":"k","code":"ShiftLeft","down":true}`))
	a.Handle([]byte(`{"t":"k","code":"Quote","down":true,"key":"İ"}`))
	evs := inj.take()
	if len(evs) != 2 || evs[1].Scan != 0x130 || evs[1].Flags != KeyUnicode {
		t.Errorf("İ: %+v", evs)
	}
}

func TestAC48ShortcutsAltTabFunctionKeys(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	seq := []string{`{"t":"k","code":"ControlLeft","down":true,"key":"Ctrl"}`, `{"t":"k","code":"KeyC","down":true,"key":"c"}`,
		`{"t":"k","code":"KeyC","down":false,"key":"c"}`, `{"t":"k","code":"ControlLeft","down":false}`,
		`{"t":"k","code":"AltLeft","down":true}`, `{"t":"k","code":"Tab","down":true}`, `{"t":"k","code":"Tab","down":false}`,
		`{"t":"k","code":"AltLeft","down":false}`, `{"t":"k","code":"F12","down":true}`, `{"t":"k","code":"ArrowUp","down":true}`}
	for _, m := range seq {
		a.Handle([]byte(m))
	}
	want := []Event{{VK: 0xA2}, {VK: 'C'}, {VK: 'C', Flags: KeyUp}, {VK: 0xA2, Flags: KeyUp},
		{VK: 0xA4}, {VK: 0x09}, {VK: 0x09, Flags: KeyUp}, {VK: 0xA4, Flags: KeyUp}, {VK: 0x7B}, {VK: 0x26, Flags: KeyExtended}}
	got := inj.take()
	if len(got) != len(want) {
		t.Fatalf("olay sayısı %d: %+v", len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%d: %+v, beklenen %+v", i, got[i], want[i])
		}
	}
}

func TestAC48CtrlAltDelAndWinLBlocked(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	for _, m := range []string{`{"t":"k","code":"ControlLeft","down":true}`, `{"t":"k","code":"AltLeft","down":true}`,
		`{"t":"k","code":"Delete","down":true}`, `{"t":"k","code":"MetaLeft","down":true}`, `{"t":"k","code":"KeyL","down":true,"key":"l"}`} {
		a.Handle([]byte(m))
	}
	for _, e := range inj.take() {
		if e.VK == 0x2E || e.VK == 'L' || e.Scan == 'l' {
			t.Fatalf("engelli tuş iletildi: %+v", e)
		}
	}
}

func TestAC49CoordinatesMapToMonitorWithinTwoPixels(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	// İki monitör: sol 2560×1440 (%150 ölçek, fiziksel piksel), sağdaki 1920×1080 aktif; sanal masaüstü birleşik.
	virt := rect(0, 0, 4480, 1440)
	mon := rect(2560, 0, 4480, 1080)
	a.SetTarget(mon, virt)
	for _, p := range [][2]float64{{0, 0}, {1, 1}, {0.5, 0.5}, {0.123, 0.987}} {
		a.Handle([]byte(`{"t":"m.move","x":` + ftoa(p[0]) + `,"y":` + ftoa(p[1]) + `}`))
		e := inj.take()[0]
		// Windows mutlak → piksel: px = dx * (virtW-1) / 65535
		px := float64(e.DX)*float64(virt.Right-virt.Left-1)/65535 + float64(virt.Left)
		py := float64(e.DY)*float64(virt.Bottom-virt.Top-1)/65535 + float64(virt.Top)
		wx := float64(mon.Left) + p[0]*float64(mon.Right-mon.Left-1)
		wy := float64(mon.Top) + p[1]*float64(mon.Bottom-mon.Top-1)
		if d := max(abs(px-wx), abs(py-wy)); d > 2 {
			t.Errorf("%v: %.1f piksel sapma", p, d)
		}
		if e.Flags != MouseMove|MouseAbsolute|MouseVirtualDesk {
			t.Errorf("bayrak %x", e.Flags)
		}
	}
}

func TestAC48WheelAndButtons(t *testing.T) {
	g, inj, a := newApplier()
	g.Open()
	a.Handle([]byte(`{"t":"m.wheel","dx":-120,"dy":240}`))
	a.Handle([]byte(`{"t":"m.btn","b":"r","down":true,"x":0.2,"y":0.2}`))
	a.Handle([]byte(`{"t":"m.btn","b":"r","down":false,"x":0.2,"y":0.2}`))
	evs := inj.take()
	if evs[0].Flags != MouseWheel || evs[0].Data != -240 || evs[1].Flags != MouseHWheel || evs[1].Data != -120 {
		t.Fatalf("tekerlek: %+v", evs[:2])
	}
	if evs[3].Flags != MouseRightDown || evs[5].Flags != MouseRightUp {
		t.Fatalf("sağ tık: %+v", evs[2:])
	}
}

func TestInputSchemaStrict(t *testing.T) {
	bad := []string{`{"t":"m.move","x":1.2,"y":0}`, `{"t":"m.move","x":0.1}`, `{"t":"m.move","x":0.1,"y":0.1,"z":1}`,
		`{"t":"m.btn","b":"x","down":true,"x":0,"y":0}`, `{"t":"m.wheel","dx":0,"dy":1201}`, `{"t":"m.wheel","dx":0.5,"dy":1}`,
		`{"t":"k","code":"Key A","down":true}`, `{"t":"k","code":"KeyA","down":true,"key":"abcde"}`,
		`{"t":"k","code":"KeyA","down":null}`, `{"t":"control.grant"}`, `{"t":"k.release_all","x":1}`, `[]`}
	for _, b := range bad {
		if _, err := Parse([]byte(b)); err == nil {
			t.Errorf("kabul edildi: %s", b)
		}
	}
	good := []string{`{"t":"m.move","x":0,"y":1}`, `{"t":"k","code":"Digit1","down":false}`, `{"t":"k.release_all"}`,
		`{"t":"k","code":"KeyQ","down":true,"key":"@"}`}
	for _, b := range good {
		if _, err := Parse([]byte(b)); err != nil {
			t.Errorf("reddedildi: %s", b)
		}
	}
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func rect(l, t, r, b int32) Rect { return Rect{Left: l, Top: t, Right: r, Bottom: b} }

// hookInj Windows'taki SendInput davranışını taklit eder: enjeksiyon, LL kancası kurulu iş parçacığı (input.Host)
// olayı işleyene kadar dönmez.
type hookInj struct {
	req chan chan struct{}
	n   atomic.Int64
}

func (h *hookInj) Inject(evs []Event) error {
	ack := make(chan struct{})
	h.req <- ack
	<-ack
	h.n.Add(int64(len(evs)))
	return nil
}

// S7-3: teknisyen sürekli hareket gönderirken (Applier kilidi tutulu, SendInput kanca iş parçacığını bekliyor)
// müşteri kısayola basar. Kanca iş parçacığı kısayolu işlerken kilit beklerse karşılıklı kilitlenme olur. gate.Shut
// ile kanca iş parçacığı hiç bloklanmamalı, kapı anında kapanmalı ve sonrasında hiçbir olay uygulanmamalı (AC-101).
func TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput(t *testing.T) {
	g := &control.Gate{}
	inj := &hookInj{req: make(chan chan struct{})}
	a := NewApplier(g, inj, nil)
	a.SetTarget(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1080))
	g.Open()

	stop := make(chan struct{})
	hotkey := make(chan struct{})
	hotkeyDone := make(chan time.Duration, 1)
	var hookWG sync.WaitGroup
	hookWG.Add(1)
	go func() { // "kanca iş parçacığı": LL kanca işleme + WM_HOTKEY
		defer hookWG.Done()
		fired := false
		for {
			select {
			case <-stop:
				return
			case ack := <-inj.req:
				if !fired {
					// Bir enjeksiyon kancayı beklerken (Applier kilidi tutulu) kısayol gelir.
					<-hotkey
					start := time.Now()
					g.Shut(nil) // host_windows.go WM_HOTKEY yolu
					hotkeyDone <- time.Since(start)
					fired = true
				}
				close(ack)
			}
		}
	}()

	var moverWG sync.WaitGroup
	moverWG.Add(1)
	go func() { // Pion goroutine'i: önce bir tuş basılı, sonra sürekli hareket
		defer moverWG.Done()
		a.Handle([]byte(`{"t":"k","code":"ShiftLeft","down":true}`))
		for {
			select {
			case <-stop:
				return
			default:
				a.Handle([]byte(`{"t":"m.move","x":0.4,"y":0.4}`))
			}
		}
	}()
	close(hotkey)
	select {
	case d := <-hotkeyDone:
		if d > 100*time.Millisecond {
			t.Fatalf("kısayol işleme %v sürdü (kanca bloklanmamalı)", d)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("karşılıklı kilitlenme: kanca iş parçacığı kısayolda takıldı")
	}
	if g.IsOpen() {
		t.Fatal("kapı kapanmalı")
	}
	// Uçuştaki tek enjeksiyon ve ayrı goroutine'deki ReleaseAll tamamlansın; sonra hiçbir olay eklenmemeli.
	time.Sleep(50 * time.Millisecond)
	settled := inj.n.Load()
	time.Sleep(100 * time.Millisecond)
	if got := inj.n.Load(); got != settled {
		t.Fatalf("Shut sonrası %d olay uygulandı", got-settled)
	}
	close(stop)
	moverWG.Wait()
	hookWG.Wait()
	if g.Dropped() == 0 {
		t.Fatal("kapanıştan sonraki hareketler düşmeli")
	}
}

// S7-8: input kanalında jeton kovası; aşan basma/hareket düşer ve sayılır, bırakma olayları sınırdan muaf.
func TestS78InputRateLimit(t *testing.T) {
	g := &control.Gate{}
	inj := &fakeInj{}
	now := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	a := NewApplier(g, inj, clock)
	a.SetTarget(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1080))
	g.Open()
	a.Handle([]byte(`{"t":"k","code":"ShiftLeft","down":true}`)) // 1 jeton
	for i := 0; i < RateBurst+100; i++ {
		a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	}
	if got := a.Limited(); got != 101 {
		t.Fatalf("düşen=%d, beklenen 101", got)
	}
	if n := inj.n.Load(); n != RateBurst {
		t.Fatalf("uygulanan=%d, beklenen %d", n, RateBurst)
	}
	// Kova boşken bırakma yine uygulanır (takılı tuş kalmaz).
	a.Handle([]byte(`{"t":"k","code":"ShiftLeft","down":false}`))
	if n := inj.n.Load(); n != RateBurst+1 {
		t.Fatalf("bırakma sınıra takıldı: %d", n)
	}
	// 1 sn sonra RatePerSec jeton dolar.
	mu.Lock()
	now = now.Add(time.Second)
	mu.Unlock()
	before := a.Limited()
	for i := 0; i < RatePerSec; i++ {
		a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	}
	if a.Limited() != before {
		t.Fatal("dolan jetonla hareketler uygulanmalı")
	}
	a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.5}`))
	if a.Limited() != before+1 {
		t.Fatal("kova yine boşalmalı")
	}
	// Kapı kapalıyken ayrıştırma yapılmadan düşer (Drop sayılır, Limited değil).
	g.Close()
	lim, drop := a.Limited(), g.Dropped()
	a.Handle([]byte(`{bozuk`))
	if a.Limited() != lim || g.Dropped() != drop+1 {
		t.Fatal("kapalı kapıda erken düşürme beklenir")
	}
}

// S7-13: bırakma muafiyeti yalnız gerçekten basılı tuş/düğmeye uygulanır. Basılı olmayan düğmenin "bırakılması" hiçbir
// olay enjekte etmez (hareket dahil) ve jeton harcar; böylece sınır bırakma selinde atlatılamaz.
func TestS713ReleaseExemptionOnlyForHeld(t *testing.T) {
	g := &control.Gate{}
	inj := &fakeInj{}
	now := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	a := NewApplier(g, inj, func() time.Time { return now })
	a.SetTarget(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1080))
	g.Open()
	upL := []byte(`{"t":"m.btn","b":"l","down":false,"x":0.5,"y":0.5}`)
	upK := []byte(`{"t":"k","code":"KeyA","down":false}`)
	for i := 0; i < RateBurst+50; i++ {
		a.Handle(upL)
		a.Handle(upK)
	}
	if n := inj.n.Load(); n != 0 {
		t.Fatalf("basılı olmayan bırakma enjekte etti: %d olay", n)
	}
	// 2*(500+50) mesaj, 500 jeton: kalanlar sınıra takılır.
	if got := a.Limited(); got != 2*(RateBurst+50)-RateBurst {
		t.Fatalf("düşen=%d, bırakma seli jeton harcamalı", got)
	}
	// Kova boşken basılı düğmeye basılamaz; ama basılıysa bırakma muaf kalır.
	now = now.Add(10 * time.Millisecond) // 2,5 jeton
	a.Handle([]byte(`{"t":"m.btn","b":"l","down":true,"x":0.5,"y":0.5}`))
	a.Handle([]byte(`{"t":"k","code":"KeyA","down":true}`))
	if n := inj.n.Load(); n != 3 { // hareket + LDOWN + KeyA
		t.Fatalf("basma=%d olay, beklenen 3", n)
	}
	for i := 0; i < 10; i++ { // kovayı boşalt
		a.Handle([]byte(`{"t":"m.move","x":0.1,"y":0.1}`))
	}
	lim := a.Limited()
	a.Handle(upL)
	a.Handle(upK)
	if a.Limited() != lim {
		t.Fatal("basılı tuş/düğmenin bırakılması sınıra takılmamalı")
	}
	evs := inj.take()
	tail := evs[len(evs)-3:]
	if tail[1].Flags != MouseLeftUp || tail[2].Flags&KeyUp == 0 {
		t.Fatalf("bırakma olayları uygulanmadı: %+v", tail)
	}
	// Artık basılı değil: ikinci bırakma yine no-op.
	before := inj.n.Load()
	now = now.Add(time.Second)
	a.Handle(upL)
	a.Handle(upK)
	if inj.n.Load() != before {
		t.Fatal("ikinci bırakma enjekte etmemeli")
	}
}
