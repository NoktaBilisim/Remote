package flow

import (
	"context"
	"errors"
	"slices"
	"time"
	"unicode/utf8"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28a pano + uzaktan yazdırma, misafir tarafı (mimari-p28 §4.3–4.5, §5.3, r2 §14). Bütün durum akış döngüsünde
// tutulur (kilitsiz); uzun işler (PDF inceleme, basma) ayrı goroutine'de çalışır ve sonucu döngüye kapanış olarak döner.
// Kurallar (bağlayıcı):
//   - Alıcı kuralı (§4.4): mesaj yalnız `caps`'te ilgili değer varsa, kimlik WS'den gelmiş ve hâlâ bekliyorsa, pano için
//     anahtar açık VE kontrol kapısı açıksa, yazdırma için kontrol kapısı açıksa uygulanır; denetim panoya yazmadan /
//     basmadan HEMEN ÖNCE yinelenir (AC-344).
//   - O-P28a-1: misafir son tarihi (pano 8 sn, yazdırma aktarım + inceleme 8 dk), yön bağı (push cid'i yalnız gelen
//     `clip.data`'yı, pid yalnız offer/çerçeve/done'u yetkiler), tek kullanım (son 64 kimlik), WS kopmasında temizlik.
//   - O-P28a-2: pid başına tek `print.offer`, `print.done` sonrası tampon değişmez, `idx` sahiplik tablosu (yazdırma
//     baytları dosya alıcısına gitmez; son 64 `idx` yeniden kullanılmaz).
//   - Y-P28a-1: kontrol kapısı kapanınca bekleyen yazdırma yerelde CANCELLED biter, işlem iptal edilir, diyalog kapanır.
//   - D-P28a-3: içerik ve dosya adı hiçbir log/diag/durum satırına/WS mesajına yazılmaz (bu dosyada log yoktur).

// Clipboard K4 (`internal/clip`) uygular. Çağrılar akış döngüsünden yapılır; uygulama pano işini kendi gizli pencereli
// iş parçacığında, 2 sn sınırla yapar (D-P28a-2). Metin UTF-8'dir; satır sonu dönüştürülmez (AC-345).
type Clipboard interface {
	// Read CF_UNICODETEXT okur. Hata: ErrClipEmpty, ErrClipSensitive (dört biçim; içerik okunmaz), ErrClipTooLarge
	// (GlobalSize sınırı); diğer her hata ERROR sayılır.
	Read() ([]byte, error)
	// Write metni + geçmiş/bulut dışı biçimleri tek açık oturumda yazar.
	Write(text []byte) error
}

// Printer K4 (`internal/printing`) uygular. Inspect ve Print akış döngüsü DIŞINDA çağrılır; ctx iptali (print.cancel,
// kontrol kapanışı, kopma) işleyici job'unu kapatmalıdır. pdf değişmez dilimdir: uygulama değiştirmez, saklamaz, diske
// yazmaz.
type Printer interface {
	// DefaultPrinter varsayılan yazıcı adı; yoksa ok=false (NO_PRINTER, diyalog açılmaz).
	DefaultPrinter() (name string, ok bool)
	// Inspect işleyici süreçle sayfa sayısı. Bozuk/parola korumalı → ErrPrintInvalidPDF.
	Inspect(ctx context.Context, pdf []byte) (pages int, err error)
	// Print sayfaları varsayılan yazıcıya basar (EndDoc başarısı = nil). Yazıcı kaybolduysa ErrNoPrinter.
	Print(ctx context.Context, pdf []byte, pages int) error
}

// PagesUnknownPrinter r4 (mimari-p28f "K5 uygulama notu", ADR-0037 m.8a): Printer bunu uygulayıp true dönerse Inspect
// sayfa sayısı vermez (0) ve onInspected `pages ≥ 1` şartını atlar; diyalog "Sayfa sayısı: yazıcıda belirlenir" gösterir.
// Yalnız macOS lp yazıcısı bildirir; Windows yolu değişmez.
type PagesUnknownPrinter interface {
	PagesUnknown() bool
}

// pagesUnknown p sayfa sayısını hesaplamayan yazıcı mı.
func pagesUnknown(p Printer) bool {
	u, ok := p.(PagesUnknownPrinter)
	return ok && u.PagesUnknown()
}

// ClipPrintUI K5 (`internal/ui`) uygular; çağrılar engellemez (UI iş parçacığına iletilir). Kullanıcı kararları Event
// olarak döner: EvClipConsent{On} (yalnız gerçek yerel girdiyle, D-P28a-1), EvPrintApprove/EvPrintReject{PID}
// (G-03 kuralları: Reddet varsayılan, Yazdır 1,5 sn kilitli, enjekte tıklama yok sayılır).
type ClipPrintUI interface {
	// ClipSwitch anahtarın görünür/etkin/işaretli durumu; görünüm yalnız buradan yazılır (BM_SETCHECK(mantık)).
	ClipSwitch(st ClipSwitchState)
	// PrintPrompt onay diyaloğu (60 sn; aynı anda tek).
	PrintPrompt(p PrintPrompt)
	// PrintPromptClosed akış diyaloğu karar verilmeden kapatır (zaman aşımı, iptal, kontrol kapanışı, kopma).
	PrintPromptClosed(pid string)
	// Notice 3 sn bildirim satırı (ClipPrintTexts dışı sabit metinler; içerik yok).
	Notice(text string)
}

// ClipSwitchState pano anahtarı: Visible yalnız `clipboard` yeteneği varken, Enabled yalnız kontrol kapısı açıkken.
type ClipSwitchState struct {
	Visible, Enabled, On bool
}

// PrintPrompt onay diyaloğu verisi. FileName temizlenmiş ve gösterim süzgecinden geçmiştir (G-06).
type PrintPrompt struct {
	PID      string
	TechName string
	FileName string
	Pages    int
	// PagesUnknown r4 (macOS): sayfa sayısı istemcide hesaplanmadı (Pages 0); UI "Sayfa sayısı: yazıcıda belirlenir" yazar.
	PagesUnknown bool
	Size         int64 // alınan bayt (diyalogda "Boyut")
	Printer      string
	Deadline     time.Time
}

// Akışa dönen tipli hatalar (K4 uygulamaları sarmalayabilir; errors.Is ile sınıflandırılır).
var (
	ErrClipEmpty       = errors.New("flow: pano boş")
	ErrClipSensitive   = errors.New("flow: pano gizli olarak işaretli")
	ErrClipTooLarge    = errors.New("flow: pano metni çok büyük")
	ErrPrintInvalidPDF = errors.New("flow: PDF açılamadı")
	ErrNoPrinter       = errors.New("flow: varsayılan yazıcı yok")
)

const (
	capClipboard = "clipboard"
	capPrint     = "print"

	clipDeadline    = signal.ClipGuestDeadlineMs * time.Millisecond
	printDeadline   = signal.PrintGuestTransferMs * time.Millisecond
	printConsentFor = signal.PrintConsentTimeoutMs * time.Millisecond
)

// Features Dial'a verilecek özellik belirteçleri: yalnız uygulaması bağlı özellik bildirilir; gözetimsiz yardımcı hiç
// bildirmez (onay gerektiren özellikler, O-P28a-4).
// P28b: `rs.cap.fsrv1` yalnız FileServer + FileServerUI bağlıyken (gözetimsiz/servis yolunda hiç).
func Features(d Deps) []string {
	var f []string
	if d.RosterUI != nil { // P28c: liste/gösterge çizebilen arayüz (yardımcı dahil — AC-364 gözetimsizde daveti ister)
		f = append(f, signal.FeatureMulti)
	}
	if d.Unattended {
		return f
	}
	if d.ClipPrintUI != nil && d.Clipboard != nil {
		f = append(f, signal.FeatureClip)
	}
	if d.ClipPrintUI != nil && d.Printer != nil {
		f = append(f, signal.FeaturePrint)
	}
	if d.FileServer != nil && d.FileServerUI != nil {
		f = append(f, signal.FeatureFsrv)
	}
	if recUI(d) != nil { // P28e: gösterge/şerit çizebilen arayüz (K-P28e-7)
		f = append(f, signal.FeatureRec)
	}
	if voiceOn(d) { // P28d O-PD-3: gözetimsizde yok (yukarıdaki erken dönüş + voiceOn)
		f = append(f, signal.FeatureVoice)
	}
	return f
}

// cpDeps clipPrint'in dış dünyası (testte sahte).
type cpDeps struct {
	clip    Clipboard
	printer Printer
	ui      ClipPrintUI
	// after d sonra f'yi döngüde çalıştırır; dönen işlev zamanlayıcıyı durdurur.
	after func(d time.Duration, f func()) (stop func() bool)
	// spawn op'u ayrı goroutine'de çalıştırır, döndürdüğü kapanışı döngüde çalıştırır.
	spawn     func(op func() func())
	send      func(signal.Outbound)
	sendCtl   func([]byte) error
	gateOpen  func() bool
	hasCap    func(string) bool
	filesBusy func() bool
	techName  func() string
	status    func(string)
	now       func() time.Time
}

type clipJob struct {
	cid  string
	asm  *dc.ClipAssembler
	stop func() bool
}

// clipPrint misafir tarafı durum makinesi (session'a aittir, yalnız döngüden çağrılır).
type clipPrint struct {
	d       cpDeps
	ctx     context.Context
	cancel  context.CancelFunc
	clipOK  bool // clipboard özelliği bildirildi
	printOK bool // print özelliği bildirildi
	clipOn  bool // müşteri anahtarı (her oturumda kapalı başlar)
	clip    *clipJob
	print   *printJob
	seenIDs []string // son 64 cid/pid (tek kullanım)
	seenIdx []uint16 // son 64 file/print idx
	// P28b: server ilk hello'da sabitlenen SERVER modu; src yazdırma bayt kaynağı (print_source.go).
	server  bool
	src     PrintSource
	dropped uint64 // alıcı kuralına takılıp düşen mesaj sayısı
}

// newClipPrint features = Dial'a verilen belirteçler (Features): yalnız bildirilen özellik işlenir.
func newClipPrint(ctx context.Context, d cpDeps, features []string) *clipPrint {
	cx, cancel := context.WithCancel(ctx)
	c := &clipPrint{d: d, ctx: cx, cancel: cancel, src: dcPrintSource{}}
	c.clipOK = d.ui != nil && d.clip != nil && slices.Contains(features, signal.FeatureClip)
	c.printOK = d.ui != nil && d.printer != nil && slices.Contains(features, signal.FeaturePrint)
	return c
}

// newClipPrint oturumun pano/yazdırma durum makinesi: zamanlayıcı ve goroutine sonuçları peerEv üzerinden döngüye döner.
func (s *session) newClipPrint(ctx context.Context) *clipPrint {
	var c *clipPrint
	post := func(f func()) {
		select {
		case s.peerEv <- peerEvent{run: f}:
		case <-c.ctx.Done():
		}
	}
	c = newClipPrint(ctx, cpDeps{
		clip: s.d.Clipboard, printer: s.d.Printer, ui: s.d.ClipPrintUI,
		after: func(d time.Duration, f func()) func() bool { return time.AfterFunc(d, func() { post(f) }).Stop },
		spawn: func(op func() func()) { go func() { post(op()) }() },
		send:  func(m signal.Outbound) { s.send(ctx, m) },
		sendCtl: func(b []byte) error {
			p := s.mainPeer() // P28c: pano/yazdırma yalnız kontrol sahibiyle
			if p == nil {
				return rtc.ErrNoCtl
			}
			return p.SendCtl(b)
		},
		gateOpen:  s.gate.IsOpen,
		hasCap:    s.hasCap,
		filesBusy: func() bool { return (s.files != nil && s.files.Busy()) || s.srv.busy() },
		techName:  func() string { return s.techName },
		status:    s.d.UI.Status,
		now:       s.d.Now,
	}, Features(s.d))
	return c
}

// remember kimliği tek kullanımlık kaydeder; daha önce görüldüyse false.
func (c *clipPrint) remember(id string) bool {
	if slices.Contains(c.seenIDs, id) {
		return false
	}
	c.seenIDs = append(c.seenIDs, id)
	if len(c.seenIDs) > signal.IDReuseWindow {
		c.seenIDs = c.seenIDs[1:]
	}
	return true
}

func (c *clipPrint) rememberIdx(idx uint16) {
	c.seenIdx = append(c.seenIdx, idx)
	if len(c.seenIdx) > signal.IDReuseWindow {
		c.seenIdx = c.seenIdx[1:]
	}
}

// fileIdx gelen `file.offer` idx'i: etkin yazdırmanın idx'iyse dosya teklifi reddedilmeli (false); değilse kaydedilir.
func (c *clipPrint) fileIdx(idx int) bool {
	if c == nil {
		return true
	}
	if c.print != nil && c.print.owns && int(c.print.idx) == idx {
		return false
	}
	c.rememberIdx(uint16(idx))
	return true
}

// clipAllowed §4.4 (c): yetenek + anahtar + kontrol kapısı. Panoya dokunmadan hemen önce de çağrılır (AC-344).
func (c *clipPrint) clipAllowed() bool {
	return c.clipOK && c.clipOn && c.d.hasCap(capClipboard) && c.d.gateOpen()
}

func (c *clipPrint) syncSwitch() {
	if !c.clipOK {
		return
	}
	c.d.ui.ClipSwitch(ClipSwitchState{Visible: c.d.hasCap(capClipboard), Enabled: c.d.gateOpen(), On: c.clipOn})
}

// onServer WS iletimleri. Özellik bildirilmediyse yok sayılır (sunucu zaten iletmez; misafir şeması rapora 1008 verirdi).
func (c *clipPrint) onServer(m signal.Inbound) {
	switch m := m.(type) {
	case signal.ClipConsent:
		if c.clipOK && !m.On && c.clipOn { // sunucu kapattı: yanıt yok
			c.clipOn = false
			c.endClip("DENIED")
			c.syncSwitch()
		}
	case signal.ClipPush:
		c.onClipPush(m)
	case signal.ClipPull:
		c.onClipPull(m)
	case signal.PrintRequest:
		c.onPrintRequest(m)
	case signal.PrintCancel:
		if c.print != nil && c.print.pid == m.PID {
			c.finishPrint("CANCELLED")
		}
	}
}

// onUser müşteri kararları (anahtar, yazdırma onayı).
func (c *clipPrint) onUser(ev Event) {
	switch ev.Kind {
	case EvClipConsent:
		if !c.clipOK {
			return
		}
		on := ev.On && c.d.hasCap(capClipboard) && c.d.gateOpen()
		if on != c.clipOn {
			c.clipOn = on
			c.d.send(signal.ClipConsentSet{T: "clip.consent", On: on})
			if !on {
				c.endClip("DENIED")
			}
		}
		c.syncSwitch() // reddedilen açma isteğinde görünüm mantığa geri çekilir (D-P28a-1)
	case EvPrintApprove, EvPrintReject:
		c.onPrintDecision(ev.PID, ev.Kind == EvPrintApprove)
	}
}

func (c *clipPrint) clipReport(cid, dir string, n int, result string) {
	c.d.send(signal.ClipReport{T: "clip.report", CID: cid, Dir: dir, Bytes: n, Result: result})
}

func (c *clipPrint) onClipPush(m signal.ClipPush) {
	if !c.clipOK {
		return
	}
	if !c.remember(m.CID) || c.clip != nil || !c.clipAllowed() {
		c.dropped++
		c.clipReport(m.CID, "TO_CUSTOMER", 0, "DENIED")
		return
	}
	j := &clipJob{cid: m.CID, asm: dc.NewClipAssembler(m.Bytes)}
	c.clip = j
	j.stop = c.d.after(clipDeadline, func() {
		if c.clip == j {
			c.endClip("TIMEOUT")
		}
	})
	b, err := dc.ClipReady(m.CID)
	if err != nil || c.d.sendCtl(b) != nil {
		c.endClip("ERROR")
	}
}

// endClip bekleyen push işini sonuçla bitirir (bayt 0) ve kimliği siler.
func (c *clipPrint) endClip(result string) {
	j := c.clip
	if j == nil {
		return
	}
	c.clip = nil
	j.stop()
	j.asm.Wipe()
	c.clipReport(j.cid, "TO_CUSTOMER", 0, result)
}

func (c *clipPrint) onClipData(m dc.Ctl) {
	j := c.clip
	if j == nil || m.CID != j.cid { // yalnız bekleyen push cid'i gelen veriyi yetkiler (pull cid'i dahil, yön bağı)
		c.dropped++
		return
	}
	text, done, err := j.asm.Add(m)
	switch {
	case err != nil:
		c.endClip("INVALID")
	case !done:
	case !c.clipAllowed(): // AC-344: anahtar/kapı kapandıktan sonra gelen veri uygulanmaz
		c.endClip("DENIED")
	default:
		werr := c.d.clip.Write(text)
		n := len(text)
		c.clip = nil
		j.stop()
		j.asm.Wipe()
		if werr != nil {
			c.clipReport(j.cid, "TO_CUSTOMER", 0, "ERROR")
			return
		}
		c.clipReport(j.cid, "TO_CUSTOMER", n, "OK")
		c.d.ui.Notice(noticeClipPut)
	}
}

func (c *clipPrint) onClipPull(m signal.ClipPull) {
	if !c.clipOK {
		return
	}
	if !c.remember(m.CID) || c.clip != nil || !c.clipAllowed() {
		c.dropped++
		c.clipReport(m.CID, "TO_TECH", 0, "DENIED")
		return
	}
	text, err := c.d.clip.Read()
	defer clear(text)
	result := clipReadResult(text, err)
	if result != "OK" {
		c.clipReport(m.CID, "TO_TECH", 0, result)
		return
	}
	frames, ferr := dc.ClipChunks(m.CID, text)
	for _, f := range frames {
		if ferr == nil {
			ferr = c.d.sendCtl(f)
		}
		clear(f)
	}
	if ferr != nil {
		c.clipReport(m.CID, "TO_TECH", 0, "ERROR")
		return
	}
	c.clipReport(m.CID, "TO_TECH", len(text), "OK")
	c.d.ui.Notice(noticeClipRead)
}

// clipReadResult okuma sonucunu rapor sonucuna çevirir (içerik yalnız sınır denetiminde kullanılır).
func clipReadResult(text []byte, err error) string {
	switch {
	case errors.Is(err, ErrClipSensitive):
		return "SENSITIVE"
	case errors.Is(err, ErrClipEmpty):
		return "EMPTY"
	case errors.Is(err, ErrClipTooLarge):
		return "TOO_LARGE"
	case err != nil:
		return "ERROR"
	case len(text) == 0:
		return "EMPTY"
	case len(text) > dc.ClipMaxBytes:
		return "TOO_LARGE"
	case !utf8.Valid(text) || slices.Contains(text, 0):
		return "INVALID"
	}
	return "OK"
}

// onCtl P28a ctl mesajları (yetenek filtresi rtc'de uygulandı).
func (c *clipPrint) onCtl(m dc.Ctl) {
	if c == nil {
		return
	}
	switch m.T {
	case "clip.data":
		c.onClipData(m)
	case "print.offer":
		c.onPrintOffer(m)
	case "print.done":
		c.onPrintDone(m.PID)
	default: // clip.ready / print.ready yalnız misafirden teknisyene gider
		c.dropped++
	}
}

// controlOpened kontrol izni verildi: anahtar etkinleşir (kendiliğinden açılmaz).
func (c *clipPrint) controlOpened() {
	if c != nil {
		c.syncSwitch()
	}
}

// controlClosed kapı kapandı (kısayol, "Kontrolü kapat", revoke, kopma, oturum sonu): anahtar yerelde kapanır (WS
// `clip.consent` gönderilmez — sunucu VIEW'a alırken kendisi kapatır), bekleyen pano işi DENIED, yazdırma CANCELLED.
func (c *clipPrint) controlClosed() {
	if c == nil {
		return
	}
	c.clipOn = false
	c.endClip("DENIED")
	if c.print != nil {
		c.finishPrint("CANCELLED")
		c.d.status(statusPrintCanceled)
	}
	c.syncSwitch()
}

// capsChanged yetenekler değişti (hello, caps.update): giden yeteneğin işi kapanır; anahtar yerelde kapanır.
func (c *clipPrint) capsChanged() {
	if c == nil {
		return
	}
	if !c.d.hasCap(capClipboard) {
		c.clipOn = false
		c.endClip("DENIED")
	}
	if !c.printCap() && c.print != nil {
		c.finishPrint("CANCELLED")
	}
	c.syncSwitch()
}

// reset WS koptu / yeni soket (O-P28a-1 m.4): bekleyen bütün kimlikler RAPORSUZ silinir (sunucu kendisi DISCONNECTED
// üretir), anahtar kapanır, süren işlem iptal edilir, açık diyalog kapanır. Son 64 kimlik/idx korunur (tek kullanım).
func (c *clipPrint) reset() {
	if c == nil {
		return
	}
	c.clipOn = false
	if j := c.clip; j != nil {
		c.clip = nil
		j.stop()
		j.asm.Wipe()
	}
	if c.print != nil {
		c.dropPrint()
	}
	c.syncSwitch()
}

// close oturum sonu.
func (c *clipPrint) close() {
	if c == nil {
		return
	}
	c.reset()
	c.cancel()
}
