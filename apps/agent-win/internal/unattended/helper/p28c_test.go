package helper

import (
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/flow"
)

// P28c (mimari-p28c §6 gözetimsiz, Y-PC-4): gösterge eki ve ShowRoster yolu.

func techs(names ...string) flow.RosterView {
	v := flow.RosterView{}
	for _, n := range names {
		v.Techs = append(v.Techs, flow.RosterTech{Name: n})
	}
	return v
}

func TestP28cNamesSuffix(t *testing.T) {
	long := strings.Repeat("ş", nameMaxRunes+5)
	cases := []struct {
		name   string
		v      flow.RosterView
		want   string
		wantOK bool
	}{
		{"tek sahip sunucu metninde", techs("Ali"), "", true},
		{"tek ama farklı ad", techs("Veli"), " · Bağlı: Veli", true},
		{"çoklu", techs("Ali", "Veli"), " · Bağlı: Ali, Veli", true},
		{"uzun ad kırpılır", techs("Ali", long), " · Bağlı: Ali, " + strings.Repeat("ş", nameMaxRunes-1) + "…", true},
		{"yön değiştirme karakteri", techs("Ali", "Ve\u202eli"), "", false},
		{"boş ad", techs("Ali", ""), "", false},
	}
	for _, c := range cases {
		got, ok := namesSuffix(c.v, "Ali")
		if got != c.want || ok != c.wantOK {
			t.Fatalf("%s: %q %v, beklenen %q %v", c.name, got, ok, c.want, c.wantOK)
		}
	}
}

type fakeLive struct {
	ok    bool
	names []string
}

func (f *fakeLive) SetNames(s string) bool {
	f.names = append(f.names, s)
	return f.ok
}

func TestP28cHeadlessShowRoster(t *testing.T) {
	if (&headless{techName: "Ali"}).ShowRoster(techs("Ali")) {
		t.Fatal("gösterge yokken çizim doğrulanamaz")
	}
	live := &fakeLive{ok: true}
	h := &headless{techName: "Ali", live: live}
	if !h.ShowRoster(techs("Ali", "Veli")) || len(live.names) != 1 || live.names[0] != " · Bağlı: Ali, Veli" {
		t.Fatalf("ek: %q", live.names)
	}
	if h.ShowRoster(techs("Ali", "Ve\u202eli")) || len(live.names) != 1 {
		t.Fatal("güvensiz ad: göstergeye yazılmamalı, çizim false")
	}
	live.ok = false
	if h.ShowRoster(techs("Ali", "Veli")) {
		t.Fatal("doğrulanamayan çizim false olmalı")
	}
}

// confirmIndicator çizilen son etiketi doğrulayan gösterge (winIndicator.Drawn eşi).
type confirmIndicator struct{ labelIndicator }

func (c *confirmIndicator) Drawn(text string, _ time.Duration) bool { return c.last() == text }

// Gerçek liveIndicator: ek etikete yazılır ve çizim doğrulanırsa true; Drawn'ı olmayan gösterge doğrulanamaz (false).
func TestP28cLiveSetNamesDrawsSuffix(t *testing.T) {
	ind := &confirmIndicator{labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}}
	h := &headless{techName: "Ali", live: newLive(ind, "İzleme — Ali", false)}
	if !h.ShowRoster(techs("Ali", "Veli")) || ind.last() != "İzleme — Ali · Bağlı: Ali, Veli" {
		t.Fatalf("etiket %q", ind.last())
	}
	if !h.ShowRoster(techs("Ali")) || ind.last() != "İzleme — Ali" {
		t.Fatalf("tek sahibe dönüş: ek kalkmalı, etiket %q", ind.last())
	}
	plain := &labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}
	h2 := &headless{techName: "Ali", live: newLive(plain, "İzleme — Ali", false)}
	if h2.ShowRoster(techs("Ali", "Veli")) {
		t.Fatal("doğrulayamayan gösterge: eş kurulmamalı (Y-PC-4)")
	}
}

// slowConfirm çizimi geç doğrulayan gösterge: ok false iken Drawn zaman aşımına uğrar (winIndicator.Drawn eşi).
type slowConfirm struct {
	labelIndicator
	ok bool
}

func (c *slowConfirm) Drawn(text string, _ time.Duration) bool { return c.ok && c.last() == text }

// D-PC-K1: önceki doğrulama zaman aşımına uğradıysa aynı ek tekrar gelince de çizim doğrulanır; doğrulanmadan true yok.
func TestP28cSetNamesSameSuffixRechecksDrawn(t *testing.T) {
	ind := &slowConfirm{labelIndicator: labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}}
	h := &headless{techName: "Ali", live: newLive(ind, "İzleme — Ali", false)}
	if h.ShowRoster(techs("Ali", "Veli")) {
		t.Fatal("doğrulama zaman aşımı: false olmalı")
	}
	if h.ShowRoster(techs("Ali", "Veli")) {
		t.Fatal("aynı ek tekrar geldi, çizim hâlâ doğrulanmadı: false olmalı (D-PC-K1)")
	}
	ind.ok = true
	if !h.ShowRoster(techs("Ali", "Veli")) {
		t.Fatal("çizim doğrulandı: aynı ek true olmalı")
	}
}
