package pairing

import "testing"

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
