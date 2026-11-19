-- P22-D oturum sohbeti veri modeli (docs/mimari-p22.md §3.1, §15.3; ADR-0025 r-P22; AC-264). Ayrıntı: docs/db-notlari.md "P22".
-- TEK DEĞİŞİKLİK: session_messages += UQ `session_messages_session_client_key` (session_id, sender, client_msg_id) — oturum
-- mesajında yeniden gönderimde çift kayıt yok. Talep satırlarında session_id NULL → UQ çakışmaz (talep satırları etkilenmez).
-- Tablo / sütun / CHECK / FK / tetikleyici / grants DEĞİŞMEZ: tetikleyici toplamı 23 (audit-continuity özeti, backup.sh
-- REMOTE_EXPECTED_TRIGGERS ve check-app-grants.sh sayıları aynı); prisma/sql/grants.sql'de değişiklik yok. Veri taşıma YOK.
--
-- ELLE YAZILDI (dba): Prisma ön kontrol yordamı ve ALGORITHM/LOCK yan tümcesi üretmez. Prisma'nın ürettiği `CREATE UNIQUE INDEX`
-- aynı ad/sütun sırasıyla ALTER biçimine çevrildi (kilit yan tümcesi için); sonrasında `migrate diff --exit-code` = 0.
--
-- Kilit (MySQL 8.4): ikincil UNIQUE indeks → ALGORITHM=INPLACE, LOCK=NONE (çevrimiçi; eşzamanlı DML sürer, yalnız başta/sonda
-- kısa metadata kilidi). MySQL bu kipi veremezse hata verir, sessizce COPY'ye düşmez.
--
-- ÖN KONTROL (P15/P18 kalıbı): aynı (session_id, sender, client_msg_id) çifti varsa UQ 1062 ile yarıda kalırdı →
-- `P22_PRECHECK dup_session_client=<n>` (n = çift grup sayısı). P22 öncesi oturum satırı yazılmadığından 0 beklenir. NULL
-- session_id/client_msg_id UQ'da çakışmaz → sayılmaz. Düzeltme: db-notlari "P22"; sonra
-- `prisma migrate resolve --rolled-back 20261126000000_p22_session_chat` + `pnpm db:migrate`.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz) — yalnız UQ DROP, veri silmez.
DROP PROCEDURE IF EXISTS `p22_precheck`;
CREATE PROCEDURE `p22_precheck`()
    READS SQL DATA
BEGIN
    DECLARE v_dup BIGINT;
    DECLARE v_msg VARCHAR(128);
    SELECT COUNT(*) INTO v_dup FROM (
        SELECT 1 FROM `session_messages`
         WHERE `session_id` IS NOT NULL AND `client_msg_id` IS NOT NULL
         GROUP BY `session_id`, `sender`, `client_msg_id`
        HAVING COUNT(*) > 1) d;
    IF v_dup > 0 THEN
        SET v_msg = CONCAT('P22_PRECHECK dup_session_client=', v_dup);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END;
CALL `p22_precheck`();
DROP PROCEDURE `p22_precheck`;

-- 1) session_messages (§3.1, AC-264). PRISMA ÜRETTİ (UQ) + ALGORITHM/LOCK ELLE.
ALTER TABLE `session_messages`
    ADD UNIQUE INDEX `session_messages_session_client_key`(`session_id`, `sender`, `client_msg_id`),
    ALGORITHM=INPLACE, LOCK=NONE;
