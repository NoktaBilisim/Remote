package dc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// P28c (mimari-p28c §4.5, D-PC-4): `by` yalnız misafir → teknisyen yönünde; misafirin gelen sohbet ayrıştırıcısı
// (teknisyenden gelen) `by`'ı ve ad taşıyan alanları reddeder. Fikstür `packages/contracts/fixtures/multi.json`.
func TestP28cInboundChatRejectsBy(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "multi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Valid   map[string][]json.RawMessage `json:"valid"`
		Invalid map[string][]json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	for _, raw := range append(f.Valid["dcChat"], f.Invalid["dcChat"]...) {
		var probe map[string]json.RawMessage
		_ = json.Unmarshal(raw, &probe)
		_, hasBy := probe["by"]
		_, hasByName := probe["byName"]
		_, err := ParseCtl(raw)
		if want := !hasBy && !hasByName; (err == nil) != want {
			t.Errorf("%s: kabul=%v, beklenen %v", raw, err == nil, want)
		}
	}
}
