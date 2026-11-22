//go:build darwin

// k0sprobe: TCC ve erişilebilirlik durumlarını YALNIZ OKUR (K0s-A2, K0s-W3). İstem açan tek yol `-request-mic`
// bayrağıdır ve spike koşusunda KULLANILMAZ (elle adım; rapor §A2).
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/test/spike-p33/mac"
)

var (
	outPath    = flag.String("o", "", "çıktı dosyası (.app içinden koşunca)")
	requestMic = flag.Bool("request-mic", false, "ELLE: mikrofon istemini aç (requestAccessForMediaType), ≤ 60 sn bekle")
)

var micNames = map[int]string{0: "notDetermined", 1: "restricted", 2: "denied", 3: "authorized"}

func main() {
	flag.Parse()
	var w io.Writer = os.Stdout
	if *outPath != "" {
		f, err := os.Create(*outPath)
		if err == nil {
			defer f.Close()
			w = io.MultiWriter(os.Stdout, f)
		}
	}
	exe, _ := os.Executable()
	fmt.Fprintf(w, "süreç: pid %d yol %s\n", os.Getpid(), exe)
	fmt.Fprintf(w, "mikrofon authorizationStatus: %s\n", micStatus())
	cg, err := objc.Framework("CoreGraphics")
	mac.Must(err)
	var pre, listen, post func() bool
	mac.Must(objc.Func(&pre, cg, "CGPreflightScreenCaptureAccess"))
	mac.Must(objc.Func(&listen, cg, "CGPreflightListenEventAccess"))
	mac.Must(objc.Func(&post, cg, "CGPreflightPostEventAccess"))
	ax, err := objc.Framework("ApplicationServices")
	mac.Must(err)
	var trusted func() bool
	mac.Must(objc.Func(&trusted, ax, "AXIsProcessTrusted"))
	fmt.Fprintf(w, "Ekran Kaydı (CGPreflightScreenCaptureAccess): %v\n", pre())
	fmt.Fprintf(w, "Girdi İzleme (CGPreflightListenEventAccess): %v  Olay gönderme (CGPreflightPostEventAccess): %v\n", listen(), post())
	fmt.Fprintf(w, "Erişilebilirlik (AXIsProcessTrusted): %v\n", trusted())
	var flags func(state int32) uint64
	mac.Must(objc.Func(&flags, cg, "CGEventSourceFlagsState"))
	fmt.Fprintf(w, "CGEventSourceFlagsState combined=0x%x hid=0x%x\n", flags(0), flags(1))
	for _, k := range []string{"stickyKey", "mouseDriver", "slowKey", "stickyKeyBeepOnModifier"} {
		v, ok := mac.Pref("com.apple.universalaccess", k)
		fmt.Fprintf(w, "CFPreferences com.apple.universalaccess %s: var=%v değer=%q\n", k, ok, strings.TrimSpace(v))
	}
	for _, k := range []string{"stickyKey", "mouseDriver"} {
		out, err := exec.Command("/usr/bin/defaults", "read", "com.apple.universalaccess", k).CombinedOutput()
		fmt.Fprintf(w, "defaults read com.apple.universalaccess %s: %q err=%v\n", k, strings.TrimSpace(string(out)), err)
	}
	if *requestMic {
		fmt.Fprintf(w, "requestAccessForMediaType çağrılıyor (istem)…\n")
		fmt.Fprintf(w, "istek sonucu: %v; durum %s\n", micRequest(), micStatus())
	}
}

func avAudio() (objc.Class, objc.ID) {
	h, err := objc.Framework("AVFoundation")
	mac.Must(err)
	t, err := objc.Symbol(h, "AVMediaTypeAudio")
	mac.Must(err)
	c, err := objc.GetClass("AVCaptureDevice")
	mac.Must(err)
	return c, objc.ID(t)
}

func micStatus() string {
	c, t := avAudio()
	st := pobjc.Send[int](objc.ID(c), objc.Sel("authorizationStatusForMediaType:"), t)
	return fmt.Sprintf("%d (%s)", st, micNames[st])
}

func micRequest() string {
	c, t := avAudio()
	ch := make(chan bool, 1)
	blk := pobjc.NewBlock(func(_ pobjc.Block, granted bool) { ch <- granted })
	defer blk.Release()
	objc.ID(c).Send(objc.Sel("requestAccessForMediaType:completionHandler:"), t, blk)
	select {
	case g := <-ch:
		return fmt.Sprint(g)
	case <-time.After(60 * time.Second):
		return "zaman aşımı (60 sn)"
	}
}
