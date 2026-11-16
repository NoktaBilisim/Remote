package fsrv

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
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
	c := New(u, srv.Client(), "0.14.0")
	c.backoff = []time.Duration{0, 0, 0}
	return c
}

func randBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

// chunkServer §4 PUT sözleşmesi: sıralı parça, son parça hariç tam 1 MiB, n<next idempotent, n>next 409 {next}.
type chunkServer struct {
	mu        sync.Mutex
	size      int64
	got       bytes.Buffer
	next      int
	fail5xx   map[int]int // parça → kaç kez 503
	authSeen  []string
	pathsSeen []string
	quota     bool
}

func (s *chunkServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authSeen = append(s.authSeen, r.Header.Get("Authorization"))
	s.pathsSeen = append(s.pathsSeen, r.URL.String())
	if r.Method != http.MethodPut || r.Header.Get("Content-Type") != "application/octet-stream" ||
		r.Header.Get("Authorization") != "Bearer "+testToken {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	n, _ := strconv.Atoi(r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:])
	if s.fail5xx[n] > 0 {
		s.fail5xx[n]--
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if s.quota {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"code":"STORAGE_QUOTA","message":"x","requestId":"r"}}`))
		return
	}
	body, _ := io.ReadAll(r.Body)
	switch {
	case n < s.next:
		_ = json.NewEncoder(w).Encode(map[string]int{"next": s.next, "received": s.got.Len()})
		return
	case n > s.next:
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]int{"next": s.next})
		return
	}
	chunks := int((s.size + signal.FsrvChunkBytes - 1) / signal.FsrvChunkBytes)
	want := int64(signal.FsrvChunkBytes)
	if n == chunks-1 {
		want = s.size - int64(n)*signal.FsrvChunkBytes
	}
	if int64(len(body)) != want {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	s.got.Write(body)
	s.next++
	if s.next == chunks {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"state":"SCANNING"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]int{"next": s.next, "received": s.got.Len()})
}

func TestAC355P28bUploadSequentialChunksWithBearer(t *testing.T) {
	data := randBytes(t, 2*signal.FsrvChunkBytes+123)
	s := &chunkServer{size: int64(len(data)), fail5xx: map[int]int{1: 2}}
	c := newTestClient(t, s)
	var last int64
	if err := c.Upload(context.Background(), testFID, testToken, int64(len(data)), bytes.NewReader(data),
		func(n int64) { last = n }); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(s.got.Bytes(), data) || last != int64(len(data)) {
		t.Fatalf("yüklenen %d bayt, ilerleme %d", s.got.Len(), last)
	}
	for i, p := range s.pathsSeen {
		if strings.Contains(p, testToken) || strings.Contains(p, "?") {
			t.Errorf("belirteç/sorgu URL'de: %s", p)
		}
		if s.authSeen[i] != "Bearer "+testToken {
			t.Errorf("Authorization yok")
		}
	}
}

func TestAC355P28bUploadResumesFromServerNext(t *testing.T) {
	data := randBytes(t, 3*signal.FsrvChunkBytes)
	s := &chunkServer{size: int64(len(data))}
	// Sunucu ilk iki parçayı zaten almış (önceki bağlantı): istemci 0'dan başlar, n<next 200 {next:2} → 2'den devam.
	s.got.Write(data[:2*signal.FsrvChunkBytes])
	s.next = 2
	c := newTestClient(t, s)
	if err := c.Upload(context.Background(), testFID, testToken, int64(len(data)), bytes.NewReader(data), nil); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(s.got.Bytes(), data) {
		t.Fatal("içerik farklı")
	}
	if len(s.pathsSeen) != 2 {
		t.Errorf("istek sayısı %d (0 → next 2, 2 → 202)", len(s.pathsSeen))
	}
}

func TestAC355P28bUploadConflictRewindsToNext(t *testing.T) {
	data := randBytes(t, 2*signal.FsrvChunkBytes)
	s := &chunkServer{size: int64(len(data))}
	c := newTestClient(t, s)
	next, done, err := c.putOnce(context.Background(), testFID, testToken, 1, data[signal.FsrvChunkBytes:])
	if err != nil || done || next != 0 {
		t.Fatalf("409 {next:0} bekleniyordu: %d %v %v", next, done, err)
	}
}

func TestAC362P28bUploadQuotaIsTerminal(t *testing.T) {
	s := &chunkServer{size: 10, quota: true}
	c := newTestClient(t, s)
	err := c.Upload(context.Background(), testFID, testToken, 10, bytes.NewReader(make([]byte, 10)), nil)
	if !errors.Is(err, ErrQuota) || len(s.pathsSeen) != 1 {
		t.Fatalf("ErrQuota tek denemede bekleniyordu: %v (%d istek)", err, len(s.pathsSeen))
	}
}

func TestAC356P28bUploadNotFoundNotRetried(t *testing.T) {
	var calls int
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNotFound)
	}))
	err := c.Upload(context.Background(), testFID, testToken, 10, bytes.NewReader(make([]byte, 10)), nil)
	var he *HTTPError
	if !errors.As(err, &he) || he.Status != 404 || calls != 1 {
		t.Fatalf("404 tek deneme: %v, %d", err, calls)
	}
	if strings.Contains(err.Error(), testToken) {
		t.Error("belirteç hata metninde")
	}
}

func TestAC355P28bUploadRetriesAtMostThreeTimes(t *testing.T) {
	var calls int
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadGateway)
	}))
	if err := c.Upload(context.Background(), testFID, testToken, 10, bytes.NewReader(make([]byte, 10)), nil); err == nil {
		t.Fatal("hata bekleniyordu")
	}
	if calls != 4 { // ilk + 3 yeniden deneme (1/2/4 sn)
		t.Errorf("deneme sayısı %d", calls)
	}
}

func TestAC356P28bInvalidInputsNotSent(t *testing.T) {
	var calls int
	c := newTestClient(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
	ctx := context.Background()
	if err := c.Upload(ctx, "../x", testToken, 10, bytes.NewReader(nil), nil); !errors.Is(err, ErrInvalid) {
		t.Error(err)
	}
	if err := c.Upload(ctx, testFID, "kisa", 10, bytes.NewReader(nil), nil); !errors.Is(err, ErrInvalid) {
		t.Error(err)
	}
	if err := c.Upload(ctx, testFID, testToken, signal.FsrvMaxBytes+1, bytes.NewReader(nil), nil); !errors.Is(err, ErrInvalid) {
		t.Error(err)
	}
	if _, err := c.Download(ctx, testFID+"/../x", testToken, 10, io.Discard); !errors.Is(err, ErrInvalid) {
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

func TestAC355P28bDigestTwoPass(t *testing.T) {
	sha, n, err := Digest(strings.NewReader("abc"))
	if err != nil || n != 3 || sha != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("%s %d %v", sha, n, err)
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
