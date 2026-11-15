# ADR-0030 — Kalıcı silme: FK döngüsünün kırılması, tetikleyiciyle koşullu DELETE, mezar taşı, firma silme işi

Tarih: 2026-11-15 · Durum: Kabul (r2: güvenlik tasarım turu S16-1..11, `docs/guvenlik-raporu.md` "P16/P17"; m.5'teki
24 saat bekleme **kullanıcı onayı bekleyen varsayımdır**) · Paket: P16 (AC-240..244) · Kapatır: K27, K-P13-1 ·
Ayrıntı: `docs/mimari-e11.md` §7

## Bağlam

- P13a anonimleştirmeyi KVKK imha yöntemi olarak kurdu. Hard delete ertelendi (K-P13-1/K27). `app`'in bugün şu
  tablolarda DELETE yetkisi yok: `support_sessions`, `support_requests`, `session_consents`, `device_bindings`,
  `customers`, `request_refs`, `consent_texts`, `tenant_request_settings`. Bütün FK'ler `ON DELETE RESTRICT`; cascade
  yok ve olmayacak.
- **Şemadan doğrulanan döngü:**
  - `device_bindings.first_session_id` ve `last_session_id` (**NOT NULL**) → `support_sessions`.
  - `support_sessions.request_id` (nullable) → `support_requests`.
  - `support_requests.binding_id` (nullable) → `device_bindings`.
  - `active_session_id` FK değildir; STORED üretilmiş sütun + UQ'dur.
- **`audit_logs.tenant_id` FK'dir.** `audit_logs_tenant_id_fkey` P1 migration'ında RESTRICT ile tanımlı ve P11 bunu
  korudu. Audit satırı UPDATE edilemez, 730 günden önce silinemez ve her gün P13b içerik özetine (14 sütun) girer.
  Bu FK durdukça firma satırı silinemez.
- `tenants`'ta pasife alınma anı yok; `updated_at` her düzenlemede değişiyor.
- `audit-continuity.sql` bütün tetikleyicilerin gövde özetini sabitle karşılaştırıyor. `check-app-grants.sh`,
  `backup.sh` (`BACKUP_EXPECTED_TRIGGERS:-3`) ve restore-verify tetikleyici sayısını 3 bekliyor.
- Yedek `--routines` almıyor, P13b anlık görüntüsü `routines` farkını FAIL sayıyor; saklı fonksiyon kullanılamaz.
- Kodda audit `entity` değeri kullanıcı için `"users"`, firma için `"tenants"`. Değerler `contracts/audit.ts`
  sabitlerinden gelir; bu ADR yalnız sabit adlarına atıf yapar.
- Super Admin'in (tenant'sız) e-posta gönderebileceği sistem SMTP'si yok. Bugün SMTP yalnız tenant düzeyinde.

## Karar

### 1. `audit_logs.tenant_id` FK'si kaldırılır

- `ALTER TABLE audit_logs DROP FOREIGN KEY audit_logs_tenant_id_fkey`. İndeksler kalır.
- Prisma'da `AuditLog.tenant` ve `Tenant.auditLogs` ilişkileri çıkarılır. `migrate diff --exit-code` 0 olmalı.
- Silinen firmanın audit satırları `tenant_id` değeriyle kalır, 730 günde mevcut saklamayla gider. Hiçbir audit
  satırına dokunulmadığı için içerik özeti değişmez.
- **Kural:** firma silinse de kalması gereken tablolar `tenants`'a FK taşımaz: `audit_logs`, `tenant_purge_jobs`, P26
  `billable_sessions`/`usage_monthly`. Meta-test (m.5) bu istisna listesini doğrular.

### 2. Döngü kırma sırası

Her adım tek TX'tir, parti 500. Silme çocuktan ebeveyne gider. Nullable FK yalnız silinecek ya da zaten anonim olan
satırda NULL'lanır.

**Gece işi (`purgeAnonymized`, AC-240).** Kesme anı **DB saatiyle** hesaplanır:
`cut = UTC_TIMESTAMP(3) − INTERVAL 30 DAY − INTERVAL 1 HOUR`. 1 saatlik pay, uygulama ile DB saati arasındaki farkta
sınırdaki adayın tetikleyiciye takılıp partiyi her gece geri aldırmasını önler (S16-8). Adımlar:

1. **Kayıt (B\*):** `revoked_at < cut` olan ve anonim olmayan hiçbir talebin bağlanmadığı kayıtlar.
   `UPDATE support_requests SET binding_id = NULL WHERE binding_id IN B*`, sonra `DELETE device_bindings`.
2. **Oturum (S\*):** `anonymized_at < cut` olan ve hiçbir kaydın `first/last_session_id`'si olmayan oturumlar. Sıra:
   `session_files` → `session_consents` → `support_sessions` → bağlı talepler (`anonymized_at < cut` olanlar).
3. **Oturumsuz talep (R\*):** `anonymized_at < cut` olan ve oturumu olmayan talepler.

`request_refs` (tek ad alanı, ADR-0006 r5), `customers` ve `consent_texts` gece işinde silinmez. Bir partide tetikleyici
SIGNAL alırsa sınıf `db_signal` olur, `rs_retention_failures_total{class="db_signal"}` artar ve alarm üretilir.

**Firma silme (AC-242).** `tenant_purge_jobs.step` sırası. Her adım `WHERE tenant_id = ? LIMIT 500` döngüsüyle çalışır:

| #   | `step`             | İş                                                                                                                      |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `FENCE`            | Firma kullanıcılarının `auth_sessions` → `revoked_at`; Super Admin satırlarında `acting_tenant_id = NULL`; WS kapatılır |
| 2   | `SESSION_FILES`    | `session_files`                                                                                                         |
| 3   | `SESSION_CONSENTS` | `session_consents`                                                                                                      |
| 4   | `REQUEST_UNLINK`   | `UPDATE support_requests SET binding_id = NULL`                                                                         |
| 5   | `BINDINGS`         | `device_bindings`                                                                                                       |
| 6   | `SESSIONS`         | `support_sessions`                                                                                                      |
| 7   | `REQUESTS`         | `support_requests`                                                                                                      |
| 8   | `REQUEST_BLOCKS`   | `request_blocks` (P15)                                                                                                  |
| 9   | `REQUEST_REFS`     | `request_refs`                                                                                                          |
| 10  | `CUSTOMERS`        | `customers`                                                                                                             |
| 11  | `SETTINGS`         | `tenant_request_settings`, `tenant_settings`                                                                            |
| 12  | `CONSENT_TEXTS`    | `consent_texts`                                                                                                         |
| 13  | `USER_CHILDREN`    | firma kullanıcılarının `user_permissions`, `recovery_codes`, `password_reset_tokens`, `auth_sessions`                   |
| 14  | `USERS`            | `users WHERE tenant_id = ?` (mezar taşları dahil)                                                                       |
| 15  | `TENANT_ROW`       | `tenants` satırı + aynı TX'te `tenant_purge_jobs.tenant_row_deleted_at = UTC_SYSDATE`                                   |
| 16  | `FILES`            | `uploads/{tenantId}/` (m.5 yol kuralları)                                                                               |
| 17  | `DONE`             | audit `tenant.purged`, `finished_at`, imha defteri satırı (m.9)                                                         |

### 3. `app`'in koşullu DELETE/UPDATE'i tetikleyiciyle zorlanır

`grants.sql`'e DELETE eklenir: `support_sessions`, `support_requests`, `session_consents`, `device_bindings`,
`customers`, `request_refs`, `consent_texts`, `tenant_request_settings`. `tenant_purge_jobs`: SELECT, INSERT, UPDATE,
DELETE.

Ortak kurallar:

- Gövde bileşik (`IF … END IF`).
- Saat kaynağı `UTC_SYSDATE` = `CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00')`; `SET TIMESTAMP` etkilemez.
- NULL karşılaştırma reddedilir (fail-closed).
- `migrator` ve `root` muaftır (`USER()`).
- Saklı fonksiyon yok.
- **PURGING(t):** `EXISTS (tenant_purge_jobs j JOIN tenants x ON x.id = j.tenant_id WHERE j.tenant_id = t AND
j.state = 'RUNNING' AND x.status = 'PASSIVE' AND x.passive_at <= UTC_SYSDATE − 30 DAY)`. Her tetikleyicide satır
  içi yazılır. `SCHEDULED` iş DB kilidini **açmaz**.

| Tetikleyici                                                                           | Kural                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_sessions`, `support_requests` BEFORE DELETE                                  | `OLD.anonymized_at <= UTC_SYSDATE − 30 DAY` **veya** PURGING                                                                                                                                             |
| `session_consents` BEFORE DELETE                                                      | üst oturumun `anonymized_at <= UTC_SYSDATE − 30 DAY` **veya** PURGING                                                                                                                                    |
| `device_bindings` BEFORE DELETE                                                       | `OLD.revoked_at <= UTC_SYSDATE − 30 DAY` **veya** PURGING                                                                                                                                                |
| `customers`, `request_refs`, `consent_texts`, `tenant_request_settings` BEFORE DELETE | yalnız PURGING                                                                                                                                                                                           |
| `users` BEFORE DELETE                                                                 | yalnız PURGING(OLD.tenant_id); `tenant_id IS NULL` (Super Admin) hiçbir zaman                                                                                                                            |
| `tenants` BEFORE DELETE                                                               | `OLD.status = 'PASSIVE'`, `passive_at` ≥ 30 g, iş RUNNING ve `step = 'TENANT_ROW'`                                                                                                                       |
| **`support_sessions`, `support_requests` BEFORE UPDATE** (S16-3)                      | `anonymized_at` NULL'dan dolu değere **bir kez** geçer; yazılan değer `[UTC_SYSDATE − 1 DAY, UTC_SYSDATE + 1 MINUTE]` aralığında olmalı; dolu değer değiştirilemez ve NULL'lanamaz                       |
| **`device_bindings` BEFORE UPDATE** (S16-3)                                           | `revoked_at` için aynı kural (kod bugün geri NULL'lamıyor: `bindings/repo.ts` yalnız `revokedAt: null` koşullu UPDATE; dba doğrular)                                                                     |
| `users` BEFORE UPDATE                                                                 | `OLD.status = 'DELETED'` ise SIGNAL (mezar taşı değişmez)                                                                                                                                                |
| `tenants` BEFORE INSERT/UPDATE                                                        | `passive_at` DB saatine zorlanır: PASSIVE'e geçişte `UTC_SYSDATE`, ACTIVE'de NULL, diğerlerinde eski değer. `SCHEDULED`/`RUNNING`/`FAILED` iş varken status değişimi SIGNAL (S16-10)                     |
| **`tenant_purge_jobs` BEFORE INSERT** (S16-4)                                         | `NEW.state = 'SCHEDULED'` zorunlu; `NEW.scheduled_for = UTC_SYSDATE + 24 HOUR` zorlanır; `tenant_id` biçimi CHECK ile                                                                                    |
| **`tenant_purge_jobs` BEFORE UPDATE**                                                 | izinli geçişler: `SCHEDULED→RUNNING` (yalnız `UTC_SYSDATE >= scheduled_for`), `SCHEDULED→CANCELLED`, `RUNNING→DONE\|FAILED`, `FAILED→RUNNING`. `scheduled_for`, `tenant_id`, `started_by` değiştirilemez |
| **`tenant_purge_jobs` BEFORE DELETE** (S16-10)                                        | yalnız `state IN ('DONE','CANCELLED') AND COALESCE(finished_at, cancelled_at) <= UTC_SYSDATE − 730 DAY`                                                                                                  |

**Sayım:** 19 yeni tetikleyici, toplam **22**. Dağılım: 11 BEFORE DELETE, 6 BEFORE UPDATE, 2 BEFORE INSERT.
Aynı migration'da güncellenecekler:

- `audit-continuity.sql` sabiti
- `check-app-grants.sh` (sayı, DELETE kümesi, negatifler)
- `backup.sh` `BACKUP_EXPECTED_TRIGGERS` varsayılanı ve `backup.env.example` (22)
- restore-verify

`anonymized_at` aralık kuralı yüzünden sahte saatle geçmiş tarih yazan testler fikstürü `testFixtureDb()` (migrator)
ile kurar (P13a kalıbı).

### 4. Kullanıcı mezar taşı ve audit maskesi (AC-241, K-E11-4)

**Mezar taşı.** Kullanıcı satırı silinmez, FK'ler bozulmaz. Tek TX'te, aktör ve hedef `FOR UPDATE` ile:

- `email = 'deleted+<id>@invalid'`, `username = NULL`
- `full_name = 'Silinmiş kullanıcı #<id son 6>'`
- `password_hash = '!deleted'`
- `totp_*` sıfır, `avatar_path = NULL`, `failed_*` ve `locked_until` sıfır
- `status = 'DELETED'`, `deleted_at = now`, `version + 1`
- Alt tablolar silinir: `user_permissions`, `recovery_codes`, `password_reset_tokens`, `auth_sessions`

DB savunması:

- `users_status_chk` += `DELETED`.
- `users_deleted_chk`: `(status = 'DELETED') = (deleted_at IS NOT NULL)`. DELETED ise `username`, `avatar_path` ve
  `totp_secret_enc` NULL; `email` mezar taşı biçiminde.
- Ön kontrol: P14a `SIGNAL` kalıbı.

Giriş ve sıfırlama:

- `findUserByLogin` ve parola sıfırlama sorgusu `status <> 'DELETED'` ile süzer. Mezar taşı "olmayan hesap" yoluna
  (bellek kovası) düşer. Sayaç UPDATE'i tetikleyiciye çarpmaz, sahte alarm ve `@invalid`'e posta oluşmaz (S16-7).

**Audit maskesi — fail-closed (S16-1).** Okuma görünümü (liste, CSV, oturum zaman çizelgesi; tek fonksiyon) şu
koşullardan biri sağlanırsa satırı **kimlik maskeli** döndürür:

- `user_id` dolu ve `users`'ta satır **yok** ya da `status = 'DELETED'`;
- `entity = AUDIT_ENTITY.USERS` (kodda `"users"`) ve `entity_id` için kullanıcı satırı yok ya da DELETED;
- `tenant_id` dolu ve `tenants`'ta satır **yok** (silinmiş firma).

Maskeleme:

- `username` → `maskIdentity()`: `a***@***`, e-posta değilse `a***`.
- `old_value`/`new_value` içinde `contracts/audit.ts` `AUDIT_IDENTITY_KEYS` kümesindeki anahtarlar maskelenir; iç içe
  nesneler dahil. Küme: `email`, `fullName`, `username`, `name`, `contactName`, `phone`, `customerName`,
  `customerEmail`, `recipient`.
- Etiketler: aktör "Silinmiş kullanıcı #XXXXXX", firma "Silinmiş firma #XXXXXX".

Durumlar sayfa başına iki `IN` sorgusuyla okunur (`users`, `tenants`). Ham değer hiçbir uçtan dönmez. Audit filtresi
yalnız `userId` ile çalışır; metin araması yok, bu yüzden sorgu yoluyla bilgi sızmaz.

### 5. `tenant_purge_jobs` adım makinesi

**Sütunlar:**

- `id` PK
- `tenant_id` CHAR(26): FK değil; CHECK `REGEXP_LIKE(tenant_id, '^[0-9A-HJKMNP-TV-Z]{26}\z', 'c')` (S16-2)
- `state`: `SCHEDULED | RUNNING | DONE | FAILED | CANCELLED`
- `step`
- `scheduled_for`
- `counts` JSON
- `attempts`
- `last_error` (yalnız sınıf)
- `preview_hash` CHAR(64) UQ (S16-6)
- `started_by` → `users`
- `cancelled_by` NULL → `users`
- `cancelled_at`, `started_at`, `heartbeat_at`, `tenant_row_deleted_at`, `finished_at`
- `created_at`, `updated_at`

**Tekillik:** firma başına tek açık iş. Fonksiyonel UQ:
`((IF(state IN ('SCHEDULED','RUNNING','FAILED'), tenant_id, NULL)))` (`consent_texts_one_current_uq` kalıbı).

**Vazgeçme penceresi (S16-4) — kullanıcı onayı bekleyen varsayım.** Ana oturum en güvenli seçeneği seçti; sabah
kullanıcıya sunulacak.

- POST işi `SCHEDULED` açar; `scheduled_for` DB saatiyle +24 saattir.
- Bu sürede `DELETE /admin/tenants/:id/purge` (Super Admin + step-up) işi `CANCELLED` yapar.
- İş açılınca bildirim yapılır:
  - audit `tenant.purge_scheduled`;
  - **bütün Super Admin'lerin panelinde** kalıcı uyarı bandı (iptal bağlantılı);
  - `rs_tenant_purge_jobs{state="SCHEDULED"}` > 0 → `remote-watch` operatör alarmı.
- E-posta: sistem düzeyi SMTP olmadığı için bugün gönderilemez. Sistem SMTP'si eklendiğinde bütün Super Admin'lere
  e-posta gider (Sonra). Bu açıklık ADR'de kalan risk olarak durur.
- Kullanıcı beklemeyi reddederse `scheduled_for = created_at` olur (tek satırlık tetikleyici değişikliği) ve risk
  "kalan risk"e taşınır.

**Yürütücü (`jobs/tenant-purge.ts`):**

- 60 sn tur, tek iş, iş satırı `FOR UPDATE`.
- `SCHEDULED` iş `scheduled_for` geçince `RUNNING` yapılır.
- **Her turun başında uygunluk yeniden doğrulanır** (DB saatiyle, S16-2):
  - `step < TENANT_ROW` iken firma PASSIVE ve `passive_at <= UTC − 30 g` olmalı.
  - `step ≥ TENANT_ROW` iken firma satırı yok **ve** `tenant_row_deleted_at` dolu olmalı.
  - Aksi hâlde iş `FAILED` (`last_error = invalid_job`) olur, alarm üretilir ve hiçbir adım çalışmaz.
- Adım 0 satır silince ayrı UPDATE ile ilerler. Yeniden çalıştırma 0 satır siler (idempotent); imleç gerekmez.
- Hata: 3 üstel deneme (1, 5, 30 dk), sonra `FAILED` + audit + alarm. `FAILED` iş varken firma yeniden etkinleştirilemez
  (uygulama 409 + tetikleyici). Sürdürme yeni önizlemeyle yapılır.
- Gece saklama işi açık işi olan firmayı atlar.
- DONE/CANCELLED satırları 730 gün sonra saklama işiyle silinir.

**`FILES` adımı (S16-2):**

- Yalnız `TENANT_PREFIX_RE` ile doğrulanmış id kabul edilir; `isPrefix` (`system`'ı da kabul eder) kullanılmaz.
- Yol `UploadStore.absDir(prefix)` ile kurulur: `resolve` + kök altında kalma kontrolü.
- `fs.rm` sembolik bağlantıyı izlemez. Bu davranış testle sabitlenir: hedef klasör bir sembolik bağlantıysa yalnız
  bağlantı silinir.

**Meta-test (S16-11):**

- `tenants`'a FK veren tablo kümesi = adım listesi ∪ istisna listesi.
- `users`'a FK veren tablolar listelenir. Firma dışı tablolardan firma kullanıcısına FK varsa adım listesinde karşılığı
  olmalıdır.
- Korunan 11 tabloya giden **bütün FK'lerde `DELETE_RULE = 'RESTRICT'`** olmalı. CASCADE ya da SET NULL tetikleyiciyi
  atlatır; MySQL FK eylemleri tetikleyici çalıştırmaz.

### 6. dryRun ve `previewId` (R26, S16-6)

- `POST /admin/tenants/:id/purge {dryRun: true}` sayıları ve `previewId` döner.
- `previewId` = HMAC-SHA256 (HKDF etiketi `purge-preview`). İçeriği:
  - tenant id
  - aktör id
  - **`authSessionId`**
  - **`passive_at`**
  - **açık işin `id:updated_at` değeri ya da `none`**
  - son geçerlilik (15 dk)
- İş oluşturma ve sürdürme `SHA-256(previewId)`'yi `preview_hash`'e yazar (UQ); ikinci kullanım reddedilir. İş durumu
  değişince eski önizleme de geçersizleşir.
- `previewId` audit'e ve loglara yazılmaz; audit'e yalnız sayılar girer.
- **Gece işi:** `RETENTION_PURGE_MODE=dry|on`, varsayılan `dry`. Staging `on`; prod'da ilk `dry` raporu kontrol
  edildikten sonra `on`.

### 7. Yetim dosya taraması (AC-243)

- Haftalık iş.
- Referans kaynakları tek listeden okunur: `uploads/references.ts` `UPLOAD_REFERENCE_SOURCES` (`tenants.logo_path`,
  `users.avatar_path`, sistem logosu). Meta-test, şemadaki bütün `*_path` sütunlarının bu listede olduğunu doğrular
  (S16-9).
- Karşılıksız dosya `uploads/.orphans.json`'a `firstSeenAt` ile yazılır, 7 gün sonra silinir. Yeniden adlandırma yok.
  24 saatten eski `.tmp` artıkları silinir.
- **Devre kesici (S16-9):** aşağıdakilerden biri varsa o tur **hiç silme yapılmaz**; audit `uploads.orphan_scan` `fail`
  (`reason: circuit_open`) yazılır ve alarm üretilir:
  - DB referans kümesi boşken diskte dosya var;
  - `found / toplam > %20`.
- Gözlem: `rs_orphan_files_total{action}`, `rs_orphan_scan_last_success_timestamp_seconds`.

### 8. Geri yükleme (R26, AC-244, S16-5)

- Prod'a seçici geri yükleme yoktur. Yedekler ≤ 14 günde düşer.
- **Varsayım:** site dışı hedefin saklaması da ≤ 14 gündür. Bunu operatör kurar; runbook'ta kontrol maddesi olur.
- **Scratch dışa aktarımı:** runbook kaydı (kim, ne zaman, hangi talep) + **iki kişinin onayı** + ağsız konteyner +
  scratch'in silindiğinin doğrulanması (`docker ps -a` ve volume listesi boş). Bu iz uygulama dışında olduğu için
  runbook kaydı zorunludur.

### 9. İmha defteri (S16-5)

- DB dışında, yalnız eklenen JSONL dosyası: `/var/lib/remote/erasure-ledger.jsonl` (server konteynerinde ayrı volume
  `remote_ledger`, 0600).
- Satır biçimi: `{v:1, type: "tenant"|"user", id, jobId?, at}`. PII yok.
- Firma işi DONE olduğunda ve mezar taşı commit edildiğinde yazılır, `fsync` ile. Yazılamazsa işlem başarılı sayılır,
  ama `rs_erasure_ledger_write_failed_total` alarmı üretilir.
- Defter DB yedeğine **girmez**. `backup.sh` onu ayrı dosya olarak yedek setine ve site dışına kopyalar. DB restore'u
  defteri geri almaz.
- **Restore sonrası zorunlu adım:** `pnpm --filter @remote/server cli erasure:replay` (migrator ile).
  - Deftere göre mezar taşı yeniden uygulanır.
  - Firmalar için `RUNNING` iş doğrudan açılır: migrator INSERT tetikleyicisinden muaftır, karar daha önce verilmiştir.
  - Ardından `erasure:verify` defterdeki id'lerin DB'de silinmiş/mezar taşı olduğunu doğrular. Restore-verify bu
    adımın yapıldığını kontrol eder.

## Alternatifler

- **Audit `tenant_id`'yi NULL'lamak:** tetikleyici ve içerik özetiyle çelişir. Reddedildi.
- **Firma satırını mezar taşı yapmak:** AC-242 "tüm satırlar" diyor. Reddedildi.
- **`ON DELETE CASCADE`:** zincirleme geri dönüşsüz silme. Reddedildi; meta-test de yasaklar.
- **Yalnız uygulama koşulu:** yanlış bir WHERE bütün geçmişi silebilirdi. Reddedildi.
- **Saklı fonksiyon:** yedek/restore anlık görüntüsüyle çelişir. Reddedildi.
- **Hemen başlayan firma silme:** S16-4 nedeniyle 24 saat beklemeye çevrildi (kullanıcı onayı bekliyor).
- **İkinci Super Admin onayı (dört göz):** tek Super Admin'li kurulumda kilitlenir. Panel bandı + alarm + iptal
  penceresi seçildi; dört göz Sonra.

## Sonuçlar

- **Olumlu:**
  - K27 kapanır.
  - 30 gün sınırı DB'de hem gece silmesinde (`anonymized_at`/`revoked_at` bir kez yazılır ve DB saatine yakın olur)
    hem firma silmede (`passive_at` zorlaması) uygulanır.
  - 24 saatlik iptal penceresi ve alarm vardır.
  - Kesintiye dayanıklıdır.
  - Restore sonrası imha kararları defterden yeniden uygulanır.
- **Olumsuz:** 19 yeni tetikleyici; continuity sabiti ve beklenen sayılar her tetikleyici değişiminde güncellenir.
  Audit'te dangling `tenant_id` kalır. Defter yeni bir operasyon nesnesidir.
- **Kalan risk:**
  - `app` kimliği ele geçirilirse saldırgan firmayı pasife alabilir ve iş açabilir. Yine de 30 + 1 gün bekler; panel
    bandı ve alarm görünür.
  - Super Admin'e e-posta bildirimi sistem SMTP'si gelene kadar yoktur.
  - Uygulama `anonymized_at`'ı erken yazarsa (gerçek anonimleştirme olmadan) 30 gün sonra satır silinir. Bu durum
    `support_sessions_anonymized_chk` ile PII NULL olmadan yazılamaz.
- **Varsayımlar** (sorulmadı, en güvenli seçenek):
  - Kullanıcı silme de step-up ister.
  - Super Admin bu uçla silinemez.
  - Gece silmesi prod'da `dry` başlar.
  - Kayıt için "anonimleşme anı" `revoked_at` sayılır.
  - Site dışı saklama ≤ 14 gündür.
  - **24 saat bekleme ve bildirim biçimi kullanıcı onayı bekliyor.**
