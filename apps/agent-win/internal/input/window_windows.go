//go:build windows

package input

import "remote-support/agent-win/internal/win"

// WinWindowAPI WindowAPI'nin Win32 uygulaması (S17-1). Durumsuzdur; her olayda güncel değer okunur (pencere taşınmış,
// küçültülmüş, kapanmış ya da üstüne başka pencere gelmiş olabilir).
type WinWindowAPI struct{}

func (WinWindowAPI) Exists(h uintptr) bool { return win.IsWindow(h) }
func (WinWindowAPI) Iconic(h uintptr) bool { return win.IsIconic(h) }
func (WinWindowAPI) Bounds(h uintptr) (Rect, bool) {
	r, ok := win.WindowBounds(h)
	return Rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom}, ok
}
func (WinWindowAPI) RootAt(x, y int32) uintptr { return win.RootAt(x, y) }
func (WinWindowAPI) ForegroundRoot() uintptr   { return win.ForegroundRoot() }
func (WinWindowAPI) CursorPos() (int32, int32) {
	p := win.CursorPos()
	return p.X, p.Y
}
func (WinWindowAPI) Owner(h uintptr) uintptr                  { return win.Owner(h) }
func (WinWindowAPI) ThreadProcess(h uintptr) (uint32, uint32) { return win.ThreadProcess(h) }
func (WinWindowAPI) IsMenu(h uintptr) bool                    { return win.ClassName(h) == "#32768" }
