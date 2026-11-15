package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

type fixture struct {
	Sanitize []struct {
		In  string `json:"in"`
		Out string `json:"out"`
	} `json:"sanitize"`
	Warning []struct {
		Name    string  `json:"name"`
		Warning Warning `json:"warning"`
	} `json:"warning"`
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "file-names.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Sanitize) == 0 || len(f.Warning) == 0 {
		t.Fatal("fixture boş")
	}
	return f
}

func TestAC117SanitizeMatchesContractsFixture(t *testing.T) {
	for _, c := range loadFixture(t).Sanitize {
		got := SanitizeFileName(c.In)
		if got != c.Out {
			t.Errorf("SanitizeFileName(%q) = %q, want %q", c.In, got, c.Out)
		}
		if !IsSanitized(got) {
			t.Errorf("%q idempotent değil", got)
		}
	}
}

func TestAC36WarningMatchesContractsFixture(t *testing.T) {
	for _, c := range loadFixture(t).Warning {
		if got := NameWarning(SanitizeFileName(c.Name)); got != c.Warning {
			t.Errorf("NameWarning(%q) = %q, want %q", c.Name, got, c.Warning)
		}
	}
}

func TestAC117InvalidUTF8AndLength(t *testing.T) {
	if got := SanitizeFileName("a\xffb.txt"); got != "ab.txt" {
		t.Fatalf("geçersiz UTF-8: %q", got)
	}
	long := strings.Repeat("ç", 300) + ".pdf"
	got := SanitizeFileName(long)
	if n := len([]rune(got)); n != NameMax || !strings.HasSuffix(got, ".pdf") {
		t.Fatalf("kısaltma: %d %q", n, got[len(got)-8:])
	}
}

func TestAC54AvailableNameNoOverwrite(t *testing.T) {
	taken := map[string]bool{"rapor.pdf": true, "rapor (1).pdf": true}
	got, err := AvailableName("rapor.pdf", func(n string) bool { return taken[n] })
	if err != nil || got != "rapor (2).pdf" {
		t.Fatalf("got %q %v", got, err)
	}
	if got, _ := AvailableName("README", func(string) bool { return false }); got != "README" {
		t.Fatalf("serbest ad değişmemeli: %q", got)
	}
	if got, _ := AvailableName("README", func(n string) bool { return n == "README" }); got != "README (1)" {
		t.Fatalf("uzantısız: %q", got)
	}
	longExt := "a." + strings.Repeat("x", extKeepMax) // uzantı (nokta dahil) > extKeepMax → bütün ad gövde sayılır
	if got, _ := AvailableName(longExt, func(n string) bool { return n == longExt }); got != longExt+" (1)" {
		t.Fatalf("uzun uzantı: %q", got)
	}
	if _, err := AvailableName("x.txt", func(string) bool { return true }); err == nil {
		t.Fatal("hepsi doluyken hata beklenirdi")
	}
	long := strings.Repeat("a", 251) + ".pdf"
	got, _ = AvailableName(long, func(n string) bool { return n == long })
	if len([]rune(got)) > NameMax || !strings.HasSuffix(got, " (1).pdf") {
		t.Fatalf("uzun ad çakışması: %d %q", len([]rune(got)), got)
	}
}

// S6-8: Go listesi contracts `DANGEROUS_EXT` (tek kaynak) ile birebir aynı olmalı.
func TestS68DangerousExtMatchesContracts(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "src", "files.ts"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)DANGEROUS_EXT[^=]*= new Set\(\[(.*?)\]\)`).FindSubmatch(b)
	if m == nil {
		t.Fatal("DANGEROUS_EXT bulunamadı")
	}
	var ts []string
	for _, q := range regexp.MustCompile(`"([a-z0-9-]+)"`).FindAllSubmatch(m[1], -1) {
		ts = append(ts, string(q[1]))
	}
	var gol []string
	for e := range dangerousExt {
		gol = append(gol, e)
	}
	sort.Strings(ts)
	sort.Strings(gol)
	if strings.Join(ts, " ") != strings.Join(gol, " ") {
		t.Fatalf("liste farklı:\ncontracts %v\ngo        %v", ts, gol)
	}
	for _, e := range []string{"one", "wsc", "sct", "diagcab", "website"} {
		if !IsDangerousExtension("a." + e) {
			t.Errorf("%s tehlikeli sayılmalı", e)
		}
	}
}
