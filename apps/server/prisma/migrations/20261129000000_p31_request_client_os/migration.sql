-- P31-D talep istemcisinin işletim sistemi (docs/mimari-p31.md §5, §15 S-P31-7, K-P31-4; docs/gereksinimler.md §14 AC-511).
-- Ayrıntı ve gerekçeler: docs/db-notlari.md "P31". Veri taşıma YOK: eski talepler client_os NULL (= windows; eski istemci
-- ve Windows gövdesi alanı göndermez) → mevcut satırlar yeni CHECK'leri olduğu gibi geçer (WEB satırları zaten NULL).
-- Yeni tablo YOK → grants.sql'de yeni GRANT yok (support_requests tablo düzeyi INSERT/UPDATE P8b-1'den; yalnız açıklayıcı
-- yorum). Tetikleyici YOK → toplam 23, audit-continuity.sql özet sabiti değişmez. İndeks YOK (sütun filtrelenmez, §5).
--
-- ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Sütun `migrate diff` çıktısıyla aynı ad/tipte
-- (`ADD COLUMN client_os VARCHAR(10) NULL`); sonrasında `migrate diff --exit-code` = 0. CHECK'ler:
--  * client_os_chk: ikili enum (ADR-0014; CAST AS BINARY). SAPMA (sıkılaştırma, db-notlari "P31"): mimari §5 düz
--    `IN ('windows','macos')` yazıyor; tablo harmanlamasında düz IN 'MACOS' ve 'macos ' değerlerini KABUL ediyor (test DB'de
--    ölçüldü) → kanonik olmayan değer DB'ye girerdi. Tam küçük harf zorunlu; Linux talebi gelirse ileri migration (S-P31-7).
--  * source_client_os_chk: WEB talebinde client_os NULL (K-P31-4). source kendi ikili CHECK'iyle (source_chk) kanonik →
--    burada CAST gerekmez.
--
-- Kilit (MySQL 8.4): ADD CHECK INPLACE/INSTANT desteklenmez (P19/P29'da ölçüldü: 1845) → sütun + 2 CHECK TEK COPY ALTER
-- (tek yeniden yazım, kısıtsız ara an yok). support_requests retention'lı ve küçük (deploy öncesi `SELECT COUNT(*) FROM
-- support_requests`); süresince talep INSERT/UPDATE'i bekler. Migrate, server'dan önce `migrate` servisinde çalışır.
-- Tetikleyiciler (support_requests_update_guard / delete_guard) COPY ALTER'da korunur.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz).

ALTER TABLE `support_requests`
    ADD COLUMN `client_os` VARCHAR(10) NULL,
    ADD CONSTRAINT `support_requests_client_os_chk` CHECK (`client_os` IS NULL
        OR CAST(`client_os` AS BINARY) IN ('windows', 'macos')),
    ADD CONSTRAINT `support_requests_source_client_os_chk` CHECK (`source` <> 'WEB' OR `client_os` IS NULL),
    ALGORITHM=COPY;
