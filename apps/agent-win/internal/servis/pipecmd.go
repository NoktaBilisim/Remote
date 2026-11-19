package servis

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"remote-support/agent-win/internal/signal"
)

// Adlandırılmış boru (mimari-p27 §5.4, r2 K-P27-19). Satır tabanlı JSON (≤ 512 B, `\n` ile biter). Borudan **açma**
// komutu yoktur: `enable` ve bilinmeyen her komut reddedilir. `unregister` yalnız `--uninstall` içindir ve yalnız
// yükseltilmiş (yönetici) istemciden kabul edilir — standart kullanıcı cihaz kaydını sunucudan düşüremez.
const (
	PipeName    = `\\.\pipe\NoktaDestekServis`
	MaxPipeLine = 512
	// PipeMaxInstances aynı anda en çok boru örneği; PipeReadTimeout istemci isteğini bu sürede tamamlamalı (saniye).
	PipeMaxInstances = 4
	PipeReadTimeout  = 5
)

// Boru komutları.
const (
	CmdStatus     = "status"
	CmdDisable    = "disable"
	CmdUnregister = "unregister"
)

// Boru hataları (yanıttaki `error`).
var (
	ErrPipeCommand   = errors.New("unknown_command")
	ErrPipeForbidden = errors.New("forbidden")
	ErrPipeFormat    = errors.New("bad_request")
)

// PipeRequest istemci isteği.
type PipeRequest struct {
	Cmd string `json:"cmd"`
}

// PipeResponse servis yanıtı. "Kapalı" durumu istemcide HKLM'den okunur (O-P27-1); State yalnız bağlantı durumudur.
type PipeResponse struct {
	OK       bool   `json:"ok"`
	State    string `json:"state,omitempty"`
	TechName string `json:"techName,omitempty"`
	Error    string `json:"error,omitempty"`
	// Version P29 (K-P29-21, yalnız ekleme): çalışan servis sürümü; tepsi kendi sürümünden farklıysa yeniden başlar.
	Version string `json:"version,omitempty"`
}

// ParsePipeRequest tek satırı strict çözer; yalnız status/disable/unregister.
func ParsePipeRequest(line []byte) (string, error) {
	line = bytes.TrimSuffix(line, []byte("\n"))
	if len(line) == 0 || len(line) > MaxPipeLine {
		return "", ErrPipeFormat
	}
	var req PipeRequest
	if err := signal.DecodeStrict(line, &req); err != nil { // harf duyarlı anahtar, bilinmeyen alan reddi
		return "", ErrPipeFormat
	}
	switch req.Cmd {
	case CmdStatus, CmdDisable, CmdUnregister:
		return req.Cmd, nil
	}
	return "", ErrPipeCommand
}

// AuthorizePipe komutun istemci kimliğiyle çalıştırılıp çalıştırılamayacağı (boru DACL'ı ayrıca INTERACTIVE ile sınırlı).
func AuthorizePipe(cmd string, clientElevated bool) error {
	if cmd == CmdUnregister && !clientElevated {
		return ErrPipeForbidden
	}
	return nil
}

// EncodePipeResponse yanıt satırı (`\n` ile).
func EncodePipeResponse(r PipeResponse) []byte {
	b, err := json.Marshal(r)
	if err != nil {
		b = []byte(`{"ok":false,"error":"internal"}`)
	}
	return append(b, '\n')
}

// PipeHandler boru komutlarının çekirdekteki karşılığı.
type PipeHandler interface {
	Status() (state, techName string)
	Disable(user string) error
	Unregister() error
}

// HandlePipe çözülmüş isteği yürütür ve yanıtı döner. user olay günlüğüne yazılacak, jetondan alınmış hesap adıdır.
func HandlePipe(h PipeHandler, line []byte, user string, elevated bool) PipeResponse {
	cmd, err := ParsePipeRequest(line)
	if err == nil {
		err = AuthorizePipe(cmd, elevated)
	}
	if err != nil {
		return PipeResponse{Error: err.Error()}
	}
	switch cmd {
	case CmdDisable:
		err = h.Disable(user)
	case CmdUnregister:
		err = h.Unregister()
	}
	if err != nil {
		return PipeResponse{Error: fmt.Sprintf("%s_failed", cmd)}
	}
	state, tech := h.Status()
	resp := PipeResponse{OK: true, State: state, TechName: tech}
	if v, ok := h.(interface{ ServiceVersion() string }); ok {
		resp.Version = v.ServiceVersion()
	}
	return resp
}
