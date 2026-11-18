package helper

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// AC-341 (mimari-p28u §r3.7): yardımcının tek pencere sınıfı göstergedir (r3: onay diyaloğu kaldırıldı). Paketin tüm
// dosyalarında (Windows dahil, test hariç) RegisterClass çağrılarının sınıf adı kümesi AST'den çözülür; üçüncü bir
// pencere sınıfı eklenemez. Sınıf adı değişmez/sabit dışı bir ifadeyse test kırmızıdır.
func TestAC431HelperWindowClassesOnlyIndicator(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	consts := map[string]string{}
	var calls []*ast.CallExpr
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			switch v := n.(type) {
			case *ast.ValueSpec:
				for i, id := range v.Names {
					if i < len(v.Values) {
						if lit, ok := v.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
							consts[id.Name], _ = strconv.Unquote(lit.Value)
						}
					}
				}
			case *ast.CallExpr:
				if sel, ok := v.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "RegisterClass" {
					calls = append(calls, v)
				}
			}
			return true
		})
	}
	set := map[string]bool{}
	for _, c := range calls {
		switch a := c.Args[0].(type) {
		case *ast.BasicLit:
			s, _ := strconv.Unquote(a.Value)
			set[s] = true
		case *ast.Ident:
			s, ok := consts[a.Name]
			if !ok {
				t.Fatalf("%s: sınıf adı sabite çözülemedi: %s", fset.Position(c.Pos()), a.Name)
			}
			set[s] = true
		default:
			t.Fatalf("%s: sınıf adı sabit değil", fset.Position(c.Pos()))
		}
	}
	var got []string
	for s := range set {
		got = append(got, s)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != "NoktaDestekGosterge" {
		t.Fatalf("pencere sınıfları %v; beklenen yalnız NoktaDestekGosterge", got)
	}
}

// D-P28u-1: yasak listesi UIPI ileti süzgecini (ChangeWindowMessageFilter ve Ex) kapsar.
func TestAC431BoundaryForbidsMessageFilter(t *testing.T) {
	for _, n := range []string{"ChangeWindowMessageFilter", "ChangeWindowMessageFilterEx"} {
		if !forbidden(n) {
			t.Errorf("%s yasak listesinde değil", n)
		}
	}
}
