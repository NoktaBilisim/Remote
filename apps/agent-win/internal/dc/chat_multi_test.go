package dc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// AC-264 / P22-G (mimari-p22 §4.4): DC `chat` misafirde tanınmaz — P28c fikstüründeki (`multi.json`; TS tarafı eski
// misafir tespiti için hâlâ tanır) geçerli ve geçersiz DC sohbet çerçevelerinin HİÇBİRİ kabul edilmez (bilinmeyen tip
// düşer, kanal açık kalır — rtc.handleCtl).
func TestAC264P22GDCChatNotRecognized(t *testing.T) {
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
	all := append(f.Valid["dcChat"], f.Invalid["dcChat"]...)
	if len(all) == 0 {
		t.Fatal("fikstürde dcChat örneği yok")
	}
	for _, raw := range all {
		if _, err := ParseCtl(raw); err == nil {
			t.Errorf("DC chat kabul edildi: %s", raw)
		}
	}
}
