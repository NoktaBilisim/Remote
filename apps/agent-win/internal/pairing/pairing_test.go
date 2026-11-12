package pairing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAC97FromFileName(t *testing.T) {
	cases := []struct {
		in   string
		code string
		ok   bool
	}{
		{`C:\Users\ayse\Downloads\Destek-12345678.exe`, "12345678", true},
		{`Destek-00000001.exe`, "00000001", true},
		{`C:\Users\ayse\Downloads\Destek-12345678 (1).exe`, "12345678", true},
		{`Destek-12345678(2).exe`, "12345678", true},
		{`destek-12345678.EXE`, "12345678", true},
		{`/tmp/Destek-12345678.exe`, "12345678", true},
		{`NoktaDestek.exe`, "", false},
		{`Destek-1234567.exe`, "", false},
		{`Destek-123456789.exe`, "", false},
		{`Destek-1234567a.exe`, "", false},
		{`Destek-12345678.exe.exe`, "", false},
		{`xDestek-12345678.exe`, "", false},
		{`Destek-12345678 (1234).exe`, "", false},
		{`Destek-١٢٣٤٥٦٧٨.exe`, "", false}, // Unicode rakam kabul edilmez
		{``, "", false},
	}
	for _, c := range cases {
		code, ok := FromFileName(c.in)
		if ok != c.ok || code != c.code {
			t.Errorf("%q: got (%q,%v) want (%q,%v)", c.in, code, ok, c.code, c.ok)
		}
	}
}

func TestAC97NormalizeManualEntry(t *testing.T) {
	ok := map[string]string{"12345678": "12345678", " 1234 5678 ": "12345678", "1234-5678": "12345678"}
	for in, want := range ok {
		if got, valid := Normalize(in); !valid || got != want {
			t.Errorf("%q: got %q %v", in, got, valid)
		}
	}
	for _, in := range []string{"", "1234567", "123456789", "abcd5678", "1234_5678", "１２３４５６７８"} {
		if _, valid := Normalize(in); valid {
			t.Errorf("%q geçerli sayılmamalı", in)
		}
	}
}

// TestAC133RefFromFileNameMatchesContractsFixture ortak fixture `request-form.json` fileName örnekleri (ADR-0006 r4).
func TestAC133RefFromFileNameMatchesContractsFixture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "request-form.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		FileName []struct {
			In  string  `json:"in"`
			Out *string `json:"out"`
		} `json:"fileName"`
	}
	if err := json.Unmarshal(b, &fx); err != nil || len(fx.FileName) == 0 {
		t.Fatalf("fixture: %v", err)
	}
	for _, c := range fx.FileName {
		ref, ok := RefFromFileName(`C:\Users\ayse\Downloads\` + c.In)
		if (c.Out == nil) == ok || (c.Out != nil && ref != *c.Out) {
			t.Errorf("%q: got (%q,%v) want %v", c.In, ref, ok, c.Out)
		}
	}
}

// TestAC161FileNameModesAreDisjoint firma dosyası 8 hane yoluna, kod dosyası talep yoluna düşmez (geriye uyum).
func TestAC161FileNameModesAreDisjoint(t *testing.T) {
	if _, ok := FromFileName("NoktaDestek-Firma12345678-abcdefghijk23456.exe"); ok {
		t.Error("firma dosyası kod modu sayılmamalı")
	}
	if _, ok := RefFromFileName("Destek-12345678.exe"); ok {
		t.Error("kod dosyası talep modu sayılmamalı")
	}
	if _, ok := RefFromFileName("NoktaDestek.exe"); ok {
		t.Error("genel dosya talep modu sayılmamalı")
	}
}
