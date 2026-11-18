//go:build linux

package portal

import (
	"errors"
	"testing"
)

// S-P28g-1 m.2 / §5.2a m.5: portal okunamazsa libgio yedeği; ikisi de yoksa Known=false (fail-closed).
func TestAC399P28gK3SettingsFallback(t *testing.T) {
	fail := Reader(func(string, string) (any, error) { return nil, errors.New("yok") })
	vals := map[string]any{nsMediaKeys + "/" + keyLock: []string{"<Super>l"}, nsLockdown + "/" + keyNoLock: false,
		nsA11yMouse + "/" + keyDwell: false, nsA11yKeyboard + "/" + keyMouseKeys: true}
	ok := Reader(func(ns, key string) (any, error) {
		if v, found := vals[ns+"/"+key]; found {
			return v, nil
		}
		return nil, errors.New("yok")
	})
	if g := ReadLockGuardWith(Fallback(nil, fail, ok)); !g.OK() {
		t.Fatalf("yedekten okunmalı: %+v", g)
	}
	if g := ReadLockGuardWith(Fallback(fail)); g.Known || g.OK() {
		t.Fatalf("okunamayan koruma geçerli sayıldı: %+v", g)
	}
	if a := ReadA11y(ok); !a.Known || !a.On {
		t.Fatalf("a11y: %+v", a)
	}
	vals[nsA11yKeyboard+"/"+keyMouseKeys] = "true" // tür hatası
	if a := ReadA11y(ok); a.Known {
		t.Fatalf("yanlış tür bilinen sayıldı: %+v", a)
	}
}
