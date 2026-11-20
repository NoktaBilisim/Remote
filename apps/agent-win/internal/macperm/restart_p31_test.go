//go:build darwin || linux

package macperm

import (
	"errors"
	"os"
	"testing"
)

// TestAC518RefNeverWrittenToRestartFile P31 AC-518 / S-P31-5: izin sonrası yeniden başlatmada firma ref'i hiçbir
// dosyaya yazılamaz — yeniden başlatma dosyası yalnız 8 haneli kod kabul eder (ref, etiketli klasör adı, büyük harfli
// ref de reddedilir) ve reddedilen yazma geçici dizinde dosya bırakmaz.
func TestAC518RefNeverWrittenToRestartFile(t *testing.T) {
	d := tmpDir(t)
	for _, v := range []string{"abcdefghijklmnop", "ABCDEFGHIJKLMNOP", "r:abcdefghijklmnop", "NoktaDestek-Test-abcdefghijklmnop", ""} {
		if err := WriteRestart(d, tok, v); !errors.Is(err, ErrBadFile) {
			t.Errorf("%q yazılmamalı: %v", v, err)
		}
	}
	ents, err := os.ReadDir(d)
	if err != nil || len(ents) != 0 {
		t.Fatalf("geçici dizinde dosya kaldı: %v %v", ents, err)
	}
}
