package servis

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"remote-support/agent-win/internal/api"
)

func TestAC273NormalizeCode(t *testing.T) {
	if c, err := NormalizeCode(" abcd-efgh 2345-6789 "); err != nil || c != "ABCDEFGH23456789" {
		t.Fatalf("%q %v", c, err)
	}
	for _, bad := range []string{"", "ab", "ABCD!EFGH", strings.Repeat("A", 40), "ABCDEFGHİJ"} {
		if _, err := NormalizeCode(bad); !errors.Is(err, ErrCodeFormat) {
			t.Errorf("%q kabul edildi", bad)
		}
	}
}

func TestAC273RegisterSuccessAndNoRetry(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req RegisterRequest
		if r.URL.Path != registerPath || r.Header.Get("Origin") != "" || r.Header.Get("Cookie") != "" ||
			json.NewDecoder(r.Body).Decode(&req) != nil || req.Code != "ABCDEFGH23456789" {
			http.Error(w, `{"error":{"code":"VALIDATION"}}`, http.StatusBadRequest)
			return
		}
		if req.PublicKey == "bad" {
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":"REGISTRATION_CODE_INVALID","requestId":"req-1"}}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"deviceId":"01JD0000000000000000000001","tenantName":"Nokta","customerName":"Örnek"}`))
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	req := RegisterRequest{Code: "ABCDEFGH23456789", PublicKey: "pk"}
	res, err := Register(context.Background(), srv.Client(), u, "0.13.0", req)
	if err != nil || res.DeviceID != "01JD0000000000000000000001" {
		t.Fatalf("%+v %v", res, err)
	}
	req.PublicKey = "bad"
	_, err = Register(context.Background(), srv.Client(), u, "0.13.0", req)
	var ae *api.Error
	if !errors.As(err, &ae) || ae.Code != CodeRegistrationInvalid || calls.Load() != 2 {
		t.Fatalf("err=%v çağrı=%d", err, calls.Load())
	}
	msg := RegisterMessage(err)
	if !strings.Contains(msg, "geçersiz") || !strings.Contains(msg, "req-1") {
		t.Fatalf("mesaj: %s", msg)
	}
}

func TestRegisterMessages(t *testing.T) {
	for _, c := range []struct {
		err  error
		want string
	}{
		{&api.Error{Err: errors.New("x")}, "Sunucuya bağlanılamadı"},
		{&api.Error{Status: 409, Code: CodeUnattendedDisabled}, "kapalı"},
		{&api.Error{Status: 429, Code: "RATE_LIMITED"}, "Çok fazla"},
		{&api.Error{Status: 500, Code: "INTERNAL"}, "Destek firmanıza"},
		{errors.New("x"), "Kayıt yapılamadı"},
	} {
		if got := RegisterMessage(c.err); !strings.Contains(got, c.want) {
			t.Errorf("%v → %s", c.err, got)
		}
	}
}

func TestRegisterBadResponse(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"deviceId":"x","tenantName":"","customerName":""}`))
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	if _, err := Register(context.Background(), srv.Client(), u, "0.13.0", RegisterRequest{}); err == nil {
		t.Fatal("geçersiz yanıt kabul edildi")
	}
}
