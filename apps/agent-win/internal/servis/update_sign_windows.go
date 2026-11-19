//go:build windows

package servis

import (
	"crypto/sha256"
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// K-P29-13 / AC-476 platform imzası: çalışan servis ikilisi Authenticode imzalıysa yeni ikili de geçerli imzalı ve AYNI
// yayıncı sertifikasıyla (imzalayan yaprak sertifikanın SHA-256 özeti) imzalı olmalıdır; aksi PLATFORM_SIGNATURE.
// Çalışan ikili imzasızsa yalnız manifest geçerlidir (bugün tüm derlemeler imzasız dalda). Sertifika yenilenirse özet
// değişir → fail-closed (yayın notu: imza sertifikası değişen sürüm elle dağıtılır).

// ErrPlatformSignature yeni ikilinin platform imzası çalışan ikiliyle uyuşmuyor.
var ErrPlatformSignature = errors.New("servis: platform imzası uyuşmuyor")

var (
	crypt32              = windows.NewLazySystemDLL("crypt32.dll")
	procCryptMsgGetParam = crypt32.NewProc("CryptMsgGetParam")
	procCryptMsgClose    = crypt32.NewProc("CryptMsgClose")
)

const cmsgSignerCertInfoParam = 7 // CMSG_SIGNER_CERT_INFO_PARAM

// platformSignature selfExe imzasızsa nil; imzalıysa newPath'in WinVerifyTrust'tan geçmesi ve imzalayan sertifika
// özetlerinin eşit olması gerekir.
func platformSignature(selfExe, newPath string) error {
	if !SelfSigned(selfExe) {
		return nil
	}
	if !SelfSigned(newPath) {
		return ErrPlatformSignature
	}
	a, err1 := signerDigest(selfExe)
	b, err2 := signerDigest(newPath)
	if errors.Join(err1, err2) != nil || a != b {
		return ErrPlatformSignature
	}
	return nil
}

// signerDigest gömülü PKCS#7 imzasındaki ilk imzalayanın sertifikasının SHA-256'sı.
func signerDigest(path string) ([sha256.Size]byte, error) {
	var zero [sha256.Size]byte
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return zero, err
	}
	var enc, content, format uint32
	var store, msg windows.Handle
	if err := windows.CryptQueryObject(windows.CERT_QUERY_OBJECT_FILE, unsafe.Pointer(p),
		windows.CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED, windows.CERT_QUERY_FORMAT_FLAG_BINARY, 0,
		&enc, &content, &format, &store, &msg, nil); err != nil {
		return zero, err
	}
	defer func() { _ = windows.CertCloseStore(store, 0) }()
	defer func() { _, _, _ = procCryptMsgClose.Call(uintptr(msg)) }()
	var size uint32
	if r, _, e := procCryptMsgGetParam.Call(uintptr(msg), cmsgSignerCertInfoParam, 0, 0,
		uintptr(unsafe.Pointer(&size))); r == 0 {
		return zero, e
	}
	if size == 0 || size > 64*1024 {
		return zero, ErrPlatformSignature
	}
	buf := make([]byte, size)
	if r, _, e := procCryptMsgGetParam.Call(uintptr(msg), cmsgSignerCertInfoParam, 0,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r == 0 {
		return zero, e
	}
	cert, err := windows.CertFindCertificateInStore(store, windows.X509_ASN_ENCODING|windows.PKCS_7_ASN_ENCODING, 0,
		windows.CERT_FIND_SUBJECT_CERT, unsafe.Pointer(&buf[0]), nil)
	if err != nil {
		return zero, err
	}
	defer func() { _ = windows.CertFreeCertificateContext(cert) }()
	return sha256.Sum256(unsafe.Slice(cert.EncodedCert, cert.Length)), nil
}
