package diag

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func sample() Report {
	return Report{
		Time: time.Date(2026, 11, 12, 9, 30, 0, 0, time.UTC), Event: EventOpenFail, Version: "0.10.2",
		OS: "10.0.22631.4317", Release: "23H2", Edition: "ProfessionalN", Target: `\\.\DISPLAY1`,
		Monitors: []Monitor{{Device: `\\.\DISPLAY1`, W: 2880, H: 1800, Primary: true}},
		Adapters: []Adapter{{Name: "Intel(R) Iris(R) Xe Graphics", Vendor: 0x8086, Device: 0x9a49},
			{Name: "NVIDIA GeForce RTX 3050 Laptop GPU", Vendor: 0x10de, Device: 0x25a2},
			{Name: "Microsoft Basic Render Driver", Vendor: 0x1414, Device: 0x8c, Software: true}},
		Outputs: []Output{{Adapter: 0, Device: `\\.\DISPLAY1`, W: 2880, H: 1800, Rotation: 1, Attached: true, Desc1: true,
			BitsPerColor: 10, ColorSpace: 12}},
		Attempts: []Attempt{{Method: "DXGI", Reason: "DXGI_UNSUPPORTED", Op: "DuplicateOutput", HR: 0x887A0004},
			{Method: "DXGI1", Reason: "FIRST_FRAME_TIMEOUT", Op: "AcquireNextFrame", HR: 0x887A0026},
			{Method: "GDI", Reason: "GDI_FAILED", Op: "BitBlt"}},
		Reason: "DXGI_UNSUPPORTED", Op: "DuplicateOutput", HR: 0x887A0004,
	}
}

// Kayıt yalnız izinli sabit anahtarlardan oluşur; HDR/hibrit GPU bilgisi ve neden kodu görünür.
func TestFormatContainsOnlyAllowedKeys(t *testing.T) {
	out := sample().Format()
	for _, want := range []string{"olay=acilis_hata", "istemci=0.10.2", "windows=10.0.22631.4317", "surum=23H2",
		"edisyon=ProfessionalN", "monitor_sayisi=1", "boyut=2880x1800", `ad="NVIDIA GeForce RTX 3050 Laptop GPU"`,
		"yazilim=1", "renk_bit=10 renk_uzayi=12 hdr=1", "deneme=DXGI sonuc=DXGI_UNSUPPORTED islem=DuplicateOutput hr=0x887A0004",
		"neden=DXGI_UNSUPPORTED islem=DuplicateOutput hr=0x887A0004", "yontem=- kodlayici=-"} {
		if !strings.Contains(out, want) {
			t.Errorf("eksik %q:\n%s", want, out)
		}
	}
	allowed := map[string]bool{}
	for _, k := range strings.Fields("olay istemci windows surum edisyon hedef monitor_sayisi monitor aygit boyut birincil " +
		"adaptor ad vendor aygit_id yazilim cikis dondurme masaustu renk_bit renk_uzayi hdr renk deneme sonuc islem hr " +
		"yontem kodlayici donanim_kodlayici neden") {
		allowed[k] = true
	}
	key := regexp.MustCompile(`([a-z_]+)=`)
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.HasPrefix(line, "--- ") {
			line = line[4:]
		}
		for _, m := range key.FindAllStringSubmatch(line, -1) {
			if !allowed[m[1]] {
				t.Errorf("izinsiz anahtar %q: %s", m[1], line)
			}
		}
	}
}

// PII yok: serbest metin alanına (adaptör/aygıt adı) gömülü satır sonu, '=' veya Türkçe/Unicode metin yeni anahtar
// ya da satır oluşturamaz; uzun değer kısaltılır. Report'ta kişisel veri alanı yoktur.
func TestFormatNoPIIAndNoInjection(t *testing.T) {
	r := sample()
	r.Adapters = []Adapter{{Name: "GPU\nneden=SAHTE ad=Ayşe telefon=+905321234567 " + strings.Repeat("x", 200)}}
	r.Outputs = nil
	r.Target = "\\\\.\\DISPLAY1\r\nanahtar=rsb_gizli"
	out := r.Format()
	if strings.Count(out, "\nneden=") != 1 || strings.Contains(out, "telefon=") || strings.Contains(out, "anahtar=") {
		t.Fatalf("enjeksiyon:\n%s", out)
	}
	if strings.Contains(out, "Ayşe") || strings.Contains(out, strings.Repeat("x", maxField)) {
		t.Fatalf("Unicode/uzun değer temizlenmeli:\n%s", out)
	}
	// Bu makinenin kullanıcı/bilgisayar adı ve ev dizini hiçbir koşulda kayda girmez (Report'ta alanı yok).
	host, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	for _, s := range []string{host, home, os.Getenv("USER"), os.Getenv("USERNAME")} {
		if len(s) > 3 && strings.Contains(sample().Format(), s) {
			t.Fatalf("kişisel veri sızdı: %q", s)
		}
	}
	for _, bad := range []string{"https://", "http://", "rsb_", "@"} {
		if strings.Contains(sample().Format(), bad) {
			t.Fatalf("URL/anahtar/e-posta: %q", bad)
		}
	}
}

func TestFormatSuccessFallbackLine(t *testing.T) {
	r := Report{Event: EventOpenFallbk, Method: "GDI", Encoder: "SW", HWReason: "NO_H264_ENCODER",
		Attempts: []Attempt{{Method: "DXGI", Reason: "DXGI_UNSUPPORTED", HR: 0x887A0004}, {Method: "GDI"}},
		Outputs:  []Output{{Device: `\\.\DISPLAY2`}}}
	out := r.Format()
	for _, want := range []string{"deneme=GDI sonuc=OK", "yontem=GDI kodlayici=SW donanim_kodlayici=NO_H264_ENCODER", "renk=bilinmiyor"} {
		if !strings.Contains(out, want) {
			t.Errorf("eksik %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "\nneden=") {
		t.Fatal("başarılı yedekte neden satırı olmamalı")
	}
}

// Boyut sınırı: dosya Max'ı aşacaksa .1'e döner; iki dosya toplamı ≤ 2×Max; tek kayıt Max'tan büyükse kısaltılır.
func TestLogRotatesWithinLimit(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	const limit = 2048
	l := &Log{Dir: dir, Max: limit}
	for i := 0; i < 50; i++ {
		if err := l.Write(sample()); err != nil {
			t.Fatal(err)
		}
	}
	cur, err := os.Stat(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	old, err := os.Stat(filepath.Join(dir, OldName))
	if err != nil {
		t.Fatal("dönen dosya yok:", err)
	}
	if cur.Size() > limit || old.Size() > limit {
		t.Fatalf("sınır aşıldı: %d + %d", cur.Size(), old.Size())
	}
	ents, _ := os.ReadDir(dir)
	if len(ents) != 2 {
		t.Fatalf("yalnız iki dosya olmalı: %v", ents)
	}
	big := sample()
	for i := 0; i < 100; i++ {
		big.Attempts = append(big.Attempts, Attempt{Method: "DXGI", Reason: "OTHER", Op: "AcquireNextFrame", HR: 1})
	}
	if err := l.Write(big); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(filepath.Join(dir, FileName)); st.Size() > limit {
		t.Fatalf("büyük kayıt kısaltılmalı: %d", st.Size())
	}
	if l2 := (&Log{Dir: dir}); l2.Write(sample()) != nil {
		t.Fatal("varsayılan sınırla yazım")
	}
}

func TestLogDisabled(t *testing.T) {
	var l *Log
	if err := l.Write(sample()); err != nil {
		t.Fatal(err)
	}
	if err := (&Log{}).Write(sample()); err != nil {
		t.Fatal(err)
	}
}

func TestDefaultLimit256KBTotal(t *testing.T) {
	if 2*MaxSize != 256<<10 {
		t.Fatal(MaxSize)
	}
}

// QA#1 / Güvenlik ORTA: log yalnız kalıcı modda yazılır; kod modunda (persistent false) klasör bile oluşmaz (AC-108,
// AC-138). Güvenlik DÜŞÜK (CWE-59): yükseltilmiş süreçte log kapalı.
func TestNewLogOnlyPersistentAndNotElevated(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	if NewLog(dir, true, func() bool { return true }) != nil {
		t.Fatal("yükseltilmiş süreçte log kapalı olmalı")
	}
	if NewLog("", false, func() bool { return true }) != nil || NewLog(dir, false, nil) != nil {
		t.Fatal("klasör/kalıcılık bilgisi yoksa log kapalı")
	}
	persistent := false
	l := NewLog(dir, false, func() bool { return persistent })
	if err := l.Write(sample()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("kod modunda klasör/dosya oluşmamalı")
	}
	persistent = true // ör. oturum içinde bilgisayar kaydı alındı
	if err := l.Write(sample()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatal("kalıcı modda yazılmalı:", err)
	}
}

// CWE-59: klasör, log veya dönen kopya sembolik bağlantıysa hiçbir şey yazılmaz/taşınmaz; hedef değişmez.
func TestLogRefusesReparsePoints(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "hedef")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	victim := filepath.Join(target, "kurban.dll")
	if err := os.WriteFile(victim, []byte("orijinal"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 1) Klasör bağlantı
	link := filepath.Join(base, "NoktaDestek")
	if err := os.Symlink(target, link); err != nil {
		t.Skip("symlink desteklenmiyor:", err)
	}
	if err := (&Log{Dir: link}).Write(sample()); err == nil {
		t.Fatal("bağlantı klasörüne yazılmamalı")
	}
	if _, err := os.Stat(filepath.Join(target, FileName)); !os.IsNotExist(err) {
		t.Fatal("hedefte log oluşmamalı")
	}
	// 2) Log dosyası bağlantı
	dir := filepath.Join(base, "d2")
	_ = os.Mkdir(dir, 0o700)
	if err := os.Symlink(victim, filepath.Join(dir, FileName)); err != nil {
		t.Fatal(err)
	}
	if err := (&Log{Dir: dir}).Write(sample()); err == nil {
		t.Fatal("bağlantı dosyaya eklenmemeli")
	}
	// 3) Dönen kopya bağlantı: döndürme (rename) yapılmamalı
	dir3 := filepath.Join(base, "d3")
	_ = os.Mkdir(dir3, 0o700)
	if err := os.WriteFile(filepath.Join(dir3, FileName), make([]byte, 300), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(victim, filepath.Join(dir3, OldName)); err != nil {
		t.Fatal(err)
	}
	if err := (&Log{Dir: dir3, Max: 200}).Write(sample()); err == nil {
		t.Fatal("bağlantı üzerine döndürülmemeli")
	}
	if b, _ := os.ReadFile(victim); string(b) != "orijinal" {
		t.Fatal("hedef dosya değişmemeli")
	}
	if st, err := os.Lstat(filepath.Join(dir3, FileName)); err != nil || st.Size() != 300 {
		t.Fatal("mevcut log taşınmamalı")
	}
}
