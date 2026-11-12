package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const fixtureKey = "rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

// TestAC182BindingStatusBodyOnlyNoOrigin anahtar yalnız gövdede (URL'de asla, AC-184), Origin yok, yanıt
// TenantRequestInfo + customer.
func TestAC182BindingStatusBodyOnlyNoOrigin(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/public/bindings/status" || r.URL.RawQuery != "" || r.Method != http.MethodPost {
			t.Errorf("beklenmeyen istek %s %s", r.Method, r.URL)
		}
		if r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" {
			t.Error("Origin/Sec-Fetch gönderilmemeli")
		}
		raw, _ := io.ReadAll(r.Body)
		if string(raw) != `{"bindingKey":"`+fixtureKey+`","clientVersion":"1.0.0"}` { // fixtures/bindings.json statusInput
			t.Errorf("gövde %s", raw)
		}
		_, _ = w.Write([]byte(`{"tenant":{"name":"Nokta","logoUrl":null},"consentText":{"id":"c","version":4,"body":"m","sha256":"ab"},
			"waitMinutes":30,"abuseEmail":null,"minAgentVersion":"0.9.0","customer":{"name":"Örnek A.Ş."}}`))
	}))
	defer srv.Close()
	info, err := trusted(t, srv).BindingStatus(context.Background(), fixtureKey)
	if err != nil {
		t.Fatal(err)
	}
	if info.Tenant.Name != "Nokta" || info.Customer == nil || info.Customer.Name != "Örnek A.Ş." || info.ConsentText.Version != 4 {
		t.Fatalf("%+v", info)
	}
}

func TestAC185BindingStatusInvalidNotRetried(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"BINDING_INVALID","message":"Bu bilgisayarın destek kaydı artık geçerli değil.","requestId":"r"}}`))
	}))
	defer srv.Close()
	_, err := trusted(t, srv).BindingStatus(context.Background(), fixtureKey)
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != "BINDING_INVALID" || hits.Load() != 1 {
		t.Fatalf("%v hits=%d", err, hits.Load())
	}
	if strings.Contains(err.Error(), fixtureKey) {
		t.Fatal("anahtar hata metnine girmemeli")
	}
}

func TestBindingStatusGenelCustomerNull(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"tenant":{"name":"Nokta","logoUrl":null},"consentText":{"id":"c","version":1,"body":"m","sha256":"ab"},
			"waitMinutes":30,"abuseEmail":null,"minAgentVersion":null,"customer":null}`))
	}))
	defer srv.Close()
	info, err := trusted(t, srv).BindingStatus(context.Background(), fixtureKey)
	if err != nil || info.Customer != nil {
		t.Fatalf("%+v %v", info, err)
	}
}

func TestAC186RevokeBindingSingleShortAttempt(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/api/v1/public/bindings/revoke" || body["bindingKey"] != fixtureKey || len(body) != 1 {
			t.Errorf("%s %v", r.URL, body)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	if err := trusted(t, srv).RevokeBinding(context.Background(), fixtureKey); err == nil || hits.Load() != 1 {
		t.Fatalf("503 tek deneme olmalı: %v %d", err, hits.Load())
	}
	slow := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer slow.Close()
	start := time.Now()
	if err := trusted(t, slow).RevokeBinding(context.Background(), fixtureKey); err == nil {
		t.Fatal("zaman aşımı hata dönmeli")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("2 sn sınırı aşıldı: %v", d)
	}
}

func TestAC182CreateRequestRefXorBindingKey(t *testing.T) {
	b, _ := json.Marshal(CreateRequestBody{BindingKey: fixtureKey, ClientInstanceID: "i", ClientVersion: "0.10.0"})
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if _, ok := m["ref"]; ok || m["bindingKey"] != fixtureKey {
		t.Fatalf("kayıtla talepte ref olmamalı: %s", b)
	}
	if _, ok := m["deviceKey"]; ok {
		t.Fatal("boş deviceKey gönderilmemeli")
	}
	b, _ = json.Marshal(CreateRequestBody{Ref: "abcdefghijk23456"})
	m = map[string]any{}
	_ = json.Unmarshal(b, &m)
	if _, ok := m["bindingKey"]; ok || m["ref"] != "abcdefghijk23456" {
		t.Fatalf("ref'li talepte bindingKey olmamalı: %s", b)
	}
}
