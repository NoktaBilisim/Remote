package servis

import (
	"regexp"

	"remote-support/agent-win/internal/update"
)

// P29 `/ws/device` güncelleme eki (mimari-p29 §4.3; contracts `ws-device.ts` deviceUpdateOutbound/InboundSchema, fikstür
// `update1*`). Servis 0.22.0 alt protokol listesine `rs.cap.update1` ekler; `update1` `device.features.caps`'e GİRMEZ
// (K2 sapması — validFeatures değişmez). Eski sunucu kuralı (AC-493): C→S `update.*` mesajları YALNIZ o bağlantıda
// sunucudan `update.offer` ya da `update.none` alındıktan sonra yazılır (DeviceClient.writer kapısı).

// DeviceCapUpdate alt protokol yetenek belirteci (kimlik değildir; Caddy loglamaz — G-10).
const DeviceCapUpdate = "rs.cap.update1"

// Sunucu → cihaz (yalnız update1 soket).
const (
	tUpdateOffer = "update.offer"
	tUpdateNone  = "update.none"
	tUpdateToken = "update.token"
)

// Cihaz → sunucu (yalnız offer/none alınmış soket).
const (
	tUpdateCheck        = "update.check"
	tUpdateTokenRequest = "update.token.request"
	tUpdateState        = "update.state"
	tUpdateEvent        = "update.event"
)

// UpdatePhaseInstalling `update.state.phase`'in tek değeri (contracts DEVICE_UPDATE_PHASES).
const UpdatePhaseInstalling = "installing"

// manifestB64Max contracts UPDATE_MANIFEST_B64_MAX (≤ 2048 bayt → ≤ 2732 karakter).
const manifestB64Max = 2732

var (
	manifestB64Re = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)
	signatureRe   = regexp.MustCompile(`^[A-Za-z0-9_-]{86}$`)
	eventAtRe     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$`)
)

// UpdateOffer `update.offer` (belirteçsiz; manifest ham baytların standart base64'ü).
type UpdateOffer struct {
	T         string `json:"t"`
	Manifest  string `json:"manifest"`
	Signature string `json:"signature"`
	Policy    string `json:"policy"`
}

// UpdateNone `update.none`: sunulabilir servis manifesti yok.
type UpdateNone struct {
	T string `json:"t"`
}

// UpdateToken `update.token`: yalnız `update.token.request` yanıtı; belirteç yalnız Authorization başlığında kullanılır.
type UpdateToken struct {
	T       string `json:"t"`
	Version string `json:"version"`
	Token   string `json:"token"`
}

// UpdateCheck `update.check`.
type UpdateCheck struct {
	T string `json:"t"`
}

// UpdateTokenRequest `update.token.request`.
type UpdateTokenRequest struct {
	T       string `json:"t"`
	Version string `json:"version"`
}

// UpdateStateMsg `update.state{installing}`.
type UpdateStateMsg struct {
	T       string `json:"t"`
	Phase   string `json:"phase"`
	Version string `json:"version"`
}

// UpdateEventMsg `update.event` (updateEventSchema alanları düz).
type UpdateEventMsg struct {
	T string `json:"t"`
	update.Event
}

func validUpdateServer(m any) (ok, known bool) {
	switch v := m.(type) {
	case *UpdateOffer:
		return len(v.Manifest) >= 4 && len(v.Manifest) <= manifestB64Max && manifestB64Re.MatchString(v.Manifest) &&
			signatureRe.MatchString(v.Signature) && (v.Policy == string(update.PolicyAuto) ||
			v.Policy == string(update.PolicyNotify)), true
	case *UpdateNone:
		return true, true
	case *UpdateToken:
		return versionRe.MatchString(v.Version) && b64url32.MatchString(v.Token), true
	}
	return false, false
}

// validUpdateEvent updateEventSchema + refine: failed/rolled_back → fail nedeni; skipped → atlama nedeni; diğerleri nedensiz.
func validUpdateEvent(e update.Event) bool {
	if !versionRe.MatchString(e.Version) || !versionRe.MatchString(e.FromVersion) || !eventAtRe.MatchString(e.At) {
		return false
	}
	switch e.Type {
	case update.EventAvailable, update.EventInstalled:
		return e.Reason == ""
	case update.EventFailed, update.EventRolledBack:
		return e.Reason != "" && !e.Reason.Skip() && isFailReason(e.Reason)
	case update.EventSkipped:
		return e.Reason.Skip()
	}
	return false
}

func isFailReason(r update.Reason) bool {
	for _, f := range update.FailReasons {
		if f == r {
			return true
		}
	}
	return false
}

func validUpdateClient(m any) (ok, known bool) {
	switch v := m.(type) {
	case *UpdateCheck:
		return true, true
	case *UpdateTokenRequest:
		return versionRe.MatchString(v.Version), true
	case *UpdateStateMsg:
		return v.Phase == UpdatePhaseInstalling && versionRe.MatchString(v.Version), true
	case *UpdateEventMsg:
		return validUpdateEvent(v.Event), true
	}
	return false, false
}

// encodeUpdateClient `t` alanını yazar; bilinmeyen tür false.
func encodeUpdateClient(m any) bool {
	switch v := m.(type) {
	case *UpdateCheck:
		v.T = tUpdateCheck
	case *UpdateTokenRequest:
		v.T = tUpdateTokenRequest
	case *UpdateStateMsg:
		v.T = tUpdateState
	case *UpdateEventMsg:
		v.T = tUpdateEvent
	default:
		return false
	}
	return true
}

// updateOnly yalnız sunucudan offer/none alınmış sokete yazılabilecek mesaj mı (AC-493).
func updateOnly(m any) bool {
	switch m.(type) {
	case *UpdateCheck, *UpdateTokenRequest, *UpdateStateMsg, *UpdateEventMsg:
		return true
	}
	return false
}

// UpdateHandler sunucunun update1 mesajlarının servis güncelleyicisindeki karşılığı (DeviceClient.Update; nil = kapalı).
type UpdateHandler interface {
	// Ready her bağlantıda device.ready sonrası (sağlık işareti, §5.3 adım 11–12a).
	Ready()
	Offer(m *UpdateOffer)
	None()
	Token(m *UpdateToken)
}
