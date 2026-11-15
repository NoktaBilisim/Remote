// Package signal WS sinyalizasyon istemcisidir (mimari-protokol §1–3). Sözleşme `packages/contracts/src/ws.ts`
// ile elle yazılmış struct'larla uygulanır; uyum `packages/contracts/fixtures/ws-messages.json` ile test edilir.
package signal

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"
)

// Sınırlar ws.ts ile aynı.
const (
	sdpMax       = 60_000
	candidateMax = 2000
	sdpMidMax    = 32
	mlineMax     = 16
	idMax        = 26
	fileNameMax  = 255
	fileSizeCap  = 2048 * 1024 * 1024
	monitorsMax  = 16
	monitorIDMax = 64
	monitorName  = 64
	monitorPxMax = 16384
	nameMax      = 100
	errMsgMax    = 300
	iceURLMax    = 300
	iceCredMax   = 200
	tenantMax    = 120
	custFirmMax  = 100
)

var (
	ulidRe   = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	isoRe    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)
	sha256Re = regexp.MustCompile(`^[a-f0-9]{64}$`)
	tokenRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	// bindingKeyRe contracts `bindingKeySchema` (`rsb_` + base64url 32 bayt).
	bindingKeyRe = regexp.MustCompile(`^rsb_[A-Za-z0-9_-]{43}$`)
)

// ErrNotForGuest sözleşmede geçerli ama misafire hiç gönderilmeyen tip (ör. peer.pending); alınırsa protokol ihlali.
var ErrNotForGuest = errors.New("signal: tip misafire yönelik değil")

func fail(t, why string) error { return fmt.Errorf("signal: %s: %s", t, why) }

func isISO(s string) bool {
	if !isoRe.MatchString(s) {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}

// zod string uzunluğu UTF-16 birimidir; BMP dışı karakter 2 sayılır.
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

// IsISO zod `z.iso.datetime()` eşi (UTC, `Z` sonekli); internal/request de kullanır.
func IsISO(s string) bool { return isISO(s) }

// literalTrueIfPresent nesnede alan yoksa veya değeri tam `true` ise doğru.
func literalTrueIfPresent(raw []byte, field string) bool {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return false
	}
	v, ok := obj[field]
	return !ok || string(v) == "true"
}

func decodeValid[M Inbound](raw []byte, ok func(*M) bool) (Inbound, error) {
	var m M
	if err := decodeStrict(raw, &m); err != nil {
		return nil, err
	}
	if !ok(&m) {
		return nil, fail(m.Type(), "şema ihlali")
	}
	return m, nil
}

// check tip M'yi katı çözüp ok ile doğrulayan ayrıştırıcı.
func check[M Inbound](ok func(*M) bool) func(raw []byte) (Inbound, error) {
	return func(raw []byte) (Inbound, error) { return decodeValid(raw, ok) }
}

func validIceServers(list []IceServer) bool {
	if list == nil {
		return false
	}
	for _, s := range list {
		if len(s.URLs) == 0 || utf16Len(s.Username) > iceCredMax || utf16Len(s.Credential) > iceCredMax {
			return false
		}
		for _, u := range s.URLs {
			if utf16Len(u) > iceURLMax {
				return false
			}
		}
	}
	return true
}

func validCaps(list []string) bool {
	if list == nil {
		return false
	}
	for _, c := range list {
		if !slices.Contains(caps, c) {
			return false
		}
	}
	return true
}

func validMaxFileMb(v *int) bool { return v == nil || (*v >= 1 && *v <= 2048) }

func validGuestKind(k string) bool { return k == "" || slices.Contains(guestKinds, k) }
