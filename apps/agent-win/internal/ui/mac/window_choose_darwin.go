//go:build darwin

package mac

import (
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
)

// P33 K2 (mimari-p33 §6.1, AC-542/543): "Teknisyenle neyi paylaşmak istiyorsunuz?" — "Tüm ekran" (varsayılan; çoklu
// monitörde altında monitör listesi) / "Yalnız bir pencere" (kaydırılabilir radyo listesi, "Listeyi yenile").
// Pencere başlıkları yalnız bu ekranda görünür; ekran kapanınca liste bırakılır (AC-556). Paylaş yalnız yerel tıklama
// ya da klavyeyle (VoiceOver/Tab) kabul edilir; sentetik/AX etkinleştirmesi yok sayılır (S-P28f-1 kalıbı). Renkler
// AppKit semantik (iki tema), radyolar VoiceOver etiketi taşır.

const (
	chooseW     = 520.0
	chooseRowH  = 26.0
	chooseListH = 200.0
)

type windowChooser struct {
	u       *UI
	f       *form
	ch      chan<- shareResult
	mons    []signal.Monitor
	mon     int
	window  bool    // "Yalnız bir pencere" seçili
	sel     uintptr // seçili pencere
	list    []capture.ShareWindow
	scroll  objc.ID
	monRads []objc.ID
	full    objc.ID
	one     objc.ID
	empty   objc.ID
	share   objc.ID
}

func (u *UI) chooseWindow(mons []signal.Monitor, def int, ch chan<- shareResult) {
	t := uicore.MacWindowTexts
	c := &windowChooser{u: u, ch: ch, mons: mons, mon: def}
	monH := 0.0
	if len(mons) > 1 {
		monH = float64(len(mons)) * chooseRowH
	}
	h := 16 + 30 + 26 + monH + 30 + chooseListH + 8 + 40 + 40 + 24 + 48
	f := u.newForm(uicore.AppTitle+" — Ekran seçimi", chooseW, h)
	c.f = f
	f.label(t.Question, 16, 16, chooseW-32, 24, fontBold)
	y := 50.0
	c.full = f.radio(t.FullScreen, 16, y, chooseW-32, 22, func(s objc.ID) { c.setMode(s, false) })
	y += 26
	if monH > 0 { // monitör radyoları ayrı grup (ayrı üst görünüm)
		box := c.box(32, y, chooseW-48, monH)
		found := false
		for i, m := range mons {
			id := m.ID
			r := c.in(box, func() objc.ID {
				return f.radio(monitorLabel(m), 0, float64(i)*chooseRowH, chooseW-48, 22, func(s objc.ID) {
					if c.accept(s) {
						c.mon = id
					}
				})
			})
			c.monRads = append(c.monRads, r)
			if m.ID == def {
				setChecked(r, true)
				found = true
			}
		}
		if !found {
			c.mon = mons[0].ID
			setChecked(c.monRads[0], true)
		}
		y += monH
	}
	c.one = f.radio(t.OneWindow, 16, y+4, chooseW-32, 22, func(s objc.ID) { c.setMode(s, true) })
	y += 30
	c.scroll = cls("NSScrollView").Send(selAlloc).Send(objc.Sel("initWithFrame:"), rect(32, y, chooseW-48, chooseListH))
	c.scroll.Send(objc.Sel("setHasVerticalScroller:"), true)
	c.scroll.Send(objc.Sel("setBorderType:"), uint(2)) // NSBezelBorder
	c.scroll.Send(objc.Sel("setAccessibilityLabel:"), nsstr(t.ListLabel))
	f.view.Send(selAddSubview, c.scroll)
	c.scroll.Send(selRelease)
	c.empty = f.label(t.Empty, 40, y+8, chooseW-64, 40, fontNormal)
	y += chooseListH + 8
	f.label(t.Warning, 16, y, chooseW-32, 36, fontBold)
	y += 40
	f.label(t.Hint, 16, y, chooseW-32, 36, fontNormal)
	y += 40 + 24
	f.button(t.Refresh, 16, y, 150, 32, func(s objc.ID) {
		if c.accept(s) {
			c.fill()
		}
	})
	c.share = f.button(t.Share, chooseW-200, y, 92, 32, func(s objc.ID) {
		if c.accept(s) {
			c.submit()
		}
	})
	setDefault(c.share)
	f.button(t.Cancel, chooseW-104, y, 88, 32, func(objc.ID) { c.done(shareResult{}) })
	f.onClose(func() { c.done(shareResult{}) })
	c.fill()
	c.apply()
	f.show(c.full, false, 0)
}

// accept yalnız yerel fare tıklaması ya da klavye (Tab/Space, VoiceOver); sentetik etkinleştirme yok sayılır.
func (c *windowChooser) accept(sender objc.ID) bool { return clickOf(sender) != clickInjected }

// box radyo grubu için ayrı, çevrilmiş (y aşağı) kap görünüm.
func (c *windowChooser) box(x, y, w, h float64) objc.ID {
	v := objc.ID(clsView).Send(selAlloc).Send(objc.Sel("initWithFrame:"), rect(x, y, w, h))
	c.f.view.Send(selAddSubview, v)
	v.Send(selRelease)
	return v
}

// in form denetimlerini geçici olarak v görünümüne ekletir.
func (c *windowChooser) in(v objc.ID, fn func() objc.ID) objc.ID {
	prev := c.f.view
	c.f.view = v
	defer func() { c.f.view = prev }()
	return fn()
}

func (c *windowChooser) setMode(sender objc.ID, window bool) {
	if !c.accept(sender) {
		c.apply() // görünen seçim Go durumuna geri döner
		return
	}
	c.window = window
	c.apply()
}

// fill pencere listesini yeniden okur (seçim, pencere hâlâ listedeyse korunur).
func (c *windowChooser) fill() {
	list, err := capture.ShareableWindows()
	if err != nil {
		list = nil
	}
	c.list = list
	keep := false
	for _, w := range list {
		keep = keep || w.ID == c.sel
	}
	if !keep {
		c.sel = 0
	}
	doc := c.box(0, 0, chooseW-66, max(chooseListH-4, float64(len(list))*chooseRowH))
	doc.Send(objc.Sel("removeFromSuperview"))
	for i, w := range list {
		id := w.ID
		r := c.in(doc, func() objc.ID {
			return c.f.radio(w.Label, 4, float64(i)*chooseRowH+2, chooseW-74, 22, func(s objc.ID) {
				if c.accept(s) {
					c.sel = id
				}
				c.apply()
			})
		})
		r.Send(objc.Sel("setAccessibilityLabel:"), nsstr(w.Label))
		setChecked(r, id == c.sel)
	}
	c.scroll.Send(objc.Sel("setDocumentView:"), doc)
	c.apply()
}

// apply denetimlerin etkinliği: pencere listesi yalnız "Yalnız bir pencere"de; boş liste iletisi; Paylaş seçim yoksa
// pasif (AC-543).
func (c *windowChooser) apply() {
	setChecked(c.full, !c.window)
	setChecked(c.one, c.window)
	for _, r := range c.monRads {
		enable(r, !c.window)
	}
	show(c.empty, c.window && len(c.list) == 0)
	show(c.scroll, !c.window || len(c.list) > 0)
	enable(c.scroll, c.window)
	if doc := c.scroll.Send(objc.Sel("documentView")); doc != 0 {
		for _, sub := range subviews(doc) {
			enable(sub, c.window)
			setChecked(sub, false)
		}
		for i, sub := range subviews(doc) {
			if i < len(c.list) && c.list[i].ID == c.sel {
				setChecked(sub, true)
			}
		}
	}
	enable(c.share, !c.window || c.sel != 0)
}

func subviews(v objc.ID) []objc.ID {
	arr := v.Send(objc.Sel("subviews"))
	n := sendInt(arr, objc.Sel("count"))
	out := make([]objc.ID, 0, n)
	for i := range n {
		out = append(out, arr.Send(objc.Sel("objectAtIndex:"), uint(i)))
	}
	return out
}

func (c *windowChooser) submit() {
	if !c.window {
		c.done(shareResult{flow.ShareChoice{Monitor: c.mon}, true})
		return
	}
	if c.sel == 0 {
		return
	}
	c.done(shareResult{flow.ShareChoice{Window: c.sel}, true})
}

func (c *windowChooser) done(r shareResult) {
	c.u.windowShare = r.ok && r.c.Window != 0
	c.list = nil // başlıklar ekran kapanınca bırakılır (AC-556)
	c.f.destroy()
	c.u.restoreQuit()
	c.ch <- r
}

// watchText gösterge/oturum metni: pencere modunda "Paylaştığınız pencere izleniyor — …" (AC-551).
func (u *UI) watchText(granted bool) string {
	if u.windowShare {
		return uicore.WindowWatchText(granted, u.techName)
	}
	return uicore.WatchText(granted, u.techName)
}
