package helper

import (
	"bufio"
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// P28e K6 yardımcı birim testleri (mimari-p28e r2 §8; AC-448, AC-449).

func TestAC449ConsentSpecCarriesRecordingLine(t *testing.T) {
	for _, rec := range []bool{false, true} {
		in := askInput()
		in.Recording = rec
		var got ConsentSpec
		ask := func(_ context.Context, sp ConsentSpec) (string, time.Time) {
			got = sp
			return helperio.DecisionDenied, time.Now()
		}
		runConsent(context.Background(), ask, in, time.Now)
		if got.RecordingLine != rec {
			t.Fatalf("Recording=%v → RecordingLine=%v", rec, got.RecordingLine)
		}
	}
}

// Satır istenmişse yalnız görünür ve metni tam olan satır "İzin ver"i açar (Windows diyaloğu her tikte bunu sorar).
func TestAC449GrantNeedsDrawnRecordingLine(t *testing.T) {
	on, off := ConsentSpec{RecordingLine: true}, ConsentSpec{}
	cases := []struct {
		sp      ConsentSpec
		text    string
		visible bool
		want    bool
	}{
		{off, "", false, true},
		{on, helperio.RecordingLine, true, true},
		{on, helperio.RecordingLine, false, false},
		{on, "", true, false},
		{on, "Bu bağlantının ekran kaydı", true, false},
	}
	for _, c := range cases {
		if got := recordingLineDrawn(c.sp, c.text, c.visible); got != c.want {
			t.Errorf("%+v %q %v → %v", c.sp, c.text, c.visible, got)
		}
	}
}

func TestAC448IndicatorDrawnWithSuffixBeforeDial(t *testing.T) {
	r := newRig(nil)
	var shown atomic.Value
	show := r.d.ShowIndicator
	r.d.ShowIndicator = func(s string) (Indicator, error) {
		shown.Store(s)
		if r.dials.Load() != 0 {
			t.Error("gösterge öncesi dial")
		}
		return show(s)
	}
	in := silentInput()
	in.Recording = true
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, in) }()
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	waitExit(t, done)
	if got, _ := shown.Load().(string); got != in.IndicatorText+helperio.RecordingSuffix {
		t.Fatalf("çizilen etiket %q", got)
	}
}

// Eki çizilemeyen göstergeyle bağlantı açılmaz (AC-294 kalıbı).
func TestAC448SuffixNotDrawableNoDial(t *testing.T) {
	r := newRig(nil)
	r.d.ShowIndicator = func(s string) (Indicator, error) {
		if strings.HasSuffix(s, helperio.RecordingSuffix) {
			return nil, errors.New("ek çizilemedi")
		}
		return r.ind, nil
	}
	in := silentInput()
	in.Recording = true
	if code := Run(context.Background(), r.d, in); code != helperio.ExitIndicatorFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d dial %d", code, r.dials.Load())
	}
}

// rec.state off/on ve silent izleme ↔ kontrol geçişi birlikte: ek sunucu etiketinden bağımsız korunur.
func TestAC448LiveSuffixFollowsRecStateAndControl(t *testing.T) {
	ind := &labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}
	live := newLive(ind, "İzleme", true)
	if live.Text() != "İzleme"+helperio.RecordingSuffix {
		t.Fatalf("başlangıç %q", live.Text())
	}
	h := &headless{mode: helperio.ModeSilent, live: live, viewText: "İzleme", controlText: "Kontrol"}
	h.ControlState(true, "")
	if ind.last() != "Kontrol"+helperio.RecordingSuffix {
		t.Fatalf("kontrol %q", ind.last())
	}
	live.SetRecording(false)
	if ind.last() != "Kontrol" {
		t.Fatalf("kayıt durdu %q", ind.last())
	}
	n := len(ind.texts)
	live.SetRecording(false) // değişim yok: yeniden çizim yok
	if len(ind.texts) != n {
		t.Fatal("aynı durum yeniden çizildi")
	}
	live.SetRecording(true)
	if ind.last() != "Kontrol"+helperio.RecordingSuffix {
		t.Fatalf("kayıt yeniden %q", ind.last())
	}
}

// Etiketi değiştiremeyen göstergede ek değişimi başarısızlıktır (fail-closed).
func TestAC448SuffixChangeOnFixedIndicatorFails(t *testing.T) {
	ind := &fakeIndicator{failed: make(chan struct{})}
	live := newLive(ind, "X", false)
	live.SetRecording(true)
	select {
	case <-live.Failed():
	case <-time.After(time.Second):
		t.Fatal("gösterge başarısız sayılmadı")
	}
}

type recSpy struct{ got []bool }

func (r *recSpy) SetRecording(on bool) { r.got = append(r.got, on) }

func TestAC448RecCommandAppliedWithoutStatusReply(t *testing.T) {
	in := "{\"cmd\":\"rec\",\"on\":false}\n{\"cmd\":\"rec\",\"id\":\"01JX0000000000000000000001\",\"on\":true}\n" +
		"{\"cmd\":\"rec\"}\n{\"cmd\":\"rec\",\"on\":true}\n"
	st := &syncBuf{}
	spy := &recSpy{}
	serveCommands(context.Background(), bufio.NewReader(strings.NewReader(in)), nil, newStatusPipe(st), spy)
	if len(spy.got) != 2 || spy.got[0] || !spy.got[1] {
		t.Fatalf("uygulanan %v", spy.got)
	}
	if l := st.lines(); len(l) != 1 || l[0] != "" {
		t.Fatalf("rec durum borusuna yazdı: %v", l)
	}
}
