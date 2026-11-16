package flow

import (
	"encoding/json"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

// P28c K3 (mimari-p28c §4.4 Y-PC-4, §4.5, §5.1, §6.1): çoklu teknisyen eş haritası.

const (
	tidA = "AAAAAAAAAAA" // sahip + kontrol sahibi
	tidB = "BBBBBBBBBBB" // katılımcı
	tidC = "CCCCCCCCCCC" // izleyici
)

type fakeRoster struct {
	views chan RosterView
	ok    bool
	chats chan string
}

func (r *fakeRoster) ShowRoster(v RosterView) bool { r.views <- v; return r.ok }
func (r *fakeRoster) TechChat(name, text string)   { r.chats <- name + ":" + text }

func rosterOf(ctrl string, entries ...[2]string) signal.TechsRoster {
	t, f := true, false
	m := signal.TechsRoster{T: "techs.roster"}
	for i, e := range entries {
		owner := &f
		if i == 0 {
			owner = &t
		}
		role := e[1]
		if e[0] == ctrl {
			role = "controller"
		}
		m.Techs = append(m.Techs, signal.RosterEntry{TID: e[0], Name: "T" + e[0][:1], Role: role, Owner: owner, Connected: &t})
	}
	return m
}

type multiRig struct {
	h      *harness
	c      *fakeConn
	roster *fakeRoster
	out    chan Outcome
}

func startMulti(t *testing.T, drawOK bool) *multiRig {
	t.Helper()
	h := newHarness(t)
	r := &fakeRoster{views: make(chan RosterView, 8), ok: drawOK, chats: make(chan string, 8)}
	h.deps.RosterUI = r
	m := &multiRig{h: h, roster: r, out: start(h, "12345678")}
	recv(t, h.creds)
	m.c = recv(t, h.conns)
	m.c.toClient <- hello(token)
	recv(t, h.peers) // eski soket eşi "" (roster gelince kapanır)
	return m
}

// offer gönderir; eş kurulduysa onu döner (kurulmadıysa nil, 300 ms bekler).
func (m *multiRig) offer(t *testing.T, from string) *fakePeer {
	t.Helper()
	m.c.toClient <- signal.SdpOffer{T: "sdp.offer", SDP: "o-" + from, From: from}
	select {
	case p := <-m.h.peers:
		recv(t, p.offers)
		for {
			if a, ok := recv(t, m.c.sent).(signal.SdpAnswer); ok {
				if a.To != from {
					t.Fatalf("answer.To %q, beklenen %q", a.To, from)
				}
				return p
			}
		}
	case <-time.After(300 * time.Millisecond):
		return nil
	}
}

func TestAC366OfferOnlyFromDrawnRosterTid(t *testing.T) {
	m := startMulti(t, true)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	if v := recv(t, m.roster.views); len(v.Techs) != 2 || v.Controller != "TA" || v.Techs[0].Removable || !v.Techs[1].Removable {
		t.Fatalf("roster görünümü: %+v", v)
	}
	if p := m.offer(t, tidC); p != nil {
		t.Fatal("roster'da olmayan tid'in eşi kuruldu")
	}
	if p := m.offer(t, ""); p != nil {
		t.Fatal("multi1'de from'suz offer kabul edildi")
	}
	if m.offer(t, tidA) == nil || m.offer(t, tidB) == nil {
		t.Fatal("roster'daki tid'lerin eşi kurulmadı")
	}
}

func TestAC366OfferRejectedWhenNameNotDrawn(t *testing.T) {
	m := startMulti(t, false)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"})
	recv(t, m.roster.views)
	if p := m.offer(t, tidA); p != nil {
		t.Fatal("çizilemeyen ad: eş kurulmamalı (Y-PC-4)")
	}
}

func TestAC366RemoveSendsTechRemoveAndRosterDropClosesPeer(t *testing.T) {
	m := startMulti(t, true)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	recv(t, m.roster.views)
	pb := m.offer(t, tidB)
	m.h.events <- Event{Kind: EvTechRemove, TID: tidA} // sahip çıkarılamaz
	m.h.events <- Event{Kind: EvTechRemove, TID: tidB}
	for {
		if tr, ok := recv(t, m.c.sent).(signal.TechRemove); ok {
			if tr.TID != tidB {
				t.Fatalf("tech.remove %+v", tr)
			}
			break
		}
	}
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"})
	recv(t, m.roster.views)
	if !pb.isClosed() {
		t.Fatal("roster'dan düşen tid'in eşi kapanmadı")
	}
}

func TestAC366UnattendedHasNoRemove(t *testing.T) {
	m := startMulti(t, true)
	m.h.deps.Unattended = true // yalnız akış kararına bakılır: onTechRemove
	s := &session{d: m.h.deps}
	s.multi.on = true
	s.multi.roster = rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"}).Techs
	s.conn = newConn()
	s.onTechRemove(t.Context(), tidB)
	select {
	case got := <-s.conn.(*fakeConn).sent:
		t.Fatalf("gözetimsizde tech.remove gitti: %+v", got)
	default:
	}
}

func TestAC371AC367TracksAndFilesFollowController(t *testing.T) {
	m := startMulti(t, true)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	recv(t, m.roster.views)
	pa, pb := m.offer(t, tidA), m.offer(t, tidB)
	if !pa.isMain() || pb.isMain() || !m.h.media.lowOn() {
		t.Fatalf("iz: A ana %v, B ana %v, düşük %v", pa.isMain(), pb.isMain(), m.h.media.lowOn())
	}
	// katılımcıdan dosya teklifi o eşe reddedilir; işaretleme düşer
	idx, size := 1, int64(1)
	pb.h.Ctl(dc.Ctl{T: "file.offer", FID: "f1", Idx: &idx, Name: "a.txt", Size: &size, SHA: "x"})
	if b := recv(t, pb.ctl); !json.Valid(b) || string(b) != `{"t":"file.reject","fid":"f1"}` {
		t.Fatalf("ret: %s", b)
	}
	// kontrol devri: B kontrol sahibi → iz takası
	m.c.toClient <- rosterOf(tidB, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	recv(t, m.roster.views)
	if pa.isMain() || !pb.isMain() {
		t.Fatal("devirde iz takası yapılmadı")
	}
}

func TestAC367InputGateFollowsController(t *testing.T) {
	h := newHarness(t)
	in := make(chan string, 4)
	h.deps.Input = func(b []byte) { in <- string(b) }
	s := &session{d: h.deps}
	s.setCtrl(tidA)
	fa, fb := s.peerInput(tidA), s.peerInput(tidB)
	fb([]byte("b"))
	fa([]byte("a"))
	if v := recv(t, in); v != "a" {
		t.Fatalf("girdi %q", v)
	}
	s.setCtrl(tidB)
	fa([]byte("a2"))
	fb([]byte("b2"))
	if v := recv(t, in); v != "b2" {
		t.Fatalf("devir sonrası girdi %q", v)
	}
}

func TestP28cChatRelayAndObserverDropped(t *testing.T) {
	m := startMulti(t, true)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"}, [2]string{tidC, "observer"})
	recv(t, m.roster.views)
	pa, pb, pc := m.offer(t, tidA), m.offer(t, tidB), m.offer(t, tidC)
	ts := int64(5)
	pb.h.Ctl(dc.Ctl{T: "chat", ID: "m1", Text: "selam", TS: &ts})
	if v := recv(t, m.roster.chats); v != "TB:selam" {
		t.Fatalf("sohbet %q", v)
	}
	for _, p := range []*fakePeer{pa, pc} {
		b := recv(t, p.ctl)
		var f map[string]any
		if json.Unmarshal(b, &f) != nil || f["by"] != tidB || f["text"] != "selam" {
			t.Fatalf("yayın %s", b)
		}
	}
	pc.h.Ctl(dc.Ctl{T: "chat", ID: "m2", Text: "gizli", TS: &ts})
	select {
	case v := <-m.roster.chats:
		t.Fatalf("izleyici sohbeti gösterildi: %s", v)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestP28cInvalidRosterEndsSession(t *testing.T) {
	m := startMulti(t, true)
	bad := rosterOf(tidA, [2]string{tidA, "participant"})
	bad.Techs[0].Role = "participant" // kontrol sahibi yok
	m.c.toClient <- bad
	if o := recv(t, m.out); o.Message != msgProtocol {
		t.Fatalf("değişmez ihlali: %+v", o)
	}
}

// multi1'de peer.left/joined{tech} yok: kontrol sahibinin kopup dönmesi roster'ın connected alanından durum metnine
// yansır (kontrol sahibi değişmeden).
func TestP28cControllerDisconnectAndReturnStatus(t *testing.T) {
	m := startMulti(t, true)
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	recv(t, m.roster.views)
	pb := m.offer(t, tidB)
	lost := rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	f := false
	lost.Techs[0].Connected = &f
	m.c.toClient <- lost
	expectCall(t, m.h.ui, "status:"+statusTechLeft)
	if v := recv(t, m.roster.views); v.Techs[0].Connected || v.Controller != "TA" {
		t.Fatalf("kopuk kontrol sahibi: %+v", v)
	}
	if pb.isClosed() || !m.h.media.lowOn() {
		t.Fatal("kontrol sahibinin kopması diğer eşi/düşük izi etkilememeli")
	}
	m.c.toClient <- rosterOf(tidA, [2]string{tidA, "participant"}, [2]string{tidB, "participant"})
	expectCall(t, m.h.ui, "status:"+statusTechBack)
	if v := recv(t, m.roster.views); !v.Techs[0].Connected {
		t.Fatalf("dönen kontrol sahibi: %+v", v)
	}
}
