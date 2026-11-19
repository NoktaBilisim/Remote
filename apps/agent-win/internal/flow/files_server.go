package flow

import (
	"context"
	"io"
	"slices"
	"time"

	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// P28b sunucu üzerinden dosya, misafir tarafı (mimari-p28b §5, §8). Mod ilk `hello`'da BİR KEZ sabitlenir (AC-355; yeniden
// bağlanma hello'su değiştiremez). SERVER modunda:
//   - Teknisyenin dosyası `fsrv.offer{FILE}` ile gelir → mevcut kabul diyaloğu (AC-36/116: temiz ad, tehlikeli uzantı
//     uyarısı, 30 sn ret beklemesi) → `fsrv.accept` → `fsrv.download` → HTTPS akışı `Downloads\<ad>.part` → boyut + SHA
//     → MOTW → yeniden adlandırma → `fsrv.result`. DC yanıtı ve `file.meta` GÖNDERİLMEZ (sunucu satırı kendisi yazar).
//   - DC dosya kanalı reddedilir: caps'te `file_transfer` yok (sunucu çıkarır) → rtc `file.offer`'a otomatik
//     `file.reject` döner ve `file` çerçeveleri alıcısız düşer; akış ayrıca SERVER modunda DC teklifini reddeder.
//   - Yazdırma `serverPrintSource` ile (clipprint_print.go). Yetenek kuralı: SERVER odasında sunucu caps'ten `print` ve
//     `file_transfer`'ı çıkarır; yetki kapısı sunucudadır (fsrv.init adım 2, print.request) — misafir SERVER modunda bu
//     iki caps değerini aramaz, yalnız WS'den gelen kimlik/teklif eşleşmesine bakar.
//   - Gözetimsiz yardımcı fsrv bildirmez (Features) → sunucu `fileMode` göndermez → mod P2P kalır, dosya zaten kapalı.
//   - Dosya adı ve içerik hiçbir log/diag'a yazılmaz (D-P28a-3; bu dosyada log yoktur).

// FileServer internal/fsrv.Client (HTTPS indirme). Download w'ye en çok limit bayt akıtır; ctx iptali isteği keser.
type FileServer interface {
	Download(ctx context.Context, fid, token string, limit int64, w io.Writer) (int64, error)
}

// FileServerUI internal/ui: SERVER modu bilgi satırı (AC-363) ve dosya alanı durum metinleri. Çağrılar engellemez.
type FileServerUI interface {
	// FileServerMode oturumun dosya modu (ilk hello'da bir kez): true → dosya alanında AC-363 satırı.
	FileServerMode(server bool)
	// FileServerStatus dosya alanı durumu; final (virüs/taranamadı) metin sohbet geçmişine "Sistem" satırı olarak da düşer.
	FileServerStatus(text string, final bool)
}

// srvDownload kabul edilmiş FILE teklifi: indirme belirteci bekleniyor ya da akış sürüyor.
type srvDownload struct {
	fid, name, sha string
	size           int64
	tries          int // gönderilen fsrv.result{ok:false} sayısı (fid başına ≤ 3 belirteç)
	stream         *transfer.Stream
	cancel         context.CancelFunc
	done           chan struct{} // akış goroutine'i bitti
}

// srvFiles SERVER modu dosya alımı (yalnız döngüden).
type srvFiles struct {
	asking      *signal.FsrvOffer
	cur         *srvDownload
	rejectUntil time.Time
	// pendingCancel kopuşta yarım kalan fid'ler (yeni sokette fsrv.cancel).
	pendingCancel []string
}

func (f *srvFiles) busy() bool { return f != nil && (f.asking != nil || f.cur != nil) }

// fsrvDeclared bu soket fsrv bildirdi (Features ile aynı kural).
func (s *session) fsrvDeclared() bool { return slices.Contains(Features(s.d), signal.FeatureFsrv) }

// fixFileMode ilk hello'da modu sabitler; sonraki hello'lar (yeniden bağlanma) yok sayılır (AC-355).
func (s *session) fixFileMode(h signal.Hello) {
	if s.fileMode != "" {
		return
	}
	s.fileMode = signal.FileModeP2P
	if s.fsrvDeclared() && h.FileMode == signal.FileModeServer {
		s.fileMode = signal.FileModeServer
		s.srv = &srvFiles{}
	}
	s.cp.setSource(s.serverMode(), s.d.FileServer)
	if s.d.FileServerUI != nil {
		s.d.FileServerUI.FileServerMode(s.serverMode())
	}
}

func (s *session) serverMode() bool { return s.fileMode == signal.FileModeServer }

// post kapanışı döngüde çalıştırır (goroutine sonuçları).
func (s *session) post(ctx context.Context, f func()) {
	select {
	case s.peerEv <- peerEvent{run: f}:
	case <-ctx.Done():
	}
}

func (s *session) onFsrv(ctx context.Context, m signal.Inbound) {
	switch m := m.(type) {
	case signal.FsrvOffer:
		if m.Purpose == signal.FsrvPurposePrint {
			s.cp.onFsrvOffer(m)
			return
		}
		s.onFsrvFileOffer(ctx, m)
	case signal.FsrvDownload:
		if s.cp.onFsrvDownload(m) {
			return
		}
		if c := s.srvCur(); c != nil && c.fid == m.FID && c.stream == nil {
			s.startDownload(ctx, c, m.Token)
		}
	case signal.FsrvStatus:
		s.onFsrvStatus(m)
	case signal.FsrvUpload:
		// Misafir istemci yükleme başlatmaz (Windows istemcide "Dosya gönder" yok); beklenmeyen belirteç yok sayılır.
	}
}

func (s *session) srvCur() *srvDownload {
	if s.srv == nil {
		return nil
	}
	return s.srv.cur
}

func (s *session) onFsrvFileOffer(ctx context.Context, m signal.FsrvOffer) {
	reject := func() { s.send(ctx, signal.FsrvReject{T: "fsrv.reject", FID: m.FID}) }
	if s.srv == nil || s.files == nil {
		reject()
		return
	}
	limit := s.fileLimit()
	if s.srv.busy() || s.cp.printBusy() || s.d.Now().Before(s.srv.rejectUntil) || m.Size > limit {
		reject()
		return
	}
	s.srv.asking = &m
	name := files.ReceivedName(m.Name) // S-P28g-6 m.3: diske yazılacak ad
	s.lastPct = -1
	s.d.UI.FileOffer(transfer.Prompt{FID: m.FID, Name: name, Size: m.Size, Warning: files.NameWarning(name)})
}

// fileLimit kabul edilebilir en büyük dosya: tenant sınırı (hello.maxFileMb) ∧ 256 MiB; indirme klasörü yoksa -1.
func (s *session) fileLimit() int64 { return min(s.files.Limit(), signal.FsrvMaxBytes) }

// onFsrvDecide kabul diyaloğu kararı (SERVER modu).
func (s *session) onFsrvDecide(ctx context.Context, fid string, accept bool) {
	o := s.srv.asking
	if o == nil || o.FID != fid {
		return
	}
	s.srv.asking = nil
	name := files.ReceivedName(o.Name)
	if !accept {
		s.srv.rejectUntil = s.d.Now().Add(transfer.RejectCooldown)
		s.send(ctx, signal.FsrvReject{T: "fsrv.reject", FID: fid})
		s.d.UI.FileResult(transfer.Result{Name: name, Status: "REJECTED"})
		return
	}
	s.srv.cur = &srvDownload{fid: fid, name: name, sha: o.SHA256, size: o.Size}
	s.send(ctx, signal.FsrvAccept{T: "fsrv.accept", FID: fid})
}

// startDownload `.part` açar ve akışı ayrı goroutine'de başlatır; sonuç döngüye kapanışla döner.
func (s *session) startDownload(ctx context.Context, c *srvDownload, token string) {
	st, err := s.files.OpenStream(c.name, c.size, c.sha)
	if err != nil {
		s.srv.cur = nil
		s.send(ctx, signal.FsrvCancel{T: "fsrv.cancel", FID: c.fid})
		s.d.UI.FileResult(transfer.Result{Name: c.name, Status: "REJECTED"})
		return
	}
	dctx, cancel := context.WithCancel(ctx)
	c.stream, c.cancel, c.done = st, cancel, make(chan struct{})
	pw := &progressWriter{w: st, total: c.size, last: -1, report: func(done int64) {
		s.post(dctx, func() {
			if s.srvCur() == c {
				s.d.UI.FileProgress(done, c.size)
			}
		})
	}}
	fs := s.d.FileServer
	go func() {
		defer close(c.done)
		_, derr := fs.Download(dctx, c.fid, token, c.size, pw)
		select {
		case s.peerEv <- peerEvent{run: func() { s.onDownloaded(ctx, c, derr) }}:
		case <-dctx.Done(): // iptal / oturum sonu: sonuç döngüye dönmez, `.part` burada silinir
			st.Abort()
		}
	}()
}

// onDownloaded akış bitti: doğrula/yerleştir ya da yeni belirteçle yeniden dene (fid başına ≤ 3).
func (s *session) onDownloaded(ctx context.Context, c *srvDownload, err error) {
	c.cancel()
	if s.srvCur() != c {
		c.stream.Abort()
		return
	}
	r := transfer.Result{Name: c.name, Status: "CORRUPT"}
	if err == nil {
		r = c.stream.Commit()
	} else {
		c.stream.Abort()
	}
	switch r.Status {
	case "OK":
		s.srv.cur = nil
		s.send(ctx, signal.FsrvResult{T: "fsrv.result", FID: c.fid, OK: true})
		s.d.UI.FileResult(r)
		return
	case "REJECTED": // MOTW yazılamadı + tehlikeli tür: dosya teslim alınmaz, teklif geri çekilir
		s.srv.cur = nil
		s.send(ctx, signal.FsrvCancel{T: "fsrv.cancel", FID: c.fid})
		s.d.UI.FileResult(r)
		return
	}
	c.tries++
	s.send(ctx, signal.FsrvResult{T: "fsrv.result", FID: c.fid, OK: false})
	if c.tries < signal.FsrvDownloadTokensPerFile {
		c.stream, c.cancel, c.done = nil, nil, nil
		s.send(ctx, signal.FsrvAccept{T: "fsrv.accept", FID: c.fid}) // yeni belirteç
		return
	}
	s.srv.cur = nil
	s.d.UI.FileResult(transfer.Result{Name: c.name, Status: "CORRUPT"})
}

// cancelFsrv müşterinin "Aktarımı iptal et" düğmesi (SERVER modu).
func (s *session) cancelFsrv(ctx context.Context) {
	c := s.srvCur()
	if c == nil {
		return
	}
	s.send(ctx, signal.FsrvCancel{T: "fsrv.cancel", FID: c.fid})
	s.d.UI.FileResult(transfer.Result{Name: c.name, Status: "CANCELLED"})
	s.dropDownload(c)
}

// dropDownload alımı bırakır; akış sürüyorsa goroutine'in dönmesi beklenir ve `.part` burada silinir (AC-108; geç
// gelen sonuç kapanışının Abort'u zararsız).
func (s *session) dropDownload(c *srvDownload) {
	s.srv.cur = nil
	if c.stream == nil {
		return
	}
	c.cancel()
	<-c.done
	c.stream.Abort()
}

// resetFsrv WS koptu (yeniden bağlanma): soketle giden kararlar kaybolmuş olabilir; açık teklif/alım yerelde
// CANCELLED biter ve fid'leri yeni hello'dan sonra `fsrv.cancel` ile bildirilir (sunucudaki yön yuvası boşalır).
func (s *session) resetFsrv() {
	if s.srv == nil {
		return
	}
	if o := s.srv.asking; o != nil {
		s.srv.asking = nil
		s.srv.pendingCancel = append(s.srv.pendingCancel, o.FID)
		s.d.UI.FileOfferWithdrawn(o.FID)
		s.d.UI.FileResult(transfer.Result{Name: files.ReceivedName(o.Name), Status: "CANCELLED"})
	}
	if c := s.srv.cur; c != nil {
		s.srv.pendingCancel = append(s.srv.pendingCancel, c.fid)
		s.d.UI.FileResult(transfer.Result{Name: c.name, Status: "CANCELLED"})
		s.dropDownload(c)
	}
}

// flushFsrvCancels yeniden bağlanma hello'sundan sonra bekleyen iptaller.
func (s *session) flushFsrvCancels(ctx context.Context) {
	if s.srv == nil {
		return
	}
	for _, fid := range s.srv.pendingCancel {
		s.send(ctx, signal.FsrvCancel{T: "fsrv.cancel", FID: fid})
	}
	s.srv.pendingCancel = nil
}

// onFsrvStatus durum: teklif geri çekildi / alım iptal edildi; tarama ilerlemesi ve sonuç metinleri dosya alanında.
func (s *session) onFsrvStatus(m signal.FsrvStatus) {
	if s.srv != nil && m.FID != "" {
		if o := s.srv.asking; o != nil && o.FID == m.FID && m.State == "CANCELLED" {
			s.srv.asking = nil
			s.d.UI.FileOfferWithdrawn(m.FID)
			s.d.UI.FileResult(transfer.Result{Name: files.ReceivedName(o.Name), Status: "CANCELLED"})
			return
		}
		if c := s.srv.cur; c != nil && c.fid == m.FID && m.State == "CANCELLED" {
			s.d.UI.FileResult(transfer.Result{Name: c.name, Status: "CANCELLED"})
			s.dropDownload(c)
			return
		}
	}
	// Sonuç/diğer durumlar ("" ) dosya alanını temizler: yazdırma yüklemesi ya da teklif öncesi iptal FileResult'a
	// ulaşmaz, "Virüs taraması yapılıyor" asılı kalmaz.
	if s.d.FileServerUI != nil {
		text, final := fsrvStatusText(m)
		s.d.FileServerUI.FileServerStatus(text, final)
	}
}

// closeFsrv oturum sonu: süren akış durur, `.part` silinir (AC-108: iz yok).
func (s *session) closeFsrv() {
	if c := s.srvCur(); c != nil {
		s.dropDownload(c)
	}
}

// progressWriter yüzde değiştikçe report çağırır (akış goroutine'inden).
type progressWriter struct {
	w      io.Writer
	total  int64
	n      int64
	last   int64
	report func(done int64)
}

func (p *progressWriter) Write(b []byte) (int, error) {
	k, err := p.w.Write(b)
	p.n += int64(k)
	if p.total > 0 {
		if pct := p.n * 100 / p.total; pct != p.last {
			p.last = pct
			p.report(p.n)
		}
	}
	return k, err
}
