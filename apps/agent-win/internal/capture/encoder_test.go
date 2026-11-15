package capture

import (
	"errors"
	"testing"
	"time"
)

// fakeEncoder hata enjeksiyonlu sahte kodlayıcı: failAt. çağrıda hata, silentFrom. çağrıdan sonra boş çıktı verir
// (0 → kapalı). Her çağrıyı kaydeder.
type fakeEncoder struct {
	name       string
	failAt     int
	silentFrom int
	calls      int
	keys       []bool
	frames     []*NV12
	bitrate    int
	closed     int
}

func (f *fakeEncoder) Encode(fr *NV12, _ time.Duration, key bool) ([]byte, bool, error) {
	f.calls++
	f.keys = append(f.keys, key)
	f.frames = append(f.frames, fr)
	if f.failAt > 0 && f.calls >= f.failAt {
		return nil, false, &Error{Reason: ReasonOther, Op: "ProcessInput", HR: 0x887A0005}
	}
	if f.silentFrom > 0 && f.calls >= f.silentFrom {
		return nil, false, nil
	}
	return []byte{0, 0, 0, 1, 0x41, byte(f.calls)}, key, nil
}

func (f *fakeEncoder) SetBitrate(bps int) { f.bitrate = bps }
func (f *fakeEncoder) Close()             { f.closed++ }

// encoderRig selectEncoder'ı sahte açıcıyla kurar; kaç kez hangi kodlayıcının açıldığını sayar.
type encoderRig struct {
	hw, sw           *fakeEncoder
	hwErr, swErr     error
	hwOpens, swOpens int
	switches         []Fallback
	clock            fakeClock
}

func (r *encoderRig) open(hw bool) (Encoder, error) {
	if hw {
		r.hwOpens++
		if r.hwErr != nil {
			return nil, r.hwErr
		}
		return r.hw, nil
	}
	r.swOpens++
	if r.swErr != nil {
		return nil, r.swErr
	}
	return r.sw, nil
}

func (r *encoderRig) selectEnc(t *testing.T, allowHW bool) encoderChoice {
	t.Helper()
	ch, err := selectEncoder(r.open, allowHW, r.clock.now, func(fb Fallback) { r.switches = append(r.switches, fb) })
	if err != nil {
		t.Fatal(err)
	}
	return ch
}

func newRig() *encoderRig {
	return &encoderRig{hw: &fakeEncoder{name: "hw"}, sw: &fakeEncoder{name: "sw"}, clock: fakeClock{t: time.Unix(1000, 0)}}
}

const frameGap = time.Second / 30

func TestAC245HardwareErrorSwitchesToSoftwareWithIDR(t *testing.T) {
	r := newRig()
	r.hw.failAt = 5
	ch := r.selectEnc(t, true)
	if !ch.hw || r.hwOpens != 1 || r.swOpens != 0 {
		t.Fatalf("donanım önce denenmeli: hw=%v hwOpens=%d swOpens=%d", ch.hw, r.hwOpens, r.swOpens)
	}
	ch.enc.SetBitrate(1_500_000) // ratectl'in düşürdüğü hedef yazılıma taşınmalı
	f := NewNV12(4, 2)
	for i := 1; i <= 4; i++ {
		if au, _, err := ch.enc.Encode(f, frameGap, i == 1); err != nil || len(au) == 0 {
			t.Fatalf("kare %d: %v", i, err)
		}
		r.clock.advance(frameGap)
	}
	au, key, err := ch.enc.Encode(f, frameGap, false) // 5. kare: donanım hatası
	if err != nil || len(au) == 0 || !key {
		t.Fatalf("geçiş karesi: err=%v len=%d key=%v (akış kesilmemeli, IDR olmalı)", err, len(au), key)
	}
	if r.swOpens != 1 || r.hw.closed != 1 {
		t.Fatalf("yazılım bir kez açılmalı, donanım kapanmalı: swOpens=%d hwClosed=%d", r.swOpens, r.hw.closed)
	}
	if len(r.sw.keys) != 1 || !r.sw.keys[0] || r.sw.frames[0] != f {
		t.Fatalf("yazılımda aynı kare zorunlu IDR ile kodlanmalı: %v", r.sw.keys)
	}
	if r.sw.bitrate != 1_500_000 {
		t.Fatalf("bit hızı taşınmadı: %d", r.sw.bitrate)
	}
	if len(r.switches) != 1 || r.switches[0].Reason != ReasonEncodeFailed || r.switches[0].Op != "ProcessInput" || r.switches[0].HR != 0x887A0005 {
		t.Fatalf("geçiş nedeni: %+v", r.switches)
	}
	for i := 0; i < 10; i++ { // tek yönlü: sonraki kareler yazılımda, donanıma dönüş yok
		if _, _, err := ch.enc.Encode(f, frameGap, false); err != nil {
			t.Fatal(err)
		}
	}
	if r.hw.calls != 5 || r.sw.calls != 11 || r.hwOpens != 1 || len(r.switches) != 1 {
		t.Fatalf("hw=%d sw=%d hwOpens=%d switches=%d", r.hw.calls, r.sw.calls, r.hwOpens, len(r.switches))
	}
	ch.enc.Close()
	if r.sw.closed != 1 || r.hw.closed != 1 {
		t.Fatalf("Close yazılımı kapatmalı: sw=%d hw=%d", r.sw.closed, r.hw.closed)
	}
}

// Donanım hata vermeden susar: ≥ 3 sn çıktı yoksa yazılıma geçilir; görüntü son donanım karesinden ≤ 5 sn sonra gelir.
func TestAC245HardwareSilenceSwitchesWithinFiveSeconds(t *testing.T) {
	r := newRig()
	r.hw.silentFrom = 31 // ilk 1 sn kare var, sonra sessizlik
	ch := r.selectEnc(t, true)
	f := NewNV12(4, 2)
	var lastHW, firstSW time.Time
	for i := 0; i < 30*10 && firstSW.IsZero(); i++ {
		au, key, err := ch.enc.Encode(f, frameGap, i == 0)
		if err != nil {
			t.Fatalf("kare %d: %v", i, err)
		}
		switch {
		case len(au) > 0 && r.sw.calls == 0:
			lastHW = r.clock.now()
		case len(au) > 0:
			if !key {
				t.Fatal("geçiş karesi IDR değil")
			}
			firstSW = r.clock.now()
		}
		r.clock.advance(frameGap)
	}
	if firstSW.IsZero() {
		t.Fatal("yazılıma geçilmedi")
	}
	if gap := firstSW.Sub(lastHW); gap < encoderStall || gap > 5*time.Second {
		t.Fatalf("görüntü boşluğu %v; beklenen [3 sn, 5 sn]", gap)
	}
	if len(r.switches) != 1 || r.switches[0].Reason != ReasonEncodeFailed || r.switches[0].Op != "EncoderStall" {
		t.Fatalf("geçiş nedeni: %+v", r.switches)
	}
}

// Ara sıra boş çıktı (kodlayıcı gecikmesi) 3 sn'yi doldurmadıkça geçişe yol açmaz.
func TestAC245ShortEncoderLatencyDoesNotSwitch(t *testing.T) {
	r := newRig()
	r.hw.silentFrom = 2
	ch := r.selectEnc(t, true)
	f := NewNV12(4, 2)
	for i := 0; i < 80; i++ { // 2.6 sn sessizlik
		if _, _, err := ch.enc.Encode(f, frameGap, false); err != nil {
			t.Fatal(err)
		}
		r.clock.advance(frameGap)
	}
	if r.swOpens != 0 || len(r.switches) != 0 {
		t.Fatalf("erken geçiş: swOpens=%d", r.swOpens)
	}
}

func TestAC245SoftwareUnavailableKeepsHardwareError(t *testing.T) {
	r := newRig()
	r.hw.failAt = 2
	r.swErr = &Error{Reason: ReasonNoH264Encoder, Op: "CoCreateInstance(H264 Encoder MFT)"}
	ch := r.selectEnc(t, true)
	f := NewNV12(4, 2)
	if _, _, err := ch.enc.Encode(f, frameGap, true); err != nil {
		t.Fatal(err)
	}
	_, _, err := ch.enc.Encode(f, frameGap, false)
	e, ok := AsError(err)
	if !ok || e.Op != "ProcessInput" {
		t.Fatalf("donanım hatası dönmeli: %v", err)
	}
	if len(r.switches) != 0 || r.hw.closed != 0 {
		t.Fatalf("geçiş yapılmamalı: %+v closed=%d", r.switches, r.hw.closed)
	}

	// Sessizlikte yazılım yoksa tipli ENCODE_FAILED döner (yayın hatası yolu).
	r2 := newRig()
	r2.hw.silentFrom = 1
	r2.swErr = r.swErr
	ch2 := r2.selectEnc(t, true)
	var last error
	for i := 0; i < 30*4 && last == nil; i++ {
		_, _, last = ch2.enc.Encode(f, frameGap, false)
		r2.clock.advance(frameGap)
	}
	if e, ok := AsError(last); !ok || e.Reason != ReasonEncodeFailed || e.Op != "EncoderStall" {
		t.Fatalf("sessizlik hatası: %v", last)
	}
}

func TestAC245SelectEncoderOrder(t *testing.T) {
	// Donanım kurulamaz → yazılım, neden tanılamada.
	r := newRig()
	r.hwErr = &Error{Reason: ReasonEncoderConfig, Op: "SetInputType"}
	ch := r.selectEnc(t, true)
	if ch.hw || ch.hwReason != ReasonEncoderConfig || ch.enc != Encoder(r.sw) {
		t.Fatalf("yazılıma düşülmeli: %+v", ch)
	}
	// Oturumda yazılıma düşülmüşse (yeniden boyutlandırma) donanım hiç denenmez.
	r = newRig()
	ch = r.selectEnc(t, false)
	if r.hwOpens != 0 || ch.hw || ch.enc != Encoder(r.sw) {
		t.Fatalf("tek yönlü geçiş: hwOpens=%d", r.hwOpens)
	}
	// İkisi de yok → yazılımın tipli hatası.
	r = newRig()
	r.hwErr = errors.New("x")
	r.swErr = &Error{Reason: ReasonNoH264Encoder, Op: "MFTEnumEx"}
	if _, err := selectEncoder(r.open, true, r.clock.now, nil); err != r.swErr {
		t.Fatalf("hata: %v", err)
	}
}

// AC-234 (I1 isteği): share.state.method son denenen/yayındaki yolu taşır, nedenden çıkarılmaz.
func TestAC234MethodIsLastTriedPath(t *testing.T) {
	tried := []attempt{
		{m: MethodDXGI, err: &Error{Reason: ReasonDXGIUnsupported}},
		{m: MethodDXGI1, err: &Error{Reason: ReasonDXGIUnsupported}},
		{m: MethodGDI, err: &Error{Reason: ReasonGDI}},
	}
	e := withMethod(tried[0].err, lastMethod(tried)) // selectMethod ilk denemenin hatasını döner
	if e.Method != MethodGDI || e.ShareMethod() != "GDI" || e.Reason != ReasonDXGIUnsupported {
		t.Fatalf("method=%s share=%s", e.Method, e.ShareMethod())
	}
	if lastMethod(nil) != "" {
		t.Fatal("deneme yokken yol boş olmalı")
	}
	// Yol bilinmiyorsa dokunulmaz (nedenden çıkarım sürer).
	e = withMethod(&Error{Reason: ReasonD3DDevice}, "")
	if e.Method != "" || e.ShareMethod() != "DXGI" {
		t.Fatalf("boş yol: %+v", e)
	}
	// Yayında kodlayıcı hatası (ENCODE_FAILED) yayındaki yakalama yolunu taşır; DXGI1 → DXGI.
	e = withMethod(tag(errors.New("x"), stageEncode, "Encode"), MethodDXGI1)
	if e.Reason != ReasonEncodeFailed || e.ShareMethod() != "DXGI" {
		t.Fatalf("yayın hatası: %+v %s", e, e.ShareMethod())
	}
	if withMethod(nil, MethodGDI) != nil {
		t.Fatal("nil korunmalı")
	}
}
