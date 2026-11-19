//go:build !windows && !darwin && !linux

package clip

// New bu platformda pano yoktur (P28a Windows, P28f macOS; Linux P28g).
func New() (Clipboard, error) { return nil, ErrUnsupported }
