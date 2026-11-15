//go:build windows

package servisui

import (
	"image"
	"unsafe"

	"remote-support/agent-win/internal/tray"
	"remote-support/agent-win/internal/win"
)

// Tepsi simgesi resmi: P20 `tray.IconPixels` ile aynı yoldan 32 bit simge (exe'de simge kaynağı yok).

// makeIcon gömülü Nokta amblemi (SM_CXSMICON); başarısızsa IDI_APPLICATION.
func makeIcon(img image.Image) uintptr {
	if h := iconFromImage(img); h != 0 {
		return h
	}
	h, _, _ := pLoadIconW.Call(0, idiApp)
	return h
}

func iconFromImage(img image.Image) uintptr {
	if img == nil {
		return 0
	}
	size, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	if size == 0 || size > 256 {
		size = 16
	}
	px := tray.IconPixels(img, int(size))
	bi := win.BITMAPINFOHEADER{Width: int32(size), Height: -int32(size), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	color, _, _ := pCreateDIBSection.Call(0, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 || bits == nil {
		return 0
	}
	defer win.DeleteObject(color)
	copy(unsafe.Slice((*byte)(bits), len(px)), px)
	mask, _, _ := pCreateBitmap.Call(size, size, 1, 1, 0)
	if mask == 0 {
		return 0
	}
	defer win.DeleteObject(mask)
	ii := iconInfo{fIcon: 1, hbmMask: mask, hbmColor: color}
	h, _, _ := pCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	return h
}
