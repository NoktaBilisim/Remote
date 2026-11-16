package servis

import (
	"remote-support/agent-win/internal/servis/helperio"
)

// P28u `/ws/device` ekleri (mimari-p28u §6; contracts `ws-device.ts` deviceConsent*, fikstür `consent1*`). Servis 0.15.0
// alt protokol listesine `rs.cap.consent1` ekler; yeni C→S mesajları yalnız `device.features` alınmış sokete yazılır
// (K-P28u-8, DeviceClient.writer). Sürüm Go'da sabit değildir (ldflags `config.version`); özellik belirtece bağlıdır.

// DeviceCapConsent alt protokol yetenek belirteci (kimlik değildir; Caddy loglamaz — G-10).
const DeviceCapConsent = "rs.cap.consent1"

// capConsent1 `device.features.caps` değeri.
const capConsent1 = "consent1"

// Sunucu → cihaz (yalnız consent1 soket).
const (
	tFeatures  = "device.features"
	tIntervene = "intervene"
	tRejoin    = "rejoin"
)

// Cihaz → sunucu (yalnız device.features sonrası).
const (
	tUser            = "device.user"
	tConsentResult   = "consent.result"
	tInterveneResult = "intervene.result"
)

// Kullanıcı durumu (`device.user.state`, AC-429).
const (
	UserActive = "active"
	UserLocked = "locked"
	UserNone   = "none"
)

// Müdahale komutları ve ret nedenleri (contracts INTERVENE_COMMANDS / INTERVENE_FAIL_REASONS).
const (
	CmdLock   = helperio.CmdLock
	CmdLogoff = "logoff"

	InterveneNoSession    = "no_session"
	InterveneNotInControl = "not_in_control"
	InterveneNotLocked    = helperio.ReasonNotLocked
	InterveneNoUser       = "no_user"
	InterveneAPIError     = "api_error"
	InterveneTimeout      = "timeout"
)

// ConsentSilent `connect.consent` izinsiz (servis diyalog göstermez; yardımcıya Consent "none", Mode "silent").
const ConsentSilent = "silent"

// RejectProtocol `consent1` sokette `connect.consent ∉ {ask, silent}` (D-P28u-5, fail-closed).
const RejectProtocol = "protocol"

var interveneFailReasons = map[string]bool{InterveneNoSession: true, InterveneNotInControl: true,
	InterveneNotLocked: true, InterveneNoUser: true, InterveneAPIError: true, InterveneTimeout: true}

// Features `device.features`.
type Features struct {
	T    string   `json:"t"`
	Caps []string `json:"caps"`
}

// Intervene `intervene` (§5.3).
type Intervene struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	ID        string `json:"id"`
	Cmd       string `json:"cmd"`
}

// Rejoin `rejoin` (§7.5). Ticket yalnız yardımcıya borudan geçer.
type Rejoin struct {
	T                string `json:"t"`
	SessionID        string `json:"sessionId"`
	Ticket           string `json:"ticket"`
	Mode             string `json:"mode"`
	IndicatorText    string `json:"indicatorText"`
	IndicatorControl string `json:"indicatorControl,omitempty"`
	ExpiresInSec     int    `json:"expiresInSec"`
}

// DeviceUser `device.user`.
type DeviceUser struct {
	T     string `json:"t"`
	State string `json:"state"`
}

// ConsentResult `consent.result`: asked ⇔ decision+ms; no_user ⇔ ikisi de yok.
type ConsentResult struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	Mode      string `json:"mode"`
	Decision  string `json:"decision,omitempty"`
	Ms        *int   `json:"ms,omitempty"`
}

// InterveneResult `intervene.result`: ok:false ⇔ reason.
type InterveneResult struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	ID        string `json:"id"`
	Cmd       string `json:"cmd"`
	OK        bool   `json:"ok"`
	Reason    string `json:"reason,omitempty"`
}

// connectConsent `connect`'in onay alanlarının consent1 sözleşmesine uyup uymadığı: ask ⇒ indicatorControl yok;
// silent ⇒ indicatorControl zorunlu. Uymayan connect ayrıştırıcıda REDDEDİLMEZ (sessionId bilindiği için çekirdek
// `connect.result{protocol}` döner; 1008 kapanışı yapılmaz) — fikstür testi bu sonucu "reddedildi" sayar.
func connectConsent(m *Connect) bool {
	switch m.Consent {
	case helperio.ConsentAsk:
		return m.IndicatorControl == ""
	case ConsentSilent:
		return helperio.Text(m.IndicatorControl, 160)
	}
	return false
}

// legacyConnect P27 (features'sız) connect: onay alanı yok.
func legacyConnect(m *Connect) bool { return m.Consent == "" && m.IndicatorControl == "" }

func validFeatures(v *Features) bool {
	if len(v.Caps) == 0 || len(v.Caps) > 8 {
		return false
	}
	seen := map[string]bool{}
	for _, c := range v.Caps {
		if c != capConsent1 || seen[c] {
			return false
		}
		seen[c] = true
	}
	return true
}

func validIntervene(v *Intervene) bool {
	return ulidRe.MatchString(v.SessionID) && ulidRe.MatchString(v.ID) && (v.Cmd == CmdLock || v.Cmd == CmdLogoff)
}

func validRejoin(v *Rejoin) bool {
	modeOK := v.Mode == helperio.ModeAsked || v.Mode == helperio.ModeNoUser || v.Mode == helperio.ModeSilent
	ctlOK := v.IndicatorControl == ""
	if v.Mode == helperio.ModeSilent {
		ctlOK = helperio.Text(v.IndicatorControl, 160)
	}
	return ulidRe.MatchString(v.SessionID) && b64url32.MatchString(v.Ticket) && modeOK && ctlOK &&
		helperio.Text(v.IndicatorText, 160) && v.ExpiresInSec >= 1 && v.ExpiresInSec <= RejoinTicketTTLSec
}

// validConsentClient yeni C→S mesajlarının gönderim öncesi denetimi.
func validConsentClient(m any) (bool, bool) {
	switch v := m.(type) {
	case *DeviceUser:
		return v.State == UserActive || v.State == UserLocked || v.State == UserNone, true
	case *ConsentResult:
		if !ulidRe.MatchString(v.SessionID) {
			return false, true
		}
		switch v.Mode {
		case helperio.ModeAsked:
			d := v.Decision
			return (d == helperio.DecisionGranted || d == helperio.DecisionDenied || d == helperio.DecisionTimeout) &&
				v.Ms != nil && *v.Ms >= 0 && *v.Ms <= helperio.MaxConsentMs, true
		case helperio.ModeNoUser:
			return v.Decision == "" && v.Ms == nil, true
		}
		return false, true
	case *InterveneResult:
		base := ulidRe.MatchString(v.SessionID) && ulidRe.MatchString(v.ID) && (v.Cmd == CmdLock || v.Cmd == CmdLogoff)
		if v.OK {
			return base && v.Reason == "", true
		}
		return base && interveneFailReasons[v.Reason], true
	}
	return false, false
}

// consentOnly yalnız `device.features` alınmış sokete yazılabilecek mesaj mı (K-P28u-8).
func consentOnly(m any) bool {
	switch v := m.(type) {
	case *DeviceUser, *ConsentResult, *InterveneResult:
		return true
	case *ConnectResult:
		return v.Reason == RejectProtocol || v.Reason == helperio.ReasonConsentDenied ||
			v.Reason == helperio.ReasonConsentTimeout
	}
	return false
}
