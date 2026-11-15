package servis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/servis/helperio"
)

// Kayıt istemcisi (`POST /api/v1/unattended/register`, mimari-p27 §4.2): çerezsiz, Origin'siz, TLS doğrulamalı
// (api.Client'ın HTTP istemcisi). Kod tek kullanımlık olduğundan istek **yeniden denenmez** (yanıtı kaybolan bir
// deneme kodu tüketmiş olabilir); 15 sn zaman aşımı. Hatalar api.Error olarak sınıflandırılır.
const (
	registerPath    = "/api/v1/unattended/register"
	registerTimeout = 15 * time.Second
	maxRegisterResp = 16 * 1024
)

// Sunucu hata kodları (contracts errors.ts).
const (
	CodeRegistrationInvalid = "REGISTRATION_CODE_INVALID"
	CodeUnattendedDisabled  = "UNATTENDED_DISABLED"
)

// RegisterRequest kayıt gövdesi.
type RegisterRequest struct {
	Code      string `json:"code"`
	PublicKey string `json:"publicKey"`
	Name      string `json:"name"`
	OSVersion string `json:"osVersion"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Signed    bool   `json:"signed"`
}

// RegisterResult kayıt yanıtı.
type RegisterResult struct {
	DeviceID     string `json:"deviceId"`
	TenantName   string `json:"tenantName"`
	CustomerName string `json:"customerName"`
}

var codeRe = regexp.MustCompile(`^[0-9A-Z]{8,32}$`)

// ErrCodeFormat kullanıcının girdiği kod biçimsel olarak geçersiz (sunucuya gönderilmez).
var ErrCodeFormat = errors.New("servis: kayıt kodu biçimi geçersiz")

// NormalizeCode tire ve boşlukları atar, büyük harfe çevirir (sunucuyla aynı kural).
func NormalizeCode(s string) (string, error) {
	s = strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	s = strings.ToUpper(s)
	if !codeRe.MatchString(s) {
		return "", ErrCodeFormat
	}
	return s, nil
}

// Register kayıt isteği. httpc api.New(...).HTTPClient() olmalıdır.
func Register(ctx context.Context, httpc *http.Client, server *url.URL, version string, req RegisterRequest) (*RegisterResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, registerTimeout)
	defer cancel()
	u := server.ResolveReference(&url.URL{Path: registerPath})
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("Accept", "application/json")
	hreq.Header.Set("User-Agent", "NoktaDestekServis/"+version)
	resp, err := httpc.Do(hreq)
	if err != nil {
		return nil, &api.Error{Err: err}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxRegisterResp))
	if err != nil {
		return nil, &api.Error{Err: err}
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, registerError(resp, data)
	}
	var out RegisterResult
	if err := json.Unmarshal(data, &out); err != nil || !ulidRe.MatchString(out.DeviceID) ||
		!helperio.Text(out.TenantName, 120) || !helperio.Text(out.CustomerName, 120) {
		return nil, &api.Error{Status: resp.StatusCode, Code: "BAD_RESPONSE", Err: errSchema}
	}
	return &out, nil
}

func registerError(resp *http.Response, data []byte) *api.Error {
	var env struct {
		Error struct {
			Code      string `json:"code"`
			RequestID string `json:"requestId"`
		} `json:"error"`
	}
	ae := &api.Error{Status: resp.StatusCode, Code: "UNKNOWN", RetryAfter: api.ParseRetryAfter(resp.Header.Get("Retry-After"))}
	if json.Unmarshal(data, &env) == nil && env.Error.Code != "" {
		ae.Code, ae.RequestID = env.Error.Code, env.Error.RequestID
	}
	return ae
}

// RegisterMessage kullanıcıya gösterilecek Türkçe metin (teknik ayrıntı yok; referans kimliği varsa eklenir).
func RegisterMessage(err error) string {
	var ae *api.Error
	if !errors.As(err, &ae) {
		return "Kayıt yapılamadı."
	}
	var msg string
	switch {
	case ae.Status == 0:
		msg = "Sunucuya bağlanılamadı. İnternet bağlantısını kontrol edip yeniden deneyin."
	case ae.Code == CodeRegistrationInvalid:
		msg = "Kayıt kodu geçersiz, kullanılmış ya da süresi dolmuş. Destek firmanızdan yeni kod isteyin."
	case ae.Code == CodeUnattendedDisabled:
		msg = "Gözetimsiz erişim bu sunucuda kapalı (kod imzası olmadan kullanılamaz)."
	case ae.Status == http.StatusTooManyRequests:
		msg = "Çok fazla deneme yapıldı. Bir süre sonra yeniden deneyin."
	default:
		msg = "Kayıt yapılamadı. Destek firmanıza başvurun."
	}
	if ae.RequestID != "" {
		msg += " (Referans: " + clean(ae.RequestID, 40) + ")"
	}
	return msg
}
