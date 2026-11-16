-- P28u-K1 gözetimsiz izinli/izinsiz bağlantı veri modeli (docs/mimari-p28u.md r2 §3.1–3.3, §16 K1, §r2; AC-436, 445, 446;
-- K-P28u-4/15/20; R-P28u-6). Ayrıntı ve gerekçeler: docs/db-notlari.md "P28u". Veri taşıma YOK: yeni sütunlar NULL / FALSE;
-- mevcut satırlar yeni ve genişleyen CHECK'leri olduğu gibi geçer. Yeni tablo YOK → grants.sql'de yeni GRANT yok (tablo düzeyi
-- UPDATE P1/P2'den). Tetikleyici YOK → toplam 23, audit-continuity.sql özet sabiti değişmez.
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (sütunlar,
-- indeks, FK) `migrate diff` çıktısıyla aynı ad/tipte; sütun + indeks + FK + CHECK tablo başına TEK ALTER'da (tek yeniden yazım).
-- Sonrasında `migrate diff --exit-code` = 0.
--
-- Sapmalar / daraltmalar (db-notlari "P28u"):
--  * support_sessions_ttl_chk: mimari "anonim satır kuralı aynen" diyor; ama anonimleştirme device_id'yi NULL'lar ve expires_at'e
--    dokunmaz → 150 sn'lik `ask` oturumu anonimleşince eski 55..65 anonim dalına sığmaz, saklama işi 3819 ile dururdu. Anonim,
--    talepsiz satırın penceresi de 55..155 sn'ye genişletildi (talep oturumu anonimde de 55..65; kod yolu 14..31 dk aynen).
--  * support_sessions_anonymized_chk += `silent_reason IS NULL` (§3.3 "anonimleştirmede NULL" DB'de zorunlu; P27 device_id kalıbı).
--  * silent_reason_chk += kırpılmış + kontrol karakteri yok (`\n` hariç) — contracts silentReasonSchema (§5.1) ile aynı sınır.
--
-- Kilit (MySQL 8.4; R-P28u-6):
--  * tenant_settings: küçük (firma başına 1 satır) → sütun + indeks + FK + CHECK tek ALTER (COPY; FK eklemek INPLACE'i
--    foreign_key_checks=1 iken zaten engeller).
--  * support_sessions: ADD COLUMN ×2 + 4 CHECK (ttl_chk + anonymized_chk DROP/ADD aynı ALTER'da → kısıtsız ara an yok) → TEK COPY
--    ALTER; tablo yeniden yazılır, süresince oturum yazımı bekler. Süre: db-notlari "P28u" (staging küçük; prod öncesi bakım penceresi).
-- Ön kontrol (ileri) gerekmez: yeni sütunlar NULL; TTL/anonim CHECK'leri yalnız genişler/yeni NULL sütuna bakar.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz) — önce precheck.sql.

-- 1) tenant_settings (§3.1, AC-436). PRISMA ÜRETTİ (sütun, indeks, FK) + CHECK ELLE — tek ALTER.
ALTER TABLE `tenant_settings`
    ADD COLUMN `unattended_silent_ack_at` DATETIME(3) NULL,
    ADD COLUMN `unattended_silent_ack_by` CHAR(26) NULL,
    ADD COLUMN `unattended_silent_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD INDEX `tenant_settings_unattended_silent_ack_by_idx`(`unattended_silent_ack_by`),
    ADD CONSTRAINT `tenant_settings_unattended_silent_ack_by_fkey` FOREIGN KEY (`unattended_silent_ack_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- ELLE (§3.1): açık politika aydınlatma izi olmadan var olamaz.
    ADD CONSTRAINT `tenant_settings_silent_ack_chk` CHECK (`unattended_silent_enabled` = 0 OR `unattended_silent_ack_at` IS NOT NULL);

-- 2) support_sessions (§3.2, AC-445/446). PRISMA ÜRETTİ (sütunlar) + CHECK'ler ELLE — TEK COPY ALTER.
ALTER TABLE `support_sessions`
    ADD COLUMN `consent_mode` VARCHAR(8) NULL,
    ADD COLUMN `silent_reason` VARCHAR(500) NULL,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_anonymized_chk`,
    ADD CONSTRAINT `support_sessions_consent_mode_chk` CHECK (`consent_mode` IS NULL
        OR CAST(`consent_mode` AS BINARY) IN ('asked', 'no_user', 'silent')),
    -- Kip yalnız cihaz oturumunda (anonimleşmiş satırda device_id NULL'dır, kip kalır — kişisel değil).
    ADD CONSTRAINT `support_sessions_consent_mode_dev_chk` CHECK (`consent_mode` IS NULL OR `device_id` IS NOT NULL
        OR `anonymized_at` IS NOT NULL),
    -- Gerekçe yalnız silent; 20..500 kod noktası, kırpılmış, kontrol/biçim karakteri yok (`\n` serbest) — §5.1 silentReasonSchema.
    -- consent_mode kendi ikili CHECK'iyle kanonik → burada CAST gerekmez.
    ADD CONSTRAINT `support_sessions_silent_reason_chk` CHECK (`silent_reason` IS NULL
        OR (`consent_mode` = 'silent'
            AND CHAR_LENGTH(`silent_reason`) BETWEEN 20 AND 500
            AND CHAR_LENGTH(`silent_reason`) = CHAR_LENGTH(TRIM(`silent_reason`))
            AND NOT REGEXP_LIKE(`silent_reason`, '[\\x{0000}-\\x{0009}\\x{000B}-\\x{001F}\\x{007F}-\\x{009F}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    -- K-P28u-4: kod yolu 14..31 dk; talep oturumu 55..65 sn; cihaz oturumu 55..155 sn (ask 150, silent 60). Anonim talepsiz satır
    -- (anonimleşmiş cihaz oturumu: device_id NULL) cihaz penceresini taşır (sapma — başlık).
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (
        (`request_id` IS NULL AND `device_id` IS NULL
            AND `expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE)
        OR (`request_id` IS NOT NULL AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 65)
        OR (`request_id` IS NULL AND (`device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL)
            AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 155)),
    -- P13a/P27 kuralı + P28u: anonim satırda gerekçe kalmaz (§3.3).
    ADD CONSTRAINT `support_sessions_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')
            AND `customer_name` IS NULL AND `customer_email` IS NULL AND `note` IS NULL
            AND `guest_net_key` IS NULL AND `guest_ip_key` IS NULL AND `device_id` IS NULL
            AND `silent_reason` IS NULL)),
    ALGORITHM=COPY;
