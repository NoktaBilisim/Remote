//go:build windows

package servis

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/proclimit"
)

// P28u K6s Windows spike (mimari-p28u §7.5 "Doğrulama", R-P28u-1/2, K-P28u-5b, ADR-0033; sonuç docs/spike-p28u-k6s.md).
// Ölçümdür: işletim sistemi davranışı testi kırmızı yapmaz; satırlar t.Log, GitHub step summary ve (elle koşuda)
// -k6s.cikti dosyasına yazılır. Üç kısım:
//   - TestK6sSessionIDs (CI, her koşu): WTSGetActiveConsoleSessionId ↔ ProcessIdToSessionId, oturum listesi,
//     WTSSessionInfoEx.SessionFlags (soru 3, kilitsiz durum).
//   - TestK6sLockRestrictedToken (CI son adımı, K6S_KILIT=1): üretim yardımcısıyla aynı proclimit.Spec'le başlatılan
//     kısıtlı jetonlu çocuk LockWorkStation çağırır (soru 1). Koşucuyu KİLİTLER; bu yüzden ayrı ve son adımdadır.
//     CI jetonu SYSTEM değil koşucu kullanıcısıdır; SYSTEM ise üretimdeki helperToken birebir kullanılır.
//   - TestK6sElle (yalnız -k6s.elle; SYSTEM + Session 0, testdata/k6s-elle.ps1): Session 0'dan kilit, gerçek
//     helperToken ile kilit, K-P28u-5b kullanıcı jetonuyla kilit, WTSLogoffSession sonrası yeni konsol oturumu (soru 2).

const (
	k6sLockArg       = "--k6s-kilit"
	k6sLockEnv       = "K6S_KILIT"
	wtsSessionInfoEx = 25 // WTS_INFO_CLASS WTSSessionInfoEx
	wtsStateLock     = 0  // WTS_SESSIONSTATE_LOCK
	wtsStateUnlock   = 1  // WTS_SESSIONSTATE_UNLOCK
	desktopReadObj   = 0x0001
	uoiNameIndex     = 2
)

var (
	k6sElle  = flag.String("k6s.elle", "", "K6s elle spike adımları: hepsi | kilit0,kilit,kilit5b,kapat (SYSTEM, Session 0)")
	k6sCikti = flag.String("k6s.cikti", "", "K6s elle spike sonuç dosyası (satır eklenir)")

	k6sWts                  = windows.NewLazySystemDLL("wtsapi32.dll")
	k6sUser32               = windows.NewLazySystemDLL("user32.dll")
	procWTSQuerySessionInfo = k6sWts.NewProc("WTSQuerySessionInformationW")
	procWTSLogoffSession    = k6sWts.NewProc("WTSLogoffSession")
	procLockWorkStation     = k6sUser32.NewProc("LockWorkStation")
	procOpenInputDesktop    = k6sUser32.NewProc("OpenInputDesktop")
	procCloseDesktop        = k6sUser32.NewProc("CloseDesktop")
	procGetUserObjectInfoW  = k6sUser32.NewProc("GetUserObjectInformationW")
)

// wtsInfoEx WTSINFOEXW'nin başı: Level, (8 bayt hizalı birleşim) WTSINFOEX_LEVEL1_W alanları.
type wtsInfoEx struct {
	Level     uint32
	_         uint32
	SessionID uint32
	State     int32
	Flags     int32
	Station   [33]uint16
	User      [21]uint16
	Domain    [18]uint16
}

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == k6sLockArg {
		os.Exit(k6sLockChild())
	}
	os.Exit(m.Run())
}

// k6sLockChild kısıtlı jetonla başlatılan çocuk: LockWorkStation çağırır, sonucu stdout'a tek satır yazar.
func k6sLockChild() int {
	r, _, e := procLockWorkStation.Call()
	var errno uint32
	if r == 0 {
		if en, ok := e.(windows.Errno); ok {
			errno = uint32(en)
		}
	}
	var sid uint32
	_ = windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &sid)
	system := false
	if u, err := windows.GetCurrentProcessToken().GetTokenUser(); err == nil {
		system = u.User.Sid.IsWellKnown(windows.WinLocalSystemSid)
	}
	// §7.5 ölçütü: yardımcı ≤ 2 sn içinde giriş masaüstünü Winlogon görür mü (SessionFlags'ten bağımsız kanıt, soru 3).
	start := time.Now()
	desk := k6sInputDesktop()
	for desk != "Winlogon" && time.Since(start) < 3*time.Second {
		time.Sleep(50 * time.Millisecond)
		desk = k6sInputDesktop()
	}
	_, _ = fmt.Fprintf(os.Stdout, "LockWorkStation=%d hata=%d (%s) oturum=%d masaüstü=%s system=%v; giriş masaüstü=%s (+%d ms)\n",
		r, errno, windows.Errno(errno).Error(), sid, proclimit.CurrentDesktop(), system, desk, time.Since(start).Milliseconds())
	return 0
}

// ---- ortak ölçüm yardımcıları ----

// k6sReporter satırı t.Log'a ve (elle) -k6s.cikti dosyasına hemen yazar (oturum kapanınca kaybolmasın); GitHub step
// summary'ye test bitince tek yazışta ekler (paralel paketlerin tabloları iç içe geçmesin).
func k6sReporter(t *testing.T, title string) func(string) {
	t.Helper()
	var rows []string
	start := time.Now()
	t.Cleanup(func() {
		path := os.Getenv("GITHUB_STEP_SUMMARY")
		if path == "" || len(rows) == 0 {
			return
		}
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			return
		}
		defer f.Close()
		var b strings.Builder
		fmt.Fprintf(&b, "\n### %s\n\n| Sonuç |\n|---|\n", title)
		for _, r := range rows {
			fmt.Fprintf(&b, "| %s |\n", strings.ReplaceAll(r, "|", "/"))
		}
		_, _ = f.WriteString(b.String())
	})
	return func(row string) {
		t.Log(row)
		rows = append(rows, row)
		if *k6sCikti == "" {
			return
		}
		if f, err := os.OpenFile(*k6sCikti, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
			_, _ = fmt.Fprintf(f, "%s +%5dms %s\n", time.Now().Format("15:04:05.000"), time.Since(start).Milliseconds(), row)
			_ = f.Close()
		}
	}
}

func k6sSessionInfo(session uint32) (wtsInfoEx, error) {
	var buf *wtsInfoEx
	var n uint32
	r, _, e := procWTSQuerySessionInfo.Call(0, uintptr(session), wtsSessionInfoEx, uintptr(unsafe.Pointer(&buf)),
		uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return wtsInfoEx{}, e
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(buf)))
	if uintptr(n) < unsafe.Sizeof(wtsInfoEx{}) {
		return wtsInfoEx{}, fmt.Errorf("WTSINFOEXW kısa: %d bayt", n)
	}
	return *buf, nil
}

func (i wtsInfoEx) String() string {
	user := "boş"
	if i.User[0] != 0 {
		user = "dolu"
	}
	return fmt.Sprintf("level=%d id=%d state=%d flags=%d(%s) istasyon=%s kullanıcı=%s", i.Level, i.SessionID, i.State,
		i.Flags, k6sFlagName(i.Flags), windows.UTF16ToString(i.Station[:]), user)
}

func k6sFlagName(f int32) string {
	switch f {
	case wtsStateLock:
		return "LOCK"
	case wtsStateUnlock:
		return "UNLOCK"
	default:
		return "UNKNOWN"
	}
}

func k6sSessions() (map[uint32]string, error) {
	var p *windows.WTS_SESSION_INFO
	var n uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &p, &n); err != nil {
		return nil, err
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(p)))
	out := map[uint32]string{}
	for _, s := range unsafe.Slice(p, n) {
		out[s.SessionID] = fmt.Sprintf("%s/state=%d", windows.UTF16PtrToString(s.WindowStationName), s.State)
	}
	return out, nil
}

// k6sInputDesktop çağıranın pencere istasyonundaki giriş masaüstünün adı; açılamazsa hata metni (Winlogon güvenli
// masaüstü SYSTEM dışı çağırana ERROR_ACCESS_DENIED verir — bu da kilit işaretidir).
func k6sInputDesktop() string {
	h, _, e := procOpenInputDesktop.Call(0, 0, desktopReadObj)
	if h == 0 {
		return "açılamadı: " + e.Error()
	}
	defer func() { _, _, _ = procCloseDesktop.Call(h) }()
	var buf [64]uint16
	var need uint32
	if r, _, e := procGetUserObjectInfoW.Call(h, uoiNameIndex, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&need))); r == 0 {
		return "ad okunamadı: " + e.Error()
	}
	return windows.UTF16ToString(buf[:])
}

func k6sIsSystem() bool {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	return err == nil && u.User.Sid.IsWellKnown(windows.WinLocalSystemSid)
}

func k6sOwnSession() uint32 {
	var s uint32
	_ = windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &s)
	return s
}

// k6sOwnRestrictedToken çağıranın jetonunun proclimit.Restrict kopyası (CI: SYSTEM değil; oturum değiştirilmez).
func k6sOwnRestrictedToken() (windows.Token, error) {
	var self windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_DUPLICATE|windows.TOKEN_QUERY, &self); err != nil {
		return 0, err
	}
	defer self.Close()
	var dup windows.Token
	if err := windows.DuplicateTokenEx(self, windows.TOKEN_ALL_ACCESS, nil, windows.SecurityImpersonation,
		windows.TokenPrimary, &dup); err != nil {
		return 0, err
	}
	defer dup.Close()
	return proclimit.Restrict(dup, false)
}

// k6sRunLockChild test ikilisini `--k6s-kilit` ile WinLauncher.start'la aynı Spec'te (MitigationImageLoad, UI kısıtı
// yok, alt süreç yasağı, job) başlatır. Test ikilisi konsol alt sistemli olduğu için Detached (proclimit.Spec notu).
func k6sRunLockChild(tok windows.Token, desktop string) (exit uint32, out string, err error) {
	exe, err := os.Executable()
	if err != nil {
		return 0, "", err
	}
	cmd, err := quoted(exe, k6sLockArg)
	if err != nil {
		return 0, "", err
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	var inR, inW, outR, outW windows.Handle
	if err := windows.CreatePipe(&inR, &inW, &sa, 0); err != nil {
		return 0, "", err
	}
	defer func() { _ = windows.CloseHandle(inW) }()
	if err := windows.CreatePipe(&outR, &outW, &sa, 0); err != nil {
		_ = windows.CloseHandle(inR)
		return 0, "", err
	}
	defer func() { _ = windows.CloseHandle(outR) }()
	_ = windows.SetHandleInformation(inW, windows.HANDLE_FLAG_INHERIT, 0)
	_ = windows.SetHandleInformation(outR, windows.HANDLE_FLAG_INHERIT, 0)
	h, job, err := proclimit.Spawn(proclimit.Spec{
		Token: tok, Exe: exe, CmdLine: cmd, Desktop: desktop, Stdin: inR, Stdout: outW,
		Handles: []windows.Handle{inR, outW}, Mitigation: proclimit.MitigationImageLoad, Detached: true, KillCode: 1,
	})
	_ = windows.CloseHandle(inR)
	_ = windows.CloseHandle(outW)
	if err != nil {
		return 0, "", err
	}
	defer func() { _ = windows.CloseHandle(h); _ = windows.CloseHandle(job) }()
	if ev, _ := windows.WaitForSingleObject(h, 20000); ev != windows.WAIT_OBJECT_0 {
		return 0, "", fmt.Errorf("çocuk 20 sn'de bitmedi")
	}
	exit = 0xFFFFFFFF
	_ = windows.GetExitCodeProcess(h, &exit)
	var sb strings.Builder
	buf := make([]byte, 1024)
	for {
		var n uint32
		if windows.ReadFile(outR, buf, &n, nil) != nil || n == 0 {
			break
		}
		sb.Write(buf[:n])
	}
	return exit, strings.TrimSpace(sb.String()), nil
}

// k6sWaitFlags oturumun SessionFlags'i want olana dek (en çok d) 100 ms'de bir yoklar.
func k6sWaitFlags(session uint32, want int32, d time.Duration) (int32, time.Duration, bool) {
	start := time.Now()
	last := int32(-2)
	for time.Since(start) < d {
		if i, err := k6sSessionInfo(session); err == nil {
			last = i.Flags
			if i.Flags == want {
				return last, time.Since(start), true
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return last, time.Since(start), false
}

// ---- CI ----

func TestK6sSessionIDs(t *testing.T) {
	report := k6sReporter(t, "P28u K6s — oturum kimlikleri ve SessionFlags (soru 2/3, CI)")
	own := k6sOwnSession()
	active := windows.WTSGetActiveConsoleSessionId()
	report(fmt.Sprintf("ProcessIdToSessionId=%d WTSGetActiveConsoleSessionId=%#x eşit=%v system=%v", own, active,
		own == active, k6sIsSystem()))
	if ss, err := k6sSessions(); err != nil {
		report("WTSEnumerateSessions hata: " + err.Error())
	} else {
		report(fmt.Sprintf("oturumlar: %v", ss))
	}
	for _, s := range []uint32{own, active} {
		if s == noConsoleSession {
			continue
		}
		i, err := k6sSessionInfo(s)
		if err != nil {
			report(fmt.Sprintf("WTSSessionInfoEx(%d) hata: %v", s, err))
			continue
		}
		report(fmt.Sprintf("WTSSessionInfoEx(%d): %s", s, i))
		if i.Level != 1 || i.SessionID != s {
			t.Errorf("WTSINFOEXW düzeni yanlış: level=%d id=%d (beklenen 1, %d)", i.Level, i.SessionID, s)
		}
	}
	report("giriş masaüstü (bu süreçten): " + k6sInputDesktop())
}

func TestK6sLockRestrictedToken(t *testing.T) {
	if os.Getenv(k6sLockEnv) != "1" {
		t.Skip("koşucuyu kilitler; yalnız CI son adımında K6S_KILIT=1 ile (elle: TestK6sElle)")
	}
	report := k6sReporter(t, "P28u K6s soru 1 — kısıtlı jetonla LockWorkStation (CI)")
	own := k6sOwnSession()
	var tok windows.Token
	var err error
	target := own
	if k6sIsSystem() {
		target = windows.WTSGetActiveConsoleSessionId()
		tok, err = helperToken(target)
	} else {
		tok, err = k6sOwnRestrictedToken()
	}
	if err != nil {
		t.Skipf("kısıtlı jeton alınamadı: %v", err)
	}
	defer tok.Close()
	desk := helperDesktop
	if cur := proclimit.CurrentDesktop(); !k6sIsSystem() && cur != "" {
		desk = cur
	}
	before, _ := k6sSessionInfo(target)
	report(fmt.Sprintf("önce: %s giriş masaüstü=%s jeton=%s masaüstü=%s", before, k6sInputDesktop(),
		map[bool]string{true: "helperToken (SYSTEM kısıtlı)", false: "koşucu kullanıcısı kısıtlı (SYSTEM değil)"}[k6sIsSystem()], desk))
	exit, out, err := k6sRunLockChild(tok, desk)
	if err != nil {
		report("çocuk başlatılamadı/bitmedi: " + err.Error())
		return
	}
	report(fmt.Sprintf("çocuk çıkış=%#x çıktı: %s", exit, out))
	flags, after, locked := k6sWaitFlags(target, wtsStateLock, 3*time.Second)
	report(fmt.Sprintf("sonra: SessionFlags=%d(%s) SessionFlags=LOCK görüldü=%v (%d ms) giriş masaüstü=%s", flags, k6sFlagName(flags),
		locked, after.Milliseconds(), k6sInputDesktop()))
}

// ---- elle (SYSTEM, Session 0; testdata/k6s-elle.ps1) ----

func TestK6sElle(t *testing.T) {
	if *k6sElle == "" {
		t.Skip("elle: SYSTEM servis bağlamı (Session 0) gerekir — testdata/k6s-elle.ps1 ile koşulur (docs/spike-p28u-k6s.md)")
	}
	if !k6sIsSystem() || k6sOwnSession() != 0 {
		t.Fatalf("elle spike LocalSystem + Session 0 ister (system=%v oturum=%d)", k6sIsSystem(), k6sOwnSession())
	}
	steps := map[string]bool{}
	for _, s := range strings.Split(*k6sElle, ",") {
		steps[strings.TrimSpace(s)] = true
	}
	all := steps["hepsi"]
	report := k6sReporter(t, "P28u K6s elle")
	report(fmt.Sprintf("başlıyor: adımlar=%s; 10 sn sonra ekran kilitlenecek, her kilitten sonra kilidi açın", *k6sElle))
	time.Sleep(10 * time.Second)

	waitUnlock := func(console uint32) {
		flags, d, ok := k6sWaitFlags(console, wtsStateUnlock, 180*time.Second)
		report(fmt.Sprintf("kilit açılması beklendi: SessionFlags=%d(%s) açıldı=%v (%d ms)", flags, k6sFlagName(flags), ok,
			d.Milliseconds()))
		time.Sleep(3 * time.Second)
	}
	// lockResult SessionFlags'i ayrı sütun olarak ölçer; kilidin asıl kanıtı çocuğun "giriş masaüstü=Winlogon" satırıdır
	// (winlogon). Herhangi biri kilit diyorsa kullanıcının kilidi açması beklenir.
	lockResult := func(label string, console uint32, winlogon bool) {
		flags, d, ok := k6sWaitFlags(console, wtsStateLock, 3*time.Second)
		report(fmt.Sprintf("%s: SessionFlags=%d(%s) SessionFlags=LOCK görüldü=%v (%d ms)", label, flags, k6sFlagName(flags), ok, d.Milliseconds()))
		if ok || winlogon {
			waitUnlock(console)
		}
	}
	console := func() (uint32, bool) {
		c := windows.WTSGetActiveConsoleSessionId()
		i, err := k6sSessionInfo(c)
		if c == noConsoleSession || err != nil || i.User[0] == 0 {
			report(fmt.Sprintf("konsolda kullanıcı yok (id=%#x err=%v) — adım atlandı", c, err))
			return c, false
		}
		report(fmt.Sprintf("konsol: %s", i))
		return c, true
	}

	if all || steps["kilit0"] {
		if c, ok := console(); ok {
			r, _, e := procLockWorkStation.Call()
			report(fmt.Sprintf("kilit0 (Session 0'dan doğrudan LockWorkStation): dönüş=%d hata=%v", r, e))
			lockResult("kilit0", c, false)
		}
	}
	if all || steps["kilit"] {
		if c, ok := console(); ok {
			tok, err := helperToken(c)
			if err != nil {
				report("kilit (helperToken): jeton hatası " + err.Error())
			} else {
				exit, out, err := k6sRunLockChild(tok, helperDesktop)
				tok.Close()
				report(fmt.Sprintf("kilit (helperToken, kısıtlı SYSTEM, %s): çıkış=%#x hata=%v çıktı: %s", helperDesktop, exit, err, out))
				lockResult("kilit", c, strings.Contains(out, "=Winlogon"))
			}
		}
	}
	if all || steps["kilit5b"] {
		if c, ok := console(); ok {
			var tok windows.Token
			if err := windows.WTSQueryUserToken(c, &tok); err != nil {
				report("kilit5b (K-P28u-5b, WTSQueryUserToken): " + err.Error())
			} else {
				exit, out, err := k6sRunLockChild(tok, helperDesktop)
				tok.Close()
				report(fmt.Sprintf("kilit5b (kullanıcı jetonu): çıkış=%#x hata=%v çıktı: %s", exit, err, out))
				lockResult("kilit5b", c, strings.Contains(out, "=Winlogon"))
			}
		}
	}
	if all || steps["kapat"] {
		k6sLogoff(report, console)
	}
	report("bitti")
}

// k6sLogoff WTSLogoffSession(bWait=FALSE) sonrası 60 sn boyunca 500 ms'de bir etkin konsol kimliği, durumu ve eski
// oturumun varlığı yoklanır; yalnız değişimler yazılır (R-P28u-2: yeni oturumun belirme süresi ≤ 20 sn bütçesi).
func k6sLogoff(report func(string), console func() (uint32, bool)) {
	old, ok := console()
	if !ok {
		return
	}
	start := time.Now()
	r, _, e := procWTSLogoffSession.Call(0, uintptr(old), 0)
	report(fmt.Sprintf("kapat: WTSLogoffSession(%d, bWait=FALSE) dönüş=%d hata=%v (%d ms)", old, r, e,
		time.Since(start).Milliseconds()))
	last := ""
	for time.Since(start) < 60*time.Second {
		act := windows.WTSGetActiveConsoleSessionId()
		desc := "yok"
		if i, err := k6sSessionInfo(act); err == nil {
			desc = i.String()
		}
		ss, _ := k6sSessions()
		_, oldAlive := ss[old]
		cur := fmt.Sprintf("etkin konsol=%#x [%s] eski(%d) var=%v", act, desc, old, oldAlive)
		if cur != last {
			report(fmt.Sprintf("kapat +%d ms: %s", time.Since(start).Milliseconds(), cur))
			last = cur
		}
		time.Sleep(500 * time.Millisecond)
	}
}
