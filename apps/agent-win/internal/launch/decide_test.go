package launch

import "testing"

// TestAC182AC183AC190DecideTable mimari-e10 §8.1 karar tablosunun tüm satırları (+ ağ hatası satırları).
func TestAC182AC183AC190AC254DecideTable(t *testing.T) {
	const gone = "Bu destek bağlantısının süresi doldu. Teknisyeninizden yeni bir bağlantı isteyin."
	cases := []struct {
		row  string
		in   Input
		want Decision
	}{
		{"1 kod geçerli, kayıt yok", Input{File: FileCode, Net: NetOK}, Decision{Screen: ScreenCode}},
		{"1 kod geçerli, kayıt var", Input{File: FileCode, Net: NetOK, Bindings: 1}, Decision{Screen: ScreenCode}},
		{"2 kod geçersiz, kayıt var", Input{File: FileCode, Net: NetGone, Bindings: 1, GoneMessage: gone},
			Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeCodeExpired}},
		{"3 kod geçersiz, kayıt yok", Input{File: FileCode, Net: NetGone, GoneMessage: gone},
			Decision{Screen: ScreenRequest, Source: SourceNone, Notice: gone}},
		{"kod ağ hatası (mesaj değişmez)", Input{File: FileCode, Net: NetError, Bindings: 1}, Decision{Screen: ScreenCode}},
		{"4 ref geçerli, kayıt yok", Input{File: FileRef, Net: NetOK}, Decision{Screen: ScreenRequest, Source: SourceRef}},
		{"4 ref geçerli, kayıt var", Input{File: FileRef, Net: NetOK, Bindings: 1}, Decision{Screen: ScreenRequest, Source: SourceRef}},
		{"5 ref geçersiz, kayıt var (K22)", Input{File: FileRef, Net: NetGone, Bindings: 1},
			Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeRefBinding}},
		{"6 ref geçersiz, kayıt yok", Input{File: FileRef, Net: NetGone}, Decision{Screen: ScreenRequest, Source: SourceRef}},
		{"ref ağ hatası (bugünkü engel ekranı)", Input{File: FileRef, Net: NetError, Bindings: 1}, Decision{Screen: ScreenRequest, Source: SourceRef}},
		{"7 diğer, kayıt var", Input{File: FileOther, Bindings: 1}, Decision{Screen: ScreenRequest, Source: SourceBinding}},
		{"8 diğer, kayıt yok", Input{File: FileOther}, Decision{Screen: ScreenRequest, Source: SourceNone}},
		{"7 diğer, 5 firma", Input{File: FileOther, Bindings: 5}, Decision{Screen: ScreenRequest, Source: SourceBinding}},
		{"5 ref geçersiz, 3 firma", Input{File: FileRef, Net: NetGone, Bindings: 3},
			Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeRefBinding}},
		{"2 kod geçersiz, 2 firma", Input{File: FileCode, Net: NetGone, Bindings: 2, GoneMessage: gone},
			Decision{Screen: ScreenRequest, Source: SourceBinding, Notice: NoticeCodeExpired}},
	}
	for _, c := range cases {
		if got := Decide(c.in); got != c.want {
			t.Errorf("%s: %+v, beklenen %+v", c.row, got, c.want)
		}
	}
}
