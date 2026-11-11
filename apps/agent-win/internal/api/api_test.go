package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

func trusted(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	u, _ := url.Parse(srv.URL)
	return newClient(u, "1.0.0", &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool})
}

func TestAC14ResolveSendsAgentKindWithoutOrigin(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/public/sessions/resolve" || r.URL.RawQuery != "" || r.Method != http.MethodPost {
			t.Errorf("beklenmeyen istek %s %s", r.Method, r.URL)
		}
		for _, h := range []string{"Origin", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Cookie"} {
			if r.Header.Get(h) != "" {
				t.Errorf("%s başlığı gönderilmemeli", h)
			}
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["clientKind"] != "AGENT" || body["code"] != "12345678" || len(body) != 2 {
			t.Errorf("gövde %v", body)
		}
		_, _ = w.Write([]byte(`{"sessionRef":"r","tenant":{"name":"Nokta","logoUrl":"/l.png"},"technician":{"name":"Ali"},
			"techVerifyCode":"7731","consentText":{"id":"c1","version":2,"body":"metin","sha256":"ab"},"abuseEmail":null,
			"expiresAt":"2026-11-11T12:00:00.000Z","joinNonce":"n1","nonceExpiresAt":"2026-11-11T11:10:00.000Z"}`))
	}))
	defer srv.Close()
	res, err := trusted(t, srv).Resolve(context.Background(), "12345678")
	if err != nil {
		t.Fatal(err)
	}
	if res.JoinNonce != "n1" || res.Technician.Name != "Ali" || res.ConsentText.Version != 2 || res.AbuseEmail != nil {
		t.Fatalf("yanıt %+v", res)
	}
}

func TestAC109RejectsUntrustedCertificate(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	_, err := New(u, "1.0.0").Resolve(context.Background(), "12345678") // sistem kökleri: httptest sertifikası güvenilmez
	var ae *Error
	var certErr *tls.CertificateVerificationError
	if !errors.As(err, &ae) || ae.Status != 0 || !errors.As(err, &certErr) {
		t.Fatalf("sertifika hatası beklenirdi: %v", err)
	}
	if hits.Load() != 0 {
		t.Fatal("doğrulanmamış sunucuya istek ulaşmamalı")
	}
}

func TestAC97ResolveErrorEnvelopeNotRetried(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusGone)
		_, _ = w.Write([]byte(`{"error":{"code":"SESSION_EXPIRED","message":"Kodun süresi doldu.","requestId":"req1"}}`))
	}))
	defer srv.Close()
	_, err := trusted(t, srv).Resolve(context.Background(), "12345678")
	var ae *Error
	if !errors.As(err, &ae) || ae.Status != 410 || ae.Code != "SESSION_EXPIRED" || ae.RequestID != "req1" || ae.Message == "" {
		t.Fatalf("hata %#v", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("4xx yeniden denenmemeli: %d", hits.Load())
	}
}

func TestResolveRetriesOn503ThenSucceeds(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"sessionRef":"r","joinNonce":"n","expiresAt":"2026-11-11T12:00:00Z","nonceExpiresAt":"2026-11-11T12:00:00Z"}`))
	}))
	defer srv.Close()
	if _, err := trusted(t, srv).Resolve(context.Background(), "12345678"); err != nil || hits.Load() != 2 {
		t.Fatalf("err=%v hits=%d", err, hits.Load())
	}
}

func TestAC98JoinNoClientKindNoRetryNoRedirect(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["clientKind"]; ok || body["consentAccepted"] != true || body["joinNonce"] != "n1" {
			t.Errorf("join gövdesi %v", body)
		}
		if _, ok := body["customerEmail"]; ok {
			t.Errorf("boş e-posta gönderilmemeli")
		}
		if hits.Load() == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		http.Redirect(w, r, "https://evil.example/", http.StatusFound)
	}))
	defer srv.Close()
	c := trusted(t, srv)
	req := JoinRequest{JoinNonce: "n1", CustomerName: "Ayşe", ConsentTextID: "c1", ConsentAccepted: true}
	_, err := c.Join(context.Background(), req)
	var ae *Error
	if !errors.As(err, &ae) || ae.Status != 503 || hits.Load() != 1 {
		t.Fatalf("join yeniden denenmemeli: %v hits=%d", err, hits.Load())
	}
	_, err = c.Join(context.Background(), req)
	if !errors.As(err, &ae) || ae.Status != http.StatusFound {
		t.Fatalf("yönlendirme izlenmemeli: %v", err)
	}
}
