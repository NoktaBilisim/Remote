package flow

import (
	"context"
	"errors"
	"strings"
	"testing"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// 0.10.2: yakalama hatasının durum satırı neden kodunu ve kısa yönlendirmeyi gösterir; tipli olmayan hata eski metni.
func TestCaptureStatusShowsReasonCode(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{&capture.Error{Reason: capture.ReasonDXGIUnsupported, Op: "DuplicateOutput", HR: 0x887A0004},
			"Ekran görüntüsü alınamadı (DXGI_UNSUPPORTED). Ekran kartı ayarını kontrol edin."},
		{&capture.Error{Reason: capture.ReasonMFStartup, Op: "MFStartup"},
			"Ekran görüntüsü alınamadı (MF_STARTUP). Windows Medya Özellik Paketi gerekli."},
		{&capture.Error{Reason: capture.ReasonFirstFrameTimeout, Op: "FirstFrame"},
			"Ekran görüntüsü alınamadı (FIRST_FRAME_TIMEOUT). Ekran yanıt vermedi; tekrar deneyin."},
		{&capture.Error{Reason: capture.ReasonOther, Op: "CoInitializeEx", HR: 0x80004005},
			"Ekran görüntüsü alınamadı (OTHER 0x80004005). Teknisyeninize bu kodu bildirin."},
		{errors.New("capture: kaynak kapalı"), statusCaptureFail},
		{nil, statusCaptureFail},
	}
	for _, c := range cases {
		if got := captureStatus(c.err); got != c.want {
			t.Errorf("%v: %q, beklenen %q", c.err, got, c.want)
		}
	}
	for _, r := range []capture.Reason{capture.ReasonDXGIUnsupported, capture.ReasonDXGIAccessDenied,
		capture.ReasonDXGINotAvailable, capture.ReasonNoOutput, capture.ReasonD3DDevice, capture.ReasonFirstFrameTimeout,
		capture.ReasonGDI, capture.ReasonMFStartup, capture.ReasonNoH264Encoder, capture.ReasonEncoderConfig,
		capture.ReasonEncodeFailed} {
		if captureHints[r] == "" {
			t.Errorf("%s için yönlendirme metni yok", r)
		}
		if s := captureStatus(&capture.Error{Reason: r}); len([]rune(s)) > 110 {
			t.Errorf("%s: durum satırı çok uzun (%d): %s", r, len([]rune(s)), s)
		}
	}
}

// Kaynak açılamazsa share.state "stopped" gider ve durum satırında neden kodu görünür.
func TestCaptureOpenFailureStatusHasReason(t *testing.T) {
	h := newHarness(t)
	h.deps.Capture = func(int) (rtc.Source, error) {
		return nil, &capture.Error{Reason: capture.ReasonDXGIUnsupported, Op: "DuplicateOutput", HR: 0x887A0004}
	}
	out := start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	if sh := recv(t, c.sent).(signal.ShareState); sh.State != "stopped" {
		t.Fatalf("share.state: %+v", sh)
	}
	expectCall(t, h.ui, "status:Ekran görüntüsü alınamadı (DXGI_UNSUPPORTED). Ekran kartı ayarını kontrol edin.")
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent) // session.end
	if o := recv(t, out); o.Message != msgSelfEnd {
		t.Fatalf("%+v", o)
	}
	if strings.Contains(captureStatus(nil), "(") {
		t.Fatal("kodsuz metin parantez içermemeli")
	}
}

// QA#4: yayın sırasında yakalama/kodlama hatası → share.state "stopped" + durum satırında neden kodu.
func TestCaptureStreamFailureStatusHasReason(t *testing.T) {
	h := newHarness(t)
	h.media.stream = func(context.Context, rtc.Source) error { // yayın tipli kodlama hatasıyla biter
		return &capture.Error{Reason: capture.ReasonEncodeFailed, Op: "Encode", HR: 0xC00D36B4}
	}
	out := start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	if sh := recv(t, c.sent).(signal.ShareState); sh.State != "sharing" {
		t.Fatalf("önce paylaşım başlamalı: %+v", sh)
	}
	if sh := recv(t, c.sent).(signal.ShareState); sh.State != "stopped" {
		t.Fatalf("yayın hatasında stopped beklenir: %+v", sh)
	}
	expectCall(t, h.ui, "status:Ekran görüntüsü alınamadı (ENCODE_FAILED). Görüntü kodlanamadı; teknisyeninize bu kodu bildirin.")
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent) // session.end
	if o := recv(t, out); o.Message != msgSelfEnd {
		t.Fatalf("%+v", o)
	}
}
