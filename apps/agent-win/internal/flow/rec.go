package flow

import (
	"context"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P28e oturum kaydı — kaynak (müşteri) tarafı (mimari-p28e r2 §2.1, §6.2, §6.3, §8; S-P28e-2, S-P28e-12). Kaydı konsol
// alır; istemci yalnız rızayı (`rec.consent`), göstergeyi/şeridi (`rec.state`) ve durdurmayı (`rec.revoke`) yürütür.

// RecUI kayıt arayüzü (isteğe bağlı; flow.UI'yi uygulayan Win32 arayüzü ayrıca bunu da uygular). Uygulanmıyorsa
// (gözetimsiz yardımcı, eski arayüz) `rs.cap.rec1` bildirilmez ve kayıt yapılmaz (K-P28e-7: göstergesi çizilemeyen
// kaynakta kayıt yok).
type RecUI interface {
	// WelcomeRec Welcome'ın kayıt kutulu biçimi: w.RecOffered ise aydınlatma metninin altında varsayılan işaretsiz
	// kutu (RecTexts.ConsentLine) çizilir; record kutunun gönderimdeki durumudur (yalnız bellekte).
	WelcomeRec(ctx context.Context, w Welcome) (customerName string, record, ok bool)
	// RecState gösterge, her zaman üstte şerit ve "Kaydı durdur" (engellemez; UI iş parçacığına iletilir).
	RecState(v RecView)
}

// RecView kayıt göstergesinin durumu.
type RecView struct {
	On       bool   // kayıt açık: gösterge + şerit + "Kaydı durdur"
	Stopping bool   // On iken: rec.revoke gönderildi, sunucu onayı bekleniyor (düğme devre dışı)
	Note     string // kapalıyken kısa bilgi satırı (boş olabilir)
}

// recState oturumun kayıt durumu (yalnız akış döngüsünde değişir).
type recState struct {
	consent bool // kutu işaretliydi (Welcome/talep formu); rec.consent ilk hello'da bir kez
	sent    bool
	on      bool
	pending bool // rec.revoke gönderildi/bekliyor, rec.state{off} gelmedi
	paused  bool // S-P28e-2: onay süresi doldu, yayın yerelde duraklatıldı
	gen     int  // zamanlayıcı kuşağı (bayat zamanlayıcı yok sayılır)
}

func recUI(d Deps) RecUI {
	if d.Unattended || d.UI == nil {
		return nil
	}
	r, _ := d.UI.(RecUI)
	return r
}

// recEnabled `rs.cap.rec1` bildirildi mi (Features ile aynı kural).
func (s *session) recEnabled() bool { return recUI(s.d) != nil }

func (s *session) recAckWait() time.Duration {
	if s.d.RecAckWait > 0 {
		return s.d.RecAckWait
	}
	return signal.RecRevokeAckMs * time.Millisecond
}

// recOnHello hello'nun İLK işi (gönderim sırası): ilk hello'da işaretliyse bir kez `rec.consent` (paylaşım seçimi
// engelleyen bir UI çağrısı olduğundan ondan önce; sunucu 30 sn penceresi), yeniden bağlanmada bekleyen `rec.revoke`
// (S-P28e-2: hello sonrası ilk mesaj). Ardından hello.rec uygulanır; yeniden bağlanmada alan yoksa kayıt yok sayılır.
// Yayın burada başlatılmaz (onHello sonunda beginShare).
func (s *session) recOnHello(ctx context.Context, h signal.Hello, first bool) {
	if !s.recEnabled() {
		return
	}
	if first && s.rec.consent && !s.rec.sent {
		s.rec.sent = true
		s.send(ctx, signal.RecConsent{T: "rec.consent", LineSha256: signal.RecConsentLineSHA256})
	}
	if !first && s.rec.pending {
		s.send(ctx, signal.RecRevoke{T: "rec.revoke"})
	}
	switch {
	case h.Rec != nil && *h.Rec.On:
		s.recOn()
	case h.Rec != nil || !first:
		reason := ""
		if h.Rec != nil {
			reason = h.Rec.Reason
		}
		s.recOff(ctx, reason, false)
	}
}

// onRecState `rec.state` (yalnız rec1 sokete gelir; bildirmediysek yok sayılır).
func (s *session) onRecState(ctx context.Context, m signal.RecState) {
	if !s.recEnabled() {
		return
	}
	if *m.On {
		s.recOn()
		return
	}
	s.recOff(ctx, m.Reason, true)
}

func (s *session) recOn() {
	s.rec.on = true
	recUI(s.d).RecState(RecView{On: true, Stopping: s.rec.pending})
}

// recOff kayıt kapandı: gösterge kalkar, bekleyen durdurma biter; duraklatılmış yayın resume ise hemen sürer.
func (s *session) recOff(ctx context.Context, reason string, resume bool) {
	wasOn, wasPaused := s.rec.on || s.rec.pending, s.rec.paused
	s.rec.on, s.rec.pending, s.rec.paused = false, false, false
	s.rec.gen++
	note := recOffNotes[reason]
	if !wasOn && note == "" {
		return // gösterge zaten kapalı (yeniden bağlanma hello'su, kayıtsız oturum)
	}
	recUI(s.d).RecState(RecView{Note: note})
	if wasPaused {
		s.d.UI.Status(note)
		if resume && s.phase == phActive && s.peer != nil && s.src != nil {
			s.startStream(ctx)
		}
	}
}

// onRecStop "Kaydı durdur" (şerit ya da oturum penceresi; onaysız, geri alınamaz). Soket yoksa revoke bekler ve
// yeniden bağlanınca ilk mesaj olur; her durumda RecAckWait sonra `off` yoksa yayın yerelde duraklar (S-P28e-2).
func (s *session) onRecStop(ctx context.Context) {
	if !s.recEnabled() || !s.rec.on || s.rec.pending {
		return
	}
	s.rec.pending = true
	s.rec.gen++
	gen := s.rec.gen
	s.send(ctx, signal.RecRevoke{T: "rec.revoke"})
	recUI(s.d).RecState(RecView{On: true, Stopping: true})
	time.AfterFunc(s.recAckWait(), func() {
		select {
		case s.peerEv <- peerEvent{run: func() { s.recAckTimeout(gen) }}:
		case <-ctx.Done():
		}
	})
}

// recAckTimeout süre doldu ve hâlâ `off` yok: yakalama döngüsü durur (yeniden bağlanma ve monitör değişimi de
// başlatamaz, startStream), durum satırı açıklar. `off` gelince recOff yayını sürdürür.
func (s *session) recAckTimeout(gen int) {
	if gen != s.rec.gen || !s.rec.pending {
		return
	}
	s.rec.paused = true
	s.stopStream()
	s.d.UI.Status(RecTexts.Paused)
}
