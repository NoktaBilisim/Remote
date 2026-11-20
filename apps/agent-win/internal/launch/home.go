package launch

import (
	"context"
	"errors"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// Firma listeli tek ana ekran (P20 K3; mimari-e11 §8d.3 ana ekran satırı, §8d.4 silme yolları, G-P20-4/8/9/12/17/18;
// tek ekran kararı 2026-11-15: dosya adı, firma dosyası, süresi dolmuş kod ve tepsi açılışı aynı ekranı açar).

// HomeUI firma listeli ana ekranı gösterir (Win32: internal/ui). Engelleyen çağrı: karar dönene kadar bekler.
// "Bu firmayı unut" ve "Bu bilgisayarı unut" onayı UI'dadır (onaylanmazsa karar dönmez).
type HomeUI interface {
	FirmHome(ctx context.Context, v FirmView) FirmAction
}

// FirmRow talep için seçilebilen firma satırı. Kayıtlı firma (gömülü kökenden): Text "<firma>[ – <müşteri>] (kayıt:
// GG.AA.YYYY)". File: açılan firma dosyasının firması (kayıt değildir; Key boş, "Bu firmayı unut" uygulanmaz); listede
// her zaman ilk satırdır ve seçili açılır. Adı yalnız sunucu yanıtından gelir (dosya adındaki etiket kullanılmaz, G-E9-11).
type FirmRow struct {
	Key  string
	Text string
	File bool
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

// FirmView ana ekran. Single: tek satır ve başka köken yok → liste yerine satır metni. Firms boşsa AC-190: "Destek
// iste" pasif, açıklama ve "Bağlantı kodum var".
// SetTray/SetAutostart UI iş parçacığında çağrılır (yerel, ağsız) ve kutuların yeni durumunu döner.
type FirmView struct {
	Firms        []FirmRow
	Single       bool
	Others       []OtherOrigin
	Notice       string
	Toggles      Toggles
	SetTray      func(on bool) Toggles
	SetAutostart func(on bool) Toggles
	// AbuseEmail P31 AC-513: dosyanın firmasının "Kötüye kullanımı bildir" adresi (açılıştaki firma bilgisi yanıtından;
	// yoksa boş). Ham değerdir; arayüz uicore.MailtoAddr ile doğrular. Win32 ana ekranı kullanmaz (form kullanır).
	AbuseEmail string
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

// Ana ekran ağ süreleri.
const (
	statusTimeout    = 5 * time.Second
	revokeAllTimeout = 2 * time.Second
)

// fileFirm açılan firma dosyasının ref'i ve açılıştaki ilk firma bilgisi yanıtı (yalnız ilk talepte kullanılır).
type fileFirm struct {
	ref  string
	info *api.TenantRequestInfo
	err  error
	used bool
}

// row dosyanın firması satırı: ad sunucu yanıtından (Display süzgeçli); yanıt yoksa (ağ hatası) yalnız önek.
func (f *fileFirm) row() FirmRow {
	text := fileRowPrefix
	if f.info != nil {
		if n := request.Display(f.info.Tenant.Name, ""); n != "" {
			text += ": " + n
		}
	}
	return FirmRow{Text: text, File: true}
}

// firmHome tek ana ekran döngüsü: her gösterimde öğeler sırayla `bindings/status` ile denetlenir; seçilen satırla
// (dosyanın firması → ref, kayıtlı firma → anahtar) talep; talep ana ekrana dönerse (kayıt geçersiz) liste bilgi
// satırıyla yeniden gösterilir. Satır kalmazsa ekran AC-190 durumuyla ("Bağlantı kodum var") açık kalır.
func (d Deps) firmHome(ctx context.Context, server string, file *fileFirm, notice string) flow.Outcome {
	notes := []string{notice}
	for {
		notes = append(notes, d.checkStatus(ctx, server)...)
		if d.UpdateNotice != nil {
			notes = append(notes, d.UpdateNotice())
		}
		st, own := d.loadOwn(server)
		if ctx.Err() != nil {
			return flow.Outcome{}
		}
		v := d.firmView(st.Data, file, own, server, joinNotes(notes))
		act := d.Home.FirmHome(ctx, v)
		out, done, more := d.onFirmAction(ctx, act, file, own, server)
		if done {
			return out
		}
		notes = more
	}
}

// onFirmAction ana ekran kararını yürütür. done=true: akış biter (out sonuçtur); değilse ekran notes bilgi satırlarıyla
// yeniden gösterilir.
func (d Deps) onFirmAction(ctx context.Context, act FirmAction, file *fileFirm, own []remember.Binding,
	server string) (out flow.Outcome, done bool, notes []string) {
	i := act.Index
	if file != nil {
		i-- // dosyanın firması 0. satır
	}
	valid := i >= 0 && i < len(own)
	switch {
	case act.Kind == FirmSupport && file != nil && act.Index == 0:
		return backNote(d.requestFile(ctx, file))
	case act.Kind == FirmSupport && valid:
		return backNote(d.requestFor(ctx, own[i], server))
	case act.Kind == FirmCode:
		fd := d.Flow
		fd.API = d.API
		return flow.Run(ctx, fd, ""), true, nil
	case act.Kind == FirmForgetOne && valid:
		return flow.Outcome{}, false, []string{d.forgetOne(ctx, own[i], server)}
	case act.Kind == FirmForgetAll:
		return flow.Outcome{}, false, d.forgetAllNotes(ctx, server)
	case act.Kind == FirmClose:
		return flow.Outcome{}, true, nil
	}
	return flow.Outcome{}, false, nil
}

// backNote talep sonucu: ana ekrana dönmediyse akış biter; döndüyse (kayıt geçersiz) bilgi satırı gösterilir.
func backNote(out flow.Outcome, back bool, note string) (flow.Outcome, bool, []string) {
	if !back {
		return out, true, nil
	}
	return flow.Outcome{}, false, []string{note}
}

// loadOwn kayıt dosyasının güncel durumu ve gömülü kökenin kayıtları (depo yoksa / köken kanonik değilse kayıtsız).
func (d Deps) loadOwn(server string) (remember.LoadResult, []remember.Binding) {
	if d.Store == nil {
		return remember.LoadResult{}, nil
	}
	st := d.Store.LoadState()
	if server == "" {
		return st, nil
	}
	return st, st.Data.ForOrigin(server)
}

func (d Deps) firmView(data remember.Data, file *fileFirm, own []remember.Binding, server, notice string) FirmView {
	v := FirmView{Notice: notice, Toggles: d.toggles(""), SetTray: d.setTray, SetAutostart: d.setAutostart}
	if file != nil {
		v.Firms = append(v.Firms, file.row())
		if file.info != nil && file.info.AbuseEmail != nil {
			v.AbuseEmail = *file.info.AbuseEmail
		}
	}
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
	if d.Store == nil || server == "" {
		return nil
	}
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

// requestFor seçilen kayıtlı firmayla talep modu (doğrudan form). Talep ana ekrana dönerse (kayıt geçersiz) back=true
// ve bilgi metni döner.
func (d Deps) requestFor(ctx context.Context, b remember.Binding, server string) (flow.Outcome, bool, string) {
	rd := d.baseRequest()
	rd.BindingKey, rd.Registered = b.Key, bindingLabel(b)
	key := b.Key // G-P20-8: kapanış bu talebin anahtarını taşır
	rd.OnBindingInvalid = func() { d.onBindingInvalid(key, server) }
	return d.runRequest(ctx, rd)
}

// requestFile dosyanın firmasıyla talep (AC-182 kural 2: talep dosyadaki ref'e). Açılıştaki firma bilgisi yanıtı yalnız
// ilk talepte kullanılır (aynı istek tekrarlanmaz); sonraki taleplerde yeniden sorulur. Hata yanıtları talep modunun
// bugünkü engel ekranlarıyla gösterilir (ağ/TLS "Tekrar dene", eski sürüm "Yeni sürümü indir").
func (d Deps) requestFile(ctx context.Context, f *fileFirm) (flow.Outcome, bool, string) {
	rd := d.baseRequest()
	rd.Ref = f.ref
	if !f.used {
		f.used = true
		if f.info != nil {
			cp := *f.info // satır adı açılıştaki yanıttan kalır; talep modu kendi kopyasını süzer
			rd.Info = &cp
		}
		rd.InfoErr = f.err
	}
	return d.runRequest(ctx, rd)
}
