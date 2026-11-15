package request

// P20 K6 — kabul öncesi talep sohbeti (AC-255 Go ucu; mimari-e11 §8d.3 sohbet satırı, G-P20-7, K-P20-1; mimari-protokol
// §5.4). Sunucu P18'de hazırdır; bu dosya platformdan bağımsız "en çok bir onaylanmamış mesaj" durum modelidir. Tel
// tipleri, ayrıştırma ve gövde doğrulaması chat_wire.go'da; gösterim süzgeci + önek/girinti + tavan chat_view.go'dadır.
// Zaman, soket ve arayüz wait.go'dadır. Oturum sohbeti (DC `chat`) P22'ye kadar değişmez.

import (
	"slices"
	"time"
)

const (
	capMessage    = "Bu talepte en çok 200 mesaj gönderilebilir."
	chatRetries   = 4 // RATE_LIMITED sonrası aynı clientMsgId ile en çok bu kadar yeniden deneme (1, 2, 4, 8 sn)
	chatSendEvery = time.Second
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
)

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

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
