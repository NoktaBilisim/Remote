//go:build windows || darwin || linux

package main

import (
	"errors"
	"os"

	"remote-support/agent-win/internal/config"
)

// identity çalışan ikilinin yolu ve SHA-256 ilk 8 hanesi (AC-128).
func identity() (string, string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	f, err := os.Open(exe)
	if err != nil {
		return "", "", err
	}
	defer f.Close()
	fp, err := config.Fingerprint(f)
	if err != nil {
		return "", "", errors.Join(errors.New("parmak izi hesaplanamadı"), err)
	}
	return exe, fp, nil
}
