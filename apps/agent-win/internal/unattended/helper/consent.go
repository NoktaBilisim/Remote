package helper

import (
	"context"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

// P28u onay diyaloğu karar mantığı (mimari-p28u §7.3, ADR-0033; AC-431). Diyaloğu yardımcı çizer (consent_windows.go,
// sınıf NoktaDestekOnay); karar verilmeden gösterge çizilmez ve `/ws/guest` açılmaz — kare/girdi yapısal olarak 0.

// ConsentTimeout yardımcı içi geri sayım (AC-431: 60 sn; sunucu PENDING 150 sn izin sonrası gösterge + katılım payıdır).
const ConsentTimeout = 60 * time.Second

// ConsentSpec diyaloğun içeriği. Ad ve firma helperio.Input doğrulamasından geçmiştir (Text, ≤ 120, kontrol/çift
// yönlü karakter yok). Firma sunucunun `connect.tenantName` değeridir (D-P28u-6).
// P28e: RecordingLine ise diyalog helperio.RecordingLine satırını çizer; satır çizilip doğrulanmadan "İzin ver"
// etkinleşmez, çizilemezse diyalog açılmaz (decisionFailed — AC-449, AC-292 kalıbı).
type ConsentSpec struct {
	TechName, TenantName string
	Deadline             time.Time
	RecordingLine        bool
}

// recordingLineDrawn "İzin ver" kapısının P28e koşulu (AC-449): satır istenmişse pencere görünür ve metni tam
// helperio.RecordingLine olmalıdır; okunamayan/farklı/gizli satır = düğme kapalı (fail-closed).
func recordingLineDrawn(sp ConsentSpec, text string, visible bool) bool {
	return !sp.RecordingLine || (visible && text == helperio.RecordingLine)
}

// AskConsent diyaloğu gösterir ve karar (helperio.Decision*) ile ilk görünür olduğu anı döner (hiç görünmediyse sıfır).
// ctx bitince (süre doldu) diyalog kapanır ve DecisionTimeout döner. Yalnız `Default` giriş masaüstünde çizilir.
type AskConsent func(ctx context.Context, sp ConsentSpec) (decision string, shownAt time.Time)

// decisionFailed diyalog hiç çizilemedi (sınıf/pencere hatası): `ev:consent` yazılmaz, yardımcı 21 ile biter
// (sunucuda "kullanıcı yanıt vermedi" diye görünmesin).
const decisionFailed = "failed"

// runConsent diyaloğu süre sınırıyla yürütür; kararı ve `ms` (ilk görünürden karara, 0..65000) değerini döner.
// Bilinmeyen karar ret sayılır (fail-closed).
func runConsent(ctx context.Context, ask AskConsent, in helperio.Input, now func() time.Time) (string, int) {
	start := now()
	ctx, cancel := context.WithDeadline(ctx, start.Add(ConsentTimeout))
	defer cancel()
	dec, shown := ask(ctx, ConsentSpec{TechName: in.TechName, TenantName: in.TenantName,
		Deadline: start.Add(ConsentTimeout), RecordingLine: in.Recording})
	switch dec {
	case helperio.DecisionGranted, helperio.DecisionTimeout, decisionFailed:
	default:
		dec = helperio.DecisionDenied
	}
	if shown.IsZero() {
		shown = start
	}
	ms := int(now().Sub(shown) / time.Millisecond)
	return dec, min(max(ms, 0), helperio.MaxConsentMs)
}

// consentExit kararın çıkış kodu (0 = devam).
func consentExit(dec string) uint32 {
	switch dec {
	case helperio.DecisionGranted:
		return 0
	case helperio.DecisionTimeout:
		return helperio.ExitConsentTimeout
	}
	return helperio.ExitConsentDenied
}

// consentTitle onay penceresinin başlığı (2026-11-18): diyalog başlığı + " — " + sürüm etiketi (flow.VersionLabel);
// etiket boşsa başlık aynen. uicore.VersionedTitle'ın uygulama adı içermeyen başlık kuralıyla aynı çıktı.
func consentTitle(title, label string) string {
	if label == "" {
		return title
	}
	return title + " — " + label
}
