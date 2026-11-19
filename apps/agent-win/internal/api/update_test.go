package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/update"
)

func TestAC473CheckUpdateOfferAndQuery(t *testing.T) {
	var gotQuery string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/public/agent/update" || r.Method != http.MethodGet || r.Header.Get("Origin") != "" {
			t.Errorf("beklenmeyen istek %s %s", r.Method, r.URL.Path)
		}
		gotQuery = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"manifest":"e30=","signature":"sig","policy":"notify"}`))
	}))
	defer srv.Close()
	c := trusted(t, srv)
	o, err := c.CheckUpdate(context.Background(), "windows", "amd64", "abcdefghijklmnop")
	if err != nil || o == nil || o.Manifest != "e30=" || o.Signature != "sig" || o.Policy != "notify" {
		t.Fatalf("%+v %v", o, err)
	}
	if gotQuery != "arch=amd64&component=client&platform=windows&ref=abcdefghijklmnop" {
		t.Fatalf("sorgu %q", gotQuery)
	}
	// Desen dışı ref gönderilmez.
	if _, err := c.CheckUpdate(context.Background(), "linux", "amd64", "ABC/../x"); err != nil || strings.Contains(gotQuery, "ref=") {
		t.Fatalf("desen dışı ref gitti: %q %v", gotQuery, err)
	}
}

// AC-493 / AC-478: 204 (yayın yok) ve 404 (eski sunucu) sessiz; 429 hata (sonraki dönem).
func TestAC493CheckUpdateSilentOnNoContentAndOldServer(t *testing.T) {
	for _, code := range []int{http.StatusNoContent, http.StatusNotFound} {
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) }))
		o, err := trusted(t, srv).CheckUpdate(context.Background(), "windows", "amd64", "")
		srv.Close()
		if o != nil || err != nil {
			t.Fatalf("%d: %+v %v", code, o, err)
		}
	}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"x","requestId":"r"}}`))
	}))
	defer srv.Close()
	_, err := trusted(t, srv).CheckUpdate(context.Background(), "windows", "amd64", "abcdefghijklmnop")
	var ae *Error
	if !errors.As(err, &ae) || ae.Code != "RATE_LIMITED" || ae.RetryAfter != time.Minute {
		t.Fatalf("%v", err)
	}
	if strings.Contains(err.Error(), "abcdefghijklmnop") {
		t.Fatal("ref hata metnine girdi")
	}
}

// AC-487/488: olaylar gövdede, anahtarlar yalnız gövdede (≤ 5), en çok 20 olay; 204.
func TestAC488SendUpdateEventsBody(t *testing.T) {
	var body struct {
		Platform    string         `json:"platform"`
		Arch        string         `json:"arch"`
		Component   string         `json:"component"`
		BindingKeys []string       `json:"bindingKeys"`
		Events      []update.Event `json:"events"`
	}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/public/agent/update-events" || r.URL.RawQuery != "" || r.Method != http.MethodPost {
			t.Errorf("beklenmeyen istek %s %s", r.Method, r.URL)
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	keys := []string{fixtureKey, fixtureKey, fixtureKey, fixtureKey, fixtureKey, fixtureKey}
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	var evs []update.Event
	for i := 0; i < 25; i++ {
		evs = append(evs, update.NewEvent(update.EventFailed, "0.22.1", "0.22.0", update.ReasonDownload, now))
	}
	if err := trusted(t, srv).SendUpdateEvents(context.Background(), "windows", "amd64", keys, evs); err != nil {
		t.Fatal(err)
	}
	if body.Component != "client" || len(body.BindingKeys) != 5 || len(body.Events) != 20 ||
		body.Events[0].At != "2026-11-19T12:00:00Z" || body.Events[0].Reason != update.ReasonDownload {
		t.Fatalf("%+v", body)
	}
	// Anahtarsız gövdede alan yok; olay yoksa istek yok.
	if err := trusted(t, srv).SendUpdateEvents(context.Background(), "linux", "amd64", nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestAC485BindingAutoUpdateField(t *testing.T) {
	var info BindingInfo
	if err := json.Unmarshal([]byte(`{"tenant":{"name":"N"},"autoUpdate":false}`), &info); err != nil {
		t.Fatal(err)
	}
	if update.PolicyFromBinding(info.AutoUpdate) != update.PolicyNotify {
		t.Fatal("autoUpdate=false notify olmalı")
	}
	var old BindingInfo
	_ = json.Unmarshal([]byte(`{"tenant":{"name":"N"}}`), &old)
	if old.AutoUpdate != nil || update.PolicyFromBinding(old.AutoUpdate) != update.PolicyAuto {
		t.Fatal("eski sunucu (alan yok) auto olmalı")
	}
}
