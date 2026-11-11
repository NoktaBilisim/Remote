package control

import "time"

// Trigger "İzin ver"e ulaşan etkileşimin türü.
type Trigger int

const (
	// TrigClick fare tıklaması (düğme üzerinde).
	TrigClick Trigger = iota
	// TrigAccessKey Alt+İ erişim tuşu.
	TrigAccessKey
	// TrigEnterSpace Enter veya Space (varsayılan düğme / odaktaki düğme).
	TrigEnterSpace
)

// Consent tek bir izin diyaloğunun (kontrol, monitör, dosya) G-03 kuralları: varsayılan/odak "Reddet"; Enter/Space
// "İzin ver"i tetiklemez; görünmeden sonraki ilk 1,5 sn hiçbir etkileşim izin vermez; enjekte (LLMHF_INJECTED)
// etkileşim izin vermez; kısayol kaydı yoksa (G-21) kontrol izni hiç verilemez.
type Consent struct {
	ShownAt time.Time
	// HotkeyOK kapatma kısayolu kaydedildi mi (yalnız kontrol diyaloğunda anlamlı; diğerlerinde true verilir).
	HotkeyOK bool
}

// Armed "İzin ver" düğmesi etkin mi (1,5 sn doldu mu).
func (c Consent) Armed(now time.Time) bool { return !now.Before(c.ShownAt.Add(ArmDelay)) }

// CanGrant etkileşim "İzin ver" sayılır mı.
func (c Consent) CanGrant(now time.Time, t Trigger, injected bool) bool {
	return c.HotkeyOK && !injected && t != TrigEnterSpace && c.Armed(now)
}
