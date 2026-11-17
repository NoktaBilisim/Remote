//go:build darwin

package input

import (
	"errors"
	"sync"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
)

// P28f düzeltme 1 (Y-P28f-K1): HostProbe'un macOS uygulaması. Fare Tuşları durumu Erişilebilirlik tercih alanından
// (com.apple.universalaccess, anahtar mouseDriver) CFPreferences ile okunur; her okumadan önce alan diskten yeniden
// eşitlenir (oturum sırasında açılırsa ≤ accessEvery'de görülür). Fail-closed: çerçeve/sembol bağlanamazsa, alan
// okunamazsa (anahtar listesi alınamaz ya da boş) ya da değer mantıksal okunamazsa "açık" sayılır. Alan okunabiliyor
// ama anahtar yoksa Fare Tuşları hiç açılmamıştır → kapalı.

var errPrefs = errors.New("input: CFPreferences bağlanamadı")

var prefs struct {
	sync      func(app uintptr) bool
	keyList   func(app, user, host uintptr) uintptr
	copyValue func(key, app uintptr) uintptr
	arrCount  func(a uintptr) int
	user      uintptr // kCFPreferencesCurrentUser
	anyHost   uintptr // kCFPreferencesAnyHost
	app, key  objc.ID // süreç ömrü NSString (CFString ile köprülü)
}

var bindPrefs = sync.OnceValue(func() error {
	if bind() != nil {
		return errPrefs
	}
	f, err := objc.Framework("CoreFoundation")
	if err != nil {
		return errors.Join(errPrefs, err)
	}
	if _, err := objc.Framework("Foundation"); err != nil { // NSString/NSNumber (test sürecinde AppKit yüklenmemiş olabilir)
		return errors.Join(errPrefs, err)
	}
	if err := errors.Join(objc.Func(&prefs.sync, f, "CFPreferencesAppSynchronize"),
		objc.Func(&prefs.keyList, f, "CFPreferencesCopyKeyList"),
		objc.Func(&prefs.copyValue, f, "CFPreferencesCopyAppValue"),
		objc.Func(&prefs.arrCount, f, "CFArrayGetCount")); err != nil {
		return errors.Join(errPrefs, err)
	}
	if prefs.user, err = objc.Symbol(f, "kCFPreferencesCurrentUser"); err != nil {
		return errors.Join(errPrefs, err)
	}
	if prefs.anyHost, err = objc.Symbol(f, "kCFPreferencesAnyHost"); err != nil {
		return errors.Join(errPrefs, err)
	}
	objc.Pool(func() {
		for _, p := range []struct {
			dst  *objc.ID
			text string
		}{{&prefs.app, "com.apple.universalaccess"}, {&prefs.key, "mouseDriver"}} {
			s, e := objc.NSString(p.text)
			if e != nil {
				err = e
				return
			}
			*p.dst = s.Send(objc.Sel("retain"))
		}
	})
	if err != nil || prefs.app == 0 || prefs.key == 0 {
		return errors.Join(errPrefs, err)
	}
	return nil
})

// MouseKeysOn Fare Tuşları açık mı (okunamazsa true).
func MouseKeysOn() bool {
	if bindPrefs() != nil {
		return true
	}
	on := true
	objc.Pool(func() {
		app := uintptr(prefs.app)
		prefs.sync(app)
		readable := false
		if list := prefs.keyList(app, prefs.user, prefs.anyHost); list != 0 {
			readable = prefs.arrCount(list) > 0
			objc.Release(objc.ID(list))
		}
		v := objc.ID(prefs.copyValue(uintptr(prefs.key), app))
		if v != 0 {
			defer objc.Release(v)
		}
		set, val := v != 0, false
		if set && objc.Responds(v, objc.Sel("boolValue")) {
			val = pobjc.Send[bool](v, objc.Sel("boolValue"))
		} else if set {
			val = true // beklenmeyen tür: açık say
		}
		on = mouseKeysState(readable, set, val)
	})
	return on
}

// cursorPos imlecin genel nokta koordinatı (CGEventCreate(NULL) konumu).
func cursorPos() (float64, float64, bool) {
	if bind() != nil {
		return 0, 0, false
	}
	ev := cg.create(0)
	if ev == 0 {
		return 0, 0, false
	}
	p := cg.location(ev)
	cg.release(ev)
	return p.X, p.Y, true
}

type macProbe struct{}

func (macProbe) MouseKeys() bool                  { return MouseKeysOn() }
func (macProbe) Cursor() (float64, float64, bool) { return cursorPos() }

// MacProbe Applier.SetHostProbe için macOS sorguları.
func MacProbe() HostProbe { return macProbe{} }
