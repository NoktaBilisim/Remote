package uicore

import (
	"os"
	"strings"
	"testing"
)

// P28d O-PD-4: libopus COPYING (BSD-3, wasm hattının çıktısı) bildirimlerde aynen; wazero NOTICE + Apache-2.0,
// wasi-libc/musl/cloudlibc ve compiler-rt metinleri var.
func TestP28dNoticesContainLibopusCopying(t *testing.T) {
	raw, err := os.ReadFile("../../voice/libopus-COPYING.txt")
	if err != nil {
		t.Fatal(err)
	}
	// Windows koşucusunda checkout CRLF olabilir (core.autocrlf): iki taraf da LF'e indirgenir.
	lf := func(s string) string { return strings.ReplaceAll(s, "\r\n", "\n") }
	notices, copying := lf(ThirdPartyNotices), lf(string(raw))
	if len(copying) == 0 || !strings.Contains(notices, copying) {
		t.Fatal("libopus-COPYING.txt bildirimlerde aynen yer almalı (yükseltmede third_party_notices.txt yeniden üretilir)")
	}
	for _, must := range []string{
		"Copyright 2020-2023 wazero authors", // wazero v1.12.0 NOTICE
		"Apache License\n                           Version 2.0, January 2004",
		"wasi-libc as a whole is multi-licensed",
		"musl as a whole is licensed under the following standard MIT license",
		"Copyright (c) 2015-2017 Nuxi (https://nuxi.nl/) and contributors.", // cloudlibc BSD-2
		"The LLVM Project is under the Apache License v2.0 with LLVM Exceptions",
		"dlmalloc",
		"github.com/ebitengine/purego v0.11.3 — LICENSE (Apache-2.0)", // P28f: macOS istemci (ADR-0037 m.1)
	} {
		if !strings.Contains(notices, must) {
			t.Errorf("bildirimlerde eksik: %q", must)
		}
	}
}
