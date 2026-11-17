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
// penceresi (UIPI) macOS'ta yoktur; onun yerine güvenli metin girişi (parola alanı; Carbon IsSecureEventInputEnabled)
// açıkken ElevatedForeground=true → mevcut "… kontrol edilemiyor" iletisi (mimari-p28f §11 AC-105; qa P28f m.4): bu
// sırada olay musluğu yerel tuşları görmez (yerel öncelik çalışmaz) ve enjekte tuşlar alana güvenilir biçimde ulaşmaz.
func EnvProbe() env.State {
	return probeState(secureInput(), sessionState())
}

// probeState güvenli metin girişi ve oturum durumu → env.State.
func probeState(secure bool, st env.State) env.State {
	st.ElevatedForeground = secure
	return st
}

// sessionState kilit ekranı / konsolda değil (SecureDesktop).
func sessionState() env.State {
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

// secureInputFn Carbon IsSecureEventInputEnabled; yakalama çerçevelerinden (fwErr) ayrı bağlanır ki eksik sembol
// yakalamayı kapatmasın. Bağlanamazsa nil → uyarı yok (bilgi amaçlı; kontrol kapısını etkilemez).
var secureInputFn = sync.OnceValue(func() func() bool {
	h, err := objc.Framework("Carbon")
	if err != nil {
		return nil
	}
	var fn func() bool
	if objc.Func(&fn, h, "IsSecureEventInputEnabled") != nil {
		return nil
	}
	return fn
})

func secureInput() bool {
	if fn := secureInputFn(); fn != nil {
		return fn()
	}
	return false
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
