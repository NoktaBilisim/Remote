package voice

import (
	"testing"
	"time"
)

// mimari-p28d r3 §4.3 K3 düzeltmesi: kayıpta DecodeFEC(next) + Decode(next) hız sınırına tek paket sayılır.
func TestP28dFECAndDecodeCountAsOnePacket(t *testing.T) {
	dec, err := NewDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	t0 := time.Unix(0, 0)
	dec.now = func() time.Time { return t0 }
	p := encodeAll(t, speechLike(2, 21))[1]
	for i := range maxPacketRate {
		if _, err := dec.DecodeFEC(p); err != nil {
			t.Fatalf("FEC %d: %v", i, err)
		}
		if _, err := dec.Decode(p); err != nil {
			t.Fatalf("çift %d: %v (FEC+Decode iki sayıldı)", i, err)
		}
	}
	if _, err := dec.DecodeFEC(p); err == nil {
		t.Fatal("sınır dolduktan sonra FEC kabul edildi")
	}
}

// Gerçek libopus ile uçtan uca: konuşan A'nın paketleri çözülür, hoparlöre gider ve dinleyen B'ye mix-minus kodlanır.
// Az çerçeve (arm64'te yorumlayıcı yavaş).
func TestAC378P28dRealCodecCallRoundTrip(t *testing.T) {
	dev := newFakeDev()
	c := newCall(dev, nil,
		func() (frameDecoder, error) { return NewDecoder() },
		func() (frameEncoder, error) { return NewEncoder() })
	var got [][]byte
	c.SetPeer("B", func(p []byte, _ time.Duration) error { got = append(got, append([]byte(nil), p...)); return nil })
	c.SetRoles([]string{"A"}, []string{"A", "B"})
	for i, p := range encodeAll(t, speechLike(4, 33)) {
		c.Push("A", uint16(i), p)
	}
	for range 4 {
		if err := c.step(); err != nil {
			t.Fatal(err)
		}
	}
	var energy float64
	for _, f := range dev.spk {
		for _, s := range f {
			energy += float64(s) * float64(s)
		}
	}
	if energy == 0 {
		t.Fatal("hoparlör sessiz: A'nın sesi çözülmedi")
	}
	if len(got) != 4 {
		t.Fatalf("B'ye %d paket", len(got))
	}
	d, err := NewDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = d.Close() }()
	for _, p := range got {
		if pcm, err := d.Decode(p); err != nil || len(pcm) != FrameSamples {
			t.Fatalf("B'ye giden paket çözülemedi: %v", err)
		}
	}
	c.closeCodecs()
}
