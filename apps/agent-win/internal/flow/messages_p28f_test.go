package flow

import (
	"reflect"
	"strings"
	"testing"
)

// AC-404 / AC-390 / AC-391: macOS metinleri tek tabloda, dolu, biçim dizesi değil (AC-504 AboutSigDevID tek %s hariç;
// teknisyen metni yok), CRLF yok.
func TestAC391P28fMacTextsTable(t *testing.T) {
	v := reflect.ValueOf(MacTexts)
	for i := range v.NumField() {
		name, s := v.Type().Field(i).Name, v.Field(i).String()
		want := 0
		if name == "AboutSigDevID" { // AC-504: tablodaki tek biçim dizesi, yalnız Team ID (tek %s)
			want = 1
		}
		pct := strings.Count(s, "%")
		if strings.TrimSpace(s) == "" || pct != want || pct != strings.Count(s, "%s") || strings.Contains(s, "\r") {
			t.Errorf("%s: %q", name, s)
		}
	}
	if MacTexts.TestBand != "TEST SÜRÜMÜ — imzasız" {
		t.Fatal("AC-390 bant metni gereksinimle aynı olmalı")
	}
	for _, must := range []string{MacTexts.OpenSettings, MacTexts.RestartGranted} {
		if !strings.Contains(MacTexts.ScreenSteps, must) {
			t.Errorf("adımlar düğme adını aynen anmalı: %q", must)
		}
	}
}

// AC-506 / K-P28f-r4-8 / S-r4-9: iki rehber eski TCC kaydının "−" ile kaldırılmasını her derlemede aynı metinle anar;
// Erişilebilirlik metninde "+" ile ekleme yolu yoktur.
func TestAC506StaleTCCStep(t *testing.T) {
	for name, s := range map[string]string{"ScreenSteps": MacTexts.ScreenSteps, "AccessBody": MacTexts.AccessBody} {
		if !strings.Contains(s, "\"−\" ile") || !strings.Contains(s, "yeniden açın") {
			t.Errorf("%s eski kayıt adımı eksik: %q", name, s)
		}
	}
	if !strings.Contains(MacTexts.ScreenSteps, "\n4. ") {
		t.Error("ScreenSteps 4. adım")
	}
	if !strings.Contains(MacTexts.AccessBody, MacTexts.OpenSettings) {
		t.Error("AccessBody düğme adını aynen anmalı (AXIsProcessTrustedWithOptions istemi, S-r4-9)")
	}
	if strings.Contains(MacTexts.AccessBody, "+") {
		t.Error("S-r4-9: AccessBody'de \"+\" ile ekleme yolu olmamalı")
	}
}
