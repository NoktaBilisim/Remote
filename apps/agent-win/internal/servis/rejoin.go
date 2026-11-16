package servis

import (
	"errors"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

// Oturum kapatma sonrası yeniden katılım (mimari-p28u §7.5, K-P28u-5 r2 tek tanım; contracts `rejoin-const.ts`, fikstür
// `constants` — wire_test eşlik testi). Pencere logoff komutunun kabulünden 45 sn; bilet ömrü ≤ 30 sn; yeni konsol
// oturumu beklemesi ≤ 20 sn (K6s spike ölçümüne göre ayarlanır, pencereyi aşamaz). rejoinPending işaretliyken yardımcı
// çıkışı `session.closed` üretmez ve konsol geçişi session_changed bitişine çevrilmez; işaret 45 sn'de kendiliğinden düşer.
const (
	RejoinWindowSec      = 45
	RejoinTicketTTLSec   = 30
	RejoinConsoleWaitSec = 20
)

// Servis içi bekleme süreleri: sunucu zaman aşımlarının (contracts INTERVENE_LOCK_TIMEOUT_MS 5 sn,
// INTERVENE_LOGOFF_TIMEOUT_MS 15 sn) altında kalır ki sonuç sunucu vazgeçmeden gitsin.
const (
	lockWait   = 4 * time.Second  // yardımcı ≤ 2 sn'de Winlogon'u doğrular (§7.5)
	logoffWait = 10 * time.Second // §7.5: ≤ 10 sn içinde kullanıcı yoksa ok, aksi timeout
	sessPoll   = 500 * time.Millisecond
)

// SERVICE_CONTROL_SESSIONCHANGE olay türleri (WTS_*). Olay yalnız tetikleyicidir; oturum kimliği okunmaz.
const (
	SessionConsoleConnect    uint32 = 0x1
	SessionConsoleDisconnect uint32 = 0x2
	SessionLogon             uint32 = 0x5
)

type timing struct {
	userDebounce, lockWait, logoffWait, poll, rejoinWindow, consoleWait time.Duration
}

// timings sıfır alanları varsayılanla doldurur (testler kısa süre verir).
func (c *Core) timings() timing {
	t := c.tm
	def := func(v *time.Duration, d time.Duration) {
		if *v == 0 {
			*v = d
		}
	}
	def(&t.userDebounce, DeviceUserDebounce)
	def(&t.lockWait, lockWait)
	def(&t.logoffWait, logoffWait)
	def(&t.poll, sessPoll)
	def(&t.rejoinWindow, RejoinWindowSec*time.Second)
	def(&t.consoleWait, RejoinConsoleWaitSec*time.Second)
	return t
}

// stopper *time.Timer.
type stopper interface{ Stop() bool }

// rejoinState rejoinPending: logoff kabulünden pencere sonuna dek.
type rejoinState struct {
	sessionID string
	base      *Connect // teknisyen/firma/IP (rejoin mesajı taşımaz)
	asked     bool     // K-P28u-17: konsolda kullanıcı oturumu açılırsa session_changed
	oldWin    uint32
	until     time.Time
	msg       *Rejoin // sunucunun bileti (oturum başına bir kez)
	rec       bool    // P28e: son bilinen kayıt durumu (yeni yardımcı eki bununla çizer; rec.state bekleyişte günceller)
}

// rejoinLocked geçerli bekleyiş; süresi dolmuşsa düşürür (kilit altında).
func (c *Core) rejoinLocked() *rejoinState {
	if c.rejoin != nil && !c.clock().Before(c.rejoin.until) {
		c.rejoin = nil
	}
	return c.rejoin
}

// Rejoin DeviceHandler: sunucu yeni bilet gönderdi. Yalnız bekleyen oturum için ve bir kez kabul edilir; yeni konsol
// oturumu belirince yardımcı `Consent:"none"` ile başlatılır (onay yeniden sorulmaz; asked'da kullanıcı varsa bitiş).
func (c *Core) Rejoin(m *Rejoin) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rj := c.rejoinLocked()
	if rj == nil || rj.sessionID != m.SessionID || rj.msg != nil || c.Sessions == nil {
		return // eski/yinelenen bilet: etkisiz (sunucu penceresi odayı bitirir)
	}
	rj.msg = m
	rj.asked = rj.asked || m.Mode == helperio.ModeAsked
	t := c.timings()
	deadline := c.clock().Add(min(t.consoleWait, time.Duration(m.ExpiresInSec)*time.Second))
	if rj.until.Before(deadline) {
		deadline = rj.until
	}
	go c.waitConsole(rj, deadline, t.poll)
}

func (c *Core) waitConsole(rj *rejoinState, deadline time.Time, every time.Duration) {
	for !c.rejoinStep(rj, deadline) {
		time.Sleep(every)
	}
}

// rejoinStep true = bitti (başlatıldı, vazgeçildi ya da bekleyiş başka yoldan düştü).
func (c *Core) rejoinStep(rj *rejoinState, deadline time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.rejoinLocked() != rj {
		return true
	}
	if c.cur == nil {
		if id, ok := c.Sessions.Console(); ok {
			if info, err := c.Sessions.Info(id); err == nil {
				if rj.asked && info.User {
					c.endLocked(KillSessionChanged) // onay aklama yok: yardımcı hiç başlatılmaz
					return true
				}
				c.launchRejoin(rj)
				return true
			}
		}
	}
	if c.clock().Before(deadline) {
		return false
	}
	c.endLocked(KillSessionChanged) // pencerede yeni oturum yok: oturum kapatma yine başarılı
	return true
}

// launchRejoin yerel anahtar her kipte geçerlidir (AC-295); kontrol kapalı başlar (D-P28u-1).
func (c *Core) launchRejoin(rj *rejoinState) {
	if !c.LocalEnabled() {
		c.endLocked(KillLocalDisabled)
		return
	}
	m, b := rj.msg, rj.base
	in := helperio.Input{V: helperio.Version, SessionID: m.SessionID, Ticket: m.Ticket, TechName: b.TechName,
		TenantName: b.TenantName, TechIP: b.TechIP, IndicatorText: m.IndicatorText, ExpiresInSec: m.ExpiresInSec,
		Consent: helperio.ConsentNone, Mode: m.Mode, IndicatorControl: m.IndicatorControl, Recording: rj.rec}
	proc, err := c.Launch.Launch(in)
	if err != nil {
		reason := helperio.ReasonHelperFailed
		if errors.Is(err, ErrNoConsole) {
			reason = helperio.ReasonNoConsole
		}
		c.endLocked(reason)
		return
	}
	c.rejoin = nil
	r := c.register(b, in, proc)
	r.guardLogon = rj.asked
}

// SessionEvent svc SERVICE_CONTROL_SESSIONCHANGE. Konsol geçişi P27 kuralıyla oturumu bitirir (K-P27-12) — logoff
// kabulünden sonraki beklenen geçiş hariç. asked odada logoff kabulünden sonra kullanıcı oturumu açılırsa session_changed.
func (c *Core) SessionEvent(ev uint32) {
	c.mu.Lock()
	rj := c.rejoinLocked()
	switch ev {
	case SessionConsoleConnect, SessionConsoleDisconnect:
		if rj == nil {
			c.killLocked(KillSessionChanged)
		}
	case SessionLogon:
		if (rj != nil && rj.asked) || (c.cur != nil && c.cur.guardLogon) {
			c.endLocked(KillSessionChanged)
		}
	}
	c.mu.Unlock()
	c.UserChanged()
}
