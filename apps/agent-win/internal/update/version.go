package update

import (
	"errors"
	"strconv"
	"strings"
)

// Version sayısal üçlü sürüm (K-P29-4; DEVICE_VERSION_PATTERN `^\d{1,3}\.\d{1,3}\.\d{1,3}$`). Ön sürüm etiketi yoktur.
// Sıfır değer 0.0.0'dır ("hiç görülmedi" maxSeen'i olarak kullanılır).
type Version struct{ Major, Minor, Patch int }

// ErrVersion sürüm desen dışı.
var ErrVersion = errors.New("update: sürüm x.y.z (her parça 1-3 rakam) biçiminde olmalı")

// ParseVersion yalnız DEVICE_VERSION_PATTERN'i kabul eder (baştaki sıfır desen gereği geçerlidir, sayısal okunur).
func ParseVersion(s string) (Version, error) {
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return Version{}, ErrVersion
	}
	var n [3]int
	for i, p := range parts {
		if len(p) < 1 || len(p) > 3 {
			return Version{}, ErrVersion
		}
		for j := 0; j < len(p); j++ {
			if p[j] < '0' || p[j] > '9' {
				return Version{}, ErrVersion
			}
		}
		n[i], _ = strconv.Atoi(p) // en çok 3 rakam: taşma yok
	}
	return Version{n[0], n[1], n[2]}, nil
}

// Compare v<o → -1, eşit → 0, v>o → 1.
func (v Version) Compare(o Version) int {
	for _, d := range [3]int{v.Major - o.Major, v.Minor - o.Minor, v.Patch - o.Patch} {
		if d < 0 {
			return -1
		}
		if d > 0 {
			return 1
		}
	}
	return 0
}

// String kanonik "x.y.z" (baştaki sıfırlar atılır; manifest baytı için kullanılmaz — o ham dizgiyi taşır).
func (v Version) String() string {
	return strconv.Itoa(v.Major) + "." + strconv.Itoa(v.Minor) + "." + strconv.Itoa(v.Patch)
}
