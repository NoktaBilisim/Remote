// Package files alınan dosya adı güvenliğinin Go eşidir (G-06, AC-36, AC-117; mimari-protokol §4.2).
// Kural `packages/contracts/src/files.ts` ile birebir; ortak örnekler `packages/contracts/fixtures/file-names.json`.
// Sıra değiştirilirse fixture ve TS eşi birlikte güncellenir.
package files

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

const (
	// NameMax dosya adı üst sınırı (Unicode kod noktası; MySQL VARCHAR(255) utf8mb4 ile aynı sayım).
	NameMax = 255
	// Fallback temizleme sonrası boş kalan ada verilen ad.
	Fallback = "dosya"
	// extKeepMax: uzantı (nokta dahil) bu uzunluğu aşmıyorsa kısaltmada korunur.
	extKeepMax = 32
	// collisionMax: ` (n)` ekiyle denenecek en büyük n.
	collisionMax = 999
)

// S-P5-7: CONIN$/CONOUT$ ve üst simge rakamlı COM¹-³/LPT¹-³ de ayrılmıştır.
var reserved = regexp.MustCompile(`(?i)^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$`)

func forbidden(r rune) bool {
	return r <= 0x1F || strings.ContainsRune(`\/:*?"<>|`, r) || unicode.Is(unicode.Cf, r)
}

func trimTrailing(s string) string {
	return strings.TrimRight(s, ". ")
}

// SanitizeFileName: son yol bileşeni → yasak karakterler ve Unicode Cf (RTLO dahil) silinir → sondaki nokta/boşluk
// silinir → Windows ayrılmış adı (uzantılı da) `_` önekli → boşsa `dosya` → ≤ 255 karakter (uzantı korunarak).
func SanitizeFileName(raw string) string {
	raw = strings.ToValidUTF8(raw, "")
	if i := strings.LastIndexAny(raw, `\/`); i >= 0 {
		raw = raw[i+1:]
	}
	name := trimTrailing(strings.Map(func(r rune) rune {
		if forbidden(r) {
			return -1
		}
		return r
	}, raw))
	stem, _, _ := strings.Cut(name, ".")
	if reserved.MatchString(strings.TrimRightFunc(stem, unicode.IsSpace)) {
		name = "_" + name
	}
	if name == "" {
		return Fallback
	}
	return truncate(name)
}

func truncate(name string) string {
	cps := []rune(name)
	if len(cps) <= NameMax {
		return name
	}
	dot := strings.LastIndex(name, ".")
	var ext []rune
	if dot > 0 {
		ext = []rune(name[dot:])
	}
	if len(ext) == 0 || len(ext) > extKeepMax {
		if s := trimTrailing(string(cps[:NameMax])); s != "" {
			return s
		}
		return Fallback
	}
	return trimTrailing(string(cps[:NameMax-len(ext)])) + string(ext)
}

// dangerousExt AC-36 (rev.) + S-P5-7 + S6-8 + S-P28f-9 (macOS türleri) + P28g §5.4 (Linux türleri; liste platformdan bağımsız) listesi; contracts `DANGEROUS_EXT` ile birebir aynı
// (TestS68DangerousExtMatchesContracts kaynak dosyadan karşılaştırır).
var dangerousExt = map[string]struct{}{}

func init() {
	for _, e := range strings.Fields(`exe msi bat cmd ps1 psm1 vbs js wsf sh scr lnk hta cpl msc jar dll
		com pif reg scf url chm iso img vhd vhdx appx msix appinstaller application xll docm xlsm
		vbe jse ws wsh msp mst inf ps1xml psc1 psd1 settingcontent-ms library-ms
		searchconnector-ms appref-ms gadget xbap xlam xla pptm dotm html htm mht mhtml svg
		one onepkg wsc sct diagcab website ade adp mde mshxml jnlp cab
		command tool app pkg mpkg dmg scpt scptd applescript terminal webloc inetloc fileloc workflow action
		mobileconfig kext dylib bundle plugin prefpane osax zsh bash csh ksh py rb pl saver
		desktop run bin appimage deb rpm snap flatpak flatpakref flatpakrepo so ko service`) {
		dangerousExt[e] = struct{}{}
	}
}

func extensions(name string) []string {
	return strings.Split(strings.ToLower(name), ".")[1:]
}

// IsDangerousExtension son uzantı tehlikeli mi. Ad önce SanitizeFileName'den geçmiş olmalı.
func IsDangerousExtension(name string) bool {
	ext := extensions(name)
	if len(ext) == 0 {
		return false
	}
	_, ok := dangerousExt[ext[len(ext)-1]]
	return ok
}

var extLike = regexp.MustCompile(`^[a-z0-9]{1,5}$`)
var hasLetter = regexp.MustCompile(`[a-z]`)

// IsDoubleExtension: tehlikeli son uzantıdan önce uzantı benzeri parça (`fatura.pdf.exe`).
func IsDoubleExtension(name string) bool {
	ext := extensions(name)
	if !IsDangerousExtension(name) || len(ext) < 2 {
		return false
	}
	prev := ext[len(ext)-2]
	return extLike.MatchString(prev) && hasLetter.MatchString(prev)
}

// Warning kabul diyaloğu uyarı düzeyi.
type Warning string

const (
	WarnNone            Warning = "none"
	WarnDangerous       Warning = "dangerous"
	WarnDoubleExtension Warning = "double_extension"
)

// IsHiddenName S-P28f-9: baştaki noktalı (gizli; `.zshrc`, `.bash_profile`) ad — kabuk başlangıç dosyası olabilir.
func IsHiddenName(name string) bool {
	return strings.HasPrefix(name, ".")
}

// NameWarning AC-36: çift uzantı ayrıca vurgulanır; gizli ad `dangerous` (S-P28f-9; contracts fileNameWarning eşi).
func NameWarning(name string) Warning {
	if IsDoubleExtension(name) {
		return WarnDoubleExtension
	}
	if IsDangerousExtension(name) || IsHiddenName(name) {
		return WarnDangerous
	}
	return WarnNone
}

// launcherPrefix S-P28g-6 m.3: Linux başlatma komutunun deseni (`Destek-<kod>`) alınan dosyaya uymasın.
var launcherPrefix = regexp.MustCompile(`(?i)^destek-`)

// RenamePrefix `destek-` önekli alınan dosyaya eklenen önek (contracts `files.ts` RECEIVED_RENAME_PREFIX).
const RenamePrefix = "Dosya-"

// ReceivedName alıcının diske yazacağı ad (contracts receivedFileName eşi; fikstür "received"): SanitizeFileName sonucu
// `destek-` (büyük/küçük harf duyarsız) ile başlıyorsa `Dosya-` öneki eklenir ve 255 sınırı yeniden uygulanır.
// İdempotenttir. Her platformda uygulanır (S-P28g-6: platformdan bağımsız). `file.meta` teklif edilen temiz adı taşır.
func ReceivedName(raw string) string {
	name := SanitizeFileName(raw)
	if launcherPrefix.MatchString(name) {
		return truncate(RenamePrefix + name)
	}
	return name
}

// IsExecutableContent S-P28g-6 m.3: içeriğin ilk baytları ELF (`\x7fELF`) ya da betik (`#!`) mi — uzantıdan bağımsız
// tehlike uyarısı için (en çok ilk 4 bayt okunur).
func IsExecutableContent(head []byte) bool {
	return len(head) >= 4 && string(head[:4]) == "\x7fELF" || len(head) >= 2 && string(head[:2]) == "#!"
}

// AvailableName §4.2/2: çakışmada ` (1)`, ` (2)` … eklenir; üzerine yazma yok. `exists` hedef klasörde adın
// (veya `.part` eşinin) bulunup bulunmadığını söyler. Ad temizlenmiş olmalı; sonuç da 255 sınırına uyar.
func AvailableName(name string, exists func(string) bool) (string, error) {
	if !exists(name) {
		return name, nil
	}
	stem, ext := name, ""
	if dot := strings.LastIndex(name, "."); dot > 0 {
		stem, ext = name[:dot], name[dot:]
	}
	if len([]rune(ext)) > extKeepMax {
		stem, ext = name, ""
	}
	for n := 1; n <= collisionMax; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		s := []rune(stem)
		if room := NameMax - len([]rune(suffix)) - len([]rune(ext)); len(s) > room {
			s = s[:room]
		}
		cand := string(s) + suffix + ext
		if !exists(cand) {
			return cand, nil
		}
	}
	return "", fmt.Errorf("files: %d denemede boş ad bulunamadı", collisionMax)
}
