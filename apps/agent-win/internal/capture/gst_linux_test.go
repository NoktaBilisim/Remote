//go:build linux

package capture

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
	"golang.org/x/sys/unix"

	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/portal"
	"remote-support/agent-win/internal/rtc"
)

// Entegrasyon testleri yalnız GUI imajında (test/linux, spike imajları) koşar; ortam yoksa görünür SKIP.
//   - P28G_GST_X11=1: Xvfb DISPLAY'inde ximagesrc → vp8enc (ana + düşük, anahtar kare, bit hızı, beyaz liste).
//   - P28G_GST_PW=1: başsız gnome-shell oturumunda mutter ScreenCast düğümü + pipewire soketi fd'siyle pipewiresrc
//     (ürün dizgisi, süreç içi; §14 m.12 ölçümü: durağan ekranda videorate kare tekrarlıyor mu, aynı fd'de ikinci hat).

func needGst(t *testing.T, env string) {
	t.Helper()
	if os.Getenv(env) != "1" {
		t.Skipf("SKIP: %s=1 ve GUI imajı gerekir", env)
	}
	if _, err := os.Stat(glib.Path(glib.LibGStreamer)); err != nil {
		t.Skipf("SKIP: GStreamer yok: %v", err)
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

func TestAC398P28gGstX11Integration(t *testing.T) {
	needGst(t, "P28G_GST_X11")
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
	s.RequestKeyframe()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	got := -1
	for i := range 10 {
		f, err := s.NextFrame(ctx)
		if err != nil {
			break
		}
		if vp8Key(f.Data) {
			got = i
			break
		}
	}
	t.Logf("zorlanan anahtar kare %d kare sonra", got)
	if got < 0 || got > 2 {
		t.Fatalf("anahtar kare ≤ 2 karede gelmedi: %d", got)
	}
}

func TestP28gGstPipeWireInProcess(t *testing.T) {
	needGst(t, "P28G_GST_PW")
	node := mutterNode(t)
	fd := pipewireFD(t)
	defer syscall.Close(fd)
	s, err := openGst(pipeSpec{Wayland: true, FD: fd, Node: node}, 1920, 1080, nil)
	if err != nil {
		t.Fatal(err)
	}
	n, k, _ := measure(t, s, 6*time.Second)
	t.Logf("pipewiresrc durağan ekran 6 sn: kare=%d (%.1f fps) anahtar=%d", n, float64(n)/6, k)
	s.Close()
	// aynı fd ile ikinci hat (basamak değişimi yeniden kurar)
	s2, err := openGst(pipeSpec{Wayland: true, FD: fd, Node: node}, 1920, 1080, nil)
	if err != nil {
		t.Fatalf("aynı fd ile ikinci hat: %v", err)
	}
	n2, _, _ := measure(t, s2, 3*time.Second)
	s2.Close()
	t.Logf("ikinci hat 3 sn: kare=%d", n2)
	if n == 0 || n2 == 0 {
		t.Fatal("kare yok")
	}
}

// pipewireFD varsayılan pipewire soketine bağlı fd (portal'ın OpenPipeWireRemote'unun yerine; aynı pipewiresrc fd= yolu).
func pipewireFD(t *testing.T) int {
	t.Helper()
	fd, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	sa := &syscall.SockaddrUnix{Name: filepath.Join(os.Getenv("XDG_RUNTIME_DIR"), "pipewire-0")}
	if err := syscall.Connect(fd, sa); err != nil {
		t.Fatal(err)
	}
	return fd
}

// mutterNode mutter ScreenCast ile birincil monitörün PipeWire düğümü (yalnız test düzeneği; ürün yolu portaldır).
func mutterNode(t *testing.T) uint32 {
	t.Helper()
	c, err := dbus.ConnectSessionBus()
	if err != nil {
		t.Skipf("SKIP: oturum veri yolu yok: %v", err)
	}
	t.Cleanup(func() { c.Close() })
	var sp dbus.ObjectPath
	if err := c.Object("org.gnome.Mutter.ScreenCast", "/org/gnome/Mutter/ScreenCast").
		Call("org.gnome.Mutter.ScreenCast.CreateSession", 0, map[string]dbus.Variant{}).Store(&sp); err != nil {
		t.Skipf("SKIP: mutter ScreenCast yok: %v", err)
	}
	sess := c.Object("org.gnome.Mutter.ScreenCast", sp)
	var stp dbus.ObjectPath
	if err := sess.Call("org.gnome.Mutter.ScreenCast.Session.RecordMonitor", 0, "",
		map[string]dbus.Variant{"cursor-mode": dbus.MakeVariant(uint32(1))}).Store(&stp); err != nil {
		t.Fatal(err)
	}
	if err := c.AddMatchSignal(dbus.WithMatchObjectPath(stp)); err != nil {
		t.Fatal(err)
	}
	ch := make(chan *dbus.Signal, 4)
	c.Signal(ch)
	if err := sess.Call("org.gnome.Mutter.ScreenCast.Session.Start", 0).Err; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sess.Call("org.gnome.Mutter.ScreenCast.Session.Stop", 0) })
	select {
	case sg := <-ch:
		if n, ok := sg.Body[0].(uint32); ok {
			return n
		}
	case <-time.After(5 * time.Second):
	}
	t.Fatal("PipeWire düğümü gelmedi")
	return 0
}

// TestP28gDumpableMeasure §5.3 / D-P28g-T2-4: PR_SET_DUMPABLE=0 (a) açılışta — pipewire bağlantısı ve portal oturumu
// kurulmadan önce — ya da (b) bunlar kurulduktan sonra uygulanırsa portal (CreateSession → Select → Start'a kadar) ve
// pipewiresrc kareleri çalışıyor mu. P28G_DUMPABLE=a|b. Start sistem diyaloğunda bekler; 4 sn'de iptal edilmesi
// (ErrCancelled) önceki adımların kabul edildiğini gösterir.
func TestP28gDumpableMeasure(t *testing.T) {
	point := os.Getenv("P28G_DUMPABLE")
	if point != "a" && point != "b" && point != "n" {
		t.Skip("SKIP: P28G_DUMPABLE=a|b|n (n: karşılaştırma, uygulanmaz) ve başsız gnome-shell oturumu gerekir")
	}
	setDumpable := func() {
		if err := unix.Prctl(unix.PR_SET_DUMPABLE, 0, 0, 0, 0); err != nil {
			t.Fatal(err)
		}
	}
	if point == "a" {
		setDumpable()
	}
	node := mutterNode(t)
	fd := pipewireFD(t)
	defer syscall.Close(fd)
	s, err := openGst(pipeSpec{Wayland: true, FD: fd, Node: node}, 1920, 1080, nil)
	if err != nil {
		t.Fatalf("pipewiresrc (%s): %v", point, err)
	}
	defer s.Close()
	b, err := portal.Connect(os.Getenv("DBUS_SESSION_BUS_ADDRESS"))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if point == "b" {
		setDumpable()
	}
	_, perr := portal.Open(ctx, b, portal.Options{Control: true})
	n, _, _ := measure(t, s, 3*time.Second)
	d, _ := unix.PrctlRetInt(unix.PR_GET_DUMPABLE, 0, 0, 0, 0)
	t.Logf("nokta %s: dumpable=%d, portal Start'a kadar=%v (ErrCancelled = diyalog açıldı), pipewiresrc 3 sn kare=%d",
		point, d, perr, n)
	if n == 0 {
		t.Fatalf("nokta %s: kare yok", point)
	}
}
