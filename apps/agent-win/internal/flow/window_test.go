package flow

import (
	"context"
	"sync"
	"testing"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// streamErrPeer Stream'i dışarıdan verilen hatayla bitiren sahte eş (yayında kaynak hatası).
type streamErrPeer struct {
	*fakePeer
	fail chan error
}

// streamErrMedia P28c: yayın eşten bağımsız; hata eşin fail kanalından (tüm eşler aynı kanalı paylaşır).
func streamErrMedia(fail chan error) func(ctx context.Context, _ rtc.Source) error {
	return func(ctx context.Context, _ rtc.Source) error {
		select {
		case err := <-fail:
			return err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type windowRec struct {
	mu                   sync.Mutex
	captured, inputWin   []uintptr
	inputMon, monCapture []int
}

func windowHarness(t *testing.T, supported bool) (*harness, *windowRec, chan *streamErrPeer) {
	t.Helper()
	h := newHarness(t)
	rec := &windowRec{}
	peers := make(chan *streamErrPeer, 2)
	fail := make(chan error, 1)
	h.media.stream = streamErrMedia(fail)
	h.deps.NewPeer = func(_ []signal.IceServer, _ []string, hd rtc.Handlers) (Peer, error) {
		p := &streamErrPeer{fakePeer: &fakePeer{h: hd, offers: make(chan string, 4), ctl: make(chan []byte, 4)}, fail: fail}
		peers <- p
		return p, nil
	}
	h.deps.Capture = func(id int) (rtc.Source, error) {
		rec.mu.Lock()
		rec.monCapture = append(rec.monCapture, id)
		rec.mu.Unlock()
		return fakeSrc{}, nil
	}
	h.deps.WindowCapture = func() bool { return supported }
	h.deps.CaptureWindow = func(hwnd uintptr) (rtc.Source, error) {
		rec.mu.Lock()
		rec.captured = append(rec.captured, hwnd)
		rec.mu.Unlock()
		return fakeSrc{}, nil
	}
	h.deps.SetInputWindow = func(hwnd uintptr) { rec.mu.Lock(); rec.inputWin = append(rec.inputWin, hwnd); rec.mu.Unlock() }
	h.deps.SetInputMonitor = func(id int) { rec.mu.Lock(); rec.inputMon = append(rec.inputMon, id); rec.mu.Unlock() }
	return h, rec, peers
}

// AC-248: pencere seçilince yalnız o pencere yakalanır, girdi o pencereye kapsanır (S17-1), share.state method WGC
// (konsolda mod) ve monitör listesi gitmez; teknisyenin monitör isteği yok sayılır. Pencere kapanınca share.state
// {stopped, WINDOW_CLOSED, WGC} ve müşteri durum satırında neden.
func TestAC248WindowModeSharesOnlyWindowAndStopsOnClose(t *testing.T) {
	h, rec, peers := windowHarness(t, true)
	h.ui.window = 0xBEEF
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	p := recv(t, peers)
	expectCall(t, h.ui, "choose:windows")
	sh := recv(t, c.sent).(signal.ShareState)
	if sh.State != "sharing" || sh.Method != "WGC" || sh.Monitors != nil || sh.ActiveMonitor != nil {
		t.Fatalf("AC-248 share.state: %+v", sh)
	}
	rec.mu.Lock()
	if len(rec.captured) != 1 || rec.captured[0] != 0xBEEF || len(rec.monCapture) != 0 {
		t.Fatalf("yakalama: pencere=%v monitör=%v", rec.captured, rec.monCapture)
	}
	if len(rec.inputWin) != 1 || rec.inputWin[0] != 0xBEEF || len(rec.inputMon) != 0 {
		t.Fatalf("girdi hedefi: pencere=%v monitör=%v", rec.inputWin, rec.inputMon)
	}
	rec.mu.Unlock()

	c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 1}
	noMore(t, c.sent)

	p.fail <- &capture.Error{Reason: capture.ReasonWindowClosed, Op: "IsWindow", Method: capture.MethodWGC}
	st := recv(t, c.sent).(signal.ShareState)
	if st.State != "stopped" || st.Reason != "WINDOW_CLOSED" || st.Method != "WGC" {
		t.Fatalf("AC-248 kapanış: %+v", st)
	}
	expectCall(t, h.ui, "status:Ekran görüntüsü alınamadı (WINDOW_CLOSED). Paylaşılan pencere kapandı; oturumu bitirip yeniden başlatın.")
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent)
	recv(t, out)
}

// AC-248: pencere açılamazsa (CreateForWindow reddi) paylaşım başlamaz, neden ve WGC gider.
func TestAC248WindowOpenFailureSendsReason(t *testing.T) {
	h, _, _ := windowHarness(t, true)
	h.ui.window = 0x10
	h.deps.CaptureWindow = func(uintptr) (rtc.Source, error) {
		return nil, &capture.Error{Reason: capture.ReasonWindowUnavailable, Op: "CreateForWindow", HR: 0x80070057, Method: capture.MethodWGC}
	}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	sh := recv(t, c.sent).(signal.ShareState)
	if sh.State != "stopped" || sh.Reason != "WINDOW_UNAVAILABLE" || sh.Method != "WGC" {
		t.Fatalf("%+v", sh)
	}
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent)
	recv(t, out)
}

// AC-248: WGC yoksa seçim ekranı pencere seçeneği olmadan (yalnız çoklu monitörde) açılır; UI pencere dönse bile
// monitör modu kalır. Tek monitör + WGC varsa seçim ekranı yine açılır.
func TestAC248WindowOptionOnlyWhenSupported(t *testing.T) {
	h, rec, _ := windowHarness(t, false)
	h.ui.window = 0x10
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	expectCall(t, h.ui, "choose")
	if sh := recv(t, c.sent).(signal.ShareState); sh.State != "sharing" || sh.Method != "" || len(sh.Monitors) != 2 {
		t.Fatalf("monitör modu: %+v", sh)
	}
	rec.mu.Lock()
	if len(rec.captured) != 0 || len(rec.monCapture) != 1 {
		t.Fatalf("WGC yokken pencere yakalanmamalı: %v %v", rec.captured, rec.monCapture)
	}
	rec.mu.Unlock()
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent)
	recv(t, out)

	h2, _, _ := windowHarness(t, true)
	h2.deps.Monitors = func() ([]signal.Monitor, error) {
		return []signal.Monitor{{ID: 1, Name: "Ekran 1", W: 1920, H: 1080, Primary: true}}, nil
	}
	out2 := start(h2, "12345678")
	c2 := recv(t, h2.conns)
	c2.toClient <- hello(token)
	expectCall(t, h2.ui, "choose:windows")
	if sh := recv(t, c2.sent).(signal.ShareState); sh.State != "sharing" || sh.Method != "" {
		t.Fatalf("tek monitör, tüm ekran seçildi: %+v", sh)
	}
	h2.events <- Event{Kind: EvEnd}
	recv(t, c2.sent)
	recv(t, out2)
}
