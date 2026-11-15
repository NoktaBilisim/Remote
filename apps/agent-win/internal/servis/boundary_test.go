package servis

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// AC-341: tüm kiplerde ilk iş güvenli DLL arama yolu — `main`'in ilk deyimi dllsafe.Harden çağrısı.
func TestAC341MainFirstCallIsDllsafe(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), filepath.Join("..", "..", "cmd", "noktadestek-servis", "main.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var body []ast.Stmt
	for _, d := range f.Decls {
		if fn, ok := d.(*ast.FuncDecl); ok && fn.Name.Name == "main" && fn.Recv == nil {
			body = fn.Body.List
		}
	}
	if len(body) == 0 {
		t.Fatal("main bulunamadı")
	}
	ifs, ok := body[0].(*ast.IfStmt)
	if !ok || ifs.Init == nil {
		t.Fatal("main'in ilk deyimi `if err := dllsafe.Harden(); …` değil")
	}
	as, ok := ifs.Init.(*ast.AssignStmt)
	if !ok || len(as.Rhs) != 1 || !isCall(as.Rhs[0], "dllsafe", "Harden") {
		t.Fatal("main'in ilk çağrısı dllsafe.Harden değil")
	}
}

func isCall(e ast.Expr, pkg, name string) bool {
	c, ok := e.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := c.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	return ok && id.Name == pkg && sel.Sel.Name == name
}

// AC-340 / D-P27-2: sunucu adresi yalnız derlemede gömülüdür; TLS doğrulaması atlanamaz. internal/servis,
// internal/unattended (K6, varsa) ve cmd/noktadestek-servis kaynaklarında InsecureSkipVerify ve ortam değişkeni
// okuması yoktur.
func TestAC340NoEnvURLOrInsecureTLS(t *testing.T) {
	roots := []string{".", filepath.Join("..", "unattended"), filepath.Join("..", "..", "cmd", "noktadestek-servis")}
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			continue
		}
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
				return err
			}
			scanForbidden(t, p)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func scanForbidden(t *testing.T, path string) {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	ast.Inspect(f, func(n ast.Node) bool {
		switch v := n.(type) {
		case *ast.Ident:
			if v.Name == "InsecureSkipVerify" {
				t.Errorf("%s: InsecureSkipVerify", path)
			}
		case *ast.CallExpr:
			for _, fn := range [][2]string{{"os", "Getenv"}, {"os", "LookupEnv"}, {"os", "Environ"}, {"syscall", "Getenv"}} {
				if isCall(v, fn[0], fn[1]) {
					t.Errorf("%s: %s.%s", path, fn[0], fn[1])
				}
			}
		}
		return true
	})
}
