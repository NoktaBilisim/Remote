// Package pairing indirilen dosya adından 8 haneli kısa kodu çıkarır (AC-27, AC-97; mimari-api agent/download:
// `Destek-<kod>.exe`). Okunamazsa çağıran kod giriş alanı gösterir; elle girilen kod Normalize ile doğrulanır.
package pairing

import (
	"path/filepath"
	"regexp"
	"strings"
)

// Tarayıcı aynı adlı ikinci indirmede ` (1)` ekler; başka hiçbir biçim kabul edilmez (yanlış eşleşme yerine elle giriş).
var fileNameRe = regexp.MustCompile(`(?i)^Destek-(\d{8})(?: ?\(\d{1,3}\))?\.exe$`)

var codeRe = regexp.MustCompile(`^\d{8}$`)

// FromFileName çalıştırılabilir yolun son bileşeninden kodu döner.
func FromFileName(path string) (string, bool) {
	base := path
	if i := strings.LastIndexAny(base, `\/`); i >= 0 {
		base = base[i+1:]
	}
	m := fileNameRe.FindStringSubmatch(filepath.Clean(base))
	if m == nil {
		return "", false
	}
	return m[1], true
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
