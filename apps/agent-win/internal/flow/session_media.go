package flow

import (
	"context"
	"time"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// firstShare admit sonrası paylaşım seçimi, etkin ekran göstergesi ve yakalama kaynağının açılması.
func (s *session) firstShare(ctx context.Context) (Outcome, bool) {
	if out, done := s.chooseShare(ctx); done {
		return out, true
	}
	s.d.UI.Active(s.techName, s.activeMonitor())
	s.openCapture()
	return Outcome{}, false
}

// chooseShare paylaşılacak monitör ya da pencere. Müşteri seçimden vazgeçerse oturum biter.
func (s *session) chooseShare(ctx context.Context) (Outcome, bool) {
	mons, err := s.d.Monitors()
	if err != nil || len(mons) == 0 {
		return Outcome{}, false
	}
	s.monitors = mons
	id := mons[0].ID
	for _, mo := range mons {
		if mo.Primary {
			id = mo.ID
		}
	}
	// AC-106: tek monitörde sorulmaz; çoklu monitörde varsayılan birincil. AC-248: pencere modu varsa tek
	// monitörde de seçim ekranı açılır ("Tüm ekran / Yalnız bir pencere").
	windows := s.windowMode()
	if len(mons) > 1 || windows {
		c, ok := s.d.UI.ChooseShare(ctx, mons, id, windows)
		if !ok {
			s.send(ctx, signal.SessionEnd{T: "session.end"})
			return Outcome{Message: msgSelfEnd}, true
		}
		if c.Window != 0 && windows {
			s.window = c.Window
		} else {
			id = c.Monitor
		}
	}
	if s.window == 0 {
		s.monitor = &id
	}
	return Outcome{}, false
}

// openCapture seçilen pencere/monitör için yakalama kaynağı; hata captureErr'de kalır (durum satırı, share.state).
func (s *session) openCapture() {
	var src rtc.Source
	var cerr error
	switch {
	case s.window != 0:
		src, cerr = s.d.CaptureWindow(s.window)
	case s.monitor != nil:
		src, cerr = s.d.Capture(*s.monitor)
	}
	if src != nil && cerr == nil {
		s.src = src
	}
	s.captureErr = cerr
}

// beginShare kaynak varsa yayını başlatır ve `share.state{sharing}` gönderir; yoksa `stopped` + durum satırı.
func (s *session) beginShare(ctx context.Context) {
	if s.src == nil {
		s.sendStopped(ctx, s.captureErr)
		s.d.UI.Status(captureStatus(s.captureErr))
		return
	}
	s.startStream(ctx)
	s.sendShare(ctx, "sharing")
}

// windowMode AC-248 pencere modu sunulabilir mi (WGC destekli ve bağımlılıklar bağlı).
func (s *session) windowMode() bool {
	return s.d.WindowCapture != nil && s.d.CaptureWindow != nil && s.d.SetInputWindow != nil && s.d.WindowCapture()
}

func (s *session) activeMonitor() signal.Monitor {
	for _, m := range s.monitors {
		if s.monitor != nil && m.ID == *s.monitor {
			return m
		}
	}
	return signal.Monitor{}
}

func (s *session) sendShare(ctx context.Context, state string) {
	m := signal.ShareState{T: "share.state", State: state}
	switch {
	case state == "sharing" && s.window != 0:
		m.Method = string(capture.MethodWGC) // AC-248: konsolda mod (P15 etiketi); monitör listesi yok (geçiş sunulmaz)
	case state == "sharing":
		m.Monitors, m.ActiveMonitor = s.monitors, s.monitor
	}
	s.sendShareMsg(ctx, m)
}

// shareRepeatWindow AC-234 (mimari-e11 §8.1): aynı neden tekrar ederse bu sürede en çok bir share.state.
const shareRepeatWindow = 5 * time.Second

// sendStopped AC-234: paylaşım başlatılamadı ya da yayında kalıcı hata → hemen (döngüde, beklemesiz) `share.state`
// {stopped, reason, method}. Tipli yakalama hatası yoksa neden OTHER; hata hiç yoksa (monitör yok) alanlar gönderilmez.
func (s *session) sendStopped(ctx context.Context, err error) {
	m := signal.ShareState{T: "share.state", State: "stopped"}
	m.Reason, m.Method = shareFailure(err)
	s.sendShareMsg(ctx, m)
}

// shareFailure hatanın `share.state` neden kodu ve yöntemi. Neden yalnız sabit küme (capture.Reason); HRESULT/işlem
// adı gönderilmez (kişisel veri yok, contracts deseni).
func shareFailure(err error) (reason, method string) {
	if err == nil {
		return "", ""
	}
	e, ok := capture.AsError(err)
	if !ok || e.Reason == "" {
		return string(capture.ReasonOther), ""
	}
	return string(e.Reason), e.ShareMethod()
}

// sendShareMsg aynı soketteki son durumla birebir aynı "stopped" mesajı 5 sn içinde tekrar gönderilmez (durum
// değişimi — sharing ↔ stopped ya da farklı neden — her zaman gider).
func (s *session) sendShareMsg(ctx context.Context, m signal.ShareState) {
	if s.conn == nil {
		return
	}
	now := s.d.Now()
	if m.State == "stopped" && s.lastShare.State == "stopped" && s.lastShare.Reason == m.Reason &&
		s.lastShare.Method == m.Method && now.Sub(s.lastShareAt) < shareRepeatWindow {
		return
	}
	s.lastShare, s.lastShareAt = m, now
	s.send(ctx, m)
}

func (s *session) startStream(ctx context.Context) {
	s.stopStream()
	if s.rec.paused || s.d.Media == nil { // P28e S-P28e-2: kayıt durdurulamadı → `off` gelene kadar görüntü gönderilmez
		return
	}
	cx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	s.streamCx, s.streamDn = cancel, done
	m, src := s.d.Media, s.src
	go func() {
		defer close(done)
		err := m.Stream(cx, src) // P28c: yayın eşten bağımsız (ana/düşük iz; eş kapanınca durmaz)
		if err != nil && cx.Err() == nil {
			select {
			case s.shareErr <- err:
			default:
			}
		}
	}()
}

// stopStream yayını durdurur ve goroutine'in kaynaktan çıkmasını bekler (kaynak tek okuyuculu).
func (s *session) stopStream() {
	if s.streamCx != nil {
		s.streamCx()
		<-s.streamDn
		s.streamCx, s.streamDn = nil, nil
	}
}

// dropPeers yayını durdurur ve tüm eşleri kapatır (yeniden bağlanma, yeni hello, oturum sonu).
func (s *session) dropPeers() {
	s.stopStream()
	for tid, tp := range s.peers {
		s.voicePeerRemoved(tid)
		_ = tp.p.Close()
		delete(s.peers, tid)
	}
	s.updateLow()
	s.cancelLocalFile()
}

func (s *session) onPeer(ctx context.Context, e peerEvent) {
	if e.run == nil && e.doneTimeout == "" {
		if tp := s.peers[e.tid]; tp == nil || tp.gen != e.gen {
			return // kapatılmış eşin geç olayı
		}
	}
	switch {
	// run/doneTimeout eşe bağlı değildir (tid ""): tid süzgecinden ÖNCE (P28d düzeltmesi — multi kipinde kontrol sahibi
	// tid'i dolu olduğundan aşağıdaki `e.tid != s.ctrlTid()` dalı bunları yutuyordu).
	case e.run != nil:
		e.run()
	case e.doneTimeout != "":
		if s.files == nil {
			return
		}
		if r := s.files.DoneTimeout(e.doneTimeout); r != nil {
			s.d.UI.FileResult(*r)
		}
	case e.ice != nil:
		s.send(ctx, *e.ice)
	case (e.state == "failed" || e.state == "closed") && e.tid != "":
		s.closePeer(ctx, e.tid) // P28c: yalnız o eş kapanır; teknisyen yeni offer'la döner
	case e.tid != s.ctrlTid():
		// ikincil eşin durum değişimi kontrol kapısını etkilemez; dosya parçası/ctl aşağıda süzülür
		if e.ctl != nil {
			s.onCtl(e.tid, *e.ctl)
		}
	case e.state == "disconnected" || e.state == "failed" || e.state == "closed":
		// PeerConnection kopması kapıyı ve diyalogları kapatır. K6: sunucu bu kopmayı bilmez (WS açık); bekleyen kontrol
		// diyaloğu kapandıysa {VIEW, SYSTEM} ile isteği kapattırır (kapı açıktıysa closeControl zaten gönderdi).
		// Monitör diyaloğu mesajsız kapanır (sunucu 30 sn yedek yoluyla temizler; müşteriye ret atfedilmez).
		if c := s.closeControl(ctx, "SYSTEM", true); c.ctlPrompt && !c.granted {
			s.sendControl(ctx, "VIEW", "SYSTEM")
		}
	case e.chunk != nil:
		s.onChunk(*e.chunk, e.ok)
	case e.ctl != nil:
		s.onCtl(e.tid, *e.ctl)
	}
}

// onChunk dosya parçası: alım sonucu ya da (yüzde değiştikçe) ilerleme.
func (s *session) onChunk(c dc.Chunk, ok bool) {
	if s.cp.chunk(c, ok) || s.files == nil || s.serverMode() { // P28b: SERVER'da `file` çerçeveleri düşer // P28a: yazdırmanın idx'i dosya alıcısına gitmez (O-P28a-2 m.3)
		return
	}
	if r := s.files.Chunk(c, ok); r != nil {
		s.d.UI.FileResult(*r)
		return
	}
	if done, total, ok := s.files.Progress(); ok && total > 0 {
		if pct := done * 100 / total; pct != s.lastPct {
			s.lastPct = pct
			s.d.UI.FileProgress(done, total)
		}
	}
}

// onCtl doğrulanmış ctl; P28c §4.5 misafir kapısı: kontrol sahibi olmayan eşten yalnız sohbet (izleyici değilse) ve
// ping; dosya teklifi o eşe reddedilir.
func (s *session) onCtl(tid string, m dc.Ctl) {
	if !s.ctlAllowed(tid, m.T) {
		if tp := s.peers[tid]; m.T == "file.offer" && tp != nil {
			if b, err := dc.FileReply("file.reject", m.FID); err == nil {
				_ = tp.p.SendCtl(b)
			}
		}
		return
	}
	switch m.T {
	case "chat":
		s.onTechChat(tid, m)
	case "annot.stroke", "annot.laser", "annot.undo", "annot.clear":
		s.d.UI.Annot(m)
	case "clip.ready", "clip.data", "print.ready", "print.offer", "print.done":
		s.cp.onCtl(m)
	case "file.offer":
		if s.serverMode() || !s.cp.fileIdx(*m.Idx) { // P28b: SERVER'da DC dosyası yok; P28a: etkin yazdırmanın idx'i
			if b, err := dc.FileReply("file.reject", m.FID); err == nil && s.mainPeer() != nil {
				_ = s.mainPeer().SendCtl(b)
			}
			return
		}
		if p := s.files.Offer(m); p != nil {
			s.lastPct = -1
			s.d.UI.FileOffer(*p)
		}
	case "file.cancel":
		pending := s.files.Pending()
		if r := s.files.Cancel(m.FID); r != nil {
			if pending == m.FID {
				s.d.UI.FileOfferWithdrawn(m.FID)
			}
			s.d.UI.FileResult(*r)
		}
	case "file.done":
		if r := s.files.Done(m.FID); r != nil {
			s.d.UI.FileResult(*r)
		}
	}
}
