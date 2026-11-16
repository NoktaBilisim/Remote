// Package fsrv P28b sunucu üzerinden dosya aktarımının HTTPS istemcisidir (mimari-p28b §4, §8): ≤ 5 dk belirteçle akışlı
// indirme (müşteri→teknisyen yükleme istemcide yok — QA P28b m.7; P28f/g'de eklenecek). Kurallar:
//   - Yalnız gömülü sunucu kökü (`config.ServerURL`), internal/api ile aynı TLS/proxy taşıyıcısı; yönlendirme izlenmez.
//   - Belirteç YALNIZ `Authorization: Bearer` başlığında; URL'de, hata metninde, logda asla (Caddy yol loglar).
//   - İstemci düzeyinde toplam süre sınırı yok (gövde akışı uzun sürebilir); süre ctx ile (parça başına parçaZamanı,
//     indirmede çağıranın ctx'i) sınırlanır.
//   - Dosya adı ve içerik hiçbir hataya/loga yazılmaz (D-P28a-3 kalıbı).
package fsrv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

const (
	downloadPath = "/api/v1/fsrv/files/"
	// errBodyMax hata zarfı okuma sınırı.
	errBodyMax = 4096
)

// HTTPError sunucu yanıtı (zarf kodu varsa Code). Belirteç ve ad içermez.
type HTTPError struct {
	Status int
	Code   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("fsrv: HTTP %d %s", e.Status, e.Code) }

// Sınıflandırılmış hatalar.
var (
	// ErrInvalid fid/belirteç/boyut biçimi geçersiz (istek gönderilmedi).
	ErrInvalid = errors.New("fsrv: geçersiz istek")
	// ErrTooLarge indirilen gövde beyan edilen/izin verilen boyutu aştı.
	ErrTooLarge = errors.New("fsrv: boyut aşıldı")
)

// Client fsrv uçlarının istemcisi.
type Client struct {
	base      *url.URL
	http      *http.Client
	userAgent string
}

// New hc'nin (api.Client.HTTPClient) taşıyıcısı ve yönlendirme kuralıyla, toplam süre sınırı olmadan kurar.
func New(base *url.URL, hc *http.Client, version string) *Client {
	return &Client{
		base:      &url.URL{Scheme: base.Scheme, Host: base.Host},
		http:      &http.Client{Transport: hc.Transport, CheckRedirect: hc.CheckRedirect, Jar: nil},
		userAgent: "NoktaDestek/" + version,
	}
}

func (c *Client) request(ctx context.Context, method, path, token string, body io.Reader, n int64) (*http.Request, error) {
	u := *c.base
	u.Path = path
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, ErrInvalid
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", c.userAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
		req.ContentLength = n
	}
	return req, nil
}

// do isteği gönderir; ağ hatası belirteç içermeyen sarmalanmış hata olarak döner (url.Error yalnız URL taşır).
func (c *Client) do(req *http.Request) (*http.Response, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fsrv: ağ hatası: %w", err)
	}
	return resp, nil
}

// httpError gövdeden zarf kodunu okur (`{"error":{"code":…}}`); gövde kapatılır.
func httpError(resp *http.Response) *HTTPError {
	defer resp.Body.Close()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, errBodyMax)).Decode(&env)
	return &HTTPError{Status: resp.StatusCode, Code: env.Error.Code}
}
