#Requires -RunAsAdministrator
# P28u K6s elle Windows spike (docs/spike-p28u-k6s.md). Tek komut, yönetici PowerShell'de, test ikilileriyle aynı klasörden:
#   powershell -ExecutionPolicy Bypass -File .\k6s-elle.ps1            # ölçümü başlatır (sonunda oturum KAPATILIR)
#   powershell -ExecutionPolicy Bypass -File .\k6s-elle.ps1 -Sonuc     # yeniden girişten sonra: sonucu gösterir, görevi siler
# Klasörde k6s-servis.test.exe bulunmalı (P28u r3: örtü testi/k6s-win.test.exe kaldırıldı) (üretimi: docs/spike-p28u-k6s.md "Elle koşu").
# Ne yapar: (1) bu kullanıcının oturumunda soru 4 (örtü) + oturum kimliği testleri; (2) tek seferlik SYSTEM zamanlanmış
# görevi (Session 0 = servis bağlamı) TestK6sElle'yi koşar: Session 0'dan kilit, kısıtlı SYSTEM yardımcı jetonuyla kilit,
# K-P28u-5b kullanıcı jetonuyla kilit (her kilitten sonra kilidi siz açarsınız), en sonda WTSLogoffSession.
param([switch]$Sonuc, [string]$Adimlar = 'hepsi')
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1: dosya BOM'lu UTF-8; test ikilisinin UTF-8 çıktısı doğru okunsun.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir  = Join-Path $env:ProgramData 'NoktaDestekK6s'
$task = 'NoktaDestekK6s'
$out  = Join-Path $dir 'sonuc.txt'
$log  = Join-Path $dir 'gunluk.txt'

if ($Sonuc) {
  foreach ($f in (Join-Path $dir 'kullanici.txt'), $out, $log) {
    Write-Output "===== $f"
    if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f -Encoding utf8 } else { Write-Output '(yok)' }
  }
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Zamanlanmış görev silindi. Klasör: $dir (sonucu docs/spike-p28u-k6s.md'ye aktardıktan sonra silin)."
  exit 0
}

if ($Adimlar -notmatch '^(hepsi|(kilit0|kilit|kilit5b|kapat)(,(kilit0|kilit|kilit5b|kapat))*)$') { throw "geçersiz -Adimlar: $Adimlar" }
foreach ($n in 'k6s-servis.test.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $n))) { throw "$n bu klasörde yok" }
}
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# SYSTEM + Yöneticiler tam, Kullanıcılar okuma/çalıştırma (K-P28u-5b çocuğu kullanıcı jetonuyla bu ikiliyi açar).
& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'k6s-servis.test.exe') $dir
Remove-Item -Force -ErrorAction SilentlyContinue $out, $log

$exeS = Join-Path $dir 'k6s-servis.test.exe'
$u = Join-Path $dir 'kullanici.txt'
"Windows: $([Environment]::OSVersion.VersionString) / $((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion)" | Set-Content -LiteralPath $u -Encoding utf8
# Test ikilisi stderr'e yazarsa 'Stop' betiği SYSTEM görevini kurmadan durdurmasın: yalnız bu çağrıda Continue.
$ErrorActionPreference = 'Continue'
& $exeS -test.run 'TestK6sSessionIDs' -test.v -test.count 1 2>&1 | ForEach-Object { "$_" } | Add-Content -LiteralPath $u -Encoding utf8
$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath $u -Encoding utf8

$arg = "/c `"`"$exeS`" -test.run TestK6sElle -test.v -test.count 1 -test.timeout 20m -k6s.elle=$Adimlar -k6s.cikti=`"$out`" > `"$log`" 2>&1`""
$act = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument $arg
$pr  = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $act -Principal $pr -Settings $set -Force | Out-Null
Start-ScheduledTask -TaskName $task
Write-Output @"

SYSTEM ölçümü başladı ($Adimlar). 10 sn sonra ekran kilitlenecek:
  - Her kilitten sonra kilidi açın (3 kez: Session 0, kısıtlı SYSTEM yardımcı, K-P28u-5b). Kilitlenmeyen adım atlanır.
  - Son adımda oturumunuz ZORLA KAPATILIR (açık belgeleri şimdi kaydedin). 60 sn ölçüm sürer, giriş ekranında bekleyin.
  - Sonra yeniden giriş yapıp yönetici PowerShell'de: powershell -ExecutionPolicy Bypass -File .\k6s-elle.ps1 -Sonuc
"@
