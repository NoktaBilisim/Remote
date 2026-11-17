package ui

import (
	"strings"
	"testing"

	"remote-support/agent-win/internal/flow"
)

// P28d mimari §8: diyalog gövdesi açıklama + dinleyecekler + kulaklık önerisi; dinleyen yoksa satır yok.
func TestP28dVoiceAskBody(t *testing.T) {
	b := voiceAskBody(flow.VoiceAsk{CallID: "c1", Name: "Ayşe", Listeners: []string{"Ali", "Veli"}})
	for _, must := range []string{flow.VoiceTexts.RequestBody, "Görüşmeyi dinleyecekler: Ali, Veli", flow.VoiceTexts.Headset} {
		if !strings.Contains(b, must) {
			t.Fatalf("gövdede %q yok: %q", must, b)
		}
	}
	if b2 := voiceAskBody(flow.VoiceAsk{CallID: "c1", Name: "Ayşe"}); strings.Contains(b2, "dinleyecekler") {
		t.Fatalf("dinleyen yokken satır olmamalı: %q", b2)
	}
	if strings.Count(b, "\r\n") != 2 || strings.Contains(strings.ReplaceAll(b, "\r\n", ""), "\n") {
		t.Fatalf("satırlar CRLF ile ayrılmalı (STATIC denetim): %q", b)
	}
}

// P28d O-PD-3 / Y-PD-3: gösterge ve satır metinleri; duyuru adla, tepsi balonu sabit.
func TestP28dVoiceRowTexts(t *testing.T) {
	if voiceIndicator(false) != flow.VoiceTexts.MicOn || voiceIndicator(true) != flow.VoiceTexts.MicMuted {
		t.Fatal("gösterge metni")
	}
	got := voiceRowText(flow.VoiceView{On: true, Talkers: []string{"A", "B"}, Listeners: []string{"C"}})
	if got != "● Mikrofon açık · Konuşan: A, B · Dinleyen: C" {
		t.Fatalf("satır: %q", got)
	}
	if got := voiceRowText(flow.VoiceView{On: true, Muted: true, Talkers: []string{"A"}}); got != "● Sessizde · Konuşan: A" {
		t.Fatalf("sessizde satır: %q", got)
	}
	if voiceMuteText(false) != flow.VoiceTexts.Mute || voiceMuteText(true) != flow.VoiceTexts.Unmute {
		t.Fatal("sessize al / mikrofonu aç")
	}
	a := voiceAnnouncements([]string{"Can"})
	if len(a) != 1 || a[0] != "Can görüşmeyi dinlemeye başladı" {
		t.Fatalf("duyuru: %q", a)
	}
	if strings.Contains(flow.VoiceTexts.Balloon, "%") {
		t.Fatal("tepsi balonu sabit metin olmalı (K-P20-9: ad yok)")
	}
}
