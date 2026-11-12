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
	ScreenCode    Screen = iota // bugünkü kod akışı (P6 karşılama; ağ hataları mevcut mesajlarla)
	ScreenRequest               // ana ekran / talep modu (Source'a göre)
)

// Source talep modunun kaynağı.
type Source int

const (
	SourceNone    Source = iota // "Destek iste" pasif (AC-190)
	SourceRef                   // talep dosyadaki ref'e (AC-182 kural 2)
	SourceBinding               // talep bilgisayar kaydıyla
)

// Ana ekran bilgi satırları (mimari-e10 §8.1).
const (
	NoticeCodeExpired = "Bu destek bağlantısının süresi doldu."
	NoticeRefBinding  = "Bu dosya artık geçerli değil; bu bilgisayarın kaydıyla destek isteyebilirsiniz."
)

// Input karar girdisi. Binding: yerel kayıt var VE kanonik kökeni gömülü sunucunun kökeniyle aynı (T43); sunucu
// geçerliliği talep modunda `bindings/status` ile denetlenir (geçersizse satır 8 ekranı + AC-185).
type Input struct {
	File    FileKind
	Net     NetResult
	Binding bool
	// GoneMessage süresi dolmuş/kullanılmış kodun bugünkü mesajı (satır 3).
	GoneMessage string
}

// Decision Decide çıktısı.
type Decision struct {
	Screen Screen
	Source Source
	Notice string
}

// Decide mimari-e10 §8.1 karar tablosu (satır numaraları yorumlarda).
func Decide(in Input) Decision {
	switch in.File {
	case FileCode:
		switch {
		case in.Net != NetGone: // 1 (ve ağ hataları: bugünkü mesajlar)
			return Decision{Screen: ScreenCode}
		case in.Binding: // 2
			return Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeCodeExpired}
		}
		return Decision{Screen: ScreenRequest, Source: SourceNone, Notice: in.GoneMessage} // 3
	case FileRef:
		if in.Net == NetGone && in.Binding { // 5 (K22)
			return Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeRefBinding}
		}
		// 4 (tenant 200 → ref ana ekranı); 6 ve ağ hataları: ref'in ilk yanıtı talep modunda bugünkü engel ekranıyla
		return Decision{Screen: ScreenRequest, Source: SourceRef}
	}
	if in.Binding { // 7
		return Decision{Screen: ScreenRequest, Source: SourceBinding}
	}
	return Decision{Screen: ScreenRequest, Source: SourceNone} // 8
}
