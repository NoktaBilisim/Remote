// Package pairing indirilen dosya adından istemcinin modunu çıkarır (ADR-0006 r4): önce firma dosyası
// `NoktaDestek-<label>-<tenantRef>.exe` → talep modu (AC-133), değilse 8 haneli kısa kod `Destek-<kod>.exe` (AC-27, AC-97).
// Hiçbiri yoksa çağıran kod giriş alanı gösterir; elle girilen kod Normalize ile doğrulanır.
package pairing

import (
	"path/filepath"
	"regexp"
	"strings"
)

// Tarayıcı aynı adlı ikinci indirmede ` (1)` ekler; başka hiçbir biçim kabul edilmez (yanlış eşleşme yerine elle giriş).
var fileNameRe = regexp.MustCompile(`(?i)^Destek-(\d{8})(?: ?\(\d{1,3}\))?\.exe$`)

var codeRe = regexp.MustCompile(`^\d{8}$`)

// RefCorePattern firma dosyası adının çekirdeği (mimari-p31 §15.2, S-P31-4; tek tanım): `NoktaDestek-<etiket>-<ref>`,
// tek yakalama grubu ref'tir. Windows dosya adı ve macOS klasör adı (launch.SourceFromBundlePath) bundan türetilir;
// çapa, `(?i)` ve sonek türetende eklenir.
const RefCorePattern = `NoktaDestek-[A-Za-z0-9]{1,20}-([a-z2-7]{16})`

// refFileNameRe contracts `REQUEST_FILE_NAME_RE` ile aynı (ortak fixture `request-form.json` fileName): önek büyük/küçük
// harf duyarsız, ref küçük harfe indirilir; tarayıcının eklediği ` (1)` kabul. P31 öncesi ifadeyle bayt eşdeğeri.
var refFileNameRe = regexp.MustCompile(`(?i)^` + RefCorePattern + `(?: ?\(\d+\))?\.exe$`)

func baseName(path string) string {
	base := path
	if i := strings.LastIndexAny(base, `\/`); i >= 0 {
		base = base[i+1:]
	}
	return filepath.Clean(base)
}

// FromFileName çalıştırılabilir yolun son bileşeninden kodu döner.
func FromFileName(path string) (string, bool) {
	m := fileNameRe.FindStringSubmatch(baseName(path))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// RefFromFileName firma dosyası adından tenantRef'i döner (ADR-0006 r4). Dosya adındaki firma etiketi (label)
// döndürülmez: pencere yalnız sunucudan gelen firma adını gösterir (G-E9-11).
func RefFromFileName(path string) (string, bool) {
	m := refFileNameRe.FindStringSubmatch(baseName(path))
	if m == nil {
		return "", false
	}
	return strings.ToLower(m[1]), true
}

// Normalize elle girilen kodu (boşluk ve tire ile gruplanmış olabilir: "1234 5678", "1234-5678") 8 haneye indirir.
func Normalize(input string) (string, bool) {
	s := strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' || r == '\t' {
			return -1
		}
		return r
	}, strings.TrimSpace(input))
	if !codeRe.MatchString(s) {
		return "", false
	}
	return s, true
}
