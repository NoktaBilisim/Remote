package voice

import (
	"slices"
	"testing"
)

// refObj COM nesnesi taklidi: edinmede AddRef (ref 1), release'te Release; bırakma sırası kaydedilir.
type refObj struct {
	name  string
	ref   *int
	order *[]string
}

func (r refObj) release() { *r.ref--; *r.order = append(*r.order, r.name) }

// D-PD-4: tüm arayüzler tek sahipte, ters sırada ve tam bir kez bırakılır (AddRef/Release dengesi).
func TestP28dComReleaseReverseOrderBalanced(t *testing.T) {
	names := []string{"enum", "capDev", "capEvent", "capClient", "capService", "capStop", "renDev", "renEvent", "renClient", "renService", "renStop"}
	refs := make([]int, len(names))
	var order []string
	var o owner
	for i, n := range names {
		refs[i]++ // AddRef (edinme)
		o.add(refObj{n, &refs[i], &order})
	}
	o.add(nil)
	o.releaseAll()
	o.releaseAll() // ikinci çağrı zararsız
	for i, r := range refs {
		if r != 0 {
			t.Fatalf("%s ref=%d; AddRef/Release dengesiz", names[i], r)
		}
	}
	want := slices.Clone(names)
	slices.Reverse(want)
	if !slices.Equal(order, want) {
		t.Fatalf("bırakma sırası %v, beklenen ters %v", order, want)
	}
}

// Hata yolunda yalnız edinilmiş olanlar bırakılır.
func TestP28dComPartialOpenReleasesAcquired(t *testing.T) {
	refs := make([]int, 2)
	var order []string
	var o owner
	o.add(refObj{"enum", &refs[0], &order})
	o.add(refObj{"capDev", &refs[1], &order})
	o.releaseAll()
	if !slices.Equal(order, []string{"capDev", "enum"}) || len(o.items) != 0 {
		t.Fatalf("kısmi açılış bırakma %v", order)
	}
}
