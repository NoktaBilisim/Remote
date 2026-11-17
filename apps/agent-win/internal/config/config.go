// Package config istemcinin derleme zamanı yapılandırmasıdır (AC-109, G-07, ADR-0010). Sunucu adresi ve sürüm
// YALNIZ `-ldflags -X` ile gömülür; komut satırı, ortam değişkeni, kayıt defteri veya yapılandırma dosyası okunmaz.
//
//	go build -ldflags "-s -w -buildid= -X remote-support/agent-win/internal/config.serverURL=https://destek.example:4450 \
//	  -X remote-support/agent-win/internal/config.version=1.0.0" ./cmd/noktadestek
package config

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/url"
)

// ldflags hedefleri; derlemede doldurulmazsa Load hata döner (yanlış yapılandırılmış build çalışmaz).
var (
	serverURL string
	version   string
	// testBuild P28f (mimari-p28f §8.2, S-P28f-7): yalnız "1" ise staging TEST derlemesi (build-darwin.sh `-t`). macOS'ta
	// TEST bandı imzadan da türetilir (K4); bu değer yalnız ek koşuldur, bandı kapatamaz.
	testBuild string
	// expectedTeamID P28f D-P28f-K3: beklenen Apple Developer Team ID (build-darwin.sh EXPECTED_TEAM_ID). Boşsa ya da
	// biçim dışıysa TEST bandı her zaman gösterilir; doluysa bant yalnız imza bu Team ID ile ise gizlenir.
	expectedTeamID string
)

// Config doğrulanmış derleme zamanı yapılandırması.
type Config struct {
	// ServerURL yalnız şema + host (+ port); yol, sorgu ve kullanıcı bilgisi yok.
	ServerURL *url.URL
	Version   string
	// TestBuild P28f: ldflags `config.testBuild=1` ile derlendi (staging TEST sürümü).
	TestBuild bool
	// TeamID P28f D-P28f-K3: gömülü beklenen Team ID (10 karakter A-Z0-9); geçersiz/boşsa "".
	TeamID string
}

// ErrNotConfigured: build ldflags olmadan alınmış.
var ErrNotConfigured = errors.New("config: sunucu adresi veya sürüm derlemede gömülmemiş")

// Load gömülü değerleri doğrular.
func Load() (Config, error) {
	c, err := parse(serverURL, version)
	c.TestBuild = isTestBuild(testBuild)
	c.TeamID = teamID(expectedTeamID)
	return c, err
}

// teamID yalnız 10 karakter A-Z0-9 Apple Team ID kabul edilir; başka her değer "" (bant gösterilir).
func teamID(v string) string {
	if len(v) != 10 {
		return ""
	}
	for _, r := range v {
		if (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return ""
		}
	}
	return v
}

// isTestBuild yalnız tam "1" değeri TEST derlemesidir (boş ya da başka değer: değil).
func isTestBuild(v string) bool { return v == "1" }

func parse(raw, ver string) (Config, error) {
	if raw == "" || ver == "" {
		return Config{}, ErrNotConfigured
	}
	u, err := url.Parse(raw)
	if err != nil {
		return Config{}, errors.New("config: sunucu adresi ayrıştırılamadı")
	}
	// AC-109: yalnız TLS; yol/sorgu/fragment/kullanıcı bilgisi kabul edilmez (adres tek anlamlı olsun).
	if u.Scheme != "https" || u.Hostname() == "" || u.User != nil || (u.Path != "" && u.Path != "/") ||
		u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return Config{}, errors.New("config: sunucu adresi https://host[:port] biçiminde olmalı")
	}
	return Config{ServerURL: &url.URL{Scheme: "https", Host: u.Host}, Version: ver}, nil
}

// DisplayHost karşılama/hakkında ekranında gösterilen bağlı sunucu adresi (AC-98, AC-128).
func (c Config) DisplayHost() string {
	return c.ServerURL.Host
}

// Fingerprint ikilinin SHA-256'sının ilk 8 hex hanesi (AC-128). Kendi hash'ini gömmek mümkün olmadığından
// çalışma anında çalıştırılabilir dosyadan hesaplanır; `SHA256SUMS` ile karşılaştırılabilir.
func Fingerprint(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil))[:8], nil
}
