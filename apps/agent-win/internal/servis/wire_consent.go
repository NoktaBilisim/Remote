package servis

import (
	"remote-support/agent-win/internal/servis/helperio"
)

// P28u `/ws/device` ekleri (mimari-p28u §6; contracts `ws-device.ts` deviceConsent*, fikstür `consent1*`). Servis 0.15.0
// alt protokol listesine `rs.cap.consent1` ekler; yeni C→S mesajları yalnız `device.features` alınmış sokete yazılır
// (K-P28u-8, DeviceClient.writer). Sürüm Go'da sabit değildir (ldflags `config.version`); özellik belirtece bağlıdır.
// r3 (mimari-p28u §r3.3, K-P28u-r3-2..5): onaysız tek yol. Servis ayrıca `rs.cap.direct1` bildirir (sunucu bağlanmayı
// yalnız bunu bildiren servise açar); `device.features.caps`'e girmez. `connect.consent` yalnız "ask" (tarihsel ad:
// "gözetimsiz bağlantı isteği; cihaz sormaz"); "silent" (eski sunucu) fail-closed `connect.result{protocol}`.

// DeviceCapConsent alt protokol yetenek belirteci (kimlik değildir; Caddy loglamaz — G-10).
const DeviceCapConsent = "rs.cap.consent1"

// DeviceCapDirect r3 alt protokol yetenek belirteci: bu servis kullanıcıya sormadan açar (K-P28u-r3-2).
const DeviceCapDirect = "rs.cap.direct1"

// ConsentAsk `connect.consent`'in tek geçerli değeri (K-P28u-r3-3; yardımcıya Consent "none", Mode "no_user").
const ConsentAsk = "ask"

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

// RejectProtocol `consent1` sokette `connect.consent` "ask" değil ya da `indicatorControl` dolu (D-P28u-5, K-P28u-r3-5;
// fail-closed).
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

// Rejoin `rejoin` (§7.5). Ticket yalnız yardımcıya borudan geçer. r3: `indicatorControl` alanı yoktur (strict ret).
type Rejoin struct {
	T             string `json:"t"`
	SessionID     string `json:"sessionId"`
	Ticket        string `json:"ticket"`
	Mode          string `json:"mode"`
	IndicatorText string `json:"indicatorText"`
	ExpiresInSec  int    `json:"expiresInSec"`
}

// DeviceUser `device.user`.
type DeviceUser struct {
	T     string `json:"t"`
	State string `json:"state"`
}

// ConsentResult `consent.result` (r3: yalnız mode "no_user"; decision/ms alanı yoktur).
type ConsentResult struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	Mode      string `json:"mode"`
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

// connectConsent `connect`'in onay alanlarının r3 sözleşmesine uyup uymadığı: consent "ask" ve indicatorControl yok.
// Eski sunucunun `silent` connect'i (indicatorControl dolu) ayrıştırıcıda REDDEDİLMEZ (sessionId bilindiği için çekirdek
// `connect.result{protocol}` döner; 1008 kapanışı yapılmaz) — fikstür testi bu sonucu "reddedildi" sayar.
func connectConsent(m *Connect) bool {
	return m.Consent == ConsentAsk && m.IndicatorControl == ""
}

// legacyConnect P27 (features'sız) connect: onay alanı yok.
func legacyConnect(m *Connect) bool {
	return m.Consent == "" && m.IndicatorControl == "" && m.Recording == nil
}

func validFeatures(v *Features) bool {
	if len(v.Caps) == 0 || len(v.Caps) > 8 {
		return false
	}
	seen := map[string]bool{}
	for _, c := range v.Caps {
		if (c != capConsent1 && c != capRecord1) || seen[c] {
			return false
		}
		seen[c] = true
	}
	return true
}

func validIntervene(v *Intervene) bool {
	return ulidRe.MatchString(v.SessionID) && ulidRe.MatchString(v.ID) && (v.Cmd == CmdLock || v.Cmd == CmdLogoff)
}

// validRejoin r3: mode "no_user"; eski sunucunun (P28u..P28f) `asked`'ı kabul edilir ve yardımcı yine no_user başlar
// (mimari-p28u §r3.7; onay yeniden sorulmaz). `silent` reddedilir (silent connect zaten protocol ile reddedilmiştir).
func validRejoin(v *Rejoin) bool {
	return ulidRe.MatchString(v.SessionID) && b64url32.MatchString(v.Ticket) &&
		(v.Mode == helperio.ModeNoUser || v.Mode == modeAskedLegacy) && helperio.Text(v.IndicatorText, 160) &&
		v.ExpiresInSec >= 1 && v.ExpiresInSec <= RejoinTicketTTLSec
}

// modeAskedLegacy eski sunucunun `rejoin.mode` değeri (yalnız okuma).
const modeAskedLegacy = "asked"

// validConsentClient yeni C→S mesajlarının gönderim öncesi denetimi.
func validConsentClient(m any) (bool, bool) {
	switch v := m.(type) {
	case *DeviceUser:
		return v.State == UserActive || v.State == UserLocked || v.State == UserNone, true
	case *ConsentResult:
		return ulidRe.MatchString(v.SessionID) && v.Mode == helperio.ModeNoUser, true
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
		return v.Reason == RejectProtocol
	}
	return false
}
