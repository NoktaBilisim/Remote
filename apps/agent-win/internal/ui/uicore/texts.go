package uicore

import (
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/flow"
)

// Win32 ve AppKit arayüzlerinin ortak metin biçimlendiricileri (P28f K4'te internal/ui'den taşındı; çıktı aynı).
// Satır sonu çağıranındır: Win32 "\r\n", AppKit "\n".

// HumanSize bayt sayısının okunur biçimi ("1,5 MB", "12,0 KB", "512 bayt").
func HumanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return strings.Replace(fmt.Sprintf("%.1f MB", float64(n)/(1<<20)), ".", ",", 1)
	case n >= 1<<10:
		return strings.Replace(fmt.Sprintf("%.1f KB", float64(n)/(1<<10)), ".", ",", 1)
	}
	return fmt.Sprintf("%d bayt", n)
}

// RosterLine P28c satırı: "Ad — Rol · Oturum sahibi (bağlantı koptu)".
func RosterLine(t flow.RosterTech) string {
	line := t.Name + " — " + t.Role
	if t.Owner {
		line += " · " + flow.MultiTexts.OwnerBadge
	}
	if !t.Connected {
		line += " (" + flow.MultiTexts.Disconnected + ")"
	}
	return line
}

// PrintBody P28a yazdırma onayı gövdesi: teknisyen, dosya, sayfa · boyut, yazıcı, kalan süre.
func PrintBody(p flow.PrintPrompt, left time.Duration, nl string) string {
	tx := flow.ClipPrintTexts
	secs := max(0, int((left+time.Second-1)/time.Second))
	pages := fmt.Sprintf("%s%d", tx.PromptPages, p.Pages)
	if p.PagesUnknown { // P28f r4 (macOS lp): sayfa sayısı yazıcıda belirlenir
		pages = flow.MacTexts.PrintPagesUnknown
	}
	printer := p.Printer
	if printer == "" {
		printer = flow.MacTexts.PrintDefault
	}
	return fmt.Sprintf(tx.PromptBody, p.TechName) + nl +
		tx.PromptFile + p.FileName + nl +
		pages + "  ·  " + tx.PromptSize + HumanSize(p.Size) + nl +
		tx.PromptPrinter + printer + nl +
		fmt.Sprintf(tx.PromptRemaining, secs)
}

// P33 K2 (mimari-p33 §6.1, §6.3 m.3; AC-542/543/551): macOS "Yalnız bir pencere" metinleri (tek ileti tablosu).
var MacWindowTexts = struct {
	Question, FullScreen, OneWindow, Refresh, Share, Cancel, Empty, Warning, Hint, ListLabel string
}{
	Question:   "Teknisyenle neyi paylaşmak istiyorsunuz?",
	FullScreen: "Tüm ekran",
	OneWindow:  "Yalnız bir pencere",
	Refresh:    "Listeyi yenile",
	Share:      "Paylaş",
	Cancel:     "Vazgeç",
	Empty:      "Paylaşılabilecek pencere yok — programı açıp Listeyi yenile'ye tıklayın",
	Warning:    "Paylaştığınız pencereden açılan yeni pencereler ve menü çubuğu teknisyene görünmez.",
	Hint: "Pencere listede yoksa: Dock'tan açın, bu masaüstüne getirin ya da tam ekrandan çıkın, sonra " +
		"Listeyi yenile'ye tıklayın.",
	ListLabel: "Paylaşılabilecek pencereler",
}

// WindowWatchText AC-551: pencere modunda gösterge metni (kontrol verilmişse WatchText ile aynı).
func WindowWatchText(granted bool, tech string) string {
	if granted {
		return WatchText(true, tech)
	}
	return "Paylaştığınız pencere izleniyor — " + tech
}
