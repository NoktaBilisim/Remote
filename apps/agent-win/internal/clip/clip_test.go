package clip

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf16"
)

// AC-345 / AC-346 / D-P28a-2: pano mantığı (Windows dışı da koşar).

func TestP28aClipSensitiveFourFormats(t *testing.T) {
	cases := map[string]marks{
		"exclude":       {exclude: true},
		"viewer ignore": {viewerIgnore: true},
		"geçmiş = 0":    {historyZero: true},
		"bulut = 0":     {cloudZero: true},
	}
	for name, m := range cases {
		if !m.sensitive() {
			t.Errorf("%s: gizli sayılmadı", name)
		}
	}
	if (marks{}).sensitive() {
		t.Error("işaretsiz pano gizli sayıldı")
	}
	if !flagZero([]byte{0, 0, 0, 0}, true) || flagZero([]byte{1, 0, 0, 0}, true) {
		t.Error("DWORD değeri yanlış okundu")
	}
	if !flagZero(nil, false) || !flagZero([]byte{1, 0}, true) {
		t.Error("okunamayan/kısa değer gizli sayılmalı (güvenli taraf)")
	}
}

func TestP28aClipGlobalSizeLimit(t *testing.T) {
	if err := checkGlobalSize(131074); err != nil {
		t.Errorf("sınırda: %v", err)
	}
	if err := checkGlobalSize(131075); !errors.Is(err, ErrTooLarge) {
		t.Errorf("sınır + 1: %v", err)
	}
	if err := checkGlobalSize(1 << 30); !errors.Is(err, ErrTooLarge) {
		t.Errorf("1 GiB: %v", err)
	}
	if err := checkGlobalSize(0); !errors.Is(err, ErrEmpty) {
		t.Errorf("boş: %v", err)
	}
}

func TestP28aClipDecodeLossless(t *testing.T) {
	in := "Şifre: ğüİı\r\nsatır 2 😀\ttab"
	units := append(utf16.Encode([]rune(in)), 0, 'x')
	got, err := decodeUTF16(units)
	if err != nil || got != in {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := decodeUTF16([]uint16{0}); !errors.Is(err, ErrEmpty) {
		t.Errorf("yalnız NUL: %v", err)
	}
	if _, err := decodeUTF16([]uint16{'a', 0xD800, 'b'}); !errors.Is(err, ErrInvalid) {
		t.Errorf("eşsiz yüksek vekil: %v", err)
	}
	if _, err := decodeUTF16([]uint16{0xDC00}); !errors.Is(err, ErrInvalid) {
		t.Errorf("eşsiz düşük vekil: %v", err)
	}
	if _, err := decodeUTF16([]uint16{'a', 0xD83D}); !errors.Is(err, ErrInvalid) {
		t.Errorf("sonda yarım çift: %v", err)
	}
}

func TestP28aClipDecodeUTF8Limit(t *testing.T) {
	ascii := utf16.Encode([]rune(strings.Repeat("a", MaxBytes)))
	if s, err := decodeUTF16(ascii); err != nil || len(s) != MaxBytes {
		t.Fatalf("64 KB ASCII: %d %v", len(s), err)
	}
	if _, err := decodeUTF16(append(ascii, 'b')); !errors.Is(err, ErrTooLarge) {
		t.Errorf("64 KB + 1: %v", err)
	}
	// 30 000 Türkçe harf = 60 000 bayt (sınır altı); 22 000 '€' = 66 000 bayt (UTF-16'da küçük, UTF-8'de büyük).
	if _, err := decodeUTF16(utf16.Encode([]rune(strings.Repeat("ş", 30000)))); err != nil {
		t.Errorf("ş: %v", err)
	}
	if _, err := decodeUTF16(utf16.Encode([]rune(strings.Repeat("€", 22000)))); !errors.Is(err, ErrTooLarge) {
		t.Errorf("€: %v", err)
	}
}

func TestP28aClipEncodeValidation(t *testing.T) {
	u, err := encodeUTF16("a\r\nb😀")
	if err != nil || u[len(u)-1] != 0 || string(utf16.Decode(u[:len(u)-1])) != "a\r\nb😀" {
		t.Fatalf("%v %v", u, err)
	}
	for name, s := range map[string]string{"boş": "", "NUL": "a\x00b", "geçersiz UTF-8": "a\xffb"} {
		if _, err := encodeUTF16(s); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := encodeUTF16(strings.Repeat("a", MaxBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Errorf("büyük: %v", err)
	}
}

// P28f K5: macOS `public.utf8-plain-text` çözümü Windows ile aynı sonuç kümesini verir (her platformda koşar).
func TestAC393P28fClipDecodeUTF8(t *testing.T) {
	if s, err := decodeUTF8([]byte("a\r\nç😀\x00çöp")); err != nil || s != "a\r\nç😀" {
		t.Fatalf("NUL'da kırpma: %q %v", s, err)
	}
	for name, c := range map[string]struct {
		in   []byte
		want error
	}{
		"boş":            {nil, ErrEmpty},
		"yalnız NUL":     {[]byte{0, 'a'}, ErrEmpty},
		"geçersiz UTF-8": {[]byte("a\xffb"), ErrInvalid},
		"64 KB üstü":     {[]byte(strings.Repeat("a", MaxBytes+1)), ErrTooLarge},
	} {
		if _, err := decodeUTF8(c.in); !errors.Is(err, c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if s, err := decodeUTF8([]byte(strings.Repeat("a", MaxBytes))); err != nil || len(s) != MaxBytes {
		t.Fatalf("tam sınır: %v", err)
	}
}
