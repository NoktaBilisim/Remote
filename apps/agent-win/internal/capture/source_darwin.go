//go:build darwin

package capture

import (
	"errors"

	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28f K1 iskeleti (mimari-p28f §6): ScreenCaptureKit + VideoToolbox yakalaması K2'de bu dosyanın ve
// monitors/vt/sck_darwin.go'nun yerini alır. O zamana kadar fail-closed: monitör listesi ve kaynak yok.

// ErrUnsupported yakalama bu derlemede yok.
var ErrUnsupported = errors.New("capture: macOS yakalaması bu sürümde yok")

// Monitors monitör listesi (K2: SCShareableContent).
func Monitors() ([]signal.Monitor, error) { return nil, ErrUnsupported }

// Open monitör yakalama kaynağı (K2: SCStream NV12 → VideoToolbox H.264).
func Open(int) (rtc.Source, error) { return nil, ErrUnsupported }
