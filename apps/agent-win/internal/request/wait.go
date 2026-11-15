package request

import (
	"context"
	"errors"
	"time"

	"remote-support/agent-win/internal/api"
)

type readRes struct {
	gen int
	m   Inbound
	err error
}

type dialRes struct {
	c   Conn
	err error
}

var errReconnectTimeout = errors.New("request: yeniden bağlanma süresi doldu")

// waiter tek talebin `/ws/request` beklemesi (mimari-protokol §5.1).
type waiter struct {
	r       *runner
	wctx    context.Context
	cancel  context.CancelFunc // wctx'i bitirir (bekleme sona erdi; paylaşımda Outcome.Release çağırır)
	secret  string
	m       Machine
	conn    Conn
	gen     int
	in      chan readRes
	redial  chan dialRes
	dialing bool
	view    WaitView
	sentAt  time.Time     // talep gönderim anı (sıra gelmeden önceki süre)
	base    time.Duration // son request.state'teki serverTime − createdAt
	baseAt  time.Time     // o mesajın yerel alınma anı
	offset  time.Duration // serverTime − yerel saat
	cancelC <-chan time.Time
	// P20 K6 talep sohbeti (chat.go): chatC sıradaki sohbet zaman olayı (1 sn kilidi / yeniden gönderim), chatAt anı.
	chat   *Chat
	chatC  <-chan time.Time
	chatAt time.Time
}

// wait back=true → forma dön (iptal sonrası veya "Yeniden talep oluştur").
func (r *runner) wait(ctx context.Context, c *api.CreateRequestResult) (bool, *Outcome) {
	w := r.openWait(ctx, c)
	sends := r.d.UI.RequestChatSends()
	w.startDial(r.d.Now(), 0) // ilk bağlantı da yeniden bağlanma yoluyla: hata → aynı süre içinde tekrar
	tick := time.NewTicker(r.d.TickEvery)
	defer tick.Stop()
	for {
		if done, back, out := w.event(ctx, tick.C, sends); done {
			return back, out
		}
	}
}

// openWait formu kapatır, bekleme penceresini ve sohbet alanını açar.
func (r *runner) openWait(ctx context.Context, c *api.CreateRequestResult) *waiter {
	wctx, wcancel := context.WithCancel(ctx)
	w := &waiter{r: r, wctx: wctx, cancel: wcancel, secret: c.RequestSecret, in: make(chan readRes, 8),
		redial: make(chan dialRes, 1), sentAt: r.d.Now(), chat: NewChat(nil)}
	w.view = WaitView{Tenant: r.info.Tenant.Name, Logo: r.logo, Code: c.RequestCode, Position: c.Position,
		Warning: r.forgetWarn, Label: r.registered}
	r.d.UI.RequestFormClose()
	r.d.UI.RequestWaiting(w.view)
	w.showChat(r.d.Now())
	return w
}

// event sıradaki olayı işler; done=true → bekleme bitti (back/out wait'in sonucudur).
func (w *waiter) event(ctx context.Context, tick <-chan time.Time, sends <-chan string) (bool, bool, *Outcome) {
	var st Step
	select {
	case <-ctx.Done():
		w.closeConn(true)
		w.cancel()
		return true, false, &Outcome{Kind: OutClose}
	case a := <-w.r.d.Events:
		st = w.m.OnUser(a)
	case rr := <-w.in:
		return w.received(ctx, rr)
	case dr := <-w.redial:
		w.dialing = false
		return w.ended(w.dialed(ctx, dr))
	case <-tick:
		st = w.tick()
	case <-w.cancelC:
		w.cancelC = nil
		st = w.m.OnCancelTimeout()
	case text := <-sends:
		now := w.r.d.Now()
		w.sendChat(w.chat.Submit(text, now))
		w.showChat(now)
		return false, false, nil
	case <-w.chatC:
		w.chatC = nil
		now := maxTime(w.r.d.Now(), w.chatAt) // zamanlayıcı olayın anına ulaşıldı demektir
		w.sendChat(w.chat.Due(now))
		w.showChat(now)
		return false, false, nil
	}
	return w.step(ctx, st)
}

// received soketten okunan mesaj ya da okuma hatası (eski bağlantının sonuçları yok sayılır).
func (w *waiter) received(ctx context.Context, rr readRes) (bool, bool, *Outcome) {
	if rr.gen != w.gen {
		return false, false, nil
	}
	if rr.err != nil {
		return w.ended(w.lost(ctx, rr.err))
	}
	if w.onChat(rr.m) {
		return false, false, nil
	}
	return w.step(ctx, w.m.OnServer(rr.m))
}

// step makine adımı: paylaşım → bekleme biter, `/ws/request` Outcome.Release'e kadar açık kalır; diğerleri apply.
func (w *waiter) step(ctx context.Context, st Step) (bool, bool, *Outcome) {
	if st.Share != nil {
		w.r.d.UI.RequestWaitClose()
		return true, false, &Outcome{Kind: OutShare, Ticket: st.Share.WsTicket, TechName: st.Share.TechnicianName,
			AdmitCode: st.Share.AdmitCode, Release: w.release(w.cancel)}
	}
	return w.ended(w.apply(ctx, st))
}

// ended bekleme bittiyse wctx'i kapatır.
func (w *waiter) ended(done, back bool, out *Outcome) (bool, bool, *Outcome) {
	if done {
		w.cancel()
	}
	return done, back, out
}

func (w *waiter) read(c Conn, gen int) {
	go func() {
		for {
			m, err := c.Read(w.wctx)
			select {
			case w.in <- readRes{gen: gen, m: m, err: err}:
			case <-w.wctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
}

// startDial deadline'a kadar bağlanmayı dener; denemeler arası dialRetryDelay (üstel + jitter + Retry-After, S8b2-2).
// 403/426 kesin hata, beklemeden döner. first>0 → ilk denemeden önce o kadar beklenir: kopmadan sonra aynı NAT
// arkasındaki istemciler aynı anda yeniden bağlanmasın diye 0..1 sn jitter (sürü etkisi, QA önerisi P8b-2).
func (w *waiter) startDial(start time.Time, first time.Duration) {
	if w.dialing {
		return
	}
	w.dialing = true
	d := w.r.d
	deadline := start.Add(d.ReconnectWindow)
	go w.dialLoop(d, deadline, first)
}

// dialLoop startDial'ın arka plan döngüsü; sonuç w.redial'a yazılır (wctx bitince sessizce çıkar).
func (w *waiter) dialLoop(d Deps, deadline time.Time, first time.Duration) {
	if first > 0 {
		select {
		case <-w.wctx.Done():
			return
		case <-d.After(first):
		}
	}
	for attempt := 1; ; attempt++ {
		c, err := d.Dial(w.wctx, w.secret)
		if err == nil {
			if w.wctx.Err() != nil {
				_ = c.Close(false)
				return
			}
			w.redial <- dialRes{c: c}
			return
		}
		var de *DialError
		if errors.As(err, &de) && (de.Status == 403 || de.Status == 426) {
			w.redial <- dialRes{err: err}
			return
		}
		left := deadline.Sub(d.Now())
		if left <= 0 {
			w.redial <- dialRes{err: errReconnectTimeout}
			return
		}
		select {
		case <-w.wctx.Done():
			return
		case <-d.After(dialRetryDelay(err, attempt, d.ReconnectEvery, left, d.Jitter)):
		}
	}
}

func (w *waiter) dialed(ctx context.Context, dr dialRes) (bool, bool, *Outcome) {
	if dr.c != nil {
		if p := w.m.Phase(); p == PhDone || p == PhSharing {
			_ = dr.c.Close(false)
			return false, false, nil
		}
		w.conn = dr.c
		w.gen++
		w.read(dr.c, w.gen)
		w.chat.Online(true)
		w.showChat(w.r.d.Now())
		if w.view.Notice != "" {
			w.view.Notice = ""
			w.r.d.UI.RequestWaiting(w.view)
		}
		if w.m.Phase() == PhCancelling { // kopukken verilen iptal kararı yeniden iletilir
			_ = dr.c.Send(w.wctx, w.cancelMsg())
		}
		return false, false, nil
	}
	if w.m.Phase() == PhCancelling {
		return w.apply(ctx, w.m.OnCancelTimeout())
	}
	w.r.d.UI.RequestWaitClose()
	var de *DialError
	if errors.As(dr.err, &de) && de.Status == 426 {
		_, out := w.r.problem(ctx, w.r.outdatedProblem())
		return true, false, out
	}
	if errors.As(dr.err, &de) && de.Status == 403 {
		return w.closedScreen(ctx, ClosedView{Message: msgGone, Recreate: true})
	}
	return w.closedScreen(ctx, ClosedView{Message: msgLost, Recreate: true})
}

func (w *waiter) cancelMsg() Outbound {
	if w.m.Ticket() != nil {
		return SendDecline
	}
	return SendCancel
}

// lost okuma hatası: protokol ihlali/4409 kesin; diğerleri 110 sn içinde yeniden bağlanma (sunucu 120 sn bekler).
func (w *waiter) lost(ctx context.Context, err error) (bool, bool, *Outcome) {
	w.conn = nil
	switch w.m.Phase() {
	case PhDone, PhSharing:
		return false, false, nil
	}
	code := CloseCode(err)
	if errors.Is(err, ErrProtocol) || code == 1008 || code == CloseReplaced {
		w.r.d.UI.RequestWaitClose()
		msg := msgProtocol
		if code == CloseReplaced {
			msg = msgReplaced
		}
		return w.closedScreen(ctx, ClosedView{Message: msg})
	}
	w.view.Notice = noticeReconnect
	w.r.d.UI.RequestWaiting(w.view)
	w.chat.Online(false)
	w.showChat(w.r.d.Now())
	w.startDial(w.r.d.Now(), w.r.d.Jitter(retryJitter))
	return false, false, nil
}

func (w *waiter) closeConn(normal bool) {
	if w.conn != nil {
		_ = w.conn.Close(normal)
		w.conn = nil
	}
}
