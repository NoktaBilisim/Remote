package helperio

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestAC431InputConsentModeCombos(t *testing.T) {
	ok := []Input{valid()}
	a := valid()
	a.Consent, a.Mode = ConsentAsk, ModeAsked
	n := valid()
	n.Consent, n.Mode = ConsentNone, ModeNoUser
	s := valid()
	s.Consent, s.Mode, s.IndicatorControl = ConsentNone, ModeSilent, "Uzaktan kontrol: Mehmet — Nokta"
	ok = append(ok, a, n, s)
	for _, in := range ok {
		if err := in.Validate(); err != nil {
			t.Errorf("%+v: %v", in, err)
		}
	}
	bad := []func(*Input){
		func(i *Input) { i.Consent, i.Mode = ConsentAsk, ModeSilent },
		func(i *Input) { i.Consent, i.Mode = ConsentNone, ModeAsked },
		func(i *Input) { i.Consent = "maybe" },
		func(i *Input) { i.Consent, i.Mode = ConsentNone, ModeSilent }, // indicatorControl eksik
		func(i *Input) { i.Consent, i.Mode, i.IndicatorControl = ConsentAsk, ModeAsked, "x" },
		func(i *Input) { i.Consent, i.Mode, i.IndicatorControl = ConsentNone, ModeSilent, "a\u202eb" },
	}
	for k, f := range bad {
		in := valid()
		f(&in)
		if in.Validate() == nil {
			t.Errorf("%d kabul edildi", k)
		}
	}
}

func TestAC443InputLineThenCommands(t *testing.T) {
	in := valid()
	in.Consent, in.Mode = ConsentAsk, ModeAsked
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
	ms := 1200
	b, err := EncodeStatus(Status{Ev: "consent", Decision: DecisionGranted, Ms: &ms})
	if err != nil || string(b) != "{\"ev\":\"consent\",\"decision\":\"granted\",\"ms\":1200}\n" {
		t.Fatalf("%s %v", b, err)
	}
	if _, err := EncodeStatus(Status{Ev: "lock", ID: strings.Repeat("x", MaxStatusLine)}); err == nil {
		t.Fatal("512 B aşımı kabul edildi")
	}
	if Reason(ExitConsentDenied) != ReasonConsentDenied || Reason(ExitConsentTimeout) != ReasonConsentTimeout ||
		!PreJoin(ReasonConsentDenied) || !PreJoin(ReasonConsentTimeout) {
		t.Fatal("onay çıkış kodları")
	}
}
