package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/update"
)

// Deterministik TEST tohumu (gerçek anahtar repoda bulunmaz).
func testSeed(name string) []byte {
	s := sha256.Sum256([]byte("rs-update-test-key-" + name))
	return s[:]
}

func testSeedB64(name string) string { return base64.StdEncoding.EncodeToString(testSeed(name)) }

func testPubB64(name string) string {
	return update.EncodePublicKey(ed25519.NewKeyFromSeed(testSeed(name)).Public().(ed25519.PublicKey))
}

var fixedNow = func() time.Time { return time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC) }

type out struct {
	code           int
	stdout, stderr string
}

func runCmd(stdin string, args ...string) out {
	var so, se bytes.Buffer
	code := run(args, strings.NewReader(stdin), &so, &se, fixedNow)
	return out{code, so.String(), se.String()}
}

func writeBinary(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func signArgs(dir, bin string, extra ...string) []string {
	return append([]string{"sign", "--key-stdin", "--env", "prod", "--platform", "windows", "--arch", "amd64",
		"--component", "client", "--version", "0.22.1", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}, extra...)
}

// AC-470: sign → verify gidiş-dönüşü; manifest kanonik, imza aynı paketin Verify'ından geçer, alanlar ikiliden.
func TestAC470SignVerifyRoundTrip(t *testing.T) {
	dir := t.TempDir()
	data := []byte("ikili-icerik")
	bin := writeBinary(t, dir, "NoktaDestek.exe", data)
	sum := sha256.Sum256(data)
	if err := os.WriteFile(filepath.Join(dir, "SHA256SUMS"), []byte(hex.EncodeToString(sum[:])+"  NoktaDestek.exe\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	o := runCmd(testSeedB64("prod-active")+"\n", signArgs(dir, bin, "--sums", filepath.Join(dir, "SHA256SUMS"))...)
	if o.code != 0 {
		t.Fatalf("sign: %d %s", o.code, o.stderr)
	}
	mp := filepath.Join(dir, "update-client-windows-amd64.json")
	raw, err := os.ReadFile(mp)
	if err != nil {
		t.Fatal(err)
	}
	m, err := update.ParseManifest(raw)
	if err != nil {
		t.Fatal(err)
	}
	if m.SHA256 != hex.EncodeToString(sum[:]) || m.Size != int64(len(data)) || m.Version != "0.22.1" ||
		m.IssuedAt != fixedNow() || m.ExpiresAt != fixedNow().Add(30*24*time.Hour) || m.MinUpdaterVersion != "0.22.0" {
		t.Fatalf("alanlar: %+v", m)
	}
	sigText, _ := os.ReadFile(mp + ".sig")
	if len(sigText) != update.SignatureB64Len {
		t.Fatalf(".sig uzunluğu %d", len(sigText))
	}
	sig, err := update.DecodeSignature(string(sigText))
	if err != nil {
		t.Fatal(err)
	}
	tr, _ := update.ParseTrust("prod", testPubB64("prod-backup")+","+testPubB64("prod-active"))
	r := update.Verify(tr, raw, sig, update.Running{Platform: "windows", Arch: "amd64", Component: "client",
		Version: update.Version{Minor: 22}}, update.Version{}, fixedNow())
	if r.Outcome != update.OutcomeAccept {
		t.Fatalf("Verify: %+v", r)
	}

	v := runCmd("", "verify", "--pubkeys", testPubB64("prod-active"), "--env", "prod", "--manifest", mp, "--file", bin)
	if v.code != 0 || !strings.HasPrefix(v.stdout, "OK update-client-windows-amd64.json") {
		t.Fatalf("verify: %d %s %s", v.code, v.stdout, v.stderr)
	}
	// Tohum hiçbir çıktıda yok (base64, base64url, hex).
	seed := testSeed("prod-active")
	for _, form := range []string{base64.StdEncoding.EncodeToString(seed), base64.RawURLEncoding.EncodeToString(seed), hex.EncodeToString(seed)} {
		if strings.Contains(o.stdout+o.stderr+v.stdout+v.stderr, form) {
			t.Fatal("tohum çıktıya sızdı")
		}
	}
}

func TestAC470VerifyRejects(t *testing.T) {
	dir := t.TempDir()
	bin := writeBinary(t, dir, "NoktaDestek.exe", []byte("ikili"))
	if o := runCmd(testSeedB64("prod-active"), signArgs(dir, bin)...); o.code != 0 {
		t.Fatal(o.stderr)
	}
	mp := filepath.Join(dir, "update-client-windows-amd64.json")
	other := writeBinary(t, dir, "baska.exe", []byte("baska"))
	cases := map[string][]string{
		"başka anahtar":   {"--pubkeys", testPubB64("attacker"), "--env", "prod", "--manifest", mp},
		"başka ortam":     {"--pubkeys", testPubB64("prod-active"), "--env", "staging", "--manifest", mp},
		"ikili uyuşmuyor": {"--pubkeys", testPubB64("prod-active"), "--env", "prod", "--manifest", mp, "--file", other},
	}
	for name, args := range cases {
		if o := runCmd("", append([]string{"verify"}, args...)...); o.code == 0 {
			t.Errorf("%s: kabul edildi", name)
		}
	}
	// Değiştirilmiş manifest (alan eksik / bayt değişti) → kırmızı.
	raw, _ := os.ReadFile(mp)
	if err := os.WriteFile(mp, bytes.Replace(raw, []byte(`,"minUpdaterVersion":"0.22.0"`), nil, 1), 0o644); err != nil {
		t.Fatal(err)
	}
	if o := runCmd("", "verify", "--pubkeys", testPubB64("prod-active"), "--env", "prod", "--manifest", mp); o.code == 0 {
		t.Fatal("alan eksik manifest kabul edildi")
	}
}

// §14.2: --from yeniden imza — yalnız issuedAt/expiresAt değişir.
func TestAC470ResignKeepsFields(t *testing.T) {
	dir, out2 := t.TempDir(), t.TempDir()
	bin := writeBinary(t, dir, "NoktaDestekServis.exe", []byte("servis"))
	args := []string{"sign", "--key-stdin", "--env", "prod", "--platform", "windows", "--arch", "amd64", "--component", "service",
		"--version", "0.22.0", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}
	if o := runCmd(testSeedB64("prod-active"), args...); o.code != 0 {
		t.Fatal(o.stderr)
	}
	name := "update-service-windows-amd64.json"
	if o := runCmd(testSeedB64("prod-active"), "sign", "--key-stdin", "--from", filepath.Join(dir, name), "--out-dir", out2,
		"--issued-at", "2026-12-01T00:00:00Z"); o.code != 0 {
		t.Fatal(o.stderr)
	}
	a, _ := os.ReadFile(filepath.Join(dir, name))
	b, _ := os.ReadFile(filepath.Join(out2, name))
	ma, _ := update.ParseManifest(a)
	mb, err := update.ParseManifest(b)
	if err != nil {
		t.Fatal(err)
	}
	if ma.ExpiresAt.Sub(ma.IssuedAt) != 90*24*time.Hour {
		t.Fatal("servis varsayılan 90 g olmalı")
	}
	ma.IssuedAt, ma.ExpiresAt = mb.IssuedAt, mb.ExpiresAt
	if ma != mb || mb.IssuedAt != time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("yeniden imzada alan değişti: %+v / %+v", ma, mb)
	}
	// --from diğer alan bayraklarıyla birlikte kullanılamaz.
	if o := runCmd(testSeedB64("prod-active"), "sign", "--key-stdin", "--from", filepath.Join(dir, name), "--out-dir", out2,
		"--version", "9.9.9"); o.code != 2 {
		t.Fatalf("--from + --version: %d", o.code)
	}
}

func TestAC471SignInputGuards(t *testing.T) {
	dir := t.TempDir()
	bin := writeBinary(t, dir, "NoktaDestek.exe", []byte("ikili"))
	seed := testSeedB64("prod-active")
	cases := map[string]struct {
		stdin string
		args  []string
	}{
		"--key-stdin yok":      {seed, func() []string { a := signArgs(dir, bin); return append(a[:1], a[2:]...) }()},
		"tohum boş":            {"", signArgs(dir, bin)},
		"tohum kısa":           {base64.StdEncoding.EncodeToString(make([]byte, 31)), signArgs(dir, bin)},
		"tohum çöp":            {"bu-bir-tohum-degil!!", signArgs(dir, bin)},
		"istemci 31 gün":       {seed, signArgs(dir, bin, "--validity-days", "31")},
		"macos amd64":          {seed, []string{"sign", "--key-stdin", "--env", "prod", "--platform", "macos", "--arch", "amd64", "--component", "client", "--version", "0.22.1", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}},
		"linux service":        {seed, []string{"sign", "--key-stdin", "--env", "prod", "--platform", "linux", "--arch", "amd64", "--component", "service", "--version", "0.22.1", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}},
		"sürüm desen dışı":     {seed, []string{"sign", "--key-stdin", "--env", "prod", "--platform", "windows", "--arch", "amd64", "--component", "client", "--version", "0.22", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}},
		"env bilinmeyen":       {seed, []string{"sign", "--key-stdin", "--env", "dev", "--platform", "windows", "--arch", "amd64", "--component", "client", "--version", "0.22.1", "--min-updater", "0.22.0", "--file", bin, "--out-dir", dir}},
		"SHA256SUMS uyuşmuyor": {seed, signArgs(dir, bin, "--sums", writeBinary(t, dir, "SUMS-bad", []byte(strings.Repeat("0", 64)+"  NoktaDestek.exe\n")))},
		"SHA256SUMS satır yok": {seed, signArgs(dir, bin, "--sums", writeBinary(t, dir, "SUMS-none", []byte(strings.Repeat("0", 64)+"  baska.exe\n")))},
		"fazla argüman":        {seed, append(signArgs(dir, bin), "fazla")},
		"bilinmeyen komut":     {seed, []string{"imzala"}},
		"komutsuz":             {seed, nil},
	}
	for name, c := range cases {
		o := runCmd(c.stdin, c.args...)
		if o.code == 0 {
			t.Errorf("%s: başarılı olmamalıydı", name)
		}
		if c.stdin != "" && strings.Contains(o.stdout+o.stderr, c.stdin) {
			t.Errorf("%s: stdin girdisi çıktıya yansıdı", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "update-client-windows-amd64.json")); !os.IsNotExist(err) {
		t.Fatal("hatalı çağrılar manifest bıraktı")
	}
}

func TestAC470KeygenAndPubkey(t *testing.T) {
	o := runCmd("", "keygen")
	if o.code != 0 {
		t.Fatal(o.stderr)
	}
	lines := strings.Split(strings.TrimSpace(o.stdout), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "UPDATE_SIGNING_KEY=") || !strings.HasPrefix(lines[1], "PUBLIC_KEY=") {
		t.Fatalf("keygen çıktısı: %q", o.stdout)
	}
	seed, pub := strings.TrimPrefix(lines[0], "UPDATE_SIGNING_KEY="), strings.TrimPrefix(lines[1], "PUBLIC_KEY=")
	if _, err := update.ParsePublicKey(pub); err != nil {
		t.Fatal(err)
	}
	p := runCmd(seed+"\n", "pubkey", "--key-stdin")
	if p.code != 0 || strings.TrimSpace(p.stdout) != pub {
		t.Fatalf("pubkey: %d %q", p.code, p.stdout)
	}
	unpadded := strings.TrimRight(seed, "=")
	if p := runCmd(unpadded, "pubkey", "--key-stdin"); p.code != 0 || strings.TrimSpace(p.stdout) != pub {
		t.Fatalf("dolgusuz tohum: %d %q", p.code, p.stderr)
	}
	if p := runCmd(seed, "pubkey"); p.code != 2 {
		t.Fatal("--key-stdin'siz pubkey kabul edildi")
	}
	if p := runCmd(testSeedB64("x"), "pubkey", "--key-stdin"); strings.TrimSpace(p.stdout) != testPubB64("x") {
		t.Fatal("deterministik pubkey")
	}
}
