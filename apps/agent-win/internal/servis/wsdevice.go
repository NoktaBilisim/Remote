package servis

import (
	"context"
	"crypto/ed25519"
	"errors"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// `/ws/device` istemcisi (mimari-p27 §4.4): `wss://<host>/ws/device`, alt protokol `rs.device.v1`, sorgu dizesi ve
// Origin başlığı YOK, TLS doğrulaması api.Client'ın sistem kökleriyle (gevşetilmez). Bant içi meydan okuma: sunucu
// `device.hello{nonce}` → cihaz `device.auth{sig}` → `device.ready`. Kopuşta üstel bekleme 1-2-4-…-30 sn + %20
// titreşim; `revoked{}` sonrası yeniden bağlanılmaz.

// Bağlantı durumları (boru `status`, ayar penceresi).
const (
	StateConnecting = "connecting"
	StateOnline     = "online"
	StateOffline    = "offline"
	StateRejected   = "rejected" // 4401/4403: imza kapısı ya da kimlik reddi (bekleyerek yeniden denenir)
	StateRevoked    = "revoked"
)

const (
	handshakeTimeout = 10 * time.Second
	writeTimeout     = 10 * time.Second
	backoffMin       = time.Second
	backoffMax       = 30 * time.Second
	outQueue         = 32
)

// ErrRevoked cihaz iptal edildi; Run döner.
var ErrRevoked = errors.New("servis: cihaz iptal edildi")

// Identity `device.auth` alanları.
type Identity struct {
	DeviceID  string
	Key       ed25519.PrivateKey
	Origin    string
	Version   string
	SHA256    string
	OSVersion string
	Signed    bool
}

// DeviceHandler sunucu mesajlarının çekirdekteki karşılığı.
type DeviceHandler interface {
	Connect(m *Connect)
	Disconnect(m *Disconnect)
	Kill(reason string)
	LocalEnabled() bool
	// P28u (yalnız device.features alınmış sokette çağrılır).
	Features()
	Intervene(m *Intervene)
	Rejoin(m *Rejoin)
}

// DeviceClient kalıcı cihaz kanalı.
type DeviceClient struct {
	HTTP    *http.Client
	Server  *url.URL
	ID      Identity
	Handler DeviceHandler
	Events  EventSink

	out     chan any
	state   atomic.Value // string
	consent atomic.Bool  // bu sokette device.features{consent1} alındı (her bağlantıda sıfırlanır)
	sleep   func(ctx context.Context, d time.Duration) bool
	lastRej string
}

// NewDeviceClient kuyruğu hazırlanmış istemci.
func NewDeviceClient(h *http.Client, server *url.URL, id Identity, handler DeviceHandler, ev EventSink) *DeviceClient {
	c := &DeviceClient{HTTP: h, Server: server, ID: id, Handler: handler, Events: ev, out: make(chan any, outQueue)}
	c.state.Store(StateConnecting)
	return c
}

// State bağlantı durumu.
func (c *DeviceClient) State() string { return c.state.Load().(string) }

// Send mesajı kuyruğa alır; kuyruk doluysa düşürür (çağıran helperMu altında olabilir — bloklamaz).
func (c *DeviceClient) Send(msg any) {
	select {
	case c.out <- msg:
	default:
	}
}

// flushMsg gönderimi beklenen mesaj (kaldırma).
type flushMsg struct {
	msg  any
	done chan error
}

// unregisterWait `device.unregister` gönderimi için en çok bekleme; çevrimdışıysa hiç beklenmez (§5.3).
const unregisterWait = 3 * time.Second

// Unregister kaldırmada `device.unregister` gönderir; çevrimdışıysa sessizce geçer (Admin panelden iptal eder).
func (c *DeviceClient) Unregister() error {
	if c.State() != StateOnline {
		return nil
	}
	done := make(chan error, 1)
	select {
	case c.out <- flushMsg{msg: &Unregister{}, done: done}:
	default:
		return nil
	}
	t := time.NewTimer(unregisterWait)
	defer t.Stop()
	select {
	case err := <-done:
		return err
	case <-t.C:
		return nil
	}
}

// Run bağlam bitene ya da cihaz iptal edilene kadar bağlı kalır.
func (c *DeviceClient) Run(ctx context.Context) error {
	wait := backoffMin
	for ctx.Err() == nil {
		ready, err := c.session(ctx)
		if errors.Is(err, ErrRevoked) {
			c.state.Store(StateRevoked)
			return err
		}
		c.noteFailure(err)
		if ready {
			wait = backoffMin
		}
		if !c.pause(ctx, jitter(wait)) {
			break
		}
		wait = min(wait*2, backoffMax)
	}
	c.state.Store(StateOffline)
	return ctx.Err()
}

// noteFailure kimlik/kapı reddini durum değişiminde bir kez olay günlüğüne yazar.
func (c *DeviceClient) noteFailure(err error) {
	reason := ""
	switch websocket.CloseStatus(err) {
	case CloseAuth:
		reason = ReasonAuthRejected
	case CloseGate:
		reason = ReasonGate
	}
	if reason == "" {
		c.state.Store(StateConnecting)
		c.lastRej = ""
		return
	}
	c.state.Store(StateRejected)
	if reason != c.lastRej && c.Events != nil {
		c.Events.Write(EvReject(reason, ""))
	}
	c.lastRej = reason
}

func (c *DeviceClient) pause(ctx context.Context, d time.Duration) bool {
	if c.sleep != nil {
		return c.sleep(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// jitter ±%20.
func jitter(d time.Duration) time.Duration {
	f := 0.8 + rand.Float64()*0.4 //nolint:gosec // zamanlama titreşimi, güvenlik amaçlı değil
	return time.Duration(float64(d) * f)
}

// session tek bağlantı: dial → meydan okuma → okuma döngüsü. ready: device.ready alındı.
func (c *DeviceClient) session(ctx context.Context) (bool, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	c.consent.Store(false)
	defer c.consent.Store(false)
	ws, err := c.dial(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = ws.CloseNow() }()
	if err := c.handshake(ctx, ws); err != nil {
		return false, err
	}
	c.state.Store(StateOnline)
	c.lastRej = ""
	go c.writer(ctx, ws)
	return true, c.readLoop(ctx, ws)
}

func (c *DeviceClient) dial(ctx context.Context) (*websocket.Conn, error) {
	u := url.URL{Scheme: "wss", Host: c.Server.Host, Path: DevicePath}
	dctx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	ws, resp, err := websocket.Dial(dctx, u.String(), &websocket.DialOptions{
		HTTPClient:   c.HTTP,
		Subprotocols: []string{DeviceSubprotocol, DeviceCapConsent},
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, err
	}
	if ws.Subprotocol() != DeviceSubprotocol {
		_ = ws.Close(websocket.StatusPolicyViolation, "")
		return nil, errors.New("servis: sunucu rs.device.v1 seçmedi")
	}
	ws.SetReadLimit(DeviceMaxMessage)
	return ws, nil
}

// handshake hello → auth → ready (10 sn).
func (c *DeviceClient) handshake(ctx context.Context, ws *websocket.Conn) error {
	hctx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	m, err := c.read(hctx, ws)
	if err != nil {
		return err
	}
	hello, ok := m.(*Hello)
	if !ok {
		return c.violation(ws, "hello bekleniyordu")
	}
	auth := &Auth{DeviceID: c.ID.DeviceID, Sig: SignAuth(c.ID.Key, hello.Nonce, c.ID.DeviceID, c.ID.Origin),
		Version: c.ID.Version, SHA256: c.ID.SHA256, Signed: c.ID.Signed,
		LocalEnabled: c.Handler.LocalEnabled(), OSVersion: c.ID.OSVersion}
	if err := c.write(hctx, ws, auth); err != nil {
		return err
	}
	m, err = c.read(hctx, ws)
	if err != nil {
		return err
	}
	if _, ok := m.(*Ready); !ok {
		return c.violation(ws, "ready bekleniyordu")
	}
	return nil
}

// readLoop sunucu mesajlarını çekirdeğe iletir.
func (c *DeviceClient) readLoop(ctx context.Context, ws *websocket.Conn) error {
	for {
		m, err := c.read(ctx, ws)
		if err != nil {
			return err
		}
		switch v := m.(type) {
		case *Connect:
			c.Handler.Connect(v)
		case *Disconnect:
			c.Handler.Disconnect(v)
		case *Revoked:
			c.Handler.Kill(KillRevoked)
			if c.Events != nil {
				c.Events.Write(EvRevokedText(false))
			}
			_ = ws.Close(websocket.StatusNormalClosure, "")
			return ErrRevoked
		case *Features, *Intervene, *Rejoin:
			if err := c.consentMessage(ws, v); err != nil {
				return err
			}
		default: // hello/ready yalnız el sıkışmada
			return c.violation(ws, "beklenmeyen mesaj")
		}
	}
}
