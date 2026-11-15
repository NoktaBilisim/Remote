package signal

import (
	"encoding/json"
	"regexp"
	"slices"
)

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

// ShareState `share.state`. Reason/Method P15/P17 (AC-234): paylaşım durduğunda neden kodu (capture.Reason) ve son
// yakalama yolu; isteğe bağlı (0.10.x göndermez).
type ShareState struct {
	T             string    `json:"t"`
	ID            string    `json:"id,omitempty"`
	State         string    `json:"state"`
	Reason        string    `json:"reason,omitempty"`
	Method        string    `json:"method,omitempty"`
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

// shareReasonRe contracts `SHARE_FAIL_REASON_PATTERN`; shareMethods `SHARE_METHODS` (ws.ts, P15 AC-234).
var (
	shareReasonRe = regexp.MustCompile(`^[A-Z0-9_]{1,32}$`)
	shareMethods  = []string{"DXGI", "GDI", "WGC"}
)

func validateShare(state, reason, method string, mons []Monitor, active *int) error {
	if state != "sharing" && state != "stopped" {
		return fail("share.state", "state")
	}
	if reason != "" && !shareReasonRe.MatchString(reason) {
		return fail("share.state", "reason")
	}
	if method != "" && !slices.Contains(shareMethods, method) {
		return fail("share.state", "method")
	}
	if err := checkMonitors(mons); err != nil {
		return err
	}
	if active != nil && (*active < 0 || *active > monitorIDMax) {
		return fail("share.state", "activeMonitor")
	}
	return nil
}

// checkMonitors share.state monitör listesi: en çok 16 öğe, kimlik/ad/boyut sınırları.
func checkMonitors(mons []Monitor) error {
	if len(mons) > monitorsMax {
		return fail("share.state", "monitör sayısı")
	}
	for _, mo := range mons {
		if mo.ID < 0 || mo.ID > monitorIDMax || utf16Len(mo.Name) > monitorName || mo.W < 1 || mo.W > monitorPxMax ||
			mo.H < 1 || mo.H > monitorPxMax {
			return fail("share.state", "monitör")
		}
	}
	return nil
}

func (m ShareState) validate() error {
	if m.T != "share.state" {
		return fail(m.T, "tip")
	}
	if err := validateShare(m.State, m.Reason, m.Method, m.Monitors, m.ActiveMonitor); err != nil {
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

// ControlState P7 (AC-29, 111): izin kararı istemcide verilir, sunucu yalnız kaydeder ve teknisyene iletir.
type ControlState struct {
	T      string `json:"t"`
	ID     string `json:"id,omitempty"`
	State  string `json:"state"`
	Source string `json:"source"`
}

// EnvState P7 (AC-105): odaktaki pencere yükseltilmiş / Güvenli Masaüstü; K8 (S7-9): istemci süreci yönetici
// belirteciyle çalışıyor. Üç bool da zorunludur (strict şema) — omitempty YASAK, false da gönderilmeli.
type EnvState struct {
	T                  string `json:"t"`
	ID                 string `json:"id,omitempty"`
	ElevatedForeground bool   `json:"elevatedForeground"`
	SecureDesktop      bool   `json:"secureDesktop"`
	SelfElevated       bool   `json:"selfElevated"`
}

// MonitorDenied P7 K4: müşteri monitör diyaloğunu reddetti (Reddet, Esc veya pencere kapatma).
type MonitorDenied struct {
	T         string `json:"t"`
	ID        string `json:"id,omitempty"`
	MonitorID int    `json:"monitorId"`
}

// guestViewSources misafirin gönderebileceği VIEW kaynakları (mimari-protokol §3; RECONNECT/TECH yalnız sunucu üretir).
var guestViewSources = []string{"UI", "HOTKEY", "DENIED", "SYSTEM"}

func (m ControlState) validate() error {
	if m.T != "control.state" {
		return fail(m.T, "tip")
	}
	switch m.State {
	case "GRANTED":
		// GRANTED yalnız yerel UI kararıyla.
		if m.Source != "UI" {
			return fail(m.T, "GRANTED yalnız UI")
		}
	case "VIEW":
		if !slices.Contains(guestViewSources, m.Source) {
			return fail(m.T, "VIEW kaynağı")
		}
	default:
		return fail(m.T, "state")
	}
	return checkID(m.T, m.ID)
}

func (m MonitorDenied) validate() error {
	if m.T != "monitor.denied" {
		return fail(m.T, "tip")
	}
	if m.MonitorID < 0 || m.MonitorID > monitorIDMax {
		return fail(m.T, "monitorId")
	}
	return checkID(m.T, m.ID)
}

func (m EnvState) validate() error {
	if m.T != "env.state" {
		return fail(m.T, "tip")
	}
	return checkID(m.T, m.ID)
}

// BindingRequest P8c (mimari-protokol §6): guest(AGENT) → S, yalnız `binding.offer` alındıktan sonra. PreviousKey
// yalnız dosyadaki kaydın kanonik kökeni gömülü sunucu kökeniyle aynıysa doldurulur (T43, G-E10-6).
// P20 (§6.1): `multi` teklifinde PreviousKey yerine PreviousKeys (aynı kökenin bütün anahtarları, 1..5, benzersiz) ve
// gömülü kökenin 5 yuvası doluysa Full; ikisi PreviousKey ile birlikte gönderilemez. 0.12 istemci `multi`'siz teklife
// PreviousKey göndermez (başka firmanın kaydı REPLACED olmasın).
type BindingRequest struct {
	T            string   `json:"t"`
	ID           string   `json:"id,omitempty"`
	PreviousKey  string   `json:"previousKey,omitempty"`
	PreviousKeys []string `json:"previousKeys,omitempty"`
	Full         bool     `json:"full,omitempty"`
}

// BindingMaxPerOrigin contracts `BINDING_MAX_PER_DEVICE` (`previousKeys` üst sınırı, köken başına kayıt).
const BindingMaxPerOrigin = 5

func (m BindingRequest) validate() error {
	if m.T != "binding.request" {
		return fail(m.T, "tip")
	}
	if m.PreviousKey != "" && !bindingKeyRe.MatchString(m.PreviousKey) {
		return fail(m.T, "previousKey")
	}
	if len(m.PreviousKeys) > 0 { // boş dilim omitempty ile hiç gitmez
		if m.PreviousKey != "" {
			return fail(m.T, "previousKey ve previousKeys birlikte")
		}
		if len(m.PreviousKeys) > BindingMaxPerOrigin {
			return fail(m.T, "previousKeys sayısı")
		}
		for i, k := range m.PreviousKeys {
			if !bindingKeyRe.MatchString(k) || slices.Contains(m.PreviousKeys[:i], k) {
				return fail(m.T, "previousKeys")
			}
		}
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
