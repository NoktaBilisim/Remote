package helperio

import (
	"bufio"
	"strings"
	"testing"
)

// P28e K6: girdi ve komut sözleşmesi (AC-448, AC-449).

func TestAC449InputRecordingOnlyWithP28uInput(t *testing.T) {
	in := Input{V: Version, SessionID: "01JX0000000000000000000000", Ticket: "tabcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
		TechName: "Ali", TenantName: "Acme", IndicatorText: "Uzaktan bağlantı: Ali — Acme", ExpiresInSec: 60, Recording: true}
	if in.Validate() == nil {
		t.Fatal("P27 girdisinde recording kabul edildi")
	}
	in.Consent, in.Mode = ConsentNone, ModeNoUser
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	b := `{"v":1,"sessionId":"01JX0000000000000000000000","ticket":"tabcdefghijklmnopqrstuvwxyz0123456789ABCDEF",` +
		`"techName":"Ali","tenantName":"Acme","techIp":"","indicatorText":"X","expiresInSec":60,"consent":"none",` +
		`"mode":"no_user","recording":true}` + "\n"
	got, err := ReadInput(NewReader(strings.NewReader(b)))
	if err != nil || !got.Recording {
		t.Fatalf("%v %+v", err, got)
	}
}

func TestAC448RecCommandContract(t *testing.T) {
	on := true
	good := []Command{{Cmd: CmdRec, On: &on}, {Cmd: CmdLock, ID: "01JX0000000000000000000001"}}
	bad := []Command{{Cmd: CmdRec}, {Cmd: CmdRec, ID: "01JX0000000000000000000001", On: &on},
		{Cmd: CmdLock, ID: "01JX0000000000000000000001", On: &on}, {Cmd: "stop", On: &on}}
	for _, c := range good {
		b, err := EncodeCommand(c)
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		if _, err := ReadCommand(bufio.NewReader(strings.NewReader(string(b)))); err != nil {
			t.Fatalf("%s: %v", b, err)
		}
	}
	if b, _ := EncodeCommand(good[0]); string(b) != "{\"cmd\":\"rec\",\"on\":true}\n" {
		t.Fatalf("kodlama %s", b)
	}
	for _, c := range bad {
		if _, err := EncodeCommand(c); err == nil {
			t.Fatalf("geçersiz komut kodlandı: %+v", c)
		}
	}
}

func TestAC448IndicatorLabel(t *testing.T) {
	if IndicatorLabel("A", false) != "A" || IndicatorLabel("A", true) != "A — Kayıt yapılıyor" {
		t.Fatal("etiket")
	}
	if !Text(IndicatorLabel(strings.Repeat("a", 160), true), 200) {
		t.Fatal("metin denetimi")
	}
}
