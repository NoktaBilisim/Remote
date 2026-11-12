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

-- P4 consent_texts: değişmez, sürümlü (yeni sürüm = INSERT). app SELECT/INSERT (seed v1 + P11 düzenleme).
-- is_current geçişi için sütun düzeyi UPDATE(is_current, updated_at) aşağıda (P8b-1'de öne alındı);
-- body/sha256/version hiçbir zaman güncellenemez. DELETE yok (retention: tenant silinmez, metin kalır).
GRANT SELECT, INSERT ON consent_texts TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON consent_texts FROM 'app'@'%';
-- P8b-1 (mimari-e9 §3.6): seed yeni aydınlatma sürümü ekler → eski sürümün is_current'ı 0 yapılmalı. Sütun düzeyi
-- UPDATE(is_current, updated_at) P11'den P8b-1'e ÖNE ALINDI (yalnız bu iki sütun; body/sha256/version güncellenemez).
-- Tenant başına tek güncel sürüm fonksiyonel UQ (consent_texts_one_current_uq) ile korunur. Bu GRANT yukarıdaki
-- tablo düzeyi REVOKE'tan SONRA gelmeli (sıra korunursa dosya idempotent).
GRANT UPDATE (is_current, updated_at) ON consent_texts TO 'app'@'%';

-- P4 session_consents: append-only onay zaman çizelgesi (AC-29/62/111). UPDATE (anonimleştirme) ve
-- DELETE (+30 gün hard delete) retention işiyle P13'te verilir.
GRANT SELECT, INSERT ON session_consents TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON session_consents FROM 'app'@'%';

-- P5 session_files: append-only dosya transferi meta kaydı (AC-55; içerik yok). UPDATE (file_name
-- anonimleştirme) ve DELETE (+30 gün hard delete) retention işiyle P13'te verilir.
-- support_sessions.quality_summary için ek yetki gerekmez (tablo düzeyi UPDATE P2'den beri var).
GRANT SELECT, INSERT ON session_files TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON session_files FROM 'app'@'%';

-- P8b-1 tenant_request_settings (mimari-e9 §3.1): tembel INSERT, ayar/ref yenileme UPDATE. Silme yok (tenant silinmez).
GRANT SELECT, INSERT, UPDATE ON tenant_request_settings TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON tenant_request_settings FROM 'app'@'%';

-- P8b-1 support_requests (mimari-e9 §3.2/§3.6): durum geçişleri ve anonimleştirme UPDATE'tir. DELETE (hard delete)
-- retention işiyle P13'te verilir (önce oturum, sonra talep — FK RESTRICT).
GRANT SELECT, INSERT, UPDATE ON support_requests TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON support_requests FROM 'app'@'%';

-- P8c-1 customers (mimari-e10 §3.1, §3.8): oluşturma/düzenleme/pasif/anonimleştirme UPDATE'tir; hard delete yok (V23).
GRANT SELECT, INSERT, UPDATE ON customers TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON customers FROM 'app'@'%';
-- P8c-1 request_refs: append-only ref ad alanı (ADR-0006 r5) — emekli ref asla silinmez/güncellenmez.
GRANT SELECT, INSERT ON request_refs TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON request_refs FROM 'app'@'%';
-- P8c-1 device_bindings: verme/yenileme/geçersizleştirme UPDATE'tir; DELETE (hard delete) P13 retention ile.
GRANT SELECT, INSERT, UPDATE ON device_bindings TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON device_bindings FROM 'app'@'%';

-- P10 recovery_codes (mimari §3.1, AC-67): üretim INSERT; kullanım yalnız used_at (sütun düzeyi UPDATE); yeniden üretim
-- ve MFA sıfırlama DELETE (kod gizlidir, geçmiş değeri yok; iz audit'te). code_hash/user_id hiçbir zaman güncellenemez.
-- Sütun GRANT'ı tablo düzeyi REVOKE'tan SONRA gelmeli (sıra korunursa dosya idempotent; consent_texts kalıbı).
GRANT SELECT, INSERT, DELETE ON recovery_codes TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON recovery_codes FROM 'app'@'%';
GRANT UPDATE (used_at, updated_at) ON recovery_codes TO 'app'@'%';
-- P10 password_reset_tokens (mimari §3.1, AC-66): istek INSERT; kullanım/geçersizleştirme yalnız used_at. token_hash,
-- expires_at, user_id güncellenemez (süre uzatılamaz). DELETE (expires_at + 7 gün hard delete) retention işiyle P13'te.
GRANT SELECT, INSERT ON password_reset_tokens TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON password_reset_tokens FROM 'app'@'%';
GRANT UPDATE (used_at, updated_at) ON password_reset_tokens TO 'app'@'%';

-- P11 system_settings (mimari §3.1; AC-77, 78): yalnız Super Admin ucu yazar; kayıt yoksa ilk kayıt INSERT, sonra UPDATE.
-- DELETE yok (ayar "kaldırma" = alanları boşaltan UPDATE ya da varsayılana dönüş; satır kalır, iz audit'te).
GRANT SELECT, INSERT, UPDATE ON system_settings TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON system_settings FROM 'app'@'%';

-- Append-only: yalnız SELECT/INSERT. P11'de DB tetikleyicileri kuruldu (audit_logs_no_update: her UPDATE → SIGNAL;
-- audit_logs_retention_only_delete: 730 günden yeni satır DELETE → SIGNAL) ama DELETE yetkisi BİLEREK verilmedi:
-- en az yetki — silen tek iş retention (P13); yetki o pakette bu dosyaya eklenir (tetikleyici yine sınırlar).
-- UPDATE/DELETE/DDL/TRIGGER yetkisi varsa geri alınır.
GRANT SELECT, INSERT ON audit_logs TO 'app'@'%';
REVOKE IF EXISTS UPDATE, DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON audit_logs FROM 'app'@'%';

-- /ready: uygulanmış son migration sürümünü okur (yalnız okuma).
GRANT SELECT ON _prisma_migrations TO 'app'@'%';
