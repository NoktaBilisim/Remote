package ui

// acceptKey açık onay diyaloğunun kimliği (S8b2-4): başlıktaki teknisyen adı + gövdedeki teknisyen doğrulama kodu.
// Yalnız ad yetmez; aynı adlı iki teknisyen farklı kodla gelebilir.
type acceptKey struct {
	tech, verify string
}

type acceptAction int

const (
	acceptOpen   acceptAction = iota // açık diyalog yok: yeni aç
	acceptUpdate                     // aynı teknisyen + aynı kod (yeniden bağlanmada yeni ticket): gövde yerinde güncellenir
	acceptReopen                     // ad veya kod değişti: kapat, yeniden aç (1,5 sn kilit yeniden başlar)
)

// acceptDecision RequestAccepted'in platformdan bağımsız kararı. open=false → karar verilmiş/kapalı diyalog yok sayılır.
func acceptDecision(open bool, cur, next acceptKey) acceptAction {
	switch {
	case !open:
		return acceptOpen
	case cur == next:
		return acceptUpdate
	}
	return acceptReopen
}

// admitLine AC-239: onay diyaloğunda talep kodu satırının sonuna eklenen kabul kodu (rakamlar aralıklı, okunur; gövde
// yüksekliği değişmesin diye ayrı satır değil). Kod boşsa "" (eski akış). "Ekranımı paylaş"tan sonra aynı kod lobi
// ekranında büyük yazıyla ve okuma yönergesiyle gösterilir (screens_windows.go Lobby, flow.RunTicket).
func admitLine(code string) string {
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
