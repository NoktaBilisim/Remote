package printing

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// r2 O-P28a-3 + D-P28a-3 sınır testleri: üst süreç işleyici çıktısını güvenilmeyen girdi sayar. Sahte işleyici
// borunun öbür ucunda istenen ham çerçeveyi yazar; Worker reddetmeli ve işleyiciyi durdurmalıdır.

type fakeWorker struct {
	w      *Worker
	killed atomic.Bool
}

// startFake her isteğe reply(istek) baytlarını yazan sahte işleyici; reply nil dönerse yanıt vermez (asılı kalır).
func startFake(t *testing.T, reply func(Request) []byte) *fakeWorker {
	t.Helper()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	f := &fakeWorker{}
	f.w = newWorker(inW, outR, func(time.Duration) uint32 {
		f.killed.Store(true)
		_ = inR.Close()
		_ = outW.Close()
		return 0
	}, 0)
	go func() {
		for {
			q, err := ReadRequest(inR)
			if err != nil {
				return
			}
			if b := reply(q); b != nil {
				if _, err := outW.Write(b); err != nil {
					return
				}
			}
		}
	}()
	t.Cleanup(func() { f.w.Close() })
	return f
}

func frame(st byte, a, b, c, n uint32, payload []byte) []byte {
	h := make([]byte, headerLen)
	h[0] = st
	le := binary.LittleEndian
	le.PutUint32(h[1:], a)
	le.PutUint32(h[5:], b)
	le.PutUint32(h[9:], c)
	le.PutUint32(h[13:], n)
	return append(h, payload...)
}

// inspected iki sayfalık belge açmış sahte işleyici; render/size yanıtları bad'den gelir.
func inspected(t *testing.T, bad func(Request) []byte) *fakeWorker {
	t.Helper()
	f := startFake(t, func(q Request) []byte {
		if q.Op == OpInspect {
			return frame(StatusOK, 2, 0, 0, 0, nil)
		}
		return bad(q)
	})
	if n, err := f.w.Inspect(context.Background(), []byte("%PDF-1.7")); n != 2 || err != nil {
		t.Fatalf("inspect = %d %v", n, err)
	}
	return f
}

func TestP28aBoundaryRenderFramesRejected(t *testing.T) {
	const w, h = 10, 4
	good := Stride(w) * h
	cases := map[string]func(Request) []byte{
		"dev önek (4 GiB)":    func(Request) []byte { return frame(StatusOK, w, h, Stride(w), 0xFFFFFFFF, nil) },
		"önek 64 MiB + 1":     func(Request) []byte { return frame(StatusOK, w, h, Stride(w), MaxFrameBytes+1, nil) },
		"önek hedeften büyük": func(Request) []byte { return frame(StatusOK, w, h, Stride(w), good+4, make([]byte, good+4)) },
		"önek hedeften küçük": func(Request) []byte { return frame(StatusOK, w, h, Stride(w), good-4, make([]byte, good-4)) },
		"başka boyut": func(Request) []byte {
			return frame(StatusOK, w*2, h, Stride(w*2), Stride(w*2)*h, make([]byte, Stride(w*2)*h))
		},
		"stride hizasız":     func(Request) []byte { return frame(StatusOK, w, h, w*3, w*3*h, make([]byte, w*3*h)) },
		"bilinmeyen durum":   func(Request) []byte { return frame(9, 0, 0, 0, 0, nil) },
		"hata + yük":         func(Request) []byte { return frame(StatusError, 0, 0, 0, 1, []byte{1}) },
		"kesik başlık":       func(Request) []byte { return []byte{StatusOK, 1, 2} },
		"yük yarıda kesildi": func(Request) []byte { return frame(StatusOK, w, h, Stride(w), good, make([]byte, 7)) },
	}
	for name, bad := range cases {
		t.Run(name, func(t *testing.T) {
			f := inspected(t, func(q Request) []byte {
				if q.Op == OpPageSize {
					return frame(StatusOK, 600, 800, 0, 0, nil)
				}
				return bad(q)
			})
			if name == "kesik başlık" || name == "yük yarıda kesildi" {
				// yanıt eksik kalır: işleyici ölünce (zaman aşımı) EOF; hızlı olsun diye son tarihi kısalt
				f.w.deadline = time.Now().Add(200 * time.Millisecond)
			}
			bm, err := f.w.Render(context.Background(), 0, w, h)
			if err == nil || bm != nil {
				t.Fatalf("kabul edildi: %+v", bm)
			}
			if !f.killed.Load() {
				t.Fatal("işleyici durdurulmadı")
			}
			if _, err := f.w.Render(context.Background(), 1, w, h); !errors.Is(err, ErrWorker) {
				t.Fatalf("durmuş işleyiciyle istek: %v", err)
			}
		})
	}
}

func TestP28aBoundaryInspectAndSizeRejected(t *testing.T) {
	inspectCases := map[string][]byte{
		"sayfa 0":           frame(StatusOK, 0, 0, 0, 0, nil),
		"sayfa 100001":      frame(StatusOK, MaxPages+1, 0, 0, 0, nil),
		"inspect yük taşır": frame(StatusOK, 2, 0, 0, 4, []byte{1, 2, 3, 4}),
	}
	for name, raw := range inspectCases {
		f := startFake(t, func(Request) []byte { return raw })
		if n, err := f.w.Inspect(context.Background(), []byte("%PDF-1.7")); err == nil || n != 0 {
			t.Errorf("%s: kabul edildi (%d)", name, n)
		}
	}
	sizeCases := map[string][]byte{
		"sıfır kenar":    frame(StatusOK, 0, 10, 0, 0, nil),
		"dev kenar":      frame(StatusOK, MaxPageDIP+1, 10, 0, 0, nil),
		"c alanı dolu":   frame(StatusOK, 10, 10, 1, 0, nil),
		"size yük taşır": frame(StatusOK, 10, 10, 0, 2, []byte{0, 0}),
	}
	for name, raw := range sizeCases {
		f := inspected(t, func(Request) []byte { return raw })
		if _, _, err := f.w.PageSize(context.Background(), 0); !errors.Is(err, ErrProtocol) || !f.killed.Load() {
			t.Errorf("%s: %v, durduruldu=%v", name, err, f.killed.Load())
		}
	}
}

// Render/size yalnız inspect'in döndürdüğü dizinler ve geçerli hedef için istenir; istek işleyiciye hiç gitmez.
func TestP28aBoundaryParentLimits(t *testing.T) {
	var sent atomic.Int32
	f := inspected(t, func(Request) []byte { sent.Add(1); return frame(StatusError, 0, 0, 0, 0, nil) })
	ctx := context.Background()
	if _, err := f.w.Render(ctx, 2, 10, 10); !errors.Is(err, ErrProtocol) {
		t.Errorf("dizin 2: %v", err)
	}
	if _, _, err := f.w.PageSize(ctx, 5); !errors.Is(err, ErrProtocol) {
		t.Errorf("size dizin 5: %v", err)
	}
	if _, err := f.w.Render(ctx, 0, 8000, 6000); !errors.Is(err, ErrProtocol) { // 48 Mpx > 40 Mpx
		t.Errorf("40 Mpx üstü: %v", err)
	}
	if sent.Load() != 0 || f.killed.Load() {
		t.Fatalf("geçersiz istek işleyiciye gitti (%d)", sent.Load())
	}
	if _, err := f.w.Inspect(ctx, make([]byte, MaxPDFBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Errorf("20 MiB üstü PDF: %v", err)
	}
	if _, err := f.w.Inspect(ctx, nil); !errors.Is(err, ErrInvalidPDF) {
		t.Errorf("boş PDF: %v", err)
	}
}

func TestP28aBoundaryTimeoutAndCancelKillWorker(t *testing.T) {
	f := inspected(t, func(Request) []byte { return nil }) // asılı işleyici
	f.w.deadline = time.Now().Add(100 * time.Millisecond)
	start := time.Now()
	if _, err := f.w.Render(context.Background(), 0, 10, 10); !errors.Is(err, ErrWorker) || !f.killed.Load() {
		t.Fatalf("zaman aşımı: %v durduruldu=%v", err, f.killed.Load())
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("zaman aşımı geç")
	}

	g := inspected(t, func(Request) []byte { return nil })
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	if _, err := g.w.Render(ctx, 0, 10, 10); !errors.Is(err, ErrCancelled) || !g.killed.Load() {
		t.Fatalf("iptal: %v durduruldu=%v", err, g.killed.Load())
	}
}

// Geçersiz PDF işleyiciyi durdurmaz (kullanıcı hatası; aynı işleyici kapanır), hata durumu durdurur.
func TestP28aBoundaryInvalidPDFKeepsWorker(t *testing.T) {
	f := startFake(t, func(Request) []byte { return frame(StatusInvalidPDF, 0, 0, 0, 0, nil) })
	if _, err := f.w.Inspect(context.Background(), []byte("x")); !errors.Is(err, ErrInvalidPDF) || f.killed.Load() {
		t.Fatalf("%v durduruldu=%v", err, f.killed.Load())
	}
}

// lpFile P28f (mimari-p28f §2): CUPS `lp` çağrısı bu pakettedir (darwin || linux; Windows işleyici ikilisine girmez).
const lpFile = "lp_unix.go"

// P28f K5 (S-P28f-16): os/exec istisnası tek dosyada ve tek komutta — lp_unix.go'da exec yalnız lpPath/lpArgs ile çağrılır,
// lpPath başlangıç değeri mutlak /usr/bin/lp, kabuk yok; dosya Windows'ta derlenmez.
func TestP28fBoundaryLPOnlyExec(t *testing.T) {
	src, err := os.ReadFile(lpFile)
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ReplaceAll(string(src), "\r\n", "\n") // Windows checkout'u (autocrlf) satır sonundan bağımsız
	if !strings.HasPrefix(s, "//go:build darwin || linux\n") {
		t.Fatal("lp_unix.go build kısıtı darwin || linux olmalı")
	}
	if strings.Count(s, "exec.Command") != 1 || !strings.Contains(s, "exec.CommandContext(ctx, lpPath, lpArgs...)") ||
		!strings.Contains(s, `var lpPath = "/usr/bin/lp"`) {
		t.Fatal("lp_unix.go yalnız sabit lp komutunu çalıştırmalı")
	}
	f, err := parser.ParseFile(token.NewFileSet(), lpFile, src, 0)
	if err != nil {
		t.Fatal(err)
	}
	ast.Inspect(f, func(n ast.Node) bool { // dize sabitlerinde kabuk, lpstat, -d yok
		if lit, ok := n.(*ast.BasicLit); ok && lit.Kind == token.STRING {
			v, _ := strconv.Unquote(lit.Value)
			if strings.Contains(v, "sh") && v != "-" || strings.Contains(v, "lpstat") || v == "-d" {
				t.Errorf("lp_unix.go yasak dize: %q", v)
			}
		}
		return true
	})
}

// D-P28a-3 + §5.2: paket üretim kodunda süreç açma, dosya yazma/açma, ağ ve kabuk çağrısı yoktur (işleyici aynı
// pakettedir). Süreç başlatma yalnız internal/proclimit üzerinden.
func TestP28aBoundaryForbiddenSymbols(t *testing.T) {
	forbiddenImports := []string{"net", "net/", "os/exec", "syscall/js"}
	forbiddenIdents := []string{"ShellExecute", "CreateProcess", "CreateFile", "WinExec", "LoadLibrary"}
	forbiddenCalls := [][2]string{{"os", "Create"}, {"os", "WriteFile"}, {"os", "OpenFile"}, {"os", "Open"},
		{"os", "CreateTemp"}, {"os", "MkdirTemp"}, {"os", "Getenv"}, {"log", "Printf"}, {"fmt", "Printf"}, {"fmt", "Println"}}
	files, err := filepath.Glob("*.go")
	if err != nil || len(files) == 0 {
		t.Fatal("kaynak yok")
	}
	for _, p := range files {
		if strings.HasSuffix(p, "_test.go") {
			continue
		}
		src, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		f, err := parser.ParseFile(token.NewFileSet(), p, src, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, im := range f.Imports {
			path, _ := strconv.Unquote(im.Path.Value)
			if path == "os/exec" && p == lpFile {
				continue // P28f K5: yalnız lp_unix.go, yalnız sabit /usr/bin/lp (TestP28fBoundaryLPOnlyExec)
			}
			for _, bad := range forbiddenImports {
				if path == bad || (strings.HasSuffix(bad, "/") && strings.HasPrefix(path, bad)) {
					t.Errorf("%s: yasak içe aktarma %s", p, path)
				}
			}
		}
		for _, bad := range forbiddenIdents {
			if bytes.Contains(src, []byte(`"`+bad)) || bytes.Contains(src, []byte("."+bad)) {
				t.Errorf("%s: yasak sembol %s", p, bad)
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			c, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := c.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok {
				for _, fc := range forbiddenCalls {
					if id.Name == fc[0] && sel.Sel.Name == fc[1] {
						t.Errorf("%s: yasak çağrı %s.%s", p, fc[0], fc[1])
					}
				}
			}
			return true
		})
	}
}
