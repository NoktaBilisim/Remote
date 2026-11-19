//go:build linux

package gtk

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"testing"
)

// K10 (D-P28g-K2-4): §5.2a m.1/m.2 (sol düğme, send_event == 0) ve onay diyaloğu Esc kararı sabit ofsetlerden okunur;
// test-linux-gui imajında libgtk-3-dev başlıklarıyla üretilen P28G_XI2_OFFSETS dosyasıyla aynı olmalı. Değişken boşsa
// (imaj dışı) SKIP.
func TestP28gK10GdkEventOffsets(t *testing.T) {
	path := os.Getenv("P28G_XI2_OFFSETS")
	if path == "" {
		t.Skip("SKIP: P28G_XI2_OFFSETS (test-linux-gui imajı) gerekir")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got := map[string]int{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if n, err := strconv.Atoi(v); ok && err == nil {
			got[k] = n
		}
	}
	want := map[string]int{
		"GdkEventButton.type": 0, "GdkEventButton.send_event": offBtnSendEvent, "GdkEventButton.time": offBtnTime,
		"GdkEventButton.x": offBtnX, "GdkEventButton.y": offBtnY, "GdkEventButton.button": offBtnButton,
		"GdkEventKey.keyval": offKeyKeyval,
	}
	for k, v := range want {
		g, ok := got[k]
		if !ok {
			t.Errorf("%s dosyada yok (xi2-offsets.c'ye satır eklenmeli)", k)
		} else if g != v {
			t.Errorf("%s: başlık %d, Go sabiti %d", k, g, v)
		}
	}
}
