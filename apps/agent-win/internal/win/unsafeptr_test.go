package win

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// uintptrescapes işaretli çağrılar: argümanlarındaki işaretçi dönüşümleri çağrı bitene kadar canlı tutulur.
var keepAliveCalls = map[string]bool{"Call": true, "call": true, "procHR": true, "SyscallN": true}

// uintptrescapes işaretli olması zorunlu yerel sarmalayıcılar (capture/com_windows.go).
var mustEscape = map[string]bool{"call": true, "procHR": true}

func isPtrToUintptr(e ast.Expr) bool {
	c, ok := e.(*ast.CallExpr)
	if !ok || len(c.Args) != 1 {
		return false
	}
	if id, ok := c.Fun.(*ast.Ident); !ok || id.Name != "uintptr" {
		return false
	}
	in, ok := c.Args[0].(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := in.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Pointer" {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "unsafe"
}

func calleeName(f ast.Expr) string {
	switch x := f.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.SelectorExpr:
		return x.Sel.Name
	}
	return ""
}

// S6-1: `uintptr(unsafe.Pointer(…))` yalnız uintptrescapes işaretli çağrının doğrudan argümanında olabilir.
// Tek istisna comObj.call içindeki alıcı (COM nesnesi Go belleği değildir ve parametre olarak canlıdır).
func TestS61PointerConversionOnlyInsideCallArgs(t *testing.T) {
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	checked := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if err != nil {
			return err
		}
		allowed := map[ast.Expr]bool{}
		for _, decl := range f.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			if mustEscape[fd.Name.Name] && filepath.Base(path) == "com_windows.go" {
				if fd.Doc == nil || !strings.Contains(commentsRaw(fd.Doc), "//go:uintptrescapes") {
					t.Errorf("%s: %s //go:uintptrescapes işaretli değil", path, fd.Name.Name)
				}
				if fd.Name.Name == "call" {
					ast.Inspect(fd.Body, func(n ast.Node) bool {
						if e, ok := n.(ast.Expr); ok && isPtrToUintptr(e) {
							allowed[e] = true
						}
						return true
					})
				}
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			c, ok := n.(*ast.CallExpr)
			if !ok || !keepAliveCalls[calleeName(c.Fun)] {
				return true
			}
			for _, a := range c.Args {
				if isPtrToUintptr(a) {
					allowed[a] = true
				}
			}
			return true
		})
		ast.Inspect(f, func(n ast.Node) bool {
			if e, ok := n.(ast.Expr); ok && isPtrToUintptr(e) {
				checked++
				if !allowed[e] {
					t.Errorf("%s: uintptr(unsafe.Pointer(…)) çağrı argümanı dışında (S6-1)", fset.Position(e.Pos()))
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked == 0 {
		t.Fatal("hiç dönüşüm bulunamadı; tarama kökü yanlış")
	}
}

func commentsRaw(g *ast.CommentGroup) string {
	var b strings.Builder
	for _, c := range g.List {
		b.WriteString(c.Text)
	}
	return b.String()
}
