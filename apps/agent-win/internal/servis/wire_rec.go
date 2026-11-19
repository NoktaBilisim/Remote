package servis

// P28e `/ws/device` ekleri (mimari-p28e r2 §6.1–§6.2; contracts `ws-device.ts` deviceRecordOutboundSchema, fikstür
// `rec.json` deviceOutbound). Yalnız tip/sabit/doğrulayıcı (K2); belirteci bildirmek, ParseServer'a `rec.state` eklemek ve
// gösterge eki davranışı K6'dadır (core_rec.go). Gösterge eki çizilemiyorsa `rs.cap.record1` bildirilmez (K-P28e-7).

// DeviceCapRecord alt protokol yetenek belirteci (kimlik değildir).
const DeviceCapRecord = "rs.cap.record1"

// capRecord1 `device.features.caps` değeri.
const capRecord1 = "record1"

// tRecState sunucu → cihaz (yalnız record1 soket).
const tRecState = "rec.state"

// RecState `rec.state{on}`: kayıt ortada durursa gösterge eki kalkar; cihaz yanıt göndermez.
type RecState struct {
	T  string `json:"t"`
	On *bool  `json:"on"`
}

func validRecState(v *RecState) bool { return v.T == tRecState && v.On != nil }

// validRecording `connect.recording` zod `z.literal(true).optional()`: alan yoksa ya da true ise geçerli.
func validRecording(b *bool) bool { return b == nil || *b }
