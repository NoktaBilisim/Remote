package mac

import (
	"testing"

	"remote-support/agent-win/internal/flow"
)

// AC-542/543 (mimari-p33 §11 "Go birim: seçim mantığı"): Tüm ekran varsayılan; pencere seçilince liste etkin; boş
// liste → Paylaş pasif ve "pencere yok" iletisi; sentetik etkinleştirme yok sayılır; seçilen pencere kimliği → flow.
func TestAC542WindowChoiceTable(t *testing.T) {
	type step func(c *windowChoice)
	mode := func(k clickKind, w bool) step { return func(c *windowChoice) { c.setMode(k, w) } }
	mon := func(k clickKind, id int) step { return func(c *windowChoice) { c.pickMonitor(k, id) } }
	win := func(k clickKind, id uintptr) step { return func(c *windowChoice) { c.pickWindow(k, id) } }
	list := func(ids ...uintptr) step { return func(c *windowChoice) { c.setList(ids) } }
	for _, tc := range []struct {
		name   string
		mons   []int
		def    int
		steps  []step
		submit clickKind
		view   choiceView
		want   flow.ShareChoice
		ok     bool
	}{
		{"varsayılan tüm ekran, def monitör", []int{1, 2}, 2, []step{list(10, 11)}, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 2}, true},
		{"def listede yoksa ilk monitör", []int{1, 2}, 9, nil, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 1}, true},
		{"tek monitör def korunur", []int{5}, 5, nil, clickKeyboard,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 5}, true},
		{"monitör seçimi", []int{1, 2}, 1, []step{mon(clickLocal, 2)}, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 2}, true},
		{"sentetik monitör seçimi yok sayılır", []int{1, 2}, 1, []step{mon(clickInjected, 2)}, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 1}, true},
		{"pencere modu: liste etkin, seçim yok → Paylaş pasif", []int{1}, 1, []step{list(10, 11), mode(clickLocal, true)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true}, flow.ShareChoice{}, false},
		{"pencere seçilir → flow pencere kimliği", []int{1}, 1, []step{list(10, 11), mode(clickLocal, true), win(clickLocal, 11)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true, Checked: 11, ShareEnabled: true}, flow.ShareChoice{Window: 11}, true},
		{"klavye (VoiceOver/Tab) kabul", []int{1}, 1, []step{list(10), mode(clickKeyboard, true), win(clickKeyboard, 10)}, clickKeyboard,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true, Checked: 10, ShareEnabled: true}, flow.ShareChoice{Window: 10}, true},
		{"boş liste → ileti, Paylaş pasif", []int{1}, 1, []step{list(), mode(clickLocal, true)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowEmpty: true}, flow.ShareChoice{}, false},
		{"sentetik mod değişimi yok sayılır", []int{1}, 1, []step{list(10), mode(clickInjected, true)}, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, ShareEnabled: true}, flow.ShareChoice{Monitor: 1}, true},
		{"sentetik pencere seçimi yok sayılır", []int{1}, 1, []step{list(10), mode(clickLocal, true), win(clickInjected, 10)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true}, flow.ShareChoice{}, false},
		{"sentetik Paylaş yok sayılır", []int{1}, 1, []step{list(10), mode(clickLocal, true), win(clickLocal, 10)}, clickInjected,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true, Checked: 10, ShareEnabled: true}, flow.ShareChoice{}, false},
		{"listede olmayan pencere seçilemez", []int{1}, 1, []step{list(10), mode(clickLocal, true), win(clickLocal, 99)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true}, flow.ShareChoice{}, false},
		{"yenilemede kapanan pencerenin seçimi kalkar", []int{1}, 1, []step{list(10, 11), mode(clickLocal, true), win(clickLocal, 11), list(10)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true}, flow.ShareChoice{}, false},
		{"yenilemede kalan pencerenin seçimi korunur", []int{1}, 1, []step{list(10, 11), mode(clickLocal, true), win(clickLocal, 11), list(11, 12)}, clickLocal,
			choiceView{OneChecked: true, ListEnabled: true, ShowList: true, Checked: 11, ShareEnabled: true}, flow.ShareChoice{Window: 11}, true},
		{"tüm ekrana dönüş monitörü paylaşır", []int{1, 2}, 2, []step{list(10), mode(clickLocal, true), win(clickLocal, 10), mode(clickLocal, false)}, clickLocal,
			choiceView{FullChecked: true, MonitorsEnabled: true, ShowList: true, Checked: 10, ShareEnabled: true}, flow.ShareChoice{Monitor: 2}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newWindowChoice(tc.mons, tc.def)
			for _, s := range tc.steps {
				s(&c)
			}
			if got := c.view(); got != tc.view {
				t.Fatalf("görünüm %+v, beklenen %+v", got, tc.view)
			}
			got, ok := c.submit(tc.submit)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("submit %+v %v, beklenen %+v %v", got, ok, tc.want, tc.ok)
			}
		})
	}
}
