# Mimari — P13a / P13b (operasyon, saklama, yedek, dokümantasyon)
Ana belge: `docs/mimari.md` (§3.4, §8.3, §10.2, §10.3, §10.5, §11, §12). Tarih: 2026-11-14. Kullanıcı kararı (2026-11-13):
P13 ikiye bölündü. **P13a** şimdi ve yalnız staging'de yapılır. **P13b** prod açılışıdır; K1 (alan adı) ve TURN ayrı IP/443 kararına bağlıdır, ikisi de henüz açık (gereksinimler S2).

## 1. Kapsam
| Paket | AC | Ortam |
|---|---|---|
| P13a | 88 (doğrulama, staging/temiz kurulum), 91, 92 (rev.), 93, **197–200** (yeni), veri saklama NFR | staging (185.126.217.99:4450 / remote.noktabilisim.net) |
| P13b | 23 (443 TURN-TLS), 88 + 91 prod tekrarı, §6'daki prod maddeleri | prod (K1 + K3 kararından sonra) |

## 2. Saklama (retention) — P13a kararları (AC-197..199)
Kaynaklar: gereksinimler NFR "Veri saklama", AC-159, AC-195, mimari §3.4, mimari-e9 §3.6, mimari-e10 §3.8. Süreler gereksinimlerde
zaten tanımlı. Yeni süre uydurulmadı; yalnız "hard delete" kararı değişti (aşağıda K-P13-1).

| Veri | Süre (başlangıç) | P13a işlemi | Durum |
|---|---|---|---|
| `support_sessions` (bitmiş: ENDED/EXPIRED/CANCELLED) | tenant `retention_days` (90–730, vars. 365), `created_at` | `customer_name, customer_email, note, guest_net_key, guest_ip_key → NULL`, `anonymized_at = now` | **yeni** |
| `session_consents` (o oturumların) | aynı | `ip, user_agent → NULL` (karar, seviye, kaynak, metin sürümü/özeti **kalır**: KVKK onay kanıtı) | **yeni** |
| `session_files` (o oturumların) | aynı | **satır silinir** (anonimleştirme anında) | **yeni**. P5 CHECK çelişkisinin çözümü, K-P13-2 |
| `support_requests` | aynı | anonimleştirme (P8b-1'de var, AC-159) | değişmez |
| `customers` (pasif) | `passive_at` + `retention_days` | anonimleştirme (P8c-1'de var, AC-195) | değişmez |
| `device_bindings` | `last_used_at` + `retention_days` | `EXPIRED` + `key_hash NULL` (P8c-1'de var) | değişmez |
| `audit_logs` | 730 gün (sabit, tenant değiştiremez) | hard delete (tetikleyici 730 günden yeniyi reddeder) | **yeni** |
| `auth_sessions` | `max(expires_at, revoked_at)` + 7 gün | hard delete | **yeni** |
| `password_reset_tokens` | `expires_at` + 7 gün | hard delete | **yeni** |
| Yedek dosyaları | 14 gün (AC-91) | `backup.sh` rotasyonu | **yeni**. Anonimleştirilen veri yedeklerde en çok 14 gün daha kalır (runbook notu, B-P12-3) |
| coturn logları | runbook §9.8.1 | değişmez | — |

**K-P13-1 (hard delete ertelendi):** mimari §3.4'teki "anonimleştirmeden 30 gün sonra hard delete" (oturum, onay, talep, kayıt) P13a'dan
**çıkarıldı**. Gerekçe: `device_bindings.first/last_session_id → support_sessions`, `support_requests.binding_id → device_bindings`,
`support_sessions.request_id → support_requests` ve `session_consents.request_id` birlikte RESTRICT FK döngüsü kurar. Silme sırası,
etkin kayda bağlı oturumların atlanması ve yarışlar kod yüzeyini büyütür. Öte yandan anonimleştirilmiş satır KVKK açısından artık
kişisel veri değildir; anonim hale getirme, Silme/Yok Etme/Anonimleştirme Yönetmeliği'nde tanınan bir imha yöntemidir. Bu gerekçe
ancak audit üzerinden yeniden tanımlama yoksa geçerlidir: **audit'te müşteri adı ve tam IP yoktur** (K-P13-3, S-P13a-1 kararı).
P13a öncesi staging'de oluşmuş ad/IP içeren audit kayıtları 730 günde silinir; prod'da bu kayıtlar hiç oluşmaz (prod açılışı P13b). Bu nedenle
`app` kullanıcısına `support_sessions`, `session_consents`, `support_requests` ve `device_bindings` için DELETE yetkisi **verilmez**
(en az yetki). **Genişleme noktası:** `jobs/retention.ts` içinde `purgeAnonymized()` adımı tanımlanır (P13a'da yazılmaz). Sıra:
`session_consents` → kayda bağlı olmayan oturumlar → oturumu ve kaydı olmayan talepler → `revoked_at + retention_days` geçmiş
kayıtlar. Grant'lar o pakette `grants.sql`'e eklenir. Tetikleyici olay: depolama ihtiyacı ya da hukuki talep.

**K-P13-2 (dosya adı):** `session_files.file_name` CHECK'i `*` karakterine izin vermez (db-notlari P5), bu yüzden `***` yazılamaz.
Yer tutucu yazmak ya da CHECK'i gevşetmek yerine satır anonimleştirme anında silinir. `sha256` da dosyayı tanımlayabilen bir değer
olduğu için satırın silinmesi daha temiz çözümdür. `app` → `session_files` DELETE (UPDATE yok).

**K-P13-3 (audit'teki kişisel veri) — r1, güvenlik S-P13a-1 kararı, seçenek (a), 2026-11-14 (bağlayıcı):** İlk tasarımda audit
kayıtları (`guest.pending` vb.) müşteri adı ve tam IP taşıyordu. Bu kayıtlar 730 gün append-only kaldığı için anonimleştirilmiş oturum
audit üzerinden yeniden tanımlanabiliyordu (S-P13a-1, Orta). **Karar:** yeni audit kayıtlarına müşteri (misafir) adı **yazılmaz**.
`ip_address` alanına ve audit `new_value`'daki misafir IP'lerine tam IP yerine **ağ öneki** yazılır (IPv4 /24, IPv6 /48; `lib/ip.ts`
`netKey()` biçimi). Uygulayan: backend-dev (audit yazım noktaları, `audit/mask.ts`). Teknisyen/yönetici kullanıcıların audit'teki
kimliği (`user_id`/`username`) değişmez; bu kişiler çalışandır ve denetim amacıyla gereklidir. P13a öncesi kayıtlar UPDATE edilemez
(tetikleyici) ve 730 günde silinir; yalnız staging'de oluşmuşlardır, prod'da oluşmaz. **Ekran kuralı (değişmez):** anonimleştirilmiş
oturumun detayında zaman çizelgesi `details.name` alanını ve CUSTOMER `actorName` değerini `null` döndürür (eski kayıtlar için).
Aydınlatma metni ve kılavuz audit süresini (730 gün) ve önekle kayıt yapıldığını belirtir (teknik-yazar).

**K-P13-4 (created_at zorlama, I-P11-3):** `audit_logs` DELETE yetkisiyle **aynı migration'da** `BEFORE INSERT` tetikleyicisi kurulur:
`audit_logs_force_created_at`. **Muaf liste (fail-closed):** çağıranın `USER()` öneki (ikili karşılaştırma) `migrator` veya `root`
değilse `NEW.created_at = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00')`. Yani `app` ve ileride eklenecek her hesap DB
saatine zorlanır. Böylece `app` geriye tarihli satır ekleyip hemen silemez. `migrator` test fikstürü yazar, `root` geri yükleme yapar
(döküm özgün `created_at` ile döner). `CURRENT_USER()` tetikleyicide DEFINER'ı döndürdüğü için `USER()` kullanılır.
**Tetikleyici gövde kuralı:** yeni tetikleyiciler bileşik gövdeyle (`BEGIN…END` / `IF…END IF`) yazılır. P13a migration'ı P11'in
tek ifadelik `audit_logs_no_update` gövdesini `BEGIN…END` ile yeniden kurar; aksi halde Prisma'nın sondaki `;`'si gövdeye girer ve
döküm `mysql` ile yüklenemez. Ayrıntı ve kanıt: `docs/db-notlari.md` P13a.

**İş tanımı (`apps/server/src/jobs/retention.ts`):** Mevcut 03:30 Europe/Istanbul zamanlayıcısı (`requests/jobs.ts dailyRetention`)
**genişletilir**, ikinci bir zamanlayıcı kurulmaz. Sıra:
1. Talep, müşteri ve kayıt adımları (mevcut).
2. Oturumlar: tenant döngüsü, 1000'lik partiler, parti başına tek TX. TX içinde aday id'ler (`status IN (ENDED,EXPIRED,CANCELLED)
   AND anonymized_at IS NULL AND created_at < cutoff`) seçilir, ardından `DELETE session_files` → `UPDATE session_consents` →
   `UPDATE support_sessions … WHERE id IN (…) AND anonymized_at IS NULL`.
3. Global adımlar: `audit_logs` (`created_at < now − 730 g`, 5000'lik partiler), `auth_sessions`, `password_reset_tokens`.

Kurallar: tenant'ta hata olursa loglanır, sonraki tenant'a geçilir (fail-soft). Tur üst üste binmez. İş idempotenttir: ikinci
çalıştırma 0 satır değiştirir. Kaçırılan gün telafi edilmez; bir sonraki tur aynı kesme noktasıyla işi tamamlar.

**Gözlemlenebilirlik (AC-199):**
- Değişiklik olan her tenant için tek audit kaydı yazılır: `action=retention.run`, `entity=retention`, `user_id NULL`,
  `username=system`, `new_value={sessions, consents, files, requests, customers, bindings}` (yalnız sayılar).
- Global adımlar `tenant_id NULL` olan bir `retention.run` kaydıyla yazılır: `{audit, authSessions, resetTokens}`.
- Metrikler:
  - `rs_retention_last_success_timestamp_seconds` (gauge)
  - `rs_retention_rows_total{kind}` (counter)
  - `rs_retention_failures_total` (counter)
- Alarm (runbook): `time() − last_success > 26 sa` ve süreç çalışma süresi > 26 sa; ya da `increase(failures[1d]) > 0`.

## 3. API / sözleşme değişiklikleri (P13a)
| Yer | Değişiklik | Hata / yetki |
|---|---|---|
| `SessionListItem`, `SessionHistoryDetail` (mimari-api P8) | `+ anonymized: boolean` (`anonymized_at IS NOT NULL`). Anonimse `customerName`, `customerEmail`, `note` null; `files` boş; zaman çizelgesinde ad yok (K-P13-3) | kırılmaz ek alan |
| PATCH `/sessions/:id` | Anonimleştirilmiş oturumda **409 `SESSION_ANONYMIZED`** (kişisel veri yeniden yazılamaz). `contracts/errors.ts` += kod, TR mesaj "Bu oturum saklama süresi dolduğu için anonimleştirildi; düzenlenemez." | session_history.edit |
| CSV export | Şema değişmez; anonim satırda müşteri hücreleri boştur | — |
| PUT/DELETE `/admin/settings/{mysql,turn,whatsapp}` (B-P12b-5) | Kullanıcı başına **10/dk** (`lib/rate.ts`), aşımda 429 `RATE_LIMITED` + `Retry-After`. Değer değişmediyse 200 döner, audit yazılmaz | SUPER_ADMIN |
| `/admin/settings/whatsapp` (B-P12b-4, sayfa testi) | Adres **WHATWG kanonik** biçimde saklanır (`new URL()`; şema/host küçük harf, ondalık/onaltılı IPv4 noktalı biçime, IDN punycode'a çevrilir; kök yolda sondaki `/` atılır). `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` reddedilir. Büyük harfli şema reddedilmez, kanonikleşir. Yanıt `source: "panel" \| "env" \| "default"` döner (küçük harf, mevcut sözleşmeyle aynı: `contracts/src/api/system-settings.ts`; env açıkça verilmemişse `default`, rozet "Varsayılan") | 400 `VALIDATION fields.url` |
| K13 sınıflaması (T33) | `169.254.0.0/16` ve `fe80::/10` "özel ağ" **sayılmaz**: canlı ortamda `http://` + link-local adres girilirse kanal kapalı kalır ve uyarı gösterilir. `[::1]` ve `127.0.0.0/8` loopback olarak özel sayılır (bugünkü davranış). SMTP/MySQL netguard'ı değişmez (link-local orada zaten yasak) | — |
| Audit etiketleri | `retention.run` → "Saklama süresi işi". Dış gönderim `reason` kodlarının Türkçe etiketleri (`unreachable`, `timeout`, `http_error`, `invalid_response`, `other` …) tek tabloda: `contracts/src/labels.ts` | — |

**Uygulama notu (backend-dev, 2026-11-14):** `source` mevcut sözleşmeye uygun küçük harfle (`"panel" | "env" | "default"`) uygulandı. CSV'de sütun kümesi değişmedi; anonim satırda "Müşteri" hücresine `Anonimleştirildi` yazılır (AC-197), "Not" boş kalır. Hata olan tenant için de `retention.run` yazılır (`result: fail`). Gerekçeler `docs/implementation.md` "P13a — Backend" bölümünde.

## 4. Yedek ve geri yükleme (AC-91, AC-200)
- **Araç:** host'ta systemd timer (`remote-backup.timer`, 02:00 Europe/Istanbul) → `deploy/backup/backup.sh`. Uygulama
  konteynerine eklenen bir şey yoktur.
- **Kullanıcı:** `'backup'@'localhost'` (yalnız mysql konteyneri içinden, soketle; TCP ile 1045). Yetkiler yalnız
  `MYSQL_DATABASE.*` üzerinde `SELECT, SHOW VIEW, TRIGGER`; global yetki yok. **PROCESS verilmez:** `--no-tablespaces` ile
  gereksizdir ve diğer oturumların SQL metnini açar. LOCK TABLES/RELOAD de verilmez (`--single-transaction`, FTWRL yok).
  TRIGGER'ın yan etkisi (CREATE/DROP TRIGGER) `localhost` kısıtı ve tetikleyici sayımıyla izlenir. Tanım: `deploy/mysql/init/01-users.sh`
  (yeni kurulum) ve `deploy/mysql/backup-user.sql` (mevcut kurulum, root ile, idempotent). Gerekçe: `docs/db-notlari.md` P13a D3.
- **Parola:** `MYSQL_BACKUP_PASSWORD` (≥ 16 karakter) `deploy/.env`'de durur ve yalnız compose `mysql` servisine verilir
  (`.env.example`'da anahtar boş). `backup.sh` dökümü `docker exec` ile konteyner içinde alır; parola argümana/loga girmez.
  Değişken boşsa kullanıcı oluşturulmaz ve yedek hata verir. Server okumadığı için `env.ts`'te yoktur.
- **Döküm:** `mysqldump --single-transaction --no-tablespaces --triggers --set-gtid-purged=OFF`. `uploads` volume'u aynı çalıştırmada
  tar'lanır (runbook §16.3 komutu). Her çalıştırma bir `manifest.json` üretir: UTC zaman, son migration, tablo başına satır sayısı,
  dosya SHA-256'ları.
- **Şifreleme:** `age -r <BACKUP_AGE_RECIPIENT>` (yalnız açık anahtar). **Özel anahtar sunucuda bulunmaz**; yalnız geri yükleme
  provasında geçici olarak getirilir. Dosyalar `umask 077`, mod 600, dizin `BACKUP_DIR` (staging `/var/backups/remote`).
- **Rotasyon:** `BACKUP_KEEP_DAYS=14`; daha eski çalıştırma dizinleri silinir.
- **Disk kontrolü:** başlamadan `BACKUP_DIR` diskinde `BACKUP_MIN_FREE_MB` (vars. 1024) boş alan yoksa hata verir.
- **Hata:** betik `set -euo pipefail` ile çalışır. Boş/bozuk çıktı (`gzip -t`, boyut > 0) çıkış kodunu ≠ 0 yapar. Systemd birimi
  `failed` olur, `OnFailure` journal'a `remote-backup: FAILED` yazar ve tanımlıysa `BACKUP_ALERT_CMD`'yi çalıştırır.
- **Yapılandırma:** `deploy/backup/backup.env` (git-ignore, root 600; `source` edilmez, yalnız bilinen anahtarlar okunur). Anahtar
  adları `backup.env.example`'da: `BACKUP_DIR`, `BACKUP_AGE_RECIPIENT`, `BACKUP_KEEP_DAYS`, `BACKUP_MIN_FREE_MB`, `BACKUP_ALERT_CMD`, `BACKUP_EXPECTED_TRIGGERS`
  (vars. 3). DB'deki tetikleyici sayısı bundan farklıysa yedek FAILED olur, çünkü audit koruması düşürülmüş olabilir (S-P13a-4).
  Yeni tetikleyici ekleyen migration bu değeri günceller. `backup.env` root'a ait ve 600 değilse betik çalışmaz (S-P13a-7).
  Bu değişkenler server'a girmez, dolayısıyla `env.ts`'e de girmez (proje CLAUDE.md "yeni env" kuralının gerekçeli istisnası;
  runbook §18'e yazılır).
- **Host araçları:** `age`, `jq` (manifest üretimi/karşılaştırması), `docker`. `jq` mimari §10.4'te onaylıdır.
- **Geri yükleme:** `deploy/backup/restore.sh --identity <age-key> --target scratch|staging [--confirm <db>@<host>] [--no-pre-backup] [--keep] [--work-dir <dizin>] <run-dir>`.
  - **Ortam kilidi (S-P13a-6):**
    - `--target staging`, canlı veritabanını silip yeniden yüklediği için `--confirm <veritabanı>@<hostname -s>` olmadan çalışmaz. Staging örneği: `--confirm remote@develop`.
    - Compose projesi `RESTORE_EXPECT_PROJECT` (vars. `remote`) değilse betik durur.
    - Yüklemeden önce güncel durumun yedeği alınır; bu adım `--no-pre-backup` ile atlanabilir.
  - **`production` hedefi reddedilir:** `--target production|prod` P13b'de ayrı bayrak ve ayrı onayla eklenecek.
  - **Çözülmüş veri (S-P13a-3):**
    - Çözülen dosyalar yalnız RAM'de (`/dev/shm`) tutulur.
    - `/dev/shm` yoksa ya da yer yetmezse operatör `--work-dir <dizin>` ile açıkça bir dizin verir (ör. şifreli disk; macOS iş istasyonunda zorunlu).
    - Gereken yer: iki düz dosya + %10.
  - Beklenen tetikleyici sayısı `RESTORE_EXPECTED_TRIGGERS` ile verilir (vars. 3).
  - `scratch`: geçici `mysql:8.4.13` konteynerine (`--log-bin-trust-function-creators=1`) yükler. Ardından doğrular: tetikleyici
    sayısı = **3** (no_update, retention_only_delete, P13a force_created_at; üçü de bileşik gövdeli), son migration = manifest, tablo satır sayıları =
    manifest, uploads SHA-256 listesi = manifest. Sonucu tek satır `restore-verify: OK|FAIL` olarak yazar.
  - `staging`: runbook adımıyla server durdurulur, root ile yüklenir, `/ready` 200 beklenir.
- **Hedefler:** RPO ≤ 24 sa. RTO ≤ 60 dk (staging provasında ölçülüp runbook'a yazılır). Ayda bir prova `scratch` hedefiyle elle
  yapılır, kayıt runbook "Prova kaydı" tablosuna girer.
- **Ayrı disk / site dışı kopya:** staging'de yalnız yerel dizin vardır. Ayrı disk + site dışı + append-only audit kopyası (I-P11-1)
  **P13b**'dedir.

## 5. AC-88 doğrulaması (P13a)
- **Yorum (K26, §12):** ADR-0007 gereği coturn ayrı compose'dadır (`deploy/turn`). AC-88'in "coturn" kısmı, aynı temiz makinede
  `deploy/turn` içinde `docker compose up -d` ile karşılanır. Prod'da coturn ayrı VM'dedir (P13b).
- **Ölçüm:** imaj önbelleği ve volume'u olmayan temiz bir Ubuntu 24.04 VM (yoksa `docker:dind` kabı) kullanılır.
  `deploy/.env` runbook §2'ye göre doldurulur. `docker compose up -d` başlangıcından `/ready` 200'e kadar geçen süre ölçülür
  (≤ 120 sn; imaj çekme/derleme süresi hariç, imajlar önceden `load` edilir). coturn için `turnutils_uclient` ile HMAC credential
  denenir. Sonuç (süre, sürüm, komut çıktısı) `docs/runbook.md` §2 "Temiz kurulum kaydı"na yazılır.

## 6. "Sonra" maddelerinin sınıflandırılması (`docs/gereksinimler-sonra-acik.md`'de Ne zaman = P13 / "en geç P13" / "P13 öncesi" / "P12/P13")
| Madde (kaynak tablo) | Karar | Gerekçe |
|---|---|---|
| B-P12b-4 WhatsApp URL kanonik + `\p{Cf}` (P12b) | **P13a** (backend + dba) | Küçük; dba P13a migration'ı zaten açıyor |
| B-P12b-5 kalan: sistem ayarı PUT/DELETE hız sınırı (P12b) | **P13a** (backend) | `rate.ts` var; birkaç satır |
| T33: link-local "genel" (P12b) | **P13a** (backend) | Tek sınıflama değişikliği |
| T33: bildirim hedefi değişiminde step-up 2FA | **Sonra** | Yeni yeniden doğrulama akışı (uç + UI + AC) gerekir; tek kullanıcı Super Admin ve zaten 2FA'lı. Genişleme noktası `auth/mfa.ts` `requireFreshMfa()` |
| T-P12b: audit `reason` Türkçe etiketleri (P12b) | **P13a** (frontend) | Etiket tablosu |
| Sayfa testi: büyük harfli şema, kaynak rozeti, IDN/`[::1]` (P12b) | **P13a** (backend + frontend) | Kanonikleştirme ile birlikte çözülür (§3) |
| Test yarışı `bindings-p8c` ↔ `settings-p11` (P12b) | **P13a** (backend) | "Ayrı proje, en sona" kalıbı; CI kararlılığı |
| B-P12-3: silinen kullanıcı/firma dosyaları (P12) | **Kısmen P13a**: yalnız runbook notu (yedekten düşme süresi 14 gün, devops). **Sonra**: dosya silme + yetim tarama | Kalıcı kullanıcı/firma silme yok (yalnız pasife alma), yani tetikleyici olay yok. Kalıcı silme kapsamına alındığında `uploads/` temizliği o akışa bağlanır |
| I-P11-1 audit'in harici append-only kopyası (P11) | **P13b** | Harici hedef (WORM/log toplayıcı/site dışı) prod altyapı kararına bağlı |
| I-P11-3 `created_at` zorlama (P11) | **P13a** (dba) | DELETE yetkisiyle aynı migration'da olmak zorunda (K-P13-4) |
| govulncheck çağrılmayan kayıtlar + x/net v0.62 (P6/P7, "en geç P13") | **P13a** (backend-dev Go) | Yalnız `go get` + `go test` + govulncheck; istemci sürümü yayımlanmaz, bir sonraki sürüm taşır |
| TEST-NAT-1 genel CA'lı TURN-TLS sertifikası | **P13b** | Alan adı (K1) gerekir |
| Donanım MFT yedeği ("en geç P13") | **Sonra** (Windows elle test bulgusuna bağlı) | Sahada hata gözlenmedi; Go + MF kod yüzeyi büyük; istemci yayını + attestation gerekir |
| Koyu tema (Windows istemci) | **Sonra** (bir sonraki istemci sürümü) | Win32 ortak denetimlerinde resmi koyu tema API'si yok; kod yüzeyi büyük, önemi düşük; istemci yayını gerekir |
| S-P5-T2-4 `reporter` kolonu (risk kabulü, "P12/P13") | **Sonra** | Risk kabulü geçerli (etki yalnız meta kaydı); protokol + dba + backend değişikliği gerekir |
| S-P5-T2-1 kalanı: kayıt diyaloğu öncesi uyarı metni ("P13 öncesi") | **P13a** (frontend); gerçek tarayıcı doğrulaması test-operatoru | Tek metin |
| QA-P4-10: AC-23 443 doğrulaması | **P13b** | 443 ayrı IP (K3) |
| S-P3-3 prod IPv6 | **P13b** | Prod ağı |
| S-P13a-2 yedek bütünlüğü (manifest imzası, `--system-command=OFF`, migrator ile yükleme) | **P13b ön koşulu** (site dışı yedekten önce) | Bugün yedek dizinine yazmak root gerektirir; risk site dışı hedefle doğar |
| (Prod öncesi) Super Admin şifre kurtarma CLI (P10) | **P13b** | "Prod açılışından önce" |
| (Prod öncesi) staging'de denenmeyen SMTP/oturum akışları (P10) | **P13b** (test-operatoru) | Prod açılış kontrol listesi |
| K13 WhatsApp prod ön koşulu (mimari-e9 §12) | **P13b** | Prod listesi |
| Hard delete (anonim oturum/talep/kayıt) | **Sonra** (yeni, K-P13-1) | FK döngüsü; KVKK anonimleştirmeyle karşılanıyor |
| Çok süreç WhatsApp yayılımı | Değişmez ("Ölçekleme kararıyla") | — |

**P13b kapsamı (özet; ayrı tasarım turu K1/K3 kapanınca yapılır):**
- **ön koşul (güvenlik S-P13a-2), site dışı yedekten önce:** manifest imzası (`ssh-keygen -Y sign` / minisign; doğrulama anahtarı yönetici tarafında, `restore.sh` imzasız yedeği çözmez), yükleme `mysql --system-command=OFF` ile ve root yerine `migrator` ile, yükleme öncesi/sonrası `mysql.user`/`ROUTINES`/`EVENTS` karşılaştırması (devops + dba)
- prod compose ve alan adı, Let's Encrypt, HSTS `includeSubDomains`
- TURN ayrı IP/443 (ADR-0007), genel CA'lı TURN-TLS, AC-23 443 ölçümü
- IPv6 doğrulaması, K13
- ayrı disk + site dışı yedek + I-P11-1
- Super Admin kurtarma CLI
- prod'da AC-88 ve AC-91 tekrarı, prod açılış kontrol listesi
- `PUBLIC_BASE_URL`/`ALLOWED_ORIGINS` prod değerleri ve istemci ldflags sunucu adresi (yeni istemci sürümü)
