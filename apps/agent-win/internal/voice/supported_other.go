//go:build !amd64

package voice

// Supported amd64 dışında her zaman false: arm64'te wazero derleyicisi libopus'u yanlış derliyor (A-PD-3), yorumlayıcı
// gerçek zamanlı değil. Yayın hedefi yalnız windows/amd64'tür.
func Supported() bool { return false }
