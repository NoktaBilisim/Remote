package api

import (
	"encoding/json"
	"testing"

	"remote-support/agent-win/internal/signal"
)

// AC-381 (mimari-p28e §8 api): `consentText.recording` katı değildir — yokken, tamken ve bilinmeyen alanla ayrışır;
// kutu yalnız offered ∧ SHA == derlemedeki cümle iken gösterilir.
func TestAC381ConsentTextRecordingOfferParsing(t *testing.T) {
	cases := []struct {
		name string
		rec  string
		want bool
	}{
		{"alan yok (eski sunucu)", ``, false},
		{"teklif", `,"recording":{"offered":true,"line":"x","lineSha256":"` + signal.RecConsentLineSHA256 + `"}`, true},
		{"teklif değil", `,"recording":{"offered":false,"line":"x","lineSha256":"` + signal.RecConsentLineSHA256 + `"}`, false},
		{"farklı cümle SHA", `,"recording":{"offered":true,"line":"x","lineSha256":"` + zeros64 + `"}`, false},
		{"bilinmeyen alan", `,"recording":{"offered":true,"line":"x","lineSha256":"` + signal.RecConsentLineSHA256 + `","yeni":1}`, true},
		{"null", `,"recording":null`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := `{"sessionRef":"r","consentText":{"id":"ct1","version":3,"body":"b","sha256":"s"` + c.rec + `},"joinNonce":"n"}`
			var res ResolveResult
			if err := json.Unmarshal([]byte(raw), &res); err != nil {
				t.Fatalf("ayrışmadı: %v", err)
			}
			if got := res.ConsentText.RecOffered(); got != c.want {
				t.Fatalf("RecOffered = %v, beklenen %v", got, c.want)
			}
			if res.ConsentText.ID != "ct1" || res.ConsentText.Version != 3 {
				t.Fatalf("eski alanlar bozuldu: %+v", res.ConsentText)
			}
		})
	}
	// Talep formu yanıtı aynı tipi taşır (TenantRequestInfo).
	var info TenantRequestInfo
	raw := `{"tenant":{"name":"Acme","logoUrl":null},"consentText":{"id":"c","version":1,"body":"b","sha256":"s",` +
		`"recording":{"offered":true,"line":"x","lineSha256":"` + signal.RecConsentLineSHA256 + `"}},"waitMinutes":5}`
	if err := json.Unmarshal([]byte(raw), &info); err != nil || !info.ConsentText.RecOffered() {
		t.Fatalf("talep bilgisinde teklif okunmadı: %v", err)
	}
}

const zeros64 = "0000000000000000000000000000000000000000000000000000000000000000"
