package uicore

import (
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/request"
)

// TestAC190AC189FirmHomeSingleScreen tek ana ekran (2026-11-15): satır yoksa "Destek iste" pasif, varsayılan "Bağlantı
// kodum var", AC-190 açıklaması; dosyanın firması tek satırsa öneksiz ve "Bu firmayı unut" pasif; kayıtlı firmada
// "Kayıtlı firma: …" ve unut etkin. Tab sırası her durumda aynı. (P31 K-P31-7: internal/ui'den taşındı, aynen.)
func TestAC190AC189FirmHomeSingleScreen(t *testing.T) {
	const order = "Destek iste|Bağlantı kodum var|Bu firmayı unut|Bu bilgisayarı unut (tüm firmalar)"
	file := launch.FirmRow{Text: "Bu dosyanın firması: Ref Firma", File: true}
	reg := launch.FirmRow{Key: "k", Text: "A (kayıt: 01.11.2026)"}
	cases := []struct {
		name      string
		v         launch.FirmView
		text      string
		def       string
		support   bool
		forgetOne bool
		listed    bool
	}{
		{"AC-190 satır yok", launch.FirmView{}, request.MsgNoSource, "Bağlantı kodum var", false, false, false},
		{"yalnız dosyanın firması", launch.FirmView{Firms: []launch.FirmRow{file}, Single: true}, file.Text, "Destek iste", true, false, false},
		{"tek kayıtlı firma", launch.FirmView{Firms: []launch.FirmRow{reg}, Single: true}, "Kayıtlı firma: " + reg.Text, "Destek iste", true, true, false},
		{"dosyanın firması + kayıtlı", launch.FirmView{Firms: []launch.FirmRow{file, reg}}, "", "Destek iste", true, false, true},
	}
	for _, c := range cases {
		b := HomeButtons(c.v, PlatformWindows)
		var names []string
		for _, x := range b {
			names = append(names, x.Text)
			if x.Default && x.Text != c.def {
				t.Errorf("%s: varsayılan %q", c.name, x.Text)
			}
		}
		if strings.Join(names, "|") != order || b[0].Enabled != c.support || b[2].Enabled != c.forgetOne || !b[1].Enabled || !b[3].Enabled {
			t.Errorf("%s: %+v", c.name, b)
		}
		if HomeListed(c.v) != c.listed || (!c.listed && HomeSingleText(c.v) != c.text) {
			t.Errorf("%s: liste=%v satır=%q", c.name, HomeListed(c.v), HomeSingleText(c.v))
		}
	}
	v := launch.FirmView{Firms: []launch.FirmRow{file, reg}}
	if Forgettable(v, 0) || !Forgettable(v, 1) || Forgettable(v, 2) || Forgettable(v, -1) {
		t.Fatal("yalnız kayıtlı satır unutulabilir (seçim değişince düğme güncellenir)")
	}
}

// TestAC513MacHomeButtonsNoForget P31 AC-513: macOS ana ekranında yalnız "Destek iste" ve "Bağlantı kodum var" (unut
// düğmeleri yok); dosyanın firmasıyla "Destek iste" varsayılan, kaynaksız açılışta pasif ve "Bağlantı kodum var"
// varsayılan (AC-190). Kind sırası Windows tablosunun ilk ikisiyle aynı.
func TestAC513MacHomeButtonsNoForget(t *testing.T) {
	file := launch.FirmView{Firms: []launch.FirmRow{{Text: "Bu dosyanın firması: F", File: true}}, Single: true}
	b := HomeButtons(file, PlatformMac)
	if len(b) != 2 || b[0].Kind != HomeSupport || b[1].Kind != HomeCode || !b[0].Enabled || !b[0].Default || b[1].Default {
		t.Fatalf("firma klasörü: %+v", b)
	}
	b = HomeButtons(launch.FirmView{}, PlatformMac)
	if len(b) != 2 || b[0].Enabled || b[0].Default || !b[1].Default || HomeSingleText(launch.FirmView{}) != request.MsgNoSource {
		t.Fatalf("kaynaksız: %+v", b)
	}
	w := HomeButtons(file, PlatformWindows)
	for i := range b {
		if b[i].Text != w[i].Text || b[i].Kind != w[i].Kind {
			t.Fatalf("Mac ve Windows ortak düğmeleri ayrıştı: %+v %+v", b, w)
		}
	}
}

// TestAC514FormFieldsShared P31 AC-514: form alanları iki platformda aynı tek tablo (sıra = Tab sırası, anahtar = request
// hata alanları). Mac'te hatırla satırının olmadığı launch tarafında (TestAC517MacNoStoreNoBindingNoRemember: Remember nil,
// AC-188 satırı boş) ve reqform_darwin.go'da (kutu yok) sabittir.
func TestAC514FormFieldsShared(t *testing.T) {
	mac := FormFields()
	want := []string{request.FieldName, request.FieldPhone, request.FieldEmail, request.FieldDescription}
	if len(mac) != len(want) {
		t.Fatalf("alan sayısı %d", len(mac))
	}
	for i, k := range want {
		if mac[i].Key != k || mac[i].Label == "" || mac[i].Limit <= 0 {
			t.Fatalf("alan %d: %+v", i, mac[i])
		}
		if k != request.FieldDescription && mac[i].Kind != FieldText {
			t.Fatalf("%s tek satır olmalı", k)
		}
	}
	if mac[3].Kind != FieldMultiline || mac[3].Limit < 500 {
		t.Fatalf("sorun alanı çok satırlı ve ≥ 500 (doğrulama 10–500): %+v", mac[3])
	}
	// Doğrulamanın odak sırası (request.FieldOrder) form sırasıyla uyumlu: alanlar sonra onay.
	for i, k := range want {
		if request.FieldOrder[i] != k {
			t.Fatalf("FieldOrder[%d]=%s", i, request.FieldOrder[i])
		}
	}
}

// TestAC515WaitAndAcceptTexts P31 AC-515/516: bekleme ve kabul metinleri iki platformda aynı biçimleyiciden; Win32
// kabul gövdesi P31 öncesi metinle bayt bayt aynı ("\r\n"), AppKit "\n".
func TestAC515WaitAndAcceptTexts(t *testing.T) {
	if RequestCodeText("123456") != "123 456" || RequestCodeText("12345") != "12345" {
		t.Fatal("talep kodu")
	}
	if MMSS(65*time.Second) != "01:05" || MMSS(0) != "00:00" || MMSS(1500*time.Millisecond) != "00:02" {
		t.Fatal("mm:ss")
	}
	if WaitPositionText(0) != "Sıra bilgisi alınıyor…" || WaitPositionText(3) != "Sırada 3. talepsiniz" ||
		WaitElapsedText(61*time.Second) != "Bekleme süresi: 01:01" {
		t.Fatal("bekleme satırları")
	}
	v := request.AcceptView{TechName: "Ali", TechVerifyCode: "7731", RequestCode: "123456", Remaining: 60 * time.Second, AdmitCode: "4821"}
	const winBody = "Teknisyen doğrulama kodu: 7731 (telefondaki teknisyen de bu kodu söylemeli)\r\n" +
		"Talep kodunuz: 123 456  ·  Kabul kodu: 4 8 2 1\r\n" +
		"\"Ekranımı paylaş\" derseniz teknisyen ekranınızı görür; uzaktan kontrol için ayrıca izin istenir.\r\n" +
		"Kalan süre: 01:00"
	if got := AcceptBody(v, "\r\n"); got != winBody {
		t.Fatalf("Win32 gövdesi değişti:\n%q", got)
	}
	if got := AcceptBody(v, "\n"); got != strings.ReplaceAll(winBody, "\r\n", "\n") {
		t.Fatalf("AppKit gövdesi: %q", got)
	}
	if AcceptHeading("Ali") != "Ali bağlanmak istiyor" || !strings.HasPrefix(AcceptBody(v, "\n")[strings.LastIndex(AcceptBody(v, "\n"), "\n")+1:], AcceptRemainingPrefix) {
		t.Fatal("başlık / kalan süre satırı")
	}
}
