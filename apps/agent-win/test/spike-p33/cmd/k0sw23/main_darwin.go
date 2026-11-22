//go:build darwin

// k0sw23: CGWindowListCopyWindowInfo anahtar dökümü (K0s-W2/W3). Başlık/uygulama adı YAZILMAZ; yalnız sayısal alanlar.
package main

import (
	"fmt"
	"sort"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/test/spike-p33/mac"
)

func main() {
	cg, err := objc.Framework("CoreGraphics")
	mac.Must(err)
	var list func(opt uint32, rel uint32) uintptr
	mac.Must(objc.Func(&list, cg, "CGWindowListCopyWindowInfo"))
	keys := []string{"kCGWindowNumber", "kCGWindowOwnerPID", "kCGWindowLayer", "kCGWindowIsOnscreen", "kCGWindowAlpha",
		"kCGWindowSharingState", "kCGWindowStoreType", "kCGWindowMemoryUsage"}
	ks := map[string]uintptr{}
	for _, k := range keys {
		ks[k] = mac.NSStr(k)
	}
	onscreen := map[float64]bool{}
	on := list(1, 0) // kCGWindowListOptionOnScreenOnly
	for i := range mac.CFArrayCount(on) {
		n, _ := mac.CFNum(mac.CFDictGet(mac.CFArrayAt(on, i), ks["kCGWindowNumber"]))
		onscreen[n] = true
	}
	all := list(0, 0) // kCGWindowListOptionAll
	type agg struct{ n, onKey, onKeyTrue, inOnList int }
	byLayer := map[float64]*agg{}
	keyset := map[string]int{}
	for i := range mac.CFArrayCount(all) {
		d := mac.CFArrayAt(all, i)
		layer, _ := mac.CFNum(mac.CFDictGet(d, ks["kCGWindowLayer"]))
		num, _ := mac.CFNum(mac.CFDictGet(d, ks["kCGWindowNumber"]))
		a := byLayer[layer]
		if a == nil {
			a = &agg{}
			byLayer[layer] = a
		}
		a.n++
		if v, ok := mac.CFNum(mac.CFDictGet(d, ks["kCGWindowIsOnscreen"])); ok {
			a.onKey++
			if v == 1 {
				a.onKeyTrue++
			}
		}
		if onscreen[num] {
			a.inOnList++
		}
		if layer == 0 {
			sig := ""
			for _, k := range keys[3:] {
				v, ok := mac.CFNum(mac.CFDictGet(d, ks[k]))
				if ok {
					sig += fmt.Sprintf("%s=%g ", k[9:], v)
				} else {
					sig += k[9:] + "=yok "
				}
			}
			keyset[sig]++
		}
	}
	ls := make([]float64, 0)
	for l := range byLayer {
		ls = append(ls, l)
	}
	sort.Float64s(ls)
	fmt.Printf("toplam pencere (All) %d, OnScreenOnly %d\n", mac.CFArrayCount(all), mac.CFArrayCount(on))
	for _, l := range ls {
		a := byLayer[l]
		fmt.Printf("  katman %5g: %3d pencere, IsOnscreen anahtarı var %3d (true %3d), OnScreen listesinde %3d\n", l, a.n, a.onKey, a.onKeyTrue, a.inOnList)
	}
	fmt.Println("katman 0 alan imzaları (adet):")
	for s, n := range keyset {
		fmt.Printf("  %3d  %s\n", n, s)
	}
}
