package request

import (
	"context"
	"errors"
	"sync"
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
}

// wait back=true → forma dön (iptal sonrası veya "Yeniden talep oluştur").
func (r *runner) wait(ctx context.Context, c *api.CreateRequestResult) (bool, *Outcome) {
	wctx, wcancel := context.WithCancel(ctx)
	w := &waiter{r: r, wctx: wctx, secret: c.RequestSecret, in: make(chan readRes, 8), redial: make(chan dialRes, 1),
		sentAt: r.d.Now()}
	w.view = WaitView{Tenant: r.info.Tenant.Name, Logo: r.logo, Code: c.RequestCode, Position: c.Position,
		Warning: r.forgetWarn}
	r.d.UI.RequestFormClose()
	r.d.UI.RequestWaiting(w.view)
	w.startDial(r.d.Now(), 0) // ilk bağlantı da yeniden bağlanma yoluyla: hata → aynı süre içinde tekrar
	tick := time.NewTicker(r.d.TickEvery)
	defer tick.Stop()
	for {
		var st Step
		select {
		case <-ctx.Done():
			w.closeConn(true)
			wcancel()
			return false, &Outcome{Kind: OutClose}
		case a := <-r.d.Events:
			st = w.m.OnUser(a)
		case rr := <-w.in:
			if rr.gen != w.gen {
				continue
			}
			if rr.err != nil {
				if done, back, out := w.lost(ctx, rr.err); done {
					wcancel()
					return back, out
				}
				continue
			}
			st = w.m.OnServer(rr.m)
		case dr := <-w.redial:
			w.dialing = false
			if done, back, out := w.dialed(ctx, dr); done {
				wcancel()
				return back, out
			}
			continue
		case <-tick.C:
			st = w.tick()
		case <-w.cancelC:
			w.cancelC = nil
			st = w.m.OnCancelTimeout()
		}
		if st.Share != nil {
			r.d.UI.RequestWaitClose()
			return false, &Outcome{Kind: OutShare, Ticket: st.Share.WsTicket, TechName: st.Share.TechnicianName,
				Release: w.release(wcancel)}
		}
		if done, back, out := w.apply(ctx, st); done {
			wcancel()
			return back, out
		}
	}
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
	go func() {
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
	}()
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
		_, out := w.r.problem(ctx, outdatedProblem())
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
	w.startDial(w.r.d.Now(), w.r.d.Jitter(retryJitter))
	return false, false, nil
}

func (w *waiter) closeConn(normal bool) {
	if w.conn != nil {
		_ = w.conn.Close(normal)
		w.conn = nil
	}
}

// restCancel soket yokken en iyi çaba iptali (AC-141; ACCEPTED iken vazgeçme yolu).
func (w *waiter) restCancel() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = w.r.d.API.CancelRequest(ctx, w.secret)
}

// release Outcome.Release (mimari-protokol §5.1 kapanış semantiği):
//   - ReleaseAdmitted: hello geldi → 1000 (oturum ACTIVE, sunucu talebi değiştirmez);
//   - ReleaseAbandoned: müşteri hello'dan önce vazgeçti → 1000 (kopuksa REST iptal) = decline, "Müşteri vazgeçti";
//   - ReleaseFailed: `/ws/guest` hello'dan önce ağ/protokol hatasıyla düştü → 1001 (kopma), REST iptal YOK; talep
//     ACCEPTED kalır ve 60 sn penceresi dolunca sunucu CONNECT_FAILED ("Müşteri bağlanamadı") yazar.
func (w *waiter) release(wcancel context.CancelFunc) func(ReleaseKind) {
	var once sync.Once
	conn := w.conn
	return func(k ReleaseKind) {
		once.Do(func() {
			switch {
			case conn != nil:
				_ = conn.Close(k != ReleaseFailed)
			case k == ReleaseAbandoned:
				w.restCancel()
			}
			wcancel()
		})
	}
}

func (w *waiter) elapsed(now time.Time) time.Duration {
	if w.baseAt.IsZero() {
		return now.Sub(w.sentAt)
	}
	return w.base + now.Sub(w.baseAt)
}

func (w *waiter) remaining(now time.Time) time.Duration {
	a := w.m.Ticket()
	if a == nil {
		return 0
	}
	exp, err := time.Parse(time.RFC3339Nano, a.TicketExpiresAt)
	if err != nil {
		return 0
	}
	return max(exp.Sub(now.Add(w.offset)), 0)
}

func (w *waiter) tick() Step {
	now := w.r.d.Now()
	switch w.m.Phase() {
	case PhWaiting:
		w.view.Elapsed = w.elapsed(now)
		w.r.d.UI.RequestWaiting(w.view)
	case PhAccepted:
		rem := w.remaining(now)
		if rem <= 0 {
			return w.m.OnTicketExpired()
		}
		w.r.d.UI.RequestAcceptedTick(rem)
	}
	return Step{}
}

// apply makine adımını uygular; done=true → bekleme bitti.
func (w *waiter) apply(ctx context.Context, st Step) (bool, bool, *Outcome) {
	d := w.r.d
	now := d.Now()
	if s := st.State; s != nil {
		created, e1 := time.Parse(time.RFC3339Nano, s.CreatedAt)
		server, e2 := time.Parse(time.RFC3339Nano, s.ServerTime)
		if e1 == nil && e2 == nil {
			w.base, w.baseAt, w.offset = max(server.Sub(created), 0), now, server.Sub(now)
		}
		w.view.Code, w.view.Position, w.view.Elapsed = s.RequestCode, s.Position, w.elapsed(now)
		d.UI.RequestWaiting(w.view)
	}
	if a := st.Accept; a != nil {
		d.UI.RequestAccepted(AcceptView{Tenant: w.view.Tenant, Logo: w.view.Logo, TechName: a.TechnicianName,
			TechVerifyCode: a.TechVerifyCode, RequestCode: w.view.Code, Remaining: w.remaining(now)})
	}
	if st.Send != "" {
		if w.conn == nil || w.conn.Send(w.wctx, st.Send) != nil {
			w.restCancel()
		}
		if w.m.Phase() == PhCancelling && w.cancelC == nil {
			w.cancelC = d.After(d.CancelWait)
		}
	}
	if st.CloseNow {
		if w.conn == nil && st.Send == "" {
			w.restCancel()
		}
		w.closeConn(true)
	}
	if st.End == nil {
		return false, false, nil
	}
	if !st.CloseNow { // süre dolumu: 1001 (kopma) — talep sunucuda CONNECT_FAILED olur, "vazgeçti" sayılmaz
		w.closeConn(st.End.Reason != EndTicketExpired)
	}
	d.UI.RequestWaitClose()
	switch st.End.Reason {
	case EndWindowClosed:
		return true, false, &Outcome{Kind: OutClose}
	case EndUserCancel:
		w.r.notice = noticeCancelled
		return true, true, nil
	case EndDeclined:
		return w.closedScreen(ctx, ClosedView{Message: msgDeclined, Recreate: true})
	case EndTicketExpired:
		return w.closedScreen(ctx, ClosedView{Message: msgTicketTO, Recreate: true})
	}
	return w.closedScreen(ctx, closedView(*st.End.Closed))
}

func (w *waiter) closedScreen(ctx context.Context, v ClosedView) (bool, bool, *Outcome) {
	if w.r.d.UI.RequestClosed(ctx, v) == ClosedRecreate && v.Recreate {
		return true, true, nil
	}
	return true, false, &Outcome{Kind: OutClose}
}

// closedView sunucunun request.closed'ı → müşteri metni (mimari-protokol §5.1).
func closedView(c Closed) ClosedView {
	reason := ""
	if c.Reason != nil {
		reason = *c.Reason
	}
	switch {
	case c.Status == "EXPIRED":
		return ClosedView{Message: Message{"Talebiniz zaman aşımına uğradı", "Firmanız bekleme süresi içinde yanıt veremedi. Bilgileriniz formda duruyor; isterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
	case c.Status == "REJECTED":
		v := ClosedView{Message: Message{"Firmanız talebinizi yanıtladı", "Ekranınız paylaşılmadı."}}
		if c.Message != nil {
			v.FirmMessage = *c.Message
		}
		return v
	case c.Status == "CONNECT_FAILED":
		return ClosedView{Message: Message{"Bağlantı kurulamadı", "Teknisyen kabul ettikten sonra bağlantı süresi doldu. İsterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
	case reason == "TENANT_PASSIVE":
		return ClosedView{Message: Message{"Talebiniz iptal edildi", "Firmanız şu an talep kabul etmiyor. Lütfen firmanızı telefonla arayın."}}
	case reason == "DISCONNECTED":
		return ClosedView{Message: Message{"Talebiniz iptal edildi", "Bağlantı uzun süre koptuğu için talebiniz iptal edildi. İsterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
	}
	return ClosedView{Message: Message{"Talebiniz iptal edildi", "İsterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
}
