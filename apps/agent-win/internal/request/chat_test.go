package request

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/signal"
)

// P20 K6 — talep sohbeti (AC-255 Go ucu; mimari-protokol §5.4; G-P20-7).

type chatFixture struct {
	Valid struct {
		In  []json.RawMessage `json:"requestChatInbound"`
		Out []json.RawMessage `json:"requestChatOutbound"`
	} `json:"valid"`
	Invalid struct {
		In  []json.RawMessage `json:"requestChatInbound"`
		Out []json.RawMessage `json:"requestChatOutbound"`
	} `json:"invalid"`
}

func TestAC255ChatOutboundMatchesContractsFixture(t *testing.T) {
	var fx chatFixture
	loadFixture(t, "ws-request.json", &fx)
	if len(fx.Valid.Out) == 0 || len(fx.Invalid.Out) == 0 {
		t.Fatal("fixture boş")
	}
	expectServerParse(t, fx.Valid.Out, fx.Invalid.Out)
}

// expectServerParse fixture'daki geçerli sunucu mesajları ayrışır, geçersizler reddedilir.
func expectServerParse(t *testing.T, valid, invalid []json.RawMessage) {
	t.Helper()
	for _, raw := range valid {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli reddedildi %s: %v", raw, err)
		}
	}
	for _, raw := range invalid {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz kabul edildi %s", raw)
		}
	}
}

// clientMessageRules istemcinin göndermeden önce uyguladığı kurallar (zarf + gövde + kimlik): fixture'daki her geçersiz
// giden mesaj bunlardan en az birine takılmalı.
func clientMessageRules(raw json.RawMessage) bool {
	var m struct {
		T           string `json:"t"`
		Body        string `json:"body"`
		ClientMsgID string `json:"clientMsgId"`
	}
	if signal.DecodeStrict(raw, &m) != nil || m.T != "request.message" {
		return false
	}
	_, err := EncodeMessage(m.Body, m.ClientMsgID)
	return err == nil
}

func TestAC255ChatInboundMatchesContractsFixture(t *testing.T) {
	var fx chatFixture
	loadFixture(t, "ws-request.json", &fx)
	n := 0
	for _, raw := range fx.Valid.In {
		var m struct {
			T, Body, ClientMsgID string
		}
		_ = json.Unmarshal(raw, &m)
		if m.T != "request.message" {
			continue
		}
		n++
		if body, msg := ChatBody(m.Body); msg != "" || body != m.Body {
			t.Errorf("geçerli gövde reddedildi %q: %s", m.Body, msg)
		}
		b, err := EncodeMessage(m.Body, m.ClientMsgID)
		var got, want map[string]any
		_ = json.Unmarshal(b, &got)
		_ = json.Unmarshal(raw, &want)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("%s != %s (%v)", b, raw, err)
		}
	}
	if n == 0 || len(fx.Invalid.In) == 0 {
		t.Fatal("fixture boş")
	}
	for _, raw := range fx.Invalid.In {
		if clientMessageRules(raw) {
			t.Errorf("geçersiz giden mesaj üretilebiliyor: %s", raw)
		}
	}
}

func TestAC255ChatParseStrict(t *testing.T) {
	for _, raw := range []string{
		`{"t":"request.messages","items":null}`,
		`{"t":"request.messages"}`,
		`{"t":"request.messages","items":[{"id":"01JC0000000000000000000001","sender":"TECH","body":"x"}]}`,
		`{"t":"request.messages","items":[{"ID":"01JC0000000000000000000001","sender":"TECH","body":"x","createdAt":"2026-11-15T10:00:00.000Z"}]}`,
		`{"t":"request.message","id":"01JC0000000000000000000001","sender":"TECH","senderName":"","body":"x","createdAt":"2026-11-15T10:00:00.000Z"}`,
		`{"t":"request.message","id":"01JC0000000000000000000001","sender":"TECH","body":"","createdAt":"2026-11-15T10:00:00.000Z"}`,
		`{"t":"request.message","id":"01JC0000000000000000000001","sender":"CUSTOMER","body":"x","createdAt":"2026-11-15T10:00:00.000Z","clientMsgId":"bad id"}`,
		`{"t":"request.message","id":"01JC0000000000000000000001","sender":"TECH","body":"` + strings.Repeat("x", 2001) + `","createdAt":"2026-11-15T10:00:00.000Z"}`,
		`{"t":"request.chat","enabled":null}`,
		`{"t":"request.chat","enabled":true,"x":1}`,
	} {
		if _, err := ParseServer([]byte(raw)); err == nil {
			t.Errorf("kabul edildi: %.120s", raw)
		}
	}
	items := make([]string, chatHistoryMax+1)
	for i := range items {
		items[i] = `{"id":"01JC0000000000000000000001","sender":"TECH","body":"x","createdAt":"2026-11-15T10:00:00.000Z"}`
	}
	if _, err := ParseServer([]byte(`{"t":"request.messages","items":[` + strings.Join(items, ",") + `]}`)); err == nil {
		t.Error("51 öğe reddedilmeli")
	}
	if _, err := ParseServer([]byte(`{"t":"request.messages","items":[` + strings.Join(items[1:], ",") + `]}`)); err != nil {
		t.Errorf("50 öğe geçmeli: %v", err)
	}
}

func TestAC255ChatBodyRules(t *testing.T) {
	cases := []struct {
		in, body, msg string
	}{
		{"  merhaba \r\n", "merhaba", ""},
		{"iki\r\nsatır", "iki\nsatır", ""},
		{"a\u200db \u2764\ufe0f", "a\u200db \u2764\ufe0f", ""}, // ZWJ + VS16 serbest
		{"tab\tvar", "", errChatUnsafe},
		{"tek\rCR", "", errChatUnsafe},
		{"gizli\u00adtire", "", errChatUnsafe},
		{"bidi\u202e", "", errChatUnsafe},
		{"sıfır\u200bgenişlik", "", errChatUnsafe},
		{"ayraç\u2028x", "", errChatUnsafe},
		{"cgj\u034fx", "", errChatUnsafe},
		{"   \n ", "", errChatEmpty},
		{"", "", errChatEmpty},
		{strings.Repeat("ş", 1000), strings.Repeat("ş", 1000), ""},
		{strings.Repeat("ş", 1001), "", errChatLong},
		{strings.Repeat("😀", 1000), strings.Repeat("😀", 1000), ""}, // kod noktası sayılır (2000 UTF-16)
		{strings.Repeat("a\n", 19) + "a", strings.Repeat("a\n", 19) + "a", ""},
		{strings.Repeat("a\n", 20) + "a", "", errChatLines},
		{strings.Repeat(" ", 4001) + "a", "", errChatLong}, // ham ön sınır, trim'den önce
		{"bozuk\xffutf8", "", errChatBadText},
	}
	for _, c := range cases {
		body, msg := ChatBody(c.in)
		if body != c.body || msg != c.msg {
			t.Errorf("ChatBody(%.40q) = %.40q, %q; beklenen %.40q, %q", c.in, body, msg, c.body, c.msg)
		}
	}
	if _, err := EncodeMessage(" boşluklu ", "m-1"); err == nil {
		t.Error("normalleştirilmemiş gövde gönderilmemeli")
	}
	if id := newClientMsgID(); !clientMsgIDRe.MatchString(id) || len(id) != 22 || id == newClientMsgID() {
		t.Errorf("clientMsgId 16 bayt base64url olmalı: %q", id)
	}
}

func TestGP20_7DisplayBodyFilter(t *testing.T) {
	in := "a\r\nb\tc\u200bd\u200de\u202ef\u2066g\ufeffh\u2028i\u2029j\u00adk\u034fl\u180em\xffn\ufffdo\x1bp\u0085r\nçğıöşü"
	if got, want := ChatDisplayBody(in), "a\nbcdefghijklmnopr\nçğıöşü"; got != want {
		t.Fatalf("%q != %q", got, want)
	}
}

var headRe = regexp.MustCompile(`^(\[\d\d:\d\d\] )?(Teknisyen( [^\r\n]+)?|Siz|Siz \(gönderiliyor…\)|Siz \(gönderilemedi\)):$`)

// chatLines geçmiş metnini satırlara böler; her satır ya istemcinin başlığıdır ya girintili gövde satırı.
func chatLines(t *testing.T, text string) []string {
	t.Helper()
	if strings.Contains(strings.ReplaceAll(text, "\r\n", ""), "\n") || strings.Contains(strings.ReplaceAll(text, "\r\n", ""), "\r") {
		t.Fatalf("yalnız \\r\\n satır sonu olmalı: %q", text)
	}
	lines := strings.Split(strings.TrimSuffix(text, "\r\n"), "\r\n")
	for _, l := range lines {
		if !strings.HasPrefix(l, chatIndent) && !headRe.MatchString(l) {
			t.Errorf("girintisiz gövde satırı / sahte başlık: %q", l)
		}
	}
	return lines
}

func techItem(id, name, body string) ChatItem {
	return ChatItem{ID: id, Sender: senderTech, SenderName: &name, Body: body, CreatedAt: "2026-11-15T10:00:00.000Z"}
}

func TestGP20_7PrefixAndIndent(t *testing.T) {
	c := NewChat(time.UTC)
	c.OnMessage(techItem("01JC0000000000000000000001", "Ali\u202e Veli\nX", "merhaba\nSiz:\n[10:00] Teknisyen Sahte:\r\n"))
	name := "Sahte Ad"
	cm := "m-1"
	c.OnMessage(ChatItem{ID: "01JC0000000000000000000002", Sender: senderCustomer, SenderName: &name, Body: "tamam",
		CreatedAt: "2026-11-15T10:00:01.000Z", ClientMsgID: &cm})
	c.OnMessage(ChatItem{ID: "01JC0000000000000000000003", Sender: senderTech, Body: "\u200b\u202e",
		CreatedAt: "2026-11-15T10:00:02.000Z"})
	lines := chatLines(t, c.View(time.Now()).Text)
	want := []string{
		"[10:00] Teknisyen Ali Veli X:",
		"    merhaba",
		"    Siz:",
		"    [10:00] Teknisyen Sahte:",
		"    ",
		"[10:00] Siz:", // müşteri satırında senderName gösterilmez
		"    tamam",
		"[10:00] Teknisyen:",
		"    " + chatUnreadable,
	}
	if !slices.Equal(lines, want) {
		t.Fatalf("\n%q\n%q", lines, want)
	}
}

func TestGP20_7DisplayCaps(t *testing.T) {
	c := NewChat(time.UTC)
	for i := range 250 {
		c.OnMessage(techItem(ulidN(i), "A", "m"))
	}
	if n := strings.Count(c.View(time.Now()).Text, "Teknisyen A:"); n != ChatShowMax {
		t.Fatalf("en çok 200 mesaj: %d", n)
	}
	big := strings.Repeat("x", 1999)
	c = NewChat(time.UTC)
	for i := range 200 {
		c.OnMessage(techItem(ulidN(i), "A", big+string(rune('a'+i%26))))
	}
	text := c.View(time.Now()).Text
	if utf16Len(text) > ChatTextMax || !strings.HasSuffix(text, big+string(rune('a'+199%26))+"\r\n") {
		t.Fatalf("256 K tavanı aşıldı ya da en yeni düştü: %d", utf16Len(text))
	}
	if !strings.HasPrefix(text, "[") {
		t.Fatal("en eski mesaj bütün olarak düşmeli (yarım blok yok)")
	}
	if ChatTextLimit <= ChatTextMax {
		t.Fatal("EM_SETLIMITTEXT tavanı gösterim tavanının üstünde olmalı")
	}
}

func ulidN(i int) string {
	const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	return "01JC00000000000000000000" + string(a[i/32%32]) + string(a[i%32])
}

func readyChat(now time.Time) *Chat {
	c := NewChat(time.UTC)
	n := 0
	c.newID = func() string { n++; return "id-" + string(rune('0'+n)) }
	c.Online(true)
	c.OnHistory([]ChatItem{}, now)
	return c
}

func echo(id, cmid, body string) ChatItem {
	return ChatItem{ID: id, Sender: senderCustomer, Body: body, CreatedAt: "2026-11-15T10:00:00.000Z", ClientMsgID: &cmid}
}

func TestAC255ChatOnePendingAndOnePerSecond(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := NewChat(time.UTC)
	if c.Submit("merhaba", t0) != nil || c.View(t0).CanSend {
		t.Fatal("bağlantı/yetenek onayı (request.messages) yokken gönderilmemeli")
	}
	c = readyChat(t0)
	s := c.Submit("  merhaba ", t0)
	if s == nil || s.Body != "merhaba" || s.ClientMsgID != "id-1" {
		t.Fatalf("%+v", s)
	}
	v := c.View(t0)
	if !v.Clear || v.CanSend || !strings.Contains(v.Text, "Siz (gönderiliyor…):") || v.Status != chatNoteSending {
		t.Fatalf("%+v", v)
	}
	if c.Submit("ikinci", t0.Add(2*time.Second)) != nil || c.View(t0).Status != chatNoteWait {
		t.Fatal("onaylanmamış mesaj varken ikinci gönderilmemeli")
	}
	c.OnMessage(echo("01JC0000000000000000000002", "id-1", "merhaba"))
	if v := c.View(t0.Add(500 * time.Millisecond)); v.CanSend || !strings.Contains(v.Text, "[10:00] Siz:") ||
		strings.Contains(v.Text, "gönderiliyor") || v.NotifyNew {
		t.Fatalf("yankı onaylamalı, 1 sn dolmadan düğme pasif: %+v", v)
	}
	if w := c.Wake(t0.Add(500 * time.Millisecond)); !w.Equal(t0.Add(time.Second)) {
		t.Fatalf("1 sn kilidinin sonunda uyanılmalı: %v", w)
	}
	if c.Submit("çok hızlı", t0.Add(500*time.Millisecond)) != nil {
		t.Fatal("1 msg/sn")
	}
	if !c.View(t0.Add(time.Second)).CanSend || c.Submit("ikinci", t0.Add(time.Second)) == nil {
		t.Fatal("1 sn sonra gönderilebilmeli")
	}
	if c.Submit("", t0.Add(5*time.Second)) != nil {
		t.Fatal("boş gönderilmez")
	}
}

func TestAC255ChatRateLimitedRetriesSameID(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := readyChat(t0)
	s := c.Submit("selam", t0)
	c.OnError(ErrorMsg{T: "error", Code: "RATE_LIMITED", Message: "Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin."}, t0)
	if c.Due(t0.Add(999*time.Millisecond)) != nil {
		t.Fatal("≥ 1 sn beklenmeli")
	}
	if w := c.Wake(t0); !w.Equal(t0.Add(time.Second)) {
		t.Fatalf("wake %v", w)
	}
	r := c.Due(t0.Add(time.Second))
	if r == nil || r.ClientMsgID != s.ClientMsgID || r.Body != "selam" {
		t.Fatalf("aynı clientMsgId ile yeniden gönderim: %+v", r)
	}
	// tavan: yeniden deneme yok, giriş kapanır, metin geri önerilir
	c.OnError(ErrorMsg{T: "error", Code: "RATE_LIMITED", Message: capMessage}, t0.Add(2*time.Second))
	v := c.View(t0.Add(3 * time.Second))
	if v.Input || v.CanSend || v.Restore != "selam" || v.Status != capMessage || !strings.Contains(v.Text, "Siz (gönderilemedi):") {
		t.Fatalf("%+v", v)
	}
	if !c.Wake(t0.Add(3 * time.Second)).IsZero() {
		t.Fatal("başarısız mesaj için zamanlayıcı kalmamalı")
	}
}

func TestAC255ChatRateLimitedGivesUpAfterRetries(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := readyChat(t0)
	c.Submit("selam", t0)
	now := t0
	for i := range chatRetries {
		c.OnError(ErrorMsg{Code: "RATE_LIMITED", Message: "x"}, now)
		if now = c.out.retryAt; now.IsZero() || c.Due(now) == nil {
			t.Fatalf("deneme %d", i)
		}
	}
	c.OnError(ErrorMsg{Code: "RATE_LIMITED", Message: "x"}, now)
	if v := c.View(now); v.Status != chatNoteFailed || v.Restore != "selam" || !v.Input {
		t.Fatalf("%+v", v)
	}
}

func TestAC255ChatInternalAndValidationKeepText(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := readyChat(t0)
	s := c.Submit("yazıcı", t0)
	c.OnError(ErrorMsg{Code: "INTERNAL", Message: "Mesaj gönderilemedi."}, t0)
	v := c.View(t0.Add(time.Second))
	if v.Restore != "yazıcı" || v.Status != chatNoteFailed || !v.CanSend || !strings.Contains(v.Text, "gönderilemedi") {
		t.Fatalf("%+v", v)
	}
	r := c.Submit("yazıcı", t0.Add(time.Second))
	if r == nil || r.ClientMsgID != s.ClientMsgID || strings.Count(c.View(t0).Text, "yazıcı") != 1 {
		t.Fatal("aynı metnin yeniden denemesi aynı clientMsgId ile, tek satır")
	}
	c.OnError(ErrorMsg{Code: "VALIDATION", Message: "Mesaj boş olamaz"}, t0.Add(time.Second))
	if v := c.View(t0.Add(2 * time.Second)); v.Status != "Mesaj boş olamaz" || v.Restore != "yazıcı" {
		t.Fatalf("%+v", v)
	}
	if r := c.Submit("başka", t0.Add(2*time.Second)); r == nil || r.ClientMsgID == s.ClientMsgID {
		t.Fatal("farklı metin yeni clientMsgId alır")
	}
	if readyChat(t0).OnError(ErrorMsg{Code: "INTERNAL"}, t0) {
		t.Fatal("bekleyen yoksa hata sohbete ait değildir")
	}
}

func TestAC255ChatReconnectResendsOnlyIfMissing(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := readyChat(t0)
	s := c.Submit("bağlantı", t0)
	c.Online(false)
	if v := c.View(t0); v.CanSend || v.Status != chatNoteOffline {
		t.Fatalf("%+v", v)
	}
	c.Online(true)
	if c.Due(t0.Add(5*time.Second)) != nil {
		t.Fatal("request.messages gelmeden yeniden gönderilmez")
	}
	r := c.OnHistory([]ChatItem{}, t0.Add(5*time.Second))
	if r == nil || r.ClientMsgID != s.ClientMsgID {
		t.Fatalf("listede yoksa aynı clientMsgId ile yeniden gönderilir: %+v", r)
	}
	c.Online(false)
	c.Online(true)
	if r := c.OnHistory([]ChatItem{echo("01JC0000000000000000000002", s.ClientMsgID, "bağlantı")}, t0.Add(9*time.Second)); r != nil {
		t.Fatal("listede varsa yeniden gönderilmez")
	}
	if c.out != nil || strings.Count(c.View(t0).Text, "bağlantı") != 1 {
		t.Fatal("onaylanmalı, çift satır yok")
	}
	// aynı geçmiş yeniden gelirse çift satır yok; yeni teknisyen mesajı bildirilir
	c.OnHistory([]ChatItem{echo("01JC0000000000000000000002", s.ClientMsgID, "bağlantı"),
		techItem("01JC0000000000000000000003", "Ali", "geldim")}, t0.Add(10*time.Second))
	v := c.View(t0)
	if strings.Count(v.Text, "bağlantı") != 1 || !v.NotifyNew || c.View(t0).NotifyNew {
		t.Fatalf("%+v", v)
	}
}

func TestAC255ChatToggleAndAccept(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	c := readyChat(t0)
	c.Submit("son mesaj", t0)
	c.OnToggle(false)
	v := c.View(t0.Add(time.Second))
	if v.Input || v.CanSend || v.Status != chatNoteClosed || v.Restore != "son mesaj" || !strings.Contains(v.Text, "gönderilemedi") {
		t.Fatalf("%+v", v)
	}
	if c.Submit("yeni", t0.Add(2*time.Second)) != nil {
		t.Fatal("kapalı sohbette gönderim yok")
	}
	c.OnToggle(true)
	if v := c.View(t0.Add(2 * time.Second)); !v.Input || !v.CanSend {
		t.Fatalf("true gelirse yeniden açılır: %+v", v)
	}
	c.OnAccepted()
	if v := c.View(t0); v.Input || v.Status != chatNoteAccepted {
		t.Fatalf("%+v", v)
	}
}

func TestKP20_9BalloonHasNoBody(t *testing.T) {
	if ChatBalloonText != "Teknisyenden yeni mesaj" {
		t.Fatal("balon metni sabit ve gövdesiz olmalı")
	}
}

// --- akış (wait.go) ---

func TestAC255ChatFlowThroughWait(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	u.forms = submits(goodForm)
	d := deps(a, u, conn, ev, nil)
	// her okumada 1 sn ilerleyen saat: 1 msg/sn kilidi gerçek beklemeden açılır (test After'ı anında tetikler)
	var tick atomic.Int64
	base := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	d.Now = func() time.Time { return base.Add(time.Duration(tick.Add(1)) * time.Second) }
	out := runAsync(d)
	connected(t, u, conn)
	conn.in <- ChatHistory{T: "request.messages", Items: []ChatItem{}}
	waitChat(t, u, func(v ChatView) bool { return v.CanSend })
	u.chatIn <- "  Merhaba, yazıcı yine sıkıştı "
	s := wait(t, conn.msgs)
	if s.Body != "Merhaba, yazıcı yine sıkıştı" || !clientMsgIDRe.MatchString(s.ClientMsgID) {
		t.Fatalf("%+v", s)
	}
	waitChat(t, u, func(v ChatView) bool { return v.Clear && strings.Contains(v.Text, "gönderiliyor") })
	conn.in <- ChatMessage{T: "request.message", ChatItem: echo("01JC0000000000000000000002", s.ClientMsgID, s.Body)}
	waitChat(t, u, func(v ChatView) bool {
		return !strings.Contains(v.Text, "gönderiliyor") && strings.Contains(v.Text, "Siz:")
	})
	conn.in <- ChatMessage{T: "request.message", ChatItem: techItem("01JC0000000000000000000003", "Ali", "Birazdan bağlanıyorum")}
	waitChat(t, u, func(v ChatView) bool { return v.NotifyNew && strings.Contains(v.Text, "    Birazdan bağlanıyorum") })
	// RATE_LIMITED → aynı clientMsgId ile yeniden gönderim (test After'ı anında tetikler)
	u.chatIn <- "ikinci"
	s2 := wait(t, conn.msgs)
	conn.in <- ErrorMsg{T: "error", Code: "RATE_LIMITED", Message: "Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin."}
	if r := wait(t, conn.msgs); r != s2 {
		t.Fatalf("%+v != %+v", r, s2)
	}
	conn.in <- ChatToggle{T: "request.chat", Enabled: new(false)}
	waitChat(t, u, func(v ChatView) bool { return !v.Input && v.Restore == "ikinci" })
	conn.in <- Closed{T: "request.closed", Status: "EXPIRED"}
	if o := wait(t, out); o.Kind != OutClose {
		t.Fatalf("%+v", o)
	}
}

func TestGP20_7WaitTitleUsesLocalLabel(t *testing.T) {
	a, u, conn, ev := &fakeAPI{tenant: "Sunucu\u202eAdı"}, newUI(), newConn(), make(chan UserAction, 4)
	u.forms = submits(goodForm)
	d := deps(a, u, conn, ev, nil)
	d.Registered = "Demo Firma – Muhasebe"
	out := runAsync(d)
	if v := wait(t, u.waiting); v.Label != "Demo Firma – Muhasebe" {
		t.Fatalf("%+v", v)
	}
	ev <- UserClose
	wait(t, out)
}

func waitChat(t *testing.T, u *fakeUI, ok func(ChatView) bool) ChatView {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case v := <-u.chats:
			if ok(v) {
				return v
			}
		case <-deadline:
			t.Fatal("sohbet görünümü gelmedi")
		}
	}
}

// --- protokol: gerçek WS (httptest TLS) ---

func TestAC255DialAnnouncesChatCapAndRoundTrips(t *testing.T) {
	got := make(chan string, 1)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var protos []string
		for _, v := range r.Header.Values("Sec-WebSocket-Protocol") {
			for p := range strings.SplitSeq(v, ",") {
				protos = append(protos, strings.TrimSpace(p))
			}
		}
		if !slices.Equal(protos, []string{"rs.v1", "rs.req." + testSecret, "rs.cap.chat1"}) {
			t.Errorf("subprotocol %v", protos)
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"rs.v1"}})
		if err != nil {
			return
		}
		ctx := r.Context()
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"request.messages","items":[]}`))
		_, data, _ := c.Read(ctx)
		got <- string(data)
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"request.message","id":"01JC0000000000000000000002","sender":"CUSTOMER","body":"Tamam","createdAt":"2026-11-15T10:00:01.000Z","clientMsgId":"m-1"}`))
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"request.message","id":"01JC0000000000000000000003","sender":"TECH","body":"x","createdAt":"2026-11-15T10:00:01.000Z","extra":1}`))
		_, _, _ = c.Read(ctx)
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	su, _ := url.Parse(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, hc, su, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	if m, err := conn.Read(ctx); err != nil || !reflect.DeepEqual(m, ChatHistory{T: "request.messages", Items: []ChatItem{}}) {
		t.Fatalf("%#v %v", m, err)
	}
	if err := conn.SendMessage(ctx, "Tamam", "m-1"); err != nil {
		t.Fatal(err)
	}
	if s := <-got; s != `{"t":"request.message","body":"Tamam","clientMsgId":"m-1"}` {
		t.Fatalf("giden çerçeve %s", s)
	}
	m, err := conn.Read(ctx)
	if cm, ok := m.(ChatMessage); err != nil || !ok || *cm.ClientMsgID != "m-1" {
		t.Fatalf("%#v %v", m, err)
	}
	if _, err := conn.Read(ctx); !errors.Is(err, ErrProtocol) {
		t.Fatal("şema dışı sohbet mesajı 1008 ile kapatmalı")
	}
	if err := conn.SendMessage(ctx, "\tsekme", "m-2"); err == nil {
		t.Fatal("yasak karakterli gövde gönderilmemeli")
	}
}
