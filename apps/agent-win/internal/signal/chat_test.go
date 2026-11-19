package signal

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// sessionChatFixture `packages/contracts/fixtures/ws-session-chat.json` (P22-C; TS ile ortak).
type sessionChatFixture struct {
	Subprotocols map[string]string            `json:"subprotocols"`
	Constants    map[string]json.RawMessage   `json:"constants"`
	Sets         map[string][]string          `json:"sets"`
	Texts        map[string]string            `json:"texts"`
	Valid        map[string][]json.RawMessage `json:"valid"`
	Invalid      map[string][]json.RawMessage `json:"invalid"`
}

func loadSessionChat(t *testing.T) sessionChatFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "ws-session-chat.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f sessionChatFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeChatSend misafirin `chat.send`'ini katı çözer; gövde kuralı ChatBody (sunucu sırası) ile denetlenir. Zarf
// hatası env=false; gövde hatası body=false.
func decodeChatSend(raw []byte) (env, body bool) {
	var m ChatSend
	if decodeStrict(raw, &m) != nil || m.T != "chat.send" || !ValidChatClientMsgID(m.ClientMsgID) {
		return false, false
	}
	_, msg := ChatBody(m.Body)
	return true, msg == ""
}

func TestAC264P22GConstantsMatchFixture(t *testing.T) {
	f := loadSessionChat(t)
	if f.Subprotocols["schat"] != FeatureSessionChat {
		t.Fatalf("belirteç %q", f.Subprotocols["schat"])
	}
	ints := map[string]int{"CHAT_HISTORY_MAX": ChatHistoryMax, "CHAT_HISTORY_MAX_BYTES": ChatHistoryMaxBytes,
		"MESSAGE_BODY_MAX": ChatBodyMax, "MESSAGE_LINES_MAX": ChatLinesMax}
	for k, want := range ints {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s = %d, Go %d", k, got, want)
		}
	}
	var pat string
	if err := json.Unmarshal(f.Constants["CHAT_CLIENT_MSG_ID_PATTERN"], &pat); err != nil || pat != chatClientMsgIDText {
		t.Errorf("CHAT_CLIENT_MSG_ID_PATTERN %q", pat)
	}
	if !slices.Equal(f.Sets["rejectReasons"], chatRejectReasons) || !slices.Equal(f.Sets["stateReasons"], chatStateReasons) {
		t.Errorf("sözlükler %v %v", f.Sets["rejectReasons"], f.Sets["stateReasons"])
	}
	if !slices.Contains(knownFeatures, FeatureSessionChat) {
		t.Error("Dial schat1'i bilmiyor")
	}
	if p, err := subprotocols("rs.ticket."+strings.Repeat("T", 43), []string{FeatureSessionChat}); err != nil ||
		!slices.Equal(p, []string{Subprotocol, "rs.ticket." + strings.Repeat("T", 43), "rs.cap.schat1"}) {
		t.Errorf("alt protokol listesi %v %v", p, err)
	}
	if maxPayload != 64*1024 {
		t.Errorf("S-P22-1: okuma sınırı değişmemeli (%d)", maxPayload)
	}
}

// AC-264: misafir yönündeki `chat.send` örnekleri (tech/guest aynı biçim): geçerliler zarf + gövde geçer; geçersizler
// zarfta, bodyOnly yalnız gövdede reddedilir.
func TestAC264P22GChatSendMatchesFixture(t *testing.T) {
	f := loadSessionChat(t)
	for _, k := range []string{"techInbound", "guestInbound"} {
		for _, raw := range f.Valid[k] {
			if env, body := decodeChatSend(raw); !env || !body {
				t.Errorf("valid.%s reddedildi: %.80s", k, raw)
			}
		}
		for _, raw := range f.Invalid[k] {
			if env, body := decodeChatSend(raw); env && body {
				t.Errorf("invalid.%s kabul edildi: %.80s", k, raw)
			}
		}
	}
	for _, raw := range f.Invalid["bodyOnly"] {
		if env, body := decodeChatSend(raw); !env || body {
			t.Errorf("bodyOnly: zarf geçmeli, gövde reddedilmeli (%v %v): %.80s", env, body, raw)
		}
	}
}

func TestAC264P22GServerMessagesMatchFixture(t *testing.T) {
	f := loadSessionChat(t)
	for _, raw := range f.Valid["guestOutbound"] {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("valid.guestOutbound reddedildi: %v %.120s", err, raw)
		}
	}
	for _, k := range []string{"guestOutbound", "techOutbound"} {
		for _, raw := range f.Invalid[k] {
			if _, err := ParseServer(raw); err == nil {
				t.Errorf("invalid.%s kabul edildi: %.120s", k, raw)
			}
		}
	}
	// Misafire giden hello/peer.joined'da guestChat yoktur (Go ≤ 0.20 katı ayrıştırıcı; yeni istemci de reddeder).
	for _, raw := range f.Valid["techOutbound"] {
		if mt := msgType(raw); (mt == "hello" || mt == "peer.joined") && func() bool { _, err := ParseServer(raw); return err == nil }() {
			t.Errorf("guestChat'li %s misafirde kabul edilmemeli: %.120s", mt, raw)
		}
	}
}

func TestAC264P22GChatStateAndItems(t *testing.T) {
	cases := []struct {
		raw string
		ok  bool
	}{
		{`{"t":"chat.state","enabled":true}`, true},
		{`{"t":"chat.state","enabled":null}`, false},
		{`{"t":"chat.state"}`, false},
		{`{"t":"chat.history","items":null,"more":false}`, false},
		{`{"t":"chat.history","items":[]}`, false},
		{`{"t":"chat.history","items":[],"more":null}`, false},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"TECH","senderName":"","body":"x","createdAt":"2026-11-17T10:00:00.000Z"}`, false},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"TECH","tid":"kısa","body":"x","createdAt":"2026-11-17T10:00:00.000Z"}`, false},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"CUSTOMER","body":"x","createdAt":"2026-11-17T10:00:00.000Z","clientMsgId":"cm_0123456789abcd"}`, true},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"TECH","senderName":"` + strings.Repeat("😀", 100) + `","body":"x","createdAt":"2026-11-17T10:00:00.000Z"}`, true},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"TECH","senderName":"` + strings.Repeat("a", 101) + `","body":"x","createdAt":"2026-11-17T10:00:00.000Z"}`, false},
		{`{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"CUSTOMER","Body":"x","createdAt":"2026-11-17T10:00:00.000Z"}`, false},
	}
	for _, c := range cases {
		if _, err := ParseServer([]byte(c.raw)); (err == nil) != c.ok {
			t.Errorf("%s → %v", c.raw, err)
		}
	}
	// 101 öğe reddedilir.
	items := make([]string, ChatHistoryMax+1)
	for i := range items {
		items[i] = fmt.Sprintf(`{"id":"%s","sender":"CUSTOMER","body":"a","createdAt":"2026-11-17T10:00:00.000Z"}`, ulidN(i))
	}
	if _, err := ParseServer([]byte(`{"t":"chat.history","items":[` + strings.Join(items, ",") + `],"more":true}`)); err == nil {
		t.Error("101 öğe kabul edildi")
	}
}

func TestAC264P22GChatSendEncode(t *testing.T) {
	ok := ChatSend{T: "chat.send", ClientMsgID: "cm_0123456789abcd", Body: "Satır 1\nSatır 2 👍"}
	b, err := Encode(ok)
	if err != nil || string(b) != `{"t":"chat.send","clientMsgId":"cm_0123456789abcd","body":"Satır 1\nSatır 2 👍"}` {
		t.Fatalf("%s %v", b, err)
	}
	for _, m := range []ChatSend{
		{T: "chat.send", ClientMsgID: "kisa", Body: "a"},
		{T: "chat.send", ClientMsgID: "cm_0123456789abcd", Body: "  kırpılmamış "},
		{T: "chat.send", ClientMsgID: "cm_0123456789abcd", Body: "bidi\u202e"},
		{T: "chat", ClientMsgID: "cm_0123456789abcd", Body: "a"},
	} {
		if _, err := Encode(m); err == nil {
			t.Errorf("geçersiz gönderim kodlandı: %+v", m)
		}
	}
}

// ulidN geçerli, sıralı ULID (Crockford base32 son iki karakter).
func ulidN(i int) string {
	const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	return "01JC5Z8X4N2M7Q9R3T6V0W1Y" + string(a[(i/32)%32]) + string(a[i%32])
}

// budgetHistory S-P22-1: sunucu fitNewest eşi — 1.000 emojilik (4 bayt) mesajlar, çerçeve ≤ 48 KiB olana kadar.
func budgetHistory(t *testing.T) []byte {
	t.Helper()
	body := strings.Repeat("😀", ChatBodyMax)
	var items []ChatItem
	var frame []byte
	for i := 0; i < ChatHistoryMax; i++ {
		name := "Ayşe Teknisyen"
		next := append(slices.Clone(items), ChatItem{ID: ulidN(i), Sender: ChatSenderTech, SenderName: &name, Body: body,
			CreatedAt: "2026-11-17T10:00:00.000Z"})
		b, err := json.Marshal(struct {
			T     string     `json:"t"`
			Items []ChatItem `json:"items"`
			More  bool       `json:"more"`
		}{"chat.history", next, true})
		if err != nil {
			t.Fatal(err)
		}
		if len(b) > ChatHistoryMaxBytes {
			break
		}
		items, frame = next, b
	}
	if len(items) < 11 || len(frame) > ChatHistoryMaxBytes || len(frame) < 40_000 {
		t.Fatalf("bütçe çerçevesi %d öğe %d bayt", len(items), len(frame))
	}
	return frame
}

// S-P22-1: 48 KiB'a yakın bütçeli chat.history gerçek soket üzerinden (64 KiB okuma sınırı DEĞİŞMEDEN) kopmadan okunur.
func TestSP22_1BudgetedHistoryReadsOverRealSocket(t *testing.T) {
	frame := budgetHistory(t)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"rs.v1"}})
		if err != nil {
			return
		}
		_ = c.Write(r.Context(), websocket.MessageText, frame)
		_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"t":"chat.state","enabled":true}`))
		_, _, _ = c.Read(r.Context())
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	u, _ := url.Parse(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, hc, u, Credential{Ticket: strings.Repeat("T", 43)}, []string{FeatureSessionChat})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	m, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("bütçeli geçmiş okunamadı (%d bayt): %v", len(frame), err)
	}
	h, ok := m.(ChatHistory)
	if !ok || len(h.Items) < 11 || !h.More || h.Items[0].Body != strings.Repeat("😀", ChatBodyMax) {
		t.Fatalf("geçmiş %T %d", m, len(h.Items))
	}
	if m, err := conn.Read(ctx); err != nil || m.Type() != "chat.state" {
		t.Fatalf("soket geçmişten sonra açık kalmalı: %v %v", m, err)
	}
}

// S-P22G-3: zod `optional()` null'ı, `reason` enum'u boş dizgeyi reddeder (contracts ws-chat.ts:86-87,100,120). Go da
// aynı: isteğe bağlı alan varsa null/"" olamaz; yokluğu geçerli kalır.
func TestSP22G3ChatNullAndEmptyRejected(t *testing.T) {
	const msg = `{"t":"chat.message","id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"%s","body":"x","createdAt":"2026-11-17T10:00:00.000Z"%s}`
	const item = `{"id":"01JC5Z8X4N2M7Q9R3T6V0W1Y2A","sender":"%s","body":"x","createdAt":"2026-11-17T10:00:00.000Z"%s}`
	hist := func(it string) string { return `{"t":"chat.history","items":[` + it + `],"more":false}` }
	cases := []struct {
		raw string
		ok  bool
	}{
		{fmt.Sprintf(msg, "CUSTOMER", `,"tid":null`), false},
		{fmt.Sprintf(msg, "TECH", `,"tid":null`), false},
		{fmt.Sprintf(msg, "TECH", `,"senderName":null`), false},
		{fmt.Sprintf(msg, "CUSTOMER", `,"clientMsgId":null`), false},
		{fmt.Sprintf(msg, "CUSTOMER", `,"clientMsgId":""`), false},
		{fmt.Sprintf(msg, "TECH", `,"tid":"t0123456789","senderName":"Ali"`), true},
		{fmt.Sprintf(msg, "TECH", ``), true},
		{hist(fmt.Sprintf(item, "CUSTOMER", `,"tid":null`)), false},
		{hist(fmt.Sprintf(item, "TECH", `,"senderName":null`)), false},
		{hist(fmt.Sprintf(item, "TECH", `,"tid":"t0123456789","senderName":"Ali"`)), true},
		{`{"t":"chat.state","enabled":false,"reason":""}`, false},
		{`{"t":"chat.state","enabled":false,"reason":null}`, false},
		{`{"t":"chat.state","enabled":false,"reason":"ended"}`, true},
		{`{"t":"chat.state","enabled":false}`, true},
	}
	for _, c := range cases {
		if _, err := ParseServer([]byte(c.raw)); (err == nil) != c.ok {
			t.Errorf("%s → %v", c.raw, err)
		}
	}
}
