package update

import (
	"encoding/base64"
	"time"
)

// Policy tenant politikası (K-P29-7, contracts UPDATE_POLICIES).
type Policy string

const (
	PolicyAuto   Policy = "auto"
	PolicyNotify Policy = "notify"
)

// ParsePolicy sunucu değeri; bilinmeyen değer kurulumu açmaz → notify (fail-closed). Boş (alan yok, eski sunucu) → auto
// (tenant bilinmiyorsa Açık, V-P29-3).
func ParsePolicy(s string) Policy {
	switch s {
	case "", string(PolicyAuto):
		return PolicyAuto
	}
	return PolicyNotify
}

// MergePolicy birden çok firma kaydında kapalı olan kazanır (AC-485); liste boşsa auto.
func MergePolicy(ps ...Policy) Policy {
	for _, p := range ps {
		if p != PolicyAuto {
			return PolicyNotify
		}
	}
	return PolicyAuto
}

// PolicyFromBinding kayıt yanıtındaki `autoUpdate` (nil = eski sunucu → auto).
func PolicyFromBinding(autoUpdate *bool) Policy {
	if autoUpdate != nil && !*autoUpdate {
		return PolicyNotify
	}
	return PolicyAuto
}

// Action karar sonucu.
type Action int

const (
	// ActionNone bir şey yapma (olay da yok ya da yalnız failed olayı).
	ActionNone Action = iota
	// ActionNotify kurulum yok; bilgi satırı "Yeni sürüm var — indirme bağlantısından …" (MessageAvailable).
	ActionNotify
	// ActionInstall indir + doğrula + (oturum yokken) kur. Yazılabilirlik denetimi platform katmanında (NOT_WRITABLE).
	ActionInstall
)

// Decision Verify sonucuna göre yapılacak iş ve kuyruğa eklenecek olaylar (Queue tekilleştirir).
type Decision struct {
	Action Action
	Events []Event
}

// Decide §5.2 akışı (taşınabilir ve servis ortak): Verify → available → politika → kurulum.
//   - Disabled / None: hiçbir şey.
//   - Rejected: failed(reason).
//   - ManualOnly: available + skipped(MANUAL_ONLY), bildir.
//   - Accept + notify: available + skipped(POLICY_OFF), bildir (AC-485 "yalnız available bildirir").
//   - Accept + auto: available, kur.
func Decide(r Result, policy Policy, running Version, now time.Time) Decision {
	from := running.String()
	v := r.Manifest.Version
	switch r.Outcome {
	case OutcomeRejected:
		return Decision{Events: []Event{NewEvent(EventFailed, failedVersion(v, from), from, r.Reason, now)}}
	case OutcomeManualOnly:
		return Decision{Action: ActionNotify, Events: []Event{
			NewEvent(EventAvailable, v, from, "", now), NewEvent(EventSkipped, v, from, ReasonManualOnly, now)}}
	case OutcomeAccept:
		avail := NewEvent(EventAvailable, v, from, "", now)
		if policy != PolicyAuto {
			return Decision{Action: ActionNotify, Events: []Event{avail, NewEvent(EventSkipped, v, from, ReasonPolicyOff, now)}}
		}
		return Decision{Action: ActionInstall, Events: []Event{avail}}
	}
	return Decision{}
}

// failedVersion ayrıştırılamayan manifestte (imza/biçim) hedef sürüm bilinmez; olay şeması sürüm ister → çalışan sürüm.
func failedVersion(v, from string) string {
	if v == "" {
		return from
	}
	return v
}

// VerifyEncoded sunucu teklifinin (HTTP 200 gövdesi ya da WS `update.offer`) kodlu alanlarıyla Verify: `manifest` standart
// base64, `signature` base64url. Çözülemeyen alan boş bayt olarak Verify'a gider → MANIFEST_SIGNATURE (sessiz düşürülmez).
func VerifyEncoded(t Trust, manifestB64, sigB64 string, run Running, maxSeen Version, now time.Time) Result {
	var manifest, sig []byte
	if len(manifestB64) <= base64.StdEncoding.EncodedLen(MaxManifestBytes) {
		if b, err := base64.StdEncoding.Strict().DecodeString(manifestB64); err == nil {
			manifest = b
		}
	}
	if b, err := DecodeSignature(sigB64); err == nil {
		sig = b
	}
	return Verify(t, manifest, sig, run, maxSeen, now)
}
