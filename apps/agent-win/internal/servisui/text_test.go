package servisui

import (
	"strings"
	"testing"

	"remote-support/agent-win/internal/servis"
)

func installed(state string) Snapshot {
	return Snapshot{Installed: true, DeviceID: "01JABCDEFGHJKMNPQRSTVWXYZ0", TenantName: "Nokta Bilişim",
		CustomerName: "Acme A.Ş.", Enabled: true, Pipe: PipeOK, State: state}
}

// AC-274: kurulu değilken tek eylem "Kur…".
func TestAC274NotInstalledOffersInstall(t *testing.T) {
	v := Compute(Snapshot{})
	if v.Status != StNotInstalled || v.Primary != ActInstall || v.PrimaryText != ButtonInstall || v.CanUninstall {
		t.Fatalf("görünüm %+v", v)
	}
	if len(v.Lines) != 0 {
		t.Fatalf("kurulu değilken bilgi satırı olmamalı: %v", v.Lines)
	}
}

// AC-274: kuruluyken "Kaldır…" ve bilgi satırları (firma, müşteri, cihaz kimliğinin ilk 8 karakteri).
func TestAC274InstalledShowsUninstallAndInfo(t *testing.T) {
	v := Compute(installed(servis.StateOnline))
	if !v.CanUninstall || v.Status != StOnline || v.StatusText != "Çevrimiçi" {
		t.Fatalf("görünüm %+v", v)
	}
	want := []string{"Destek firması: Nokta Bilişim", "Müşteri: Acme A.Ş.", "Cihaz kimliği: 01JABCDE"}
	if strings.Join(v.Lines, "|") != strings.Join(want, "|") {
		t.Fatalf("satırlar %v", v.Lines)
	}
	if v.Primary != ActDisable || v.PrimaryText != ButtonDisable || v.Tip != TipPrefix+"Açık" {
		t.Fatalf("birincil/ipucu %+v", v)
	}
}

// AC-295 / AC-338: "Kapalı" HKLM'den gelir — boru "online" dese bile LocalEnabled=0 ise yerel kapalı ve "aç…".
func TestAC338LocalOffComesFromHKLMNotPipe(t *testing.T) {
	s := installed(servis.StateOnline)
	s.Enabled = false
	v := Compute(s)
	if v.Status != StLocalOff || v.Primary != ActEnable || v.PrimaryText != ButtonEnable || v.Tip != TipPrefix+"Kapalı" {
		t.Fatalf("görünüm %+v", v)
	}
	s.Pipe, s.State = PipeDown, ""
	if Compute(s).Status != StLocalOff {
		t.Fatal("servis çalışmasa da HKLM kapalıysa durum yerel kapalı olmalı")
	}
}

// AC-338: boru sunucusu servis değilse "Servis doğrulanamadı" her durumun önüne geçer.
func TestAC338UnverifiedWins(t *testing.T) {
	for _, en := range []bool{true, false} {
		s := installed(servis.StateOnline)
		s.Enabled, s.Pipe = en, PipeUnverified
		v := Compute(s)
		if v.Status != StUnverified || v.StatusText != TextUnverified || !strings.Contains(v.Tip, TextUnverified) {
			t.Fatalf("enabled=%v görünüm %+v", en, v)
		}
	}
}

// AC-295: bağlantı sırasında ipucu teknisyen adını taşır; ad temizlenir.
func TestAC295SessionTipCarriesCleanTechName(t *testing.T) {
	s := installed(stateSession)
	s.TechName = "Ali\u202e Veli\n\tYılmaz"
	v := Compute(s)
	if v.Status != StSession || v.StatusText != "Bağlantı var: Ali Veli Yılmaz" {
		t.Fatalf("durum %q", v.StatusText)
	}
	if v.Tip != TipPrefix+"Bağlantı var: Ali Veli Yılmaz" || v.Primary != ActDisable {
		t.Fatalf("görünüm %+v", v)
	}
	s.TechName = ""
	if Compute(s).StatusText != "Bağlantı var" {
		t.Fatal("adsız bağlantı metni")
	}
}

func TestAC295StatesMapToOffline(t *testing.T) {
	for _, st := range []string{servis.StateConnecting, servis.StateOffline, servis.StateRejected, stateUnsafe, ""} {
		v := Compute(installed(st))
		if v.Status != StOffline || v.StatusText != "Bağlanamıyor" || v.Detail == "" {
			t.Fatalf("%q → %+v", st, v)
		}
	}
	s := installed(servis.StateOnline)
	s.Pipe = PipeDown
	if v := Compute(s); v.Status != StOffline || v.Detail != "Servis çalışmıyor." {
		t.Fatalf("boru yok → %+v", v)
	}
}

// İptal edilmiş cihazda açma/kapatma yok, yalnız kaldırma.
func TestRevokedOnlyUninstall(t *testing.T) {
	v := Compute(installed(servis.StateRevoked))
	if v.Status != StRevoked || v.Primary != ActNone || !v.CanUninstall {
		t.Fatalf("görünüm %+v", v)
	}
}

// §5.3: sürüm farklı ve çalışan ikili kurulu kopya değilse "Güncelle…".
func TestUpdateOnlyForDifferentForeignBinary(t *testing.T) {
	s := installed(servis.StateOnline)
	s.InstalledVersion, s.SelfVersion = "0.27.0", "0.27.1"
	if !Compute(s).Update {
		t.Fatal("güncelleme önerilmeli")
	}
	s.SelfIsInstalled = true
	if Compute(s).Update {
		t.Fatal("kurulu kopyanın kendisi güncelleme önermemeli")
	}
	s.SelfIsInstalled, s.SelfVersion = false, "0.27.0"
	if Compute(s).Update {
		t.Fatal("aynı sürüm güncelleme önermemeli")
	}
}

func TestCleanNameAndShortID(t *testing.T) {
	long := strings.Repeat("ş", 80)
	if got := CleanName(long); len([]rune(got)) != maxShownName {
		t.Fatalf("uzunluk %d", len([]rune(got)))
	}
	if got := CleanName("  a\u200b\u0000b  c "); got != "ab c" {
		t.Fatalf("temizlik %q", got)
	}
	if ShortID("01AB") != "01AB" || ShortID("") != "" {
		t.Fatal("kısa kimlik")
	}
	if MenuText("A&B") != "A&&B" {
		t.Fatal("menü & kaçışı")
	}
}

func TestMergeKeepsPreviousOnBusy(t *testing.T) {
	prev := installed(stateSession)
	prev.TechName = "Ali"
	cur := installed("")
	cur.Pipe = PipeBusy
	if m := Merge(prev, cur); m.Pipe != PipeOK || m.State != stateSession || m.TechName != "Ali" {
		t.Fatalf("birleşim %+v", m)
	}
	if m := Merge(Snapshot{}, cur); m.Pipe != PipeOK || m.State != "" {
		t.Fatalf("ilk okuma %+v", m)
	}
	cur.Pipe = PipeUnverified
	if Merge(prev, cur).Pipe != PipeUnverified {
		t.Fatal("doğrulanamadı korunmamalı, aynen geçmeli")
	}
}

func TestUTF16TruncKeepsTerminatorAndPairs(t *testing.T) {
	if got := utf16Trunc("abc", 3); len(got) != 2 {
		t.Fatalf("uzunluk %d", len(got))
	}
	if got := utf16Trunc("a\U0001F600", 3); len(got) != 1 {
		t.Fatalf("vekil çift bölünmemeli: %v", got)
	}
	if got := utf16Trunc("ğ", 4); len(got) != 1 || got[0] != 'ğ' {
		t.Fatalf("Türkçe %v", got)
	}
}
