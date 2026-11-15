package servis

import (
	"fmt"
	"strings"
	"time"
	"unicode"

	"remote-support/agent-win/internal/servis/helperio"
)

// Olay günlüğü (mimari-p27 §5.7): kaynak `NoktaDestek`, Application. Bilet, anahtar, nonce, imza yazılmaz; serbest
// metin alanları (teknisyen/firma adı, kullanıcı adı) kontrol karakterlerinden arındırılıp kısaltılır.
const (
	EventSource = "NoktaDestek"

	EvStarted  uint32 = 1001 // bağlantı başladı
	EvEnded    uint32 = 1002 // bağlantı bitti
	EvLocal    uint32 = 1003 // yerel anahtar kapandı/açıldı
	EvRejected uint32 = 1004 // bağlantı reddedildi / güvenlik denetimi başarısız
	EvRevoked  uint32 = 1005 // cihaz iptal edildi / kayıt kaldırıldı
)

// 1004 nedenleri (bağlantı reddi dışındakiler servis açılış/denetim hatalarıdır).
const (
	ReasonFolderACL    = "folder_acl"
	ReasonPipeSquatted = "pipe_squatted"
	ReasonKey          = "device_key"
	ReasonAuthRejected = "auth_rejected"
	ReasonGate         = "signature_gate"
	ReasonFolderMoved  = "folder_renamed"
)

// Event tek olay kaydı.
type Event struct {
	ID      uint32
	Warning bool
	Text    string
}

// EventSink olay günlüğü yazıcısı (Windows: svc/eventlog; testte bellek).
type EventSink interface {
	Write(e Event)
}

func evStarted(c *Connect) Event {
	return Event{ID: EvStarted, Text: fmt.Sprintf("Gözetimsiz bağlantı başladı. Teknisyen: %s; destek firması: %s; "+
		"teknisyen IP: %s; oturum: %s", clean(c.TechName, 100), clean(c.TenantName, 120), clean(c.TechIP, 45), c.SessionID)}
}

func evEnded(sessionID, reason string, d time.Duration) Event {
	return Event{ID: EvEnded, Text: fmt.Sprintf("Gözetimsiz bağlantı bitti. Oturum: %s; neden: %s; süre: %s",
		sessionID, clean(reason, 32), d.Round(time.Second))}
}

func evLocal(enabled bool, user string) Event {
	state := "kapatıldı"
	if enabled {
		state = "açıldı"
	}
	who := clean(user, 120)
	if who == "" {
		who = "kayıt defteri (yönetici)"
	}
	return Event{ID: EvLocal, Text: fmt.Sprintf("Gözetimsiz erişim yerel olarak %s. Kullanıcı: %s", state, who)}
}

// EvReject 1004 (uyarı).
func EvReject(reason, detail string) Event {
	t := "Gözetimsiz bağlantı reddedildi. Neden: " + clean(reason, 32)
	if d := clean(detail, 64); d != "" {
		t += "; " + d
	}
	return Event{ID: EvRejected, Warning: true, Text: t}
}

// EvRevokedText 1005.
func EvRevokedText(unregistered bool) Event {
	if unregistered {
		return Event{ID: EvRevoked, Text: "Cihaz kaydı kaldırıldı (servis kaldırılıyor)."}
	}
	return Event{ID: EvRevoked, Warning: true, Text: "Cihaz destek firması tarafından iptal edildi; sunucuya yeniden bağlanılmayacak."}
}

// clean kontrol karakterlerini atar ve n karaktere kısaltır.
func clean(s string, n int) string {
	var b strings.Builder
	i := 0
	for _, r := range s {
		if i >= n {
			break
		}
		if helperio.Unsafe(r) || r == unicode.ReplacementChar {
			continue
		}
		b.WriteRune(r)
		i++
	}
	return strings.TrimSpace(b.String())
}
