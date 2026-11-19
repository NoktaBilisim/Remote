//go:build windows

package ui

import (
	"fmt"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// P28d sesli görüşme — müşteri arayüzü (mimari-p28d r3 §8, §14 K-PD-2 / O-PD-3 / Y-PD-3). Kararlar flow'dadır; burada
// yalnız çizim ve yerel tıklamalar:
//   - Kabul diyaloğu ortak izin diyaloğudur (newConsent, G-03): odak "Reddet", "Kabul et" 1,5 sn kilitli, Enter/Space
//     tetiklemez, tıklamayı üreten olay enjekteyse (teknisyenin SendInput'u) kabul edilmez → EvVoiceAccept yalnız gerçek
//     yerel tıklamayla (K-PD-2).
//   - Mikrofon açıkken her monitörde her zaman üstte, odak almayan, tıklama geçirgen, yakalamadan hariç gösterge şeridi
//     (recStrip kalıbı); oturum penceresi küçültülse ve tepsi olmasa da görünür (O-PD-3). Tepsi varsa ipucu ve menü.
//   - Yeni dinleyici (Y-PD-3): sohbete "Sistem" satırı (adla) + pencere yanıp söner + sabit tepsi balonu (ad yok, K-P20-9).

const (
	idVoiceMute = 46
	idVoiceEnd  = 47
	// voiceStripTop ses şeridinin monitör üstüne uzaklığı: gösterge etiketi (0–32), bildirim satırı (36–64) ve kayıt
	// şeridinin (68–98) altında; kayıt ve görüşme aynı anda olabilir.
	voiceStripTop = 102
)

// VoiceAsk flow.VoiceUI: kabul diyaloğu; aynı callId'de gövde yerinde güncellenir (yeniden kurulmaz, kilit sürmez).
func (u *UI) VoiceAsk(a flow.VoiceAsk) {
	u.t.Do(func() {
		if d := u.voiceDlg; d != nil && !d.decided && u.voiceAskID == a.CallID {
			win.SetText(d.body.h, uicore.VoiceAskBody(a))
			return
		}
		closeDlg(u.voiceDlg)
		id := a.CallID
		u.voiceAskID = id
		u.voiceDlg = u.newConsent(consentSpec{
			title:     flow.VoiceTexts.DialogTitle,
			heading:   fmt.Sprintf(flow.VoiceTexts.RequestTitle, a.Name),
			body:      uicore.VoiceAskBody(a),
			grantText: flow.VoiceTexts.Accept,
			denyText:  flow.VoiceTexts.Reject,
			hotkeyOK:  true, // kısayol koşulu yalnız kontrol diyaloğunda (G-21)
			slot:      &u.voiceDlg,
			onGrant:   func() { u.emit(flow.Event{Kind: flow.EvVoiceAccept, CallID: id}) },
			onDeny:    func() { u.emit(flow.Event{Kind: flow.EvVoiceReject, CallID: id}) },
		})
	})
}

// VoiceAskClosed flow.VoiceUI: diyalog karar verilmeden kapanır (yalnız aynı callId'ninki).
func (u *UI) VoiceAskClosed(callID string) {
	u.t.Do(func() {
		if u.voiceAskID == callID {
			closeDlg(u.voiceDlg)
			u.voiceDlg, u.voiceAskID = nil, ""
		}
	})
}

// VoiceBar flow.VoiceUI: oturum penceresi ses satırı, gösterge şeridi, tepsi göstergesi ve yeni dinleyici duyurusu.
// On=false: hepsi kalkar; Note (görüşme bitti / aygıt hatası yol tarifi) sohbete "Sistem" satırı olarak yazılır (uzun
// V-PD-1 metni satıra sığmaz, geçmişte tam okunur).
func (u *UI) VoiceBar(v flow.VoiceView) {
	u.t.Do(func() {
		u.voiceOn, u.voiceMuted = v.On, v.On && v.Muted
		if u.voiceTray != nil {
			u.voiceTray(u.voiceOn, u.voiceMuted)
		}
		s := u.sess
		live := s != nil && !s.finished
		if !v.On {
			u.dropVoiceStrip()
			if live {
				showVoiceRow(s, false)
				if v.Note != "" {
					s.appendSystem(v.Note)
					u.flashSession(s)
				}
			}
			return
		}
		// Gösterge pencere durumundan bağımsız: oturum penceresi yoksa/bittiyse de şerit çizilir (O-PD-3 güvenli yön).
		if u.vstrip == nil {
			u.vstrip = newStrip(u.t, uicore.VoiceIndicator(u.voiceMuted), voiceStripTop, nil)
		} else {
			u.vstrip.setText(uicore.VoiceIndicator(u.voiceMuted))
		}
		if live {
			win.SetText(s.voiceLbl.h, uicore.VoiceRowText(v))
			win.SetText(s.voiceMute.h, uicore.VoiceMuteText(u.voiceMuted))
			showVoiceRow(s, true)
			for _, line := range uicore.VoiceAnnouncements(v.Announce) {
				s.appendSystem(line)
			}
		}
		if len(v.Announce) > 0 {
			if live {
				u.flashSession(s)
			}
			if u.voiceBalloon != nil {
				u.voiceBalloon(flow.VoiceTexts.Balloon)
			}
		}
	})
}

// SetVoiceTray tepsi simgesi sahibi (main.go) ses göstergesi (ipucu + menüde "Görüşmeyi bitir") ve sabit balon
// işlevlerini verir; tepsi yoksa işlevler hiçbir şey yapmaz. UI iş parçacığında çağrılır (SetRequestChatBalloon kalıbı).
func (u *UI) SetVoiceTray(set func(on, muted bool), balloon func(text string)) {
	u.t.Do(func() { u.voiceTray, u.voiceBalloon = set, balloon })
}

// VoiceEnd tepsi menüsünden "Görüşmeyi bitir" (güvenli yön: yalnız kapatır).
func (u *UI) VoiceEnd() { u.emit(flow.Event{Kind: flow.EvVoiceEnd}) }

// newVoiceRow ses satırı denetimleri (gizli): iki satırlık gösterge etiketi + "Sessize al" + "Görüşmeyi bitir".
func (s *sessionWin) newVoiceRow(f *form, y int32) {
	s.voiceLbl = f.danger("", 16, y, 184, uicore.VoiceRowH-2, fontNormal)
	s.voiceMute = f.button(flow.VoiceTexts.Mute, idVoiceMute, 204, y+2, 104, false)
	s.voiceEnd = f.button(flow.VoiceTexts.End, idVoiceEnd, 312, y+2, 112, false)
	showVoiceRow(s, false)
}

func showVoiceRow(s *sessionWin, on bool) {
	show := win.SW_HIDE
	if on {
		show = win.SW_SHOWNOACTIVATE
	}
	for _, c := range []*ctrl{s.voiceLbl, s.voiceMute, s.voiceEnd} {
		win.ShowWindow(c.h, show)
	}
}

// voiceCommand ses satırı düğmeleri. Sessize alma ve bitirme güvenli yöndür; "Mikrofonu aç" (sesi yeniden gönderme)
// yalnız bu pencereye gelen gerçek yerel girdiyle (teknisyenin SendInput'u ile değil; clipClicked / S7-5 kalıbı).
func (u *UI) voiceCommand(s *sessionWin, id, code int) {
	if code != win.BN_CLICKED || s.finished || !u.voiceOn {
		return
	}
	switch id {
	case idVoiceMute:
		mute := !u.voiceMuted
		if !mute && !u.t.userInput(s.f) {
			return
		}
		u.emit(flow.Event{Kind: flow.EvVoiceMute, On: mute})
	case idVoiceEnd:
		u.emit(flow.Event{Kind: flow.EvVoiceEnd})
	}
}

// flashSession pencere ön planda değilse başlık ve görev çubuğu düğmesi öne gelene kadar yanıp söner (belirgin duyuru).
func (u *UI) flashSession(s *sessionWin) {
	if win.Foreground() != s.f.h || !windows.IsWindowVisible(windows.HWND(s.f.h)) {
		win.FlashUntilFocus(s.f.h)
	}
}

func (u *UI) dropVoiceStrip() {
	if u.vstrip != nil {
		u.vstrip.close()
		u.vstrip = nil
	}
}

// resetVoice kapsam sonu (ResetScope): diyalog, şerit ve tepsi göstergesi kalkar. Akış oturum sonunda mikrofonu zaten
// bırakmış ve VoiceBar{On:false} göndermiştir (cleanup → voiceDrop); bu yalnız artık kalanı temizler.
func (u *UI) resetVoice() {
	closeDlg(u.voiceDlg)
	u.voiceDlg, u.voiceAskID = nil, ""
	u.dropVoiceStrip()
	if u.voiceOn && u.voiceTray != nil {
		u.voiceTray(false, false)
	}
	u.voiceOn, u.voiceMuted = false, false
}

var _ flow.VoiceUI = (*UI)(nil)
