package objc

import "testing"

// S-P28f-11 kural 1: C'ye verilen bağlam tamsayı tutamaçtır; 0 verilmez, bir kez alınır.
func TestP28fHandlesPutTakeOnce(t *testing.T) {
	var h Handles[string]
	a, b := h.Put("a"), h.Put("b")
	if a == 0 || b == 0 || a == b {
		t.Fatalf("tutamaçlar %d %d", a, b)
	}
	if v, ok := h.Take(a); !ok || v != "a" {
		t.Fatalf("Take(a) = %q %v", v, ok)
	}
	if _, ok := h.Take(a); ok {
		t.Fatal("tutamaç ikinci kez alınmamalı")
	}
	if _, ok := h.Take(0); ok {
		t.Fatal("0 tutamacı geçersiz")
	}
	if h.Len() != 1 {
		t.Fatalf("bekleyen %d", h.Len())
	}
}

// Sayaç taşsa da 0 ya da kullanımdaki tutamaç verilmez.
func TestP28fHandlesWrapSkipsZeroAndUsed(t *testing.T) {
	var h Handles[int]
	h.next = ^uintptr(0) - 1
	first := h.Put(1) // ^0
	second := h.Put(2)
	if first != ^uintptr(0) || second != 1 {
		t.Fatalf("taşma: %d %d", first, second)
	}
	h.next = 0
	if third := h.Put(3); third != 2 {
		t.Fatalf("kullanımdaki 1 atlanmalı: %d", third)
	}
}
