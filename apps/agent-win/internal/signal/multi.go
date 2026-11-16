package signal

import (
	"regexp"
	"slices"
)

// P28c çoklu teknisyen WS sözleşme eşi (mimari-p28c r2 §4.4, §11; `packages/contracts/src/ws-multi.ts`). Yalnız tip, sabit
// ve doğrulayıcı (K0); davranış (eş haritası, kabul listesi, iz takası) internal/flow + internal/rtc'de (K3). Uyum
// `packages/contracts/fixtures/multi.json` ile test edilir. SdpOffer/RemoteIce `From`, SdpAnswer/Ice `To` alanları
// inbound.go/outbound.go'da (omitempty; yalnız multi1 sokette dolu).

// FeatureMulti `WS_CAP_MULTI`: Dial'ın features parametresi (0.17.0 istemci + yardımcı).
const FeatureMulti = "rs.cap.multi1"

// Sabitler (`ws-multi.ts`; fikstür `constants`).
const (
	MaxTechs       = 3
	LowFPS         = 8
	LowFPSMin      = 5
	LowBPS         = 1_000_000
	rosterNameMax  = 100
	CloseRemoved   = 4403
	tidPatternText = `^[A-Za-z0-9_-]{11}$`
)

// tidRe oda içi opak teknisyen kimliği (8 bayt base64url = 11 karakter).
var tidRe = regexp.MustCompile(tidPatternText)

// rosterRoles `ROSTER_ROLES`.
var rosterRoles = []string{"controller", "participant", "observer"}

// ValidTID oda içi teknisyen kimliği biçimi (sohbet yayınının `by` alanı).
func ValidTID(s string) bool { return tidRe.MatchString(s) }

// ValidRoster roster değişmezleri (1..3 satır, tid benzersiz, tam bir sahip ve tam bir kontrol sahibi). ParseServer
// zaten uygular; akış ikinci savunma olarak denetler ve ihlalde bağlantıyı koparır.
func ValidRoster(m TechsRoster) bool { return validTechsRoster(&m) }

// validOptTid alan yoksa (eski soket) ya da geçerli tid ise doğru.
func validOptTid(s string) bool { return s == "" || tidRe.MatchString(s) }

// RosterEntry roster satırı. Müşteriye userId GİTMEZ (T10): alan yoktur, gelirse katı çözüm reddeder.
// Owner/Connected işaretçi: iç içe nesnede eksik alan nil kalır ve doğrulayıcı reddeder.
type RosterEntry struct {
	TID       string `json:"tid"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Owner     *bool  `json:"owner"`
	Connected *bool  `json:"connected"`
}

// TechsRoster sunucu → multi1 misafir: bağlı teknisyenler (1..3). Misafir yalnız son roster'da olan ve ekranda çizilmiş
// tid'in sdp.offer'ını kabul eder (Y-PC-4; K3).
type TechsRoster struct {
	T     string        `json:"t"`
	Techs []RosterEntry `json:"techs"`
}

func (m TechsRoster) Type() string { return m.T }

// validTechsRoster `techRosterSchema`: 1..3 satır, tid benzersiz, tam bir sahip ve tam bir kontrol sahibi.
func validTechsRoster(m *TechsRoster) bool {
	if len(m.Techs) < 1 || len(m.Techs) > MaxTechs {
		return false
	}
	owners, controllers := 0, 0
	for i, e := range m.Techs {
		n := utf16Len(e.Name)
		if !tidRe.MatchString(e.TID) || n < 1 || n > rosterNameMax || !slices.Contains(rosterRoles, e.Role) ||
			e.Owner == nil || e.Connected == nil {
			return false
		}
		for _, p := range m.Techs[:i] {
			if p.TID == e.TID {
				return false
			}
		}
		if *e.Owner {
			owners++
		}
		if e.Role == "controller" {
			controllers++
		}
	}
	return owners == 1 && controllers == 1
}

// TechRemove misafir → sunucu (yalnız multi1): müşterinin "Çıkar"ı. Sahip hedeflenemez (sunucu FORBIDDEN).
type TechRemove struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	TID string `json:"tid"`
}

func (m TechRemove) validate() error {
	if m.T != "tech.remove" || !tidRe.MatchString(m.TID) {
		return fail(m.T, "tech.remove")
	}
	return checkID(m.T, m.ID)
}
