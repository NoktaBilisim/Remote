//go:build linux

package gtk

import (
	"context"
	"fmt"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
)

type shareResult struct {
	c  flow.ShareChoice
	ok bool
}

// ChooseShare AC-106 (X11): yalnız monitör listesi; pencere paylaşımı yok (AC-248). Wayland'de çağrılmaz (portaldan
// tek akış; seçimi sistem diyaloğu yaptırır).
func (u *UI) ChooseShare(ctx context.Context, mons []signal.Monitor, def int, _ bool) (flow.ShareChoice, bool) {
	ch := make(chan shareResult, 1)
	u.do(func() {
		u.closeLobby()
		f := u.newForm(uicore.AppTitle+" — Ekran seçimi", 460)
		f.heading("Teknisyenle paylaşılacak ekranı seçin")
		sel, found := def, false
		var group uintptr
		for _, m := range mons {
			id := m.ID
			r := gtkRadioNewFromWidget(group, cstr(monitorLabel(m.Name, m.W, m.H, m.Primary)))
			addClass(r, clsLabel)
			if group == 0 {
				group = r
			}
			add(f.box, r)
			if m.ID == def {
				setChecked(r, true)
				found = true
			}
			on(r, sigToggled, func() {
				if checked(r) {
					sel = id
				}
			})
		}
		if !found && len(mons) > 0 {
			sel = mons[0].ID
		}
		done := func(r shareResult) {
			if f.closed {
				return
			}
			f.destroy()
			ch <- r
		}
		b := f.row()
		ok := f.button(b, "Paylaş", func() { done(shareResult{flow.ShareChoice{Monitor: sel}, true}) })
		gtkWidgetSetCanDefault(ok, true)
		gtkWindowSetDefault(f.win, ok)
		f.button(b, "Vazgeç", func() { done(shareResult{}) })
		f.onX = func() { done(shareResult{}) }
		f.show(ok)
	})
	r := await(ctx, ch, shareResult{})
	return r.c, r.ok
}

// --- Wayland portal ekranı (§2.1 choose satırı, AC-399; §14 m.6, m.11) --------------------------------------------
//
// K2'nin Wayland yakalaması (portal oturumu) bu yöntemleri çağırır: PortalOpening sistem diyaloğu açılmadan önce,
// reddedilir/iptal edilirse PortalFailed (engeller: true = "Tekrar dene", false = "Oturumu bitir" ya da pencere
// kapatma — akışa EvEnd de gider), başarıda PortalDone. Kendi monitör seçim ekranı yoktur (çifte seçim yok).

// PortalOpening "Sistem izin penceresi açılıyor…" + kontrol için "Uzaktan etkileşime izin ver" ipucu.
func (u *UI) PortalOpening() {
	u.do(func() {
		u.closeLobby()
		u.closePortal()
		t := flow.LinuxTexts
		f := u.newForm(uicore.AppTitle+" — Ekran paylaşımı", 460)
		f.heading(t.PortalOpening)
		f.label(t.AllowControl)
		f.onX = func() {} // sistem diyaloğu sonucu beklenir; kapatma yolu yok (iptal sistem diyaloğundadır)
		f.show(0)
		u.portal = f
	})
}

// PortalFailed paylaşım başlamadı: "Paylaşım başlatılmadı" + "Tekrar dene" + "Oturumu bitir". missing true ise portal
// arayüzü yok (A-PG-2): yalnız "Oturumu bitir". Engeller.
func (u *UI) PortalFailed(ctx context.Context, missing bool) bool {
	ch := make(chan bool, 1)
	u.do(func() {
		u.closePortal()
		t := flow.LinuxTexts
		f := u.newForm(uicore.AppTitle+" — Ekran paylaşımı", 460)
		done := func(retry bool) {
			if f.closed {
				return
			}
			f.destroy()
			u.portal = nil
			if !retry {
				u.emit(flow.Event{Kind: flow.EvEnd})
			}
			ch <- retry
		}
		if missing {
			f.heading(t.PortalMissing)
		} else {
			f.heading(t.ShareNotStarted)
			f.label(t.AllowControl)
		}
		b := f.row()
		if !missing {
			retry := f.button(b, t.Retry, func() { done(true) })
			gtkWidgetSetCanDefault(retry, true)
			gtkWindowSetDefault(f.win, retry)
		}
		f.button(b, "Oturumu bitir", func() { done(false) })
		f.onX = func() { done(false) }
		f.show(0)
		u.portal = f
	})
	return await(ctx, ch, false)
}

// PortalDone portal ekranı kapanır (paylaşım başladı).
func (u *UI) PortalDone() { u.do(u.closePortal) }

func (u *UI) closePortal() {
	if u.portal != nil {
		u.portal.destroy()
		u.portal = nil
	}
}

// PortalMonitors Wayland monitör listesi (K2 capture.Monitors portal diyaloğunu açar): önce "Sistem izin penceresi
// açılıyor…" gösterilir, sonra open çağrılır. classify portal hatasını ayırır (capture.PortalError; missing =
// portal.ErrUnavailable → A-PG-2 metni). Portal hatasında "Tekrar dene" döngüsü; "Oturumu bitir" → hata döner (akış
// EvEnd'i de alır). Akış goroutine'inden çağrılır (engeller). Bağlama cmd/noktadestek'tedir.
func (u *UI) PortalMonitors(ctx context.Context, open func() ([]signal.Monitor, error),
	classify func(error) (isPortal, missing bool)) ([]signal.Monitor, error) {
	for {
		u.PortalOpening()
		mons, err := open()
		if err == nil {
			u.PortalDone()
			return mons, nil
		}
		isPortal, missing := classify(err)
		if !isPortal || !u.PortalFailed(ctx, missing) {
			u.PortalDone()
			return nil, err
		}
	}
}

// PortalParent portal diyaloğunun üst penceresi ("x11:<XID>"; capture.ConfigureWayland'e verilir). Portal ekranı
// yoksa oturum penceresi, o da yoksa "" (üst pencere yok). Ana döngü dışından çağrılır; en çok 2 sn bekler.
func (u *UI) PortalParent() string {
	ch := make(chan string, 1)
	u.do(func() {
		var w uintptr
		switch {
		case u.portal != nil && !u.portal.closed:
			w = u.portal.win
		case u.sess != nil && !u.sess.finished:
			w = u.sess.f.win
		}
		id := ""
		if gw := gtkWidgetGetWindow(w); w != 0 && gw != 0 {
			if xid := gdkX11WindowGetXID(gw); xid != 0 {
				id = fmt.Sprintf("x11:%x", xid)
			}
		}
		ch <- id
	})
	select {
	case id := <-ch:
		return id
	case <-time.After(2 * time.Second):
		return ""
	}
}
