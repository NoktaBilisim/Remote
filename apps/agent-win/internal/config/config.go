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
)

// Config doğrulanmış derleme zamanı yapılandırması.
type Config struct {
	// ServerURL yalnız şema + host (+ port); yol, sorgu ve kullanıcı bilgisi yok.
	ServerURL *url.URL
	Version   string
}

// ErrNotConfigured: build ldflags olmadan alınmış.
var ErrNotConfigured = errors.New("config: sunucu adresi veya sürüm derlemede gömülmemiş")

// Load gömülü değerleri doğrular.
func Load() (Config, error) {
	return parse(serverURL, version)
}

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
