package uicore

import (
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/flow"
)

func TestP28fHumanSizeAndRosterLine(t *testing.T) {
	if HumanSize(512) != "512 bayt" || HumanSize(1536) != "1,5 KB" || HumanSize(3<<20) != "3,0 MB" {
		t.Fatal("HumanSize")
	}
	l := RosterLine(flow.RosterTech{Name: "Ali", Role: "Teknisyen", Owner: true})
	if !strings.HasPrefix(l, "Ali — Teknisyen · ") || !strings.HasSuffix(l, ")") {
		t.Fatalf("RosterLine %q", l)
	}
}

// AC-349 (Windows aynı) + r4 macOS: sayfa sayısı bilinmiyorsa "yazıcıda belirlenir", yazıcı adı yoksa "Varsayılan yazıcı".
func TestP28fPrintBody(t *testing.T) {
	p := flow.PrintPrompt{TechName: "Ali", FileName: "a.pdf", Pages: 3, Size: 2 << 20, Printer: "HP"}
	w := PrintBody(p, 30*time.Second, "\r\n")
	if !strings.Contains(w, "Sayfa: 3  ·  Boyut: 2,0 MB\r\nYazıcı: HP\r\n") || !strings.HasSuffix(w, "30 sn") {
		t.Fatalf("%q", w)
	}
	p.PagesUnknown, p.Pages, p.Printer = true, 0, ""
	m := PrintBody(p, 30*time.Second, "\n")
	if !strings.Contains(m, "Sayfa sayısı: yazıcıda belirlenir  ·  Boyut: 2,0 MB\nYazıcı: Varsayılan yazıcı\n") {
		t.Fatalf("%q", m)
	}
}
