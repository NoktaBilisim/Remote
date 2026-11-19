// Package dc DataChannel sözleşmesinin Go eşidir (mimari-protokol §4; `packages/contracts/src/dc.ts`).
// `ctl` JSON mesajları katı doğrulanır; DC'de `control.*` tipi yoktur (kontrol isteği yalnız WS'den, G-09).
package dc

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"unicode/utf8"
)

// Kanal adları (teknisyen offer'da açar).
const (
	LabelCtl   = "ctl"
	LabelFile  = "file"
	LabelInput = "input"
)

const (
	// CtlMaxBytes tek ctl mesajı üst sınırı (UTF-8 bayt).
	CtlMaxBytes = 16 * 1024
	annotMaxPts = 500
	nameMax     = 255
	// FileMaxBytesCap tenant max_file_mb tavanı (2048 MiB).
	FileMaxBytesCap = 2048 * 1024 * 1024
	// DefaultMaxFileMb hello.maxFileMb yoksa (AC-53).
	DefaultMaxFileMb = 100
	capFileTransfer  = "file_transfer"
)

var (
	msgIDRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,26}$`)
	sha256Re = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// MaxFileBytes tenant MB → bayt (tavanla sınırlı).
func MaxFileBytes(mb int) int64 {
	return min(int64(max(0, mb))*1024*1024, FileMaxBytesCap)
}

// Ctl doğrulanmış ctl mesajı. Kullanılmayan alanlar boş kalır; T tipi belirler.
type Ctl struct {
	T     string       `json:"t"`
	ID    string       `json:"id,omitempty"`
	Tool  string       `json:"tool,omitempty"`
	Color string       `json:"color,omitempty"`
	Pts   [][2]float64 `json:"pts,omitempty"`
	X     *float64     `json:"x,omitempty"`
	Y     *float64     `json:"y,omitempty"`
	FID   string       `json:"fid,omitempty"`
	Idx   *int         `json:"idx,omitempty"`
	Name  string       `json:"name,omitempty"`
	Size  *int64       `json:"size,omitempty"`
	SHA   string       `json:"sha256,omitempty"`
	OK    *bool        `json:"ok,omitempty"`
	// P28a (ctl_clip_print.go): pano/yazdırma kimlikleri ve `clip.data` parçası.
	CID  string `json:"cid,omitempty"`
	PID  string `json:"pid,omitempty"`
	Seq  *int   `json:"seq,omitempty"`
	Last *bool  `json:"last,omitempty"`
	B64  string `json:"b64,omitempty"`
}

// Tip başına izinli alanlar: zorunlu (+) ve isteğe bağlı (?). zod strictObject eşi. P22-G (mimari-p22 §4.4): `chat`
// yoktur — sohbet sunucu aktarımlı WS'tedir; DC `chat` bilinmeyen tip olarak düşer, kanal açık kalır.
var ctlFields = map[string]struct{ req, opt []string }{
	"annot.stroke": {[]string{"id", "tool", "color", "pts"}, nil},
	"annot.laser":  {[]string{"x", "y"}, nil},
	"annot.undo":   {nil, []string{"id"}},
	"annot.clear":  {nil, []string{"id"}},
	"file.offer":   {[]string{"fid", "idx", "name", "size", "sha256"}, nil},
	"file.accept":  {[]string{"fid"}, nil},
	"file.reject":  {[]string{"fid"}, nil},
	"file.cancel":  {[]string{"fid"}, nil},
	"file.done":    {[]string{"fid"}, nil},
	"file.result":  {[]string{"fid", "ok"}, nil},
	"ping":         {nil, []string{"id"}},
	"clip.ready":   {[]string{"cid"}, nil},
	"clip.data":    {[]string{"cid", "seq", "last", "b64"}, nil},
	"print.ready":  {[]string{"pid"}, nil},
	"print.offer":  {[]string{"pid", "idx", "name", "size", "sha256"}, nil},
	"print.done":   {[]string{"pid"}, nil},
}

// FileTypes file_transfer yeteneğine bağlı tipler (AC-119).
var fileTypes = []string{"file.offer", "file.accept", "file.reject", "file.cancel", "file.done", "file.result"}

var errInvalid = errors.New("dc: geçersiz ctl mesajı")

// ParseCtl ham ctl çerçevesini doğrular; hata → alıcı mesajı düşürür.
func ParseCtl(raw []byte) (Ctl, error) {
	if len(raw) > CtlMaxBytes || !utf8.Valid(raw) {
		return Ctl{}, errInvalid
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return Ctl{}, errInvalid
	}
	var t string
	if json.Unmarshal(obj["t"], &t) != nil {
		return Ctl{}, errInvalid
	}
	f, ok := ctlFields[t]
	if !ok {
		return Ctl{}, errInvalid
	}
	for k, v := range obj {
		// Hiçbir ctl alanı nullable değil; bilinmeyen/harf farklı anahtar reddedilir.
		if bytes.Equal(v, []byte("null")) || (k != "t" && !slices.Contains(f.req, k) && !slices.Contains(f.opt, k)) {
			return Ctl{}, errInvalid
		}
	}
	for _, k := range f.req {
		if _, ok := obj[k]; !ok {
			return Ctl{}, errInvalid
		}
	}
	var m Ctl
	if json.Unmarshal(raw, &m) != nil || !m.valid() {
		return Ctl{}, errInvalid
	}
	return m, nil
}

func unit(v float64) bool { return v >= 0 && v <= 1 }

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func (m Ctl) valid() bool {
	idOK := m.ID == "" || msgIDRe.MatchString(m.ID)
	switch m.T {
	case "annot.stroke":
		if !msgIDRe.MatchString(m.ID) || !slices.Contains([]string{"pen", "arrow", "rect"}, m.Tool) ||
			!slices.Contains([]string{"red", "yellow", "green", "blue"}, m.Color) || len(m.Pts) < 1 || len(m.Pts) > annotMaxPts {
			return false
		}
		for _, p := range m.Pts {
			if !unit(p[0]) || !unit(p[1]) {
				return false
			}
		}
		return true
	case "annot.laser":
		return unit(*m.X) && unit(*m.Y)
	case "annot.undo", "annot.clear", "ping":
		return idOK
	case "file.offer":
		l := utf16Len(m.Name)
		return msgIDRe.MatchString(m.FID) && *m.Idx >= 0 && *m.Idx <= 0xFFFF && l >= 1 && l <= nameMax &&
			*m.Size >= 0 && *m.Size <= FileMaxBytesCap && sha256Re.MatchString(m.SHA)
	case "clip.ready", "clip.data", "print.ready", "print.offer", "print.done":
		return m.validClipPrint()
	default: // file.accept/reject/cancel/done/result
		return msgIDRe.MatchString(m.FID)
	}
}

// Allowed misafir tarafı yetenek filtresi (G-09): file_transfer yoksa dosya tipleri kabul edilmez
// (çağıran file.offer'a otomatik file.reject döner, diğerlerini düşürür). P28a: `clip.*` ← clipboard, `print.*` ← print.
func Allowed(t string, caps []string) bool {
	switch {
	case slices.Contains(clipTypes, t):
		return slices.Contains(caps, capClipboard)
	case slices.Contains(printTypes, t):
		return slices.Contains(caps, capPrint)
	}
	return !slices.Contains(fileTypes, t) || slices.Contains(caps, capFileTransfer)
}

// FileReply alıcının fid'li yanıtı (accept/reject/cancel/done).
func FileReply(t, fid string) ([]byte, error) {
	if !slices.Contains([]string{"file.accept", "file.reject", "file.cancel", "file.done"}, t) || !msgIDRe.MatchString(fid) {
		return nil, errInvalid
	}
	return json.Marshal(struct {
		T   string `json:"t"`
		FID string `json:"fid"`
	}{t, fid})
}

// FileResult alıcının SHA-256 doğrulama sonucu (AC-54).
func FileResult(fid string, ok bool) ([]byte, error) {
	if !msgIDRe.MatchString(fid) {
		return nil, errInvalid
	}
	return json.Marshal(struct {
		T   string `json:"t"`
		FID string `json:"fid"`
		OK  bool   `json:"ok"`
	}{"file.result", fid, ok})
}
