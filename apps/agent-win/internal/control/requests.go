package control

import "time"

// İstek kuralları (AC-116, G-03): reddedilen istekten sonra 30 sn yeni istek iletilmez; oturum başına en çok 5 istek
// iletilir; diyalog açıkken gelen ikinci istek yeni diyalog açmaz. Sunucu aynı kuralı uygular; istemci yedek katmandır.
const (
	DenyCooldown  = 30 * time.Second
	MaxPerSession = 5
	ArmDelay      = 1500 * time.Millisecond
)

// Requests tek bir istek türünün (kontrol veya monitör) sayacı. Yalnız akış goroutine'inden kullanılır.
type Requests struct {
	shown    int
	open     bool
	deniedAt time.Time
}

// Admit isteğin diyalog açıp açamayacağı. true ise diyalog açık sayılır (Done/Denied ile kapanır).
func (r *Requests) Admit(now time.Time) bool {
	if r.open || r.shown >= MaxPerSession {
		return false
	}
	if !r.deniedAt.IsZero() && now.Sub(r.deniedAt) < DenyCooldown {
		return false
	}
	r.shown++
	r.open = true
	return true
}

// AdmitOpen gözetimsiz oda (mimari-p28u §8.2a, K-P28u-16): sayaç/bekleme uygulanmaz, yalnız bekleyen istek yok
// denetimi (sel sunucudaki oda kovasında). Müdahale et ↔ İzlemeye dön geçişleri 5 sınırına takılmaz.
func (r *Requests) AdmitOpen() bool {
	if r.open {
		return false
	}
	r.open = true
	return true
}

// Granted diyalog izinle kapandı.
func (r *Requests) Granted() { r.open = false }

// Denied diyalog retle kapandı; 30 sn bekleme başlar.
func (r *Requests) Denied(now time.Time) {
	r.open = false
	r.deniedAt = now
}

// Cancel diyalog karar verilmeden kapandı (kopma, revoke): ret sayılmaz.
func (r *Requests) Cancel() { r.open = false }

// Pending diyalog açık mı.
func (r *Requests) Pending() bool { return r.open }
