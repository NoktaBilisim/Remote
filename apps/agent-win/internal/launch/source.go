package launch

import (
	"path/filepath"
	"regexp"
	"strings"

	"remote-support/agent-win/internal/pairing"
)

// P31 (mimari-p31 §3.2, §15.2; AC-512, ADR-0041): macOS'ta açılış kaynağı `.app`'in (translocation çözülmüş) üst klasör
// adından okunur. Firma zip'i Arşiv İzlencesi'nce `NoktaDestek-<etiket>-<ref>/Nokta Destek.app` olarak açılır; kod zip'i
// `Destek-<kod>/` (P28f). Kopya ekleri P28f `folderCode` ile aynı: ` (n)`, `(n)`, ` n` (n 1–3 hane). Desen çekirdeği
// Windows dosya adıyla ortaktır (pairing.RefCorePattern); büyük/küçük harf duyarsız, ref küçük harfe çevrilir.
var folderRef = regexp.MustCompile(`(?i)^` + pairing.RefCorePattern + `(?: ?\([0-9]{1,3}\)| [0-9]{1,3})?$`)

// Source açılış kaynağı: en çok biri doludur; ikisi de boşsa kaynak yok (AC-190 + NoticeMacFolder).
type Source struct {
	Code, Ref string
}

// SourceFromBundlePath özgün bundle yolundan kaynak. Öncelik (§15.2): klasör kod > klasör ref > bundle adı yalnız kod >
// yok. Bundle (`.app`) adından ref okunmaz (K-P31-1: `.app` adı hiçbir dağıtımda ref taşımaz). Klasör adındaki firma
// etiketi döndürülmez (G-E9-11).
func SourceFromBundlePath(bundle string) Source {
	if bundle == "" {
		return Source{}
	}
	bundle = filepath.Clean(bundle)
	folder := filepath.Base(filepath.Dir(bundle))
	if m := folderCode.FindStringSubmatch(folder); m != nil {
		return Source{Code: m[1]}
	}
	if m := folderRef.FindStringSubmatch(folder); m != nil {
		return Source{Ref: strings.ToLower(m[1])}
	}
	if m := folderCode.FindStringSubmatch(strings.TrimSuffix(filepath.Base(bundle), ".app")); m != nil {
		return Source{Code: m[1]}
	}
	return Source{}
}
