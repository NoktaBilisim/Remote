package launch

import "regexp"

// P28f (mimari-p28f §2 launch/code_darwin.go, AC-97/AC-392, S-P28f-13): macOS zip'i `Destek-<kod>/Nokta Destek.app`
// olarak açılır; kod bundle'ın (translocation çözülmüş) üst klasör adından, yoksa bundle adından okunur. Desen çapalı:
// tarayıcı/Finder kopya ekleri " (1)" ve " 2" kabul edilir, başka hiçbir şey kabul edilmez.
// P28g (mimari-p28g §4.3): Linux'ta ikili `Destek-<kod>` (uzantısız) adıyla iner; Firefox'un çift indirme adı
// `Destek-12345678(1)` (boşluksuz) da kabul edilir. Karşılama sayfasındaki komutun `find` deseni bununla aynıdır.
var folderCode = regexp.MustCompile(`^Destek-([0-9]{8})(?: ?\([0-9]{1,3}\)| [0-9]{1,3})?$`)

// CodeFromBundlePath özgün bundle yolundan kod; bulunamazsa "" (kod alanı, AC-97). P31: SourceFromBundlePath'in kod
// alanı (geri uyum; firma klasöründe "").
func CodeFromBundlePath(bundle string) string { return SourceFromBundlePath(bundle).Code }

// CodeFromExeName P28g (mimari-p28g §2 launch/code_linux.go): çalışan ikilinin taban adından kod; uymazsa "" (kod
// alanı, AC-97). Ad yalnız taban addır (dizin yok); desen çapalıdır.
func CodeFromExeName(name string) string {
	if m := folderCode.FindStringSubmatch(name); m != nil {
		return m[1]
	}
	return ""
}
