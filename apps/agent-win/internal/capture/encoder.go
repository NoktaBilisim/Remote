package capture

import "time"

// Encoder H.264 kodlayıcı (AC-245): tek NV12 kareyi kodlar, Annex-B erişim birimini döner (IDR önünde SPS/PPS; key
// IDR mi). Kodlayıcı gecikmesinde çıktı boş olabilir. key=true anahtar kare zorlar. Windows'ta Media Foundation H.264
// MFT'si (mf_windows.go); testlerde sahte kodlayıcı.
type Encoder interface {
	Encode(f *NV12, dur time.Duration, key bool) (au []byte, isKey bool, err error)
	SetBitrate(bps int)
	Close()
}

// encoderStall donanım kodlayıcı girdi aldığı hâlde bu süre çıktı vermezse yazılıma geçilir (AC-245: 3 sn).
const encoderStall = 3 * time.Second

// Fallback donanımdan yazılım kodlayıcıya geçişin nedeni (yerel tanılama logu `encoder_fallback`). Kişisel veri
// içermez: sabit neden kodu, işlem adı, HRESULT.
type Fallback struct {
	Reason Reason
	Op     string
	HR     uint32
}

// fallbackEncoder donanım kodlayıcıyı sarar (AC-245): yayında Encode hatası (ENCODE_FAILED) ya da encoderStall boyunca
// çıktı yoksa yazılım kodlayıcıyı aynı çözünürlük/kare hızı/profil ile açar (openSW), donanımı kapatır ve aynı kareyi
// zorunlu IDR ile yazılımda kodlar. Track ve codec (H.264) değişmez; çağıran yalnız kare akışını görür. Geçiş oturumda
// tek yönlüdür; yazılımın hatası olduğu gibi döner. Yazılım açılamazsa donanımın hatası döner (eski davranış).
type fallbackEncoder struct {
	cur      Encoder
	hw       bool // cur donanım kodlayıcı (geçiş yapılmadı)
	openSW   func() (Encoder, error)
	onSwitch func(Fallback) // geçişte bir kez (nil olabilir)
	now      func() time.Time
	lastOut  time.Time // donanımın son çıktısı ya da ilk girdisi
	bitrate  int       // son SetBitrate (yazılıma taşınır)
}

func (f *fallbackEncoder) Encode(fr *NV12, dur time.Duration, key bool) ([]byte, bool, error) {
	if !f.hw {
		return f.cur.Encode(fr, dur, key)
	}
	now := f.now()
	if f.lastOut.IsZero() {
		f.lastOut = now
	}
	au, isKey, err := f.cur.Encode(fr, dur, key)
	var cause *Error
	switch {
	case err != nil:
		cause = tag(err, stageEncode, "Encode")
	case len(au) > 0:
		f.lastOut = now
		return au, isKey, nil
	case now.Sub(f.lastOut) < encoderStall:
		return nil, false, nil
	default:
		cause = &Error{Reason: ReasonEncodeFailed, Op: "EncoderStall"}
	}
	sw, serr := f.openSW()
	if serr != nil {
		if err != nil {
			return nil, false, err
		}
		return nil, false, cause
	}
	f.cur.Close()
	f.cur, f.hw = sw, false
	if f.bitrate > 0 {
		sw.SetBitrate(f.bitrate)
	}
	if f.onSwitch != nil {
		f.onSwitch(Fallback{Reason: cause.Reason, Op: cause.Op, HR: cause.HR})
	}
	return sw.Encode(fr, dur, true) // geçişte zorunlu IDR (alıcı yeni SPS/PPS ile çözer)
}

func (f *fallbackEncoder) SetBitrate(bps int) {
	f.bitrate = bps
	f.cur.SetBitrate(bps)
}

func (f *fallbackEncoder) Close() { f.cur.Close() }
