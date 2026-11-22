//go:build !darwin

package voice

import "golang.org/x/sys/cpu"

// Supported sesli görüşmenin bu makinede gerçek zamanlı koşup koşamayacağını söyler (A-PD-6). amd64'te wazero
// derleyicisi SSE4.1 ister; yoksa wazero yorumlayıcıya düşer (≈ 22 ms/20 ms çerçeve, bütçe dışı). Ölçüt wazero v1.12.0
// internal/platform.compilerPlatformSupports ile aynıdır (cpu.X86.HasSSE41). false ise çağıran `rs.cap.voice1`
// bildirmez (cmd/noktadestek/deps.go ses bağımlılıklarını bağlamaz).
func Supported() bool { return cpu.X86.HasSSE41 }
