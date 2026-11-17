package capture

import (
	"bytes"
	"math"
	"testing"
)

// P28f K2 / S-P28f-11 kural 4: düzlem boyutu taşma denetimli.
func TestP28fK2PlaneBytesOverflow(t *testing.T) {
	if n, ok := planeBytes(2048, 1080); !ok || n != 2048*1080 {
		t.Fatalf("normal düzlem: %d %v", n, ok)
	}
	for _, c := range [][2]uint64{{0, 10}, {10, 0}, {math.MaxUint64, 2}, {1 << 32, 1 << 32}, {1 << 20, 1 << 11}} {
		if _, ok := planeBytes(c[0], c[1]); ok {
			t.Errorf("reddedilmeli: %v", c)
		}
	}
}

func TestP28fK2CopyPlaneStrides(t *testing.T) {
	src := []byte{1, 2, 3, 9, 4, 5, 6, 9} // adım 4, satır 3 bayt
	dst := make([]byte, 6)
	if err := copyPlane(dst, 3, src, 4, 3, 2); err != nil || !bytes.Equal(dst, []byte{1, 2, 3, 4, 5, 6}) {
		t.Fatalf("adımlı kopya: %v %v", dst, err)
	}
	// son satırın dolgusu gerekmez (C düzlemi bytesPerRow × yükseklik'ten kısa olabilir)
	if err := copyPlane(dst, 3, src[:7], 4, 3, 2); err != nil {
		t.Fatalf("dolgusuz son satır: %v", err)
	}
	for _, bad := range []func() error{
		func() error { return copyPlane(dst, 3, src[:6], 4, 3, 2) }, // kaynak kısa
		func() error { return copyPlane(dst[:5], 3, src, 4, 3, 2) }, // hedef kısa
		func() error { return copyPlane(dst, 2, src, 4, 3, 2) },     // adım < satır
		func() error { return copyPlane(dst, 3, src, 4, 0, 2) },
	} {
		if bad() == nil {
			t.Error("geçersiz kopya kabul edildi")
		}
	}
}

// ADR-0037 m.2: AVCC → Annex-B; anahtar karede SPS/PPS önde, bozuk uzunluk reddedilir.
func TestP28fK2AVCCToAnnexB(t *testing.T) {
	sps, pps := []byte{0x67, 0x42, 0xc0, 0x1f}, []byte{0x68, 0xce}
	idr, slice := []byte{0x65, 0x88, 0x84}, []byte{0x41, 0x9a}
	avcc := append([]byte{0, 0, 0, 3}, idr...)
	out, err := avccToAnnexB(avcc, 4, [][]byte{sps, pps}, true)
	if err != nil {
		t.Fatal(err)
	}
	nals := splitNALs(out)
	if len(nals) != 3 || nals[0][0]&0x1f != nalSPS || nals[1][0]&0x1f != nalPPS || nals[2][0]&0x1f != nalIDR {
		t.Fatalf("anahtar kare NAL sırası: %x", out)
	}
	out, err = avccToAnnexB(append([]byte{0, 2}, slice...), 2, [][]byte{sps, pps}, false)
	if err != nil || !bytes.Equal(out, append([]byte{0, 0, 0, 1}, slice...)) {
		t.Fatalf("P karesinde SPS/PPS eklenmemeli: %x %v", out, err)
	}
	for _, bad := range []struct {
		b []byte
		n int
	}{
		{[]byte{0, 0, 0, 9, 0x65}, 4}, // uzunluk taşar
		{[]byte{0, 0, 0, 0}, 4},       // sıfır uzunluk
		{[]byte{0, 0}, 4},             // başlık eksik
		{nil, 4},                      // boş
		{[]byte{1, 0x65}, 3},          // geçersiz başlık boyu
	} {
		if _, err := avccToAnnexB(bad.b, bad.n, nil, false); err == nil {
			t.Errorf("bozuk AVCC kabul edildi: %x", bad.b)
		}
	}
}

// AC-106 / AC-392: monitör kimliği kuralı (K3 girdi ve K4 gösterge aynı eşlemeyi kullanır).
func TestP28fK2AC106DisplayOrder(t *testing.T) {
	got := orderDisplays([]display{{id: 7}, {id: 3}, {id: 9, mirror: true}, {id: 5}}, 3)
	if want := []uint32{3, 7, 5}; len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("sıra %v, beklenen %v", got, want)
	}
	if got := orderDisplays(nil, 1); len(got) != 0 {
		t.Fatalf("boş liste: %v", got)
	}
	many := make([]display, 40)
	for i := range many {
		many[i] = display{id: uint32(i + 1)}
	}
	if got := orderDisplays(many, 40); len(got) != maxMonitors || got[0] != 40 {
		t.Fatalf("tavan: %d %v", len(got), got[:1])
	}
}

func TestP28fK2PTSStrictlyIncreasing(t *testing.T) {
	var c ptsClock
	got := []int64{c.next(0), c.next(0), c.next(5), c.next(3), c.next(100)}
	for i := 1; i < len(got); i++ {
		if got[i] <= got[i-1] {
			t.Fatalf("PTS artmıyor: %v", got)
		}
	}
}
