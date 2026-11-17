//go:build darwin

package input

import "testing"

// Y-P28f-K1: Fare Tuşları tercihi okunur (bu makinede alan okunabiliyor; anahtar yoksa kapalı) ve imleç okunur.
// Okunamazsa MouseKeysOn true döner (fail-closed) — o durumda test görünür biçimde bildirir.
func TestYP28fK1MacProbeReads(t *testing.T) {
	if err := bindPrefs(); err != nil {
		t.Fatal(err)
	}
	on := MacProbe().MouseKeys()
	t.Logf("Fare Tuşları açık=%v (okunamazsa true)", on)
	if _, _, ok := MacProbe().Cursor(); !ok {
		t.Fatal("imleç okunamadı")
	}
}
