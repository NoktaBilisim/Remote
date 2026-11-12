//go:build windows

package capture

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/win"
)

const maxDiagAdapters = 8

type dxgiAdapterDesc1 struct {
	Description           [128]uint16
	VendorID, DeviceID    uint32
	SubSysID, Revision    uint32
	DedicatedVideoMemory  uintptr
	DedicatedSystemMemory uintptr
	SharedSystemMemory    uintptr
	LuidLow               uint32
	LuidHigh              int32
	Flags                 uint32
}

// dxgiOutputDesc1 DXGI_OUTPUT_DESC1 (dxgi1_6.h).
type dxgiOutputDesc1 struct {
	dxgiOutputDesc
	BitsPerColor          uint32
	ColorSpace            uint32
	Primaries             [8]float32 // Red, Green, Blue, WhitePoint (x, y)
	MinLuminance          float32
	MaxLuminance          float32
	MaxFullFrameLuminance float32
}

const dxgiAdapterFlagSoftware = 2

// probeSystem tanılama kaydına sistem bilgisini ekler: Windows sürümü, monitörler, DXGI adaptör ve çıkışları (renk
// derinliği/uzayı). Kişisel veri içermez; hata durumunda ilgili kısım boş kalır.
func probeSystem(r *diag.Report) {
	v := windows.RtlGetVersion()
	r.OS = fmt.Sprintf("%d.%d.%d", v.MajorVersion, v.MinorVersion, v.BuildNumber)
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE); err == nil {
		if ubr, _, err := k.GetIntegerValue("UBR"); err == nil {
			r.OS += fmt.Sprintf(".%d", ubr)
		}
		r.Release, _, _ = k.GetStringValue("DisplayVersion")
		r.Edition, _, _ = k.GetStringValue("EditionID")
		_ = k.Close()
	}
	for _, m := range win.Monitors() {
		r.Monitors = append(r.Monitors, diag.Monitor{Device: m.Device, W: int(m.Rect.Right - m.Rect.Left),
			H: int(m.Rect.Bottom - m.Rect.Top), Primary: m.Primary})
	}
	var factory *comObj
	if err := procHR(pCreateDXGIFactory1, "CreateDXGIFactory1", uintptr(unsafe.Pointer(&iidIDXGIFactory1)),
		uintptr(unsafe.Pointer(&factory))); err != nil {
		return
	}
	defer factory.release()
	for ai := 0; ai < maxDiagAdapters; ai++ {
		var a *comObj
		if hr := factory.call(vtFactory1EnumAdapters1, uintptr(ai), uintptr(unsafe.Pointer(&a))); hr.failed() {
			return
		}
		var ad dxgiAdapterDesc1
		if hr := a.call(vtAdapter1GetDesc1, uintptr(unsafe.Pointer(&ad))); !hr.failed() {
			r.Adapters = append(r.Adapters, diag.Adapter{Name: windows.UTF16ToString(ad.Description[:]), Vendor: ad.VendorID,
				Device: ad.DeviceID, Software: ad.Flags&dxgiAdapterFlagSoftware != 0})
		}
		for oi := uintptr(0); oi < maxMonitors; oi++ {
			var o *comObj
			if hr := a.call(vtAdapterEnumOutputs, oi, uintptr(unsafe.Pointer(&o))); hr.failed() {
				break
			}
			r.Outputs = append(r.Outputs, describeOutput(ai, o))
			o.release()
		}
		a.release()
	}
}

func describeOutput(ai int, o *comObj) diag.Output {
	out := diag.Output{Adapter: ai}
	var d dxgiOutputDesc
	if hr := o.call(vtOutputGetDesc, uintptr(unsafe.Pointer(&d))); !hr.failed() {
		out.Device = windows.UTF16ToString(d.DeviceName[:])
		out.W = int(d.DesktopCoordinates.Right - d.DesktopCoordinates.Left)
		out.H = int(d.DesktopCoordinates.Bottom - d.DesktopCoordinates.Top)
		out.Rotation, out.Attached = int(d.Rotation), d.AttachedToDesktop != 0
	}
	if o6, err := o.query(&iidIDXGIOutput6); err == nil {
		var d1 dxgiOutputDesc1
		if hr := o6.call(vtOutput6GetDesc1, uintptr(unsafe.Pointer(&d1))); !hr.failed() {
			out.Desc1, out.BitsPerColor, out.ColorSpace = true, int(d1.BitsPerColor), int(d1.ColorSpace)
		}
		o6.release()
	}
	return out
}
