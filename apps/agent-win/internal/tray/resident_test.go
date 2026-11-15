package tray

import (
	"context"
	"image"
	"image/color"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/signal"
)

const origin = "https://destek.example"

func state(st remember.Status, tray bool, n int) remember.LoadResult {
	r := remember.LoadResult{Status: st}
	for i := 0; i < n; i++ {
		r.Data.Bindings = append(r.Data.Bindings, remember.Binding{Server: origin, Key: strings.Repeat("k", i+1)})
	}
	if n > 0 {
		r.Data.Prefs = &remember.Prefs{Tray: tray}
	}
	return r
}

func TestAC253GP206TrayArgOnlyExact(t *testing.T) {
	cases := []struct {
		args []string
		want bool
	}{
		{[]string{"x.exe", "--tray"}, true},
		{[]string{"x.exe"}, false},
		{[]string{"x.exe", "/tray"}, false},
		{[]string{"x.exe", "--tray=1"}, false},
		{[]string{"x.exe", "--TRAY"}, false},
		{[]string{"x.exe", "--tray", "--tray"}, false},
		{[]string{"x.exe", "--tray", "https://kotu.example"}, false},
		{[]string{"x.exe", " --tray"}, false},
	}
	for _, c := range cases {
		if got := IsTrayLaunch(c.args); got != c.want {
			t.Errorf("%q: %v, beklenen %v", c.args, got, c.want)
		}
	}
}

func TestAC253DecideStart(t *testing.T) {
	cases := []struct {
		name     string
		r        remember.LoadResult
		store    bool
		elevated bool
		want     StartMode
	}{
		{"kayıt + tepsi açık", state(remember.StatusOK, true, 1), true, false, StartResident},
		{"tepsi kapalı → Run silinir", state(remember.StatusOK, false, 2), true, false, StartDisable},
		{"kayıt yok", state(remember.StatusAbsent, false, 0), true, false, StartDisable},
		{"G-P20-3 okunamıyor → Run korunur, tepsi", state(remember.StatusUnreadable, false, 0), true, false, StartResident},
		{"LocalAppData yok", state(remember.StatusAbsent, false, 0), false, false, StartDisable},
		{"K-P20-8 yükseltilmiş: kayıt defterine dokunulmaz", state(remember.StatusOK, true, 1), true, true, StartQuit},
	}
	for _, c := range cases {
		if got := DecideStart(c.r, origin, c.store, c.elevated); got != c.want {
			t.Errorf("%s: %v, beklenen %v", c.name, got, c.want)
		}
	}
	other := state(remember.StatusOK, true, 1)
	other.Data.Bindings[0].Server = "https://baska.example"
	if DecideStart(other, origin, true, false) != StartDisable {
		t.Error("yalnız başka kökenli kayıt: tepsi koşulu sağlanmamalı")
	}
	if Eligible(state(remember.StatusUnreadable, true, 1), origin) {
		t.Error("Eligible okunamayan dosyada false olmalı (normal açılışta tepsiye inilmez)")
	}
}

// --- sahte simge ve kapsam ---

type fakeIcon struct {
	mu       sync.Mutex
	cmds     chan Command
	balloons []string
	tips     []string
	confirm  bool
	confirms int
	closed   bool
}

func newIcon() *fakeIcon { return &fakeIcon{cmds: make(chan Command, 8)} }

func (f *fakeIcon) Commands() <-chan Command { return f.cmds }
func (f *fakeIcon) SetTip(s string)          { f.mu.Lock(); f.tips = append(f.tips, s); f.mu.Unlock() }
func (f *fakeIcon) Balloon(s string)         { f.mu.Lock(); f.balloons = append(f.balloons, s); f.mu.Unlock() }
func (f *fakeIcon) Confirm(string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.confirms++
	return f.confirm
}
func (f *fakeIcon) Close() { f.mu.Lock(); f.closed = true; f.mu.Unlock() }

type scopeLog struct {
	mu        sync.Mutex
	runs      []bool // first bayrağı
	gates     []*control.Gate
	openAtRun []bool
	hotkeys   int // kurulu kısayol sayısı (Start - Stop)
	maxHot    int
	resets    []*control.Gate
	ended     int
	idle      int
	// body kapsam içinde çalışır (nil: hemen biter).
	body func(ctx context.Context, gate *control.Gate, active func()) flow.Outcome
}

func (l *scopeLog) scope() Scope {
	return Scope{
		Hotkey: func(*control.Gate) (string, func()) {
			l.mu.Lock()
			l.hotkeys++
			l.maxHot = max(l.maxHot, l.hotkeys)
			l.mu.Unlock()
			return "Ctrl+Shift+F12", func() { l.mu.Lock(); l.hotkeys--; l.mu.Unlock() }
		},
		Reset: func(g *control.Gate, _ string) { l.mu.Lock(); l.resets = append(l.resets, g); l.mu.Unlock() },
		Run: func(ctx context.Context, first bool, gate *control.Gate, _ string, active func()) flow.Outcome {
			l.mu.Lock()
			l.runs = append(l.runs, first)
			l.gates = append(l.gates, gate)
			l.openAtRun = append(l.openAtRun, gate.IsOpen())
			hot := l.hotkeys
			body := l.body
			l.mu.Unlock()
			if hot != 1 {
				panic("kısayol kapsam başında kurulmalı")
			}
			if body != nil {
				return body(ctx, gate, active)
			}
			return flow.Outcome{}
		},
		Ended:      func(flow.Outcome) { l.mu.Lock(); l.ended++; l.mu.Unlock() },
		CloseDelay: 5 * time.Millisecond,
		Idle:       func() { l.mu.Lock(); l.idle++; l.mu.Unlock() },
	}
}

func (l *scopeLog) waitIdle(t *testing.T, n int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		l.mu.Lock()
		got := l.idle
		l.mu.Unlock()
		if got >= n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("kapsam %d bitmedi", n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func (f *fixture) startedN() int { f.mu.Lock(); defer f.mu.Unlock(); return f.started }

type fixture struct {
	log      *scopeLog
	icon     *fakeIcon
	st       remember.LoadResult
	started  int
	trayOK   bool
	verify   bool
	disabled int
	raised   int
	ended    chan struct{}
	mu       sync.Mutex
}

func newFixture() *fixture {
	return &fixture{log: &scopeLog{}, icon: newIcon(), st: state(remember.StatusOK, true, 1), trayOK: true,
		ended: make(chan struct{}, 4)}
}

func (f *fixture) resident() Resident {
	return Resident{
		Scope: f.log.scope(),
		StartTray: func() (IconAPI, bool) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.started++
			if !f.trayOK {
				return nil, false
			}
			return f.icon, true
		},
		State:      func() remember.LoadResult { f.mu.Lock(); defer f.mu.Unlock(); return f.st },
		Origin:     origin,
		Verify:     func() bool { return f.verify },
		Disable:    func() { f.mu.Lock(); f.disabled++; f.mu.Unlock() },
		Raise:      func() { f.mu.Lock(); f.raised++; f.mu.Unlock() },
		EndSession: func() { f.ended <- struct{}{} },
		ExitGrace:  time.Second,
	}
}

func runAsync(fn func()) chan struct{} {
	done := make(chan struct{})
	go func() { defer close(done); fn() }()
	return done
}

func wait(t *testing.T, done chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("zaman aşımı")
	}
}

func TestAC253TrayLaunchNoNetworkUntilCommand(t *testing.T) {
	f := newFixture()
	ctx, cancel := context.WithCancel(context.Background())
	done := runAsync(func() { f.resident().RunTray(ctx, f.icon, "") })
	time.Sleep(30 * time.Millisecond)
	cancel()
	wait(t, done)
	if len(f.log.runs) != 0 || f.log.maxHot != 0 {
		t.Fatalf("--tray boşta: akış (ağ) %d kez, kısayol %d — ikisi de 0 olmalı (S-P20-2, G-P20-5)", len(f.log.runs), f.log.maxHot)
	}
	if !f.icon.closed {
		t.Fatal("çıkışta simge kaldırılmalı")
	}
}

func TestAC253GP205ScopesResetPerSession(t *testing.T) {
	f := newFixture()
	f.log.body = func(_ context.Context, gate *control.Gate, active func()) flow.Outcome {
		gate.Open() // A oturumunda kontrol izni verildi
		active()
		return flow.Outcome{Message: flow.Message{Title: "Oturum bitti"}}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := runAsync(func() { f.resident().RunTray(ctx, f.icon, "") })
	f.icon.cmds <- CmdOpen
	f.log.waitIdle(t, 1)
	f.icon.cmds <- CmdOpen
	f.log.waitIdle(t, 2)
	cancel()
	wait(t, done)
	l := f.log
	if len(l.runs) != 2 || l.runs[0] || l.runs[1] {
		t.Fatalf("iki kapsam, ikisi de dosya adı değerlendirmeden (first=false) beklenirdi: %v", l.runs)
	}
	if l.gates[0] == l.gates[1] || l.openAtRun[1] {
		t.Fatal("B oturumu yeni ve kapalı izin kapısıyla başlamalı (G-P20-5)")
	}
	if l.gates[0].IsOpen() {
		t.Fatal("A kapsamının kapısı kapsam sonunda kapanmalı")
	}
	if l.hotkeys != 0 || l.maxHot != 1 {
		t.Fatalf("kısayol yalnız kapsam süresince: kalan %d, en çok %d", l.hotkeys, l.maxHot)
	}
	if l.ended != 2 || len(l.resets) != 4 || l.resets[1] != nil || l.resets[2] != l.gates[1] {
		t.Fatalf("her kapsam başında yeni kapıyla, sonunda nil ile UI sıfırlanmalı: ended=%d resets=%v", l.ended, l.resets)
	}
	f.icon.mu.Lock()
	defer f.icon.mu.Unlock()
	if !contains(f.icon.tips, TipSession) || f.icon.tips[len(f.icon.tips)-1] != Tip {
		t.Fatalf("oturumda ipucu %q, sonunda %q olmalı: %v", TipSession, Tip, f.icon.tips)
	}
	if !f.icon.closed {
		t.Fatal("süreç tepside kalmalı ve yalnız çıkışta simge kalkmalı")
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestAC253NormalCloseGoesToTrayOnceBalloon(t *testing.T) {
	f := newFixture()
	ctx, cancel := context.WithCancel(context.Background())
	done := runAsync(func() { f.resident().RunNormal(ctx) })
	f.log.waitIdle(t, 1)
	time.Sleep(30 * time.Millisecond)
	if f.startedN() != 1 {
		t.Fatalf("X sonrası tepsi koşulu sağlanınca simge (ve mutex) alınmalı: %d", f.started)
	}
	f.icon.cmds <- CmdExit
	wait(t, done)
	cancel()
	if len(f.log.runs) != 1 || !f.log.runs[0] {
		t.Fatalf("normal açılışta ilk kapsam dosya adıyla (first=true): %v", f.log.runs)
	}
	if len(f.icon.balloons) != 1 || f.icon.balloons[0] != BalloonResident {
		t.Fatalf("tepsiye inişte bir kez balon: %v", f.icon.balloons)
	}
	if f.icon.confirms != 0 {
		t.Fatal("boşta Çık onay istememeli")
	}
}

func TestAC107NormalExitWhenNotResident(t *testing.T) {
	cases := []struct {
		name string
		mod  func(f *fixture, r *Resident)
	}{
		{"tepsi tercihi kapalı (AC-107 aynen)", func(f *fixture, _ *Resident) { f.st = state(remember.StatusOK, false, 1) }},
		{"kayıt okunamıyor", func(f *fixture, _ *Resident) { f.st = state(remember.StatusUnreadable, true, 1) }},
		{"kod/ref dosyası bağımsız", func(_ *fixture, r *Resident) { r.Standalone = true }},
		{"yükseltilmiş", func(_ *fixture, r *Resident) { r.Elevated = true }},
	}
	for _, c := range cases {
		f := newFixture()
		r := f.resident()
		c.mod(f, &r)
		wait(t, runAsync(func() { r.RunNormal(context.Background()) }))
		if f.started != 0 {
			t.Errorf("%s: tepsiye inilmemeli", c.name)
		}
	}
}

func TestAC253GP213SecondTrayInstanceExits(t *testing.T) {
	f := newFixture()
	f.trayOK = false // Run'dan başlamış tepsi örneği mutex'i tutuyor
	wait(t, runAsync(func() { f.resident().RunNormal(context.Background()) }))
	if f.started != 1 || f.icon.closed || len(f.icon.balloons) != 0 {
		t.Fatal("mutex alınamazsa tepsiye inilmez, bugünkü gibi çıkılır (G-P20-13)")
	}
}

func TestAC253ExitDuringSessionConfirmsAndEnds(t *testing.T) {
	f := newFixture()
	inScope := make(chan struct{})
	f.log.body = func(ctx context.Context, _ *control.Gate, _ func()) flow.Outcome {
		close(inScope)
		select { // EndSession → session.end ile biter
		case <-f.ended:
			return flow.Outcome{Message: flow.Message{Title: "Oturumu bitirdiniz"}}
		case <-ctx.Done():
			return flow.Outcome{}
		}
	}
	f.ended = make(chan struct{}, 1)
	ctx := context.Background()
	done := runAsync(func() { f.resident().RunTray(ctx, f.icon, "") })
	f.icon.cmds <- CmdOpen
	<-inScope
	f.icon.cmds <- CmdOpen // açıkken Aç → öne getir
	f.icon.cmds <- CmdExit // onay: hayır
	time.Sleep(30 * time.Millisecond)
	f.mu.Lock()
	raised := f.raised
	f.mu.Unlock()
	if raised != 1 {
		t.Fatalf("pencere açıkken Aç öne getirmeli: %d", raised)
	}
	f.icon.mu.Lock()
	f.icon.confirm = true
	f.icon.mu.Unlock()
	f.icon.cmds <- CmdExit
	wait(t, done)
	if f.icon.confirms != 2 || len(f.log.runs) != 1 || f.log.hotkeys != 0 || !f.icon.closed {
		t.Fatalf("Çık: onay(2)=%d, kapsam=%d, kısayol=%d, simge kapalı=%v", f.icon.confirms, len(f.log.runs), f.log.hotkeys, f.icon.closed)
	}
}

func TestAC253TrayClosesWhenNoLongerEligible(t *testing.T) {
	f := newFixture()
	f.log.body = func(context.Context, *control.Gate, func()) flow.Outcome {
		f.mu.Lock()
		f.st = state(remember.StatusAbsent, false, 0) // kapsam içinde "Bu bilgisayarı unut"
		f.mu.Unlock()
		return flow.Outcome{}
	}
	done := runAsync(func() { f.resident().RunTray(context.Background(), f.icon, "") })
	f.icon.cmds <- CmdOpen
	wait(t, done)
	if f.disabled != 1 || !f.icon.closed {
		t.Fatal("son kayıt gidince Run silinmeli ve tepsi kapanmalı")
	}
}

func TestAC253GP203UnreadableKeepsTray(t *testing.T) {
	f := newFixture()
	f.st = state(remember.StatusUnreadable, false, 0)
	ctx, cancel := context.WithCancel(context.Background())
	done := runAsync(func() { f.resident().RunTray(ctx, f.icon, "") })
	f.icon.cmds <- CmdOpen
	time.Sleep(30 * time.Millisecond)
	cancel()
	wait(t, done)
	if f.disabled != 0 || len(f.log.runs) != 1 {
		t.Fatal("geçici okuma hatasında Run korunur, tepsi kalır")
	}
}

func TestAC253GP215VerifyOnTrayOpenBalloon(t *testing.T) {
	f := newFixture()
	f.verify = true
	ctx, cancel := context.WithCancel(context.Background())
	done := runAsync(func() { f.resident().RunTray(ctx, f.icon, BalloonAutorunOff) })
	f.icon.cmds <- CmdOpen
	time.Sleep(30 * time.Millisecond)
	cancel()
	wait(t, done)
	if len(f.icon.balloons) != 2 || f.icon.balloons[0] != BalloonAutorunOff || f.icon.balloons[1] != BalloonAutorunOff {
		t.Fatalf("--tray açılışında ve tepsiden açılışta zayıf izin balonu: %v", f.icon.balloons)
	}
}

type recUI struct {
	flow.UI
	active []string
}

func (r *recUI) Active(tech string, _ signal.Monitor) { r.active = append(r.active, tech) }

func TestAC253WithActiveForwards(t *testing.T) {
	inner := &recUI{}
	n := 0
	WithActive(inner, func() { n++ }).Active("Ayşe", signal.Monitor{})
	if len(inner.active) != 1 || n != 1 {
		t.Fatal("Active iletilmeli ve kanca çağrılmalı")
	}
	if WithActive(inner, nil) != flow.UI(inner) {
		t.Fatal("kanca yoksa sarmalanmamalı")
	}
}

func TestAC253MutexNameAndTexts(t *testing.T) {
	a, b := MutexName("S-1-5-21-1-2-3-1001"), MutexName("S-1-5-21-1-2-3-1002")
	if !strings.HasPrefix(a, `Local\NoktaDestek.Tray.`) || len(a) != len(`Local\NoktaDestek.Tray.`)+16 || a == b {
		t.Fatalf("mutex adı: %q %q", a, b)
	}
	if strings.Contains(a, "1001") {
		t.Fatal("ad SID'i açık taşımamalı (özet)")
	}
	for _, s := range []string{BalloonResident, BalloonAutorunOff, Tip, TipSession} {
		if len(truncate(s, 64)) == 0 || len([]rune(s)) > 63 {
			t.Fatalf("sabit metin sığmalı: %q", s)
		}
	}
	if got := truncate(strings.Repeat("ş", 200), 128); len(got) != 127 {
		t.Fatalf("kesme sonlandırıcıya yer bırakmalı: %d", len(got))
	}
	if got := truncate("a😀", 3); len(got) != 1 {
		t.Fatalf("vekil çifti bölünmemeli: %v", got)
	}
}

func TestAC253IconPixelsSquareTransparentPadding(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 40, 20)) // geniş, tümü opak kırmızı
	for y := 0; y < 20; y++ {
		for x := 0; x < 40; x++ {
			img.Set(x, y, color.NRGBA{R: 200, A: 255})
		}
	}
	px := IconPixels(img, 16)
	if len(px) != 16*16*4 {
		t.Fatalf("boy %d", len(px))
	}
	at := func(x, y int) []byte { o := (y*16 + x) * 4; return px[o : o+4] }
	if a := at(8, 0)[3]; a != 0 {
		t.Fatalf("üst kenar saydam olmalı (oran korunur): alfa %d", a)
	}
	if c := at(8, 8); c[2] != 200 || c[3] != 255 || c[0] != 0 {
		t.Fatalf("orta piksel BGRA: %v", c)
	}
	if IconPixels(nil, 16) == nil || IconPixels(img, 0) != nil {
		t.Fatal("nil resim saydam, 0 boy nil")
	}
}
