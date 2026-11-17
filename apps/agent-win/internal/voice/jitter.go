package voice

import "time"

// Go jitter tamponu (mimari-p28d §4.3): konuşan (tid) başına RTP sıra numaralı tampon. Oynatma 3 paket (60 ms)
// birikince başlar; üst sınır 10 paket (200 ms), taşmada en eski paket atılır. Sırası geçmiş (geç) paket atılır.
// Kayıp çerçevede ardından gelen paket varsa onun bant içi FEC'i, yoksa PLC (Conceal) kullanılır; 5 ardışık PLC'den
// sonra sessizlik ve yeniden tamponlama. Çözülmüş örnekler tik başına 960 örneklik FIFO'dan çekilir (karşı taraf 10/40/60
// ms çerçeve gönderebilir). Sınırlar paket sayısıyla tutulur (20 ms paket varsayımı; Chrome varsayılanı).
const (
	jitterStart  = 3   // oynatmaya başlama: 60 ms
	jitterCap    = 10  // üst sınır: 200 ms
	jitterResync = 100 // bu kadar ileri/geri sıçrama eşin yeniden başlaması sayılır: tampon yeniden eşitlenir
	maxPLC       = 5   // ardışık PLC sınırı; sonrası sessizlik + yeniden tamponlama
	fifoCap      = jitterCap * FrameSamples
	maxPullSteps = 8 // tik başına en çok çözme (2,5 ms'lik çerçevelerle 960 örnek = 8 çözme)
)

// frameDecoder *Decoder'ın jitter tarafından kullanılan yüzü (testte sayaçlı sahte çözücü).
type frameDecoder interface {
	Decode(packet []byte) ([]int16, error)
	DecodeFEC(next []byte) ([]int16, error)
	Conceal() ([]int16, error)
	Close() error
}

// pullKind tampondan bu adımda ne yapılacağı.
type pullKind int

const (
	pullSilence pullKind = iota // tamponlanıyor ya da 5 PLC sonrası: sessizlik
	pullDecode                  // beklenen paket var: çöz
	pullFEC                     // beklenen kayıp, ardından gelen var: FEC ile kur (ardından gelen tamponda kalır)
	pullConceal                 // beklenen kayıp, ardından gelen yok: PLC
)

// jitter bir konuşanın tamponu. push/take alanları Call.mu altında (RTP goroutine'i ve döngü paylaşır); fifo/out
// yalnız döngü goroutine'inindir.
type jitter struct {
	pkts      map[uint16][]byte
	next      uint16 // oynatılacak sıradaki sıra numarası
	anchored  bool   // next geçerli mi (ilk paket ya da yeniden eşitleme)
	buffering bool
	plc       int

	winStart time.Time // varış hızı penceresi (Push'ta ≤ 100 paket/sn)
	winCount int

	fifo []int16
	out  []int16
}

func newJitter() *jitter {
	return &jitter{pkts: make(map[uint16][]byte, jitterCap), buffering: true,
		fifo: make([]int16, 0, fifoCap+maxFrame), out: make([]int16, FrameSamples)}
}

// push bir RTP yükünü tampona koyar (yük zaten kopyalanmış olmalı). Varış hızı > 100/sn, geç, yinelenen ya da 1275
// bayttan uzun paket düşer; false döner.
func (j *jitter) push(seq uint16, payload []byte, now time.Time) bool {
	if len(payload) == 0 || len(payload) > maxPacketSize {
		return false
	}
	if now.Sub(j.winStart) >= time.Second {
		j.winStart, j.winCount = now, 0
	}
	if j.winCount++; j.winCount > maxPacketRate {
		return false
	}
	if !j.anchored {
		j.resync(seq)
	}
	d := int(int16(seq - j.next))
	switch {
	case d < -jitterResync || d >= jitterResync:
		j.resync(seq) // eş yeniden başladı (sıra numarası sıçradı): eski tampon atılır
		d = 0
	case d < 0 && j.buffering && j.span()-d < jitterCap:
		j.next, d = seq, 0 // henüz oynatılmadı: başlangıçtaki sıra bozukluğu, oynatma noktası geri alınır
	case d < 0:
		return false // geç paket: oynatma noktası geçti
	}
	if _, dup := j.pkts[seq]; dup {
		return false
	}
	for ; d >= jitterCap; d-- { // taşma: en eski paket atılır, oynatma noktası ilerler
		delete(j.pkts, j.next)
		j.next++
	}
	j.pkts[seq] = payload
	return true
}

// span tampondaki en yeni paketin oynatma noktasına uzaklığı (paket; tampon boşsa 0).
func (j *jitter) span() int {
	m := 0
	for s := range j.pkts {
		m = max(m, int(int16(s-j.next)))
	}
	return m
}

func (j *jitter) resync(seq uint16) {
	clear(j.pkts)
	j.next, j.anchored, j.buffering, j.plc = seq, true, true, 0
}

// take bir sonraki adımı seçer ve oynatma noktasını ilerletir. pullFEC'te dönen paket tamponda kalır (sonraki adımda
// ayrıca çözülür).
func (j *jitter) take() (pullKind, []byte) {
	if j.buffering {
		if len(j.pkts) < jitterStart {
			return pullSilence, nil
		}
		j.buffering, j.plc = false, 0
		for { // tampondaki en eski pakete atla (hepsi next'ten sonra; < jitterCap adım)
			if _, ok := j.pkts[j.next]; ok {
				break
			}
			j.next++
		}
	}
	if p, ok := j.pkts[j.next]; ok {
		delete(j.pkts, j.next)
		j.next++
		j.plc = 0
		return pullDecode, p
	}
	if p, ok := j.pkts[j.next+1]; ok {
		j.next++
		j.plc = 0
		return pullFEC, p
	}
	if j.plc >= maxPLC {
		// Konuşan sustu (ör. replaceTrack(null)): sessizlik. Sıra numarası kaldığı yerden sürer; ilerlettiğimiz oynatma
		// noktası yeni paketleri "geç" saymasın diye tampon ilk yeni pakete yeniden eşitlenir.
		clear(j.pkts)
		j.anchored, j.buffering, j.plc = false, true, 0
		return pullSilence, nil
	}
	j.plc++
	j.next++
	return pullConceal, nil
}

// emit FIFO'dan 960 örnek verir (eksik kısım sıfır) ve FIFO'yu kaydırır.
func (j *jitter) emit() []int16 {
	n := copy(j.out, j.fifo)
	clear(j.out[n:])
	j.fifo = j.fifo[:copy(j.fifo, j.fifo[n:])]
	return j.out
}

// feed çözülmüş örnekleri FIFO'ya ekler; 200 ms'yi aşarsa en eskiler atılır.
func (j *jitter) feed(pcm []int16) {
	j.fifo = append(j.fifo, pcm...)
	if over := len(j.fifo) - fifoCap; over > 0 {
		j.fifo = j.fifo[:copy(j.fifo, j.fifo[over:])]
	}
}
