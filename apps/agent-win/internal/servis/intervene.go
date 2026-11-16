package servis

import (
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

// Müdahale komutları (mimari-p28u §7.5, AC-442..444). İstemci tarafı ret: komut yalnız çalışan yardımcının oturumu
// için, kontrol açıkken (son `ev:control` = on) ve yardımcının Windows oturumu hâlâ etkin konsol oturumuyken
// (D-P28u-3) uygulanır. Kilit yardımcıda (`LockWorkStation`, boru komutu); oturum kapatma serviste (`WTSLogoffSession`).

// Locker oturum kilitleme yolu. Sonuç eşzamansızdır (`ev:lock` ya da zaman aşımı). K-P28u-5b gerekirse (K6s spike:
// kısıtlı SYSTEM jetonundan LockWorkStation çalışmazsa) kullanıcı jetonlu kısa ömürlü `--lock` uygulaması bu arayüzün
// arkasına girer; hedef yine yardımcının oturum kimliğidir.
type Locker interface {
	Lock(p Process, id string) error
}

// pipeLocker varsayılan: giriş borusuna `{"cmd":"lock","id":…}`.
type pipeLocker struct{}

func (pipeLocker) Lock(p Process, id string) error {
	return p.Command(helperio.Command{Cmd: helperio.CmdLock, ID: id})
}

// pendingLogoff onay bekleyen oturum kapatma (tek bekleyen).
type pendingLogoff struct {
	sessionID, id, techName string
	target                  uint32
	deadline                time.Time
}

// Intervene DeviceHandler: sunucunun müdahale komutu.
func (c *Core) Intervene(m *Intervene) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.cur
	if r == nil || r.sessionID != m.SessionID || c.Sessions == nil {
		c.interveneDone(m.SessionID, m.ID, m.Cmd, InterveneNoSession, "")
		return
	}
	if !r.st.control {
		c.interveneDone(m.SessionID, m.ID, m.Cmd, InterveneNotInControl, r.techName)
		return
	}
	target := r.proc.WinSession()
	if id, ok := c.Sessions.Console(); !ok || id != target {
		c.interveneDone(m.SessionID, m.ID, m.Cmd, InterveneNoSession, r.techName) // hızlı kullanıcı değiştirme
		return
	}
	if m.Cmd == CmdLock {
		c.lockLocked(r, m.ID)
		return
	}
	c.logoffLocked(r, m.ID, target)
}

func (c *Core) lockLocked(r *running, id string) {
	if r.st.pendingLock != "" {
		c.interveneDone(r.sessionID, id, CmdLock, InterveneAPIError, r.techName)
		return
	}
	locker := c.Locker
	if locker == nil {
		locker = pipeLocker{}
	}
	if err := locker.Lock(r.proc, id); err != nil {
		c.interveneDone(r.sessionID, id, CmdLock, InterveneAPIError, r.techName)
		return
	}
	r.st.pendingLock = id
	r.lockTimer = time.AfterFunc(c.timings().lockWait, func() { c.lockTimeout(r, id) })
}

func (c *Core) lockTimeout(r *running, id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur != r || r.st.pendingLock != id {
		return
	}
	r.st.pendingLock, r.st.lateLock = "", id // geç gelen tek ev:lock ihlal sayılmaz
	c.interveneDone(r.sessionID, id, CmdLock, InterveneTimeout, r.techName)
}

// logoffLocked: konsolda kullanıcı yoksa no_user; varsa yeniden katılım işareti komut kabul anında konur (yardımcı
// WTS_SESSION_LOGOFF onayından önce ölür) ve WTSLogoffSession çağrılır. Onay hedef oturumda kullanıcının yok olmasıdır.
func (c *Core) logoffLocked(r *running, id string, target uint32) {
	if c.logoff != nil {
		c.interveneDone(r.sessionID, id, CmdLogoff, InterveneAPIError, r.techName)
		return
	}
	if info, err := c.Sessions.Info(target); err == nil && !info.User {
		c.interveneDone(r.sessionID, id, CmdLogoff, InterveneNoUser, r.techName)
		return
	}
	t := c.timings()
	now := c.clock()
	asked := r.mode == helperio.ModeAsked
	c.rejoin = &rejoinState{sessionID: r.sessionID, base: r.conn, asked: asked, oldWin: target,
		until: now.Add(t.rejoinWindow), rec: r.rec}
	r.guardLogon = r.guardLogon || asked
	if err := c.Sessions.Logoff(target); err != nil {
		c.rejoin = nil
		c.interveneDone(r.sessionID, id, CmdLogoff, InterveneAPIError, r.techName)
		return
	}
	lo := &pendingLogoff{sessionID: r.sessionID, id: id, techName: r.techName, target: target,
		deadline: now.Add(t.logoffWait)}
	c.logoff = lo
	go c.pollLogoff(lo, t.poll)
}

// pollLogoff hedef oturumda kullanıcı kalmayana kadar (≤ logoffWait) yoklar.
func (c *Core) pollLogoff(lo *pendingLogoff, every time.Duration) {
	for {
		if c.logoffStep(lo) {
			return
		}
		time.Sleep(every)
	}
}

func (c *Core) logoffStep(lo *pendingLogoff) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.logoff != lo {
		return true
	}
	info, err := c.Sessions.Info(lo.target)
	if err != nil || !info.User {
		c.logoff = nil
		c.interveneDone(lo.sessionID, lo.id, CmdLogoff, "", lo.techName)
		return true
	}
	if c.clock().Before(lo.deadline) {
		return false
	}
	c.logoff = nil
	if rj := c.rejoinLocked(); rj != nil && rj.sessionID == lo.sessionID && rj.msg == nil {
		c.rejoin = nil // ok:false ile aynı temizlik (D-P28u-2)
	}
	c.interveneDone(lo.sessionID, lo.id, CmdLogoff, InterveneTimeout, lo.techName)
	return true
}

// interveneDone sonucu sunucuya ve olay günlüğüne (1006/1007) yazar. reason "" = ok.
func (c *Core) interveneDone(sessionID, id, cmd, reason, techName string) {
	c.Send(&InterveneResult{SessionID: sessionID, ID: id, Cmd: cmd, OK: reason == "", Reason: reason})
	c.Events.Write(evIntervene(cmd, techName, sessionID, reason))
}
