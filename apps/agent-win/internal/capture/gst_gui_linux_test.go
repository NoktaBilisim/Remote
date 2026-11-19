//go:build linux && linuxgui

package capture

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/rtc"
)

// K8a sözleşmesi: yalnız test-linux-gui imajında (P28G_GUI=x11, Xvfb :99). P28G_GUI boşsa yerel geliştirmede SKIP.
func needX11(t *testing.T) {
	t.Helper()
	if os.Getenv("P28G_GUI") != "x11" {
		t.Skip("SKIP: P28G_GUI=x11 (test-linux-gui imajı) gerekir")
	}
	if !ValidDisplay(os.Getenv("DISPLAY")) {
		t.Fatal("DISPLAY geçersiz")
	}
}

// measure kaynaktan d boyunca kare çeker.
func measure(t *testing.T, s *gstSource, d time.Duration) (frames, keys, bytes int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	for {
		f, err := s.NextFrame(ctx)
		if err != nil {
			return
		}
		frames++
		bytes += len(f.Data)
		if vp8Key(f.Data) {
			keys++
		}
	}
}

// T6 ikinci katman (K8a zorunlu adı): gerçek hatta gst_bin_iterate_recurse fabrika adları listede; liste dışı öğeli
// hat başlatılmaz.
func TestP28gK2GUIRuntimeWhitelist(t *testing.T) {
	needX11(t)
	d, err := buildPipeline(pipeSpec{X: 0, Y: 0, W: 640, H: 480, OutW: 640, OutH: 480, BPS: 1_000_000, LowW: 320, LowH: 240})
	if err != nil {
		t.Fatal(err)
	}
	p, err := startPipe(d)
	if err != nil {
		t.Fatalf("ürün hattı başlamadı: %v", err)
	}
	if !p.elementsAllowed() {
		t.Fatal("ürün hattı beyaz listede değil")
	}
	p.close()
	cd, _ := glib.CString("videotestsrc ! fakesink")
	var gerr uintptr
	pipe := gst.parseLaunch(cd, &gerr)
	if gerr != 0 || pipe == 0 {
		t.Fatal("deneme hattı ayrıştırılamadı")
	}
	bad := &gstPipe{pipe: pipe}
	defer bad.close()
	if bad.elementsAllowed() {
		t.Fatal("videotestsrc/fakesink kabul edildi")
	}
	if _, err := startPipe("videotestsrc ! fakesink"); err == nil {
		t.Fatal("liste dışı hat başlatıldı")
	}
}

// AC-398 (K8a zorunlu adı): Xvfb'de 5 sn VP8 kare, anahtar kare biti, düşük akış, zorlanan anahtar kare.
func TestP28gK2GUIXimagesrcVP8Frames(t *testing.T) {
	needX11(t)
	if !ValidDisplay(os.Getenv("DISPLAY")) {
		t.Fatalf("DISPLAY geçersiz")
	}
	t0 := time.Now()
	s, err := openGst(pipeSpec{X: 0, Y: 0, W: 1920, H: 1080}, 1920, 1080, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	t.Logf("açılış (ilk kare dahil) %v, basamak %d", time.Since(t0), s.lad.Edge())
	if !vp8Key(s.first) {
		t.Fatal("ilk kare anahtar kare değil (§14 m.5)")
	}
	var lows atomic.Int32
	s.SetLowSink(func(rtc.Frame) { lows.Add(1) })
	s.EnableLow(true)
	n, k, b := measure(t, s, 5*time.Second)
	t.Logf("5 sn: ana kare=%d anahtar=%d ort. bit hızı=%.2f Mbit/s düşük kare=%d", n, k, float64(b*8)/5e6, lows.Load())
	if n < 100 || lows.Load() < 20 {
		t.Fatalf("kare az: ana %d düşük %d", n, lows.Load())
	}
	// K10 (qa m.2 kök nedeni): NextFrame zorlamayı son anahtar kareden keyMinGap (500 ms) sonraya erteler (§7 PLI seli).
	// 22.04'te doğal anahtar kare istekten ~80 ms önce geldiğinde test bu ertelemeyi "gelmedi" sanıyordu. Önce aralık
	// dolana kadar kare tüketilir; böylece §7 "≤ 2 kare" ölçütü zorlamanın kendisini sınar.
	drain, dcancel := context.WithTimeout(context.Background(), 3*time.Second)
	for time.Since(s.lastKey) < keyMinGap+50*time.Millisecond {
		if _, err := s.NextFrame(drain); err != nil {
			dcancel()
			t.Fatalf("aralık beklenirken kare yok: %v", err)
		}
	}
	dcancel()
	if got := forcedKeyAfter(t, s, 10); got < 0 || got > 2 {
		t.Fatalf("anahtar kare ≤ 2 karede gelmedi: %d", got)
	}
	// Kötü durum (22.04'teki CI koşusu): istek doğal/zorlanmış anahtar kareden hemen sonra. Zorlama ertelenir ama
	// kaybolmaz: keyMinGap + 2 kare içinde gelir.
	if got := forcedKeyAfter(t, s, int(keyMinGap/frameInterval)+gstFPS/2); got < 0 {
		t.Fatal("ertelenen anahtar kare isteği kayboldu")
	}
}

// forcedKeyAfter anahtar kare ister ve kaçıncı karede geldiğini döner (en çok n kare / 2 sn; gelmezse -1).
func forcedKeyAfter(t *testing.T, s *gstSource, n int) int {
	t.Helper()
	s.RequestKeyframe()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for i := range n {
		f, err := s.NextFrame(ctx)
		if err != nil {
			break
		}
		if vp8Key(f.Data) {
			t.Logf("zorlanan anahtar kare %d kare sonra", i)
			return i
		}
	}
	t.Logf("zorlanan anahtar kare %d karede gelmedi", n)
	return -1
}
