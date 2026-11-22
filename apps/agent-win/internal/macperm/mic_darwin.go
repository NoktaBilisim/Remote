//go:build darwin

package macperm

import (
	"time"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
)

// Mikrofon TCC izni (mimari-p33 K-P33-3, §6.5). AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio ve
// requestAccessForMediaType:completionHandler:. İstem YALNIZ yerel "Kabul et"in devamında açılır (deps_darwin
// openVoice); voice.Supported yoklaması buraya dokunmaz (S-P33-T-4). Bağlanamazsa durum "kısıtlı" sayılır (fail-closed:
// mikrofon açılmaz, rehber gösterilir).

// MicStatus AVAuthorizationStatus.
type MicStatus int

// AVAuthorizationStatus değerleri.
const (
	MicNotDetermined MicStatus = 0
	MicRestricted    MicStatus = 1
	MicDenied        MicStatus = 2
	MicAuthorized    MicStatus = 3
)

// MicRequestWait istem yanıtı için en uzun bekleme (S-P33-T-4: bu süre boyunca enjektör duraklatılır).
const MicRequestWait = 60 * time.Second

// MicSettingsURL Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon.
const MicSettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"

// micBind AVFoundation sınıfı ve AVMediaTypeAudio sabiti; ok=false ise bağlanamadı.
func micBind() (objc.ID, objc.ID, bool) {
	h, err := objc.Framework("AVFoundation")
	if err != nil {
		return 0, 0, false
	}
	media, err := objc.Symbol(h, "AVMediaTypeAudio")
	if err != nil || media == 0 {
		return 0, 0, false
	}
	c, err := objc.GetClass("AVCaptureDevice")
	if err != nil {
		return 0, 0, false
	}
	return objc.ID(c), objc.ID(media), true
}

// Microphone mikrofon izninin durumu (istem açmaz).
func Microphone() MicStatus {
	c, media, ok := micBind()
	if !ok {
		return MicRestricted
	}
	return MicStatus(pobjc.Send[int](c, objc.Sel("authorizationStatusForMediaType:"), media))
}

// RequestMicrophone sistem istemini açar ve yanıtı en çok wait kadar bekler; zaman aşımında false. Blok yanıt
// gelmeden bırakılmaz (geç gelen tamamlanma bırakılmış bloğa düşmesin; zaman aşımında tek blok sızar).
func RequestMicrophone(wait time.Duration) bool {
	c, media, ok := micBind()
	if !ok {
		return false
	}
	ch := make(chan bool, 1)
	blk := pobjc.NewBlock(func(_ pobjc.Block, granted bool) {
		ch <- granted
	})
	c.Send(objc.Sel("requestAccessForMediaType:completionHandler:"), media, blk)
	select {
	case g := <-ch:
		blk.Release()
		return g
	case <-time.After(wait):
		return false
	}
}
