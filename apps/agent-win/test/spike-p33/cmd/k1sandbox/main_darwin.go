//go:build darwin

// k1sandbox: P33 K1 — S-P33-T2-1 m.3 ölçümü. Çözücüler sandbox_init'ten ÖNCE kurulup ısıtılır (gerçek paket + PLC +
// Reset), sonra seçilen profile girilir; çözme/PLC/Reset sürüyor mu, yeni çözücü kurulabiliyor mu ve öz-test (dosya
// okuma, socket, /tmp yazma) sonuçları yazılır.
package main

import (
	"flag"
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/test/spike-p33/at"
	"remote-support/agent-win/test/spike-p33/sig"
)

var profiles = map[string]string{
	"empty":  `(version 1) (deny default)`,
	"nosock": `(version 1) (deny default) (deny system-socket) (deny network*)`,
	"sysctl": `(version 1) (deny default) (allow sysctl-read)`,
	"sys": `(version 1) (deny default) (allow sysctl-read)
(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/private/var/db/dyld")
  (subpath "/System/Volumes/Preboot/Cryptexes"))`,
	"wide": `(version 1) (deny default) (allow file-read*) (allow sysctl-read)
(allow mach-lookup (global-name "com.apple.audio.AudioComponentRegistrar"))`,
}

func main() {
	prof := flag.String("profile", "empty", "empty|sysctl|sys|wide|none")
	n := flag.Int("frames", 2000, "çerçeve")
	probe := flag.String("probe", "", "okunacak dosya (EPERM beklenir)")
	flag.Parse()
	h, err := objc.Open(objc.LibSystem)
	if err != nil {
		panic(err)
	}
	var sbInit func(profile *byte, flags uint64, errbuf *uintptr) int32
	var sbCheck func(pid int32, op uintptr, typ int32) int32
	if err := objc.Func(&sbInit, h, "sandbox_init"); err != nil {
		panic(err)
	}
	if err := objc.Func(&sbCheck, h, "sandbox_check"); err != nil {
		panic(err)
	}
	pcm := sig.SpeechLike(*n, 11)
	enc, err := at.NewEncoder(32000)
	if err != nil {
		panic(err)
	}
	var pkts [][]byte
	for f := range *n {
		ps, err := enc.Encode(pcm[f*960 : (f+1)*960])
		if err != nil || len(ps) != 1 {
			panic("kodlama")
		}
		pkts = append(pkts, ps[0])
	}
	var decs []*at.Decoder
	for range 3 {
		d, err := at.NewDecoder(1, 1, nil)
		if err != nil {
			panic(err)
		}
		if _, err := d.DecodeCap(pkts[0], 960); err != nil {
			panic(err)
		}
		if _, err := d.DecodeCap(nil, 960); err != nil {
			panic(err)
		}
		if err := d.Reset(); err != nil {
			panic(err)
		}
		decs = append(decs, d)
	}
	fmt.Printf("önce sandbox_check(self)=%d\n", sbCheck(int32(os.Getpid()), 0, 0))
	if *prof != "none" {
		p := append([]byte(profiles[*prof]), 0)
		var eb uintptr
		rc := sbInit(&p[0], 0, &eb)
		fmt.Printf("sandbox_init(%s) rc=%d err=%v\n", *prof, rc, eb != 0)
		if rc != 0 {
			os.Exit(3)
		}
	}
	fmt.Printf("sonra sandbox_check(self)=%d\n", sbCheck(int32(os.Getpid()), 0, 0))
	// çözme
	var td []time.Duration
	bad, short := 0, 0
	for f, pk := range pkts {
		t0 := time.Now()
		o, err := decs[f%3].DecodeCap(pk, 960)
		td = append(td, time.Since(t0))
		if err != nil {
			bad++
		} else if len(o) != 960 {
			short++
		}
		if f%100 == 50 {
			if o, err := decs[f%3].DecodeCap(nil, 960); err != nil || len(o) != 960 {
				fmt.Println("PLC hata", err, len(o))
			}
		}
	}
	p := sig.Pct(td, 50, 95, 99, 100)
	fmt.Printf("çöz: hata=%d kısa=%d p50 %.3f p95 %.3f p99 %.3f maks %.3f ms\n", bad, short, p[0], p[1], p[2], p[3])
	if err := decs[0].Reset(); err != nil {
		fmt.Println("Reset sonrası hata:", err)
	} else if o, err := decs[0].DecodeCap(pkts[10], 960); err != nil {
		fmt.Println("Reset sonrası çözme:", err)
	} else {
		fmt.Println("Reset sonrası çözme tamam", len(o))
	}
	if d, err := at.NewDecoder(1, 1, nil); err != nil {
		fmt.Println("yeni çözücü:", err)
	} else {
		o, err := d.DecodeCap(pkts[10], 960)
		fmt.Println("yeni çözücü kuruldu; çözme:", err, len(o))
	}
	// öz-test
	for _, path := range []string{"/Users", "/Library/Keychains", "/private/var/folders", "/etc/hosts", *probe} {
		if path == "" {
			continue
		}
		f, err := os.Open(path)
		if err == nil {
			_, err = f.Read(make([]byte, 1))
			if err != nil && err.Error() == "read "+path+": is a directory" {
				_, err = f.Readdirnames(1)
			}
			f.Close()
		}
		fmt.Printf("oku %s: %v\n", path, err)
	}
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	fmt.Printf("socket: fd=%d %v\n", fd, err)
	fd2, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	fmt.Printf("socket unix: fd=%d %v\n", fd2, err)
	if fd > 0 {
		err = syscall.Connect(fd, &syscall.SockaddrInet4{Port: 80, Addr: [4]byte{1, 1, 1, 1}})
		fmt.Printf("connect 1.1.1.1:80: %v\n", err)
	}
	err = os.WriteFile("/tmp/k1sandbox-yazma-denemesi", []byte("x"), 0o600)
	fmt.Printf("/tmp yaz: %v\n", err)
	_ = unsafe.Pointer(nil)
}
