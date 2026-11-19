package update

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// §14.2: cmd/update-sign bu paketi içe aktarır ve imza işinde GOPROXY=off ile, bağımlılık kapanışında yalnız stdlib olacak
// biçimde derlenir. Platformdan bağımsız dosyalar yalnız stdlib içe aktarabilir.
func TestK3StdlibOnlyImports(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		// Platform dosyaları (_windows/_darwin/_linux) imza koşucusunun (linux) kapanışına girmez kuralı K6'nın
		// `go list -deps` adımı denetler; burada yalnız tüm platformlarda derlenen ortak dosyalar.
		if strings.HasSuffix(f, "_test.go") || strings.HasSuffix(f, "_windows.go") || strings.HasSuffix(f, "_darwin.go") ||
			strings.HasSuffix(f, "_linux.go") {
			continue
		}
		af, err := parser.ParseFile(token.NewFileSet(), f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range af.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			if first := strings.SplitN(p, "/", 2)[0]; strings.Contains(first, ".") || first == "remote-support" {
				t.Errorf("%s: %q stdlib değil (update-sign kapanışı yalnız stdlib olmalı)", f, p)
			}
		}
	}
}
