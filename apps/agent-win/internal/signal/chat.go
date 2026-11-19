package signal

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// P22-G oturum sohbeti WS sözleşme eşi (mimari-p22 r2 §4, §9, §15.1; `packages/contracts/src/ws-chat.ts`, `chat.ts`).
// Akış tek yol: misafir → sunucu (doğrula → şifrele → kaydet) → herkese ilet; DataChannel `chat` yoktur. `chat.*` yalnız
// FeatureSessionChat bildiren sokete gelir. Davranış (iyimser öğe, yankı eşleme, kova) internal/flow/chat.go'dadır. Uyum
// `packages/contracts/fixtures/ws-session-chat.json` ile test edilir.
//
// Gövde kuralı (ChatBody) ve gösterim süzgeci (ChatDisplayBody) burada tek tanımdır: P18 talep sohbeti (internal/request)
// buna delege eder (contracts'ta `requestMessageBodySchema` → `chat.ts` taşımasının eşi; request → flow → signal yönü
// döngü yaratmaz).

// FeatureSessionChat `WS_CAP_SCHAT`: Dial'ın features parametresi (0.21.0). Gözetimsiz bağlantılarda BİLDİRİLMEZ.
const FeatureSessionChat = "rs.cap.schat1"

// Sabitler (contracts; fikstür `constants`).
const (
	ChatHistoryMax      = 100    // CHAT_HISTORY_MAX
	ChatHistoryMaxBytes = 49_152 // CHAT_HISTORY_MAX_BYTES (S-P22-1; okuma sınırı maxPayload DEĞİŞMEZ)
	ChatBodyMax         = 1000   // MESSAGE_BODY_MAX (kod noktası)
	ChatLinesMax        = 20     // MESSAGE_LINES_MAX
	chatRawMax          = 4000   // ham gövde ön sınırı (UTF-16 birimi)
	chatInBodyMax       = 2 * ChatBodyMax
	chatSenderNameMax   = 100
	chatClientMsgIDText = `^[A-Za-z0-9_-]{16,36}$`
)

// Gövde hata metinleri contracts `chatBodySchema` ile aynı (müşteri iki istemcide aynı ifadeyi görür).
const (
	ChatErrLong    = "Mesaj en çok 1000 karakter olabilir"
	ChatErrBadText = "Mesaj geçersiz karakter içeriyor"
	ChatErrUnsafe  = "Mesaj görünmez veya kontrol karakteri içeremez"
	ChatErrEmpty   = "Mesaj boş olamaz"
	ChatErrLines   = "Mesaj en çok 20 satır olabilir"
)

// Gönderen ve sözlükler (`MESSAGE_SENDERS`, `CHAT_REJECT_REASONS`, `CHAT_STATE_REASONS`).
const (
	ChatSenderTech     = "TECH"
	ChatSenderCustomer = "CUSTOMER"
)

var (
	chatSenders       = []string{ChatSenderTech, ChatSenderCustomer}
	chatRejectReasons = []string{"rate", "cap", "invalid", "forbidden", "not_active", "outdated", "internal"}
	chatStateReasons  = []string{"not_active", "ended"}
	chatClientMsgIDRe = regexp.MustCompile(chatClientMsgIDText)
)

// ValidChatClientMsgID `CHAT_CLIENT_MSG_ID_PATTERN`.
func ValidChatClientMsgID(s string) bool { return chatClientMsgIDRe.MatchString(s) }

// --- Sunucu → misafir ---

// ChatItem `chat.message` gövde alanları (yayında ve `chat.history` öğesinde aynı). TID/SenderName yalnız TECH'te
// (ikisi de isteğe bağlı); CUSTOMER'da ikisi de yasak.
type ChatItem struct {
	ID         string  `json:"id"`
	Sender     string  `json:"sender"`
	TID        *string `json:"tid,omitempty"`
	SenderName *string `json:"senderName,omitempty"`
	Body       string  `json:"body"`
	CreatedAt  string  `json:"createdAt"`
}

// ChatMessage canlı mesaj. ClientMsgID yalnız gönderenin kendi soketine giden kopyada (yankı = onay).
type ChatMessage struct {
	T           string  `json:"t"`
	ID          string  `json:"id"`
	Sender      string  `json:"sender"`
	TID         *string `json:"tid,omitempty"`
	SenderName  *string `json:"senderName,omitempty"`
	Body        string  `json:"body"`
	CreatedAt   string  `json:"createdAt"`
	ClientMsgID *string `json:"clientMsgId,omitempty"`
}

// Item mesajın öğe alanları.
func (m ChatMessage) Item() ChatItem {
	return ChatItem{ID: m.ID, Sender: m.Sender, TID: m.TID, SenderName: m.SenderName, Body: m.Body, CreatedAt: m.CreatedAt}
}

// ChatHistory hello sonrası son ≤ 100 mesaj (çerçeve ≤ 48 KiB), artan sıra; öğelerde clientMsgId yok.
type ChatHistory struct {
	T     string
	Items []ChatItem
	More  bool
}

// ChatState kabulde `enabled:true`, oturum bitince `false` (+ reason).
type ChatState struct {
	T       string `json:"t"`
	Enabled *bool  `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}

// On sohbet açık mı (Enabled ayrıştırıcıda nil olamaz).
func (m ChatState) On() bool { return m.Enabled != nil && *m.Enabled }

// ChatRejected yalnız gönderene; soket açık kalır.
type ChatRejected struct {
	T           string `json:"t"`
	ClientMsgID string `json:"clientMsgId"`
	Reason      string `json:"reason"`
}

func (m ChatMessage) Type() string  { return m.T }
func (m ChatHistory) Type() string  { return m.T }
func (m ChatState) Type() string    { return m.T }
func (m ChatRejected) Type() string { return m.T }

func validChatItem(it ChatItem) bool {
	if !ulidRe.MatchString(it.ID) || !slices.Contains(chatSenders, it.Sender) || it.Body == "" ||
		utf16Len(it.Body) > chatInBodyMax || !isISO(it.CreatedAt) {
		return false
	}
	if it.Sender == ChatSenderCustomer {
		return it.TID == nil && it.SenderName == nil
	}
	// senderName: sunucu `displayName` ≤ 100 KOD NOKTASI keser (zod `max(100)` UTF-16 sayar); emoji adlı teknisyende
	// geçmiş her yeniden bağlanmada 1008 olmasın diye Go kod noktası sayar (şemanın üst kümesi, ≤ 200 UTF-16).
	return (it.TID == nil || tidRe.MatchString(*it.TID)) &&
		(it.SenderName == nil || (*it.SenderName != "" && utf8.RuneCountInString(*it.SenderName) <= chatSenderNameMax))
}

func validChatMessage(m *ChatMessage) bool {
	return validChatItem(m.Item()) && (m.ClientMsgID == nil || chatClientMsgIDRe.MatchString(*m.ClientMsgID))
}

// parseChatHistory öğeler tek tek katı çözülür (iç içe DisallowUnknownFields harf duyarsızdır ve zorunlu alanı
// denetlemez); `items: null` ve `more` eksik/null reddedilir.
func parseChatHistory(raw []byte) (Inbound, error) {
	const t = "chat.history"
	var w struct {
		T     string            `json:"t"`
		Items []json.RawMessage `json:"items"`
		More  *bool             `json:"more"`
	}
	if err := decodeStrict(raw, &w); err != nil {
		return nil, fail(t, err.Error())
	}
	if w.Items == nil || len(w.Items) > ChatHistoryMax || w.More == nil {
		return nil, fail(t, "items/more")
	}
	h := ChatHistory{T: t, Items: make([]ChatItem, 0, len(w.Items)), More: *w.More}
	for _, r := range w.Items {
		var it ChatItem // öğede `t`/`clientMsgId` yok: bilinmeyen alan olarak reddedilir
		if err := decodeStrict(r, &it); err != nil {
			return nil, fail(t, err.Error())
		}
		if !validChatItem(it) || nullOrEmptyKey(r, "tid", "senderName") != "" {
			return nil, fail(t, "öğe")
		}
		h.Items = append(h.Items, it)
	}
	return h, nil
}

// chatNoNull S-P22G-3: zod `optional()` alanı `null` ve enum `""` değerini reddeder; encoding/json ikisini de "yok"
// sayar. Katı çözümden sonra ham anahtarlar denetlenir: isteğe bağlı alan varsa null/boş olamaz.
func chatNoNull(p func([]byte) (Inbound, error), keys ...string) func([]byte) (Inbound, error) {
	return func(raw []byte) (Inbound, error) {
		m, err := p(raw)
		if err != nil {
			return nil, err
		}
		if k := nullOrEmptyKey(raw, keys...); k != "" {
			return nil, fail(m.Type(), k+" null/boş")
		}
		return m, nil
	}
}

// nullOrEmptyKey keys içinden değeri `null` ya da `""` olan ilk anahtar; yoksa "". raw katı çözümden geçmiştir.
func nullOrEmptyKey(raw []byte, keys ...string) string {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return "json"
	}
	for _, k := range keys {
		if v, ok := obj[k]; ok && (string(v) == "null" || string(v) == `""`) {
			return k
		}
	}
	return ""
}

func validChatState(m *ChatState) bool {
	return m.Enabled != nil && (m.Reason == "" || slices.Contains(chatStateReasons, m.Reason))
}

func validChatRejected(m *ChatRejected) bool {
	return chatClientMsgIDRe.MatchString(m.ClientMsgID) && slices.Contains(chatRejectReasons, m.Reason)
}

// --- Misafir → sunucu (yalnız FeatureSessionChat bildiren sokette şemadadır) ---

// ChatSend `chat.send`. `id` alanı YOK: sunucu şeması strictObject {t, clientMsgId, body} (fazlası 1008).
type ChatSend struct {
	T           string `json:"t"`
	ClientMsgID string `json:"clientMsgId"`
	Body        string `json:"body"`
}

// validate gövde ChatBody'den geçmiş (normalleştirilmiş) olmalı; kimlik biçimi geçerli.
func (m ChatSend) validate() error {
	if m.T != "chat.send" || !chatClientMsgIDRe.MatchString(m.ClientMsgID) {
		return fail(m.T, "chat.send")
	}
	if b, msg := ChatBody(m.Body); msg != "" || b != m.Body {
		return fail(m.T, "gövde")
	}
	return nil
}

// --- Gövde kuralı ve gösterim süzgeci (tek tanım) ---

// ChatBody contracts `chatBodySchema` sırası: ham ≤ 4000 UTF-16 → iyi biçimli metin → `\r\n`→`\n` → trim → yasak
// karakter yok (Cc yalnız `\n` serbest; Cf yalnız ZWJ serbest; Zl/Zp, U+034F, U+180E) → 1..1000 kod noktası → ≤ 20
// satır. NFC sunucuda yapılır (ek bağımlılık yok); istemci yankıdaki gövdeyi esas alır. Hata yoksa msg boştur.
func ChatBody(raw string) (body, msg string) {
	if utf16Len(raw) > chatRawMax {
		return "", ChatErrLong
	}
	if !utf8.ValidString(raw) { // Go dizesinde vekil kod noktası olamaz; geçersiz UTF-8 = iyi biçimsiz metin
		return "", ChatErrBadText
	}
	s := strings.TrimFunc(strings.ReplaceAll(raw, "\r\n", "\n"), jsSpace)
	if strings.ContainsFunc(s, func(r rune) bool { return r != '\n' && r != 0x200D && unsafeChatChar(r) }) {
		return "", ChatErrUnsafe
	}
	switch n := utf8.RuneCountInString(s); {
	case n < 1:
		return "", ChatErrEmpty
	case n > ChatBodyMax:
		return "", ChatErrLong
	}
	if strings.Count(s, "\n")+1 > ChatLinesMax {
		return "", ChatErrLines
	}
	return s, ""
}

// ChatDisplayBody gösterim süzgeci (G-P20-7; satır sonları korunur): Cc (`\n` hariç; `\r` ve `\t` dahil), tüm Cf
// (bidi, sıfır genişlik, U+FEFF, U+00AD…), U+2028/2029, U+034F, U+180E, geçersiz UTF-8 baytları ve U+FFFD atılır.
func ChatDisplayBody(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		i += n
		if r == '\n' || (r != utf8.RuneError && !unsafeChatChar(r)) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// unsafeChatChar contracts `UNSAFE_MESSAGE_CHARS` (Cc, Cf, Zl, Zp, U+034F, U+180E).
func unsafeChatChar(r rune) bool {
	return unicode.In(r, unicode.Cc, unicode.Cf, unicode.Zl, unicode.Zp) || r == 0x034f || r == 0x180e
}

// jsSpace JavaScript `String.prototype.trim` kümesi (WhiteSpace + LineTerminator).
func jsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
