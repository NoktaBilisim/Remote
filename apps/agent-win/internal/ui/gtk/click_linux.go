//go:build linux

package gtk

// §5.2a localClick arayüz tarafı: korunan denetimin button-press-event'i ve button-release-event'i kopyalanır; eylem
// yalnız bırakmada, aynı denetimde kaydedilmiş basışla ve ClickGuard (K3) kararıyla verilir. GdkEventButton alanları
// x86_64 ofsetleri (gdkevents.h; spike K0s-5'te doğrulandı): type 0, send_event 16, time 20, x 24, y 32, button 52.
// K10 (D-P28g-K2-4): sabitler CI'da libgtk-3-dev başlıklarıyla (test/linux/xi2-offsets.c) TestP28gK10GdkEventOffsets
// içinde karşılaştırılır.

// GdkEventButton / GdkEventKey alan ofsetleri (amd64 LP64).
const (
	offBtnSendEvent = 16 // GdkEventButton.send_event (gint8)
	offBtnTime      = 20 // GdkEventButton.time (guint32)
	offBtnX         = 24 // GdkEventButton.x (gdouble)
	offBtnY         = 32 // GdkEventButton.y (gdouble)
	offBtnButton    = 52 // GdkEventButton.button (guint)
	offKeyKeyval    = 28 // GdkEventKey.keyval (guint)
)

// presses denetim başına son basış (bırakmada tüketilir; destroy'da silinir).
var presses = map[uintptr]ButtonEvent{}

// readButton geri çağrı içinde olay alanlarını kopyalar.
func readButton(ev uintptr, w uintptr) ButtonEvent {
	if ev == 0 {
		return ButtonEvent{}
	}
	p := cptr(ev)
	typ := *(*int32)(p)
	if typ != gdkButtonPress && typ != gdkButtonRelease {
		return ButtonEvent{} // çift/üçlü tıklama olayları korunan denetimde yok sayılır
	}
	e := ButtonEvent{
		Present:   true,
		Release:   typ == gdkButtonRelease,
		SendEvent: *(*int8)(ptrAt(p, offBtnSendEvent)) != 0,
		Time:      *(*uint32)(ptrAt(p, offBtnTime)),
		Button:    *(*uint32)(ptrAt(p, offBtnButton)),
		DeviceID:  -1,
	}
	x, y := *(*float64)(ptrAt(p, offBtnX)), *(*float64)(ptrAt(p, offBtnY))
	e.Inside = x >= 0 && y >= 0 && x < float64(gtkWidgetGetAllocW(w)) && y < float64(gtkWidgetGetAllocH(w))
	if d := gdkEventGetSourceDevice(ev); d != 0 {
		if id := gdkX11DeviceGetID(d); id > 0 {
			e.DeviceID = id
		}
	}
	return e
}

// bindClick basış/bırakma kaydı. consume true: GTK'nın varsayılan işlemesi durdurulur (onay kutusu kendiliğinden
// geçmez). Bağlanamazsa false (çağıran denetimi kapatır).
func (u *UI) bindClick(w uintptr, consume bool, fn func(k clickKind)) bool {
	okP := onEvent(w, sigPress, func(ev uintptr) bool {
		e := readButton(ev, w)
		if e.Present && !e.Release {
			presses[w] = e
		} else {
			delete(presses, w)
		}
		return consume
	})
	okR := onEvent(w, sigRelease, func(ev uintptr) bool {
		rel := readButton(ev, w)
		press, have := presses[w]
		delete(presses, w)
		if rel.Present && rel.Button == 1 {
			fn(classifyClick(u.guard, press, rel, have))
		}
		return consume
	})
	return okP && okR
}
