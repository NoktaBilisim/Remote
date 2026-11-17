package voice

import "testing"

type infoFakeDev struct{ *fakeDev }

func (infoFakeDev) Info() DeviceInfo {
	return DeviceInfo{Render: Format{Rate: 48000, Channels: 2, Bits: 32, Float: true}, RenderIsComm: 0, Rendered: 960}
}

// TestP28dVoiceStatsCountPerPeerAndPlayback saha düzeltmesi 1 tanılaması: eş başına gelen/kapıda atılan/jitter'ın
// attığı paket, çözülen ve PLC çerçeve, aygıta yazılan ve sesli çerçeve sayılır; sayaçlar Close'dan sonra da okunur,
// tid tutulmaz (görülme sırası). Aygıt Info sağlıyorsa biçim eklenir.
func TestP28dVoiceStatsCountPerPeerAndPlayback(t *testing.T) {
	h := newHarness()
	h.c.dev = infoFakeDev{h.dev}
	h.c.SetRoles([]string{"A"}, []string{"A"})
	h.push3("A", 10, 5)
	h.c.Push("A", 10, []byte{5}) // yinelenen → jitter atar
	h.c.Push("C", 1, []byte{9})  // konuşan değil → kapıda atılır
	h.step(0)                    // A'nın 1. paketi çözülür (sesli)
	h.step(0)
	h.step(0)
	h.step(0) // tampon boş → PLC
	_ = h.c.Close()
	s := h.c.Stats()
	if len(s.Peers) != 2 || s.Peers[0] != (PeerStats{Rx: 4, Jitter: 1}) || s.Peers[1] != (PeerStats{Rx: 1, Gated: 1}) {
		t.Fatalf("eş sayaçları: %+v", s.Peers)
	}
	if s.Decoded != 3 || s.PLC != 1 || s.Written != 4 || s.Audible != 3 {
		t.Fatalf("döngü sayaçları: %+v", s)
	}
	if s.Device == nil || s.Device.Render.Rate != 48000 || s.Device.RenderIsComm != 0 {
		t.Fatalf("aygıt bilgisi: %+v", s.Device)
	}
}
