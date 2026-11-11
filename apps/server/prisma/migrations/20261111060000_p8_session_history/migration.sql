-- P8 (mimari §3.1 support_sessions, §10.2 P8, mimari-api GET/PATCH /sessions + export.csv; AC-60..63, 124):
-- oturum geçmişi alanları + liste indeksi. Expand migration: yalnız NULL'lanabilir sütun + ikincil indeks;
-- mevcut satırlar NULL kalır (P8 öncesi oturumların müşteri adı DB'de yoktu — yalnız audit `guest.admitted`
-- new_value.name'de; geri doldurma yapılmaz, UI "—" gösterir; docs/db-notlari.md P8 karar 3).
-- `anonymized_at` bu pakette EKLENMEZ: retention/anonimleştirme işiyle (P13) kendi migration'ında gelir.
--
-- Kilitleme notu (MySQL 8.4):
--  * ADD COLUMN (NULL, varsayılansız; TEXT dahil) → ALGORITHM=INSTANT (yalnız metadata).
--  * CREATE INDEX → ALGORITHM=INPLACE, LOCK=NONE (eşzamanlı DML serbest; sonda kısa metadata kilidi).
--  * ADD CHECK → ALGORITHM=COPY (tablo yeniden yazılır, süresince yazma bekler). support_sessions küçük
--    (3 yılda ~250k satır öngörüsü, mimari §7; staging'de yüzlerce) ve prod henüz açık değil (P10) → kabul.
--    Büyük tabloda: CHECK'ler ayrı, bakım penceresinde uygulanır.
--  Yeni sütunlar NULL olduğundan CHECK'ler mevcut veride ihlal üretmez.

-- AlterTable
ALTER TABLE `support_sessions` ADD COLUMN `customer_email` VARCHAR(190) NULL,
    ADD COLUMN `customer_name` VARCHAR(100) NULL,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `ticket_no` VARCHAR(50) NULL;

-- CreateIndex
-- Mimari §3.1 "IX(tenant_id, status)" yerine (tenant_id, status, created_at): durum filtresi + created_at DESC
-- sırası/tarih aralığı aynı indeksten (filesort yok). İkincil indeks PK'yı (id) içerir → ORDER BY created_at
-- DESC, id DESC geri tarama ile karşılanır. Sapma notu: mimari §3.1 "dba notu (P8)".
CREATE INDEX `support_sessions_tenant_id_status_created_at_idx` ON `support_sessions`(`tenant_id`, `status`, `created_at`);

-- CreateIndex
-- Super Admin, firma seçmeden tüm tenant'ları listeler (mimari-api "Oturum geçmişi (P8)" §2, §6): created_at DESC
-- geri tarama. P13 retention (created_at eşiği) de kullanır.
CREATE INDEX `support_sessions_created_at_idx` ON `support_sessions`(`created_at`);

-- CreateIndex
-- Detay zaman çizelgesi (mimari-api §3): audit_logs WHERE tenant_id=? AND entity='support_sessions' AND entity_id=?
-- AND action IN (...) ORDER BY created_at, id. INPLACE/LOCK=NONE: audit_logs en hızlı büyüyen tablo, eşzamanlı
-- INSERT'leri bloklamaz (sonda kısa metadata kilidi).
CREATE INDEX `audit_logs_tenant_id_entity_entity_id_created_at_idx` ON `audit_logs`(`tenant_id`, `entity`, `entity_id`, `created_at`);


-- ELLE EKLENDİ (dba): CHECK kısıtları. Prisma CHECK ifade edemez, MySQL drift'inde karşılaştırılmaz.
-- zod/servis kurallarının (mimari-api join customerName 2..100, PATCH ticketNo ≤50, note ≤4000) DB'deki
-- ikinci emniyetidir; değiştirirken packages/contracts şemasıyla birlikte güncelleyin.
-- Not 1: CHECK ifadesi NULL dönerse geçer; NULL olabilen sütunlar `IS NULL OR …` ile yazıldı.
-- Not 2: utf8mb4_unicode_ci PAD SPACE'tir ('a ' = 'a'); kırpılmışlık bu yüzden `x = TRIM(x)` ile değil
--        CHAR_LENGTH karşılaştırmasıyla denetlenir.
-- Not 3: boş metin saklanmaz — temizlemek (PATCH ticketNo:"" / note:"") NULL yazmaktır (servis "" → null).
ALTER TABLE `support_sessions`
    -- Misafir adı (join: trim sonrası 2..100, Unicode Cc/Cf yok — kontrol, bidi, sıfır genişlik).
    ADD CONSTRAINT `support_sessions_customer_name_chk` CHECK (
        `customer_name` IS NULL
        OR (CHAR_LENGTH(`customer_name`) BETWEEN 2 AND 100
            AND CHAR_LENGTH(`customer_name`) = CHAR_LENGTH(TRIM(`customer_name`))
            AND NOT REGEXP_LIKE(`customer_name`, '[\\p{Cc}\\p{Cf}]', 'c'))),
    -- E-posta yalnız biçim iskeleti (tam doğrulama zod `email`); tek '@', boşluk/kontrol karakteri yok.
    ADD CONSTRAINT `support_sessions_customer_email_chk` CHECK (
        `customer_email` IS NULL
        OR (REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c')
            AND `customer_name` IS NOT NULL)),
    -- Müşteri bilgisi yalnız admit edilmiş (tüketilmiş) oturumda: admit UPDATE'i ikisini birlikte yazar.
    ADD CONSTRAINT `support_sessions_customer_consumed_chk` CHECK (`customer_name` IS NULL OR `consumed_at` IS NOT NULL),
    -- Ticket no (AC-63, mimari-api P8 §4 UNSAFE_NAME_CHARS): 1..50, kırpılmış, Cc/Cf/Zl/Zp yok (tek satır).
    ADD CONSTRAINT `support_sessions_ticket_no_chk` CHECK (
        `ticket_no` IS NULL
        OR (CHAR_LENGTH(`ticket_no`) BETWEEN 1 AND 50
            AND CHAR_LENGTH(`ticket_no`) = CHAR_LENGTH(TRIM(`ticket_no`))
            AND NOT REGEXP_LIKE(`ticket_no`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    -- Not (AC-63, mimari-api P8 §4): 1..4000 karakter (TEXT 65.535 bayt; 4000 × 4 B sığar). Yalnız \n ve \t
    -- serbest; diğer Cc (\r dahil, U+007F–U+009F) ve Cf (bidi, sıfır genişlik) yasak.
    ADD CONSTRAINT `support_sessions_note_chk` CHECK (
        `note` IS NULL
        OR (CHAR_LENGTH(`note`) BETWEEN 1 AND 4000
            AND NOT REGEXP_LIKE(`note`, '[\\x{00}-\\x{08}\\x{0B}-\\x{1F}\\x{7F}-\\x{9F}\\p{Cf}]', 'c')));
