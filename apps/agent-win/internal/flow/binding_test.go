package flow

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
)

const prevKey = "rsb_PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP"
const newKey = "rsb_NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"

var multiTrue = true

type fakeBinding struct {
	mu      sync.Mutex
	prev    string
	issued  []signal.BindingIssued
	changed string
	multis  []bool
	skip    string // doluysa Request ok=false ve bu not
	limited string
}

func (b *fakeBinding) Request(multi bool) (signal.BindingRequest, string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.multis = append(b.multis, multi)
	if b.skip != "" {
		return signal.BindingRequest{}, b.skip, false
	}
	r := signal.BindingRequest{T: "binding.request"}
	if multi && b.prev != "" {
		r.PreviousKeys = []string{b.prev}
	}
	return r, "", true
}

func (b *fakeBinding) Limited() string { return b.limited }
func (b *fakeBinding) Issued(m signal.BindingIssued) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.issued = append(b.issued, m)
	return b.changed
}

func (b *fakeBinding) count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.issued)
}

func issued() signal.BindingIssued {
	firm := "Örnek A.Ş."
	return signal.BindingIssued{T: "binding.issued", BindingKey: newKey, TenantName: "Nokta", CustomerFirmName: &firm}
}

// noMore kanalda belirtilen sürede mesaj olmadığını doğrular.
func noMore(t *testing.T, ch <-chan signal.Outbound) {
	t.Helper()
	select {
	case m := <-ch:
		t.Fatalf("beklenmeyen gönderim: %#v", m)
	case <-time.After(100 * time.Millisecond):
	}
}

// startAdmitted kayıt işleyicili (nil olabilir) oturumu kod akışıyla başlatır, hello gönderir ve ilk share.state'i
// tüketir.
func startAdmitted(t *testing.T, b BindingHandler) (*harness, chan Outcome, *fakeConn) {
	t.Helper()
	h := newHarness(t)
	h.deps.Binding = b
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent) // share.state
	return h, out, c
}

// noCall birikmiş arayüz çağrılarında bad'e uyan olmadığını doğrular.
func noCall(t *testing.T, u *fakeUI, bad func(call string) bool, msg string) {
	t.Helper()
	for {
		select {
		case call := <-u.calls:
			if bad(call) {
				t.Fatal(msg)
			}
		default:
			return
		}
	}
}

// TestAC181OfferRequestIssuedOnlyAfterAdmit teklif → istek (önceki anahtarla) → kayıt yazılır; ikinci teklif (yeniden
// bağlanma) kayıt alındıktan sonra yok sayılır; AC-187 bilgisi Outcome'a taşınır.
func TestAC181OfferRequestIssuedOnlyAfterAdmit(t *testing.T) {
	b := &fakeBinding{prev: prevKey, changed: "Nokta – Örnek A.Ş."}
	h, out, c := startAdmitted(t, b)
	c.toClient <- signal.BindingOffer{T: "binding.offer", Multi: &multiTrue}
	req, ok := recv(t, c.sent).(signal.BindingRequest)
	if !ok || len(req.PreviousKeys) != 1 || req.PreviousKeys[0] != prevKey || req.PreviousKey != "" {
		t.Fatalf("binding.request: %#v", req)
	}
	c.toClient <- issued()
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	noMore(t, c.sent)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	o := recv(t, out)
	if b.count() != 1 || o.BindingChanged != "Nokta – Örnek A.Ş." {
		t.Fatalf("issued=%d %+v", b.count(), o)
	}
	if h.ui.welcomes[0].RememberNote == "" {
		t.Fatal("AC-188: karşılamada bilgi satırı olmalı")
	}
}

// TestAC181NoOfferNoRequest teklifsiz sunucu (eski sunucu / 0.9.x yolu): istek gönderilmez, istenmemiş issued yazılmaz.
func TestAC181NoOfferNoRequest(t *testing.T) {
	b := &fakeBinding{}
	_, out, c := startAdmitted(t, b)
	c.toClient <- issued()
	noMore(t, c.sent)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	if o := recv(t, out); b.count() != 0 || o.BindingChanged != "" {
		t.Fatalf("istenmemiş kayıt yazıldı: %d %+v", b.count(), o)
	}
}

// TestAC181ErrorAfterRequestSwallowedSessionContinues kayıt reddi (CONFLICT) oturumu etkilemez, durum satırına yazılmaz;
// sonraki teklife yeniden istek gider (kayıt alınmadı); önceki anahtar yoksa alan boş.
func TestAC181ErrorAfterRequestSwallowedSessionContinues(t *testing.T) {
	h, out, c := startAdmitted(t, &fakeBinding{})
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	if req := recv(t, c.sent).(signal.BindingRequest); req.PreviousKey != "" {
		t.Fatalf("köken eşleşmeyen/yok anahtar gönderilmemeli: %#v", req)
	}
	c.toClient <- signal.ErrorMsg{T: "error", Code: "CONFLICT", Message: "Kayıt verilemedi"}
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	if _, ok := recv(t, c.sent).(signal.BindingRequest); !ok {
		t.Fatal("kayıt alınmadıysa yeni teklife istek gitmeli")
	}
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
	noCall(t, h.ui, func(call string) bool { return call == "status:Kayıt verilemedi" }, "kayıt hatası kullanıcıya gösterilmemeli")
}

// TestBP8c22OfferInLobbyIgnored B-P8c2-2: hello'dan önce (lobide) gelen teklif yanıtlanmaz.
func TestBP8c22OfferInLobbyIgnored(t *testing.T) {
	h := newHarness(t)
	h.deps.Binding = &fakeBinding{prev: prevKey}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	expectCall(t, h.ui, "lobby:1234:Ali Teknisyen")
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	noMore(t, c.sent)
	h.events <- Event{Kind: EvEnd}
	if _, ok := recv(t, c.sent).(signal.SessionEnd); !ok {
		t.Fatal("lobide yalnız session.end gitmeli")
	}
	recv(t, out)
}

// TestS5OnlyBindingErrorCodesSwallowed istek beklerken kayıt yolu dışındaki hata kodu (ör. VALIDATION) durum satırına
// yazılır; kayıt kodları (CONFLICT) yutulur.
func TestS5OnlyBindingErrorCodesSwallowed(t *testing.T) {
	h, out, c := startAdmitted(t, &fakeBinding{})
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	recv(t, c.sent)
	c.toClient <- signal.ErrorMsg{T: "error", Code: "VALIDATION", Message: "başka hata"}
	expectCall(t, h.ui, "status:başka hata")
	c.toClient <- signal.ErrorMsg{T: "error", Code: "CONFLICT", Message: "Kayıt verilemedi"}
	c.toClient <- signal.ErrorMsg{T: "error", Code: "NOT_FOUND", Message: "sonraki"}
	expectCall(t, h.ui, "status:sonraki")
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
}

// TestAC181BindingDisabledIgnoresOffer Binding nil → teklif yok sayılır, karşılamada AC-188 satırı yok.
func TestAC181BindingDisabledIgnoresOffer(t *testing.T) {
	h, out, c := startAdmitted(t, nil)
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	noMore(t, c.sent)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
	if h.ui.welcomes[0].RememberNote != "" {
		t.Fatal("kayıt kapalıyken bilgi satırı olmamalı")
	}
}

// TestAC181LobbyCloseNoBinding onay verilmeden (lobide Vazgeç) kapanan oturumda hello yok → kayıt yok.
func TestAC181LobbyCloseNoBinding(t *testing.T) {
	h := newHarness(t)
	b := &fakeBinding{}
	h.deps.Binding = b
	out := make(chan Outcome, 1)
	go func() { out <- Run(context.Background(), h.deps, "12345678") }()
	c := recv(t, h.conns)
	expectCall(t, h.ui, "lobby:1234:Ali Teknisyen")
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent)
	if o := recv(t, out); b.count() != 0 || o.BindingChanged != "" {
		t.Fatal("onaysız oturumda kayıt olmamalı")
	}
}

// TestAC254OldServerOfferPassesMultiFalse eski sunucu teklifi (`multi` yok) işleyiciye multi=false olarak iletilir;
// işleyici `previousKey` üretmez (fake: yalnız multi'de anahtar) — 0.12 eski sunucuya önceki anahtar göndermez.
func TestAC254OldServerOfferPassesMultiFalse(t *testing.T) {
	b := &fakeBinding{prev: prevKey}
	_, out, c := startAdmitted(t, b)
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	req := recv(t, c.sent).(signal.BindingRequest)
	if req.PreviousKey != "" || req.PreviousKeys != nil || len(b.multis) != 1 || b.multis[0] {
		t.Fatalf("%#v multis=%v", req, b.multis)
	}
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
}

// TestAC254RequestSkippedShowsNote işleyici istek vermezse (5 dolu + eski sunucu, üçüncü köken) hiçbir şey gönderilmez,
// sonraki teklifler de yanıtlanmaz; not oturum sonunda.
func TestAC254RequestSkippedShowsNote(t *testing.T) {
	b := &fakeBinding{skip: "Bu bilgisayarda başka iki sunucunun kayıtları var."}
	_, out, c := startAdmitted(t, b)
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	c.toClient <- signal.BindingOffer{T: "binding.offer", Multi: &multiTrue}
	noMore(t, c.sent)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	if o := recv(t, out); o.BindingChanged != b.skip || len(b.multis) != 1 {
		t.Fatalf("%+v multis=%v", o, b.multis)
	}
}

// TestAC254BindingLimitSessionContinues `error BINDING_LIMIT` oturumu bitirmez, durum satırına yazılmaz, sonraki teklif
// yanıtlanmaz; işleyicinin metni oturum sonunda.
func TestAC254BindingLimitSessionContinues(t *testing.T) {
	b := &fakeBinding{prev: prevKey, limited: "Bu bilgisayar 5 firmaya kayıtlı; Nokta için kayıt alınmadı."}
	h, out, c := startAdmitted(t, b)
	c.toClient <- signal.BindingOffer{T: "binding.offer", Multi: &multiTrue}
	recv(t, c.sent)
	c.toClient <- signal.ErrorMsg{T: "error", Code: "BINDING_LIMIT", Message: "Bu bilgisayar en çok 5 firmaya kayıtlı olabilir"}
	c.toClient <- signal.BindingOffer{T: "binding.offer", Multi: &multiTrue}
	noMore(t, c.sent)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	o := recv(t, out)
	if o.BindingChanged != b.limited || b.count() != 0 {
		t.Fatalf("%+v", o)
	}
	noCall(t, h.ui, func(call string) bool { return strings.HasPrefix(call, "status:Bu bilgisayar en çok") },
		"BINDING_LIMIT sunucu metni durum satırına yazılmamalı")
}
