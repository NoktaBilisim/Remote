package launch

import (
	"context"

	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// Ana ekran eylemleri: kayıt silme (§8d.4 silme yolları) ve "Tepside çalıştır" / "Windows açılışında başlat" kutuları.

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

// forgetAllNotes "Bu bilgisayarı unut" sonrası bilgi satırları: sonuç ve (silinemediyse) Run değeri notu.
func (d Deps) forgetAllNotes(ctx context.Context, server string) []string {
	runNote, err := d.forgetAll(ctx, server)
	n := request.MsgForgotten
	if err != nil {
		n = noteForgetAllFailed
	}
	return []string{n, runNote}
}

// toggles kutuların durumu (yükseltilmiş süreçte ikisi pasif + açıklama; başlatma yalnız tepsi açıkken).
func (d Deps) toggles(hint string) Toggles {
	t := Toggles{Hint: hint}
	if d.Store == nil {
		t.AutostartHidden = true
		return t
	}
	st := d.Store.LoadState()
	server, _ := remember.CanonicalOrigin(d.ServerURL.String())
	firms := len(st.Data.ForOrigin(server)) > 0 // tercih yalnız kayıt varken tutulur (remember.SetPrefs)
	t.Tray = st.Data.Prefs != nil && st.Data.Prefs.Tray
	t.TrayEnabled = !d.Flow.SelfElevated && st.Status == remember.StatusOK && firms
	if d.Autostart == nil {
		t.AutostartHidden = true
		return t
	}
	as, err := d.Autostart.State()
	t.Autostart = err == nil && as.On
	t.AutostartEnabled = t.Tray && t.TrayEnabled && err == nil && as.Blocked == autorun.ReasonOK
	if t.Hint == "" {
		t.Hint = d.toggleHint(t.Tray, st.Status, firms, as, err)
	}
	return t
}

// toggleHint kutuların açıklaması (öncelik sırasıyla ilk uyan); hiçbiri uymazsa boş.
func (d Deps) toggleHint(tray bool, status remember.Status, firms bool, as autorun.State, err error) string {
	switch {
	case d.Flow.SelfElevated:
		return autorun.ReasonElevated.Message()
	case status != remember.StatusUnreadable && !firms:
		return hintTrayNoFirm
	case err != nil:
		return hintStateFailed
	case as.Blocked != autorun.ReasonOK:
		return as.Blocked.Message()
	case as.DisabledInWindows:
		return hintWindowsOff
	case !tray:
		return hintTrayFirst
	}
	return ""
}

// setTray "Tepside çalıştır"; kapatılınca Run değeri de silinir (§8d.4). Kutu pasifken (depo yok, yükseltilmiş, okunamayan
// dosya, kayıtlı firma yok) hiçbir şey yazılmaz.
func (d Deps) setTray(on bool) Toggles {
	if t := d.toggles(""); !t.TrayEnabled {
		return t
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
