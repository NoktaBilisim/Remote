package request

// Bekleme durum makinesi (mimari-protokol §5.1, mimari-e9 §13.3). Saf mantıktır; soket, zaman ve arayüz run.go'da.
//
//	Waiting ──accepted──▶ Accepted ──Ekranımı paylaş──▶ Sharing (/ws/guest; makine biter)
//	   │                     │
//	   │ İptal/kapatma       │ Vazgeç/İptal/kapatma
//	   ▼                     ▼
//	Cancelling ◀─────────────┘   (bu durumda gelen request.accepted YOK SAYILIR, request.decline gönderilir)
//	   │ request.closed
//	   ▼
//	 Done
//
// Her durumda request.closed → Done (Sharing hariç: oturum artık flow'dadır).

// Phase bekleme aşaması.
type Phase int

const (
	PhWaiting Phase = iota
	PhAccepted
	PhCancelling
	PhSharing
	PhDone
)

// EndReason beklemenin neden bittiği.
type EndReason int

const (
	// EndClosed sunucu request.closed gönderdi (süre dolumu, ret, iptal, bağlanamadı).
	EndClosed EndReason = iota
	// EndUserCancel "Talebi iptal et" (forma dönülür).
	EndUserCancel
	// EndWindowClosed pencere kapatıldı (süreç sonlanır, AC-163).
	EndWindowClosed
	// EndDeclined onay ekranında "Vazgeç".
	EndDeclined
	// EndTicketExpired onay 60 sn içinde verilmedi (AC-155).
	EndTicketExpired
)

// UserAction bekleme sırasında kullanıcı eylemi.
type UserAction int

const (
	UserCancel  UserAction = iota // "Talebi iptal et"
	UserClose                     // pencere kapatma
	UserShare                     // "Ekranımı paylaş" (yalnız yerel donanım tıklaması; UI denetler)
	UserDecline                   // "Vazgeç" / onay diyaloğunu kapatma
)

// End beklemenin sonucu.
type End struct {
	Reason EndReason
	Closed *Closed // EndClosed'da ve iptal sonrası sunucu yanıtı geldiyse dolu
}

// Step makinenin bir girdiye karşılığı; boş alanlar "yapılacak yok" demektir.
type Step struct {
	Send   Outbound  // gönderilecek mesaj
	State  *State    // bekleme ekranını güncelle
	Accept *Accepted // onay ekranını göster/güncelle (yeniden bağlanmada yeni ticket)
	Share  *Accepted // /ws/guest'e bu ticket ile bağlan
	End    *End      // bekleme bitti
	// CloseNow soket hemen kapatılır (pencere kapatma: önce mesaj, sonra 1000 — §5.1 kapanış semantiği).
	CloseNow bool
}

// Machine bekleme durum makinesi.
type Machine struct {
	phase    Phase
	accepted *Accepted
	intent   EndReason // Cancelling'e geçiren eylem
}

// Phase güncel aşama.
func (m *Machine) Phase() Phase { return m.phase }

// Ticket onay ekranındaki güncel ticket (yoksa nil).
func (m *Machine) Ticket() *Accepted { return m.accepted }

func (m *Machine) done(e End) Step {
	m.phase = PhDone
	return Step{End: &e}
}

// OnServer sunucu mesajı.
func (m *Machine) OnServer(in Inbound) Step {
	switch v := in.(type) {
	case State:
		if m.phase == PhWaiting {
			return Step{State: &v}
		}
	case Accepted:
		switch m.phase {
		case PhWaiting, PhAccepted:
			m.phase, m.accepted = PhAccepted, &v
			return Step{Accept: &v}
		case PhCancelling:
			// İptal–kabul yarışı (§13.3): kabul yok sayılır, bağlanılmaz; sunucu sırası ne olursa olsun talep CANCELLED.
			return Step{Send: SendDecline}
		}
	case Closed:
		switch m.phase {
		case PhCancelling:
			return m.done(End{Reason: m.intent, Closed: &v})
		case PhWaiting, PhAccepted:
			return m.done(End{Reason: EndClosed, Closed: &v})
		}
	}
	return Step{}
}

// OnUser kullanıcı eylemi.
func (m *Machine) OnUser(a UserAction) Step {
	switch m.phase {
	case PhWaiting:
		switch a {
		case UserCancel:
			m.phase, m.intent = PhCancelling, EndUserCancel
			return Step{Send: SendCancel}
		case UserClose:
			st := m.done(End{Reason: EndWindowClosed})
			st.Send, st.CloseNow = SendCancel, true
			return st
		}
	case PhAccepted:
		switch a {
		case UserShare:
			m.phase = PhSharing
			return Step{Share: m.accepted}
		case UserDecline, UserCancel:
			m.phase, m.intent = PhCancelling, EndDeclined
			return Step{Send: SendDecline}
		case UserClose:
			st := m.done(End{Reason: EndWindowClosed})
			st.Send, st.CloseNow = SendDecline, true
			return st
		}
	case PhCancelling:
		if a == UserClose {
			st := m.done(End{Reason: EndWindowClosed})
			st.CloseNow = true
			return st
		}
	}
	return Step{}
}

// OnTicketExpired onay penceresi (60 sn) doldu.
func (m *Machine) OnTicketExpired() Step {
	if m.phase != PhAccepted {
		return Step{}
	}
	return m.done(End{Reason: EndTicketExpired})
}

// OnCancelTimeout iptal sonrası sunucu yanıtı gelmedi: iptal niyetiyle biter (soket 1000 ile kapanır → sunucu iptal eder).
func (m *Machine) OnCancelTimeout() Step {
	if m.phase != PhCancelling {
		return Step{}
	}
	st := m.done(End{Reason: m.intent})
	st.CloseNow = true
	return st
}
