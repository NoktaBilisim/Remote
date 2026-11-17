//go:build darwin

package input

import (
	"time"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
)

// localClick'in AppKit tarafı (mimari-p28f §5.2a). Yalnız ANA iş parçacığında (AppKit) çağrılır. Herhangi bir sınıf,
// selector ya da CoreGraphics işlevi çözülemezse Present false döner → LocalClick ret (FFI kuralı 5).

// EventClick NSEvent'ten localClick alanlarını okur (basışı kaydetmek için: ör. mouseDown: / yerel olay izleyicisi).
func EventClick(ev objc.ID) ClickEvent {
	if ev == 0 || bind() != nil {
		return ClickEvent{}
	}
	selType, selCG, selTS := objc.Sel("type"), objc.Sel("CGEvent"), objc.Sel("timestamp")
	if !objc.Responds(ev, selType) || !objc.Responds(ev, selCG) || !objc.Responds(ev, selTS) {
		return ClickEvent{}
	}
	ref := uintptr(ev.Send(selCG)) // NSEvent'in sahip olduğu CGEventRef (bırakılmaz)
	if ref == 0 {
		return ClickEvent{}
	}
	return ClickEvent{
		Present:  true,
		Type:     uint32(pobjc.Send[uint](ev, selType)),
		StateID:  cg.getInt(ref, fieldStateID),
		PID:      cg.getInt(ref, fieldSourcePID),
		UserData: cg.getInt(ref, fieldUserData),
		At:       seconds(pobjc.Send[float64](ev, selTS)),
	}
}

// CurrentClick eylem anındaki NSApp.currentEvent (bırakma).
func CurrentClick() ClickEvent {
	c, err := objc.GetClass("NSApplication")
	if err != nil {
		return ClickEvent{}
	}
	app := objc.ID(c).Send(objc.Sel("sharedApplication"))
	if !objc.Responds(app, objc.Sel("currentEvent")) {
		return ClickEvent{}
	}
	return EventClick(app.Send(objc.Sel("currentEvent")))
}

// Uptime NSEvent.timestamp ile aynı zaman tabanı (NSProcessInfo.systemUptime). Okunamazsa 0 (→ bayat → ret).
func Uptime() time.Duration {
	c, err := objc.GetClass("NSProcessInfo")
	if err != nil {
		return 0
	}
	pi := objc.ID(c).Send(objc.Sel("processInfo"))
	if !objc.Responds(pi, objc.Sel("systemUptime")) {
		return 0
	}
	return seconds(pobjc.Send[float64](pi, objc.Sel("systemUptime")))
}

func seconds(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }
