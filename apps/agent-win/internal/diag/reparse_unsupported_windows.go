//go:build windows && !(amd64 || arm64)

package diag

import (
	"errors"
	"os"
)

// S-P17-5: handle üzerinden korumalı dosya işlemleri (reparse_windows.go, AC-249) yalnız 64 bit Windows'ta derlenir;
// FILE_RENAME_INFORMATION düzeni orada 64 bit hizalamayla yazılmıştır. İstemci yalnız windows/amd64 dağıtılır
// (runbook §24.6). 32 bit Windows'ta (386, arm) paket derlenir ama kapalı kalır: hiçbir dosya açılmaz, yazılmaz,
// taşınmaz, silinmez (mod bitiyle zayıf denetime sessiz dönüş yok). Tanılama logu ve "beni hatırla" çalışmaz.

var errArch = errors.Join(errors.ErrUnsupported, errors.New("diag: 32 bit Windows'ta dosya işlemleri desteklenmiyor"))

// Dir 32 bit Windows eşi (hiç oluşturulmaz).
type Dir struct{}

// OpenDir her zaman desteklenmiyor hatası.
func OpenDir(string, bool) (*Dir, error) { return nil, errArch }

// Close imza eşi.
func (d *Dir) Close() {}

// Open her zaman desteklenmiyor hatası.
func (d *Dir) Open(string, Mode) (*os.File, error) { return nil, errArch }

// Rename her zaman desteklenmiyor hatası.
func (d *Dir) Rename(string, string) error { return errArch }

// Remove her zaman desteklenmiyor hatası.
func (d *Dir) Remove(string) error { return errArch }

// RemoveIfEmpty etkisiz.
func (d *Dir) RemoveIfEmpty() {}
