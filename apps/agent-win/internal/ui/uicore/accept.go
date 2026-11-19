package uicore

import "remote-support/agent-win/internal/flow"

// AcceptKey açık onay diyaloğunun kimliği (S8b2-4): başlıktaki teknisyen adı + gövdedeki teknisyen doğrulama kodu.
// Yalnız ad yetmez; aynı adlı iki teknisyen farklı kodla gelebilir.
type AcceptKey struct {
	Tech, Verify string
}

type AcceptAction int

const (
	AcceptOpen   AcceptAction = iota // açık diyalog yok: yeni aç
	AcceptUpdate                     // aynı teknisyen + aynı kod (yeniden bağlanmada yeni ticket): gövde yerinde güncellenir
	AcceptReopen                     // ad veya kod değişti: kapat, yeniden aç (1,5 sn kilit yeniden başlar)
)

// AcceptDecision RequestAccepted'in platformdan bağımsız kararı. open=false → karar verilmiş/kapalı diyalog yok sayılır.
func AcceptDecision(open bool, cur, next AcceptKey) AcceptAction {
	switch {
	case !open:
		return AcceptOpen
	case cur == next:
		return AcceptUpdate
	}
	return AcceptReopen
}

// AdmitLine AC-239: onay diyaloğunda talep kodu satırının sonuna eklenen kabul kodu (rakamlar aralıklı, okunur; gövde
// yüksekliği değişmesin diye ayrı satır değil). Kod boşsa "" (eski akış). "Ekranımı paylaş"tan sonra aynı kod lobi
// ekranında büyük yazıyla ve okuma yönergesiyle gösterilir (screens_windows.go Lobby, flow.RunTicket).
func AdmitLine(code string) string {
	if code == "" {
		return ""
	}
	spaced := make([]byte, 0, 2*len(code))
	for i := 0; i < len(code); i++ {
		if i > 0 {
			spaced = append(spaced, ' ')
		}
		spaced = append(spaced, code[i])
	}
	return "  ·  Kabul kodu: " + string(spaced)
}

// ConsentReady P22 AC-292 (mimari-p22 §9): onay/gönder düğmesi yalnız saklama günü geçerliyken (≥ 1) VE saklama satırı
// ekranda çizildiyse etkin olabilir. Üç platform ve talep formu bu tek kuralı kullanır (diğer koşullar — onay kutusu,
// ad — ayrıca aranır).
func ConsentReady(days int, lineDrawn bool) bool { return days >= 1 && lineDrawn }

// RetentionText düğmenin hemen üstündeki satır: geçerli günde flow.ChatRetentionLine(days); alan yok/0 (eski sunucu) →
// flow.ChatTexts.ServerOutdated.
func RetentionText(days int) string {
	if days < 1 {
		return flow.ChatTexts.ServerOutdated
	}
	return flow.ChatRetentionLine(days)
}

// RetentionDrawn çizilen (geri okunan) satır beklenen saklama satırı mı (lineDrawn kanıtı; sabit true değil).
func RetentionDrawn(days int, readBack string) bool {
	return days >= 1 && readBack == flow.ChatRetentionLine(days)
}
