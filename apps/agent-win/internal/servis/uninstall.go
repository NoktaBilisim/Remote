package servis

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"path/filepath"
	"strings"
)

// Kaldırma kopyasının platformsuz parçaları (D-P27-K5). Program Files'taki ikili kendini silemediği için yükseltilmiş
// kaldırıcı kendini `%SystemRoot%\Temp\NoktaDestekServis-kaldir-<16 hex>\` klasörüne kopyalayıp oradan yeniden başlar.
// Klasör tek çağrıda yalnız SYSTEM + Administrators'a açık oluşturulur (kullanıcı `%TEMP%`'i değil: bölünmüş jetonlu
// yöneticide orta bütünlükteki süreçler kopyayı değiştiremez, yanına DLL bırakamaz).

// UninstallTempPrefix geçici kaldırma klasörü adının öneki (trace-check.ps1 aynı deseni tanır).
const UninstallTempPrefix = "NoktaDestekServis-kaldir-"

// UninstallTempSDDL sahip Administrators, DACL korumalı (devralma kapalı), yalnız SYSTEM ve Administrators tam erişim.
const UninstallTempSDDL = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"

const uninstallRandLen = 8 // bayt → 16 hex

// UninstallTempDir `<base>\NoktaDestekServis-kaldir-<hex(rnd)>`.
func UninstallTempDir(base string, rnd [uninstallRandLen]byte) string {
	return filepath.Join(base, UninstallTempPrefix+hex.EncodeToString(rnd[:]))
}

// IsUninstallTemp exe geçici kaldırma klasöründeki kopya mı (ad ExeName, üst klasör önek + 16 küçük hex).
func IsUninstallTemp(exe string) bool {
	if !strings.EqualFold(filepath.Base(exe), ExeName) {
		return false
	}
	dir := filepath.Base(filepath.Dir(exe))
	rest, ok := strings.CutPrefix(dir, UninstallTempPrefix)
	if !ok || len(rest) != 2*uninstallRandLen {
		return false
	}
	for _, c := range rest {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// SameContent iki akışın SHA-256 özeti aynı mı (kopya, başlatmadan önce kaynakla karşılaştırılır).
func SameContent(a, b io.Reader) (bool, error) {
	ha, err := digest(a)
	if err != nil {
		return false, err
	}
	hb, err := digest(b)
	if err != nil {
		return false, err
	}
	return bytes.Equal(ha, hb), nil
}

func digest(r io.Reader) ([]byte, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return nil, err
	}
	return h.Sum(nil), nil
}
