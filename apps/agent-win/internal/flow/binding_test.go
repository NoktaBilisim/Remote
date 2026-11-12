package flow

import (
	"context"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
)

const prevKey = "rsb_PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP"
const newKey = "rsb_NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"

type fakeBinding struct {
	mu      sync.Mutex
	prev    string
	issued  []signal.BindingIssued
	changed string
}

func (b *fakeBinding) PreviousKey() string { return b.prev }
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

// TestAC181OfferRequestIssuedOnlyAfterAdmit teklif → istek (önceki anahtarla) → kayıt yazılır; ikinci teklif (yeniden
// bağlanma) kayıt alındıktan sonra yok sayılır; AC-187 bilgisi Outcome'a taşınır.
func TestAC181OfferRequestIssuedOnlyAfterAdmit(t *testing.T) {
	h := newHarness(t)
	b := &fakeBinding{prev: prevKey, changed: "Nokta – Örnek A.Ş."}
	h.deps.Binding = b
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent) // share.state
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	req, ok := recv(t, c.sent).(signal.BindingRequest)
	if !ok || req.PreviousKey != prevKey {
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
	h := newHarness(t)
	b := &fakeBinding{}
	h.deps.Binding = b
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent)
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
	h := newHarness(t)
	h.deps.Binding = &fakeBinding{}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent)
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
	for {
		select {
		case call := <-h.ui.calls:
			if call == "status:Kayıt verilemedi" {
				t.Fatal("kayıt hatası kullanıcıya gösterilmemeli")
			}
			continue
		default:
		}
		break
	}
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
	h := newHarness(t)
	h.deps.Binding = &fakeBinding{}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent)
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
	h := newHarness(t)
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent)
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
