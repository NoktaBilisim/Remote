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
