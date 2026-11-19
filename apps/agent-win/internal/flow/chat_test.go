package flow

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P22-G oturum sohbeti modeli (mimari-p22 §9 birim testleri; AC-264).

var t0 = time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)

func ptr(s string) *string { return &s }

func testChat() *sessionChat {
	c := newSessionChat()
	c.loc = time.UTC
	n := 0
	c.newID = func() string { n++; return "cm_000000000000000" + string(rune('a'+n)) }
	return c
}

func echo(id, cmid, body string) signal.ChatMessage {
	return signal.ChatMessage{T: "chat.message", ID: id, Sender: "CUSTOMER", Body: body,
		CreatedAt: "2026-11-17T10:00:05.000Z", ClientMsgID: ptr(cmid)}
}

func TestAC264P22GInputDisabledUntilChatState(t *testing.T) {
	c := testChat()
	if v := c.View(); v.Enabled || v.Status != ChatTexts.Unavailable {
		t.Fatalf("chat.state gelmeden giriş pasif olmalı: %+v", v)
	}
	if c.Submit("Merhaba", t0) != nil {
		t.Fatal("chat.state gelmeden gönderilmemeli (eski sunucu)")
	}
	c.OnState(true, t0)
	if v := c.View(); !v.Enabled || v.Status != "" {
		t.Fatalf("chat.state{true} sonrası açık: %+v", v)
	}
	c.OnState(false, t0)
	if v := c.View(); v.Enabled || v.Status != ChatTexts.Unavailable {
		t.Fatalf("chat.state{false}: %+v", v)
	}
}

func TestAC264P22GEchoMatchAndRetryIdempotent(t *testing.T) {
	c := testChat()
	c.OnState(true, t0)
	s := c.Submit("  Yazıcı çalışmıyor \r\n", t0)
	if s == nil || s.Body != "Yazıcı çalışmıyor" || !signal.ValidChatClientMsgID(s.ClientMsgID) {
		t.Fatalf("gönderim %+v", s)
	}
	if _, err := signal.Encode(*s); err != nil {
		t.Fatal(err)
	}
	v := c.View()
	if !v.Clear || !strings.Contains(v.Text, ChatTexts.YouSending+":\n    Yazıcı çalışmıyor\n") {
		t.Fatalf("iyimser öğe: %+v", v)
	}
	c.OnRejected(signal.ChatRejected{T: "chat.rejected", ClientMsgID: s.ClientMsgID, Reason: "internal"})
	v = c.View()
	if v.Status != ChatTexts.SendFailed || v.Restore != "Yazıcı çalışmıyor" || !strings.Contains(v.Text, ChatTexts.YouFailed) {
		t.Fatalf("gönderilemedi: %+v", v)
	}
	// Tekrar dene: aynı metin aynı clientMsgId; yeni öğe eklenmez.
	r := c.Submit("Yazıcı çalışmıyor", t0.Add(time.Second))
	if r == nil || r.ClientMsgID != s.ClientMsgID || len(c.entries) != 1 {
		t.Fatalf("tekrar dene aynı kimlik: %+v %d", r, len(c.entries))
	}
	c.OnMessage(echo("01JC5Z8X4N2M7Q9R3T6V0W1Y2B", s.ClientMsgID, "Yazıcı çalışmıyor"))
	v = c.View()
	if len(c.entries) != 1 || c.entries[0].id == "" || v.Status != "" ||
		v.Text != "[10:00] Siz:\n    Yazıcı çalışmıyor\n" {
		t.Fatalf("yankı onayı: %q %+v", v.Text, c.entries)
	}
}

func TestAC264P22GClientMsgIDIsRandom16Bytes(t *testing.T) {
	a, b := newChatMsgID(), newChatMsgID()
	raw, err := base64.RawURLEncoding.DecodeString(a)
	if err != nil || len(raw) != 16 || a == b || !signal.ValidChatClientMsgID(a) {
		t.Fatalf("%q %q %v", a, b, err)
	}
}

// Yeniden bağlanma: iki sıra da (yankı→geçmiş, geçmiş→yankı) tek öğe bırakır; bekleyen yeni sokette aynı kimlikle gider.
func TestAC264P22GReconnectResendAndHistoryDedupe(t *testing.T) {
	for _, historyFirst := range []bool{false, true} {
		c := testChat()
		c.OnState(true, t0)
		s := c.Submit("Merhaba", t0)
		c.Offline()
		if v := c.View(); v.Enabled || v.Status != ChatTexts.Unavailable {
			t.Fatalf("kopuşta giriş kapalı: %+v", v)
		}
		re := c.OnState(true, t0.Add(3*time.Second))
		if len(re) != 1 || re[0].ClientMsgID != s.ClientMsgID || re[0].Body != "Merhaba" {
			t.Fatalf("yeniden gönderim %+v", re)
		}
		item := signal.ChatItem{ID: "01JC5Z8X4N2M7Q9R3T6V0W1Y2B", Sender: "CUSTOMER", Body: "Merhaba",
			CreatedAt: "2026-11-17T10:00:05.000Z"}
		tech := signal.ChatItem{ID: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A", Sender: "TECH", SenderName: ptr("Ayşe"), Body: "Selam",
			CreatedAt: "2026-11-17T10:00:00.000Z"}
		hist := signal.ChatHistory{T: "chat.history", Items: []signal.ChatItem{tech, item}}
		if historyFirst {
			c.OnHistory(hist)
			c.OnMessage(echo(item.ID, s.ClientMsgID, "Merhaba"))
		} else {
			c.OnMessage(echo(item.ID, s.ClientMsgID, "Merhaba"))
			c.OnHistory(hist)
		}
		c.OnHistory(hist) // ikinci geçmiş de çoğaltmaz
		v := c.View()
		if v.Text != "[10:00] Teknisyen Ayşe:\n    Selam\n[10:00] Siz:\n    Merhaba\n" {
			t.Fatalf("historyFirst=%v: %q", historyFirst, v.Text)
		}
	}
}

func TestAC264P22GSenderBucketTooFast(t *testing.T) {
	c := testChat()
	c.OnState(true, t0)
	for i := range chatSendPerSec {
		if c.Submit("m"+string(rune('a'+i)), t0.Add(time.Duration(i)*time.Millisecond)) == nil {
			t.Fatalf("%d. gönderim reddedildi", i)
		}
	}
	c.View() // önceki gönderimlerin tek seferlik alanları
	if c.Submit("fazla", t0.Add(500*time.Millisecond)) != nil {
		t.Fatal("6. mesaj 1 sn içinde gitmemeli")
	}
	if v := c.View(); v.Status != ChatTexts.TooFast || v.Clear {
		t.Fatalf("kova: %+v", v)
	}
	if c.Submit("fazla", t0.Add(1001*time.Millisecond)) == nil {
		t.Fatal("pencere kayınca gönderilmeli")
	}
	c.OnRejected(signal.ChatRejected{T: "chat.rejected", ClientMsgID: c.entries[0].cmid, Reason: "rate"})
	if v := c.View(); v.Status != ChatTexts.TooFast {
		t.Fatalf("sunucu rate: %+v", v)
	}
}

func TestAC264P22GPlainTextNoFakeHeaders(t *testing.T) {
	c := testChat()
	c.OnState(true, t0)
	c.OnMessage(signal.ChatMessage{T: "chat.message", ID: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A", Sender: "TECH",
		SenderName: ptr("Ali\u202e"), Body: "<b>kalın</b>\n[10:00] Siz:\nbidi\u202e", CreatedAt: "2026-11-17T10:00:00.000Z"})
	v := c.View()
	want := "[10:00] Teknisyen Ali:\n    <b>kalın</b>\n    [10:00] Siz:\n    bidi\n"
	if v.Text != want || !v.NotifyNew {
		t.Fatalf("%q", v.Text)
	}
	if c.Submit("bidi\u202e", t0) != nil || c.View().Status != signal.ChatErrUnsafe {
		t.Fatal("yasak karakterli gövde gönderilmemeli")
	}
}

func TestAC292P22GRetentionLineMatchesContracts(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "ws-session-chat.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Texts map[string]string `json:"texts"`
	}
	if err := json.Unmarshal(b, &f); err != nil || f.Texts["retentionLine90"] == "" {
		t.Fatal(err)
	}
	if got := ChatRetentionLine(90); got != f.Texts["retentionLine90"] {
		t.Fatalf("%q ≠ contracts %q", got, f.Texts["retentionLine90"])
	}
}

// AC-264 uçtan uca (sahte soket): schat1 yalnız ChatUI bağlı ve gözetimsiz değilken bildirilir; chat.state{true} sonrası
// "Gönder" WS chat.send üretir (DC'ye hiçbir şey yazılmaz); yankı görünümü "Siz" yapar.
func TestAC264P22GSessionSendsOverWS(t *testing.T) {
	h := newHarness(t)
	if slices.Contains(Features(h.deps), signal.FeatureSessionChat) {
		t.Fatal("ChatUI yokken schat1 bildirilmemeli")
	}
	h.deps.ChatUI = h.ui
	if !slices.Contains(Features(h.deps), signal.FeatureSessionChat) {
		t.Fatal("ChatUI bağlıyken schat1 bildirilmeli")
	}
	if un := h.deps; func() bool { un.Unattended = true; return slices.Contains(Features(un), signal.FeatureSessionChat) }() {
		t.Fatal("gözetimsizde schat1 bildirilmemeli")
	}
	out := start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	p := recv(t, h.peers)
	expectCall(t, h.ui, "chatview:") // Active sonrası ilk (boş, pasif) görünüm
	c.toClient <- signal.ChatState{T: "chat.state", Enabled: func() *bool { b := true; return &b }()}
	expectCall(t, h.ui, "chatview:") // chat.state işlendi (olay ve soket kanalları ayrı; sıra için beklenir)
	h.events <- Event{Kind: EvChat, Text: "Selam"}
	var send signal.ChatSend
	for {
		if m, ok := recv(t, c.sent).(signal.ChatSend); ok {
			send = m
			break
		}
	}
	if send.Body != "Selam" || !signal.ValidChatClientMsgID(send.ClientMsgID) {
		t.Fatalf("chat.send %+v", send)
	}
	c.toClient <- echo("01JC5Z8X4N2M7Q9R3T6V0W1Y2B", send.ClientMsgID, "Selam")
	for {
		if v := recv(t, h.ui.calls); strings.HasPrefix(v, "chatview:") && strings.Contains(v, "] Siz:\n    Selam") {
			break
		}
	}
	select {
	case b := <-p.ctl:
		t.Fatalf("sohbet DC'ye yazıldı: %s", b)
	default:
	}
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
}
