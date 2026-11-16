package fsrv

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

const (
	testFID   = "01JD5ZQ8X3M4N5P6Q7R8S9T0VW"
	testToken = "Abc_defGhijKlmnOpqrStuvWxyz0123456789-_ABCD"
)

func newTestClient(t *testing.T, h http.Handler) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return New(u, srv.Client(), "0.14.0")
}

func randBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAC356P28bInvalidInputsNotSent(t *testing.T) {
	var calls int
	c := newTestClient(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
	ctx := context.Background()
	if _, err := c.Download(ctx, testFID+"/../x", testToken, 10, io.Discard); !errors.Is(err, ErrInvalid) {
		t.Error(err)
	}
	if _, err := c.Download(ctx, testFID, "kisa", 10, io.Discard); !errors.Is(err, ErrInvalid) {
		t.Error(err)
	}
	if calls != 0 {
		t.Errorf("geçersiz girdiyle %d istek gitti", calls)
	}
}

func TestAC356P28bDownloadBearerOnlyAndLimit(t *testing.T) {
	data := randBytes(t, 5000)
	var auth, rawURL string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, rawURL = r.Header.Get("Authorization"), r.URL.String()
		if r.Header.Get("Cookie") != "" || r.Method != http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	}))
	var out bytes.Buffer
	n, err := c.Download(context.Background(), testFID, testToken, int64(len(data)), &out)
	if err != nil || n != int64(len(data)) || !bytes.Equal(out.Bytes(), data) {
		t.Fatalf("indirme: %d %v", n, err)
	}
	if auth != "Bearer "+testToken || rawURL != "/api/v1/fsrv/files/"+testFID+"/content" {
		t.Fatalf("başlık/yol: %q %q", auth, rawURL)
	}
	out.Reset()
	if _, err := c.Download(context.Background(), testFID, testToken, int64(len(data)-1), &out); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("sınır aşımı: %v", err)
	}
	if int64(out.Len()) > int64(len(data)-1) {
		t.Error("sınırı aşan bayt yazıldı")
	}
}

func TestAC356P28bDownloadChunkedOverLimit(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.(http.Flusher).Flush() // Content-Length yok (chunked)
		_, _ = w.Write(make([]byte, 100))
	}))
	var out bytes.Buffer
	if _, err := c.Download(context.Background(), testFID, testToken, 50, &out); !errors.Is(err, ErrTooLarge) || out.Len() > 50 {
		t.Fatalf("chunked sınır: %v %d", err, out.Len())
	}
}

func TestAC356P28bDownloadNotFound(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"NOT_FOUND","message":"x","requestId":"r"}}`))
	}))
	_, err := c.Download(context.Background(), testFID, testToken, 10, io.Discard)
	var he *HTTPError
	if !errors.As(err, &he) || he.Status != 404 || he.Code != "NOT_FOUND" {
		t.Fatalf("%v", err)
	}
}

func TestAC356P28bNoRedirectFollow(t *testing.T) {
	var hops int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hops++
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	// api.Client'ın kuralı (yönlendirme izlenmez) New ile taşınır; toplam süre sınırı taşınmaz.
	hc := &http.Client{Transport: http.DefaultTransport, Timeout: time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	c := New(u, hc, "0.14.0")
	if c.http.Timeout != 0 {
		t.Error("istemci süre sınırı taşındı")
	}
	if _, err := c.Download(context.Background(), testFID, testToken, 10, io.Discard); err == nil || hops != 1 {
		t.Fatalf("yönlendirme izlendi: %v %d", err, hops)
	}
}
