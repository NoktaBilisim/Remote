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
	"runtime"
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
		if body["clientKind"] != "AGENT" || body["code"] != "12345678" || body["clientVersion"] != "1.0.0" ||
			body["clientOs"] != clientOS(runtime.GOOS) || len(body) != 4 {
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

// P28f (mimari-p28f §4.1): GOOS → contracts CLIENT_OS; bilinmeyen platform alan göndermez (400 yerine "windows" sayılır).
func TestP28fResolveClientOSMapping(t *testing.T) {
	for goos, want := range map[string]string{"windows": "windows", "darwin": "macos", "linux": "linux", "freebsd": "", "": ""} {
		if got := clientOS(goos); got != want {
			t.Errorf("clientOS(%q) = %q, beklenen %q", goos, got, want)
		}
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
	if !errors.As(err, &ae) || ae.Status != 0 || !errors.As(err, &certErr) || !ae.TLS || ae.Retryable() {
		t.Fatalf("sertifika hatası (TLS, yeniden denenmez) beklenirdi: %v", err)
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

func TestAC109TLSErrorClassification(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	u, _ := url.Parse(srv.URL)
	cases := []struct {
		name string
		cfg  *tls.Config
	}{
		{"güvenilmeyen kök", &tls.Config{MinVersion: tls.VersionTLS12}},
		{"ad uyuşmazlığı", &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool, ServerName: "baska.example"}},
	}
	for _, c := range cases {
		_, err := newClient(u, "1.0.0", c.cfg).Join(context.Background(), JoinRequest{JoinNonce: "n"})
		var ae *Error
		if !errors.As(err, &ae) || ae.Status != 0 || !ae.TLS || ae.Retryable() {
			t.Errorf("%s: TLS hatası beklenirdi: %#v", c.name, err)
		}
	}
	// Sertifikayla ilgisiz ağ hatası TLS sayılmaz ve yeniden denenebilir.
	closed := httptest.NewServer(http.NotFoundHandler())
	cu, _ := url.Parse(closed.URL)
	closed.Close()
	_, err := New(cu, "1.0.0").Join(context.Background(), JoinRequest{JoinNonce: "n"})
	var ae *Error
	if !errors.As(err, &ae) || ae.Status != 0 || ae.TLS || !ae.Retryable() {
		t.Fatalf("ağ hatası TLS sayılmamalı: %#v", err)
	}
}

func TestAC133TenantInfoGetWithRefNoOrigin(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/public/requests/tenant" || r.URL.Query().Get("ref") != "abcdefghijk23456" {
			t.Errorf("beklenmeyen istek %s %s", r.Method, r.URL)
		}
		if r.Header.Get("Origin") != "" || r.Header.Get("Content-Type") != "" {
			t.Error("Origin/Content-Type gönderilmemeli")
		}
		_, _ = w.Write([]byte(`{"tenant":{"name":"Demo","logoUrl":null},"consentText":{"id":"01JC0000000000000000000000","version":3,"body":"m","sha256":"ab"},"waitMinutes":30,"abuseEmail":null,"minAgentVersion":"0.9.0"}`))
	}))
	defer srv.Close()
	info, err := trusted(t, srv).TenantInfo(context.Background(), "abcdefghijk23456")
	if err != nil || info.Tenant.Name != "Demo" || info.MinAgentVersion == nil || *info.MinAgentVersion != "0.9.0" || info.Tenant.LogoURL != nil {
		t.Fatalf("%+v %v", info, err)
	}
}

func TestS8b8CreateNotRetriedAndRetryAfterParsed(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["deviceKey"]; ok {
			t.Error("boş deviceKey gönderilmemeli")
		}
		if _, ok := body["email"]; ok {
			t.Error("boş email gönderilmemeli")
		}
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"code":"NOT_READY","message":"Sunucu şu an yoğun.","requestId":"r1"}}`))
	}))
	defer srv.Close()
	_, err := trusted(t, srv).CreateRequest(context.Background(), CreateRequestBody{Ref: "abcdefghijk23456", ConsentAccepted: true})
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != "NOT_READY" || ae.RetryAfter.Seconds() != 5 || calls.Load() != 1 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestAC141CancelRequest204(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/api/v1/public/requests/cancel" || body["requestSecret"] != "s" || len(body) != 1 {
			t.Errorf("%s %v", r.URL.Path, body)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	if err := trusted(t, srv).CancelRequest(context.Background(), "s"); err != nil {
		t.Fatal(err)
	}
}
