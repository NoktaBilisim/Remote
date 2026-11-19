//go:build darwin

package mac

import (
	"context"
	"fmt"
	"strings"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
)

// Oturum öncesi ekranlar (mimari-p28f §2.1): kod girişi (AC-97), karşılama + KVKK + kayıt rızası (AC-98/125/128,
// P28e), lobi (AC-112) ve bağlanıyor, monitör seçimi (AC-106; pencere paylaşımı yok, AC-248), Ekran Kaydı rehberi
// (AC-391), Erişilebilirlik rehberi.

type textResult struct {
	text string
	ok   bool
}

// restoreQuit Cmd+Q yolunu ön plandaki ekrana döndürür (oturum varsa onaylı bitirme).
func (u *UI) restoreQuit() {
	switch {
	case u.sess != nil && !u.sess.finished:
		u.quit = u.confirmEnd
	case u.lobby != nil:
		u.quit = func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
	default:
		u.quit = nil
	}
}

// AskCode AC-97: klasör adından kod okunamazsa elle giriş.
func (u *UI) AskCode(ctx context.Context, notice string) (string, bool) {
	ch := make(chan textResult, 1)
	u.do(func() {
		f := u.newForm(uicore.AppTitle, 460, 248)
		f.label("Uzaktan destek", 16, 16, 428, 24, fontBold)
		f.label("Teknisyeninizin verdiği 8 haneli destek kodunu girin.", 16, 46, 428, 20, fontNormal)
		var e objc.ID
		done := func(r textResult) {
			f.destroy()
			u.restoreQuit()
			ch <- r
		}
		e = f.field(16, 72, 200, 26, func() { done(textResult{getText(e), true}) }, nil)
		f.danger(notice, 16, 108, 428, 40, fontNormal)
		ok := f.button("Devam", 252, 154, 96, 32, func(objc.ID) { done(textResult{getText(e), true}) })
		setDefault(ok)
		f.button("Kapat", 352, 154, 92, 32, func(objc.ID) { done(textResult{}) })
		f.label(u.footer, 16, 198, 428, 40, fontNormal)
		f.onClose(func() { done(textResult{}) })
		f.show(e, false, 0)
	})
	r := await(ctx, ch, textResult{})
	return r.text, r.ok
}

// Welcome AC-98/125/128.
func (u *UI) Welcome(ctx context.Context, w flow.Welcome) (string, bool) {
	w.RecOffered = false
	name, _, ok := u.WelcomeRec(ctx, w)
	return name, ok
}

type welcomeResult struct {
	name       string
	record, ok bool
}

// WelcomeRec flow.RecUI: karşılama + P28e kayıt rıza kutusu (varsayılan işaretsiz; korunan denetim — yalnız yerel
// tıklamayla çevrilir, durum Go değişkeninden okunur, §5.2a).
func (u *UI) WelcomeRec(ctx context.Context, w flow.Welcome) (string, bool, bool) {
	ch := make(chan welcomeResult, 1)
	u.do(func() { u.welcomeForm(w, ch) })
	r := await(ctx, ch, welcomeResult{})
	return r.name, r.record, r.ok
}

func (u *UI) welcomeForm(w flow.Welcome, ch chan<- welcomeResult) {
	shift := 0.0
	if w.RecOffered {
		shift = 44
	}
	f := u.newForm(uicore.AppTitle+" — Karşılama", 520, 652+shift)
	f.label("Uzaktan destek bağlantısı", 16, 14, 488, 30, fontBig)
	f.label(w.Tenant+" teknisyeni sizinle uzaktan destek oturumu başlatmak istiyor.", 16, 50, 488, 20, fontNormal)
	f.label("Teknisyen: "+w.TechName, 16, 74, 352, 20, fontBold)
	f.label("Teknisyen doğrulama kodu: "+w.TechVerifyCode, 16, 98, 352, 20, fontBold)
	f.label("Telefondaki teknisyen de bu kodu söylemeli.", 16, 120, 352, 20, fontNormal)
	logo := w.Logo
	if logo == nil {
		logo = uicore.SystemLogo()
	}
	f.picture(logo, 376, 72, 128, 68)
	f.label("Bağlanılan sunucu: "+w.Host, 16, 144, 488, 20, fontNormal)
	f.danger("Sizi biz aramadıysak devam etmeyin", 16, 172, 488, 20, fontBold)
	f.danger("Sizi kendiliğinden arayan biri bunu istediyse kapatın; banka veya şifre işlemi yapmayın. "+
		"Teknisyenimiz şifrenizi hiçbir zaman sormaz.", 16, 194, 488, 38, fontNormal)
	if addr := uicore.MailtoAddr(w.AbuseEmail); addr != "" {
		f.button("Kötüye kullanımı bildir", 16, 234, 200, 32, func(objc.ID) { openMailto(addr) })
	}
	f.danger(w.Notice, 224, 236, 280, 30, fontNormal)
	f.label(fmt.Sprintf("Aydınlatma metni (sürüm %d)", w.ConsentVersion), 16, 272, 488, 20, fontBold)
	f.textView(16, 294, 488, 120, w.ConsentBody)
	f.label(w.RememberNote, 16, 420, 488, 36, fontNormal)
	f.label("Adınız ve soyadınız (teknisyeniniz sizi bu adla görür)", 16, 462, 488, 20, fontNormal)
	var connect, name, consent objc.ID
	valid := func() bool { return checked(consent) && strings.TrimSpace(getText(name)) != "" }
	refresh := func() { enable(connect, valid()) }
	record := false
	done := func(r welcomeResult) {
		f.destroy()
		u.restoreQuit()
		ch <- r
	}
	submit := func() {
		if valid() { // AC-98: onaysız bağlantı başlamaz
			done(welcomeResult{uicore.TrimRunes(strings.TrimSpace(getText(name)), 100), record && w.RecOffered, true})
		}
	}
	name = f.field(16, 484, 300, 26, submit, refresh)
	consent = f.check("Aydınlatma metnini okudum; ekran görüntümün bu oturum boyunca teknisyenle paylaşılmasını "+
		"kabul ediyorum. Uzaktan kontrol için ayrıca onay istenir.", 16, 520, 488, 52, func(objc.ID) { refresh() })
	if w.RecOffered {
		var rec objc.ID
		rec = f.check(flow.RecTexts.ConsentLine, 16, 578, 488, 36, func(s objc.ID) {
			if clickOf(s) == clickLocal {
				record = !record
			}
			setChecked(rec, record)
		})
	}
	connect = f.button("Bağlan", 318, 584+shift, 90, 32, func(objc.ID) { submit() })
	setDefault(connect)
	f.button("Vazgeç", 414, 584+shift, 90, 32, func(objc.ID) { done(welcomeResult{}) })
	f.label(u.footer, 16, 626+shift, 488, 20, fontNormal)
	enable(connect, false)
	f.onClose(func() { done(welcomeResult{}) })
	f.show(name, false, 0)
}

// Lobby AC-112: kabul kodu büyük yazıyla.
func (u *UI) Lobby(admitCode, techName string) {
	u.do(func() {
		u.closeLobby()
		f := u.newForm(uicore.AppTitle+" — Bekleme odası", 420, 290)
		f.label("Teknisyen onayı bekleniyor", 16, 16, 388, 24, fontBold)
		f.label("Kabul kodunuz", 16, 48, 388, 20, fontNormal)
		c := f.label(admitCode, 16, 70, 388, 46, fontHuge)
		c.Send(objc.Sel("setAlignment:"), uint(nsAlignCtr))
		f.label("Bu kodu telefonda teknisyeninize okuyun. Teknisyen kodu girdiğinde bağlantı başlar.", 16, 122, 388, 40, fontNormal)
		f.danger("Kodu yalnız sizi aradığını bildiğiniz teknisyene söyleyin.", 16, 166, 388, 36, fontNormal)
		f.label("Teknisyen: "+techName, 16, 206, 388, 20, fontNormal)
		u.showLobby(f, 242)
	})
}

// Connecting talep oturumu (macOS'ta talep yolu yok; flow.UI sözleşmesi için aynı ekran).
func (u *UI) Connecting(techName string) {
	u.do(func() {
		u.closeLobby()
		f := u.newForm(uicore.AppTitle+" — Bağlanıyor", 420, 170)
		f.label("Teknisyen bağlanıyor…", 16, 16, 388, 24, fontBold)
		f.label("Teknisyen: "+techName, 16, 48, 388, 20, fontNormal)
		f.label("Ekranınız teknisyen bağlandığında paylaşılmaya başlar.", 16, 74, 388, 40, fontNormal)
		u.showLobby(f, 122)
	})
}

func (u *UI) showLobby(f *form, btnY float64) {
	end := func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
	f.button("Vazgeç ve çık", 16, btnY, 150, 32, func(objc.ID) { end() })
	f.onClose(end)
	f.show(0, false, 0)
	u.lobby = f
}

func (u *UI) closeLobby() {
	if u.lobby != nil {
		u.lobby.destroy()
		u.lobby = nil
	}
}

type shareResult struct {
	c  flow.ShareChoice
	ok bool
}

// ChooseShare AC-106: yalnız monitör listesi; varsayılan def. windows parametresi macOS'ta yok sayılır (AC-248).
func (u *UI) ChooseShare(ctx context.Context, mons []signal.Monitor, def int, _ bool) (flow.ShareChoice, bool) {
	ch := make(chan shareResult, 1)
	u.do(func() {
		u.closeLobby()
		h := 120 + float64(len(mons))*26
		f := u.newForm(uicore.AppTitle+" — Ekran seçimi", 460, h)
		f.label("Teknisyenle paylaşılacak ekranı seçin", 16, 16, 428, 24, fontBold)
		sel := def
		found := false
		for i, m := range mons {
			id := m.ID
			r := f.radio(monitorLabel(m), 16, 48+float64(i)*26, 428, 22, func(objc.ID) { sel = id })
			if m.ID == def {
				setChecked(r, true)
				found = true
			}
		}
		if !found && len(mons) > 0 {
			sel = mons[0].ID
		}
		done := func(r shareResult) {
			f.destroy()
			u.restoreQuit()
			ch <- r
		}
		ok := f.button("Paylaş", 256, h-46, 92, 32, func(objc.ID) { done(shareResult{flow.ShareChoice{Monitor: sel}, true}) })
		setDefault(ok)
		f.button("Vazgeç", 352, h-46, 92, 32, func(objc.ID) { done(shareResult{}) })
		f.onClose(func() { done(shareResult{}) })
		f.show(0, false, 0)
	})
	r := await(ctx, ch, shareResult{})
	return r.c, r.ok
}

func monitorLabel(m signal.Monitor) string {
	l := fmt.Sprintf("%s — %d×%d", m.Name, m.W, m.H)
	if m.Primary {
		l += " (birincil)"
	}
	return l
}

// PermAction Ekran Kaydı rehberinin sonucu.
type PermAction int

const (
	PermCancel  PermAction = iota // "Vazgeç" ya da pencere kapatma: uygulama çıkar
	PermRestart                   // "İzni verdim, yeniden başlat" (§5.3 m.3)
)

// Sistem Ayarları gizlilik bölmeleri (§5.3).
const (
	SettingsScreen        = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
	SettingsAccessibility = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
)

// PermGuide AC-391 Ekran Kaydı rehberi (resolve'dan önce): üç adım, "Sistem Ayarları'nı aç", "İzni verdim, yeniden
// başlat", "Vazgeç". Engeller.
func (u *UI) PermGuide(ctx context.Context) PermAction {
	ch := make(chan PermAction, 1)
	u.do(func() {
		t := flow.MacTexts
		f := u.newForm(uicore.AppTitle+" — İzin", 480, 284)
		f.label(t.ScreenTitle, 16, 16, 448, 24, fontBold)
		f.label("Teknisyenin ekranınızı görebilmesi için macOS'ta Ekran Kaydı izni verilmelidir.", 16, 46, 448, 36, fontNormal)
		f.label(t.ScreenSteps, 16, 84, 448, 70, fontNormal)
		f.button(t.OpenSettings, 16, 164, 200, 32, func(objc.ID) { openURL(SettingsScreen) })
		done := func(a PermAction) {
			f.destroy()
			u.restoreQuit()
			ch <- a
		}
		rs := f.button(t.RestartGranted, 224, 164, 240, 32, func(objc.ID) { done(PermRestart) })
		setDefault(rs)
		f.button(t.Cancel, 368, 206, 96, 32, func(objc.ID) { done(PermCancel) })
		f.label(u.footer, 16, 254, 448, 20, fontNormal)
		f.onClose(func() { done(PermCancel) })
		f.show(0, false, 0)
	})
	return await(ctx, ch, PermCancel)
}

// AccessibilityGuide AC-391: kontrol isteğinde Erişilebilirlik izni yoksa (K3 control.state{VIEW, OS_PERMISSION}
// gönderir) bilgi penceresi + Sistem Ayarları düğmesi. Engellemez.
func (u *UI) AccessibilityGuide() {
	u.do(func() {
		closePrompt(u.accessDlg)
		t := flow.MacTexts
		u.accessDlg = u.newPrompt(promptSpec{title: t.AccessTitle, body: t.AccessBody, grantText: t.OpenSettings,
			denyText: "Kapat", open: true, slot: &u.accessDlg,
			onGrant: func() { openURL(SettingsAccessibility) }})
	})
}

// openURL NSWorkspace ile sabit URL açar (yalnız bu paketteki sabitler).
func openURL(s string) {
	url := cls("NSURL").Send(objc.Sel("URLWithString:"), nsstr(s))
	if url != 0 {
		cls("NSWorkspace").Send(objc.Sel("sharedWorkspace")).Send(objc.Sel("openURL:"), url)
	}
}

// openMailto S-P28f-12: mailto NSURLComponents ile (adres yol bileşeni, kodlamayı AppKit yapar).
func openMailto(addr string) {
	c := cls("NSURLComponents").Send(selNew)
	defer c.Send(selRelease)
	c.Send(objc.Sel("setScheme:"), nsstr("mailto"))
	c.Send(objc.Sel("setPath:"), nsstr(addr))
	if url := c.Send(objc.Sel("URL")); url != 0 {
		cls("NSWorkspace").Send(objc.Sel("sharedWorkspace")).Send(objc.Sel("openURL:"), url)
	}
}

// showAbout AC-128: sürüm, ikili parmak izi ve sunucu.
func (u *UI) showAbout() {
	if u.about != nil {
		u.about.show(0, false, 0)
		return
	}
	f := u.newForm(uicore.AppTitle+" Hakkında", 460, 120)
	f.label(uicore.AppTitle, 16, 16, 428, 24, fontBold)
	f.label(u.footer, 16, 48, 428, 36, fontNormal)
	f.onClose(func() { f.destroy(); u.about = nil; u.restoreQuit() })
	ok := f.button("Tamam", 352, 82, 92, 30, func(objc.ID) { f.destroy(); u.about = nil; u.restoreQuit() })
	setDefault(ok)
	u.about = f
	f.show(0, false, 0)
}

// showLicenses üçüncü taraf bildirimleri (salt okunur, ağsız).
func (u *UI) showLicenses() {
	if u.licenses != nil {
		u.licenses.show(0, false, 0)
		return
	}
	f := u.newForm(uicore.AppTitle+" — Lisanslar", 640, 520)
	f.textView(16, 16, 608, 448, uicore.ThirdPartyNotices)
	closeFn := func() { f.destroy(); u.licenses = nil; u.restoreQuit() }
	f.button("Kapat", 532, 476, 92, 32, func(objc.ID) { closeFn() })
	f.onClose(closeFn)
	u.licenses = f
	f.show(0, false, 0)
}
