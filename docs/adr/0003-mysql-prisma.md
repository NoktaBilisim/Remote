# ADR-0003 — MySQL 8 + Prisma; MySQL ayar ekranının anlamı

Durum: Kabul · Tarih: 2026-11-10

## Bağlam

V1 / ortak standart 1.2: tek MySQL, tenant_id ile ayrım; panelde MySQL ayar + test ekranı zorunlu. Uygulamanın kendi DB bağlantısı panelden okunursa "tavuk-yumurta" sorunu var.

## Karar

- Prisma (MySQL provider), migration `prisma migrate`; audit tetikleyicileri raw SQL migration.
- Uygulama açılışta `DATABASE_URL` (env) kullanır. Panel ekranı: değerleri girer, **Bağlantıyı Test Et** (`mysql2`, 10 sn timeout) çalıştırır, şifreyi AES-256-GCM ile `system_settings`'e yazar ve "Uygulamak için yeniden başlatma gerekir" uyarısı gösterir. Uygulama başlangıcında `DATABASE_URL` yoksa `system_settings` okunamaz → env zorunlu. Devops runbook'u: panel değerini `.env`'e aktarma adımı.
- ID: ULID `CHAR(26)`; audit `BIGINT AUTO_INCREMENT`.

## Alternatifler

Drizzle (daha hafif ama ekip Prisma biliyor); panelden canlı DB değiştirme (riskli: yarım bağlantı, migration uyumsuzluğu).

## Sonuçlar

Ekran standarda uyar; canlı geçiş yok (bilinçli). Ölçüm: AC-77, AC-78.

- r2 (G-15): iki DB kullanıcısı — `migrator` (DDL + TRIGGER; yalnız tek seferlik `migrate` compose servisi, `MIGRATE_DATABASE_URL`) ve `app` (DML; `audit_logs` için yalnız INSERT/SELECT/DELETE, DELETE tetikleyiciyle 730 gün sınırlı). Server konteyneri migrator kimliğini görmez → uygulama ele geçirilse de audit tetikleyicisi düşürülemez (AC-123). Panel MySQL ekranı `app` bağlantısını test eder.
