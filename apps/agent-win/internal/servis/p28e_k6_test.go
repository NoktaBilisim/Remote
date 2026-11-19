package servis

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/servis/helperio"
)

// P28e K6 servis birim testleri (mimari-p28e r2 §2.2, §6, §8): record1, connect.recording, rec.state, olay günlüğü.

func recRig(t *testing.T, record1 bool) *p28uRig {
	t.Helper()
	rg := newP28u(t, newSess(true, false))
	rg.c.Record1 = func() bool { return record1 }
	return rg
}

func withRec(m *Connect) *Connect {
	on := true
	m.Recording = &on
	return m
}

func (p *fakeProc) commands() []helperio.Command {
	p.cmdMu.Lock()
	defer p.cmdMu.Unlock()
	return append([]helperio.Command(nil), p.cmds...)
}

func eventText(ev *memEvents, id uint32) []string {
	ev.mu.Lock()
	defer ev.mu.Unlock()
	var out []string
	for _, e := range ev.evs {
		if e.ID == id {
			out = append(out, e.Text)
		}
	}
	return out
}

// r3: kayıtlı connect de onaysız açılır; yardımcıya yalnız gösterge eki bayrağı (Recording) gider.
func TestAC448ConnectRecordingPassesSuffixFlagToHelper(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(withRec(askConnect()))
	if rg.l.launched.Load() != 1 {
		t.Fatalf("yardımcı başlamadı: %+v", rg.out.all())
	}
	in := rg.l.inputs[0]
	if !in.Recording || in.Mode != helperio.ModeNoUser || in.Consent != helperio.ConsentNone || in.Validate() != nil {
		t.Fatalf("girdi %+v", in)
	}
	if ts := eventText(rg.ev, EvStarted); len(ts) != 1 || !strings.Contains(ts[0], "ekran kaydı: alınıyor") {
		t.Fatalf("1001 metni %v", ts)
	}
}

func TestAC448ConnectWithoutRecordingHasNoSuffixFlag(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(askConnect())
	if in := rg.l.inputs[0]; in.Recording {
		t.Fatalf("kayıtsız bağlantıda Recording %+v", in)
	}
	if ts := eventText(rg.ev, EvStarted); strings.Contains(ts[0], "kayıt") {
		t.Fatalf("1001 metni %v", ts)
	}
}

func TestAC448RecordingOnSocketWithoutRecord1IsProtocol(t *testing.T) {
	rg := recRig(t, false)
	rg.c.Connect(withRec(askConnect()))
	if r, _ := lastOf[*ConnectResult](rg.out); r.OK || r.Reason != RejectProtocol || rg.l.launched.Load() != 0 {
		t.Fatalf("record1'siz kayıt isteği = %+v, başlatma %d", r, rg.l.launched.Load())
	}
}

func TestAC448LegacySocketRecordingRejected(t *testing.T) {
	c, l, _, out, _ := newCore(true)
	c.Connect(withRec(connectMsg()))
	if r, _ := lastOf[*ConnectResult](out); r.OK || r.Reason != helperio.ReasonHelperFailed || l.launched.Load() != 0 {
		t.Fatalf("P27 soketinde kayıt = %+v", r)
	}
}

func TestAC448RecStateTogglesHelperSuffixAndLogs(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(withRec(askConnect()))
	rg.c.RecState(true) // değişim yok: komut/olay yok
	rg.c.RecState(false)
	rg.c.RecState(false)
	rg.c.RecState(true)
	cmds := rg.l.procs[0].commands()
	if len(cmds) != 2 || cmds[0].Cmd != helperio.CmdRec || *cmds[0].On || !*cmds[1].On {
		t.Fatalf("komutlar %+v", cmds)
	}
	for _, c := range cmds {
		if _, err := helperio.EncodeCommand(c); err != nil {
			t.Fatalf("komut kodlanamadı: %v", err)
		}
	}
	ts := eventText(rg.ev, EvRecord)
	if len(ts) != 2 || !strings.HasPrefix(ts[0], "Ekran kaydı durdu") || !strings.HasPrefix(ts[1], "Ekran kaydı başladı") {
		t.Fatalf("1009 %v", ts)
	}
}

// Sunucu kaydın açık olduğunu bildirirse gösterge eki her durumda çizilir (gizli kayıt yok, K-P28e-7).
func TestAC448RecStateOnWithoutConnectRecordingStillShown(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(askConnect())
	rg.c.RecState(true)
	if cmds := rg.l.procs[0].commands(); len(cmds) != 1 || !*cmds[0].On {
		t.Fatalf("komutlar %+v", cmds)
	}
}

func TestAC448RecCommandFailureKillsHelper(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(askConnect())
	rg.l.procs[0].cmdErr = errors.New("boru kapalı")
	rg.c.RecState(true)
	cl := waitFor(t, rg.out, func(m *Closed) bool { return true })
	if cl.Reason != helperio.ReasonIndicatorFailed {
		t.Fatalf("neden %s", cl.Reason)
	}
}

// Cihazda kaydı durdurma yolu yok; tek yol yerel anahtar (AC-295): bağlantı (dolayısıyla kayıt kaynağı) kesilir.
func TestAC448LocalSwitchIsOnlyStopPath(t *testing.T) {
	rg := recRig(t, true)
	rg.c.Connect(withRec(askConnect()))
	if err := rg.c.Disable("kullanici"); err != nil {
		t.Fatal(err)
	}
	cl := waitFor(t, rg.out, func(m *Closed) bool { return true })
	if cl.Reason != KillLocalDisabled {
		t.Fatalf("neden %s", cl.Reason)
	}
}

func TestAC448RejoinCarriesLastRecordingState(t *testing.T) {
	for _, off := range []bool{false, true} {
		rg := recRig(t, true)
		rg.c.Connect(withRec(askConnect()))
		logoffAndExit(t, rg)
		if off {
			rg.c.RecState(false) // bekleyiş sırasında kayıt durdu
		}
		rg.sess.set(func(s *fakeSess) { s.console = 3; s.info[3] = SessionInfo{} })
		rg.c.Rejoin(rejoinMsg(helperio.ModeNoUser))
		for i := 0; i < 200 && rg.l.launched.Load() < 2; i++ {
			time.Sleep(5 * time.Millisecond)
		}
		if rg.l.launched.Load() != 2 {
			t.Fatal("yeniden katılım yardımcısı başlamadı")
		}
		rg.l.mu.Lock()
		in := rg.l.inputs[1]
		rg.l.mu.Unlock()
		if in.Recording == off || in.Validate() != nil {
			t.Fatalf("off=%v rejoin girdisi %+v", off, in)
		}
	}
}

// rec.state record1 bildirilmiş sokette çekirdeğe gider; features'sız/record1'siz sokette 1008.
func TestAC448RecStateOnlyOnRecord1Socket(t *testing.T) {
	for _, caps := range []string{`["consent1","record1"]`, `["consent1"]`, ``} {
		closed := make(chan bool, 1)
		c, fs, h, _ := startDevice(t, func(ctx context.Context, ws *websocket.Conn) {
			if caps != "" {
				_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"device.features","caps":`+caps+`}`))
			}
			_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"rec.state","on":true}`))
			_, _, err := ws.Read(ctx)
			select { // yeniden bağlanmada betik yeniden koşar; tampon doluysa bırak (sunucu kapanışı beklemesin)
			case closed <- websocket.CloseStatus(err) == websocket.StatusPolicyViolation:
			default:
			}
		})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		go func() { _ = c.Run(ctx) }()
		want := caps == `["consent1","record1"]`
		if want {
			for ctx.Err() == nil {
				h.mu.Lock()
				n := len(h.recs)
				h.mu.Unlock()
				if n == 1 && c.Record1() {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			if ctx.Err() != nil {
				t.Fatal("rec.state çekirdeğe ulaşmadı")
			}
			hdr := <-fs.header
			if !strings.Contains(hdr.Get("Sec-WebSocket-Protocol"), DeviceCapRecord) {
				t.Fatalf("alt protokol listesi %q", hdr.Get("Sec-WebSocket-Protocol"))
			}
		} else {
			select {
			case v := <-closed:
				if !v {
					t.Fatalf("caps=%s: 1008 değil", caps)
				}
			case <-ctx.Done():
				t.Fatalf("caps=%s: kapatılmadı", caps)
			}
			h.mu.Lock()
			n := len(h.recs)
			h.mu.Unlock()
			if n != 0 {
				t.Fatalf("caps=%s: rec.state iletildi", caps)
			}
		}
		cancel()
	}
}
