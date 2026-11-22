//go:build darwin

package main

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/macperm"
	"remote-support/agent-win/internal/voice"
)

// macVoiceUI ui/mac'in ses için ek kancaları (voice_darwin.go): Mikrofon rehberi, TCC istemi sürerken enjektörü
// durdurma (S-P33-T-4) ve gösterge sağlığı bozulunca görüşmeyi aygıt hatasıyla bitirme (S-P33-T-6).
type macVoiceUI interface {
	MicGuide()
	HoldInjection(on bool)
	SetVoiceFail(fn func())
}

// macVoiceDeps P33 K1 (mimari-p33 §6.5, K-P33-11): yoklama geçtiyse ve arayüz uyguluyorsa ses bağlanır; aksi
// alanlar nil kalır ve `rs.cap.voice1` bildirilmez (flow.Features). Features'tan ÖNCE çağrılır.
func macVoiceDeps(d *flow.Deps, u flow.UI) {
	vu, ok := u.(flow.VoiceUI)
	mu, ok2 := u.(macVoiceUI)
	if !ok || !ok2 || !voice.Supported() {
		return
	}
	d.VoiceUI = vu
	d.OpenVoice = func(onFail func(error)) (flow.VoiceCall, error) { return openMacVoice(mu, onFail) }
}

// openMacVoice yalnız yerel "Kabul et"ten sonra akışın goroutine'inde çağrılır (K-PD-2). Mikrofon izni burada
// denetlenir; belirlenmemişse sistem istemi açılır ve yanıt gelene dek (≤ 60 sn) enjektör duraklar. İzin yok →
// rehber + voice.end{device} (flow, ErrDeviceDenied). Hata açıkça nil arayüzle döner.
func openMacVoice(mu macVoiceUI, onFail func(error)) (flow.VoiceCall, error) {
	switch macperm.Microphone() {
	case macperm.MicAuthorized:
	case macperm.MicNotDetermined:
		mu.HoldInjection(true)
		granted := macperm.RequestMicrophone(macperm.MicRequestWait)
		mu.HoldInjection(false)
		if !granted {
			mu.MicGuide()
			return nil, voice.ErrDeviceDenied
		}
	default:
		mu.MicGuide()
		return nil, voice.ErrDeviceDenied
	}
	c, err := voice.New(voice.OpenAudioQueue, onFail)
	if err != nil {
		return nil, err
	}
	mu.SetVoiceFail(func() { onFail(voice.ErrDevice) })
	return &macCall{Call: c, mu: mu}, nil
}

// macCall görüşme bitince gösterge kancası çözülür.
type macCall struct {
	*voice.Call
	mu macVoiceUI
}

func (c *macCall) Close() error {
	c.mu.SetVoiceFail(nil)
	return c.Call.Close()
}
