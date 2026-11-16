package servis

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"

	"remote-support/agent-win/internal/servis/helperio"
)

// Durum borusu okuyucusu (mimari-p28u §7.4, D-P28u-1, K-P28u-19). Yardımcı servisten daha az güvenilen süreçtir
// (S-P27-6): her satır boyut + şema + olay × durum tablosundan geçer; beklenmeyen her şey `helper_protocol` (olay 1004)
// ve TerminateProcess'tir. Tablo:
//
//	ev:consent  Consent=="ask" ∧ henüz karar yok (bir kez)
//	ev:control  karar granted ∨ Consent=="none"; yalnız değer değişimi
//	ev:lock     id = bekleyen tek lock komutunun kimliği
//	diğer/bozuk —

// ReasonHelperProtocol 1004 nedeni: yardımcı durum borusunda sözleşme dışı satır yazdı.
const ReasonHelperProtocol = "helper_protocol"

var errStatus = errors.New("servis: durum borusu sözleşme dışı")

// helperStatus tek yardımcının durum makinesi. control başlatmada (sıfır değer) ve çıkışta off'tur.
type helperStatus struct {
	consent     string // helperio.ConsentAsk | ConsentNone
	decided     bool
	granted     bool
	control     bool
	pendingLock string // bekleyen lock komut kimliği
	lateLock    string // zaman aşımına uğramış son kimlik: geç gelen tek ev:lock yok sayılır
}

// statusAction kabul edilen olayın sonucu.
type statusAction struct {
	consent  bool // decision/ms consent.result'a gider
	decision string
	ms       int
	lock     bool   // bekleyen kilidin sonucu
	reason   string // "" = ok
}

// apply olayı tabloya göre kabul eder; hata = sonlandırma.
func (h *helperStatus) apply(s helperio.Status) (statusAction, error) {
	switch s.Ev {
	case "consent":
		ok := h.consent == helperio.ConsentAsk && !h.decided && s.On == nil && s.ID == "" && s.Ok == nil &&
			s.Reason == "" && s.Ms != nil && *s.Ms >= 0 && *s.Ms <= helperio.MaxConsentMs &&
			(s.Decision == helperio.DecisionGranted || s.Decision == helperio.DecisionDenied ||
				s.Decision == helperio.DecisionTimeout)
		if !ok {
			return statusAction{}, errStatus
		}
		h.decided, h.granted = true, s.Decision == helperio.DecisionGranted
		return statusAction{consent: true, decision: s.Decision, ms: *s.Ms}, nil
	case "control":
		allowed := h.consent == helperio.ConsentNone || (h.decided && h.granted)
		ok := allowed && s.On != nil && *s.On != h.control && s.Decision == "" && s.Ms == nil && s.ID == "" &&
			s.Ok == nil && s.Reason == ""
		if !ok {
			return statusAction{}, errStatus
		}
		h.control = *s.On
		return statusAction{}, nil
	case "lock":
		if h.lateLock != "" && s.ID == h.lateLock && s.Ok != nil {
			h.lateLock = ""
			return statusAction{}, nil
		}
		ok := h.pendingLock != "" && s.ID == h.pendingLock && s.Ok != nil && s.Decision == "" && s.Ms == nil &&
			s.On == nil && (*s.Ok == (s.Reason == "")) &&
			(s.Reason == "" || s.Reason == InterveneNotLocked || s.Reason == InterveneAPIError)
		if !ok {
			return statusAction{}, errStatus
		}
		h.pendingLock = ""
		return statusAction{lock: true, reason: s.Reason}, nil
	}
	return statusAction{}, errStatus
}

// decodeStatus tek satırı katı çözer (bilinmeyen alan, fazladan veri reddedilir).
func decodeStatus(line []byte) (helperio.Status, error) {
	var s helperio.Status
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil || dec.More() {
		return helperio.Status{}, errStatus
	}
	return s, nil
}

// readStatusLine '\n'e kadar en çok MaxStatusLine bayt (yeni satır dahil) okur.
func readStatusLine(br *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		b, err := br.ReadByte()
		if err != nil {
			return nil, err
		}
		if b == '\n' {
			return buf, nil
		}
		if len(buf)+2 > helperio.MaxStatusLine {
			return nil, errStatus
		}
		buf = append(buf, b)
	}
}

// readStatus yardımcı çıkana (EOF) ya da ilk ihlale kadar okur.
func (c *Core) readStatus(r *running, pipe io.Reader) {
	if cl, ok := pipe.(io.Closer); ok {
		defer func() { _ = cl.Close() }()
	}
	br := bufio.NewReaderSize(pipe, helperio.MaxStatusLine)
	for {
		line, err := readStatusLine(br)
		if errors.Is(err, io.EOF) {
			return
		}
		var s helperio.Status
		if err == nil {
			s, err = decodeStatus(line)
		}
		if err != nil || !c.onStatus(r, s) {
			c.statusViolation(r)
			return
		}
	}
}

// onStatus kabul edilen olayı uygular; false = ihlal.
func (c *Core) onStatus(r *running, s helperio.Status) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur != r {
		return true // çıkmış yardımcının son satırları: etkisiz
	}
	act, err := r.st.apply(s)
	if err != nil {
		return false
	}
	switch {
	case act.consent:
		ms := act.ms
		c.Send(&ConsentResult{SessionID: r.sessionID, Mode: helperio.ModeAsked, Decision: act.decision, Ms: &ms})
		c.Events.Write(evConsent(r, act.decision))
	case act.lock:
		if r.lockTimer != nil {
			r.lockTimer.Stop()
		}
		c.interveneDone(r.sessionID, s.ID, CmdLock, act.reason, r.techName)
	}
	return true
}

// statusViolation yardımcıyı keser (oturum helper_failed ile biter) ve 1004 helper_protocol yazar.
func (c *Core) statusViolation(r *running) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur != r {
		return
	}
	c.Events.Write(EvReject(ReasonHelperProtocol, "oturum "+r.sessionID))
	if c.rejoin != nil && c.rejoin.sessionID == r.sessionID {
		c.rejoin = nil
	}
	c.killLocked(helperio.ReasonHelperFailed)
}

// exitedLocked yardımcı çıkışında: control=off (yeniden katılan yardımcı devralmaz), bekleyen kilit no_session.
func (c *Core) exitedLocked(r *running) {
	r.st.control = false
	if id := r.st.pendingLock; id != "" {
		if r.lockTimer != nil {
			r.lockTimer.Stop()
		}
		r.st.pendingLock = ""
		c.interveneDone(r.sessionID, id, CmdLock, InterveneNoSession, r.techName)
	}
}
