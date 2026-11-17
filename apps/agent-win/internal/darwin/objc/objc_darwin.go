//go:build darwin

package objc

import (
	"errors"
	"fmt"
	"runtime"
	"unicode/utf8"
	"unsafe"

	pobjc "github.com/ebitengine/purego/objc"
)

// ID, SEL, Class purego/objc türleri (tür adları için; tipli gönderim `Send[T]` ve sınıf kaydı purego/objc ile yapılır).
type (
	ID    = pobjc.ID
	SEL   = pobjc.SEL
	Class = pobjc.Class
)

// MaxStringBytes NSString dönüşümlerinin üst sınırı (FFI kuralı 3): en büyük metin olan gömülü lisans bildirimleri
// (≈ 42 KB) ve pano (≤ 64 KB) sığar; ağdan gelen metinlerin kendi sınırları daha küçüktür.
const MaxStringBytes = 64 << 10

const nsUTF8StringEncoding = 4

var (
	// ErrStringTooLong metin MaxStringBytes'tan uzun.
	ErrStringTooLong = errors.New("objc: metin çok uzun")
	// ErrInvalidUTF8 metin geçerli UTF-8 değil.
	ErrInvalidUTF8 = errors.New("objc: metin geçerli UTF-8 değil")
	// ErrNoClass sınıf çözülemedi (fail-closed, FFI kuralı 5).
	ErrNoClass = errors.New("objc: sınıf yok")
)

var (
	selAlloc        = pobjc.RegisterName("alloc")
	selAutorelease  = pobjc.RegisterName("autorelease")
	selRelease      = pobjc.RegisterName("release")
	selNew          = pobjc.RegisterName("new")
	selDrain        = pobjc.RegisterName("drain")
	selResponds     = pobjc.RegisterName("respondsToSelector:")
	selInitBytes    = pobjc.RegisterName("initWithBytes:length:encoding:")
	selLengthOfUTF8 = pobjc.RegisterName("lengthOfBytesUsingEncoding:")
	selGetCString   = pobjc.RegisterName("getCString:maxLength:encoding:")
)

// Sel selector adını kaydeder (objc runtime hiçbir zaman 0 dönmez; varlığı Responds ile denetlenir).
func Sel(name string) SEL { return pobjc.RegisterName(name) }

// GetClass adıyla sınıfı çözer; yoksa ErrNoClass.
func GetClass(name string) (Class, error) {
	c := pobjc.GetClass(name)
	if c == 0 {
		return 0, fmt.Errorf("%w: %s", ErrNoClass, name)
	}
	return c, nil
}

// Responds nesne (ya da sınıf) selector'ü uyguluyor mu; id 0 ise false (fail-closed).
func Responds(id ID, sel SEL) bool {
	if id == 0 {
		return false
	}
	return pobjc.Send[bool](id, selResponds, sel)
}

// NSString Go metninden autorelease edilmiş NSString (FFI kuralı 3): uzunluk ve UTF-8 denetimi, sonra
// `initWithBytes:length:encoding:` (NUL'a dayanmaz, biçim dizesi değildir). Çağrı bir autorelease havuzu içinde
// yapılmalıdır (Pool).
func NSString(s string) (ID, error) {
	if len(s) > MaxStringBytes {
		return 0, ErrStringTooLong
	}
	if !utf8.ValidString(s) {
		return 0, ErrInvalidUTF8
	}
	c, err := GetClass("NSString")
	if err != nil {
		return 0, err
	}
	b := []byte(s)
	var p unsafe.Pointer
	if len(b) > 0 {
		p = unsafe.Pointer(&b[0])
	}
	id := ID(c).Send(selAlloc).Send(selInitBytes, p, uint(len(b)), uint(nsUTF8StringEncoding))
	runtime.KeepAlive(b)
	if id == 0 {
		return 0, ErrInvalidUTF8
	}
	return id.Send(selAutorelease), nil
}

// GoString NSString'in UTF-8 kopyası; MaxStringBytes'tan uzunsa ErrStringTooLong. id 0 ise "".
func GoString(id ID) (string, error) {
	if id == 0 {
		return "", nil
	}
	n := pobjc.Send[uint](id, selLengthOfUTF8, uint(nsUTF8StringEncoding))
	if n > MaxStringBytes {
		return "", ErrStringTooLong
	}
	buf := make([]byte, n+1)
	if !pobjc.Send[bool](id, selGetCString, unsafe.Pointer(&buf[0]), uint(len(buf)), uint(nsUTF8StringEncoding)) {
		return "", ErrInvalidUTF8 // dönüştürülemeyen karakter
	}
	return string(buf[:n]), nil
}

// Release +1 tutulan nesneyi bırakır (0 güvenli).
func Release(id ID) {
	if id != 0 {
		id.Send(selRelease)
	}
}

// Pool fn'i bir NSAutoreleasePool içinde çalıştırır (havuz aynı OS iş parçacığında açılıp kapanır).
func Pool(fn func()) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	c := pobjc.GetClass("NSAutoreleasePool")
	if c == 0 {
		fn()
		return
	}
	p := ID(c).Send(selNew)
	defer p.Send(selDrain)
	fn()
}

// CGPoint, CGSize, CGRect CoreGraphics yapıları (64 bit: CGFloat = float64).
type (
	CGPoint struct{ X, Y float64 }
	CGSize  struct{ W, H float64 }
	CGRect  struct {
		Origin CGPoint
		Size   CGSize
	}
)
