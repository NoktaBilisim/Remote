package voice

import (
	"testing"
	"time"
)

// jt saati her pakette 20 ms ilerleyen (varış hızı sınırına takılmayan) test tamponu.
type jt struct {
	*jitter
	t time.Time
}

func newJT() *jt { return &jt{jitter: newJitter(), t: time.Unix(0, 0)} }

func (j *jt) put(seq uint16) bool {
	j.t = j.t.Add(20 * time.Millisecond)
	return j.push(seq, []byte{byte(seq)}, j.t)
}

func (j *jt) expect(t *testing.T, kind pullKind, seq int) {
	t.Helper()
	k, p := j.take()
	if k != kind {
		t.Fatalf("take: tür %d, beklenen %d", k, kind)
	}
	if seq >= 0 && (len(p) != 1 || p[0] != byte(seq)) {
		t.Fatalf("take: paket %v, beklenen sıra %d", p, seq)
	}
}

func TestP28dJitterStartsAt60msInOrder(t *testing.T) {
	j := newJT()
	j.put(12)
	j.put(10)
	j.expect(t, pullSilence, -1) // 2 paket: henüz 60 ms yok
	j.put(11)
	j.expect(t, pullDecode, 10)
	j.expect(t, pullDecode, 11)
	j.expect(t, pullDecode, 12)
}

func TestP28dJitterSequenceWrap(t *testing.T) {
	j := newJT()
	for _, s := range []uint16{65534, 0, 65535, 1} {
		if !j.put(s) {
			t.Fatalf("paket %d reddedildi", s)
		}
	}
	for _, s := range []int{65534 & 0xff, 65535 & 0xff, 0, 1} {
		j.expect(t, pullDecode, s)
	}
}

func TestP28dJitterLateAndDuplicateDropped(t *testing.T) {
	j := newJT()
	j.put(100)
	j.put(101)
	j.put(102)
	j.expect(t, pullDecode, 100)
	j.expect(t, pullDecode, 101)
	if j.put(100) {
		t.Fatal("geç paket (oynatma noktası geçti) kabul edildi")
	}
	if j.put(102) {
		t.Fatal("yinelenen paket kabul edildi")
	}
	j.expect(t, pullDecode, 102)
}

func TestP28dJitterOverflowDropsOldest(t *testing.T) {
	j := newJT()
	for s := uint16(0); s < jitterCap+3; s++ {
		j.put(s)
	}
	if len(j.pkts) != jitterCap {
		t.Fatalf("tampon %d paket; üst sınır %d (200 ms)", len(j.pkts), jitterCap)
	}
	j.expect(t, pullDecode, 3) // en eski 3 paket atıldı
}

func TestP28dJitterFECThenConceal(t *testing.T) {
	j := newJT()
	for _, s := range []uint16{0, 1, 2, 4} {
		j.put(s)
	}
	j.expect(t, pullDecode, 0)
	j.expect(t, pullDecode, 1)
	j.expect(t, pullDecode, 2)
	j.expect(t, pullFEC, 4)    // 3 kayıp, 4 var: 4'ün FEC'i
	j.expect(t, pullDecode, 4) // 4'ün kendisi ayrıca çözülür
	j.expect(t, pullConceal, -1)
}

func TestP28dJitterSilenceAfterFivePLCAndReanchor(t *testing.T) {
	j := newJT()
	for s := uint16(500); s < 503; s++ {
		j.put(s)
	}
	for range 3 {
		j.take()
	}
	for i := range maxPLC {
		k, _ := j.take()
		if k != pullConceal {
			t.Fatalf("PLC %d: tür %d", i+1, k)
		}
	}
	for range 3 {
		j.expect(t, pullSilence, -1)
	}
	// Konuşan kaldığı sıradan sürdürür (503 < oynatma noktası 508): yeniden eşitlenir, geç sayılmaz.
	for s := uint16(503); s < 506; s++ {
		if !j.put(s) {
			t.Fatalf("susmadan sonra paket %d reddedildi", s)
		}
	}
	j.expect(t, pullDecode, 503)
}

func TestP28dJitterResyncOnSequenceJump(t *testing.T) {
	j := newJT()
	for s := uint16(10); s < 13; s++ {
		j.put(s)
	}
	j.expect(t, pullDecode, 10)
	for s := uint16(30000); s < 30003; s++ { // eş yeniden başladı
		if !j.put(s) {
			t.Fatalf("sıçrama sonrası paket %d reddedildi", s)
		}
	}
	j.expect(t, pullDecode, 30000&0xff)
}

func TestP28dJitterArrivalRateLimit(t *testing.T) {
	j := newJitter()
	now := time.Unix(0, 0)
	for i := range maxPacketRate {
		if !j.push(uint16(i), []byte{1}, now) {
			t.Fatalf("paket %d reddedildi", i)
		}
	}
	if j.push(uint16(maxPacketRate), []byte{1}, now) {
		t.Fatal("101. paket (aynı saniye) kabul edildi")
	}
	if !j.push(uint16(maxPacketRate+1), []byte{1}, now.Add(time.Second)) {
		t.Fatal("yeni pencerede paket reddedildi")
	}
	if j.push(1, make([]byte, maxPacketSize+1), now.Add(time.Second)) || j.push(2, nil, now.Add(time.Second)) {
		t.Fatal("boş ya da 1275 bayttan uzun yük kabul edildi")
	}
}

func TestP28dJitterFIFOVariableFrames(t *testing.T) {
	j := newJitter()
	j.feed(make([]int16, 480)) // 10 ms
	j.feed(make([]int16, 2880))
	if got := len(j.emit()); got != FrameSamples {
		t.Fatalf("emit %d örnek", got)
	}
	if len(j.fifo) != 480+2880-FrameSamples {
		t.Fatalf("FIFO kalan %d", len(j.fifo))
	}
	j.feed(make([]int16, fifoCap+FrameSamples))
	if len(j.fifo) != fifoCap {
		t.Fatalf("FIFO %d; üst sınır %d", len(j.fifo), fifoCap)
	}
}
