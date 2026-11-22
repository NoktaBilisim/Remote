//go:build darwin

package capture

import (
	"context"
	"errors"
	"math"
	"os"
	"sync"
	"time"
	"unsafe"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/cgwin"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/rtc"
)

// P33 K2 (mimari-p33 K-P33-4/5, §6.1–6.3; ADR-0043): macOS "Yalnız bir pencere" kaynağı. ScreenCaptureKit
// `SCContentFilter initWithDesktopIndependentWindow:` yalnız o pencerenin katmanını verir (üstüne gelen pencere
// görüntüye girmez, AC-544/T7). Akış altyapısı (temsilci, NV12 yuvası, VideoToolbox, App Nap) ekran kaynağıyla
// ortaktır (sck_darwin.go, source_darwin.go). Pencere durumu tek kaynaktan, CG yoklamasıyla izlenir (K-P33-5, 250 ms):
//
//   - pencere yok → kalıcı WINDOW_CLOSED (akış ve kare yuvası hemen bırakılır, tüm ekrana geçilmez; AC-546),
//   - ekranda değil (küçültme, ⌘H, başka Space, tam ekran) → son gerçek kare siyah plakayla değişir, akış kapanır;
//     keep-alive ve PLI yalnız plakayı gönderir (AC-545, S-P33-T-9),
//   - yeniden görünür → akış yeniden açılır (ilk kare taze; ≤ 2 sn),
//   - boyut değişti → updateConfiguration (kodlayıcı yeni boyutla yeniden kurulur; AC-544).
//
// share.state yöntemi "WGC" = pencere modu belirteci (K-P33-6); WGC_UNSUPPORTED macOS'ta üretilmez. Başlık hiçbir
// hata/log iletisine girmez (S-P33-T-8): SCWindow/SCRunningApplication nesneleri biçimlendirilmez.

const (
	winPollEvery   = 250 * time.Millisecond
	winReopenTries = 3 // görünür pencerenin akışı art arda bu kadar açılamazsa WINDOW_UNAVAILABLE
	opWindowCG     = "CGWindowList"
	opWindowSCK    = "SCWindow"
	opWindowFilter = "SCContentFilterWindow"
)

var (
	winSupportOnce sync.Once
	winSupportOK   bool
)

// WindowCaptureSupported pencere modu kullanılabilir mi: çerçeveler bağlı, SCContentFilter masaüstünden bağımsız
// pencere kurucusunu tanıyor (macOS 12.3+; destek alt sınırı 13) ve CG pencere sorguları bağlanabildi.
func WindowCaptureSupported() bool {
	winSupportOnce.Do(func() {
		if fwErr != nil || !cgwin.Available() {
			return
		}
		objc.Pool(func() {
			fc, err := objc.GetClass("SCContentFilter")
			if err != nil {
				return
			}
			inst := objc.ID(fc).Send(objc.Sel("alloc"))
			winSupportOK = objc.Responds(inst, objc.Sel("initWithDesktopIndependentWindow:"))
			objc.Release(inst)
		})
	})
	return winSupportOK
}

// ShareableWindows AC-542/543 seçim ekranının pencere listesi (§6.2 süzgeci). Ekran Kaydı izni yoksa SCK'ya
// dokunulmaz (izin istemi açılmasın). Dönen etiketler yalnız seçim ekranında gösterilir.
func ShareableWindows() ([]ShareWindow, error) {
	if fwErr != nil {
		return nil, &Error{Reason: ReasonOther, Op: "LoadFrameworks"}
	}
	if !cgPreflight() {
		return nil, &Error{Reason: ReasonOther, Op: "ScreenCaptureAccess"}
	}
	content, err := shareableContentOpts(true, true)
	if err != nil {
		return nil, err
	}
	defer objc.Release(content)
	var all []MacWindow
	objc.Pool(func() { all = macWindows(content) })
	return filterWindows(all, int32(os.Getpid())), nil
}

// macWindows SCShareableContent.windows → Go adayları (metinler kopyalanır; nesne taşınmaz).
func macWindows(content objc.ID) []MacWindow {
	ws := content.Send(objc.Sel("windows"))
	n := pobjc.Send[uint](ws, objc.Sel("count"))
	out := make([]MacWindow, 0, n)
	for i := range n {
		w := ws.Send(objc.Sel("objectAtIndex:"), i)
		fr := pobjc.Send[objc.CGRect](w, objc.Sel("frame"))
		mw := MacWindow{ID: pobjc.Send[uint32](w, objc.Sel("windowID")), Title: nsText(w.Send(objc.Sel("title"))),
			Layer: pobjc.Send[int](w, objc.Sel("windowLayer")), OnScreen: pobjc.Send[bool](w, objc.Sel("isOnScreen")),
			W: fr.Size.W, H: fr.Size.H}
		if app := w.Send(objc.Sel("owningApplication")); app != 0 {
			mw.PID = pobjc.Send[int32](app, objc.Sel("processID"))
			mw.App = nsText(app.Send(objc.Sel("applicationName")))
			mw.Bundle = nsText(app.Send(objc.Sel("bundleIdentifier")))
		}
		out = append(out, mw)
	}
	return out
}

// nsText NSString → Go (nil ya da dönüştürülemezse ""; hata metni taşınmaz).
func nsText(s objc.ID) string {
	if s == 0 {
		return ""
	}
	t, err := objc.GoString(s)
	if err != nil {
		return ""
	}
	return t
}

// OpenWindow AC-544: CGWindowID penceresi için H.264 kaynağı. Pencere listede yoksa ya da ekranda değilse
// WINDOW_UNAVAILABLE (§6.1).
func OpenWindow(wid uintptr) (rtc.Source, error) {
	s, err := openWindow(uint32(wid))
	if err != nil {
		return nil, err
	}
	return s, nil
}

func openWindow(wid uint32) (*source, error) {
	if fwErr != nil {
		return nil, &Error{Reason: ReasonOther, Op: "LoadFrameworks", Method: MethodWGC}
	}
	o := observeWindow(wid)
	if wid == 0 || !o.Exists || !o.OnScreen {
		return nil, &Error{Reason: ReasonWindowUnavailable, Op: opWindowCG, Method: MethodWGC}
	}
	p := &pipeline{window: wid, track: winTrack{w: o.W, h: o.H}}
	s, err := openPipeline(p)
	if err != nil {
		if e, ok := AsError(err); ok {
			return nil, withMethod(e, MethodWGC)
		}
		return nil, err
	}
	p.pollAt = time.Now().Add(winPollEvery)
	return s, nil
}

// observeWindow CG yoklaması: varlık, ekranda olma ve çıktı boyutu (nokta × ekran ölçeği, OutputSize).
func observeWindow(wid uint32) winObs {
	w, ok := cgwin.Get(wid)
	if !ok {
		return winObs{}
	}
	ow, oh := windowOutSize(w.Bounds)
	return winObs{Exists: true, OnScreen: w.OnScreen, W: ow, H: oh}
}

// windowOutSize pencere çerçevesinin (nokta) akış boyutu: merkezinin bulunduğu ekranın piksel/nokta ölçeğiyle
// çarpılır, uzun kenar ≤ 1920 ve çift boyut (OutputSize; tam ekran kuralıyla aynı).
func windowOutSize(b objc.CGRect) (int, int) {
	scale := 1.0
	cx, cy := b.Origin.X+b.Size.W/2, b.Origin.Y+b.Size.H/2
	if ids, err := activeDisplays(); err == nil {
		for _, id := range ids {
			r := cgBounds(id)
			if cx >= r.Origin.X && cx < r.Origin.X+r.Size.W && cy >= r.Origin.Y && cy < r.Origin.Y+r.Size.H && r.Size.W > 0 {
				pw, _ := pixelSize(id)
				scale = float64(pw) / r.Size.W
				break
			}
		}
	}
	w := int(math.Round(b.Size.W * scale))
	h := int(math.Round(b.Size.H * scale))
	return OutputSize(max(2, w), max(2, h))
}

// openWindowStream pencere filtresiyle akış. Filtre yalnız o pencereyi içerir: kendi uygulamamızın dışlanmasına
// gerek yoktur (excluded true; excludeLater başlatılmaz).
func openWindowStream(wid uint32, w, h int) (*sckStream, error) {
	if !cgPreflight() {
		return nil, &Error{Reason: ReasonOther, Op: "ScreenCaptureAccess", Method: MethodWGC}
	}
	content, err := shareableContent()
	if err != nil {
		return nil, withMethod(asErrDarwin(err), MethodWGC)
	}
	defer objc.Release(content)
	s := &sckStream{slot: newSlot(), quit: make(chan struct{}), w: w, h: h}
	s.excluded.Store(true)
	var oerr error
	objc.Pool(func() { oerr = s.startWindow(content, wid) })
	if oerr != nil {
		s.close()
		return nil, withMethod(asErrDarwin(oerr), MethodWGC)
	}
	return s, nil
}

func asErrDarwin(err error) *Error {
	if e, ok := AsError(err); ok {
		return e
	}
	return &Error{Reason: ReasonOther, Op: opWindowSCK}
}

// startWindow SCWindow'u kimlikle bulur ve masaüstünden bağımsız pencere filtresiyle akışı başlatır.
func (s *sckStream) startWindow(content objc.ID, wid uint32) error {
	var win objc.ID
	ws := content.Send(objc.Sel("windows"))
	for i := range pobjc.Send[uint](ws, objc.Sel("count")) {
		w := ws.Send(objc.Sel("objectAtIndex:"), i)
		if pobjc.Send[uint32](w, objc.Sel("windowID")) == wid {
			win = w
			break
		}
	}
	if win == 0 {
		return &Error{Reason: ReasonWindowUnavailable, Op: opWindowSCK}
	}
	fc, err := objc.GetClass("SCContentFilter")
	if err != nil {
		return &Error{Reason: ReasonOther, Op: opWindowFilter}
	}
	filter := objc.ID(fc).Send(objc.Sel("alloc")).Send(objc.Sel("initWithDesktopIndependentWindow:"), win)
	if filter == 0 {
		return &Error{Reason: ReasonWindowUnavailable, Op: opWindowFilter}
	}
	defer objc.Release(filter)
	return s.startFilter(filter)
}

// resize AC-544: akış boyutunu updateConfiguration ile değiştirir (yeni kareler yeni boyutta gelir).
func (s *sckStream) resize(w, h int) error {
	s.w, s.h = w, h
	var err error
	objc.Pool(func() {
		cfg, cerr := s.streamConfig()
		if cerr != nil {
			err = cerr
			return
		}
		defer objc.Release(cfg)
		err = s.call("updateConfiguration:completionHandler:", "updateConfiguration", cfg)
	})
	return err
}

// windowPoll pencere modunda grab'ın ön adımı (K-P33-5). handled true ise grab sonucu (changed, err) budur; false
// ise olağan kare alma yolu sürer.
func (p *pipeline) windowPoll(ctx context.Context, done <-chan struct{}) (changed bool, err error, handled bool) {
	if p.closedErr != nil {
		return false, p.closedErr, true
	}
	if now := time.Now(); !now.Before(p.pollAt) {
		p.pollAt = now.Add(winPollEvery)
		o := observeWindow(p.window)
		switch p.track.observe(o) {
		case winClosed:
			p.dropWindowStream()
			p.closedErr = &Error{Reason: ReasonWindowClosed, Op: opWindowCG, Method: MethodWGC}
			return false, p.closedErr, true
		case winHide:
			p.hide()
			return true, nil, true
		case winShow:
			p.retryAt = time.Time{} // akış nil: olağan yol hemen yeniden açar
		case winResize:
			if p.st != nil && p.st.resize(o.W, o.H) != nil {
				p.st.close()
				p.st = nil
				p.retryAt = time.Time{}
			}
		}
	}
	if p.track.hidden {
		return false, sleepCtx(ctx, done, frameWait), true
	}
	return false, nil, false
}

// hide S-P33-T-9: akış kapanır, son gerçek kare aynı boyutta siyah plakayla değişir (keep-alive/PLI eski kareyi
// göndermez; kodlayıcı yeniden kurulmaz).
func (p *pipeline) hide() {
	w, h := p.encW, p.encH
	if p.cur != nil {
		w, h = p.cur.W, p.cur.H
	}
	if p.st != nil {
		p.st.close()
		p.st = nil
	}
	p.cur = hidePlate(w, h, plateMask(w, h))
	p.kc.Request()
}

// dropWindowStream WINDOW_CLOSED: akış ve kare yuvası hemen bırakılır, son kare tutulmaz.
func (p *pipeline) dropWindowStream() {
	if p.st != nil {
		p.st.close()
		p.st = nil
	}
	p.cur = nil
}

// windowOpenFailed pencere akışı yeniden açılamadı: pencere yoksa WINDOW_CLOSED, art arda winReopenTries kez
// açılamazsa WINDOW_UNAVAILABLE (kalıcı); değilse geri çekilmeli yeniden denenir (nil).
func (p *pipeline) windowOpenFailed() error {
	p.winFails++
	o := observeWindow(p.window)
	switch {
	case !o.Exists:
		p.closedErr = &Error{Reason: ReasonWindowClosed, Op: opWindowCG, Method: MethodWGC}
	case p.winFails >= winReopenTries:
		p.closedErr = &Error{Reason: ReasonWindowUnavailable, Op: opWindowSCK, Method: MethodWGC}
	default:
		return nil
	}
	p.cur = nil
	return p.closedErr
}

// Plaka yazısı (CoreText; ortak iconicPlate Windows GDI'sidir). Bağlanamazsa düz siyah plaka (Windows ile aynı yedek).
var plateText = sync.OnceValue(func() *plateFns {
	var f plateFns
	cg, err1 := objc.Framework("CoreGraphics")
	ct, err2 := objc.Framework("CoreText")
	cf, err3 := objc.Framework("CoreFoundation")
	if errors.Join(err1, err2, err3) != nil {
		return nil
	}
	if errors.Join(
		objc.Func(&f.graySpace, cg, "CGColorSpaceCreateDeviceGray"),
		objc.Func(&f.spaceRelease, cg, "CGColorSpaceRelease"),
		objc.Func(&f.bitmap, cg, "CGBitmapContextCreate"),
		objc.Func(&f.bitmapData, cg, "CGBitmapContextGetData"),
		objc.Func(&f.bitmapBPR, cg, "CGBitmapContextGetBytesPerRow"),
		objc.Func(&f.ctxRelease, cg, "CGContextRelease"),
		objc.Func(&f.fillGray, cg, "CGContextSetGrayFillColor"),
		objc.Func(&f.textPos, cg, "CGContextSetTextPosition"),
		objc.Func(&f.uiFont, ct, "CTFontCreateUIFontForLanguage"),
		objc.Func(&f.line, ct, "CTLineCreateWithAttributedString"),
		objc.Func(&f.lineBounds, ct, "CTLineGetTypographicBounds"),
		objc.Func(&f.lineDraw, ct, "CTLineDraw"),
		objc.Func(&f.release, cf, "CFRelease"),
	) != nil {
		return nil
	}
	var err error
	if f.kFont, err = objc.Symbol(ct, "kCTFontAttributeName"); err != nil {
		return nil
	}
	if f.kFromCtx, err = objc.Symbol(ct, "kCTForegroundColorFromContextAttributeName"); err != nil {
		return nil
	}
	if f.kTrue, err = objc.Symbol(cf, "kCFBooleanTrue"); err != nil {
		return nil
	}
	return &f
})

type plateFns struct {
	graySpace    func() uintptr
	spaceRelease func(s uintptr)
	bitmap       func(data uintptr, w, h, bpc, bpr uintptr, space uintptr, info uint32) uintptr
	bitmapData   func(ctx uintptr) unsafe.Pointer
	bitmapBPR    func(ctx uintptr) uintptr
	ctxRelease   func(ctx uintptr)
	fillGray     func(ctx uintptr, gray, alpha float64)
	textPos      func(ctx uintptr, x, y float64)
	uiFont       func(typ uint32, size float64, lang uintptr) uintptr
	line         func(attr uintptr) uintptr
	lineBounds   func(line uintptr, ascent, descent, leading *float64) float64
	lineDraw     func(line, ctx uintptr)
	release      func(p uintptr)

	kFont, kFromCtx, kTrue uintptr
}

// plateLabel görünmez pencere plakasının yazısı (Windows iconicText ile aynı metin; AC-545).
const plateLabel = "Pencere simge durumunda"

const (
	ctFontUIEmphasizedSystem = 3 // kCTFontUIFontEmphasizedSystem
	cgImageAlphaNone         = 0
)

// plateMask "Pencere simge durumunda" yazısının w×h gri kapsama maskesi (ortalanmış, beyaz); olmazsa nil.
func plateMask(w, h int) []byte {
	f := plateText()
	if f == nil || w < 2 || h < 2 {
		return nil
	}
	var out []byte
	objc.Pool(func() {
		space := f.graySpace()
		if space == 0 {
			return
		}
		defer f.spaceRelease(space)
		ctx := f.bitmap(0, uintptr(w), uintptr(h), 8, 0, space, cgImageAlphaNone) // satır adımını CG seçer
		if ctx == 0 {
			return
		}
		defer f.ctxRelease(ctx)
		font := f.uiFont(ctFontUIEmphasizedSystem, float64(max(16, h/18)), 0)
		if font == 0 {
			return
		}
		defer f.release(font)
		dc, err := objc.GetClass("NSMutableDictionary")
		if err != nil {
			return
		}
		attrs := objc.ID(dc).Send(objc.Sel("dictionary"))
		attrs.Send(objc.Sel("setObject:forKey:"), objc.ID(font), objc.ID(f.kFont))
		attrs.Send(objc.Sel("setObject:forKey:"), objc.ID(f.kTrue), objc.ID(f.kFromCtx))
		text, err := objc.NSString(plateLabel)
		if err != nil {
			return
		}
		ac, err := objc.GetClass("NSAttributedString")
		if err != nil {
			return
		}
		as := objc.ID(ac).Send(objc.Sel("alloc")).Send(objc.Sel("initWithString:attributes:"), text, attrs)
		if as == 0 {
			return
		}
		defer objc.Release(as)
		line := f.line(uintptr(as))
		if line == 0 {
			return
		}
		defer f.release(line)
		var asc, desc, lead float64
		width := f.lineBounds(line, &asc, &desc, &lead)
		f.fillGray(ctx, 1, 1)
		f.textPos(ctx, (float64(w)-width)/2, (float64(h)-asc-desc)/2+desc)
		f.lineDraw(line, ctx)
		data, bpr := f.bitmapData(ctx), int(f.bitmapBPR(ctx))
		n, ok := planeBytes(uint64(bpr), uint64(h))
		if data == nil || !ok || bpr < w {
			return
		}
		mask := make([]byte, w*h)
		if copyPlane(mask, w, unsafe.Slice((*byte)(data), n), bpr, w, h) == nil {
			out = mask
		}
	})
	return out
}
