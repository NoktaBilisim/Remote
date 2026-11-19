package helperio

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// P28u (mimari-p28u §7.4; r3 §r3.5): giriş borusunun ilk satırı Input, sonraki satırları servis komutlarıdır
// (`{"cmd":"lock","id":"…"}`); boru açık kalır. Durum borusu (yardımcı → servis, tek yön) satır başına bir JSON olaydır
// (≤ MaxStatusLine bayt). İki uç aynı ikilidir: bilinmeyen alan reddedilir (DisallowUnknownFields).
// r3 (K-P28u-r3-1): onay diyaloğu yok; tek kip `no_user`. Consent "" = P27 girdisi, "none" = P28u girdisi.

// ConsentNone Input.Consent: yardımcı kullanıcıya sormaz (r3'te tek değer).
const ConsentNone = "none"

// ModeNoUser Input.Mode (contracts `consentMode`; r3'te yeni yazımda tek değer).
const ModeNoUser = "no_user"

// Lock sonucu nedeni (contracts `intervene.result.reason`).
const ReasonNotLocked = "not_locked"

// MaxStatusLine durum borusunda bir satırın en çok bayt sayısı (yeni satır dahil).
const MaxStatusLine = 512

// CmdLock tek komut (oturum kapatma servistedir — §7.5).
const CmdLock = "lock"

// Command giriş borusunun ikinci ve sonraki satırları. lock ⇒ ID dolu, On yok; rec (P28e) ⇒ ID boş, On dolu.
type Command struct {
	Cmd string `json:"cmd"`
	ID  string `json:"id,omitempty"`
	On  *bool  `json:"on,omitempty"`
}

// Status durum borusu olayı. Ev'e göre alanlar: control{On}, lock{ID, Ok, Reason?}.
type Status struct {
	Ev     string `json:"ev"`
	On     *bool  `json:"on,omitempty"`
	ID     string `json:"id,omitempty"`
	Ok     *bool  `json:"ok,omitempty"`
	Reason string `json:"reason,omitempty"`
}

var cmdIDRe = ulidRe

// validateP28u Input'un P28u alanlarının birlikte geçerliliği (§7.4, r3): none ⇔ no_user. İkisi de boşsa P27 girdisidir.
func (in Input) validateP28u() error {
	switch {
	case in.Consent == "" && in.Mode == "":
	case in.Consent == ConsentNone && in.Mode == ModeNoUser:
	default:
		return fmt.Errorf("%w: consent/mode", ErrInvalid)
	}
	if in.Recording && in.Consent == "" { // P27 girdisi kayıt taşımaz (gösterge eki yok → kayıt yok, K-P28e-7)
		return fmt.Errorf("%w: recording", ErrInvalid)
	}
	return nil
}

// NewReader giriş borusu okuyucusu: ReadInput ardından ReadCommand aynı tamponu kullanır.
func NewReader(r io.Reader) *bufio.Reader { return bufio.NewReaderSize(r, MaxInput+1) }

// ReadInput ilk satırı (ya da yeni satırsız tek nesneyi, EOF'a dek — P27 servisi) okur ve doğrular.
func ReadInput(br *bufio.Reader) (Input, error) {
	line, err := readLine(br, MaxInput)
	if err != nil && (err != io.EOF || len(line) == 0) {
		return Input{}, fmt.Errorf("%w: okuma", ErrInvalid)
	}
	var in Input
	if err := strictDecode(line, &in); err != nil {
		return Input{}, err
	}
	return in, in.Validate()
}

// ReadCommand sonraki komut satırı. io.EOF = servis boruyu kapattı (oturum sürer). Bozuk satır ErrInvalid döner.
func ReadCommand(br *bufio.Reader) (Command, error) {
	line, err := readLine(br, 256)
	if err != nil && (err != io.EOF || len(line) == 0) {
		return Command{}, err
	}
	var c Command
	if derr := strictDecode(line, &c); derr != nil {
		return Command{}, derr
	}
	if !validCommand(c) {
		return Command{}, fmt.Errorf("%w: komut", ErrInvalid)
	}
	return c, nil
}

// EncodeCommand servis tarafı: tek satır (yeni satırla).
func EncodeCommand(c Command) ([]byte, error) {
	if !validCommand(c) {
		return nil, fmt.Errorf("%w: komut", ErrInvalid)
	}
	b, err := json.Marshal(c)
	return append(b, '\n'), err
}

// EncodeStatus durum olayını tek satıra çevirir; boyut aşımı reddedilir.
func EncodeStatus(s Status) ([]byte, error) {
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	b = append(b, '\n')
	if len(b) > MaxStatusLine {
		return nil, fmt.Errorf("%w: durum satırı boyutu", ErrInvalid)
	}
	return b, nil
}

// readLine '\n'e kadar en çok max bayt okur (yeni satır hariç döner).
func readLine(br *bufio.Reader, max int) ([]byte, error) {
	var buf []byte
	for {
		b, err := br.ReadByte()
		if err != nil {
			return buf, err
		}
		if b == '\n' {
			return bytes.TrimRight(buf, "\r"), nil
		}
		if len(buf) >= max {
			return nil, fmt.Errorf("%w: boyut", ErrInvalid)
		}
		buf = append(buf, b)
	}
}

func strictDecode(line []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: json", ErrInvalid)
	}
	if dec.More() {
		return fmt.Errorf("%w: fazladan veri", ErrInvalid)
	}
	return nil
}
