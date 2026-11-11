-- GERİ ALMA (elle, dba) — 20261111030000_p4_consents. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: consent_texts ve session_consents tablolarını VE VERİSİNİ siler (KVKK onay kayıtları — yasal
-- kanıt). Önce yedek alın (docs/db-notlari.md "Geri alma", docs/runbook.md). Sonraki (P5+) migration'lar
-- uygulanmışsa önce onların down.sql'i çalıştırılmalıdır (ters sıra). P4 kodu da geri alınmalıdır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111030000_p4_consents/down.sql
-- grants.sql'deki P4 satırları tablolar yokken hata verir: geri almadan sonra o satırları da geri alın.

-- Çocuk tablo önce (FK: session_consents -> consent_texts, support_sessions, tenants).
DROP TABLE IF EXISTS `session_consents`;
DROP TABLE IF EXISTS `consent_texts`;

-- session_consents bileşik FK hedefi; artık referans yok.
DROP INDEX `support_sessions_id_tenant_id_key` ON `support_sessions`;

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111030000_p4_consents';
