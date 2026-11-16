package helperio

// P28e (mimari-p28e r2 §8; AC-448, AC-449): gözetimsiz kayıt. Metinler servis ve yardımcıda aynı ikilidedir; satır
// contracts `REC_UNATTENDED_LINE` (fikstür `rec.json` consent.unattendedLine) ile aynıdır (servis wire_rec_test).

// RecordingLine `asked` onay diyaloğundaki kayıt satırı (AC-449).
const RecordingLine = "Bu bağlantının ekran kaydı alınacaktır"

// RecordingSuffix kayıt sürerken gösterge etiketine eklenen ek (AC-448; contracts `REC_INDICATOR_LABEL`).
const RecordingSuffix = " — Kayıt yapılıyor"

// CmdRec servis → yardımcı: kayıt durumu (`rec.state{on}`); yanıt yoktur.
const CmdRec = "rec"

// IndicatorLabel göstergenin çizilecek etiketi: kayıt sürerken ek eklenir (eki çizilemezse gösterge başarısızdır).
func IndicatorLabel(text string, recording bool) string {
	if recording {
		return text + RecordingSuffix
	}
	return text
}

// validCommand lock ⇒ geçerli kimlik, durum yok; rec ⇒ kimlik yok, durum zorunlu.
func validCommand(c Command) bool {
	switch c.Cmd {
	case CmdLock:
		return cmdIDRe.MatchString(c.ID) && c.On == nil
	case CmdRec:
		return c.ID == "" && c.On != nil
	}
	return false
}
