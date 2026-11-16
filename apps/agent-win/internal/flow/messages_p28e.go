package flow

import "remote-support/agent-win/internal/signal"

// P28e oturum kaydı metinleri (mimari-p28e §8 "messages_p28e.go"; tek tablo). Web karşılıkları
// `packages/contracts/src/api/recording.ts` (REC_INDICATOR_LABEL, REC_REVOKE_BUTTON_LABEL, REC_GUEST_STOPPED_MESSAGE,
// REC_REVOKE_PAUSED_MESSAGE, REC_STATE_REASON_LABELS); müşteri iki istemcide aynı ifadeyi görür.

// RecTexts kutu, gösterge, şerit ve durdurma metinleri.
var RecTexts = struct {
	ConsentLine string // onay kutusu (yalnız sunucu teklif ettiyse ve SHA uyuyorsa; varsayılan işaretsiz)
	Indicator   string // oturum penceresi göstergesi
	Stop        string // "Kaydı durdur" (onaysız)
	StopNote    string // düğme yanında: geri alınamaz
	Stopping    string // rec.revoke gönderildi, onay bekleniyor
	Strip       string // her zaman üstte şerit (tıklayınca durdurur, S-P28e-12)
	StripBusy   string // şerit: durdurma onayı bekleniyor
	Paused      string // S-P28e-2: 2 sn'de onay gelmedi, paylaşım yerelde duraklatıldı
}{
	ConsentLine: signal.RecConsentLine,
	Indicator:   "● Kayıt yapılıyor",
	Stop:        "Kaydı &durdur",
	StopNote:    "Durdurulan kayıt bu oturumda yeniden başlatılamaz.",
	Stopping:    "Kayıt durduruluyor…",
	Strip:       "● Kayıt yapılıyor — durdurmak için tıklayın",
	StripBusy:   "● Kayıt durduruluyor…",
	Paused:      "Kayıt durdurulamadı, paylaşım duraklatıldı",
}

// recOffNotes `rec.state{on:false, reason}` → oturum penceresindeki kısa bilgi satırı. session_end için satır yok
// (son ekran zaten gösterilir); bilinmeyen/boş neden → satır yok.
var recOffNotes = map[string]string{
	"revoked":     "Kayıt durduruldu; o ana kadarki kısım saklanır",
	"quota":       "Depolama kotası doldu, kayıt durdu",
	"error":       "Kayıt durdu (hata)",
	"policy_off":  "Firma kayıt ayarı kapatıldı, kayıt durdu",
	"unavailable": "Bu firmada oturum kaydı kapalı",
}
