package dc

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"
)

func frame(idx uint16, seq uint32, payload []byte) []byte {
	b := make([]byte, ChunkHeaderBytes+len(payload))
	binary.BigEndian.PutUint16(b, idx)
	binary.BigEndian.PutUint32(b[2:], seq)
	copy(b[ChunkHeaderBytes:], payload)
	return b
}

func TestAC35AC56CtlValidMessages(t *testing.T) {
	sha := strings.Repeat("a", 64)
	ok := []string{
		`{"t":"annot.stroke","id":"s1","tool":"arrow","color":"red","pts":[[0,0],[1,1],[0.5,0.25]]}`,
		`{"t":"annot.laser","x":0.1,"y":1}`,
		`{"t":"annot.undo"}`, `{"t":"annot.clear","id":"s1"}`, `{"t":"ping"}`,
		`{"t":"file.offer","fid":"f1","idx":65535,"name":"..\\evil.exe","size":0,"sha256":"` + sha + `"}`,
		`{"t":"file.accept","fid":"f1"}`, `{"t":"file.result","fid":"f1","ok":false}`,
	}
	for _, s := range ok {
		if _, err := ParseCtl([]byte(s)); err != nil {
			t.Errorf("kabul edilmeliydi: %s", s)
		}
	}
}

func TestAC119CtlRejectsInvalidAndControl(t *testing.T) {
	sha := strings.Repeat("a", 64)
	bad := []string{
		`{"t":"control.request"}`, `{"t":"control.state","state":"GRANTED"}`, // DC'de control.* yok (G-09)
		// AC-264 / P22-G: DC `chat` tipi yok (sohbet yalnız WS) — eski geçerli biçim de bilinmeyen tip olarak düşer.
		`{"t":"chat","id":"m1","text":"Merhaba ğüşİ","ts":1700000000000}`,
		`{"t":"chat","id":"m1","text":"","ts":1}`,
		`{"t":"chat","id":"m1","text":"` + strings.Repeat("x", 2001) + `","ts":1}`,
		`{"t":"chat","id":"m1","text":"a","ts":1.5}`,
		`{"t":"chat","id":"m 1","text":"a","ts":1}`,
		`{"t":"chat","id":"m1","text":"a","ts":1,"html":"<b>"}`,
		`{"t":"chat","ID":"m1","text":"a","ts":1}`,
		`{"t":"annot.stroke","id":"s1","tool":"pen","color":"pink","pts":[[0,0]]}`,
		`{"t":"annot.stroke","id":"s1","tool":"pen","color":"red","pts":[]}`,
		`{"t":"annot.laser","x":1.01,"y":0}`,
		`{"t":"ping","id":null}`,
		`{"t":"file.offer","fid":"f1","idx":65536,"name":"a","size":1,"sha256":"` + sha + `"}`,
		`{"t":"file.offer","fid":"f1","idx":0,"name":"a","size":2147483649,"sha256":"` + sha + `"}`,
		`{"t":"file.offer","fid":"f1","idx":0,"name":"a","size":1,"sha256":"` + strings.ToUpper(sha) + `"}`,
		`{"t":"file.offer","fid":"f1","idx":0,"name":"a","size":1}`,
		`{"t":"file.result","fid":"f1"}`,
		`not json`, `[]`, `{"t":"chat","id":"m1","text":"` + strings.Repeat("a", CtlMaxBytes) + `","ts":1}`,
	}
	for _, s := range bad {
		if _, err := ParseCtl([]byte(s)); err == nil {
			t.Errorf("reddedilmeliydi: %.120s", s)
		}
	}
	// Yetenek filtresi
	if Allowed("file.offer", []string{"remote_control"}) || !Allowed("file.offer", []string{"file_transfer"}) || !Allowed("ping", nil) {
		t.Fatal("caps filtresi")
	}
}

func TestAC53MaxFileBytes(t *testing.T) {
	if MaxFileBytes(DefaultMaxFileMb) != 100*1024*1024 || MaxFileBytes(4096) != FileMaxBytesCap || MaxFileBytes(-1) != 0 {
		t.Fatal("MaxFileBytes")
	}
}

func TestAC54ReceiverVerifiesSizeAndSHA256(t *testing.T) {
	data := []byte(strings.Repeat("veri-", 5000))
	sum := sha256.Sum256(data)
	r := NewReceiver(int64(len(data)), MaxFileBytes(100))
	var seq uint32
	for off := 0; off < len(data); off += ChunkMaxPayload {
		end := min(off+ChunkMaxPayload, len(data))
		c, ok := DecodeChunk(frame(7, seq, data[off:end]))
		if !ok || c.FIDIndex != 7 || r.Add(c) != AddOK {
			t.Fatalf("parça %d", seq)
		}
		seq++
	}
	if !r.Verify(hex.EncodeToString(sum[:])) || r.Bytes() != int64(len(data)) {
		t.Fatal("doğru dosya doğrulanmalı")
	}
	if r.Verify(strings.Repeat("0", 64)) || r.Verify("zz") {
		t.Fatal("yanlış hash kabul edildi")
	}
}

func TestAC55ReceiverGuardBoundaries(t *testing.T) {
	// Beyan 10 bayt ama 11 gelir → exceeded (beyana güvenilmez).
	r := NewReceiver(10, 1<<20)
	if r.Add(Chunk{Seq: 0, Payload: make([]byte, 6)}) != AddOK || r.Add(Chunk{Seq: 1, Payload: make([]byte, 5)}) != AddExceeded {
		t.Fatal("beyan aşımı")
	}
	// Beyan büyük, tenant sınırı küçük → sınırda kesilir.
	r = NewReceiver(1<<30, 8)
	if r.Add(Chunk{Seq: 0, Payload: make([]byte, 9)}) != AddExceeded {
		t.Fatal("tenant sınırı")
	}
	// Sıra dışı seq ve eksik dosya.
	r = NewReceiver(4, 100)
	if r.Add(Chunk{Seq: 1, Payload: []byte{1}}) != AddOutOfOrder {
		t.Fatal("sıra dışı")
	}
	_ = r.Add(Chunk{Seq: 0, Payload: []byte{1, 2}})
	if r.Verify(strings.Repeat("a", 64)) {
		t.Fatal("eksik dosya doğrulanmamalı")
	}
	// Çerçeve sınırları.
	if _, ok := DecodeChunk(make([]byte, 5)); ok {
		t.Fatal("kısa çerçeve")
	}
	if _, ok := DecodeChunk(make([]byte, ChunkHeaderBytes+ChunkMaxPayload+1)); ok {
		t.Fatal("büyük çerçeve")
	}
	if c, ok := DecodeChunk(frame(0xFFFF, 0xFFFFFFFF, nil)); !ok || c.FIDIndex != 0xFFFF || c.Seq != 0xFFFFFFFF || len(c.Payload) != 0 {
		t.Fatal("başlık big-endian")
	}
}

func TestFileRepliesEncode(t *testing.T) {
	b, err := FileReply("file.reject", "f1")
	if err != nil || string(b) != `{"t":"file.reject","fid":"f1"}` {
		t.Fatalf("%s %v", b, err)
	}
	b, err = FileResult("f1", true)
	if err != nil || string(b) != `{"t":"file.result","fid":"f1","ok":true}` {
		t.Fatalf("%s %v", b, err)
	}
	if _, err := FileReply("file.offer", "f1"); err == nil {
		t.Fatal("file.offer yanıt tipi değil")
	}
	for _, s := range []string{`{"t":"file.reject","fid":"f1"}`, `{"t":"file.result","fid":"f1","ok":true}`} {
		if _, err := ParseCtl([]byte(s)); err != nil {
			t.Fatalf("kendi ürettiğimiz mesaj geçersiz: %s", s)
		}
	}
}
