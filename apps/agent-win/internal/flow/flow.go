// Package flow istemcinin oturum akışıdır (mimari §10.2 P6; mimari-protokol §3.1): kod (dosya adı veya elle) →
// resolve → karşılama/KVKK → join → lobi (admitCode) → admit (`hello`) → monitör seçimi + paylaşım → `session.ended`.
// Platformdan bağımsızdır: arayüz (Win32), WS, WebRTC ve ekran yakalama arayüzlerle bağlanır; Linux'ta sahtelerle test edilir.
package flow

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"slices"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/pairing"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// API resolve/join (internal/api.Client).
type API interface {
	Resolve(ctx context.Context, code string) (*api.ResolveResult, error)
	Join(ctx context.Context, req api.JoinRequest) (*api.JoinResult, error)
}

// Conn WS sinyal bağlantısı (internal/signal.Conn).
type Conn interface {
	Read(ctx context.Context) (signal.Inbound, error)
	Send(ctx context.Context, m signal.Outbound) error
	Close() error
}

// Peer WebRTC eşi (internal/rtc.Peer).
type Peer interface {
	HandleOffer(sdp string) (signal.SdpAnswer, error)
	AddRemoteICE(m signal.RemoteIce) error
	SetICEServers(list []signal.IceServer) error
	SendCtl(b []byte) error
	SetCaps(caps []string)
	Stream(ctx context.Context, src rtc.Source) error
	Close() error
}

// Welcome karşılama + KVKK ekranı verisi (AC-98, AC-125, AC-128).
type Welcome struct {
	Host, Version, Fingerprint       string
	Tenant, TechName, TechVerifyCode string
	ConsentVersion                   int
	ConsentBody                      string
	AbuseEmail                       string // boşsa "Kötüye kullanımı bildir" gizlenir
	Notice                           string
	// Logo firma logosu (QA-P6-1); nil ise arayüz gömülü sistem logosunu (Nokta) gösterir.
	Logo image.Image
	// RememberNote AC-188 bilgi satırı ("Oturumdan sonra bu bilgisayar … için hatırlanır"); kayıt kapalıysa boş.
	RememberNote string
}

// BindingHandler P8c (ADR-0017, mimari-e10 §8.4): bilgisayar kaydının alınması. Uygulaması internal/launch'tadır.
// P20 (mimari-e11 §8d.2, AC-254): çoklu firma kaydı; dönen metinler oturum sonu bilgi satırıdır (tam cümle).
type BindingHandler interface {
	// Request teklife verilecek `binding.request`. multi `binding.offer.multi`; ok=false ise istek gönderilmez (eski
	// sunucuda 5 yuva dolu, üçüncü köken, kayıt dosyası okunamadı) ve note (boş olabilir) oturum sonunda gösterilir.
	// Anahtarlar YALNIZ gömülü sunucunun kanonik kökenindendir (T43).
	Request(multi bool) (req signal.BindingRequest, note string, ok bool)
	// Issued anahtarı DPAPI dosyasına yazar (oturum etkilenmez); oturum sonu bilgisi döner (yeni yuva, ad değişimi,
	// "Kayıt bu bilgisayara yazılamadı"), yoksa "".
	Issued(m signal.BindingIssued) string
	// Limited `error BINDING_LIMIT` (yalnız `full` isteğe): oturum sürer, oturum sonu bilgisi döner.
	Limited() string
}

// UI akışın arayüzden beklediği işlemler. Engelleyen çağrılar (AskCode, Welcome, ChooseShare) yalnız oturum
// öncesi/başında kullanılır; oturum sırasındaki çağrılar engellemez (UI iş parçacığına iletilir).
type UI interface {
	AskCode(ctx context.Context, notice string) (code string, ok bool)
	Welcome(ctx context.Context, w Welcome) (customerName string, ok bool)
	Lobby(admitCode, techName string)
	// Connecting P8b-2: talepten doğan oturumda lobi yok (ön-kabul); "Teknisyen bağlanıyor…" gösterilir.
	Connecting(techName string)
	// ChooseShare AC-106/AC-248: paylaşılacak monitör ya da (windows true ise) "Yalnız bir pencere" seçimi.
	ChooseShare(ctx context.Context, mons []signal.Monitor, def int, windows bool) (c ShareChoice, ok bool)
	Active(techName string, mon signal.Monitor)
	Status(msg string)
	Chat(text string)
	Annot(m dc.Ctl)
	FileOffer(p transfer.Prompt)
	FileOfferWithdrawn(fid string)
	FileProgress(done, total int64)
	FileResult(r transfer.Result)
	Ended(m Message)
	// P7: kontrol/monitör izin diyalogları (G-03 kuralları UI'da), kapanışları ve kontrol durumu göstergesi.
	ControlRequest(p ControlPrompt)
	MonitorRequest(mon signal.Monitor)
	ControlPromptClosed() // kontrol izni diyaloğu karar verilmeden kapanır
	MonitorPromptClosed() // monitör izni diyaloğu karar verilmeden kapanır
	ControlState(granted bool, hotkey string)
	MonitorChanged(mon signal.Monitor)
}

// ShareChoice paylaşım seçimi: Window 0 değilse yalnız o pencere (AC-248, WGC), değilse Monitor.
type ShareChoice struct {
	Monitor int
	Window  uintptr
}

// EventKind kullanıcıdan akışa gelen olay.
type EventKind int

const (
	EvEnd        EventKind = iota // "Oturumu bitir" / lobide "Vazgeç" / pencere kapatma
	EvChat                        // Text
	EvFileAccept                  // FID
	EvFileReject                  // FID
	EvFileCancel                  // süren alımı iptal
	// P7. EvControlGrant yalnız yerel, enjekte olmayan, 1,5 sn sonraki tıklama/Alt+İ ile üretilir (UI denetler).
	EvControlGrant
	EvControlDeny
	EvControlClose  // "Kontrolü kapat" (UI kapıyı zaten kapattı)
	EvControlHotkey // global kısayol (input.Host kapıyı zaten kapattı)
	EvMonitorAccept // Monitor
	EvMonitorDeny
)

// Event kullanıcı olayı.
type Event struct {
	Kind    EventKind
	Text    string
	FID     string
	Monitor int
}

// Deps akışın bağımlılıkları.
type Deps struct {
	Host, Version, Fingerprint string
	API                        API
	Dial                       func(ctx context.Context, cred signal.Credential) (Conn, error)
	NewPeer                    func(ice []signal.IceServer, caps []string, h rtc.Handlers) (Peer, error)
	Monitors                   func() ([]signal.Monitor, error)
	Capture                    func(monitorID int) (rtc.Source, error)
	DownloadDir                func() (string, error)
	MOTW                       func(path string) error
	// Logo `tenant.logoUrl`'i indirir (api.Client.Logo: yalnız gömülü sunucu kökeni, PNG/JPG, ≤ 2 MB). nil olabilir.
	Logo   func(ctx context.Context, logoURL string) (image.Image, error)
	UI     UI
	Events <-chan Event
	// Gate izin kapısı (UI, input.Host ve input.Applier ile paylaşılır); nil ise akış kendi kapısını kurar.
	Gate *control.Gate
	// Hotkey kaydedilen kapatma kısayolu ("Ctrl+Shift+F12" / yedek); boşsa kontrol izni verilemez (G-21).
	Hotkey string
	// Input `input` DC alıcısı (input.Applier.Handle); nil ise kanal kapatılır.
	Input func(raw []byte)
	// SetInputMonitor fare koordinatlarının eşleneceği monitör (AC-49).
	SetInputMonitor func(id int)
	// AC-248 pencere modu: WindowCapture() true ve CaptureWindow/SetInputWindow doluysa paylaşım ekranında
	// "Yalnız bir pencere" sunulur. SetInputWindow girdiyi o pencereye kapsar (S17-1).
	WindowCapture  func() bool
	CaptureWindow  func(hwnd uintptr) (rtc.Source, error)
	SetInputWindow func(hwnd uintptr)
	// EnvProbe AC-105 ortam yoklaması (env.Probe); nil olabilir.
	EnvProbe func() env.State
	// SelfElevated K8 (S7-9): istemci süreci yönetici belirteciyle çalışıyor (açılışta bir kez ölçülür, sabit).
	SelfElevated bool
	Now          func() time.Time
	// ReconnectWindow AC-24: kopuştan sonra yeniden bağlanma süresi (varsayılan 120 sn).
	ReconnectWindow time.Duration
	// ReconnectEvery deneme aralığı (varsayılan 2 sn).
	ReconnectEvery time.Duration
	// Binding P8c: nil ise `binding.offer` yok sayılır (kayıt istenmez) ve AC-188 satırı gösterilmez.
	Binding BindingHandler
	// Admitted P8b-2: ilk `hello` geldiğinde bir kez çağrılır (talep modu `/ws/request`'i 1000 ile ancak bundan sonra
	// kapatır; öncesindeki 1000 sunucuda "vazgeçme" sayılır). nil olabilir.
	Admitted func()
}

// Outcome akışın sonu; Message boşsa kullanıcı pencereyi kapattı (son ekran yok).
type Outcome struct {
	Message Message
	// Failed oturum bağlantı/protokol hatasıyla bitti (kullanıcı kararı veya sunucu son durumu değil). Talep modu bunu
	// hello'dan önce `/ws/request`'i 1001 ile bırakmak için kullanır (CONNECT_FAILED, "vazgeçti" değil).
	Failed bool
	// BindingChanged oturum sonu kayıt bilgisi (tam cümle; P20: BindingHandler'ın döndürdüğü metin); yoksa boş.
	BindingChanged string
}

// Run akışı baştan sona yürütür. initial dosya adından okunan koddur (boşsa elle giriş istenir, AC-97).
func Run(ctx context.Context, d Deps, initial string) Outcome {
	d = withDefaults(d)
	jr, res, out, ok := admitStage(ctx, d, initial)
	if !ok {
		return out
	}
	s := &session{d: d, techName: res.Technician.Name, gate: newGate(d.Gate), pendingMon: -1}
	return s.finish(s.run(ctx, jr))
}

// RunTicket P8b-2 (mimari-protokol §5.2): talepten doğan oturum. Kod/karşılama/join yoktur — müşteri onayı
// ("Ekranımı paylaş") internal/request'te alındı; `/ws/guest`'e talebin ticket'ıyla bağlanılır, sunucu doğrudan `hello`
// gönderir. Sonrası (kontrol izni, dosya, oturum sonu) Run ile aynı yoldur (AC-156).
// P17 (AC-239): admitCode doluysa (tenant "kabul kodu iste" açık) sunucu önce `lobby.wait` gönderir; lobi ekranı kodu
// büyük gösterir, teknisyen kodu konsola girince `hello` gelir. Boşsa eski akış ("Teknisyen bağlanıyor…").
func RunTicket(ctx context.Context, d Deps, ticket, techName, admitCode string) Outcome {
	d = withDefaults(d)
	s := &session{d: d, techName: techName, gate: newGate(d.Gate), pendingMon: -1, preAdmitted: admitCode == ""}
	return s.finish(s.run(ctx, &api.JoinResult{WsTicket: ticket, TechnicianName: techName, AdmitCode: admitCode}))
}

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

// admitStage kod → resolve → karşılama → join. ok=false ise out son ekrandır.
func admitStage(ctx context.Context, d Deps, initial string) (*api.JoinResult, *api.ResolveResult, Outcome, bool) {
	code, notice := initial, ""
	welcomeNotice := ""
	for {
		if code == "" {
			raw, ok := d.UI.AskCode(ctx, notice)
			if !ok {
				return nil, nil, Outcome{}, false
			}
			c, valid := pairing.Normalize(raw)
			if !valid {
				notice = "Kod 8 rakamdan oluşmalıdır."
				continue
			}
			code = c
		}
		res, err := d.API.Resolve(ctx, code)
		if err != nil {
			m, o := classify(err)
			if o == outFinal {
				return nil, nil, Outcome{Message: m}, false
			}
			code, notice = "", m.Title+". "+m.Body
			continue
		}
		abuse := ""
		if res.AbuseEmail != nil && api.ValidAbuseEmail(*res.AbuseEmail) { // S6-7: geçersizse bağlantı gizlenir
			abuse = *res.AbuseEmail
		}
		name, ok := d.UI.Welcome(ctx, Welcome{
			Host: d.Host, Version: d.Version, Fingerprint: d.Fingerprint,
			Tenant: res.Tenant.Name, TechName: res.Technician.Name, TechVerifyCode: res.TechVerifyCode,
			ConsentVersion: res.ConsentText.Version, ConsentBody: res.ConsentText.Body, AbuseEmail: abuse,
			Notice: welcomeNotice, Logo: tenantLogo(ctx, d, res.Tenant.LogoURL), RememberNote: rememberNote(d, res.Tenant.Name),
		})
		if !ok {
			return nil, nil, Outcome{}, false
		}
		// AC-98: onaysız bağlantı başlamaz — UI yalnız onay kutusu işaretliyken ok döner.
		jr, err := d.API.Join(ctx, api.JoinRequest{JoinNonce: res.JoinNonce, CustomerName: name,
			ConsentTextID: res.ConsentText.ID, ConsentAccepted: true})
		if err != nil {
			m, o := classify(err)
			switch o {
			case outRetryNonce:
				welcomeNotice = statusNonce
				continue // aynı kodla yeniden çöz
			case outFinal:
				return nil, nil, Outcome{Message: m}, false
			}
			code, notice = "", m.Title+". "+m.Body
			continue
		}
		return jr, res, Outcome{}, true
	}
}

// logoTimeout karşılamayı geciktirmemek için logo indirme üst süresi; aşılırsa sistem logosu gösterilir.
const logoTimeout = 3 * time.Second

// tenantLogo AC-98: firma logosu; yoksa, indirilemezse veya reddedilirse nil (sistem logosu).
func tenantLogo(ctx context.Context, d Deps, logoURL string) image.Image {
	if logoURL == "" || d.Logo == nil {
		return nil
	}
	lctx, cancel := context.WithTimeout(ctx, logoTimeout)
	defer cancel()
	img, err := d.Logo(lctx, logoURL)
	if err != nil {
		return nil
	}
	return img
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

	var reconnectDeadline time.Time
	for {
		select {
		case <-ctx.Done():
			return Outcome{}
		case ev := <-s.d.Events:
			if out, done := s.onUser(ctx, ev); done {
				return out
			}
		case r := <-s.in:
			if r.conn != s.conn {
				continue // eski soketin geç gelen okuması
			}
			if r.err != nil {
				if s.phase != phActive || s.token == "" || signal.Fatal(r.err) {
					if signal.Fatal(r.err) {
						return Outcome{Message: msgProtocol, Failed: true}
					}
					return Outcome{Message: msgLost, Failed: true}
				}
				// AC-24: kabul edilmiş misafir reconnectToken ile 120 sn içinde döner; yeni PeerConnection kurulur.
				s.closeControl(ctx, "", true) // kopuşta kapı kapanır; sunucu durumu VIEW yapar (AC-24)
				// AC-250 (B-P8c2-4): yanıtı gelmemiş kayıt isteği soketle gitti; yeni soketteki teklif yeni istek doğurur.
				s.bindingPending = false
				s.phase = phReconnecting
				reconnectDeadline = s.d.Now().Add(s.d.ReconnectWindow)
				s.dropPeer()
				s.conn = nil
				s.d.UI.Status(statusReconnecting)
				go s.reconnect(ctx, reconnectDeadline)
				continue
			}
			if out, done := s.onServer(ctx, r.m); done {
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

func (s *session) onServer(ctx context.Context, m signal.Inbound) (Outcome, bool) {
	lost := s.techLost
	s.techLost = false
	switch m := m.(type) {
	case signal.LobbyWait:
		// Lobi ekranı join sonrası zaten gösterildi; expiresAt yalnız bilgi.
	case signal.Hello:
		if out, done := s.onHello(ctx, m); done {
			return out, true
		}
	case signal.SdpOffer:
		if s.peer == nil {
			return Outcome{}, false
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
	case signal.ErrorMsg:
		if s.bindingPending && slices.Contains(bindingErrorCodes, m.Code) { // kayıt reddi: oturum sürer, gösterilmez
			s.bindingPending = false
			if m.Code == "BINDING_LIMIT" { // P20: 5 firma dolu — yeni teklife istek yok, oturum sonu bilgisi
				s.bindingDone = true
				s.bindingChanged = s.d.Binding.Limited()
			}
			return Outcome{}, false
		}
		s.d.UI.Status(m.Message)
	}
	return Outcome{}, false
}

// onHello admit (ilk) veya yeniden bağlanma (sonraki) — her ikisinde yeni PeerConnection (AC-24).
func (s *session) onHello(ctx context.Context, h signal.Hello) (Outcome, bool) {
	first := s.phase == phLobby
	if first && s.d.Admitted != nil {
		s.d.Admitted()
	}
	s.closeControl(ctx, "", true) // AC-24: her yeni PeerConnection kapı kapalı başlar
	s.helloEnv(ctx)               // K8: hello'dan hemen sonra tek env.state (monitör seçimi beklenmez)
	if h.ReconnectToken != "" {
		s.token = h.ReconnectToken
	}
	s.ice, s.caps = h.IceServers, h.Caps
	if h.MaxFileMb != nil {
		s.maxFileMb = *h.MaxFileMb
	}
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
		mons, err := s.d.Monitors()
		if err == nil && len(mons) > 0 {
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
		}
		s.d.UI.Active(s.techName, s.activeMonitor())
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
	} else {
		s.d.UI.Status(statusReconnected)
	}
	s.phase = phActive
	s.setInputMonitor()
	s.startEnv(ctx)
	if s.src == nil {
		s.sendStopped(ctx, s.captureErr)
		s.d.UI.Status(captureStatus(s.captureErr))
		return Outcome{}, false
	}
	s.startStream(ctx)
	s.sendShare(ctx, "sharing")
	return Outcome{}, false
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
		Meta: func(m signal.FileMeta) { s.send(ctx, m) },
		MOTW: s.d.MOTW,
		Now:  s.d.Now,
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
	cx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	s.streamCx, s.streamDn = cancel, done
	p, src := s.peer, s.src
	go func() {
		defer close(done)
		err := p.Stream(cx, src)
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

func (s *session) dropPeer() {
	s.stopStream()
	if s.peer != nil {
		_ = s.peer.Close()
		s.peer = nil
	}
	if s.files != nil {
		if r := s.files.CancelLocal(); r != nil {
			s.d.UI.FileResult(*r)
		}
	}
}

func (s *session) handlers(ctx context.Context) rtc.Handlers {
	push := func(e peerEvent) {
		select {
		case s.peerEv <- e:
		case <-ctx.Done():
		}
	}
	return rtc.Handlers{
		LocalICE:  func(m signal.Ice) { push(peerEvent{ice: &m}) },
		Ctl:       func(m dc.Ctl) { push(peerEvent{ctl: &m}) },
		FileChunk: func(c dc.Chunk, ok bool) { push(peerEvent{chunk: &c, ok: ok}) },
		State:     func(st string) { push(peerEvent{state: st}) },
		Input:     s.d.Input,
	}
}

func (s *session) onPeer(ctx context.Context, e peerEvent) {
	switch {
	case e.ice != nil:
		s.send(ctx, *e.ice)
	case e.state == "disconnected" || e.state == "failed" || e.state == "closed":
		// PeerConnection kopması kapıyı ve diyalogları kapatır. K6: sunucu bu kopmayı bilmez (WS açık); bekleyen kontrol
		// diyaloğu kapandıysa {VIEW, SYSTEM} ile isteği kapattırır (kapı açıktıysa closeControl zaten gönderdi).
		// Monitör diyaloğu mesajsız kapanır (sunucu 30 sn yedek yoluyla temizler; müşteriye ret atfedilmez).
		if c := s.closeControl(ctx, "SYSTEM", true); c.ctlPrompt && !c.granted {
			s.sendControl(ctx, "VIEW", "SYSTEM")
		}
	case e.chunk != nil:
		if s.files == nil {
			return
		}
		if r := s.files.Chunk(*e.chunk, e.ok); r != nil {
			s.d.UI.FileResult(*r)
			return
		}
		if done, total, ok := s.files.Progress(); ok && total > 0 {
			if pct := done * 100 / total; pct != s.lastPct {
				s.lastPct = pct
				s.d.UI.FileProgress(done, total)
			}
		}
	case e.ctl != nil:
		s.onCtl(*e.ctl)
	case e.doneTimeout != "":
		if s.files == nil {
			return
		}
		if r := s.files.DoneTimeout(e.doneTimeout); r != nil {
			s.d.UI.FileResult(*r)
		}
	}
}

func (s *session) onCtl(m dc.Ctl) {
	switch m.T {
	case "chat":
		s.d.UI.Chat(m.Text)
	case "annot.stroke", "annot.laser", "annot.undo", "annot.clear":
		s.d.UI.Annot(m)
	case "file.offer":
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
