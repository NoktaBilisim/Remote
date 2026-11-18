package flow

import (
	"fmt"
	"net"
	"reflect"
	"strings"
	"testing"

	"remote-support/agent-win/internal/api"
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

// P28g K10 (qa m.5, D-P28g-T2-1): Linux'ta vekil hatası sabit "Vekil sunucuya bağlanılamadı" metnine eşlenir (kod alanına
// dönülür); Windows/macOS'ta aynı hata eski genel ağ metnidir. Sertifika hatası önceliği korunur; metinde adres yok.
func TestP28gK10ProxyMessage(t *testing.T) {
	inner := &net.OpError{Op: "proxyconnect", Net: "tcp", Err: fmt.Errorf("dial tcp 10.9.8.7:3128: connection refused")}
	perr := &api.Error{Err: inner, Proxy: true}
	m, o := classifyFor(perr, true)
	if m.Title != "Vekil sunucuya bağlanılamadı" || o != outRetryCode {
		t.Fatalf("linux: %+v %v", m, o)
	}
	if strings.Contains(m.Title+m.Body, "10.9.8.7") || strings.Contains(m.Title+m.Body, "3128") {
		t.Fatal("metinde vekil adresi")
	}
	if m, o := classifyFor(perr, false); m != msgNetwork || o != outRetryCode {
		t.Fatalf("windows/macOS metni değişmemeli: %+v", m)
	}
	if m, _ := classifyFor(&api.Error{Proxy: true, TLS: true}, true); m != msgTLS {
		t.Fatal("sertifika hatası önceliği")
	}
	if m, _ := classifyFor(&api.Error{}, true); m != msgNetwork {
		t.Fatal("vekilsiz ağ hatası genel metin olmalı")
	}
}
