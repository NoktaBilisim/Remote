# QA Raporu — P13a — Tur 2
DURUM: GEÇTİ

Tarih: 2026-11-14. Kapsam: Tur 1 maddelerinin (1–11) kapanışı, güvenlik düzeltmeleri (S-P13a-1..8), yeni "Veri saklama süresi"
alanı (Ayarlar › Güvenlik), dokümanların koda ve `deploy/backup`'ın son hâline uyumu, PDF'lerin güncelliği.
Çalışma ağacı: `0f06d7d` + P13a değişiklikleri (commit edilmemiş). Staging'e bağlanılmadı.

AC-88 (temiz VM), AC-91 (staging geri yükleme) ve AC-200 (staging'de günlük çalışma, MySQL durdurma testi, RTO) ölçümleri
**staging'de doğrulanacak** (runbook §18.7/7–9). Koordinatör kararıyla bu ölçümler bu paketin GEÇTİ kararını engellemez.
Yerel provalar kayıtlı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 78/78, web 249/249, server 350/350. Skip yok |
| server `test:int`, temiz DB (`rs-mysql-p13qa:33394`, P1→P13a, sonra `down`) | **53 dosya, 529/529**. Skip yok |
| `check-app-grants.sh` (aynı DB, backup hesabı dahil) | **373/373 PASS**, 0 FAIL |
| e2e: `p13a`, `p12b-whatsapp`, `p11-admin`, `p8-history`, `p10-account` (desktop + mobile) | **87 geçti, 0 hata, 41 atlandı**. Atlananların hepsi gerekçeli `desktopOnly`/"mobil düzen" atlamaları |
| `bash -n` (deploy/backup/*.sh, scripts/build-docs.sh, 01-users.sh, check-app-grants.sh, test-db.sh) | hepsi OK |
| shellcheck (`koalaman/shellcheck:stable -x`; imaj sonra silindi) | `deploy/backup/{backup,restore,lib}.sh`, `build-docs.sh`, `01-users.sh`, `test-db.sh`: **0 bulgu**. `check-app-grants.sh`: yalnız style/info (Tur 1 ile aynı desen) |
| PDF içerik kontrolü (pypdf ile metin çıkarımı) | 3 PDF 22:12:15'te üretilmiş, kaynak .md'lerden (22:12:07) daha yeni. Yeni bölümlerin metni PDF'lerde var: kılavuzda AppLocker, "Veri saklama süresi", "Anonimleştirildi", "730 gün", "Varsayılan" ve "üzerine yazmayın"; README'de "Yedek, geri yükleme ve saklama", `MYSQL_BACKUP_PASSWORD` ve `BACKUP_EXPECTED_TRIGGERS`; DATASHEET'te KVKK ve şifreli yedek. ç ğ ı ö ş ü İ metin katmanında doğru. Görsel render bu makinede yapılamadı (poppler yok) |

## Tur 1 maddelerinin kapanışı
| # | Durum | Kanıt |
|---|---|---|
| 1 Kılavuz | ✅ | AppLocker/AV rehberi (§1377, SHA256SUMS, yol/hash), anonim görünüm (§732–748), audit 730 g (§1188), Veri saklama süresi (§1352), dosya üzerine yazma uyarısı (§318) |
| 2 api.md | ✅ | `anonymized`, 409 `SESSION_ANONYMIZED` + mesaj, anonim alanlar, `source: default`, 10/dk 429, CSV |
| 3 CHANGELOG | ✅ | `[Unreleased]` → P13a Eklendi/Değişti/Güvenlik |
| 4 DATASHEET | ✅ | KVKK saklama + şifreli günlük yedek (site dışı yedek yazılmamış, doğru) |
| 5 README | ✅ | "Yedek, geri yükleme ve saklama" bölümü, env tablosunda `MYSQL_BACKUP_PASSWORD`, "Sıradaki paket P13b" |
| 6 PDF | ✅ | Yeniden üretilmiş, içerik güncel (yukarıda) |
| 7 implementation "P13a — DevOps" | ✅ | jq, skip-extended-insert, `MYSQL_BACKUP_PASSWORD`, `BACKUP_MIN_FREE_MB`, `fix_trigger_dump` gerekçeli |
| 8 runbook §18.4 kalıcı çözüm cümlesi | ✅ | "Kalıcı çözüm uygulandı: P13a migration'ı…"; `lib.sh` yorumu da güncel |
| 9 runbook §15.6 INSERT | ✅ | "P13a'dan itibaren INSERT de reddedilir (force_created_at)" |
| 10 runbook §3 env | ✅ | `MYSQL_BACKUP_PASSWORD` satırı var |
| 11 mimari hizalama | ✅ | mimari §10.4'te `jq` (MIT, gerekçeli); mimari-p13 §4'te PROCESS yok, `MYSQL_BACKUP_PASSWORD`, `BACKUP_MIN_FREE_MB`; §3 uygulama notunda küçük harf `source` |

## README ↔ runbook §18 ↔ deploy/backup tutarlılığı
- **backup.env anahtarları:** `lib.sh BACKUP_ENV_KEYS`, `backup.env.example`, README ve runbook §18.2 aynı altı anahtarı listeliyor (`BACKUP_DIR`, `BACKUP_AGE_RECIPIENT`, `BACKUP_KEEP_DAYS`, `BACKUP_MIN_FREE_MB`, `BACKUP_ALERT_CMD`, `BACKUP_EXPECTED_TRIGGERS`).
- **restore.sh seçenekleri:** `--identity`, `--target scratch|staging`, `--confirm <db>@<hostname -s>`, `--no-pre-backup`, `--keep`, `--work-dir` README/runbook komutlarıyla uyumlu. Staging örneği `--confirm remote@develop`. `production` reddediliyor (S-P13a-6).
- **backup.env sahipliği:** runbook §18.2 `install -o root -g root -m 600`, betikteki S-P13a-7 koşuluyla uyumlu.
- **Düz veri:** runbook §18 "Düz veri" satırı ve backup.sh başlığı aynı şeyi söylüyor (düz döküm/arşiv diske yazılmaz, restore `/dev/shm`).
- **Küçük fark (öneri 2):** mimari-p13 §4 anahtar listesinde `BACKUP_EXPECTED_TRIGGERS` ve `--confirm`/`--work-dir` yok.

## Güvenlik düzeltmeleri (QA açısından)
- **S-P13a-1:** müşteri audit'inde IP öneki ve UA yok; kural tek noktada (`writeAudit`). Yeni `audit-customer-p13a.test.ts` gerçek resolve→join→admit akışını sınıyor. Zaman çizelgesinde reddedilen misafirin satırına ad yazılmıyor.
- **S-P13a-5:** anonim oturumda `session.terminated.reason` siliniyor.
- **S-P13a-8:** dosya audit kayıtlarında ad ve sha256 yok, yalnız `ext`. Birim (10 vaka) ve entegrasyon testleri var.
- Bu düzeltmeler AC-197'nin "müşteri adı hiçbir alanda görünmez" hedefini audit tarafında da güçlendiriyor.

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-88 | Staging'de doğrulanacak | Yerel: `/ready` 20–28 sn, coturn HMAC 62/0 (runbook §2) |
| AC-91 | Staging'de doğrulanacak | Timer 02:00, 14 g rotasyon; yerel scratch + `--target staging` provası OK (runbook §18.4) |
| AC-92 | ✅ | runbook §19.1–19.10 (6 zorunlu senaryo + 4 ek), her biri belirti → komut → doğrulama → geri dönüş |
| AC-93 | ✅ | `pnpm docs:pdf` / `scripts/build-docs.sh`. README, api.md, kılavuz (User/Admin/Super Admin + AppLocker/AV), DATASHEET, 3 PDF güncel. Türkçe karakterler metin katmanında doğru |
| AC-197 | ✅ | `retention-p13a-job.test.ts` (anonimleştirme, idempotent, sahte saat, liste/detay/zaman çizelgesi, 409, CSV, kapsam 404). `retention-p13a-db.test.ts`. `audit-customer-p13a.test.ts`. e2e `p13a.spec.ts` |
| AC-198 | ✅ | 730 g silme + 7 g auth/reset (sahte saat). app ile geri tarihleme ve 730 günden yeniyi silme reddediliyor. check-app-grants 373/373 |
| AC-199 | ✅ | partiler (1001), üst üste binmez, fail-soft + fail audit + `rs_retention_*`, kişisel veri yok. Runbook §18.6 26 sa alarmı. e2e audit etiketi/grubu |
| AC-200 | Staging'de doğrulanacak | Betikler uygun: aynı çalıştırma, age, 600/700, manifest, 14 g, hata → FAILED + OnFailure + alarm, scratch `restore-verify`. shellcheck temiz. Yerel olumsuz testler kayıtlı |

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Lint / typecheck / birim | ✅ | |
| Entegrasyon (temiz DB) | ✅ | 529/529 |
| İlgili e2e | ✅ | 87/87, atlamalar gerekçeli |
| AC kanıtı | ✅ | Staging ölçümleri hariç (karar gereği engelleyici değil) |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | Backend/frontend/devops/dba bölümleri. Küçük doküman farkı öneri 2'de |
| Contracts tek kaynak | ✅ | Saklama aralığı da `TENANT_SETTINGS_LIMITS`'ten geliyor |
| Tenant kapsamı, TX, hata yutma, PII log | ✅ | |
| En az yetki (DB) | ✅ | K27; backup SELECT/SHOW VIEW/TRIGGER, localhost |
| Gizli bilgi yok | ✅ | `backup.env` git dışı, örnek dosya boş, özel age anahtarı reddediliyor |
| Yeni env kuralı | ✅ | `.env.example`, compose, runbook §3, README. env.ts istisnası gerekçeli |
| Yeni bağımlılık gerekçesi | ✅ | jq: mimari §10.4 + implementation |
| UI: 5 durum, axe iki tema, 390 px, ikon, token | ✅ | Saklama formu: `CalendarClock`, SaveBar, alan hatası + odak, salt okunur |
| Dokümantasyon + PDF | ✅ | |
| shellcheck (T2) | ✅ | |

## Öneriler (zorunlu değil)
1. [mimar] "Veri saklama süresi" alanının (Ayarlar › Güvenlik) mimari §10.5'te görev satırı yok. Bu yüzden CLAUDE.md'deki "mimari karşılık" kuralı biçimsel olarak eksik kalıyor. Alan mevcut bir gereksinimi (tenant ayarı, gereksinimler-e9 V20) ve mevcut bir ucu (PUT `/settings/tenant` `retentionDays`) arayüze bağladığı için engelleyici sayılmadı. §10.5'e F5 satırı eklenmesi önerilir.
2. [mimar] `docs/mimari-p13.md` §4'e `BACKUP_EXPECTED_TRIGGERS` (S-P13a-4), `--confirm <db>@<host>` / `--work-dir` / `production` reddi (S-P13a-6, S-P13a-3) eklenmeli.
3. [frontend-dev] Saklama süresi düşürüldüğünde, ertesi 03:30'da geri dönüşü olmayan toplu anonimleştirme olur. Kaydetmeden önce onay diyaloğu düşünülebilir, ör. "Süreyi X günden Y güne düşürüyorsunuz…". Ayrıca `RETENTION_DEFAULT_DAYS = 365` web'de sabit; contracts'ta bir varsayılan sabiti varsa oradan alınmalı.
4. [teknik-yazar] README'deki prova komutunda macOS iş istasyonu için `--work-dir` gerekliliği belirtilebilir. Runbook §18.4 A bunu söylüyor, README söylemiyor.
5. Tur 1'deki öneriler hâlâ geçerli:
   - web'deki `canonicalWaUrl` kopyası,
   - ölü global retention fonksiyonları,
   - mysql/turn için "değişmeyen PUT" testi,
   - CI'da shellcheck adımı,
   - runbook §18.8/1'de Cf karakteri uç durumu.

## Olumlu
- Tur 1'deki 11 maddenin hepsi kapatılmış. Dokümanlar betiklerin son hâliyle (anahtar adları, seçenekler, hedef kilidi) birebir uyumlu.
- Güvenlik düzeltmeleri anonimleştirmenin audit üzerinden delinmesini kapatıyor (müşteri adı, tam IP, UA, dosya adı ve sha256). Kural merkezi ve testli.
- Yedek tarafı belirgin biçimde sertleşmiş: düz veri diske yazılmıyor, döküm istemci komutu taramasından geçiyor, yükleme öncesi ve sonrası hesap/yetki anlık görüntüsü karşılaştırılıyor, ortam kilidi var. Olumsuz senaryolar yerelde Linux root konteynerinde (dind olmadan) denenmiş.
