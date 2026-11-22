//go:build darwin

package voice

import (
	"encoding/binary"
	"math"
	"sync"
	"time"
)

// Supported K-P33-11 çalışma zamanı yoklaması (süreçte bir kez, sonuç önbellekte): AudioToolbox Opus kodlayıcısı
// kurulur, sinüs çerçevesi kodlanır, çözücü yardımcısı başlatılır (hazır baytı + sandbox_check, S-P33-T2-2) ve paket
// çözülür. Yoklama hiçbir AudioQueue açmaz ve AVCaptureDevice/AVFoundation'a dokunmaz (S-P33-T-4). false ise çağıran
// `rs.cap.voice1` bildirmez (cmd/noktadestek/deps_darwin.go ses bağımlılıklarını bağlamaz).
func Supported() bool {
	supportedOnce.Do(func() { supported = probeVoice() })
	return supported
}

var (
	supportedOnce sync.Once
	supported     bool
)

func probeVoice() bool {
	enc, err := newATEncoder()
	if err != nil {
		return false
	}
	defer enc.c.close()
	frame := make([]int16, FrameSamples)
	for i := range frame {
		frame[i] = int16(8000 * math.Sin(2*math.Pi*440*float64(i)/SampleRate))
	}
	var pkt []byte
	for range 3 { // kodlayıcının ilk çerçevesi önden dolguyla gelir; üçüncü çerçeve sinüsü taşır
		if pkt, err = enc.encode(frame); err != nil {
			return false
		}
	}
	hc, err := spawnHelper()
	if err != nil {
		return false
	}
	defer hc.kill()
	req := make([]byte, helperReqHdr+len(pkt))
	binary.LittleEndian.PutUint16(req[1:], uint16(len(pkt)))
	copy(req[helperReqHdr:], pkt)
	var resp []byte
	if _, err := hc.w.Write(req); err != nil {
		return false
	}
	// okuyucu goroutine'i spawnHelper başlattı: yanıt kanaldan gelir
	select {
	case b := <-hc.resp:
		resp = b
	case <-hc.dead:
		return false
	case <-time.After(time.Second):
		return false
	}
	if resp[0] != helperRespOK {
		return false
	}
	var e float64
	for i := range FrameSamples {
		s := float64(int16(binary.LittleEndian.Uint16(resp[1+2*i:])))
		e += s * s
	}
	return e > 0
}
