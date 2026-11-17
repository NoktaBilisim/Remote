//go:build darwin

package capture

import (
	"sync"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/env"
)

// EnvProbe AC-105 / AC-392 macOS karşılığı (flow.Deps.EnvProbe): kilit ekranı açıksa ya da oturum konsolda değilse
// (hızlı kullanıcı değiştirme) SecureDesktop=true → teknisyen konsolunda mevcut "Müşteri güvenli masaüstünde"
// iletisi. CGSessionCopyCurrentDictionary izin istemez; env.Every (500 ms) aralıkla çağrılır. Yükseltilmiş ön plan
// penceresi (UIPI) macOS'ta yoktur.
func EnvProbe() env.State {
	if fwErr != nil {
		return env.State{}
	}
	keys := sessionKeys()
	if keys.locked == 0 || keys.onConsole == 0 {
		return env.State{}
	}
	d := cgSessionCopyDc()
	if d == 0 {
		return env.State{SecureDesktop: true} // oturum sözlüğü yok: konsol oturumu değil
	}
	defer cfRelease(d)
	return env.State{SecureDesktop: sessionLocked(boolKey(d, keys.locked), boolKey(d, keys.onConsole))}
}

// sessionLocked kilit anahtarı varsa ve doğruysa ya da konsol anahtarı varsa ve yanlışsa güvenli masaüstü sayılır
// (anahtar yoksa: kilitli değil / konsolda).
func sessionLocked(locked, onConsole optBool) bool {
	return (locked.set && locked.v) || (onConsole.set && !onConsole.v)
}

type optBool struct{ set, v bool }

func boolKey(d, key uintptr) optBool {
	v := cfDictGet(d, key)
	if v == 0 {
		return optBool{}
	}
	return optBool{set: true, v: cfBooleanValue(v)}
}

// sessionKeys CGSession sözlük anahtarları başlıkta CFSTR makrosudur (dışa açık sembol yok); süreç ömrü NSString.
var sessionKeys = sync.OnceValue(func() (k struct{ locked, onConsole uintptr }) {
	objc.Pool(func() {
		for _, p := range []struct {
			dst  *uintptr
			name string
		}{{&k.locked, "CGSSessionScreenIsLocked"}, {&k.onConsole, "kCGSSessionOnConsoleKey"}} {
			s, err := objc.NSString(p.name)
			if err != nil {
				return
			}
			s.Send(objc.Sel("retain"))
			*p.dst = uintptr(s)
		}
	})
	return k
})
