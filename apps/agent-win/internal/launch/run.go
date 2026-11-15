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

// Store kayıt dosyası (remember.Store, `kayitlar.bin` v3). P20 K2 ara uyarlaması: çoklu firma akışı K3'te.
type Store interface {
	request.Remember
	Load() (remember.Data, bool)
	SaveBinding(b remember.Binding, replaceKey string) error
	RemoveBinding(key string) error
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
}

// Run açılış kararını verir ve seçilen akışı yürütür; dönen sonucun Message'ı son ekrandır (boşsa son ekran yok).
func Run(ctx context.Context, d Deps) flow.Outcome {
	if d.Now == nil {
		d.Now = time.Now
	}
	server, serverOK := remember.CanonicalOrigin(d.ServerURL.String())
	local := d.localBinding(server, serverOK)
	if d.Store != nil && serverOK {
		d.Flow.Binding = newKeeper(d.Store, server, local, d.Now)
	}
	d.Flow.API = d.API
	in := Input{Binding: local != nil && local.Server == server}
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
	rd := d.requestDeps(dec, ref, info, infoErr, local, server)
	return d.runRequest(ctx, rd)
}

// localBinding dosyadaki kayıt (herhangi bir köken; AC-187 karşılaştırması için). Köken eşleşmesi Run'da yapılır;
// eşleşmeyen kayıt yok sayılır, SİLİNMEZ (T43).
func (d Deps) localBinding(server string, serverOK bool) *remember.Binding {
	if d.Store == nil || !serverOK {
		return nil
	}
	data, ok := d.Store.Load()
	if !ok || len(data.Bindings) == 0 {
		return nil
	}
	if own := data.ForOrigin(server); len(own) > 0 {
		return &own[0]
	}
	return &data.Bindings[0]
}

func (d Deps) requestDeps(dec Decision, ref string, info *api.TenantRequestInfo, infoErr error, local *remember.Binding, server string) request.Deps {
	rd := d.Request
	rd.API, rd.ServerURL, rd.Notice = d.API, d.ServerURL, dec.Notice
	rd.BindingEnabled = d.Flow.Binding != nil // AC-188 satırı yalnız kayıt alınabiliyorsa
	if d.Store != nil {
		rd.Remember = d.Store
	}
	usable := local != nil && local.Server == server
	switch dec.Source {
	case SourceRef:
		rd.Ref, rd.Info, rd.InfoErr = ref, info, infoErr
	case SourceBinding:
		rd.BindingKey = local.Key
	}
	if usable {
		rd.Registered = request.Label(request.Display(local.TenantName, ""), request.Display(local.CustomerName, ""))
	}
	rd.OnBindingInvalid = func() {
		if d.Store != nil && local != nil {
			_ = d.Store.RemoveBinding(local.Key) // yalnız o öğe; kişisel bilgiler kalır (AC-185)
		}
	}
	rd.ForgetComputer = func(ctx context.Context) error {
		var err error
		if d.Store != nil {
			err = d.Store.ForgetAll() // önce yerel silme (≤ 1 sn, AC-186)
		}
		if usable { // anahtar yalnız kendi sunucusuna; en iyi çaba, 2 sn
			_ = d.API.RevokeBinding(ctx, local.Key)
		}
		if k, ok := d.Flow.Binding.(*keeper); ok {
			k.forget()
		}
		return err
	}
	return rd
}

// runRequest talep modu → kod akışı ya da talepten doğan oturum (P8b-2 sırası aynen).
func (d Deps) runRequest(ctx context.Context, rd request.Deps) flow.Outcome {
	res := request.Run(ctx, rd)
	switch res.Kind {
	case request.OutCodeMode: // AC-162, AC-189: "Bağlantı kodum var" → 8 hane girişi + lobi
		d.Flow.API = d.API
		return flow.Run(ctx, d.Flow, "")
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
		return out
	}
	return flow.Outcome{} // AC-163: pencere kapatıldı
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
