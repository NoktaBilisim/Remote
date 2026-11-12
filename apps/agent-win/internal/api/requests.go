package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"
)

// Destek talebi public uçları (mimari-api "Destek talepleri (P8b)"). Origin/Sec-Fetch gönderilmez (ADR-0012 AGENT).
const requestsPath = "/api/v1/public/requests"

// TenantRequestInfo GET /public/requests/tenant?ref= yanıtı (contracts `TenantRequestInfo`).
type TenantRequestInfo struct {
	Tenant struct {
		Name    string  `json:"name"`
		LogoURL *string `json:"logoUrl"`
	} `json:"tenant"`
	ConsentText     ConsentText `json:"consentText"`
	WaitMinutes     int         `json:"waitMinutes"`
	AbuseEmail      *string     `json:"abuseEmail"`
	MinAgentVersion *string     `json:"minAgentVersion"`
}

// CreateRequestBody POST /public/requests gövdesi (contracts `createRequestInputSchema`). `ref` ya da `bindingKey`
// (P8c): tam biri dolu. `email` ve `deviceKey` boşsa gönderilmez (deviceKey yalnız "hatırla" açıkken, ADR-0004 r3
// eki; kayıtla açılan talepte hiç gönderilmez, G-E10-5).
type CreateRequestBody struct {
	Ref              string `json:"ref,omitempty"`
	BindingKey       string `json:"bindingKey,omitempty"`
	ClientInstanceID string `json:"clientInstanceId"`
	ClientVersion    string `json:"clientVersion"`
	CustomerName     string `json:"customerName"`
	Phone            string `json:"phone"`
	Email            string `json:"email,omitempty"`
	Description      string `json:"description"`
	ConsentTextID    string `json:"consentTextId"`
	ConsentAccepted  bool   `json:"consentAccepted"`
	DeviceKey        string `json:"deviceKey,omitempty"`
}

// CreateRequestResult 201 yanıtı. RequestSecret yalnız bellekte tutulur; diske/loga yazılmaz (mimari-e9 §5.1).
type CreateRequestResult struct {
	RequestID     string    `json:"requestId"`
	RequestSecret string    `json:"requestSecret"`
	RequestCode   string    `json:"requestCode"`
	ExpiresAt     time.Time `json:"expiresAt"`
	Position      int       `json:"position"`
}

// TenantInfo firma bilgisini alır (AC-133). GET yan etkisizdir: ağ hatası / 502-504'te Resolve gibi en çok 3 deneme.
func (c *Client) TenantInfo(ctx context.Context, ref string) (*TenantRequestInfo, error) {
	q := url.Values{"ref": {ref}}
	var out TenantRequestInfo
	var err error
	for attempt := 1; attempt <= resolveAttempts; attempt++ {
		err = c.do(ctx, http.MethodGet, &url.URL{Path: requestsPath + "/tenant", RawQuery: q.Encode()}, nil, &out)
		var ae *Error
		if err == nil || !errors.As(err, &ae) || !ae.Retryable() || attempt == resolveAttempts {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(retryBackoff * time.Duration(attempt)):
		}
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateRequest talebi oluşturur. Burada yeniden DENENMEZ: her deneme sunucunun IP/önek kovalarını tüketir; 503
// yeniden deneme politikası (S8b-8) internal/request'tedir.
func (c *Client) CreateRequest(ctx context.Context, body CreateRequestBody) (*CreateRequestResult, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	var out CreateRequestResult
	if err := c.do(ctx, http.MethodPost, &url.URL{Path: requestsPath}, b, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CancelRequest WS kopukken en iyi çaba iptali (AC-141; ACCEPTED iken decline yolu, §13.3). Yanıt her durumda 204.
func (c *Client) CancelRequest(ctx context.Context, secret string) error {
	b, err := json.Marshal(struct {
		RequestSecret string `json:"requestSecret"`
	}{secret})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, &url.URL{Path: requestsPath + "/cancel"}, b, nil)
}
