package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"
)

// Bilgisayar kaydı public uçları (mimari-api "Public (P8c)", ADR-0017). Anahtar YALNIZ gövdede gider (URL'de asla);
// Origin/Sec-Fetch gönderilmez (ADR-0012 AGENT). Anahtar hiçbir hata metnine/loga yazılmaz.
const (
	bindingsPath  = "/api/v1/public/bindings"
	revokeTimeout = 2 * time.Second
)

// BindingInfo POST /public/bindings/status yanıtı (contracts `BindingInfo`): firma bilgisi + müşteri firma adı
// (Genel kayıtta null).
type BindingInfo struct {
	TenantRequestInfo
	Customer *struct {
		Name string `json:"name"`
	} `json:"customer"`
	// AutoUpdate P29 (K-P29-7, AC-485): tenant'ın otomatik güncelleme politikası; eski sunucu göndermez (nil → auto).
	// Birden çok kayıtta update.MergePolicy (kapalı kazanır).
	AutoUpdate *bool `json:"autoUpdate,omitempty"`
}

// BindingStatus açılışta kaydın geçerliliği ve firma bilgisi (AC-182, AC-185). `last_used_at`'i değiştirmez (K21),
// yan etkisizdir: ağ hatası / 502-504'te en çok 3 deneme. 404 `BINDING_INVALID` tek tip yanıttır.
func (c *Client) BindingStatus(ctx context.Context, key string) (*BindingInfo, error) {
	b, err := json.Marshal(struct {
		BindingKey    string `json:"bindingKey"`
		ClientVersion string `json:"clientVersion"`
	}{key, c.version})
	if err != nil {
		return nil, err
	}
	var out BindingInfo
	err = withRetry(ctx, func() error {
		return c.do(ctx, http.MethodPost, &url.URL{Path: bindingsPath + "/status"}, b, &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// RevokeBinding "Bu bilgisayarı unut" (AC-186): en iyi çaba, 2 sn, tek deneme. Sunucu her durumda 204 döner.
func (c *Client) RevokeBinding(ctx context.Context, key string) error {
	b, err := json.Marshal(struct {
		BindingKey string `json:"bindingKey"`
	}{key})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, revokeTimeout)
	defer cancel()
	return c.do(ctx, http.MethodPost, &url.URL{Path: bindingsPath + "/revoke"}, b, nil)
}
