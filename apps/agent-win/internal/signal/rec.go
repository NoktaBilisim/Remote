package signal

import "slices"

// P28e oturum kaydı WS sözleşme eşi (mimari-p28e r2 §4, §6; `packages/contracts/src/ws-rec.ts`). Tip, sabit ve
// doğrulayıcı (K2); `rec.state` ParseServer tablosunda, `rs.cap.rec1` Dial'ın bilinen belirteçlerinde (K5). Davranış
// internal/flow (rec.go). Uyum `packages/contracts/fixtures/rec.json` ile test edilir.

// FeatureRec `WS_CAP_REC`: Dial'ın features parametresi. Gösterge (şerit) çizilemiyorsa bildirilmez (K-P28e-7).
const FeatureRec = "rs.cap.rec1"

// Rıza metni (§4). Kutu yalnız `ConsentTextView.recording.lineSha256 == RecConsentLineSHA256` iken gösterilir.
const (
	RecConsentLine       = "Oturumun görüntü kaydının alınmasına izin veriyorum"
	RecConsentLineSHA256 = "367c841cafd53771a4efd842c46c744a476c9801859791434a388e1d17e39dc9"
)

// RecRevokeAckMs `rec.revoke` sonrası bu sürede `rec.state{on:false}` gelmezse yakalama yerelde duraklar (S-P28e-2).
const RecRevokeAckMs = 2_000

// recStateReasons `REC_STATE_REASONS`.
var recStateReasons = []string{"revoked", "quota", "session_end", "error", "policy_off", "unavailable"}

// RecConsent misafir → sunucu: kutu işaretliyse admit sonrası ilk hello'dan sonra bir kez.
type RecConsent struct {
	T          string `json:"t"`
	ID         string `json:"id,omitempty"`
	LineSha256 string `json:"lineSha256"`
}

// RecRevoke misafir → sunucu: "Kaydı durdur" (geri alınamaz).
type RecRevoke struct {
	T  string `json:"t"`
	ID string `json:"id,omitempty"`
}

func (m RecConsent) validate() error {
	if m.T != "rec.consent" || !sha256Re.MatchString(m.LineSha256) {
		return fail(m.T, "rec.consent")
	}
	return checkID(m.T, m.ID)
}

func (m RecRevoke) validate() error {
	if m.T != "rec.revoke" {
		return fail(m.T, "tip")
	}
	return checkID(m.T, m.ID)
}

// RecState sunucu → misafir (`rec1`): misafir biçimi yalnız {on, reason?} (rid/basis/upload katı çözmede reddedilir).
// On işaretçi: alan zorunlu (decodeStrict üst düzeyde denetler; RecHello iç içe olduğundan nil denetimi doğrulayıcıda).
type RecState struct {
	T      string `json:"t"`
	On     *bool  `json:"on"`
	Reason string `json:"reason,omitempty"`
}

// RecHello `hello.rec` (yalnız rec1 soketine, yeniden bağlanmada).
type RecHello struct {
	On     *bool  `json:"on"`
	Reason string `json:"reason,omitempty"`
}

func (m RecState) Type() string { return m.T }

// validRecBody ortak kural: on zorunlu; açıkken neden yok; neden bilinen kümeden.
func validRecBody(on *bool, reason string) bool {
	if on == nil {
		return false
	}
	if reason == "" {
		return true
	}
	return !*on && slices.Contains(recStateReasons, reason)
}

func validRecState(m *RecState) bool { return validRecBody(m.On, m.Reason) }

func validRecHello(m *RecHello) bool { return m == nil || validRecBody(m.On, m.Reason) }
