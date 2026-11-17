package voice

import "sync/atomic"

// Görüşme tanılaması (P28d saha düzeltmesi 1): görüşme kapanınca cmd/noktadestek tek satır `tanilama.log` kaydı yazar.
// Yalnız sayaçlar ve aygıt biçimi; tid, ad, aygıt adı/kimliği tutulmaz (eşler görülme sırasıyla numaralanır).

// Format bir WASAPI uç noktasının karışım (mix) biçimi; Rate 0 → bilinmiyor.
type Format struct {
	Rate     int
	Channels int
	Bits     int
	Float    bool
}

// DeviceInfo aygıtın isteğe bağlı tanılaması (WASAPI gerçeklemesi; sahte aygıtlar uygulamaz).
type DeviceInfo struct {
	Render, Capture Format
	// RenderIsComm çalma aygıtı (varsayılan, eConsole) iletişim varsayılanıyla aynı mı: 1 evet, 0 hayır, -1 bilinmiyor.
	RenderIsComm int
	// Rendered çalma tamponuna gerçekten yazılan örnek; RenderDropped çalma kuyruğu taşmasında atılan örnek.
	Rendered, RenderDropped int64
}

// infoDevice DeviceInfo sağlayan aygıt.
type infoDevice interface{ Info() DeviceInfo }

// PeerStats bir eşten gelen ses paketleri.
type PeerStats struct {
	Rx     int64 // Push'a gelen geçerli yük
	Gated  int64 // talker kapısında (konuşan değil / düşürülmüş / kapalı) atılan
	Jitter int64 // jitter tamponunun reddettiği (geç, yinelenen, hız)
}

// Stats görüşme sayaçları.
type Stats struct {
	Peers        []PeerStats // görülme sırası (tid yazılmaz)
	Decoded      int64       // çözülen paket
	FEC          int64       // FEC ile kurulan çerçeve
	PLC          int64       // kayıp gizleme (PLC) çerçevesi
	DecodeErr    int64       // gizlenen bozuk paket / çözücü hatası
	Written      int64       // aygıta yazılan 20 ms çerçeve
	Audible      int64       // bunlardan sessiz olmayan
	DroppedPeers int64       // 3 tuzakta düşen eş
	Device       *DeviceInfo // aygıt tanılaması (yoksa nil)
}

// callStats döngü sayaçları (eş sayaçları Call.mu altında rx'te).
type callStats struct {
	decoded, fec, plc, decodeErr, written, audible, dropped atomic.Int64
}

// peerStat Push sırasındaki sayaçlar (Call.mu altında).
type peerStat struct {
	order int
	s     PeerStats
}

// stat tid'in sayacını döner; yoksa kurar. Call.mu tutulmalı. Kötü niyetli tid seli sınırsız büyütmesin diye
// en çok maxStatPeers eş izlenir (fazlası sayılmaz).
func (c *Call) stat(tid string) *peerStat {
	p := c.rx[tid]
	if p == nil && len(c.rx) < maxStatPeers {
		p = &peerStat{order: len(c.rx)}
		c.rx[tid] = p
	}
	return p
}

const maxStatPeers = 8

// Stats görüşme sayaçlarının anlık görüntüsü; Close'dan sonra da çağrılabilir.
func (c *Call) Stats() Stats {
	c.mu.Lock()
	peers := make([]PeerStats, len(c.rx))
	for _, p := range c.rx {
		peers[p.order] = p.s
	}
	c.mu.Unlock()
	s := Stats{Peers: peers, Decoded: c.st.decoded.Load(), FEC: c.st.fec.Load(), PLC: c.st.plc.Load(),
		DecodeErr: c.st.decodeErr.Load(), Written: c.st.written.Load(), Audible: c.st.audible.Load(),
		DroppedPeers: c.st.dropped.Load()}
	if d, ok := c.dev.(infoDevice); ok {
		info := d.Info()
		s.Device = &info
	}
	return s
}

func audible(pcm []int16) bool {
	for _, v := range pcm {
		if v != 0 {
			return true
		}
	}
	return false
}
