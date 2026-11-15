package servis

import (
	"errors"
	"strings"
	"testing"
)

type fakePipeHandler struct {
	disabledBy string
	unreg      bool
}

func (f *fakePipeHandler) Status() (string, string) { return StateOnline, "" }
func (f *fakePipeHandler) Disable(u string) error   { f.disabledBy = u; return nil }
func (f *fakePipeHandler) Unregister() error        { f.unreg = true; return nil }

func TestAC295PipeFilterRejectsEnable(t *testing.T) {
	for line, want := range map[string]error{
		`{"cmd":"enable"}` + "\n":           ErrPipeCommand,
		`{"cmd":"ENABLE"}`:                  ErrPipeCommand,
		`{"cmd":"disable","x":1}`:           ErrPipeFormat,
		`{"Cmd":"disable"}`:                 ErrPipeFormat,
		`{"cmd":"status"}{"cmd":"disable"}`: ErrPipeFormat,
		"":                                  ErrPipeFormat,
		`{"cmd":"` + strings.Repeat("a", 600) + `"}`: ErrPipeFormat,
	} {
		if _, err := ParsePipeRequest([]byte(line)); !errors.Is(err, want) {
			t.Errorf("%q → %v, beklenen %v", line, err, want)
		}
	}
	for _, ok := range []string{CmdStatus, CmdDisable, CmdUnregister} {
		if c, err := ParsePipeRequest([]byte(`{"cmd":"` + ok + `"}` + "\n")); err != nil || c != ok {
			t.Errorf("%s reddedildi: %v", ok, err)
		}
	}
}

func TestAC295PipeDisableUsesTokenUser(t *testing.T) {
	h := &fakePipeHandler{}
	r := HandlePipe(h, []byte(`{"cmd":"disable"}`+"\n"), `PC\ayse`, false)
	if !r.OK || h.disabledBy != `PC\ayse` {
		t.Fatalf("yanıt %+v, kullanıcı %q", r, h.disabledBy)
	}
}

func TestAC338PipeUnregisterOnlyElevated(t *testing.T) {
	h := &fakePipeHandler{}
	if r := HandlePipe(h, []byte(`{"cmd":"unregister"}`), `PC\ayse`, false); r.OK || r.Error != ErrPipeForbidden.Error() || h.unreg {
		t.Fatalf("standart kullanıcı kaydı kaldırabildi: %+v", r)
	}
	if r := HandlePipe(h, []byte(`{"cmd":"unregister"}`), `PC\admin`, true); !r.OK || !h.unreg {
		t.Fatalf("yönetici kaldıramadı: %+v", r)
	}
	if b := EncodePipeResponse(PipeResponse{OK: true, State: StateOnline}); len(b) > MaxPipeLine || b[len(b)-1] != '\n' {
		t.Fatalf("yanıt satırı: %q", b)
	}
}
