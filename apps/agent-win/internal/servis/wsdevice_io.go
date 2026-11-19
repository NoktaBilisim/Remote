package servis

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"time"

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
				// S-P29-K-3: süresi dolan (çağıran vazgeçti) ya da önceki bağlantıda kuyruğa alınmış update.* yazılmaz.
				if fm.dropped != nil && (fm.dropped.Load() || fm.gen != c.gen.Load()) {
					fm.done <- errUpdateGate
					continue
				}
			}
			if consentOnly(m) && !c.consent.Load() {
				continue // K-P28u-8: features'sız (eski/geri alınmış) sunucuya yeni mesaj yazılmaz
			}
			if updateOnly(m) && !c.updateSeen.Load() {
				if flush {
					fm.done <- errUpdateGate
				}
				continue // AC-493: offer/none almamış (eski) sunucuya update.* yazılmaz
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

// Record1 bu sokette `device.features` caps `record1` içeriyor mu (P28e; `connect.recording` kabulü).
func (c *DeviceClient) Record1() bool { return c.record.Load() }

// consentMessage P28u/P28e sunucu mesajları. intervene/rejoin features'tan önce gelirse protokol ihlalidir.
func (c *DeviceClient) consentMessage(ws *websocket.Conn, m any) error {
	if f, ok := m.(*Features); ok {
		c.consent.Store(true)
		c.record.Store(slices.Contains(f.Caps, capRecord1))
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
	case *RecState:
		if !c.record.Load() { // K-P28e-7: record1'siz sokette rec.state şema hatasıdır
			return c.violation(ws, "record1 olmadan rec.state")
		}
		c.Handler.RecState(*v.On)
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

// errUpdateGate güncelleme mesajı bu sokette yazılamaz (sunucu offer/none göndermedi).
var errUpdateGate = errors.New("servis: sunucu güncelleme desteğini duyurmadı")

// UpdateGate bu sokette `update.offer`/`update.none` alındı mı (C→S update.* yazma kapısı).
func (c *DeviceClient) UpdateGate() bool { return c.updateSeen.Load() && c.State() == StateOnline }

// SendWait mesajı kuyruğa alır ve yazılmasını bekler (en çok d). Kuyruk doluysa, kapı kapalıysa ya da süre dolarsa hata.
func (c *DeviceClient) SendWait(msg any, d time.Duration) error {
	done := make(chan error, 1)
	dropped := &atomic.Bool{}
	select {
	case c.out <- flushMsg{msg: msg, done: done, dropped: dropped, gen: c.gen.Load()}:
	default:
		return errUpdateGate
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case err := <-done:
		return err
	case <-t.C:
		dropped.Store(true) // yazıcı henüz almadıysa düşürür
		return errUpdateGate
	}
}

// updateMessage P29 sunucu mesajları: offer/none kapıyı açar (sunucu P29'u biliyor); güncelleyiciye iletilir.
func (c *DeviceClient) updateMessage(m any) {
	c.updateSeen.Store(true)
	if c.Update == nil {
		return
	}
	switch v := m.(type) {
	case *UpdateOffer:
		c.Update.Offer(v)
	case *UpdateNone:
		c.Update.None()
	case *UpdateToken:
		c.Update.Token(v)
	}
}
