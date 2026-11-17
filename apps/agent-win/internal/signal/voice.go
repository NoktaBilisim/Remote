package signal

import (
	"regexp"
	"slices"
)

// P28d sesli görüşme WS sözleşme eşi (mimari-p28d r2 §4; `packages/contracts/src/ws-voice.ts`). Yalnız tip, sabit ve
// doğrulayıcı (K0); davranış (diyalog, rıza kaydı, mikrofon, mix-minus, talker/gönderim kapısı) internal/flow +
// internal/voice'ta (K3). Uyum `packages/contracts/fixtures/voice.json` ile test edilir.
//
// K-PD-2: VoiceRequest ve VoiceState mikrofon AÇMAZ, yalnız kapatabilir; mikrofon yalnız aynı süreçte o CallID için yerel
// "Kabul et" tıklamasından sonra açılır.

// FeatureVoice `WS_CAP_VOICE`: Dial'ın features parametresi (0.18.0). Gözetimsiz (cihaz bileti/servis/yardımcı)
// bağlantılarında BİLDİRİLMEZ (O-PD-3).
const FeatureVoice = "rs.cap.voice1"

// Sabitler (`ws-voice.ts`; fikstür `constants`).
const (
	VoiceRequestTimeoutMs   = 60_000
	VoiceDenyCooldownMs     = 30_000
	VoiceRequestsPerSession = 10
	// VoiceMaxOpusBytes tek Opus paketi üst sınırı (RFC 6716); çözücü önündeki boyut kapısı (Y-PD-2).
	VoiceMaxOpusBytes = 1275
	// VoiceMaxPktPerSec tid başına saniyede en çok paket (Y-PD-2).
	VoiceMaxPktPerSec = 100
	callIDPatternText = `^[A-Za-z0-9_-]{22}$`
)

// callIDRe sunucu üretimli görüşme kimliği (16 bayt base64url = 22 karakter).
var callIDRe = regexp.MustCompile(callIDPatternText)

// ValidCallID görüşme kimliği biçimi.
func ValidCallID(s string) bool { return callIDRe.MatchString(s) }

// Sözlükler (`VOICE_PHASES`, `VOICE_END_REASONS`, `VOICE_GUEST_END_REASONS`).
var (
	voicePhases          = []string{"idle", "pending", "active"}
	voiceEndReasons      = []string{"tech", "customer", "timeout", "left", "device", "disconnect", "session_ended"}
	voiceGuestEndReasons = []string{"customer", "device"}
)

// Misafir → sunucu nedenleri.
const (
	VoiceEndCustomer = "customer" // müşteri bitirdi ya da rıza kaydı yok
	VoiceEndDevice   = "device"   // mikrofon açılamadı (V-PD-1)
)

// VoiceRequest sunucu → misafir: diyalog açar. By roster'da yoksa yok sayılır (K3; Y-PC-4 kalıbı).
type VoiceRequest struct {
	T      string `json:"t"`
	CallID string `json:"callId"`
	By     string `json:"by"`
}

// VoiceState sunucu → misafir: her değişimde. Talkers/Listeners zorunlu (boş olabilir, null olamaz).
type VoiceState struct {
	T         string   `json:"t"`
	Phase     string   `json:"phase"`
	CallID    string   `json:"callId,omitempty"`
	By        string   `json:"by,omitempty"`
	Talkers   []string `json:"talkers"`
	Listeners []string `json:"listeners"`
	EndReason string   `json:"endReason,omitempty"`
}

func (m VoiceRequest) Type() string { return m.T }
func (m VoiceState) Type() string   { return m.T }

func validVoiceRequest(m *VoiceRequest) bool {
	return callIDRe.MatchString(m.CallID) && tidRe.MatchString(m.By)
}

// validTidSet 0..MaxTechs, biçimi geçerli ve benzersiz tid; nil (JSON null) geçersiz.
func validTidSet(a []string) bool {
	if a == nil || len(a) > MaxTechs {
		return false
	}
	for i, s := range a {
		if !tidRe.MatchString(s) || slices.Contains(a[:i], s) {
			return false
		}
	}
	return true
}

// validVoiceState `voiceStateSchema` değişmezleri: pending/active'de callId zorunlu; idle'da callId yalnız endReason ile;
// endReason yalnız idle'da; talkers ⊆ listeners.
func validVoiceState(m *VoiceState) bool {
	if !slices.Contains(voicePhases, m.Phase) || !validOptTid(m.By) || !validTidSet(m.Talkers) || !validTidSet(m.Listeners) {
		return false
	}
	if m.CallID != "" && !callIDRe.MatchString(m.CallID) {
		return false
	}
	if m.EndReason != "" && (m.Phase != "idle" || !slices.Contains(voiceEndReasons, m.EndReason)) {
		return false
	}
	if m.Phase == "idle" {
		if (m.CallID != "") != (m.EndReason != "") {
			return false
		}
	} else if m.CallID == "" {
		return false
	}
	for _, t := range m.Talkers {
		if !slices.Contains(m.Listeners, t) {
			return false
		}
	}
	return true
}

// VoiceAnswer misafir → sunucu: tıklama anında, rıza kaydıyla aynı anda (K-PD-2).
type VoiceAnswer struct {
	T      string `json:"t"`
	ID     string `json:"id,omitempty"`
	CallID string `json:"callId"`
	Accept bool   `json:"accept"`
}

// VoiceEnd misafir → sunucu: yalnız active iken; Reason VoiceEndCustomer | VoiceEndDevice.
type VoiceEnd struct {
	T      string `json:"t"`
	ID     string `json:"id,omitempty"`
	CallID string `json:"callId"`
	Reason string `json:"reason"`
}

func (m VoiceAnswer) validate() error {
	if m.T != "voice.answer" || !callIDRe.MatchString(m.CallID) {
		return fail(m.T, "voice.answer")
	}
	return checkID(m.T, m.ID)
}

func (m VoiceEnd) validate() error {
	if m.T != "voice.end" || !callIDRe.MatchString(m.CallID) || !slices.Contains(voiceGuestEndReasons, m.Reason) {
		return fail(m.T, "voice.end")
	}
	return checkID(m.T, m.ID)
}
