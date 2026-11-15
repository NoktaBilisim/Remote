package dc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"unicode/utf8"
)

// P28a pano + yazdırma `ctl` mesajları (mimari-p28 §4.4, r2 O-P28a-1/2; `packages/contracts/src/dc-clip-print.ts`).
// PDF baytları mevcut `file` kanalı çerçevesiyle (`fidIndex = print.offer.idx`) gelir. Uyum
// `packages/contracts/fixtures/clip-print.json` (`dc`, `texts`) ile test edilir.

const (
	// ClipMaxBytes AC-345 düz metin üst sınırı (UTF-8 bayt).
	ClipMaxBytes = 65_536
	// ClipChunkBytes `clip.data` parça boyutu (ham bayt) → en çok ClipMaxChunks parça.
	ClipChunkBytes = 8_192
	ClipMaxChunks  = ClipMaxBytes / ClipChunkBytes
	// ClipChunkB64Max 8192 ham bayt → dolgulu base64 10 924 karakter.
	ClipChunkB64Max = (ClipChunkBytes + 2) / 3 * 4
	// PrintMaxBytes / PrintMinBytes `print.offer.size` aralığı (AC-348).
	PrintMaxBytes = 20 * 1024 * 1024
	PrintMinBytes = 5
	// PDFMagic alınan belgenin ilk 5 baytı.
	PDFMagic = "%PDF-"

	capClipboard = "clipboard"
	capPrint     = "print"
	clipB64Min   = 4
)

var (
	cpIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,26}$`)
	b64Re  = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)

	clipTypes  = []string{"clip.ready", "clip.data"}
	printTypes = []string{"print.ready", "print.offer", "print.done"}
)

func (m Ctl) validClipPrint() bool {
	switch m.T {
	case "clip.ready":
		return cpIDRe.MatchString(m.CID)
	case "clip.data":
		return cpIDRe.MatchString(m.CID) && *m.Seq >= 0 && *m.Seq < ClipMaxChunks && len(m.B64) >= clipB64Min &&
			len(m.B64) <= ClipChunkB64Max && b64Re.MatchString(m.B64)
	case "print.offer":
		l := utf16Len(m.Name)
		return cpIDRe.MatchString(m.PID) && *m.Idx >= 0 && *m.Idx <= 0xFFFF && l >= 1 && l <= nameMax &&
			*m.Size >= PrintMinBytes && *m.Size <= PrintMaxBytes && sha256Re.MatchString(m.SHA)
	default: // print.ready, print.done
		return cpIDRe.MatchString(m.PID)
	}
}

// ClipReady misafir WS `clip.push`'u kabul etti (konsol ancak bundan sonra veri gönderir).
func ClipReady(cid string) ([]byte, error) { return idMessage("clip.ready", "cid", cid) }

// PrintReady misafir bayt almaya hazır.
func PrintReady(pid string) ([]byte, error) { return idMessage("print.ready", "pid", pid) }

func idMessage(t, key, id string) ([]byte, error) {
	b, err := json.Marshal(map[string]string{"t": t, key: id})
	if err != nil {
		return nil, err
	}
	if _, err := ParseCtl(b); err != nil {
		return nil, err
	}
	return b, nil
}

// ClipChunks metni 8 KB ham bayt parçalarına bölüp dolgulu standart base64 `clip.data` mesajları üretir (parça sınırı
// çok baytlı karakterin ortasına düşebilir; alıcı birleştirip doğrular). Boş veya > 64 KB metin hata döner.
func ClipChunks(cid string, text []byte) ([][]byte, error) {
	if len(text) == 0 || len(text) > ClipMaxBytes {
		return nil, errInvalid
	}
	var out [][]byte
	for seq := 0; len(text) > 0; seq++ {
		n := min(len(text), ClipChunkBytes)
		b, err := json.Marshal(struct {
			T    string `json:"t"`
			CID  string `json:"cid"`
			Seq  int    `json:"seq"`
			Last bool   `json:"last"`
			B64  string `json:"b64"`
		}{"clip.data", cid, seq, n == len(text), base64.StdEncoding.EncodeToString(text[:n])})
		if err != nil {
			return nil, err
		}
		if _, err := ParseCtl(b); err != nil {
			return nil, err
		}
		out = append(out, b)
		text = text[n:]
	}
	return out, nil
}

// ErrClipInvalid gelen pano parçaları sözleşme dışı (sıra, boyut, UTF-8, U+0000) → `report{INVALID}`.
var ErrClipInvalid = errors.New("dc: geçersiz pano verisi")

// ClipAssembler gelen `clip.data` parçalarını birleştirir: `seq` ardışık, toplam ≤ beklenen, `last` sonrası toplam =
// beklenen (push'ta `clip.push.bytes`), UTF-8 geçerli ve U+0000 yok.
type ClipAssembler struct {
	want int
	next int
	buf  []byte
}

// NewClipAssembler want = WS'de yetkilenen bayt sayısı (1..64 KB).
func NewClipAssembler(want int) *ClipAssembler {
	return &ClipAssembler{want: want, buf: make([]byte, 0, min(max(want, 0), ClipMaxBytes))}
}

// Add parçayı ekler. done=true ise text tam metindir (çağıran işi bitince Wipe çağırır); hata ErrClipInvalid.
func (a *ClipAssembler) Add(m Ctl) (text []byte, done bool, err error) {
	if m.T != "clip.data" || m.Seq == nil || m.Last == nil || *m.Seq != a.next {
		return nil, false, ErrClipInvalid
	}
	raw, derr := base64.StdEncoding.DecodeString(m.B64)
	if derr != nil || len(raw) > ClipChunkBytes || len(a.buf)+len(raw) > min(a.want, ClipMaxBytes) {
		clear(raw)
		return nil, false, ErrClipInvalid
	}
	a.buf = append(a.buf, raw...)
	clear(raw)
	a.next++
	if !*m.Last {
		if a.next >= ClipMaxChunks {
			return nil, false, ErrClipInvalid
		}
		return nil, false, nil
	}
	if len(a.buf) != a.want || !utf8.Valid(a.buf) || bytes.IndexByte(a.buf, 0) >= 0 {
		return nil, false, ErrClipInvalid
	}
	return a.buf, true, nil
}

// Wipe birleştirilen metni sıfırlar (bellekte iz bırakmaz).
func (a *ClipAssembler) Wipe() {
	clear(a.buf[:cap(a.buf)])
	a.buf = a.buf[:0]
}

// IsClipPrintType ctl tipinin P28a tipi olup olmadığı (akış yönlendirmesi).
func IsClipPrintType(t string) bool {
	return slices.Contains(clipTypes, t) || slices.Contains(printTypes, t)
}
