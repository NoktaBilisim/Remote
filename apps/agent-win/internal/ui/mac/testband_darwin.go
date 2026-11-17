//go:build darwin

package mac

import (
	"errors"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// AC-390 / S-P28f-7: "TEST SÜRÜMÜ — imzasız" bandı çalışma anında kendi imzamızdan türetilir
// (SecCodeCopySelf + SecCodeCopySigningInformation). Bant her ekranın üstünde, gösterge seviyesinde, tıklama geçirgen,
// gizlenemez (canHide=NO) bir şerittir ve her pencerenin en üst satırıdır (form_darwin.go newForm). Tik ve ekran
// değişimi bildirimi şeritleri yeniden kurar/öne alır.

const (
	bandH         = 24
	bandW         = 320
	secCSSignInfo = 1 << 1 // kSecCSSigningInformation
	secCodeAdHoc  = 0x0002 // kSecCodeSignatureAdhoc
	errSecSuccess = 0
	keyTeamID     = "teamid" // kSecCodeInfoTeamIdentifier değeri
	keyCodeFlags  = "flags"  // kSecCodeInfoFlags değeri
	nsBorderless  = 0
	nsSharingNone = 0 // NSWindowSharingNone: ekran yakalamasına girmez (Windows ExcludeFromCapture eşi)
)

var errNoSignInfo = errors.New("ui/mac: imza bilgisi okunamadı")

// signingInfo Team ID ve ad-hoc bayrağı; herhangi bir adım başarısızsa Err (bant gösterilir, fail-closed).
func signingInfo() signInfo {
	h, err := objc.Framework("Security")
	if err != nil {
		return signInfo{Err: err}
	}
	var copySelf func(flags uint32, out *uintptr) int32
	var copyInfo func(code uintptr, flags uint32, out *uintptr) int32
	if err := errors.Join(objc.Func(&copySelf, h, "SecCodeCopySelf"),
		objc.Func(&copyInfo, h, "SecCodeCopySigningInformation")); err != nil {
		return signInfo{Err: err}
	}
	var code, dict uintptr
	if copySelf(0, &code) != errSecSuccess || code == 0 {
		return signInfo{Err: errNoSignInfo}
	}
	defer objc.Release(objc.ID(code))
	if copyInfo(code, secCSSignInfo, &dict) != errSecSuccess || dict == 0 {
		return signInfo{Err: errNoSignInfo}
	}
	d := objc.ID(dict)
	defer objc.Release(d)
	si := signInfo{TeamID: goText(d.Send(objc.Sel("objectForKey:"), nsstr(keyTeamID)))}
	if n := d.Send(objc.Sel("objectForKey:"), nsstr(keyCodeFlags)); n != 0 {
		si.AdHoc = sendInt(n, objc.Sel("unsignedIntValue"))&secCodeAdHoc != 0
	} else {
		si.Err = errNoSignInfo
	}
	return si
}

func flowBandText() string { return flow.MacTexts.TestBand }

// syncBands her NSScreen için bir şerit (ekran sayısı değiştiyse yeniden kurulur) ve hepsini öne alır.
func (u *UI) syncBands() {
	if !u.band {
		return
	}
	screens := screenFrames()
	if len(screens) != len(u.bands) {
		for _, b := range u.bands {
			b.Send(selClose)
			b.Send(selRelease)
		}
		u.bands = nil
		for _, s := range screens {
			u.bands = append(u.bands, newBand(s.frame, s.visible))
		}
	}
	for i, b := range u.bands {
		b.Send(objc.Sel("setFrame:display:"), bandRect(screens[i].frame, screens[i].visible), true)
		b.Send(selOrderFrontRegardless)
	}
}

// bandRect ekranın menü çubuğunun hemen altında, sağ üstte (gösterge etiketiyle çakışmaz).
func bandRect(frame, visible objc.CGRect) objc.CGRect {
	top := visible.Origin.Y + visible.Size.H
	return rect(frame.Origin.X+frame.Size.W-bandW-12, top-bandH-4, bandW, bandH)
}

func newBand(frame, visible objc.CGRect) objc.ID {
	w := overlayWindow(bandRect(frame, visible))
	l := cls("NSTextField").Send(objc.Sel("labelWithString:"), nsstr(flowBandText()))
	l.Send(selSetFont, font(fontBold))
	l.Send(objc.Sel("setDrawsBackground:"), true)
	l.Send(objc.Sel("setBackgroundColor:"), rgb(uicore.IndicatorBg))
	l.Send(selSetTextColor, rgb(uicore.IndicatorText))
	l.Send(objc.Sel("setAlignment:"), uint(nsAlignCtr))
	l.Send(selSetFrame, rect(0, 0, bandW, bandH))
	w.Send(objc.Sel("contentView")).Send(selAddSubview, l)
	return w
}

// overlayWindow kenarlıksız, saydam, tıklama geçirgen, tüm masaüstlerinde ve tam ekran uygulamaların üstünde,
// gizlenemez (canHide=NO), ekran yakalamasından hariç pencere (gösterge, işaretleme, TEST bandı; §2.1, §5.2b).
func overlayWindow(r objc.CGRect) objc.ID {
	w := objc.ID(clsPanel).Send(selAlloc).Send(selInitContent, r, uint(nsBorderless), uint(nsBuffered), false)
	w.Send(objc.Sel("setOpaque:"), false)
	w.Send(objc.Sel("setBackgroundColor:"), cls("NSColor").Send(objc.Sel("clearColor")))
	w.Send(objc.Sel("setHasShadow:"), false)
	w.Send(objc.Sel("setLevel:"), levelSaver)
	w.Send(objc.Sel("setCollectionBehavior:"), uint(behaviorInd))
	w.Send(objc.Sel("setIgnoresMouseEvents:"), true)
	w.Send(objc.Sel("setHidesOnDeactivate:"), false)
	w.Send(objc.Sel("setCanHide:"), false)
	w.Send(objc.Sel("setRestorable:"), false)
	w.Send(objc.Sel("setReleasedWhenClosed:"), false)
	w.Send(objc.Sel("setSharingType:"), uint(nsSharingNone))
	w.Send(selOrderFrontRegardless)
	return w
}

// screen bir NSScreen'in çerçevesi, çalışma alanı ve CGDirectDisplayID'si.
type screen struct {
	frame, visible objc.CGRect
	id             int
}

func screenFrames() []screen {
	arr := cls("NSScreen").Send(objc.Sel("screens"))
	n := sendInt(arr, objc.Sel("count"))
	out := make([]screen, 0, n)
	for i := range n {
		s := arr.Send(objc.Sel("objectAtIndex:"), uint(i))
		id := s.Send(objc.Sel("deviceDescription")).Send(objc.Sel("objectForKey:"), nsstr("NSScreenNumber"))
		out = append(out, screen{frame: sendRect(s, objc.Sel("frame")), visible: sendRect(s, objc.Sel("visibleFrame")),
			id: sendInt(id, objc.Sel("intValue"))})
	}
	return out
}
