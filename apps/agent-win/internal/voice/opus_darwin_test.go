//go:build darwin

package voice

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/helpermode"
	"remote-support/agent-win/internal/darwin/sandbox"
	"remote-support/agent-win/internal/macperm"
)

// Test ikilisi yardımcı olarak kendini çalıştırır (argv tam [exe, "--opus-cozucu"]); .app denetimi test dikişiyle aşılır.
func TestMain(m *testing.M) {
	if helpermode.Active {
		os.Exit(RunDecoderHelper())
	}
	if os.Getenv("NOKTA_PROBE_CHILD") == "1" {
		os.Exit(probeChild())
	}
	if os.Getenv("NOKTA_MACH_CHILD") == "1" {
		os.Exit(machChild())
	}
	helperPath = os.Executable
	os.Exit(m.Run())
}

func testHelperDecoder(t testing.TB) (*Decoder, *helperProc) {
	t.Helper()
	h := newHelperProc()
	t.Cleanup(h.close)
	d, err := newDecoderWith(h.newCodec)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Unix(0, 0)
	d.now = func() time.Time { t0 = t0.Add(20 * time.Millisecond); return t0 }
	waitReady(t, h)
	return d, h
}

func waitReady(t testing.TB, h *helperProc) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		h.mu.Lock()
		ok := h.conn != nil
		h.ensureStart()
		h.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("yardımcı 5 sn içinde hazır olmadı")
}

// decodeWait gerçek yardımcıyla çözer; tik sınırı (yük altındaki test makinesi) aşılırsa bayat yanıt atılıp yeniden denenir.
func decodeWait(t testing.TB, d *Decoder, p []byte) []int16 {
	t.Helper()
	for range 50 {
		pcm, err := d.Decode(p)
		if err == nil {
			return pcm
		}
		if !errors.Is(err, errHelperSlow) && !errors.Is(err, errHelperBusy) && !errors.Is(err, errHelperNotReady) {
			t.Fatalf("çözme: %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("çözme tamamlanmadı")
	return nil
}

// S-P33-T2-2 / T2-3: yardımcı yalnız hazır baytından sonra kullanılır ve sandbox_check(çocuk) = 1'dir; argv ve ortam
// boştur. Sandbox içinde ev dizini okuması, /tmp yazması, ağ ve exec EPERM'dir (öz-test yardımcıda geçmeseydi hazır
// baytı gelmezdi; aynı denetim internal/darwin/sandbox testinde ev dizini dosyasıyla da yapılır).
func TestP33K1SandboxHelperStartsSandboxed(t *testing.T) {
	hc, err := spawnHelper()
	if err != nil {
		t.Fatal(err)
	}
	defer hc.kill()
	in, err := sandbox.Check(hc.cmd.Process.Pid)
	if err != nil || !in {
		t.Fatalf("sandbox_check(çocuk) = %v, %v", in, err)
	}
	if !slices.Equal(hc.cmd.Args, []string{hc.cmd.Path, "--opus-cozucu"}) || len(hc.cmd.Env) != 0 || hc.cmd.Env == nil ||
		len(hc.cmd.ExtraFiles) != 0 || hc.cmd.Stderr != nil {
		t.Fatalf("başlatma: args=%q env=%v extra=%d", hc.cmd.Args, hc.cmd.Env, len(hc.cmd.ExtraFiles))
	}
	if in, _ := sandbox.Check(os.Getpid()); in {
		t.Fatal("ana süreç sandbox'ta olmamalı")
	}
}

// T2-2 negatif: hazır baytı gelmeyen ya da sandbox'ta olmayan çocuk reddedilir (burada: /bin/cat yardımcı sanılır).
func TestP33K1SandboxHelperRejectsUnsandboxedChild(t *testing.T) {
	old := helperPath
	helperPath = func() (string, error) { return "/bin/cat", nil }
	defer func() { helperPath = old }()
	start := time.Now()
	if _, err := spawnHelper(); err == nil {
		t.Fatal("sandbox'sız çocuk kabul edildi")
	}
	if time.Since(start) > helperReadyWait+time.Second {
		t.Fatal("bekleme süresi aşıldı")
	}
}

// T2-3: yardımcı yalnız .app paketinin Contents/MacOS'undaki ikiliden başlatılır.
func TestP33K1HelperPathMustBeInsideAppBundle(t *testing.T) {
	cases := map[string]bool{
		"/Applications/Nokta Destek.app/Contents/MacOS/noktadestek": true,
		"/Users/a/Downloads/X.app/Contents/MacOS/noktadestek":       true,
		"/usr/local/bin/noktadestek":                                false,
		"/X.app/Contents/Resources/noktadestek":                     false,
		"/X.app/Contents/MacOS/sub/noktadestek":                     false,
		"X.app/Contents/MacOS/noktadestek":                          false,
		"/X.app/Contents/MacOS/../MacOS/noktadestek":                false,
		"/Xapp/Contents/MacOS/noktadestek":                          false,
	}
	for p, want := range cases {
		if got := inAppBundle(p); got != want {
			t.Errorf("%q: %v, beklenen %v", p, got, want)
		}
	}
}

// T2-3 yardımcı tarafı: tid ≥ 3 ya da uzunluk > 1275 → yanıt yazmadan çıkış.
func TestP33K1HelperRejectsMalformedFrames(t *testing.T) {
	decs, err := warmDecoders()
	if err != nil {
		t.Fatal(err)
	}
	for _, req := range [][]byte{{3, 0, 0}, {0, 0xfc, 0x04}, {255, 1, 0, 9}} {
		var out strings.Builder
		if rc := serveHelper(strings.NewReader(string(req)), &out, decs); rc != helperExitProtocol || out.Len() != 0 {
			t.Errorf("% x: rc=%d yanıt=%d bayt", req, rc, out.Len())
		}
	}
	// Bozuk yük: yanıt "çözülemedi" ve yardımcı sürer.
	var out strings.Builder
	in := string([]byte{1, 3, 0, 0xff, 0xff, 0xff}) + string([]byte{1, 0, 0})
	if rc := serveHelper(strings.NewReader(in), &out, decs); rc != helperExitOK || out.Len() != 2*helperRespSize {
		t.Fatalf("rc=%d yanıt=%d", rc, out.Len())
	}
	if b := out.String(); b[helperRespSize] != helperRespOK {
		t.Fatalf("bozuk yükten sonraki PLC durumu %d", b[helperRespSize])
	}
}

// goldenSets testdata/opus-golden.bin (test/spike-p33/cmd/k1golden): paketler + aynı paketlerin libopus 1.6.1 çıktısı.
func goldenSets(t *testing.T) (pkts [][][]byte, pcm [][]int16) {
	t.Helper()
	b, err := os.ReadFile("testdata/opus-golden.bin")
	if err != nil || len(b) < 6 || string(b[:4]) != "NKOG" {
		t.Fatalf("altın fikstür: %v", err)
	}
	u16 := func() int { v := int(binary.LittleEndian.Uint16(b)); b = b[2:]; return v }
	b = b[4:]
	for range u16() {
		n := u16()
		var set [][]byte
		for range n {
			l := u16()
			set = append(set, b[:l])
			b = b[l:]
		}
		out := make([]int16, n*FrameSamples)
		for i := range out {
			out[i] = int16(u16())
		}
		pkts, pcm = append(pkts, set), append(pcm, out)
	}
	return pkts, pcm
}

// AC-538 / §9: Apple↔libopus çapraz SNR ≥ 40 dB (aynı paketlerin iki çözücü çıktısı; K0s ölçümü ≥ 106 dB). Çıktı
// libopus ile örnek hizasındadır (B3 kısa çıktısı başa sıfırla doldurulur).
func TestP33K1AppleDecoderMatchesLibopusGolden(t *testing.T) {
	pkts, ref := goldenSets(t)
	for si, set := range pkts {
		d, _ := testHelperDecoder(t)
		var sig, noise float64
		for fi, p := range set {
			out := decodeWait(t, d, p)
			if len(out) != FrameSamples {
				t.Fatalf("küme %d çerçeve %d: %d örnek", si, fi, len(out))
			}
			for i, s := range out {
				r := float64(ref[si][fi*FrameSamples+i])
				if fi == 0 && i < 120 { // B3: taze çözücüde başa dolgu; yardımcının ısıtılıp Reset edilmiş çözücüsünde yok
					continue
				}
				sig += r * r
				noise += (r - float64(s)) * (r - float64(s))
			}
		}
		snr := 10 * math.Log10(sig/max(noise, 1))
		t.Logf("küme %d: Apple ↔ libopus SNR %.1f dB", si, snr)
		if snr < 40 {
			t.Fatalf("küme %d: SNR %.1f dB < 40", si, snr)
		}
	}
}

// Kodla (ana süreç AudioToolbox) → çöz (yardımcı) gidiş-dönüş: 32 kbit/s, her çerçeve tek paket, özgün sinyale göre
// hizalı SNR > 3 dB (libopus tabanı ≈ 3,6 dB; Opus algısal), Lookahead = 312.
func TestP33K1RoundTripEncodeDecode(t *testing.T) {
	const frames = 100
	ref := speechLike(frames, 1)
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	look, err := enc.Lookahead()
	if err != nil || look != 312 {
		t.Logf("lookahead=%d (%v)", look, err)
	}
	d, _ := testHelperDecoder(t)
	var got []int16
	bytes := 0
	for f := range frames {
		p, err := enc.Encode(ref[f*FrameSamples : (f+1)*FrameSamples])
		if err != nil {
			t.Fatal(err)
		}
		bytes += len(p)
		got = append(got, decodeWait(t, d, p)...)
	}
	best := math.Inf(-1)
	for dl := 0; dl <= 1200; dl++ {
		best = max(best, snrDB(ref, got, 10*FrameSamples, dl))
	}
	kbps := float64(bytes*8) / (frames * 0.02) / 1000
	t.Logf("SNR %.1f dB, %.1f kbit/s", best, kbps)
	if best < 3 || kbps < 16 || kbps > 48 {
		t.Fatalf("SNR %.1f dB / %.1f kbit/s", best, kbps)
	}
	if _, err := enc.Encode(make([]int16, 480)); !errors.Is(err, ErrFrameSize) {
		t.Fatalf("10 ms çerçeve: %v", err)
	}
}

// B1: 20 ms dışı paket çözücüye verilmeden düşer (DecodeErr); stereo bayraklı 20 ms fikstürler mono çözülür;
// FEC desteklenmez (V-P33-A2); PLC konuşma sürerken sessiz değildir.
func TestP33K1FixturesFilterFECAndPLC(t *testing.T) {
	f, err := os.Open("testdata/opus-fixtures.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	d, _ := testHelperDecoder(t)
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<16)
	n20, nOther := 0, 0
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) != 3 || strings.HasPrefix(fs[0], "#") {
			continue
		}
		smp, _ := strconv.Atoi(fs[1])
		pkt, err := hex.DecodeString(fs[2])
		if err != nil {
			t.Fatal(err)
		}
		if smp == FrameSamples {
			if out := decodeWait(t, d, pkt); len(out) != FrameSamples {
				t.Fatalf("%s: %d örnek", fs[0], len(out))
			}
			n20++
			continue
		}
		if _, err := d.Decode(pkt); !errors.Is(err, errOpusNot20ms) {
			t.Fatalf("%s (%d örnek): %v, beklenen 20 ms süzgeci", fs[0], smp, err)
		}
		nOther++
	}
	if n20 == 0 || nOther == 0 {
		t.Fatalf("fikstür: 20 ms %d, diğer %d", n20, nOther)
	}
	if _, err := d.DecodeFEC([]byte{0x08, 1}); err == nil {
		t.Fatal("FEC desteklenmemeli")
	}
	pkts := encodeAll(t, speechLike(40, 2))
	for _, p := range pkts[:30] {
		decodeWait(t, d, p)
	}
	var plc []int16
	for range 50 {
		if plc, err = d.Conceal(); err == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	var e float64
	for _, s := range plc {
		e += float64(s) * float64(s)
	}
	if len(plc) != FrameSamples || math.Sqrt(e/FrameSamples) < 50 {
		t.Fatalf("PLC: %d örnek, rms %.0f", len(plc), math.Sqrt(e/FrameSamples))
	}
}

// fakeHelper bellek içi boru üzerinde yardımcı taklidi: hang=true iken istekleri okur ama yanıt vermez.
func fakeHelper(t *testing.T, hang *bool) func() (*helperConn, error) {
	return func() (*helperConn, error) {
		cr, pw, _ := os.Pipe()
		pr, cw, _ := os.Pipe()
		cmd := exec.Command("/bin/sleep", "60")
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		go func() {
			hdr := make([]byte, helperReqHdr)
			for {
				if _, err := io.ReadFull(cr, hdr); err != nil {
					_ = cw.Close()
					return
				}
				body := make([]byte, binary.LittleEndian.Uint16(hdr[1:]))
				if _, err := io.ReadFull(cr, body); err != nil {
					_ = cw.Close()
					return
				}
				if *hang {
					continue
				}
				resp := make([]byte, helperRespSize)
				if _, err := cw.Write(resp); err != nil {
					return
				}
			}
		}()
		hc := &helperConn{cmd: cmd, w: pw, r: pr, resp: make(chan []byte, 1), dead: make(chan struct{})}
		go hc.read()
		return hc, nil
	}
}

// T2-3 + §6.6: askıdaki yardımcı yalnız gelen sesi susturur — tik sınırı (15 ms) aşılınca çağrı hemen döner, bekleyen
// yanıt varken hiçbir yuva IPC beklemez, 200 ms'de yardımcı öldürülür ve panik YALNIZ uçuştaki isteğin sahibine yazılır.
// Masum konuşan düşmez; suçlu 3. olayda düşer (ErrPeerDropped).
func TestP33K1HungHelperBlamesOnlyInflightOwner(t *testing.T) {
	hang := false
	h := newHelperProc()
	h.spawn = fakeHelper(t, &hang)
	defer h.close()
	ca, _ := h.newCodec()
	cb, _ := h.newCodec()
	a, _ := newDecoderWith(func() (codec, error) { return ca, nil })
	a.newDec = h.newCodec
	b, _ := newDecoderWith(func() (codec, error) { return cb, nil })
	b.newDec = h.newCodec
	for _, d := range []*Decoder{a, b} {
		t0 := time.Unix(0, 0)
		d.now = func() time.Time { t0 = t0.Add(20 * time.Millisecond); return t0 }
	}
	waitReady(t, h)
	if _, err := b.Conceal(); err != nil {
		t.Fatalf("sağlıklı yardımcı: %v", err)
	}
	pkt := []byte{0x08, 1, 2}
	for round := 1; round <= maxPanics; round++ {
		waitReady(t, h)
		hang = true
		start := time.Now()
		if _, err := a.Decode(pkt); !errors.Is(err, errHelperSlow) {
			t.Fatalf("tur %d: A %v, beklenen tik aşımı", round, err)
		}
		if el := time.Since(start); el > 3*helperTickLimit {
			t.Fatalf("tik sınırı aşıldı: %v", el)
		}
		start = time.Now()
		if _, err := b.Conceal(); !errors.Is(err, errHelperBusy) || time.Since(start) > 5*time.Millisecond {
			t.Fatalf("tur %d: B %v (%v), beklenen IPC'siz meşgul", round, err, time.Since(start))
		}
		time.Sleep(helperHardLimit + 20*time.Millisecond)
		hang = false
		if _, err := b.Conceal(); !errors.Is(err, errHelperNotReady) {
			t.Fatalf("tur %d: B %v, beklenen yeniden başlatma (B suçlanmaz)", round, err)
		}
		_, err := a.Decode(pkt)
		if round < maxPanics && !errors.Is(err, ErrCodecPanic) {
			t.Fatalf("tur %d: A %v, beklenen ErrCodecPanic", round, err)
		}
		if round == maxPanics && !errors.Is(err, ErrPeerDropped) {
			t.Fatalf("tur %d: A %v, beklenen ErrPeerDropped", round, err)
		}
	}
	waitReady(t, h)
	if b.panics != 0 {
		t.Fatalf("masum konuşan %d panik saydı", b.panics)
	}
	if _, err := b.Conceal(); err != nil {
		t.Fatalf("masum konuşan sonradan: %v", err)
	}
}

// AC-538 / §6.6 bütçesi: yardımcı üzerinden çözme (IPC dahil) p95 ≤ 0,5 ms hedef; kodla + çöz + IPC p95 ≤ 2 ms.
func TestP33K1IPCLatencyBudget(t *testing.T) {
	const frames = 1500
	pkts := encodeAll(t, speechLike(frames+1, 5))
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	d, _ := testHelperDecoder(t)
	pcm := speechLike(frames, 6)
	var dec, total []time.Duration
	for f := range frames {
		t0 := time.Now()
		if _, err := enc.Encode(pcm[f*FrameSamples : (f+1)*FrameSamples]); err != nil {
			t.Fatal(err)
		}
		t1 := time.Now()
		decodeWait(t, d, pkts[f])
		t2 := time.Now()
		if f >= 100 {
			dec, total = append(dec, t2.Sub(t1)), append(total, t2.Sub(t0))
		}
	}
	p95 := func(v []time.Duration) time.Duration { slices.Sort(v); return v[len(v)*95/100] }
	pd, pt := p95(dec), p95(total)
	t.Logf("çöz+IPC p95 %.3f ms, kodla+çöz+IPC p95 %.3f ms", float64(pd.Microseconds())/1000, float64(pt.Microseconds())/1000)
	if pt > 2*time.Millisecond {
		t.Fatalf("kodla+çöz+IPC p95 %v > 2 ms", pt)
	}
}

// probeChild ayrı süreçte yoklamayı koşar ve AVFoundation'ın yüklenmediğini bildirir (RTLD_NOLOAD = 0x10).
func probeChild() int {
	helperPath = os.Executable
	ok := Supported()
	_, err := purego.Dlopen("/System/Library/Frameworks/AVFoundation.framework/AVFoundation", 0x10|purego.RTLD_LAZY)
	if !ok {
		return 4
	}
	if err == nil {
		return 5 // AVFoundation yüklü
	}
	return 0
}

// K-P33-11 / S-P33-T-4: yoklama true döner, AVFoundation'ı (AVCaptureDevice) hiç yüklemez ve mikrofon izin durumu
// yoklamadan önce ve sonra aynıdır (CI'da TCC yok: notDetermined kalır; bu makinede terminal kimliği neyse o).
func TestP33K1ProbeLeavesMicrophoneUntouched(t *testing.T) {
	before := macperm.Microphone()
	exe, _ := os.Executable()
	cmd := exec.Command(exe, "-test.run=^$")
	cmd.Env = []string{"NOKTA_PROBE_CHILD=1"}
	err := cmd.Run()
	if ee, ok := err.(*exec.ExitError); ok {
		t.Fatalf("yoklama çocuğu çıkış %d (4: Supported false, 5: AVFoundation yüklendi)", ee.ExitCode())
	} else if err != nil {
		t.Fatal(err)
	}
	if after := macperm.Microphone(); after != before {
		t.Fatalf("mikrofon durumu değişti: %d → %d", before, after)
	}
}
