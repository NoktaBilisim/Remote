package dc

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type clipPrintFixture struct {
	Constants map[string]json.RawMessage   `json:"constants"`
	Valid     map[string][]json.RawMessage `json:"valid"`
	Invalid   map[string][]json.RawMessage `json:"invalid"`
	Texts     []struct {
		Name   string `json:"name"`
		Text   string `json:"text"`
		Bytes  int    `json:"bytes"`
		Chunks []struct {
			Seq  int    `json:"seq"`
			Last bool   `json:"last"`
			B64  string `json:"b64"`
		} `json:"chunks"`
	} `json:"texts"`
}

func loadClipPrint(t *testing.T) clipPrintFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "clip-print.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f clipPrintFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestAC345P28aCtlMatchesFixture(t *testing.T) {
	f := loadClipPrint(t)
	for _, raw := range f.Valid["dc"] {
		if _, err := ParseCtl(raw); err != nil {
			t.Errorf("geçerli ctl reddedildi: %s", raw)
		}
	}
	for _, raw := range f.Invalid["dc"] {
		if _, err := ParseCtl(raw); err == nil {
			t.Errorf("geçersiz ctl kabul edildi: %.160s", raw)
		}
	}
	nums := map[string]int{"CLIP_MAX_BYTES": ClipMaxBytes, "CLIP_CHUNK_BYTES": ClipChunkBytes,
		"CLIP_MAX_CHUNKS": ClipMaxChunks, "CLIP_CHUNK_B64_MAX": ClipChunkB64Max, "PRINT_MAX_BYTES": PrintMaxBytes,
		"PRINT_MIN_BYTES": PrintMinBytes}
	for k, want := range nums {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s = %s, Go %d", k, f.Constants[k], want)
		}
	}
	var magic string
	_ = json.Unmarshal(f.Constants["PDF_MAGIC"], &magic)
	if magic != PDFMagic {
		t.Errorf("PDF_MAGIC %q", magic)
	}
}

// AC-345: iki yönde birebir — Go parçalama fikstürle aynı base64'ü üretir, birleştirme metni geri verir.
func TestAC345P28aClipTextsRoundTrip(t *testing.T) {
	f := loadClipPrint(t)
	const cid = "aZ3_x-Q9LmN0pR7sT2uV1w"
	for _, tx := range f.Texts {
		if len(tx.Text) != tx.Bytes {
			t.Fatalf("%s: fikstür bayt %d ≠ %d", tx.Name, tx.Bytes, len(tx.Text))
		}
		frames, err := ClipChunks(cid, []byte(tx.Text))
		if err != nil || len(frames) != len(tx.Chunks) {
			t.Fatalf("%s: %d parça, %v", tx.Name, len(frames), err)
		}
		asm := NewClipAssembler(tx.Bytes)
		for i, fr := range frames {
			m, err := ParseCtl(fr)
			if err != nil {
				t.Fatalf("%s: üretilen parça geçersiz: %v", tx.Name, err)
			}
			want := tx.Chunks[i]
			if *m.Seq != want.Seq || *m.Last != want.Last || m.B64 != want.B64 {
				t.Errorf("%s parça %d farklı", tx.Name, i)
			}
			text, done, err := asm.Add(m)
			if err != nil || done != want.Last {
				t.Fatalf("%s parça %d: done=%v err=%v", tx.Name, i, done, err)
			}
			if done && string(text) != tx.Text {
				t.Errorf("%s: metin birebir değil", tx.Name)
			}
		}
		asm.Wipe()
	}
}

func clipData(seq int, last bool, b64 string) Ctl {
	return Ctl{T: "clip.data", CID: "aZ3_x-Q9LmN0pR7sT2uV1w", Seq: &seq, Last: &last, B64: b64}
}

func TestAC345P28aClipAssemblerRejects(t *testing.T) {
	cases := map[string]func() error{
		"sıra atlama": func() error { _, _, err := NewClipAssembler(1).Add(clipData(1, true, "YQ==")); return err },
		"beyan dışı toplam": func() error {
			_, _, err := NewClipAssembler(2).Add(clipData(0, true, "YQ=="))
			return err
		},
		"beyanı aşan": func() error { _, _, err := NewClipAssembler(1).Add(clipData(0, false, "YWE=")); return err },
		"U+0000":      func() error { _, _, err := NewClipAssembler(1).Add(clipData(0, true, "AA==")); return err },
		"geçersiz UTF-8": func() error {
			_, _, err := NewClipAssembler(1).Add(clipData(0, true, "/w=="))
			return err
		},
	}
	for name, f := range cases {
		if err := f(); !errors.Is(err, ErrClipInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := ClipChunks("aZ3_x-Q9LmN0pR7sT2uV1w", nil); err == nil {
		t.Error("boş metin parçalanmamalı")
	}
	if _, err := ClipChunks("aZ3_x-Q9LmN0pR7sT2uV1w", make([]byte, ClipMaxBytes+1)); err == nil {
		t.Error("64 KB üstü parçalanmamalı")
	}
}

func TestAC348P28aCapsFilter(t *testing.T) {
	for _, tc := range []struct {
		t    string
		caps []string
		want bool
	}{
		{"clip.data", []string{"remote_control"}, false},
		{"clip.data", []string{"clipboard"}, true},
		{"print.offer", []string{"file_transfer"}, false}, // print, file_transfer'dan bağımsız (§4.1)
		{"print.offer", []string{"print"}, true},
		{"file.offer", []string{"print"}, false},
		{"ping", nil, true},
	} {
		if got := Allowed(tc.t, tc.caps); got != tc.want {
			t.Errorf("Allowed(%s, %v) = %v", tc.t, tc.caps, got)
		}
	}
	if b, err := ClipReady("kisa"); err == nil {
		t.Errorf("geçersiz cid ile üretildi: %s", b)
	}
	if b, err := PrintReady("Pq8-Zx_4KdLm2Nb7Vc1Ty0"); err != nil || string(b) != `{"pid":"Pq8-Zx_4KdLm2Nb7Vc1Ty0","t":"print.ready"}` {
		t.Errorf("%s %v", b, err)
	}
}
