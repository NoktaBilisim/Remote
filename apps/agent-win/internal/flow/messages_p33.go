package flow

// P33 K1 macOS sesli görüşme metinleri (mimari-p33 §6.5, S-P33-T-7; tek tablo). Mikrofon rehberi yalnız paket kimlikli
// adımlar içerir: sudo, `tccutil reset All`, SIP kapatma ya da TCC.db düzenleme önerilmez.
var MacVoiceTexts = struct {
	Device      string // VoiceTexts.Device'ın macOS eşi (darwin init)
	GuideTitle  string
	GuideBody   string
	GuideOpen   string
	GuideClose  string
	IndicatorOn string // gösterge şeridine eklenen ses satırı (ayraçla)
}{
	Device: "Mikrofonunuz açılamadı. Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon altında Nokta Destek açık olmalı; " +
		"teknisyen yeniden isteyebilir.",
	GuideTitle: "Mikrofon izni gerekli",
	GuideBody: "Sesli görüşme için Nokta Destek'in mikrofonu kullanmasına izin verin: Sistem Ayarları → Gizlilik ve " +
		"Güvenlik → Mikrofon → Nokta Destek açık olmalı. Listede açık görünüyor ama ses gitmiyorsa Nokta Destek'i " +
		"listeden − ile kaldırın, programı yeniden açın ve sorulduğunda İzin Ver'e tıklayın. Yalnız Nokta Destek " +
		"açıkken istediği izni verin.",
	GuideOpen:   "Sistem Ayarları'nı aç",
	GuideClose:  "Kapat",
	IndicatorOn: "  ·  ",
}
