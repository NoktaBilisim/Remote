package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Firma logosu sınırları (AC-98, QA-P6-1; ortak standart 1.5: PNG/JPG, ≤ 2 MB; sunucu logoyu ≤ 512 px'e küçültür).
const (
	LogoMaxBytes = 2 << 20
	// LogoMaxSide çözülmeden önce başlıktan okunan en/boy üst sınırı (sıkıştırma bombasına karşı).
	LogoMaxSide = 2048
)

// ErrLogo logo kabul edilmedi (başka köken, tür, boyut, çözme); çağıran sistem logosunu gösterir.
var ErrLogo = errors.New("api: logo kabul edilmedi")

var (
	pngMagic  = []byte("\x89PNG\r\n\x1a\n")
	jpegMagic = []byte{0xFF, 0xD8, 0xFF}
)

// LogoURL resolve yanıtındaki `tenant.logoUrl`'i gömülü sunucu adresine göre çözer. Kabul: kök-göreli yol (`/…`,
// `//` değil) veya şema + host + port'u gömülü adresle birebir aynı mutlak URL; kullanıcı bilgisi ve fragment yok.
// Başka her köken reddedilir — istemci yalnız kendi sunucusuna bağlanır (AC-109).
func (c *Client) LogoURL(raw string) (*url.URL, error) {
	if raw == "" || len(raw) > 2048 || strings.ContainsAny(raw, "\\\x00\r\n\t ") {
		return nil, ErrLogo
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return nil, ErrLogo
	}
	switch {
	case u.Scheme == "" && u.Host == "":
		if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
			return nil, ErrLogo
		}
	case u.Scheme == c.base.Scheme && strings.EqualFold(u.Host, c.base.Host):
	default:
		return nil, ErrLogo
	}
	r := c.base.ResolveReference(u)
	if r.Scheme != c.base.Scheme || !strings.EqualFold(r.Host, c.base.Host) {
		return nil, ErrLogo
	}
	return r, nil
}

// Logo firma logosunu aynı TLS doğrulamalı istemciyle (yönlendirme izlenmez) indirir ve çözer. Yalnız 200,
// `image/png` veya `image/jpeg` başlığı + aynı türün sihirli baytları, ≤ LogoMaxBytes ve ≤ LogoMaxSide kabul edilir.
// Hata ayrıntısı kullanıcıya gösterilmez; her hatada sistem logosu kullanılır.
func (c *Client) Logo(ctx context.Context, raw string) (image.Image, error) {
	u, err := c.LogoURL(raw)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrLogo
	}
	req.Header.Set("Accept", "image/png, image/jpeg")
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrLogo, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.ContentLength > LogoMaxBytes {
		return nil, ErrLogo
	}
	ct, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || (ct != "image/png" && ct != "image/jpeg") {
		return nil, ErrLogo
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, LogoMaxBytes+1))
	if err != nil || len(data) > LogoMaxBytes {
		return nil, ErrLogo
	}
	return DecodeLogo(data, ct)
}

// DecodeLogo içerik türünü sihirli baytlardan doğrular (uzantı/başlık tek başına yetmez), önce yalnız başlığı
// okuyup en/boy sınırını uygular, sonra yalnız o türün çözücüsüyle çözer (image.Decode kayıtlı başka biçimleri denemez).
func DecodeLogo(data []byte, contentType string) (image.Image, error) {
	var cfg func(io.Reader) (image.Config, error)
	var dec func(io.Reader) (image.Image, error)
	switch {
	case contentType == "image/png" && bytes.HasPrefix(data, pngMagic):
		cfg, dec = png.DecodeConfig, png.Decode
	case contentType == "image/jpeg" && bytes.HasPrefix(data, jpegMagic):
		cfg, dec = jpeg.DecodeConfig, jpeg.Decode
	default:
		return nil, ErrLogo
	}
	if len(data) > LogoMaxBytes {
		return nil, ErrLogo
	}
	c, err := cfg(bytes.NewReader(data))
	if err != nil || c.Width <= 0 || c.Height <= 0 || c.Width > LogoMaxSide || c.Height > LogoMaxSide {
		return nil, ErrLogo
	}
	img, err := dec(bytes.NewReader(data))
	if err != nil {
		return nil, ErrLogo
	}
	return img, nil
}

// abuseEmailMax mimari-api `ABUSE_EMAIL` üst sınırı ile aynı (S6-7).
const abuseEmailMax = 190

var abuseEmailRe = regexp.MustCompile(`^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,63}$`)

// ValidAbuseEmail sunucudan gelen `abuseEmail`'in `mailto:` ile kabuğa verilmeden önce doğrulanması (S6-7):
// basit e-posta biçimi, ≤ 190 karakter; `?`, `&`, boşluk ve denetim karakterleri biçim gereği reddedilir.
func ValidAbuseEmail(s string) bool {
	return len(s) <= abuseEmailMax && abuseEmailRe.MatchString(s)
}
