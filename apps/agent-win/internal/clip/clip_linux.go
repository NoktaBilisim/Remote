//go:build linux

package clip

import (
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"remote-support/agent-win/internal/linux/glib"
)

// Linux pano (mimari-p28g §2 `clip_linux.go`, K0s-8): GTK3 CLIPBOARD seçimi, düz metin, mevcut clip.go kuralları.
//   - GTK yalnız ana iş parçacığında çağrılır: her işlem glib.Post ile GLib ana döngüsüne verilir, çağıran en çok Timeout
//     bekler. Önceki işlem hâlâ sürüyorsa yenisi hemen ErrFailed (Windows "kuyruk dolu" kuralı; iç içe bekleme yok).
//     New ana döngüye iş göndermez (flowDeps gtk_main'den önce çağrılır), yalnız sembolleri bağlar.
//   - X11'de doğrudan, Wayland'de mutter'ın XWayland seçim köprüsü üzerinden çalışır (GTK X11 arka ucu, K0s-8).
//   - Okuma: önce hedef (TARGETS) listesi; parola yöneticisi ipucu `x-kde-passwordManagerHint` varsa içerik okunmaz
//     (ErrSensitive, S-P28f-12 karşılığı; değeri okunmaz). Sonra yalnız UTF-8 hedefi (`UTF8_STRING`, yoksa
//     `text/plain;charset=utf-8`; dönüştürücü yok — macOS `public.utf8-plain-text` kuralı). Uzunluk kopyalamadan önce
//     denetlenir, sonra decodeUTF8.
//   - Yazma: gtk_clipboard_set_text (sahiplik süreçtedir; gtk_clipboard_store çağrılmaz — süreç kapanınca metin panoda
//     kalmaz, iz yok). Linux'ta geçmiş/bulut dışı bırakma biçimi yoktur (GNOME varsayılan pano geçmişi tutmaz; sapma,
//     implementation.md "P28g K5"); bu yüzden teknisyenin koyduğu metin geri okununca SENSITIVE değildir.

const (
	targetHint     = "x-kde-passwordManagerHint"
	targetUTF8     = "UTF8_STRING"
	targetMimeUTF8 = "text/plain;charset=utf-8"
	atomNameMax    = 256 // hedef adı üst sınırı (C dizgisi okuma)
	maxTargets     = 512 // TARGETS yanıtında işlenen en çok hedef
)

var (
	bindOnce sync.Once
	bindErr  error

	gdkAtomIntern                  func(name *byte, onlyIfExists bool) uintptr
	gdkAtomName                    func(atom uintptr) unsafe.Pointer
	gtkClipboardGet                func(selection uintptr) uintptr
	gtkClipboardWaitForTargets     func(cb uintptr, targets *unsafe.Pointer, n *int32) bool
	gtkClipboardWaitForContents    func(cb, target uintptr) uintptr
	gtkSelectionDataGetDataWithLen func(sd uintptr, length *int32) unsafe.Pointer
	gtkSelectionDataFree           func(sd uintptr)
	gtkClipboardSetText            func(cb uintptr, text *byte, n int32)
)

// bind GTK/GDK pano sembollerini izin listeli mutlak yoldan bağlar (bir kez; FFI kuralı 4: eksik sembol → hata).
func bind() error {
	bindOnce.Do(func() {
		if bindErr = glib.Load(); bindErr != nil {
			return
		}
		gdk, err := glib.Open(glib.Path(glib.LibGDK))
		if err != nil {
			bindErr = err
			return
		}
		gtk, err := glib.Open(glib.Path(glib.LibGTK))
		if err != nil {
			bindErr = err
			return
		}
		bindErr = errors.Join(
			glib.Func(&gdkAtomIntern, gdk, "gdk_atom_intern"),
			glib.Func(&gdkAtomName, gdk, "gdk_atom_name"),
			glib.Func(&gtkClipboardGet, gtk, "gtk_clipboard_get"),
			glib.Func(&gtkClipboardWaitForTargets, gtk, "gtk_clipboard_wait_for_targets"),
			glib.Func(&gtkClipboardWaitForContents, gtk, "gtk_clipboard_wait_for_contents"),
			glib.Func(&gtkSelectionDataGetDataWithLen, gtk, "gtk_selection_data_get_data_with_length"),
			glib.Func(&gtkSelectionDataFree, gtk, "gtk_selection_data_free"),
			glib.Func(&gtkClipboardSetText, gtk, "gtk_clipboard_set_text"))
	})
	return bindErr
}

type gtkClip struct {
	busy   atomic.Bool
	closed atomic.Bool
}

// New GTK panosunu kullanır. Kitaplık ya da sembol yoksa hata: pano özelliği bildirilmez (fail-closed).
func New() (Clipboard, error) {
	if err := bind(); err != nil {
		return nil, ErrUnsupported
	}
	return &gtkClip{}, nil
}

// do işi ana döngüye verir ve en çok Timeout bekler. Önceki iş sürüyorsa ya da gönderilemezse hemen ErrFailed; geç
// başlayan iş son tarihi geçtiyse panoya dokunmadan döner.
func (c *gtkClip) do(op func() error) error {
	if c.closed.Load() || !c.busy.CompareAndSwap(false, true) {
		return ErrFailed
	}
	deadline := time.Now().Add(Timeout)
	res := make(chan error, 1)
	if glib.Post(func() {
		defer c.busy.Store(false)
		if c.closed.Load() || time.Now().After(deadline) {
			res <- ErrFailed
			return
		}
		res <- op()
	}) != nil {
		c.busy.Store(false)
		return ErrFailed
	}
	t := time.NewTimer(Timeout)
	defer t.Stop()
	select {
	case err := <-res:
		return err
	case <-t.C:
		return ErrFailed
	}
}

func (c *gtkClip) Close() { c.closed.Store(true) }

// clipboard CLIPBOARD seçimi (ana iş parçacığında).
func clipboard() (uintptr, error) {
	name, err := glib.CString("CLIPBOARD")
	if err != nil {
		return 0, ErrFailed
	}
	cb := gtkClipboardGet(gdkAtomIntern(name, false))
	if cb == 0 {
		return 0, ErrFailed
	}
	return cb, nil
}

func (c *gtkClip) ReadText() (string, error) {
	var s string
	err := c.do(func() (err error) {
		s, err = read()
		return err
	})
	return s, err
}

// read hedefler → ipucu → UTF-8 hedefi → uzunluk (kopyalamadan) → kopya → doğrulama. Ana iş parçacığında.
func read() (string, error) {
	cb, err := clipboard()
	if err != nil {
		return "", err
	}
	var targets unsafe.Pointer
	var n int32
	if !gtkClipboardWaitForTargets(cb, &targets, &n) || targets == nil || n <= 0 {
		if targets != nil {
			glib.Free(uintptr(targets))
		}
		return "", ErrEmpty
	}
	atoms := slices.Clone(unsafe.Slice((*uintptr)(targets), min(int(n), maxTargets)))
	glib.Free(uintptr(targets))
	names := make([]string, 0, len(atoms))
	for _, a := range atoms {
		p := gdkAtomName(a)
		if p == nil {
			continue
		}
		names = append(names, cName(p, atomNameMax))
		glib.Free(uintptr(p))
	}
	if sensitiveTargets(names) {
		return "", ErrSensitive
	}
	i, ok := textTarget(names)
	if !ok {
		return "", ErrEmpty
	}
	sd := gtkClipboardWaitForContents(cb, atoms[i])
	if sd == 0 {
		return "", ErrEmpty
	}
	defer gtkSelectionDataFree(sd)
	var length int32
	data := gtkSelectionDataGetDataWithLen(sd, &length)
	switch {
	case data == nil || length <= 0:
		return "", ErrEmpty
	case int(length) > maxGlobalBytes: // kaba sınır kopyalamadan önce; kesin sınır decodeUTF8'de
		return "", ErrTooLarge
	}
	buf := slices.Clone(unsafe.Slice((*byte)(data), int(length)))
	s, err := decodeUTF8(buf)
	clear(buf)
	return s, err
}

func (c *gtkClip) WriteText(s string) error {
	if err := validateText(s); err != nil {
		return err
	}
	cs, err := glib.CString(s) // ≤ 64 KB, UTF-8, NUL yok (validateText ile aynı sınır)
	if err != nil {
		return ErrInvalid
	}
	return c.do(func() error {
		cb, err := clipboard()
		if err != nil {
			return err
		}
		gtkClipboardSetText(cb, cs, int32(len(s)))
		return nil
	})
}

// sensitiveTargets hedef listesinde parola yöneticisi ipucu var mı (değeri okunmaz; varlığı yeter).
func sensitiveTargets(names []string) bool { return slices.Contains(names, targetHint) }

// textTarget okunacak UTF-8 hedefinin dizini: önce UTF8_STRING, yoksa text/plain;charset=utf-8 (harf duyarsız).
func textTarget(names []string) (int, bool) {
	if i := slices.Index(names, targetUTF8); i >= 0 {
		return i, true
	}
	for i, n := range names {
		if len(n) == len(targetMimeUTF8) && equalFold(n, targetMimeUTF8) {
			return i, true
		}
	}
	return 0, false
}

func equalFold(a, b string) bool {
	for i := 0; i < len(a); i++ {
		x, y := a[i], b[i]
		if 'A' <= x && x <= 'Z' {
			x += 'a' - 'A'
		}
		if 'A' <= y && y <= 'Z' {
			y += 'a' - 'A'
		}
		if x != y {
			return false
		}
	}
	return true
}

// cName C dizgisini en çok max bayta kadar kopyalar (NUL'a dek; FFI kuralı 6). Geçersiz UTF-8 olduğu gibi kalır —
// yalnız sabit adlarla karşılaştırılır.
func cName(p unsafe.Pointer, max int) string {
	b := make([]byte, 0, 32)
	for i := 0; i < max; i++ {
		c := *(*byte)(unsafe.Add(p, i)) //nolint:govet // C belleği
		if c == 0 {
			break
		}
		b = append(b, c)
	}
	return string(b)
}
