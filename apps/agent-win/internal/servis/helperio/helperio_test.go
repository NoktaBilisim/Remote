package helperio

import (
	"bytes"
	"strings"
	"testing"
)

func valid() Input {
	return Input{V: Version, SessionID: "01JD0000000000000000000002", Ticket: "OSTHxpIxRYOEvsy1t7jssmOfVM9-lMgf5dSNuly4uso",
		TechName: "Mehmet", TenantName: "Nokta", TechIP: "203.0.113.7", IndicatorText: "Uzaktan bağlantı: Mehmet — Nokta",
		ExpiresInSec: 60}
}

func TestAC341HelperInputRoundTrip(t *testing.T) {
	b, err := Encode(valid())
	if err != nil {
		t.Fatal(err)
	}
	got, err := Read(bytes.NewReader(b))
	if err != nil || got != valid() {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestAC341HelperInputRejects(t *testing.T) {
	bad := []string{
		`{"v":1,"x":1}`,
		strings.Repeat(" ", MaxInput+1),
		`{"v":2}`,
	}
	for _, s := range bad {
		if _, err := Read(strings.NewReader(s)); err == nil {
			t.Errorf("kabul edildi: %.40q", s)
		}
	}
	in := valid()
	in.TechName = "Mehmet\u202eteknisyen"
	if _, err := Encode(in); err == nil {
		t.Fatal("yön değiştirme karakteri kabul edildi")
	}
	b, _ := Encode(valid())
	if _, err := Read(bytes.NewReader(append(b, b...))); err == nil {
		t.Fatal("fazladan veri kabul edildi")
	}
}

func TestExitReasons(t *testing.T) {
	for code, want := range map[uint32]string{ExitEnded: ReasonEnded, ExitIndicatorFailed: ReasonIndicatorFailed,
		ExitNoConsole: ReasonNoConsole, ExitSessionChanged: ReasonSessionChanged, 0xC0000005: ReasonHelperFailed} {
		if Reason(code) != want {
			t.Errorf("%d → %s", code, Reason(code))
		}
	}
	if !PreJoin(ReasonIndicatorFailed) || PreJoin(ReasonEnded) {
		t.Fatal("PreJoin")
	}
}
