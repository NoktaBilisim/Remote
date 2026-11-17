package voice

// sat16 toplamı s16 aralığına kırpar (doymalı; taşma sarmaz).
func sat16(v int32) int16 { return int16(max(-32768, min(32767, v))) }

// voiceFrame bir konuşanın bu tikteki çözülmüş 20 ms çerçevesi.
type voiceFrame struct {
	tid string
	pcm []int16
}

// mixMinus `to` eşine gidecek karışımı dst'ye yazar: mikrofon + Σ(talkers \ {to}) (mimari-p28d §4.3). Alıcı kendi
// sesini geri almaz. Toplama int32'de yapılır ve bir kez kırpılır (doymalı s16; sıradan bağımsız sonuç). mic nil ise
// sessiz mikrofon sayılır.
func mixMinus(dst, mic []int16, talkers []voiceFrame, to string) {
	for i := range dst {
		var acc int32
		if i < len(mic) {
			acc = int32(mic[i])
		}
		for _, f := range talkers {
			if f.tid != to && i < len(f.pcm) {
				acc += int32(f.pcm[i])
			}
		}
		dst[i] = sat16(acc)
	}
}

// mixAll hoparlör çıkışı: Σ talkers (müşteri tüm konuşanları duyar).
func mixAll(dst []int16, talkers []voiceFrame) { mixMinus(dst, nil, talkers, "") }
