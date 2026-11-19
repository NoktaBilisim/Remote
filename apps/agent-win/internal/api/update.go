package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"

	"remote-support/agent-win/internal/update"
)

// P29 public güncelleme uçları (mimari-p29 §4.2, §4.5; contracts `api/update.ts`). Kimliksizdir; `MIN_AGENT_VERSION` bu
// uçlara uygulanmaz (K-P29-19). Eski sunucuda uç yoktur → 404 sessiz (AC-493). `ref` ve kayıt anahtarı loga/hata metnine
// yazılmaz; anahtar yalnız gövdede gider.
const (
	updateCheckPath  = "/api/v1/public/agent/update"
	updateEventsPath = "/api/v1/public/agent/update-events"
	// maxUpdateBindingKeys istek başına en çok kayıt anahtarı (UPDATE_EVENTS_BINDING_KEYS_MAX).
	maxUpdateBindingKeys = 5
)

// UpdateOffer GET 200 gövdesi (contracts `updateOfferSchema`). Alanlar KODLU kalır; doğrulama update.VerifyEncoded'dadır
// (çözülemeyen alan MANIFEST_SIGNATURE olur, sessiz düşmez).
type UpdateOffer struct {
	Manifest  string `json:"manifest"`
	Signature string `json:"signature"`
	Policy    string `json:"policy"`
}

// CheckUpdate istemci manifestini sorar (component=client). 204 (yayın yok) ve 404 (eski sunucu) → nil, nil. ref yalnız
// müşteri dosyası deseni `[a-z2-7]{16}` ise gönderilir. Yeniden denenmez (bir sonraki dönem, AC-478).
func (c *Client) CheckUpdate(ctx context.Context, platform, arch, ref string) (*UpdateOffer, error) {
	q := url.Values{"platform": {platform}, "arch": {arch}, "component": {update.ComponentClient}}
	if validUpdateRef(ref) {
		q.Set("ref", ref)
	}
	u := c.base.ResolveReference(&url.URL{Path: updateCheckPath, RawQuery: q.Encode()})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, &Error{Err: err}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, &Error{Err: scrubURLError(err), TLS: isCertError(err), Proxy: isProxyError(err)}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return nil, &Error{Err: err}
	}
	switch {
	case resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound:
		return nil, nil
	case resp.StatusCode != http.StatusOK:
		return nil, errorEnvelope(resp, data)
	}
	var out UpdateOffer
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, &Error{Status: resp.StatusCode, Code: "BAD_RESPONSE", Err: err}
	}
	return &out, nil
}

// SendUpdateEvents taşınabilir istemci olaylarını bildirir (§4.5). Sunucu her durumda 204 döner (anahtar oracle'ı yok).
// En çok 5 anahtar ve update.QueueMax olay gönderilir; hata olursa çağıran kuyruğu korur (Queue.Ack yalnız nil'de).
func (c *Client) SendUpdateEvents(ctx context.Context, platform, arch string, bindingKeys []string, events []update.Event) error {
	if len(events) == 0 {
		return nil
	}
	if len(events) > update.QueueMax {
		events = events[:update.QueueMax]
	}
	if len(bindingKeys) > maxUpdateBindingKeys {
		bindingKeys = bindingKeys[:maxUpdateBindingKeys]
	}
	b, err := json.Marshal(struct {
		Platform    string         `json:"platform"`
		Arch        string         `json:"arch"`
		Component   string         `json:"component"`
		BindingKeys []string       `json:"bindingKeys,omitempty"`
		Events      []update.Event `json:"events"`
	}{platform, arch, update.ComponentClient, bindingKeys, events})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, &url.URL{Path: updateEventsPath}, b, nil)
}

// validUpdateRef müşteri dosyası ref'i (base32 küçük harf, 16 karakter).
func validUpdateRef(ref string) bool {
	if len(ref) != 16 {
		return false
	}
	for i := 0; i < len(ref); i++ {
		c := ref[i]
		if (c < 'a' || c > 'z') && (c < '2' || c > '7') {
			return false
		}
	}
	return true
}

// scrubURLError url.Error'dan URL'yi (sorgudaki ref) atar.
func scrubURLError(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}
