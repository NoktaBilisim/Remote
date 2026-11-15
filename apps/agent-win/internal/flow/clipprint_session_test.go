package flow

import (
	"fmt"
	"testing"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

// chanCPUI ClipPrintUI'nin eşzamanlı sahtesi (döngü goroutine'inden çağrılır).
type chanCPUI struct{ calls chan string }

func (u chanCPUI) ClipSwitch(st ClipSwitchState) {
	u.calls <- fmt.Sprintf("switch:%v:%v:%v", st.Visible, st.Enabled, st.On)
}
func (u chanCPUI) PrintPrompt(p PrintPrompt)    { u.calls <- "prompt:" + p.PID }
func (u chanCPUI) PrintPromptClosed(pid string) { u.calls <- "closed:" + pid }
func (u chanCPUI) Notice(text string)           { u.calls <- "notice:" + text }

func expectCP(t *testing.T, u chanCPUI, want string) {
	t.Helper()
	for recv(t, u.calls) != want {
	}
}

// Oturum bağlantısı: hello yetenekleri → anahtar görünür; kontrol izni → etkin; müşteri açar → WS clip.consent;
// clip.push → DC clip.ready → clip.data → panoya yazılır, rapor; kontrol kapanınca anahtar yerelde kapanır.
func TestAC343P28aSessionWiring(t *testing.T) {
	h := newHarness(t)
	ui := chanCPUI{calls: make(chan string, 64)}
	h.deps.Gate, h.deps.Hotkey = &control.Gate{}, "Ctrl+Shift+F12"
	h.deps.Clipboard, h.deps.Printer, h.deps.ClipPrintUI = &fakeClip{}, &fakePrinter{name: "Yazıcı"}, ui
	start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	hl := hello(token)
	hl.Caps = []string{"remote_control", "clipboard", "print"}
	c.toClient <- hl
	peer := recv(t, h.peers)
	expectCP(t, ui, "switch:true:false:false")
	c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, h.ui, "ctlreq:Ali Teknisyen:Ctrl+Shift+F12")
	h.events <- Event{Kind: EvControlGrant}
	expectControl(t, c, "GRANTED", "UI")
	expectCP(t, ui, "switch:true:true:false")
	h.events <- Event{Kind: EvClipConsent, On: true}
	for {
		if m, ok := recv(t, c.sent).(signal.ClipConsentSet); ok && m.On {
			break
		}
	}
	c.toClient <- signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 3}
	if m := ctlOf(t, recv(t, peer.ctl)); m.T != "clip.ready" {
		t.Fatalf("clip.ready bekleniyordu: %+v", m)
	}
	frames, _ := dc.ClipChunks(cid1, []byte("abc"))
	peer.h.Ctl(ctlOf(t, frames[0]))
	if r, ok := recv(t, c.sent).(signal.ClipReport); !ok || r.Result != "OK" || r.Bytes != 3 {
		t.Fatalf("clip.report OK bekleniyordu: %+v", r)
	}
	expectCP(t, ui, "notice:"+noticeClipPut)
	h.events <- Event{Kind: EvControlClose}
	expectCP(t, ui, "switch:true:false:false")
}
