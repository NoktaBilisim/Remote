package capture

import (
	"strings"
	"testing"
	"time"
)

func x11Spec() pipeSpec {
	return pipeSpec{X: 1920, Y: 0, W: 1280, H: 1024, OutW: 1280, OutH: 1024, BPS: 2_000_000, LowW: 640, LowH: 512}
}

func TestAC398P28gPipelineX11(t *testing.T) {
	d, err := buildPipeline(x11Spec())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"ximagesrc use-damage=false show-pointer=true startx=1920 starty=0 endx=3199 endy=1023",
		"width=1280,height=1024", "target-bitrate=2000000", "keyframe-max-dist=60", "width=640,height=512",
		"appsink name=mainsink sync=false async=false", "appsink name=lowsink sync=false async=false",
		"valve name=lowvalve drop=true"} {
		if !strings.Contains(d, want) {
			t.Fatalf("eksik %q:\n%s", want, d)
		}
	}
	if strings.Contains(d, "display-name") {
		t.Fatal("display-name yazılmamalı (S-P28g-4)")
	}
}

func TestAC399P28gPipelineWayland(t *testing.T) {
	s := x11Spec()
	s.Wayland, s.FD, s.Node = true, 7, 42
	d, err := buildPipeline(s)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(d, "pipewiresrc fd=7 path=42 do-timestamp=true keepalive-time=1000 ! ") {
		t.Fatal(d)
	}
}

// T6 / S-P28g-4: şablondaki tüm öğeler beyaz listede; GPL/otomatik seçici yok; her yer tutucu sınırlı tamsayı.
// AC-398 / T6 / S-P28g-4 (K8a zorunlu adı): şablondaki öğeler beyaz listede, yasak öğe yok, dizgiye yalnız sınırlı tamsayı.
func TestP28gK2PipelineElementsWhitelisted(t *testing.T) {
	for _, s := range []pipeSpec{x11Spec(), {Wayland: true, FD: 3, Node: 1, OutW: 16, OutH: 16, BPS: 100_000, LowW: 16, LowH: 16}} {
		d, err := buildPipeline(s)
		if err != nil {
			t.Fatal(err)
		}
		names := pipelineFactories(d)
		if !factoriesAllowed(names) {
			t.Fatalf("beyaz liste dışı öğe: %v", names)
		}
		for _, bad := range []string{"decodebin", "autovideo", "x264", "openh264", "playbin", "filesrc", "shmsrc"} {
			if strings.Contains(d, bad) {
				t.Fatalf("yasak öğe %s", bad)
			}
		}
	}
	if factoriesAllowed(nil) || factoriesAllowed([]string{"vp8enc", "x264enc"}) {
		t.Fatal("liste dışı ya da boş kabul edildi")
	}
	bad := []func(*pipeSpec){
		func(s *pipeSpec) { s.OutW = 1281 }, func(s *pipeSpec) { s.OutW = 0 }, func(s *pipeSpec) { s.BPS = 1 },
		func(s *pipeSpec) { s.W = 0 }, func(s *pipeSpec) { s.H = 99999 }, func(s *pipeSpec) { s.LowH = 3 },
		func(s *pipeSpec) { s.X = -99999 },
		func(s *pipeSpec) { s.Wayland, s.FD, s.Node = true, -1, 1 },
		func(s *pipeSpec) { s.Wayland, s.FD, s.Node = true, 3, 0 },
	}
	for i, f := range bad {
		s := x11Spec()
		f(&s)
		if _, err := buildPipeline(s); err == nil {
			t.Fatalf("%d: sınır dışı kabul edildi", i)
		}
	}
}

func TestAC398P28gValidDisplay(t *testing.T) {
	for _, ok := range []string{":0", ":1", ":10.0", ":999.99"} {
		if !ValidDisplay(ok) {
			t.Fatal(ok)
		}
	}
	for _, no := range []string{"", "0", "host:0", ":0 ! filesrc", ":1000", ":0.123", "unix:0", ":0\n", "localhost:10.0"} {
		if ValidDisplay(no) {
			t.Fatalf("%q kabul edildi", no)
		}
	}
}

func TestAC398P28gVP8KeyBit(t *testing.T) {
	if !vp8Key([]byte{0x10, 0x02}) || vp8Key([]byte{0x11}) || vp8Key(nil) {
		t.Fatal("VP8 anahtar kare biti")
	}
}

func TestAC398P28gFitEdge(t *testing.T) {
	cases := [][5]int{{1920, 1080, 1280, 1280, 720}, {1366, 768, 1280, 1280, 718}, {1024, 768, 1280, 1024, 768},
		{1080, 1920, 1280, 720, 1280}, {1919, 1079, 1920, 1918, 1078}}
	for _, c := range cases {
		if w, h := fitEdge(c[0], c[1], c[2]); w != c[3] || h != c[4] {
			t.Fatalf("%v → %dx%d", c, w, h)
		}
	}
}

// §14 m.3: 1280 başlangıç; CPU < %40 → 1600 → 1920; > %60 → iner; 30 sn'den sık değişmez; kaynaktan büyümez.
func TestAC398P28gResolutionLadder(t *testing.T) {
	t0 := time.Unix(0, 0)
	l := newLadder(1920, 1080, t0)
	if l.Edge() != defaultEdge {
		t.Fatal(l.Edge())
	}
	if l.Observe(t0.Add(10*time.Second), 0.1, 300, 34*time.Millisecond) {
		t.Fatal("30 sn dolmadan değişti")
	}
	if !l.Observe(t0.Add(30*time.Second), 0.3, 300, 34*time.Millisecond) || l.Edge() != 1600 {
		t.Fatal("1600'e çıkmalı")
	}
	if !l.Observe(t0.Add(60*time.Second), 0.3, 50, 900*time.Millisecond) || l.Edge() != 1920 {
		t.Fatal("durağan ekranda yalnız CPU ile 1920'ye çıkmalı")
	}
	if l.Observe(t0.Add(90*time.Second), 0.2, 300, 33*time.Millisecond) {
		t.Fatal("tepede kalmalı")
	}
	if !l.Observe(t0.Add(120*time.Second), 0.7, 300, 33*time.Millisecond) || l.Edge() != 1600 {
		t.Fatal("CPU > %60 → inmeli")
	}
	if !l.Observe(t0.Add(150*time.Second), 0.3, 300, 80*time.Millisecond) || l.Edge() != 1280 {
		t.Fatal("kare aralığı p95 > 50 ms → inmeli")
	}
	if l.Observe(t0.Add(180*time.Second), 0.9, 300, 80*time.Millisecond) || l.Edge() != 1280 {
		t.Fatal("en alttan inmez")
	}
	small := newLadder(1366, 768, t0)
	if small.Observe(t0.Add(time.Minute), 0.1, 300, 30*time.Millisecond) {
		t.Fatal("1366 kaynakta 1600'e çıkmamalı")
	}
}

func TestAC398P28gGapP95(t *testing.T) {
	var g gapStats
	t0 := time.Unix(0, 0)
	for i := range 101 {
		d := 33 * time.Millisecond
		if i%20 == 0 {
			d = 200 * time.Millisecond
		}
		t0 = t0.Add(d)
		g.add(t0)
	}
	if p := g.p95(); p != 33*time.Millisecond && p != 200*time.Millisecond {
		t.Fatal(p)
	}
	g.reset(t0)
	if g.p95() != 0 {
		t.Fatal("sıfırlanmadı")
	}
}

// §14 m.9: ölçülen bit hızı %20'den fazla aşarsa hedef orantılı düşer, sonra nominale %10 adımlarla döner.
func TestAC398P28gMeasuredBitrate(t *testing.T) {
	t0 := time.Unix(0, 0)
	b := newBrCtl(2_000_000, t0)
	if _, ch := b.Add(400_000, t0.Add(500*time.Millisecond)); ch {
		t.Fatal("pencere dolmadan")
	}
	// 1 sn'de 525 kB = 4,2 Mbit/s
	tg, ch := b.Add(125_000, t0.Add(time.Second))
	if !ch || tg >= 1_000_000 || tg < 900_000 {
		t.Fatalf("orantılı düşüş: %d", tg)
	}
	// %10 aşım: değişmez
	if _, ch := b.Add(int(2_150_000/8), t0.Add(2*time.Second)); ch {
		t.Fatal("eşik altı aşım değiştirmemeli")
	}
	tg, ch = b.Add(100_000, t0.Add(3*time.Second))
	if !ch || tg <= 952_380 {
		t.Fatalf("toparlanma: %d", tg)
	}
	for i := 4; i < 20; i++ {
		tg, _ = b.Add(100_000, t0.Add(time.Duration(i)*time.Second))
	}
	if tg != 2_000_000 {
		t.Fatalf("nominale dönmeli: %d", tg)
	}
	z := newBrCtl(2_000_000, t0)
	if tg, _ := z.Add(10_000_000, t0.Add(time.Second)); tg != brFloor {
		t.Fatalf("taban: %d", tg)
	}
}

// §4.4 düşük akış: ana boyutun yarısı, çift ve alt sınırlı.
func TestAC398P28gLowSize(t *testing.T) {
	if w, h := lowSize(1280, 720); w != 640 || h != 360 {
		t.Fatalf("%d×%d", w, h)
	}
	if w, h := lowSize(1, 1); w != minOutEdge || h != minOutEdge {
		t.Fatalf("alt sınır %d×%d", w, h)
	}
}
