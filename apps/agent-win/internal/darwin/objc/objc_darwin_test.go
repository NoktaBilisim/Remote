//go:build darwin

package objc

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if _, err := Framework("Foundation"); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

// S-P28f-11 kural 7 / T5: yalnız mutlak sistem çerçevesi ve iki sistem kütüphanesi açılır.
func TestP28fOpenAllowList(t *testing.T) {
	for _, ok := range []string{LibObjC, LibSystem, "/System/Library/Frameworks/AppKit.framework/AppKit",
		"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"} {
		if !Allowed(ok) {
			t.Errorf("izinli olmalı: %s", ok)
		}
	}
	for _, bad := range []string{"AppKit", "libobjc.A.dylib", "@rpath/x.dylib", "/tmp/AppKit.framework/AppKit",
		"/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit", "/System/Library/Frameworks/../../../tmp/x",
		"/System/Library/Frameworks/AppKit.framework/Foundation", "/usr/lib/libz.dylib", "/usr/lib/libobjc.A.dylib ",
		"/System/Library/Frameworks/A.b.framework/A.b"} {
		if Allowed(bad) {
			t.Errorf("reddedilmeli: %q", bad)
		}
		if _, err := Open(bad); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("Open(%q) = %v", bad, err)
		}
	}
	if _, err := Framework("AppKit"); err != nil {
		t.Fatal(err)
	}
}

// S-P28f-11 kural 5: çözülemeyen sınıf/selector fail-closed.
func TestP28fClassAndSelectorFailClosed(t *testing.T) {
	if _, err := GetClass("NKYokBoyleBirSinif"); !errors.Is(err, ErrNoClass) {
		t.Fatalf("olmayan sınıf: %v", err)
	}
	c, err := GetClass("NSString")
	if err != nil {
		t.Fatal(err)
	}
	if !Responds(ID(c), Sel("alloc")) || Responds(ID(c), Sel("nkYokBoyleSelector:")) || Responds(0, Sel("alloc")) {
		t.Fatal("Responds")
	}
	var f func() uintptr
	if err := Func(&f, mustOpen(t, LibSystem), "nk_yok_boyle_islev"); err == nil {
		t.Fatal("olmayan sembol hata vermeli")
	}
}

func mustOpen(t *testing.T, p string) uintptr {
	t.Helper()
	h, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// S-P28f-11 kural 3: NSString sınırlı, UTF-8 doğrulanmış; Türkçe metin ve boş metin gidiş-dönüş aynı.
func TestP28fNSStringRoundTripAndLimits(t *testing.T) {
	Pool(func() {
		for _, s := range []string{"", "Ğüşİöç ıI — %@ %s %n", strings.Repeat("ş", MaxStringBytes/2)} {
			id, err := NSString(s)
			if err != nil {
				t.Fatalf("%.20q: %v", s, err)
			}
			got, err := GoString(id)
			if err != nil || got != s {
				t.Fatalf("gidiş-dönüş %.20q → %.20q, %v", s, got, err)
			}
		}
		if _, err := NSString(strings.Repeat("a", MaxStringBytes+1)); !errors.Is(err, ErrStringTooLong) {
			t.Fatalf("uzun: %v", err)
		}
		if _, err := NSString("a\xffb"); !errors.Is(err, ErrInvalidUTF8) {
			t.Fatalf("geçersiz UTF-8: %v", err)
		}
		id, _ := NSString("a\x00b") // gömülü NUL: uzunluk korunur (C dizgisi gibi kesilmez)
		if got, err := GoString(id); err != nil || got != "a\x00b" {
			t.Fatalf("gömülü NUL: %q %v", got, err)
		}
		if s, err := GoString(0); s != "" || err != nil {
			t.Fatal("nil NSString")
		}
	})
}

// S-P28f-11 kural 1–2: dispatch bağlamı tutamaçtır; iş kuyrukta çalışır ve tutamaç tüketilir.
func TestP28fAsyncRunsOnQueueAndConsumesHandle(t *testing.T) {
	q, err := NewQueue("net.noktabilisim.destek.test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := MainQueue(); err != nil {
		t.Fatal(err)
	}
	done := make(chan int, 3)
	for i := range 3 {
		if err := Async(q, func() { done <- i }); err != nil {
			t.Fatal(err)
		}
	}
	for want := range 3 { // seri kuyruk: sıra korunur
		select {
		case got := <-done:
			if got != want {
				t.Fatalf("sıra %d, beklenen %d", got, want)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("dispatch işi çalışmadı")
		}
	}
	if pending.Len() != 0 {
		t.Fatalf("tutamaç sızıntısı: %d", pending.Len())
	}
	if err := Async(0, func() {}); err == nil {
		t.Fatal("0 kuyruk reddedilmeli")
	}
}
