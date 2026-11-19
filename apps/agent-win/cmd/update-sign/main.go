// Komut update-sign güncelleme manifestini üretir, Ed25519 ile imzalar ve doğrular (P29, ADR-0040, mimari-p29 §9.3, §14.2).
//
// Yalnız Go standart kitaplığı + internal/update (o da yalnız stdlib) kullanır; imza işinden önce anahtarsız işte
// `GOFLAGS=-mod=readonly GOPROXY=off go build ./cmd/update-sign` ile derlenir. Tohum YALNIZ stdin'den okunur (--key-stdin),
// hiçbir çıktıya/hata metnine yazılmaz ve kullanımdan sonra bellekten silinir.
//
//	update-sign keygen                                  # çevrimdışı makinede: tohum (secret) + açık anahtar
//	update-sign pubkey --key-stdin                      # tohumun açık anahtarı (.pub denetimi)
//	update-sign sign --key-stdin --env prod --platform windows --arch amd64 --component client \
//	    --version 0.22.0 --min-updater 0.22.0 --file NoktaDestek.exe [--sums SHA256SUMS] --out-dir out/
//	update-sign sign --key-stdin --from eski/update-client-windows-amd64.json --out-dir out/   # yeniden imza (update-resign)
//	update-sign verify --pubkeys <b64url>[,<b64url>] --env prod --manifest m.json [--sig m.json.sig] [--file ikili]
package main

import (
	"bufio"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"remote-support/agent-win/internal/update"
)

// maxSeedInput stdin'den okunan en çok bayt (base64 32 bayt + boşluk).
const maxSeedInput = 256

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, time.Now))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer, now func() time.Time) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "kullanım: update-sign keygen|pubkey|sign|verify [bayraklar]")
		return 2
	}
	var err error
	switch args[0] {
	case "keygen":
		err = cmdKeygen(args[1:], stdout, stderr)
	case "pubkey":
		err = cmdPubkey(args[1:], stdin, stdout, stderr)
	case "sign":
		err = cmdSign(args[1:], stdin, stdout, stderr, now)
	case "verify":
		err = cmdVerify(args[1:], stdout, stderr, now)
	default:
		err = usageError("bilinmeyen komut " + strconvQuote(args[0]))
	}
	if err != nil {
		fmt.Fprintln(stderr, "update-sign:", err)
		var u usageError
		if errors.As(err, &u) {
			return 2
		}
		return 1
	}
	return 0
}

type usageError string

func (u usageError) Error() string { return string(u) }

func strconvQuote(s string) string {
	if len(s) > 32 {
		s = s[:32]
	}
	return fmt.Sprintf("%q", s)
}

func newFlags(name string, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	return fs
}

func parseFlags(fs *flag.FlagSet, args []string) error {
	if err := fs.Parse(args); err != nil {
		return usageError(err.Error())
	}
	if fs.NArg() != 0 {
		return usageError("fazla argüman")
	}
	return nil
}

// cmdKeygen çevrimdışı makinede yeni çift: stdout'a `UPDATE_SIGNING_KEY=<base64 tohum>` ve `PUBLIC_KEY=<base64url>`.
func cmdKeygen(args []string, stdout, stderr io.Writer) error {
	fs := newFlags("keygen", stderr)
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	seed := make([]byte, ed25519.SeedSize)
	defer clear(seed)
	if _, err := rand.Read(seed); err != nil {
		return errors.New("rastgele kaynak okunamadı")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	defer clear(priv)
	pub := priv.Public().(ed25519.PublicKey)
	fmt.Fprintf(stdout, "UPDATE_SIGNING_KEY=%s\nPUBLIC_KEY=%s\n", base64.StdEncoding.EncodeToString(seed), update.EncodePublicKey(pub))
	return nil
}

func cmdPubkey(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := newFlags("pubkey", stderr)
	keyStdin := fs.Bool("key-stdin", false, "tohumu stdin'den oku (zorunlu)")
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if !*keyStdin {
		return usageError("--key-stdin zorunlu (tohum yalnız stdin'den)")
	}
	priv, err := readKey(stdin)
	if err != nil {
		return err
	}
	defer clear(priv)
	fmt.Fprintln(stdout, update.EncodePublicKey(priv.Public().(ed25519.PublicKey)))
	return nil
}

// readKey stdin'den base64 (standart; dolgulu ya da dolgusuz) 32 bayt tohum okur. Hata metni girdiyi içermez.
func readKey(stdin io.Reader) (ed25519.PrivateKey, error) {
	buf := make([]byte, maxSeedInput+1)
	defer clear(buf)
	n, err := io.ReadFull(stdin, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, errors.New("tohum stdin'den okunamadı")
	}
	if n > maxSeedInput {
		return nil, errors.New("tohum girdisi çok uzun")
	}
	raw := bytes.TrimSpace(buf[:n])
	seed := make([]byte, len(raw)) // her iki kodlamanın çözüm boyutundan büyük
	defer clear(seed)
	var m int
	if bytes.HasSuffix(raw, []byte("=")) {
		m, err = base64.StdEncoding.Strict().Decode(seed, raw)
	} else {
		m, err = base64.RawStdEncoding.Strict().Decode(seed, raw)
	}
	if err != nil || m != ed25519.SeedSize {
		return nil, errors.New("tohum base64 32 bayt olmalı")
	}
	return ed25519.NewKeyFromSeed(seed[:m]), nil
}

type signOpts struct {
	keyStdin                                           bool
	env, platform, arch, component, version, minUpdate string
	file, sums, from, outDir, issuedAt                 string
	validityDays                                       int
}

func cmdSign(args []string, stdin io.Reader, stdout, stderr io.Writer, now func() time.Time) error {
	fs := newFlags("sign", stderr)
	var o signOpts
	fs.BoolVar(&o.keyStdin, "key-stdin", false, "tohumu stdin'den oku (zorunlu)")
	fs.StringVar(&o.env, "env", "", "prod|staging")
	fs.StringVar(&o.platform, "platform", "", "windows|macos|linux")
	fs.StringVar(&o.arch, "arch", "", "amd64|universal")
	fs.StringVar(&o.component, "component", "", "client|service")
	fs.StringVar(&o.version, "version", "", "x.y.z")
	fs.StringVar(&o.minUpdate, "min-updater", "", "minUpdaterVersion x.y.z")
	fs.StringVar(&o.file, "file", "", "ikili (sha256 + size buradan)")
	fs.StringVar(&o.sums, "sums", "", "isteğe bağlı SHA256SUMS; ikilinin satırı hesaplanan SHA ile aynı olmalı")
	fs.StringVar(&o.from, "from", "", "yeniden imza: önceki manifest (yalnız issuedAt/expiresAt değişir)")
	fs.StringVar(&o.outDir, "out-dir", "", "çıktı klasörü (update-<component>-<platform>-<arch>.json + .sig)")
	fs.StringVar(&o.issuedAt, "issued-at", "", "YYYY-MM-DDTHH:MM:SSZ (varsayılan: şimdi)")
	fs.IntVar(&o.validityDays, "validity-days", 0, "geçerlilik günü (varsayılan: client 30, service 90)")
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if !o.keyStdin {
		return usageError("--key-stdin zorunlu (tohum yalnız stdin'den)")
	}
	if o.outDir == "" {
		return usageError("--out-dir zorunlu")
	}
	m, err := buildManifest(o, now)
	if err != nil {
		return err
	}
	raw := m.Canonical()
	if _, err := update.ParseManifest(raw); err != nil {
		return err
	}

	priv, err := readKey(stdin)
	if err != nil {
		return err
	}
	sig := ed25519.Sign(priv, update.SignedMessage(raw))
	pub := priv.Public().(ed25519.PublicKey)
	clear(priv)
	// Üreten = doğrulayan: yazmadan önce aynı paketin Verify zinciriyle kendi imzasını denetle.
	if !(update.Trust{Env: m.Env, Keys: []ed25519.PublicKey{pub}}).VerifySignature(raw, sig) {
		return errors.New("üretilen imza doğrulanamadı")
	}

	name := filepath.Join(o.outDir, m.FileName())
	if err := writeFileAtomic(name, raw); err != nil {
		return err
	}
	if err := writeFileAtomic(name+".sig", []byte(update.EncodeSignature(sig))); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "%s version=%s sha256=%s size=%d expiresAt=%s pubkey=%s\n", filepath.Base(name), m.Version, m.SHA256,
		m.Size, m.ExpiresAt.Format(time.RFC3339), update.EncodePublicKey(pub))
	return nil
}

func buildManifest(o signOpts, now func() time.Time) (update.Manifest, error) {
	var m update.Manifest
	issued := now().UTC().Truncate(time.Second)
	if o.issuedAt != "" {
		t, err := time.Parse("2006-01-02T15:04:05Z", o.issuedAt)
		if err != nil {
			return m, usageError("--issued-at YYYY-MM-DDTHH:MM:SSZ olmalı")
		}
		issued = t
	}
	if o.from != "" {
		if o.env != "" || o.platform != "" || o.arch != "" || o.component != "" || o.version != "" || o.minUpdate != "" ||
			o.file != "" || o.sums != "" {
			return m, usageError("--from yalnız --out-dir, --issued-at, --validity-days ile kullanılır")
		}
		prev, err := os.ReadFile(o.from)
		if err != nil {
			return m, errors.New("--from okunamadı")
		}
		if m, err = update.ParseManifest(prev); err != nil {
			return m, err
		}
	} else {
		if o.file == "" {
			return m, usageError("--file zorunlu")
		}
		sum, size, err := hashFile(o.file)
		if err != nil {
			return m, err
		}
		if o.sums != "" {
			if err := checkSums(o.sums, filepath.Base(o.file), sum); err != nil {
				return m, err
			}
		}
		m = update.Manifest{Schema: update.SchemaVersion, Env: o.env, Platform: o.platform, Arch: o.arch,
			Component: o.component, Version: o.version, SHA256: sum, Size: size, MinUpdaterVersion: o.minUpdate}
		if !update.ValidCombo(m.Platform, m.Arch, m.Component) {
			return m, usageError("platform/arch/component birleşimi geçersiz (windows|linux→amd64, macos→universal, service yalnız windows)")
		}
	}
	days := o.validityDays
	if days == 0 {
		days = int(update.MaxValidity(m.Component) / (24 * time.Hour))
	}
	validity := time.Duration(days) * 24 * time.Hour
	if days < 1 || validity > update.MaxValidity(m.Component) {
		return m, usageError(fmt.Sprintf("--validity-days 1..%d olmalı", int(update.MaxValidity(m.Component)/(24*time.Hour))))
	}
	m.IssuedAt, m.ExpiresAt = issued, issued.Add(validity)
	return m, m.Validate()
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, errors.New("ikili açılamadı")
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(f, update.MaxBinarySize+1))
	if err != nil {
		return "", 0, errors.New("ikili okunamadı")
	}
	if n < 1 || n > update.MaxBinarySize {
		return "", 0, errors.New("ikili boyutu 1..100 MiB olmalı")
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// checkSums SHA256SUMS (`<hex>  <ad>` ya da `<hex> *<ad>`) içinde adın satırı hesaplanan SHA olmalı.
func checkSums(path, name, sum string) error {
	f, err := os.Open(path)
	if err != nil {
		return errors.New("SHA256SUMS açılamadı")
	}
	defer f.Close()
	sc := bufio.NewScanner(io.LimitReader(f, 1<<20))
	found := false
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) != 2 || strings.TrimPrefix(fields[1], "*") != name {
			continue
		}
		if found {
			return errors.New("SHA256SUMS'ta ad birden çok kez geçiyor")
		}
		found = true
		if strings.ToLower(fields[0]) != sum {
			return errors.New("SHA256SUMS ile ikili SHA'sı uyuşmuyor")
		}
	}
	if err := sc.Err(); err != nil {
		return errors.New("SHA256SUMS okunamadı")
	}
	if !found {
		return errors.New("SHA256SUMS'ta ikilinin satırı yok")
	}
	return nil
}

func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".update-sign-*")
	if err != nil {
		return errors.New("çıktı klasörüne yazılamadı")
	}
	tmpName := tmp.Name()
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmpName, 0o644)
	}
	if err == nil {
		err = os.Rename(tmpName, path)
	}
	if err != nil {
		_ = os.Remove(tmpName)
		return errors.New("çıktı yazılamadı: " + filepath.Base(path))
	}
	return nil
}

func cmdVerify(args []string, stdout, stderr io.Writer, now func() time.Time) error {
	fs := newFlags("verify", stderr)
	pubkeys := fs.String("pubkeys", "", "<b64url>[,<b64url>] (build/update-keys/<env>.pub)")
	env := fs.String("env", "", "beklenen ortam prod|staging")
	manifestPath := fs.String("manifest", "", "manifest dosyası")
	sigPath := fs.String("sig", "", "imza dosyası (varsayılan <manifest>.sig)")
	file := fs.String("file", "", "isteğe bağlı ikili: sha256 + size manifestle aynı olmalı")
	allowExpired := fs.Bool("allow-expired", false, "süresi dolmuş manifesti de kabul et (yalnız arşiv denetimi)")
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if *manifestPath == "" || *pubkeys == "" || *env == "" {
		return usageError("--manifest, --pubkeys ve --env zorunlu")
	}
	trust, err := update.ParseTrust(*env, *pubkeys)
	if err != nil || !trust.Enabled() {
		return usageError("--env/--pubkeys geçersiz")
	}
	if *sigPath == "" {
		*sigPath = *manifestPath + ".sig"
	}
	raw, err := readLimited(*manifestPath, update.MaxManifestBytes)
	if err != nil {
		return err
	}
	sigText, err := readLimited(*sigPath, update.SignatureB64Len+2)
	if err != nil {
		return err
	}
	sig, err := update.DecodeSignature(strings.TrimSuffix(string(sigText), "\n"))
	if err != nil {
		return err
	}
	if !trust.VerifySignature(raw, sig) {
		return errors.New("imza geçersiz (" + string(update.ReasonManifestSignature) + ")")
	}
	m, err := update.ParseManifest(raw)
	if err != nil {
		return err
	}
	if m.Env != trust.Env {
		return errors.New("ortam uyuşmuyor (" + string(update.ReasonEnvMismatch) + ")")
	}
	if m.ExpiresAt.Sub(m.IssuedAt) > update.MaxValidity(m.Component) {
		return errors.New("geçerlilik component sınırını aşıyor (" + string(update.ReasonExpired) + ")")
	}
	if !*allowExpired && now().After(m.ExpiresAt) {
		return errors.New("manifest süresi dolmuş (" + string(update.ReasonExpired) + ")")
	}
	if *file != "" {
		sum, size, err := hashFile(*file)
		if err != nil {
			return err
		}
		if sum != m.SHA256 || size != m.Size {
			return errors.New("ikili manifestle uyuşmuyor (" + string(update.ReasonHashMismatch) + ")")
		}
	}
	fmt.Fprintf(stdout, "OK %s env=%s platform=%s arch=%s component=%s version=%s sha256=%s size=%d issuedAt=%s expiresAt=%s minUpdaterVersion=%s\n",
		filepath.Base(*manifestPath), m.Env, m.Platform, m.Arch, m.Component, m.Version, m.SHA256, m.Size,
		m.IssuedAt.Format(time.RFC3339), m.ExpiresAt.Format(time.RFC3339), m.MinUpdaterVersion)
	return nil
}

func readLimited(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New(filepath.Base(path) + " açılamadı")
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, errors.New(filepath.Base(path) + " okunamadı")
	}
	if int64(len(b)) > limit {
		return nil, errors.New(filepath.Base(path) + " boyut sınırını aşıyor")
	}
	return b, nil
}
