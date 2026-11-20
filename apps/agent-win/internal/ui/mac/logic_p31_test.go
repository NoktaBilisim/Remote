package mac

import "testing"

// TestAC519MacOpenURLOnlyDownloadURL P31 AC-519 / T-P31-8: macOS OpenURL yalnız request.DownloadURL biçimindeki
// https adresini açar; başka şema, yol, sorgu, kullanıcı bilgisi ya da parça reddedilir.
func TestAC519MacOpenURLOnlyDownloadURL(t *testing.T) {
	const base = "https://remote.example/api/v1/public/agent/request-download?ref=abcdefghijk23456"
	ok := []string{base, base + "&os=macos", "https://remote.example:4450/api/v1/public/agent/request-download?ref=abcdefghijk23456&os=macos"}
	bad := []string{"", "http://remote.example/api/v1/public/agent/request-download?ref=abcdefghijk23456",
		"https://remote.example/api/v1/public/agent/other?ref=abcdefghijk23456", base + "&os=windows", base + "&x=1",
		base + "#f", "https://a@remote.example/api/v1/public/agent/request-download?ref=abcdefghijk23456",
		"https://remote.example/api/v1/public/agent/request-download", base + "&ref=b", "file:///etc/passwd",
		"mailto:abuse@example.com", "x-apple.systempreferences:com.apple.preference.security", base + "&os=macos&os=macos"}
	for _, s := range ok {
		if !downloadURLAllowed(s) {
			t.Errorf("kabul edilmeli: %q", s)
		}
	}
	for _, s := range bad {
		if downloadURLAllowed(s) {
			t.Errorf("reddedilmeli: %q", s)
		}
	}
}
