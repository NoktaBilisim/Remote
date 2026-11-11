// Package signal WS sinyalizasyon istemcisidir (mimari-protokol §1–3). Sözleşme `packages/contracts/src/ws.ts`
// ile elle yazılmış struct'larla uygulanır; uyum `packages/contracts/fixtures/ws-messages.json` ile test edilir.
package signal

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"
)

// Sınırlar ws.ts ile aynı.
const (
	sdpMax       = 60_000
	candidateMax = 2000
	sdpMidMax    = 32
	mlineMax     = 16
	idMax        = 26
	fileNameMax  = 255
	fileSizeCap  = 2048 * 1024 * 1024
	monitorsMax  = 16
	monitorIDMax = 64
	monitorName  = 64
	monitorPxMax = 16384
	nameMax      = 100
	errMsgMax    = 300
	iceURLMax    = 300
	iceCredMax   = 200
)

var (
	ulidRe   = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	isoRe    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)
	sha256Re = regexp.MustCompile(`^[a-f0-9]{64}$`)
	tokenRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

// ErrNotForGuest sözleşmede geçerli ama misafire hiç gönderilmeyen tip (ör. peer.pending); alınırsa protokol ihlali.
var ErrNotForGuest = errors.New("signal: tip misafire yönelik değil")

func fail(t, why string) error { return fmt.Errorf("signal: %s: %s", t, why) }

func isISO(s string) bool {
	if !isoRe.MatchString(s) {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}

// zod string uzunluğu UTF-16 birimidir; BMP dışı karakter 2 sayılır.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------------------------------------------------------
// İstemci (misafir) → sunucu: guestInboundSchema

// Outbound misafirin gönderebileceği mesaj.
type Outbound interface{ validate() error }

type SdpAnswer struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	SDP string `json:"sdp"`
}

type Ice struct {
	T             string  `json:"t"`
	ID            string  `json:"id,omitempty"`
	Candidate     string  `json:"candidate"`
	SdpMid        *string `json:"sdpMid,omitempty"`
	SdpMLineIndex *int    `json:"sdpMLineIndex,omitempty"`
}

type Monitor struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	W       int    `json:"w"`
	H       int    `json:"h"`
	Primary bool   `json:"primary"`
}

type ShareState struct {
	T             string    `json:"t"`
	ID            string    `json:"id,omitempty"`
	State         string    `json:"state"`
	Monitors      []Monitor `json:"monitors,omitempty"`
	ActiveMonitor *int      `json:"activeMonitor,omitempty"`
}

type SessionEnd struct {
	T  string `json:"t"`
	ID string `json:"id,omitempty"`
}

type FileMeta struct {
	T         string `json:"t"`
	ID        string `json:"id,omitempty"`
	Direction string `json:"direction"`
	FileName  string `json:"fileName"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
	Result    string `json:"result"`
}

func checkID(t, id string) error {
	if utf16Len(id) > idMax {
		return fail(t, "id uzun")
	}
	return nil
}

func (m SdpAnswer) validate() error {
	if m.T != "sdp.answer" {
		return fail(m.T, "tip")
	}
	if m.SDP == "" || utf16Len(m.SDP) > sdpMax {
		return fail(m.T, "sdp uzunluğu")
	}
	return checkID(m.T, m.ID)
}

func validateIce(m Ice) error {
	if utf16Len(m.Candidate) > candidateMax {
		return fail("ice", "candidate uzun")
	}
	if m.SdpMid != nil && utf16Len(*m.SdpMid) > sdpMidMax {
		return fail("ice", "sdpMid uzun")
	}
	if m.SdpMLineIndex != nil && (*m.SdpMLineIndex < 0 || *m.SdpMLineIndex > mlineMax) {
		return fail("ice", "sdpMLineIndex aralık dışı")
	}
	return checkID("ice", m.ID)
}

func (m Ice) validate() error {
	if m.T != "ice" {
		return fail(m.T, "tip")
	}
	return validateIce(m)
}

func validateShare(state string, mons []Monitor, active *int) error {
	if state != "sharing" && state != "stopped" {
		return fail("share.state", "state")
	}
	if len(mons) > monitorsMax {
		return fail("share.state", "monitör sayısı")
	}
	for _, mo := range mons {
		if mo.ID < 0 || mo.ID > monitorIDMax || utf16Len(mo.Name) > monitorName || mo.W < 1 || mo.W > monitorPxMax ||
			mo.H < 1 || mo.H > monitorPxMax {
			return fail("share.state", "monitör")
		}
	}
	if active != nil && (*active < 0 || *active > monitorIDMax) {
		return fail("share.state", "activeMonitor")
	}
	return nil
}

func (m ShareState) validate() error {
	if m.T != "share.state" {
		return fail(m.T, "tip")
	}
	if err := validateShare(m.State, m.Monitors, m.ActiveMonitor); err != nil {
		return err
	}
	return checkID(m.T, m.ID)
}

func (m SessionEnd) validate() error {
	if m.T != "session.end" {
		return fail(m.T, "tip")
	}
	return checkID(m.T, m.ID)
}

func (m FileMeta) validate() error {
	if m.T != "file.meta" {
		return fail(m.T, "tip")
	}
	if m.Direction != "TO_CUSTOMER" && m.Direction != "TO_TECH" {
		return fail(m.T, "direction")
	}
	if m.FileName == "" || utf16Len(m.FileName) > fileNameMax {
		return fail(m.T, "fileName")
	}
	if m.SizeBytes < 0 || m.SizeBytes > fileSizeCap || !sha256Re.MatchString(m.SHA256) {
		return fail(m.T, "boyut/sha256")
	}
	if !slices.Contains([]string{"OK", "REJECTED", "CANCELLED", "CORRUPT"}, m.Result) {
		return fail(m.T, "result")
	}
	return checkID(m.T, m.ID)
}

// Encode doğrulanmış mesajı JSON'a çevirir; geçersiz mesaj gönderilmez (sunucu 1008 ile kapatırdı).
func Encode(m Outbound) ([]byte, error) {
	if err := m.validate(); err != nil {
		return nil, err
	}
	return json.Marshal(m)
}

// ---------------------------------------------------------------------------------------------------------------
// Sunucu → istemci (misafir): serverOutboundSchema'nın misafire gelen tipleri

// Inbound sunucudan misafire gelen doğrulanmış mesaj.
type Inbound interface{ Type() string }

type IceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type ShareSnapshot struct {
	State         string    `json:"state"`
	Monitors      []Monitor `json:"monitors,omitempty"`
	ActiveMonitor *int      `json:"activeMonitor,omitempty"`
}

type Hello struct {
	T              string         `json:"t"`
	Role           string         `json:"role"`
	SessionID      string         `json:"sessionId"`
	PeerPresent    bool           `json:"peerPresent"`
	GuestKind      string         `json:"guestKind,omitempty"`
	IceServers     []IceServer    `json:"iceServers"`
	MaxEndsAt      *string        `json:"maxEndsAt"`
	Caps           []string       `json:"caps,omitempty"`
	MaxFileMb      *int           `json:"maxFileMb,omitempty"`
	ReconnectToken string         `json:"reconnectToken,omitempty"`
	GuestName      *string        `json:"guestName,omitempty"`
	Share          *ShareSnapshot `json:"share,omitempty"`
}

type LobbyWait struct {
	T         string `json:"t"`
	ExpiresAt string `json:"expiresAt"`
}

type IceServers struct {
	T          string      `json:"t"`
	IceServers []IceServer `json:"iceServers"`
}

type PeerJoined struct {
	T         string  `json:"t"`
	Role      string  `json:"role"`
	GuestKind string  `json:"guestKind,omitempty"`
	GuestName *string `json:"guestName,omitempty"`
	MaxEndsAt string  `json:"maxEndsAt,omitempty"`
	MaxFileMb *int    `json:"maxFileMb,omitempty"`
}

type PeerLeft struct {
	T      string `json:"t"`
	Role   string `json:"role"`
	Reason string `json:"reason,omitempty"`
}

// SdpOffer teknisyenin offer'ı (sunucu id'yi atarak yeniden kurar).
type SdpOffer struct {
	T   string `json:"t"`
	SDP string `json:"sdp"`
}

// RemoteIce karşı tarafın ICE adayı (id'siz).
type RemoteIce struct {
	T             string  `json:"t"`
	Candidate     string  `json:"candidate"`
	SdpMid        *string `json:"sdpMid,omitempty"`
	SdpMLineIndex *int    `json:"sdpMLineIndex,omitempty"`
}

type IceRestart struct {
	T string `json:"t"`
}

type SessionEnded struct {
	T      string `json:"t"`
	Reason string `json:"reason"`
}

type SessionWarning struct {
	T      string `json:"t"`
	Kind   string `json:"kind"`
	EndsAt string `json:"endsAt"`
}

type ErrorMsg struct {
	T       string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (m Hello) Type() string          { return m.T }
func (m LobbyWait) Type() string      { return m.T }
func (m IceServers) Type() string     { return m.T }
func (m PeerJoined) Type() string     { return m.T }
func (m PeerLeft) Type() string       { return m.T }
func (m SdpOffer) Type() string       { return m.T }
func (m RemoteIce) Type() string      { return m.T }
func (m IceRestart) Type() string     { return m.T }
func (m SessionEnded) Type() string   { return m.T }
func (m SessionWarning) Type() string { return m.T }
func (m ErrorMsg) Type() string       { return m.T }

var (
	roles         = []string{"tech", "guest"}
	guestKinds    = []string{"BROWSER", "AGENT"}
	caps          = []string{"remote_control", "file_transfer"}
	endedReasons  = []string{"tech", "customer", "timeout", "max_duration", "cancelled", "tenant_passive", "server", "admin", "auth_revoked", "rejected", "lobby_timeout"}
	wsErrorCodes  = []string{"ADMIT_CODE_INVALID", "CONFLICT", "FORBIDDEN", "RATE_LIMITED", "NOT_FOUND", "VALIDATION"}
	techOnlyTypes = []string{"peer.pending", "peer.pending.left", "sdp.answer", "share.state"}
)

func validIceServers(list []IceServer) bool {
	if list == nil {
		return false
	}
	for _, s := range list {
		if len(s.URLs) == 0 || utf16Len(s.Username) > iceCredMax || utf16Len(s.Credential) > iceCredMax {
			return false
		}
		for _, u := range s.URLs {
			if utf16Len(u) > iceURLMax {
				return false
			}
		}
	}
	return true
}

func validMaxFileMb(v *int) bool { return v == nil || (*v >= 1 && *v <= 2048) }

func validGuestKind(k string) bool { return k == "" || slices.Contains(guestKinds, k) }

// ParseServer ham WS metnini doğrular (sunucunun misafire gönderdiği tipler). Bilinmeyen tip/alan, eksik alan veya
// sınır ihlali hata döner — çağıran bağlantıyı kapatır.
func ParseServer(raw []byte) (Inbound, error) {
	var env struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fail("?", "json")
	}
	if slices.Contains(techOnlyTypes, env.T) {
		return nil, ErrNotForGuest
	}
	switch env.T {
	case "hello":
		return decodeValid(raw, func(m *Hello) bool {
			for _, c := range m.Caps {
				if !slices.Contains(caps, c) {
					return false
				}
			}
			return slices.Contains(roles, m.Role) && ulidRe.MatchString(m.SessionID) && validGuestKind(m.GuestKind) &&
				validIceServers(m.IceServers) && (m.MaxEndsAt == nil || isISO(*m.MaxEndsAt)) && validMaxFileMb(m.MaxFileMb) &&
				(m.ReconnectToken == "" || tokenRe.MatchString(m.ReconnectToken)) &&
				(m.GuestName == nil || utf16Len(*m.GuestName) <= nameMax) &&
				(m.Share == nil || validateShare(m.Share.State, m.Share.Monitors, m.Share.ActiveMonitor) == nil)
		})
	case "lobby.wait":
		return decodeValid(raw, func(m *LobbyWait) bool { return isISO(m.ExpiresAt) })
	case "ice.servers":
		return decodeValid(raw, func(m *IceServers) bool { return validIceServers(m.IceServers) })
	case "peer.joined":
		return decodeValid(raw, func(m *PeerJoined) bool {
			return slices.Contains(roles, m.Role) && validGuestKind(m.GuestKind) &&
				(m.GuestName == nil || utf16Len(*m.GuestName) <= nameMax) && (m.MaxEndsAt == "" || isISO(m.MaxEndsAt)) &&
				validMaxFileMb(m.MaxFileMb)
		})
	case "peer.left":
		return decodeValid(raw, func(m *PeerLeft) bool {
			return slices.Contains(roles, m.Role) && (m.Reason == "" || m.Reason == "disconnect" || m.Reason == "ended")
		})
	case "sdp.offer":
		return decodeValid(raw, func(m *SdpOffer) bool { return m.SDP != "" && utf16Len(m.SDP) <= sdpMax })
	case "ice":
		return decodeValid(raw, func(m *RemoteIce) bool {
			return validateIce(Ice{T: m.T, Candidate: m.Candidate, SdpMid: m.SdpMid, SdpMLineIndex: m.SdpMLineIndex}) == nil
		})
	case "ice.restart":
		return decodeValid(raw, func(*IceRestart) bool { return true })
	case "session.ended":
		return decodeValid(raw, func(m *SessionEnded) bool { return slices.Contains(endedReasons, m.Reason) })
	case "session.warning":
		return decodeValid(raw, func(m *SessionWarning) bool { return m.Kind == "max_duration_5min" && isISO(m.EndsAt) })
	case "error":
		return decodeValid(raw, func(m *ErrorMsg) bool {
			return slices.Contains(wsErrorCodes, m.Code) && utf16Len(m.Message) <= errMsgMax
		})
	}
	return nil, fail(env.T, "bilinmeyen tip")
}

func decodeValid[M Inbound](raw []byte, ok func(*M) bool) (Inbound, error) {
	var m M
	if err := decodeStrict(raw, &m); err != nil {
		return nil, err
	}
	if !ok(&m) {
		return nil, fail(m.Type(), "şema ihlali")
	}
	return m, nil
}
