//go:build darwin

package capture

import (
	"bufio"
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/cgwin"
	"remote-support/agent-win/internal/darwin/objc"
)

// P33 K2 / K0s-W1 (mimari-p33 §6.3, §10.1): SCK masaüstünden bağımsız pencere akışının otomatik ölçümü. Hedef bu test
// sürecinin başlıklı, boyutlandırılabilir penceresidir (renk 60 Hz değişir); örtücü yine bizim, daha üst düzeyde yeşil
// penceredir. Başka süreçten örtücü, Space/tam ekran geçişi elle adımdır (implementation.md P33-K2).
// Süre: NK_K2W1_OLCUM=<sn> (varsayılan 3 sn fps penceresi).

func titledWindow(t *testing.T, x, y, w, h float64, level int, r, g, b float64) objc.ID {
	t.Helper()
	var win objc.ID
	onMain(t, func() {
		rc := objc.CGRect{Origin: objc.CGPoint{X: x, Y: y}, Size: objc.CGSize{W: w, H: h}}
		wc, _ := objc.GetClass("NSWindow")
		style := uint(1 | 2 | 4 | 8) // titled | closable | miniaturizable | resizable
		if level > 0 {
			style = 0
		}
		win = objc.ID(wc).Send(objc.Sel("alloc")).Send(objc.Sel("initWithContentRect:styleMask:backing:defer:"), rc, style, uint(2), false)
		win.Send(objc.Sel("setReleasedWhenClosed:"), false)
		win.Send(objc.Sel("setRestorable:"), false)
		if level > 0 {
			win.Send(objc.Sel("setLevel:"), level)
			win.Send(objc.Sel("setIgnoresMouseEvents:"), true)
		}
		setColor(win, r, g, b)
		win.Send(objc.Sel("orderFrontRegardless"))
	})
	return win
}

// greenAtCenter yeşil örtücü karede mi (709 sınırlı: Y≈173 U≈42 V≈26).
func greenAtCenter(f *NV12) bool {
	x, y := f.W/2, f.H/2
	o := f.W*f.H + (y/2)*f.W + (x/2)*2
	return f.Data[y*f.W+x] > 120 && f.Data[o] < 90 && f.Data[o+1] < 90
}

func isPlate(f *NV12) bool {
	if f == nil {
		return false
	}
	for _, b := range f.Data[f.W*f.H:] {
		if b != plateChroma {
			return false
		}
	}
	return true
}

// waitFor NextFrame'i cond doğru olana dek (en çok d) çağırır; geçen süre ve son hata.
func waitFor(s *source, d time.Duration, cond func() bool) (time.Duration, error) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	for !cond() {
		if _, err := s.NextFrame(ctx); err != nil {
			return time.Since(start), err
		}
	}
	return time.Since(start), nil
}

func TestP33K2W1WindowStream(t *testing.T) {
	needCapture(t)
	if !WindowCaptureSupported() {
		t.Skip("SCK masaüstünden bağımsız pencere filtresi yok")
	}
	secs, _ := strconv.Atoi(os.Getenv("NK_K2W1_OLCUM"))
	if secs < 1 {
		secs = 3
	}
	win := titledWindow(t, 200, 200, 480, 320, 0, 1, 0, 1)
	released := false
	t.Cleanup(func() {
		if !released {
			onMain(t, func() { objc.Release(win) })
		}
	})
	stop := make(chan struct{})
	go func() { // 60 Hz içerik
		q, _ := objc.MainQueue()
		tick := time.NewTicker(16 * time.Millisecond)
		defer tick.Stop()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-tick.C:
			}
			v := float64(i%2) * 0.6
			_ = objc.Async(q, func() { objc.Pool(func() { setColor(win, 1, v, 1) }) })
		}
	}()
	defer func() {
		if stop != nil {
			close(stop)
		}
	}()
	var wid uint32
	onMain(t, func() { wid = uint32(pobjc.Send[int](win, objc.Sel("windowNumber"))) })
	time.Sleep(300 * time.Millisecond)
	cw, _ := cgwin.Get(wid)
	t.Logf("CG: katman %d ekranda %v çerçeve %.0fx%.0f", cw.Layer, cw.OnScreen, cw.Bounds.Size.W, cw.Bounds.Size.H)

	src, err := openWindow(wid)
	if err != nil {
		t.Fatalf("openWindow: %v", err)
	}
	defer src.Close()
	// Örtücü: hedefin ortasının üstünde, daha üst düzeyde yeşil pencere (AC-544/T7).
	occ := titledWindow(t, 360, 280, 160, 160, 3, 0, 1, 0)
	time.Sleep(200 * time.Millisecond)
	total, green := 0, 0
	framesFor(t, src, time.Duration(secs)*time.Second, func(f *NV12) {
		total++
		if greenAtCenter(f) {
			green++
		}
	})
	fps := float64(total) / float64(secs)
	t.Logf("W1 fps %.1f (%d kare / %d sn), örtücü görünen kare %d, boyut %dx%d", fps, total, secs, green,
		src.p.cur.W, src.p.cur.H)
	onMain(t, func() { occ.Send(objc.Sel("close")); objc.Release(occ) })
	if green != 0 {
		t.Fatalf("örtücü pencere karede göründü (%d) — yalnız-pencere karesi FAIL", green)
	}
	if fps < 25 && os.Getenv("NK_K2W1_OLCUM") != "" { // ölçüt yalnız ölçüm kipinde (CI/yük altında oynak)
		t.Errorf("fps %.1f < 25", fps)
	}

	// Boyut değişimi → updateConfiguration (≤ 2 sn).
	onMain(t, func() {
		f := pobjc.Send[objc.CGRect](win, objc.Sel("frame"))
		f.Size = objc.CGSize{W: 800, H: 500}
		win.Send(objc.Sel("setFrame:display:"), f, true)
	})
	time.Sleep(300 * time.Millisecond)
	cw, _ = cgwin.Get(wid)
	ww, wh := windowOutSize(cw.Bounds)
	d, err := waitFor(src, 3*time.Second, func() bool { return src.p.cur != nil && src.p.cur.W == ww && src.p.cur.H == wh })
	t.Logf("boyut değişimi: %dx%d ilk kare %v (err %v)", ww, wh, d, err)
	if err != nil || d > 2*time.Second {
		t.Errorf("boyut değişimi süresi %v > 2 sn", d)
	}

	// Görünmezlik: küçült ve gizle (orderOut ≈ ⌘H) → plaka; geri gelince ≤ 2 sn taze kare.
	for _, c := range []struct{ name, off, on string }{
		{"küçültme", "miniaturize:", "deminiaturize:"},
		{"gizleme (orderOut)", "orderOut:", "orderFrontRegardless"},
	} {
		onMain(t, func() {
			if c.off == "orderOut:" || c.off == "miniaturize:" {
				win.Send(objc.Sel(c.off), objc.ID(0))
			}
		})
		d, err := waitFor(src, 3*time.Second, func() bool { return src.p.track.hidden && isPlate(src.p.cur) })
		cw, _ := cgwin.Get(wid)
		t.Logf("%s: plaka %v (err %v); CG ekranda=%v", c.name, d, err, cw.OnScreen)
		if err != nil {
			t.Fatalf("%s: plaka gelmedi", c.name)
		}
		if src.p.st != nil {
			t.Fatalf("%s: görünmezken akış açık kaldı", c.name)
		}
		onMain(t, func() {
			if c.on == "deminiaturize:" {
				win.Send(objc.Sel(c.on), objc.ID(0))
			} else {
				win.Send(objc.Sel(c.on))
			}
		})
		d, err = waitFor(src, 4*time.Second, func() bool { return !src.p.track.hidden && !isPlate(src.p.cur) })
		t.Logf("%s: geri dönüş taze kare %v (err %v)", c.name, d, err)
		if err != nil || d > 2*time.Second+winPollEvery {
			t.Errorf("%s: geri dönüş %v", c.name, d)
		}
	}

}

// helperEnv test ikilisi bu ortam değişkeniyle yardımcı kipte açılır: başlıklı pencere açar, kimliğini stdout'a
// yazar, stdin kapanınca çıkar (gerçek kapanış: pencere sunucusundaki pencere yok olur).
const helperEnv = "NK_P33_YARDIMCI_PENCERE"

func runHelperWindow() int {
	var win objc.ID
	objc.Pool(func() {
		wc, _ := objc.GetClass("NSWindow")
		rc := objc.CGRect{Origin: objc.CGPoint{X: 260, Y: 260}, Size: objc.CGSize{W: 420, H: 300}}
		win = objc.ID(wc).Send(objc.Sel("alloc")).Send(objc.Sel("initWithContentRect:styleMask:backing:defer:"), rc, uint(15), uint(2), false)
		setColor(win, 0, 0.5, 1)
		win.Send(objc.Sel("orderFrontRegardless"))
	})
	os.Stdout.WriteString(strconv.Itoa(pobjc.Send[int](win, objc.Sel("windowNumber"))) + "\n")
	eof := make(chan struct{})
	go func() {
		buf := make([]byte, 1)
		for {
			if _, err := os.Stdin.Read(buf); err != nil {
				close(eof)
				return
			}
		}
	}()
	for {
		select {
		case <-eof:
			return 0
		default:
		}
		objc.Pool(func() { pump(20 * time.Millisecond) })
	}
}

// AC-546: başka süreçteki pencere kapanınca (süreç çıkışı) kalıcı WINDOW_CLOSED; tüm ekrana geçilmez.
func TestP33K2W1OtherProcessWindowClosed(t *testing.T) {
	needCapture(t)
	exe, err := os.Executable()
	if err != nil {
		t.Skip(err)
	}
	cmd := exec.Command(exe, "-test.run=^$")
	cmd.Env = append(os.Environ(), helperEnv+"=1")
	in, _ := cmd.StdinPipe()
	out, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Skip(err)
	}
	defer func() { _ = in.Close(); _ = cmd.Wait() }()
	line, err := bufio.NewReader(out).ReadString('\n')
	wid, _ := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || wid == 0 {
		t.Fatalf("yardımcı pencere: %q %v", line, err)
	}
	time.Sleep(400 * time.Millisecond)
	src, err := openWindow(uint32(wid))
	if err != nil {
		t.Fatalf("openWindow: %v", err)
	}
	defer src.Close()
	n := framesFor(t, src, 2*time.Second, nil)
	_ = in.Close()
	_ = cmd.Wait()
	d, err := waitFor(src, 3*time.Second, func() bool { return false })
	e, ok := AsError(err)
	t.Logf("başka süreç: %d kare/2 sn; kapanıştan %v sonra %v", n, d, err)
	if !ok || e.Reason != ReasonWindowClosed || e.ShareMethod() != "WGC" || src.p.cur != nil || src.p.st != nil {
		t.Fatalf("WINDOW_CLOSED beklenirdi: %v", err)
	}
	if _, err2 := src.NextFrame(context.Background()); !errors.Is(err2, err) {
		t.Fatalf("kapanış kalıcı olmalı: %v", err2)
	}
}

func TestP33K2OpenWindowUnavailable(t *testing.T) {
	_, err := OpenWindow(0)
	e, ok := AsError(err)
	if !ok || e.Reason != ReasonWindowUnavailable || e.ShareMethod() != "WGC" {
		t.Fatalf("%v", err)
	}
}

// AC-543 + S-P33-T-8: gerçek liste kendi pencerelerimizi içermez; etiket dışındaki yollarda başlık yok.
func TestP33K2ShareableWindowsExcludesOwn(t *testing.T) {
	needCapture(t)
	win := titledWindow(t, 220, 220, 300, 200, 0, 0, 0, 1)
	t.Cleanup(func() { onMain(t, func() { win.Send(objc.Sel("close")); objc.Release(win) }) })
	var wid uint32
	onMain(t, func() {
		ttl, _ := objc.NSString(secretTitle)
		win.Send(objc.Sel("setTitle:"), ttl)
		wid = uint32(pobjc.Send[int](win, objc.Sel("windowNumber")))
	})
	time.Sleep(300 * time.Millisecond)
	ws, err := ShareableWindows()
	if err != nil {
		t.Fatalf("%v", err)
	}
	for _, w := range ws {
		if uint32(w.ID) == wid {
			t.Fatal("kendi penceremiz listelendi")
		}
	}
	t.Logf("paylaşılabilir pencere sayısı %d", len(ws))
}

// AC-545: plaka yazısı CoreText ile çizilir (ortada beyaz pikseller, kenarlar siyah).
func TestP33K2PlateMaskDrawn(t *testing.T) {
	m := plateMask(640, 360)
	if m == nil {
		t.Skip("CoreText bağlanamadı: düz siyah plaka (yedek)")
	}
	lit := 0
	for _, v := range m {
		if v > 128 {
			lit++
		}
	}
	if lit == 0 || m[0] != 0 || m[len(m)-1] != 0 {
		t.Fatalf("yazı çizilmedi ya da kenar dolu: %d", lit)
	}
	t.Logf("yazı pikseli %d", lit)
}
