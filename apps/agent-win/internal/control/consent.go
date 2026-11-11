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

// Reason CanGrant kararının nedeni (0.8.1: diyalog yalnız ReasonInjected'da kullanıcıya uyarı gösterir).
type Reason int

const (
	// ReasonOK etkileşim izin verir.
	ReasonOK Reason = iota
	// ReasonNoHotkey kapatma kısayolu kaydedilemedi (G-21); düğme zaten hiç etkinleşmez.
	ReasonNoHotkey
	// ReasonEnterSpace Enter/Space "İzin ver"i tetiklemez.
	ReasonEnterSpace
	// ReasonTooEarly görünmeden sonraki ilk 1,5 sn; düğme zaten devre dışıdır.
	ReasonTooEarly
	// ReasonInjected etkileşim yerel donanımdan gelmedi (uzak bağlantı/yazılım, IMO_HARDWARE dışı).
	ReasonInjected
)

// InjectedWarning ReasonInjected ile reddedilen tıklamada diyalogda gösterilen uyarı.
const InjectedWarning = "Bu tıklama uzak bağlantı veya yazılım üzerinden geldiği için kabul edilmedi. İzni yalnız " +
	"bu bilgisayarın kendi faresi veya klavyesiyle verebilirsiniz."

// Check etkileşimin izin verip vermediğini ve vermiyorsa nedenini döner. Kısayol, tetikleyici ve zaman kuralları
// enjeksiyondan önce denetlenir: o durumlarda düğme zaten kullanılamaz, uyarı gösterilmez.
func (c Consent) Check(now time.Time, t Trigger, injected bool) Reason {
	switch {
	case !c.HotkeyOK:
		return ReasonNoHotkey
	case t == TrigEnterSpace:
		return ReasonEnterSpace
	case !c.Armed(now):
		return ReasonTooEarly
	case injected:
		return ReasonInjected
	}
	return ReasonOK
}

// CanGrant etkileşim "İzin ver" sayılır mı.
func (c Consent) CanGrant(now time.Time, t Trigger, injected bool) bool {
	return c.Check(now, t, injected) == ReasonOK
}
