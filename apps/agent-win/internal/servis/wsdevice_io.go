package servis

import (
	"context"
	"errors"

	"github.com/coder/websocket"
)

// `/ws/device` soket G/Ç'si: yazıcı döngüsü, doğrulayarak okuma, zaman aşımlı yazma ve protokol ihlali kapanışı.

func (c *DeviceClient) writer(ctx context.Context, ws *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-c.out:
			fm, flush := m.(flushMsg)
			if flush {
				m = fm.msg
			}
			if consentOnly(m) && !c.consent.Load() {
				continue // K-P28u-8: features'sız (eski/geri alınmış) sunucuya yeni mesaj yazılmaz
			}
			err := c.write(ctx, ws, m)
			if flush {
				fm.done <- err
			}
			if err != nil {
				_ = ws.CloseNow()
				return
			}
		}
	}
}

// Consent1 bu sokette `device.features{consent1}` alındı mı (çekirdeğin kip kararı; D-P28u-5).
func (c *DeviceClient) Consent1() bool { return c.consent.Load() }

// consentMessage P28u sunucu mesajları. intervene/rejoin features'tan önce gelirse protokol ihlalidir.
func (c *DeviceClient) consentMessage(ws *websocket.Conn, m any) error {
	if _, ok := m.(*Features); ok {
		c.consent.Store(true)
		c.Handler.Features()
		return nil
	}
	if !c.consent.Load() {
		return c.violation(ws, "device.features öncesi P28u mesajı")
	}
	switch v := m.(type) {
	case *Intervene:
		c.Handler.Intervene(v)
	case *Rejoin:
		c.Handler.Rejoin(v)
	}
	return nil
}

func (c *DeviceClient) read(ctx context.Context, ws *websocket.Conn) (any, error) {
	typ, data, err := ws.Read(ctx)
	if err != nil {
		return nil, err
	}
	if typ != websocket.MessageText {
		return nil, c.violation(ws, "ikili mesaj")
	}
	m, err := ParseServer(data)
	if err != nil {
		_ = ws.Close(websocket.StatusPolicyViolation, "")
		return nil, err
	}
	return m, nil
}

func (c *DeviceClient) write(ctx context.Context, ws *websocket.Conn, m any) error {
	b, err := encodeClient(m)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, b)
}

func (c *DeviceClient) violation(ws *websocket.Conn, why string) error {
	_ = ws.Close(websocket.StatusPolicyViolation, "")
	return errors.Join(errSchema, errors.New(why))
}
