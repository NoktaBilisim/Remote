//go:build windows

package printing

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/dllsafe"
)

// P28a-K0 prototip testleri (mimari-p28 §10 K0, K-P28a-4). Sonuçlar t.Log ile ve GitHub Actions'ta ayrıca
// $GITHUB_STEP_SUMMARY'ye ("P28a K0" tablosu) yazılır: `go test ./...` -v olmadan da koşu özetinde görünür.
// Test ikilisi işleyici rolünü de oynar: TestMain `--pdf-isleyici` argümanında RunWorker'a dallanır.

//go:embed testdata/k0.pdf
var k0PDF []byte // 2 sayfa: A4 dikey + A4 yatay (çerçeve, metin, mavi dikdörtgen)

var (
	summaryMu sync.Mutex
	summary   []string
)

func report(t *testing.T, row string) {
	t.Helper()
	t.Log(row)
	summaryMu.Lock()
	summary = append(summary, row)
	summaryMu.Unlock()
}

func TestMain(m *testing.M) {
	if IsWorkerLaunch(os.Args) {
		if err := dllsafe.Harden(); err != nil {
			os.Exit(WorkerExitIO)
		}
		os.Exit(RunWorker())
	}
	code := m.Run()
	writeSummary()
	os.Exit(code)
}

func writeSummary() {
	path := os.Getenv("GITHUB_STEP_SUMMARY")
	if path == "" || len(summary) == 0 {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = fmt.Fprintf(f, "### P28a K0 — Windows.Data.Pdf / işleyici yalıtımı / GDI\n\n| Sonuç |\n|---|\n")
	for _, r := range summary {
		_, _ = fmt.Fprintf(f, "| %s |\n", strings.ReplaceAll(r, "|", "/"))
	}
}

// inkPixels beyaz olmayan piksel sayısı ve mavi (B baskın) piksel var mı.
func inkPixels(bm *Bitmap) (ink int, blue bool) {
	for y := 0; y < bm.H; y++ {
		row := bm.Pix[y*bm.Stride:]
		for x := 0; x < bm.W; x++ {
			b, g, r := row[x*3], row[x*3+1], row[x*3+2]
			if b < 0xf0 || g < 0xf0 || r < 0xf0 {
				ink++
			}
			if b > 0xa0 && r < 0x80 && g < 0x90 {
				blue = true
			}
		}
	}
	return ink, blue
}

const testW, testH = 850, 1100 // ~100 DPI Letter oranı; render hedefi üst süreçten

// (a) Aynı süreçte Windows.Data.Pdf: LoadFromStreamAsync + RenderToStreamAsync → BGR.
func TestP28aK0InProcessRender(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := roInit(); err != nil {
		report(t, fmt.Sprintf("(a) aynı süreç: RoInitialize ÇALIŞMIYOR: %v", err))
		t.Fatal(err)
	}
	defer roUninit()
	doc, err := loadPDF(k0PDF)
	if err != nil {
		report(t, fmt.Sprintf("(a) aynı süreç: LoadFromStreamAsync ÇALIŞMIYOR: %v", err))
		t.Fatal(err)
	}
	defer doc.close()
	if doc.pages != 2 {
		t.Fatalf("sayfa = %d, 2 beklenir", doc.pages)
	}
	for i := uint32(0); i < doc.pages; i++ {
		bm, err := doc.render(i, testW, testH)
		if err != nil {
			report(t, fmt.Sprintf("(a) aynı süreç: sayfa %d render ÇALIŞMIYOR: %v", i+1, err))
			t.Fatal(err)
		}
		ink, blue := inkPixels(bm)
		if bm.W != testW || bm.H != testH || ink < 1000 || !blue {
			t.Fatalf("sayfa %d: %dx%d mürekkep=%d mavi=%v", i+1, bm.W, bm.H, ink, blue)
		}
	}
	report(t, fmt.Sprintf("(a) aynı süreç: ÇALIŞIYOR (2 sayfa, %dx%d)", testW, testH))

	if _, err := loadPDF([]byte("%PDF-1.4\nbozuk")); !errors.Is(err, ErrInvalidPDF) {
		t.Errorf("bozuk PDF: %v, ErrInvalidPDF beklenir", err)
	}
}

// (b) İşleyici süreçte render: her zaman kısıtlı jeton + job + HANDLE_LIST + alt süreç yasağı + görüntü yükleme
// mitigasyonu; varyantlar düşük bütünlük ve r2 mitigation'larını ayrı ayrı ve birlikte ölçer (K-P28a-4 kanıtı).
// Temel varyant zorunludur (kırmızı olur); diğerleri sonucu raporlar.
func TestP28aK0WorkerIsolation(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	variants := []struct {
		name     string
		iso      Isolation
		required bool
	}{
		{"kısıtlı jeton + job", Isolation{}, true},
		{"+ düşük bütünlük", Isolation{LowIntegrity: true}, false},
		{"+ yalnız Microsoft imzalı görüntü", Isolation{MicrosoftOnly: true}, false},
		{"+ dinamik kod yasak", Isolation{NoDynamicCode: true}, false},
		{"tam (tasarım r2)", FullIsolation, false},
	}
	for _, v := range variants {
		t.Run(v.name, func(t *testing.T) {
			res, err := workerRound(exe, v.iso)
			if err != nil {
				report(t, fmt.Sprintf("(b) işleyici [%s]: ÇALIŞMIYOR — %v", v.name, err))
				if v.required {
					t.Fatal(err)
				}
				return
			}
			report(t, fmt.Sprintf("(b) işleyici [%s]: ÇALIŞIYOR — %s", v.name, res))
		})
	}
}

// workerRound işleyiciyi başlatır, bütünlük düzeyini okur, iki sayfa render eder, bozuk PDF'i dener, kapatır.
func workerRound(exe string, iso Isolation) (string, error) {
	w, err := StartWorker(exe, iso)
	if err != nil {
		return "", fmt.Errorf("başlatma: %w", err)
	}
	pages, err := w.Inspect(k0PDF)
	il := integrityOf(w)
	if err != nil {
		code := w.Close()
		return "", fmt.Errorf("inspect: %w (bütünlük %s, çıkış 0x%08X)", err, il, code)
	}
	if pages != 2 {
		w.Close()
		return "", fmt.Errorf("sayfa = %d", pages)
	}
	for i := uint32(0); i < 2; i++ {
		bm, err := w.Render(i, testW, testH)
		if err != nil {
			code := w.Close()
			return "", fmt.Errorf("render %d: %w (bütünlük %s, çıkış 0x%08X)", i+1, err, il, code)
		}
		if ink, blue := inkPixels(bm); ink < 1000 || !blue {
			w.Close()
			return "", fmt.Errorf("render %d boş görünüyor (mürekkep=%d)", i+1, ink)
		}
	}
	if _, err := w.Inspect([]byte("%PDF-1.4\nbozuk")); !errors.Is(err, ErrInvalidPDF) {
		w.Close()
		return "", fmt.Errorf("bozuk PDF: %v, ErrInvalidPDF beklenir", err)
	}
	if code := w.Close(); code != WorkerExitOK {
		return "", fmt.Errorf("çıkış kodu 0x%08X", code)
	}
	return fmt.Sprintf("2 sayfa render, bozuk PDF → INVALID_PDF, bütünlük %s, çıkış 0", il), nil
}

// integrityOf işleyici sürecin bütünlük SID'i (S-1-16-4096 = düşük, 8192 = orta, 12288 = yüksek).
func integrityOf(w *Worker) string {
	var tok windows.Token
	if err := windows.OpenProcessToken(w.p.h, windows.TOKEN_QUERY, &tok); err != nil {
		return "okunamadı"
	}
	defer tok.Close()
	var n uint32
	_ = windows.GetTokenInformation(tok, windows.TokenIntegrityLevel, nil, 0, &n)
	if n == 0 {
		return "okunamadı"
	}
	buf := make([]byte, n)
	if err := windows.GetTokenInformation(tok, windows.TokenIntegrityLevel, &buf[0], n, &n); err != nil {
		return "okunamadı"
	}
	return (*windows.Tokenmandatorylabel)(unsafe.Pointer(&buf[0])).Label.Sid.String()
}

// (c) GDI: "Microsoft Print to PDF" varsa iki sayfayı dosyaya basar (çıktı yolu verildiği için kayıt diyaloğu
// açılmaz); yazıcı yoksa SKIP.
func TestP28aK0PrintToPDF(t *testing.T) {
	if name, err := DefaultPrinter(); err == nil {
		report(t, fmt.Sprintf("(c) varsayılan yazıcı: %q", name))
	} else {
		report(t, "(c) varsayılan yazıcı: yok (NO_PRINTER yolu)")
	}
	p, err := OpenPrinter("Microsoft Print to PDF")
	if err != nil {
		report(t, "(c) Microsoft Print to PDF: yazıcı yok — SKIP")
		t.Skip("Microsoft Print to PDF yok")
	}
	defer p.Close()
	w, h, ok := p.Target()
	if !ok {
		t.Fatal("yazdırılabilir alan okunamadı")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := roInit(); err != nil {
		t.Fatal(err)
	}
	defer roUninit()
	doc, err := loadPDF(k0PDF)
	if err != nil {
		t.Fatal(err)
	}
	defer doc.close()
	var pages []*Bitmap
	for i := uint32(0); i < doc.pages; i++ {
		bm, err := doc.render(i, w, h)
		if err != nil {
			t.Fatal(err)
		}
		pages = append(pages, bm)
	}
	out := filepath.Join(t.TempDir(), "k0-cikti.pdf")
	if err := p.Print(pages, out); err != nil {
		report(t, fmt.Sprintf("(c) Microsoft Print to PDF: ÇALIŞMIYOR — %v", err))
		t.Fatal(err)
	}
	// Kuyruk eşzamansızdır: dosya EndDoc'tan sonra biriktirici tarafından yazılır.
	var data []byte
	for i := 0; i < 100; i++ {
		if data, err = os.ReadFile(out); err == nil && bytes.Contains(data, []byte("%%EOF")) {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if err != nil || !bytes.HasPrefix(data, []byte("%PDF")) {
		report(t, fmt.Sprintf("(c) Microsoft Print to PDF: çıktı dosyası yok/geçersiz (%v)", err))
		t.Fatalf("çıktı: %v", err)
	}
	report(t, fmt.Sprintf("(c) Microsoft Print to PDF: ÇALIŞIYOR (hedef %dx%d, 2 sayfa, %d bayt PDF)", w, h, len(data)))
}
