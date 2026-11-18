//go:build linux

package portal

import (
	"context"
	"errors"
	"strings"

	"github.com/godbus/dbus/v5"
)

// Kilit kısayolu koruması (mimari-p28g §5.2b m.2, §13 S-P28g-1 m.2): media-keys `screensaver` boş ya da lockdown
// `disable-lock-screen=true` ise Wayland'de kontrol verilmez; oturumda değişirse kontrol kapanır. Değerler portal
// `Settings.Read` ile okunur (godbus). Okunamazsa güvenli sayılmaz (fail-closed).
const (
	ifSettings  = "org.freedesktop.portal.Settings"
	nsMediaKeys = "org.gnome.settings-daemon.plugins.media-keys"
	keyLock     = "screensaver"
	nsLockdown  = "org.gnome.desktop.lockdown"
	keyNoLock   = "disable-lock-screen"
)

// errSetting ayar okunamadı ya da türü beklenmedik.
var errSetting = errors.New("portal: ayar okunamadı")

// LockGuard kilit kısayolu durumu.
type LockGuard struct {
	Known    bool // iki ayar da okunabildi
	Shortcut bool // en az bir boş olmayan kilit kısayolu var
	Disabled bool // disable-lock-screen
}

// OK kilit ekranı kullanıcı tarafından tetiklenebilir (telafi geçerli).
func (g LockGuard) OK() bool { return g.Known && g.Shortcut && !g.Disabled }

// ReadLockGuard iki ayarı portal üzerinden okur.
func ReadLockGuard(b Bus) LockGuard { return ReadLockGuardWith(PortalReader(b)) }

// Reader tek GSettings değerini okur (portal Settings.Read ya da libgio yedeği). Değer []string, string ya da bool.
type Reader func(ns, key string) (any, error)

// PortalReader portal Settings.Read okuyucusu (sahip her çağrıda yeniden sorulur).
func PortalReader(b Bus) Reader {
	return func(ns, key string) (any, error) {
		owner, err := b.Owner(desktopName)
		if err != nil || owner == "" {
			return nil, errSetting
		}
		return readSetting(b, owner, ns, key)
	}
}

// Fallback ilk başarılı okuyucunun değeri (S-P28g-1 m.2: portal, şema sunulmuyorsa libgio). nil okuyucular atlanır.
func Fallback(rs ...Reader) Reader {
	return func(ns, key string) (any, error) {
		for _, r := range rs {
			if r == nil {
				continue
			}
			if v, err := r(ns, key); err == nil {
				return v, nil
			}
		}
		return nil, errSetting
	}
}

// ReadLockGuardWith iki ayarı r ile okur; biri okunamazsa Known=false (fail-closed).
func ReadLockGuardWith(r Reader) LockGuard {
	keys, err1 := r(nsMediaKeys, keyLock)
	off, err2 := r(nsLockdown, keyNoLock)
	if err1 != nil || err2 != nil {
		return LockGuard{}
	}
	return lockGuardOf(keys, off)
}

// Erişilebilirlik tıklama ayarları (§5.2a m.5, S-P28g-3 m.1).
const (
	nsA11yMouse    = "org.gnome.desktop.a11y.mouse"
	keyDwell       = "dwell-click-enabled"
	nsA11yKeyboard = "org.gnome.desktop.a11y.keyboard"
	keyMouseKeys   = "mousekeys-enable"
)

// A11yState bekleme tıklaması / Fare Tuşları durumu.
type A11yState struct {
	Known     bool
	On        bool // ikisinden biri açık
	MouseKeys bool // Fare Tuşları açık (Applier HostProbe)
}

// ReadA11y iki ayarı r ile okur.
func ReadA11y(r Reader) A11yState {
	a, err1 := r(nsA11yMouse, keyDwell)
	b, err2 := r(nsA11yKeyboard, keyMouseKeys)
	ab, ok1 := a.(bool)
	bb, ok2 := b.(bool)
	if err1 != nil || err2 != nil || !ok1 || !ok2 {
		return A11yState{}
	}
	return A11yState{Known: true, On: ab || bb, MouseKeys: bb}
}

// lockGuardOf ayar değerlerinin yorumu: kısayol `as` (GNOME 42+) ya da eski `s`; lockdown `b`.
func lockGuardOf(keys, off any) LockGuard {
	g := LockGuard{}
	switch k := keys.(type) {
	case []string:
		for _, s := range k {
			if strings.TrimSpace(s) != "" {
				g.Shortcut = true
			}
		}
	case string:
		g.Shortcut = strings.TrimSpace(k) != ""
	default:
		return LockGuard{}
	}
	d, ok := off.(bool)
	if !ok {
		return LockGuard{}
	}
	g.Disabled = d
	g.Known = true
	return g
}

// readSetting Settings.Read(ns, key); eski sürümler değeri iç içe varyantla döndürür, açılır.
func readSetting(b Bus, owner, ns, key string) (any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), lockTimeout)
	defer cancel()
	body, err := b.Call(ctx, owner, desktopPath, ifSettings+".Read", ns, key)
	if err != nil || len(body) != 1 {
		return nil, errSetting
	}
	v := body[0]
	for range 3 {
		vv, ok := v.(dbus.Variant)
		if !ok {
			break
		}
		v = vv.Value()
	}
	if _, ok := v.(dbus.Variant); ok {
		return nil, errSetting
	}
	return v, nil
}
