package request

// P20 K6 — talep sohbetinin gösterimi (G-P20-7): gövde süzgeci, istemcinin ürettiği önek + girinti, gösterim tavanları.
// Durum modeli chat.go'dadır.

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Gösterim tavanları (G-P20-7): 200 mesaj ve 256 K karakter (UTF-16 birimi; aşımda en eski düşer). Salt okunur geçmiş
// kutusunun `EM_SETLIMITTEXT` sınırı ChatTextLimit'tir (ui).
const (
	ChatShowMax    = 200
	ChatTextMax    = 256 * 1024
	ChatTextLimit  = 512 * 1024
	ChatInputLimit = 2 * chatBodyMax // giriş kutusu (UTF-16 birimi); asıl sınır ChatBody'dedir
)

const (
	chatIndent      = "    "
	chatUnreadable  = "(görüntülenemeyen içerik)"
	chatTechDefault = "Teknisyen"
	// ChatBalloonText tepsi balonu / bildirim metni: mesaj gövdesi ve teknisyen adı GÖSTERİLMEZ (K-P20-9).
	ChatBalloonText = "Teknisyenden yeni mesaj"
)

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

func (c *Chat) trim() {
	if n := len(c.entries) - ChatShowMax; n > 0 {
		c.entries = slices.Delete(c.entries, 0, n)
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
