package request

import (
	"strings"
	"testing"
)

const acceptedJSON = `{"t":"request.accepted","wsTicket":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",` +
	`"technicianName":"Mehmet","techVerifyCode":"4821","ticketExpiresAt":"2026-11-12T10:01:00.000Z"`

// AC-239: `request.accepted.admitCode` sıkı şemada kabul edilir (4 hane); kodsuz mesaj eski akış; geçersiz kod red.
func TestAC239AcceptedAdmitCodeStrict(t *testing.T) {
	m, err := ParseServer([]byte(acceptedJSON + `,"admitCode":"0937"}`))
	if a, ok := m.(Accepted); err != nil || !ok || a.AdmitCode != "0937" {
		t.Fatalf("AC-239 kodlu: %#v %v", m, err)
	}
	m, err = ParseServer([]byte(acceptedJSON + `}`))
	if a, ok := m.(Accepted); err != nil || !ok || a.AdmitCode != "" {
		t.Fatalf("AC-239 kodsuz eski akış: %#v %v", m, err)
	}
	for _, bad := range []string{`"123"`, `"12345"`, `"12a4"`, `""`, `1234`, `null`} {
		if _, err := ParseServer([]byte(acceptedJSON + `,"admitCode":` + bad + `}`)); err == nil {
			t.Errorf("AC-239 geçersiz kod kabul edildi: %s", bad)
		}
	}
	if _, err := ParseServer([]byte(acceptedJSON + `,"AdmitCode":"1234"}`)); err == nil || !strings.Contains(err.Error(), "bilinmeyen") {
		t.Errorf("harf duyarlı sıkı şema: %v", err)
	}
}
