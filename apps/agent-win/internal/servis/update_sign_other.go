//go:build !windows

package servis

// PlatformSignature Windows dışında Authenticode yoktur; kapı uygulanmaz (macOS/Linux kapıları internal/update'te).
func PlatformSignature(_, _ string) error { return nil }
