//go:build windows

package servis

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// P29-K0s/K7 Windows birim testleri (agent-win.yml "go test (Windows)" adımındaki `go test ./...` ile koşar; koşucu
// yöneticidir ama SYSTEM değildir). SCM/RUN_COMMAND davranışı burada denenmez — K11 staging listesi (implementation.md).

// K0s: çalışan imaj yeniden adlandırılabilir ve sabit bağlantı kurulabilir (test ikilisinin kendi kopyası üzerinde).
func TestK0sRenameRunningImageAndHardLink(t *testing.T) {
	sysDir, err := windows.GetSystemDirectory()
	if err != nil {
		t.Fatal(err)
	}
	self := filepath.Join(sysDir, "PING.EXE")
	dir := t.TempDir()
	exe := filepath.Join(dir, "kopya.exe")
	raw, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, raw, 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-n", "30", "127.0.0.1") // çalışan (eşlenmiş) imaj
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	if err := createHardLink(exe+exeOldSuffix, exe); err != nil {
		t.Logf("K0s: çalışan imaja sabit bağlantı kurulamadı: %v", err)
	}
	if err := os.WriteFile(exe+exeNewSuffix, []byte("yeni"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := renamePOSIX(exe+exeNewSuffix, exe); err != nil {
		t.Logf("K0s: FileRenameInfoEx (POSIX) eşlenmiş imaj üstüne başarısız, iki adımlı akış kullanılacak: %v", err)
		_ = os.Remove(exe + exeOldSuffix)
		if err := swapExe(exe); err != nil {
			t.Fatalf("iki adımlı yer değiştirme: %v", err)
		}
	}
	if b, _ := os.ReadFile(exe); string(b) != "yeni" {
		t.Fatal("exe yeni bayt değil")
	}
	if !exists(exe + exeOldSuffix) {
		t.Fatal("exe.eski yok")
	}
	if err := rollbackExe(exe); err != nil {
		t.Fatalf("geri dönüş: %v", err)
	}
	if b, _ := os.ReadFile(exe); len(b) != len(raw) {
		t.Fatal("geri dönüşte eski ikili yerine konmadı")
	}
}

func TestAC480SwapRollbackFiles(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, ExeName)
	_ = os.WriteFile(exe, []byte("eski"), 0o755)
	_ = os.WriteFile(exe+exeNewSuffix, []byte("yeni"), 0o755)
	if err := swapExe(exe); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "yeni" {
		t.Fatalf("exe = %q", b)
	}
	if b, _ := os.ReadFile(exe + exeOldSuffix); string(b) != "eski" {
		t.Fatalf("exe.eski = %q", b)
	}
	if err := rollbackExe(exe); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "eski" {
		t.Fatalf("geri dönüş exe = %q", b)
	}
	if b, _ := os.ReadFile(exe + exeBrokenSuffix); string(b) != "yeni" {
		t.Fatalf("exe.bozuk = %q", b)
	}
	// exe yokken (R-P29-11) exe.eski yerine konur.
	_ = os.Rename(exe, exe+exeOldSuffix)
	if err := rollbackExe(exe); err != nil || !exists(exe) {
		t.Fatalf("exe yokken geri dönüş: %v", err)
	}
}

// T-4: gözetmen mutex'i varlık anlamlı — ikinci alma başarısız, bırakınca yeniden alınır.
func TestT4SupervisorMutexSingle(t *testing.T) {
	name := `Local\NoktaDestekServisUpdateTest`
	r1, ok := acquireNamed(name)
	if !ok {
		t.Skip("mutex oluşturulamadı")
	}
	if _, ok := acquireNamed(name); ok {
		t.Fatal("ikinci gözetmen mutex'i aldı")
	}
	r1()
	r2, ok := acquireNamed(name)
	if !ok {
		t.Fatal("bırakılan mutex yeniden alınamadı")
	}
	r2()
}

// T-6: varsayılan ACL'li ya da bağlantı noktası olan Guncelleme\ reddedilir ve yeniden oluşturulur.
func TestT6PrepareUpdateDir(t *testing.T) {
	data := t.TempDir()
	dir := UpdateDir(data)
	if err := os.Mkdir(dir, 0o755); err != nil { // miras ACL: DACL korumalı değil
		t.Fatal(err)
	}
	if err := verifyUpdateDir(dir); err == nil {
		t.Fatal("korumasız klasör doğrulandı")
	}
	recreated, err := prepareUpdateDir(data)
	if !recreated {
		t.Fatal("güvensiz klasör yeniden oluşturulmadı")
	}
	if err != nil && !strings.Contains(err.Error(), "sahip") {
		t.Logf("yeniden oluşturma (yönetici olmayan sahip olabilir): %v", err)
	}
	target := t.TempDir()
	_ = os.RemoveAll(dir)
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", dir, target).CombinedOutput(); err != nil {
		t.Skipf("bağlantı noktası oluşturulamadı: %v %s", err, out)
	}
	attrs, err := reparseAttrs(dir)
	if err != nil || attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT == 0 {
		t.Fatalf("bağlantı noktası görülmedi: %v", err)
	}
	if err := verifyUpdateDir(dir); err == nil {
		t.Fatal("bağlantı noktası doğrulandı")
	}
	if err := removeUnsafeDir(dir); err != nil {
		t.Fatal(err)
	}
	if !exists(target) {
		t.Fatal("bağlantı hedefi silindi")
	}
}

// T-4: --update-apply / --update-recover LocalSystem dışında hiçbir şey yapmaz.
func TestT4ApplyDeniedOutsideSystem(t *testing.T) {
	if isLocalSystem() {
		t.Skip("koşucu SYSTEM")
	}
	sup := &Supervisor{Sys: &winApplySys{}, Store: &StateStore{Dir: t.TempDir()}, Events: &memEvents{}}
	if sup.Apply() != ApplyDenied || sup.Recover() != ApplyDenied {
		t.Fatal("SYSTEM dışı jetonla gözetmen ilerledi")
	}
}

func TestAC480StagedExclusiveHandle(t *testing.T) {
	path := filepath.Join(t.TempDir(), stagedFileName)
	f, err := createExclusive(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := os.Open(path); err == nil {
		t.Fatal("paylaşımsız tutamaç açıkken dosya okunabildi")
	}
	if _, err := createExclusive(path); err == nil {
		t.Fatal("CREATE_NEW var olan dosyayı açtı")
	}
}
