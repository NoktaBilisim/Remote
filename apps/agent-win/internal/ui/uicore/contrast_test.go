package uicore

import "math"

// AC-247 kontrast yardımcıları: yalnız theme_test.go'daki WCAG tablo testleri kullanır (PT-K8: theme.go'dan taşındı,
// üretim kodunda okuyucusu yok).

// colorPair metin/zemin çifti (kontrast tablo testi).
type colorPair struct {
	name   string
	fg, bg RGB
}

// textPairs paletteki her metin/zemin çifti; arayüzde başka metin rengi kullanılmaz.
func (p Palette) textPairs() []colorPair {
	return []colorPair{
		{"metin/zemin", p.Text, p.Window},
		{"uyarı/zemin", p.Danger, p.Window},
		{"alan metni/alan", p.FieldText, p.Field},
	}
}

func linear(c uint8) float64 {
	v := float64(c) / 255
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

// luminance WCAG 2.x göreli parlaklık.
func luminance(c RGB) float64 {
	return 0.2126*linear(c.R) + 0.7152*linear(c.G) + 0.0722*linear(c.B)
}

// contrastRatio WCAG 2.x kontrast oranı (1..21).
func contrastRatio(a, b RGB) float64 {
	la, lb := luminance(a), luminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}
