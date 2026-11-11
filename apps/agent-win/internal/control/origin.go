package control

// INPUT_MESSAGE_SOURCE.originId değerleri (winuser.h, INPUT_MESSAGE_ORIGIN_ID). S7-12: önceki sürümde IMO_INJECTED
// yanlışlıkla 0x01 (gerçekte IMO_HARDWARE) tanımlanmıştı; değerler mingw-w64 winuser.h ile birebir aynıdır.
const (
	IMO_UNAVAILABLE uint32 = 0x00000000
	IMO_HARDWARE    uint32 = 0x00000001
	IMO_INJECTED    uint32 = 0x00000002
	IMO_SYSTEM      uint32 = 0x00000004
)

// OriginInjected S7-12 (G-03): GetCurrentInputMessageSource sonucuna göre girdi "enjekte" (izin veremez) sayılır mı.
// Fail-closed: yalnız başarılı bir sorguda IMO_HARDWARE yerel kullanıcı girdisidir; IMO_INJECTED, IMO_SYSTEM,
// IMO_UNAVAILABLE, bilinmeyen/birleşik değerler ve başarısız sorgu (ok=false) enjekte sayılır.
// Bilinen sınır: UIAccess yetkili bir uygulamanın SendInput'u da IMO_HARDWARE görünür.
func OriginInjected(origin uint32, ok bool) bool {
	return !ok || origin != IMO_HARDWARE
}

// CharInjected S7-12: WM_CHAR/WM_SYSCHAR (Alt+İ erişim tuşu) TranslateMessage ile üretildiğinden kaynağı çoğu zaman
// IMO_UNAVAILABLE'dır; o zaman onu üreten tuş basışının kararı (keyInjected) geçerlidir. Kaynak biliniyorsa ikisinden
// biri enjekteyse karakter enjektedir. Kaynak bilinmiyorsa tuş basışının kararı tek başına belirler (o da fail-closed).
func CharInjected(keyInjected bool, origin uint32, ok bool) bool {
	if !ok || origin == IMO_UNAVAILABLE {
		return keyInjected
	}
	return keyInjected || OriginInjected(origin, ok)
}
