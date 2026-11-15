package launch

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// Firma listeli ana ekran (P20 K3; mimari-e11 §8d.3 ana ekran satırı, §8d.4 silme yolları, G-P20-4/8/9/12/17/18).

// HomeUI firma listeli ana ekranı gösterir (Win32: internal/ui). Engelleyen çağrı: karar dönene kadar bekler.
// "Bu firmayı unut" ve "Bu bilgisayarı unut" onayı UI'dadır (onaylanmazsa karar dönmez).
type HomeUI interface {
	FirmHome(ctx context.Context, v FirmView) FirmAction
}

// FirmRow talep için seçilebilen firma satırı (gömülü kökenden). Text "<firma>[ – <müşteri>] (kayıt: GG.AA.YYYY)".
type FirmRow struct {
	Key  string
	Text string
}

// OtherOrigin gömülü kökenden farklı kökenli kayıtlar: "Başka sunucu (<host>)" başlığı altında, seçilemez (T43).
type OtherOrigin struct {
	Host string
	Rows []string
}

// Toggles "Tepside çalıştır" / "Windows açılışında başlat" onay kutuları. Hint açıklama veya hata metnidir.
type Toggles struct {
	Tray, TrayEnabled           bool
	Autostart, AutostartEnabled bool
	// AutostartHidden autorun bu platformda/yapılandırmada yok: kutu gösterilmez.
	AutostartHidden bool
	Hint            string
}

// FirmView ana ekran. Single: tek kayıt ve başka köken yok → liste yerine "Bu bilgisayar … için kayıtlı" satırı.
// SetTray/SetAutostart UI iş parçacığında çağrılır (yerel, ağsız) ve kutuların yeni durumunu döner.
type FirmView struct {
	Firms        []FirmRow
	Single       bool
	Others       []OtherOrigin
	Notice       string
	Toggles      Toggles
	SetTray      func(on bool) Toggles
	SetAutostart func(on bool) Toggles
}

// FirmActionKind ana ekran kararı.
type FirmActionKind int

const (
	FirmClose FirmActionKind = iota
	FirmSupport
	FirmCode
	FirmForgetOne
	FirmForgetAll
)

// FirmAction karar; Index FirmSupport/FirmForgetOne'da Firms dizinidir.
type FirmAction struct {
	Kind  FirmActionKind
	Index int
}

// Autostart internal/autorun.Manager (K4 sözleşmesi).
type Autostart interface {
	State() (autorun.State, error)
	Enable() (autorun.Reason, error)
	Disable() error
	Verify() (autorun.Check, error)
}

// Ana ekran metinleri.
const (
	NoticeUnreadable = "Bu bilgisayardaki kayıtlar şu an okunamıyor; kayıtlar silinmedi, program kayıtsız gibi çalışıyor. " +
		"Sorun sürerse Bu bilgisayarı unut ile kayıtları silebilirsiniz (firmalardaki kayıtlar bu durumda iptal edilemez)."
	NoticeSuggestForget = "Kayıtlar art arda okunamadı. Bu bilgisayarı unut ile silmeniz önerilir; firmalardaki kayıtlar " +
		"okunamadığı için iptal edilemez, firmanızdan yeni dosya isteyin."
	NoticeTrimmed = "Kayıt dosyasında sınırı aşan eski kayıtlar vardı; en eski kullanılanlar listeden çıkarıldı."
	// NoticeOldVersion G-P20-9 ek cümlesi.
	NoticeOldVersion  = "Eski sürüm dosyasını açmayın; tam temizlik için bu programda Bu bilgisayarı unut'u kullanın."
	NoticeRunRemoved  = "Windows açılışında başlatma kapatıldı: "
	NoticeRunMissing  = "Windows açılışında başlatma kaydı artık bulunmayan bir program dosyasını gösteriyor; kutuyu yeniden işaretleyin."
	NoticeRunNotFreed = "Windows açılışında başlatma kaydı silinemedi; kullanım kılavuzundaki elle kaldırma adımını uygulayın."
	hintTrayFirst     = "Windows açılışında başlatmak için önce Tepside çalıştır'ı açın."
	hintStateFailed   = "Windows açılışında başlatma durumu okunamadı."
	hintWindowsOff    = "Windows ayarlarında devre dışı"
	statusTimeout     = 5 * time.Second
	revokeAllTimeout  = 2 * time.Second
)

// BlockedText K-P20-5 + G-P20-9: 5 sınırı nedeniyle eski sürümden kalan kayıt eklenemedi.
func BlockedText(firm string) string {
	return "Eski sürümden kalan bir kayıt (" + firm + ") eklenemedi; 5 firma sınırı. Eklemek için bir firmayı unutun. " +
		NoticeOldVersion
}

// InvalidText BINDING_INVALID olan öğe silindi.
func InvalidText(label string) string {
	return label + ": bu bilgisayarın kaydı artık geçerli değil, listeden çıkarıldı."
}

// ForgotOneText "Bu firmayı unut" sonrası.
func ForgotOneText(label string) string { return label + " bu bilgisayardan unutuldu." }

func joinNotes(n []string) string {
	var out []string
	for _, s := range n {
		if s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, " ")
}

func bindingLabel(b remember.Binding) string {
	return request.Label(request.Display(b.TenantName, ""), request.Display(b.CustomerName, ""))
}

// rowText G-P20-12: her satırda yerel kayıt tarihi.
func rowText(b remember.Binding) string {
	return bindingLabel(b) + " (kayıt: " + b.IssuedAt.Local().Format("02.01.2006") + ")"
}

// originHost "https://host:443" → "host" (443 dışı port korunur).
func originHost(origin string) string {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return origin
	}
	if u.Port() == "443" {
		return u.Hostname()
	}
	return u.Host
}

// startupNotes açılış bilgileri (bir kez): okuma durumu, göç, otomatik başlatma doğrulaması (G-P20-15 normal açılış).
func (d Deps) startupNotes(st remember.MigrateResult) []string {
	var n []string
	switch {
	case st.Status == remember.StatusUnreadable && st.SuggestForget:
		n = append(n, NoticeSuggestForget)
	case st.Status == remember.StatusUnreadable:
		n = append(n, NoticeUnreadable)
	}
	if st.Trimmed {
		n = append(n, NoticeTrimmed)
	}
	if st.Blocked != "" {
		n = append(n, BlockedText(request.Display(st.Blocked, "Firma")))
	}
	if d.Autostart != nil {
		if c, err := d.Autostart.Verify(); err == nil || c.Removed {
			switch {
			case c.Removed:
				n = append(n, NoticeRunRemoved+c.Reason.Message()+".")
			case c.Missing:
				n = append(n, NoticeRunMissing)
			}
		}
	}
	return n
}

// firmHome ana ekran döngüsü: her gösterimde öğeler sırayla `bindings/status` ile denetlenir; seçilen firmayla talep;
// talep ana ekrana dönerse (kayıt geçersiz) liste yeniden gösterilir.
func (d Deps) firmHome(ctx context.Context, server, notice string) flow.Outcome {
	notes := []string{notice}
	for {
		notes = append(notes, d.checkStatus(ctx, server)...)
		st := d.Store.LoadState()
		own := st.Data.ForOrigin(server)
		if ctx.Err() != nil {
			return flow.Outcome{}
		}
		if len(own) == 0 { // son öğe de gitti → kaynaksız ana ekran (satır 8 + bilgiler)
			return d.runRequest(ctx, d.requestDeps(Decision{Notice: joinNotes(notes)}, "", nil, nil, nil, server))
		}
		v := d.firmView(st.Data, own, server, joinNotes(notes))
		notes = nil
		act := d.Home.FirmHome(ctx, v)
		valid := act.Index >= 0 && act.Index < len(own)
		switch {
		case act.Kind == FirmSupport && valid:
			out, back, note := d.requestFor(ctx, own[act.Index], server)
			if !back {
				return out
			}
			notes = append(notes, note)
		case act.Kind == FirmCode:
			fd := d.Flow
			fd.API = d.API
			return flow.Run(ctx, fd, "")
		case act.Kind == FirmForgetOne && valid:
			notes = append(notes, d.forgetOne(ctx, own[act.Index], server))
		case act.Kind == FirmForgetAll:
			runNote, err := d.forgetAll(ctx, server)
			n := request.MsgForgotten
			if err != nil {
				n = "Bu bilgisayardaki kayıt silinemedi. Pencereyi kapatıp yeniden deneyin."
			}
			return d.runRequest(ctx, d.requestDeps(Decision{Notice: joinNotes([]string{n, runNote})}, "", nil, nil, nil, server))
		case act.Kind == FirmClose:
			return flow.Outcome{}
		}
	}
}

func (d Deps) firmView(data remember.Data, own []remember.Binding, server, notice string) FirmView {
	v := FirmView{Notice: notice, Toggles: d.toggles(""), SetTray: d.setTray, SetAutostart: d.setAutostart}
	for _, b := range own {
		v.Firms = append(v.Firms, FirmRow{Key: b.Key, Text: rowText(b)})
	}
	idx := map[string]int{}
	for _, b := range data.Bindings {
		if b.Server == server {
			continue
		}
		i, ok := idx[b.Server]
		if !ok {
			i = len(v.Others)
			idx[b.Server] = i
			v.Others = append(v.Others, OtherOrigin{Host: originHost(b.Server)})
		}
		v.Others[i].Rows = append(v.Others[i].Rows, rowText(b))
	}
	v.Single = len(v.Firms) == 1 && len(v.Others) == 0
	return v
}

// checkStatus öğeleri sırayla denetler (≤ 5 istek). YALNIZ `BINDING_INVALID` o öğeyi siler (G-P20-8); RATE_LIMITED,
// 5xx, ağ hatası, CLIENT_OUTDATED, kodsuz 404 hiçbir öğeyi silmez. Ad değiştiyse dosya güncellenir + bir kez bilgi
// (G-P20-12). Ağ yoksa (ilk ağ hatası) kalan öğeler denetlenmez (ekran gecikmesin).
func (d Deps) checkStatus(ctx context.Context, server string) []string {
	st := d.Store.LoadState()
	if st.Status != remember.StatusOK {
		return nil
	}
	var notes []string
	for _, b := range st.Data.ForOrigin(server) {
		cctx, cancel := context.WithTimeout(ctx, statusTimeout)
		info, err := d.API.BindingStatus(cctx, b.Key)
		cancel()
		if ctx.Err() != nil {
			return notes
		}
		var ae *api.Error
		switch {
		case err == nil:
			notes = append(notes, d.rename(b, info))
		case errors.As(err, &ae) && ae.Code == "BINDING_INVALID":
			if n := d.onBindingInvalid(b.Key, server); n != "" {
				notes = append(notes, n)
			} else {
				notes = append(notes, InvalidText(bindingLabel(b)))
			}
		case !errors.As(err, &ae) || ae.Status == 0:
			return notes // ağ/TLS: kalanları bu gösterimde sorma
		}
	}
	return notes
}

// rename sunucudaki ad yereldekinden farklıysa yereli günceller (anahtar, kayıt tarihi, son kullanım aynı).
func (d Deps) rename(b remember.Binding, info *api.BindingInfo) string {
	nb := b
	nb.TenantName = request.Display(info.Tenant.Name, b.TenantName)
	nb.CustomerName = ""
	if info.Customer != nil {
		nb.CustomerName = request.Display(info.Customer.Name, "")
	}
	old, cur := bindingLabel(b), bindingLabel(nb)
	if old == cur {
		return ""
	}
	if err := d.Store.SaveBinding(nb, b.Key); err != nil {
		d.diag(err)
		return NoteWriteFailed
	}
	return RenamedText(old, cur)
}

func (d Deps) diag(err error) {
	if d.Diag != nil && err != nil {
		d.Diag(eventStoreFailure, remember.ErrorClass(err))
	}
}

// onBindingInvalid G-P20-8: silme isteği anındaki ANAHTARLA (seçili öğeyle değil). Hata metni döner ("" = silindi).
func (d Deps) onBindingInvalid(key, server string) string {
	if d.Store == nil {
		return ""
	}
	if err := d.Store.RemoveBinding(key); err != nil {
		d.diag(err)
		return NoteWriteFailed
	}
	return d.afterRemove(server)
}

// afterRemove §8d.4: gömülü kökende öğe kalmadıysa Run değeri silinir (tepsi K5'te kapanır); hata metni döner.
func (d Deps) afterRemove(server string) string {
	if d.Store == nil || d.Autostart == nil {
		return ""
	}
	if st := d.Store.LoadState(); st.Status == remember.StatusUnreadable || len(st.Data.ForOrigin(server)) > 0 {
		return ""
	}
	if err := d.Autostart.Disable(); err != nil {
		return NoticeRunNotFreed
	}
	return ""
}

// forgetOne "Bu firmayı unut": yerel silme, sonra o anahtarla en iyi çaba iptal (2 sn).
func (d Deps) forgetOne(ctx context.Context, b remember.Binding, server string) string {
	if err := d.Store.RemoveBinding(b.Key); err != nil {
		d.diag(err)
		return NoteWriteFailed
	}
	rctx, cancel := context.WithTimeout(ctx, revokeAllTimeout)
	_ = d.API.RevokeBinding(rctx, b.Key)
	cancel()
	return joinNotes([]string{ForgotOneText(bindingLabel(b)), d.afterRemove(server)})
}

// forgetAll "Bu bilgisayarı unut" (AC-186, §8d.4): önce yerel silme (okuma durumundan bağımsız, G-P20-18), sonra
// gömülü kökenin anahtarlarıyla iptal (toplam 2 sn; başka kökenin anahtarı gönderilmez, T43), Run değeri silinir.
// İlk dönüş Run silinemediyse bilgi metnidir; hata yalnız yerel silmedir.
func (d Deps) forgetAll(ctx context.Context, server string) (string, error) {
	var keys []string
	var err error
	if d.Store != nil {
		if data, ok := d.Store.Load(); ok && server != "" {
			for _, b := range data.ForOrigin(server) {
				keys = append(keys, b.Key)
			}
		}
		err = d.Store.ForgetAll()
	}
	rctx, cancel := context.WithTimeout(ctx, revokeAllTimeout)
	for _, k := range keys {
		_ = d.API.RevokeBinding(rctx, k)
	}
	cancel()
	note := ""
	if d.Autostart != nil && d.Autostart.Disable() != nil {
		note = NoticeRunNotFreed
	}
	return note, err
}

// requestFor seçilen firmayla talep modu. Talebin ana ekranı otomatik geçilir; talep ana ekrana dönmek isterse (kayıt
// geçersiz) back=true ve bilgi metni döner.
func (d Deps) requestFor(ctx context.Context, b remember.Binding, server string) (flow.Outcome, bool, string) {
	rd := d.baseRequest(server)
	rd.BindingKey, rd.Registered = b.Key, bindingLabel(b)
	key := b.Key // G-P20-8: kapanış bu talebin anahtarını taşır
	rd.OnBindingInvalid = func() { d.onBindingInvalid(key, server) }
	u := &firmRequestUI{UI: rd.UI, first: true}
	rd.UI = u
	out := d.runRequest(ctx, rd)
	if u.back {
		return out, true, u.notice
	}
	return out, false, ""
}

// firmRequestUI talep modunun ana ekranını firma listesine bağlar: ilk ana ekran (firma bilgisi alındıysa) "Destek
// iste" ile geçilir; sonraki/başarısız ana ekran talebi kapatır ve listeye döner (bilgi satırıyla).
type firmRequestUI struct {
	request.UI
	first  bool
	back   bool
	notice string
}

func (u *firmRequestUI) RequestHome(_ context.Context, v request.HomeView) request.HomeAction {
	if u.first {
		u.first = false
		if v.Support {
			return request.HomeSupport
		}
	}
	u.back, u.notice = true, v.Notice
	return request.HomeClose
}

// toggles kutuların durumu (yükseltilmiş süreçte ikisi pasif + açıklama; başlatma yalnız tepsi açıkken).
func (d Deps) toggles(hint string) Toggles {
	t := Toggles{Hint: hint}
	if d.Store == nil {
		t.AutostartHidden = true
		return t
	}
	st := d.Store.LoadState()
	t.Tray = st.Data.Prefs != nil && st.Data.Prefs.Tray
	t.TrayEnabled = !d.Flow.SelfElevated && st.Status == remember.StatusOK
	if d.Autostart == nil {
		t.AutostartHidden = true
		return t
	}
	as, err := d.Autostart.State()
	t.Autostart = err == nil && as.On
	t.AutostartEnabled = t.Tray && t.TrayEnabled && err == nil && as.Blocked == autorun.ReasonOK
	if t.Hint != "" {
		return t
	}
	switch {
	case d.Flow.SelfElevated:
		t.Hint = autorun.ReasonElevated.Message()
	case err != nil:
		t.Hint = hintStateFailed
	case as.Blocked != autorun.ReasonOK:
		t.Hint = as.Blocked.Message()
	case as.DisabledInWindows:
		t.Hint = hintWindowsOff
	case !t.Tray:
		t.Hint = hintTrayFirst
	}
	return t
}

// setTray "Tepside çalıştır"; kapatılınca Run değeri de silinir (§8d.4).
func (d Deps) setTray(on bool) Toggles {
	if d.Store == nil || d.Flow.SelfElevated {
		return d.toggles("")
	}
	if err := d.Store.SetPrefs(remember.Prefs{Tray: on}); err != nil {
		d.diag(err)
		return d.toggles(NoteWriteFailed)
	}
	if !on && d.Autostart != nil && d.Autostart.Disable() != nil {
		return d.toggles(NoticeRunNotFreed)
	}
	return d.toggles("")
}

// setAutostart "Windows açılışında başlat" (açık kullanıcı eylemi; yalnız tepsi açıkken).
func (d Deps) setAutostart(on bool) Toggles {
	if d.Autostart == nil {
		return d.toggles("")
	}
	if !on {
		if d.Autostart.Disable() != nil {
			return d.toggles(NoticeRunNotFreed)
		}
		return d.toggles("")
	}
	if t := d.toggles(""); !t.AutostartEnabled {
		return t
	}
	r, err := d.Autostart.Enable()
	switch {
	case r != autorun.ReasonOK:
		return d.toggles(r.Message())
	case err != nil:
		return d.toggles(hintStateFailed)
	}
	return d.toggles("")
}

// observedAPI oturum firmasının adını (BINDING_LIMIT metni) ve kayıtla açılan talebin 201'ini (TouchBinding) izler.
type observedAPI struct {
	API
	mu     sync.Mutex
	tenant string
	touch  func(key string)
}

func (o *observedAPI) setTenant(name string) {
	o.mu.Lock()
	o.tenant = request.Display(name, "")
	o.mu.Unlock()
}

func (o *observedAPI) lastTenant() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.tenant
}

func (o *observedAPI) Resolve(ctx context.Context, code string) (*api.ResolveResult, error) {
	r, err := o.API.Resolve(ctx, code)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) TenantInfo(ctx context.Context, ref string) (*api.TenantRequestInfo, error) {
	r, err := o.API.TenantInfo(ctx, ref)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) BindingStatus(ctx context.Context, key string) (*api.BindingInfo, error) {
	r, err := o.API.BindingStatus(ctx, key)
	if err == nil {
		o.setTenant(r.Tenant.Name)
	}
	return r, err
}

func (o *observedAPI) CreateRequest(ctx context.Context, body api.CreateRequestBody) (*api.CreateRequestResult, error) {
	r, err := o.API.CreateRequest(ctx, body)
	if err == nil && body.BindingKey != "" && o.touch != nil {
		o.touch(body.BindingKey)
	}
	return r, err
}
