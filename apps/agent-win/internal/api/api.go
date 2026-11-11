// Package api public müşteri uçlarının (resolve/join) istemcisidir (mimari-api "Public", ADR-0012).
// Kurallar: yalnız gömülü sunucu adresi (config), sistem kök sertifikalarıyla TLS doğrulaması, pinning yok (AC-109);
// `Origin` ve `Sec-Fetch-*` başlıkları GÖNDERİLMEZ — sunucu Origin'siz isteği yalnız `clientKind=AGENT` ile kabul eder.
// Yönlendirme izlenmez (başka adrese bağlanılmaz).
package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const (
	basePath        = "/api/v1/public/sessions/"
	requestTimeout  = 15 * time.Second
	maxResponseSize = 256 * 1024
	resolveAttempts = 3
	retryBackoff    = 500 * time.Millisecond
	clientKindAgent = "AGENT"
)

// Error sunucu hata zarfı (`packages/contracts/src/errors.ts` ErrorEnvelope) veya ağ/protokol hatası.
type Error struct {
	Status    int               // HTTP durum kodu; ağ hatasında 0
	Code      string            // ör. NOT_FOUND, SESSION_EXPIRED, NONCE_INVALID, LOBBY_FULL, RATE_LIMITED
	Message   string            // sunucunun Türkçe mesajı (kullanıcıya gösterilebilir)
	Fields    map[string]string // VALIDATION alan hataları
	RequestID string            // destek referansı
	Err       error             // ağ/TLS hatası (Status 0)
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("api: ağ hatası: %v", e.Err)
	}
	return fmt.Sprintf("api: %d %s (ref %s)", e.Status, e.Code, e.RequestID)
}

func (e *Error) Unwrap() error { return e.Err }

// Retryable yalnız ağ hatası ve 502/503/504 (sunucu kararı verilmemiş) için true.
func (e *Error) Retryable() bool {
	return e.Status == 0 || e.Status == http.StatusBadGateway || e.Status == http.StatusServiceUnavailable ||
		e.Status == http.StatusGatewayTimeout
}

// Client resolve/join istemcisi.
type Client struct {
	base      *url.URL
	userAgent string
	http      *http.Client
}

// New sistem kök sertifikalarıyla doğrulayan istemci kurar (AC-109).
func New(serverURL *url.URL, version string) *Client {
	return newClient(serverURL, version, &tls.Config{MinVersion: tls.VersionTLS12})
}

func newClient(serverURL *url.URL, version string, tlsCfg *tls.Config) *Client {
	tr := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		TLSClientConfig:     tlsCfg,
		TLSHandshakeTimeout: 10 * time.Second,
		ForceAttemptHTTP2:   true,
	}
	return &Client{
		base:      serverURL,
		userAgent: "NoktaDestek/" + version,
		http: &http.Client{
			Transport: tr,
			Timeout:   requestTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// HTTPClient WS dial için aynı TLS/proxy ayarlı istemciyi paylaşır.
func (c *Client) HTTPClient() *http.Client { return c.http }

// ConsentText KVKK onay metni (AC-98); sha256 = body UTF-8 hex.
type ConsentText struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Body    string `json:"body"`
	SHA256  string `json:"sha256"`
}

// ResolveResult karşılama ekranı verisi (mimari-api resolve yanıtı).
type ResolveResult struct {
	SessionRef string `json:"sessionRef"`
	Tenant     struct {
		Name    string `json:"name"`
		LogoURL string `json:"logoUrl"`
	} `json:"tenant"`
	Technician struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatarUrl,omitempty"`
	} `json:"technician"`
	TechVerifyCode string      `json:"techVerifyCode"`
	ConsentText    ConsentText `json:"consentText"`
	AbuseEmail     *string     `json:"abuseEmail"`
	ExpiresAt      time.Time   `json:"expiresAt"`
	JoinNonce      string      `json:"joinNonce"`
	NonceExpiresAt time.Time   `json:"nonceExpiresAt"`
}

// JoinRequest lobiye giriş (gövdede clientKind yok — kind nonce'a bağlı, ADR-0012).
type JoinRequest struct {
	JoinNonce       string `json:"joinNonce"`
	CustomerName    string `json:"customerName"`
	CustomerEmail   string `json:"customerEmail,omitempty"`
	ConsentTextID   string `json:"consentTextId"`
	ConsentAccepted bool   `json:"consentAccepted"`
}

// JoinResult WS ticket'ı ve müşterinin teknisyene söyleyeceği admitCode.
type JoinResult struct {
	WsTicket       string `json:"wsTicket"`
	AdmitCode      string `json:"admitCode"`
	TechnicianName string `json:"technicianName"`
}

// Resolve 8 haneli kodla oturumu çözer. Yalnız ağ hatası / 502-504'te yeniden dener (resolve tüketmez);
// 4xx sunucu kararıdır, tekrar denenmez (başarısız deneme hız kovasını doldurur).
func (c *Client) Resolve(ctx context.Context, code string) (*ResolveResult, error) {
	body := struct {
		Code       string `json:"code"`
		ClientKind string `json:"clientKind"`
	}{code, clientKindAgent}
	var out ResolveResult
	var err error
	for attempt := 1; attempt <= resolveAttempts; attempt++ {
		err = c.post(ctx, "resolve", body, &out)
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

// Join tek kullanımlık nonce'u tüketir; yeniden DENENMEZ (gönderilmiş istek nonce'u harcamış olabilir).
func (c *Client) Join(ctx context.Context, req JoinRequest) (*JoinResult, error) {
	var out JoinResult
	if err := c.post(ctx, "join", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) post(ctx context.Context, op string, in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	u := c.base.ResolveReference(&url.URL{Path: basePath + op})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return &Error{Err: err}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return &Error{Err: err}
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := json.Unmarshal(data, out); err != nil {
			return &Error{Status: resp.StatusCode, Code: "BAD_RESPONSE", Err: err}
		}
		return nil
	}
	var env struct {
		Error struct {
			Code      string            `json:"code"`
			Message   string            `json:"message"`
			Fields    map[string]string `json:"fields"`
			RequestID string            `json:"requestId"`
		} `json:"error"`
	}
	ae := &Error{Status: resp.StatusCode, Code: "UNKNOWN"}
	if json.Unmarshal(data, &env) == nil && env.Error.Code != "" {
		ae.Code, ae.Message, ae.Fields, ae.RequestID = env.Error.Code, env.Error.Message, env.Error.Fields, env.Error.RequestID
	}
	return ae
}
