package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// P28g K10 (D-P28g-T2-1, qa m.5): vekil hataları Proxy=true; hata metninde vekil adresi yok. Vekile bağlanılamadı
// (proxyconnect) ve CONNECT reddi (407) ayrı ayrı; vekilsiz ağ hatası Proxy=false.
func TestP28gK10ProxyErrorClassified(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := ln.Addr().String()
	ln.Close()
	reject := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusProxyAuthRequired)
	}))
	defer reject.Close()
	rejectURL, _ := url.Parse(reject.URL)
	base, _ := url.Parse("https://destek.example.invalid")
	for _, c := range []struct {
		name  string
		proxy *url.URL
		want  bool
	}{
		{"vekile bağlanılamadı", &url.URL{Scheme: "http", Host: closed}, true},
		{"CONNECT 407", rejectURL, true},
	} {
		cl := newClient(base, "1.0.0", nil)
		cl.http.Transport.(*http.Transport).Proxy = http.ProxyURL(c.proxy)
		_, err := cl.Join(context.Background(), JoinRequest{JoinNonce: "n"})
		var ae *Error
		if !errors.As(err, &ae) || ae.Status != 0 || ae.Proxy != c.want || ae.TLS {
			t.Fatalf("%s: %#v", c.name, err)
		}
		if strings.Contains(ae.Error(), c.proxy.Host) || strings.Contains(ae.Error(), c.proxy.Hostname()) {
			t.Fatalf("%s: hata metninde vekil adresi: %q", c.name, ae.Error())
		}
	}
	// Vekilsiz ağ hatası vekil sayılmaz.
	u, _ := url.Parse("https://" + closed)
	cl := newClient(u, "1.0.0", nil)
	cl.http.Transport.(*http.Transport).Proxy = nil
	_, err = cl.Join(context.Background(), JoinRequest{JoinNonce: "n"})
	var ae *Error
	if !errors.As(err, &ae) || ae.Status != 0 || ae.Proxy {
		t.Fatalf("doğrudan bağlantı hatası: %#v", err)
	}
	if !isProxyError(errProxy) || isProxyError(errors.New("x")) {
		t.Fatal("isProxyError")
	}
}
