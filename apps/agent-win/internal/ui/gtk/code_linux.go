//go:build linux

package gtk

import (
	"context"

	"remote-support/agent-win/internal/ui/uicore"
)

type textResult struct {
	text string
	ok   bool
}

// AskCode AC-97: dosya adından kod okunamazsa elle giriş (8 hane; mesajlar flow ileti tablosundan).
func (u *UI) AskCode(ctx context.Context, notice string) (string, bool) {
	ch := make(chan textResult, 1)
	u.do(func() {
		f := u.newForm(uicore.AppTitle, 460)
		f.heading("Uzaktan destek")
		f.label("Teknisyeninizin verdiği 8 haneli destek kodunu girin.")
		r := f.row()
		var e uintptr
		done := func(res textResult) {
			if f.closed {
				return
			}
			f.destroy()
			ch <- res
		}
		e = f.field(r, 16, func() { done(textResult{entryText(e), true}) }, nil)
		if notice != "" {
			f.danger(notice)
		}
		b := f.row()
		ok := f.button(b, "Devam", func() { done(textResult{entryText(e), true}) })
		gtkWidgetSetCanDefault(ok, true)
		gtkWindowSetDefault(f.win, ok)
		f.button(b, "Kapat", func() { done(textResult{}) })
		f.label(u.footer)
		f.onX = func() { done(textResult{}) }
		f.show(e)
	})
	r := await(ctx, ch, textResult{})
	return r.text, r.ok
}
