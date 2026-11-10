-- app DB kullanıcısının tablo bazlı yetkileri (G-15, AC-123, mimari §3.3).
-- Çalıştıran: `migrate` servisi, migrator kullanıcısıyla, `prisma migrate deploy`dan HEMEN SONRA:
--   prisma db execute --file prisma/sql/grants.sql   (pnpm db:migrate ikisini sırayla yapar)
-- Tablo adları nitelenmemiştir: bağlantı URL'sindeki veritabanına uygulanır.
-- İdempotent: GRANT tekrar çalıştırılabilir; REVOKE IF EXISTS (MySQL >= 8.0.30) yoksa uyarı verir.
-- KURAL: Yeni tablo ekleyen her migration bu dosyaya kendi GRANT satırını ekler
-- (MySQL tablo düzeyinde var olmayan tabloya CREATE'siz yetki verilemez; DB düzeyi `app.*`
-- yetkisi bilinçli olarak yok, çünkü audit_logs'tan UPDATE tablo düzeyinde düşürülemez).

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants          TO 'app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings  TO 'app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON users            TO 'app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON user_permissions TO 'app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions    TO 'app'@'%';

-- P2: oturumlar hard delete edilmez (iptal/expiry = UPDATE status). DELETE yetkisi retention
-- işiyle (P13, mimari §3.4: anonimleştirme +30 gün hard delete) birlikte verilir.
GRANT SELECT, INSERT, UPDATE ON support_sessions TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON support_sessions FROM 'app'@'%';

-- Append-only: yalnız SELECT/INSERT. DELETE yetkisi retention/tetikleyiciyle birlikte (P11/P13)
-- verilecek; o pakette bu dosya güncellenir. UPDATE/DELETE/DDL/TRIGGER yetkisi varsa geri alınır.
GRANT SELECT, INSERT ON audit_logs TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON audit_logs FROM 'app'@'%';

-- /ready: uygulanmış son migration sürümünü okur (yalnız okuma).
GRANT SELECT ON _prisma_migrations TO 'app'@'%';
