package servis

import "remote-support/agent-win/internal/servis/helperio"

// P28e gözetimsiz kayıt (mimari-p28e r2 §2.2, §6.2, §8; AC-448, AC-449). Kayıt teknisyen konsolunda alınır; servis
// yalnız göstergeyi doğru tutar: `connect.recording` → yardımcı girdisi (asked diyalog satırı + gösterge eki),
// `rec.state{on}` → yardımcıya `rec` komutu (ek eklenir/kaldırılır). Cihaz kullanıcısına durdurma yolu verilmez; tek yol
// yerel anahtardır (AC-295: bağlantı kesilir, kayıt kaynağı biter). Sunucu hangi durumu bildirirse gösterge onu çizer:
// `on:true` connect.recording olmadan gelse de ek çizilir (gizli kayıt olmaz — K-P28e-7 güvenli yön).

func (c *Core) record1() bool { return c.Record1 != nil && c.Record1() }

// RecState DeviceHandler: sunucunun `rec.state{on}`'u (yalnız record1 sokette). Değişim yoksa etkisiz.
func (c *Core) RecState(on bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if r := c.cur; r != nil {
		if r.rec == on {
			return
		}
		r.rec = on
		if err := r.proc.Command(helperio.Command{Cmd: helperio.CmdRec, On: &on}); err != nil && on {
			c.killLocked(helperio.ReasonIndicatorFailed) // ek çizdirilemiyor: kayıt göstergesiz sürmez (fail-closed)
		}
		c.Events.Write(evRecord(r.sessionID, r.techName, on))
		return
	}
	if rj := c.rejoinLocked(); rj != nil && rj.rec != on { // oturum kapatma sonrası bekleyiş: yeni yardımcı bununla başlar
		rj.rec = on
		c.Events.Write(evRecord(rj.sessionID, rj.base.TechName, on))
	}
}
