package signal

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"

	"github.com/coder/websocket"
)

const (
	// Subprotocol ve önekler ws.ts ile aynı (G-10: kimlik bilgisi URL'de değil Sec-WebSocket-Protocol'de).
	Subprotocol     = "rs.v1"
	ticketPrefix    = "rs.ticket."
	reconnectPrefix = "rs.reconnect."
	guestPath       = "/ws/guest"
	maxPayload      = 64 * 1024
)

// Kapanış kodları (ws.ts WS_CLOSE).
const (
	CloseNormal      = websocket.StatusNormalClosure
	ClosePolicy      = websocket.StatusPolicyViolation
	CloseAuthRevoked = websocket.StatusCode(4401)
)

// Kimlik bilgisi subprotocol token'ı olduğundan RFC 6455 token karakterleriyle sınırlı (base64url).
var credRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

// Credential WS kimlik bilgisi: join'den wsTicket (ilk bağlanma) veya hello.reconnectToken (yeniden bağlanma).
type Credential struct {
	Ticket    string
	Reconnect string
}

func (c Credential) protocol() (string, error) {
	switch {
	case c.Ticket != "" && c.Reconnect == "" && credRe.MatchString(c.Ticket):
		return ticketPrefix + c.Ticket, nil
	case c.Reconnect != "" && c.Ticket == "" && credRe.MatchString(c.Reconnect):
		return reconnectPrefix + c.Reconnect, nil
	}
	return "", errors.New("signal: geçersiz kimlik bilgisi")
}

// ErrProtocol sunucu sözleşme dışı mesaj gönderdi; soket 1008 ile kapatıldı (yeniden bağlanılmaz).
var ErrProtocol = errors.New("signal: protokol ihlali")

// Fatal yeniden bağlanmanın anlamsız olduğu kopuşlar: protokol ihlali (1008) ve yetki iptali (4401).
func Fatal(err error) bool {
	s := websocket.CloseStatus(err)
	return errors.Is(err, ErrProtocol) || s == ClosePolicy || s == CloseAuthRevoked
}

// Conn doğrulanmış mesaj okuyan/yazan misafir soketi.
type Conn struct {
	ws *websocket.Conn
}

// Dial `wss://<host>/ws/guest`'e (sorgu dizesi YOK) bağlanır. httpClient api.Client'ın TLS doğrulamalı istemcisidir;
// Origin başlığı gönderilmez (sunucu Origin'siz bağlantıyı yalnız ticket.kind=AGENT ile kabul eder, ADR-0012).
// features P28a (mimari-p28 §4.2) bildirilen özellik belirteçleri (FeatureClip, FeaturePrint; P28b FeatureFsrv; P28e
// FeatureRec); kimlik değildir. Gözetimsiz
// yardımcı nil geçer (sunucu da gözetimsiz odada okumaz, O-P28a-4). Bilinmeyen/tekrarlı belirteç hata döner.
func Dial(ctx context.Context, httpClient *http.Client, server *url.URL, cred Credential, features []string) (*Conn, error) {
	proto, err := cred.protocol()
	if err != nil {
		return nil, err
	}
	protos, err := subprotocols(proto, features)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "wss", Host: server.Host, Path: guestPath}
	ws, resp, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{
		HTTPClient:   httpClient,
		Subprotocols: protos,
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, err
	}
	if ws.Subprotocol() != Subprotocol {
		_ = ws.Close(ClosePolicy, "")
		return nil, errors.New("signal: sunucu rs.v1 seçmedi")
	}
	ws.SetReadLimit(maxPayload)
	return &Conn{ws: ws}, nil
}

// knownFeatures Dial'ın kabul ettiği özellik belirteçleri.
var knownFeatures = []string{FeatureClip, FeaturePrint, FeatureFsrv, FeatureRec, FeatureMulti}

// subprotocols `rs.v1, <kimlik>, <özellikler…>` listesi; özellik yalnız bilinen ve tekrarsız belirteç olabilir.
func subprotocols(cred string, features []string) ([]string, error) {
	out := []string{Subprotocol, cred}
	for _, f := range features {
		if !slices.Contains(knownFeatures, f) || slices.Contains(out, f) {
			return nil, errors.New("signal: geçersiz özellik belirteci")
		}
		out = append(out, f)
	}
	return out, nil
}

// Read sıradaki sunucu mesajını doğrulayarak döner. Şema ihlalinde soketi 1008 ile kapatır.
func (c *Conn) Read(ctx context.Context) (Inbound, error) {
	typ, data, err := c.ws.Read(ctx)
	if err != nil {
		return nil, err
	}
	if typ != websocket.MessageText {
		_ = c.ws.Close(ClosePolicy, "")
		return nil, errors.Join(ErrProtocol, errors.New("signal: ikili mesaj beklenmiyordu"))
	}
	m, err := ParseServer(data)
	if err != nil {
		_ = c.ws.Close(ClosePolicy, "")
		return nil, errors.Join(ErrProtocol, err)
	}
	return m, nil
}

// Send mesajı doğrulayıp gönderir.
func (c *Conn) Send(ctx context.Context, m Outbound) error {
	b, err := Encode(m)
	if err != nil {
		return err
	}
	return c.ws.Write(ctx, websocket.MessageText, b)
}

// Close normal kapanış.
func (c *Conn) Close() error {
	return c.ws.Close(CloseNormal, "")
}
