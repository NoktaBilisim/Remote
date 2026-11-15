package request

// Bekleme ekranı (AC-139..157): geçen/kalan süre, makine adımının uygulanması, kapanış ekranları, `/ws/request`'in
// bırakılması (REST iptal, Outcome.Release) ve talep sohbeti alanı.

import (
	"context"
	"sync"
	"time"
)

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
	now := w.r.d.Now()
	if s := st.State; s != nil {
		w.onState(s, now)
	}
	if a := st.Accept; a != nil {
		w.onAccept(a, now)
	}
	w.sendStep(st)
	if st.End == nil {
		return false, false, nil
	}
	return w.finish(ctx, st)
}

// onState sıra/süre: serverTime − createdAt taban alınır, saat farkı (offset) onay süresinde kullanılır.
func (w *waiter) onState(s *State, now time.Time) {
	created, e1 := time.Parse(time.RFC3339Nano, s.CreatedAt)
	server, e2 := time.Parse(time.RFC3339Nano, s.ServerTime)
	if e1 == nil && e2 == nil {
		w.base, w.baseAt, w.offset = max(server.Sub(created), 0), now, server.Sub(now)
	}
	w.view.Code, w.view.Position, w.view.Elapsed = s.RequestCode, s.Position, w.elapsed(now)
	w.r.d.UI.RequestWaiting(w.view)
}

// onAccept onay ekranı; sohbet kapanır.
func (w *waiter) onAccept(a *Accepted, now time.Time) {
	w.chat.OnAccepted()
	w.showChat(now)
	w.r.d.UI.RequestAccepted(AcceptView{Tenant: w.view.Tenant, Logo: w.view.Logo, TechName: a.TechnicianName,
		TechVerifyCode: a.TechVerifyCode, RequestCode: w.view.Code, Remaining: w.remaining(now), AdmitCode: a.AdmitCode})
}

// sendStep adımın gidecek mesajı (soket yoksa/yazılamazsa REST iptal) ve hemen kapanışı.
func (w *waiter) sendStep(st Step) {
	d := w.r.d
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
}

// finish bekleme sonu: soket kapanır, pencere kapanır, sonuca göre forma dönülür ya da kapanış ekranı gösterilir.
func (w *waiter) finish(ctx context.Context, st Step) (bool, bool, *Outcome) {
	if !st.CloseNow { // süre dolumu: 1001 (kopma) — talep sunucuda CONNECT_FAILED olur, "vazgeçti" sayılmaz
		w.closeConn(st.End.Reason != EndTicketExpired)
	}
	w.r.d.UI.RequestWaitClose()
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
	case reason == "CUSTOMER_PASSIVE" || reason == "BINDING_REVOKED": // P8c (AC-171, §15.2): genel metin, neden gösterilmez
		return ClosedView{Message: msgFirmClosed}
	case reason == "DISCONNECTED":
		return ClosedView{Message: Message{"Talebiniz iptal edildi", "Bağlantı uzun süre koptuğu için talebiniz iptal edildi. İsterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
	}
	return ClosedView{Message: Message{"Talebiniz iptal edildi", "İsterseniz yeniden talep oluşturabilirsiniz."}, Recreate: true}
}

// onChat P20 sohbet mesajları ve `error` (sohbetten doğar; bekleme makinesi `error`'ı zaten yok sayar).
func (w *waiter) onChat(m Inbound) bool {
	now := w.r.d.Now()
	switch v := m.(type) {
	case ChatMessage:
		w.chat.OnMessage(v.ChatItem)
	case ChatHistory:
		w.sendChat(w.chat.OnHistory(v.Items, now))
	case ChatToggle:
		w.chat.OnToggle(*v.Enabled)
	case ErrorMsg:
		w.chat.OnError(v, now)
	default:
		return false
	}
	w.showChat(now)
	return true
}

// sendChat yazım hatası kopma gibi ele alınır (yeniden bağlantıdaki `request.messages` ile denetlenir).
func (w *waiter) sendChat(s *ChatSend) {
	if s == nil {
		return
	}
	if w.conn == nil || w.conn.SendMessage(w.wctx, s.Body, s.ClientMsgID) != nil {
		w.chat.SendFailed()
	}
}

// showChat sohbet alanını çizer ve sıradaki sohbet zaman olayını kurar.
func (w *waiter) showChat(now time.Time) {
	w.r.d.UI.RequestChat(w.chat.View(now))
	if t := w.chat.Wake(now); !t.IsZero() && (w.chatC == nil || !t.Equal(w.chatAt)) {
		w.chatAt, w.chatC = t, w.r.d.After(max(t.Sub(now), 0))
	}
}
