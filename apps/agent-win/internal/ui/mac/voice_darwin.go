//go:build darwin

package mac

import (
	"fmt"
	"strings"
	"sync/atomic"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/macperm"
	"remote-support/agent-win/internal/ui/uicore"
)

// P33 K1 sesli görüşme (mimari-p33 §6.5; ui/gtk/voice_linux.go kalıbı). Kabul diyaloğu ortak korunan diyalogdur
// (K-PD-2: 1,5 sn kilit, yalnız localClick, açıkken enjektör durur). Mikrofon açıkken gösterge şeridinde (§5.2b:
// canHide=NO, küçültülemez, 1 sn tik) "● Mikrofon açık" satırı; gösterge 3 tik görünür kılınamazsa görüşme
// voice.end{device} ile biter (S-P33-T-6). "Mikrofonu aç" ve rehberdeki "Sistem Ayarları'nı aç" yalnız yerel
// tıklamayla; "Sessize al" ve "Görüşmeyi bitir" güvenli yön.

// voiceFail deps_darwin'in görüşme başına bağladığı aygıt hatası kancası (gösterge sağlığı bozulunca çağrılır).
var voiceFail atomic.Pointer[func()]

// SetVoiceFail görüşmenin aygıt hatası yolunu bağlar (nil: görüşme yok).
func (u *UI) SetVoiceFail(fn func()) {
	if fn == nil {
		voiceFail.Store(nil)
		return
	}
	voiceFail.Store(&fn)
}

// VoiceAsk flow.VoiceUI: aynı callId'de gövde yerinde güncellenir.
func (u *UI) VoiceAsk(a flow.VoiceAsk) {
	u.do(func() {
		if d := u.voiceDlg; d != nil && !d.decided && u.voiceAskID == a.CallID {
			setText(d.body, uicore.VoiceAskBody(a))
			return
		}
		closePrompt(u.voiceDlg)
		id := a.CallID
		u.voiceAskID = id
		u.voiceDlg = u.newPrompt(promptSpec{title: fmt.Sprintf(flow.VoiceTexts.RequestTitle, a.Name),
			body: uicore.VoiceAskBody(a), bodyH: 120, grantText: uicore.StripAccel(flow.VoiceTexts.Accept),
			denyText: uicore.StripAccel(flow.VoiceTexts.Reject), hotkeyOK: true, slot: &u.voiceDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvVoiceAccept, CallID: id}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvVoiceReject, CallID: id}) }})
	})
}

// VoiceAskClosed diyalog karar verilmeden kapanır (yalnız aynı callId'ninki).
func (u *UI) VoiceAskClosed(callID string) {
	u.do(func() {
		if u.voiceAskID == callID {
			closePrompt(u.voiceDlg)
			u.voiceDlg, u.voiceAskID = nil, ""
		}
	})
}

// VoiceBar oturum penceresi ses satırı ve gösterge satırı; yeni dinleyici duyurusu sohbete "Sistem" satırı.
func (u *UI) VoiceBar(v flow.VoiceView) {
	u.do(func() {
		u.voiceOn, u.voiceMuted = v.On, v.On && v.Muted
		u.applyVoiceIndicator()
		s := u.sess
		if s == nil || s.finished {
			return
		}
		if !v.On {
			for _, c := range s.voiceCtl() {
				show(c, false)
			}
			if v.Note != "" {
				u.appendLine(s, "Sistem", v.Note)
			}
			return
		}
		setText(s.voiceLbl, uicore.VoiceRowText(v))
		s.voiceMute.Send(selSetTitle, nsstr(uicore.StripAccel(uicore.VoiceMuteText(u.voiceMuted))))
		for _, c := range s.voiceCtl() {
			show(c, true)
		}
		for _, line := range uicore.VoiceAnnouncements(v.Announce) {
			u.appendLine(s, "Sistem", line)
		}
	})
}

func (s *sessionWin) voiceCtl() [3]objc.ID { return [3]objc.ID{s.voiceLbl, s.voiceMute, s.voiceEnd} }

// voiceIndicatorText gösterge metnine eklenen ses parçası (görüşme yoksa boş).
func (u *UI) voiceIndicatorText() string {
	if !u.voiceOn {
		return ""
	}
	return flow.MacVoiceTexts.IndicatorOn + uicore.VoiceIndicator(u.voiceMuted)
}

// applyVoiceIndicator göstergenin ana metnine ses parçasını ekler/kaldırır (ana metin ControlState'te değişir).
func (u *UI) applyVoiceIndicator() {
	if u.ind == nil {
		return
	}
	base := u.ind.text
	if i := strings.Index(base, flow.MacVoiceTexts.IndicatorOn); i >= 0 {
		base = base[:i]
	}
	u.ind.setText(base + u.voiceIndicatorText())
}

// voiceMuteClicked "Sessize al" güvenli yön; "Mikrofonu aç" yalnız yerel tıklamayla.
func (u *UI) voiceMuteClicked(s *sessionWin, sender objc.ID) {
	if s.finished || !u.voiceOn {
		return
	}
	mute := !u.voiceMuted
	if !mute && clickOf(sender) != clickLocal {
		return
	}
	u.emit(flow.Event{Kind: flow.EvVoiceMute, On: mute})
}

// voiceHealth S-P33-T-6: gösterge 3 ardışık tikte görünür kılınamadıysa (Health.Failed) mikrofon açık görüşme aygıt
// hatasıyla biter (bir kez). Her tikte indicatorTick'ten sonra çağrılır.
func (u *UI) voiceHealth() {
	if !u.voiceOn || !u.health.Failed {
		u.voiceTripped = false
		return
	}
	if u.voiceTripped {
		return
	}
	u.voiceTripped = true
	if fn := voiceFail.Load(); fn != nil {
		go (*fn)()
	}
}

// MicGuide Mikrofon izni rehberi (§6.5): "Sistem Ayarları'nı aç" korunan düğmedir (localClick, 1,5 sn kilit).
func (u *UI) MicGuide() {
	u.do(func() {
		if u.micDlg != nil && !u.micDlg.decided {
			u.micDlg.present()
			return
		}
		tx := flow.MacVoiceTexts
		u.micDlg = u.newPrompt(promptSpec{title: tx.GuideTitle, body: tx.GuideBody, bodyH: 150, grantText: tx.GuideOpen,
			denyText: tx.GuideClose, hotkeyOK: true, slot: &u.micDlg,
			onGrant: func() { openURL(macperm.MicSettingsURL) }})
	})
}

// HoldInjection S-P33-T-4: Mikrofon TCC istemi sürerken enjektör duraklar (korunan diyalog sayacıyla aynı kanca;
// istem sistem penceresidir, uzaktan tıklama ona ulaşmasın). Akış goroutine'inden çağrılır; ana iş parçacığında
// uygulanana dek bekler.
func (u *UI) HoldInjection(on bool) {
	done := make(chan struct{})
	u.do(func() {
		if on {
			u.protectedDelta(1)
		} else {
			u.protectedDelta(-1)
		}
		close(done)
	})
	<-done
}

var _ flow.VoiceUI = (*UI)(nil)
