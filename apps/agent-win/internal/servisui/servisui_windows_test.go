//go:build windows

package servisui

import (
	"testing"
	"unsafe"

	"remote-support/agent-win/internal/servis"
)

// AC-338: pencere/tepsi metni servis istemcisinin doğrulama metniyle aynıdır.
func TestAC338UnverifiedTextMatchesPipeClient(t *testing.T) {
	if TextUnverified != servis.ServiceUnverifiedText {
		t.Fatalf("%q ≠ %q", TextUnverified, servis.ServiceUnverifiedText)
	}
}

// AC-338: doğrulanamayan boru sunucusu "doğrulanamadı", olmayan boru "servis çalışmıyor" olarak sınıflanır.
func TestAC338PipeErrorClassification(t *testing.T) {
	if pipeResult(servis.PipeResponse{}, servis.ErrServiceUnverified) != PipeUnverified {
		t.Fatal("unverified")
	}
	if pipeResult(servis.PipeResponse{OK: true, State: servis.StateOnline}, nil) != PipeOK {
		t.Fatal("ok")
	}
	if pipeResult(servis.PipeResponse{Error: "x"}, nil) != PipeBusy {
		t.Fatal("ok:false geçici sayılmalı")
	}
}

// NOTIFYICONDATAW tam boy (P20 tray_windows_test ile aynı ölçü).
func TestNotifyIconDataSize(t *testing.T) {
	want := uintptr(976)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		want = 956
	}
	if got := unsafe.Sizeof(notifyIconData{}); got != want {
		t.Fatalf("boyut %d, beklenen %d", got, want)
	}
}
