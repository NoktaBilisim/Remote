package uicore

import (
	"fmt"
	"strings"

	"remote-support/agent-win/internal/flow"
)

// P28d sesli görüşme metinleri (platformsuz; Win32 çizimi voice_windows.go). Kaynak flow.VoiceTexts (mimari-p28d §8).

// VoiceAskBody kabul diyaloğu gövdesi: açıklama, (varsa) dinleyecekler, kulaklık önerisi. Aynı callId'de yerinde
// güncellenir (dinleyecekler değişebilir).
func VoiceAskBody(a flow.VoiceAsk) string {
	lines := []string{flow.VoiceTexts.RequestBody}
	if len(a.Listeners) > 0 {
		lines = append(lines, fmt.Sprintf(flow.VoiceTexts.RequestListeners, strings.Join(a.Listeners, ", ")))
	}
	lines = append(lines, flow.VoiceTexts.Headset)
	return strings.Join(lines, "\r\n")
}

// VoiceIndicator gösterge metni ("● Mikrofon açık" / "● Sessizde"): her zaman üstte şerit ve oturum penceresi satırı.
func VoiceIndicator(muted bool) string {
	if muted {
		return flow.VoiceTexts.MicMuted
	}
	return flow.VoiceTexts.MicOn
}

// VoiceRowText oturum penceresindeki ses satırı: gösterge · Konuşan: … · Dinleyen: … (dinleyen yoksa yok).
func VoiceRowText(v flow.VoiceView) string {
	parts := []string{VoiceIndicator(v.Muted)}
	if len(v.Talkers) > 0 {
		parts = append(parts, fmt.Sprintf(flow.VoiceTexts.Talkers, strings.Join(v.Talkers, ", ")))
	}
	if len(v.Listeners) > 0 {
		parts = append(parts, fmt.Sprintf(flow.VoiceTexts.Listeners, strings.Join(v.Listeners, ", ")))
	}
	return strings.Join(parts, " · ")
}

// VoiceMuteText "Sessize al" ↔ "Mikrofonu aç" düğmesi.
func VoiceMuteText(muted bool) string {
	if muted {
		return flow.VoiceTexts.Unmute
	}
	return flow.VoiceTexts.Mute
}

// VoiceAnnouncements Y-PD-3: yeni dinleyiciler için sohbet "Sistem" satırları ("<Ad> görüşmeyi dinlemeye başladı").
func VoiceAnnouncements(names []string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, fmt.Sprintf(flow.VoiceTexts.NewListener, n))
	}
	return out
}
