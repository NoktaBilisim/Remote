package update

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Sabit indirme yolları (K-P29-6): manifestte URL yoktur; istemci gömülü kökene bu yolları ekler.
const (
	PathWindowsClient = "/downloads/NoktaDestek.exe"
	PathMacOSClient   = "/downloads/NoktaDestek-macOS.zip"
	PathLinuxClient   = "/downloads/NoktaDestek-linux"
	// PathServiceFile servis ikilisi; tek kullanımlık belirteç yalnız `Authorization: Bearer` başlığında (r2 T-10).
	PathServiceFile = "/api/v1/public/agent/update/service-file"
)

// defaultDownloadTimeout bağlamda süre yoksa uygulanan üst sınır (15 MB'lik ikili yavaş hatta da sığsın).
const defaultDownloadTimeout = 30 * time.Minute

// ClientPath manifest platformunun taşınabilir istemci indirme yolu; bilinmeyen platform "".
func ClientPath(platform string) string {
	switch platform {
	case PlatformWindows:
		return PathWindowsClient
	case PlatformMacOS:
		return PathMacOSClient
	case PlatformLinux:
		return PathLinuxClient
	}
	return ""
}

// DownloadError indirme/bütünlük hatası; Reason DOWNLOAD veya HASH_MISMATCH.
type DownloadError struct {
	Reason Reason
	// Status HTTP durumu (ağ hatasında 0).
	Status int
	// RetryAfter 429/503 `Retry-After` (saniye); yoksa 0. Servis dosyası 503'te çağıran en az bu kadar bekler (§4.4).
	RetryAfter time.Duration
	Err        error
}

func (e *DownloadError) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("update: indirme %s (HTTP %d)", e.Reason, e.Status)
	}
	return fmt.Sprintf("update: indirme %s: %v", e.Reason, e.Err)
}

func (e *DownloadError) Unwrap() error { return e.Err }

var (
	errRedirect   = errors.New("yönlendirme reddedildi")
	errTooLarge   = errors.New("gövde manifest boyutunu aşıyor")
	errShort      = errors.New("gövde manifest boyutundan kısa")
	errDigest     = errors.New("SHA-256 manifestle uyuşmuyor")
	errOrigin     = errors.New("köken https://host[:port] olmalı")
	errPath       = errors.New("yol sabit indirme yollarından biri olmalı")
	errNilClient  = errors.New("http istemcisi yok")
	errNilWriter  = errors.New("hedef yok")
	errBadSHA     = errors.New("manifest sha256 geçersiz")
	errSizeLimits = errors.New("manifest size geçersiz")
)

// DownloadRequest bir indirme. Hedef (Dst) çağıranın açtığı dosya tutamacıdır (TOCTOU, §5.1): yalnız sahibin erişebildiği
// konumda O_EXCL/CREATE_NEW + Windows'ta paylaşımsız açılır; Download yazar ama kapatmaz. Hata halinde dosyayı silmek ve
// kurulum sayacını artırmamak çağıranın işidir (§5.1 adım 10).
type DownloadRequest struct {
	// Client mevcut api istemcisinin HTTP istemcisi (aynı TLS/vekil taşıyıcısı). Kopyası alınır: Timeout kaldırılır (bağlam
	// süreyi belirler), CheckRedirect her yönlendirmeyi hata yapar.
	Client *http.Client
	// Origin gömülü sunucu kökeni (config.ServerURL); yalnız https, yol/sorgu yok.
	Origin *url.URL
	// Path sabit yollardan biri (Path* sabitleri).
	Path string
	// Bearer servis dosyası belirteci (boşsa başlık gönderilmez). Hata metnine/loga yazılmaz.
	Bearer string
	// UserAgent isteğe bağlı (api istemcisiyle aynı "NoktaDestek/<sürüm>").
	UserAgent string
	// Manifest Verify'dan OutcomeAccept ile geçmiş manifest (sha256 + size).
	Manifest Manifest
	// Dst doğrulanan baytın yazıldığı tutamaç.
	Dst io.Writer
}

// Download aynı kökenden indirir; gövde size+1 baytta kesilir (r2 T-10). Fazla bayt → DOWNLOAD, eksik bayt ya da SHA farkı →
// HASH_MISMATCH (AC-474/477). SHA, Dst'e yazılan akış üzerinden hesaplanır: doğrulanan bayt = yazılan bayt.
func Download(ctx context.Context, req DownloadRequest) error {
	dl := func(err error) error { return &DownloadError{Reason: ReasonDownload, Err: err} }
	if req.Client == nil {
		return dl(errNilClient)
	}
	if req.Dst == nil {
		return dl(errNilWriter)
	}
	if !validOrigin(req.Origin) {
		return dl(errOrigin)
	}
	if !fixedPath(req.Path) {
		return dl(errPath)
	}
	want, err := hex.DecodeString(req.Manifest.SHA256)
	if err != nil || !isLowerHex(req.Manifest.SHA256, 64) {
		return dl(errBadSHA)
	}
	size := req.Manifest.Size
	if size < 1 || size > MaxBinarySize {
		return dl(errSizeLimits)
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultDownloadTimeout)
		defer cancel()
	}

	target := url.URL{Scheme: "https", Host: req.Origin.Host, Path: req.Path}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return dl(err)
	}
	if req.Bearer != "" {
		hreq.Header.Set("Authorization", "Bearer "+req.Bearer)
	}
	if req.UserAgent != "" {
		hreq.Header.Set("User-Agent", req.UserAgent)
	}
	hreq.Header.Set("Accept", "application/octet-stream")

	c := *req.Client
	c.Timeout = 0
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return errRedirect }
	resp, err := c.Do(hreq)
	if err != nil {
		return dl(scrub(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &DownloadError{Reason: ReasonDownload, Status: resp.StatusCode, RetryAfter: retryAfter(resp.Header.Get("Retry-After"))}
	}
	if resp.ContentLength > size {
		return dl(errTooLarge)
	}

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(req.Dst, h), io.LimitReader(resp.Body, size+1))
	if err != nil {
		return dl(scrub(err))
	}
	switch {
	case n > size:
		return dl(errTooLarge)
	case n < size:
		return &DownloadError{Reason: ReasonHashMismatch, Err: errShort}
	}
	if subtle.ConstantTimeCompare(h.Sum(nil), want) != 1 {
		return &DownloadError{Reason: ReasonHashMismatch, Err: errDigest}
	}
	return nil
}

func validOrigin(u *url.URL) bool {
	return u != nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && (u.Path == "" || u.Path == "/") &&
		u.RawQuery == "" && u.Fragment == "" && u.Opaque == ""
}

func fixedPath(p string) bool {
	switch p {
	case PathWindowsClient, PathMacOSClient, PathLinuxClient, PathServiceFile:
		return true
	}
	return false
}

// scrub url.Error'dan URL'yi atar (yol sabit ama ileride sorgu eklenirse belirteç loga sızmasın).
func scrub(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		if errors.Is(ue.Err, errRedirect) {
			return errRedirect
		}
		return ue.Err
	}
	return err
}

// retryAfter yalnız saniye biçimi (sunucu böyle gönderir); en çok 24 sa.
func retryAfter(v string) time.Duration {
	s, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || s <= 0 {
		return 0
	}
	if s > 86400 {
		s = 86400
	}
	return time.Duration(s) * time.Second
}
