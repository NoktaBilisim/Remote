-- GERİ ALMA (elle, dba) — 20261111040000_p5_session_files. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: session_files tablosunu VE VERİSİNİ (dosya transferi meta kayıtları — AC-55 iz kaydı) ve
-- support_sessions.quality_summary sütununu siler. Audit kayıtları (file.* olayları) kalır. Önce yedek alın
-- (docs/db-notlari.md "Geri alma", docs/runbook.md). Sonraki (P6+) migration'lar uygulanmışsa önce onların
-- down.sql'i çalıştırılmalıdır (ters sıra). P5 kodu da geri alınmalıdır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111040000_p5_session_files/down.sql
-- grants.sql'deki P5 satırları tablo yokken hata verir: geri almadan sonra o satırları da geri alın.

DROP TABLE IF EXISTS `session_files`;

-- DropCheck (sütun düşmeden önce; MySQL sütuna bağlı CHECK varken DROP COLUMN'ı reddeder)
ALTER TABLE `support_sessions` DROP CHECK `support_sessions_quality_summary_chk`;

-- AlterTable
ALTER TABLE `support_sessions` DROP COLUMN `quality_summary`;

-- support_sessions_id_tenant_id_key (bileşik FK hedefi) P4'e aittir, burada DÜŞÜRÜLMEZ.

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111040000_p5_session_files';
