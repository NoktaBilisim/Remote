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

-- P2: oturumlar hard delete edilmez (iptal/expiry = UPDATE status; P13a anonimleştirme = UPDATE). DELETE YOK:
-- K-P13-1/K27 hard delete ertelendi (FK döngüsü; anonimleştirme KVKK imha yöntemi). Genişleme: purgeAnonymized().
-- P16 (ADR-0030 m.3, AC-240/242): DELETE eklendi; koşul tetikleyicide (support_sessions_delete_guard: anonim + 30 g
-- ya da RUNNING firma silme işi).
GRANT SELECT, INSERT, UPDATE, DELETE ON support_sessions TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON support_sessions FROM 'app'@'%';

-- P4 consent_texts: değişmez, sürümlü (yeni sürüm = INSERT). app SELECT/INSERT (seed v1 + P11 düzenleme).
-- is_current geçişi için sütun düzeyi UPDATE(is_current, updated_at) aşağıda (P8b-1'de öne alındı);
-- body/sha256/version hiçbir zaman güncellenemez. DELETE yok (retention: tenant silinmez, metin kalır).
-- P16: DELETE yalnız RUNNING firma silme işinde (consent_texts_delete_guard).
GRANT SELECT, INSERT, DELETE ON consent_texts TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON consent_texts FROM 'app'@'%';
-- P8b-1 (mimari-e9 §3.6): seed yeni aydınlatma sürümü ekler → eski sürümün is_current'ı 0 yapılmalı. Sütun düzeyi
-- UPDATE(is_current, updated_at) P11'den P8b-1'e ÖNE ALINDI (yalnız bu iki sütun; body/sha256/version güncellenemez).
-- Tenant başına tek güncel sürüm fonksiyonel UQ (consent_texts_one_current_uq) ile korunur. Bu GRANT yukarıdaki
-- tablo düzeyi REVOKE'tan SONRA gelmeli (sıra korunursa dosya idempotent).
GRANT UPDATE (is_current, updated_at) ON consent_texts TO 'app'@'%';

-- P4 session_consents: append-only onay zaman çizelgesi (AC-29/62/111). DELETE YOK (K-P13-1/K27).
-- P13a (AC-197): anonimleştirme yalnız sütun düzeyi UPDATE(ip, user_agent) → karar/seviye/kaynak/metin sürümü/özeti
-- (KVKK onay kanıtı) değiştirilemez. Tabloda updated_at yok. Sütun GRANT'ı tablo düzeyi REVOKE'tan SONRA.
-- P16: DELETE — üst oturum anonim + 30 g ya da RUNNING firma silme işi (session_consents_delete_guard).
GRANT SELECT, INSERT, DELETE ON session_consents TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON session_consents FROM 'app'@'%';
GRANT UPDATE (ip, user_agent) ON session_consents TO 'app'@'%';

-- P5 session_files: append-only dosya transferi meta kaydı (AC-55; içerik yok). UPDATE YOK.
-- P13a (K-P13-2, AC-197): oturum anonimleştirilirken satır SİLİNİR (file_name CHECK'i `***`'a izin vermez; sha256
-- de tanımlayıcı) → DELETE. support_sessions.quality_summary için ek yetki gerekmez (tablo düzeyi UPDATE P2'den).
GRANT SELECT, INSERT, DELETE ON session_files TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON session_files FROM 'app'@'%';

-- P8b-1 tenant_request_settings (mimari-e9 §3.1): tembel INSERT, ayar/ref yenileme UPDATE. Silme yok (tenant silinmez).
-- P16: DELETE yalnız RUNNING firma silme işinde (tenant_request_settings_delete_guard).
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_request_settings TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON tenant_request_settings FROM 'app'@'%';

-- P8b-1 support_requests (mimari-e9 §3.2/§3.6): durum geçişleri ve anonimleştirme UPDATE'tir. DELETE YOK
-- (K-P13-1/K27: hard delete ertelendi; genişleme noktası purgeAnonymized(), grant o pakette eklenir).
-- P16: DELETE — anonim + 30 g ya da RUNNING firma silme işi (support_requests_delete_guard).
GRANT SELECT, INSERT, UPDATE, DELETE ON support_requests TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON support_requests FROM 'app'@'%';

-- P8c-1 customers (mimari-e10 §3.1, §3.8): oluşturma/düzenleme/pasif/anonimleştirme UPDATE'tir; hard delete yok (V23).
-- P16: DELETE yalnız RUNNING firma silme işinde (customers_delete_guard).
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON customers FROM 'app'@'%';
-- P8c-1 request_refs: append-only ref ad alanı (ADR-0006 r5) — emekli ref asla silinmez/güncellenmez.
-- P16: DELETE yalnız RUNNING firma silme işinde (request_refs_delete_guard; gece işi silmez — tek ad alanı).
GRANT SELECT, INSERT, DELETE ON request_refs TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON request_refs FROM 'app'@'%';
-- P8c-1 device_bindings: verme/yenileme/geçersizleştirme/EXPIRED UPDATE'tir; DELETE YOK (K-P13-1/K27).
-- P16: DELETE — revoked_at + 30 g ya da RUNNING firma silme işi (device_bindings_delete_guard).
GRANT SELECT, INSERT, UPDATE, DELETE ON device_bindings TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON device_bindings FROM 'app'@'%';

-- P10 recovery_codes (mimari §3.1, AC-67): üretim INSERT; kullanım yalnız used_at (sütun düzeyi UPDATE); yeniden üretim
-- ve MFA sıfırlama DELETE (kod gizlidir, geçmiş değeri yok; iz audit'te). code_hash/user_id hiçbir zaman güncellenemez.
-- Sütun GRANT'ı tablo düzeyi REVOKE'tan SONRA gelmeli (sıra korunursa dosya idempotent; consent_texts kalıbı).
GRANT SELECT, INSERT, DELETE ON recovery_codes TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON recovery_codes FROM 'app'@'%';
GRANT UPDATE (used_at, updated_at) ON recovery_codes TO 'app'@'%';
-- P10 password_reset_tokens (mimari §3.1, AC-66): istek INSERT; kullanım/geçersizleştirme yalnız used_at. token_hash,
-- expires_at, user_id güncellenemez (süre uzatılamaz). P13a (AC-198): expires_at + 7 gün hard delete → DELETE.
GRANT SELECT, INSERT, DELETE ON password_reset_tokens TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON password_reset_tokens FROM 'app'@'%';
GRANT UPDATE (used_at, updated_at) ON password_reset_tokens TO 'app'@'%';

-- P11 system_settings (mimari §3.1; AC-77, 78): yalnız Super Admin ucu yazar; kayıt yoksa ilk kayıt INSERT, sonra UPDATE.
-- DELETE yok (ayar "kaldırma" = alanları boşaltan UPDATE ya da varsayılana dönüş; satır kalır, iz audit'te).
GRANT SELECT, INSERT, UPDATE ON system_settings TO 'app'@'%';
REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON system_settings FROM 'app'@'%';

-- Append-only: SELECT/INSERT + P13a (AC-198) retention DELETE. Üç tetikleyici sınırlar: audit_logs_no_update (her
-- UPDATE → SIGNAL), audit_logs_retention_only_delete (730 günden yeni satır DELETE → SIGNAL, SYSDATE/UTC),
-- audit_logs_force_created_at (P13a: app'in yazdığı created_at DB saatine zorlanır → geriye tarihli ekle-sil yok).
-- DELETE yetkisi tetikleyiciyle AYNI pakette (K-P13-4). UPDATE/DDL/TRIGGER yetkisi varsa geri alınır.
GRANT SELECT, INSERT, DELETE ON audit_logs TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON audit_logs FROM 'app'@'%';

-- /ready: uygulanmış son migration sürümünü okur (yalnız okuma).
GRANT SELECT ON _prisma_migrations TO 'app'@'%';

-- P15 request_blocks (mimari-e11 §6; AC-235): engel ekleme INSERT, kaldırma ve süresi dolanın temizliği DELETE. UPDATE YOK:
-- engel satırı değişmez (süre değişimi = aynı TX'te DELETE + INSERT; iz audit'te) → hedef/süre sessizce değiştirilemez.
GRANT SELECT, INSERT, DELETE ON request_blocks TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON request_blocks FROM 'app'@'%';

-- P16 tenant_purge_jobs (ADR-0030 m.5, AC-242): iş açma INSERT, ilerleme/iptal UPDATE, 730 g sonra DELETE. Bütün koşullar
-- tetikleyicide (insert/update/delete_guard): yalnız SCHEDULED açılır (+24 sa DB saati), izinli geçişler, DONE/CANCELLED +
-- 730 g silme. DDL/TRIGGER yetkisi yok.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_purge_jobs TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON tenant_purge_jobs FROM 'app'@'%';

-- P18 session_messages (mimari-e11 §8b.1, ADR-0025; AC-255): append-only talep/oturum mesajları. INSERT (gönderim), DELETE
-- (retention: üst talep anonimleşince aynı TX; firma silme MESSAGES adımı — koşul session_messages_delete_guard'da).
-- UPDATE YOK (gövde değişmez). S-P18-T2: anahtar sızıntısında yeniden şifreleme (`crypto:rewrap`) migrator ile yapılır
-- (migrator'ın DB yetkisi zaten var; tabloda UPDATE tetikleyicisi yok) — app'e UPDATE verilmez.
GRANT SELECT, INSERT, DELETE ON session_messages TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON session_messages FROM 'app'@'%';

-- P18 business_holidays (§8b.1; AC-258): ekle INSERT, kaldır DELETE; değişiklik = DELETE + INSERT (request_blocks kalıbı).
-- Firma silmede SETTINGS adımında silinir (tetikleyicisiz; satır firma ayarıdır, kişisel veri yok).
GRANT SELECT, INSERT, DELETE ON business_holidays TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON business_holidays FROM 'app'@'%';

-- P19 notification_outbox (mimari-e11 §8c.1, §8c.3; AC-261; S-P19-12): müşteri durum bildirimi kuyruğu. INSERT (kuyruğa alma,
-- talep durum geçişi TX'i), UPDATE (işçi: PENDING → SENDING → SENT/FAILED, kurtarma, son durumda recipient_enc NULL), DELETE
-- (7 gün temizlik, anonimleştirme aynı TX, firma silme MESSAGES adımı). Tetikleyici yok; kurallar CHECK'lerde. DDL yok.
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_outbox TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON notification_outbox FROM 'app'@'%';

-- P27a trusted_devices (mimari-p27a §3.1/§3.3; AC-325..334): "2FA cihazı 30 gün hatırla". INSERT (verify + hatırla), UPDATE
-- (her atlamada token_hash döndürme + last_used_at/ip; koşullu UPDATE), DELETE (geçersiz kılma noktaları §3.4, yeniden kullanım,
-- saklama, firma silme USER_CHILDREN, KVKK erasure, purgeTx). Tetikleyici yok; kurallar CHECK + bileşik FK'de. DDL yok.
GRANT SELECT, INSERT, UPDATE, DELETE ON trusted_devices TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON trusted_devices FROM 'app'@'%';

-- P27 gözetimsiz erişim (mimari-p27 §3.1–3.6; AC-273, 275, 293, 296). Tetikleyici yok; kurallar CHECK + bileşik FK'de. DDL yok.
-- unattended_devices: kayıt INSERT, auth/iptal/rozet UPDATE, gece temizliği (iptal + 30 g, bağlı oturum yok) ve firma silme DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON unattended_devices TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON unattended_devices FROM 'app'@'%';
-- unattended_device_grants: değişmez satır — verme INSERT, geri alma DELETE (request_blocks kalıbı). UPDATE YOK.
GRANT SELECT, INSERT, DELETE ON unattended_device_grants TO 'app'@'%';
REVOKE IF EXISTS UPDATE, ALTER, DROP, INDEX, TRIGGER, REFERENCES ON unattended_device_grants FROM 'app'@'%';
-- unattended_registration_codes: üretim INSERT, tüketim UPDATE (used_at + device_id), iptal/temizlik/firma silme DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON unattended_registration_codes TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON unattended_registration_codes FROM 'app'@'%';
-- customer_notify_contacts: panel düzenleme (TX'te DELETE + INSERT), müşteri anonimleştirmesi ve firma silme DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_notify_contacts TO 'app'@'%';
REVOKE IF EXISTS ALTER, DROP, INDEX, TRIGGER, REFERENCES ON customer_notify_contacts FROM 'app'@'%';
