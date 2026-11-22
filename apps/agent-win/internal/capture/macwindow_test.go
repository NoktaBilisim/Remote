package capture

import (
	"strings"
	"testing"
)

// P33 K2 (mimari-p33 §6.2, §6.3, §9): macOS pencere modunun platformdan bağımsız parçaları (Linux CI'da da).

const secretTitle = "GIZLI-BASLIK-123"

func TestAC543FilterWindows(t *testing.T) {
	ok := MacWindow{ID: 1, Title: "  Fatura   2026  ", App: "Muhasebe", Bundle: "com.example.m", PID: 50, OnScreen: true, W: 800, H: 600}
	long := ok
	long.ID, long.Title = 9, strings.Repeat("ş", 120)
	all := []MacWindow{
		ok,
		{ID: 2, Title: "Menü", PID: 50, Layer: 24, OnScreen: true, W: 300, H: 300},                // katman ≠ 0
		{ID: 3, Title: "Simge", PID: 50, OnScreen: false, W: 800, H: 600},                         // D-P33-1: küçültülmüş listelenmez
		{ID: 4, Title: "", PID: 50, OnScreen: true, W: 800, H: 600},                               // başlıksız
		{ID: 5, Title: "Rozet", PID: 50, OnScreen: true, W: 63, H: 600},                           // < 64 pt
		{ID: 6, Title: "Sahipsiz", PID: 0, OnScreen: true, W: 800, H: 600},                        // owningApplication yok
		{ID: 7, Title: "Kendi", PID: 900, OnScreen: true, W: 800, H: 600},                         // kendi PID'imiz
		{ID: 8, Title: "Dock", PID: 60, Bundle: "com.apple.dock", OnScreen: true, W: 800, H: 600}, // sistem
		{ID: 10, Title: "Spot", PID: 61, Bundle: "com.apple.Spotlight", OnScreen: true, W: 800, H: 600},
		long,
	}
	got := filterWindows(all, 900)
	if len(got) != 2 || got[0].ID != 1 || got[0].Label != "Fatura 2026 — Muhasebe" || got[1].ID != 9 {
		t.Fatalf("%+v", got)
	}
	if r := []rune(strings.TrimSuffix(got[1].Label, " — Muhasebe")); len(r) != macTitleMax || r[len(r)-1] != '…' {
		t.Fatalf("80 karakterde kısaltılmalı: %d", len(r))
	}
	if filterWindows(nil, 1) != nil {
		t.Fatal("boş liste")
	}
	var many []MacWindow
	for i := range 100 {
		many = append(many, MacWindow{ID: uint32(i + 1), Title: "p", PID: 5, OnScreen: true, W: 100, H: 100})
	}
	if len(filterWindows(many, 1)) != macWindowsMax {
		t.Fatal("üst sınır")
	}
}

// S-P33-T-8: başlık yalnız seçim ekranı etiketine girer; pencere modunun ürettiği hiçbir hata/kod metninde yoktur.
func TestAC543TitleNeverInErrors(t *testing.T) {
	got := filterWindows([]MacWindow{{ID: 77, Title: secretTitle, App: secretTitle + "-APP", PID: 5, OnScreen: true, W: 100, H: 100}}, 1)
	if len(got) != 1 || !strings.Contains(got[0].Label, secretTitle) {
		t.Fatal("etiket seçim ekranı için başlığı içermeli")
	}
	for _, e := range []*Error{
		{Reason: ReasonWindowClosed, Op: "CGWindowList", Method: MethodWGC},
		{Reason: ReasonWindowUnavailable, Op: "SCWindow", Method: MethodWGC},
		{Reason: ReasonWindowUnavailable, Op: "SCContentFilterWindow", Method: MethodWGC},
		{Reason: ReasonOther, Op: "updateConfiguration", HR: 7, Method: MethodWGC},
	} {
		for _, s := range []string{e.Error(), e.Code(), e.ShareMethod()} {
			if strings.Contains(s, secretTitle) || strings.Contains(s, "77") {
				t.Fatalf("hata metni başlık/kimlik taşıyor: %q", s)
			}
		}
		if e.ShareMethod() != "WGC" {
			t.Fatalf("pencere modu yöntemi WGC olmalı: %q", e.ShareMethod())
		}
	}
}

func TestAC545WinTrackStates(t *testing.T) {
	tr := winTrack{w: 1280, h: 720}
	steps := []struct {
		o    winObs
		want winAct
	}{
		{winObs{Exists: true, OnScreen: true, W: 1280, H: 720}, winKeep},
		{winObs{Exists: true, OnScreen: true, W: 1600, H: 900}, winResize},
		{winObs{Exists: true, OnScreen: false}, winHide},
		{winObs{Exists: true, OnScreen: false}, winKeep}, // geçişte bir kez
		{winObs{Exists: true, OnScreen: true, W: 1600, H: 900}, winShow},
		{winObs{}, winClosed},
		{winObs{Exists: true, OnScreen: true, W: 1600, H: 900}, winClosed}, // AC-546 kalıcı
	}
	for i, s := range steps {
		if got := tr.observe(s.o); got != s.want {
			t.Fatalf("adım %d: %v beklenen %v", i, got, s.want)
		}
	}
}

// S-P33-T-9: plaka son gerçek karenin boyutundadır (kodlayıcı yeniden kurulmaz) ve gerçek kareden hiçbir piksel taşımaz.
func TestAC545HidePlateReplacesFrame(t *testing.T) {
	real := NewNV12(64, 32)
	for i := range real.Data {
		real.Data[i] = 0xAB
	}
	p := hidePlate(real.W, real.H, nil)
	if p.W != 64 || p.H != 32 || len(p.Data) != len(real.Data) || &p.Data[0] == &real.Data[0] {
		t.Fatal("boyut aynı, tampon ayrı olmalı")
	}
	for i, b := range p.Data {
		want := byte(plateBlackY)
		if i >= 64*32 {
			want = plateChroma
		}
		if b != want {
			t.Fatalf("plaka siyah değil: %d=%d", i, b)
		}
	}
	mask := make([]byte, 64*32)
	mask[5] = 255
	if q := hidePlate(64, 32, mask); q.Data[5] != plateWhiteY || q.Data[6] != plateBlackY {
		t.Fatal("yazı maskesi")
	}
	if d := hidePlate(0, 0, nil); d.W != plateDefault || d.H != plateDefH {
		t.Fatal("varsayılan boyut")
	}
}
