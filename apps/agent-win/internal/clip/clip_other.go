//go:build !windows

package clip

// New bu platformda pano yoktur (P28a yalnız Windows istemci; macOS/Linux P28f/g).
func New() (Clipboard, error) { return nil, ErrUnsupported }
