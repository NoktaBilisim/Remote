package flow

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

func withDefaults(d Deps) Deps {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.ReconnectWindow == 0 {
		d.ReconnectWindow = 120 * time.Second
	}
	if d.ReconnectEvery == 0 {
		d.ReconnectEvery = 2 * time.Second
	}
	return d
}

type phase int

const (
	phLobby phase = iota
	phActive
	phReconnecting
)

type inbound struct {
	conn Conn
	m    signal.Inbound
	err  error
}

type peerEvent struct {
	ice   *signal.Ice
	ctl   *dc.Ctl
	chunk *dc.Chunk
	ok    bool
	state string
	// doneTimeout transfer.DoneWait doldu (fid); zamanlayıcı goroutine'inden döngüye döner.
	doneTimeout string
}

type session struct {
	d        Deps
	techName string

	conn      Conn
	peer      Peer
	phase     phase
	token     string
	ice       []signal.IceServer
	caps      []string
	maxFileMb int

	monitors []signal.Monitor
	monitor  *int
	// window AC-248: 0 değilse yalnız bu pencere paylaşılıyor (monitor nil).
	window   uintptr
	src      rtc.Source
	streamCx context.CancelFunc
	streamDn chan struct{}
	shareErr chan error
	// captureErr son kaynak açma hatası (0.10.2: durum satırında neden kodu).
	captureErr error
	// lastShare bu sokette son gönderilen share.state (AC-234 tekrar sınırı); lastShareAt gönderim anı.
	lastShare   signal.ShareState
	lastShareAt time.Time

	files   *transfer.Manager
	lastPct int64

	in     chan inbound
	peerEv chan peerEvent
	redial chan Conn

	// P7
	gate       *control.Gate
	granted    bool
	ctlReq     control.Requests
	monReq     control.Requests
	pendingMon int
	env        env.State
	envCh      chan env.State
	// preAdmitted talepten doğan oturum: lobi ekranı yerine "Teknisyen bağlanıyor…".
	preAdmitted bool
	// P8c kayıt: bindingPending istek gönderildi, yanıt (issued/error) bekleniyor; bindingDone kayıt alındı.
	bindingPending, bindingDone bool
	bindingChanged              string
	// techLost bir önceki sunucu mesajı control.revoke{reconnect} idi ve kontrol/diyalog kapattı (yalnız bir mesaj yaşar).
	techLost bool
}

func (s *session) run(ctx context.Context, jr *api.JoinResult) Outcome {
	s.in = make(chan inbound, 16)
	s.peerEv = make(chan peerEvent, 256)
	s.redial = make(chan Conn, 1)
	s.shareErr = make(chan error, 1)
	defer s.cleanup()

	conn, err := s.d.Dial(ctx, signal.Credential{Ticket: jr.WsTicket})
	if err != nil {
		return Outcome{Message: msgLost, Failed: true}
	}
	s.attach(ctx, conn)
	if jr.TechnicianName != "" {
		s.techName = jr.TechnicianName
	}
	if s.preAdmitted {
		s.d.UI.Connecting(s.techName)
	} else {
		s.d.UI.Lobby(jr.AdmitCode, s.techName)
	}
	return s.loop(ctx)
}

// loop oturum olay döngüsü: kullanıcı, sunucu, yeniden bağlanma, eş, ortam ve yayın hatası olayları.
func (s *session) loop(ctx context.Context) Outcome {
	for {
		select {
		case <-ctx.Done():
			return Outcome{}
		case ev := <-s.d.Events:
			if out, done := s.onUser(ctx, ev); done {
				return out
			}
		case r := <-s.in:
			if out, done := s.onInbound(ctx, r); done {
				return out
			}
		case c := <-s.redial:
			if c == nil {
				return Outcome{Message: msgLost, Failed: true}
			}
			s.attach(ctx, c)
		case e := <-s.peerEv:
			s.onPeer(ctx, e)
		case st := <-s.envCh:
			s.onEnv(ctx, st)
		case err := <-s.shareErr:
			s.stopStream()
			s.sendStopped(ctx, err)
			s.d.UI.Status(captureStatus(err))
		}
	}
}

// onInbound soketten gelen okuma: sunucu mesajı ya da okuma hatası (kopuş).
func (s *session) onInbound(ctx context.Context, r inbound) (Outcome, bool) {
	if r.conn != s.conn {
		return Outcome{}, false // eski soketin geç gelen okuması
	}
	if r.err == nil {
		return s.onServer(ctx, r.m)
	}
	if s.phase != phActive || s.token == "" || signal.Fatal(r.err) {
		if signal.Fatal(r.err) {
			return Outcome{Message: msgProtocol, Failed: true}, true
		}
		return Outcome{Message: msgLost, Failed: true}, true
	}
	s.startReconnect(ctx)
	return Outcome{}, false
}

// startReconnect AC-24: kabul edilmiş misafir reconnectToken ile 120 sn içinde döner; yeni PeerConnection kurulur.
func (s *session) startReconnect(ctx context.Context) {
	s.closeControl(ctx, "", true) // kopuşta kapı kapanır; sunucu durumu VIEW yapar (AC-24)
	// AC-250 (B-P8c2-4): yanıtı gelmemiş kayıt isteği soketle gitti; yeni soketteki teklif yeni istek doğurur.
	s.bindingPending = false
	s.phase = phReconnecting
	reconnectDeadline := s.d.Now().Add(s.d.ReconnectWindow)
	s.dropPeer()
	s.conn = nil
	s.d.UI.Status(statusReconnecting)
	go s.reconnect(ctx, reconnectDeadline)
}

func (s *session) attach(ctx context.Context, c Conn) {
	s.conn = c
	s.lastShare, s.lastShareAt = signal.ShareState{}, time.Time{} // yeni soket: sunucu durumu yeniden alır
	go func() {
		for {
			m, err := c.Read(ctx)
			select {
			case s.in <- inbound{conn: c, m: m, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
}

func (s *session) reconnect(ctx context.Context, deadline time.Time) {
	for s.d.Now().Before(deadline) {
		c, err := s.d.Dial(ctx, signal.Credential{Reconnect: s.token})
		if err == nil {
			s.redial <- c
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.d.ReconnectEvery):
		}
	}
	s.redial <- nil
}

func (s *session) send(ctx context.Context, m signal.Outbound) {
	if s.conn == nil {
		return // yeniden bağlanırken gönderilemez (file.meta kaybı implementation.md'de)
	}
	_ = s.conn.Send(ctx, m)
}

func (s *session) onUser(ctx context.Context, ev Event) (Outcome, bool) {
	switch ev.Kind {
	case EvEnd:
		s.send(ctx, signal.SessionEnd{T: "session.end"})
		if s.phase == phLobby {
			return Outcome{Message: msgLeft}, true
		}
		return Outcome{Message: msgSelfEnd}, true
	case EvChat:
		b, err := chatMessage(ev.Text, s.d.Now())
		if err != nil || s.peer == nil || s.peer.SendCtl(b) != nil {
			s.d.UI.Status(statusChatFail)
		}
	case EvFileAccept, EvFileReject:
		if s.files == nil {
			return Outcome{}, false
		}
		r, _ := s.files.Decide(ev.FID, ev.Kind == EvFileAccept)
		if r != nil {
			s.d.UI.FileResult(*r)
		}
	case EvControlGrant, EvControlDeny, EvControlClose, EvControlHotkey, EvMonitorAccept, EvMonitorDeny:
		s.onControlUser(ctx, ev)
	case EvFileCancel:
		if s.files != nil {
			if r := s.files.CancelLocal(); r != nil {
				s.d.UI.FileResult(*r)
			}
		}
	}
	return Outcome{}, false
}

// chatMessage misafir chat çerçevesi; gönderimden önce aynı şemayla doğrulanır.
func chatMessage(text string, now time.Time) ([]byte, error) {
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	b, err := json.Marshal(struct {
		T    string `json:"t"`
		ID   string `json:"id"`
		Text string `json:"text"`
		TS   int64  `json:"ts"`
	}{"chat", fmt.Sprintf("g%x", id), text, now.UnixMilli()})
	if err != nil {
		return nil, err
	}
	if _, err := dc.ParseCtl(b); err != nil {
		return nil, errors.New("flow: geçersiz chat mesajı")
	}
	return b, nil
}

func (s *session) cleanup() {
	s.gate.Close()
	s.dropPeer()
	if s.src != nil {
		_ = s.src.Close()
	}
	if s.files != nil {
		s.files.Close()
	}
	if s.conn != nil {
		_ = s.conn.Close()
	}
}
