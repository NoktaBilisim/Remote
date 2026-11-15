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
    # 0.12.0 "Bu bilgisayarı unut" sonrası: -Binding off -Remember off -Tray off -Autostart off (varsayılanlar)
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
if ($Mode -eq 'Compare') {
    $full = [IO.Path]::GetFullPath($SnapshotPath)
    try {
        $before = @((Get-Content -LiteralPath $full -Raw -Encoding UTF8 | ConvertFrom-Json).entries)
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
$r = Compare-TraceSnapshot -Before $before -After $after -Pattern $pattern -ExeFull $exeFull -Exclude $exclude -Allowed $al.Allowed
$procs = @(Get-TraceProcess -Pattern $pattern -ExeFull $exeFull)
$procInfo = @()
if ($Tray -eq 'on') { $procInfo = $procs; $procs = @() }   # tepside çalışan istemci iz değil (AC-253, K-P20-7)

$traces = @($r.Trace) + @($procs) + @($missing)
if ($Mode -eq 'Check') {
    # Önceki durum yok: desene uyan her girdi iz sayılır (Compare-TraceSnapshot hepsini "yeni" görür).
    $review = @()
} else {
    $review = @($r.Review)
    if ($Strict) { $traces += $review; $review = @() }
}

Write-Output ("trace-check ($Mode, Remember=$Remember, Binding=$Binding, Tray=$Tray, Autostart=$Autostart, " +
    "Diagnostics=$Diagnostics) — desen: $pattern")
foreach ($p in $r.Preexisting) { Write-Output "UYARI (çalıştırmadan önce de vardı): $p" }
foreach ($w in $al.Warning) { Write-Output "UYARI: $w" }
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
