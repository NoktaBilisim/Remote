package flow

import (
	"errors"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/signal"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type ctlSession struct {
	h     *harness
	c     *fakeConn
	peer  *fakePeer
	gate  *control.Gate
	clk   *clock
	out   chan Outcome
	mu    sync.Mutex
	input []int
}

// startControl kabul edilmiş, paylaşan oturum (remote_control yetenekli, kısayol kayıtlı).
func startControl(t *testing.T, hotkey string) *ctlSession {
	t.Helper()
	h := newHarness(t)
	cs := &ctlSession{h: h, gate: &control.Gate{}, clk: &clock{t: time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)}}
	h.deps.Gate, h.deps.Hotkey, h.deps.Now = cs.gate, hotkey, cs.clk.now
	h.deps.SetInputMonitor = func(id int) { cs.mu.Lock(); cs.input = append(cs.input, id); cs.mu.Unlock() }
	cs.out = start(h, "12345678")
	recv(t, h.creds)
	cs.c = recv(t, h.conns)
	hl := hello(token)
	hl.Caps = []string{"remote_control", "file_transfer"}
	cs.c.toClient <- hl
	cs.peer = recv(t, h.peers)
	if sh := recv(t, cs.c.sent).(signal.ShareState); sh.State != "sharing" {
		t.Fatalf("%+v", sh)
	}
	return cs
}

func (cs *ctlSession) grant(t *testing.T) {
	t.Helper()
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Ctrl+Shift+F12")
	cs.h.events <- Event{Kind: EvControlGrant}
	expectControl(t, cs.c, "GRANTED", "UI")
	if !cs.gate.IsOpen() {
		t.Fatal("izin sonrası kapı açık olmalı")
	}
}

func expectControl(t *testing.T, c *fakeConn, state, source string) {
	t.Helper()
	for {
		if m, ok := recv(t, c.sent).(signal.ControlState); ok {
			if m.State != state || m.Source != source {
				t.Fatalf("control.state %+v, beklenen %s/%s", m, state, source)
			}
			return
		}
	}
}

func noSend(t *testing.T, c *fakeConn) {
	t.Helper()
	select {
	case m := <-c.sent:
		t.Fatalf("beklenmeyen gönderim: %+v", m)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestAC99ViewOnlyAtStartAndDenyThenCooldown(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	if cs.gate.IsOpen() {
		t.Fatal("ilk bağlantıda yalnız görüntüleme")
	}
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Ctrl+Shift+F12")
	cs.h.events <- Event{Kind: EvControlDeny}
	expectControl(t, cs.c, "VIEW", "DENIED")
	// AC-116: ret sonrası 30 sn içinde gelen istek diyalog açmaz.
	cs.clk.add(10 * time.Second)
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	cs.h.events <- Event{Kind: EvControlGrant} // bekleyen istek yok → yok sayılır
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("bekleyen istek yokken kapı açılmamalı")
	}
	cs.clk.add(21 * time.Second)
	cs.grant(t)
}

func TestAC50AC111CloseButtonAndHotkeyCloseGate(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	expectCall(t, cs.h.ui, "control:on:Ctrl+Shift+F12")
	cs.gate.Close() // UI düğmesi kapıyı kendi iş parçacığında kapatır
	cs.h.events <- Event{Kind: EvControlClose}
	expectControl(t, cs.c, "VIEW", "UI")
	expectCall(t, cs.h.ui, "control:off")
	cs.clk.add(time.Minute)
	cs.grant(t)
	cs.h.events <- Event{Kind: EvControlHotkey}
	expectControl(t, cs.c, "VIEW", "HOTKEY")
	if cs.gate.IsOpen() {
		t.Fatal("kısayol sonrası kapı kapalı olmalı")
	}
}

func TestAC102NoHotkeyNoGrant(t *testing.T) {
	cs := startControl(t, "")
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:")
	cs.h.events <- Event{Kind: EvControlGrant}
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("kısayol yokken kontrol izni verilmemeli (G-21)")
	}
}

func TestAC115RevokeClosesGateAndReportsSystem(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- signal.ControlRevoke{T: "control.revoke", Reason: "permission"}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	if cs.gate.IsOpen() {
		t.Fatal("revoke sonrası kapı kapalı olmalı")
	}
	expectCall(t, cs.h.ui, "status:"+statusControlRevoked)
}

func TestAC115CapsUpdateWithoutRemoteControlClosesGate(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- signal.CapsUpdate{T: "caps.update", Caps: []string{"file_transfer"}}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	if cs.gate.IsOpen() {
		t.Fatal("yetki kalkınca kapı kapalı olmalı")
	}
	cs.peer.mu.Lock()
	caps := cs.peer.caps
	cs.peer.mu.Unlock()
	if len(caps) != 1 || caps[0] != "file_transfer" {
		t.Fatalf("eşe yetenek iletilmedi: %v", caps)
	}
	// Yetenek yokken yeni istek diyalog açmaz.
	cs.clk.add(time.Minute)
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	noSend(t, cs.c)
}

func TestAC24ReconnectResetsToViewOnly(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- errors.New("ağ koptu")
	recv(t, cs.h.creds)
	expectCall(t, cs.h.ui, "control:off")
	if cs.gate.IsOpen() {
		t.Fatal("kopuşta kapı kapanmalı")
	}
	c2 := recv(t, cs.h.conns)
	hl := hello(token)
	hl.Caps = []string{"remote_control"}
	c2.toClient <- hl
	recv(t, cs.h.peers)
	recv(t, c2.sent) // share.state
	if cs.gate.IsOpen() {
		t.Fatal("yeniden bağlanmada izin sıfırlanmalı (yalnız görüntüleme)")
	}
}

func TestTechDisconnectClosesGate(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- signal.PeerLeft{T: "peer.left", Role: "tech", Reason: "disconnect"}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	if cs.gate.IsOpen() {
		t.Fatal("teknisyen koptuğunda kapı kapanmalı")
	}
}

func TestAC43MonitorRequestNeedsConsent(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 2} // zaten 2 (harness seçimi)
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 9} // bilinmeyen
	noSend(t, cs.c)
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 1}
	expectCall(t, cs.h.ui, "monreq:Ekran 1")
	cs.h.events <- Event{Kind: EvMonitorAccept, Monitor: 1}
	expectCall(t, cs.h.ui, "monchanged:Ekran 1")
	cs.mu.Lock()
	if n := len(cs.input); n < 2 || cs.input[0] != 2 || cs.input[n-1] != 1 {
		t.Fatalf("AC-49 girdi monitörü güncellenmedi: %v", cs.input)
	}
	cs.mu.Unlock()
	sh := recv(t, cs.c.sent).(signal.ShareState)
	if sh.State != "sharing" || sh.ActiveMonitor == nil || *sh.ActiveMonitor != 1 {
		t.Fatalf("share.state: %+v", sh)
	}
	// ret → 30 sn içinde yeni monitör isteği diyalog açmaz
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 2}
	expectCall(t, cs.h.ui, "monreq:Ekran 2")
	cs.h.events <- Event{Kind: EvMonitorDeny}
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 2}
	cs.c.toClient <- signal.ControlRequest{T: "control.request"} // sıra işareti
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Ctrl+Shift+F12")
}

func TestAC105EnvStateReported(t *testing.T) {
	h := newHarness(t)
	var mu sync.Mutex
	st := env.State{}
	h.deps.EnvProbe = func() env.State { mu.Lock(); defer mu.Unlock(); return st }
	start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	if e := recv(t, c.env); e.ElevatedForeground {
		t.Fatalf("ilk env.state: %+v", e)
	}
	mu.Lock()
	st = env.State{ElevatedForeground: true}
	mu.Unlock()
	if e := recv(t, c.env); !e.ElevatedForeground {
		t.Fatalf("değişim bildirilmedi: %+v", e)
	}
}

// K8 (S7-9): her hello'dan (ilk ve yeniden bağlanma) hemen sonra tek env.state; selfElevated açılış ölçümüdür.
// İzleyicinin aynı değerli ilk olayı tekrar gönderilmez. Yoklayıcı yoksa da gönderilir (alanlar false).
func TestK8EnvStateAfterEveryHelloWithSelfElevated(t *testing.T) {
	h := newHarness(t)
	h.deps.SelfElevated = true
	h.deps.EnvProbe = func() env.State { return env.State{SecureDesktop: true} }
	start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	if e := recv(t, c.env); !e.SelfElevated || !e.SecureDesktop || e.ElevatedForeground {
		t.Fatalf("hello sonrası env.state: %+v", e)
	}
	recv(t, c.sent) // share.state
	select {
	case e := <-c.env:
		t.Fatalf("değişmeyen durum tekrar gönderildi: %+v", e)
	case <-time.After(3 * env.Every):
	}
	c.toClient <- errors.New("ağ koptu")
	recv(t, h.creds)
	c2 := recv(t, h.conns)
	c2.toClient <- hello(token)
	recv(t, h.peers)
	if e := recv(t, c2.env); !e.SelfElevated || !e.SecureDesktop {
		t.Fatalf("yeniden bağlanma sonrası env.state: %+v", e)
	}
	select {
	case e := <-c2.env:
		t.Fatalf("hello başına tek env.state beklenir: %+v", e)
	case <-time.After(3 * env.Every):
	}
}

func TestK8EnvStateWithoutProbe(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12") // EnvProbe nil, SelfElevated false
	if e := recv(t, cs.c.env); e.SelfElevated || e.ElevatedForeground || e.SecureDesktop {
		t.Fatalf("ölçülemeyen alanlar false olmalı: %+v", e)
	}
}

// K6: PeerConnection kopması (WS açık) + bekleyen kontrol diyaloğu → diyalog kapanır, tek control.state{VIEW, SYSTEM}.
// Sonradan gelen "İzin ver" kapıyı açmaz.
func TestK6PeerDropWithOpenPromptSendsViewSystemOnce(t *testing.T) {
	for _, st := range []string{"disconnected", "failed", "closed"} {
		t.Run(st, func(t *testing.T) {
			cs := startControl(t, "Ctrl+Shift+F12")
			cs.openPrompt(t)
			cs.peer.h.State(st)
			expectControl(t, cs.c, "VIEW", "SYSTEM")
			if calls := cs.callsUntilMark(t); !has(calls, "promptclosed") {
				t.Fatalf("diyalog kapanmalı: %v", calls)
			}
			cs.peer.h.State(st) // ikinci olay: diyalog yok, kapı kapalı → mesaj yok
			cs.h.events <- Event{Kind: EvControlGrant}
			noSend(t, cs.c)
			if cs.gate.IsOpen() {
				t.Fatal("kapanmış diyalog kapıyı açmamalı")
			}
		})
	}
}

// K6: kapı açıkken PC kopması yine tek {VIEW, SYSTEM} (çift gönderim yok); hiçbir şey açık değilken mesaj yok;
// monitör diyaloğu mesajsız kapanır (monitor.denied yok).
func TestK6PeerDropGrantedIdleAndMonitorPrompt(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.peer.h.State("failed")
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	cs.callsUntilMark(t)
	noSend(t, cs.c)

	cs2 := startControl(t, "Ctrl+Shift+F12")
	cs2.peer.h.State("disconnected")
	cs2.callsUntilMark(t)
	noSend(t, cs2.c)

	cs2.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 1}
	expectCall(t, cs2.h.ui, "monreq:Ekran 1")
	cs2.peer.h.State("closed")
	if calls := cs2.callsUntilMark(t); !has(calls, "monpromptclosed") {
		t.Fatalf("monitör diyaloğu kapanmalı: %v", calls)
	}
	noSend(t, cs2.c)
}

// K6: sunucunun zaten VIEW'a geçtiği kapanışlarda (revoke, release, cancel, caps.update, peer.left/joined{tech}, hello)
// ve WS kopmasında açık diyalog için control.state GÖNDERİLMEZ.
func TestK6ServerKnownClosuresSendNothingForPrompt(t *testing.T) {
	cases := map[string]any{
		"revoke":      signal.ControlRevoke{T: "control.revoke", Reason: "admin"},
		"release":     signal.ControlRelease{T: "control.release"},
		"cancel":      signal.ControlCancel{T: "control.cancel"},
		"caps.update": signal.CapsUpdate{T: "caps.update", Caps: []string{"file_transfer"}},
		"peer.left":   signal.PeerLeft{T: "peer.left", Role: "tech", Reason: "disconnect"},
		"peer.joined": signal.PeerJoined{T: "peer.joined", Role: "tech"},
	}
	for name, msg := range cases {
		t.Run(name, func(t *testing.T) {
			cs := startControl(t, "Ctrl+Shift+F12")
			cs.openPrompt(t)
			cs.c.toClient <- msg
			if calls := cs.callsUntilMark(t); !has(calls, "promptclosed") {
				t.Fatalf("diyalog kapanmalı: %v", calls)
			}
			noSend(t, cs.c)
		})
	}
	t.Run("hello", func(t *testing.T) {
		cs := startControl(t, "Ctrl+Shift+F12")
		cs.openPrompt(t)
		hl := hello(token)
		hl.Caps = []string{"remote_control"}
		cs.c.toClient <- hl
		recv(t, cs.h.peers)
		if m, ok := recv(t, cs.c.sent).(signal.ShareState); !ok {
			t.Fatalf("hello sonrası yalnız share.state beklenir: %+v", m)
		}
		noSend(t, cs.c)
	})
	t.Run("ws", func(t *testing.T) {
		cs := startControl(t, "Ctrl+Shift+F12")
		cs.openPrompt(t)
		cs.c.toClient <- errors.New("ağ koptu")
		recv(t, cs.h.creds)
		expectCall(t, cs.h.ui, "promptclosed")
		noSend(t, cs.c)
	})
}

// callsUntilMark işaret mesajına (error → Status) kadar UI çağrılarını toplar; "olmamalı" denetimleri için.
func (cs *ctlSession) callsUntilMark(t *testing.T) []string {
	t.Helper()
	cs.c.toClient <- signal.ErrorMsg{T: "error", Code: "CONFLICT", Message: "işaret"}
	var got []string
	for {
		c := recv(t, cs.h.ui.calls)
		if c == "status:işaret" {
			return got
		}
		got = append(got, c)
	}
}

func has(calls []string, want string) bool {
	for _, c := range calls {
		if c == want {
			return true
		}
	}
	return false
}

func (cs *ctlSession) openPrompt(t *testing.T) {
	t.Helper()
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Ctrl+Shift+F12")
}

// K1: control.release kapıyı kapatır, yanıt göndermez, "Teknisyen kontrolü bıraktı".
func TestK1ReleaseClosesGateWithoutReply(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- signal.ControlRelease{T: "control.release"}
	calls := cs.callsUntilMark(t)
	if cs.gate.IsOpen() {
		t.Fatal("release sonrası kapı kapalı olmalı")
	}
	if !has(calls, "control:off") || !has(calls, "status:"+statusControlReleased) {
		t.Fatalf("gösterge/metin: %v", calls)
	}
	noSend(t, cs.c)
	// Yeniden kontrol yeni istek ve yeni izin ister.
	cs.grant(t)
}

// K2: control.cancel bekleyen diyaloğu kapatır, yanıt yok; sonradan gelen "İzin ver" kapıyı açmaz.
func TestK2CancelClosesPromptAndLateGrantIgnored(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.openPrompt(t)
	cs.c.toClient <- signal.ControlCancel{T: "control.cancel"}
	calls := cs.callsUntilMark(t)
	if !has(calls, "promptclosed") || !has(calls, "status:"+statusControlCancel) {
		t.Fatalf("diyalog/metin: %v", calls)
	}
	cs.h.events <- Event{Kind: EvControlGrant} // yarış: kullanıcı iptalden hemen sonra tıkladı
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("iptal edilen istek kapıyı açmamalı")
	}
	// İptal ret sayılmaz: 30 sn beklemeden yeni istek diyalog açar.
	cs.openPrompt(t)
}

// K1/K2: hiçbir şey açık değilken release/cancel sessizdir; release diyalog açıkken iptal metni gösterir.
func TestK1K2IdleAndPromptTexts(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.callsUntilMark(t) // açılış çağrılarını (karşılama, lobi, aktif) boşalt
	cs.c.toClient <- signal.ControlCancel{T: "control.cancel"}
	cs.c.toClient <- signal.ControlRelease{T: "control.release"}
	if calls := cs.callsUntilMark(t); len(calls) != 0 {
		t.Fatalf("boştayken UI çağrısı olmamalı: %v", calls)
	}
	noSend(t, cs.c)
	cs.openPrompt(t)
	cs.c.toClient <- signal.ControlRelease{T: "control.release"}
	if calls := cs.callsUntilMark(t); !has(calls, "status:"+statusControlCancel) || has(calls, "status:"+statusControlReleased) {
		t.Fatalf("diyalog açıkken release → iptal metni: %v", calls)
	}
}

// K1/K2: release/cancel yalnız kontrol diyaloğunu kapatır; monitör diyaloğu sürer (revoke ise ikisini de kapatır).
func TestK2CancelKeepsMonitorPromptRevokeClosesIt(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 1}
	expectCall(t, cs.h.ui, "monreq:Ekran 1")
	cs.c.toClient <- signal.ControlCancel{T: "control.cancel"}
	if calls := cs.callsUntilMark(t); has(calls, "monpromptclosed") {
		t.Fatalf("cancel monitör diyaloğunu kapatmamalı: %v", calls)
	}
	cs.c.toClient <- signal.ControlRevoke{T: "control.revoke", Reason: "admin"}
	if calls := cs.callsUntilMark(t); !has(calls, "monpromptclosed") {
		t.Fatalf("revoke monitör diyaloğunu kapatmalı: %v", calls)
	}
	cs.h.events <- Event{Kind: EvMonitorAccept, Monitor: 1} // kapanmış diyaloğun geç olayı
	noSend(t, cs.c)
}

// §3 control.revoke: kapı kapalıyken (stale) yanıt yok; kapı açıksa {VIEW,SYSTEM}.
func TestK2StaleRevokeWhileViewSendsNothing(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.c.toClient <- signal.ControlRevoke{T: "control.revoke", Reason: "stale"}
	cs.callsUntilMark(t)
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("stale kapıyı açamaz")
	}
}

// K3: revoke{reconnect} kapıyı kapatır; ardından gelen peer.left metni ezmez. Hiçbir şey açık değilse olağan metin.
func TestK3ReconnectRevokeThenPeerLeft(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.grant(t)
	cs.c.toClient <- signal.ControlRevoke{T: "control.revoke", Reason: "reconnect"}
	cs.c.toClient <- signal.PeerLeft{T: "peer.left", Role: "tech", Reason: "disconnect"}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	calls := cs.callsUntilMark(t)
	if cs.gate.IsOpen() {
		t.Fatal("revoke{reconnect} kapıyı kapatmalı")
	}
	if !has(calls, "status:"+statusControlTechLost) || has(calls, "status:"+statusTechLeft) {
		t.Fatalf("metin: %v", calls)
	}
	// Bu kez hiçbir şey açık değil: olağan "teknisyen döndü" metni.
	cs.c.toClient <- signal.ControlRevoke{T: "control.revoke", Reason: "reconnect"}
	cs.c.toClient <- signal.PeerJoined{T: "peer.joined", Role: "tech"}
	calls = cs.callsUntilMark(t)
	if has(calls, "status:"+statusControlTechLost) || !has(calls, "status:"+statusTechBack) {
		t.Fatalf("metin: %v", calls)
	}
}

// K3 ikinci katman: revoke gelmese bile peer.joined{tech} (sekme değişimi) açık diyaloğu kapatır.
func TestK3PeerJoinedClosesPromptWithoutRevoke(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.openPrompt(t)
	cs.c.toClient <- signal.PeerJoined{T: "peer.joined", Role: "tech"}
	calls := cs.callsUntilMark(t)
	if !has(calls, "promptclosed") || !has(calls, "status:"+statusControlTechLost) {
		t.Fatalf("diyalog/metin: %v", calls)
	}
	cs.h.events <- Event{Kind: EvControlGrant}
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("eski teknisyenin isteği yeni sekmeye kapı açmamalı")
	}
}

// K4: monitör diyaloğunda Reddet/Esc/pencere kapatma → monitor.denied{monitorId}.
func TestK4MonitorDeniedSent(t *testing.T) {
	cs := startControl(t, "Ctrl+Shift+F12")
	cs.c.toClient <- signal.MonitorRequest{T: "monitor.request", MonitorID: 1}
	expectCall(t, cs.h.ui, "monreq:Ekran 1")
	cs.h.events <- Event{Kind: EvMonitorDeny}
	for {
		if m, ok := recv(t, cs.c.sent).(signal.MonitorDenied); ok {
			if m.MonitorID != 1 {
				t.Fatalf("%+v", m)
			}
			break
		}
	}
	cs.h.events <- Event{Kind: EvMonitorDeny} // çift olay: ikinci bildirim yok
	noSend(t, cs.c)
}
