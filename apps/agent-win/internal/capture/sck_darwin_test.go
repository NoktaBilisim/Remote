//go:build darwin

package capture

import (
	"context"
	"errors"
	"os"
	"runtime"
	"slices"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/rtc"
)

// AppKit (test penceresi) ve ana dispatch kuyruğu yalnız ana iş parçacığında: TestMain ana goroutine'i ana iş
// parçacığına kilitler, testleri ayrı goroutine'de koşturup olay döngüsünü pompalar.
func init() { runtime.LockOSThread() }

var testApp objc.ID

func TestMain(m *testing.M) {
	if _, err := objc.Framework("AppKit"); err != nil {
		os.Exit(m.Run()) // AppKit yoksa pencere testleri atlanır
	}
	c, _ := objc.GetClass("NSApplication")
	testApp = objc.ID(c).Send(objc.Sel("sharedApplication"))
	testApp.Send(objc.Sel("setActivationPolicy:"), 1) // accessory: Dock simgesi yok
	testApp.Send(objc.Sel("finishLaunching"))
	done := make(chan int, 1)
	go func() { done <- m.Run() }()
	for {
		select {
		case code := <-done:
			os.Exit(code)
		default:
		}
		objc.Pool(func() { pump(20 * time.Millisecond) })
	}
}

func pump(d time.Duration) {
	dc, _ := objc.GetClass("NSDate")
	until := objc.ID(dc).Send(objc.Sel("dateWithTimeIntervalSinceNow:"), d.Seconds())
	mode, _ := objc.NSString("kCFRunLoopDefaultMode")
	for {
		ev := testApp.Send(objc.Sel("nextEventMatchingMask:untilDate:inMode:dequeue:"), ^uint64(0), until, mode, true)
		if ev == 0 {
			return
		}
		testApp.Send(objc.Sel("sendEvent:"), ev)
	}
}

// onMain fn'i ana kuyrukta çalıştırıp bekler.
func onMain(t *testing.T, fn func()) {
	t.Helper()
	q, err := objc.MainQueue()
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan struct{})
	if err := objc.Async(q, func() { objc.Pool(fn); close(ch) }); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("ana kuyruk yanıt vermedi")
	}
}

func needCapture(t *testing.T) {
	t.Helper()
	if fwErr != nil {
		t.Skipf("çerçeveler: %v", fwErr)
	}
	if testApp == 0 {
		t.Skip("AppKit yok")
	}
	if !cgPreflight() {
		t.Skip("Ekran Kaydı izni yok (CGPreflightScreenCaptureAccess=false); SCK testleri atlandı")
	}
}

// probeWindow ana ekranın ortasında kenarlıksız, en üstte, saf macenta pencere (kendi penceremiz) açar.
func probeWindow(t *testing.T) objc.ID {
	var w objc.ID
	onMain(t, func() {
		sc, _ := objc.GetClass("NSScreen")
		scr := objc.ID(sc).Send(objc.Sel("mainScreen"))
		fr := objcRect(scr)
		r := objc.CGRect{Origin: objc.CGPoint{X: fr.Size.W/2 - 150, Y: fr.Size.H/2 - 100}, Size: objc.CGSize{W: 300, H: 200}}
		wc, _ := objc.GetClass("NSWindow")
		w = objc.ID(wc).Send(objc.Sel("alloc")).Send(objc.Sel("initWithContentRect:styleMask:backing:defer:"), r, uint(0), uint(2), false)
		w.Send(objc.Sel("setReleasedWhenClosed:"), false)
		w.Send(objc.Sel("setRestorable:"), false)
		w.Send(objc.Sel("setIgnoresMouseEvents:"), true)
		w.Send(objc.Sel("setLevel:"), 1000)
		setColor(w, 1, 0, 1)
		w.Send(objc.Sel("orderFrontRegardless"))
	})
	t.Cleanup(func() { onMain(t, func() { w.Send(objc.Sel("close")); objc.Release(w) }) })
	return w
}

func objcRect(scr objc.ID) objc.CGRect { return pobjc.Send[objc.CGRect](scr, objc.Sel("frame")) }

func setColor(w objc.ID, r, g, b float64) {
	cc, _ := objc.GetClass("NSColor")
	w.Send(objc.Sel("setBackgroundColor:"), objc.ID(cc).Send(objc.Sel("colorWithSRGBRed:green:blue:alpha:"), r, g, b, 1.0))
}

// magentaAtCenter son karenin ortası macenta mı (709 sınırlı aralık: Y≈78 U≈214 V≈230; eşikler geniş).
func magentaAtCenter(f *NV12) bool {
	x, y := f.W/2, f.H/2
	Y := f.Data[y*f.W+x]
	o := f.W*f.H + (y/2)*f.W + (x/2)*2
	U, V := f.Data[o], f.Data[o+1]
	return Y > 40 && Y < 150 && U > 175 && V > 185
}

// framesFor kaynaktan d süresince kare çeker; her yeni kare için fn(p.cur).
func framesFor(t *testing.T, s *source, d time.Duration, fn func(*NV12)) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	n := 0
	for {
		_, err := s.NextFrame(ctx)
		if err != nil {
			return n
		}
		n++
		if fn != nil {
			fn(s.p.cur)
		}
	}
}

// AC-106 / AC-392: monitör listesi izin istemeden gelir; ana ekran 1 ve birincil; MonitorRect ana ekranda köken 0,0.
func TestP28fK2AC106Monitors(t *testing.T) {
	if fwErr != nil {
		t.Skip(fwErr)
	}
	ms, err := Monitors()
	if err != nil || len(ms) == 0 {
		t.Fatalf("Monitors: %v %v", ms, err)
	}
	if !ms[0].Primary || ms[0].ID != 1 || ms[0].W < 2 || ms[0].H < 2 {
		t.Fatalf("ana ekran: %+v", ms[0])
	}
	r, ok := MonitorRect(1)
	if !ok || r.Origin.X != 0 || r.Origin.Y != 0 || r.Size.W < 1 {
		t.Fatalf("MonitorRect(1) = %+v %v", r, ok)
	}
	if _, ok := MonitorRect(len(ms) + 1); ok {
		t.Fatal("olmayan monitör")
	}
	if _, err := Open(len(ms) + 1); err == nil {
		t.Fatal("olmayan monitör açıldı")
	} else if e, _ := AsError(err); e == nil || e.Reason != ReasonNoOutput || e.ShareMethod() != "" {
		t.Fatalf("hata %v", err)
	}
	t.Logf("monitörler: %+v", ms)
}

// AC-105 / AC-392: kilitsiz oturumda güvenli masaüstü yok (kilit ekranı senaryosu elle, runbook).
// Pozitif kontrol: sözlükte konsol anahtarı bulunur ve doğrudur (anahtar adları başlıktaki CFSTR değerleri; kilit
// anahtarı belgelenmemiştir ve yalnız kilitliyken bulunur → elle).
func TestP28fK2AC105EnvProbeUnlocked(t *testing.T) {
	if fwErr != nil {
		t.Skip(fwErr)
	}
	d := cgSessionCopyDc()
	if d == 0 {
		t.Skip("oturum sözlüğü yok (konsol oturumu değil)")
	}
	defer cfRelease(d)
	k := sessionKeys()
	if oc := boolKey(d, k.onConsole); !oc.set || !oc.v {
		t.Fatalf("kCGSSessionOnConsoleKey okunamadı: %+v", oc)
	}
	if st := EnvProbe(); st.SecureDesktop || st.ElevatedForeground {
		t.Skipf("oturum kilitli görünüyor: %+v (elle doğrula)", st)
	}
}

// Akış sistemce durdurulursa (kilit, ekran çıkarma, kip değişimi) kaynak son kareyle sürer, yeniden açar ve IDR üretir.
func TestP28fK2AC392StreamStopReopens(t *testing.T) {
	needCapture(t)
	src, err := open(1, streamOpts{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer src.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if _, err := src.NextFrame(ctx); err != nil {
		t.Fatal(err)
	}
	old := src.p.st
	old.slot.stop() // didStopWithError: taklidi
	gotIDR := false
	for range 200 {
		f, err := src.NextFrame(ctx)
		if err != nil {
			t.Fatalf("durma sonrası NextFrame: %v", err)
		}
		if idr, _, _ := auKinds(f.Data); idr && src.p.st != nil && src.p.st != old {
			gotIDR = true
			break
		}
	}
	if !gotIDR {
		t.Fatal("yeniden açılan akıştan IDR gelmedi")
	}
}

// AC-392 / ADR-0037 m.2: SCK + VT kaynağı: ilk kare IDR (SPS/PPS önde), boyut uzun kenar ≤ 1920, PLI isteği IDR üretir,
// ekran değişmese de 1 sn'de bir kare (idleKeepAlive), Close sonrası NextFrame hata.
func TestP28fK2AC392SourceSmoke(t *testing.T) {
	needCapture(t)
	src, err := open(1, streamOpts{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if max(src.p.cur.W, src.p.cur.H) > maxLongSide || src.p.cur.W%2 != 0 {
		t.Fatalf("kodlama boyutu %dx%d", src.p.cur.W, src.p.cur.H)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	f, err := src.NextFrame(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if idr, sps, pps := auKinds(f.Data); !(idr && sps && pps) {
		t.Fatal("ilk kare IDR + SPS/PPS değil")
	}
	gotIDR := false
	src.RequestKeyframe()
	for range 60 {
		f, err := src.NextFrame(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if idr, _, _ := auKinds(f.Data); idr {
			gotIDR = true
			break
		}
	}
	if !gotIDR {
		t.Fatal("RequestKeyframe IDR üretmedi")
	}
	if src.nap == 0 {
		t.Error("App Nap etkinliği başlatılmadı")
	}
	_ = src.Close()
	_ = src.Close()
	if _, err := src.NextFrame(ctx); err == nil {
		t.Fatal("kapalı kaynak kare verdi")
	}
}

// ADR-0037 m.2: kendi pencerelerimiz yakalamaya girmez. Pozitif kontrol (hariç tutma yok) macentayı görmeli; negatif
// (üretim) görmemeli; uygulama açılışta listede yoksa (henüz pencere yok) sonradan dışlanmalı.
func TestP28fK2AC392OwnWindowsExcluded(t *testing.T) {
	needCapture(t)
	probeWindow(t)
	time.Sleep(300 * time.Millisecond)
	check := func(opt streamOpts) (seen, total int, excluded bool) {
		src, err := open(1, opt)
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		defer src.Close()
		framesFor(t, src, 2*time.Second, func(f *NV12) {
			total++
			if magentaAtCenter(f) {
				seen++
			}
		})
		return seen, total, src.p.st != nil && src.p.st.excluded.Load()
	}
	if seen, total, _ := check(streamOpts{noExclude: true}); seen == 0 {
		t.Fatalf("pozitif kontrol: %d karede macenta görülmedi (yoklama geçersiz)", total)
	}
	seen, total, excluded := check(streamOpts{})
	if !excluded || seen != 0 || total == 0 {
		t.Fatalf("üretim: hariç=%v macenta %d/%d", excluded, seen, total)
	}
	t.Logf("kendi pencere: pozitif kontrol görüldü, üretimde %d karede 0", total)
}

// Ölçüm (P28f K2, ADR-0037 m.2 ölçütü: 30 fps sürdürülebilir, kodlama p95 ≤ 33 ms, kare kaybı 0). Uzun sürdüğü için
// yalnız NK_K2_OLCUM=<sn> ile koşar. Hareket kaynağı kendi penceremizdir (60 Hz renk), bu yüzden hariç tutma kapalı.
// Tanımlar: p95 = ana Encode duvar süresi; adım = ana + düşük kodlama; kare kaybı = çıktısız Encode + VT atlaması +
// zaman aşımı; fps = yayımlanan kare / süre.
func TestP28fK2Measure(t *testing.T) {
	secs, _ := strconv.Atoi(os.Getenv("NK_K2_OLCUM"))
	if secs <= 0 {
		t.Skip("NK_K2_OLCUM=<sn> verilmedi")
	}
	needCapture(t)
	w := probeWindow(t)
	stop := make(chan struct{})
	go func() {
		q, _ := objc.MainQueue()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-time.After(16 * time.Millisecond):
			}
			v := float64(i%60) / 60
			_ = objc.Async(q, func() { objc.Pool(func() { setColor(w, v, 1-v, 0.5); w.Send(objc.Sel("display")) }) })
		}
	}()
	defer close(stop)
	for _, low := range []bool{true, false} {
		measure(t, time.Duration(secs)*time.Second, low)
	}
}

func measure(t *testing.T, d time.Duration, low bool) {
	src, err := open(1, streamOpts{noExclude: true})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer src.Close()
	src.p.stats.on = true
	var lowBytes, lowFrames atomic.Int64
	if low {
		src.SetLowSink(func(f rtc.Frame) { lowBytes.Add(int64(len(f.Data))); lowFrames.Add(1) })
		src.EnableLow(true)
	}
	var mainBytes int64
	t0 := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	for {
		f, err := src.NextFrame(ctx)
		if err != nil {
			break
		}
		mainBytes += int64(len(f.Data))
	}
	el := time.Since(t0).Seconds()
	st := src.p.stats
	enc := innerVT(src.p.enc)
	loss := st.empty
	hw := false
	if enc != nil {
		loss += enc.dropped + enc.timeouts
		hw = enc.UsingHardware()
	}
	src.p.st.slot.mu.Lock()
	delivered, bad := src.p.st.slot.delivered, src.p.st.slot.bad
	src.p.st.slot.mu.Unlock()
	p50, p95, mx := pct(st.encodeNs, 50), pct(st.encodeNs, 95), pct(st.encodeNs, 100)
	s95 := pct(st.stepNs, 95)
	fps := float64(st.emitted) / el
	t.Logf("düşük iz=%v boyut %dx%d donanım=%v süre %.1f sn: SCK Complete %d (%.1f/sn, kopyalanamayan %d); yayımlanan %d (%.1f fps); "+
		"Encode p50 %v p95 %v maks %v; ana+düşük adım p95 %v; kare kaybı %d; ana %.2f Mbit/s; düşük %d kare %.2f Mbit/s; hedef fps %d",
		low, src.p.cur.W, src.p.cur.H, hw, el, delivered, float64(delivered)/el, bad, st.emitted, fps,
		p50.Round(10*time.Microsecond), p95.Round(10*time.Microsecond), mx.Round(10*time.Microsecond), s95.Round(10*time.Microsecond),
		loss, float64(mainBytes*8)/el/1e6, lowFrames.Load(), float64(lowBytes.Load()*8)/el/1e6, src.p.rc.FPS())
	if fps < 28 || p95 > 33*time.Millisecond || loss != 0 {
		t.Errorf("ölçüt tutmadı (low=%v): fps %.1f ≥ 28, p95 %v ≤ 33 ms, kayıp %d = 0", low, fps, p95, loss)
	}
}

func innerVT(e Encoder) *vtEncoder {
	switch x := e.(type) {
	case *vtEncoder:
		return x
	case *fallbackEncoder:
		v, _ := x.cur.(*vtEncoder)
		return v
	}
	return nil
}

func pct(d []time.Duration, p int) time.Duration {
	if len(d) == 0 {
		return 0
	}
	c := slices.Clone(d)
	slices.Sort(c)
	return c[min(len(c)-1, len(c)*p/100)]
}

// Açılışta uygulamamızın penceresi yoksa SCK listesinde de olmayabilir; pencere sonradan açılınca akış dışlamalı
// filtreyle yeniden açılmalı (excludeLater) ve macenta ≤ 1 sn içinde görüntüden çıkıp öyle kalmalı. Yol lateExclude
// ile zorlanır: aksi hâlde runner durumuna göre uygulama açılışta zaten listede olur ve test geç yolu hiç sınamaz.
func TestP28fK2AC392LateWindowExcluded(t *testing.T) {
	needCapture(t)
	src, err := open(1, streamOpts{lateExclude: true})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer src.Close()
	first := src.p.st
	if first.excluded.Load() {
		t.Fatal("lateExclude açılışı dışlamalı başladı")
	}
	src.p.opt = streamOpts{} // yeniden açılış üretim yolundan; NextFrame yalnız bu goroutine'den çağrılır
	probeWindow(t)
	// Tek geçiş: yeni akışın ilk kareleri de ölçülür. Eski akıştan kare (dışlama öncesi) macenta içerebilir; yeniden
	// açılışta eski kare atıldığı için sonrasında kodlanan her kare yeni (dışlamalı) akıştandır ve macenta 0 olmalı.
	var pre, preMag, post, postMag int
	var firstAt time.Time
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) && (firstAt.IsZero() || time.Since(firstAt) < 1500*time.Millisecond) {
		framesFor(t, src, 100*time.Millisecond, func(f *NV12) {
			m := magentaAtCenter(f)
			if src.p.st == first {
				pre++
				if m {
					preMag++
				}
				return
			}
			if firstAt.IsZero() {
				firstAt = time.Now()
			}
			post++
			if m {
				postMag++
			}
		})
	}
	reopenedAt := src.p.stats.reopenedAt
	if firstAt.IsZero() || reopenedAt.IsZero() || src.p.st == nil || !src.p.st.excluded.Load() {
		t.Fatalf("uygulama sonradan dışlanmadı: dışlama öncesi %d kare (%d macenta), sonrası %d", pre, preMag, post)
	}
	if preMag == 0 {
		t.Fatalf("pozitif kontrol: dışlama öncesi macenta görülmedi (%d kare); 'sonrası 0' kanıt sayılmaz", pre)
	}
	lag := firstAt.Sub(reopenedAt)
	if postMag != 0 || lag > time.Second {
		t.Fatalf("dışlama sonrası: ilk taze kare %v (≤ 1 sn), macenta %d/%d; öncesi %d/%d",
			lag.Round(time.Millisecond), postMag, post, preMag, pre)
	}
	t.Logf("geç dışlama: öncesi %d karede %d macenta; yeniden açılış→ilk taze kare %v; sonrası %d karede macenta 0",
		pre, preMag, lag.Round(time.Millisecond), post)
}

// Open ilk kareyi beklerken yeniden açılış istenirse (excludeLater ilk kareden önce) hata dönmez: akış bir kez yeniden
// açılır, kancalar temizlenir ve ilk kare ikinci akıştan gelir.
func TestP28fK2AC392OpenReopenBeforeFirstFrame(t *testing.T) {
	needCapture(t)
	src, err := open(1, streamOpts{lateExclude: true, haltFirst: true})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer src.Close()
	if src.p.opt.lateExclude || src.p.opt.haltFirst {
		t.Fatalf("yeniden açılış dalı koşmadı: opt %+v", src.p.opt)
	}
	if src.p.st == nil || src.p.cur == nil {
		t.Fatal("ikinci akış ya da ilk kare yok")
	}
	src.p.st.slot.mu.Lock()
	reopen := src.p.st.slot.reopen
	src.p.st.slot.mu.Unlock()
	if reopen {
		t.Fatal("ikinci akış da yeniden açılış bekliyor")
	}
	if n := framesFor(t, src, 500*time.Millisecond, nil); n == 0 {
		t.Fatal("yeniden açılan akıştan kare gelmedi")
	}
}

// D-392-2: dışlamasız akış sistemce durursa son kare (penceremizi içerebilir) atılır; dışlamalı akışınki korunur.
func TestP28fK2AC392StoppedUnexcludedDropsFrame(t *testing.T) {
	for _, excluded := range []bool{false, true} {
		st := &sckStream{slot: newSlot(), quit: make(chan struct{})}
		st.excluded.Store(excluded)
		st.slot.stop()
		cur := NewNV12(2, 2)
		p := &pipeline{st: st, cur: cur}
		changed, err := p.grab(context.Background(), make(chan struct{}))
		if changed || err != nil || p.st != nil {
			t.Fatalf("excluded=%v: grab %v %v st=%v", excluded, changed, err, p.st)
		}
		if kept := p.cur == cur; kept != excluded {
			t.Fatalf("excluded=%v: son kare korundu=%v", excluded, kept)
		}
	}
}

// Sistem durdurması (errStreamStopped: dışlamalı akışta son kare korunur) ile dışlama yeniden açılışı (errStreamReopen: son kare
// atılır) ayrışır; ikisi birlikte gelirse yeniden açılış önceliklidir.
func TestP28fK2AC392SlotReopenDistinct(t *testing.T) {
	s := newSlot()
	s.stop()
	if _, err := s.poll(); !errors.Is(err, errStreamStopped) {
		t.Fatalf("stop: %v", err)
	}
	s.halt(true)
	if _, err := s.poll(); !errors.Is(err, errStreamReopen) {
		t.Fatalf("halt(true): %v", err)
	}
	s.stop()
	if _, err := s.poll(); !errors.Is(err, errStreamReopen) {
		t.Fatalf("halt(true) sonrası stop: %v", err)
	}
}
