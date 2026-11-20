package request

import (
	"context"
	"net/url"
	"testing"
)

// TestAC519DownloadURLPlatform P31 AC-519: macOS'ta "Yeni sürümü indir" `&os=macos` ekli adresi açar; Windows (boş ya
// da "windows") adresi P31 öncesiyle bayt bayt aynıdır; başka değer eklenmez; geçersiz ref / https dışı köken yine yok.
func TestAC519DownloadURLPlatform(t *testing.T) {
	srv, _ := url.Parse("https://remote.example:4450")
	const base = "https://remote.example:4450/api/v1/public/agent/request-download?ref=abcdefghijk23456"
	cases := map[string]string{
		"":        base,
		"windows": base,
		"macos":   base + "&os=macos",
		"linux":   base,
		"macos&x": base,
		"MACOS":   base,
	}
	for os, want := range cases {
		if u, ok := DownloadURL(srv, "abcdefghijk23456", os); !ok || u != want {
			t.Errorf("os=%q: %q %v", os, u, ok)
		}
	}
	if _, ok := DownloadURL(srv, "ABC&x=1", DownloadOSMac); ok {
		t.Fatal("geçersiz ref ile URL üretilmemeli")
	}
	plain, _ := url.Parse("http://remote.example")
	if _, ok := DownloadURL(plain, "abcdefghijk23456", DownloadOSMac); ok {
		t.Fatal("https dışı köken")
	}
}

// TestAC519OutdatedProblemOpensMacURL P31 AC-519: sunucu eski sürüm derse "Yeni sürümü indir" macOS'ta yalnız
// `&os=macos` ekli adresi açar (UI.OpenURL'e başka adres gitmez); form gösterilmez.
func TestAC519OutdatedProblemOpensMacURL(t *testing.T) {
	min := "0.9.1"
	a, u := &fakeAPI{min: &min}, newUI()
	u.problems = []ProblemAction{ProblemDownload, ProblemCodeMode}
	d := deps(a, u, newConn(), nil, nil)
	d.DownloadOS = DownloadOSMac
	o := Run(context.Background(), d)
	if o.Kind != OutClose || len(u.views) != 0 || len(u.opened) != 1 ||
		u.opened[0] != "https://remote.example/api/v1/public/agent/request-download?ref="+testRef+"&os=macos" {
		t.Fatalf("%+v views=%d opened=%v", o, len(u.views), u.opened)
	}
}
