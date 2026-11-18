package helperio

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestAC433InputConsentModeCombos(t *testing.T) {
	n := valid()
	n.Consent, n.Mode = ConsentNone, ModeNoUser
	for _, in := range []Input{valid(), n} {
		if err := in.Validate(); err != nil {
			t.Errorf("%+v: %v", in, err)
		}
	}
	// r3: onay diyaloğu ve izleme kipi yok — eski değerler yardımcıya hiç ulaşmaz (fail-closed).
	bad := []func(*Input){
		func(i *Input) { i.Consent, i.Mode = "ask", "asked" },
		func(i *Input) { i.Consent, i.Mode = ConsentNone, "asked" },
		func(i *Input) { i.Consent, i.Mode = ConsentNone, "silent" },
		func(i *Input) { i.Consent, i.Mode = "maybe", ModeNoUser },
		func(i *Input) { i.Consent = ConsentNone },
		func(i *Input) { i.Mode = ModeNoUser },
	}
	for k, f := range bad {
		in := valid()
		f(&in)
		if in.Validate() == nil {
			t.Errorf("%d kabul edildi", k)
		}
	}
	if _, err := Read(strings.NewReader(`{"v":1,"sessionId":"01JD0000000000000000000002","ticket":"OSTHxpIxRYOEvsy1t7jssmOfVM9-lMgf5dSNuly4uso","techName":"M","tenantName":"N","techIp":"1.2.3.4","indicatorText":"U","expiresInSec":30,"consent":"none","mode":"no_user","indicatorControl":"x"}`)); err == nil {
		t.Fatal("indicatorControl alanı kabul edildi (r3: alan yok)")
	}
}

func TestAC443InputLineThenCommands(t *testing.T) {
	in := valid()
	in.Consent, in.Mode = ConsentNone, ModeNoUser
	b, _ := Encode(in)
	c1, _ := EncodeCommand(Command{Cmd: CmdLock, ID: "01JD0000000000000000000003"})
	if b[len(b)-1] != '\n' {
		t.Fatal("Encode yeni satırla bitmeli (açık boru)")
	}
	stream := append(append([]byte{}, b...), c1...)
	stream = append(stream, []byte("{\"cmd\":\"logoff\",\"id\":\"01JD0000000000000000000004\"}\n")...)
	br := NewReader(bytes.NewReader(stream))
	got, err := ReadInput(br)
	if err != nil || got != in {
		t.Fatalf("%+v %v", got, err)
	}
	c, err := ReadCommand(br)
	if err != nil || c.ID != "01JD0000000000000000000003" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err := ReadCommand(br); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bilinmeyen komut: %v", err)
	}
	if _, err := ReadCommand(br); err != io.EOF {
		t.Fatalf("EOF bekleniyordu: %v", err)
	}
	// P27 servisi: yeni satırsız tek nesne + EOF
	if _, err := ReadInput(NewReader(bytes.NewReader(b))); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadInput(NewReader(strings.NewReader(strings.Repeat("a", MaxInput+10) + "\n"))); err == nil {
		t.Fatal("boyut aşımı kabul edildi")
	}
}

func TestAC431StatusLineAndReasons(t *testing.T) {
	on := true
	b, err := EncodeStatus(Status{Ev: "control", On: &on})
	if err != nil || string(b) != "{\"ev\":\"control\",\"on\":true}\n" {
		t.Fatalf("%s %v", b, err)
	}
	if _, err := EncodeStatus(Status{Ev: "lock", ID: strings.Repeat("x", MaxStatusLine)}); err == nil {
		t.Fatal("512 B aşımı kabul edildi")
	}
	// r3: eski onay çıkış kodları (24/25) tanımsız kod gibi helper_failed; consent_* katılım öncesi ret değildir.
	if Reason(24) != ReasonHelperFailed || Reason(25) != ReasonHelperFailed || PreJoin("consent_denied") ||
		PreJoin("consent_timeout") {
		t.Fatal("eski onay çıkış kodları")
	}
}
