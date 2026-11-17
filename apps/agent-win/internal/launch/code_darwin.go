//go:build darwin

package launch

import (
	"remote-support/agent-win/internal/darwin/objc"
)

// BundleCode çalışan .app'in özgün yolundan kod (mimari-p28f §2 sıra 2–3). App Translocation altındaysa özgün yol
// SecTranslocateCreateOriginalPathForURL ile çözülür; çözülemezse çalışılan yol kullanılır (translocation yolu
// rastgele adlıdır, desenle eşleşmez → kod alanı, AC-97). Hata → "" (fail-closed: kod elle girilir).
func BundleCode() string { return CodeFromBundlePath(BundlePath()) }

// BundlePath çalışan bundle'ın özgün yolu ("" okunamazsa).
func BundlePath() string {
	var path string
	objc.Pool(func() {
		b, err := objc.GetClass("NSBundle")
		if err != nil {
			return
		}
		p, _ := objc.GoString(objc.ID(b).Send(objc.Sel("mainBundle")).Send(objc.Sel("bundlePath")))
		path = p
		if orig := originalPath(p); orig != "" {
			path = orig
		}
	})
	return path
}

func originalPath(p string) string {
	h, err := objc.Framework("Security")
	if err != nil {
		return ""
	}
	var isTransloc func(url objc.ID, out *bool, err *uintptr) bool
	var orig func(url objc.ID, err *uintptr) objc.ID
	if objc.Func(&isTransloc, h, "SecTranslocateIsTranslocatedURL") != nil ||
		objc.Func(&orig, h, "SecTranslocateCreateOriginalPathForURL") != nil {
		return ""
	}
	u, err := objc.GetClass("NSURL")
	if err != nil {
		return ""
	}
	s, err := objc.NSString(p)
	if err != nil {
		return ""
	}
	url := objc.ID(u).Send(objc.Sel("fileURLWithPath:"), s)
	var tr bool
	var cerr uintptr
	if url == 0 || !isTransloc(url, &tr, &cerr) || !tr {
		return ""
	}
	o := orig(url, &cerr)
	if o == 0 {
		return ""
	}
	defer objc.Release(o)
	out, _ := objc.GoString(o.Send(objc.Sel("path")))
	return out
}
