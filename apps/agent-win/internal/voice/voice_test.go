package voice

import (
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeDec paketin ilk baytı × 10 değerinde 960 örneklik çerçeve üretir (konuşanı karışımda ayırt etmek için).
type fakeDec struct {
	decodes, fecs, conceals int
	closed                  bool
	dropAfter               int // > 0 ise bu kadar çözmeden sonra ErrPeerDropped
	pcm                     []int16
}

func (d *fakeDec) frame(v int16) []int16 {
	d.pcm = slices.Repeat([]int16{v}, FrameSamples)
	return d.pcm
}

func (d *fakeDec) Decode(p []byte) ([]int16, error) {
	d.decodes++
	if d.dropAfter > 0 && d.decodes > d.dropAfter {
		return nil, ErrPeerDropped
	}
	return d.frame(int16(p[0]) * 10), nil
}
func (d *fakeDec) DecodeFEC(p []byte) ([]int16, error) {
	d.fecs++
	return d.frame(int16(p[0]) * 10), nil
}
func (d *fakeDec) Conceal() ([]int16, error) { d.conceals++; return d.frame(0), nil }
func (d *fakeDec) Close() error              { d.closed = true; return nil }

// fakeEnc kodlanan karışımı kaydeder.
type fakeEnc struct {
	got    [][]int16
	closed bool
}

func (e *fakeEnc) Encode(pcm []int16) ([]byte, error) {
	e.got = append(e.got, slices.Clone(pcm))
	return []byte{0xf8}, nil
}
func (e *fakeEnc) Close() error { e.closed = true; return nil }

// fakeDev mikrofon saatini taklit eder: ReadFrame tick kanalından bir çerçeve bekler; Close bloklu okumayı çözer.
type fakeDev struct {
	ticks   chan int16
	spk     [][]int16
	mu      sync.Mutex
	readErr error
	closes  atomic.Int32
	closed  chan struct{}
	once    sync.Once
}

func newFakeDev() *fakeDev { return &fakeDev{ticks: make(chan int16), closed: make(chan struct{})} }

func (d *fakeDev) ReadFrame(pcm []int16) error {
	if d.readErr != nil {
		return d.readErr
	}
	select {
	case v := <-d.ticks:
		for i := range pcm {
			pcm[i] = v
		}
		return nil
	case <-d.closed:
		return errDeviceClosedFake
	}
}

var errDeviceClosedFake = errors.New("sahte aygıt kapalı")

func (d *fakeDev) WriteFrame(pcm []int16) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.spk = append(d.spk, slices.Clone(pcm))
	return nil
}

func (d *fakeDev) Close() error {
	d.closes.Add(1)
	d.once.Do(func() { close(d.closed) })
	return nil
}

// harness sahte kodekli Call; step doğrudan sürülür (döngü goroutine'i yok).
type harness struct {
	c    *Call
	dev  *fakeDev
	nDec int // kurulan çözücü sayısı
	encs []*fakeEnc
	sent map[string]int
	smu  sync.Mutex
	dec  func() *fakeDec
}

func newHarness() *harness {
	h := &harness{dev: newFakeDev(), sent: map[string]int{}}
	h.dec = func() *fakeDec { return &fakeDec{} }
	h.c = newCall(h.dev, nil,
		func() (frameDecoder, error) { h.nDec++; return h.dec(), nil },
		func() (frameEncoder, error) { e := &fakeEnc{}; h.encs = append(h.encs, e); return e, nil })
	return h
}

func (h *harness) sink(tid string) func([]byte, time.Duration) error {
	return func(p []byte, d time.Duration) error {
		if d != frameDur || len(p) == 0 {
			panic("sink: süre/yük")
		}
		h.smu.Lock()
		h.sent[tid]++
		h.smu.Unlock()
		return nil
	}
}

// push tid'e 3 paket (60 ms) koyar: oynatma başlar. Paket değeri v (çerçeve v×10).
func (h *harness) push3(tid string, base uint16, v byte) {
	for i := range uint16(3) {
		h.c.Push(tid, base+i, []byte{v})
	}
}

func (h *harness) step(mic int16) {
	for i := range h.c.mic {
		h.c.mic[i] = mic
	}
	if err := h.c.step(); err != nil {
		panic(err)
	}
}

// encOf eşin canlı kodlayıcısı.
func (h *harness) encOf(tid string) *fakeEnc {
	e, _ := h.c.encs[tid].(*fakeEnc)
	return e
}

func TestAC378P28dMixMinusExcludesSelf(t *testing.T) {
	h := newHarness()
	for _, tid := range []string{"A", "B", "C"} {
		h.c.SetPeer(tid, h.sink(tid))
	}
	h.c.SetRoles([]string{"A", "B"}, []string{"A", "B", "C"})
	h.push3("A", 0, 10)  // A → 100
	h.push3("B", 0, 100) // B → 1000
	h.step(7)
	want := map[string]int16{"A": 7 + 1000, "B": 7 + 100, "C": 7 + 100 + 1000}
	for tid, v := range want {
		e := h.encOf(tid)
		if e == nil || len(e.got) != 1 || e.got[0][0] != v || e.got[0][FrameSamples-1] != v {
			t.Fatalf("%s karışımı: %v, beklenen %d (alıcı kendi sesini almamalı)", tid, e, v)
		}
	}
	if spk := h.dev.spk[0][0]; spk != 1100 {
		t.Fatalf("hoparlör %d, beklenen Σ talkers = 1100 (mikrofon hoparlöre gitmez)", spk)
	}
}

func TestAC378P28dOnlyListenersReceive(t *testing.T) {
	h := newHarness()
	for _, tid := range []string{"A", "B", "C"} {
		h.c.SetPeer(tid, h.sink(tid))
	}
	h.c.SetRoles([]string{"A"}, []string{"A"})
	h.push3("A", 0, 1)
	h.step(5)
	if h.sent["A"] != 1 || h.sent["B"] != 0 || h.sent["C"] != 0 {
		t.Fatalf("gönderim %v; yalnız listeners (A) almalı", h.sent)
	}
	if len(h.encs) != 1 {
		t.Fatalf("%d kodlayıcı; yalnız dinleyene kurulmalı", len(h.encs))
	}
	// B dinleyene eklenir, A çıkar: A'nın kodlayıcısı kapanır, B'ye sıfırdan kurulur.
	h.c.SetRoles(nil, []string{"B"})
	h.step(5)
	if h.sent["B"] != 1 || h.sent["A"] != 1 || !h.encs[0].closed {
		t.Fatalf("rol değişimi sonrası gönderim %v, A kodlayıcısı kapandı=%v", h.sent, h.encs[0].closed)
	}
	h.c.RemovePeer("B")
	h.step(5)
	if h.sent["B"] != 1 || !h.encs[1].closed {
		t.Fatal("RemovePeer sonrası eşe yazıldı ya da kodlayıcısı kapanmadı")
	}
}

func TestAC378P28dNonTalkerPacketDroppedNoDecoder(t *testing.T) {
	h := newHarness()
	h.c.SetPeer("X", h.sink("X"))
	h.c.SetRoles([]string{"A"}, []string{"A", "X"})
	h.push3("X", 0, 50) // X dinleyen ama konuşan değil (izleyici / değiştirilmiş konsol)
	for range 3 {
		h.step(0)
	}
	if h.nDec != 0 {
		t.Fatalf("talker dışı paket için %d çözücü kuruldu", h.nDec)
	}
	if _, ok := h.c.jit["X"]; ok {
		t.Fatal("talker dışı tid için tampon var")
	}
	if e := h.encOf("A"); e != nil {
		t.Fatal("eşi olmayan A'ya kodlayıcı kuruldu")
	}
	// Konuşan A paketsizken de çözücü kurulmaz (tamponlanıyor: sessizlik).
	if h.nDec != 0 {
		t.Fatal("paketsiz konuşan için çözücü kuruldu")
	}
	// A konuşmayı bırakınca çözücüsü bir sonraki tikte kapanır, tamponu hemen atılır.
	h.push3("A", 0, 1)
	h.step(0)
	if h.nDec != 1 {
		t.Fatalf("konuşan için %d çözücü", h.nDec)
	}
	d := h.c.decs["A"].(*fakeDec)
	h.c.SetRoles(nil, []string{"X"})
	if _, ok := h.c.jit["A"]; ok {
		t.Fatal("konuşmayı bırakan tid'in tamponu kaldı")
	}
	h.c.Push("A", 3, []byte{1})
	h.step(0)
	if !d.closed || h.c.decs["A"] != nil {
		t.Fatal("konuşmayı bırakan tid'in çözücüsü kapanmadı")
	}
}

func TestAC378P28dPeerDroppedAfterRepeatedTraps(t *testing.T) {
	h := newHarness()
	h.dec = func() *fakeDec { return &fakeDec{dropAfter: 1} }
	h.c.SetRoles([]string{"A"}, nil)
	h.push3("A", 0, 1)
	h.step(0) // 1. çözme
	h.step(0) // 2. çözme → ErrPeerDropped
	if !h.c.dropped["A"] || h.c.jit["A"] != nil || h.c.decs["A"] != nil {
		t.Fatal("düşürülen eş temizlenmedi")
	}
	h.c.SetRoles([]string{"A"}, nil) // yeniden konuşan yapılsa da görüşme sonuna dek düşük kalır
	h.push3("A", 10, 1)
	h.step(0)
	if h.nDec != 1 {
		t.Fatalf("düşürülen eş için çözücü yeniden kuruldu (%d)", h.nDec)
	}
}

func TestAC378P28dMutedSendsOthersOnly(t *testing.T) {
	h := newHarness()
	h.c.SetPeer("C", h.sink("C"))
	h.c.SetRoles([]string{"A"}, []string{"A", "C"})
	h.push3("A", 0, 10)
	h.c.SetMuted(true)
	h.step(1234)
	if got := h.encOf("C").got[0][0]; got != 100 {
		t.Fatalf("sessizde C'ye %d; mikrofon 0 + A (100) beklenir", got)
	}
}

func TestP28dMixSaturates(t *testing.T) {
	dst := make([]int16, 4)
	mic := []int16{30000, -30000, 1, 0}
	fr := []voiceFrame{{"a", []int16{30000, -30000, 2, 32767}}, {"b", []int16{-30000, -30000, 3, 1}}}
	mixMinus(dst, mic, fr, "")
	if !slices.Equal(dst, []int16{30000, -32768, 6, 32767}) {
		t.Fatalf("doymalı toplama %v", dst)
	}
	mixMinus(dst, mic, fr, "a")
	if !slices.Equal(dst, []int16{0, -32768, 4, 1}) {
		t.Fatalf("mix-minus a %v", dst)
	}
	mixAll(dst, fr)
	if !slices.Equal(dst, []int16{0, -32768, 5, 32767}) {
		t.Fatalf("hoparlör %v", dst)
	}
}

func TestP28dJitterLossUsesFECThenPLCInCall(t *testing.T) {
	h := newHarness()
	h.c.SetRoles([]string{"A"}, nil)
	for _, s := range []uint16{0, 1, 2, 4} {
		h.c.Push("A", s, []byte{1})
	}
	for range 6 {
		h.step(0)
	}
	d := h.c.decs["A"].(*fakeDec)
	if d.fecs != 1 || d.decodes != 4 || d.conceals != 1 {
		t.Fatalf("çözme=%d FEC=%d PLC=%d; beklenen 4/1/1", d.decodes, d.fecs, d.conceals)
	}
}

func TestP28dReleaseWithinOneSecond(t *testing.T) {
	dev := newFakeDev()
	var fails atomic.Int32
	var sent atomic.Int32
	c := newCall(dev, func(error) { fails.Add(1) },
		func() (frameDecoder, error) { return &fakeDec{}, nil },
		func() (frameEncoder, error) { return &fakeEnc{}, nil })
	c.SetPeer("A", func([]byte, time.Duration) error { sent.Add(1); return nil })
	c.SetRoles([]string{"A"}, []string{"A"})
	c.start()
	dev.ticks <- 1
	dev.ticks <- 1 // ikinci çerçeve alındıysa ilk tik işlendi
	// Döngü şimdi mikrofon saatinde bloklu (yeni tik yok).
	t0 := time.Now()
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if el := time.Since(t0); el > time.Second {
		t.Fatalf("Close %v sürdü (≤ 1 sn)", el)
	}
	select {
	case <-c.done:
	default:
		t.Fatal("Close döndü ama döngü bitmedi")
	}
	if dev.closes.Load() != 1 {
		t.Fatalf("aygıt %d kez kapandı", dev.closes.Load())
	}
	before := sent.Load()
	c.Push("A", 0, []byte{1})
	c.SetPeer("B", func([]byte, time.Duration) error { sent.Add(1); return nil })
	c.SetRoles([]string{"B"}, []string{"B"})
	if sent.Load() != before || len(c.peers) != 0 || len(c.jit) != 0 {
		t.Fatal("Close sonrası Push/SetPeer/SetRoles etkili oldu")
	}
	if c.Close() != nil || dev.closes.Load() != 1 {
		t.Fatal("ikinci Close zararsız olmalı")
	}
	if fails.Load() != 0 {
		t.Fatal("Close ile biten görüşmede onFail çağrıldı")
	}
}

func TestP28dDeviceFailureCallsOnFailOnceWithoutDeadlock(t *testing.T) {
	dev := newFakeDev()
	dev.readErr = &HRError{Op: "GetNextPacketSize", HR: hrDeviceInvalidated}
	got := make(chan error, 4)
	var c *Call
	c = newCall(dev, func(err error) { _ = c.Close(); got <- err }, // flow onFail içinden kapatabilir
		func() (frameDecoder, error) { return &fakeDec{}, nil },
		func() (frameEncoder, error) { return &fakeEnc{}, nil })
	c.start()
	select {
	case err := <-got:
		if !errors.Is(err, ErrDeviceLost) {
			t.Fatalf("onFail hatası %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("onFail çağrılmadı ya da Close ile kilitlendi")
	}
	if dev.closes.Load() < 1 {
		t.Fatal("aygıt hatasında aygıt bırakılmadı")
	}
	time.Sleep(50 * time.Millisecond)
	if len(got) != 0 {
		t.Fatal("onFail birden çok çağrıldı")
	}
}

func TestP28dLoopPanicReleasesDevice(t *testing.T) {
	dev := newFakeDev()
	got := make(chan error, 1)
	c := newCall(dev, func(err error) { got <- err },
		func() (frameDecoder, error) { panic("beklenmeyen") },
		func() (frameEncoder, error) { return &fakeEnc{}, nil })
	c.SetRoles([]string{"A"}, nil)
	for i := range uint16(3) {
		c.Push("A", i, []byte{1})
	}
	c.start()
	dev.ticks <- 0
	select {
	case err := <-got:
		if !errors.Is(err, ErrDevice) || dev.closes.Load() != 1 {
			t.Fatalf("panik: hata %v, aygıt kapanışı %d", err, dev.closes.Load())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("döngü paniği onFail'e ulaşmadı")
	}
}

func TestP28dConcurrentPushAndRoles(t *testing.T) {
	dev := newFakeDev()
	c := newCall(dev, nil,
		func() (frameDecoder, error) { return &fakeDec{}, nil },
		func() (frameEncoder, error) { return &fakeEnc{}, nil })
	c.SetPeer("A", func([]byte, time.Duration) error { return nil })
	c.start()
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(3)
	go func() {
		defer wg.Done()
		for s := uint16(0); ; s++ {
			select {
			case <-stop:
				return
			default:
				c.Push("A", s, []byte{1, 2, 3})
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
				if i%2 == 0 {
					c.SetRoles([]string{"A"}, []string{"A"})
				} else {
					c.SetRoles(nil, nil)
				}
				c.SetMuted(i%3 == 0)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for range 50 {
			select {
			case dev.ticks <- 1:
			case <-dev.closed:
				return
			}
		}
	}()
	time.Sleep(100 * time.Millisecond)
	close(stop)
	_ = c.Close()
	wg.Wait()
}

func TestP28dHRErrorClasses(t *testing.T) {
	for _, tc := range []struct {
		hr   uint32
		want error
	}{
		{0x80070005, ErrDeviceDenied},
		{0x80070490, ErrDeviceNotFound},
		{0x88890004, ErrDeviceLost},
		{0x88890026, ErrDeviceLost},
		{0x80004005, ErrDevice},
	} {
		err := error(&HRError{Op: "Activate", HR: tc.hr})
		if !errors.Is(err, tc.want) {
			t.Fatalf("0x%08X → %v, beklenen %v", tc.hr, errors.Unwrap(err), tc.want)
		}
		if got := err.Error(); got != "voice: Activate hr=0x"+hex8(tc.hr) {
			t.Fatalf("metin %q", got)
		}
	}
}

func hex8(v uint32) string {
	const d = "0123456789ABCDEF"
	b := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		b[i] = d[v&0xf]
		v >>= 4
	}
	return string(b)
}

// flow sözleşmesi (K3a notları): SetRoles gelene kadar gönderim yok; SetPeer aynı tid'de öncekinin yerine geçer; sink
// hatası (ör. rtc.ErrNoAudio: eşin ses izi yok) yutulur, eş düşürülmez; SetRoles dilimi motora kopyalanır.
func TestP28dFlowContractPeersRolesSinkErrors(t *testing.T) {
	h := newHarness()
	var old, cur int
	h.c.SetPeer("A", func([]byte, time.Duration) error { old++; return nil })
	h.step(1)
	if old != 0 || len(h.encs) != 0 {
		t.Fatal("SetRoles gelmeden eşe ses gönderildi")
	}
	h.c.SetPeer("A", func([]byte, time.Duration) error { cur++; return errors.New("eşin ses izi yok") })
	roles := []string{"A"}
	h.c.SetRoles(nil, roles)
	roles[0] = "Z" // flow dilimi sonradan değiştirse de motor etkilenmez
	for range 3 {
		h.step(1)
	}
	if old != 0 || cur != 3 {
		t.Fatalf("eski sink %d, yeni sink %d; yeni 3 olmalı (hata yutulup gönderim sürer)", old, cur)
	}
}
