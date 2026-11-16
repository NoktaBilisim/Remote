package signal

import (
	"regexp"
	"slices"
)

// P28b sunucu üzerinden dosya aktarımı WS sözleşmesi (mimari-p28b §5, §11.3 r2; `packages/contracts/src/ws-fsrv.ts`).
// Bayt WS'den GEÇMEZ: yükleme/indirme HTTPS (internal/fsrv, Bearer belirteç); WS yalnız kimlik, boyut, SHA-256, durum.
// Uyum `packages/contracts/fixtures/fsrv.json` ile test edilir. Belirteç (`token`) hiçbir hata metnine yazılmaz.

// FeatureFsrv `WS_GUEST_CAP_FSRV`: Dial'ın features parametresi (yalnız katılımlı oturum; gözetimsiz yardımcı bildirmez).
const FeatureFsrv = "rs.cap.fsrv1"

// Dosya modu (`FILE_MODES`; oturum açılışında bir kez sabitlenir, AC-355).
const (
	FileModeP2P    = "P2P"
	FileModeServer = "SERVER"
)

// Sınırlar (contracts sabitleri; fikstür `constants` ile test edilir).
const (
	FsrvChunkBytes            = 1_048_576
	FsrvMaxBytes              = 268_435_456
	FsrvMaxChunks             = FsrvMaxBytes / FsrvChunkBytes
	FsrvPrintMaxBytes         = PrintMaxBytes
	FsrvPrintFileName         = "belge.pdf"
	FsrvDownloadTTLMs         = 300_000
	FsrvDownloadTokensPerFile = 3
	fsrvNameMax               = 255
)

// Amaçlar ve durum/neden kümeleri (`FSRV_PURPOSES`, `FSRV_WIRE_STATES`, `FSRV_GATE_REASONS`, `AV_SCAN_REASONS`).
const (
	FsrvPurposeFile  = "FILE"
	FsrvPurposePrint = "PRINT"
)

var (
	fileModes       = []string{FileModeP2P, FileModeServer}
	fsrvPurposes    = []string{FsrvPurposeFile, FsrvPurposePrint}
	fsrvWireStates  = []string{"UPLOADING", "SCANNING", "CLEAN", "INFECTED", "SCAN_FAILED", "CORRUPT", "CANCELLED", "REJECTED", "DELIVERED"}
	fsrvGateReasons = []string{"MODE", "FORBIDDEN", "UNSUPPORTED", "BUSY", "TOO_LARGE", "RATE_LIMITED", "SESSION_LIMIT", "QUOTA"}
	avScanReasons   = []string{"UNAVAILABLE", "TIMEOUT", "ENCRYPTED", "LIMIT", "BUSY", "ERROR"}
	avSignatureRe   = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,120}$`)
)

// ValidFsrvToken belirteç biçimi (`FSRV_TOKEN_PATTERN`); internal/fsrv istek öncesi denetler.
func ValidFsrvToken(s string) bool { return tokenRe.MatchString(s) }

// ValidFsrvFID fid biçimi (ULID; yol parçası olarak kullanılmadan önce denetlenir).
func ValidFsrvFID(s string) bool { return ulidRe.MatchString(s) }

func validFileMode(m string) bool { return m == "" || slices.Contains(fileModes, m) }

// --- Sunucu → misafir ---

// FsrvUpload yükleme belirteci (yalnız gönderene).
type FsrvUpload struct {
	T          string `json:"t"`
	XID        string `json:"xid"`
	FID        string `json:"fid"`
	Token      string `json:"token"`
	ChunkBytes int    `json:"chunkBytes"`
	Chunks     int    `json:"chunks"`
}

// FsrvStatus aktarım durumu (iki tarafa). En az biri: FID (satır var) / XID (kapı reddi).
type FsrvStatus struct {
	T         string `json:"t"`
	FID       string `json:"fid,omitempty"`
	XID       string `json:"xid,omitempty"`
	State     string `json:"state"`
	Reason    string `json:"reason,omitempty"`
	Signature string `json:"signature,omitempty"`
	Progress  *int   `json:"progress,omitempty"`
}

// FsrvOffer temiz dosyanın alıcıya teklifi. PRINT'te PID zorunlu ve ad `belge.pdf`; FILE'da PID yok.
type FsrvOffer struct {
	T       string `json:"t"`
	FID     string `json:"fid"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
	Purpose string `json:"purpose"`
	PID     string `json:"pid,omitempty"`
}

// FsrvDownload indirme belirteci (≤ 5 dk; yalnız `Authorization: Bearer`).
type FsrvDownload struct {
	T         string `json:"t"`
	FID       string `json:"fid"`
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

func (m FsrvUpload) Type() string   { return m.T }
func (m FsrvStatus) Type() string   { return m.T }
func (m FsrvOffer) Type() string    { return m.T }
func (m FsrvDownload) Type() string { return m.T }

func validFsrvSize(n int64) bool { return n >= 1 && n <= FsrvMaxBytes }

func validFsrvName(s string) bool { l := utf16Len(s); return l >= 1 && l <= fsrvNameMax }

// validPrintShape `printShape`: PRINT ⇒ pid zorunlu + ad belge.pdf; FILE ⇒ pid yok.
func validPrintShape(purpose, pid, name string) bool {
	switch purpose {
	case FsrvPurposePrint:
		return cpIDRe.MatchString(pid) && name == FsrvPrintFileName
	case FsrvPurposeFile:
		return pid == ""
	}
	return false
}

func validFsrvUpload(m *FsrvUpload) bool {
	return cpIDRe.MatchString(m.XID) && ulidRe.MatchString(m.FID) && tokenRe.MatchString(m.Token) &&
		m.ChunkBytes == FsrvChunkBytes && m.Chunks >= 1 && m.Chunks <= FsrvMaxChunks
}

func validFsrvStatus(m *FsrvStatus) bool {
	if (m.FID == "" && m.XID == "") || (m.FID != "" && !ulidRe.MatchString(m.FID)) ||
		(m.XID != "" && !cpIDRe.MatchString(m.XID)) || !slices.Contains(fsrvWireStates, m.State) ||
		(m.Progress != nil && (*m.Progress < 0 || *m.Progress > 100)) {
		return false
	}
	switch m.State {
	case "SCAN_FAILED":
		if !slices.Contains(avScanReasons, m.Reason) {
			return false
		}
	case "REJECTED":
		if m.Reason != "" && !slices.Contains(fsrvGateReasons, m.Reason) {
			return false
		}
	default:
		if m.Reason != "" {
			return false
		}
	}
	return m.Signature == "" || (m.State == "INFECTED" && avSignatureRe.MatchString(m.Signature))
}

func validFsrvOffer(m *FsrvOffer) bool {
	return ulidRe.MatchString(m.FID) && validFsrvName(m.Name) && validFsrvSize(m.Size) && sha256Re.MatchString(m.SHA256) &&
		validPrintShape(m.Purpose, m.PID, m.Name)
}

func validFsrvDownload(m *FsrvDownload) bool {
	return ulidRe.MatchString(m.FID) && tokenRe.MatchString(m.Token) && isISO(m.ExpiresAt)
}

// --- Misafir → sunucu (yalnız SERVER odasında ve fsrv bildiren sokette şemadadır) ---

// FsrvInit yükleme isteği (ad ham; sunucu temizler).
type FsrvInit struct {
	T       string `json:"t"`
	ID      string `json:"id,omitempty"`
	XID     string `json:"xid"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
	Purpose string `json:"purpose"`
	PID     string `json:"pid,omitempty"`
}

// FsrvAccept teklifin alıcısı kabul etti → `fsrv.download`.
type FsrvAccept struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	FID string `json:"fid"`
}

// FsrvReject alıcı reddi (satır REJECTED, disk hemen silinir).
type FsrvReject struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	FID string `json:"fid"`
}

// FsrvResult alıcının SHA-256 doğrulama sonucu (OK zorunlu; false da gönderilir).
type FsrvResult struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	FID string `json:"fid"`
	OK  bool   `json:"ok"`
}

// FsrvCancel gönderen/alıcı iptali.
type FsrvCancel struct {
	T   string `json:"t"`
	ID  string `json:"id,omitempty"`
	FID string `json:"fid"`
}

func (m FsrvInit) validate() error {
	if m.T != "fsrv.init" {
		return fail(m.T, "tip")
	}
	if !cpIDRe.MatchString(m.XID) || !validFsrvName(m.Name) || !validFsrvSize(m.Size) || !sha256Re.MatchString(m.SHA256) ||
		!validPrintShape(m.Purpose, m.PID, m.Name) {
		return fail(m.T, "alan")
	}
	return checkID(m.T, m.ID)
}

func validateFid(t, want, id, fid string) error {
	if t != want {
		return fail(t, "tip")
	}
	if !ulidRe.MatchString(fid) {
		return fail(t, "fid")
	}
	return checkID(t, id)
}

func (m FsrvAccept) validate() error { return validateFid(m.T, "fsrv.accept", m.ID, m.FID) }
func (m FsrvReject) validate() error { return validateFid(m.T, "fsrv.reject", m.ID, m.FID) }
func (m FsrvResult) validate() error { return validateFid(m.T, "fsrv.result", m.ID, m.FID) }
func (m FsrvCancel) validate() error { return validateFid(m.T, "fsrv.cancel", m.ID, m.FID) }
