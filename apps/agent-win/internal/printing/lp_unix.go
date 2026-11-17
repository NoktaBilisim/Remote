//go:build darwin || linux

package printing

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

// CUPS `lp` ile yazdırma (mimari-p28f §2 `printing/lp_unix.go`, §5.1 T9, S-P28f-16; P28g aynı dosyayı kullanır).
// PDF ayrıştırması bu süreçte değil cupsd filtrelerindedir. Komut mutlak yol + sabit argümanlardır (kabuk yok); `-d` ve
// `lpstat` yoktur — lp sistemin varsayılan yazıcısını kullanır, yazıcı adı hiçbir zaman argüman olmaz. Ortamdan
// LPDEST/PRINTER silinir (varsayılanı yönlendiremesin). PDF stdin'den akar, diske yazılmaz. lp'nin hata metni macOS'ta
// sistem dilindedir (LC_ALL etkisiz, ölçüldü) → metin ayrıştırılmaz: lp'nin sıfır dışı çıkışı "yazıcı yok" sayılır
// (tasarım §2: "varsayılan yazıcı yoksa lp hatası → yazıcı yok"), stderr okunmaz.

// lpPath CUPS istemcisi; yalnız testler sahte lp ile değiştirir (lp_unix_test.go).
var lpPath = "/usr/bin/lp"

// lpArgs sabit argümanlar (S-P28f-16).
var lpArgs = []string{"-n", "1", "-t", "Nokta Destek", "-o", "document-format=application/pdf", "-"}

// lpWaitDelay ctx iptalinden sonra G/Ç boruları için en uzun bekleme.
const lpWaitDelay = 2 * time.Second

// lpEnv ebeveyn ortamı LPDEST ve PRINTER olmadan.
func lpEnv(parent []string) []string {
	env := make([]string, 0, len(parent))
	for _, kv := range parent {
		if k, _, _ := strings.Cut(kv, "="); k == "LPDEST" || k == "PRINTER" {
			continue
		}
		env = append(env, kv)
	}
	return env
}

// checkPDF istemcideki tek PDF denetimi (ayrıştırma yok, T9): `%PDF-` öneki ve ≤ MaxPDFBytes; ctx iptali ErrCancelled.
func checkPDF(ctx context.Context, pdf []byte) error {
	switch {
	case len(pdf) == 0 || !bytes.HasPrefix(pdf, []byte("%PDF-")):
		return ErrInvalidPDF
	case len(pdf) > MaxPDFBytes:
		return ErrTooLarge
	case ctx.Err() != nil:
		return ErrCancelled
	}
	return nil
}

// PrintLP pdf'i varsayılan yazıcıya tek kopya basar. Hatalar: ErrInvalidPDF (boş / `%PDF-` değil), ErrTooLarge
// (> MaxPDFBytes), ErrCancelled (ctx iptali; lp süreci öldürülür), ErrNoPrinter (lp sıfır dışı çıkış: varsayılan hedef
// yok/erişilemez), ErrPrint (lp başlatılamadı). pdf değiştirilmez ve saklanmaz.
func PrintLP(ctx context.Context, pdf []byte) error {
	if err := checkPDF(ctx, pdf); err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, lpPath, lpArgs...)
	cmd.Env = lpEnv(os.Environ())
	cmd.Stdin = bytes.NewReader(pdf)
	cmd.Dir = "/"
	cmd.WaitDelay = lpWaitDelay // iptalde alt süreçler boruyu tutsa da Run döner
	err := cmd.Run()
	switch {
	case err == nil:
		return nil
	case ctx.Err() != nil:
		return ErrCancelled
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return ErrNoPrinter
	}
	return errors.Join(ErrPrint, err)
}
