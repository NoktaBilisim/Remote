package flow

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/signal"
)

// recFakeUI fakeUI + flow.RecUI (P28e). record: karşılamadaki kayıt kutusunun gönderimdeki durumu.
type recFakeUI struct {
	*fakeUI
	record  bool
	offered chan bool
}

func (u *recFakeUI) WelcomeRec(ctx context.Context, w Welcome) (string, bool, bool) {
	u.offered <- w.RecOffered
	name, ok := u.Welcome(ctx, w)
	return name, u.record && w.RecOffered, ok
}

func (u *recFakeUI) RecState(v RecView) {
	switch {
	case v.On && v.Stopping:
		u.log("rec:stopping")
	case v.On:
		u.log("rec:on")
	default:
		u.log("rec:off:" + v.Note)
	}
}

var validOffer = &api.RecordingOffer{Offered: true, Line: signal.RecConsentLine, LineSha256: signal.RecConsentLineSHA256}

type recRig struct {
	h    *harness
	ui   *recFakeUI
	live chan bool
	out  chan Outcome
	c    *fakeConn
}

// startRec kod yolu: karşılama (kutu) → join → hello → paylaşım. İlk sokette hello sonrası gönderilenler döner
// (share.state{sharing} dahil).
func startRec(t *testing.T, offer *api.RecordingOffer, record bool) (*recRig, []signal.Outbound) {
	t.Helper()
	h := newHarness(t)
	h.api.rec = offer
	r := &recRig{h: h, ui: &recFakeUI{fakeUI: h.ui, record: record, offered: make(chan bool, 4)}, live: make(chan bool, 32)}
	h.deps.UI = r.ui
	h.deps.RecAckWait = 50 * time.Millisecond
	h.media.live = r.live
	r.out = start(h, "12345678")
	recv(t, h.creds)
	r.c = recv(t, h.conns)
	r.c.toClient <- hello(token)
	recv(t, h.peers)
	var sent []signal.Outbound
	for {
		m := recv(t, r.c.sent)
		sent = append(sent, m)
		if sh, ok := m.(signal.ShareState); ok && sh.State == "sharing" {
			break
		}
	}
	r.expectLive(t, true)
	return r, sent
}

func (r *recRig) expectLive(t *testing.T, want bool) {
	t.Helper()
	if got := recv(t, r.live); got != want {
		t.Fatalf("yayın durumu %v, beklenen %v", got, want)
	}
}

func consents(sent []signal.Outbound) int {
	n := 0
	for _, m := range sent {
		if _, ok := m.(signal.RecConsent); ok {
			n++
		}
	}
	return n
}

// AC-381: kutu yalnız teklif geçerliyken gösterilir; işaretsiz/teklifsiz/farklı SHA → rec.consent gönderilmez.
func TestAC381NoConsentWithoutOfferOrCheck(t *testing.T) {
	bad := &api.RecordingOffer{Offered: true, Line: "başka", LineSha256: zeroSHA}
	cases := []struct {
		name    string
		offer   *api.RecordingOffer
		record  bool
		offered bool
	}{
		{"teklif yok", nil, true, false},
		{"teklif kapalı", &api.RecordingOffer{LineSha256: signal.RecConsentLineSHA256}, true, false},
		{"SHA farklı", bad, true, false},
		{"teklif var, kutu işaretsiz", validOffer, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, sent := startRec(t, c.offer, c.record)
			if got := recv(t, r.ui.offered); got != c.offered {
				t.Fatalf("kutu gösterimi %v, beklenen %v", got, c.offered)
			}
			if n := consents(sent); n != 0 {
				t.Fatalf("rec.consent gönderilmemeli: %+v", sent)
			}
			noSend(t, r.c)
		})
	}
}

// AC-381 / K-P28e-3: işaretliyse admit sonrası ilk hello'da tam bir kez ve İLK mesaj olarak (paylaşım seçiminden
// önce) rec.consent{lineSha256}; yeniden bağlanmada tekrar gönderilmez.
func TestAC381ConsentSentOnceFirstAfterHello(t *testing.T) {
	r, sent := startRec(t, validOffer, true)
	if !recv(t, r.ui.offered) {
		t.Fatal("kutu gösterilmeli")
	}
	m, ok := sent[0].(signal.RecConsent)
	if !ok || m.LineSha256 != signal.RecConsentLineSHA256 || consents(sent) != 1 {
		t.Fatalf("ilk mesaj tek rec.consent olmalı: %+v", sent)
	}
	r.c.toClient <- errors.New("ağ koptu")
	recv(t, r.h.creds)
	c2 := recv(t, r.h.conns)
	c2.toClient <- hello(token)
	recv(t, r.h.peers)
	if sh, ok := recv(t, c2.sent).(signal.ShareState); !ok || sh.State != "sharing" {
		t.Fatalf("yeniden bağlanmada rec.consent tekrar gitmemeli: %+v", sh)
	}
}

// AC-382: rec.state{on} → gösterge/şerit; "Kaydı durdur" → rec.revoke; off → bilgi satırı. Kapalıyken durdur yok sayılır.
func TestAC382IndicatorAndStop(t *testing.T) {
	r, _ := startRec(t, validOffer, true)
	r.h.events <- Event{Kind: EvRecStop} // kayıt kapalı: etkisiz
	noSend(t, r.c)
	on := true
	r.c.toClient <- signal.RecState{T: "rec.state", On: &on}
	expectCall(t, r.h.ui, "rec:on")
	r.h.events <- Event{Kind: EvRecStop}
	if _, ok := recv(t, r.c.sent).(signal.RecRevoke); !ok {
		t.Fatal("rec.revoke beklenir")
	}
	expectCall(t, r.h.ui, "rec:stopping")
	r.h.events <- Event{Kind: EvRecStop} // çift tıklama: ikinci revoke yok
	off := false
	r.c.toClient <- signal.RecState{T: "rec.state", On: &off, Reason: "revoked"}
	expectCall(t, r.h.ui, "rec:off:"+recOffNotes["revoked"])
	noSend(t, r.c)
	select {
	case v := <-r.live:
		t.Fatalf("onay süresinde geldi: yayın değişmemeli (%v)", v)
	case <-time.After(150 * time.Millisecond):
	}
}

// S-P28e-2: revoke'tan RecAckWait sonra off yoksa yayın yerelde duraklar + metin; off gelince yayın kendiliğinden sürer.
func TestSP28e2PauseWithoutAckThenResume(t *testing.T) {
	r, _ := startRec(t, validOffer, true)
	on, off := true, false
	r.c.toClient <- signal.RecState{T: "rec.state", On: &on}
	expectCall(t, r.h.ui, "rec:on")
	r.h.events <- Event{Kind: EvRecStop}
	recv(t, r.c.sent)
	r.expectLive(t, false)
	expectCall(t, r.h.ui, "status:"+RecTexts.Paused)
	r.c.toClient <- signal.RecState{T: "rec.state", On: &off, Reason: "revoked"}
	expectCall(t, r.h.ui, "rec:off:"+recOffNotes["revoked"])
	r.expectLive(t, true)
}

// S-P28e-2: soket kopukken/kopunca bekleyen rec.revoke yeni sokette hello sonrası İLK mesajdır; duraklama yeniden
// bağlanmada sürer (hello.rec{on}), off gelince yayın başlar.
func TestSP28e2PendingRevokeFirstAfterReconnect(t *testing.T) {
	r, _ := startRec(t, validOffer, true)
	on, off := true, false
	r.c.toClient <- signal.RecState{T: "rec.state", On: &on}
	expectCall(t, r.h.ui, "rec:on")
	r.h.events <- Event{Kind: EvRecStop}
	recv(t, r.c.sent) // ilk revoke (sunucuya ulaşmadı sayılır)
	r.expectLive(t, false)
	expectCall(t, r.h.ui, "status:"+RecTexts.Paused)
	r.c.toClient <- errors.New("ağ koptu")
	recv(t, r.h.creds)
	c2 := recv(t, r.h.conns)
	hl := hello(token)
	hl.Rec = &signal.RecHello{On: &on}
	c2.toClient <- hl
	recv(t, r.h.peers)
	if _, ok := recv(t, c2.sent).(signal.RecRevoke); !ok {
		t.Fatal("yeni sokette ilk mesaj rec.revoke olmalı")
	}
	if sh, ok := recv(t, c2.sent).(signal.ShareState); !ok || sh.State != "sharing" {
		t.Fatalf("%+v", sh)
	}
	select {
	case v := <-r.live:
		t.Fatalf("duraklama sürmeli, yayın başlamamalı (%v)", v)
	case <-time.After(150 * time.Millisecond):
	}
	c2.toClient <- signal.RecState{T: "rec.state", On: &off, Reason: "revoked"}
	r.expectLive(t, true)
}

// K-P28e-7 / S-P28e-12: rec1 yalnız gösterge/şerit çizebilen arayüzde (RecUI) ve gözetimsiz değilken bildirilir.
func TestSP28e12FeatureOnlyWithRecUI(t *testing.T) {
	h := newHarness(t)
	if slices.Contains(Features(h.deps), signal.FeatureRec) {
		t.Fatal("RecUI yokken rec1 bildirilmemeli")
	}
	h.deps.UI = &recFakeUI{fakeUI: h.ui}
	if !slices.Contains(Features(h.deps), signal.FeatureRec) {
		t.Fatal("RecUI varken rec1 bildirilmeli")
	}
	h.deps.Unattended = true
	if slices.Contains(Features(h.deps), signal.FeatureRec) {
		t.Fatal("gözetimsizde rec1 yok")
	}
}

const zeroSHA = "0000000000000000000000000000000000000000000000000000000000000000"
