-- GERİ ALMA (elle, dba) — 20261111050000_p7_consent_source_tech. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- session_consents_source_chk'i P4 kümesine (UI/HOTKEY/RECONNECT/SYSTEM) daraltır. Tablo/veri silinmez.
-- Uyarı: source='TECH' satırı VARSA ALTER CHECK ihlaliyle (3819) başarısız olur ve hiçbir şey değişmez
-- (tek ALTER, atomik). Bu satırlar KVKK onay zaman çizelgesidir (yasal kanıt): SİLMEYİN / SYSTEM'e ÇEVİRMEYİN
-- (aktörü yanlış gösterir — ADR-0013). TECH satırı oluştuktan sonra geri alma yerine ileri düzeltme yapın.
-- Ön kontrol: SELECT COUNT(*) FROM `session_consents` WHERE `source` = 'TECH';   -- 0 olmalı
-- Sonraki (P8+) migration'lar uygulanmışsa önce onların down.sql'i çalıştırılmalıdır (ters sıra). P7 kodu
-- (control.release/cancel → TECH yazan) önce geri alınmalıdır; aksi halde kayıtlar CHECK ile reddedilir.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111050000_p7_consent_source_tech/down.sql
-- grants.sql değişmedi (yeni tablo yok).

ALTER TABLE `session_consents`
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_source_chk` CHECK (`source` IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM'));

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111050000_p7_consent_source_tech';
