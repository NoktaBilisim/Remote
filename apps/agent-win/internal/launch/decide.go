// Package launch istemcinin açılış kararıdır (mimari-e10 §8.1; AC-182, 183, 190; K22): dosya adı, ağ yanıtı ve yerel
// bilgisayar kaydından hangi ekranın açılacağını seçer. Decide saf tablodur; Run onu ağ ve depo ile yürütür.
package launch

// FileKind çalıştırılan dosyanın adı.
type FileKind int

const (
	FileOther FileKind = iota // NoktaDestek.exe, yeniden adlandırılmış
	FileCode                  // Destek-<8 hane>.exe
	FileRef                   // NoktaDestek-<etiket>-<ref>.exe
)

// NetResult dosya adındaki kaynağın sunucu yanıtı (FileOther için anlamsız).
type NetResult int

const (
	NetOK    NetResult = iota // resolve 200 / tenant 200
	NetGone                   // kod: 404/410 (süresi doldu, kullanıldı, iptal); ref: 404 REQUEST_REF_INVALID
	NetError                  // ağ/TLS/429/426 vb. — mevcut mesajlarla gösterilir (değişmez)
)

// Screen açılacak akış.
type Screen int

const (
	ScreenCode Screen = iota // bugünkü kod akışı (P6 karşılama; ağ hataları mevcut mesajlarla)
	ScreenHome               // tek ana ekran: firma listesi (mimari-e11 §8d.3; tek ekran kararı 2026-11-15)
)

// Ana ekran bilgi satırları (mimari-e10 §8.1).
const (
	NoticeCodeExpired = "Bu destek bağlantısının süresi doldu."
	NoticeRefBinding  = "Bu dosya artık geçerli değil; bu bilgisayarın kaydıyla destek isteyebilirsiniz."
	// NoticeRefGone satır 6: geçersiz firma dosyası, kayıt yok (bugünkü engel ekranının metni, ana ekranda).
	NoticeRefGone = "Bu dosya artık geçerli değil. Firmanızdan yenisini isteyin. Teknisyen size kod verdiyse " +
		"Bağlantı kodum var ile devam edebilirsiniz."
)

// Input karar girdisi. Bindings: kanonik kökeni gömülü sunucunun kökeniyle aynı yerel kayıt sayısı (T43; P20 0..5);
// sunucu geçerliliği ana ekranda öğe öğe `bindings/status` ile denetlenir (geçersiz öğe silinir, AC-185).
type Input struct {
	File     FileKind
	Net      NetResult
	Bindings int
	// GoneMessage süresi dolmuş/kullanılmış kodun bugünkü mesajı (satır 3).
	GoneMessage string
}

// Decision Decide çıktısı. FileRow: dosyanın firması ana ekranda üstte ve seçili satırdır; talep o ref ile yürür.
type Decision struct {
	Screen  Screen
	FileRow bool
	Notice  string
}

// Decide mimari-e10 §8.1 karar tablosu (satır numaraları yorumlarda). Kod akışı dışındaki her satır aynı ana ekranı
// açar (kullanıcı kararı 2026-11-15: "işlemler basit olmalı"); satırlar yalnız bilgi satırı ve dosya satırıyla ayrılır.
func Decide(in Input) Decision {
	switch in.File {
	case FileCode:
		switch {
		case in.Net != NetGone: // 1 (ve ağ hataları: bugünkü mesajlar)
			return Decision{Screen: ScreenCode}
		case in.Bindings > 0: // 2
			return Decision{Screen: ScreenHome, Notice: NoticeCodeExpired}
		}
		return Decision{Screen: ScreenHome, Notice: in.GoneMessage} // 3
	case FileRef:
		switch {
		case in.Net != NetGone: // 4; ağ hataları: dosya satırı, bugünkü engel ekranı "Destek iste" ile
			return Decision{Screen: ScreenHome, FileRow: true}
		case in.Bindings > 0: // 5 (K22)
			return Decision{Screen: ScreenHome, Notice: NoticeRefBinding}
		}
		return Decision{Screen: ScreenHome, Notice: NoticeRefGone} // 6
	}
	return Decision{Screen: ScreenHome} // 7, 8
}
