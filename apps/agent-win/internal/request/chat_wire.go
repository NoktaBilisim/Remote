package request

// P20 K6 — talep sohbetinin tel tarafı (mimari-protokol §5.4): sözleşme sabitleri, `request.message` /
// `request.messages` / `request.chat` tipleri ve sıkı ayrıştırılması, gönderim gövdesinin yerel doğrulaması (§5.4.4,
// sunucuyla aynı sıra) ve `request.message` (C→S) kodlaması. Durum modeli chat.go, gösterim chat_view.go'dadır.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"remote-support/agent-win/internal/signal"
)

// Sözleşme sabitleri (contracts `api/requests.ts`, `ws-request.ts`).
const (
	// CapChat `rs.cap.chat1` (WS_REQUEST_CAP_CHAT): Dial her zaman bildirir.
	CapChat        = "rs.cap.chat1"
	chatRawMax     = 4000 // ham gövde ön sınırı (UTF-16 birimi)
	chatBodyMax    = 1000 // MESSAGE_BODY_MAX (kod noktası)
	chatLinesMax   = 20   // MESSAGE_LINES_MAX
	chatInBodyMax  = 2000 // sunucu → istemci gövde payı (MESSAGE_BODY_MAX * 2, UTF-16 birimi)
	chatHistoryMax = 50   // MESSAGE_HISTORY_WS
	senderNameMax  = 100
	senderTech     = "TECH"
	senderCustomer = "CUSTOMER"
)

// Gövde hata metinleri contracts `requestMessageBodySchema` ile aynı.
const (
	errChatLong    = "Mesaj en çok 1000 karakter olabilir"
	errChatBadText = "Mesaj geçersiz karakter içeriyor"
	errChatUnsafe  = "Mesaj görünmez veya kontrol karakteri içeremez"
	errChatEmpty   = "Mesaj boş olamaz"
	errChatLines   = "Mesaj en çok 20 satır olabilir"
)

var (
	ulidRe        = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	clientMsgIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,36}$`)
	chatSenders   = []string{senderTech, senderCustomer}
)

// ChatItem `request.message` / `request.messages.items[]` alanları (S→C; öğede `t` yok).
type ChatItem struct {
	ID          string  `json:"id"`
	Sender      string  `json:"sender"`
	SenderName  *string `json:"senderName,omitempty"`
	Body        string  `json:"body"`
	CreatedAt   string  `json:"createdAt"`
	ClientMsgID *string `json:"clientMsgId,omitempty"`
}

// ChatMessage `request.message` (S→C): teknisyen mesajı ya da müşterinin kendi mesajının yankısı.
type ChatMessage struct {
	T string `json:"t"`
	ChatItem
}

// ChatHistory `request.messages`: bağlantı sonrası son ≤ 50 mesaj, artan sıra.
type ChatHistory struct {
	T     string
	Items []ChatItem
}

// ChatToggle `request.chat`: false → giriş kapanır (kabul/kapanış öncesi).
type ChatToggle struct {
	T       string `json:"t"`
	Enabled *bool  `json:"enabled"`
}

func (ChatMessage) isInbound() {}
func (ChatHistory) isInbound() {}
func (ChatToggle) isInbound()  {}

// chatItemWire ChatItem'ın sıkı çözümü için gömmesiz eşi (DecodeStrict gömülü alanı görmez).
type chatItemWire struct {
	ID          string  `json:"id"`
	Sender      string  `json:"sender"`
	SenderName  *string `json:"senderName,omitempty"`
	Body        string  `json:"body"`
	CreatedAt   string  `json:"createdAt"`
	ClientMsgID *string `json:"clientMsgId,omitempty"`
}

type chatMessageWire struct {
	T           string  `json:"t"`
	ID          string  `json:"id"`
	Sender      string  `json:"sender"`
	SenderName  *string `json:"senderName,omitempty"`
	Body        string  `json:"body"`
	CreatedAt   string  `json:"createdAt"`
	ClientMsgID *string `json:"clientMsgId,omitempty"`
}

func validChatItem(it ChatItem) bool {
	return ulidRe.MatchString(it.ID) && slices.Contains(chatSenders, it.Sender) &&
		(it.SenderName == nil || (*it.SenderName != "" && utf16Len(*it.SenderName) <= senderNameMax)) &&
		it.Body != "" && utf16Len(it.Body) <= chatInBodyMax && signal.IsISO(it.CreatedAt) &&
		(it.ClientMsgID == nil || clientMsgIDRe.MatchString(*it.ClientMsgID))
}

// parseChat requestChatOutboundSchema eşi (yalnız `rs.cap.chat1` soketine gelir; Dial her zaman bildirir).
func parseChat(t string, raw []byte) (Inbound, error) {
	switch t {
	case "request.message":
		return parseChatMessage(t, raw)
	case "request.messages":
		return parseChatHistory(t, raw)
	case "request.chat":
		return parseChatToggle(t, raw)
	}
	return nil, bad(t, "bilinmeyen tip")
}

func parseChatMessage(t string, raw []byte) (Inbound, error) {
	var w chatMessageWire
	if err := signal.DecodeStrict(raw, &w); err != nil {
		return nil, bad(t, err.Error())
	}
	it := ChatItem{ID: w.ID, Sender: w.Sender, SenderName: w.SenderName, Body: w.Body, CreatedAt: w.CreatedAt,
		ClientMsgID: w.ClientMsgID}
	if !validChatItem(it) {
		return nil, bad(t, "alan")
	}
	return ChatMessage{T: t, ChatItem: it}, nil
}

func parseChatHistory(t string, raw []byte) (Inbound, error) {
	var w struct {
		T     string            `json:"t"`
		Items []json.RawMessage `json:"items"`
	}
	if err := signal.DecodeStrict(raw, &w); err != nil {
		return nil, bad(t, err.Error())
	}
	if w.Items == nil || len(w.Items) > chatHistoryMax {
		return nil, bad(t, "items")
	}
	h := ChatHistory{T: t, Items: make([]ChatItem, 0, len(w.Items))}
	for _, r := range w.Items {
		var iw chatItemWire // öğede `t` yok: bilinmeyen alan olarak reddedilir
		if err := signal.DecodeStrict(r, &iw); err != nil {
			return nil, bad(t, err.Error())
		}
		it := ChatItem(iw)
		if !validChatItem(it) {
			return nil, bad(t, "öğe")
		}
		h.Items = append(h.Items, it)
	}
	return h, nil
}

func parseChatToggle(t string, raw []byte) (Inbound, error) {
	var m ChatToggle
	if err := signal.DecodeStrict(raw, &m); err != nil {
		return nil, bad(t, err.Error())
	}
	if m.Enabled == nil {
		return nil, bad(t, "enabled")
	}
	return m, nil
}

// ChatBody §5.4.4 gövde kuralları (sunucuyla aynı sıra): ham ≤ 4000 UTF-16 → iyi biçimli metin → `\r\n`→`\n` → trim →
// yasak karakter yok (Cc yalnız `\n` serbest; Cf yalnız ZWJ serbest; Zl/Zp, U+034F, U+180E) → 1..1000 kod noktası →
// ≤ 20 satır. NFC sunucuda yapılır (ek bağımlılık yok); istemci yankıdaki gövdeyi esas alır. Hata yoksa msg boştur.
func ChatBody(raw string) (body, msg string) {
	if utf16Len(raw) > chatRawMax {
		return "", errChatLong
	}
	if !utf8.ValidString(raw) { // Go dizesinde vekil kod noktası olamaz; geçersiz UTF-8 = iyi biçimsiz metin
		return "", errChatBadText
	}
	s := strings.TrimFunc(strings.ReplaceAll(raw, "\r\n", "\n"), jsSpace)
	if strings.ContainsFunc(s, func(r rune) bool { return r != '\n' && r != 0x200D && unsafeChar(r) }) {
		return "", errChatUnsafe
	}
	switch n := utf8.RuneCountInString(s); {
	case n < 1:
		return "", errChatEmpty
	case n > chatBodyMax:
		return "", errChatLong
	}
	if strings.Count(s, "\n")+1 > chatLinesMax {
		return "", errChatLines
	}
	return s, ""
}

// EncodeMessage `request.message` (C→S). Gövde ChatBody'den geçmiş olmalıdır.
func EncodeMessage(body, clientMsgID string) ([]byte, error) {
	if nb, msg := ChatBody(body); msg != "" || nb != body || !clientMsgIDRe.MatchString(clientMsgID) {
		return nil, errors.New("request: geçersiz sohbet mesajı")
	}
	return json.Marshal(struct {
		T           string `json:"t"`
		Body        string `json:"body"`
		ClientMsgID string `json:"clientMsgId"`
	}{"request.message", body, clientMsgID})
}

// newClientMsgID 16 bayt rastgele, base64url (22 karakter): talep ömrü boyunca tekil.
func newClientMsgID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}
