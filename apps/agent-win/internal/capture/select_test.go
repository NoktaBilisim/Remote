package capture

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

// 0.10.2: neden sınıflandırma tablosu (adım + HRESULT → kod).
func TestClassifyReasonTable(t *testing.T) {
	cases := []struct {
		st   stage
		hr   uint32
		want Reason
	}{
		{stageDuplicate, 0x887A0004, ReasonDXGIUnsupported},  // DXGI_ERROR_UNSUPPORTED (hibrit GPU, HDR)
		{stageDuplicate, 0x80004002, ReasonDXGIUnsupported},  // E_NOINTERFACE (IDXGIOutput1/5 yok)
		{stageDuplicate, 0x80070005, ReasonDXGIAccessDenied}, // E_ACCESSDENIED (güvenli masaüstü)
		{stageDuplicate, 0x887A0022, ReasonDXGINotAvailable}, // NOT_CURRENTLY_AVAILABLE
		{stageDuplicate, 0x887A0028, ReasonDXGINotAvailable}, // SESSION_DISCONNECTED
		{stageDuplicate, 0x80004005, ReasonOther},
		{stageDevice, 0x887A0004, ReasonD3DDevice},
		{stageDevice, 0x80070005, ReasonDXGIAccessDenied},
		{stageOutput, 0, ReasonNoOutput},
		{stageFirstFrame, 0x887A0026, ReasonFirstFrameTimeout},
		{stageGDI, 0, ReasonGDI},
		{stageMF, 0x80070002, ReasonMFStartup},
		{stageMF, 0, ReasonMFStartup},
		{stageEncoderCreate, 0x80040154, ReasonNoH264Encoder}, // REGDB_E_CLASSNOTREG (Windows N)
		{stageEncoderConfig, 0xC00D36B4, ReasonEncoderConfig},
		{stageEncode, 0, ReasonEncodeFailed},
		{stageCOM, 0x80010106, ReasonOther},
	}
	for _, c := range cases {
		if got := classify(c.st, c.hr); got != c.want {
			t.Errorf("classify(%d, 0x%08X) = %s, beklenen %s", c.st, c.hr, got, c.want)
		}
	}
}

func TestTagKeepsOpAndHRAndHidesForeignText(t *testing.T) {
	e := tag(&Error{Reason: ReasonOther, Op: "DuplicateOutput", HR: 0x887A0004}, stageDuplicate, "x")
	if e.Reason != ReasonDXGIUnsupported || e.Op != "DuplicateOutput" || e.HR != 0x887A0004 {
		t.Fatalf("%+v", e)
	}
	if e.Code() != "DXGI_UNSUPPORTED" {
		t.Fatal(e.Code())
	}
	f := tag(errors.New(`Failed to load C:\Users\ahmet\mfplat.dll`), stageMF, "MFStartup")
	if f.Reason != ReasonMFStartup || f.Op != "MFStartup" || f.HR != 0 {
		t.Fatalf("%+v", f)
	}
	if s := f.Error(); s != "capture: MFStartup: MF_STARTUP" {
		t.Fatalf("yabancı hata metni sızmamalı: %q", s)
	}
	o := &Error{Reason: ReasonOther, Op: "CoInitializeEx", HR: 0x80004005}
	if o.Code() != "OTHER 0x80004005" {
		t.Fatal(o.Code())
	}
	if tag(nil, stageMF, "x") != nil {
		t.Fatal("nil hata nil kalmalı")
	}
	wrapped := fmt.Errorf("rtc: %w", &Error{Reason: ReasonEncodeFailed, Op: "Encode"})
	if g, ok := AsError(wrapped); !ok || g.Reason != ReasonEncodeFailed {
		t.Fatal("sarılmış hata çıkarılmalı")
	}
}

// fakeGrabber sırayla verilen acquire sonuçlarını döndürür; her çağrıda sahte saati ilerletir.
type fakeGrabber struct {
	results []fakeAcq
	clk     *fakeClock
	closed  int
}

type fakeAcq struct {
	ok  bool
	err error
}

func (g *fakeGrabber) acquire(_ uint32, fn func([]byte, int, int, int) error) (bool, error) {
	g.clk.advance(100 * time.Millisecond)
	if len(g.results) == 0 {
		return false, nil
	}
	r := g.results[0]
	g.results = g.results[1:]
	if r.ok {
		px := make([]byte, 4*4*4)
		if err := fn(px, 4, 4, 16); err != nil {
			return false, err
		}
	}
	return r.ok, r.err
}

func (g *fakeGrabber) rotation() Rotation { return RotNone }
func (g *fakeGrabber) cursor() *Cursor    { return nil }
func (g *fakeGrabber) close()             { g.closed++ }

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func (c *fakeClock) pause(d time.Duration)   { c.advance(d) }
func noConvert(grabber) func([]byte, int, int, int) error {
	return func([]byte, int, int, int) error { return nil }
}

func TestAwaitFirstReturnsOnFirstFrame(t *testing.T) {
	clk := &fakeClock{t: time.Unix(0, 0)}
	g := &fakeGrabber{clk: clk, results: []fakeAcq{{}, {}, {ok: true}}}
	got, err := awaitFirst(g, nil, noConvert, clk.now().Add(2*time.Second), clk.now, clk.pause)
	if err != nil || got != g || g.closed != 0 {
		t.Fatalf("got=%v err=%v closed=%d", got, err, g.closed)
	}
}

// Çoğaltma tekrar tekrar kaybolup ilk kare gelmezse: her kayıpta kapatılıp yeniden açılır, süre dolunca son hatanın
// HRESULT'u ile FIRST_FRAME_TIMEOUT döner (seçici GDI'ya geçer).
func TestAwaitFirstRepeatedLossTimesOut(t *testing.T) {
	clk := &fakeClock{t: time.Unix(0, 0)}
	lost := &Error{Reason: ReasonOther, Op: "AcquireNextFrame", HR: 0x887A0026}
	var opened []*fakeGrabber
	mk := func() *fakeGrabber {
		g := &fakeGrabber{clk: clk, results: []fakeAcq{{err: lost}}}
		opened = append(opened, g)
		return g
	}
	first := mk()
	_, err := awaitFirst(first, func() (grabber, error) { return mk(), nil }, noConvert,
		clk.now().Add(2*time.Second), clk.now, clk.pause)
	e, ok := AsError(err)
	if !ok || e.Reason != ReasonFirstFrameTimeout || e.HR != 0x887A0026 || e.Op != "AcquireNextFrame" {
		t.Fatalf("%v", err)
	}
	if len(opened) < 3 {
		t.Fatalf("yeniden açma denenmeli: %d", len(opened))
	}
	for i, g := range opened {
		if g.closed != 1 {
			t.Fatalf("kaynak %d kapatılmalı (closed=%d)", i, g.closed)
		}
	}
}

// QA#3: BGRA dışı yüzey (copyFrame → DXGI_UNSUPPORTED/SurfaceFormat) kaynak kaybı sayılmaz; yeniden açılmadan hemen
// aynı nedenle döner.
func TestAwaitFirstNonBGRASurfaceReturnsUnsupported(t *testing.T) {
	clk := &fakeClock{t: time.Unix(0, 0)}
	g := &fakeGrabber{clk: clk, results: []fakeAcq{{err: &Error{Reason: ReasonDXGIUnsupported, Op: "SurfaceFormat"}}}}
	reopened := 0
	_, err := awaitFirst(g, func() (grabber, error) { reopened++; return g, nil }, noConvert,
		clk.now().Add(2*time.Second), clk.now, clk.pause)
	e, ok := AsError(err)
	if !ok || e.Reason != ReasonDXGIUnsupported || e.Op != "SurfaceFormat" {
		t.Fatalf("%v", err)
	}
	if reopened != 0 || g.closed != 1 || clk.now().After(time.Unix(0, 0).Add(time.Second)) {
		t.Fatalf("hemen dönmeli: reopen=%d closed=%d", reopened, g.closed)
	}
}

func TestAwaitFirstNoFrameTimesOutAndCloses(t *testing.T) {
	clk := &fakeClock{t: time.Unix(0, 0)}
	g := &fakeGrabber{clk: clk}
	_, err := awaitFirst(g, nil, noConvert, clk.now().Add(time.Second), clk.now, clk.pause)
	if e, ok := AsError(err); !ok || e.Reason != ReasonFirstFrameTimeout || e.HR != 0 {
		t.Fatalf("%v", err)
	}
	if g.closed != 1 {
		t.Fatal("süre dolunca kaynak kapatılmalı")
	}
}

// chainOf her yöntem için açma sonucu (hata veya ilk kare verip vermeyeceği) ile zincir kurar ve açılanları sayar.
type step struct {
	openErr  error
	frame    bool
	firstErr error // ilk kare beklenirken dönen hata (boşsa FIRST_FRAME_TIMEOUT)
}

func chainOf(steps map[Method]step, opened *[]Method) []methodOpener {
	var out []methodOpener
	for _, m := range []Method{MethodDXGI, MethodDXGI1, MethodGDI} {
		s := steps[m]
		out = append(out, methodOpener{m: m, open: func() (grabber, error) {
			*opened = append(*opened, m)
			if s.openErr != nil {
				return nil, s.openErr
			}
			return &fakeGrabber{clk: &fakeClock{}}, nil
		}})
	}
	return out
}

func firstBy(steps map[Method]step) func(methodOpener, grabber) (grabber, error) {
	return func(c methodOpener, g grabber) (grabber, error) {
		if steps[c.m].frame {
			return g, nil
		}
		g.close()
		if e := steps[c.m].firstErr; e != nil {
			return nil, e
		}
		return nil, &Error{Reason: ReasonFirstFrameTimeout, Op: "FirstFrame"}
	}
}

func methods(a []attempt) []string {
	var out []string
	for _, x := range a {
		r := "OK"
		if x.err != nil {
			r = string(x.err.Reason)
		}
		out = append(out, string(x.m)+"="+r)
	}
	return out
}

// Yöntem seçimi: DXGI → (DXGI açılamadıysa) DXGI1 → GDI.
func TestSelectMethodChain(t *testing.T) {
	unsupported := &Error{Reason: ReasonOther, Op: "DuplicateOutput", HR: 0x887A0004}
	cases := []struct {
		name   string
		steps  map[Method]step
		want   Method
		opened string
		tried  string
		err    Reason
	}{
		{"normal masaüstü: DXGI", map[Method]step{MethodDXGI: {frame: true}, MethodDXGI1: {frame: true}, MethodGDI: {frame: true}},
			MethodDXGI, "[DXGI]", "[DXGI=OK]", ""},
		{"HDR: DXGI UNSUPPORTED → DXGI1", map[Method]step{MethodDXGI: {openErr: unsupported}, MethodDXGI1: {frame: true}, MethodGDI: {frame: true}},
			MethodDXGI1, "[DXGI DXGI1]", "[DXGI=DXGI_UNSUPPORTED DXGI1=OK]", ""},
		{"hibrit GPU: DXGI ve DXGI1 açılmaz → GDI", map[Method]step{MethodDXGI: {openErr: unsupported},
			MethodDXGI1: {openErr: &Error{Reason: ReasonOther, Op: "QueryInterface", HR: 0x80004002}}, MethodGDI: {frame: true}},
			MethodGDI, "[DXGI DXGI1 GDI]", "[DXGI=DXGI_UNSUPPORTED DXGI1=DXGI_UNSUPPORTED GDI=OK]", ""},
		{"DXGI açıldı ama kare yok → DXGI1 atlanır, GDI", map[Method]step{MethodDXGI: {}, MethodDXGI1: {frame: true}, MethodGDI: {frame: true}},
			MethodGDI, "[DXGI GDI]", "[DXGI=FIRST_FRAME_TIMEOUT GDI=OK]", ""},
		{"DXGI açıldı ama yüzey BGRA dışı → DXGI1", map[Method]step{
			MethodDXGI:  {firstErr: &Error{Reason: ReasonDXGIUnsupported, Op: "SurfaceFormat"}},
			MethodDXGI1: {frame: true}, MethodGDI: {frame: true}},
			MethodDXGI1, "[DXGI DXGI1]", "[DXGI=DXGI_UNSUPPORTED DXGI1=OK]", ""},
		{"BGRA dışı yüzey DXGI1'de de → GDI", map[Method]step{
			MethodDXGI:  {firstErr: &Error{Reason: ReasonDXGIUnsupported, Op: "SurfaceFormat"}},
			MethodDXGI1: {firstErr: &Error{Reason: ReasonDXGIUnsupported, Op: "SurfaceFormat"}}, MethodGDI: {frame: true}},
			MethodGDI, "[DXGI DXGI1 GDI]", "[DXGI=DXGI_UNSUPPORTED DXGI1=DXGI_UNSUPPORTED GDI=OK]", ""},
		{"hepsi başarısız → ilk hata", map[Method]step{MethodDXGI: {openErr: unsupported}, MethodDXGI1: {openErr: unsupported},
			MethodGDI: {openErr: errors.New("gdi")}},
			"", "[DXGI DXGI1 GDI]", "[DXGI=DXGI_UNSUPPORTED DXGI1=DXGI_UNSUPPORTED GDI=GDI_FAILED]", ReasonDXGIUnsupported},
		{"monitör DXGI'da yok → GDI", map[Method]step{MethodDXGI: {openErr: &Error{Reason: ReasonNoOutput, Op: "FindOutput"}},
			MethodDXGI1: {openErr: &Error{Reason: ReasonNoOutput, Op: "FindOutput"}}, MethodGDI: {frame: true}},
			MethodGDI, "[DXGI DXGI1 GDI]", "[DXGI=NO_OUTPUT DXGI1=NO_OUTPUT GDI=OK]", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var opened []Method
			chain := chainOf(c.steps, &opened)
			g, i, tried, err := selectMethod(chain, firstBy(c.steps))
			if got := fmt.Sprint(opened); got != c.opened {
				t.Errorf("açılanlar %s, beklenen %s", got, c.opened)
			}
			if got := fmt.Sprint(methods(tried)); got != c.tried {
				t.Errorf("denemeler %s, beklenen %s", got, c.tried)
			}
			if c.err != "" {
				e, ok := AsError(err)
				if !ok || e.Reason != c.err || g != nil || i != -1 {
					t.Fatalf("hata %v, beklenen %s", err, c.err)
				}
				return
			}
			if err != nil || g == nil || chain[i].m != c.want {
				t.Fatalf("seçilen %v (err %v), beklenen %s", i, err, c.want)
			}
		})
	}
}

func TestGDIRateCapped(t *testing.T) {
	r := newRateCtlCap(gdiFPS)
	if r.FPS() != gdiFPS || r.Interval() != 100*time.Millisecond {
		t.Fatal(r.FPS())
	}
	for i := 0; i < 200; i++ {
		r.Observe(time.Millisecond) // ucuz kareler hızı üst sınırın üstüne çıkarmamalı
	}
	if r.FPS() != gdiFPS {
		t.Fatalf("GDI hızı %d", r.FPS())
	}
	for i := 0; i < 200; i++ {
		r.Observe(time.Second)
	}
	if r.FPS() != gdiFPS {
		t.Fatalf("GDI hızı alt sınırı %d", r.FPS())
	}
}
