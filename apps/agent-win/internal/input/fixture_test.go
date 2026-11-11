package input

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestAC101InputMatchesContractsFixture Go şeması `packages/contracts/fixtures/dc-input.json` ile birebir.
func TestAC101InputMatchesContractsFixture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "dc-input.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Valid   []json.RawMessage `json:"valid"`
		Invalid []json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Valid) == 0 || len(f.Invalid) == 0 {
		t.Fatal("fixture boş")
	}
	for _, raw := range f.Valid {
		if _, err := Parse(raw); err != nil {
			t.Errorf("geçerli reddedildi: %s", raw)
		}
	}
	for _, raw := range f.Invalid {
		if _, err := Parse(raw); err == nil {
			t.Errorf("geçersiz kabul edildi: %s", raw)
		}
	}
}
