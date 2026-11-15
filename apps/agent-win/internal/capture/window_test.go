package capture

import (
	"testing"
	"time"
)

// AC-248: pencere kapandı (WINDOW_CLOSED) kaynak kaybı sayılmaz; yeniden açma denenmeden aynı nedenle hemen döner
// (FIRST_FRAME_TIMEOUT'a çevrilmez). Yeniden açma da kalıcı nedenle başarısızsa süre beklenmez.
func TestAC248AwaitFirstWindowClosedReturnsImmediately(t *testing.T) {
	clk := &fakeClock{t: time.Unix(0, 0)}
	closed := &Error{Reason: ReasonWindowClosed, Op: "IsWindow", Method: MethodWGC}
	g := &fakeGrabber{clk: clk, results: []fakeAcq{{err: closed}}}
	reopened := 0
	_, err := awaitFirst(g, func() (grabber, error) { reopened++; return g, nil }, noConvert,
		clk.now().Add(2*time.Second), clk.now, clk.pause)
	if e, ok := AsError(err); !ok || e.Reason != ReasonWindowClosed || reopened != 0 || g.closed != 1 {
		t.Fatalf("err=%v reopen=%d closed=%d", err, reopened, g.closed)
	}

	clk = &fakeClock{t: time.Unix(0, 0)}
	lost := &Error{Reason: ReasonOther, Op: "TryGetNextFrame", HR: 0x80004005}
	g = &fakeGrabber{clk: clk, results: []fakeAcq{{err: lost}}}
	_, err = awaitFirst(g, func() (grabber, error) { return nil, closed }, noConvert,
		clk.now().Add(2*time.Second), clk.now, clk.pause)
	if e, ok := AsError(err); !ok || e.Reason != ReasonWindowClosed || !clk.now().Before(time.Unix(1, 0)) {
		t.Fatalf("yeniden açmada kalıcı neden: %v (saat %v)", err, clk.now())
	}
}

// AC-248: pencere zinciri (yalnız WGC) — açma ve ilk kare hatalarında pencere nedeni ve WGC yolu korunur; DXGI
// HRESULT tablosu uygulanmaz.
func TestAC248SelectMethodWindowReasonsKept(t *testing.T) {
	cases := []struct {
		openErr, firstErr error
		want              Reason
	}{
		{openErr: &Error{Reason: ReasonWindowUnavailable, Op: "CreateForWindow", HR: 0x80070005, Method: MethodWGC}, want: ReasonWindowUnavailable},
		{openErr: &Error{Reason: ReasonOther, Op: "StartCapture", HR: 0x80070005}, want: ReasonOther}, // E_ACCESSDENIED DXGI_ACCESS_DENIED olmaz
		{openErr: errPlain("x"), want: ReasonOther},
		{firstErr: &Error{Reason: ReasonWindowClosed, Op: "IsWindow", Method: MethodWGC}, want: ReasonWindowClosed},
	}
	for _, c := range cases {
		chain := []methodOpener{{m: MethodWGC, open: func() (grabber, error) {
			if c.openErr != nil {
				return nil, c.openErr
			}
			return &fakeGrabber{clk: &fakeClock{}}, nil
		}}}
		_, _, tried, err := selectMethod(chain, func(methodOpener, grabber) (grabber, error) { return nil, c.firstErr })
		e, ok := AsError(err)
		if !ok || e.Reason != c.want || lastMethod(tried) != MethodWGC {
			t.Errorf("%v/%v: err=%v tried=%v", c.openErr, c.firstErr, err, tried)
			continue
		}
		if withMethod(e, lastMethod(tried)).ShareMethod() != "WGC" {
			t.Errorf("method WGC olmalı: %+v", e)
		}
	}
}

// AC-248/AC-234: yeni neden kodları sözleşme desenine uyar ve yol bilinmese de WGC'ye eşlenir.
func TestAC248WindowReasonsShareMethod(t *testing.T) {
	for _, r := range []Reason{ReasonWGCUnsupported, ReasonWindowClosed, ReasonWindowUnavailable} {
		if len(r) > 32 || (&Error{Reason: r}).ShareMethod() != "WGC" || !windowFinal(&Error{Reason: r}) {
			t.Errorf("%s", r)
		}
	}
	if windowFinal(&Error{Reason: ReasonDXGIUnsupported}) || windowFinal(nil) {
		t.Error("yalnız pencere nedenleri kalıcı")
	}
}

type errPlain string

func (e errPlain) Error() string { return string(e) }
