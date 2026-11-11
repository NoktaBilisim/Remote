-- ADR-0014 ön kontrol (yalnız okuma; Prisma bu dosyayı ÇALIŞTIRMAZ). Staging/prod'da migrate'ten ÖNCE çalıştırın:
--   docker compose exec mysql sh -c 'MYSQL_PWD=… mysql -umigrator remote' < precheck.sql
-- Her satır 0 olmalı. 0 değilse migration zaten 3819 (adr14_noncanonical_rows_chk) ile hiçbir şey değiştirmeden durur;
-- satırları elle DÜZELTMEYİN (session_consents KVKK kanıtı) — sonucu mimara bildirin.
SELECT 'tenants.status' AS col, COUNT(*) AS n FROM `tenants` WHERE CAST(`status` AS BINARY) NOT IN ('ACTIVE', 'PASSIVE')
UNION ALL SELECT 'tenant_settings.smtp_security', COUNT(*) FROM `tenant_settings` WHERE CAST(`smtp_security` AS BINARY) NOT IN ('NONE', 'SSL', 'STARTTLS')
UNION ALL SELECT 'users.role', COUNT(*) FROM `users` WHERE CAST(`role` AS BINARY) NOT IN ('SUPER_ADMIN', 'ADMIN', 'USER')
UNION ALL SELECT 'users.theme', COUNT(*) FROM `users` WHERE CAST(`theme` AS BINARY) NOT IN ('LIGHT', 'DARK', 'SYSTEM')
UNION ALL SELECT 'users.status', COUNT(*) FROM `users` WHERE CAST(`status` AS BINARY) NOT IN ('ACTIVE', 'PASSIVE')
UNION ALL SELECT 'audit_logs.result', COUNT(*) FROM `audit_logs` WHERE CAST(`result` AS BINARY) NOT IN ('success', 'fail')
UNION ALL SELECT 'support_sessions.status', COUNT(*) FROM `support_sessions` WHERE CAST(`status` AS BINARY) NOT IN ('PENDING', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED')
UNION ALL SELECT 'support_sessions.ended_by', COUNT(*) FROM `support_sessions` WHERE CAST(`ended_by` AS BINARY) NOT IN ('TECH', 'CUSTOMER', 'ADMIN', 'SYSTEM')
UNION ALL SELECT 'support_sessions.mode', COUNT(*) FROM `support_sessions` WHERE CAST(`mode` AS BINARY) NOT IN ('AGENT', 'BROWSER')
UNION ALL SELECT 'session_consents.level', COUNT(*) FROM `session_consents` WHERE CAST(`level` AS BINARY) NOT IN ('VIEW', 'CONTROL')
UNION ALL SELECT 'session_consents.decision', COUNT(*) FROM `session_consents` WHERE CAST(`decision` AS BINARY) NOT IN ('GRANTED', 'DENIED', 'REVOKED')
UNION ALL SELECT 'session_consents.source', COUNT(*) FROM `session_consents` WHERE CAST(`source` AS BINARY) NOT IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH')
UNION ALL SELECT 'session_files.direction', COUNT(*) FROM `session_files` WHERE CAST(`direction` AS BINARY) NOT IN ('TO_CUSTOMER', 'TO_TECH')
UNION ALL SELECT 'session_files.result', COUNT(*) FROM `session_files` WHERE CAST(`result` AS BINARY) NOT IN ('OK', 'REJECTED', 'CANCELLED', 'CORRUPT');
