// Package request firma dosyasıyla açılan müşteri başlatmalı destek talebi akışıdır (P8b-2; mimari-e9 §2.3, §13;
// mimari-protokol §5.1): firma bilgisi → form + doğrulama + KVKK → talep → `/ws/request` bekleme → kabulde
// "Ekranımı paylaş / Vazgeç" → `/ws/guest` (flow.RunTicket). Platformdan bağımsızdır; arayüz (Win32), REST, WS ve
// hatırlama dosyası arayüzlerle bağlanır ve sahtelerle test edilir.
package request

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Form alan anahtarları: sunucunun VALIDATION `fields` anahtarlarıyla aynı (contracts `createRequestInputSchema`).
const (
	FieldName        = "customerName"
	FieldPhone       = "phone"
	FieldEmail       = "email"
	FieldDescription = "description"
	FieldConsent     = "consentAccepted"
)

// FieldOrder hata durumunda odaklanacak ilk alanı belirler (AC-164: hata alanına odak; Tab sırası ile aynı).
var FieldOrder = []string{FieldName, FieldPhone, FieldEmail, FieldDescription, FieldConsent}

// Hata metinleri contracts şemalarıyla aynı (müşteri iki tarafta aynı ifadeyi görür).
const (
	errNameUnsafe   = "Ad görünmez veya kontrol karakteri içeremez"
	errNameShort    = "Ad en az 2 karakter olmalı"
	errNameLong     = "Ad en çok 80 karakter olabilir"
	errPhone        = "Telefon numarası geçersiz"
	errEmailLong    = "E-posta en çok 254 karakter olabilir"
	errEmail        = "E-posta adresi geçersiz"
	errDescUnsafe   = "Açıklama görünmez veya kontrol karakteri içeremez"
	errDescShort    = "Açıklama en az 10 karakter olmalı"
	errDescLong     = "Açıklama en çok 500 karakter olabilir"
	errConsent      = "Aydınlatma metni onaylanmalı"
	nameRawMax      = 400
	nameMin, nameMx = 2, 80
	phoneRawMax     = 40
	emailMax        = 254
	descRawMax      = 2000
	descMin, descMx = 10, 500
)

var (
	trPhoneRe   = regexp.MustCompile(`^(?:\+90|0)?(5[0-9]{9})$`)
	intlPhoneRe = regexp.MustCompile(`^\+?([1-9][0-9]{7,14})$`)
	// zod 4 `z.email()` varsayılan ifadesi (regexes.js `email`).
	emailRe = regexp.MustCompile(`^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)
)

// Form müşterinin girdiği ham değerler.
type Form struct {
	Name, Phone, Email, Description string
	Consent                         bool
	Remember                        bool
	// RememberChosen müşteri "hatırla" kutusunu bu oturumda kendisi değiştirdi (S8b2-1). Hatırlanan veriyle işaretli
	// açılan kutu bunu true yapmaz; arayüz ad/telefon değişince (EN_CHANGE) kutuyu müşteri dokunmadıysa işaretsize çeker.
	RememberChosen bool
	// Record P28e kayıt rıza kutusu (yalnız FormView.RecOffered iken çizilir; yalnız bellekte, sunucuya gönderilmez).
	Record bool
}

// Valid sunucuya gidecek normalize değerler (telefon E.164, açıklama tek satır, e-posta boşsa "").
type Valid struct {
	Name, Phone, Email, Description string
}

// Validate AC-134: contracts şemalarının Go eşi (ortak fixture `request-form.json`). Hata yoksa errs boştur.
func Validate(f Form) (Valid, map[string]string) {
	errs := map[string]string{}
	var v Valid
	var msg string
	if v.Name, msg = CustomerName(f.Name); msg != "" {
		errs[FieldName] = msg
	}
	if p, ok := NormalizePhone(f.Phone); ok {
		v.Phone = p
	} else {
		errs[FieldPhone] = errPhone
	}
	if v.Email, msg = Email(f.Email); msg != "" {
		errs[FieldEmail] = msg
	}
	if v.Description, msg = Description(f.Description); msg != "" {
		errs[FieldDescription] = msg
	}
	if !f.Consent {
		errs[FieldConsent] = errConsent
	}
	return v, errs
}

// jsSpace JavaScript `\s` ve `String.prototype.trim` kümesi (WhiteSpace + LineTerminator).
func jsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// unsafeChar contracts `UNSAFE_NAME_CHARS` (Cc, Cf, Zl, Zp, U+034F, U+180E).
func unsafeChar(r rune) bool {
	return unicode.In(r, unicode.Cc, unicode.Cf, unicode.Zl, unicode.Zp) || r == 0x034f || r == 0x180e
}

func hasUnsafe(s string) bool { return strings.IndexFunc(s, unsafeChar) >= 0 }

// Display S8b2-3: sunucudan gelen ve arayüze basılan metinlerin (firma adı, teknisyen adı, ret mesajı, hata metni)
// TEK süzgeci. Satır/paragraf ayırıcıları ve sekme boşluğa çevrilir; diğer Cc/Cf (bidi U+202A..202E, U+2066..2069,
// sıfır genişlik vb.), U+034F, U+180E çıkarılır; kenar boşlukları kırpılır. Sonuç boşsa fallback döner.
func Display(s, fallback string) string {
	out := strings.Map(func(r rune) rune {
		switch {
		case r == '\n' || r == '\r' || r == '\t' || unicode.In(r, unicode.Zl, unicode.Zp):
			return ' '
		case unsafeChar(r):
			return -1
		}
		return r
	}, s)
	if out = strings.TrimSpace(out); out == "" {
		return fallback
	}
	return out
}

// utf16Len zod `max()` uzunluğu (UTF-16 birimi).
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}

// CustomerName ad soyad: ham ≤ 400, güvensiz karakter yok, trim, 2..80 kod noktası.
func CustomerName(raw string) (string, string) {
	if utf16Len(raw) > nameRawMax {
		return "", errNameLong
	}
	if hasUnsafe(raw) {
		return "", errNameUnsafe
	}
	s := strings.TrimFunc(raw, jsSpace)
	switch n := utf8.RuneCountInString(s); {
	case n < nameMin:
		return "", errNameShort
	case n > nameMx:
		return "", errNameLong
	}
	return s, ""
}

// NormalizePhone contracts `normalizePhone`: boşluk, `-`, `(`, `)` silinir; TR cep → `+90…`, değilse E.164 8–15 hane.
func NormalizePhone(raw string) (string, bool) {
	if utf16Len(raw) > phoneRawMax {
		return "", false
	}
	s := strings.Map(func(r rune) rune {
		if jsSpace(r) || r == '-' || r == '(' || r == ')' {
			return -1
		}
		return r
	}, strings.TrimFunc(raw, jsSpace))
	if m := trPhoneRe.FindStringSubmatch(s); m != nil {
		return "+90" + m[1], true
	}
	if m := intlPhoneRe.FindStringSubmatch(s); m != nil {
		return "+" + m[1], true
	}
	return "", false
}

// Email isteğe bağlı: trim, boş → "", ≤ 254, zod e-posta biçimi.
func Email(raw string) (string, string) {
	s := strings.TrimFunc(raw, jsSpace)
	switch {
	case utf16Len(s) > emailMax:
		return "", errEmailLong
	case s == "":
		return "", ""
	case !emailRe.MatchString(s):
		return "", errEmail
	}
	return s, ""
}

// NormalizeDescription contracts `normalizeDescription`: CR/LF/TAB ve tüm boşluk dizileri → tek boşluk, trim.
func NormalizeDescription(raw string) string {
	var b strings.Builder
	space := false
	for _, r := range raw {
		if jsSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

// Description sorun açıklaması (r2, G-E9-5): ham ≤ 2000, tek satıra normalize, güvensiz karakter yok, 10..500.
func Description(raw string) (string, string) {
	if utf16Len(raw) > descRawMax {
		return "", errDescLong
	}
	s := NormalizeDescription(raw)
	if hasUnsafe(s) {
		return "", errDescUnsafe
	}
	switch n := utf8.RuneCountInString(s); {
	case n < descMin:
		return "", errDescShort
	case n > descMx:
		return "", errDescLong
	}
	return s, ""
}
