//go:build darwin

package capture

import (
	"os"
	"strconv"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
)

// synthNV12 masaüstüne benzer sentetik kare: sabit metin deseni + kayan kutu (seed).
func synthNV12(w, h, seed int) *NV12 {
	f := NewNV12(w, h)
	for r := range h {
		for c := range w {
			v := byte(235)
			if (r/18)%3 == 0 && (c/7)%5 != 0 {
				v = 40
			}
			if bx, by := 100+seed*13%(w/2), 80+seed*7%(h/2); c >= bx && c < bx+200 && r >= by && r < by+150 {
				v = byte(c*3 + r*5 + seed*11)
			}
			f.Data[r*w+c] = v
		}
	}
	for i := w * h; i < len(f.Data); i++ {
		f.Data[i] = byte(128 + (i+seed)%31 - 15)
	}
	return f
}

func auKinds(au []byte) (idr, sps, pps bool) {
	for _, n := range splitNALs(au) {
		switch n[0] & 0x1f {
		case nalIDR:
			idr = true
		case nalSPS:
			sps = true
		case nalPPS:
			pps = true
		}
	}
	return
}

// AC-392 / AC-245 (macOS): VideoToolbox donanım ve yazılım oturumu, eşzamanlı Encode: her kare çıktı verir
// (kare kaybı 0), ilk kare ve zorlanan kare IDR + SPS/PPS, diğerleri IDR değil. Ekran Kaydı izni gerekmez.
func TestP28fK2AC392VTEncodeKeyframesNoLoss(t *testing.T) {
	const w, h = 1280, 720
	frames := []*NV12{synthNV12(w, h, 0), synthNV12(w, h, 1), synthNV12(w, h, 2)}
	for _, hw := range []bool{true, false} {
		enc, err := openEncoder(w, h, targetFPS, hw)
		if err != nil {
			if hw {
				t.Logf("donanım kodlayıcı yok (sanal makine?): %v", err)
				continue
			}
			t.Fatalf("yazılım kodlayıcı: %v", err)
		}
		v := enc.(*vtEncoder)
		for i := range 40 {
			force := i == 0 || i == 20
			au, key, err := enc.Encode(frames[i%3], time.Second/targetFPS, force)
			if err != nil {
				t.Fatalf("hw=%v kare %d: %v", hw, i, err)
			}
			if len(au) == 0 {
				t.Fatalf("hw=%v kare %d çıktı yok (kare kaybı)", hw, i)
			}
			idr, sps, pps := auKinds(au)
			if key != idr {
				t.Fatalf("hw=%v kare %d: key=%v IDR=%v", hw, i, key, idr)
			}
			if force && !(idr && sps && pps) {
				t.Fatalf("hw=%v kare %d: zorlanan kare IDR+SPS+PPS değil", hw, i)
			}
			if !force && idr {
				t.Fatalf("hw=%v kare %d: istenmeden IDR", hw, i)
			}
			if i == 10 {
				enc.SetBitrate(1_000_000) // yayında bit hızı değişimi (rateCtl / düşük iz)
			}
		}
		if hw && !v.UsingHardware() {
			t.Error("Require HW oturumu donanımda değil")
		}
		if v.dropped != 0 || v.timeouts != 0 {
			t.Fatalf("hw=%v atlanan=%d zaman aşımı=%d", hw, v.dropped, v.timeouts)
		}
		enc.Close()
		enc.Close() // ikinci kapatma güvenli
	}
}

// Boyutu tutmayan kare tipli hata (ENCODE_FAILED) döner; oturum kapanınca geç geri çağrı yok sayılır.
func TestP28fK2VTRejectsWrongSize(t *testing.T) {
	enc, err := openEncoder(640, 360, targetFPS, false)
	if err != nil {
		t.Fatal(err)
	}
	defer enc.Close()
	_, _, err = enc.Encode(NewNV12(320, 180), time.Second/30, true)
	if e, ok := AsError(err); !ok || e.Reason != ReasonEncodeFailed {
		t.Fatalf("hata %v", err)
	}
	if _, _, err := enc.Encode(nil, time.Second/30, true); err == nil {
		t.Fatal("nil kare kabul edildi")
	}
}

// FFI kuralı 1: geri çağrı bağlamı tamsayı; kapanan oturumun anahtarı tablodan silinir.
func TestP28fK2VTSessionTableCleared(t *testing.T) {
	vtMu.Lock()
	before := len(vtSessions)
	vtMu.Unlock()
	enc, err := openEncoder(320, 240, targetFPS, false)
	if err != nil {
		t.Fatal(err)
	}
	enc.Close()
	vtMu.Lock()
	after := len(vtSessions)
	vtMu.Unlock()
	if after != before {
		t.Fatalf("oturum tablosu %d → %d", before, after)
	}
	vtOutput(1<<40, 1, 0, 0, 0) // bilinmeyen bağlam: panik yok, yok sayılır
}

func TestP28fK2SessionLockedRule(t *testing.T) {
	cases := []struct {
		locked, console optBool
		want            bool
	}{
		{optBool{}, optBool{}, false},
		{optBool{true, true}, optBool{true, true}, true},
		{optBool{true, false}, optBool{true, true}, false},
		{optBool{}, optBool{true, false}, true},
	}
	for _, c := range cases {
		if got := sessionLocked(c.locked, c.console); got != c.want {
			t.Errorf("%+v → %v", c, got)
		}
	}
}

// Ağır içerik ölçümü (izin gerekmez; NK_K2_OLCUM=<sn>): 1670×1080, her karede tamamı değişen gürültü, 30 fps tempolu, ana
// (bitrateFor) + düşük (signal.LowBPS, ≈ 7,5 fps) oturum eşzamanlı. Bit hızı tavanının devrede olduğu yük.
func TestP28fK2MeasureHeavyVT(t *testing.T) {
	secs, _ := strconv.Atoi(os.Getenv("NK_K2_OLCUM"))
	if secs <= 0 {
		t.Skip("NK_K2_OLCUM=<sn> verilmedi")
	}
	const w, h = 1670, 1080
	frames := make([]*NV12, 8)
	for i := range frames {
		f := NewNV12(w, h)
		x := uint32(i*7919 + 1)
		for j := range f.Data {
			x ^= x << 13
			x ^= x >> 17
			x ^= x << 5
			if os.Getenv("NK_K2_BLOK") != "" { // video benzeri: 16×16 bloklar, karede kayar
				r, c := j/w, j%w
				f.Data[j] = byte(16 + ((r/16+i)*31+(c/16+i*3)*17)%220)
				continue
			}
			f.Data[j] = byte(16 + x%220)
		}
		frames[i] = f
	}
	mainEnc, err := openEncoder(w, h, targetFPS, true)
	if err != nil {
		t.Skipf("donanım kodlayıcı yok: %v", err)
	}
	defer mainEnc.Close()
	lowEnc, err := openEncoder(w, h, signal.LowFPS, true)
	if err != nil {
		t.Fatal(err)
	}
	defer lowEnc.Close()
	lowEnc.SetBitrate(signal.LowBPS)
	var lat []time.Duration
	var mainBytes, lowBytes, empty int
	n := secs * targetFPS
	t0 := time.Now()
	for i := range n {
		time.Sleep(time.Until(t0.Add(time.Duration(i) * time.Second / targetFPS)))
		s := time.Now()
		au, _, err := mainEnc.Encode(frames[i%len(frames)], time.Second/targetFPS, i%60 == 0)
		lat = append(lat, time.Since(s))
		if err != nil {
			t.Fatal(err)
		}
		if len(au) == 0 {
			empty++
		}
		mainBytes += len(au)
		if i%4 == 0 {
			au, _, err := lowEnc.Encode(frames[i%len(frames)], time.Second/signal.LowFPS, i%240 == 0)
			if err != nil {
				t.Fatal(err)
			}
			if len(au) == 0 {
				empty++
			}
			lowBytes += len(au)
		}
	}
	el := time.Since(t0).Seconds()
	m, l := mainEnc.(*vtEncoder), lowEnc.(*vtEncoder)
	loss := empty + m.timeouts + l.timeouts
	t.Logf("ağır içerik %dx%d %d kare %.1f sn (%.1f fps): Encode p50 %v p95 %v maks %v; kayıp %d (atlanan ana %d düşük %d); "+
		"ana %.2f Mbit/s (hedef %.2f), düşük %.2f Mbit/s (hedef %.2f)", w, h, n, el, float64(n)/el,
		pct(lat, 50).Round(10*time.Microsecond), pct(lat, 95).Round(10*time.Microsecond), pct(lat, 100).Round(10*time.Microsecond),
		loss, m.dropped, l.dropped, float64(mainBytes*8)/el/1e6, float64(bitrateFor(w, h, targetFPS))/1e6,
		float64(lowBytes*8)/el/1e6, float64(signal.LowBPS)/1e6)
	if pct(lat, 95) > 33*time.Millisecond || loss != 0 {
		t.Errorf("ölçüt tutmadı: p95 %v, kayıp %d", pct(lat, 95), loss)
	}
}
