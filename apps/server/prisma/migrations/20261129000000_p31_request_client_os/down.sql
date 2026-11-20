-- GERİ ALMA (elle, dba) — 20261129000000_p31_request_client_os. Prisma bu dosyayı ÇALIŞTIRMAZ. Asıl geri alma önceki
-- server imajıdır (mimari-p31 §5): sütun NULL'lanabilir, eski kod okumaz → şema genelde kalabilir (expand). Şema geri
-- alınacaksa önce P31 sunucu kodu (B1) geri alınır, sonra (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261129000000_p31_request_client_os/down.sql
-- Guard YOK (mimari §5: yalnız DROP CHECK + DROP COLUMN). Kalıcı kayıp (bilinçli): support_requests.client_os. Kapanmış
-- taleplerde yalnız geçmiş bilgisi (kopyası audit `request.create` newValue.clientOs'ta). BEKLEYEN (PENDING) bir macOS
-- talebi kabul edilirse misafir `windows` sayılır → yalnız OS_PERMISSION metni/linux kuralları etkilenir, yetki vermez
-- (T-P31-5). Gerekirse önce kontrol: SELECT COUNT(*) FROM support_requests WHERE status='PENDING' AND client_os='macos';
-- Kilit: CHECK DROP + sütun DROP tek ALTER (tek yeniden yazım; tablo küçük).
ALTER TABLE `support_requests`
    DROP CHECK `support_requests_client_os_chk`,
    DROP CHECK `support_requests_source_client_os_chk`,
    DROP COLUMN `client_os`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261129000000_p31_request_client_os';
