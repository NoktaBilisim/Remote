package flow

import (
	"reflect"
	"strings"
	"testing"
)

// AC-404 / AC-390 / AC-391: macOS metinleri tek tabloda, dolu, biçim dizesi değil (teknisyen metni yok), CRLF yok.
func TestAC391P28fMacTextsTable(t *testing.T) {
	v := reflect.ValueOf(MacTexts)
	for i := range v.NumField() {
		name, s := v.Type().Field(i).Name, v.Field(i).String()
		if strings.TrimSpace(s) == "" || strings.Contains(s, "%") || strings.Contains(s, "\r") {
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
