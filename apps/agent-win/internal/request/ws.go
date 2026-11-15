package request

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"time"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/signal"
)

// `/ws/request` sözleşmesi (mimari-protokol §5.1; contracts `ws-request.ts`, fixture `ws-request.json`).
const (
	wsPath       = "/ws/request"
	secretPrefix = "rs.req."
	maxPayload   = 64 * 1024
	techNameMax  = 100
	closedMsgMax = 200
	errMsgMax    = 300
	// CloseReplaced aynı sırla yeni bağlantı geldi (4409): eski soket yeniden bağlanmaz.
	CloseReplaced = 4409
)

var (
	secretRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	codeRe   = regexp.MustCompile(`^[0-9]{6}$`)
	verifyRe = regexp.MustCompile(`^[0-9]{4}$`)

	closedStatuses = []string{"CANCELLED", "EXPIRED", "REJECTED", "CONNECT_FAILED"}
	cancelReasons  = []string{"CUSTOMER", "DISCONNECTED", "TENANT_PASSIVE", "CUSTOMER_PASSIVE", "BINDING_REVOKED"} // P8c: ≥ 0.10.0 gerçek neden alır (mimari-e10 §5.4)
	wsErrorCodes   = []string{"RATE_LIMITED", "VALIDATION", "INTERNAL"}
)

// Inbound sunucudan gelen doğrulanmış mesaj.
type Inbound interface{ isInbound() }

// State `request.state` (AC-139): yalnız bu talebin sırası ve zamanları.
type State struct {
	T           string `json:"t"`
	Status      string `json:"status"`
	RequestCode string `json:"requestCode"`
	Position    int    `json:"position"`
	CreatedAt   string `json:"createdAt"`
	ExpiresAt   string `json:"expiresAt"`
	ServerTime  string `json:"serverTime"`
}

// Accepted `request.accepted` (AC-154): ticket yalnız "Ekranımı paylaş"ta kullanılır.
type Accepted struct {
	T               string `json:"t"`
	WsTicket        string `json:"wsTicket"`
	TechnicianName  string `json:"technicianName"`
	TechVerifyCode  string `json:"techVerifyCode"`
	TicketExpiresAt string `json:"ticketExpiresAt"`
	// AdmitCode P15/P17 (AC-239): yalnız tenant "kabul kodu iste" açıkken ve istemci ≥ 0.11.0 ise; 4 hane. Müşteri
	// ekranında büyük gösterilir, teknisyen konsola girer. Yoksa eski akış.
	AdmitCode string `json:"admitCode,omitempty"`
}

// Closed `request.closed`: son durum; ardından sunucu 1000 ile kapatır.
type Closed struct {
	T       string  `json:"t"`
	Status  string  `json:"status"`
	Reason  *string `json:"reason,omitempty"`
	Message *string `json:"message,omitempty"`
}

// ErrorMsg `error`.
type ErrorMsg struct {
	T       string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (State) isInbound()    {}
func (Accepted) isInbound() {}
func (Closed) isInbound()   {}
func (ErrorMsg) isInbound() {}

// validAdmitCode AC-239: `admitCode` isteğe bağlı ama varsa (null/boş dahil) 4 hane olmalı (zod `.optional()`).
func validAdmitCode(raw []byte, code string) bool {
	if verifyRe.MatchString(code) {
		return true
	}
	var keys map[string]json.RawMessage
	if json.Unmarshal(raw, &keys) != nil {
		return false
	}
	_, has := keys["admitCode"]
	return !has
}

func bad(t, why string) error { return fmt.Errorf("request: %s: %s", t, why) }

// ParseServer requestOutboundSchema eşi: strictObject + alan kuralları.
func ParseServer(raw []byte) (Inbound, error) {
	var head struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, bad("?", "json")
	}
	switch head.T {
	case "request.state":
		var m State
		if err := signal.DecodeStrict(raw, &m); err != nil {
			return nil, bad(head.T, err.Error())
		}
		if m.Status != "PENDING" || !codeRe.MatchString(m.RequestCode) || m.Position < 1 ||
			!signal.IsISO(m.CreatedAt) || !signal.IsISO(m.ExpiresAt) || !signal.IsISO(m.ServerTime) {
			return nil, bad(head.T, "alan")
		}
		return m, nil
	case "request.accepted":
		var m Accepted
		if err := signal.DecodeStrict(raw, &m); err != nil {
			return nil, bad(head.T, err.Error())
		}
		if !secretRe.MatchString(m.WsTicket) || m.TechnicianName == "" || utf16Len(m.TechnicianName) > techNameMax ||
			!verifyRe.MatchString(m.TechVerifyCode) || !signal.IsISO(m.TicketExpiresAt) || !validAdmitCode(raw, m.AdmitCode) {
			return nil, bad(head.T, "alan")
		}
		m.TechnicianName = Display(m.TechnicianName, "Teknisyen") // S8b2-3: arayüze yalnız süzülmüş ad gider
		return m, nil
	case "request.closed":
		var m Closed
		if err := signal.DecodeStrict(raw, &m); err != nil {
			return nil, bad(head.T, err.Error())
		}
		if !slices.Contains(closedStatuses, m.Status) ||
			(m.Reason != nil && (m.Status != "CANCELLED" || !slices.Contains(cancelReasons, *m.Reason))) ||
			(m.Message != nil && (m.Status != "REJECTED" || utf16Len(*m.Message) > closedMsgMax)) {
			return nil, bad(head.T, "alan")
		}
		if m.Message != nil {
			msg := Display(*m.Message, "")
			m.Message = &msg
		}
		return m, nil
	case "error":
		var m ErrorMsg
		if err := signal.DecodeStrict(raw, &m); err != nil {
			return nil, bad(head.T, err.Error())
		}
		if !slices.Contains(wsErrorCodes, m.Code) || utf16Len(m.Message) > errMsgMax {
			return nil, bad(head.T, "alan")
		}
		m.Message = Display(m.Message, "")
		return m, nil
	}
	return nil, bad(head.T, "bilinmeyen tip")
}

// Outbound istemci → sunucu: yalnız `request.cancel` ve `request.decline` (requestInboundSchema).
type Outbound string

const (
	SendCancel  Outbound = "request.cancel"
	SendDecline Outbound = "request.decline"
)

// Encode gönderilecek çerçeve.
func Encode(m Outbound) ([]byte, error) {
	if m != SendCancel && m != SendDecline {
		return nil, errors.New("request: geçersiz giden mesaj")
	}
	return json.Marshal(struct {
		T string `json:"t"`
	}{string(m)})
}

// ErrProtocol sunucu sözleşme dışı mesaj gönderdi (soket 1008 ile kapatıldı).
var ErrProtocol = errors.New("request: protokol ihlali")

// DialError upgrade HTTP yanıtıyla reddedildi (403 talep geçersiz/kapalı, 426 eski sürüm, 429 hız).
type DialError struct {
	Status int
	// RetryAfter `Retry-After` (saniye; yoksa 0) — S8b2-2 yeniden bağlanma beklemesi buna uyar.
	RetryAfter time.Duration
	Err        error
}

func (e *DialError) Error() string { return fmt.Sprintf("request: upgrade %d: %v", e.Status, e.Err) }
func (e *DialError) Unwrap() error { return e.Err }

// WSConn `/ws/request` soketi.
type WSConn struct {
	ws *websocket.Conn
}

// Dial `wss://<host>/ws/request`'e (sorgu dizesi yok, Origin yok) `rs.v1, rs.req.<sır>` ile bağlanır. Sır yalnız
// subprotocol'de taşınır; hata metinlerine/loga girmez.
func Dial(ctx context.Context, httpClient *http.Client, server *url.URL, secret string) (*WSConn, error) {
	if !secretRe.MatchString(secret) {
		return nil, errors.New("request: geçersiz talep sırrı")
	}
	u := url.URL{Scheme: "wss", Host: server.Host, Path: wsPath}
	ws, resp, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{
		HTTPClient:   httpClient,
		Subprotocols: []string{signal.Subprotocol, secretPrefix + secret},
	})
	status, after := 0, time.Duration(0)
	if resp != nil {
		status, after = resp.StatusCode, api.ParseRetryAfter(resp.Header.Get("Retry-After"))
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
	}
	if err != nil {
		if status >= 400 {
			return nil, &DialError{Status: status, RetryAfter: after, Err: errors.New("upgrade reddedildi")}
		}
		return nil, err
	}
	if ws.Subprotocol() != signal.Subprotocol {
		_ = ws.Close(websocket.StatusPolicyViolation, "")
		return nil, errors.Join(ErrProtocol, errors.New("sunucu rs.v1 seçmedi"))
	}
	ws.SetReadLimit(maxPayload)
	return &WSConn{ws: ws}, nil
}

// Read sıradaki doğrulanmış sunucu mesajı; şema ihlalinde 1008 ile kapatır.
func (c *WSConn) Read(ctx context.Context) (Inbound, error) {
	typ, data, err := c.ws.Read(ctx)
	if err != nil {
		return nil, err
	}
	if typ != websocket.MessageText {
		_ = c.ws.Close(websocket.StatusPolicyViolation, "")
		return nil, ErrProtocol
	}
	m, err := ParseServer(data)
	if err != nil {
		_ = c.ws.Close(websocket.StatusPolicyViolation, "")
		return nil, errors.Join(ErrProtocol, err)
	}
	return m, nil
}

// Send `request.cancel` / `request.decline`.
func (c *WSConn) Send(ctx context.Context, m Outbound) error {
	b, err := Encode(m)
	if err != nil {
		return err
	}
	return c.ws.Write(ctx, websocket.MessageText, b)
}

// Close normal=true → 1000 (sunucu: PENDING ise iptal, ACCEPTED + oturum PENDING ise vazgeçme; mimari-protokol §5.1),
// normal=false → 1001 (kopma sayılır; ACCEPTED talebi değiştirmez, süre dolumu CONNECT_FAILED olur).
func (c *WSConn) Close(normal bool) error {
	if normal {
		return c.ws.Close(websocket.StatusNormalClosure, "")
	}
	return c.ws.Close(websocket.StatusGoingAway, "")
}

// CloseCode sunucunun kapanış kodu (yoksa -1).
func CloseCode(err error) int { return int(websocket.CloseStatus(err)) }
