package launch

import (
	"context"
	"errors"
	"net/url"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/pairing"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// API istemcinin public uçları (api.Client).
type API interface {
	flow.API
	request.API
	RevokeBinding(ctx context.Context, key string) error
}

// Store kayıt dosyası (remember.Store, `kayitlar.bin` v3; mimari-e11 §8d.1).
type Store interface {
	request.Remember
	Load() (remember.Data, bool)
	LoadState() remember.LoadResult
	SaveBinding(b remember.Binding, replaceKey string) error
	RemoveBinding(key string) error
	TouchBinding(key string, t time.Time) error
	SetPrefs(p remember.Prefs) error
	ForgetAll() error
}

// Deps açılışın bağımlılıkları. Flow ve Request, API/Binding/kaynak alanları dışında doldurulmuş gelir.
type Deps struct {
	Exe       string
	ServerURL *url.URL
	API       API
	Store     Store // nil olabilir (LocalAppData yok): kayıt ve hatırlama kapalı
	Flow      flow.Deps
	Request   request.Deps
	Now       func() time.Time
	// Home tek ana ekran (firma listesi; zorunlu — nil ise ana ekran açılmaz, sonuç boş döner).
	Home HomeUI
	// Autostart "Windows açılışında başlat" (internal/autorun); nil ise Windows'ta autorun.New(), başka yerde kapalı.
	Autostart Autostart
	// Startup açılıştaki remember.Migrate() sonucu (K5 main.go'da bir kez çağırır); nil ise Store.LoadState().
	Startup *remember.MigrateResult
	// Diag kişisel veri içermeyen tanılama olayı (`store_write_failed{class}`); nil olabilir.
	Diag func(event, class string)
}

// Run açılış kararını verir ve seçilen akışı yürütür; dönen sonucun Message'ı son ekrandır (boşsa son ekran yok).
func Run(ctx context.Context, d Deps) flow.Outcome {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.Autostart == nil {
		d.Autostart = defaultAutostart()
	}
	obs := &observedAPI{API: d.API}
	d.API = obs
	server, serverOK := remember.CanonicalOrigin(d.ServerURL.String())
	st := d.startState()
	notes := d.startupNotes(st)
	if d.Store != nil && serverOK {
		k := newKeeper(d.Store, server, d.Now)
		k.diag, k.tenant = d.Diag, obs.lastTenant
		d.Flow.Binding = k
		obs.touch = func(key string) {
			if err := d.Store.TouchBinding(key, d.Now()); err != nil && d.Diag != nil {
				d.Diag(eventStoreFailure, remember.ErrorClass(err))
			}
		}
	}
	if !serverOK {
		server = ""
	}
	d.Flow.API = d.API
	in := Input{Bindings: len(st.Data.ForOrigin(server))}
	var info *api.TenantRequestInfo
	var infoErr error
	ref, isRef := pairing.RefFromFileName(d.Exe)
	code, isCode := pairing.FromFileName(d.Exe)
	switch {
	case isRef:
		in.File = FileRef
		info, infoErr = d.API.TenantInfo(ctx, ref)
		in.Net = refNet(infoErr)
	case isCode:
		in.File = FileCode
		res, err := d.API.Resolve(ctx, code)
		in.Net = codeNet(err)
		if in.Net == NetGone {
			m := flow.ResolveMessage(err)
			in.GoneMessage = m.Title + ". " + m.Body
		}
		d.Flow.API = &onceResolve{API: d.API, code: code, res: res, err: err}
	}
	dec := Decide(in)
	if ctx.Err() != nil {
		return flow.Outcome{}
	}
	if dec.Screen == ScreenCode {
		return flow.Run(ctx, d.Flow, code)
	}
	if d.Home == nil {
		return flow.Outcome{}
	}
	var file *fileFirm
	if dec.FileRow {
		file = &fileFirm{ref: ref, info: info, err: infoErr}
	}
	return d.firmHome(ctx, server, file, joinNotes(append([]string{dec.Notice}, notes...)))
}

// startState açılış okuma durumu (K5 Migrate sonucunu verirse o, değilse LoadState). Depo yoksa kayıtsız.
func (d Deps) startState() remember.MigrateResult {
	switch {
	case d.Startup != nil:
		return *d.Startup
	case d.Store != nil:
		return remember.MigrateResult{LoadResult: d.Store.LoadState()}
	}
	return remember.MigrateResult{}
}

// baseRequest talep modunun ortak alanları.
func (d Deps) baseRequest() request.Deps {
	rd := d.Request
	rd.API, rd.ServerURL = d.API, d.ServerURL
	rd.BindingEnabled = d.Flow.Binding != nil // AC-188 satırı yalnız kayıt alınabiliyorsa
	if d.Store != nil {
		rd.Remember = d.Store
	}
	return rd
}

// runRequest talep modu → kod akışı ya da talepten doğan oturum (P8b-2 sırası aynen). back=true: talep ana ekrana
// döner (AC-185 kayıt geçersiz; note bilgi satırı).
func (d Deps) runRequest(ctx context.Context, rd request.Deps) (flow.Outcome, bool, string) {
	res := request.Run(ctx, rd)
	switch res.Kind {
	case request.OutBack:
		return flow.Outcome{}, true, res.Notice
	case request.OutCodeMode: // AC-162, AC-189: "Bağlantı kodum var" → 8 hane girişi + lobi
		d.Flow.API = d.API
		return flow.Run(ctx, d.Flow, ""), false, ""
	case request.OutShare:
		fd := d.Flow
		fd.Admitted = func() { res.Release(request.ReleaseAdmitted) }
		out := flow.RunTicket(ctx, fd, res.Ticket, res.TechName, res.AdmitCode)
		// hello geldiyse no-op (bir kez çalışır). Gelmediyse: ağ/protokol hatası → 1001 (sunucu CONNECT_FAILED);
		// müşteri vazgeçti/sunucu bitirdi → 1000/REST (mimari-protokol §5.1, mimari-e9 §13.3).
		kind := request.ReleaseAbandoned
		if out.Failed {
			kind = request.ReleaseFailed
		}
		res.Release(kind)
		return out, false, ""
	}
	return flow.Outcome{}, false, "" // AC-163: pencere kapatıldı
}

func apiErr(err error) (*api.Error, bool) {
	var ae *api.Error
	ok := errors.As(err, &ae)
	return ae, ok
}

// codeNet resolve sonucu: 404/410 ve SESSION_EXPIRED/CANCELLED/CONSUMED "artık geçersiz kod" (satır 2–3).
func codeNet(err error) NetResult {
	if err == nil {
		return NetOK
	}
	if ae, ok := apiErr(err); ok {
		switch ae.Code {
		case "SESSION_EXPIRED", "SESSION_CANCELLED", "SESSION_CONSUMED":
			return NetGone
		}
		if ae.Status == 404 || ae.Status == 410 {
			return NetGone
		}
	}
	return NetError
}

// refNet firma bilgisi sonucu: 404 REQUEST_REF_INVALID (tek tip) satır 5–6.
func refNet(err error) NetResult {
	if err == nil {
		return NetOK
	}
	if ae, ok := apiErr(err); ok && (ae.Code == "REQUEST_REF_INVALID" || ae.Status == 404) {
		return NetGone
	}
	return NetError
}

// onceResolve launch'ın yaptığı ilk resolve'u kod akışına bir kez verir (aynı istek tekrarlanmaz; resolve kovası).
type onceResolve struct {
	flow.API
	code string
	res  *api.ResolveResult
	err  error
	used bool
}

func (o *onceResolve) Resolve(ctx context.Context, code string) (*api.ResolveResult, error) {
	if !o.used && code == o.code {
		o.used = true
		return o.res, o.err
	}
	return o.API.Resolve(ctx, code)
}
