<#
.SYNOPSIS
    Nokta Destek Windows istemcisi kapandıktan sonra makinede iz kalmadığını doğrular (AC-108, T17, mimari §9 / §10.3 P6 DoD).

.DESCRIPTION
    SALT OKUNUR: registry'ye, servislere, görevlere ve dosyalara yazmaz, hiçbir şeyi silmez. Tek yazım, -Mode Snapshot
    ile verilen -SnapshotPath dosyasıdır (taranan bir klasörün içindeyse karşılaştırmada otomatik hariç tutulur).

    Taranan yerler:
      Registry   HKCU\Software, HKLM\Software, HKLM\Software\WOW6432Node (anahtar adları, 2 seviye)
      RunValue   HKCU/HKLM ...\CurrentVersion\Run, RunOnce (32/64 bit görünüm) — değer adı ve komut satırı
      Service    tüm servisler (ad + ImagePath)
      Task       tüm zamanlanmış görevler (yol + ad + eylem komutu)
      Startup    kullanıcı ve ortak Başlangıç klasörü (.lnk hedefi dahil)
      AppData    %APPDATA% (2 seviye)      LocalAppData  %LOCALAPPDATA% (2 seviye)
      Temp       %TEMP% (4 seviye)         Downloads     İndirilenler (1 seviye; yalnız yarım kalan *.part iz sayılır)
      Process    açık kalan istemci süreci (her modda, snapshot'a girmez)

    İz sayılanlar:
      - Ad/komut satırı istemci desenlerine uyan her yeni girdi (NoktaDestek, Nokta Destek, Destek-<8 hane>,
        remote-support, -ExePath dosya adı, -ExtraPattern).
      - İndirilenler'de yeni *.part (AC-108: yarım aktarım kapanışta silinir). Kabul edilmiş tam dosyalar iz değildir.
      - Çalışan istemci süreci (-Tray on iken yalnız bilgi olarak listelenir).
    Desene uymayan yeni girdiler (Windows, Defender, başka uygulamalar) "İNCELEYİN" olarak listelenir; -Strict verilirse
    bunlar da iz sayılır. Windows'un kendi tuttuğu kayıtlar (Prefetch, AmCache, UserAssist, MuiCache,
    AppCompatFlags) istemcinin yazdığı veri değildir, taranmaz. İstemci 0.12.0 (P20) istisnaları: işletim sisteminin
    tepsi simgesi geçmişi (HKCU\Control Panel\NotifyIconSettings\*, ...\CurrentVersion\TrayNotify IconStreams /
    PastIconsStream) ve Görev Yöneticisi > Başlangıç'ın yazdığı ...\Explorer\StartupApproved\Run değeri Windows'undur;
    istemci yazmaz, silemez, taranmaz (mimari-e11 §8d.3).

    Windows PowerShell 5.1 ve PowerShell 7 ile çalışır. Yönetici yetkisi gerekmez (standart kullanıcıda bazı
    HKLM/görev ayrıntıları okunamazsa atlanır).

.PARAMETER Mode
    Snapshot  Mevcut durumu -SnapshotPath'e JSON olarak kaydeder (istemciyi çalıştırmadan ÖNCE).
    Compare   Yeni durumu -SnapshotPath'teki önceki durumla karşılaştırır (istemci kapandıktan SONRA).
    Check     Önceki durum olmadan yalnız desen taraması yapar (varsayılan; desene uyan HER girdi iz sayılır).

.PARAMETER SnapshotPath
    Snapshot/Compare için JSON dosyası. Taranan klasörlerin dışında olması önerilir (ör. masaüstü değil, D:\ veya
    $env:RUNNER_TEMP).

.PARAMETER ExePath
    Çalıştırılan istemci dosyasının yolu (ör. C:\Users\u\Downloads\Destek-12345678.exe). Dosya adı desenlere eklenir,
    bu yoldan çalışan süreç aranır. İndirilenler'deki exe'nin kendisi iz sayılmaz.

.PARAMETER ExtraPattern
    Ek düzenli ifade(ler) (büyük/küçük harf duyarsız).

.PARAMETER Remember
    P8b-2 (AC-137/138, ADR-0004 r3). off (varsayılan): "Bilgilerimi hatırla" kapalı veya "Bilgilerimi unut" sonrası —
    %LOCALAPPDATA%\NoktaDestek dahil hiçbir iz olmamalı. on: hatırla açıkken izin verilen iz %LOCALAPPDATA%\NoktaDestek
    klasörü ve içindeki kayıt dosyasıdır: hatirla.bin (≤ 0.11.x) veya kayitlar.bin + kayitlar.lock (≥ 0.12.0, P20);
    ikisinden biri YOKSA da hata (1) verilir, klasörde başka dosya (ör. *.tmp) iz sayılır. İkisi birden varsa uyarı
    basılır (0.12.0 göçü yarım kalmış ya da 5 firma sınırı nedeniyle hatirla.bin korunmuş; mimari-e11 §8d.1).

.PARAMETER Binding
    P8c (AC-181, 186, 188, ADR-0004 r4). on: bilgisayar kaydı alınmış oturumdan sonra — -Remember on ile aynı kural.
    off (varsayılan): "Bu bilgisayarı unut" sonrası hiçbir iz olmamalı (-Remember off ile birlikte; klasör, kayıt
    dosyaları, kilit dosyası ve Run değeri dahil).

.PARAMETER Tray
    İstemci 0.12.0 (P20, AC-253/254). on: "Tepside çalıştır" açık bir kayıtlı bilgisayar — izinli iz yalnız
    %LOCALAPPDATA%\NoktaDestek\kayitlar.bin ve kayitlar.lock (kayitlar.bin YOKSA hata; tepsi kaydı olmayan bilgisayarda
    yoktur). hatirla.bin iz sayılır (0.12.0 göçten sonra siler). Tepside çalışan istemci süreci iz değil, bilgi olarak
    listelenir. off (varsayılan): süreç iz sayılır.

.PARAMETER Autostart
    İstemci 0.12.0 (P20, AC-253). on: "Windows açılışında başlat" açık — izinli tek kayıt defteri izi
    HKCU\Software\Microsoft\Windows\CurrentVersion\Run altında REG_SZ değer NoktaDestek = "<-ExePath tam yolu>" --tray.
    Değer yoksa, verisi farklıysa veya türü REG_SZ değilse hata (1). HKLM, RunOnce, WOW6432Node ya da başka adlı değer her
    durumda iz sayılır. -Tray on ve -ExePath gerektirir (yoksa 2). off (varsayılan): Run değeri iz sayılır ("Bu
    bilgisayarı unut" ve tepsi kapatıldıktan sonra değer kalmamalı).

.PARAMETER Diagnostics
    İstemci 0.10.2. Tanılama logu (%LOCALAPPDATA%\NoktaDestek\tanilama.log ve dönen tanilama.log.1, toplam ≤ 256 KB)
    yalnız ekran yakalama sorununda ve YALNIZ kalıcı modda (bilgisayar kaydı veya "hatırla" açık; süreç yükseltilmiş
    değilken) yazılır. auto (varsayılan): -Remember on, -Binding on veya -Tray on ise bu iki dosya izinli (zorunlu
    değil), aksi hâlde iz sayılır (kod modunda log oluşmamalı; AC-108). on: her durumda izinli. off: her durumda iz
    sayılır. Kayıt/kişisel veri silindiğinde ("Bu bilgisayarı unut", kayıt yokken "Bilgilerimi unut", geçersiz kayıt)
    log da silinir.

.PARAMETER Update
    İstemci 0.22.0 (P29 K8, AC-484, D-3). off (varsayılan): değişiklik yok. installed: istemci kendini yerinde
    güncelledi ve yeni sürüm henüz açılmadı — izinli tek ek iz İndirilenler'de "<-ExePath>.eski" (görünür, yürütülemez
    uzantı; yeni sürümün ilk açılışında silinir). "<-ExePath>.yeni" (yarım indirme) her durumda izdir. relaunched: yeni
    sürüm bir kez açılıp kapandı — .eski de iz sayılır (off ile aynı). -ExePath gerektirir (yoksa 2).

.PARAMETER Servis
    P27 K9 (mimari-p27 §5.3, AC-289/340, D-P27-2). Gözetimsiz erişim servisi (NoktaDestekServis.exe) profili. Tarama her
    modda ayrıca %ProgramFiles% ve %ProgramData% (1 seviye), HKLM ...\Uninstall anahtarlarını ve Application olay günlüğü
    kaynaklarını kapsar; servis kaldırıldıktan sonra (off, varsayılan) bunların hiçbirinde NoktaDestek izi kalmamalı.
    on: kurulu servis — izinli izler: hizmet NoktaDestekServis (ImagePath tam olarak
    "%ProgramFiles%\NoktaDestek Servis\NoktaDestekServis.exe" --service, tırnaklı), HKLM\SOFTWARE\NoktaDestek\Servis,
    HKLM Run NoktaDestekServis = "<exe>" --tray (REG_SZ), Uninstall\NoktaDestekServis, olay kaynağı NoktaDestek,
    %ProgramFiles%\NoktaDestek Servis\ ve %ProgramData%\NoktaDestek Servis\ (device.key.tmp hariç). Ayrıca klasör
    denetimi: %ProgramData%\NoktaDestek Servis ve Gelen\ sahibi SYSTEM/Administrators, DACL korumalı (devralma kapalı),
    ACE kümesi tam olarak SY+BA tam (Gelen: + Authenticated Users okuma/yürütme 0x1200a9), reparse noktası yok.
    Yönetici yetkisi ister (yoksa 2). "NoktaDestek Servis.eski-*" (squatting önlemi) iz değil UYARI'dır.
    Kaldırıcının geçici kopyası %SystemRoot%\Temp\NoktaDestekServis-kaldir-<16 hex>\ (D-P27-K5) her modda taranır:
    PendingFileRenameOperations'ta yeniden başlatmada silinmek üzere kayıtlıysa UYARI, değilse iz; yeniden başlatma
    sonrası hiç görünmemeli.

.PARAMETER ContentMarker
    P28a K7 (mimari-p28 §9, r2 D-P28a-3; AC-347/350/351). Pano metni ve yazdırılan dosya adı istemci günlüğüne, tanılama
    paketine (internal/diag) ve diske GEÇMEMELİ. Varsayılan işaretler: 'P28A-ISARET-' (elle turda panoya konan metin) ve
    'gizli-ad-' (yazdırılan PDF'in adı). Compare/Check modlarında her zaman taranır (büyük/küçük harf duyarsız; içerik
    UTF-8 ve UTF-16LE olarak):
      - %LOCALAPPDATA%\NoktaDestek\ altındaki tüm dosyalar (tanilama.log, tanilama.log.1, kayıt dosyaları),
      - %ProgramData%\NoktaDestek Servis\ altındaki tüm dosyalar (okunabildiği kadar; yönetici değilseniz UYARI),
      - %TEMP% dosyaları (Compare: önceki durumdan sonra değişenler; Check: yalnız istemci desenine uyanlar),
      - Application olay günlüğünde kaynak 'NoktaDestek' olaylarının metni (Compare: önceki durumdan sonrakiler),
      - taranan tüm girdilerin YOLU (ör. %TEMP%\gizli-ad-1.pdf, İndirilenler'de gizli-ad-*.pdf).
    Bulunan her eşleşme iz sayılır ("İÇERİK İŞARETİ [D-P28a-3]"); eşleşen içerik ekrana BASILMAZ, yalnız yer + işaret.
    Boş dizi (-ContentMarker @()) taramayı kapatır. OS yazdırma kuyruğu (spool) taranmaz; belge adı sabittir
    ("NoktaDestek uzaktan yazdırma", dosya adı kuyruğa düşmez).

.PARAMETER Strict
    Desene uymayan yeni girdileri de iz say (sessiz, temiz bir VM'de kullanın).

.OUTPUTS
    Çıkış kodu: 0 = temiz (Snapshot modunda: kaydedildi), 1 = iz bulundu, 2 = kullanım/ortam hatası
    (Windows değil, SnapshotPath eksik/okunamaz, -Autostart on için -Tray on / -ExePath eksik).

.EXAMPLE
    # Elle test (Windows VM, runbook §11.8):
    pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Snapshot -SnapshotPath D:\iz-once.json
    # ... istemciyi çalıştır, oturumu bitir, kapanmasını bekle ...
    # Kayıt alınmış oturum sonrası: -Binding on; "Bu bilgisayarı unut" sonrası: -Binding off -Remember off
    # Firma dosyası + "hatırla" açık: -Remember on -ExePath "$env:USERPROFILE\Downloads\NoktaDestek-Firma-<ref>.exe"
    # 0.12.0 tepsi + Windows açılışı açık (runbook §24.9): -Binding on -Tray on -Autostart on -ExePath "<exe tam yolu>"
    # P27 gözetimsiz servis kurulu (yönetici PowerShell): -Servis on ; kaldırıldıktan sonra: -Servis off (varsayılan)
    # 0.12.0 "Bu bilgisayarı unut" sonrası: -Binding off -Remember off -Tray off -Autostart off (varsayılanlar)
    # 0.13.0 pano + yazdırma turu (runbook §28a.4): P28A-ISARET- / gizli-ad- içerik taraması her Compare/Check'te açık
    pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Compare -SnapshotPath D:\iz-once.json -ExePath "$env:USERPROFILE\Downloads\Destek-12345678.exe"

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File trace-check.ps1     # PowerShell 7 yoksa; yalnız desen taraması
#>
[CmdletBinding()]
param(
    [ValidateSet('Snapshot', 'Compare', 'Check')]
    [string]$Mode = 'Check',
    [string]$SnapshotPath,
    [string]$ExePath,
    [string[]]$ExtraPattern = @(),
    [ValidateSet('on', 'off')]
    [string]$Remember = 'off',
    [ValidateSet('on', 'off')]
    [string]$Binding = 'off',
    [ValidateSet('on', 'off')]
    [string]$Tray = 'off',
    [ValidateSet('on', 'off')]
    [string]$Autostart = 'off',
    [ValidateSet('auto', 'on', 'off')]
    [string]$Diagnostics = 'auto',
    [ValidateSet('on', 'off')]
    [string]$Servis = 'off',
    [ValidateSet('off', 'installed', 'relaunched')]
    [string]$Update = 'off',
    [string[]]$ContentMarker = @('P28A-ISARET-', 'gizli-ad-'),
    [switch]$Strict
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:BasePatterns = @(
    'NoktaDestek',
    'Nokta[ _.-]Destek',
    'Destek-\d{8}',
    'remote-support'
)

function Get-TracePattern {
    param([string]$Exe, [string[]]$Extra)
    $p = @($script:BasePatterns)
    if ($Exe) {
        $name = ($Exe -split '[\\/]')[-1] -replace '(?i)\.exe$', ''
        $p += [regex]::Escape($name)
    }
    foreach ($e in $Extra) { if ($e) { $p += $e } }
    return '(?i)(' + ($p -join '|') + ')'
}

function Test-TraceEntry {
    # Bir girdi ("Kategori<TAB>öğe") istemciye ait mi? .part kuralı yalnız İndirilenler için.
    param([string]$Entry, [string]$Pattern, [string]$ExeFull)
    $cat, $item = $Entry -split "`t", 2
    if ($ExeFull -and $cat -eq 'Downloads' -and $item -ieq $ExeFull) { return $false }
    if ($cat -eq 'Downloads' -and $item -match '(?i)\.part$') { return $true }
    return [bool]($item -match $Pattern)
}

function Compare-TraceSnapshot {
    # Saf fonksiyon: önce/sonra listelerinden { Trace; Review; Preexisting } üretir.
    param([string[]]$Before, [string[]]$After, [string]$Pattern, [string]$ExeFull, [string[]]$Exclude = @(),
        [string[]]$Allowed = @())
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($b in $Before) { [void]$set.Add($b) }
    $trace = @(); $review = @(); $pre = @()
    foreach ($a in $After) {
        $item = ($a -split "`t", 2)[-1]
        if ($Exclude -contains $item -or ($ExeFull -and $item -ieq $ExeFull)) { continue }   # snapshot dosyası, exe'nin kendisi
        if ($Allowed -contains $a) { continue }   # -Remember on: izin verilen tek iz (AC-138)
        $isTrace = Test-TraceEntry -Entry $a -Pattern $Pattern -ExeFull $ExeFull
        if ($set.Contains($a)) {
            if ($isTrace) { $pre += $a }
        } elseif ($isTrace) {
            $trace += $a
        } else {
            $review += $a
        }
    }
    return [pscustomobject]@{ Trace = $trace; Review = $review; Preexisting = $pre }
}

$script:RunKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$script:RunValueName = 'NoktaDestek'

function Get-TraceAllowance {
    # Saf fonksiyon: parametrelerden { Allowed; Missing; Warning } üretir. Allowed = izinli girdiler, Missing = olması
    # gerekirken yok (iz gibi hata), Warning = bilgi. $After yalnız varlık denetimi için okunur.
    param([string]$StoreDir, [string]$Remember, [string]$Binding, [string]$Tray, [string]$Autostart,
        [string]$Diagnostics, [string]$ExeFull, [string[]]$After = @())
    $legacy = "$StoreDir\hatirla.bin"   # Join-Path değil: saf fonksiyon (Windows dışında birim testi)
    $v3 = "$StoreDir\kayitlar.bin"
    $lock = "$StoreDir\kayitlar.lock"
    $has = { param($f) $After -contains "LocalAppData`t$f" }
    $allowed = @(); $missing = @(); $warning = @()
    if ($Tray -eq 'on') {
        # Tepsi yalnız kayıtlı bilgisayarda (prefs yalnız bindings doluyken yazılır, §8d.1); 0.12.0 hatirla.bin'i göçten sonra siler.
        $allowed += @("LocalAppData`t$StoreDir", "LocalAppData`t$v3", "LocalAppData`t$lock")
        if (-not (& $has $v3)) { $missing += "Beklenen kayıt dosyası yok (-Tray on): $v3" }
    } elseif ($Remember -eq 'on' -or $Binding -eq 'on') {
        $allowed += @("LocalAppData`t$StoreDir", "LocalAppData`t$legacy", "LocalAppData`t$v3", "LocalAppData`t$lock")
        if (-not ((& $has $legacy) -or (& $has $v3))) { $missing += "Beklenen kayıt dosyası yok: $legacy veya $v3" }
        if ((& $has $legacy) -and (& $has $v3)) {
            $warning += "hatirla.bin ve kayitlar.bin birlikte: 0.12.0 göçü yarım ya da 5 firma sınırı (mimari-e11 §8d.1 m.3)"
        }
    }
    $persistent = ($Remember -eq 'on' -or $Binding -eq 'on' -or $Tray -eq 'on')
    if ($Diagnostics -eq 'on' -or ($Diagnostics -eq 'auto' -and $persistent)) {
        $allowed += @("LocalAppData`t$StoreDir", "LocalAppData`t$StoreDir\tanilama.log", "LocalAppData`t$StoreDir\tanilama.log.1")
    }
    if ($Autostart -eq 'on') {
        # Biçim autorun.Command ile aynı: "<kanonik yol>" --tray (G-P20-6). Karşılaştırma büyük/küçük harf duyarsız.
        $run = "RunValue`t$($script:RunKey)\$($script:RunValueName)=`"$ExeFull`" --tray"
        $allowed += $run
        if (-not ($After -contains $run)) {
            $missing += "Beklenen Run değeri yok veya verisi farklı: $($script:RunKey)\$($script:RunValueName) = `"$ExeFull`" --tray"
        }
    }
    return [pscustomobject]@{ Allowed = @($allowed | Select-Object -Unique); Missing = $missing; Warning = $warning }
}

$script:UninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
$script:EventLogKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Application'

function Get-ServisAllowance {
    # Saf fonksiyon (P27 K9): -Servis on izinli girdileri ve eksikleri üretir. $Pf/$Pd = %ProgramFiles%/%ProgramData%.
    param([string]$Pf, [string]$Pd, [string[]]$After = @())
    $dir = "$Pf\NoktaDestek Servis"; $exe = "$dir\NoktaDestekServis.exe"; $data = "$Pd\NoktaDestek Servis"
    $svc = "Service`tNoktaDestekServis=`"$exe`" --service"
    $run = "RunValue`tHKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\NoktaDestekServis=`"$exe`" --tray"
    $allowed = @($svc, $run, "ProgramFiles`t$dir", "ProgramFiles`t$exe",
        'Registry`tHKEY_LOCAL_MACHINE\SOFTWARE\NoktaDestek', 'Registry`tHKEY_LOCAL_MACHINE\SOFTWARE\NoktaDestek\Servis',
        "Uninstall`tNoktaDestekServis", "EventSource`tNoktaDestek", "ProgramData`t$data")
    $allowed = @($allowed | ForEach-Object { $_ -replace '`t', "`t" })
    foreach ($a in $After) {
        $cat, $item = $a -split "`t", 2
        if ($cat -eq 'ProgramData' -and $item -like "$data\*" -and $item -notlike '*\device.key.tmp') { $allowed += $a }
    }
    $missing = @(); $warning = @()
    foreach ($need in $svc, "ProgramFiles`t$exe", "ProgramData`t$data") {
        if (-not ($After -contains $need)) { $missing += "Beklenen servis izi yok veya farklı: $need" }
    }
    foreach ($a in $After) {
        $cat, $item = $a -split "`t", 2
        if ($cat -eq 'Service' -and $item -like 'NoktaDestekServis=*' -and $a -ne $svc) {
            $missing += "ImagePath tırnaklı ve Program Files altında değil (D-P27-2): $item"
        }
        if ($cat -eq 'ProgramData' -and $item -like "$data.eski-*") { $warning += "squatting önlemi klasörü (inceleyin): $item" }
    }
    return [pscustomobject]@{ Allowed = $allowed; Missing = $missing; Warning = $warning }
}

function Split-PendingUninstallCopy {
    # Saf fonksiyon (D-P27-K5): yeniden başlatmada silinmek üzere kayıtlı (PendingFileRenameOperations) kaldırma kopyası
    # klasörleri iz değil UYARI'dır; kayıtlı değilse iz kalır. $Pending çoklu dize, yollar `\??\` önekli olabilir.
    param([string[]]$After, [string[]]$Pending)
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($p in $Pending) { if ($p) { [void]$set.Add(($p -replace '^\\\?\?\\', '').TrimEnd('\')) } }
    $keep = @(); $warning = @()
    foreach ($a in $After) {
        $cat, $item = $a -split "`t", 2
        if ($cat -eq 'WinTemp' -and $set.Contains($item.TrimEnd('\'))) {
            $warning += "kaldırma kopyası yeniden başlatmada silinecek (yeniden başlatıp tekrar çalıştırın): $item"
        } else { $keep += $a }
    }
    return [pscustomobject]@{ After = $keep; Warning = $warning }
}

function Test-ServisAcl {
    # Saf fonksiyon (P27 K9, mimari-p27 §5.3 r2): klasör sahip/DACL/ACE denetimi. $Aces: @{ Sid; Rights (int); Allow (bool);
    # Inherited (bool) }. Beklenen: sahip SY/BA, korumalı DACL, izin ACE'leri tam olarak $Expect (sid -> rights), deny yok.
    param([string]$Path, [string]$Owner, [bool]$Protected, [object[]]$Aces, [hashtable]$Expect, [bool]$Reparse)
    $p = @()
    if ($Owner -notin 'S-1-5-18', 'S-1-5-32-544') { $p += "$Path sahibi SYSTEM/Administrators değil ($Owner)" }
    if (-not $Protected) { $p += "$Path DACL korumalı değil (devralma açık)" }
    if ($Reparse) { $p += "$Path reparse noktası (junction/symlink)" }
    $seen = @{}
    foreach ($a in $Aces) {
        if (-not $a.Allow) { $p += "$Path beklenmeyen deny ACE: $($a.Sid)"; continue }
        if (-not $Expect.ContainsKey($a.Sid)) { $p += "$Path beklenmeyen ACE: $($a.Sid) 0x$('{0:x}' -f $a.Rights)"; continue }
        if ([int]$a.Rights -ne [int]$Expect[$a.Sid]) { $p += "$Path $($a.Sid) hakları 0x$('{0:x}' -f $a.Rights), beklenen 0x$('{0:x}' -f $Expect[$a.Sid])" }
        $seen[$a.Sid] = $true
    }
    foreach ($k in $Expect.Keys) { if (-not $seen.ContainsKey($k)) { $p += "$Path ACE eksik: $k" } }
    return $p
}

function Get-ServisAclProblem {
    # Windows'ta gerçek klasörleri okur ve Test-ServisAcl'e verir (yönetici gerekir: klasör yalnız SY/BA'ya açık).
    param([string]$Pd)
    $full = 0x1F01FF; $rx = 0x1200A9
    $data = Join-Path $Pd 'NoktaDestek Servis'
    if (-not (Test-Path -LiteralPath $data)) { return @("$data yok") }
    $p = @()
    $targets = @(@{ P = $data; E = @{ 'S-1-5-18' = $full; 'S-1-5-32-544' = $full } })
    $gelen = Join-Path $data 'Gelen'
    if (Test-Path -LiteralPath $gelen) {
        $targets += @{ P = $gelen; E = @{ 'S-1-5-18' = $full; 'S-1-5-32-544' = $full; 'S-1-5-11' = $rx } }
    }
    foreach ($t in $targets) {
        $acl = Get-Acl -LiteralPath $t.P
        $owner = (New-Object Security.Principal.NTAccount $acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
        # Kalıtımla gelen (OICI'den alt nesneye düşen) ACE'ler aynı klasörde görünmez; yalnız açık ACE'ler sayılır.
        $aces = @($acl.Access | Where-Object { -not $_.IsInherited } | ForEach-Object {
                @{ Sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                    Rights = [int]$_.FileSystemRights; Allow = ($_.AccessControlType -eq 'Allow') }
            })
        $rp = [bool]((Get-Item -LiteralPath $t.P -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
        $p += Test-ServisAcl -Path $t.P -Owner $owner -Protected $acl.AreAccessRulesProtected -Aces $aces -Expect $t.E -Reparse $rp
    }
    Get-ChildItem -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
        ForEach-Object { $p += "$($_.FullName) reparse noktası (junction/symlink)" }
    return $p
}

function Find-MarkerInText {
    # Saf fonksiyon (P28a D-P28a-3): metin(ler)de geçen işaretleri döndürür (büyük/küçük harf duyarsız). İçerik döndürmez.
    param([string[]]$Text, [string[]]$Marker)
    $hits = @()
    foreach ($m in $Marker) {
        if (-not $m) { continue }
        foreach ($t in $Text) {
            if ($t -and $t.IndexOf($m, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hits += $m; break }
        }
    }
    return $hits
}

function Find-ContentMarker {
    # Saf fonksiyon (P28a D-P28a-3): bayt içeriğini UTF-8 ve UTF-16LE (iki hizalama) olarak çözüp işaretleri arar.
    param([byte[]]$Bytes, [string[]]$Marker)
    if (-not $Bytes -or $Bytes.Length -eq 0) { return @() }
    $texts = @([Text.Encoding]::UTF8.GetString($Bytes), [Text.Encoding]::Unicode.GetString($Bytes))
    if ($Bytes.Length -gt 2) { $texts += [Text.Encoding]::Unicode.GetString($Bytes, 1, $Bytes.Length - 1) }
    return @(Find-MarkerInText -Text $texts -Marker $Marker)
}

function Find-PathMarker {
    # Saf fonksiyon (P28a D-P28a-3): taranan girdilerin yolunda/adında işaret (ör. %TEMP%\gizli-ad-1.pdf) — iz satırları.
    param([string[]]$Entries, [string[]]$Marker)
    $out = @()
    foreach ($a in $Entries) {
        $item = ($a -split "`t", 2)[-1]
        foreach ($m in @(Find-MarkerInText -Text @($item) -Marker $Marker)) { $out += "İÇERİK İŞARETİ [D-P28a-3] yol '$m': $a" }
    }
    return $out
}

function Get-ContentMarkerHit {
    # Windows: istemci günlüğü/tanılama/servis verisi, %TEMP% ve olay günlüğünde işaret arar. { Trace; Warning }.
    # $Since: Compare'de önceki durum zamanı (yalnız sonrası); Check'te $null. Eşleşen içerik döndürülmez.
    param([string[]]$Marker, $Since, [string]$Pattern)
    $trace = @(); $warning = @()
    $maxBytes = 16MB
    $files = @()
    foreach ($root in (Join-Path $env:LOCALAPPDATA 'NoktaDestek'), (Join-Path $env:ProgramData 'NoktaDestek Servis')) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $errs = $null
        $files += @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable errs)
        if ($errs) { $warning += "içerik taraması: $root altı kısmen okunamadı (yönetici PowerShell ile yineleyin)" }
    }
    Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Recurse -Depth 3 -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($null -ne $Since) { if ($_.LastWriteTime -ge $Since) { $files += $_ } }
        elseif ($_.FullName -match $Pattern) { $files += $_ }
    }
    foreach ($f in $files) {
        if ($f.Length -gt $maxBytes) { $warning += "içerik taraması: $($f.FullName) $maxBytes bayttan büyük, atlandı"; continue }
        $bytes = $null
        try { $bytes = [IO.File]::ReadAllBytes($f.FullName) } catch { $warning += "içerik taraması: $($f.FullName) okunamadı"; continue }
        foreach ($m in @(Find-ContentMarker -Bytes $bytes -Marker $Marker)) { $trace += "İÇERİK İŞARETİ [D-P28a-3] dosya '$m': $($f.FullName)" }
    }
    $filter = @{ LogName = 'Application'; ProviderName = 'NoktaDestek' }
    if ($null -ne $Since) { $filter.StartTime = $Since }
    $events = @()
    try { $events = @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop) } catch { $events = @() }   # olay/kaynak yok
    foreach ($ev in $events) {
        $txt = @([string]$ev.Message) + @($ev.Properties | ForEach-Object { [string]$_.Value })
        foreach ($m in @(Find-MarkerInText -Text $txt -Marker $Marker)) {
            $trace += "İÇERİK İŞARETİ [D-P28a-3] olay günlüğü '$m': Application/NoktaDestek kayıt $($ev.RecordId) ($($ev.TimeCreated.ToString('o')))"
        }
    }
    return [pscustomobject]@{ Trace = $trace; Warning = $warning }
}

function Get-DownloadsPath {
    $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
    $v = (Get-ItemProperty -Path $k -Name '{374DE290-123F-4565-9164-39C4925E467B}' -ErrorAction SilentlyContinue)
    if ($v) { return [Environment]::ExpandEnvironmentVariables($v.'{374DE290-123F-4565-9164-39C4925E467B}') }
    return (Join-Path $env:USERPROFILE 'Downloads')
}

function Get-FileEntry {
    param([string]$Category, [string]$Root, [int]$Depth)
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { return @() }
    Get-ChildItem -LiteralPath $Root -Recurse -Depth $Depth -Force -ErrorAction SilentlyContinue |
        ForEach-Object { "$Category`t$($_.FullName)" }
}

function Get-TraceSnapshot {
    $e = New-Object 'System.Collections.Generic.List[string]'

    foreach ($root in 'HKCU:\Software', 'HKLM:\SOFTWARE', 'HKLM:\SOFTWARE\WOW6432Node') {
        Get-ChildItem -Path $root -Recurse -Depth 1 -ErrorAction SilentlyContinue |
            ForEach-Object { $e.Add("Registry`t$($_.Name)") }
    }

    $runKeys = foreach ($hive in 'HKCU:', 'HKLM:') {
        foreach ($view in 'SOFTWARE', 'SOFTWARE\WOW6432Node') {
            foreach ($leaf in 'Run', 'RunOnce') { "$hive\$view\Microsoft\Windows\CurrentVersion\$leaf" }
        }
    }
    foreach ($k in $runKeys) {
        $props = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
        if (-not $props) { continue }
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like 'PS*') { continue }
            $e.Add("RunValue`t$k\$($p.Name)=$($p.Value)")
        }
    }

    Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue |
        ForEach-Object { $e.Add("Service`t$($_.Name)=$($_.PathName)") }

    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
        Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
            $acts = @($_.Actions | ForEach-Object {
                    if ($_.PSObject.Properties['Execute']) { "$($_.Execute) $($_.Arguments)".Trim() }
                }) -join ' ; '
            $e.Add("Task`t$($_.TaskPath)$($_.TaskName)=$acts")
        }
    }

    $shell = $null
    try { $shell = New-Object -ComObject WScript.Shell } catch { $shell = $null }
    foreach ($sf in 'Startup', 'CommonStartup') {
        $dir = [Environment]::GetFolderPath($sf)
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $target = ''
            if ($shell -and $_.Extension -ieq '.lnk') {
                try { $target = $shell.CreateShortcut($_.FullName).TargetPath } catch { $target = '' }
            }
            $e.Add("Startup`t$($_.FullName)=$target")
        }
    }

    foreach ($x in @(Get-FileEntry -Category 'AppData' -Root $env:APPDATA -Depth 1)) { $e.Add($x) }
    foreach ($x in @(Get-FileEntry -Category 'LocalAppData' -Root $env:LOCALAPPDATA -Depth 1)) { $e.Add($x) }
    foreach ($x in @(Get-FileEntry -Category 'Temp' -Root ([IO.Path]::GetTempPath()) -Depth 3)) { $e.Add($x) }
    foreach ($x in @(Get-FileEntry -Category 'Downloads' -Root (Get-DownloadsPath) -Depth 0)) { $e.Add($x) }
    # P27 K9: gözetimsiz servis kurulum yerleri (her modda; kaldırma sonrası iz kalmamalı).
    foreach ($x in @(Get-FileEntry -Category 'ProgramFiles' -Root $env:ProgramFiles -Depth 1)) { $e.Add($x) }
    foreach ($x in @(Get-FileEntry -Category 'ProgramData' -Root $env:ProgramData -Depth 1)) { $e.Add($x) }
    # D-P27-K5: kaldırıcının geçici kopya klasörü %SystemRoot%\Temp\NoktaDestekServis-kaldir-* (yalnız bu ad; klasörün
    # geri kalanı taranmaz, içi SY/BA'ya kapalı).
    Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'Temp') -Filter 'NoktaDestekServis-kaldir-*' -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $e.Add("WinTemp`t$($_.FullName)") }
    foreach ($k in $script:UninstallKey, $script:EventLogKey) {
        $cat = if ($k -eq $script:UninstallKey) { 'Uninstall' } else { 'EventSource' }
        Get-ChildItem -Path $k -ErrorAction SilentlyContinue | ForEach-Object { $e.Add("$cat`t$($_.PSChildName)") }
    }

    return , $e.ToArray()
}

function Get-TraceProcess {
    param([string]$Pattern, [string]$ExeFull)
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $path = $null
            try { $path = $_.Path } catch { $path = $null }
            ($_.ProcessName -match $Pattern) -or ($ExeFull -and $path -and ($path -ieq $ExeFull))
        } | ForEach-Object { "Process`t$($_.ProcessName) (PID $($_.Id)) $($_.Path)" })
}

# ---------------------------------------------------------------- ana akış
if ($MyInvocation.InvocationName -eq '.') { return }   # nokta-kaynak (birim testi): yalnız fonksiyonlar

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Write-Output 'HATA: trace-check.ps1 yalnız Windows''ta çalışır.'
    exit 2
}
if ($Mode -ne 'Check' -and -not $SnapshotPath) {
    Write-Output "HATA: -Mode $Mode için -SnapshotPath gerekli."
    exit 2
}

if ($Autostart -eq 'on' -and ($Tray -ne 'on' -or -not $ExePath)) {
    Write-Output 'HATA: -Autostart on için -Tray on ve -ExePath gerekli (Windows açılışı yalnız tepsiyle; Run verisi exe yolunu taşır).'
    exit 2
}
if ($Servis -eq 'on') {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { Write-Output 'HATA: -Servis on yönetici yetkisi ister (klasör ACL''i yalnız SY/BA okunur).'; exit 2 }
}
$exeFull = if ($ExePath) { [IO.Path]::GetFullPath($ExePath) } else { '' }
$pattern = Get-TracePattern -Exe $ExePath -Extra $ExtraPattern

if ($Mode -eq 'Snapshot') {
    $snap = Get-TraceSnapshot
    $full = [IO.Path]::GetFullPath($SnapshotPath)
    ConvertTo-Json -InputObject @{ created = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; entries = $snap } -Depth 3 |
        Set-Content -LiteralPath $full -Encoding UTF8
    Write-Output "Önceki durum kaydedildi: $full ($($snap.Count) girdi)"
    exit 0
}

$before = @()
$exclude = @()
$since = $null
if ($Mode -eq 'Compare') {
    $full = [IO.Path]::GetFullPath($SnapshotPath)
    try {
        $snapObj = Get-Content -LiteralPath $full -Raw -Encoding UTF8 | ConvertFrom-Json
        $before = @($snapObj.entries)
        if ($snapObj.created) { $since = if ($snapObj.created -is [datetime]) { $snapObj.created } else { [datetime]::Parse([string]$snapObj.created, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } }
    } catch {
        Write-Output "HATA: önceki durum okunamadı: $full ($($_.Exception.Message))"
        exit 2
    }
    $exclude = @($full)
}

$after = Get-TraceSnapshot
$al = Get-TraceAllowance -StoreDir (Join-Path $env:LOCALAPPDATA 'NoktaDestek') -Remember $Remember -Binding $Binding `
    -Tray $Tray -Autostart $Autostart -Diagnostics $Diagnostics -ExeFull $exeFull -After $after
$missing = @($al.Missing)
if ($Autostart -eq 'on') {
    # G-P20-6: değer yalnız REG_SZ (Get-ItemProperty REG_EXPAND_SZ'yi genişletip aynı veriyi gösterirdi).
    $kind = $null
    try { $kind = (Get-Item -LiteralPath $script:RunKey).GetValueKind($script:RunValueName) } catch { $kind = $null }
    if ($null -ne $kind -and $kind -ne [Microsoft.Win32.RegistryValueKind]::String) {
        $missing += "Run değeri REG_SZ değil ($kind): $($script:RunKey)\$($script:RunValueName)"
    }
}
$allowedAll = @($al.Allowed)
if ($Update -ne 'off' -and -not $exeFull) { Write-Error '-Update -ExePath gerektirir'; exit 2 }
if ($Update -eq 'installed') { $allowedAll += "Downloads`t$exeFull.eski" }   # P29 D-3: sonraki açılışa kadar
$pendingOps = @()   # değer yoksa (bekleyen işlem yok) Get-ItemProperty hata verir
try {
    $pendingOps = @((Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' `
                -Name PendingFileRenameOperations -ErrorAction Stop).PendingFileRenameOperations)
} catch { $pendingOps = @() }
$pc = Split-PendingUninstallCopy -After $after -Pending $pendingOps
$after = @($pc.After)
$servisWarn = @($pc.Warning)
if ($Servis -eq 'on') {
    $sa = Get-ServisAllowance -Pf $env:ProgramFiles -Pd $env:ProgramData -After $after
    $allowedAll += $sa.Allowed; $missing += $sa.Missing; $servisWarn += @($sa.Warning)
    $missing += @(Get-ServisAclProblem -Pd $env:ProgramData)
    $rk = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
    $kind = $null
    try { $kind = (Get-Item -LiteralPath $rk).GetValueKind('NoktaDestekServis') } catch { $kind = $null }
    if ($null -ne $kind -and $kind -ne [Microsoft.Win32.RegistryValueKind]::String) { $missing += "HKLM Run NoktaDestekServis REG_SZ değil ($kind)" }
} else {
    foreach ($a in $after) {
        $item = ($a -split "`t", 2)[-1]
        if ($a -like "ProgramData`t*" -and $item -like '*\NoktaDestek Servis.eski-*') { $servisWarn += "squatting önlemi klasörü (inceleyin): $item" }
    }
    $after = @($after | Where-Object { -not ($_ -like "ProgramData`t*" -and $_ -like '*\NoktaDestek Servis.eski-*') })
}
$r = Compare-TraceSnapshot -Before $before -After $after -Pattern $pattern -ExeFull $exeFull -Exclude $exclude -Allowed $allowedAll
$procs = @(Get-TraceProcess -Pattern $pattern -ExeFull $exeFull)
$procInfo = @()
if ($Tray -eq 'on') { $procInfo = $procs; $procs = @() }
if ($Servis -eq 'on') {   # kurulu servis (ve yardımcı/tepsi) çalışır: iz değil, bilgi
    $procInfo += @($procs | Where-Object { $_ -match '(?i)NoktaDestekServis' }); $procs = @($procs | Where-Object { $_ -notmatch '(?i)NoktaDestekServis' })
}   # tepside çalışan istemci iz değil (AC-253, K-P20-7)

$traces = @($r.Trace) + @($procs) + @($missing)
$markerWarn = @()
if (@($ContentMarker | Where-Object { $_ }).Count -gt 0) {   # P28a D-P28a-3: içerik işaretleri (pano metni, yazdırılan dosya adı)
    $traces += @(Find-PathMarker -Entries $after -Marker $ContentMarker)
    $ch = Get-ContentMarkerHit -Marker $ContentMarker -Since $since -Pattern $pattern
    $traces += @($ch.Trace); $markerWarn = @($ch.Warning)
}
if ($Mode -eq 'Check') {
    # Önceki durum yok: desene uyan her girdi iz sayılır (Compare-TraceSnapshot hepsini "yeni" görür).
    $review = @()
} else {
    $review = @($r.Review)
    if ($Strict) { $traces += $review; $review = @() }
}

Write-Output ("trace-check ($Mode, Remember=$Remember, Binding=$Binding, Tray=$Tray, Autostart=$Autostart, " +
    "Diagnostics=$Diagnostics, Servis=$Servis) — desen: $pattern")
foreach ($p in $r.Preexisting) { Write-Output "UYARI (çalıştırmadan önce de vardı): $p" }
foreach ($w in @($al.Warning) + $servisWarn + $markerWarn) { Write-Output "UYARI: $w" }
foreach ($p in $procInfo) { Write-Output "BİLGİ (tepside çalışıyor, -Tray on): $p" }
if ($review.Count -gt 0) {
    Write-Output "İNCELEYİN — desene uymayan yeni girdiler ($($review.Count)); istemciye ait değilse yok sayılabilir:"
    $review | Select-Object -First 200 | ForEach-Object { Write-Output "  $_" }
}
if ($traces.Count -gt 0) {
    Write-Output "İZ BULUNDU ($($traces.Count)):"
    $traces | ForEach-Object { Write-Output "  $_" }
    exit 1
}
Write-Output "TEMİZ: istemciye ait iz yok ($($after.Count) girdi tarandı)."
exit 0
