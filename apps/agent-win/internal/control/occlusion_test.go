package control

import (
	"testing"
	"time"
)

var dlgRect = Rect{100, 100, 540, 330}

func TestAC431ObscuredLayeredTransparentCountsOwnExcluded(t *testing.T) {
	own := func(h uintptr) bool { return h == 7 }
	cases := []struct {
		name  string
		above []ZWindow
		want  bool
	}{
		{"boş", nil, false},
		{"saydam katman keser", []ZWindow{{H: 1, Visible: true, Rect: Rect{0, 0, 2000, 2000}}}, true},
		{"gizli", []ZWindow{{H: 1, Visible: false, Rect: Rect{0, 0, 2000, 2000}}}, false},
		{"sıfır alan", []ZWindow{{H: 1, Visible: true, Rect: Rect{200, 200, 200, 400}}}, false},
		{"kesmiyor", []ZWindow{{H: 1, Visible: true, Rect: Rect{540, 100, 900, 330}}}, false},
		{"kendi gösterge", []ZWindow{{H: 7, Visible: true, Rect: Rect{0, 0, 2000, 2000}}}, false},
		{"kendi + yabancı", []ZWindow{{H: 7, Visible: true, Rect: dlgRect}, {H: 9, Visible: true, Rect: Rect{300, 300, 310, 310}}}, true},
	}
	for _, c := range cases {
		if got := Obscured(dlgRect, c.above, own); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
}

func TestAC431GuardRearmsAfterOcclusionAndHide(t *testing.T) {
	t0 := time.Unix(1000, 0)
	g := NewGuard(t0)
	if g.Enabled(t0.Add(time.Second)) || !g.Enabled(t0.Add(ArmDelay)) {
		t.Fatal("1,5 sn kilit")
	}
	t1 := t0.Add(3 * time.Second)
	g.Observe(t1, true)
	if g.Enabled(t1) || g.Check(t1, TrigClick, false, false, true) != ReasonObscured {
		t.Fatal("örtülüyken İzin ver pasif olmalı")
	}
	t2 := t1.Add(time.Second)
	g.Observe(t2, false)
	if g.Enabled(t2.Add(ArmDelay-time.Millisecond)) || !g.Enabled(t2.Add(ArmDelay)) {
		t.Fatal("örtülme kalkınca kilit yeniden başlamalı")
	}
	t3 := t2.Add(5 * time.Second)
	g.Hide()
	if g.Check(t3, TrigClick, false, false, true) == ReasonOK {
		t.Fatal("gizliyken izin")
	}
	g.Show(t3)
	if g.Enabled(t3) || !g.Enabled(t3.Add(ArmDelay)) {
		t.Fatal("yeniden gösterimde kilit")
	}
	ok := t3.Add(ArmDelay)
	for _, c := range []struct {
		trig                  Trigger
		inj, obscuredNow, hit bool
		want                  Reason
	}{
		{TrigClick, false, false, true, ReasonOK},
		{TrigAccessKey, false, false, true, ReasonOK},
		{TrigEnterSpace, false, false, true, ReasonEnterSpace},
		{TrigClick, true, false, true, ReasonInjected},
		{TrigClick, false, true, true, ReasonObscured},
		{TrigClick, false, false, false, ReasonObscured}, // WindowFromPoint düğme değil
	} {
		if r := g.Check(ok, c.trig, c.inj, c.obscuredNow, c.hit); r != c.want {
			t.Errorf("%+v → %d", c, r)
		}
	}
}

func TestAC439UnattendedAdmitOpenNoSessionLimit(t *testing.T) {
	var r Requests
	for i := 0; i < MaxPerSession+5; i++ {
		if !r.AdmitOpen() {
			t.Fatalf("%d. istek reddedildi", i+1)
		}
		if r.AdmitOpen() {
			t.Fatal("bekleyen varken ikinci istek")
		}
		r.Granted()
	}
}
