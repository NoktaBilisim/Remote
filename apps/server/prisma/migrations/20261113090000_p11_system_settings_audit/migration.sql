-- P11 sistem ayarları + audit değiştirilemezliği (docs/mimari.md §3.1 `system_settings`, §3.3, §10 P11; ADR-0003 r2;
-- AC-76, 77, 78, 123). Expand-only: 1 yeni tablo (system_settings), audit_logs'a 2 tetikleyici, audit ekranı indeksleri.
-- Veri taşıma YOK. Ayrıntı ve kararlar: docs/db-notlari.md "P11".
--
-- ÖN KOŞUL (binlog, ERROR 1419): MySQL 8.4'te binary log varsayılan AÇIK. Bu durumda SUPER yetkisi olmayan kullanıcı
-- (migrator) CREATE TRIGGER çalıştıramaz. Sunucu `--log-bin-trust-function-creators=1` ile açılmalıdır
-- (deploy/docker-compose.yml mysql `command`, scripts/test-db.sh, CI'da root `SET GLOBAL`). SUPER'i migrator'a vermek
-- reddedildi (deneyle doğrulandı: SET_ANY_DEFINER, SYSTEM_VARIABLES_ADMIN, BINLOG_ADMIN, SESSION_VARIABLES_ADMIN +
-- `sql_log_bin=0` gibi dinamik yetkilerin hiçbiri yetmiyor; yalnız SUPER yetiyor).
-- Bayrak yoksa migration İLK ifadede (tetikleyici) 1419 ile durur. Tetikleyiciler bu yüzden en başta: hiçbir şey
-- değişmez → bayrağı aç, `prisma migrate resolve --rolled-back 20261113090000_p11_system_settings_audit`, tekrar deploy.
--
-- Kilitleme notu (MySQL 8.4):
--  * CREATE TRIGGER → audit_logs üzerinde kısa metadata kilidi (saniyenin altı).
--  * CREATE TABLE (boş) + FK → kilit yok.
--  * audit_logs ADD INDEX → ALGORITHM=INPLACE, LOCK=NONE (çevrimiçi; yazma sürer). DROP INDEX → yalnız metadata.
--    audit_logs en hızlı büyüyen tablo; staging'de küçük, prod henüz kapalı.
--  * system_settings ADD CHECK → boş tablo, anında.

-- ELLE EKLENDİ ↓ (Prisma tetikleyici üretmez; mimari §3.3). Tanımlayıcı (DEFINER) = migrator; tetikleyici gövdesi
-- yetki gerektirmez (yalnız SIGNAL). Tek ifadelik gövde / IF bloğu: Prisma betiği sunucuya bütün olarak gönderir,
-- DELIMITER gerekmez.

-- Her UPDATE reddedilir (append-only; migrator/root dahil — düzeltme gerekirse yeni kayıt yazılır).
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE denied';

-- Yalnız 730 günden eski satır silinebilir (retention, §3.4). Saat kaynağı SYSDATE(): NOW()/UTC_TIMESTAMP() oturum
-- değişkeni `timestamp` ile (SET TIMESTAMP — yetki gerektirmez) ileri alınabilir ve korumayı aşardı (deneyle doğrulandı);
-- SYSDATE gerçek saattir (sunucu `--sysdate-is-now` ile AÇILMAMALI). CONVERT_TZ: oturumun time_zone'u değiştirilse de
-- UTC'ye çevrilir (created_at UTC). Fail-closed: karşılaştırma NULL olursa (ör. bilinmeyen saat dilimi) silme reddedilir.
-- Not: mimari §3.3 metnindeki NOW() yerine SYSDATE — sapma notu mimari §3.1 (P11).
CREATE TRIGGER `audit_logs_retention_only_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW
    IF NOT COALESCE(OLD.`created_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 730 DAY, FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs: only rows older than 730 days can be deleted (retention)';
    END IF;

-- PRISMA ÜRETTİ (migrate diff --from-config-datasource --to-schema, P10 durumundaki DB'den) ↓ — İKİ ELLE DEĞİŞİKLİK:
--  (1) Prisma `ALTER TABLE audit_logs DROP FOREIGN KEY audit_logs_tenant_id_fkey` + sonda YANLIŞ tabloya
--      `ALTER TABLE tenant_settings ADD CONSTRAINT tenant_settings_tenant_id_fkey ...` üretti (Prisma 7.10.1 hatası;
--      FK zaten var → 1826 ile düşerdi ve audit_logs FK'siz kalırdı). FK'yi düşürmek gereksiz: tenant_id önekli
--      IX(tenant_id, created_at) FK'yi taşımaya devam eder → iki satır çıkarıldı. Sonrasında `migrate diff --exit-code` = 0.
--  (2) Yeni indeksler `CREATE INDEX` yerine `ALTER TABLE ... ALGORITHM=INPLACE, LOCK=NONE` (çevrimiçi garanti; kilit
--      gerekirse sessizce kilitlemek yerine hata verir). İndeks adları Prisma'nınkiyle aynı.

-- DropIndex — (tenant_id, user_id, created_at) yerine (user_id, created_at): user_id ULID ve tek tenant'a ait (P2
-- technician_id kararıyla aynı gerekçe); Admin sorgusu `tenant_id = ? AND user_id = ?` yeni indeksi aynı verimle kullanır,
-- Super Admin tüm-tenant kullanıcı filtresi ancak bununla indeksli olur. Net indeks sayısı +1 (yalnız action, created_at).
DROP INDEX `audit_logs_tenant_id_user_id_created_at_idx` ON `audit_logs`;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(60) NOT NULL,
    `value_json` JSON NULL,
    `secret_enc` VARBINARY(512) NULL,
    `updated_by` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `system_settings_updated_by_idx`(`updated_by`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex (audit ekranı, AC-76: Super Admin tüm tenant'larda kullanıcı / işlem filtresi; ORDER BY created_at DESC,
-- id DESC — InnoDB ikincil indeksi PK'yi (id) sonda taşır, sıralama indeksten gelir)
ALTER TABLE `audit_logs`
    ADD INDEX `audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    ADD INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    ALGORITHM=INPLACE, LOCK=NONE;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE EKLENDİ ↓ (Prisma CHECK kısıtı üretmez; zod'a ek DB savunması, mimari §3 dba notu P1 (3)).
-- Anahtar kümesi ikili karşılaştırma (ADR-0014: 'MYSQL', 'mysql ' geçmez). Yeni anahtar (ör. P12 sistem logosu) = bu
-- CHECK'i genişleten migration. value_json: nesne ≤ 4 KB (P5 kalıbı); gizli değer hiçbir zaman value_json'da değil
-- (anahtar başına additionalProperties:false şeması `password`/`secret` alanını reddeder).
-- mysql: {host, port, database, user} zorunlu ve yalnız bunlar; host = SMTP host kuralı (ASCII ad / IPv4 / [IPv6]);
--        database [A-Za-z0-9_$-]{1,64}; user 1..32 (MySQL sınırı), kontrol/biçim karakteri yok; şifre secret_enc (opsiyonel).
-- turn:  {urls: 0..10 tekil `stun:|turn:|turns:` URL, boşluksuz yazdırılabilir ASCII ≤ 255}; turn:/turns: URL'si varsa
--        secret_enc zorunlu (env.ts TURN_SECRET kuralıyla aynı).
-- JSON şeması `pattern` sonu `$`: ICU `$` sorunu (db-notlari P10 madde 3) burada yok — rapidjson regex'i; test edildi.
ALTER TABLE `system_settings`
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn')),
    ADD CONSTRAINT `system_settings_value_json_chk` CHECK (`value_json` IS NULL
        OR (JSON_TYPE(`value_json`) = 'OBJECT' AND JSON_STORAGE_SIZE(`value_json`) <= 4096)),
    ADD CONSTRAINT `system_settings_secret_enc_chk` CHECK (`secret_enc` IS NULL OR LENGTH(`secret_enc`) >= 30),
    ADD CONSTRAINT `system_settings_mysql_chk` CHECK (CAST(`key` AS BINARY) <> 'mysql' OR (`value_json` IS NOT NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["host","port","database","user"],"properties":{"host":{"type":"string","minLength":1,"maxLength":253,"pattern":"^([A-Za-z0-9.-]+|\\\\[[0-9A-Fa-f:.]+\\\\])$"},"port":{"type":"integer","minimum":1,"maximum":65535},"database":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[A-Za-z0-9_$-]+$"},"user":{"type":"string","minLength":1,"maxLength":32}}}',
            `value_json`)
        AND NOT REGEXP_LIKE(`value_json` ->> '$.user', '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `system_settings_turn_chk` CHECK (CAST(`key` AS BINARY) <> 'turn' OR (`value_json` IS NOT NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["urls"],"properties":{"urls":{"type":"array","maxItems":10,"uniqueItems":true,"items":{"type":"string","minLength":6,"maxLength":255,"pattern":"^(stun|turn|turns):[!-~]+$"}}}}',
            `value_json`)
        AND (`secret_enc` IS NOT NULL OR NOT REGEXP_LIKE(CAST(JSON_EXTRACT(`value_json`, '$.urls') AS CHAR), '"turns?:', 'c'))));
