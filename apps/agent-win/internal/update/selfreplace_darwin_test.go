//go:build darwin

package update

import "testing"

// S-r4-11 / AC-507: MacReplacer.Prepare hiçbir girdide Staging döndürmez (zip inmez; yalnız bildirim).
func TestSr411MacPrepareNeverStages(t *testing.T) {
	dir := t.TempDir()
	for _, r := range []MacReplacer{
		{},
		{Bundle: dir},
		{Bundle: dir, Translocated: true},
		{Bundle: dir + "/yok.app"},
	} {
		st, err := r.Prepare()
		if st != nil || err == nil {
			t.Errorf("%+v → staging=%v err=%v", r, st, err)
		}
	}
}
