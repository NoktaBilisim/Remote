//go:build linux

package gtk

import (
	"fmt"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// P28d sesli görüşme (voice_windows.go kalıbı): kabul diyaloğu ortak korunan diyalogdur (K-PD-2); mikrofon açıkken
// göstergede "● Mikrofon açık" satırı (O-PD-3); oturum penceresinde ses satırı. "Mikrofonu aç" korunan denetimdir,
// "Sessize al" ve "Görüşmeyi bitir" güvenli yön.

// VoiceAsk flow.VoiceUI: aynı callId'de gövde yerinde güncellenir (yeniden kurulmaz, kilit sürmez).
func (u *UI) VoiceAsk(a flow.VoiceAsk) {
	u.do(func() {
		if d := u.voiceDlg; d != nil && !d.decided && u.voiceAskID == a.CallID {
			setText(d.body, uicore.VoiceAskBody(a))
			return
		}
		closePrompt(u.voiceDlg)
		id := a.CallID
		u.voiceAskID = id
		u.voiceDlg = u.newPrompt(promptSpec{title: flow.VoiceTexts.DialogTitle,
			heading: fmt.Sprintf(flow.VoiceTexts.RequestTitle, a.Name), body: uicore.VoiceAskBody(a),
			grantText: flow.VoiceTexts.Accept, denyText: flow.VoiceTexts.Reject, hotkeyOK: true, slot: &u.voiceDlg,
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

// VoiceBar oturum penceresi ses satırı ve gösterge satırı; yeni dinleyici duyurusu sohbete "Sistem" satırı + aciliyet.
func (u *UI) VoiceBar(v flow.VoiceView) {
	u.do(func() {
		u.voiceOn, u.voiceMuted = v.On, v.On && v.Muted
		if u.ind != nil {
			u.ind.setVoice(u.voiceOn, u.voiceMuted)
		}
		s := u.sess
		live := s != nil && !s.finished
		if !live {
			return
		}
		if !v.On {
			show(s.voiceBox, false)
			if v.Note != "" {
				u.appendLine(s, "Sistem", v.Note)
				gtkWindowSetUrgencyHint(s.f.win, true)
			}
			return
		}
		setText(s.voiceLbl, uicore.VoiceRowText(v))
		gtkButtonSetLabel(s.voiceMute, cstr(uicore.StripAccel(uicore.VoiceMuteText(u.voiceMuted))))
		show(s.voiceBox, true)
		for _, line := range uicore.VoiceAnnouncements(v.Announce) {
			u.appendLine(s, "Sistem", line)
		}
		if len(v.Announce) > 0 && !gtkWindowIsActive(s.f.win) {
			gtkWindowSetUrgencyHint(s.f.win, true)
		}
	})
}

// voiceMuteClicked "Sessize al" güvenli yön; "Mikrofonu aç" yalnız yerel tıklamayla. Düğme korunan düğme olarak
// kurulur (iki yön tek denetim); sessize alma da yalnız fare ile — klavye/Orca için "Görüşmeyi bitir" güvenli yoldur.
func (u *UI) voiceMuteClicked(s *sessionWin, k clickKind) {
	if s.finished || !u.voiceOn {
		return
	}
	mute := !u.voiceMuted
	if !mute && k != clickLocal {
		return
	}
	u.emit(flow.Event{Kind: flow.EvVoiceMute, On: mute})
}

var _ flow.VoiceUI = (*UI)(nil)
