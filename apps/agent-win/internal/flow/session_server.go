package flow

import (
	"context"
	"slices"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

func (s *session) onServer(ctx context.Context, m signal.Inbound) (Outcome, bool) {
	lost := s.techLost
	s.techLost = false
	switch m := m.(type) {
	case signal.LobbyWait:
		// Lobi ekranı join sonrası zaten gösterildi; expiresAt yalnız bilgi.
	case signal.Hello:
		return s.onHello(ctx, m)
	case signal.SdpOffer, signal.RemoteIce, signal.IceServers, signal.IceRestart:
		s.onSignaling(ctx, m)
	case signal.PeerLeft, signal.PeerJoined:
		s.onPresence(ctx, m, lost)
	case signal.SessionWarning:
		s.d.UI.Status(statusWarn5min)
	case signal.SessionEnded:
		s.gate.Close()
		return Outcome{Message: endedMessage(m.Reason)}, true
	case signal.ControlRequest, signal.MonitorRequest, signal.ControlRevoke, signal.ControlRelease, signal.ControlCancel,
		signal.CapsUpdate:
		s.onControlServer(ctx, m)
	case signal.BindingOffer, signal.BindingIssued:
		s.onBinding(ctx, m)
	case signal.ClipConsent, signal.ClipPush, signal.ClipPull, signal.PrintRequest, signal.PrintCancel:
		s.cp.onServer(m)
	case signal.FsrvUpload, signal.FsrvStatus, signal.FsrvOffer, signal.FsrvDownload:
		s.onFsrv(ctx, m)
	case signal.ErrorMsg:
		s.onError(m)
	case signal.RecState:
		s.onRecState(ctx, m)
	}
	return Outcome{}, false
}

// onSignaling WebRTC sinyal mesajları: teknisyenin offer'ı, karşı ICE adayı, ICE sunucuları, ICE yeniden başlatma.
func (s *session) onSignaling(ctx context.Context, m signal.Inbound) {
	switch m := m.(type) {
	case signal.SdpOffer:
		if s.peer == nil {
			return
		}
		ans, err := s.peer.HandleOffer(m.SDP)
		if err == nil {
			s.send(ctx, ans)
		}
	case signal.RemoteIce:
		if s.peer != nil {
			_ = s.peer.AddRemoteICE(m)
		}
	case signal.IceServers:
		s.ice = m.IceServers
		if s.peer != nil {
			_ = s.peer.SetICEServers(m.IceServers)
		}
	case signal.IceRestart:
		// Teknisyen ardından iceRestart'lı yeni offer gönderir; answer HandleOffer'da üretilir.
	}
}

// onPresence peer.left/peer.joined; lost önceki mesaj control.revoke{reconnect} ise metni ezmemek içindir.
func (s *session) onPresence(ctx context.Context, m signal.Inbound, lost bool) {
	switch m := m.(type) {
	case signal.PeerLeft:
		if m.Role == "tech" {
			s.techChanged(ctx, lost, statusTechLeft)
		}
	case signal.PeerJoined:
		if m.Role == "tech" {
			s.techChanged(ctx, lost, statusTechBack)
		}
		if m.MaxFileMb != nil {
			s.maxFileMb = *m.MaxFileMb
		}
	}
}

// onError `error`: bekleyen kayıt isteğinin reddi oturumu etkilemez ve gösterilmez; diğerleri durum satırında.
func (s *session) onError(m signal.ErrorMsg) {
	if s.bindingPending && slices.Contains(bindingErrorCodes, m.Code) { // kayıt reddi: oturum sürer, gösterilmez
		s.bindingPending = false
		if m.Code == "BINDING_LIMIT" { // P20: 5 firma dolu — yeni teklife istek yok, oturum sonu bilgisi
			s.bindingDone = true
			s.bindingChanged = s.d.Binding.Limited()
		}
		return
	}
	s.d.UI.Status(m.Message)
}

// onHello admit (ilk) veya yeniden bağlanma (sonraki) — her ikisinde yeni PeerConnection (AC-24).
func (s *session) onHello(ctx context.Context, h signal.Hello) (Outcome, bool) {
	first := s.phase == phLobby
	s.recOnHello(ctx, h, first) // P28e: hello sonrası ilk mesaj (rec.consent / bekleyen rec.revoke)
	if first && s.d.Admitted != nil {
		s.d.Admitted()
	}
	s.closeControl(ctx, "", true) // AC-24: her yeni PeerConnection kapı kapalı başlar
	s.cp.reset()                  // P28a: yeni soket — önceki bekleyen kimlikler geçersiz
	s.helloEnv(ctx)               // K8: hello'dan hemen sonra tek env.state (monitör seçimi beklenmez)
	s.applyHello(h)
	s.fixFileMode(h) // P28b: capsChanged'dan önce (SERVER modunda yazdırma `print` caps'ine bakmaz)
	s.flushFsrvCancels(ctx)
	s.cp.capsChanged()
	s.dropPeer()
	p, err := s.d.NewPeer(s.ice, s.caps, s.handlers(ctx))
	if err != nil {
		return Outcome{Message: msgError}, true
	}
	s.peer = p
	if s.files == nil {
		if out, done := s.initFiles(ctx); done {
			return out, true
		}
	}
	if first {
		if out, done := s.firstShare(ctx); done {
			return out, true
		}
	} else {
		s.d.UI.Status(statusReconnected)
	}
	s.phase = phActive
	s.setInputMonitor()
	s.startEnv(ctx)
	s.beginShare(ctx)
	return Outcome{}, false
}

// applyHello hello'daki oturum parametreleri (yeniden bağlanma belirteci, ICE, yetenekler, dosya sınırı).
func (s *session) applyHello(h signal.Hello) {
	if h.ReconnectToken != "" {
		s.token = h.ReconnectToken
	}
	s.ice, s.caps = h.IceServers, h.Caps
	if h.MaxFileMb != nil {
		s.maxFileMb = *h.MaxFileMb
	}
}

func (s *session) initFiles(ctx context.Context) (Outcome, bool) {
	dir, err := s.d.DownloadDir()
	if err != nil {
		dir = ""
	}
	mb := s.maxFileMb
	if mb == 0 {
		mb = dc.DefaultMaxFileMb
	}
	maxBytes := dc.MaxFileBytes(mb)
	if dir == "" {
		maxBytes = -1 // indirme klasörü yok → her teklif otomatik reddedilir
	}
	s.files = transfer.New(transfer.Deps{
		Dir: dir, MaxBytes: maxBytes,
		SendCtl: func(b []byte) error {
			if s.peer == nil {
				return rtc.ErrNoCtl
			}
			return s.peer.SendCtl(b)
		},
		Meta:     func(m signal.FileMeta) { s.send(ctx, m) },
		MOTW:     s.d.MOTW,
		CheckDir: s.d.CheckDir,
		Now:      s.d.Now,
		After: func(d time.Duration, fid string) func() bool {
			return time.AfterFunc(d, func() {
				select {
				case s.peerEv <- peerEvent{doneTimeout: fid}:
				case <-ctx.Done():
				}
			}).Stop
		},
	})
	return Outcome{}, false
}
