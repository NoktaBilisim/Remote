// Package flow istemcinin oturum akışıdır (mimari §10.2 P6; mimari-protokol §3.1): kod (dosya adı veya elle) →
// resolve → karşılama/KVKK → join → lobi (admitCode) → admit (`hello`) → monitör seçimi + paylaşım → `session.ended`.
// Platformdan bağımsızdır: arayüz (Win32), WS, WebRTC ve ekran yakalama arayüzlerle bağlanır; Linux'ta sahtelerle test edilir.
package flow

import (
	"context"
	"image"
	"time"

	"remote-support/agent-win/internal/api"
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
	// CheckDir P27: nil değilse her dosya yazımından önce DownloadDir'in gerçek yolu denetlenir (transfer.Deps.CheckDir).
	CheckDir func() error
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
	// Unattended P27 (mimari-p27 §5.6): gözetimsiz yardımcı. control.request kullanıcıya sorulmadan GRANTED{UNATTENDED}
	// ile kabul edilir; kapatma kısayolu gerekmez (yerel anahtar geçerlidir). Yalnız internal/unattended/helper açar.
	Unattended bool
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

// admitStage kod → resolve → karşılama → join. ok=false ise out son ekrandır.
func admitStage(ctx context.Context, d Deps, initial string) (*api.JoinResult, *api.ResolveResult, Outcome, bool) {
	code, notice, welcomeNotice := initial, "", ""
	for {
		if code == "" {
			c, ok := askCode(ctx, d, notice)
			if !ok {
				return nil, nil, Outcome{}, false
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
		name, ok := d.UI.Welcome(ctx, welcomeData(ctx, d, res, welcomeNotice))
		if !ok {
			return nil, nil, Outcome{}, false
		}
		// AC-98: onaysız bağlantı başlamaz — UI yalnız onay kutusu işaretliyken ok döner.
		jr, err := d.API.Join(ctx, api.JoinRequest{JoinNonce: res.JoinNonce, CustomerName: name,
			ConsentTextID: res.ConsentText.ID, ConsentAccepted: true})
		if err == nil {
			return jr, res, Outcome{}, true
		}
		m, o := classify(err)
		switch o {
		case outRetryNonce:
			welcomeNotice = statusNonce
			continue // aynı kodla yeniden çöz
		case outFinal:
			return nil, nil, Outcome{Message: m}, false
		}
		code, notice = "", m.Title+". "+m.Body
	}
}

// askCode elle kod girişi (AC-97); geçersiz biçimde uyarıyla yeniden sorar. ok=false: kullanıcı vazgeçti.
func askCode(ctx context.Context, d Deps, notice string) (string, bool) {
	for {
		raw, ok := d.UI.AskCode(ctx, notice)
		if !ok {
			return "", false
		}
		c, valid := pairing.Normalize(raw)
		if valid {
			return c, true
		}
		notice = "Kod 8 rakamdan oluşmalıdır."
	}
}

// welcomeData karşılama/KVKK ekranı verisi (AC-98).
func welcomeData(ctx context.Context, d Deps, res *api.ResolveResult, notice string) Welcome {
	abuse := ""
	if res.AbuseEmail != nil && api.ValidAbuseEmail(*res.AbuseEmail) { // S6-7: geçersizse bağlantı gizlenir
		abuse = *res.AbuseEmail
	}
	return Welcome{
		Host: d.Host, Version: d.Version, Fingerprint: d.Fingerprint,
		Tenant: res.Tenant.Name, TechName: res.Technician.Name, TechVerifyCode: res.TechVerifyCode,
		ConsentVersion: res.ConsentText.Version, ConsentBody: res.ConsentText.Body, AbuseEmail: abuse,
		Notice: notice, Logo: tenantLogo(ctx, d, res.Tenant.LogoURL), RememberNote: rememberNote(d, res.Tenant.Name),
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
