//go:build darwin

package mac

import (
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/input"
)

// §5.2a localClick (S-P28f-1): korunan denetimler (kontrol/monitör izni, dosya teklifi, yazdırma, pano anahtarı,
// roster "Çıkar" ve onayı, kayıt rızası kutusu, "Erişime izin ver") yalnız K3'ün input.LocalClick beyaz listesinden
// geçer. Basış NKDestekDugme mouseDown: içinde input.EventClick ile kaydedilir (runtime_darwin.go onButtonDown);
// bırakma eylem anındaki NSApp.currentEvent'tir. Okuma ya da bağlama hatası → ret (fail-closed).

// clickOf korunan denetimin eyleminde (ana iş parçacığı) etkileşim sınıfı.
func clickOf(sender objc.ID) clickKind {
	cur := input.CurrentClick()
	press, ok := downs[sender]
	return classifyClick(cur, ok && input.LocalClick(press, cur, input.Uptime()))
}
