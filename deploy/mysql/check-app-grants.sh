#!/bin/bash
# app DB kullanıcısının yetki sınırı kontrolü (G-15, AC-123 kullanıcı ayrımı). Kullanım:
#   APP_PW=<app parolası> CONTAINER=<mysql konteyner adı> DB=<veritabanı> ./check-app-grants.sh
# Beklenen tüm satırlar PASS; FAIL varsa çıkış kodu 1. Geçici tenant/kullanıcı ekler ve sonunda siler; audit_logs'a kalıcı satır yazmaz.
FAILED=0
run() { # $1 beklenen, $2 sql
  out=$(docker exec -e MYSQL_PWD="$APP_PW" "${CONTAINER:-rs-mysql-test}" mysql -uapp "${DB:-remote}" -N -e "$2" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || s=FAIL
  [ "$s" = FAIL ] && FAILED=1; printf '%s | beklenen=%-6s sonuç=%-6s | %s %s\n' "$s" "$1" "$got" "$2" "$( [ $got = DENIED ] && echo "-> ${out##*: }" )"
}
# Boş DB'de de anlamlı olsun diye geçici tenant/ayar/kullanıcı (app DML'iyle) eklenir, sonda silinir.
run OK     "DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"
run OK     "INSERT INTO tenants (id,name,slug,updated_at) VALUES ('00000000000000000000GRANTT','grant-test','grant-test-tmp',NOW(3))"
run OK     "INSERT INTO tenant_settings (tenant_id,updated_at) VALUES ('00000000000000000000GRANTT',NOW(3))"
run OK     "INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTU','00000000000000000000GRANTT','grant-test@invalid.test','Grant Test','USER','x',NOW(3))"
run OK     "SELECT COUNT(*) FROM audit_logs"
# INSERT geri alınan transaction içinde denenir: app audit satırı silemez, kalıcı test satırı bırakılmaz.
run OK     "START TRANSACTION; INSERT INTO audit_logs (action,entity,result) VALUES ('test.grant','audit_logs','success'); ROLLBACK"
run DENIED "UPDATE audit_logs SET result='fail' WHERE id=-1"
run DENIED "DELETE FROM audit_logs WHERE id=-1"
run DENIED "ALTER TABLE audit_logs ADD COLUMN x INT"
run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON audit_logs FOR EACH ROW SET @a=1"
run DENIED "DROP TABLE audit_logs"
run DENIED "TRUNCATE TABLE audit_logs"
run DENIED "CREATE TABLE x_test (id INT)"
run DENIED "ALTER TABLE users ADD COLUMN x INT"
run DENIED "GRANT UPDATE ON audit_logs TO 'app'@'%'"
run DENIED "INSERT INTO _prisma_migrations (id,checksum,migration_name,applied_steps_count) VALUES ('x','x','x',0)"
run OK     "SELECT migration_name FROM _prisma_migrations"
run OK     "UPDATE users SET theme='DARK' WHERE id='00000000000000000000GRANTU'"
run DENIED "UPDATE users SET role='ROOT' WHERE id='00000000000000000000GRANTU'"
run DENIED "UPDATE users SET tenant_id=NULL WHERE id='00000000000000000000GRANTU'"
run DENIED "UPDATE tenant_settings SET session_ttl_min=5 WHERE tenant_id='00000000000000000000GRANTT'"
# P2 support_sessions: SELECT/INSERT/UPDATE izinli, DELETE/DDL yok; CHECK/UQ kısıtları. Tüm denemeler
# geri alınan transaction içinde (app silemez; hata veren denemede bağlantı kapanınca otomatik ROLLBACK).
SS="INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,ended_at,created_at,updated_at) VALUES"
T="'00000000000000000000GRANTT','00000000000000000000GRANTU'"
H1="REPEAT('a',64)"; H2="REPEAT('b',64)"; E15="NOW(3)+INTERVAL 15 MINUTE"
run OK     "SELECT COUNT(*) FROM support_sessions"
run OK     "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='CANCELLED',active_code=NULL,ended_at=NOW(3),ended_by='TECH',end_reason='cancelled' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run OK     "START TRANSACTION; $SS ('00000000000000000000GRANT1',$T,$H1,NULL,'0427','EXPIRED',$E15,NOW(3),NOW(3),NOW(3)),('00000000000000000000GRANT2',$T,$H2,NULL,'0427','EXPIRED',$E15,NOW(3),NOW(3),NOW(3)); ROLLBACK"
run DENIED "DELETE FROM support_sessions WHERE id='00000000000000000000GRANTS'"
run DENIED "ALTER TABLE support_sessions ADD COLUMN x INT"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANT1',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)),('00000000000000000000GRANT2',$T,$H2,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','BOGUS',$E15,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',NOW(3)+INTERVAL 5 MINUTE,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',NOW(3)+INTERVAL 45 MINUTE,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',$E15,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'4829137A','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,'plain-token-not-a-hash','48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='CANCELLED',ended_at=NOW(3) WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='EXPIRED',active_code=NULL WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='CANCELLED',active_code=NULL,ended_at=NOW(3),ended_by='BOT' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
# Temizlik (FK sırasıyla)
run OK     "DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"
exit $FAILED
