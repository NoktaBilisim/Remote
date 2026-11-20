package launch

import (
	"testing"

	"remote-support/agent-win/internal/pairing"
)

// TestAC512SourceFromBundlePath P31 AC-512 (mimari-p31 §15.2 test tablosu): öncelik klasör kod > klasör ref > bundle adı
// yalnız kod > yok; ref büyük/küçük harf duyarsız okunur ve küçük harfe çevrilir; etiket döndürülmez.
func TestAC512SourceFromBundlePath(t *testing.T) {
	const ref = "abcdefghijklmnop"
	const dl = "/Users/a/Downloads/"
	cases := []struct {
		name, path string
		want       Source
	}{
		{"kod klasörü", dl + "Destek-12345678/Nokta Destek.app", Source{Code: "12345678"}},
		{"firma klasörü", dl + "NoktaDestek-Ornek-" + ref + "/Nokta Destek.app", Source{Ref: ref}},
		{"kopya eki ' (1)'", dl + "NoktaDestek-Ornek-" + ref + " (1)/Nokta Destek.app", Source{Ref: ref}},
		{"kopya eki '(2)'", dl + "NoktaDestek-Ornek-" + ref + "(2)/Nokta Destek.app", Source{Ref: ref}},
		{"kopya eki ' 3'", dl + "NoktaDestek-Ornek-" + ref + " 3/Nokta Destek.app", Source{Ref: ref}},
		{"kopya eki 3 hane", dl + "NoktaDestek-Ornek-" + ref + " (123)/Nokta Destek.app", Source{Ref: ref}},
		{"büyük harf ≡ küçük", dl + "NoktaDestek-X-ABCDEFGHIJKLMNOP/Nokta Destek.app", Source{Ref: ref}},
		{"önek küçük harf", dl + "noktadestek-x-" + ref + "/Nokta Destek.app", Source{Ref: ref}},
		{"20 karakter etiket", dl + "NoktaDestek-ABCDEFGHIJ0123456789-" + ref + "/N.app", Source{Ref: ref}},
		{"21 karakter etiket", dl + "NoktaDestek-ABCDEFGHIJ01234567890-" + ref + "/N.app", Source{}},
		{"boş etiket", dl + "NoktaDestek--" + ref + "/N.app", Source{}},
		{"15 karakter ref", dl + "NoktaDestek-X-abcdefghijklmno/N.app", Source{}},
		{"17 karakter ref", dl + "NoktaDestek-X-abcdefghijklmnopq/N.app", Source{}},
		{"ref alfabe dışı (1, 8)", dl + "NoktaDestek-X-abcdefghijklmn18/N.app", Source{}},
		{"sonek -x", dl + "NoktaDestek-X-" + ref + "-x/N.app", Source{}},
		{"sonek (1234)", dl + "NoktaDestek-X-" + ref + " (1234)/N.app", Source{}},
		{"sonek .zip", dl + "NoktaDestek-X-" + ref + ".zip/N.app", Source{}},
		{"Türkçe harfli etiket", dl + "NoktaDestek-Çağrı-" + ref + "/N.app", Source{}},
		{"önek önünde metin", dl + "xNoktaDestek-X-" + ref + "/N.app", Source{}},
		{"translocation yolu", "/private/var/folders/ab/T/AppTranslocation/0A1B2C3D-0000-1111-2222-333344445555/d/Nokta Destek.app", Source{}},
		{"bundle adında ref, klasör eşleşmiyor", dl + "NoktaDestek-X-" + ref + ".app", Source{}},
		{"bundle adında ref, klasör başka", dl + "Indirilenler/NoktaDestek-X-" + ref + ".app", Source{}},
		{"klasörde ref + bundle adında kod", dl + "NoktaDestek-X-" + ref + "/Destek-12345678.app", Source{Ref: ref}},
		{"klasörde kod + bundle adında kod", dl + "Destek-12345678/Destek-87654321.app", Source{Code: "12345678"}},
		{"bundle adında kod (P28f yedeği)", dl + "Destek-12345678.app", Source{Code: "12345678"}},
		{"kaynaksız", dl + "Nokta Destek.app", Source{}},
		{"Programlar'a taşınmış", "/Applications/Nokta Destek.app", Source{}},
		{"boş yol", "", Source{}},
	}
	for _, c := range cases {
		if got := SourceFromBundlePath(c.path); got != c.want {
			t.Errorf("%s: SourceFromBundlePath(%q) = %+v, beklenen %+v", c.name, c.path, got, c.want)
		}
		if got := CodeFromBundlePath(c.path); got != c.want.Code {
			t.Errorf("%s: CodeFromBundlePath geri uyum %q", c.name, got)
		}
	}
}

// TestAC512WindowsRefFromFileNameUnchanged §15.2: Windows dosya adı deseni ortak çekirdekten türetildi; tablo P31
// öncesiyle aynı sonucu verir (klasör eki ` 3` Windows'ta kabul edilmez).
func TestAC512WindowsRefFromFileNameUnchanged(t *testing.T) {
	cases := map[string]string{
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456.exe`:                 "abcdefghijk23456",
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456 (1).exe`:             "abcdefghijk23456",
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456(12).exe`:             "abcdefghijk23456",
		`C:\D\noktadestek-ORNEK-ABCDEFGHIJK23456.EXE`:                 "abcdefghijk23456",
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456 3.exe`:               "",
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456`:                     "",
		`C:\D\NoktaDestek-Ornek-abcdefghijk23456.zip`:                 "",
		`C:\D\NoktaDestek-Ornek0123456789012345-abcdefghijk23456.exe`: "",
	}
	for in, want := range cases {
		got, ok := pairing.RefFromFileName(in)
		if got != want || ok != (want != "") {
			t.Errorf("RefFromFileName(%q) = %q %v, beklenen %q", in, got, ok, want)
		}
	}
}
