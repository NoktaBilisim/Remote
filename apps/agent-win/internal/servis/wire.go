// Package servis gözetimsiz erişim Windows servisinin (`NoktaDestekServis.exe --service`, P27-K5; mimari-p27 §5)
// platformsuz çekirdeğidir: `/ws/device` sözleşmesi ve istemcisi, cihaz anahtarı, yerel anahtar + yardımcı yaşam
// döngüsü (helperMu), boru komut süzgeci, kayıt istemcisi ve olay metinleri. Win32 uygulaması `*_windows.go`
// dosyalarındadır (SCM, HKLM, adlandırılmış boru, DPAPI, yardımcı başlatma, kurulum/kaldırma).
package servis

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// `/ws/device` (mimari-p27 §4.4; contracts `ws-device.ts`, "v":1). Mesaj ayırıcı alanı `t` (ws.ts kalıbı).
const (
	DeviceSubprotocol = "rs.device.v1"
	DevicePath        = "/ws/device"
	DeviceMaxMessage  = 4 * 1024
	ProtocolVersion   = 1
)

// Kapanış kodları (§4.4).
const (
	CloseAuth     = websocket.StatusCode(4401) // imza/iptal/tenant pasif
	CloseGate     = websocket.StatusCode(4403) // imza kapısı (UNATTENDED_MODE)
	CloseReplaced = websocket.StatusCode(4409) // aynı cihaz yeniden bağlandı
)

// Sunucu → cihaz mesaj türleri.
const (
	tHello      = "device.hello"
	tReady      = "device.ready"
	tConnect    = "connect"
	tDisconnect = "disconnect"
	tRevoked    = "revoked"
)

// Cihaz → sunucu mesaj türleri.
const (
	tAuth          = "device.auth"
	tConnectResult = "connect.result"
	tState         = "device.state"
	tClosed        = "session.closed"
	tUnregister    = "device.unregister"
)

// Hello açılış meydan okuması.
type Hello struct {
	T     string `json:"t"`
	V     int    `json:"v"`
	Nonce string `json:"nonce"`
}

// Ready kimlik doğrulandı.
type Ready struct {
	T            string `json:"t"`
	TenantName   string `json:"tenantName"`
	CustomerName string `json:"customerName"`
}

// Connect bağlantı isteği (§2 adım 2). Ticket yalnız yardımcıya borudan geçer.
type Connect struct {
	T             string `json:"t"`
	SessionID     string `json:"sessionId"`
	Ticket        string `json:"ticket"`
	TechName      string `json:"techName"`
	TenantName    string `json:"tenantName"`
	TechIP        string `json:"techIp"`
	ExpiresInSec  int    `json:"expiresInSec"`
	IndicatorText string `json:"indicatorText"`
	// P28u: consent1 sokette zorunlu "ask"|"silent" (çekirdek denetler, connectConsent); indicatorControl yalnız silent.
	Consent          string `json:"consent,omitempty"`
	IndicatorControl string `json:"indicatorControl,omitempty"`
	// P28e (§6.2): yalnız record1 sokete ve yalnız true (validRecording); servis → yardımcı RecordingLine/Recording (K6).
	Recording *bool `json:"recording,omitempty"`
}

// Disconnect sunucu tarafı bitiş (yedek yol).
type Disconnect struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

// Revoked Admin iptali; ardından 4401.
type Revoked struct {
	T string `json:"t"`
}

// Auth `device.auth`.
type Auth struct {
	T            string `json:"t"`
	DeviceID     string `json:"deviceId"`
	Sig          string `json:"sig"`
	Version      string `json:"version"`
	SHA256       string `json:"sha256"`
	Signed       bool   `json:"signed"`
	LocalEnabled bool   `json:"localEnabled"`
	OSVersion    string `json:"osVersion"`
}

// ConnectResult `connect.result`. ok:false iken reason zorunlu, ok:true iken yasak (contracts refine).
type ConnectResult struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	OK        bool   `json:"ok"`
	Reason    string `json:"reason,omitempty"`
}

// State `device.state`.
type State struct {
	T            string `json:"t"`
	LocalEnabled bool   `json:"localEnabled"`
}

// Closed `session.closed`.
type Closed struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

// Unregister `device.unregister`.
type Unregister struct {
	T string `json:"t"`
}

// connect.result ret nedenleri (§4.4).
const (
	RejectLocalDisabled = "local_disabled"
	RejectBusy          = "busy"
)

var (
	ulidRe    = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	b64url32  = regexp.MustCompile(`^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`) // 32 bayt, kanonik (contracts)
	b64url64  = regexp.MustCompile(`^[A-Za-z0-9_-]{85}[AQgw]$`)             // Ed25519 imzası, kanonik
	versionRe = regexp.MustCompile(`^\d{1,3}\.\d{1,3}\.\d{1,3}$`)
	sha256Re  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	reasonRe  = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)
	errSchema = errors.New("servis: sözleşme dışı mesaj")
)

// connectFailReasons contracts DEVICE_CONNECT_FAIL_REASONS.
var connectFailReasons = map[string]bool{RejectLocalDisabled: true, helperio.ReasonIndicatorFailed: true,
	helperio.ReasonHelperFailed: true, helperio.ReasonNoConsole: true, RejectBusy: true,
	helperio.ReasonConsentDenied: true, helperio.ReasonConsentTimeout: true, RejectProtocol: true}

// sessionEndedReasons contracts ws.ts SESSION_ENDED_REASONS (`disconnect.reason`).
var sessionEndedReasons = map[string]bool{"tech": true, "customer": true, "timeout": true, "max_duration": true,
	"cancelled": true, "tenant_passive": true, "server": true, "admin": true, "auth_revoked": true, "rejected": true,
	"lobby_timeout": true, "permission": true, "device_revoked": true, "local_disabled": true, "indicator_failed": true,
	"device_timeout": true, "session_changed": true,
	"consent_denied": true, "consent_timeout": true, "consent_missing": true}

// name contracts `z.string().min(1).max(120)` (sunucu metni; kontrol karakteri ayrıca reddedilir).
func name(s string) bool { return helperio.Text(s, 120) }

// ParseServer sunucu mesajını strict (zod strictObject eşdeğeri, signal.DecodeStrict) çözer ve alanları doğrular.
func ParseServer(raw []byte) (any, error) {
	if len(raw) > DeviceMaxMessage {
		return nil, fmt.Errorf("%w: boyut", errSchema)
	}
	var head struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, fmt.Errorf("%w: json", errSchema)
	}
	var m any
	switch head.T {
	case tHello:
		m = &Hello{}
	case tReady:
		m = &Ready{}
	case tConnect:
		m = &Connect{}
	case tDisconnect:
		m = &Disconnect{}
	case tRevoked:
		m = &Revoked{}
	case tFeatures:
		m = &Features{}
	case tIntervene:
		m = &Intervene{}
	case tRejoin:
		m = &Rejoin{}
	default:
		return nil, fmt.Errorf("%w: tür %q", errSchema, head.T)
	}
	if err := signal.DecodeStrict(raw, m); err != nil {
		return nil, fmt.Errorf("%w: %w", errSchema, err)
	}
	if err := validateServer(m); err != nil {
		return nil, err
	}
	return m, nil
}

func validateServer(m any) error {
	ok := true
	switch v := m.(type) {
	case *Hello:
		ok = v.V == ProtocolVersion && b64url32.MatchString(v.Nonce)
	case *Ready:
		ok = name(v.TenantName) && name(v.CustomerName)
	case *Connect:
		ok = ulidRe.MatchString(v.SessionID) && b64url32.MatchString(v.Ticket) && name(v.TechName) &&
			name(v.TenantName) && len(v.TechIP) >= 2 && len(v.TechIP) <= 45 && v.ExpiresInSec >= 1 &&
			v.ExpiresInSec <= 300 && helperio.Text(v.IndicatorText, 160) && len(v.Consent) <= 16 &&
			(v.IndicatorControl == "" || helperio.Text(v.IndicatorControl, 160)) && validRecording(v.Recording)
	case *Features:
		ok = validFeatures(v)
	case *Intervene:
		ok = validIntervene(v)
	case *Rejoin:
		ok = validRejoin(v)
	case *Disconnect:
		ok = ulidRe.MatchString(v.SessionID) && sessionEndedReasons[v.Reason]
	}
	if !ok {
		return fmt.Errorf("%w: alan", errSchema)
	}
	return nil
}

// validateClient cihaz mesajını sözleşmeye göre denetler (gönderim öncesi fail-closed; contracts ws-device.ts).
func validateClient(m any) bool {
	if ok, known := validConsentClient(m); known {
		return ok
	}
	switch v := m.(type) {
	case *Auth:
		osv := strings.TrimSpace(v.OSVersion)
		return ulidRe.MatchString(v.DeviceID) && b64url64.MatchString(v.Sig) && versionRe.MatchString(v.Version) &&
			sha256Re.MatchString(v.SHA256) && helperio.Text(osv, 64)
	case *ConnectResult:
		if v.OK {
			return ulidRe.MatchString(v.SessionID) && v.Reason == ""
		}
		return ulidRe.MatchString(v.SessionID) && connectFailReasons[v.Reason]
	case *Closed:
		return ulidRe.MatchString(v.SessionID) && reasonRe.MatchString(v.Reason)
	case *State, *Unregister:
		return true
	}
	return false
}

// encodeClient cihaz mesajını `t` alanıyla JSON'a çevirir.
func encodeClient(m any) ([]byte, error) {
	switch v := m.(type) {
	case *Auth:
		v.T = tAuth
	case *ConnectResult:
		v.T = tConnectResult
	case *State:
		v.T = tState
	case *Closed:
		v.T = tClosed
	case *Unregister:
		v.T = tUnregister
	case *DeviceUser:
		v.T = tUser
	case *ConsentResult:
		v.T = tConsentResult
	case *InterveneResult:
		v.T = tInterveneResult
	default:
		return nil, fmt.Errorf("%w: istemci türü %T", errSchema, m)
	}
	if !validateClient(m) {
		return nil, fmt.Errorf("%w: istemci alanı", errSchema)
	}
	return json.Marshal(m)
}
