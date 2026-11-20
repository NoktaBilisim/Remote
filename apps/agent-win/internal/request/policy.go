package request

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"remote-support/agent-win/internal/api"
)

// 503 NOT_READY yeniden deneme politikası (S8b-8). Sunucu IP/önek kovalarını (5/sa) kapıdan ÖNCE tüketir; her otomatik
// deneme meşru müşterinin saatlik kotasından yer. Bu yüzden:
//   - yalnız 503 + NOT_READY (karar verilmemiş, yazma geri alınmış) otomatik denenir; ağ hatası, 502/504 ve diğer her
//     yanıt DENENMEZ (talep oluşmuş olabilir → ikinci talep 409/kota),
//   - en çok 2 deneme (1 otomatik tekrar) — müşteri kotasının en çok 2/5'i,
//   - bekleme `Retry-After` (yoksa 5 sn), 1..15 sn'ye kırpılır + 0..1 sn rastgele (eşzamanlı istemciler aynı anda dönmesin).
const (
	createMaxAttempts = 2
	notReadyDefault   = 5 * time.Second
	notReadyMin       = time.Second
	notReadyMax       = 15 * time.Second
	retryJitter       = time.Second
)

// createRetryDelay attempt (1'den başlar) başarısız olduktan sonra yeniden denenecekse beklemeyi döner.
func createRetryDelay(err error, attempt int, jitter func(time.Duration) time.Duration) (time.Duration, bool) {
	var ae *api.Error
	if attempt >= createMaxAttempts || !errors.As(err, &ae) || ae.Status != 503 || ae.Code != "NOT_READY" {
		return 0, false
	}
	d := ae.RetryAfter
	if d <= 0 {
		d = notReadyDefault
	}
	d = min(max(d, notReadyMin), notReadyMax)
	return d + jitter(retryJitter), true
}

// parseVersion "x.y.z" → üç sayı.
func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 999 || len(p) == 0 || len(p) > 3 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// Outdated istemci sürümü sunucunun asgari sürümünden düşük mü (G-E9-4). Biçim dışı değer → false (sunucu yine 426
// ile korur; istemci yanlış alarm vermez).
func Outdated(version string, minVersion *string) bool {
	if minVersion == nil || *minVersion == "" {
		return false
	}
	a, ok1 := parseVersion(version)
	b, ok2 := parseVersion(*minVersion)
	if !ok1 || !ok2 {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

// DownloadOSMac P31 (AC-519): macOS istemcisinin indirme platformu (Deps.DownloadOS).
const DownloadOSMac = "macos"

// DownloadURL ADR-0004 r3 eki: açılabilecek TEK adres — gömülü sunucu kökü + sabit yol + doğrulanmış ref. P31 AC-519:
// os=="macos" → `&os=macos` eki (sunucu .zip'e yönlendirir); başka her değerde adres P31 öncesiyle bayt bayt aynıdır.
func DownloadURL(server *url.URL, ref, os string) (string, bool) {
	if !tenantRefRe.MatchString(ref) || server == nil || server.Scheme != "https" {
		return "", false
	}
	q := "ref=" + ref
	if os == DownloadOSMac {
		q += "&os=" + DownloadOSMac
	}
	u := url.URL{Scheme: "https", Host: server.Host, Path: "/api/v1/public/agent/request-download", RawQuery: q}
	return u.String(), true
}

// `/ws/request` yeniden bağlanma politikası (S8b2-2). Sunucunun upgrade kovası IP başına 31/dk; aynı NAT arkasındaki
// bekleyen istemciler sabit aralıkla denerse kova birlikte tükenir. Bu yüzden her başarısız denemeden sonra (429,
// 503 ve ağ hataları dahil; 403/426 zaten kesin):
//   - üstel geri çekilme: ReconnectEvery (2 sn) → 4 → 8 → 15 sn tavan,
//   - üzerine 0..1 sn crypto/rand jitter,
//   - upgrade yanıtında `Retry-After` varsa en az o kadar (≤ 60 sn kırpılır),
//   - bekleme kopma bütçesini (ReconnectWindow, sunucunun 120 sn'sinin altında) aşmaz: son deneme süre dolmadan yapılır.
const (
	dialBackoffMax    = 15 * time.Second
	dialRetryAfterMax = 60 * time.Second
)

// dialRetryDelay attempt (1'den başlar) başarısız olduktan sonra beklenecek süre; left kopma bütçesinden kalan süre.
func dialRetryDelay(err error, attempt int, every, left time.Duration, jitter func(time.Duration) time.Duration) time.Duration {
	d := every
	for i := 1; i < attempt && d < dialBackoffMax; i++ {
		d *= 2
	}
	d = min(d, dialBackoffMax) + jitter(retryJitter)
	var de *DialError
	if errors.As(err, &de) && de.RetryAfter > 0 {
		d = max(d, min(de.RetryAfter, dialRetryAfterMax))
	}
	return max(min(d, left), 0)
}
