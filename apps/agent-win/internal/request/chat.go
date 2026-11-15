package request

// P20 K6 — kabul öncesi talep sohbeti (AC-255 Go ucu; mimari-e11 §8d.3 sohbet satırı, G-P20-7, K-P20-1; mimari-protokol
// §5.4). Sunucu P18'de hazırdır; bu dosya platformdan bağımsız kısımdır: gelen sohbet mesajlarının sıkı ayrıştırılması,
// gönderim gövdesinin yerel doğrulaması (§5.4.4, sunucuyla aynı sıra), gösterim süzgeci + önek/girinti + tavan, ve
// "en çok bir onaylanmamış mesaj" durum modeli. Zaman, soket ve arayüz wait.go'dadır. Oturum sohbeti (DC `chat`) P22'ye
// kadar değişmez.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"remote-support/agent-win/internal/signal"
)

// Sözleşme sabitleri (contracts `api/requests.ts`, `ws-request.ts`).
const (
	// CapChat `rs.cap.chat1` (WS_REQUEST_CAP_CHAT): Dial her zaman bildirir.
	CapChat         = "rs.cap.chat1"
	chatRawMax      = 4000 // ham gövde ön sınırı (UTF-16 birimi)
	chatBodyMax     = 1000 // MESSAGE_BODY_MAX (kod noktası)
	chatLinesMax    = 20   // MESSAGE_LINES_MAX
	chatInBodyMax   = 2000 // sunucu → istemci gövde payı (MESSAGE_BODY_MAX * 2, UTF-16 birimi)
	chatHistoryMax  = 50   // MESSAGE_HISTORY_WS
	senderNameMax   = 100
	senderTech      = "TECH"
	senderCustomer  = "CUSTOMER"
	capMessage      = "Bu talepte en çok 200 mesaj gönderilebilir."
	chatRetries     = 4 // RATE_LIMITED sonrası aynı clientMsgId ile en çok bu kadar yeniden deneme (1, 2, 4, 8 sn)
	chatSendEvery   = time.Second
	chatIndent      = "    "
	chatUnreadable  = "(görüntülenemeyen içerik)"
	chatTechDefault = "Teknisyen"
)

// Gösterim tavanları (G-P20-7): 200 mesaj ve 256 K karakter (UTF-16 birimi; aşımda en eski düşer). Salt okunur geçmiş
// kutusunun `EM_SETLIMITTEXT` sınırı ChatTextLimit'tir (ui).
const (
	ChatShowMax    = 200
	ChatTextMax    = 256 * 1024
	ChatTextLimit  = 512 * 1024
	ChatInputLimit = 2 * chatBodyMax // giriş kutusu (UTF-16 birimi); asıl sınır ChatBody'dedir
)

// Gövde hata metinleri contracts `requestMessageBodySchema` ile aynı.
const (
	errChatLong    = "Mesaj en çok 1000 karakter olabilir"
	errChatBadText = "Mesaj geçersiz karakter içeriyor"
	errChatUnsafe  = "Mesaj görünmez veya kontrol karakteri içeremez"
	errChatEmpty   = "Mesaj boş olamaz"
	errChatLines   = "Mesaj en çok 20 satır olabilir"
)

// Sohbet durum satırı metinleri.
const (
	chatNoteSending  = "Mesajınız gönderiliyor…"
	chatNoteRetry    = "Çok hızlı mesaj gönderildi; birazdan yeniden deneniyor…"
	chatNoteFailed   = "Mesaj gönderilemedi. Tekrar deneyin."
	chatNoteWait     = "Önceki mesajınız gönderiliyor; lütfen bekleyin."
	chatNoteOffline  = "Bağlantı bekleniyor; mesaj şu an gönderilemez."
	chatNoteClosed   = "Talep kabul edildi ya da kapandı; mesaj gönderilemez."
	chatNoteAccepted = "Talep kabul edildi; sohbet kapandı."
	// ChatBalloonText tepsi balonu / bildirim metni: mesaj gövdesi ve teknisyen adı GÖSTERİLMEZ (K-P20-9).
	ChatBalloonText = "Teknisyenden yeni mesaj"
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
	case "request.messages":
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
	case "request.chat":
		var m ChatToggle
		if err := signal.DecodeStrict(raw, &m); err != nil {
			return nil, bad(t, err.Error())
		}
		if m.Enabled == nil {
			return nil, bad(t, "enabled")
		}
		return m, nil
	}
	return nil, bad(t, "bilinmeyen tip")
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

// ChatDisplayBody G-P20-7 gövde süzgeci (request.Display'den AYRI: satır sonları korunur). Cc (`\n` hariç; `\r` ve
// `\t` dahil), tüm Cf (U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF, U+00AD…), U+2028/2029, U+034F, U+180E,
// geçersiz UTF-8 baytları ve U+FFFD atılır (encoding/json eşlenmemiş vekili U+FFFD'ye çevirir; vekil böylece atılır).
func ChatDisplayBody(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		i += n
		if r == '\n' || (r != utf8.RuneError && !unsafeChar(r)) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

type entryState int

const (
	entrySent entryState = iota
	entryPending
	entryFailed
)

type chatEntry struct {
	id, sender, name, body, cmid string
	at                           time.Time // sunucu createdAt; bekleyen yerel mesajda sıfır
	state                        entryState
}

// outgoing en çok bir onaylanmamış mesaj (§5.4.2 `error` clientMsgId taşımaz).
type outgoing struct {
	cmid, body string
	inFlight   bool      // gönderildi, yankı bekleniyor
	retryAt    time.Time // RATE_LIMITED / yeniden bağlantı sonrası yeniden gönderim anı
	retries    int
	failed     bool // kullanıcıya "gönderilemedi"; aynı gövde yeniden gönderilirse aynı clientMsgId kullanılır
}

// ChatSend gönderilecek `request.message`.
type ChatSend struct{ Body, ClientMsgID string }

// ChatView bekleme ekranının sohbet alanı.
type ChatView struct {
	Text      string // salt okunur geçmiş: süzülmüş, öneki istemci üretmiş, `\r\n`, tavanlı
	Rev       int    // Text değiştiğinde artar (arayüz yalnız değişince yeniden yazar)
	Input     bool   // giriş kutusu etkin
	CanSend   bool   // "Gönder" etkin (1 msg/sn, tek bekleyen mesaj, bağlantı)
	Status    string // durum satırı
	Clear     bool   // giriş kutusunu boşalt (gönderim kabul edildi)
	Restore   string // giriş boşsa bu metni geri koy (gönderilemedi; müşteri metni kaybolmaz)
	NotifyNew bool   // yeni teknisyen mesajı (pencere önde değilse yanıp sönme / gövdesiz balon)
}

// Chat talep sohbeti durum modeli (saf; zaman parametreyle gelir).
type Chat struct {
	entries []chatEntry
	online  bool // soket bağlı
	ready   bool // bu bağlantıda `request.messages` geldi (yetenek kabul edildi, §5.4.1)
	closed  bool
	out     *outgoing
	next    time.Time // 1 msg/sn: bu andan önce gönderilmez
	status  string
	rev     int
	// tek seferlik görünüm alanları
	clear   bool
	restore string
	notify  bool
	loc     *time.Location
	newID   func() string
}

// NewChat boş sohbet; loc saat damgasının yerel saat dilimi (nil → time.Local).
func NewChat(loc *time.Location) *Chat {
	if loc == nil {
		loc = time.Local
	}
	return &Chat{loc: loc, newID: newClientMsgID, status: chatNoteOffline}
}

func (c *Chat) changed() { c.rev++ }

func (c *Chat) find(pred func(e chatEntry) bool) int { return slices.IndexFunc(c.entries, pred) }

func (c *Chat) setState(cmid string, s entryState) {
	if i := c.find(func(e chatEntry) bool { return e.cmid == cmid && e.id == "" }); i >= 0 {
		c.entries[i].state = s
		c.changed()
	}
}

// fail bekleyen mesajı "gönderilemedi" yapar ve gövdeyi giriş kutusuna geri önerir.
func (c *Chat) fail(note string) {
	if c.out == nil {
		return
	}
	c.out.failed, c.out.inFlight, c.out.retryAt = true, false, time.Time{}
	c.setState(c.out.cmid, entryFailed)
	c.restore, c.status = c.out.body, note
}

func (c *Chat) canSend(now time.Time) bool {
	return c.online && c.ready && !c.closed && (c.out == nil || c.out.failed) && !now.Before(c.next)
}

// Submit "Gönder": yerel doğrulama + kurallar; gönderilecek çerçeveyi döner (nil → gönderilmez, durum satırı söyler).
func (c *Chat) Submit(raw string, now time.Time) *ChatSend {
	switch {
	case c.closed:
		c.status = chatNoteClosed
		return nil
	case !c.online || !c.ready:
		c.status = chatNoteOffline
		return nil
	case c.out != nil && !c.out.failed:
		c.status = chatNoteWait
		return nil
	case now.Before(c.next):
		return nil // düğme zaten pasif (1 sn)
	}
	body, msg := ChatBody(raw)
	if msg != "" {
		c.status = msg
		return nil
	}
	cmid := ""
	if c.out != nil && c.out.body == body { // aynı metnin yeniden denemesi: aynı clientMsgId (çift kayıt yok, §5.4.3)
		cmid = c.out.cmid
	}
	if cmid == "" {
		cmid = c.newID()
		c.entries = append(c.entries, chatEntry{sender: senderCustomer, body: body, cmid: cmid, state: entryPending})
	} else {
		c.setState(cmid, entryPending)
	}
	c.trim()
	c.changed()
	c.out = &outgoing{cmid: cmid, body: body, inFlight: true}
	c.next, c.status, c.clear = now.Add(chatSendEvery), chatNoteSending, true
	return &ChatSend{Body: body, ClientMsgID: cmid}
}

// merge sunucudan gelen bir mesaj; yeni teknisyen mesajıysa true.
func (c *Chat) merge(it ChatItem) bool {
	at, _ := time.Parse(time.RFC3339Nano, it.CreatedAt)
	e := chatEntry{id: it.ID, sender: it.Sender, body: it.Body, at: at}
	if it.Sender == senderTech && it.SenderName != nil {
		e.name = *it.SenderName // senderName yalnız TECH'te gösterilir
	}
	if c.find(func(x chatEntry) bool { return x.id == it.ID }) >= 0 {
		return false
	}
	if it.Sender == senderCustomer && it.ClientMsgID != nil {
		e.cmid = *it.ClientMsgID
		if i := c.find(func(x chatEntry) bool { return x.id == "" && x.cmid == e.cmid }); i >= 0 {
			c.entries[i] = e // yankı = onay; sunucunun normalleştirdiği gövde esas
			if c.out != nil && c.out.cmid == e.cmid {
				c.out, c.status = nil, ""
			}
			c.changed()
			return false
		}
	}
	c.entries = append(c.entries, e)
	c.trim()
	c.changed()
	return it.Sender == senderTech
}

func (c *Chat) trim() {
	if n := len(c.entries) - ChatShowMax; n > 0 {
		c.entries = slices.Delete(c.entries, 0, n)
	}
}

// OnMessage `request.message`.
func (c *Chat) OnMessage(it ChatItem) {
	if c.merge(it) {
		c.notify = true
	}
}

// OnHistory `request.messages` (her bağlantıda bir kez): birleştirir; bağlantı koparken uçuştaki mesaj listede yoksa
// aynı clientMsgId ile yeniden gönderilir (1 sn kuralı içinde: gerekirse retryAt).
func (c *Chat) OnHistory(items []ChatItem, now time.Time) *ChatSend {
	c.ready = true
	if c.status == chatNoteOffline {
		c.status = ""
	}
	for _, it := range items {
		if c.merge(it) {
			c.notify = true
		}
	}
	if o := c.out; o != nil && o.inFlight && !c.closed {
		o.inFlight = false
		o.retryAt = maxTime(now, c.next)
		return c.Due(now)
	}
	return nil
}

// Online soket bağlandı/koptu. Kopunca yetenek yeniden `request.messages` ile onaylanana kadar gönderim kapalı.
func (c *Chat) Online(on bool) {
	c.online = on
	if !on {
		c.ready = false
		if !c.closed {
			c.status = chatNoteOffline
		}
	}
}

// OnToggle `request.chat`.
func (c *Chat) OnToggle(enabled bool) {
	c.closed = !enabled
	if c.closed {
		if c.out != nil && !c.out.failed {
			c.fail(chatNoteClosed)
		} else {
			c.status = chatNoteClosed
		}
		return
	}
	if c.status == chatNoteClosed {
		c.status = ""
	}
}

// OnAccepted kabul: sohbet kapanır (sunucu zaten `request.chat false` göndermiştir; savunma amaçlı).
func (c *Chat) OnAccepted() {
	c.OnToggle(false)
	c.status = chatNoteAccepted
}

// OnError sohbetten doğan `error` (§5.4.3); bekleyen mesaj yoksa yok sayılır (true → sohbet hatasıydı).
func (c *Chat) OnError(e ErrorMsg, now time.Time) bool {
	o := c.out
	if o == nil || o.failed {
		return false
	}
	switch {
	case e.Code == "RATE_LIMITED" && e.Message != capMessage && o.retries < chatRetries:
		o.inFlight = false
		o.retryAt = now.Add(chatSendEvery << o.retries)
		o.retries++
		c.status = chatNoteRetry
	case e.Code == "RATE_LIMITED" && e.Message == capMessage:
		c.fail(capMessage)
		c.closed = true // tavan: yeniden deneme yok, giriş kapanır
	case e.Code == "VALIDATION" && e.Message != "":
		c.fail(e.Message)
	default:
		c.fail(chatNoteFailed)
	}
	return true
}

// Due zamanı gelmiş yeniden gönderim.
func (c *Chat) Due(now time.Time) *ChatSend {
	o := c.out
	if o == nil || o.failed || o.inFlight || o.retryAt.IsZero() || now.Before(o.retryAt) ||
		!c.online || !c.ready || c.closed {
		return nil
	}
	o.retryAt, o.inFlight = time.Time{}, true
	c.next = now.Add(chatSendEvery)
	c.status = chatNoteSending
	return &ChatSend{Body: o.body, ClientMsgID: o.cmid}
}

// Wake sıradaki zaman olayı (yeniden gönderim ya da 1 sn düğme kilidinin bitişi); yoksa sıfır.
func (c *Chat) Wake(now time.Time) time.Time {
	var t time.Time
	if now.Before(c.next) {
		t = c.next
	}
	if o := c.out; o != nil && !o.failed && !o.retryAt.IsZero() && c.online && c.ready && !c.closed {
		if r := maxTime(o.retryAt, now); t.IsZero() || r.Before(t) {
			t = r
		}
	}
	return t
}

// SendFailed soket yazımı başarısız: bağlantı kopması gibi ele alınır (yeniden bağlantıda history ile denetlenir).
func (c *Chat) SendFailed() {
	if c.out != nil && c.out.inFlight {
		c.Online(false)
	}
}

// View görünüm; tek seferlik alanlar (Clear, Restore, NotifyNew) okununca sıfırlanır.
func (c *Chat) View(now time.Time) ChatView {
	v := ChatView{Text: c.text(), Rev: c.rev, Input: !c.closed, CanSend: c.canSend(now), Status: c.status,
		Clear: c.clear, Restore: c.restore, NotifyNew: c.notify}
	c.clear, c.restore, c.notify = false, "", false
	return v
}

// text geçmiş metni: her mesaj "[SS:DD] Teknisyen <ad>:" / "Siz:" başlığı (istemci üretir) + girintili gövde satırları;
// gövde satırı hiçbir zaman sütun 0'da başlamaz, sahte başlık üretilemez (G-P20-7). Tavan aşımında en eski düşer.
func (c *Chat) text() string {
	blocks := make([]string, 0, len(c.entries))
	total := 0
	for i := len(c.entries) - 1; i >= 0; i-- {
		b := c.block(c.entries[i])
		if n := utf16Len(b); total+n > ChatTextMax {
			break
		} else {
			total += n
		}
		blocks = append(blocks, b)
	}
	slices.Reverse(blocks)
	return strings.Join(blocks, "")
}

func (c *Chat) block(e chatEntry) string {
	var head string
	if !e.at.IsZero() {
		head = "[" + e.at.In(c.loc).Format("15:04") + "] "
	}
	switch {
	case e.sender == senderTech:
		head += chatTechDefault
		if n := Display(e.name, ""); n != "" {
			head += " " + n
		}
	case e.state == entryPending:
		head += "Siz (gönderiliyor…)"
	case e.state == entryFailed:
		head += "Siz (gönderilemedi)"
	default:
		head += "Siz"
	}
	body := ChatDisplayBody(e.body)
	if strings.TrimSpace(body) == "" {
		body = chatUnreadable
	}
	return head + ":\r\n" + chatIndent + strings.ReplaceAll(body, "\n", "\r\n"+chatIndent) + "\r\n"
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
