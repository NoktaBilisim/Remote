package objc

import "sync"

// Handles C tarafında saklanan bağlam için Go değerlerini tamsayı tutamaçla eşler (FFI kuralı 1). Tutamaç 0 hiçbir
// zaman verilmez; bir tutamaç Take ile bir kez alınır (alınınca silinir). Sıfır değeri kullanıma hazırdır.
type Handles[T any] struct {
	mu   sync.Mutex
	next uintptr
	m    map[uintptr]T
}

// Put değeri saklar ve tutamacını döner.
func (h *Handles[T]) Put(v T) uintptr {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.m == nil {
		h.m = map[uintptr]T{}
	}
	for {
		h.next++
		if _, used := h.m[h.next]; h.next != 0 && !used {
			break
		}
	}
	h.m[h.next] = v
	return h.next
}

// Take tutamacın değerini döner ve kaydı siler; bilinmeyen tutamaçta ok=false.
func (h *Handles[T]) Take(id uintptr) (T, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	v, ok := h.m[id]
	delete(h.m, id)
	return v, ok
}

// Len bekleyen kayıt sayısı (sızıntı testleri).
func (h *Handles[T]) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.m)
}
