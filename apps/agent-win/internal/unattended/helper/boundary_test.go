package helper

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// AC-341 / Y-P27-3 m.4 (mimari-p27 §5.2): yardımcının Windows bağımlılık kümesinde URL/e-posta açma, ileti kutusu,
// dosya seçici ve ShellExecute kullanımı yoktur. `go list -deps` (GOOS=windows) + go/ast taraması; yasak paketler hiç
// içe aktarılmaz. internal/win bu işlevleri TANIMLAR (P20 arayüzü için); tanımın kendisi kullanım sayılmaz, kümedeki
// herhangi bir çağrı/başvuru sayılır.

const module = "remote-support/agent-win/"

var forbiddenPkgs = []string{
	module + "internal/ui", module + "internal/tray", module + "internal/request", module + "internal/launch",
	module + "internal/servis", module + "internal/servisui", module + "internal/autorun", "os/exec",
	// P28d O-PD-3: gözetimsiz yardımcıda ses motoru (mikrofon/WASAPI) ve wasm çalışma zamanı kurulmaz.
	module + "internal/voice", "github.com/tetratelabs/wazero",
}

// forbiddenNames başvurusu yasak tanımlayıcılar (seçici ya da yalın ad) ve dize önekleri (NewProc adları).
var forbiddenNames = []string{"MessageBox", "OpenURL", "OpenMailto", "ShellExecute", "GetOpenFileName",
	"GetSaveFileName", "SHBrowseForFolder", "FileOpenDialog", "FileSaveDialog", "pMessageBoxW", "pShellExecuteW",
	// P28u D-P28u-1: UIPI'yi delen ileti süzgeci (önek eşleşmesi Ex sürümünü de kapsar).
	"ChangeWindowMessageFilter"}

// winDefinitions internal/win'deki izinli tanımlar (gövdeleri taranmaz; başka yerden başvuru yasak).
var winDefinitions = map[string]bool{"MessageBox": true, "OpenURL": true, "OpenMailto": true,
	"pMessageBoxW": true, "pShellExecuteW": true}

func forbidden(s string) bool {
	for _, f := range forbiddenNames {
		if strings.HasPrefix(s, f) {
			return true
		}
	}
	return false
}

type depPkg struct{ path, dir, files string }

func windowsDeps(t *testing.T) []depPkg {
	t.Helper()
	cmd := exec.Command("go", "list", "-deps", "-f", "{{.ImportPath}}|{{.Dir}}|{{join .GoFiles \",\"}}", ".")
	cmd.Env = append(os.Environ(), "GOOS=windows", "GOARCH=amd64", "CGO_ENABLED=0")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	var pkgs []depPkg
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		p := strings.SplitN(line, "|", 3)
		pkgs = append(pkgs, depPkg{p[0], p[1], p[2]})
	}
	return pkgs
}

func TestAC341HelperDependencyBoundary(t *testing.T) {
	pkgs := windowsDeps(t)
	seen := map[string]bool{}
	for _, p := range pkgs {
		seen[p.path] = true
		for _, f := range forbiddenPkgs {
			if p.path == f || (strings.HasPrefix(p.path, f+"/") && p.path != module+"internal/servis/helperio") {
				t.Errorf("yasak paket bağımlılıkta: %s", p.path)
			}
		}
		if !strings.HasPrefix(p.path, module) {
			continue
		}
		for _, name := range strings.Split(p.files, ",") {
			if name != "" {
				scanFile(t, filepath.Join(p.dir, name), p.path == module+"internal/win")
			}
		}
	}
	for _, must := range []string{module + "internal/flow", module + "internal/capture", module + "internal/win"} {
		if !seen[must] {
			t.Fatalf("tarama eksik: %s kümede yok (go list çıktısı hatalı?)", must)
		}
	}
}

func scanFile(t *testing.T, path string, winPkg bool) {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range nodes(f, winPkg) {
		ast.Inspect(n, func(n ast.Node) bool {
			switch v := n.(type) {
			case *ast.Ident:
				if forbidden(v.Name) {
					t.Errorf("%s: yasak başvuru %s", path, v.Name)
				}
			case *ast.BasicLit:
				if v.Kind == token.STRING && forbidden(strings.Trim(v.Value, "\"`")) {
					t.Errorf("%s: yasak dize %s", path, v.Value)
				}
			}
			return true
		})
	}
}

// nodes taranacak düğümler. internal/win'de izinli tanımlar (listedeki adlı işlev ve yalnız listedeki adı tanımlayan
// var belirtimi) atlanır; aynı bloktaki diğer belirtimler taranır.
func nodes(f *ast.File, winPkg bool) []ast.Node {
	var out []ast.Node
	for _, d := range f.Decls {
		switch v := d.(type) {
		case *ast.FuncDecl:
			if winPkg && v.Recv == nil && winDefinitions[v.Name.Name] {
				continue
			}
			out = append(out, v)
		case *ast.GenDecl:
			for _, s := range v.Specs {
				if vs, ok := s.(*ast.ValueSpec); ok && winPkg && v.Tok == token.VAR && len(vs.Names) == 1 &&
					winDefinitions[vs.Names[0].Name] {
					continue
				}
				out = append(out, s)
			}
		}
	}
	return out
}

// P28d O-PD-3: gözetimsiz yardımcının (servis ikilisi) bağımlılık kümesinde ses motoru ve wazero yok; müşteri istemcisinde
// var (pozitif denetim: yasak yol adı doğru — ad değişirse yasak sessizce boşa düşmesin).
func TestP28dBoundaryHelperHasNoVoice(t *testing.T) {
	voicePkg := module + "internal/voice"
	for _, p := range windowsDeps(t) {
		if p.path == voicePkg || strings.HasPrefix(p.path, "github.com/tetratelabs/wazero") {
			t.Fatalf("yardımcıda ses motoru: %s", p.path)
		}
	}
	cmd := exec.Command("go", "list", "-buildvcs=false", "-deps", module+"cmd/noktadestek") // ana paket: CI konteynerinde VCS damgası (dubious ownership) go list'i düşürür
	cmd.Env = append(os.Environ(), "GOOS=windows", "GOARCH=amd64", "CGO_ENABLED=0")
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			t.Fatalf("go list: %v: %s", err, ee.Stderr)
		}
		t.Fatalf("go list: %v", err)
	}
	deps := strings.Fields(string(out))
	for _, must := range []string{voicePkg, "github.com/tetratelabs/wazero"} {
		found := false
		for _, d := range deps {
			found = found || d == must
		}
		if !found {
			t.Fatalf("müşteri istemcisinde %s yok — yasak listesindeki yol güncel mi?", must)
		}
	}
}
