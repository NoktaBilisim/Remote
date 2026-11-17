package voice

import (
	"errors"
	"fmt"
)

// Aygıt hatası sınıfları (V-PD-1): flow bunlardan herhangi biri için `voice.end{device}` gönderir ve Windows mikrofon
// gizlilik yolunu tarif eden metni gösterir. Aygıt adı/kimliği hiçbir hataya girmez.
var (
	// ErrDeviceDenied Windows gizlilik ayarı masaüstü uygulamalarının mikrofona erişimini kapatmış (E_ACCESSDENIED).
	ErrDeviceDenied = errors.New("voice: mikrofon erişimi engellendi")
	// ErrDeviceNotFound varsayılan iletişim mikrofonu/hoparlörü yok (E_NOTFOUND).
	ErrDeviceNotFound = errors.New("voice: ses aygıtı bulunamadı")
	// ErrDeviceLost aygıt görüşme sırasında çıkarıldı ya da biçimi değişti (AUDCLNT_E_DEVICE_INVALIDATED).
	ErrDeviceLost = errors.New("voice: ses aygıtı kayboldu")
	// ErrDevice diğer tüm aygıt hataları (sınıflandırılmamış HRESULT, durmuş akış).
	ErrDevice = errors.New("voice: ses aygıtı hatası")
)

const (
	hrAccessDenied         = 0x80070005 // E_ACCESSDENIED
	hrNotFound             = 0x80070490 // HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
	hrDeviceInvalidated    = 0x88890004 // AUDCLNT_E_DEVICE_INVALIDATED
	hrResourcesInvalidated = 0x88890026 // AUDCLNT_E_RESOURCES_INVALIDATED (aygıt değişimi)
)

// classifyHR HRESULT'u aygıt hatası sınıfına eşler.
func classifyHR(hr uint32) error {
	switch hr {
	case hrAccessDenied:
		return ErrDeviceDenied
	case hrNotFound:
		return ErrDeviceNotFound
	case hrDeviceInvalidated, hrResourcesInvalidated:
		return ErrDeviceLost
	}
	return ErrDevice
}

// HRError COM/WASAPI hatası; yalnız adım adı ve HRESULT (aygıt adı/kimliği yok). errors.Is ile sınıfa eşlenir.
type HRError struct {
	Op string
	HR uint32
}

func (e *HRError) Error() string { return fmt.Sprintf("voice: %s hr=0x%08X", e.Op, e.HR) }

// Unwrap HRESULT'un aygıt hatası sınıfını döner (errors.Is(err, ErrDeviceDenied) …).
func (e *HRError) Unwrap() error { return classifyHR(e.HR) }
