//go:build darwin

package macperm

import "testing"

// AC-506 / S-r4-9: Erişilebilirlik istemi sembolleri bu macOS'ta bağlanır (istem açılmaz; yalnız bağlama denetlenir).
func TestAC506AXPromptBinds(t *testing.T) {
	if _, ok := bindAXPrompt(); !ok {
		t.Fatal("AXIsProcessTrustedWithOptions / kAXTrustedCheckOptionPrompt / kCFBooleanTrue bağlanamadı")
	}
}
