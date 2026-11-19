package flow

import (
	"context"
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
	// run P28a: zamanlayıcı/goroutine sonucunun döngüde çalışacak kapanışı (clipprint).
	run func()
	// tid/gen P28c: olayı üreten eş (gen eşleşmezse eş kapatılmıştır; olay düşer). run/doneTimeout için boş.
	tid string
	gen uint64
}

type session struct {
	d        Deps
	techName string

	conn Conn
	// peers P28c teknisyen başına eş (tid → eş; eski sokette tek eş ""); multi roster durumu (peers.go).
	peers     map[string]*techPeer
	peerGen   uint64
	multi     multiState
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
	// cp P28a pano + yazdırma (clipprint.go).
	cp *clipPrint
	// P28b: fileMode ilk hello'da sabitlenir (P2P|SERVER); srv yalnız SERVER modunda (files_server.go).
	fileMode string
	srv      *srvFiles
	// rec P28e kayıt rızası/göstergesi/durdurma (rec.go).
	rec recState
	// voice P28d sesli görüşme (voice.go).
	voice voiceState
	// chat P22-G oturum sohbeti (chat.go; yalnız Deps.ChatUI bağlıyken).
	chat *sessionChat
}

func (s *session) run(ctx context.Context, jr *api.JoinResult) Outcome {
	s.in = make(chan inbound, 16)
	s.peerEv = make(chan peerEvent, 256)
	s.redial = make(chan Conn, 1)
	s.shareErr = make(chan error, 1)
	s.cp = s.newClipPrint(ctx)
	s.chat = newSessionChat()
	s.peers = map[string]*techPeer{}
	s.setCtrl("")
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
	s.voiceDrop(VoiceTexts.Ended) // P28d O-PD-1/V-PD-7: kapıdan hemen sonra; göndericiler susar, mikrofon bırakılır, rıza silinir
	s.cp.reset()                  // P28a O-P28a-1 m.4: bekleyen kimlikler silinir
	s.resetFsrv()                 // P28b: yarım teklif/alım yerelde biter, fid'ler yeni sokette iptal edilir
	s.chatOffline()               // P22-G: yeni sokette chat.state{true} gelene kadar giriş kapalı
	// AC-250 (B-P8c2-4): yanıtı gelmemiş kayıt isteği soketle gitti; yeni soketteki teklif yeni istek doğurur.
	s.bindingPending = false
	s.phase = phReconnecting
	reconnectDeadline := s.d.Now().Add(s.d.ReconnectWindow)
	s.dropPeers()
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
		s.onChatUser(ctx, ev.Text) // P22-G: yalnız WS (chat.send); DC `chat` yok
	case EvTechRemove:
		s.onTechRemove(ctx, ev.TID)
	case EvFileAccept, EvFileReject:
		if s.srv != nil {
			s.onFsrvDecide(ctx, ev.FID, ev.Kind == EvFileAccept)
			return Outcome{}, false
		}
		if s.files == nil {
			return Outcome{}, false
		}
		r, _ := s.files.Decide(ev.FID, ev.Kind == EvFileAccept)
		if r != nil {
			s.d.UI.FileResult(*r)
		}
	case EvControlGrant, EvControlDeny, EvControlClose, EvControlHotkey, EvControlSystem, EvMonitorAccept, EvMonitorDeny:
		s.onControlUser(ctx, ev)
	case EvClipConsent, EvPrintApprove, EvPrintReject:
		s.cp.onUser(ev)
	case EvRecStop:
		s.onRecStop(ctx)
	case EvVoiceAccept, EvVoiceReject, EvVoiceEnd, EvVoiceMute:
		s.onVoiceUser(ctx, ev)
	case EvFileCancel:
		if s.srv != nil {
			s.cancelFsrv(ctx)
		} else if s.files != nil {
			if r := s.files.CancelLocal(); r != nil {
				s.d.UI.FileResult(*r)
			}
		}
	}
	return Outcome{}, false
}

func (s *session) cleanup() {
	s.gate.Close()
	s.voiceDrop("") // P28d D-PD-5: kapıdan hemen sonra mikrofon bırakılır (açılmakta olan da, openVoice)
	s.cp.close()
	s.closeFsrv()
	s.dropPeers()
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
