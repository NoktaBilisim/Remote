//go:build darwin

package voice

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"unsafe"

	"remote-support/agent-win/internal/darwin/objc"
)

// S-P33-K-2 ölçümü (yalnız NOKTA_MACH_OLCUM=1): taze bir süreçte Mach port adlarını (mach_port_names) ısıtmadan önce,
// yardımcının ısıtmasından (yalnız çözücü) sonra ve eski ısıtmadaki gibi ek bir kodlayıcı kurulduktan sonra sayar.
// Hakların hangi servise ait olduğu bu API ile görünmez (lsmp kök ister); yalnız ad sayısı ve hak türü sayılır.
func TestP33K2MachPortsAfterWarm(t *testing.T) {
	if os.Getenv("NOKTA_MACH_OLCUM") != "1" {
		t.Skip("NOKTA_MACH_OLCUM=1 verilmedi (ölçüm)")
	}
	exe, _ := os.Executable()
	cmd := exec.Command(exe, "-test.run=^$")
	cmd.Env = []string{"NOKTA_MACH_CHILD=1"}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	t.Logf("\n%s", strings.TrimSpace(string(out)))
}

// MACH_PORT_TYPE_* (mach/port.h): hak bitleri 16+MACH_PORT_RIGHT_*.
const (
	machTypeSend    = 1 << 16
	machTypeReceive = 1 << 17
	machTypeSendOne = 1 << 18
	machTypeDead    = 1 << 20
)

func machPortSummary() (string, error) {
	h, err := objc.Open(objc.LibSystem)
	if err != nil {
		return "", err
	}
	var self func() uint32
	var names func(task uint32, n **uint32, nc *uint32, ty **uint32, tc *uint32) int32
	if err := errors.Join(objc.Func(&self, h, "task_self_trap"), objc.Func(&names, h, "mach_port_names")); err != nil {
		return "", err
	}
	var np, tp *uint32
	var nc, tc uint32
	if kr := names(self(), &np, &nc, &tp, &tc); kr != 0 {
		return "", fmt.Errorf("mach_port_names kr=%d", kr)
	}
	types := unsafe.Slice(tp, tc)
	var send, recv, once, dead int
	for _, ty := range types {
		switch {
		case ty&machTypeDead != 0:
			dead++
		case ty&machTypeReceive != 0:
			recv++
		case ty&machTypeSend != 0:
			send++
		case ty&machTypeSendOne != 0:
			once++
		}
	}
	return fmt.Sprintf("ad %d (gönderme %d, alma %d, tek-gönderme %d, ölü %d)", nc, send, recv, once, dead), nil
}

func machChild() int {
	step := func(name string) {
		s, err := machPortSummary()
		if err != nil {
			fmt.Println(name, "hata:", err)
			return
		}
		fmt.Println(name+":", s)
	}
	step("ısıtma öncesi")
	if _, err := warmDecoders(); err != nil {
		fmt.Println("ısıtma:", err)
		return 2
	}
	step("çözücü ısıtması sonrası (güncel yardımcı)")
	enc, err := newATEncoder()
	if err != nil {
		fmt.Println("kodlayıcı:", err)
		return 2
	}
	step("+ kodlayıcı (eski ısıtma)")
	enc.c.close()
	step("kodlayıcı kapatıldıktan sonra")
	return 0
}
