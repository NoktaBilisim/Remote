package dc

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"hash"
)

// `file` kanalı çerçevesi: fidIndex(uint16 BE) | seq(uint32 BE) | payload(≤ 16 KB) — mimari-protokol §4.2.
const (
	ChunkHeaderBytes = 6
	ChunkMaxPayload  = 16 * 1024
)

// Chunk çözülmüş çerçeve; Payload girdinin alt dilimidir (kopyalanmaz).
type Chunk struct {
	FIDIndex uint16
	Seq      uint32
	Payload  []byte
}

// DecodeChunk bozuk/aşırı büyük çerçevede false döner (alıcı transferi iptal eder).
func DecodeChunk(frame []byte) (Chunk, bool) {
	if len(frame) < ChunkHeaderBytes || len(frame) > ChunkHeaderBytes+ChunkMaxPayload {
		return Chunk{}, false
	}
	return Chunk{
		FIDIndex: binary.BigEndian.Uint16(frame[0:2]),
		Seq:      binary.BigEndian.Uint32(frame[2:6]),
		Payload:  frame[ChunkHeaderBytes:],
	}, true
}

// AddResult FileReceiveGuard.add sonucu.
type AddResult int

const (
	AddOK AddResult = iota
	AddExceeded
	AddOutOfOrder
)

// Receiver contracts `FileReceiveGuard` eşi + artımlı SHA-256: beyan edilen boyuta güvenilmez, sınır alınan bayt
// sayacıyla uygulanır (§4.2/5). Exceeded/OutOfOrder → çağıran transferi iptal eder ve `.part`'ı siler.
type Receiver struct {
	declared int64
	limit    int64
	received int64
	nextSeq  uint32
	h        hash.Hash
}

// NewReceiver offer.size ve tenant sınırı (bayt) ile.
func NewReceiver(declaredSize, maxBytes int64) *Receiver {
	return &Receiver{declared: declaredSize, limit: min(declaredSize, maxBytes), h: sha256.New()}
}

// Add parçayı sayar ve hash'e ekler. Sınır aşımında parça hash'e eklenmez.
func (r *Receiver) Add(c Chunk) AddResult {
	if c.Seq != r.nextSeq {
		return AddOutOfOrder
	}
	r.nextSeq++
	r.received += int64(len(c.Payload))
	if r.received > r.limit {
		return AddExceeded
	}
	r.h.Write(c.Payload)
	return AddOK
}

// Bytes alınan toplam bayt.
func (r *Receiver) Bytes() int64 { return r.received }

// Verify file.done sonrası: alınan = beyan ve SHA-256 eşleşiyor mu (AC-54). Beklenen değer küçük harf hex.
func (r *Receiver) Verify(expectedHex string) bool {
	if r.received != r.declared {
		return false
	}
	want, err := hex.DecodeString(expectedHex)
	if err != nil || len(want) != sha256.Size {
		return false
	}
	return subtle.ConstantTimeCompare(r.h.Sum(nil), want) == 1
}
