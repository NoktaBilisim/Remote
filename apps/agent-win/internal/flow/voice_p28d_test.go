package flow

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P28d K3a (mimari-p28d r3 §4.2, §4.3; K-PD-2, O-PD-1, O-PD-3, D-PD-3, D-PD-5, Y-PD-3): Go misafir ses akışı.

var (
	call1 = strings.Repeat("a", 22)
	call2 = strings.Repeat("b", 22)
)

// WriteAudio fakePeer'i VoicePeer yapar (rtc.Peer.WriteAudio eşi).
func (p *fakePeer) WriteAudio([]byte, time.Duration) error { return nil }

// fakeVoiceUI engellemez (döngüyü bekletmez); kayıtlar eventually ile okunur.
type fakeVoiceUI struct {
	mu     sync.Mutex
	asks   []VoiceAsk
	closed []string
	bars   []VoiceView
}

func (u *fakeVoiceUI) VoiceAsk(a VoiceAsk) { u.mu.Lock(); u.asks = append(u.asks, a); u.mu.Unlock() }
func (u *fakeVoiceUI) VoiceAskClosed(id string) {
	u.mu.Lock()
	u.closed = append(u.closed, id)
	u.mu.Unlock()
}
func (u *fakeVoiceUI) VoiceBar(v VoiceView) { u.mu.Lock(); u.bars = append(u.bars, v); u.mu.Unlock() }

func (u *fakeVoiceUI) lastBar() (VoiceView, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.bars) == 0 {
		return VoiceView{}, false
	}
	return u.bars[len(u.bars)-1], true
}

func (u *fakeVoiceUI) snapshot() ([]VoiceAsk, []string, []VoiceView) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return slices.Clone(u.asks), slices.Clone(u.closed), slices.Clone(u.bars)
}

type fakeCall struct {
	mu           sync.Mutex
	peers        map[string]bool
	talkers      []string
	listeners    []string
	muted        bool
	pushes       int
	closes       int
	mutedAtClose bool
}

func (c *fakeCall) SetPeer(tid string, _ func([]byte, time.Duration) error) {
	c.mu.Lock()
	c.peers[tid] = true
	c.mu.Unlock()
}
func (c *fakeCall) RemovePeer(tid string) { c.mu.Lock(); delete(c.peers, tid); c.mu.Unlock() }
func (c *fakeCall) SetRoles(t, l []string) {
	c.mu.Lock()
	c.talkers, c.listeners = slices.Clone(t), slices.Clone(l)
	c.mu.Unlock()
}
func (c *fakeCall) SetMuted(on bool) { c.mu.Lock(); c.muted = on; c.mu.Unlock() }
func (c *fakeCall) Push(string, uint16, []byte) {
	c.mu.Lock()
	if c.closes == 0 {
		c.pushes++
	}
	c.mu.Unlock()
}
func (c *fakeCall) Close() error {
	c.mu.Lock()
	if c.closes == 0 {
		c.mutedAtClose = c.muted
	}
	c.closes++
	c.mu.Unlock()
	return nil
}

func (c *fakeCall) get() (closes int, muted bool, peers []string, talkers, listeners []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for p := range c.peers {
		peers = append(peers, p)
	}
	slices.Sort(peers)
	return c.closes, c.muted, peers, slices.Clone(c.talkers), slices.Clone(c.listeners)
}

// fakeOpener sayaçlı OpenVoice (WASAPI Initialize eşi). block doluysa açılış o kapanana dek bekler.
type fakeOpener struct {
	mu      sync.Mutex
	opens   int
	calls   []*fakeCall
	block   chan struct{}
	err     error
	onFail  func(error)
	started chan struct{}
}

func (o *fakeOpener) open(onFail func(error)) (VoiceCall, error) {
	o.mu.Lock()
	o.opens++
	o.onFail = onFail
	b, err := o.block, o.err
	o.mu.Unlock()
	o.started <- struct{}{}
	if b != nil {
		<-b
	}
	if err != nil {
		return nil, err
	}
	c := &fakeCall{peers: map[string]bool{}}
	o.mu.Lock()
	o.calls = append(o.calls, c)
	o.mu.Unlock()
	return c, nil
}

func (o *fakeOpener) count() (opens int, calls []*fakeCall) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.opens, slices.Clone(o.calls)
}

type voiceRig struct {
	*multiRig
	ui *fakeVoiceUI
	op *fakeOpener
	pa *fakePeer
	pb *fakePeer
}

// startVoice çok teknisyenli oturum: A sahip+kontrol, B katılımcı, C izleyici; A ve B'nin eşleri kurulu.
func startVoice(t *testing.T, op *fakeOpener) *voiceRig {
	t.Helper()
	h := newHarness(t)
	r := &fakeRoster{views: make(chan RosterView, 32), ok: true, chats: make(chan string, 8)}
	h.deps.RosterUI = r
	ui := &fakeVoiceUI{}
	if op == nil {
		op = &fakeOpener{}
	}
	op.started = make(chan struct{}, 8)
	h.deps.VoiceUI, h.deps.OpenVoice = ui, op.open
	m := &multiRig{h: h, roster: r, out: start(h, "12345678")}
	recv(t, h.creds)
	m.c = recv(t, h.conns)
	m.c.toClient <- hello(token)
	recv(t, h.peers)
	m.c.toClient <- voiceRoster()
	recv(t, r.views)
	v := &voiceRig{multiRig: m, ui: ui, op: op}
	v.pa, v.pb = m.offer(t, tidA), m.offer(t, tidB)
	if v.pa == nil || v.pb == nil {
		t.Fatal("eşler kurulmadı")
	}
	return v
}

func voiceRoster() signal.TechsRoster {
	return rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"}, [2]string{tidC, "observer"})
}

func vstate(phase, callID string, talkers, listeners []string) signal.VoiceState {
	m := signal.VoiceState{T: "voice.state", Phase: phase, CallID: callID, Talkers: []string{}, Listeners: []string{}}
	m.Talkers = append(m.Talkers, talkers...)
	m.Listeners = append(m.Listeners, listeners...)
	if phase == "idle" && callID != "" {
		m.EndReason = "tech"
	}
	return m
}

func eventually(t *testing.T, what string, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !f() {
		if time.Now().After(deadline) {
			t.Fatal("zaman aşımı: " + what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// voiceSent soketten giden voice.answer / voice.end mesajlarını window boyunca toplar.
func (v *voiceRig) voiceSent(window time.Duration) []signal.Outbound {
	var out []signal.Outbound
	tm := time.After(window)
	for {
		select {
		case m := <-v.c.sent:
			switch m.(type) {
			case signal.VoiceAnswer, signal.VoiceEnd:
				out = append(out, m)
			}
		case <-tm:
			return out
		}
	}
}

// nextVoice sıradaki voice.* gönderimi.
func (v *voiceRig) nextVoice(t *testing.T) signal.Outbound {
	t.Helper()
	for {
		m := recv(t, v.c.sent)
		switch m.(type) {
		case signal.VoiceAnswer, signal.VoiceEnd:
			return m
		}
	}
}

func (v *voiceRig) ask(t *testing.T, callID string) {
	t.Helper()
	n := len(v.asksNow())
	v.c.toClient <- signal.VoiceRequest{T: "voice.request", CallID: callID, By: tidA}
	eventually(t, "diyalog", func() bool { return len(v.asksNow()) > n })
}

func (v *voiceRig) asksNow() []VoiceAsk { a, _, _ := v.ui.snapshot(); return a }

// accepted request + pending + yerel kabul + açılış; açılan çağrı döner.
func (v *voiceRig) accepted(t *testing.T, callID string, listeners ...string) *fakeCall {
	t.Helper()
	v.ask(t, callID)
	v.c.toClient <- vstate("pending", callID, nil, append([]string{tidA}, listeners...))
	eventually(t, "pending diyaloğu", func() bool { return len(v.asksNow()) >= 2 })
	opens, _ := v.op.count()
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: callID}
	if a, ok := v.nextVoice(t).(signal.VoiceAnswer); !ok || !a.Accept || a.CallID != callID {
		t.Fatalf("voice.answer{true} beklenirdi: %+v", a)
	}
	recv(t, v.op.started)
	var c *fakeCall
	eventually(t, "açılış", func() bool {
		n, calls := v.op.count()
		if n == opens+1 && len(calls) > 0 {
			c = calls[len(calls)-1]
			return true
		}
		return false
	})
	eventually(t, "eş bağlama", func() bool { _, _, p, _, _ := c.get(); return len(p) == 2 })
	return c
}

func closes(c *fakeCall) int { n, _, _, _, _ := c.get(); return n }

// --- K-PD-2 ---------------------------------------------------------------------------------------------------

func TestAC374P28dNoMicWithoutLocalAccept(t *testing.T) {
	op := &fakeOpener{block: make(chan struct{})}
	v := startVoice(t, op)
	v.ask(t, call1)
	if a := v.asksNow()[0]; a.CallID != call1 || a.Name != "TA" {
		t.Fatalf("diyalog: %+v", a)
	}
	v.c.toClient <- vstate("pending", call1, nil, []string{tidA, tidC})
	eventually(t, "dinleyecekler", func() bool {
		a := v.asksNow()
		return len(a) == 2 && slices.Equal(a[1].Listeners, []string{"TC"})
	})
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call2} // açık diyalog değil
	v.h.events <- Event{Kind: EvVoiceAccept}                // callId'siz
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("yanlış callId'li kabul yanıt üretti: %+v", got)
	}
	if n, _ := op.count(); n != 0 {
		t.Fatalf("yerel kabul olmadan OpenVoice %d kez", n)
	}
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	// voice.answer tıklama turunda, açılış (engelli) bitmeden gider.
	if a, ok := v.nextVoice(t).(signal.VoiceAnswer); !ok || !a.Accept || a.CallID != call1 {
		t.Fatalf("voice.answer: %+v", a)
	}
	recv(t, op.started)
	close(op.block)
	eventually(t, "çağrı", func() bool { _, c := op.count(); return len(c) == 1 })
	if b, _ := v.ui.lastBar(); !b.On {
		t.Fatalf("kabulden sonra gösterge: %+v", b)
	}
}

func TestAC374P28dStateActiveWithoutConsentSendsCustomerEndOnce(t *testing.T) {
	v := startVoice(t, nil)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB})
	got := v.voiceSent(300 * time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("callId başına bir voice.end beklenirdi: %+v", got)
	}
	if e, ok := got[0].(signal.VoiceEnd); !ok || e.CallID != call1 || e.Reason != signal.VoiceEndCustomer {
		t.Fatalf("voice.end{customer}: %+v", got[0])
	}
	if n, _ := v.op.count(); n != 0 {
		t.Fatalf("rızasız active mikrofon açtı (%d)", n)
	}
	if _, _, bars := v.ui.snapshot(); slices.ContainsFunc(bars, func(b VoiceView) bool { return b.On }) {
		t.Fatal("rızasız active göstergeyi açtı")
	}
}

func TestAC374P28dStateOnlyCloses(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB})
	eventually(t, "roller", func() bool {
		_, _, _, tk, ls := c.get()
		return slices.Equal(tk, []string{tidA}) && slices.Equal(ls, []string{tidA, tidB})
	})
	v.c.toClient <- vstate("idle", call1, nil, nil)
	eventually(t, "idle bırakır", func() bool { return closes(c) == 1 })
	if b, _ := v.ui.lastBar(); b.On || b.Note != VoiceTexts.Ended {
		t.Fatalf("bitiş görünümü: %+v", b)
	}
	// Aynı callId için yeniden active: rıza silindi → açılmaz, voice.end{customer}.
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	if e, ok := v.nextVoice(t).(signal.VoiceEnd); !ok || e.Reason != signal.VoiceEndCustomer {
		t.Fatalf("rıza silindikten sonra active: %+v", e)
	}
	if n, _ := v.op.count(); n != 1 {
		t.Fatalf("voice.state mikrofon açtı: opens=%d", n)
	}
}

func TestAC374P28dNewRequestOtherCallReleases(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.ask(t, call2)
	eventually(t, "başka callId bırakır", func() bool { return closes(c) == 1 })
}

// --- tek releaseMic çağrı yerleri (D-PD-5, O-PD-1) --------------------------------------------------------------

func TestAC374P28dReleaseMicOnWsDrop(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	v.ask(t, call2) // başka callId: bırakır; call2 diyaloğu açık kalır
	eventually(t, "bırakma", func() bool { return closes(c) == 1 })
	v.c.toClient <- errors.New("ws koptu")
	eventually(t, "diyalog kapanır", func() bool { _, cl, _ := v.ui.snapshot(); return slices.Contains(cl, call2) })
	c3 := recv(t, v.h.conns)
	c3.toClient <- hello(token)
	expectCall(t, v.h.ui, "status:"+statusReconnected)
	// Kopuştan önce açık kalan diyaloğun kabulü yeni sokette yanıt/mikrofon üretmez (K-PD-2: yeni istek + yeni kabul).
	v.c = c3
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call2}
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("eski diyalog yeni sokette yanıt verdi: %+v", got)
	}
	if n, _ := v.op.count(); n != 1 {
		t.Fatalf("opens=%d", n)
	}
}

func TestAC374P28dReleaseMicOnWsDropSilencesFirst(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- errors.New("ws koptu")
	eventually(t, "kopuşta bırakma", func() bool { return closes(c) == 1 })
	c.mu.Lock()
	silenced := c.mutedAtClose
	c.mu.Unlock()
	if !silenced {
		t.Fatal("Close'dan önce susturulmadı (O-PD-1)")
	}
	if b, _ := v.ui.lastBar(); b.On || b.Note != VoiceTexts.Ended {
		t.Fatalf("kopuş görünümü: %+v", b)
	}
}

func TestAC374P28dReleaseMicOnSessionEnd(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, v.out)
	if closes(c) != 1 {
		t.Fatalf("oturum sonunda Close=%d", closes(c))
	}
}

func TestAC374P28dReleaseMicOnIdle(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- vstate("idle", call1, nil, nil)
	eventually(t, "idle", func() bool { return closes(c) == 1 })
}

func TestAC374P28dReleaseMicOnLocalEnd(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	eventually(t, "active", func() bool { _, _, _, tk, _ := c.get(); return len(tk) == 1 })
	v.h.events <- Event{Kind: EvVoiceEnd}
	if e, ok := v.nextVoice(t).(signal.VoiceEnd); !ok || e.CallID != call1 || e.Reason != signal.VoiceEndCustomer {
		t.Fatalf("voice.end{customer}: %+v", e)
	}
	eventually(t, "bırakma", func() bool { return closes(c) == 1 })
	// Üst üste tetikleyiciler: yine tek Close; sunucu bitiş yayını ve oturum sonu yeni mesaj üretmez.
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	v.c.toClient <- vstate("idle", call1, nil, nil)
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("bitişten sonra ek voice.*: %+v", got)
	}
	v.c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, v.out)
	if closes(c) != 1 {
		t.Fatalf("Close %d kez", closes(c))
	}
}

func TestAC374P28dDeviceErrorSendsDeviceEnd(t *testing.T) {
	v := startVoice(t, &fakeOpener{err: errors.New("E_ACCESSDENIED")})
	v.ask(t, call1)
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	if a, ok := v.nextVoice(t).(signal.VoiceAnswer); !ok || !a.Accept {
		t.Fatalf("voice.answer: %+v", a)
	}
	if e, ok := v.nextVoice(t).(signal.VoiceEnd); !ok || e.CallID != call1 || e.Reason != signal.VoiceEndDevice {
		t.Fatalf("voice.end{device}: %+v", e)
	}
	eventually(t, "aygıt notu", func() bool { b, _ := v.ui.lastBar(); return !b.On && b.Note == VoiceTexts.Device })
}

func TestAC374P28dDeviceLostMidCallSendsDeviceEnd(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.op.mu.Lock()
	fail := v.op.onFail
	v.op.mu.Unlock()
	fail(errors.New("AUDCLNT_E_DEVICE_INVALIDATED"))
	if e, ok := v.nextVoice(t).(signal.VoiceEnd); !ok || e.Reason != signal.VoiceEndDevice {
		t.Fatalf("voice.end{device}: %+v", e)
	}
	eventually(t, "bırakma", func() bool { return closes(c) == 1 })
	fail(errors.New("ikinci")) // bayat: yeni mesaj yok
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("bayat aygıt hatası: %+v", got)
	}
}

func TestAC374P28dStaleOpenClosedImmediately(t *testing.T) {
	t.Run("idle açılış sürerken", func(t *testing.T) {
		op := &fakeOpener{block: make(chan struct{})}
		v := startVoice(t, op)
		v.ask(t, call1)
		v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
		v.nextVoice(t)
		recv(t, op.started)
		v.c.toClient <- vstate("idle", call1, nil, nil)
		eventually(t, "bitiş", func() bool { b, _ := v.ui.lastBar(); return b.Note == VoiceTexts.Ended })
		close(op.block)
		eventually(t, "bayat çağrı kapanır", func() bool {
			_, calls := op.count()
			return len(calls) == 1 && closes(calls[0]) == 1
		})
		if _, _, p, _, _ := func() (int, bool, []string, []string, []string) { _, c := op.count(); return c[0].get() }(); len(p) != 0 {
			t.Fatalf("bayat çağrı eşlere bağlandı: %v", p)
		}
	})
	t.Run("oturum açılış sürerken biter", func(t *testing.T) {
		op := &fakeOpener{block: make(chan struct{})}
		v := startVoice(t, op)
		v.ask(t, call1)
		v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
		v.nextVoice(t)
		recv(t, op.started)
		v.c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
		recv(t, v.out)
		close(op.block)
		eventually(t, "açılan = kapanan", func() bool {
			n, calls := op.count()
			return n == 1 && len(calls) == 1 && closes(calls[0]) == 1
		})
	})
}

// --- O-PD-3 -----------------------------------------------------------------------------------------------------

func TestAC379P28dUnattendedNoFeatureNoOpen(t *testing.T) {
	op := &fakeOpener{started: make(chan struct{}, 4)}
	ui := &fakeVoiceUI{}
	full := Deps{VoiceUI: ui, OpenVoice: op.open, RosterUI: &fakeRoster{}}
	if !slices.Contains(Features(full), signal.FeatureVoice) {
		t.Fatal("tam bağlı istemci voice1 bildirmeli")
	}
	for name, d := range map[string]Deps{
		"gözetimsiz": {VoiceUI: ui, OpenVoice: op.open, RosterUI: &fakeRoster{}, Unattended: true},
		"VoiceUI":    {OpenVoice: op.open, RosterUI: &fakeRoster{}},
		"OpenVoice":  {VoiceUI: ui, RosterUI: &fakeRoster{}},
		"RosterUI":   {VoiceUI: ui, OpenVoice: op.open},
	} {
		if voiceOn(d) || slices.Contains(Features(d), signal.FeatureVoice) {
			t.Errorf("%s: voice1 bildirilmemeli", name)
		}
	}
	d := full
	d.Unattended = true
	s := &session{d: d, conn: newConn(), peerEv: make(chan peerEvent, 4)}
	s.multi.roster = voiceRoster().Techs
	ctx := context.Background()
	s.onVoiceServer(ctx, signal.VoiceRequest{T: "voice.request", CallID: call1, By: tidA})
	s.onVoiceUser(ctx, Event{Kind: EvVoiceAccept, CallID: call1})
	s.onVoiceServer(ctx, vstate("active", call1, []string{tidA}, []string{tidA}))
	if n, _ := op.count(); n != 0 {
		t.Fatalf("gözetimsizde OpenVoice çağrıldı (%d)", n)
	}
	if a, _, b := ui.snapshot(); len(a) != 0 || len(b) != 0 {
		t.Fatalf("gözetimsizde ses arayüzü: %v %v", a, b)
	}
	if s.handlers(ctx, tidA, 1).Audio != nil {
		t.Fatal("gözetimsizde ses alıcısı kuruldu")
	}
}

// --- Y-PD-3 / D-PD-3 / gönderim kapısı ---------------------------------------------------------------------------

func TestAC378P28dNewListenerAnnounced(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1, tidC)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidC})
	eventually(t, "active görünüm", func() bool {
		b, _ := v.ui.lastBar()
		return b.On && slices.Equal(b.Talkers, []string{"TA"}) && slices.Equal(b.Listeners, []string{"TC"})
	})
	if _, _, bars := v.ui.snapshot(); slices.ContainsFunc(bars, func(b VoiceView) bool { return len(b.Announce) > 0 }) {
		t.Fatal("diyalogda gösterilen dinleyici duyuruldu")
	}
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB, tidC})
	eventually(t, "duyuru", func() bool { b, _ := v.ui.lastBar(); return slices.Equal(b.Announce, []string{"TB"}) })
	v.c.toClient <- vstate("active", call1, []string{tidA, tidB}, []string{tidA, tidB, tidC})
	eventually(t, "katılım", func() bool {
		b, _ := v.ui.lastBar()
		return slices.Equal(b.Talkers, []string{"TA", "TB"}) && len(b.Announce) == 0
	})
	// Roster dışı tid (D-PD-3) motora ve görünüme girmez.
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, "DDDDDDDDDDD"})
	eventually(t, "roster süzgeci", func() bool {
		_, _, _, tk, ls := c.get()
		return slices.Equal(tk, []string{tidA}) && slices.Equal(ls, []string{tidA})
	})
}

func TestAC374P28dMuteIsLocal(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.h.events <- Event{Kind: EvVoiceMute, On: true}
	eventually(t, "sessiz", func() bool { _, m, _, _, _ := c.get(); b, _ := v.ui.lastBar(); return m && b.Muted && b.On })
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("sessize alma sunucuya gitti: %+v", got)
	}
	v.h.events <- Event{Kind: EvVoiceMute, On: false}
	eventually(t, "açık", func() bool { _, m, _, _, _ := c.get(); return !m })
}

func TestAC378P28dPeerBinding(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	if _, _, p, _, _ := c.get(); !slices.Equal(p, []string{tidA, tidB}) {
		t.Fatalf("eşler: %v", p)
	}
	if v.offer(t, tidC) == nil {
		t.Fatal("C eşi kurulmadı")
	}
	eventually(t, "yeni eş", func() bool { _, _, p, _, _ := c.get(); return len(p) == 3 })
	v.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidC, "observer"})
	eventually(t, "düşen eş", func() bool { _, _, p, _, _ := c.get(); return slices.Equal(p, []string{tidA, tidC}) })
}

func TestP28dAudioPushRacesRelease(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
				v.pa.h.Audio(1, []byte{1})
			}
		}
	}()
	eventually(t, "push", func() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.pushes > 0 })
	v.h.events <- Event{Kind: EvVoiceEnd}
	eventually(t, "bırakma", func() bool { return closes(c) == 1 })
	close(stop)
	<-done
}

// TestP28dRunEventsInMultiMode peerEvent{run} (zamanlayıcı/goroutine sonucu) kontrol sahibi tid'i dolu iken de
// çalışır (P28c'den beri tid'e göre süzme run'ı yutuyordu: rec ack zamanlayıcısı, pano/yazdırma, OpenVoice sonucu).
func TestP28dRunEventsInMultiMode(t *testing.T) {
	s := &session{d: withDefaults(Deps{}), peers: map[string]*techPeer{}}
	s.setCtrl(tidA)
	ran := false
	s.onPeer(context.Background(), peerEvent{run: func() { ran = true }})
	if !ran {
		t.Fatal("multi kipinde run olayı çalışmadı")
	}
}

func TestAC374P28dReleaseMicOnHello(t *testing.T) {
	v := startVoice(t, nil)
	v.ask(t, call1)
	// Aynı sokette ikinci hello: açık diyalog kararsız kapanır; eski diyaloğun kabulü yanıt/mikrofon üretmez.
	v.c.toClient <- hello(token)
	expectCall(t, v.h.ui, "status:"+statusReconnected)
	if _, cl, _ := v.ui.snapshot(); !slices.Equal(cl, []string{call1}) {
		t.Fatalf("hello diyaloğu kapatmadı: %v", cl)
	}
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("hello sonrası eski diyalog yanıt verdi: %+v", got)
	}
	if n, _ := v.op.count(); n != 0 {
		t.Fatalf("opens=%d", n)
	}
}

func TestAC374P28dHelloReleasesOpenCall(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1)
	v.c.toClient <- hello(token)
	eventually(t, "hello bırakır", func() bool { return closes(c) == 1 })
	if b, _ := v.ui.lastBar(); b.On {
		t.Fatalf("hello sonrası gösterge açık: %+v", b)
	}
}

func TestAC374P28dAskClosedWhenRequesterLeavesRoster(t *testing.T) {
	v := startVoice(t, nil)
	v.ask(t, call1)
	v.c.toClient <- rosterOf(tidB, [2]string{tidB, "participant"}, [2]string{tidC, "observer"})
	eventually(t, "diyalog kapanır", func() bool { _, cl, _ := v.ui.snapshot(); return slices.Equal(cl, []string{call1}) })
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("kapanan diyalog yanıt verdi: %+v", got)
	}
}

func TestAC374P28dLocalEndBeforeActiveThenLateActiveEndsOnce(t *testing.T) {
	v := startVoice(t, nil)
	c := v.accepted(t, call1) // yerelde hâlâ pending (active gelmedi)
	v.h.events <- Event{Kind: EvVoiceEnd}
	eventually(t, "bırakma", func() bool { return closes(c) == 1 })
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("pending'de voice.end gönderildi: %+v", got)
	}
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB})
	got := v.voiceSent(300 * time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("geç active → tek voice.end beklenirdi: %+v", got)
	}
	if e, ok := got[0].(signal.VoiceEnd); !ok || e.Reason != signal.VoiceEndCustomer {
		t.Fatalf("voice.end{customer}: %+v", got[0])
	}
	if n, _ := v.op.count(); n != 1 {
		t.Fatalf("geç active mikrofon açtı: %d", n)
	}
}
