package control

import (
	"errors"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)

func TestAC101GateClosedByDefaultAndAfterClose(t *testing.T) {
	var g Gate
	if g.IsOpen() || g.Allow(t0) {
		t.Fatal("kapı varsayılan kapalı olmalı")
	}
	released := 0
	g.OnClose(func() { released++ })
	g.Open()
	if !g.Allow(t0) {
		t.Fatal("açık kapı izin vermeli")
	}
	if !g.Close() || g.Allow(t0) || released != 1 {
		t.Fatalf("Close sonrası kapalı ve dinleyici 1 kez: released=%d", released)
	}
	if g.Close() || released != 1 {
		t.Fatal("ikinci Close değişiklik bildirmemeli")
	}
}

func TestAC104LocalInputSuspendsOneSecond(t *testing.T) {
	var g Gate
	g.Open()
	g.Suspend(t0)
	if g.Allow(t0.Add(999 * time.Millisecond)) {
		t.Fatal("yerel girdiden sonraki 1 sn içinde uzaktan girdi askıda olmalı")
	}
	if !g.Allow(t0.Add(time.Second)) {
		t.Fatal("1 sn sonra uzaktan girdi devam etmeli")
	}
}

func TestAC101GateConcurrentCloseIsRaceFree(t *testing.T) {
	var g Gate
	g.Open()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				if !g.Allow(t0) {
					g.Drop()
				}
			}
		}()
	}
	g.Close()
	wg.Wait()
	if g.IsOpen() {
		t.Fatal("kapı kapalı kalmalı")
	}
}

func TestAC116RequestCooldownAndSessionLimit(t *testing.T) {
	var r Requests
	if !r.Admit(t0) {
		t.Fatal("ilk istek diyalog açmalı")
	}
	if r.Admit(t0) {
		t.Fatal("diyalog açıkken ikinci istek yeni diyalog açmamalı")
	}
	r.Denied(t0)
	if r.Admit(t0.Add(29 * time.Second)) {
		t.Fatal("ret sonrası 30 sn içinde istek iletilmemeli")
	}
	if !r.Admit(t0.Add(30 * time.Second)) {
		t.Fatal("30 sn sonra istek iletilmeli")
	}
	r.Granted()
	for i := 0; i < 3; i++ {
		if !r.Admit(t0.Add(time.Minute)) {
			t.Fatalf("%d. istek", i+3)
		}
		r.Cancel()
	}
	if r.Admit(t0.Add(time.Hour)) {
		t.Fatal("oturum başına 5 istekten fazlası iletilmemeli")
	}
}

func TestAC116ConsentTimingFocusAndInjection(t *testing.T) {
	c := Consent{ShownAt: t0, HotkeyOK: true}
	cases := []struct {
		name     string
		at       time.Duration
		trig     Trigger
		injected bool
		want     bool
	}{
		{"ilk 1,5 sn tıklama", 1499 * time.Millisecond, TrigClick, false, false},
		{"anında tıklama", 0, TrigClick, false, false},
		{"Enter/Space hiçbir zaman", 10 * time.Second, TrigEnterSpace, false, false},
		{"enjekte tıklama", 10 * time.Second, TrigClick, true, false},
		{"1,5 sn sonra tıklama", 1500 * time.Millisecond, TrigClick, false, true},
		{"1,5 sn sonra Alt+İ", 2 * time.Second, TrigAccessKey, false, true},
		{"ilk 1,5 sn Alt+İ", time.Second, TrigAccessKey, false, false},
	}
	for _, tc := range cases {
		if got := c.CanGrant(t0.Add(tc.at), tc.trig, tc.injected); got != tc.want {
			t.Errorf("%s: %v, beklenen %v", tc.name, got, tc.want)
		}
	}
}

func TestAC102NoHotkeyNoGrant(t *testing.T) {
	c := Consent{ShownAt: t0, HotkeyOK: false}
	if c.CanGrant(t0.Add(time.Minute), TrigClick, false) {
		t.Fatal("kısayol kaydı yokken kontrol izni verilmemeli")
	}
}

func TestAC102HotkeyFallback(t *testing.T) {
	hk, err := RegisterHotkey(func(Hotkey) error { return nil })
	if err != nil || hk != HotkeyPrimary {
		t.Fatalf("birincil kaydedilmeli: %v %v", hk, err)
	}
	hk, err = RegisterHotkey(func(h Hotkey) error {
		if h == HotkeyPrimary {
			return errors.New("başka uygulamada kayıtlı")
		}
		return nil
	})
	if err != nil || hk.Label != "Ctrl+Shift+F11" {
		t.Fatalf("yedeğe düşmeli: %v %v", hk, err)
	}
	var tried []string
	_, err = RegisterHotkey(func(h Hotkey) error { tried = append(tried, h.Label); return errors.New("x") })
	if !errors.Is(err, ErrNoHotkey) || len(tried) != 2 {
		t.Fatalf("ikisi de denenmeli ve ErrNoHotkey: %v %v", tried, err)
	}
}

func TestAC116DialogNeverUnderCursor(t *testing.T) {
	work := Rect{0, 0, 1920, 1040}
	w, h, pad := int32(420), int32(220), int32(24)
	for _, cur := range []Point{{960, 520}, {960, 30}, {960, 1000}, {10, 10}, {1900, 1030}, {700, 400}} {
		x, y := PlaceAway(cur, work, w, h, pad)
		if (Rect{x, y, x + w, y + h}).Contains(cur) {
			t.Errorf("imleç %v diyalog içinde (%d,%d)", cur, x, y)
		}
	}
	// imleç merkezdeyse üst-orta
	if x, y := PlaceAway(Point{960, 520}, work, w, h, pad); x != 750 || y != pad {
		t.Errorf("merkezde imleç → üst-orta beklenir: %d,%d", x, y)
	}
	// çalışma alanından büyük diyalog
	x, y := PlaceAway(Point{100, 100}, Rect{0, 0, 300, 200}, w, h, pad)
	if (Rect{x, y, x + w, y + h}).Contains(Point{100, 100}) {
		t.Error("büyük diyalog da imleci içermemeli")
	}
}

// S7-3: Shut kanca iş parçacığından çağrılır; kapanış dinleyicisi (Applier kilidini bekleyen ReleaseAll) bloklansa
// bile Shut hemen döner ve kapı anında kapalıdır.
func TestS73ShutNeverBlocksAndClosesAtomically(t *testing.T) {
	var g Gate
	release := make(chan struct{})
	listened := make(chan struct{})
	g.OnClose(func() { <-release; close(listened) })
	after := make(chan struct{})
	g.Open()
	returned := make(chan bool, 1)
	go func() { returned <- g.Shut(func() { close(after) }) }()
	select {
	case was := <-returned:
		if !was {
			t.Fatal("açık kapı kapanmalı (true)")
		}
	case <-time.After(time.Second):
		t.Fatal("Shut bloklandı (kanca iş parçacığı kilitlenir)")
	}
	if g.IsOpen() || g.Allow(t0) {
		t.Fatal("Shut döndüğünde kapı kapalı olmalı (AC-101)")
	}
	close(release)
	for _, ch := range []chan struct{}{listened, after} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatal("dinleyici / after çalışmadı")
		}
	}
	// Kapalı kapıda Shut dinleyiciyi yeniden çalıştırmaz ama after (akış bildirimi) yine çalışır.
	again := make(chan struct{})
	if g.Shut(func() { close(again) }) {
		t.Fatal("kapalı kapı için false beklenir")
	}
	<-again
}

// S7-7: açılış dinleyicisi (LL kancalarını kur) yalnız kapalı → açık geçişinde bir kez çalışır.
func TestS77OpenListenerOnlyOnTransition(t *testing.T) {
	var g Gate
	opened, closed := 0, 0
	g.OnOpen(func() { opened++ })
	g.OnClose(func() { closed++ })
	g.Open()
	g.Open()
	g.Close()
	g.Close()
	if opened != 1 || closed != 1 {
		t.Fatalf("opened=%d closed=%d", opened, closed)
	}
}

// S7-12: yalnız IMO_HARDWARE yerel; INJECTED, SYSTEM, UNAVAILABLE, bilinmeyen/birleşik değer ve başarısız sorgu enjekte.
func TestS712OriginInjectedFailClosed(t *testing.T) {
	if IMO_UNAVAILABLE != 0 || IMO_HARDWARE != 1 || IMO_INJECTED != 2 || IMO_SYSTEM != 4 {
		t.Fatal("sabitler winuser.h ile aynı olmalı")
	}
	cases := []struct {
		name     string
		origin   uint32
		ok       bool
		injected bool
	}{
		{"IMO_HARDWARE", IMO_HARDWARE, true, false},
		{"IMO_INJECTED", IMO_INJECTED, true, true},
		{"IMO_SYSTEM", IMO_SYSTEM, true, true},
		{"IMO_UNAVAILABLE", IMO_UNAVAILABLE, true, true},
		{"bilinmeyen 8", 8, true, true},
		{"birleşik HARDWARE|INJECTED", IMO_HARDWARE | IMO_INJECTED, true, true},
		{"en büyük değer", ^uint32(0), true, true},
		{"sorgu başarısız (HARDWARE)", IMO_HARDWARE, false, true},
		{"sorgu başarısız (0)", 0, false, true},
	}
	for _, c := range cases {
		if got := OriginInjected(c.origin, c.ok); got != c.injected {
			t.Errorf("%s: injected=%v, beklenen %v", c.name, got, c.injected)
		}
	}
}

// S7-12: WM_CHAR/WM_SYSCHAR kaynağı bilinmiyorsa tuş basışının kararı, biliniyorsa ikisinden biri enjekteyse enjekte.
func TestS712CharInjected(t *testing.T) {
	cases := []struct {
		name        string
		keyInjected bool
		origin      uint32
		ok          bool
		injected    bool
	}{
		{"yerel tuş, kaynak yok", false, IMO_UNAVAILABLE, true, false},
		{"enjekte tuş, kaynak yok", true, IMO_UNAVAILABLE, true, true},
		{"yerel tuş, sorgu başarısız", false, 0, false, false},
		{"enjekte tuş, sorgu başarısız", true, IMO_HARDWARE, false, true},
		{"yerel tuş, HARDWARE", false, IMO_HARDWARE, true, false},
		{"yerel tuş, INJECTED", false, IMO_INJECTED, true, true},
		{"yerel tuş, SYSTEM", false, IMO_SYSTEM, true, true},
		{"yerel tuş, bilinmeyen", false, 16, true, true},
		{"enjekte tuş, HARDWARE", true, IMO_HARDWARE, true, true},
	}
	for _, c := range cases {
		if got := CharInjected(c.keyInjected, c.origin, c.ok); got != c.injected {
			t.Errorf("%s: injected=%v, beklenen %v", c.name, got, c.injected)
		}
	}
}

// hookModel input.Host'un kanca durumunu taklit eder (Windows'tan bağımsız): wmHooksOn yalnız kapı açıksa kurar,
// wmHooksOff yalnız StillClosed(nesil) ise kaldırır.
type hookModel struct {
	g         *Gate
	installed bool
}

func (h *hookModel) on() {
	if h.g.IsOpen() {
		h.installed = true
	}
}

func (h *hookModel) off(gen uint64) {
	if h.g.StillClosed(gen) {
		h.installed = false
	}
}

// S7-16: kısayolla kapatma (Shut) → dinleyici goroutine'i gecikirken kapı yeniden açılır → geç gelen kaldırma isteği
// yeni açılışın kancalarını kaldırmaz. Normal kapanış ise kaldırır.
func TestS716StaleHooksOffIgnoredAfterReopen(t *testing.T) {
	g := &Gate{}
	h := &hookModel{g: g}
	release := make(chan struct{})
	staleGen := make(chan uint64, 1)
	var blockOnce sync.Once
	g.OnCloseGen(func(gen uint64) {
		blockOnce.Do(func() { <-release; staleGen <- gen }) // ilk kapanışın dinleyicisi gecikir
	})
	g.Open()
	h.on()
	g.Shut(nil) // kanca iş parçacığı: atomik kapanış, dinleyici ayrı goroutine'de bekliyor
	g.Open()    // yeni istek + izin
	h.on()
	if !h.installed || !g.IsOpen() {
		t.Fatal("yeniden açılışta kancalar kurulu olmalı")
	}
	close(release)
	gen := <-staleGen
	h.off(gen) // gecikmiş kaldırma isteği
	if !h.installed {
		t.Fatal("bayat Hooks(false) yeni açılışın kancalarını kaldırdı (AC-104)")
	}
	// Yeni açılışın kendi kapanışı kaldırır.
	var cur uint64
	g.OnCloseGen(func(gen uint64) { cur = gen })
	g.Close()
	h.off(cur)
	if h.installed {
		t.Fatal("geçerli kapanış kancaları kaldırmalı")
	}
	if cur == gen {
		t.Fatal("her açılış yeni nesil almalı")
	}
	// Kapalıyken kuyrukta kalmış açma isteği kurmaz.
	h.on()
	if h.installed {
		t.Fatal("kapalı kapıda kanca kurulmamalı")
	}
}

// S7-16: eşzamanlı Open/Close/Shut altında nesil ve açıklık tutarlı; StillClosed yalnız son kapanışın nesli için true.
func TestS716GenerationRaceFree(t *testing.T) {
	g := &Gate{}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 500; j++ {
				switch (i + j) % 3 {
				case 0:
					g.Open()
				case 1:
					g.Close()
				default:
					g.Shut(nil)
				}
			}
		}(i)
	}
	wg.Wait()
	g.Close()
	g.Open()
	last := g.state.Load() >> 1 // gecikmiş Shut dinleyicileri hâlâ çalışıyor olabilir; nesil doğrudan okunur
	g.Close()
	if !g.StillClosed(last) || g.StillClosed(last-1) {
		t.Fatal("StillClosed yalnız son kapanan nesil için true olmalı")
	}
}
