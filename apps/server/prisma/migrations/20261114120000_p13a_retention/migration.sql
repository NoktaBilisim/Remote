-- P13a saklama (retention) + audit created_at zorlaması + WhatsApp adres CHECK sıkılaştırması (docs/mimari.md §10.5 D1,
-- docs/mimari-p13.md §2 K-P13-1..4, §3 B-P12b-4; AC-197, AC-198). Expand-only: 1 nullable sütun, 1 CHECK, 1 indeks,
-- 1 tetikleyici, 1 CHECK değişikliği. Veri taşıma YOK. Yetkiler (DELETE / sütun UPDATE) bu dosyada DEĞİL,
-- prisma/sql/grants.sql'de (migrate deploy'dan hemen sonra aynı `pnpm db:migrate` adımında). Ayrıntı: docs/db-notlari.md "P13a".
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve tetikleyici üretmez. Prisma'nın üreteceği kısım (sütun + indeks)
-- `migrate diff` çıktısıyla aynı adlarla elle yazıldı ve ALGORITHM/LOCK yan tümceleri eklendi (çevrimiçi DDL);
-- sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Kilit (MySQL 8.4):
--  * Up guard (geçici tablo) → kilit yok.
--  * CREATE TRIGGER → audit_logs üzerinde kısa metadata kilidi (saniyenin altı). Binlog açık: sunucu
--    --log-bin-trust-function-creators=1 ile açık olmalı (P11'den beri compose/test-db/CI'da var; yoksa İLK DDL'de 1419,
--    öncesinde yalnız guard çalışmış olur → hiçbir şey değişmez).
--  * support_sessions ADD COLUMN (nullable, sonda) → ALGORITHM=INSTANT (yalnız metadata).
--  * support_sessions ADD INDEX → ALGORITHM=INPLACE, LOCK=NONE (çevrimiçi; yazma sürer).
--  * support_sessions ADD CHECK → ALGORITHM=COPY (tablo yeniden yazılır, süre boyunca yazma bekler). Büyüyen tablo;
--    staging'de küçük, prod henüz kapalı (P13b). Yeni sütun tamamen NULL olduğundan CHECK bu anda ihlal edilemez.
--  * system_settings DROP+ADD CHECK (tek ALTER, kısıtsız ara an yok) → COPY, birkaç satır.
--
-- ÖN KONTROL (koruma): MySQL DDL transaction'a girmez; son ALTER ihlalle düşerse öncekiler değişmiş kalırdı. Mevcut
-- `whatsapp` satırı yeni WhatsApp CHECK'ini ihlal ediyorsa (adreste \p{Cf}: U+200B, U+202E, U+FEFF, U+00AD … — P12b
-- CHECK'i bunları kabul ediyordu) `p13a_up_guard_chk` (3819) migration'ı HİÇBİR ŞEY DEĞİŞMEDEN durdurur.
-- Kurtarma: Super Admin adresi panelden yeniden girer (ya da migrator: UPDATE system_settings SET value_json =
-- JSON_OBJECT('url', NULL) WHERE `key` = 'whatsapp'), sonra `prisma migrate resolve --rolled-back
-- 20261114120000_p13a_retention` + `pnpm db:migrate`.
CREATE TEMPORARY TABLE `p13a_up_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p13a_up_guard_chk` CHECK (`n` = 0));
INSERT INTO `p13a_up_guard` (`n`) SELECT COUNT(*) FROM `system_settings`
    WHERE CAST(`key` AS BINARY) = 'whatsapp'
      AND JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'STRING'
      AND NOT REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+\\z', 'c');
DROP TEMPORARY TABLE `p13a_up_guard`;

-- 0) ELLE (devops yedek provası bulgusu, 2026-11-14): P11'in `audit_logs_no_update` tetikleyicisi tek ifadelik gövdeyle
--    (SIGNAL …;) yazılmıştı; Prisma'nın çok ifadeli gönderiminde MySQL sondaki `;`'yi gövdeye dahil etti
--    (ACTION_STATEMENT `…UPDATE denied';`). mysqldump bunu `…'; */;;` olarak döker ve düz `mysql` istemcisiyle geri
--    yükleme 1064 verir (AC-200 geri yükleme). Davranış AYNI kalacak şekilde BEGIN…END bileşik gövdeyle yeniden kurulur:
--    bileşik ifade `END`'de biter, `;` gövdeye girmez (IF…END IF gövdeli diğer iki tetikleyicide sorun yok — kontrol
--    edildi). DROP+CREATE arası korumasız an saniyenin altında; app'te zaten UPDATE yetkisi yok.
--    P11 migration dosyası değiştirilmedi (uygulanmış migration'ın checksum'ı bozulmasın).
DROP TRIGGER `audit_logs_no_update`;
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW
    BEGIN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE denied';
    END;

-- 1) audit_logs created_at zorlaması (K-P13-4, I-P11-3, AC-198). P13a'da app audit_logs DELETE yetkisi alır; 730 gün
--    sınırı (audit_logs_retention_only_delete) satırın created_at'ine bakar. app geriye tarihli satır ekleyebilseydi
--    ekleyip hemen silebilirdi → app'in yazdığı created_at yok sayılır, DB saati (UTC) yazılır.
--    Koşul (dba kararı, fail-closed): MUAF liste, zorlanan liste değil. Yalnız `migrator` (migration, test fikstürü) ve
--    `root` (yedekten geri yükleme — mysqldump satırları özgün created_at ile döner; restore.sh root kullanır) kendi
--    değerini yazabilir; `app` ve ileride eklenecek her kullanıcı DB saatine zorlanır.
--    USER() (istemcinin bağlandığı hesap adı) kullanılır: tetikleyici içinde CURRENT_USER() DEFINER'ı (migrator)
--    döndürür, ayırt edemez. Hesap adı ikili karşılaştırılır (MySQL kullanıcı adları harf duyarlı).
--    Saat kaynağı P11 DELETE tetikleyicisiyle aynı: SYSDATE (SET TIMESTAMP ile ileri/geri alınamaz) + CONVERT_TZ
--    (oturum time_zone'u ne olursa olsun UTC). CONVERT_TZ NULL dönerse (bilinmeyen dilim) created_at NOT NULL
--    olduğu için INSERT reddedilir (fail-closed). Tetikleyici yalnız NEW'e yazar; yetki gerektirmez (DEFINER migrator).
--    Tetikleyici sayısı audit_logs'ta 2 → 3 (restore-verify, runbook §15.6, check-app-grants).
CREATE TRIGGER `audit_logs_force_created_at` BEFORE INSERT ON `audit_logs` FOR EACH ROW
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root') THEN
        SET NEW.`created_at` = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00');
    END IF;

-- 2) support_sessions anonimleştirme işareti (AC-197, mimari-p13 §2). Saklama işi bitmiş oturumda kişisel alanları
--    NULL'lar ve anonymized_at'i yazar (aynı UPDATE). Liste/detay/CSV `anonymized` bayrağını buradan türetir;
--    PATCH 409 SESSION_ANONYMIZED kararı da buna bakar.
-- PRISMA ÜRETTİ (adlar migrate diff ile aynı) + ALGORITHM yan tümceleri ELLE:
ALTER TABLE `support_sessions` ADD COLUMN `anonymized_at` DATETIME(3) NULL, ALGORITHM=INSTANT;

-- Saklama işinin aday sorgusu (tenant döngüsü, 1000'lik parti):
--   WHERE tenant_id = ? AND anonymized_at IS NULL AND created_at < ? AND status IN ('ENDED','EXPIRED','CANCELLED')
--   ORDER BY created_at, id LIMIT 1000
-- → eşitlik (tenant_id) + IS NULL (eşitlik gibi kullanılır) + created_at aralığı; status indeks üstünde süzülür.
--   Anonimleşmiş satırlar indeksin ayrı bir dilimine düştüğü için her tur yalnız kalan adayları tarar (idempotent tur
--   ucuz). Mevcut IX(tenant_id, status, created_at) IS NULL koşulunu taşımaz; anonim satırlar biriktikçe her tur
--   onları baştan okurdu.
ALTER TABLE `support_sessions`
    ADD INDEX `support_sessions_tenant_id_anonymized_at_created_at_idx`(`tenant_id`, `anonymized_at`, `created_at`),
    ALGORITHM=INPLACE, LOCK=NONE;

-- ELLE: anonimleşmiş oturumda kişisel veri yok ve yalnız bitmiş oturum anonimleşir. Kişisel alan yazan her UPDATE
-- (PATCH /sessions/:id) anonim oturumda bu CHECK'e çarpar (3819) — API 409'unun DB savunması.
-- status değerleri support_sessions_status_chk ile zaten ikili/kanonik → burada CAST gerekmez.
-- ticket_no, süre, mod, kalite özeti KALIR (AC-197).
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')
            AND `customer_name` IS NULL AND `customer_email` IS NULL AND `note` IS NULL
            AND `guest_net_key` IS NULL AND `guest_ip_key` IS NULL));

-- 3) WhatsApp servis adresi (B-P12b-4, mimari-p13 §3): + \p{Cf} (biçim: bidi U+202A–202E/2066–2069, sıfır genişlik
--    U+200B–200D, BOM U+FEFF, yumuşak tire U+00AD …), \p{Zl} (U+2028), \p{Zp} (U+2029) reddi. Zl/Zp ICU `\s`
--    içinde zaten vardı (P12b); zod ile birebir aynı küme olsun diye açıkça yazıldı. Geri kalanı P12b ile aynı.
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_whatsapp_chk`,
    ADD CONSTRAINT `system_settings_whatsapp_chk` CHECK (CAST(`key` AS BINARY) <> 'whatsapp' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":["string","null"],"maxLength":200}}}',
            `value_json`)
        AND (JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'NULL'
            OR REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+\\z', 'c'))));
