package signal

import (
	"encoding/json"
	"slices"
)

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
	Reason        string    `json:"reason,omitempty"`
	Method        string    `json:"method,omitempty"`
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
	// P28a (§4.2): yalnız role=tech hello'sunda gelir; misafir istemci kullanmaz, şema eşi için doğrulanır.
	GuestFeatures []string `json:"guestFeatures,omitempty"`
	ClipConsent   *bool    `json:"clipConsent,omitempty"`
	// P28b (mimari-p28b §5.1): yalnız fsrv bildiren sokete gelir; yoksa P2P. Oturum boyunca değişmez (AC-355).
	FileMode string `json:"fileMode,omitempty"`
	// P28e (§6.2): yalnız rec1 soketine, yeniden bağlanmada; misafir biçimi {on, reason?}.
	Rec *RecHello `json:"rec,omitempty"`
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
	// P28a (§4.2): yalnız role=guest (teknisyene giden) mesajda; şema eşi için doğrulanır.
	GuestFeatures []string `json:"guestFeatures,omitempty"`
	// P28b: teknisyene giden peer.joined{guest}'te; şema eşi için doğrulanır.
	FileMode string `json:"fileMode,omitempty"`
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

// ControlRequest teknisyenin kontrol isteği (yalnız istek; izin müşteri diyaloğunda, AC-99).
type ControlRequest struct {
	T string `json:"t"`
}

// MonitorRequest teknisyenin monitör değiştirme isteği (AC-43; müşteri diyaloğu).
type MonitorRequest struct {
	T         string `json:"t"`
	MonitorID int    `json:"monitorId"`
}

// ControlRelease teknisyen kontrolü bıraktı (K1); ControlCancel bekleyen isteği geri çekti (K2). İkisinde de istemci
// durumdan bağımsız kapıyı ve açık kontrol diyaloğunu kapatır, yanıt göndermez.
type ControlRelease struct {
	T string `json:"t"`
}

type ControlCancel struct {
	T string `json:"t"`
}

// ControlRevoke sunucu kontrolü geri aldı (G-04/G-15): istemci kapıyı kapatır, açamaz.
type ControlRevoke struct {
	T      string `json:"t"`
	Reason string `json:"reason"`
}

// CapsUpdate teknisyen yetkisi değişti (G-09).
type CapsUpdate struct {
	T    string   `json:"t"`
	Caps []string `json:"caps"`
}

// BindingOffer P8c: sunucu bu misafire kayıt verebilir (yalnız ≥ 0.10.0 AGENT; admit/yeniden bağlanma hello'sundan
// hemen sonra). P20 (§6.1): Multi yalnız ticket `clientVersion ≥ 0.12.0` ise ve yalnız `true` olarak gelir.
type BindingOffer struct {
	T     string `json:"t"`
	Multi *bool  `json:"multi,omitempty"`
}

// IsMulti çoklu firma teklifi (sunucu `previousKeys` kabul eder).
func (m BindingOffer) IsMulti() bool { return m.Multi != nil && *m.Multi }

// BindingIssued P8c: kayıt anahtarı yalnız isteyen sokete. CustomerFirmName null = Genel (alan zorunlu).
// P20: PreviousIndex yalnız `previousKeys`'li isteğe gelir — yenilenen anahtarın listedeki sırası (0..4); null/yok =
// yeni yuva.
type BindingIssued struct {
	T                string  `json:"t"`
	BindingKey       string  `json:"bindingKey"`
	TenantName       string  `json:"tenantName"`
	CustomerFirmName *string `json:"customerFirmName"`
	Renewed          bool    `json:"renewed"`
	PreviousIndex    *int    `json:"previousIndex,omitempty"`
}

func (m BindingOffer) Type() string  { return m.T }
func (m BindingIssued) Type() string { return m.T }

func (m ControlRequest) Type() string { return m.T }
func (m MonitorRequest) Type() string { return m.T }
func (m ControlRevoke) Type() string  { return m.T }
func (m ControlRelease) Type() string { return m.T }
func (m ControlCancel) Type() string  { return m.T }
func (m CapsUpdate) Type() string     { return m.T }

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
	caps          = []string{"remote_control", "file_transfer", "clipboard", "print"} // P28a: + clipboard, print (G-09)
	endedReasons  = []string{"tech", "customer", "timeout", "max_duration", "cancelled", "tenant_passive", "server", "admin", "auth_revoked", "rejected", "lobby_timeout"}
	wsErrorCodes  = []string{"ADMIT_CODE_INVALID", "CONFLICT", "FORBIDDEN", "RATE_LIMITED", "NOT_FOUND", "VALIDATION", "INTERNAL", "BINDING_LIMIT"}
	techOnlyTypes = []string{"peer.pending", "peer.pending.left", "sdp.answer", "share.state", "control.state", "env.state",
		"monitor.denied", "clip.status", "print.status"}
	revokeReasons = []string{"permission", "audit", "admin", "reconnect", "stale"}
)

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
	if parse, ok := serverParsers[env.T]; ok {
		return parse(raw)
	}
	return nil, fail(env.T, "bilinmeyen tip")
}

// serverParsers ParseServer'ın tip başına ayrıştırıcısı: katı çözme + alan doğrulaması.
var serverParsers = map[string]func(raw []byte) (Inbound, error){
	"hello":       check(validHello),
	"lobby.wait":  check(func(m *LobbyWait) bool { return isISO(m.ExpiresAt) }),
	"ice.servers": check(func(m *IceServers) bool { return validIceServers(m.IceServers) }),
	"peer.joined": check(validPeerJoined),
	"peer.left": check(func(m *PeerLeft) bool {
		return slices.Contains(roles, m.Role) && (m.Reason == "" || m.Reason == "disconnect" || m.Reason == "ended")
	}),
	"sdp.offer": check(func(m *SdpOffer) bool { return m.SDP != "" && utf16Len(m.SDP) <= sdpMax }),
	"ice": check(func(m *RemoteIce) bool {
		return validateIce(Ice{T: m.T, Candidate: m.Candidate, SdpMid: m.SdpMid, SdpMLineIndex: m.SdpMLineIndex}) == nil
	}),
	"ice.restart":   check(func(*IceRestart) bool { return true }),
	"session.ended": check(func(m *SessionEnded) bool { return slices.Contains(endedReasons, m.Reason) }),
	"session.warning": check(func(m *SessionWarning) bool {
		return m.Kind == "max_duration_5min" && isISO(m.EndsAt)
	}),
	"control.request": check(func(*ControlRequest) bool { return true }),
	"monitor.request": check(func(m *MonitorRequest) bool { return m.MonitorID >= 0 && m.MonitorID <= monitorIDMax }),
	"control.revoke":  check(func(m *ControlRevoke) bool { return slices.Contains(revokeReasons, m.Reason) }),
	"control.release": check(func(*ControlRelease) bool { return true }),
	"control.cancel":  check(func(*ControlCancel) bool { return true }),
	"caps.update":     check(func(m *CapsUpdate) bool { return validCaps(m.Caps) }),
	"binding.offer":   parseBindingOffer,
	// P28a (mimari-p28 §4.3): pano/yazdırma iletimi; doğrulayıcılar clipprint.go.
	"clip.consent":   check(func(*ClipConsent) bool { return true }),
	"clip.push":      check(validClipPush),
	"clip.pull":      check(func(m *ClipPull) bool { return cpIDRe.MatchString(m.CID) }),
	"print.request":  check(validPrintRequest),
	"print.cancel":   check(func(m *PrintCancel) bool { return cpIDRe.MatchString(m.PID) }),
	"binding.issued": check(validBindingIssued),
	// P28b (mimari-p28b §5.2): sunucu üzerinden dosya; doğrulayıcılar fsrv.go.
	"fsrv.upload":   check(validFsrvUpload),
	"fsrv.status":   check(validFsrvStatus),
	"fsrv.offer":    check(validFsrvOffer),
	"fsrv.download": check(validFsrvDownload),
	// P28e (mimari-p28e §6.2): misafir biçimi {on, reason?}; teknisyen alanları (rid/basis/upload) katı çözmede red.
	"rec.state": check(validRecState),
	"error": check(func(m *ErrorMsg) bool {
		return slices.Contains(wsErrorCodes, m.Code) && utf16Len(m.Message) <= errMsgMax
	}),
}

func validHello(m *Hello) bool {
	return validHelloCaps(m.Caps) && slices.Contains(roles, m.Role) && ulidRe.MatchString(m.SessionID) &&
		validGuestKind(m.GuestKind) && validIceServers(m.IceServers) && (m.MaxEndsAt == nil || isISO(*m.MaxEndsAt)) &&
		validMaxFileMb(m.MaxFileMb) && (m.ReconnectToken == "" || tokenRe.MatchString(m.ReconnectToken)) &&
		(m.GuestName == nil || utf16Len(*m.GuestName) <= nameMax) && validShareSnapshot(m.Share) &&
		validGuestFeatures(m.GuestFeatures) && validFileMode(m.FileMode) && validRecHello(m.Rec)
}

// validHelloCaps hello'da caps isteğe bağlıdır (nil geçerli); varsa yalnız bilinen yetenekler.
func validHelloCaps(list []string) bool {
	for _, c := range list {
		if !slices.Contains(caps, c) {
			return false
		}
	}
	return true
}

func validShareSnapshot(s *ShareSnapshot) bool {
	return s == nil || validateShare(s.State, s.Reason, s.Method, s.Monitors, s.ActiveMonitor) == nil
}

func validPeerJoined(m *PeerJoined) bool {
	return slices.Contains(roles, m.Role) && validGuestKind(m.GuestKind) &&
		(m.GuestName == nil || utf16Len(*m.GuestName) <= nameMax) && (m.MaxEndsAt == "" || isISO(m.MaxEndsAt)) &&
		validMaxFileMb(m.MaxFileMb) && validGuestFeatures(m.GuestFeatures) && validFileMode(m.FileMode)
}

// parseBindingOffer zod `z.literal(true).optional()`: alan varsa yalnız `true` (null/false red).
func parseBindingOffer(raw []byte) (Inbound, error) {
	multiOK := literalTrueIfPresent(raw, "multi")
	return decodeValid(raw, func(*BindingOffer) bool { return multiOK })
}

func validBindingIssued(m *BindingIssued) bool {
	return bindingKeyRe.MatchString(m.BindingKey) && utf16Len(m.TenantName) <= tenantMax &&
		(m.CustomerFirmName == nil || utf16Len(*m.CustomerFirmName) <= custFirmMax) &&
		(m.PreviousIndex == nil || (*m.PreviousIndex >= 0 && *m.PreviousIndex < BindingMaxPerOrigin))
}
