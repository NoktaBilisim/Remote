package flow

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"slices"
	"strings"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P22-G oturum sohbeti (mimari-p22 r2 §4, §9; AC-264): sunucu aktarımlı WS sohbeti — DataChannel `chat` yoktur. Akış:
// "Gönder" → yerel gövde kuralı (signal.ChatBody) + 5/sn gönderen kovası → iyimser "gönderiliyor" öğesi + `chat.send`
// → sunucunun yankısı (aynı clientMsgId) = onay. `chat.rejected` → "gönderilemedi"; aynı metin yeniden gönderilince aynı
// clientMsgId kullanılır (sunucu UQ ile idempotent, S-P22-10). Giriş yalnız `chat.state{enabled:true}` sonrası açıktır
// (eski sunucu göndermez → "Sohbet şu an kullanılamıyor"). Yeniden bağlanmada kapanır; yeni sokette `chat.state{true}`
// gelince yanıtı gelmemiş öğeler aynı clientMsgId ile yeniden gönderilir. `chat.history` öğeleri id ile tekilleştirilir
// ve ULID (id) sırasına konur. Model saftır (zaman parametreyle); gösterim düz metindir (biçim yorumlanmaz).

// ChatUI oturum penceresinin sohbet bölümü (Windows/macOS/Linux). nil → `rs.cap.schat1` bildirilmez, `chat.*` yok sayılır.
type ChatUI interface {
	// SessionChat görünümü uygular (UI iş parçacığına iletilir, engellemez).
	SessionChat(v ChatView)
}

// ChatView sohbet bölümü görünümü.
type ChatView struct {
	Text      string // salt okunur geçmiş: süzülmüş, öneki istemci üretmiş, satır sonu "\n", tavanlı
	Rev       int    // Text değişince artar (arayüz yalnız değişince yeniden yazar)
	Enabled   bool   // giriş kutusu ve "Gönder" etkin
	Status    string // durum satırı (boş olabilir)
	Clear     bool   // giriş kutusunu boşalt (gönderim kabul edildi)
	Restore   string // giriş boşsa bu metni geri koy ("gönderilemedi"; müşteri metni kaybolmaz)
	NotifyNew bool   // yeni teknisyen mesajı (pencere önde değilse okunmamış sayacı / dikkat isteği)
}

// Sohbet sabitleri.
const (
	chatSendPerSec = 5 // CHAT_SEND_PER_SEC (sunucu kovasının aynası; aşımda ChatTexts.TooFast)
	chatShowMax    = 200
	// ChatTextMax gösterilen geçmişin bayt tavanı (GTK/AppKit C dizgi sınırının altında; aşımda en eski düşer).
	ChatTextMax = 48 << 10
	chatIndent  = "    "
)

type chatState int

const (
	chatSent chatState = iota
	chatPending
	chatFailed
)

type chatEntry struct {
	id, sender, name, body, cmid string
	at                           time.Time // sunucu createdAt; yerel öğede sıfır
	state                        chatState
}

// sessionChat oturum sohbeti durum modeli.
type sessionChat struct {
	entries []chatEntry
	enabled bool
	status  string
	rev     int
	sent    []time.Time // son 1 sn'deki gönderimler (kova; yeniden gönderimler dahil)
	clear   bool
	restore string
	notify  bool
	loc     *time.Location
	newID   func() string
}

func newSessionChat() *sessionChat {
	return &sessionChat{loc: time.Local, newID: newChatMsgID, status: ChatTexts.Unavailable}
}

// newChatMsgID 16 bayt crypto/rand, base64url (22 karakter; CHAT_CLIENT_MSG_ID_PATTERN).
func newChatMsgID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func (c *sessionChat) changed() { c.rev++ }

func (c *sessionChat) local(cmid string) int {
	return slices.IndexFunc(c.entries, func(e chatEntry) bool { return e.id == "" && e.cmid == cmid })
}

func (c *sessionChat) hasID(id string) bool {
	return slices.ContainsFunc(c.entries, func(e chatEntry) bool { return e.id == id })
}

// take kovadan bir gönderim hakkı (kayan 1 sn).
func (c *sessionChat) take(now time.Time) bool {
	c.sent = slices.DeleteFunc(c.sent, func(t time.Time) bool { return now.Sub(t) >= time.Second })
	if len(c.sent) >= chatSendPerSec {
		return false
	}
	c.sent = append(c.sent, now)
	return true
}

// Submit "Gönder": nil → gönderilmez (durum satırı nedenini söyler, giriş kutusu korunur).
func (c *sessionChat) Submit(raw string, now time.Time) *signal.ChatSend {
	if !c.enabled {
		c.status = ChatTexts.Unavailable
		return nil
	}
	body, msg := signal.ChatBody(raw)
	if msg != "" {
		c.status = msg
		return nil
	}
	if !c.take(now) {
		c.status = ChatTexts.TooFast
		return nil
	}
	// Tekrar dene: gönderilemeyen aynı metin aynı clientMsgId ile (çift kayıt yok).
	i := slices.IndexFunc(c.entries, func(e chatEntry) bool { return e.id == "" && e.state == chatFailed && e.body == body })
	if i >= 0 {
		c.entries[i].state = chatPending
	} else {
		c.entries = append(c.entries, chatEntry{sender: signal.ChatSenderCustomer, body: body, cmid: c.newID(),
			state: chatPending})
		c.trim()
		i = len(c.entries) - 1
	}
	c.status, c.clear = "", true
	c.changed()
	return &signal.ChatSend{T: "chat.send", ClientMsgID: c.entries[i].cmid, Body: body}
}

// OnMessage `chat.message`. Yankı (CUSTOMER + clientMsgId) iyimser öğeyi onaylar; id zaten listede ise (geçmiş yankıdan
// önce geldi) iyimser öğe silinir.
func (c *sessionChat) OnMessage(m signal.ChatMessage) {
	it := m.Item()
	if m.ClientMsgID != nil && it.Sender == signal.ChatSenderCustomer {
		if i := c.local(*m.ClientMsgID); i >= 0 {
			if c.hasID(it.ID) {
				c.entries = slices.Delete(c.entries, i, i+1)
			} else {
				c.entries[i] = c.entry(it)
			}
			c.settled()
			c.changed()
			return
		}
	}
	if c.merge(it) && it.Sender == signal.ChatSenderTech {
		c.notify = true
	}
}

// OnHistory `chat.history` (her soket hello'sundan sonra): id ile tekilleştirilir, ULID sırasına konur.
func (c *sessionChat) OnHistory(h signal.ChatHistory) {
	for _, it := range h.Items {
		if c.merge(it) && it.Sender == signal.ChatSenderTech {
			c.notify = true
		}
	}
}

// merge yeni öğe ekler (id listede ise false). Sunucu öğeleri id (ULID) sırasında, yerel öğeler sonda kalır.
func (c *sessionChat) merge(it signal.ChatItem) bool {
	if c.hasID(it.ID) {
		return false
	}
	c.entries = append(c.entries, c.entry(it))
	slices.SortStableFunc(c.entries, func(a, b chatEntry) int {
		switch {
		case a.id == "" && b.id == "":
			return 0
		case a.id == "":
			return 1
		case b.id == "":
			return -1
		}
		return strings.Compare(a.id, b.id)
	})
	c.trim()
	c.changed()
	return true
}

func (c *sessionChat) entry(it signal.ChatItem) chatEntry {
	at, _ := time.Parse(time.RFC3339Nano, it.CreatedAt)
	e := chatEntry{id: it.ID, sender: it.Sender, body: it.Body, at: at}
	if it.Sender == signal.ChatSenderTech && it.SenderName != nil {
		e.name = *it.SenderName
	}
	return e
}

// settled gönderilemeyen öğe kalmadıysa "gönderilemedi" satırı kalkar.
func (c *sessionChat) settled() {
	if c.status == ChatTexts.SendFailed && !slices.ContainsFunc(c.entries, func(e chatEntry) bool { return e.state == chatFailed }) {
		c.status = ""
	}
}

// OnRejected `chat.rejected`: öğe "gönderilemedi", metin giriş kutusuna geri önerilir.
func (c *sessionChat) OnRejected(m signal.ChatRejected) {
	i := c.local(m.ClientMsgID)
	if i < 0 {
		return
	}
	c.entries[i].state = chatFailed
	c.restore = c.entries[i].body
	switch m.Reason {
	case "rate":
		c.status = ChatTexts.TooFast
	case "not_active", "forbidden", "outdated":
		c.status = ChatTexts.Unavailable
	default: // cap, invalid, internal
		c.status = ChatTexts.SendFailed
	}
	c.changed()
}

// OnState `chat.state`. true → giriş açılır ve yanıtı gelmemiş öğeler aynı clientMsgId ile yeniden gönderilir (kova
// içinde; sığmayan "gönderilemedi" olur). false → giriş kapanır, bekleyenler "gönderilemedi".
func (c *sessionChat) OnState(on bool, now time.Time) []signal.ChatSend {
	c.enabled = on
	if !on {
		c.failPending()
		c.status = ChatTexts.Unavailable
		return nil
	}
	if c.status == ChatTexts.Unavailable {
		c.status = ""
	}
	var out []signal.ChatSend
	for i, e := range c.entries {
		if e.id != "" || e.state != chatPending {
			continue
		}
		if !c.take(now) {
			c.entries[i].state = chatFailed
			c.status = ChatTexts.SendFailed
			c.changed()
			continue
		}
		out = append(out, signal.ChatSend{T: "chat.send", ClientMsgID: e.cmid, Body: e.body})
	}
	return out
}

// Offline soket koptu: yeni sokette `chat.state{true}` gelene kadar giriş kapalı; bekleyenler beklemede kalır.
func (c *sessionChat) Offline() {
	c.enabled = false
	c.status = ChatTexts.Unavailable
}

func (c *sessionChat) failPending() {
	for i, e := range c.entries {
		if e.id == "" && e.state == chatPending {
			c.entries[i].state = chatFailed
			c.changed()
		}
	}
}

func (c *sessionChat) trim() {
	if n := len(c.entries) - chatShowMax; n > 0 {
		c.entries = slices.Delete(c.entries, 0, n)
	}
}

// View görünüm; tek seferlik alanlar (Clear, Restore, NotifyNew) okununca sıfırlanır.
func (c *sessionChat) View() ChatView {
	v := ChatView{Text: c.text(), Rev: c.rev, Enabled: c.enabled, Status: c.status, Clear: c.clear, Restore: c.restore,
		NotifyNew: c.notify}
	c.clear, c.restore, c.notify = false, "", false
	return v
}

// text geçmiş: her mesaj "[SS:DD] Teknisyen <ad>:" / "Siz:" başlığı (istemci üretir) + girintili gövde satırları; gövde
// satırı sütun 0'da başlamaz, sahte başlık üretilemez. Tavan aşımında en eski düşer.
func (c *sessionChat) text() string {
	blocks := make([]string, 0, len(c.entries))
	total := 0
	for i := len(c.entries) - 1; i >= 0; i-- {
		b := c.block(c.entries[i])
		if total+len(b) > ChatTextMax {
			break
		}
		total += len(b)
		blocks = append(blocks, b)
	}
	slices.Reverse(blocks)
	return strings.Join(blocks, "")
}

func (c *sessionChat) block(e chatEntry) string {
	var head string
	if !e.at.IsZero() {
		head = "[" + e.at.In(c.loc).Format("15:04") + "] "
	}
	switch {
	case e.sender == signal.ChatSenderTech:
		head += ChatTexts.Tech
		if n := chatName(e.name); n != "" {
			head += " " + n
		}
	case e.state == chatPending:
		head += ChatTexts.YouSending
	case e.state == chatFailed:
		head += ChatTexts.YouFailed
	default:
		head += ChatTexts.You
	}
	body := signal.ChatDisplayBody(e.body)
	if strings.TrimSpace(body) == "" {
		body = ChatTexts.Unreadable
	}
	return head + ":\n" + chatIndent + strings.ReplaceAll(body, "\n", "\n"+chatIndent) + "\n"
}

// chatName teknisyen adı tek satır, süzülmüş.
func chatName(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(signal.ChatDisplayBody(s), "\n", " "))
}

// --- oturum bağlantısı ---

func (s *session) chatOn() bool { return s.d.ChatUI != nil && !s.d.Unattended }

// pushChat görünümü arayüze verir.
func (s *session) pushChat() {
	if s.chatOn() {
		s.d.ChatUI.SessionChat(s.chat.View())
	}
}

func (s *session) onChatServer(ctx context.Context, m signal.Inbound) {
	if !s.chatOn() {
		return
	}
	switch m := m.(type) {
	case signal.ChatMessage:
		s.chat.OnMessage(m)
	case signal.ChatHistory:
		s.chat.OnHistory(m)
	case signal.ChatState:
		for _, out := range s.chat.OnState(m.On(), s.d.Now()) {
			s.send(ctx, out)
		}
	case signal.ChatRejected:
		s.chat.OnRejected(m)
	}
	s.pushChat()
}

func (s *session) onChatUser(ctx context.Context, text string) {
	if !s.chatOn() {
		return
	}
	if out := s.chat.Submit(text, s.d.Now()); out != nil {
		s.send(ctx, *out)
	}
	s.pushChat()
}

func (s *session) chatOffline() {
	if s.chatOn() {
		s.chat.Offline()
		s.pushChat()
	}
}
