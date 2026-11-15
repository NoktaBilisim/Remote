// PT-K0 ölçüm yardımcısı (scripts/pt-olcum.sh çağırır; repoya bağımlılık eklemez, yalnız standart kütüphane).
// Go işlev uzunluğu: her `func` için gövde satır sayısı (ilk satır `func` … son `}` dahil) — go/ast, derleme etiketi
// gözetmeden tüm .go dosyaları. Çıktı (stdout, JSON): [{"file","name","lines","test"}].
// Kullanım (modül dışından): go run golen.go <kök-dizin>
package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type fn struct {
	File  string `json:"file"`
	Name  string `json:"name"`
	Lines int    `json:"lines"`
	Test  bool   `json:"test"`
}

func main() {
	root := os.Args[1]
	out := []fn{}
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") {
			return err
		}
		f, err := parser.ParseFile(fset, p, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		for _, decl := range f.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			name := fd.Name.Name
			if fd.Recv != nil && len(fd.Recv.List) > 0 {
				name = recvName(fd.Recv.List[0].Type) + "." + name
			}
			lines := fset.Position(fd.End()).Line - fset.Position(fd.Pos()).Line + 1
			out = append(out, fn{rel, name, lines, strings.HasSuffix(p, "_test.go")})
		}
		return nil
	})
	if err != nil {
		panic(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}

func recvName(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.StarExpr:
		return recvName(t.X)
	case *ast.IndexExpr:
		return recvName(t.X)
	case *ast.IndexListExpr:
		return recvName(t.X)
	case *ast.Ident:
		return t.Name
	}
	return "?"
}
