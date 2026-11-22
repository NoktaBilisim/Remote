//go:build darwin

package mac

import (
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
)

// P33 K2 (mimari-p33 §6.1, AC-542/543): "Teknisyenle neyi paylaşmak istiyorsunuz?" — "Tüm ekran" (varsayılan; çoklu
// monitörde altında monitör listesi) / "Yalnız bir pencere" (kaydırılabilir radyo listesi, "Listeyi yenile").
// Pencere başlıkları yalnız bu ekranda görünür; ekran kapanınca liste bırakılır (AC-556). Paylaş yalnız yerel tıklama
// ya da klavyeyle (VoiceOver/Tab) kabul edilir; sentetik/AX etkinleştirmesi yok sayılır (S-P28f-1 kalıbı). Renkler
// AppKit semantik (iki tema), radyolar VoiceOver etiketi taşır. Karar mantığı (seçim, etkinlik, Paylaş sonucu)
// window_choice.go'dadır (platformdan bağımsız, tablo testli); bu dosya yalnız çizer.

const (
	chooseW     = 520.0
	chooseRowH  = 26.0
	chooseListH = 200.0
)

type windowChooser struct {
	u       *UI
	f       *form
	ch      chan<- shareResult
	st      windowChoice
	list    []capture.ShareWindow // yalnız radyo etiketleri için (sıra st.list ile aynı)
	scroll  objc.ID
	monRads []objc.ID
	monIDs  []int // monRads ile aynı sırada
	full    objc.ID
	one     objc.ID
	empty   objc.ID
	share   objc.ID
}

func (u *UI) chooseWindow(mons []signal.Monitor, def int, ch chan<- shareResult) {
	t := uicore.MacWindowTexts
	ids := make([]int, len(mons))
	for i, m := range mons {
		ids[i] = m.ID
	}
	c := &windowChooser{u: u, ch: ch, st: newWindowChoice(ids, def)}
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
		for i, m := range mons {
			id := m.ID
			r := c.in(box, func() objc.ID {
				return f.radio(monitorLabel(m), 0, float64(i)*chooseRowH, chooseW-48, 22, func(s objc.ID) {
					c.st.pickMonitor(clickOf(s), id)
					c.apply()
				})
			})
			c.monRads, c.monIDs = append(c.monRads, r), append(c.monIDs, id)
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
		if accepted(clickOf(s)) {
			c.fill()
		}
	})
	c.share = f.button(t.Share, chooseW-200, y, 92, 32, func(s objc.ID) {
		if sc, ok := c.st.submit(clickOf(s)); ok {
			c.done(shareResult{sc, true})
		}
	})
	setDefault(c.share)
	f.button(t.Cancel, chooseW-104, y, 88, 32, func(objc.ID) { c.done(shareResult{}) })
	f.onClose(func() { c.done(shareResult{}) })
	c.fill()
	c.apply()
	f.show(c.full, false, 0)
}

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

// setMode sentetik etkinleştirmede de apply çağrılır: görünen seçim Go durumuna geri döner.
func (c *windowChooser) setMode(sender objc.ID, window bool) {
	c.st.setMode(clickOf(sender), window)
	c.apply()
}

// fill pencere listesini yeniden okur (seçim, pencere hâlâ listedeyse korunur).
func (c *windowChooser) fill() {
	list, err := capture.ShareableWindows()
	if err != nil {
		list = nil
	}
	c.list = list
	ids := make([]uintptr, len(list))
	for i, w := range list {
		ids[i] = w.ID
	}
	c.st.setList(ids)
	doc := c.box(0, 0, chooseW-66, max(chooseListH-4, float64(len(list))*chooseRowH))
	doc.Send(objc.Sel("removeFromSuperview"))
	for i, w := range list {
		id := w.ID
		r := c.in(doc, func() objc.ID {
			return c.f.radio(w.Label, 4, float64(i)*chooseRowH+2, chooseW-74, 22, func(s objc.ID) {
				c.st.pickWindow(clickOf(s), id)
				c.apply()
			})
		})
		r.Send(objc.Sel("setAccessibilityLabel:"), nsstr(w.Label))
	}
	c.scroll.Send(objc.Sel("setDocumentView:"), doc)
	c.apply()
}

// apply windowChoice görünümünü denetimlere yansıtır (AC-543: Paylaş seçim yoksa pasif).
func (c *windowChooser) apply() {
	v := c.st.view()
	setChecked(c.full, v.FullChecked)
	setChecked(c.one, v.OneChecked)
	for i, r := range c.monRads {
		enable(r, v.MonitorsEnabled)
		setChecked(r, c.monIDs[i] == c.st.mon)
	}
	show(c.empty, v.ShowEmpty)
	show(c.scroll, v.ShowList)
	// NSScrollView bir NSControl değildir (setEnabled: yok → NSInvalidArgumentException, çöker); pasiflik satırlara verilir.
	if doc := c.scroll.Send(objc.Sel("documentView")); doc != 0 {
		for i, sub := range subviews(doc) {
			enable(sub, v.ListEnabled)
			setChecked(sub, i < len(c.st.list) && c.st.list[i] == v.Checked && v.Checked != 0)
		}
	}
	enable(c.share, v.ShareEnabled)
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
