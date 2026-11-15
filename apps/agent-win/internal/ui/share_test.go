package ui

import (
	"strings"
	"testing"
)

// AC-248: pencere listesi süzgeci — görünür, araç penceresi değil, kendi sürecimiz değil, gizlenmemiş, başlıklı.
func TestAC248ShareableWindowsFilter(t *testing.T) {
	const self = 42
	all := []windowCandidate{
		{HWND: 1, Title: "Muhasebe — Fatura", PID: 10, Visible: true},
		{HWND: 2, Title: "Nokta Destek — Oturum", PID: self, Visible: true}, // kendi oturum penceremiz
		{HWND: 3, Title: "Gizli", PID: 11, Visible: false},
		{HWND: 4, Title: "Araç", PID: 12, Visible: true, Tool: true},
		{HWND: 5, Title: "Ayarlar", PID: 13, Visible: true, Cloaked: true},
		{HWND: 6, Title: "  \t ", PID: 14, Visible: true},
		{HWND: 7, Title: "Not Defteri", PID: 15, Visible: true, Iconic: true},
		{HWND: 8, Title: "Satır\r\nsonu", PID: 16, Visible: true},
		{HWND: 9, Title: strings.Repeat("ç", 100), PID: 17, Visible: true},
		{HWND: 0, Title: "sıfır", PID: 18, Visible: true},
		// S-P17-4: kabuk pencereleri (görünür, başlıklı, araç penceresi değil) listelenmez.
		{HWND: 20, Title: "Program Manager", PID: 30, Visible: true, Class: "Progman"},
		{HWND: 21, Title: "Masaüstü", PID: 30, Visible: true, Class: "WorkerW"},
		{HWND: 22, Title: "Görev çubuğu", PID: 30, Visible: true, Class: "Shell_TrayWnd"},
		{HWND: 23, Title: "İkinci görev çubuğu", PID: 30, Visible: true, Class: "Shell_SecondaryTrayWnd"},
		{HWND: 24, Title: "Belgeler", PID: 30, Visible: true, Class: "CabinetWClass"}, // Gezgin penceresi kalır
	}
	got := shareableWindows(all, self)
	want := []shareWindow{{1, "Muhasebe — Fatura"}, {7, "Not Defteri (simge durumunda)"}, {8, "Satır sonu"},
		{9, strings.Repeat("ç", shareTitleMax-1) + "…"}, {24, "Belgeler"}}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%d: %+v, beklenen %+v", i, got[i], want[i])
		}
	}
}

func TestAC248ShareableWindowsCapped(t *testing.T) {
	var all []windowCandidate
	for i := range 100 {
		all = append(all, windowCandidate{HWND: uintptr(i + 1), Title: "p", PID: 1, Visible: true})
	}
	if got := shareableWindows(all, 2); len(got) != shareWindowsMax || got[0].HWND != 1 {
		t.Fatalf("%d", len(got))
	}
	if got := shareableWindows(nil, 2); len(got) != 0 {
		t.Fatal("boş liste")
	}
}
