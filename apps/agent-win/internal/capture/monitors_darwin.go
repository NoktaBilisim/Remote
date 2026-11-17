//go:build darwin

package capture

import (
	"fmt"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/signal"
)

// activeDisplays monitör kimliği sırasıyla CGDirectDisplayID listesi (orderDisplays kuralı: ana ekran 1, yansılar
// yok). CoreGraphics ekran listesi Ekran Kaydı izni istemez.
func activeDisplays() ([]uint32, error) {
	if fwErr != nil {
		return nil, fwErr
	}
	var ids [maxMonitors * 2]uint32
	var n uint32
	if rc := cgActiveList(uint32(len(ids)), &ids[0], &n); rc != 0 {
		return nil, &Error{Reason: ReasonNoOutput, Op: "CGGetActiveDisplayList", HR: uint32(rc)}
	}
	list := make([]display, 0, n)
	for _, id := range ids[:min(int(n), len(ids))] {
		list = append(list, display{id: id, mirror: cgMirrors(id) != 0})
	}
	out := orderDisplays(list, cgMainDisplay())
	if len(out) == 0 {
		return nil, &Error{Reason: ReasonNoOutput, Op: "CGGetActiveDisplayList"}
	}
	return out, nil
}

// pixelSize ekranın geçerli kipteki piksel boyutu (Retina'da nokta × ölçek; ör. 4112×2658).
func pixelSize(id uint32) (int, int) {
	m := cgCopyMode(id)
	if m == 0 {
		b := cgBounds(id)
		return int(b.Size.W), int(b.Size.H)
	}
	defer cgModeRelease(m)
	return int(cgModePixelW(m)), int(cgModePixelH(m))
}

// Monitors share.state için monitör listesi (AC-106). Kimlik 1 tabanlı sıradır (orderDisplays); W/H fiziksel piksel
// (Windows'taki gibi).
func Monitors() ([]signal.Monitor, error) {
	ids, err := activeDisplays()
	if err != nil {
		return nil, err
	}
	main := cgMainDisplay()
	out := make([]signal.Monitor, 0, len(ids))
	for i, id := range ids {
		w, h := pixelSize(id)
		out = append(out, signal.Monitor{ID: i + 1, Name: fmt.Sprintf("Ekran %d", i+1), W: w, H: h, Primary: id == main})
	}
	return out, nil
}

// MonitorRect kimliğe göre ekranın genel masaüstü dikdörtgeni (nokta; CGDisplayBounds, sol üst köken). Girdi (K3) ve
// gösterge (K4) monitör kimliğini bununla eşler.
func MonitorRect(id int) (objc.CGRect, bool) {
	cg, ok := displayOf(id)
	if !ok {
		return objc.CGRect{}, false
	}
	return cgBounds(cg), true
}

// displayOf monitör kimliğinin CGDirectDisplayID'si.
func displayOf(id int) (uint32, bool) {
	ids, err := activeDisplays()
	if err != nil || id < 1 || id > len(ids) {
		return 0, false
	}
	return ids[id-1], true
}
