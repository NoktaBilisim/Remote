package api

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.NRGBA{R: 200, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestAC98LogoURLOnlySameOrigin(t *testing.T) {
	base, _ := url.Parse("https://destek.example.com:4450")
	c := newClient(base, "1.0.0", nil)
	ok := map[string]string{
		"/api/v1/public/files/logo/t1/a.png":        "https://destek.example.com:4450/api/v1/public/files/logo/t1/a.png",
		"https://destek.example.com:4450/l.png":     "https://destek.example.com:4450/l.png",
		"https://DESTEK.example.com:4450/l.png?v=2": "https://DESTEK.example.com:4450/l.png?v=2",
		"/a/../api/v1/public/files/logo/t1/a.png":   "https://destek.example.com:4450/api/v1/public/files/logo/t1/a.png",
	}
	for raw, want := range ok {
		u, err := c.LogoURL(raw)
		if err != nil || u.String() != want {
			t.Errorf("%q → %v %v (beklenen %s)", raw, u, err, want)
		}
	}
	for _, raw := range []string{
		"", "l.png", "//evil.example/l.png", "https://evil.example/l.png", "https://destek.example.com/l.png",
		"http://destek.example.com:4450/l.png", "https://u:p@destek.example.com:4450/l.png", "/l.png#x",
		"javascript:alert(1)", "data:image/png;base64,AAAA", "file:///C:/x.png", "/\\evil.example/l.png",
		"https://destek.example.com:4450.evil.example/l.png", "/l.png\r\nX: y", "/" + strings.Repeat("a", 2100),
	} {
		if u, err := c.LogoURL(raw); !errors.Is(err, ErrLogo) {
			t.Errorf("%q kabul edildi: %v", raw, u)
		}
	}
}

func TestAC98LogoDownloadedWithLimits(t *testing.T) {
	good := pngBytes(t, 64, 32)
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch r.URL.Path {
		case "/ok.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(good)
		case "/wrongtype.png":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write(good)
		case "/svg.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
		case "/big.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(append(append([]byte{}, good...), make([]byte, LogoMaxBytes)...))
		case "/huge.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes(t, LogoMaxSide+1, 1))
		case "/redirect.png":
			http.Redirect(w, r, "https://evil.example/l.png", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := trusted(t, srv)
	img, err := c.Logo(context.Background(), "/ok.png")
	if err != nil || img.Bounds().Dx() != 64 || img.Bounds().Dy() != 32 {
		t.Fatalf("logo: %v %v", img, err)
	}
	for _, p := range []string{"/wrongtype.png", "/svg.png", "/big.png", "/huge.png", "/redirect.png", "/yok.png"} {
		if img, err := c.Logo(context.Background(), p); !errors.Is(err, ErrLogo) || img != nil {
			t.Errorf("%s kabul edildi: %v", p, err)
		}
	}
	before := hits.Load()
	if _, err := c.Logo(context.Background(), "https://evil.example/l.png"); !errors.Is(err, ErrLogo) {
		t.Fatal("başka köken kabul edildi")
	}
	if hits.Load() != before {
		t.Fatal("reddedilen URL için istek atıldı")
	}
}

func TestAC98DecodeLogoChecksMagicBytes(t *testing.T) {
	var jb bytes.Buffer
	if err := jpeg.Encode(&jb, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeLogo(jb.Bytes(), "image/jpeg"); err != nil {
		t.Fatalf("jpeg: %v", err)
	}
	if _, err := DecodeLogo(jb.Bytes(), "image/png"); !errors.Is(err, ErrLogo) {
		t.Fatal("tür/içerik uyuşmazlığı kabul edildi")
	}
	if _, err := DecodeLogo(append(append([]byte{}, pngMagic...), 1, 2, 3), "image/png"); !errors.Is(err, ErrLogo) {
		t.Fatal("bozuk png kabul edildi")
	}
}

func TestS67AbuseEmailValidated(t *testing.T) {
	for _, s := range []string{"abuse@example.com", "kotuye.kullanim+destek@nokta-bilisim.com.tr"} {
		if !ValidAbuseEmail(s) {
			t.Errorf("%q reddedildi", s)
		}
	}
	for _, s := range []string{"", "abuse", "a@b", "a@example.com?subject=x", "a@example.com&cc=b@c.com",
		"a b@example.com", "a@example.com\r\n", "a@exa\x00mple.com", "a@@example.com", "<a@example.com>",
		strings.Repeat("a", 60) + "@" + strings.Repeat("b", 130) + ".com"} {
		if ValidAbuseEmail(s) {
			t.Errorf("%q kabul edildi", s)
		}
	}
}
