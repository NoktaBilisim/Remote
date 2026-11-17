package flow

import (
	"reflect"
	"strings"
	"testing"
)

// AC-404 / AC-399: Linux metinleri tek tabloda, dolu, biçim dizesi değil, CRLF yok; bağlayıcı metinler tasarımla aynı.
func TestAC399P28gLinuxTextsTable(t *testing.T) {
	v := reflect.ValueOf(LinuxTexts)
	for i := range v.NumField() {
		name, s := v.Type().Field(i).Name, v.Field(i).String()
		if strings.TrimSpace(s) == "" || strings.Contains(s, "%") || strings.Contains(s, "\r") {
			t.Errorf("%s: %q", name, s)
		}
	}
	// §5.2b m.4 (r3, Y-P28g-T2-1) bağlayıcı uyarı metni.
	if LinuxTexts.WaylandWarning != "Bu masaüstünde fareniz teknisyenin hareketini durdurmaz; kesmek için Super+L "+
		"(ekranı kilitle) ya da üst çubukta Durdur. Super+L hemen çalışmazsa birkaç kez basın; yine olmazsa önce "+
		"Super+Esc, sonra Super+L." {
		t.Fatal("Wayland uyarı metni mimari-p28g §5.2b m.4 ile aynı olmalı")
	}
	if LinuxTexts.ProxyFailed != "Vekil sunucuya bağlanılamadı" {
		t.Fatal("D-P28g-T2-1 sabit vekil metni")
	}
}
