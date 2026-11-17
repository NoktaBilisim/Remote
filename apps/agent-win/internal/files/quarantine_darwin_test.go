//go:build darwin

package files

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// readQuarantine dosyanın karantina özniteliği (sembolik bağ izlenmez).
func readQuarantine(t *testing.T, path string) (string, error) {
	t.Helper()
	buf := make([]byte, 256)
	n, err := unix.Lgetxattr(path, QuarantineAttr, buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}

// AC-117 / T8 / S-P28f-9: değer biçimi, bayraklarda 0x40 (USER_APPROVED) yok.
func TestAC117P28fQuarantineValue(t *testing.T) {
	v := QuarantineValue(time.Unix(0x6739a2b0, 0))
	if v != "0083;6739a2b0;Nokta Destek;" {
		t.Fatalf("değer: %q", v)
	}
	flags, err := strconv.ParseUint(strings.SplitN(v, ";", 2)[0], 16, 16)
	if err != nil || flags&0x40 != 0 || flags&0x01 == 0 {
		t.Fatalf("bayraklar %#x %v", flags, err)
	}
}

// AC-117 / T8: öznitelik gerçek dosyaya (APFS geçici dizin) yazılır ve okunur; sembolik bağ izlenmez.
func TestAC117P28fQuarantineWrittenToFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "rapor.pdf.part")
	if err := os.WriteFile(p, []byte("%PDF-1.4"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := time.Now().Unix()
	if err := WriteQuarantine(p); err != nil {
		t.Fatal(err)
	}
	v, err := readQuarantine(t, p)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(v, ";")
	if len(parts) != 4 || parts[0] != "0083" || parts[2] != "Nokta Destek" || parts[3] != "" {
		t.Fatalf("değer: %q", v)
	}
	ts, err := strconv.ParseInt(parts[1], 16, 64)
	if err != nil || ts < before || ts > time.Now().Unix() {
		t.Fatalf("zaman: %q", parts[1])
	}
	// Yeniden adlandırma özniteliği taşır (transfer `.part` → nihai ad).
	final := filepath.Join(dir, "rapor.pdf")
	if err := os.Rename(p, final); err != nil {
		t.Fatal(err)
	}
	if v2, err := readQuarantine(t, final); err != nil || v2 != v {
		t.Fatalf("yeniden adlandırma sonrası: %q %v", v2, err)
	}

	target := filepath.Join(dir, "hedef.txt")
	link := filepath.Join(dir, "bag.part")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	_ = WriteQuarantine(link) // bağın kendisine yazılabilir ya da reddedilir; hedef asla işaretlenmez
	if _, err := readQuarantine(t, target); !errors.Is(err, unix.ENOATTR) {
		t.Fatalf("bağ izlendi: %v", err)
	}
}

// Yazılamayan yol hata döner (transfer bunu fail-closed işler).
func TestAC117P28fQuarantineMissingFileFails(t *testing.T) {
	if err := WriteQuarantine(filepath.Join(t.TempDir(), "yok.part")); err == nil {
		t.Fatal("olmayan dosyada hata bekleniyordu")
	}
}

// T8 / §8.2 test-macos "quarantine spctl reddi": spctl karantinasız eş dosyayı da reddediyorsa değerlendirme karantinayı
// ayırt etmiyor demektir (imzasız dosyada "no usable signature") ve test bir şey kanıtlamaz → görünür SKIP. Karantinanın
// Gatekeeper etkisi elle (Finder'da açma uyarısı) doğrulanır; otomatik kanıt yukarıdaki öznitelik testleridir.
func TestAC117P28fQuarantineSpctl(t *testing.T) {
	spctl, err := exec.LookPath("/usr/sbin/spctl")
	if err != nil {
		t.Skip("SKIP: spctl yok")
	}
	dir := t.TempDir()
	assess := func(name string, quarantine bool) bool {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		if quarantine {
			if err := WriteQuarantine(p); err != nil {
				t.Fatal(err)
			}
		}
		return exec.Command(spctl, "-a", "-t", "open", "--context", "context:primary-signature", p).Run() == nil
	}
	if assess("denetim.command", false) == assess("karantina.command", true) {
		t.Skip("SKIP: spctl karantinalı ve karantinasız dosyaya aynı sonucu veriyor (imzasız dosya her durumda ret); " +
			"Gatekeeper etkisi elle doğrulanır (runbook P28f elle listesi)")
	}
	if assess("karantina2.command", true) {
		t.Fatal("karantinalı dosya Gatekeeper değerlendirmesinden geçti")
	}
}
