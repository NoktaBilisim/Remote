package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

var payload = []byte("yeni-ikili-baytlari")

func payloadManifest() Manifest {
	m := baseManifest()
	sum := sha256.Sum256(payload)
	m.SHA256 = hex.EncodeToString(sum[:])
	m.Size = int64(len(payload))
	return m
}

func tlsServer(t *testing.T, h http.HandlerFunc) (*httptest.Server, *url.URL) {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return srv, u
}

func reasonOf(t *testing.T, err error) Reason {
	t.Helper()
	var de *DownloadError
	if !errors.As(err, &de) {
		t.Fatalf("DownloadError beklenirdi, alınan %v", err)
	}
	return de.Reason
}

func TestAC477DownloadSameOriginWritesVerifiedBytes(t *testing.T) {
	var gotAuth, gotPath, gotUA string
	srv, origin := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath, gotUA = r.Header.Get("Authorization"), r.URL.Path, r.Header.Get("User-Agent")
		_, _ = w.Write(payload)
	})
	var dst bytes.Buffer
	err := Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathServiceFile,
		Bearer: "belirtec", UserAgent: "NoktaDestek/0.22.0", Manifest: payloadManifest(), Dst: &dst})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(dst.Bytes(), payload) || gotAuth != "Bearer belirtec" || gotPath != PathServiceFile || gotUA != "NoktaDestek/0.22.0" {
		t.Fatalf("dst=%q auth=%q path=%q ua=%q", dst.Bytes(), gotAuth, gotPath, gotUA)
	}
	// Bearer boşsa başlık gönderilmez.
	dst.Reset()
	if err := Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathWindowsClient,
		Manifest: payloadManifest(), Dst: &dst}); err != nil || gotAuth != "" {
		t.Fatalf("bearersiz: %v auth=%q", err, gotAuth)
	}
}

func TestAC474DownloadHashAndSize(t *testing.T) {
	tampered := append([]byte{}, payload...)
	tampered[0] ^= 1
	cases := []struct {
		name   string
		body   []byte
		reason Reason
	}{
		{"SHA farkı", tampered, ReasonHashMismatch},
		{"eksik bayt", payload[:len(payload)-1], ReasonHashMismatch},
		{"fazla bayt", append(append([]byte{}, payload...), 'x'), ReasonDownload},
	}
	for _, c := range cases {
		srv, origin := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Length", strconv.Itoa(len(c.body)))
			_, _ = w.Write(c.body)
		})
		var dst bytes.Buffer
		err := Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathLinuxClient,
			Manifest: payloadManifest(), Dst: &dst})
		if got := reasonOf(t, err); got != c.reason {
			t.Errorf("%s: %s, beklenen %s", c.name, got, c.reason)
		}
	}
}

// r2 T-10: Content-Length'siz akışta gövde size+1 baytta kesilir; sunucu daha fazlasını gönderse de okunmaz.
func TestAC477DownloadStopsAtSizePlusOne(t *testing.T) {
	srv, origin := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
		chunk := bytes.Repeat([]byte("A"), 32*1024)
		fl := w.(http.Flusher)
		for i := 0; i < 1024 && r.Context().Err() == nil; i++ { // en çok 32 MiB
			if _, err := w.Write(chunk); err != nil {
				return
			}
			fl.Flush()
		}
	})
	var dst bytes.Buffer
	err := Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathMacOSClient,
		Manifest: payloadManifest(), Dst: &dst})
	if reasonOf(t, err) != ReasonDownload {
		t.Fatalf("%v", err)
	}
	if int64(dst.Len()) > payloadManifest().Size+1 {
		t.Fatalf("size+1'den fazla yazıldı: %d", dst.Len())
	}
}

func TestAC477DownloadRejectsRedirect(t *testing.T) {
	var followed atomic.Bool
	srv, origin := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/baska" {
			followed.Store(true)
			_, _ = w.Write(payload)
			return
		}
		http.Redirect(w, r, "/baska", http.StatusFound)
	})
	client := srv.Client()
	var dst bytes.Buffer
	err := Download(context.Background(), DownloadRequest{Client: client, Origin: origin, Path: PathWindowsClient,
		Manifest: payloadManifest(), Dst: &dst})
	if reasonOf(t, err) != ReasonDownload || followed.Load() || dst.Len() != 0 {
		t.Fatalf("yönlendirme izlendi: err=%v followed=%v", err, followed.Load())
	}
	if !errors.Is(err, errRedirect) {
		t.Fatalf("yönlendirme hatası sınıflanmadı: %v", err)
	}
	if client.CheckRedirect != nil {
		t.Fatal("çağıranın istemcisi değiştirildi")
	}
}

func TestAC477DownloadStatusAndRetryAfter(t *testing.T) {
	srv, origin := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "300")
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	err := Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathServiceFile,
		Bearer: "gizli-belirtec", Manifest: payloadManifest(), Dst: &bytes.Buffer{}})
	var de *DownloadError
	if !errors.As(err, &de) || de.Reason != ReasonDownload || de.Status != 503 || de.RetryAfter != 300*time.Second {
		t.Fatalf("%+v", err)
	}
	if bytes.Contains([]byte(err.Error()), []byte("gizli-belirtec")) {
		t.Fatal("belirteç hata metnine sızdı")
	}
	// Content-Length size'tan büyükse gövde okunmadan DOWNLOAD.
	srv2, origin2 := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "1000")
		_, _ = w.Write(make([]byte, 1000))
	})
	var dst bytes.Buffer
	if reasonOf(t, Download(context.Background(), DownloadRequest{Client: srv2.Client(), Origin: origin2, Path: PathLinuxClient,
		Manifest: payloadManifest(), Dst: &dst})) != ReasonDownload || dst.Len() != 0 {
		t.Fatal("büyük Content-Length kabul edildi")
	}
}

func TestAC477DownloadInputGuards(t *testing.T) {
	srv, origin := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) })
	httpOrigin := &url.URL{Scheme: "http", Host: origin.Host}
	pathOrigin := &url.URL{Scheme: "https", Host: origin.Host, Path: "/x"}
	badSHA := payloadManifest()
	badSHA.SHA256 = "zz"
	zero := payloadManifest()
	zero.Size = 0
	for name, req := range map[string]DownloadRequest{
		"http köken":        {Client: srv.Client(), Origin: httpOrigin, Path: PathLinuxClient, Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"yollu köken":       {Client: srv.Client(), Origin: pathOrigin, Path: PathLinuxClient, Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"köken yok":         {Client: srv.Client(), Path: PathLinuxClient, Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"sabit olmayan yol": {Client: srv.Client(), Origin: origin, Path: "/downloads/baska.exe", Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"sorgulu yol":       {Client: srv.Client(), Origin: origin, Path: PathServiceFile + "?t=x", Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"istemci yok":       {Origin: origin, Path: PathLinuxClient, Manifest: payloadManifest(), Dst: &bytes.Buffer{}},
		"hedef yok":         {Client: srv.Client(), Origin: origin, Path: PathLinuxClient, Manifest: payloadManifest()},
		"sha bozuk":         {Client: srv.Client(), Origin: origin, Path: PathLinuxClient, Manifest: badSHA, Dst: &bytes.Buffer{}},
		"size 0":            {Client: srv.Client(), Origin: origin, Path: PathLinuxClient, Manifest: zero, Dst: &bytes.Buffer{}},
	} {
		if reasonOf(t, Download(context.Background(), req)) != ReasonDownload {
			t.Errorf("%s: DOWNLOAD beklenirdi", name)
		}
	}
	if ClientPath(PlatformWindows) != PathWindowsClient || ClientPath(PlatformMacOS) != PathMacOSClient ||
		ClientPath(PlatformLinux) != PathLinuxClient || ClientPath("x") != "" {
		t.Fatal("ClientPath")
	}
}

// Yerel yazma hatası (disk dolu vb.) DOWNLOAD olarak sınıflanır.
type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("disk dolu") }

func TestAC477DownloadWriteError(t *testing.T) {
	srv, origin := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) })
	if reasonOf(t, Download(context.Background(), DownloadRequest{Client: srv.Client(), Origin: origin, Path: PathLinuxClient,
		Manifest: payloadManifest(), Dst: failWriter{}})) != ReasonDownload {
		t.Fatal("yazma hatası")
	}
}
