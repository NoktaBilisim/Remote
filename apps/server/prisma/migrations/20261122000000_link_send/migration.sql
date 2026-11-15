-- LG-1 müşteriye bağlantı gönderme (docs/mimari-link-gonderme.md §3, §3.1, §4.4; AC-419, AC-420). Ayrıntı: docs/db-notlari.md
-- "LG". Yeni tablo yok; unattended_registration_codes'a iki sütun. Veri taşıma YOK: mevcut kodlarda download_token_hash NULL
-- kalır (düz kod/belirteç türetilemez; bu kodlar K1 bağlantısıyla gönderilemez, 24 sa içinde zaten sona erer), sent_count 0.
-- Grant değişmez (app SELECT/INSERT/UPDATE/DELETE zaten var). Tetikleyici / saklı yordam YOK → toplam 23 kalır.
--
-- ELLE EKLENDİ (dba): Prisma CHECK üretmez. Prisma'nın ürettiği kısımlar (2 ADD COLUMN + UNIQUE INDEX) `migrate diff` çıktısıyla
-- aynı ad/tipte; CHECK'lerle TEK ALTER'da birleştirildi (ayrı ALTER'lar ayrı yeniden yazım olurdu). Sonrasında
-- `migrate diff --exit-code` = 0.
-- Mimariye ek: download_token_hash_chk (küçük harf hex, code_hash_chk kalıbı) — düz belirteç yazılamasın.
--
-- Kilit (MySQL 8.4): CHECK eklemek COPY gerektirir → tablo yeniden yazılır, süresince kod üretimi/tüketimi bekler. Tablo küçük
-- (bekleyen kodlar ≤ 24 sa + gece temizliği 7 g); ön kontrol gerekmez (yeni sütunlar NULL / 0 → CHECK'leri geçer).
-- Geri alma: down.sql (elle; Prisma çalıştırmaz).
ALTER TABLE `unattended_registration_codes`
    ADD COLUMN `download_token_hash` CHAR(64) NULL,
    ADD COLUMN `sent_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ADD UNIQUE INDEX `unattended_registration_codes_download_token_hash_key`(`download_token_hash`),
    -- ELLE: yalnız SHA-256 hex (küçük harf).
    ADD CONSTRAINT `unattended_registration_codes_download_token_hash_chk`
        CHECK (`download_token_hash` IS NULL OR REGEXP_LIKE(`download_token_hash`, '^[0-9a-f]{64}\\z', 'c')),
    -- ELLE (§7 K2): kod başına en çok 3 gönderim.
    ADD CONSTRAINT `unattended_registration_codes_sent_count_chk` CHECK (`sent_count` BETWEEN 0 AND 3);
