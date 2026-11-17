package voice

import (
	"runtime"
	"testing"

	"golang.org/x/sys/cpu"
)

// A-PD-6: ses yalnız wazero derleyicisinin seçildiği makinede bildirilir. wazero v1.12.0'ın ölçütü
// (internal/platform.compilerPlatformSupports) amd64 + cpu.X86.HasSSE41'dir; diğer mimarilerde voice1 yok.
func TestP28dSupportedMatchesWazeroCompilerCriterion(t *testing.T) {
	want := runtime.GOARCH == "amd64" && cpu.X86.HasSSE41
	if got := Supported(); got != want {
		t.Fatalf("Supported()=%v, beklenen %v (GOARCH=%s, SSE4.1=%v)", got, want, runtime.GOARCH, cpu.X86.HasSSE41)
	}
}
