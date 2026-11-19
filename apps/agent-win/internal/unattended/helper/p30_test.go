package helper

import (
	"reflect"
	"testing"
	"time"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
)

// P30 (mimari-p30 §9): gözetimsiz yardımcıda işaretleme — durum yardımcı süreçte (liveIndicator), gösterge yalnız boyar.

func stroke(id string) dc.Ctl {
	return dc.Ctl{T: "annot.stroke", ID: id, Tool: "pen", Color: "blue", Pts: [][2]float64{{0.1, 0.1}, {0.5, 0.5}}}
}

func laserAt(x, y float64) dc.Ctl { return dc.Ctl{T: "annot.laser", X: &x, Y: &y} }

func newPaintInd(desk string) *deskIndicator {
	return &deskIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}, desk: desk}
}

func mustLast(t *testing.T, i *deskIndicator) annotSnap {
	t.Helper()
	s, ok := i.last()
	if !ok {
		t.Fatal("göstergeye çizim anlık görüntüsü verilmedi")
	}
	return s
}

// AC-494: çizim/lazer/geri al/temizle anlık görüntüye yansır; yüzey paylaşılan monitördür.
func TestAC494LiveAnnotSnapshot(t *testing.T) {
	ind := newPaintInd("Default")
	l := newLive(ind, "X", false)
	l.SetSurface(2)
	l.Annot(stroke("a"))
	l.Annot(stroke("b"))
	l.Annot(laserAt(0.5, 0.25))
	s := mustLast(t, ind)
	if len(s.Strokes) != 2 || s.Surface != 2 || s.Laser == nil || s.Laser[0] != 0.5 || time.Since(s.LaserAt) > time.Second {
		t.Fatalf("anlık görüntü %+v", s)
	}
	l.Annot(dc.Ctl{T: "annot.undo", ID: "b"})
	if s := mustLast(t, ind); len(s.Strokes) != 1 || s.Strokes[0].ID != "a" {
		t.Fatalf("geri al %+v", s.Strokes)
	}
	l.Annot(dc.Ctl{T: "annot.clear"})
	if s := mustLast(t, ind); len(s.Strokes) != 0 || s.Laser != nil {
		t.Fatalf("temizle %+v", s)
	}
	for range annot.MaxStrokes + 5 {
		l.Annot(stroke("x"))
	}
	if s := mustLast(t, ind); len(s.Strokes) != annot.MaxStrokes {
		t.Fatalf("sınır %d", len(s.Strokes))
	}
	select {
	case <-l.Failed():
		t.Fatal("çizim göstergeyi başarısız saydı")
	default:
	}
}

// AC-494: anlık görüntü kopyadır (sonraki ileti verilen görüntüyü değiştirmez); süresi dolmuş lazer yeniden gönderilmez.
func TestAC494SnapshotIsCopyAndStaleLaserDropped(t *testing.T) {
	ind := newPaintInd("Default")
	l := newLive(ind, "X", false)
	l.Annot(stroke("a"))
	first := mustLast(t, ind)
	l.Annot(dc.Ctl{T: "annot.undo"})
	l.Annot(stroke("b"))
	if first.Strokes[0].ID != "a" {
		t.Fatal("verilen anlık görüntü sonradan değişti")
	}
	l.Annot(laserAt(0.2, 0.2))
	l.mu.Lock()
	l.ann.laserAt = time.Now().Add(-2 * laserTTL)
	l.mu.Unlock()
	l.Annot(stroke("c"))
	if s := mustLast(t, ind); s.Laser != nil {
		t.Fatal("sönmüş lazer yeniden gönderildi")
	}
}

// AC-497: masaüstü değişiminde yeni göstergeye aynı çizim listesi ve yüzey verilir; lazer düşer.
func TestAC497RebindRepaintsStrokesDropsLaser(t *testing.T) {
	first := newPaintInd("Default")
	l := newLive(first, "X", false)
	l.SetSurface(1)
	l.Annot(stroke("a"))
	l.Annot(stroke("b"))
	l.Annot(laserAt(0.3, 0.3))
	want := mustLast(t, first).Strokes
	second := newPaintInd("Winlogon")
	desk, err := l.rebind(func(string) (Indicator, error) { return second, nil })
	if err != nil || desk != "Winlogon" {
		t.Fatalf("rebind %q %v", desk, err)
	}
	s := mustLast(t, second)
	if !reflect.DeepEqual(s.Strokes, want) || s.Surface != 1 || s.Laser != nil {
		t.Fatalf("yeni gösterge %+v", s)
	}
	until(t, first.closed.Load)
	l.Annot(stroke("c")) // sonraki iletiler yeni göstergeye
	if s := mustLast(t, second); len(s.Strokes) != 3 {
		t.Fatalf("geçiş sonrası %d çizim", len(s.Strokes))
	}
}

// AC-497 (K-P30-4): monitör değişiminde yüzey güncellenir, çizimler korunur; aynı monitör yeniden boyatmaz.
func TestAC497SetSurfaceKeepsStrokes(t *testing.T) {
	ind := newPaintInd("Default")
	l := newLive(ind, "X", false)
	l.SetSurface(1)
	l.Annot(stroke("a"))
	l.SetSurface(2)
	s := mustLast(t, ind)
	if s.Surface != 2 || len(s.Strokes) != 1 {
		t.Fatalf("%+v", s)
	}
	n := len(ind.snaps)
	l.SetSurface(2)
	if len(ind.snaps) != n {
		t.Fatal("aynı yüzey yeniden boyatıldı")
	}
}

// Kapanmış göstergeye ve boyayamayan göstergeye çizim gitmez; panik yok.
func TestP30AnnotAfterCloseAndNonPainter(t *testing.T) {
	ind := newPaintInd("Default")
	l := newLive(ind, "X", false)
	l.Close()
	l.Annot(stroke("a"))
	l.SetSurface(1)
	if _, ok := ind.last(); ok {
		t.Fatal("kapanmış göstergeye çizim")
	}
	plain := newLive(&fakeIndicator{failed: make(chan struct{})}, "X", false)
	plain.Annot(stroke("a"))
	plain.SetSurface(1)
}

type fakeSink struct {
	ctl     []string
	surface []int
}

func (f *fakeSink) Annot(m dc.Ctl)    { f.ctl = append(f.ctl, m.T) }
func (f *fakeSink) SetSurface(id int) { f.surface = append(f.surface, id) }

// AC-494/497: headless işaretlemeyi ve paylaşılan monitörü göstergeye iletir; gösterge yoksa no-op.
func TestAC494HeadlessForwardsAnnotAndSurface(t *testing.T) {
	f := &fakeSink{}
	h := &headless{draw: f}
	h.Active("Ali", signal.Monitor{ID: 2})
	h.MonitorChanged(signal.Monitor{ID: 1})
	h.Annot(stroke("a"))
	if !reflect.DeepEqual(f.surface, []int{2, 1}) || !reflect.DeepEqual(f.ctl, []string{"annot.stroke"}) {
		t.Fatalf("%+v", f)
	}
	empty := &headless{}
	empty.Annot(stroke("a"))
	empty.Active("", signal.Monitor{ID: 1})
}

// AC-496 (K-P30-3): katman kırpma dikdörtgenleri = gösterge yerleşimi (layout), katmanın yerel koordinatında.
func TestAC496ExcludeRectsMatchIndicatorLayout(t *testing.T) {
	const b, lh = 5, 32 // Windows göstergesinin kenar kalınlığı ve etiket yüksekliği
	m := rect{1920, -200, 3840, 880}
	bars, lbl := layout(m, b, 600, lh)
	got := annotExclude(m, b, 600, lh)
	if len(got) != 5 {
		t.Fatalf("%d dikdörtgen", len(got))
	}
	for i, r := range append(bars[:], lbl) {
		w := rect{r.Left - m.Left, r.Top - m.Top, r.Right - m.Left, r.Bottom - m.Top}
		if got[i] != w {
			t.Fatalf("%d: %+v, beklenen %+v", i, got[i], w)
		}
	}
	if got[0] != (rect{0, 0, 1920, b}) || got[4] != (rect{660, 0, 1260, lh}) {
		t.Fatalf("yerel koordinat %+v", got)
	}
}

// AC-496 (K-P30-3): en üste alma turunda önce katman, sonra gösterge pencereleri; katman yoksa yalnız gösterge.
func TestAC496RaiseOrderLayerFirst(t *testing.T) {
	if got := raiseOrder(9, []uintptr{1, 2}); !reflect.DeepEqual(got, []uintptr{9, 1, 2}) {
		t.Fatalf("%v", got)
	}
	if got := raiseOrder(0, []uintptr{1}); !reflect.DeepEqual(got, []uintptr{1}) {
		t.Fatalf("%v", got)
	}
}

// AC-494/497 uçtan uca: kontrol sahibinin DC çizimi yardımcı göstergesine paylaşılan monitörle ulaşır; masaüstü
// değişiminde yeni göstergeye aynı liste verilir.
func TestAC497RunAnnotSurvivesDesktopChange(t *testing.T) {
	r := newDeskRig(0, time.Second)
	r.d.Flow.Monitors = func() ([]signal.Monitor, error) {
		return []signal.Monitor{{ID: 1, Primary: true, W: 1920, H: 1080}}, nil
	}
	done, h := r.startStreaming(t)
	first := <-r.inds
	h.Ctl(stroke("a"))
	until(t, func() bool { s, ok := first.last(); return ok && len(s.Strokes) == 1 && s.Surface == 1 })
	r.desk.set("Winlogon")
	second := <-r.inds
	until(t, func() bool { s, ok := second.last(); return ok && len(s.Strokes) == 1 && s.Surface == 1 })
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	waitExit(t, done)
}

// P30 güvenlik turu (DÜŞÜK): kontrol başka teknisyene geçince önceki sahibin çizimleri silinir; aynı sahipte ve ilk
// roster'da silinmez.
func TestAC498ControllerChangeClearsStrokes(t *testing.T) {
	ctrl := flow.MultiTexts.RoleControl
	view := func(c string) flow.RosterView {
		v := flow.RosterView{}
		for _, tid := range []string{"A", "B"} {
			role := flow.MultiTexts.RoleMember
			if tid == c {
				role = ctrl
			}
			v.Techs = append(v.Techs, flow.RosterTech{TID: tid, Name: "T" + tid, Role: role})
		}
		return v
	}
	f := &fakeSink{}
	h := &headless{draw: f, live: &fakeLive{ok: true}, techName: "TA"}
	h.ShowRoster(view("A"))
	h.ShowRoster(view("A"))
	if len(f.ctl) != 0 {
		t.Fatalf("sahip değişmeden silindi: %v", f.ctl)
	}
	h.ShowRoster(view("B"))
	if !reflect.DeepEqual(f.ctl, []string{"annot.clear"}) {
		t.Fatalf("devirde silinmedi: %v", f.ctl)
	}
}

// P30 güvenlik turu (YÜKSEK): gözcü — doğrulama turu limit'ten eskiyse fail; güncel tur ya da stop'ta fail yok.
func TestAC342P30WatchdogFailsOnStaleTick(t *testing.T) {
	failed := make(chan struct{})
	stale := time.Now().Add(-time.Hour)
	go watchdog(make(chan struct{}), func() time.Time { return stale }, 50*time.Millisecond, 5*time.Millisecond,
		func() { close(failed) })
	select {
	case <-failed:
	case <-time.After(time.Second):
		t.Fatal("eski turda gözcü fail çağırmadı")
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	var calls int
	go func() {
		watchdog(stop, time.Now, 50*time.Millisecond, 5*time.Millisecond, func() { calls++ })
		close(done)
	}()
	time.Sleep(100 * time.Millisecond)
	close(stop)
	<-done
	if calls != 0 {
		t.Fatal("güncel turda fail çağrıldı")
	}
}
