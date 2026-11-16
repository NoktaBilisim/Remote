#!/bin/bash
# app DB kullanıcısının yetki sınırı kontrolü (G-15, AC-123 kullanıcı ayrımı). Kullanım:
#   APP_PW=<app parolası> CONTAINER=<mysql konteyner adı> DB=<veritabanı> [BACKUP_PW=<backup parolası>] [MIGRATOR_PW=<migrator parolası>] ./check-app-grants.sh
# P13a: sonda `backup` kullanıcısı da sınanır (parola BACKUP_PW ya da konteyner env MYSQL_BACKUP_PASSWORD; ikisi de
# yoksa o bölüm FAIL — yedek kullanıcısı her kurulumda olmalı). P13b: sonda migrator sınırı da sınanır (parola MIGRATOR_PW
# ya da konteyner env MYSQL_MIGRATOR_PASSWORD; compose/test-db.sh'te env var, CI servis konteynerinde yok → MIGRATOR_PW).
# Beklenen tüm satırlar PASS; FAIL varsa çıkış kodu 1. Geçici tenant/kullanıcı ekler ve sonunda siler; audit_logs'a kalıcı satır yazmaz.
FAILED=0
run() { # $1 beklenen, $2 sql, $3 (ops.) DENIED'de hata mesajında beklenen metin (ör. kısıt adı)
  out=$(docker exec -e MYSQL_PWD="$APP_PW" "${CONTAINER:-rs-mysql-test}" mysql -uapp "${DB:-remote}" -N -e "$2" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || s=FAIL
  [ "$s" = PASS ] && [ "$got" = DENIED ] && [ -n "${3:-}" ] && [[ "$out" != *"$3"* ]] && s=FAIL
  [ "$s" = FAIL ] && FAILED=1; printf '%s | beklenen=%-6s sonuç=%-6s | %s %s\n' "$s" "$1" "$got" "$2" "$( [ $got = DENIED ] && echo "-> ${out##*: }" )"
}
run_mig() { # $1 beklenen, $2 sql — migrator (fikstür/temizlik; P16 tetikleyicilerinden muaf). Parola MIGRATOR_PW ya da konteyner env'i.
  out=$(docker exec -e MPW="${MIGRATOR_PW:-}" "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="${MPW:-$MYSQL_MIGRATOR_PASSWORD}" mysql -umigrator --protocol=socket -N "$1" -e "$0"' "$2" "${DB:-remote}" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || { s=FAIL; FAILED=1; }
  printf '%s | beklenen=%-6s sonuç=%-6s | (migrator) %s %s\n' "$s" "$1" "$got" "${2:0:160}" "$( [ $got = DENIED ] && echo "-> ${out##*: }" )"
}
run_val() { # $1 beklenen tek değer, $2 sql (app), $3 açıklama
  out=$(docker exec -e MYSQL_PWD="$APP_PW" "${CONTAINER:-rs-mysql-test}" mysql -uapp "${DB:-remote}" -N -e "$2" 2>&1)
  [ "$out" = "$1" ] && s=PASS || { s=FAIL; FAILED=1; }
  printf '%s | beklenen=%-6s sonuç=%-6s | (app) %s\n' "$s" "$1" "$out" "$3"
}
# Boş DB'de de anlamlı olsun diye geçici tenant/ayar/kullanıcı (app DML'iyle) eklenir, sonda silinir.
run_mig OK "DELETE FROM tenant_purge_jobs WHERE tenant_id IN ('00000000000000000000GRANTT','00000000000000000000GRANTW'); DELETE FROM session_consents WHERE id IN ('00000000000000000000GRANT9','0000000000000000000GRANT10'); DELETE FROM support_sessions WHERE id IN ('00000000000000000000GRANT7','00000000000000000000GRANT8'); DELETE FROM customers WHERE id='00000000000000000000GRANTY'; DELETE FROM tenants WHERE id='00000000000000000000GRANTW'; DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"  # P16: app tenant/users silemez (tetikleyici) → migrator
run OK     "INSERT INTO tenants (id,name,slug,updated_at) VALUES ('00000000000000000000GRANTT','grant-test','grant-test-tmp',NOW(3))"
run OK     "INSERT INTO tenant_settings (tenant_id,updated_at) VALUES ('00000000000000000000GRANTT',NOW(3))"
run OK     "INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTU','00000000000000000000GRANTT','grant-test@invalid.test','Grant Test','USER','x',NOW(3))"
run OK     "SELECT COUNT(*) FROM audit_logs"
# INSERT geri alınan transaction içinde denenir: app audit satırı silemez, kalıcı test satırı bırakılmaz.
run OK     "START TRANSACTION; INSERT INTO audit_logs (action,entity,result) VALUES ('test.grant','audit_logs','success'); ROLLBACK"
run DENIED "UPDATE audit_logs SET result='fail' WHERE id=-1"
# P13a: DELETE yetkisi var (retention), tetikleyici 730 günden yeni satırı reddeder; app'in geriye tarihli created_at'i
# DB saatine zorlanır → 2020 tarihli eklenen satır da "yeni" sayılır ve silinemez (K-P13-4).
run OK     "DELETE FROM audit_logs WHERE id=-1"
run DENIED "START TRANSACTION; INSERT INTO audit_logs (created_at,action,entity,result) VALUES ('2020-01-01 00:00:00.000','test.grant','audit_logs','success'); DELETE FROM audit_logs WHERE id=LAST_INSERT_ID(); ROLLBACK" "older than 730 days"
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
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); DELETE FROM support_sessions WHERE id='00000000000000000000GRANTS'; ROLLBACK" "p16: support_sessions DELETE"  # P16: yetki var, tetikleyici reddeder
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
# P3 admit/terminate CHECK'leri (giriş şartı 2: tek atomik UPDATE; G-04 terminated_by).
run OK     "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3); UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='ADMIN',end_reason='admin',terminated_by='00000000000000000000GRANTU' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run OK     "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3); UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='SYSTEM',end_reason='max_duration' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='AGENT' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3) WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='VNC' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3)+INTERVAL 20 MINUTE,mode='AGENT' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='CANCELLED',active_code=NULL,ended_at=NOW(3),consumed_at=NOW(3),mode='AGENT' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3); UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='ADMIN' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3); UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='TECH',terminated_by='00000000000000000000GRANTU' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3); UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='ADMIN',terminated_by='00000000000000000000NOUSER' WHERE id='00000000000000000000GRANTS'; ROLLBACK"
# P4 consent_texts (değişmez, sürümlü; app SELECT/INSERT) + session_consents (append-only; SELECT/INSERT).
# Tüm denemeler geri alınan transaction içinde; tenant GRANTX çapraz-tenant denemeleri için geçicidir.
B="REPEAT('Aydinlatma metni v1 ',3)"  # ASCII: CLI istemci karakter setinden bağımsız SHA2
CT="INSERT INTO consent_texts (id,tenant_id,version,body,sha256,is_current,updated_at) VALUES"
CT1="$CT ('00000000000000000000GRANTC','00000000000000000000GRANTT',1,$B,SHA2($B,256),1,NOW(3))"
ADM="$SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS' AND status='PENDING' AND expires_at > NOW(3)"
SC="INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source,consent_text_id,consent_sha256,ip,user_agent) VALUES"
GX="INSERT INTO tenants (id,name,slug,updated_at) VALUES ('00000000000000000000GRANTX','grant-x','grant-test-x',NOW(3))"
run OK     "SELECT COUNT(*) FROM consent_texts; SELECT COUNT(*) FROM session_consents"
run OK     "START TRANSACTION; $CT1; $CT ('00000000000000000000GRANTD','00000000000000000000GRANTT',2,'v2',SHA2('v2',256),0,NOW(3)); ROLLBACK"
run DENIED "UPDATE consent_texts SET body='x' WHERE id='00000000000000000000GRANTC'"
# P8b-1: sütun düzeyi UPDATE(is_current, updated_at) izinli (seed yeni sürüm); diğer sütunlar hâlâ reddedilir.
run OK     "UPDATE consent_texts SET is_current=0, updated_at=NOW(3) WHERE id='00000000000000000000GRANTC'"
run DENIED "UPDATE consent_texts SET version=9 WHERE id='00000000000000000000GRANTC'"
run DENIED "START TRANSACTION; $CT1; DELETE FROM consent_texts WHERE id='00000000000000000000GRANTC'; ROLLBACK" "p16: consent_texts DELETE"  # P16
run DENIED "ALTER TABLE consent_texts ADD COLUMN x INT"
run DENIED "START TRANSACTION; $CT1; $CT ('00000000000000000000GRANTD','00000000000000000000GRANTT',2,'v2',SHA2('v2',256),1,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT1; $CT ('00000000000000000000GRANTD','00000000000000000000GRANTT',1,'v2',SHA2('v2',256),0,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT ('00000000000000000000GRANTC','00000000000000000000GRANTT',1,'metin',SHA2('baska',256),1,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT ('00000000000000000000GRANTC','00000000000000000000GRANTT',0,'metin',SHA2('metin',256),1,NOW(3)); ROLLBACK"
run OK     "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'),('00000000000000000000GRANTW','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','DENIED','SYSTEM',NULL,NULL,NULL,NULL); ROLLBACK"
# P13a: anonimleştirme yalnız ip/user_agent (sütun düzeyi UPDATE); karar/seviye/kaynak/metin özeti değişmez (1143).
run OK     "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'); UPDATE session_consents SET ip=NULL,user_agent=NULL WHERE session_id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "UPDATE session_consents SET level='CONTROL' WHERE id='00000000000000000000GRANTV'" "command denied"
run DENIED "UPDATE session_consents SET decision='DENIED' WHERE id='00000000000000000000GRANTV'" "command denied"
run DENIED "UPDATE session_consents SET consent_sha256=NULL,consent_text_id=NULL WHERE id='00000000000000000000GRANTV'" "command denied"
run DENIED "UPDATE session_consents SET created_at=NOW(3) WHERE id='00000000000000000000GRANTV'" "command denied"
run DENIED "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'); DELETE FROM session_consents WHERE id='00000000000000000000GRANTV'; ROLLBACK" "p16: session_consents DELETE"  # P16
run DENIED "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2('baska',256),'203.0.113.7','ua'); ROLLBACK"
run DENIED "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',NULL,'203.0.113.7','ua'); ROLLBACK"
run DENIED "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'); ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','BOGUS','UI',NULL,NULL,NULL,NULL); ROLLBACK"
run DENIED "START TRANSACTION; $GX; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTX','VIEW','GRANTED','SYSTEM',NULL,NULL,NULL,NULL); ROLLBACK"
run DENIED "START TRANSACTION; $GX; $CT ('00000000000000000000GRANTC','00000000000000000000GRANTX',1,$B,SHA2($B,256),1,NOW(3)); $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'); ROLLBACK"
# P5 session_files (append-only meta; app SELECT/INSERT) + support_sessions.quality_summary CHECK.
SF="INSERT INTO session_files (id,session_id,tenant_id,direction,file_name,size_bytes,sha256,result) VALUES"
run OK     "SELECT COUNT(*) FROM session_files"
run OK     "START TRANSACTION; $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK'); UPDATE support_sessions SET quality_summary=JSON_OBJECT('connType','relay') WHERE id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "UPDATE session_files SET file_name='x' WHERE id='00000000000000000000GRANTF'"
# P13a (K-P13-2): anonimleştirmede satır silinir → DELETE izinli; UPDATE hâlâ yok.
run OK     "START TRANSACTION; $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK'); DELETE FROM session_files WHERE session_id='00000000000000000000GRANTS'; ROLLBACK"
run DENIED "ALTER TABLE session_files ADD COLUMN x INT"
run DENIED "START TRANSACTION; $GX; $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTX','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK'); ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT','TO_CUSTOMER','a/b.pdf',1024,$H1,'OK'); ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT','UP','rapor.pdf',1024,$H1,'OK'); ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET quality_summary=JSON_OBJECT('connType','relay') WHERE id='00000000000000000000GRANTS'; ROLLBACK"
# P7 session_consents.source += TECH (ADR-0013: teknisyen bırakması CONTROL/REVOKED/TECH); küme dışı değer reddi.
run OK     "START TRANSACTION; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','REVOKED','TECH',NULL,NULL,NULL,NULL); ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','REVOKED','BOGUS',NULL,NULL,NULL,NULL); ROLLBACK"
# P8 oturum geçmişi alanları (customer_*, ticket_no, note) CHECK'leri; tablo düzeyi UPDATE P2'den. ASCII + CHAR()/X'' (CLI karakter setinden bağımsız).
U8="UPDATE support_sessions SET"; W8="WHERE id='00000000000000000000GRANTS'"
RTLO="CONVERT(X'E280AE' USING utf8mb4)"
run OK     "START TRANSACTION; $ADM; $U8 customer_name='Ayse Yilmaz',customer_email='ayse@example.test',ticket_no='INC-123',note=CONCAT(REPEAT('n',3998),CHAR(10),'x') $W8; ROLLBACK"
run OK     "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); $U8 ticket_no='INC-1',note='bekleyen' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 note=REPEAT('n',4001) $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 note='' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 ticket_no='' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 ticket_no=' INC-1' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 ticket_no=CONCAT('INC',CHAR(10),'1') $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_name=CONCAT('Ali',CHAR(9),'Veli') $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_name=CONCAT('Ali',$RTLO,'fdp.exe') $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_name='A' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_name='Ayse ' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); $U8 customer_name='Ayse Yilmaz' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_name='Ayse Yilmaz',customer_email='gecersiz' $W8; ROLLBACK"
run DENIED "START TRANSACTION; $ADM; $U8 customer_email='ayse@example.test' $W8; ROLLBACK"
# ADR-0014: enum CHECK'leri ikili (CAST AS BINARY, NO PAD). Her CHECK için kanonik değer kabul; harf varyantı,
# sondaki boşluk ve aksanlı varyant (UTF-8 X'' ile, CLI karakter setinden bağımsız) beklenen kısıt adıyla 3819.
# enum_case <kısıt> <kanonik> <harf varyantı> <aksanlı SQL ifadesi> <SQL şablonu; @V@ = değer ifadesi>
enum_case() {
  local canon="'$2'" casev="'$3'" pad="'$2 '"  # tırnaklar değişkende: bash 3.2/5.x ${//} farkından bağımsız
  run OK     "${5//@V@/$canon}"
  run DENIED "${5//@V@/$casev}" "$1"
  run DENIED "${5//@V@/$pad}" "$1"
  run DENIED "${5//@V@/$4}" "$1"
}
EA="CONVERT(X'C389' USING utf8mb4)"; AA="CONVERT(X'C381' USING utf8mb4)"; OA="CONVERT(X'C393' USING utf8mb4)"  # É Á Ó
R="ROLLBACK"; TX="START TRANSACTION;"
enum_case tenants_status_chk ACTIVE active "CONCAT($AA,'CTIVE')" "$TX UPDATE tenants SET status=@V@ WHERE id='00000000000000000000GRANTT'; $R"
# P10: tenant_settings_smtp_complete_chk tek başına smtp_security'yi reddeder → değer tam SMTP yapılandırmasıyla denenir.
enum_case tenant_settings_smtp_security_chk SSL ssl "CONCAT('SS',CONVERT(X'C4B9' USING utf8mb4))" "$TX UPDATE tenant_settings SET smtp_security=@V@,smtp_host='smtp.example.com',smtp_port=465,smtp_from_email='destek@example.com' WHERE tenant_id='00000000000000000000GRANTT'; $R"
enum_case users_role_chk ADMIN admin "CONCAT($AA,'DMIN')" "$TX UPDATE users SET role=@V@ WHERE id='00000000000000000000GRANTU'; $R"
enum_case users_theme_chk DARK dark "CONCAT('D',$AA,'RK')" "$TX UPDATE users SET theme=@V@ WHERE id='00000000000000000000GRANTU'; $R"
enum_case users_status_chk PASSIVE passive "CONCAT('P',$AA,'SSIVE')" "$TX UPDATE users SET status=@V@ WHERE id='00000000000000000000GRANTU'; $R"
enum_case audit_logs_result_chk success SUCCESS "CONCAT('succ',CONVERT(X'C3A9' USING utf8mb4),'ss')" "$TX INSERT INTO audit_logs (action,entity,result) VALUES ('test.grant','audit_logs',@V@); $R"
enum_case support_sessions_status_chk PENDING pending "CONCAT('P',$EA,'NDING')" "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427',@V@,$E15,NULL,NOW(3),NOW(3)); $R"
enum_case support_sessions_ended_by_chk TECH tech "CONCAT('T',$EA,'CH')" "$TX $ADM; UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by=@V@ WHERE id='00000000000000000000GRANTS'; $R"
enum_case support_sessions_mode_chk AGENT agent "CONCAT('AG',$EA,'NT')" "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='ACTIVE',active_code=NULL,consumed_at=NOW(3),mode=@V@ WHERE id='00000000000000000000GRANTS'; $R"
enum_case session_consents_level_chk CONTROL control "CONCAT('C',$OA,'NTROL')" "$TX $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT',@V@,'DENIED','SYSTEM',NULL,NULL,NULL,NULL); $R"
enum_case session_consents_decision_chk DENIED denied "CONCAT('D',$EA,'NIED')" "$TX $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL',@V@,'SYSTEM',NULL,NULL,NULL,NULL); $R"
enum_case session_consents_source_chk TECH tech "CONCAT('T',$EA,'CH')" "$TX $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','REVOKED',@V@,NULL,NULL,NULL,NULL); $R"
enum_case session_files_direction_chk TO_TECH to_tech "CONCAT('T',$OA,'_TECH')" "$TX $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT',@V@,'rapor.pdf',1024,$H1,'OK'); $R"
enum_case session_files_result_chk REJECTED rejected "CONCAT('R',$EA,'JECTED')" "$TX $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','00000000000000000000GRANTT','TO_CUSTOMER','rapor.pdf',1024,$H1,@V@); $R"
# P8b-1 tenant_request_settings + support_requests (SELECT/INSERT/UPDATE; DELETE/DDL yok) ve CHECK'leri; support_sessions
# request_id'ye göre ayrılan P2 kod/TTL CHECK'leri; session_consents.request_id. Tüm denemeler geri alınan TX'te.
RS="INSERT INTO tenant_request_settings (tenant_id,request_ref,file_label,wa_recipients,email_recipients,trusted_cidrs,updated_at) VALUES"
RS1="$RS ('00000000000000000000GRANTT','abcdefghijk23456','GrantTest','[]','[]','[]',NOW(3))"
RQC="id,tenant_id,request_code,secret_hash,client_instance,client_version,customer_name,customer_phone,customer_email,description,consent_text_id,consent_sha256,consented_at,ip,ip_key,net_key,expires_at,created_at,updated_at"
RQV="'00000000000000000000GRANTT','123456',$H1,'AAAAAAAAAAAAAAAAAAAAAA','0.9.0','Ayse Yilmaz','+905301112233',NULL,'Yazici calismiyor lutfen','00000000000000000000GRANTC',SHA2($B,256),NOW(3),'203.0.113.7','203.0.113.7','203.0.113.0/24',NOW(3)+INTERVAL 30 MINUTE,NOW(3),NOW(3)"
RQ="$CT1; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTR',$RQV)"
rq() { echo "$CT1; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTR',${RQV/$1/$2})"; }  # $1 → $2 değiştir
UR="UPDATE support_requests SET"; WR="WHERE id='00000000000000000000GRANTR'"
RSR="INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id,customer_name) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR','Ayse Yilmaz')"
ACC="$UR status='ACCEPTED',accepted_by='00000000000000000000GRANTU',accepted_at=NOW(3),closed_at=NOW(3) $WR"
run OK     "SELECT COUNT(*) FROM tenant_request_settings; SELECT COUNT(*) FROM support_requests"
run OK     "$TX $RS1; UPDATE tenant_request_settings SET wait_minutes=60,wa_enabled=1,wa_recipients='[\"+905301112233\"]',trusted_cidrs='[\"203.0.113.0/24\"]' WHERE tenant_id='00000000000000000000GRANTT'; $R"
run DENIED "$TX $RS1; DELETE FROM tenant_request_settings WHERE tenant_id='00000000000000000000GRANTT'; $R" "p16: tenant_request_settings DELETE"  # P16
run DENIED "ALTER TABLE tenant_request_settings ADD COLUMN x INT"
run DENIED "$TX $RS ('00000000000000000000GRANTT','ABCDEFGHIJK23456','GrantTest','[]','[]','[]',NOW(3)); $R" tenant_request_settings_ref_fmt_chk
run DENIED "$TX $RS ('00000000000000000000GRANTT','abcdefghijk23456','Grant-Test','[]','[]','[]',NOW(3)); $R" tenant_request_settings_file_label_chk
run DENIED "$TX $RS ('00000000000000000000GRANTT','abcdefghijk23456',CONCAT('GrantTest',CHAR(10)),'[]','[]','[]',NOW(3)); $R" tenant_request_settings_file_label_chk  # P14a AC-201 \\z
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET wait_minutes=5 WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_wait_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET wa_recipients='[\"905301112233\"]' WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_wa_recipients_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET wa_recipients='[\"+905301112233\",\"+905301112233\"]' WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_wa_recipients_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET wa_recipients='[\"+901\",\"+902\",\"+903\",\"+904\",\"+905\",\"+906\"]' WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_wa_recipients_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET wa_enabled=1 WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_wa_enabled_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET trusted_cidrs='{\"a\":1}' WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_trusted_cidrs_chk
run DENIED "$TX $RS1; UPDATE tenant_request_settings SET email_recipients='[\"gecersiz\"]' WHERE tenant_id='00000000000000000000GRANTT'; $R" tenant_request_settings_email_recipients_chk
run DENIED "$TX $RS1; $RS ('00000000000000000000GRANTT','bbcdefghijk23456','GrantTest','[]','[]','[]',NOW(3)); $R"
# Talep yaşam döngüsü (izinli): oluştur → kabul → talep oturumu (kodsuz, 60 sn) → admit (AGENT + ağ anahtarları) + talep onayı;
# PENDING → REJECTED; PENDING → CANCELLED(CUSTOMER); ACCEPTED → CANCELLED(CUSTOMER) (decline); anonimleştirme.
run OK     "$TX $RQ; $ACC; $RSR; UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='AGENT',guest_net_key='203.0.113.0/24',guest_ip_key='203.0.113.7' WHERE id='00000000000000000000GRANTS'; INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source,consent_text_id,consent_sha256,ip,user_agent,request_id) VALUES ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua','00000000000000000000GRANTR'); $R"
run OK     "$TX $RQ; $UR status='REJECTED',rejected_by='00000000000000000000GRANTU',reject_message='Sizi arayacagiz',closed_at=NOW(3) $WR; $R"
run OK     "$TX $RQ; $UR status='CANCELLED',cancel_reason='CUSTOMER',closed_at=NOW(3) $WR; $R"
run OK     "$TX $RQ; $ACC; $UR status='CANCELLED',cancel_reason='CUSTOMER' $WR; $R"
run OK     "$TX $RQ; $UR status='EXPIRED',closed_at=NOW(3) $WR; $UR customer_name=NULL,customer_phone=NULL,customer_email=NULL,description=NULL,ip=NULL,ip_key=NULL,net_key=NULL,device_hash=NULL,anonymized_at=NOW(3) $WR; $R"
run DENIED "$TX $RQ; DELETE FROM support_requests $WR; $R" "p16: support_requests DELETE"  # P16
run DENIED "ALTER TABLE support_requests ADD COLUMN x INT"
# Talep CHECK negatifleri (beklenen kısıt adıyla).
run DENIED "$TX $(rq "'123456'" "'12345A'"); $R" support_requests_code_fmt_chk
run DENIED "$TX $(rq "'+905301112233'" "'05301112233'"); $R" support_requests_phone_fmt_chk
run DENIED "$TX $(rq "'0.9.0'" "'0.9'"); $R" support_requests_client_version_fmt_chk
run DENIED "$TX $(rq "'0.9.0'" "CONCAT('0.9.0',CHAR(10))"); $R" support_requests_client_version_fmt_chk  # P14a AC-201
run DENIED "$TX $(rq "'+905301112233'" "CONCAT('+905301112233',CHAR(10))"); $R" support_requests_phone_fmt_chk  # P14a AC-201
run DENIED "$TX $(rq "'AAAAAAAAAAAAAAAAAAAAAA'" "'AAAA'"); $R" support_requests_client_instance_fmt_chk
run DENIED "$TX $(rq "'Ayse Yilmaz'" "'A'"); $R" support_requests_customer_name_chk
run DENIED "$TX $(rq "'Ayse Yilmaz'" "CONCAT('Ali',$RTLO,'fdp.exe')"); $R" support_requests_customer_name_chk
run DENIED "$TX $(rq "'Yazici calismiyor lutfen'" "CONCAT('Yazici calismiyor',CHAR(10),'lutfen')"); $R" support_requests_description_chk
run DENIED "$TX $(rq "'Yazici calismiyor lutfen'" "'Yazici  calismiyor'"); $R" support_requests_description_chk
run DENIED "$TX $(rq "'Yazici calismiyor lutfen'" "'kisa'"); $R" support_requests_description_chk
run DENIED "$TX $(rq "NULL,'Yazici" "'gecersiz','Yazici"); $R" support_requests_email_fmt_chk
run DENIED "$TX $(rq "'Ayse Yilmaz'" "NULL"); $R" support_requests_pii_chk
run DENIED "$TX $(rq "'203.0.113.0/24'" "NULL"); $R" support_requests_pii_chk
run DENIED "$TX $(rq "+INTERVAL 30 MINUTE" "+INTERVAL 5 MINUTE"); $R" support_requests_expires_chk
run DENIED "$TX $(rq "+INTERVAL 30 MINUTE" "+INTERVAL 3 HOUR"); $R" support_requests_expires_chk
run DENIED "$TX $RQ; $UR status='pending' $WR; $R" support_requests_status_chk
run DENIED "$TX $RQ; $UR status='PENDING ' $WR; $R" support_requests_status_chk
run DENIED "$TX $RQ; $UR network_match='ip' $WR; $R" support_requests_network_match_chk
run DENIED "$TX $RQ; $UR status='CANCELLED',closed_at=NOW(3) $WR; $R" support_requests_cancel_status_chk
run DENIED "$TX $RQ; $UR status='CANCELLED',cancel_reason='BOGUS',closed_at=NOW(3) $WR; $R" support_requests_cancel_reason_chk
run DENIED "$TX $RQ; $UR status='EXPIRED' $WR; $R" support_requests_closed_status_chk
run DENIED "$TX $RQ; $UR status='ACCEPTED',closed_at=NOW(3) $WR; $R" support_requests_accepted_chk
run DENIED "$TX $RQ; $ACC; $UR status='CANCELLED',cancel_reason='DISCONNECTED' $WR; $R" support_requests_accepted_chk
run DENIED "$TX $RQ; $UR status='REJECTED',rejected_by='00000000000000000000GRANTU',closed_at=NOW(3) $WR; $R" support_requests_rejected_chk
run DENIED "$TX $RQ; $UR status='REJECTED',rejected_by='00000000000000000000GRANTU',reject_message=CONCAT('Ara',CHAR(10),'yin'),closed_at=NOW(3) $WR; $R" support_requests_reject_message_chk
run DENIED "$TX $RQ; $UR customer_name=NULL,anonymized_at=NOW(3) $WR; $R" support_requests_pii_chk
run DENIED "$TX $RQ; $UR known_device=1 $WR; $R" support_requests_known_device_chk
run DENIED "$TX $RQ; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTQ',${RQV/$H1/$H2}); $R" support_requests_pending_code_uq
run OK     "$TX $RQ; $UR status='EXPIRED',closed_at=NOW(3) $WR; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTQ',${RQV/$H1/$H2}); $R"
run DENIED "$TX $RQ; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTQ',$(c="'123456'"; d="'654321'"; echo "${RQV/$c/$d}")); $R" support_requests_secret_hash_key
run DENIED "$TX $GX; $CT1; INSERT INTO support_requests ($RQC) VALUES ('00000000000000000000GRANTR',${RQV/00000000000000000000GRANTT/00000000000000000000GRANTX}); $R"
# support_sessions: talep oturumu kodsuz + 60 sn; kod yolu P2 kuralları aynen; talep oturumu BROWSER olamaz; ağ anahtarı admit'siz yok.
run DENIED "$TX $RQ; $ACC; $SS ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NULL,NOW(3),NOW(3)); $R" support_sessions_code_pending_chk
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); $R" support_sessions_code_pending_chk
run OK     "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id,customer_name) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR','Ayse Yilmaz'); UPDATE support_sessions SET status='CANCELLED',ended_at=NOW(3),ended_by='SYSTEM',end_reason='connect_timeout' WHERE id='00000000000000000000GRANTS'; $UR status='CONNECT_FAILED' $WR; $R"
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',$E15,NOW(3),NOW(3),'00000000000000000000GRANTR'); $R" support_sessions_ttl_chk
# P19 J2: talep oturumu BROWSER olabilir (web talebi; request_mode_chk düşürüldü — mode_chk AGENT|BROWSER yeterli).
run OK     "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS'; $R"
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='KIOSK' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_mode_chk
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'),('00000000000000000000GRANT1',$T,$H2,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); $R" support_sessions_request_id_tenant_id_key
run DENIED "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET guest_net_key='203.0.113.0/24',guest_ip_key='203.0.113.7' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_guest_keys_chk
run DENIED "$TX $ADM; UPDATE support_sessions SET guest_net_key='203.0.113.0/24' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_guest_keys_chk
run OK     "$TX $ADM; UPDATE support_sessions SET customer_name='Ayse Yilmaz',customer_email=CONCAT(REPEAT('a',240),'@example.test') WHERE id='00000000000000000000GRANTS'; $R"
run DENIED "$TX $RQ; $ACC; $RSR; INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source,request_id) VALUES ('00000000000000000000GRANTW','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','DENIED','SYSTEM','00000000000000000000GRANTR'); $R" session_consents_request_scope_chk
run DENIED "UPDATE session_consents SET request_id=NULL WHERE id='00000000000000000000GRANTV'"
# P8c-1 customers (SELECT/INSERT/UPDATE), request_refs (append-only: SELECT/INSERT), device_bindings (SELECT/INSERT/UPDATE)
# ve CHECK/UQ/FK kısıtları; support_requests/support_sessions müşteri/kayıt bağı ve yeni iptal nedenleri. Tümü geri alınan TX'te.
CU="INSERT INTO customers (id,tenant_id,name,name_key,search_key,file_label,request_ref,updated_at) VALUES"
CUV="'00000000000000000000GRANTK','00000000000000000000GRANTT','Grant Musteri','grant musteri','grant musteri 905301112233','GrantMusteri','cccccccccccccccc',NOW(3)"
CU1="$CU ($CUV)"
cu() { echo "$CU (${CUV/$1/$2})"; }  # $1 → $2 değiştir
UC="UPDATE customers SET"; WC="WHERE id='00000000000000000000GRANTK'"
RR="INSERT INTO request_refs (ref,tenant_id,customer_id) VALUES"
DBI="INSERT INTO device_bindings (id,tenant_id,customer_id,key_hash,client_version,first_session_id,last_session_id,last_used_at,updated_at) VALUES"
DB1="$DBI ('00000000000000000000GRANTB','00000000000000000000GRANTT','00000000000000000000GRANTK',$H1,'0.10.0','00000000000000000000GRANTS','00000000000000000000GRANTS',NOW(3),NOW(3))"
DB2="$DBI ('00000000000000000000GRANTA','00000000000000000000GRANTT',NULL,$H2,'0.10.0','00000000000000000000GRANTS','00000000000000000000GRANTS',NOW(3),NOW(3))"
UB="UPDATE device_bindings SET"; WB="WHERE id='00000000000000000000GRANTB'"
REV="$UB revoked_at=NOW(3),revoke_reason='FORGOTTEN',key_hash=NULL $WB"
run OK     "SELECT COUNT(*) FROM customers; SELECT COUNT(*) FROM request_refs; SELECT COUNT(*) FROM device_bindings"
run OK     "$TX $CU1; $RR ('cccccccccccccccc','00000000000000000000GRANTT','00000000000000000000GRANTK'),('dddddddddddddddd','00000000000000000000GRANTT',NULL); $UC contact_name='Ayse Yilmaz',phone='+905301112233',email='ayse@example.test',note=CONCAT('satir 1',CHAR(10),'satir 2') $WC; $UC status='PASSIVE',passive_at=NOW(3) $WC; $UC contact_name=NULL,phone=NULL,email=NULL,note=NULL,anonymized_at=NOW(3) $WC; $R"
run DENIED "$TX $CU1; DELETE FROM customers $WC; $R" "p16: customers DELETE"  # P16
run DENIED "ALTER TABLE customers ADD COLUMN x INT"
run DENIED "UPDATE request_refs SET customer_id=NULL WHERE ref='cccccccccccccccc'"
run DENIED "$TX $RR ('dddddddddddddddd','00000000000000000000GRANTT',NULL); DELETE FROM request_refs WHERE ref='dddddddddddddddd'; $R" "p16: request_refs DELETE"  # P16
run DENIED "ALTER TABLE request_refs ADD COLUMN x INT"
run DENIED "$TX $RR ('cccccccccccccccc','00000000000000000000GRANTT',NULL); $RR ('cccccccccccccccc','00000000000000000000GRANTT',NULL); $R" PRIMARY
run DENIED "$TX $RR ('CCCCCCCCCCCCCCCC','00000000000000000000GRANTT',NULL); $R" request_refs_ref_fmt_chk
run DENIED "$TX $CU1; $GX; $RR ('cccccccccccccccc','00000000000000000000GRANTX','00000000000000000000GRANTK'); $R" request_refs_tenant_id_customer_id_fkey
run DENIED "$TX $(cu "'Grant Musteri'" "'A'"); $R" customers_name_chk
run DENIED "$TX $(cu "'Grant Musteri'" "CONCAT('Grant',$RTLO,'exe')"); $R" customers_name_chk
run DENIED "$TX $(cu "'GrantMusteri'" "'Grant-Musteri'"); $R" customers_file_label_chk
run DENIED "$TX $(cu "'GrantMusteri'" "CONCAT('GrantMusteri',CHAR(10))"); $R" customers_file_label_chk  # P14a AC-201
run DENIED "$TX $(cu "'cccccccccccccccc'" "'cccccccccccccc01'"); $R" customers_ref_fmt_chk
run DENIED "$TX $(cu "'grant musteri 905301112233'" "'baska 905301112233'"); $R" customers_search_key_chk
run DENIED "$TX $(cu "'grant musteri','grant musteri 9" "' grant musteri',' grant musteri 9"); $R" customers_name_key_chk
run DENIED "$TX $CU1; $UC status='passive',passive_at=NOW(3) $WC; $R" customers_status_chk
run DENIED "$TX $CU1; $UC status='PASSIVE' $WC; $R" customers_passive_chk
run DENIED "$TX $CU1; $UC passive_at=NOW(3) $WC; $R" customers_passive_chk
run DENIED "$TX $CU1; $UC phone='05301112233' $WC; $R" customers_phone_fmt_chk
run DENIED "$TX $CU1; $UC phone=CONCAT('+905301112233',CHAR(10)) $WC; $R" customers_phone_fmt_chk  # P14a AC-201
run DENIED "$TX $CU1; $UC email='gecersiz' $WC; $R" customers_email_fmt_chk
run DENIED "$TX $CU1; $UC contact_name='' $WC; $R" customers_contact_name_chk
run DENIED "$TX $CU1; $UC note=CONCAT('a',CHAR(9),'b') $WC; $R" customers_note_chk
run DENIED "$TX $CU1; $UC note=REPEAT('n',1001) $WC; $R" "Data too long for column 'note'"
run DENIED "$TX $CU1; $UC phone='+905301112233',anonymized_at=NOW(3) $WC; $R" customers_anonymized_chk
# Ad tekilliği tenant içinde (pasifler dahil); başka tenant'ta aynı ad serbest; ref global tekil.
run DENIED "$TX $CU1; $UC status='PASSIVE',passive_at=NOW(3) $WC; $CU ('00000000000000000000GRANTL','00000000000000000000GRANTT','Grant Musteri','grant musteri','grant musteri','GrantMusteri','eeeeeeeeeeeeeeee',NOW(3)); $R" customers_tenant_id_name_key_key
run OK     "$TX $CU1; $GX; $CU ('00000000000000000000GRANTL','00000000000000000000GRANTX','Grant Musteri','grant musteri','grant musteri','GrantMusteri','eeeeeeeeeeeeeeee',NOW(3)); $R"
run DENIED "$TX $CU1; $CU ('00000000000000000000GRANTL','00000000000000000000GRANTT','Diger','diger','diger','Diger','cccccccccccccccc',NOW(3)); $R" customers_request_ref_key
# device_bindings: verme → yerinde yenileme → geçersizleştirme; geçersiz satır oturumu serbest bırakır (active_session_id UQ).
run OK     "$TX $CU1; $ADM; $DB1; $UB key_hash=$H2,issue_count=issue_count+1,last_used_at=NOW(3),client_version='0.10.1' $WB; $REV; $DB2; $R"
run OK     "$TX $CU1; $ADM; $DB1; $UB revoked_at=NOW(3),revoke_reason='ADMIN_REVOKED',key_hash=NULL $WB; $R"
run DENIED "$TX $CU1; $ADM; $DB1; $DB2; $R" device_bindings_active_session_id_key
run DENIED "$TX $CU1; $ADM; $DB1; $DB1; $R" PRIMARY
run DENIED "$TX $CU1; $ADM; $DB1; $DBI ('00000000000000000000GRANTA','00000000000000000000GRANTT',NULL,$H1,'0.10.0','00000000000000000000GRANTS','00000000000000000000GRANTS',NOW(3),NOW(3)); $R" device_bindings_key_hash_key
run DENIED "$TX $CU1; $ADM; $DB1; $UB revoked_at=NOW(3),revoke_reason='FORGOTTEN' $WB; $R" device_bindings_revoked_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB key_hash=NULL $WB; $R" device_bindings_revoked_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB revoked_at=NOW(3),key_hash=NULL $WB; $R" device_bindings_revoked_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB revoked_at=NOW(3),revoke_reason='forgotten',key_hash=NULL $WB; $R" device_bindings_revoke_reason_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB key_hash=UPPER($H2) $WB; $R" device_bindings_key_hash_fmt_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB client_version='0.10' $WB; $R" device_bindings_client_version_fmt_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB client_version=CONCAT('0.10.0',CHAR(10)) $WB; $R" device_bindings_client_version_fmt_chk  # P14a AC-201
run DENIED "$TX $CU1; $ADM; $DB1; $UB issue_count=0 $WB; $R" device_bindings_issue_count_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB active_session_id=NULL $WB; $R" "generated column"
run DENIED "$TX $CU1; $ADM; $DB1; DELETE FROM device_bindings $WB; $R" "p16: device_bindings DELETE"  # P16
run DENIED "ALTER TABLE device_bindings ADD COLUMN x INT"
run DENIED "$TX $CU1; $GX; $ADM; $DBI ('00000000000000000000GRANTB','00000000000000000000GRANTX',NULL,$H1,'0.10.0','00000000000000000000GRANTS','00000000000000000000GRANTS',NOW(3),NOW(3)); $R" session_id_tenant_id_fkey
# support_requests / support_sessions müşteri + kayıt bağı (bileşik FK) ve yeni iptal nedenleri.
run OK     "$TX $CU1; $ADM; $DB1; $RQ; $UR customer_id='00000000000000000000GRANTK',binding_id='00000000000000000000GRANTB' $WR; $UR status='CANCELLED',cancel_reason='CUSTOMER_PASSIVE',closed_at=NOW(3) $WR; UPDATE support_sessions SET customer_id='00000000000000000000GRANTK' WHERE id='00000000000000000000GRANTS'; $R"
run OK     "$TX $RQ; $UR status='CANCELLED',cancel_reason='BINDING_REVOKED',closed_at=NOW(3) $WR; $R"
run DENIED "$TX $RQ; $UR status='CANCELLED',cancel_reason='customer_passive',closed_at=NOW(3) $WR; $R" support_requests_cancel_reason_chk
run DENIED "$TX $GX; $CU ('00000000000000000000GRANTL','00000000000000000000GRANTX','Grant Musteri','grant musteri','grant musteri','GrantMusteri','eeeeeeeeeeeeeeee',NOW(3)); $RQ; $UR customer_id='00000000000000000000GRANTL' $WR; $R" support_requests_tenant_id_customer_id_fkey
run DENIED "$TX $RQ; $UR binding_id='00000000000000000000NOBIND' $WR; $R" support_requests_binding_id_tenant_id_fkey
run DENIED "$TX $GX; $CU ('00000000000000000000GRANTL','00000000000000000000GRANTX','Grant Musteri','grant musteri','grant musteri','GrantMusteri','eeeeeeeeeeeeeeee',NOW(3)); $ADM; UPDATE support_sessions SET customer_id='00000000000000000000GRANTL' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_tenant_id_customer_id_fkey
# P10 recovery_codes (SELECT/INSERT/DELETE + UPDATE(used_at, updated_at)), password_reset_tokens (SELECT/INSERT +
# UPDATE(used_at, updated_at); DELETE P13), users TOTP CHECK'leri, tenant_settings SMTP CHECK'leri. Tümü geri alınan TX'te.
RC="INSERT INTO recovery_codes (id,user_id,code_hash,updated_at) VALUES"
RC1="$RC ('00000000000000000000GRANTQ','00000000000000000000GRANTU',$H1,NOW(3))"
PR="INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,updated_at) VALUES"
PR1="$PR ('00000000000000000000GRANTP','00000000000000000000GRANTU',$H1,NOW(3)+INTERVAL 30 MINUTE,NOW(3))"
UU="UPDATE users SET"; WU="WHERE id='00000000000000000000GRANTU'"
US="UPDATE tenant_settings SET"; WT="WHERE tenant_id='00000000000000000000GRANTT'"
SMTP_OK="smtp_host='smtp.example.com',smtp_port=587,smtp_security='STARTTLS',smtp_user='destek@example.com',smtp_pass_enc=RANDOM_BYTES(45),smtp_from_name='Nokta Destek',smtp_from_email='destek@example.com'"
run OK     "SELECT COUNT(*) FROM recovery_codes; SELECT COUNT(*) FROM password_reset_tokens"
run OK     "$TX $RC1,('00000000000000000000GRANTO','00000000000000000000GRANTU',$H2,NOW(3)); UPDATE recovery_codes SET used_at=NOW(3) WHERE user_id='00000000000000000000GRANTU' AND code_hash=$H1 AND used_at IS NULL; DELETE FROM recovery_codes WHERE user_id='00000000000000000000GRANTU'; $R"
run DENIED "UPDATE recovery_codes SET code_hash=$H2 WHERE id='00000000000000000000GRANTQ'"
run DENIED "UPDATE recovery_codes SET user_id='00000000000000000000GRANTU' WHERE id='00000000000000000000GRANTQ'"
run DENIED "ALTER TABLE recovery_codes ADD COLUMN x INT"
run DENIED "$TX $RC1; $RC1; $R" PRIMARY
run DENIED "$TX $RC1; $RC ('00000000000000000000GRANTO','00000000000000000000GRANTU',$H1,NOW(3)); $R" recovery_codes_user_id_code_hash_key
run DENIED "$TX $RC ('00000000000000000000GRANTQ','00000000000000000000GRANTU',UPPER($H2),NOW(3)); $R" recovery_codes_code_hash_fmt_chk
run DENIED "$TX $RC ('00000000000000000000GRANTQ','00000000000000000000GRANTU','ABCD-EFGH-12',NOW(3)); $R" recovery_codes_code_hash_fmt_chk
run DENIED "$TX $RC ('00000000000000000000GRANTQ','0000000000000000000NOUSER',$H1,NOW(3)); $R" recovery_codes_user_id_fkey
run OK     "$TX $PR1; UPDATE password_reset_tokens SET used_at=NOW(3) WHERE token_hash=$H1 AND used_at IS NULL AND expires_at > NOW(3); $R"
run OK     "START TRANSACTION; $PR1; DELETE FROM password_reset_tokens WHERE id='00000000000000000000GRANTP'; ROLLBACK"
run DENIED "UPDATE password_reset_tokens SET expires_at=NOW(3)+INTERVAL 1 DAY WHERE id='00000000000000000000GRANTP'"
run DENIED "UPDATE password_reset_tokens SET token_hash=$H2 WHERE id='00000000000000000000GRANTP'"
run DENIED "ALTER TABLE password_reset_tokens ADD COLUMN x INT"
run DENIED "$TX $PR1; $PR ('00000000000000000000GRANTO','00000000000000000000GRANTU',$H1,NOW(3)+INTERVAL 30 MINUTE,NOW(3)); $R" password_reset_tokens_token_hash_key
run DENIED "$TX $PR ('00000000000000000000GRANTP','00000000000000000000GRANTU',$H1,NOW(3)+INTERVAL 45 MINUTE,NOW(3)); $R" password_reset_tokens_ttl_chk
run DENIED "$TX $PR ('00000000000000000000GRANTP','00000000000000000000GRANTU',$H1,NOW(3)-INTERVAL 1 SECOND,NOW(3)); $R" password_reset_tokens_ttl_chk
run DENIED "$TX $PR ('00000000000000000000GRANTP','00000000000000000000GRANTU','plain-reset-token',NOW(3)+INTERVAL 30 MINUTE,NOW(3)); $R" password_reset_tokens_token_hash_fmt_chk
# users TOTP: setup (sır, etkin değil) → enable → adım ilerler → MFA sıfırlama (tek UPDATE).
run OK     "$TX $UU totp_secret_enc=RANDOM_BYTES(61) $WU; $UU totp_enabled=1,totp_last_step=59000000 $WU; $UU totp_last_step=59000001 $WU; $UU totp_secret_enc=NULL,totp_enabled=0,totp_last_step=NULL $WU; $R"
run DENIED "$TX $UU totp_enabled=1 $WU; $R" users_totp_enabled_chk
run DENIED "$TX $UU totp_secret_enc=RANDOM_BYTES(61),totp_enabled=1 $WU; $UU totp_secret_enc=NULL $WU; $R" users_totp_enabled_chk
run DENIED "$TX $UU totp_secret_enc=X'01020304' $WU; $R" users_totp_secret_enc_chk
run DENIED "$TX $UU totp_last_step=59000000 $WU; $R" users_totp_last_step_chk
run DENIED "$TX $UU totp_secret_enc=RANDOM_BYTES(61),totp_last_step=0 $WU; $R" users_totp_last_step_chk
# tenant_settings SMTP: tam yapılandırma; kimliksiz (NONE, 25); IPv6/IPv4 literal; tamamen temizleme.
run OK     "$TX $US $SMTP_OK $WT; $US smtp_user=NULL,smtp_pass_enc=NULL,smtp_security='NONE',smtp_port=25,smtp_host='[2001:db8::25]',smtp_from_name=NULL $WT; $US smtp_host='203.0.113.25' $WT; $US smtp_host=NULL,smtp_port=NULL,smtp_security=NULL,smtp_from_email=NULL $WT; $R"
run DENIED "$TX $US smtp_host='smtp.example.com' $WT; $R" tenant_settings_smtp_complete_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_from_email=NULL $WT; $R" tenant_settings_smtp_complete_chk
run DENIED "$TX $US smtp_from_name='Nokta' $WT; $R" tenant_settings_smtp_complete_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_user=NULL $WT; $R" tenant_settings_smtp_auth_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_pass_enc=X'00' $WT; $R" tenant_settings_smtp_pass_enc_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_port=0 $WT; $R" tenant_settings_smtp_port_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_port=65536 $WT; $R" tenant_settings_smtp_port_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_host=CONCAT('smtp.example.com',CHAR(13),CHAR(10)) $WT; $R" tenant_settings_smtp_host_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_host=CONCAT('smtp.example.com',CHAR(10)) $WT; $R" tenant_settings_smtp_host_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_host='smtp example.com' $WT; $R" tenant_settings_smtp_host_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_user=CONCAT('destek',CHAR(10)) $WT; $R" tenant_settings_smtp_user_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_from_name=CONCAT('Nokta',CHAR(13),CHAR(10),'Bcc: x@example.com') $WT; $R" tenant_settings_smtp_from_name_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_from_name=' Nokta' $WT; $R" tenant_settings_smtp_from_name_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_from_email='destek-example.com' $WT; $R" tenant_settings_smtp_from_email_chk
run DENIED "$TX $US $SMTP_OK $WT; $US smtp_security='starttls' $WT; $R" tenant_settings_smtp_security_chk
# P11 (mimari §3.3, AC-123): audit_logs tetikleyicileri + app'in onlara dokunamaması; system_settings yetki ve CHECK'leri.
# Tetikleyici varlığı ve app'in global/DB/tablo düzeyi DDL yetkisi app'e görünmez (TRIGGER yetkisi yok) → root ile
# (konteyner env MYSQL_ROOT_PASSWORD; compose, test-db.sh ve CI servisinde tanımlı).
run_root() { # $1 beklenen tek değer, $2 sql, $3 açıklama
  out=$(docker exec "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "$0" "$1"' "$2" "${DB:-remote}" 2>&1)
  [ "$out" = "$1" ] && s=PASS || { s=FAIL; FAILED=1; }
  printf '%s | beklenen=%-6s sonuç=%-6s | (root) %s\n' "$s" "$1" "$out" "$3"
}
run_root 3 "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='audit_logs' AND ((TRIGGER_NAME='audit_logs_no_update' AND EVENT_MANIPULATION='UPDATE') OR (TRIGGER_NAME='audit_logs_retention_only_delete' AND EVENT_MANIPULATION='DELETE') OR (TRIGGER_NAME='audit_logs_force_created_at' AND EVENT_MANIPULATION='INSERT')) AND ACTION_TIMING='BEFORE'" "audit_logs tetikleyicileri var (BEFORE UPDATE + DELETE + INSERT/P13a)"
run_root 23 "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=DATABASE()" "DB'de toplam tetikleyici = 23 (audit 3 + P16 19 + P18 1; backup.sh/restore-verify ile aynı)"
run_root "12,6,2" "SELECT CONCAT(SUM(EVENT_MANIPULATION='DELETE'),',',SUM(EVENT_MANIPULATION='UPDATE'),',',SUM(EVENT_MANIPULATION='INSERT')) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE '%\\_guard'" "P16+P18: 12 BEFORE DELETE, 6 BEFORE UPDATE, 2 BEFORE INSERT"
run_root 0 "SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND (DELETE_RULE<>'RESTRICT' OR UPDATE_RULE<>'RESTRICT')" "P16 (S16-11): bütün FK'ler RESTRICT (CASCADE/SET NULL tetikleyiciyi atlatır)"
run_root 0 "SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='tenants' AND TABLE_NAME IN ('audit_logs','tenant_purge_jobs')" "P16 (ADR-0030 m.1): audit_logs ve tenant_purge_jobs tenants'a FK taşımaz"
run_root 0 "SELECT (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND PRIVILEGE_TYPE<>'USAGE') + (SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\") + (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND PRIVILEGE_TYPE IN ('TRIGGER','ALTER','DROP','CREATE','INDEX','REFERENCES','GRANT OPTION'))" "app: global/DB yetkisi yok, hiçbir tabloda TRIGGER/ALTER/DROP/CREATE/INDEX yok"
run_root 0 "SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_NAME='audit_logs' AND PRIVILEGE_TYPE NOT IN ('SELECT','INSERT','DELETE')" "app: audit_logs yalnız SELECT/INSERT/DELETE (DELETE P13a)"
# P13a (K27) + P16 (ADR-0030 m.3): DELETE yetkisi tam olarak bu tablolarda; P16'nın 8 tablosunda koşul tetikleyicide.
run_root "audit_logs,auth_sessions,business_holidays,consent_texts,customer_notify_contacts,customers,device_bindings,notification_outbox,password_reset_tokens,recovery_codes,request_blocks,request_refs,session_consents,session_files,session_messages,session_recording_parts,session_recordings,session_stored_files,support_requests,support_sessions,tenant_purge_jobs,tenant_request_settings,tenant_settings,tenants,trusted_devices,unattended_device_grants,unattended_devices,unattended_registration_codes,user_permissions,users" "SELECT GROUP_CONCAT(TABLE_NAME ORDER BY CAST(TABLE_NAME AS BINARY)) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_SCHEMA=DATABASE() AND PRIVILEGE_TYPE='DELETE'" "app: DELETE yetkili tablo kümesi (K27)"
run_root "consent_texts.is_current:UPDATE,consent_texts.updated_at:UPDATE,password_reset_tokens.updated_at:UPDATE,password_reset_tokens.used_at:UPDATE,recovery_codes.updated_at:UPDATE,recovery_codes.used_at:UPDATE,session_consents.ip:UPDATE,session_consents.user_agent:UPDATE,session_recordings.delete_reason:UPDATE,session_recordings.deleted_at:UPDATE,session_recordings.duration_ms:UPDATE,session_recordings.part_count:UPDATE,session_recordings.recorder_user_id:UPDATE,session_recordings.size_bytes:UPDATE,session_recordings.state:UPDATE,session_recordings.stop_reason:UPDATE,session_recordings.stopped_at:UPDATE,session_recordings.updated_at:UPDATE,session_stored_files.deleted_at:UPDATE,session_stored_files.delivered_at:UPDATE,session_stored_files.expires_at:UPDATE,session_stored_files.scan_reason:UPDATE,session_stored_files.scanned_at:UPDATE,session_stored_files.signature:UPDATE,session_stored_files.state:UPDATE,session_stored_files.storage_rel:UPDATE,session_stored_files.updated_at:UPDATE" "SELECT GROUP_CONCAT(CONCAT(TABLE_NAME,'.',COLUMN_NAME,':',PRIVILEGE_TYPE) ORDER BY CAST(TABLE_NAME AS BINARY),CAST(COLUMN_NAME AS BINARY)) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_SCHEMA=DATABASE()" "app: sütun düzeyi yetki kümesi (P13a session_consents ip/user_agent, P28b, P28e)"
run_root 0 "SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_NAME='audit_logs'" "app: audit_logs sütun düzeyi UPDATE yok"
run DENIED "DROP TRIGGER audit_logs_force_created_at" "denied"
run DENIED "UPDATE audit_logs SET action='x' WHERE id=-1"
run DENIED "DROP TRIGGER audit_logs_no_update" "denied"
run DENIED "DROP TRIGGER audit_logs_retention_only_delete" "denied"
run DENIED "CREATE TRIGGER audit_logs_x BEFORE UPDATE ON audit_logs FOR EACH ROW SET @a=1" "denied"
run DENIED "RENAME TABLE audit_logs TO audit_logs_x" "denied"
run DENIED "ALTER TABLE audit_logs DROP INDEX audit_logs_created_at_idx" "denied"
SSI="INSERT INTO system_settings (\`key\`,value_json,secret_enc,updated_at) VALUES"
MY_OK="'{\"host\":\"db.internal\",\"port\":3306,\"database\":\"remote\",\"user\":\"rapor\"}'"
run OK     "SELECT COUNT(*) FROM system_settings"
run OK     "$TX $SSI ('mysql',$MY_OK,RANDOM_BYTES(45),NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc),updated_at=NOW(3); UPDATE system_settings SET secret_enc=NULL WHERE \`key\`='mysql'; $R"
run DENIED "DELETE FROM system_settings WHERE \`key\`='mysql'" "denied"
run DENIED "ALTER TABLE system_settings ADD COLUMN x INT" "denied"
run DENIED "$TX $SSI ('MYSQL',$MY_OK,NULL,NOW(3)); $R" system_settings_key_chk
run DENIED "$TX $SSI ('mysql','{\"host\":\"db\",\"port\":3306,\"database\":\"remote\",\"user\":\"rapor\",\"password\":\"x\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json); $R" system_settings_mysql_chk
run DENIED "$TX $SSI ('mysql',$MY_OK,X'00',NOW(3)) ON DUPLICATE KEY UPDATE secret_enc=VALUES(secret_enc); $R" system_settings_secret_enc_chk
run DENIED "$TX $SSI ('turn','{\"urls\":[\"turn:turn.example.com:3478\"]}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_turn_chk
# P12 (AC-81..85): yetki değişmedi (app tenants/users tablo düzeyi UPDATE, system_settings SELECT/INSERT/UPDATE).
# Yol biçimi `{tenant_id|system}/{[A-Za-z0-9_-]16..100}.{png|jpg|webp}`, öndek satırın tenant'ına bağlı; system_logo anahtarı.
GT="00000000000000000000GRANTT"; RND="Ab_-0123456789xyz"
run OK     "$TX UPDATE tenants SET logo_path='$GT/$RND.png' WHERE id='$GT'; UPDATE tenants SET logo_path=NULL WHERE id='$GT'; $R"
run OK     "$TX UPDATE users SET avatar_path='$GT/$RND.webp', theme='LIGHT' WHERE id='00000000000000000000GRANTU'; $R"
run DENIED "UPDATE tenants SET logo_path='$GT/../$RND.png' WHERE id='$GT'" tenants_logo_path_chk
run DENIED "UPDATE tenants SET logo_path='00000000000000000000OTHERT/$RND.png' WHERE id='$GT'" tenants_logo_path_chk
run DENIED "UPDATE tenants SET logo_path='$GT/$RND.svg' WHERE id='$GT'" tenants_logo_path_chk
run DENIED "UPDATE users SET avatar_path='system/$RND.jpg' WHERE id='00000000000000000000GRANTU'" users_avatar_path_chk
run DENIED "UPDATE users SET avatar_path=CONCAT('$GT/$RND.png',CHAR(10)) WHERE id='00000000000000000000GRANTU'" users_avatar_path_chk
run OK     "$TX $SSI ('system_logo','{\"path\":\"system/$RND.webp\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL,updated_at=NOW(3); $R"
run DENIED "$TX $SSI ('system_logo','{\"path\":\"$GT/$RND.webp\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_system_logo_chk
run DENIED "$TX $SSI ('System_Logo','{\"path\":\"system/$RND.webp\"}',NULL,NOW(3)); $R" system_settings_key_chk
# WhatsApp servis ayarı (20261114090000): yetki değişmedi; anahtar `whatsapp` ikili, value_json {url: null|http(s) adresi}.
run OK     "$TX $SSI ('whatsapp','{\"url\":\"http://203.0.113.10:3000\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL,updated_at=NOW(3); $R"
run OK     "$TX $SSI ('whatsapp','{\"url\":null}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL,updated_at=NOW(3); $R"
run DENIED "$TX $SSI ('WhatsApp','{\"url\":null}',NULL,NOW(3)); $R" system_settings_key_chk
run DENIED "$TX $SSI ('whatsapp','{\"url\":\"ftp://wa.example\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_whatsapp_chk
run DENIED "$TX $SSI ('whatsapp','{\"url\":\"http://u:p@wa.example\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_whatsapp_chk
run DENIED "$TX $SSI ('whatsapp','{\"url\":null,\"token\":\"x\"}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_whatsapp_chk
run DENIED "$TX $SSI ('whatsapp','{\"url\":null}',RANDOM_BYTES(45),NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc); $R" system_settings_whatsapp_chk
# 20261115090000_whatsapp_api_key (S-P13b-3): adres doluyken şifreli API anahtarı serbest; kısa blob genel CHECK'e çarpar.
run OK     "$TX $SSI ('whatsapp','{\"url\":\"https://wa.example\"}',RANDOM_BYTES(45),NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc),updated_at=NOW(3); $R"
run DENIED "$TX $SSI ('whatsapp','{\"url\":\"https://wa.example\"}',X'00',NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc); $R" system_settings_secret_enc_chk
run DENIED "$TX $SSI ('whatsapp','{\"url\":\"https://u:p@wa.example\"}',RANDOM_BYTES(45),NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc); $R" system_settings_whatsapp_chk
# P13a (AC-197): support_sessions_anonymized_chk — anonim oturumda kişisel alan yok, yalnız bitmiş oturum anonimleşir;
# ticket_no/kalite kalır. P13a WhatsApp CHECK'i += \p{Cf}\p{Zl}\p{Zp}.
END="UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='TECH',end_reason='ended' WHERE id='00000000000000000000GRANTS'"
FULL="UPDATE support_sessions SET customer_name='Ayse Yilmaz',customer_email='ayse@example.test',ticket_no='INC-1',note='not',guest_net_key='203.0.113.0/24',guest_ip_key='203.0.113.7',quality_summary=JSON_OBJECT('connType','relay') WHERE id='00000000000000000000GRANTS'"
ANON="UPDATE support_sessions SET customer_name=NULL,customer_email=NULL,note=NULL,guest_net_key=NULL,guest_ip_key=NULL,anonymized_at=NOW(3) WHERE id='00000000000000000000GRANTS'"
run OK     "$TX $ADM; $FULL; $END; $ANON; $R"
run OK     "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET status='EXPIRED',active_code=NULL,ended_at=NOW(3),ended_by='SYSTEM',end_reason='expired' WHERE id='00000000000000000000GRANTS'; $ANON; $R"
run DENIED "$TX $ADM; $FULL; $ANON; $R" support_sessions_anonymized_chk
run DENIED "$TX $ADM; $FULL; $END; UPDATE support_sessions SET customer_email=NULL,customer_name=NULL,anonymized_at=NOW(3) WHERE id='00000000000000000000GRANTS'; $R" support_sessions_anonymized_chk
run DENIED "$TX $ADM; $FULL; $END; $ANON; UPDATE support_sessions SET note='yeniden' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_anonymized_chk
run DENIED "$TX $ADM; $FULL; $END; $ANON; UPDATE support_sessions SET customer_name='Ayse Yilmaz' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_anonymized_chk
run DENIED "$TX $ADM; DELETE FROM support_sessions WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions DELETE"  # P16
WA() { echo "$TX $SSI ('whatsapp',JSON_OBJECT('url',CONCAT('http://wa.example',CONVERT(X'$1' USING utf8mb4))),NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R"; }
run DENIED "$(WA E2808B)" system_settings_whatsapp_chk   # U+200B sıfır genişlik (Cf)
run DENIED "$(WA E280AE)" system_settings_whatsapp_chk   # U+202E RTLO (Cf)
run DENIED "$(WA EFBBBF)" system_settings_whatsapp_chk   # U+FEFF BOM (Cf)
run DENIED "$(WA C2AD)" system_settings_whatsapp_chk     # U+00AD yumuşak tire (Cf)
run DENIED "$(WA E280A8)" system_settings_whatsapp_chk   # U+2028 (Zl)
run DENIED "$(WA E280A9)" system_settings_whatsapp_chk   # U+2029 (Zp)
run OK     "$(WA 2F6170692F7631)"                         # /api/v1
# P13b D2 (mimari-p13 §7.7): `reset-superadmin` CLI app ile tek TX'te çalışır — yeni grant GEREKMEZ. Yazdığı her ifade
# (users parola/kilit/MFA alanları, auth_sessions iptal, password_reset_tokens used_at, recovery_codes DELETE, audit INSERT).
SA="UPDATE users SET password_hash='\$argon2id\$x',must_change_password=1,failed_login_count=0,failed_window_at=NULL,locked_until=NULL,updated_at=NOW(3) $WU"
AS1="INSERT INTO auth_sessions (id,user_id,token_hash,ip,user_agent,last_seen_at,expires_at,updated_at) VALUES ('00000000000000000000GRANTZ','00000000000000000000GRANTU',$H1,'203.0.113.7','ua',NOW(3),NOW(3)+INTERVAL 1 HOUR,NOW(3))"
run OK     "$TX $AS1; $RC1; $PR1; $SA; UPDATE auth_sessions SET revoked_at=NOW(3),updated_at=NOW(3) WHERE user_id='00000000000000000000GRANTU' AND revoked_at IS NULL; UPDATE password_reset_tokens SET used_at=NOW(3),updated_at=NOW(3) WHERE user_id='00000000000000000000GRANTU' AND used_at IS NULL; $UU totp_enabled=0,totp_secret_enc=NULL,totp_last_step=NULL $WU; DELETE FROM recovery_codes WHERE user_id='00000000000000000000GRANTU'; INSERT INTO audit_logs (action,entity,entity_id,username,user_agent,result,new_value) VALUES ('auth.superadmin_reset','users','00000000000000000000GRANTU','cli','reset-superadmin-cli','success',JSON_OBJECT('mustChangePassword',TRUE,'mfaReset',TRUE,'revokedSessions',1)); $R"
# P15 (AC-233, 235, 238, 239 + P14 devri e-posta `\z`). request_blocks: SELECT/INSERT/DELETE, UPDATE/DDL yok; CHECK'ler.
RB="INSERT INTO request_blocks (id,tenant_id,kind,ip_from,ip_to,device_key_hash,expires_at,note,created_by) VALUES"
GU="'00000000000000000000GRANTU'"
run OK     "SELECT COUNT(*) FROM request_blocks"
run OK     "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('CB007100'),UNHEX('CB0071FF'),NULL,NOW(3)+INTERVAL 1 HOUR,'Spam',$GU),('00000000000000000000GRANTD','$GT','DEVICE',NULL,NULL,$H1,NULL,NULL,$GU),('00000000000000000000GRANT6','$GT','IP',UNHEX('20010DB8000100000000000000000000'),UNHEX('20010DB80001FFFFFFFFFFFFFFFFFFFF'),NULL,NULL,NULL,$GU); DELETE FROM request_blocks WHERE id='00000000000000000000GRANTB'; $R"
run DENIED "UPDATE request_blocks SET expires_at=NULL WHERE id='-'" "denied"
run DENIED "ALTER TABLE request_blocks ADD COLUMN x INT" "denied"
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','ip',UNHEX('CB007100'),UNHEX('CB0071FF'),NULL,NULL,NULL,$GU); $R" request_blocks_kind_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('CB007100'),UNHEX('CB0071FF'),$H1,NULL,NULL,$GU); $R" request_blocks_target_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,NULL,NULL,NULL,$GU); $R" request_blocks_target_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('CB000000'),UNHEX('CB00FFFF'),NULL,NULL,NULL,$GU); $R" request_blocks_ip_range_chk   # /16 > /24
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('CB007101'),UNHEX('CB0071FF'),NULL,NULL,NULL,$GU); $R" request_blocks_ip_range_chk   # ağ adresi değil
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('CB007100'),UNHEX('20010DB8000100000000000000000000'),NULL,NULL,NULL,$GU); $R" request_blocks_ip_range_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','IP',UNHEX('20010DB8000000000000000000000000'),UNHEX('20010DB8FFFFFFFFFFFFFFFFFFFFFFFF'),NULL,NULL,NULL,$GU); $R" request_blocks_ip_range_chk   # /32 > /48
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,UPPER($H1),NULL,NULL,$GU); $R" request_blocks_device_key_hash_fmt_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,CONCAT(REPEAT('a',63),CHAR(10)),NULL,NULL,$GU); $R" request_blocks_device_key_hash_fmt_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,$H1,NOW(3)-INTERVAL 1 MINUTE,NULL,$GU); $R" request_blocks_expires_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,$H1,NULL,' Spam',$GU); $R" request_blocks_note_chk
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,$H1,NULL,NULL,'00000000000000000000NOUSER'); $R" "foreign key"
run DENIED "$TX $RB ('00000000000000000000GRANTB','$GT','DEVICE',NULL,NULL,$H1,NULL,NULL,$GU),('00000000000000000000GRANTC','$GT','DEVICE',NULL,NULL,$H1,NULL,NULL,$GU); $R" "Duplicate"
# AC-233: logo kaldırma = {"path": null} (UPDATE); DELETE hâlâ yok (yukarıdaki mysql DELETE denemesiyle aynı tablo düzeyi).
run OK     "$TX $SSI ('system_logo','{\"path\":null}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL,updated_at=NOW(3); $R"
run DENIED "DELETE FROM system_settings WHERE \`key\`='system_logo'" "denied"
run DENIED "$TX $SSI ('system_logo','{\"path\":null}',RANDOM_BYTES(45),NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=VALUES(secret_enc); $R" system_settings_system_logo_chk
run DENIED "$TX $SSI ('system_logo','{}',NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),secret_enc=NULL; $R" system_settings_system_logo_chk
# mysql_chk: JSON şeması `$`'ı gerçek son (ECMAScript) → host/database sonundaki satır sonu zaten ret (P15 doğrulaması).
run DENIED "$TX $SSI ('mysql',JSON_OBJECT('host',CONCAT('db.internal',CHAR(10 USING utf8mb4)),'port',3306,'database','remote','user','rapor'),NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json); $R" system_settings_mysql_chk
run DENIED "$TX $SSI ('mysql',JSON_OBJECT('host','db.internal','port',3306,'database',CONCAT('remote',CHAR(13,10 USING utf8mb4)),'user','rapor'),NULL,NOW(3)) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json); $R" system_settings_mysql_chk
# AC-239 / AC-238: yeni sütunlar app'in mevcut tablo yetkisiyle yazılır; session_files UPDATE hâlâ yok.
run OK     "$TX $RS1; UPDATE tenant_request_settings SET require_accept_code=1 WHERE tenant_id='$GT'; $R"
run OK     "$TX $ADM; $SF ('00000000000000000000GRANTF','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK'); INSERT INTO session_files (id,session_id,tenant_id,direction,file_name,size_bytes,sha256,result,reported_by,match_key) VALUES ('00000000000000000000GRANTG','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK','CUSTOMER',$H2); $R"
run DENIED "$TX $ADM; INSERT INTO session_files (id,session_id,tenant_id,direction,file_name,size_bytes,sha256,result,reported_by) VALUES ('00000000000000000000GRANTG','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK','customer'); $R" session_files_reported_by_chk
run DENIED "$TX $ADM; INSERT INTO session_files (id,session_id,tenant_id,direction,file_name,size_bytes,sha256,result,match_key) VALUES ('00000000000000000000GRANTG','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK',CONCAT(REPEAT('a',63),CHAR(10))); $R" session_files_match_key_fmt_chk
run DENIED "$TX $ADM; INSERT INTO session_files (id,session_id,tenant_id,direction,file_name,size_bytes,sha256,result,match_key) VALUES ('00000000000000000000GRANTG','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK',$H2),('00000000000000000000GRANTH','00000000000000000000GRANTS','$GT','TO_CUSTOMER','rapor.pdf',1024,$H1,'OK',$H2); $R" "Duplicate"
run DENIED "UPDATE session_files SET reported_by='TECH' WHERE id='-'" "denied"
# P14 devri: 4 e-posta CHECK'i `\z` (sondaki satır sonu ret).
run OK     "$TX UPDATE tenant_settings SET smtp_host='smtp.example.com',smtp_port=465,smtp_security='SSL',smtp_from_email='a@b.test' WHERE tenant_id='$GT'; $R"
run DENIED "$TX UPDATE tenant_settings SET smtp_host='smtp.example.com',smtp_port=465,smtp_security='SSL',smtp_from_email=CONCAT('a@b.test',CHAR(13,10)) WHERE tenant_id='$GT'; $R" tenant_settings_smtp_from_email_chk
run DENIED "$TX $ADM; UPDATE support_sessions SET customer_name='Ayse Yilmaz',customer_email=CONCAT('a@b.test',CHAR(10)) WHERE id='00000000000000000000GRANTS'; $R" support_sessions_customer_email_chk
# P16 (ADR-0030 m.3–m.5, mimari-e11 §7.1; AC-240..242; S16-2,3,4,10,15): 19 tetikleyici, tenant_purge_jobs, mezar taşı,
# tenants.passive_at. app DELETE yetkisi 8 tabloda var, koşul tetikleyicide (`p16:` önekli SIGNAL). Geçmiş tarihli
# fikstürler migrator ile (tetikleyiciden muaf; P13a kalıbı), sonra app ile denenir.
GJ="'00000000000000000000GRANTJ'"; GW="00000000000000000000GRANTW"
PJ="INSERT INTO tenant_purge_jobs (id,tenant_id,scheduled_for,counts,preview_hash,started_by,updated_at) VALUES"
PJ1="$PJ ($GJ,'$GT',NOW(3),'{}',$H1,$GU,NOW(3))"
UJ="UPDATE tenant_purge_jobs SET"; WJ="WHERE id=$GJ"
PAS="UPDATE tenants SET status='PASSIVE' WHERE id='$GT'"
TOMB="UPDATE users SET status='DELETED',deleted_at=NOW(3),email=CONCAT('deleted+',id,'@invalid'),username=NULL,password_hash='!deleted',avatar_path=NULL,totp_secret_enc=NULL,full_name='Silinmis kullanici #GRANTU' $WU"
UTC30="UTC_TIMESTAMP(3) - INTERVAL"
# Negatifler (§7.1 listesi)
run DENIED "$TX $ADM; $FULL; $END; $ANON; DELETE FROM support_sessions WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions DELETE"   # taze anonim oturum
run DENIED "$TX $RQ; $UR status='EXPIRED',closed_at=NOW(3) $WR; $UR customer_name=NULL,customer_phone=NULL,customer_email=NULL,description=NULL,ip=NULL,ip_key=NULL,net_key=NULL,device_hash=NULL,anonymized_at=NOW(3) $WR; DELETE FROM support_requests $WR; $R" "p16: support_requests DELETE"
run DENIED "$TX $CU1; $ADM; $DB1; $REV; DELETE FROM device_bindings $WB; $R" "p16: device_bindings DELETE"   # taze geçersiz kayıt
run DENIED "$TX $CU1; DELETE FROM customers $WC; $R" "p16: customers DELETE"   # aktif firma müşterisi
run DENIED "$TX INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTA',NULL,'grant-sa@invalid.test','Grant SA','SUPER_ADMIN','x',NOW(3)); DELETE FROM users WHERE id='00000000000000000000GRANTA'; $R" "p16: users DELETE"   # Super Admin
run DENIED "DELETE FROM users $WU" "p16: users DELETE"   # firma kullanıcısı, iş yok
run DENIED "DELETE FROM tenants WHERE id='$GT'" "p16: tenants DELETE"
run_val 1 "$TX $PAS; UPDATE tenants SET passive_at='2000-01-01' WHERE id='$GT'; SELECT passive_at > UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE FROM tenants WHERE id='$GT'; $R" "passive_at geri tarihleme yok sayılır (zorlanan değer)"
run_val 1 "$TX UPDATE tenants SET status='PASSIVE',passive_at='2000-01-01' WHERE id='$GT'; SELECT passive_at > UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE FROM tenants WHERE id='$GT'; $R" "PASSIVE geçişinde passive_at = DB saati"
run_val 1 "$TX $GX; UPDATE tenants SET status='PASSIVE' WHERE id='00000000000000000000GRANTX'; UPDATE tenants SET status='ACTIVE',passive_at=NOW(3) WHERE id='00000000000000000000GRANTX'; SELECT passive_at IS NULL FROM tenants WHERE id='00000000000000000000GRANTX'; $R" "ACTIVE'e dönüşte passive_at NULL"
run_val 1 "$TX INSERT INTO tenants (id,name,slug,status,passive_at,updated_at) VALUES ('00000000000000000000GRANTX','grant-x','grant-test-x','PASSIVE','2000-01-01',NOW(3)); SELECT passive_at > UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE FROM tenants WHERE id='00000000000000000000GRANTX'; $R" "INSERT'te passive_at zorlanır"
run OK     "$TX UPDATE users SET status='PASSIVE' $WU; $TOMB; $R"   # mezar taşı geçişi
run DENIED "$TX UPDATE users SET status='PASSIVE' $WU; $TOMB; UPDATE users SET theme='DARK' $WU; $R" "p16: users tombstone"
run DENIED "$TX UPDATE users SET status='DELETED' $WU; $R" users_deleted_chk
run DENIED "$TX $TOMB; UPDATE users SET email='x@y.test' $WU; $R" "p16: users tombstone"
run DENIED "$TX UPDATE users SET status='DELETED',deleted_at=NOW(3),email='baska@invalid',username=NULL,password_hash='!deleted' $WU; $R" users_deleted_chk
run DENIED "$TX UPDATE users SET deleted_at=NOW(3) $WU; $R" users_deleted_chk
run_val 1 "$TX $PAS; $PJ1; SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(3), scheduled_for) BETWEEN 1439 AND 1440 AND state='SCHEDULED' AND step='FENCE' FROM tenant_purge_jobs WHERE id=$GJ; $R" "iş SCHEDULED açılır, scheduled_for = DB saati + 24 sa"
run DENIED "$TX $PAS; $PJ1; UPDATE tenants SET status='ACTIVE' WHERE id='$GT'; $R" "p16: tenants status change"   # açık işte yeniden etkinleştirme
run OK     "$TX $PAS; $PJ1; $UJ state='CANCELLED',cancelled_by=$GU $WJ; UPDATE tenants SET status='ACTIVE' WHERE id='$GT'; $R"   # iptal sonrası serbest
run DENIED "$TX $PAS; $PJ1; $UJ state='CANCELLED',cancelled_by=$GU $WJ; $UJ attempts=1 $WJ; $R" "p16: tenant_purge_jobs DONE/CANCELLED"
run DENIED "$TX $PAS; $PJ1; $PJ ('00000000000000000000GRANTK','$GT',NOW(3),'{}',$H2,$GU,NOW(3)); $R" tenant_purge_jobs_one_open_uq
run DENIED "$TX $PJ ($GJ,'$GT',NOW(3),'{}',$H1,$GU,NOW(3)); $PJ ('00000000000000000000GRANTK','$GT',NOW(3),'{}',$H1,$GU,NOW(3)); $R" "Duplicate"   # preview_hash tek kullanım
run DENIED "$TX INSERT INTO tenant_purge_jobs (id,tenant_id,state,scheduled_for,counts,preview_hash,started_by,updated_at) VALUES ($GJ,'$GT','RUNNING',NOW(3),'{}',$H1,$GU,NOW(3)); $R" "p16: tenant_purge_jobs INSERT"
run DENIED "$TX INSERT INTO tenant_purge_jobs (id,tenant_id,step,scheduled_for,counts,preview_hash,started_by,updated_at) VALUES ($GJ,'$GT','FILES',NOW(3),'{}',$H1,$GU,NOW(3)); $R" "p16: tenant_purge_jobs INSERT"
run DENIED "$TX $PAS; $PJ1; $UJ state='RUNNING' $WJ; $R" "p16: tenant_purge_jobs state transition"   # scheduled_for dolmadan RUNNING
run DENIED "$TX $PAS; $PJ1; $UJ scheduled_for=NOW(3) - INTERVAL 1 DAY $WJ; $R" "immutable"
run DENIED "$TX $PJ ($GJ,'system',NOW(3),'{}',$H1,$GU,NOW(3)); $R" tenant_purge_jobs_tenant_id_fmt_chk
run DENIED "$TX $PJ ($GJ,'..',NOW(3),'{}',$H1,$GU,NOW(3)); $R" tenant_purge_jobs_tenant_id_fmt_chk
run DENIED "$TX $PJ ($GJ,LOWER('$GT'),NOW(3),'{}',$H1,$GU,NOW(3)); $R" tenant_purge_jobs_tenant_id_fmt_chk
run DENIED "$TX $PAS; $PJ1; $UJ last_error='Bad Error' $WJ; $R" tenant_purge_jobs_last_error_chk
run DENIED "$TX $PAS; $PJ1; DELETE FROM tenant_purge_jobs $WJ; $R" "p16: tenant_purge_jobs DELETE"
run DENIED "$TX $ADM; $FULL; $END; UPDATE support_sessions SET customer_name=NULL,customer_email=NULL,note=NULL,guest_net_key=NULL,guest_ip_key=NULL,anonymized_at='2000-01-01' WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions.anonymized_at"
run DENIED "$TX $ADM; $FULL; $END; UPDATE support_sessions SET customer_name=NULL,customer_email=NULL,note=NULL,guest_net_key=NULL,guest_ip_key=NULL,anonymized_at=NOW(3)+INTERVAL 1 DAY WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions.anonymized_at"
run DENIED "$TX $ADM; $FULL; $END; $ANON; UPDATE support_sessions SET anonymized_at=NOW(3)-INTERVAL 1 HOUR WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions.anonymized_at"
run DENIED "$TX $ADM; $FULL; $END; $ANON; UPDATE support_sessions SET anonymized_at=NULL WHERE id='00000000000000000000GRANTS'; $R" "p16: support_sessions.anonymized_at"
run DENIED "$TX $RQ; $UR status='EXPIRED',closed_at=NOW(3) $WR; $UR customer_name=NULL,customer_phone=NULL,customer_email=NULL,description=NULL,ip=NULL,ip_key=NULL,net_key=NULL,device_hash=NULL,anonymized_at='2000-01-01' $WR; $R" "p16: support_requests.anonymized_at"
run DENIED "$TX $CU1; $ADM; $DB1; $UB revoked_at='2000-01-01',revoke_reason='FORGOTTEN',key_hash=NULL $WB; $R" "p16: device_bindings.revoked_at"
run DENIED "$TX $CU1; $ADM; $DB1; $REV; $UB revoked_at=NOW(3)-INTERVAL 1 HOUR $WB; $R" "p16: device_bindings.revoked_at"   # dolu revoked_at değişimi
# Migrator fikstürü: 29 g anonim oturum → SIGNAL, 31 g → OK (üst oturum 31 g ise onay satırı da silinir).
SSX="INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,ended_at,created_at,updated_at) VALUES"
run_mig OK "$SSX ('00000000000000000000GRANT7',$T,$H1,NULL,'0427','EXPIRED',$E15,NOW(3),NOW(3),NOW(3)),('00000000000000000000GRANT8',$T,$H2,NULL,'0427','EXPIRED',$E15,NOW(3),NOW(3),NOW(3)); UPDATE support_sessions SET anonymized_at=$UTC30 29 DAY WHERE id='00000000000000000000GRANT7'; UPDATE support_sessions SET anonymized_at=$UTC30 31 DAY WHERE id='00000000000000000000GRANT8'; INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source) VALUES ('00000000000000000000GRANT9','00000000000000000000GRANT8','$GT','VIEW','DENIED','SYSTEM'),('0000000000000000000GRANT10','00000000000000000000GRANT7','$GT','VIEW','DENIED','SYSTEM')"
run DENIED "DELETE FROM session_consents WHERE id='0000000000000000000GRANT10'" "p16: session_consents DELETE"
run DENIED "DELETE FROM support_sessions WHERE id='00000000000000000000GRANT7'" "p16: support_sessions DELETE"   # 29 g
run OK     "DELETE FROM session_consents WHERE id='00000000000000000000GRANT9'; DELETE FROM support_sessions WHERE id='00000000000000000000GRANT8'"   # 31 g
run_val 0 "SELECT COUNT(*) FROM support_sessions WHERE id='00000000000000000000GRANT8'" "31 g anonim oturum silindi"
run_mig OK "DELETE FROM session_consents WHERE id='0000000000000000000GRANT10'; DELETE FROM support_sessions WHERE id='00000000000000000000GRANT7'"
# RUNNING iş (migrator fikstürü) — aktif firmada kilit açılmaz (S16-2), satır silinemez, adım atlanamaz (S16-15).
run_mig OK "INSERT INTO tenant_purge_jobs (id,tenant_id,state,step,scheduled_for,counts,preview_hash,started_by,started_at,updated_at) VALUES ($GJ,'$GT','RUNNING','FENCE',NOW(3),'{}',$H1,$GU,NOW(3),NOW(3))"
run DENIED "DELETE FROM tenant_purge_jobs $WJ" "p16: tenant_purge_jobs DELETE"   # RUNNING iş satırı
run DENIED "$TX $CU1; DELETE FROM customers $WC; $R" "p16: customers DELETE"   # RUNNING iş ama firma ACTIVE
run DENIED "$UJ step='BINDINGS' $WJ" "p16: tenant_purge_jobs step"
run DENIED "$UJ tenant_row_deleted_at=NOW(3) $WJ" "p16: tenant_row_deleted_at"
run OK     "$TX $UJ step='SESSION_FILES',heartbeat_at=NOW(3),counts=JSON_OBJECT('session_files',0),attempts=attempts+1 $WJ; $R"
run DENIED "$UJ state='DONE',step='DONE' $WJ" "p16: tenant_purge_jobs step"
run DENIED "$UJ preview_hash=$H2 $WJ" "p16: tenant_purge_jobs preview_hash"
run DENIED "$TX $UJ state='FAILED',last_error='db_signal' $WJ; $UJ state='RUNNING' $WJ; $R" "requires a new preview_hash"
run OK     "$TX $UJ state='FAILED',last_error='db_signal' $WJ; $UJ state='RUNNING',preview_hash=$H2 $WJ; $R"
run DENIED "$TX $UJ state='FAILED' $WJ; UPDATE tenants SET status='PASSIVE' WHERE id='$GT'; $R" "p16: tenants status change"
run_mig OK "DELETE FROM tenant_purge_jobs WHERE id=$GJ"
# Uçtan uca firma silme (migrator fikstürü: PASSIVE + 31 g, RUNNING iş): kilit açılır; SCHEDULED/29 g açmaz.
WCU="INSERT INTO customers (id,tenant_id,name,name_key,search_key,file_label,request_ref,updated_at) VALUES ('00000000000000000000GRANTY','$GW','Grant W','grant w','grant w','GrantW','wwwwwwwwwwwwwwww',NOW(3))"
run_mig OK "INSERT INTO tenants (id,name,slug,status,passive_at,updated_at) VALUES ('$GW','grant-w','grant-test-w','PASSIVE',$UTC30 31 DAY,NOW(3)); $WCU; INSERT INTO tenant_purge_jobs (id,tenant_id,scheduled_for,counts,preview_hash,started_by,updated_at) VALUES ($GJ,'$GW',NOW(3),'{}',$H1,$GU,NOW(3))"
run DENIED "DELETE FROM customers WHERE tenant_id='$GW'" "p16: customers DELETE"   # SCHEDULED iş kilidi açmaz
run_mig OK "UPDATE tenant_purge_jobs SET state='RUNNING',step='CUSTOMERS',started_at=NOW(3) WHERE id=$GJ"
run OK     "$TX DELETE FROM customers WHERE tenant_id='$GW'; $R"
run DENIED "$TX DELETE FROM customers WHERE tenant_id='$GW'; DELETE FROM tenants WHERE id='$GW'; $R" "p16: tenants DELETE"   # adım TENANT_ROW değil
run_mig OK "UPDATE tenants SET passive_at=$UTC30 29 DAY WHERE id='$GW'"
run DENIED "DELETE FROM customers WHERE tenant_id='$GW'" "p16: customers DELETE"   # 29 g
run_mig OK "UPDATE tenants SET passive_at=$UTC30 31 DAY WHERE id='$GW'; UPDATE tenant_purge_jobs SET step='TENANT_ROW' WHERE id=$GJ"
run DENIED "$UJ tenant_row_deleted_at=NOW(3) $WJ" "p16: tenant_row_deleted_at"   # firma satırı hâlâ var
run_val 1 "$TX DELETE FROM customers WHERE tenant_id='$GW'; DELETE FROM tenants WHERE id='$GW'; $UJ tenant_row_deleted_at='2000-01-01',step='FILES' $WJ; SELECT tenant_row_deleted_at > UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE FROM tenant_purge_jobs $WJ; $R" "TENANT_ROW: firma satırı silinir, tenant_row_deleted_at DB saatiyle"
run_mig OK "DELETE FROM tenant_purge_jobs WHERE id=$GJ; DELETE FROM customers WHERE id='00000000000000000000GRANTY'; DELETE FROM tenants WHERE id='$GW'"
# DONE/CANCELLED iş satırı yalnız 730 g sonra (S16-10).
run_mig OK "INSERT INTO tenant_purge_jobs (id,tenant_id,state,step,scheduled_for,counts,preview_hash,started_by,tenant_row_deleted_at,finished_at,updated_at) VALUES ($GJ,'$GW','DONE','DONE',NOW(3),'{}',$H1,$GU,NOW(3),$UTC30 729 DAY,NOW(3))"
run DENIED "DELETE FROM tenant_purge_jobs $WJ" "p16: tenant_purge_jobs DELETE"
run_mig OK "UPDATE tenant_purge_jobs SET finished_at=$UTC30 731 DAY WHERE id=$GJ"
run OK     "DELETE FROM tenant_purge_jobs $WJ"
run_mig OK "DELETE FROM tenant_purge_jobs WHERE id=$GJ"
# P18 (mimari-e11 §8b.1 + §8b.13; AC-255..258; S-P18-T5/T11): session_messages (SELECT/INSERT/DELETE; UPDATE yok),
# business_holidays (SELECT/INSERT/DELETE), talep/müşteri/ayar sütunları ve CHECK'leri, session_messages_delete_guard
# (`p18:`), bileşik atama FK'si. Tümü geri alınan TX'te; firma silme fikstürü migrator ile.
SM="INSERT INTO session_messages (id,tenant_id,request_id,session_id,sender,sender_user_id,client_msg_id,body_enc,body_chars) VALUES"
GM="'00000000000000000000GRANTM'"; GRR="'00000000000000000000GRANTR'"; GRS="'00000000000000000000GRANTS'"
M1="$SM ($GM,'$GT',$GRR,NULL,'TECH',$GU,'msg-1_a',RANDOM_BYTES(31),2)"
M2="$SM ('00000000000000000000GRANTN','$GT',$GRR,NULL,'CUSTOMER',NULL,'msg-1_a',REPEAT(X'AB',29+4*1000),1000)"
RANON="$UR status='EXPIRED',closed_at=NOW(3) $WR; $UR customer_name=NULL,customer_phone=NULL,customer_email=NULL,description=NULL,ip=NULL,ip_key=NULL,net_key=NULL,device_hash=NULL,anonymized_at=NOW(3) $WR"
HB="INSERT INTO business_holidays (id,tenant_id,day,name,open_until,created_by) VALUES"
H18="$HB ('00000000000000000000GRANTH','$GT','2026-10-28','Cumhuriyet Bayrami arifesi','13:00',$GU)"
WK="'[[{\"from\":\"09:00\",\"to\":\"12:30\"},{\"from\":\"13:30\",\"to\":\"18:00\"}],[{\"from\":\"09:00\",\"to\":\"18:00\"}],[{\"from\":\"09:00\",\"to\":\"18:00\"}],[{\"from\":\"09:00\",\"to\":\"18:00\"}],[{\"from\":\"09:00\",\"to\":\"18:00\"}],[{\"from\":\"10:00\",\"to\":\"24:00\"}],[]]'"
URS="UPDATE tenant_request_settings SET"; WRS="WHERE tenant_id='$GT'"
run OK     "SELECT COUNT(*) FROM session_messages; SELECT COUNT(*) FROM business_holidays"
run OK     "$TX $RQ; $M1; $M2; $R"
run OK     "$TX $RQ; $ACC; $UR priority='HIGH',assigned_to=$GU,assigned_at=NOW(3),sla_minutes=30,sla_due_at=created_at+INTERVAL 30 MINUTE,after_hours=1 $WR; $R"
run OK     "$TX $RQ; $UR sla_minutes=30 $WR; $R"   # dakika var, takvimde açık an yok → due NULL
run OK     "$TX $RS1; $URS default_priority='LOW',default_sla_minutes=1440,time_zone='America/Argentina/Buenos_Aires',business_hours=$WK,hours_enabled=1,after_hours_mode='REJECT' $WRS; $URS time_zone='Etc/GMT+3' $WRS; $R"
run OK     "$TX $CU1; UPDATE customers SET default_priority='HIGH',sla_minutes=5 $WC; $R"
run OK     "$TX $H18; $HB ('00000000000000000000GRANTI','$GT','2026-10-29','Cumhuriyet Bayrami',NULL,$GU); DELETE FROM business_holidays WHERE tenant_id='$GT'; $R"
# §8b.1 negatifleri
run DENIED "$TX $RQ; $M1; DELETE FROM session_messages WHERE id=$GM; $R" "p18: session_messages DELETE"   # anonim olmayan talep
run OK     "$TX $RQ; $M1; $RANON; DELETE FROM session_messages WHERE request_id=$GRR; $R"                      # anonim talep (aynı TX)
run DENIED "UPDATE session_messages SET body_chars=1 WHERE id=$GM" "command denied"
run DENIED "UPDATE business_holidays SET name='x' WHERE id='-'" "command denied"
run DENIED "ALTER TABLE session_messages ADD COLUMN x INT" "denied"
run DENIED "DROP TRIGGER session_messages_delete_guard" "denied"
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'TECH',NULL,NULL,RANDOM_BYTES(31),2); $R" session_messages_sender_user_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'CUSTOMER',$GU,NULL,RANDOM_BYTES(31),2); $R" session_messages_sender_user_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'customer',NULL,NULL,RANDOM_BYTES(31),2); $R" session_messages_sender_chk
run DENIED "$TX $SM ($GM,'$GT',NULL,NULL,'CUSTOMER',NULL,NULL,RANDOM_BYTES(31),2); $R" session_messages_parent_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'CUSTOMER',NULL,'a b',RANDOM_BYTES(31),2); $R" session_messages_client_msg_id_fmt_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'CUSTOMER',NULL,CONCAT('abc',CHAR(10)),RANDOM_BYTES(31),2); $R" session_messages_client_msg_id_fmt_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'CUSTOMER',NULL,NULL,REPEAT(X'AB',29+4*1001),1001); $R" session_messages_body_chars_chk
run DENIED "$TX $RQ; $SM ($GM,'$GT',$GRR,NULL,'CUSTOMER',NULL,NULL,'duz metin govde',2); $R" session_messages_body_enc_chk
run DENIED "$TX $RQ; $M1; $SM ('00000000000000000000GRANTN','$GT',$GRR,NULL,'TECH',$GU,'msg-1_a',RANDOM_BYTES(31),2); $R" "Duplicate"   # aynı client_msg_id
run DENIED "$TX $GX; $RQ; $SM ($GM,'00000000000000000000GRANTX',$GRR,NULL,'CUSTOMER',NULL,NULL,RANDOM_BYTES(31),2); $R" "foreign key"   # başka tenant'ın talebi
run DENIED "$TX $RQ; $UR priority='URGENT' $WR; $R" support_requests_priority_chk
run DENIED "$TX $RQ; $UR priority='high' $WR; $R" support_requests_priority_chk
run DENIED "$TX $RQ; $UR assigned_to=$GU $WR; $R" support_requests_assigned_chk
run DENIED "$TX $RQ; $UR sla_minutes=4 $WR; $R" support_requests_sla_minutes_chk
run DENIED "$TX $RQ; $UR sla_due_at=NOW(3)+INTERVAL 1 HOUR $WR; $R" support_requests_sla_due_chk   # dakikasız due
run DENIED "$TX $RQ; $UR sla_minutes=30,sla_due_at=created_at-INTERVAL 1 MINUTE $WR; $R" support_requests_sla_due_chk
# S-P18-T5: atanan aynı tenant'ta (bileşik FK) — başka tenant kullanıcısı ve Super Admin → 1452.
run DENIED "$TX $GX; INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTA','00000000000000000000GRANTX','grant-x@invalid.test','Grant X','USER','x',NOW(3)); $RQ; $UR assigned_to='00000000000000000000GRANTA',assigned_at=NOW(3) $WR; $R" "foreign key constraint fails"
run DENIED "$TX INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTA',NULL,'grant-sa@invalid.test','Grant SA','SUPER_ADMIN','x',NOW(3)); $RQ; $UR assigned_to='00000000000000000000GRANTA',assigned_at=NOW(3) $WR; $R" "foreign key constraint fails"
run DENIED "$TX $CU1; UPDATE customers SET sla_minutes=1441 $WC; $R" customers_sla_minutes_chk
run DENIED "$TX $CU1; UPDATE customers SET default_priority='URGENT' $WC; $R" customers_default_priority_chk
run DENIED "$TX $RS1; $URS default_priority='normal' $WRS; $R" tenant_request_settings_default_priority_chk
run DENIED "$TX $RS1; $URS default_sla_minutes=0 $WRS; $R" tenant_request_settings_default_sla_chk
run DENIED "$TX $RS1; $URS time_zone='Europe/Istanbul;x' $WRS; $R" tenant_request_settings_time_zone_chk
run DENIED "$TX $RS1; $URS time_zone=CONCAT('Europe/Istanbul',CHAR(10)) $WRS; $R" tenant_request_settings_time_zone_chk
run DENIED "$TX $RS1; $URS after_hours_mode='DROP' $WRS; $R" tenant_request_settings_after_hours_mode_chk
run DENIED "$TX $RS1; $URS hours_enabled=1 $WRS; $R" tenant_request_settings_hours_enabled_chk
run DENIED "$TX $RS1; $URS business_hours='[[],[],[],[],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk   # 8 gün
run DENIED "$TX $RS1; $URS business_hours='[[{\"from\":\"18:00\",\"to\":\"09:00\"}],[],[],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk   # from > to
run DENIED "$TX $RS1; $URS business_hours='[[],[],[{\"from\":\"09:00\",\"to\":\"13:00\"},{\"from\":\"12:00\",\"to\":\"18:00\"}],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk   # örtüşme
run DENIED "$TX $RS1; $URS business_hours='[[{\"from\":\"09:00\",\"to\":\"24:30\"}],[],[],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk
run DENIED "$TX $RS1; $URS business_hours='[[{\"from\":\"09:00\",\"to\":\"18:00\",\"x\":1}],[],[],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk
run DENIED "$TX $RS1; $URS business_hours='[[{\"from\":\"08:00\",\"to\":\"09:00\"},{\"from\":\"10:00\",\"to\":\"11:00\"},{\"from\":\"12:00\",\"to\":\"13:00\"}],[],[],[],[],[],[]]' $WRS; $R" tenant_request_settings_business_hours_chk   # 3 aralık
run DENIED "$TX $H18; $HB ('00000000000000000000GRANTI','$GT','2026-10-28','Tekrar',NULL,$GU); $R" "Duplicate"
run DENIED "$TX $HB ('00000000000000000000GRANTH','$GT','2026-10-28',' Bayram',NULL,$GU); $R" business_holidays_name_chk
run DENIED "$TX $HB ('00000000000000000000GRANTH','$GT','2026-10-28',CONCAT('Bayram',CHAR(10)),NULL,$GU); $R" business_holidays_name_chk
run DENIED "$TX $HB ('00000000000000000000GRANTH','$GT','2026-10-28','Bayram','00:00',$GU); $R" business_holidays_open_until_chk
run DENIED "$TX $HB ('00000000000000000000GRANTH','$GT','2026-10-28','Bayram','13:00:30',$GU); $R" business_holidays_open_until_chk
# S-P18-T11: iki bağlı satır (talep + oturum; P22) — yalnız talep anonimken SIGNAL, ikisi anonimken OK.
M3="$SM ($GM,'$GT',$GRR,$GRS,'CUSTOMER',NULL,NULL,RANDOM_BYTES(31),2)"
run DENIED "$TX $RQ; $ADM; $M3; $RANON; DELETE FROM session_messages WHERE id=$GM; $R" "p18: session_messages DELETE"
run DENIED "$TX $RQ; $ADM; $M3; $END; $ANON; DELETE FROM session_messages WHERE id=$GM; $R" "p18: session_messages DELETE"   # yalnız oturum anonim
run OK     "$TX $RQ; $ADM; $M3; $END; $ANON; $RANON; DELETE FROM session_messages WHERE id=$GM; $R"
# Firma silme: RUNNING iş (PASSIVE 31 g) kilidi açar; iş yokken SIGNAL. Fikstür migrator ile (tetikleyiciden muaf).
run_mig OK "INSERT INTO tenants (id,name,slug,status,passive_at,updated_at) VALUES ('$GW','grant-w','grant-test-w','PASSIVE',$UTC30 31 DAY,NOW(3)); ${RQ//00000000000000000000GRANTT/$GW}; $SM ($GM,'$GW',$GRR,NULL,'CUSTOMER',NULL,NULL,RANDOM_BYTES(31),2)"
run DENIED "DELETE FROM session_messages WHERE tenant_id='$GW'" "p18: session_messages DELETE"
run_mig OK "INSERT INTO tenant_purge_jobs (id,tenant_id,state,step,scheduled_for,counts,preview_hash,started_by,started_at,updated_at) VALUES ($GJ,'$GW','RUNNING','MESSAGES',NOW(3),'{}',$H1,$GU,NOW(3),NOW(3))"
run OK     "$TX DELETE FROM session_messages WHERE tenant_id='$GW'; $R"
run OK     "$TX $UJ step='REQUEST_UNLINK' $WJ; $R"   # MESSAGES → REQUEST_UNLINK (+1)
run DENIED "$UJ step='BINDINGS' $WJ" "p16: tenant_purge_jobs step"
run_mig OK "DELETE FROM tenant_purge_jobs WHERE id=$GJ; DELETE FROM session_messages WHERE id=$GM; DELETE FROM support_requests WHERE id=$GRR; DELETE FROM consent_texts WHERE tenant_id='$GW'; DELETE FROM tenants WHERE id='$GW'"
# P19 (mimari-e11 §8c.1; AC-259..261; S-P19-12, S-P19-T5): support_requests.source + bildirim bayrakları (WEB ⇔
# client_version NULL), tenant_request_settings web formu/bildirim anahtarları, tenant_settings SMS sütunları ve CHECK'leri,
# notification_outbox (SELECT/INSERT/UPDATE/DELETE; tetikleyici yok) ve CHECK/UQ/FK'leri. Tümü geri alınan TX'te.
OB="INSERT INTO notification_outbox (id,tenant_id,request_id,kind,channel,recipient_enc,recipient_mask,recipient_hash,state,attempts,last_reason,sent_at,updated_at) VALUES"
GO="'00000000000000000000GRANTO'"
O1V="$GO,'$GT',$GRR,'REQ_ACCEPTED','SMS',RANDOM_BYTES(45),'+90 5** *** ** 33',$H1,'PENDING',0,NULL,NULL,NOW(3)"
O1="$OB ($O1V)"
ob() { echo "$OB (${O1V/$1/$2})"; }  # $1 → $2 değiştir
UO="UPDATE notification_outbox SET"; WO="WHERE id=$GO"
RQW="$CT1; INSERT INTO support_requests ($RQC,source,notify_sms,notify_whatsapp,notify_email) VALUES ('00000000000000000000GRANTR',$(c="'0.9.0'"; echo "${RQV/$c/NULL}"),'WEB',1,1,0)"
US19="UPDATE tenant_settings SET"; WT19="WHERE tenant_id='$GT'"
run OK     "SELECT COUNT(*) FROM notification_outbox"
run OK     "$TX $RQW; $R"                                                                                  # WEB talebi, sürüm NULL
run OK     "$TX $RQ; $UR notify_sms=1,notify_email=1 $WR; $R"
run OK     "$TX $RS1; $URS web_form_enabled=1,notify_sms_enabled=1,notify_whatsapp_enabled=1,notify_email_enabled=1 $WRS; $R"
run OK     "$TX $US19 sms_url='https://sms.example.com/api',sms_api_key_enc=RANDOM_BYTES(60),sms_header='NOKTA BLSM' $WT19; $US19 sms_url='http://10.0.0.5:3001',sms_header=NULL $WT19; $US19 sms_url=NULL,sms_api_key_enc=NULL $WT19; $R"
run OK     "$TX $RQ; $O1; $UO state='SENDING',attempts=1 $WO; $UO state='PENDING',next_at=NOW(3)+INTERVAL 10 SECOND,last_reason='unreachable' $WO; $UO state='SENT',attempts=2,recipient_enc=NULL,sent_at=NOW(3),last_reason=NULL $WO; DELETE FROM notification_outbox $WO; $R"
run OK     "$TX $RQ; $(ob "RANDOM_BYTES(45)" "NULL" | sed "s/'PENDING',0,NULL/'FAILED',0,'rate_limited'/"); $R"   # tavan aşımı: FAILED, alıcı yok
run OK     "$TX $RQ; $O1; $(ob "'SMS'" "'EMAIL'" | sed "s/$GO/'00000000000000000000GRANTP'/"); $R"             # aynı talep, başka kanal
run OK     "$TX $RQ; $O1; $RANON; DELETE FROM notification_outbox WHERE tenant_id='$GT' AND request_id IN ($GRR); $R"   # anonimleştirme aynı TX
run DENIED "ALTER TABLE notification_outbox ADD COLUMN x INT" "denied"
run DENIED "DROP TABLE notification_outbox" "denied"
run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON notification_outbox FOR EACH ROW SET @a=1" "denied"
# §8c.1 negatifleri
enum_case support_requests_source_chk AGENT agent "CONCAT($AA,'GENT')" "$TX $RQ; $UR source=@V@ $WR; $R"
run DENIED "$TX $RQ; $UR source='KIOSK' $WR; $R" support_requests_source_chk
run DENIED "$TX $RQ; $UR source='WEB' $WR; $R" support_requests_source_version_chk                      # WEB + '0.9.0'
run DENIED "$TX $RQ; $UR client_version=NULL $WR; $R" support_requests_source_version_chk               # AGENT + NULL
run DENIED "$TX $(echo "$RQW" | sed "s/,NULL,'Ayse/,'0.12.0','Ayse/"); $R" support_requests_source_version_chk   # WEB + sürüm
enum_case notification_outbox_channel_chk SMS sms "CONCAT('SM',CONVERT(X'C59E' USING utf8mb4))" "$TX $RQ; $(ob "'SMS'" "@V@"); $R"
enum_case notification_outbox_kind_chk REQ_ACCEPTED req_accepted "CONCAT('REQ_',$AA,'CCEPTED')" "$TX $RQ; $(ob "'REQ_ACCEPTED'" "@V@"); $R"
enum_case notification_outbox_state_chk PENDING pending "CONCAT('P',$EA,'NDING')" "$TX $RQ; $(ob "'PENDING'" "@V@"); $R"
run DENIED "$TX $RQ; $(ob "'SMS'" "'FAX'"); $R" notification_outbox_channel_chk
run DENIED "$TX $RQ; $(ob "'REQ_ACCEPTED'" "'ASSIGNED'"); $R" notification_outbox_kind_chk               # K-P18-9: eklenmez
run DENIED "$TX $RQ; $(ob "'PENDING',0,NULL,NULL" "'SENT',1,NULL,NOW(3)"); $R" notification_outbox_recipient_enc_chk   # SENT + alıcı dolu
run DENIED "$TX $RQ; $(ob "RANDOM_BYTES(45)" "NULL"); $R" notification_outbox_recipient_enc_chk           # PENDING + alıcı yok
run DENIED "$TX $RQ; $(ob "RANDOM_BYTES(45)" "'+905301112233'"); $R" notification_outbox_recipient_enc_chk   # düz metin alıcı
run DENIED "$TX $RQ; $(ob "$H1" "'abc'"); $R" notification_outbox_recipient_hash_chk
run DENIED "$TX $RQ; $(ob "$H1" "REPEAT('A',64)"); $R" notification_outbox_recipient_hash_chk            # büyük harf hex
run DENIED "$TX $RQ; $(ob "$H1" "CONCAT(REPEAT('a',63),CHAR(10))"); $R" notification_outbox_recipient_hash_chk
run DENIED "$TX $RQ; $(ob "$H1" "NULL"); $R" "cannot be null"                                             # 1048
run DENIED "$TX $RQ; $(ob "'+90 5** *** ** 33'" "''"); $R" notification_outbox_recipient_mask_chk
run DENIED "$TX $RQ; $(ob "'+90 5** *** ** 33'" "CONCAT('+90',CHAR(10),'5**')"); $R" notification_outbox_recipient_mask_chk
run DENIED "$TX $RQ; $(ob "'PENDING',0" "'PENDING',4"); $R" notification_outbox_attempts_chk
run DENIED "$TX $RQ; $O1; $UO state='SENT',recipient_enc=NULL $WO; $R" notification_outbox_sent_chk     # SENT + sent_at yok
run DENIED "$TX $RQ; $O1; $UO sent_at=NOW(3) $WO; $R" notification_outbox_sent_chk                      # PENDING + sent_at
run DENIED "$TX $RQ; $O1; $UO state='FAILED',recipient_enc=NULL $WO; $R" notification_outbox_last_reason_chk   # FAILED + neden yok
run DENIED "$TX $RQ; $O1; $UO last_reason='ECONNREFUSED 10.0.0.1' $WO; $R" notification_outbox_last_reason_chk   # ham hata
run DENIED "$TX $RQ; $O1; $UO last_reason=REPEAT('x',31) $WO; $R" "Data too long"                            # VARCHAR(30)
run DENIED "$TX $RQ; $O1; $UO last_reason='Rate_Limited' $WO; $R" notification_outbox_last_reason_chk
run DENIED "$TX $RQ; $O1; $(ob "$GO" "'00000000000000000000GRANTP'"); $R" "Duplicate"                    # UQ(talep, tenant, tür, kanal)
run DENIED "$TX $GX; $RQ; $(ob "'$GT'" "'00000000000000000000GRANTX'"); $R" "foreign key"                # başka tenant'ın talebi
run DENIED "$TX $(ob "$GRR" "'00000000000000000000NOREQ0'"); $R" "foreign key"                           # talep yok
run DENIED "$TX $US19 sms_header='ABCDEFGHIJKL' $WT19; $R" "Data too long"                                # 12 karakter: VARCHAR(11) (1406) CHECK'ten önce
run DENIED "$TX $US19 sms_header='' $WT19; $R" tenant_settings_sms_header_chk
run DENIED "$TX $US19 sms_header='NOKTA_BLSM' $WT19; $R" tenant_settings_sms_header_chk
run DENIED "$TX $US19 sms_header=CONCAT('NOKTA',CHAR(10)) $WT19; $R" tenant_settings_sms_header_chk
run DENIED "$TX $US19 sms_url='https://u:p@sms.example.com' $WT19; $R" tenant_settings_sms_url_chk       # S-P19-T5 userinfo
run DENIED "$TX $US19 sms_url='https://sms.example.com/x?apikey=1' $WT19; $R" tenant_settings_sms_url_chk   # sorgu
run DENIED "$TX $US19 sms_url='https://sms.example.com/#k' $WT19; $R" tenant_settings_sms_url_chk        # parça
run DENIED "$TX $US19 sms_url='https://sms.example.com/a@b' $WT19; $R" tenant_settings_sms_url_chk       # yolda @
run DENIED "$TX $US19 sms_url=CONCAT('https://sms.example.com',CHAR(10)) $WT19; $R" tenant_settings_sms_url_chk
run DENIED "$TX $US19 sms_url='ftp://sms.example.com' $WT19; $R" tenant_settings_sms_url_chk
run DENIED "$TX $US19 sms_url='https:///api' $WT19; $R" tenant_settings_sms_url_chk                     # boş host
run DENIED "$TX $US19 sms_api_key_enc='duz-anahtar' $WT19; $R" tenant_settings_sms_api_key_enc_chk
# P27a (mimari-p27a §3.1/§3.3; AC-325..334, K-P27a-2/3/11): tenant_settings.mfa_remember_device (varsayılan TRUE) ve
# trusted_devices (SELECT/INSERT/UPDATE/DELETE; tetikleyici yok; r3: token_hash indekssiz) — CHECK/bileşik FK. Tümü geri alınan TX'te.
TD="INSERT INTO trusted_devices (id,tenant_id,user_id,token_hash,ua_summary,ip,expires_at,updated_at) VALUES"
GD="'00000000000000000000GRANTD'"; E30="NOW(3)+INTERVAL 30 DAY"
TD1="$TD ($GD,'$GT','00000000000000000000GRANTU',$H1,'Chrome · Windows','203.0.113.7',$E30,NOW(3))"
td() { echo "$TD ($GD,'$GT','00000000000000000000GRANTU',$1,$2,'203.0.113.7',$3,NOW(3))"; }   # $1 özet, $2 ua, $3 bitiş
run_val 1 "SELECT mfa_remember_device FROM tenant_settings WHERE tenant_id='$GT'" "tenant_settings.mfa_remember_device varsayılanı TRUE (K-P27a-12)"
run OK     "SELECT COUNT(*) FROM trusted_devices"
run OK     "$TX $US19 mfa_remember_device=0 $WT19; $US19 mfa_remember_device=1 $WT19; $R"
run OK     "$TX $TD1; UPDATE trusted_devices SET token_hash=$H2,last_used_at=NOW(3),ip='198.51.100.9' WHERE id=$GD AND token_hash=$H1; DELETE FROM trusted_devices WHERE user_id='00000000000000000000GRANTU'; $R"   # verify → döndürme → iptal
run OK     "$TX $TD1; DELETE FROM trusted_devices WHERE tenant_id='$GT'; $R"                                       # firma geneli (pasif / anahtar kapatma)
run OK     "$TX $(td "$H1" "''" "$E30"); $R"                                                                     # boş UA özeti serbest
run DENIED "ALTER TABLE trusted_devices ADD COLUMN x INT" "denied"
run DENIED "DROP TABLE trusted_devices" "denied"
run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON trusted_devices FOR EACH ROW SET @a=1" "denied"
run DENIED "$TX $TD ($GD,NULL,'00000000000000000000GRANTU',$H1,'ua','203.0.113.7',$E30,NOW(3)); $R" "cannot be null"   # K-P27a-2: Super Admin (tenant NULL) satırı yok
run DENIED "$TX $GX; $TD ($GD,'00000000000000000000GRANTX','00000000000000000000GRANTU',$H1,'ua','203.0.113.7',$E30,NOW(3)); $R" trusted_devices_user_id_tenant_id_fkey   # kullanıcının firması değil
run DENIED "$TX $TD ($GD,'$GT','0000000000000000000NOUSER',$H1,'ua','203.0.113.7',$E30,NOW(3)); $R" trusted_devices_user_id_tenant_id_fkey
run DENIED "$TX $(td "'plain-device-token'" "'ua'" "$E30"); $R" trusted_devices_token_hash_fmt_chk
run DENIED "$TX $(td "UPPER($H2)" "'ua'" "$E30"); $R" trusted_devices_token_hash_fmt_chk
run DENIED "$TX $(td "CONCAT(REPEAT('a',63),CHAR(10))" "'ua'" "$E30"); $R" trusted_devices_token_hash_fmt_chk
run DENIED "$TX $TD1; UPDATE trusted_devices SET token_hash='plain-device-token' WHERE id=$GD; $R" trusted_devices_token_hash_fmt_chk
run DENIED "$TX $(td "$H1" "'ua'" "NOW(3)+INTERVAL 31 DAY"); $R" trusted_devices_ttl_chk                     # 30 günden uzun
run DENIED "$TX $(td "$H1" "'ua'" "NOW(3)-INTERVAL 1 SECOND"); $R" trusted_devices_ttl_chk
run DENIED "$TX $TD1; UPDATE trusted_devices SET expires_at=expires_at+INTERVAL 1 DAY WHERE id=$GD; $R" trusted_devices_ttl_chk   # döndürme süre uzatamaz
run DENIED "$TX $(td "$H1" "CONCAT('Chrome',CHAR(13),CHAR(10),'Bcc: x')" "$E30"); $R" trusted_devices_ua_summary_chk
run DENIED "$TX $(td "$H1" "CONCAT('Chrome',CONVERT(X'E280AE' USING utf8mb4),'swodniW')" "$E30"); $R" trusted_devices_ua_summary_chk   # U+202E (Cf)
run DENIED "$TX $(td "$H1" "REPEAT('u',81)" "$E30"); $R" "Data too long"
# P27 (mimari-p27 §3; AC-273, 275, 293, 296, 336, 337; K-P27-9/14): unattended_devices / registration_codes /
# customer_notify_contacts (SELECT/INSERT/UPDATE/DELETE), unattended_device_grants (SELECT/INSERT/DELETE; UPDATE yok);
# support_sessions cihaz oturumu (kod yok, 60 sn, UNATTENDED), session_consents UNATTENDED, outbox session/event çapası. Tümü
# geri alınan TX'te.
UD="INSERT INTO unattended_devices (id,tenant_id,customer_id,name,public_key,os_version,agent_version,binary_sha256,signed,registered_ip,registered_by,updated_at) VALUES"
GDV="'0000000000000000000GRANTDV'"; GK="'00000000000000000000GRANTK'"
UDV="$GDV,'$GT',$GK,'PC-01',RANDOM_BYTES(32),'Windows 11 Pro 23H2','0.27.0',$H1,0,'203.0.113.7',$GU,NOW(3)"
UD1="$CU1; $UD ($UDV)"
ud() { echo "$CU1; $UD (${UDV/$1/$2})"; }  # $1 → $2 değiştir
UUD="UPDATE unattended_devices SET"; WUD="WHERE id=$GDV"
UG="INSERT INTO unattended_device_grants (id,tenant_id,device_id,user_id,created_by) VALUES"
UG1="$UG ('0000000000000000000GRANTGR','$GT',$GDV,$GU,$GU)"
URC="INSERT INTO unattended_registration_codes (id,tenant_id,customer_id,code_hash,created_by,expires_at,updated_at) VALUES"
GQ="'00000000000000000000GRANTQ'"
URC1="$URC ($GQ,'$GT',$GK,$H2,$GU,NOW(3)+INTERVAL 24 HOUR,NOW(3))"
NC="INSERT INTO customer_notify_contacts (id,tenant_id,customer_id,email,phone,updated_at) VALUES"
NC1="$NC ('0000000000000000000GRANTNC','$GT',$GK,'bt@musteri.test','+905301112233',NOW(3))"
USSC="id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,device_id,customer_id,customer_name"
USSV="'00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),$GDV,$GK,'PC-01'"
USS="INSERT INTO support_sessions ($USSC) VALUES ($USSV)"
uss() { echo "INSERT INTO support_sessions ($USSC) VALUES (${USSV/$1/$2})"; }
UADM="UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='UNATTENDED' WHERE id='00000000000000000000GRANTS'"
UEND="UPDATE support_sessions SET status='ENDED',ended_at=NOW(3),ended_by='TECH',end_reason='tech_end' WHERE id='00000000000000000000GRANTS'"
UANON="UPDATE support_sessions SET customer_name=NULL,device_id=NULL,anonymized_at=NOW(3) WHERE id='00000000000000000000GRANTS'"
OBS="INSERT INTO notification_outbox (id,tenant_id,request_id,session_id,event_id,kind,channel,recipient_enc,recipient_mask,recipient_hash,updated_at) VALUES"
obs() { echo "$OBS ('$1','$GT',$2,$3,$4,'$5','EMAIL',RANDOM_BYTES(45),'b***@musteri.test',$6,NOW(3))"; }  # id req ses evt kind hash
GSE="'00000000000000000000GRANTS'"; GEV="'01JZ0000000000000000000EVT'"
SA="INSERT INTO users (id,tenant_id,email,full_name,role,password_hash,updated_at) VALUES ('00000000000000000000GRANTZ',NULL,'grant-sa@invalid.test','Grant SA','SUPER_ADMIN','x',NOW(3))"
run OK     "SELECT COUNT(*) FROM unattended_devices; SELECT COUNT(*) FROM unattended_device_grants; SELECT COUNT(*) FROM unattended_registration_codes; SELECT COUNT(*) FROM customer_notify_contacts"
# Akış: kod → kayıt (kod tüketimi) → grant (verified_at) → bağlan (PENDING, kod yok, 60 sn) → admit (UNATTENDED + onay) → outbox → bitiş → anonim
run OK     "$TX $CU1; $URC1; $UD ($UDV); UPDATE unattended_registration_codes SET used_at=NOW(3),device_id=$GDV WHERE id=$GQ AND used_at IS NULL AND expires_at > NOW(3); $UG1; $UUD verified_at=NOW(3) $WUD; $R"
run OK     "$TX $UD1; $USS; $UADM; INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source) VALUES ('0000000000000000000GRANTSC',$GSE,'$GT','VIEW','GRANTED','UNATTENDED'); $(obs 0000000000000000000GRANTO1 NULL "$GSE" NULL UNATTENDED_STARTED "$H1"); $(obs 0000000000000000000GRANTO2 NULL "$GSE" NULL UNATTENDED_STARTED "$H2"); $UEND; $UANON; DELETE FROM notification_outbox WHERE session_id=$GSE; $R"
run OK     "$TX $UD1; $USS; UPDATE support_sessions SET status='CANCELLED',ended_at=NOW(3),ended_by='SYSTEM',end_reason='device_timeout' WHERE id=$GSE; $UANON; $R"   # zaman aşımı + anonim (60 sn, device NULL)
run OK     "$TX $UD1; $(uss "'PC-01'" "'X'"); $R"                                                                   # 1 karakterlik cihaz adı
run OK     "$TX $UD1; $(obs 0000000000000000000GRANTO1 NULL NULL "$GEV" UN_DEVICE_REGISTERED "$H1"); $(obs 0000000000000000000GRANTO2 NULL NULL "$GEV" UN_CONTACTS_CHANGED "$H1"); $R"
run OK     "$TX $UD1; $UUD local_enabled=0,last_seen_at=NOW(3),last_ip='198.51.100.9',agent_version='0.27.1',signed=1,notify_failed_at=NOW(3) $WUD; $UUD notify_failed_at=NULL $WUD; $R"
run OK     "$TX $UD1; $UG1; DELETE FROM unattended_device_grants WHERE device_id=$GDV; $UUD revoked_at=NOW(3),revoked_by=$GU,revoke_reason='ADMIN',last_ip=NULL $WUD; DELETE FROM unattended_devices $WUD; $R"
run OK     "$TX $UD1; $UUD revoked_at=NOW(3),revoke_reason='UNINSTALLED' $WUD; $R"
run OK     "$TX $CU1; $NC1; UPDATE customer_notify_contacts SET phone=NULL WHERE customer_id=$GK; DELETE FROM customer_notify_contacts WHERE tenant_id='$GT' AND customer_id=$GK; $R"
run OK     "$TX $CU1; $URC1; DELETE FROM unattended_registration_codes WHERE id=$GQ; $R"
run DENIED "$TX $UD1; $UG1; UPDATE unattended_device_grants SET user_id=$GU WHERE device_id=$GDV; $R" "denied"   # UPDATE yetkisi yok
for t in unattended_devices unattended_device_grants unattended_registration_codes customer_notify_contacts; do
  run DENIED "ALTER TABLE $t ADD COLUMN x INT" "denied"
  run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON $t FOR EACH ROW SET @a=1" "denied"
done
run DENIED "DROP TABLE unattended_devices" "denied"
# §3 negatifleri — cihaz
run DENIED "$TX $(ud "'PC-01'" "''"); $R" unattended_devices_name_chk
run DENIED "$TX $(ud "'PC-01'" "' PC-01'"); $R" unattended_devices_name_chk
run DENIED "$TX $(ud "'PC-01'" "CONCAT('PC',CHAR(10),'01')"); $R" unattended_devices_name_chk
run DENIED "$TX $(ud "'PC-01'" "CONCAT('PC',CONVERT(X'E280AE' USING utf8mb4),'01')"); $R" unattended_devices_name_chk   # U+202E
run DENIED "$TX $(ud "'PC-01'" "CONCAT('PC',CONVERT(X'CD8F' USING utf8mb4),'01')"); $R" unattended_devices_name_chk     # U+034F
run DENIED "$TX $(ud "'Windows 11 Pro 23H2'" "CONCAT('Win',CHAR(9))"); $R" unattended_devices_os_version_chk
run DENIED "$TX $(ud "RANDOM_BYTES(32)" "RANDOM_BYTES(31)"); $R" unattended_devices_public_key_chk
run DENIED "$TX $(ud "'0.27.0'" "'0.27.0-beta'"); $R" unattended_devices_agent_version_chk
run DENIED "$TX $(ud "'0.27.0'" "CONCAT('0.27.0',CHAR(10))"); $R" unattended_devices_agent_version_chk
run DENIED "$TX $(ud "$H1" "UPPER($H1)"); $R" unattended_devices_binary_sha256_chk
run DENIED "$TX $(ud "RANDOM_BYTES(32)" "REPEAT(X'01',32)"); $UD ('0000000000000000000GRANTDW','$GT',$GK,'PC-02',REPEAT(X'01',32),'Win','0.27.0',$H1,0,'203.0.113.7',NULL,NOW(3)); $R" "Duplicate entry"   # public_key tekil
run DENIED "$TX $UD1; $UUD revoked_at=NOW(3) $WUD; $R" unattended_devices_revoked_chk                                  # neden yok
run DENIED "$TX $UD1; $UUD revoked_at=NOW(3),revoke_reason='UNINSTALLED',revoked_by=$GU $WUD; $R" unattended_devices_revoked_chk   # by yalnız ADMIN
run DENIED "$TX $UD1; $UUD last_ip='198.51.100.9' $WUD; $UUD revoked_at=NOW(3),revoke_reason='ADMIN' $WUD; $R" unattended_devices_revoked_chk   # iptalde last_ip kalmaz
enum_case unattended_devices_revoke_reason_chk ADMIN admin "CONCAT($AA,'DMIN')" "$TX $UD1; $UUD revoked_at=NOW(3),revoke_reason=@V@ $WUD; $R"
run DENIED "$TX $UD1; $UUD revoked_at=NOW(3),revoke_reason='EXPIRED' $WUD; $R" unattended_devices_revoke_reason_chk
run DENIED "$TX $GX; $CU1; $UD ($GDV,'00000000000000000000GRANTX',$GK,'PC-01',RANDOM_BYTES(32),'Win','0.27.0',$H1,0,'203.0.113.7',NULL,NOW(3)); $R" unattended_devices_tenant_id_customer_id_fkey   # başka firmanın müşterisi
# grant
run DENIED "$TX $UD1; $UG1; $UG ('0000000000000000000GRANTGS','$GT',$GDV,$GU,NULL); $R" "Duplicate entry"
run DENIED "$TX $UD1; $SA; $UG ('0000000000000000000GRANTGS','$GT',$GDV,'00000000000000000000GRANTZ',$GU); $R" unattended_device_grants_user_id_tenant_id_fkey   # K-P27-9 Super Admin
run DENIED "$TX $UD1; $GX; $UG ('0000000000000000000GRANTGS','00000000000000000000GRANTX',$GDV,$GU,NULL); $R" unattended_device_grants_device_id_tenant_id_fkey   # tenant uyuşmazlığı
run OK     "$TX $UD1; $SA; $UG ('0000000000000000000GRANTGS','$GT',$GDV,$GU,'00000000000000000000GRANTZ'); $R"   # Super Admin grant VEREBİLİR (created_by tekil FK)
# kayıt kodu
run DENIED "$TX $CU1; $URC ($GQ,'$GT',$GK,'ABCD-1234-EFGH-5678',$GU,NOW(3)+INTERVAL 24 HOUR,NOW(3)); $R" unattended_registration_codes_code_hash_chk
run DENIED "$TX $CU1; $URC ($GQ,'$GT',$GK,$H2,$GU,NOW(3)+INTERVAL 25 HOUR,NOW(3)); $R" unattended_registration_codes_ttl_chk
run DENIED "$TX $CU1; $URC1; UPDATE unattended_registration_codes SET expires_at=expires_at+INTERVAL 1 HOUR WHERE id=$GQ; $R" unattended_registration_codes_ttl_chk
run DENIED "$TX $CU1; $URC1; UPDATE unattended_registration_codes SET used_at=NOW(3) WHERE id=$GQ; $R" unattended_registration_codes_used_chk
run DENIED "$TX $UD1; $URC1; UPDATE unattended_registration_codes SET used_at=NOW(3),device_id=$GDV WHERE id=$GQ; $URC ('00000000000000000000GRANTJ','$GT',$GK,REPEAT('c',64),NULL,NOW(3)+INTERVAL 1 HOUR,NOW(3)); UPDATE unattended_registration_codes SET used_at=NOW(3),device_id=$GDV WHERE id='00000000000000000000GRANTJ'; $R" "Duplicate entry"   # cihaz tek kod
# bildirim adresi
run DENIED "$TX $CU1; $NC1; $NC ('0000000000000000000GRANTND','$GT',$GK,'BT@Musteri.TEST',NULL,NOW(3)); $R" "Duplicate entry"   # büyük/küçük harf duyarsız tekil
run DENIED "$TX $CU1; $NC ('0000000000000000000GRANTNC','$GT',$GK,CONCAT('bt@musteri.test',CHAR(10)),NULL,NOW(3)); $R" customer_notify_contacts_email_chk
run DENIED "$TX $CU1; $NC ('0000000000000000000GRANTNC','$GT',$GK,'bt@musteri.test','05301112233',NOW(3)); $R" customer_notify_contacts_phone_chk
# support_sessions cihaz oturumu
run DENIED "$TX $UD1; $(uss "NULL,'0427'" "'48291376','0427'"); $R" support_sessions_code_pending_chk                     # cihaz oturumunda kod yok
run DENIED "$TX $UD1; $(uss "INTERVAL 60 SECOND" "INTERVAL 15 MINUTE"); $R" support_sessions_ttl_chk
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='AGENT' WHERE id=$GSE; $R" support_sessions_device_mode_chk
run DENIED "$TX $ADM; UPDATE support_sessions SET mode='UNATTENDED' WHERE id=$GSE; $R" support_sessions_unattended_device_chk   # cihazsız UNATTENDED
run DENIED "$TX $RQ; $ACC; $UD1; $RSR; UPDATE support_sessions SET device_id=$GDV WHERE id=$GSE; $R" support_sessions_device_request_chk
run DENIED "$TX $UD1; $USS; $UADM; $UEND; UPDATE support_sessions SET customer_name=NULL,anonymized_at=NOW(3) WHERE id=$GSE; $R" support_sessions_anonymized_chk   # anonimde device_id kalmaz
run DENIED "$TX $UD1; $USS; DELETE FROM unattended_devices $WUD; $R" support_sessions_device_id_tenant_id_fkey
enum_case support_sessions_mode_chk UNATTENDED unattended "CONCAT('UN',$AA,'TTENDED')" "$TX $UD1; $USS; UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode=@V@ WHERE id=$GSE; $R"
enum_case session_consents_source_chk UNATTENDED unattended "CONCAT('UN',$AA,'TTENDED')" "$TX $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','GRANTED',@V@,NULL,NULL,NULL,NULL); $R"
# outbox çapası
run DENIED "$TX $UD1; $USS; $(obs 0000000000000000000GRANTO1 NULL "$GSE" "$GEV" UNATTENDED_STARTED "$H1"); $R" notification_outbox_anchor_chk
run DENIED "$TX $(obs 0000000000000000000GRANTO1 NULL NULL NULL UN_DEVICE_REGISTERED "$H1"); $R" notification_outbox_anchor_chk
run DENIED "$TX $UD1; $USS; $(obs 0000000000000000000GRANTO1 NULL "$GSE" NULL UN_CONTACTS_CHANGED "$H1"); $R" notification_outbox_kind_anchor_chk
run DENIED "$TX $(obs 0000000000000000000GRANTO1 NULL NULL "$GEV" UNATTENDED_STARTED "$H1"); $R" notification_outbox_kind_anchor_chk
run DENIED "$TX $RQ; $(obs 0000000000000000000GRANTO1 "$GRR" NULL NULL UN_DEVICE_REGISTERED "$H1"); $R" notification_outbox_kind_anchor_chk
run DENIED "$TX $(obs 0000000000000000000GRANTO1 NULL NULL "'not-a-ulid'" UN_DEVICE_REGISTERED "$H1"); $R" notification_outbox_event_id_chk
run DENIED "$TX $UD1; $USS; $(obs 0000000000000000000GRANTO1 NULL "$GSE" NULL UNATTENDED_STARTED "$H1"); $(obs 0000000000000000000GRANTO2 NULL "$GSE" NULL UNATTENDED_STARTED "$H1"); $R" "Duplicate entry"   # aynı alıcı
run DENIED "$TX $(obs 0000000000000000000GRANTO1 NULL "'0000000000000000000NOSESS'" NULL UNATTENDED_STARTED "$H1"); $R" notification_outbox_session_id_tenant_id_fkey
# UN_DEVICE_REGISTERED tam 20 karakter: sondaki boşluk VARCHAR(20)'de sessizce kırpılır → boşluk varyantı 18 karakterlik türle sınanır.
enum_case notification_outbox_kind_chk UNATTENDED_STARTED unattended_started "CONCAT('UN',$AA,'TTENDED_STARTED')" "$TX $UD1; $USS; $(obs 0000000000000000000GRANTO1 NULL "$GSE" NULL @KIND@ "$H1" | sed "s/'@KIND@'/@V@/"); $R"
run DENIED "$TX $(obs 0000000000000000000GRANTO1 NULL NULL "$GEV" un_device_registered "$H1"); $R" notification_outbox_kind_chk
# P28b (mimari-p28b §3.1–3.4; AC-354, 355, 360, 362): session_stored_files (SELECT/INSERT/DELETE + sütun düzeyi UPDATE; tetikleyici
# yok), support_sessions.file_mode (insert'te sabit; support_sessions_update_guard `p28b:`), tenant_settings dosya modu/saklama,
# tenants.storage_quota_gb, system_settings `clamav`. Tümü geri alınan TX'te.
SFC="id,tenant_id,session_id,direction,purpose,uploaded_by_user_id,file_name,ext,size_bytes,sha256,storage_rel,key_ver,state,updated_at"
SFV="'0000000000000000000GRANTSF','$GT','00000000000000000000GRANTS','TO_CUSTOMER','FILE','00000000000000000000GRANTU','rapor.pdf','pdf',1048576,$H1,CONCAT('$GT','/',REPEAT('a',24),'.rsf'),1,'UPLOADING',NOW(3)"
SF1="INSERT INTO session_stored_files ($SFC) VALUES ($SFV)"
sf() { echo "INSERT INTO session_stored_files ($SFC) VALUES (${SFV/$1/$2})"; }  # $1 → $2 değiştir
USF="UPDATE session_stored_files SET"; WSF="WHERE id='0000000000000000000GRANTSF'"
run_val "1,0,20" "SELECT CONCAT(s.file_retention_days,',',s.file_server_mode,',',t.storage_quota_gb) FROM tenant_settings s JOIN tenants t ON t.id=s.tenant_id WHERE s.tenant_id='$GT'" "P28b varsayılanlar: saklama 1 g, mod kapalı, kota 20 GB"
run OK     "SELECT COUNT(*) FROM session_stored_files"
# Yaşam döngüsü: UPLOADING → SCANNING → CLEAN → teslim (expires) → EXPIRED (disk NULL) → anonimleştirme DELETE
run OK     "$TX $ADM; $SF1; $USF state='SCANNING' $WSF; $USF state='CLEAN',scanned_at=NOW(3) $WSF; $USF delivered_at=NOW(3),expires_at=NOW(3)+INTERVAL 1 DAY $WSF; $USF state='EXPIRED',storage_rel=NULL,deleted_at=NOW(3) $WSF; DELETE FROM session_stored_files WHERE session_id='00000000000000000000GRANTS'; $R"
run OK     "$TX $ADM; $SF1; $USF state='SCAN_FAILED',scan_reason='ENCRYPTED',storage_rel=NULL,deleted_at=NOW(3),scanned_at=NOW(3) $WSF; $R"
run OK     "$TX $ADM; $SF1; $USF state='INFECTED',signature='Eicar-Test-Signature',storage_rel=NULL,deleted_at=NOW(3),scanned_at=NOW(3) $WSF; $R"
run OK     "$TX $ADM; $(sf "'FILE','00000000000000000000GRANTU','rapor.pdf'" "'PRINT','00000000000000000000GRANTU','belge.pdf'"); $R"
run OK     "$TX $ADM; $(sf "'TO_CUSTOMER','FILE','00000000000000000000GRANTU'" "'TO_TECH','FILE',NULL"); $R"   # müşteri yüklemesi
run OK     "$TX $ADM; UPDATE support_sessions SET file_mode=file_mode,note='x' WHERE id='00000000000000000000GRANTS'; $R"   # aynı değer serbest
run OK     "$TX $US19 file_server_mode=1,file_retention_days=7 $WT19; UPDATE tenants SET storage_quota_gb=2000 WHERE id='$GT'; $R"
# Yetki sınırı: kimlik/boyut/sha/ad/oturum güncellenemez; DDL yok
run DENIED "UPDATE session_stored_files SET size_bytes=1 $WSF" "command denied"
run DENIED "UPDATE session_stored_files SET sha256=REPEAT('c',64) $WSF" "command denied"
run DENIED "UPDATE session_stored_files SET file_name='x.exe' $WSF" "command denied"
run DENIED "UPDATE session_stored_files SET tenant_id='00000000000000000000GRANTX' $WSF" "command denied"
run DENIED "UPDATE session_stored_files SET key_ver=2 $WSF" "command denied"
run DENIED "ALTER TABLE session_stored_files ADD COLUMN x INT" "denied"
run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON session_stored_files FOR EACH ROW SET @a=1" "denied"
# file_mode insert'te sabit (AC-355)
run DENIED "$TX $ADM; UPDATE support_sessions SET file_mode='SERVER' WHERE id='00000000000000000000GRANTS'; $R" "p28b: support_sessions.file_mode"
run DENIED "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET file_mode='server' WHERE id='00000000000000000000GRANTS'; $R" "p28b: support_sessions.file_mode"
run DENIED "$TX INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,file_mode,updated_at) VALUES ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,'server',NOW(3)); $R" support_sessions_file_mode_chk
# CHECK'ler
run DENIED "$TX $ADM; $(sf "'TO_CUSTOMER','FILE'" "'to_customer','FILE'"); $R" session_stored_files_direction_chk
run DENIED "$TX $ADM; $(sf "'UPLOADING'" "'BOGUS'"); $R" session_stored_files_state_chk
run DENIED "$TX $ADM; $(sf 1048576 268435457); $R" session_stored_files_size_chk
run DENIED "$TX $ADM; $(sf 1048576 0); $R" session_stored_files_size_chk
run DENIED "$TX $ADM; $(sf "'FILE','00000000000000000000GRANTU','rapor.pdf'" "'PRINT','00000000000000000000GRANTU','gizli.pdf'"); $R" session_stored_files_file_name_chk
run DENIED "$TX $ADM; $(sf "'rapor.pdf'" "CONCAT('fatura',CONVERT(X'E280AE' USING utf8mb4),'fdp.exe')"); $R" session_stored_files_file_name_chk
run DENIED "$TX $ADM; $(sf "'pdf'" "'PDF'"); $R" session_stored_files_ext_chk
run DENIED "$TX $ADM; $(sf "$H1" "UPPER($H1)"); $R" session_stored_files_sha256_chk
run DENIED "$TX $GX; $ADM; $(sf "CONCAT('$GT'" "CONCAT('00000000000000000000GRANTX'"); $R" session_stored_files_storage_rel_chk   # öndek başka tenant
run DENIED "$TX $ADM; $(sf "'.rsf')" "'.rs/')"); $R" session_stored_files_storage_rel_chk
run DENIED "$TX $ADM; $SF1; $USF state='CANCELLED' $WSF; $R" session_stored_files_storage_rel_chk          # disk silinmeden son durum
run DENIED "$TX $ADM; $SF1; $USF state='CLEAN' $WSF; $R" session_stored_files_scanned_chk                 # taranmadan CLEAN
run DENIED "$TX $ADM; $SF1; $USF state='SCAN_FAILED',storage_rel=NULL,scanned_at=NOW(3) $WSF; $R" session_stored_files_scan_reason_chk
run DENIED "$TX $ADM; $SF1; $USF state='CLEAN',scanned_at=NOW(3),delivered_at=NOW(3) $WSF; $R" session_stored_files_expires_chk   # teslim edilen FILE süresiz
run DENIED "$TX $ADM; $SF1; $USF state='CLEAN',scanned_at=NOW(3),delivered_at=NOW(3),expires_at=NOW(3)+INTERVAL 8 DAY $WSF; $R" session_stored_files_expires_chk
run DENIED "$TX $ADM; $SF1; $USF delivered_at=NOW(3) $WSF; $R" session_stored_files_delivered_chk
run DENIED "$TX $ADM; $(sf "'TO_CUSTOMER','FILE'" "'TO_TECH','FILE'"); $R" session_stored_files_uploaded_by_chk
run DENIED "$TX $ADM; $(sf "),1," "),0,"); $R" session_stored_files_key_ver_chk
SFX="${SFV/CONCAT(*.rsf\')/NULL}"; OGT="'$GT'"; NGX="'00000000000000000000GRANTX'"
run DENIED "$TX $GX; $ADM; INSERT INTO session_stored_files ($SFC) VALUES (${SFX/$OGT/$NGX}); $R" session_stored_files_session_id_tenant_id_fkey   # başka tenant'ın oturumu
run DENIED "$TX $US19 file_retention_days=8 $WT19; $R" tenant_settings_file_retention_chk
run DENIED "$TX $US19 file_retention_days=0 $WT19; $R" tenant_settings_file_retention_chk
run DENIED "$TX UPDATE tenants SET storage_quota_gb=0 WHERE id='$GT'; $R" tenants_storage_quota_chk
# system_settings clamav (Super Admin ayarı; app INSERT/UPDATE). Uygulama gibi upsert: satır yoksa INSERT, varsa (staging/prod'da
# ayar kayıtlı) UPDATE yolu — iki yolda da aynı CHECK'ler sınanır ve "Duplicate entry" çıkmaz. app'in DELETE'i yok, anahtar CHECK'i
# geçici anahtara izin vermez → tek yol budur. Tümü geri alınan TX'te; kayıtlı satır değişmez.
cv() { echo "INSERT INTO system_settings (\`key\`,value_json,secret_enc,updated_at) VALUES ('clamav',$1,$2,NOW(3)) AS n ON DUPLICATE KEY UPDATE value_json=n.value_json,secret_enc=n.secret_enc,updated_at=n.updated_at"; }
CVOK="JSON_OBJECT('host','clamav','port',3310,'lastTest',NULL)"
run OK     "$TX $(cv "$CVOK" NULL); UPDATE system_settings SET value_json=JSON_OBJECT('host','clamav','port',3310,'lastTest',JSON_OBJECT('ok',TRUE,'at','2026-11-16T10:00:00.000Z','version','ClamAV 1.5.4/28177','dbDate','2026-11-16')) WHERE \`key\`='clamav'; $R"
run DENIED "$TX $(cv "JSON_OBJECT('host','clamav','port',70000,'lastTest',NULL)" NULL); $R" system_settings_clamav_chk
run DENIED "$TX $(cv "JSON_OBJECT('host','clamav;rm','port',3310,'lastTest',NULL)" NULL); $R" system_settings_clamav_chk
run DENIED "$TX $(cv "JSON_OBJECT('host','clamav','port',3310,'lastTest',NULL,'x',1)" NULL); $R" system_settings_clamav_chk
run DENIED "$TX $(cv "$CVOK" "RANDOM_BYTES(40)"); $R" system_settings_clamav_chk
run DENIED "$TX $(cv "$CVOK" NULL); UPDATE system_settings SET \`key\`='ClamAV' WHERE \`key\`='clamav'; $R" system_settings_key_chk
# P28u (mimari-p28u §3; AC-436, 445, 446; K-P28u-4): tenant_settings izinsiz politika + aydınlatma izi, support_sessions
# consent_mode / silent_reason, cihaz TTL 55..155 sn, anonimleştirmede gerekçe NULL. Yeni tablo/tetikleyici yok. Tümü geri alınan TX'te.
PR28="'Arıza tespiti için kullanıcı yokken bağlanılıyor'"
run_val "0" "SELECT unattended_silent_enabled FROM tenant_settings WHERE tenant_id='$GT'" "P28u politika varsayılanı kapalı"
run OK     "$TX $US19 unattended_silent_enabled=1,unattended_silent_ack_at=NOW(3),unattended_silent_ack_by=$GU $WT19; $US19 unattended_silent_enabled=0 $WT19; $R"   # kapatınca iz kalır
run DENIED "$TX $US19 unattended_silent_enabled=1 $WT19; $R" tenant_settings_silent_ack_chk
run DENIED "$TX $US19 unattended_silent_ack_at=NOW(3),unattended_silent_ack_by='0000000000000000000NOUSER' $WT19; $R" tenant_settings_unattended_silent_ack_by_fkey
# ask: 150 sn PENDING → admit asked → bitiş → anonim (device_id + gerekçe NULL, 150 sn pencere anonimde geçerli)
run OK     "$TX $UD1; $(uss "INTERVAL 60 SECOND" "INTERVAL 150 SECOND"); $UADM; UPDATE support_sessions SET consent_mode='asked' WHERE id=$GSE; $UEND; $UANON; $R"
run OK     "$TX $UD1; $(uss "INTERVAL 60 SECOND" "INTERVAL 150 SECOND"); UPDATE support_sessions SET status='CANCELLED',ended_at=NOW(3),ended_by='SYSTEM',end_reason='device_timeout' WHERE id=$GSE; $UANON; $R"
# silent: 60 sn, gerekçe connect TX'inde; anonimde gerekçe NULL zorunlu
run OK     "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=$PR28 WHERE id=$GSE; $UADM; $UEND; UPDATE support_sessions SET customer_name=NULL,device_id=NULL,silent_reason=NULL,anonymized_at=NOW(3) WHERE id=$GSE; $R"
run OK     "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=CONCAT($PR28,CHAR(10),'ikinci satır') WHERE id=$GSE; $R"   # \n serbest
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=$PR28 WHERE id=$GSE; $UADM; $UEND; $UANON; $R" support_sessions_anonymized_chk
run DENIED "$TX $UD1; $(uss "INTERVAL 60 SECOND" "INTERVAL 156 SECOND"); $R" support_sessions_ttl_chk
run DENIED "$TX $RQ; $ACC; $RSR; UPDATE support_sessions SET expires_at=created_at+INTERVAL 150 SECOND WHERE id=$GSE; $R" support_sessions_ttl_chk   # talep oturumu 55..65 kalır
run DENIED "$TX $ADM; UPDATE support_sessions SET consent_mode='asked' WHERE id=$GSE; $R" support_sessions_consent_mode_dev_chk   # cihazsız kip
enum_case support_sessions_consent_mode_chk no_user NO_USER "CONCAT('no',$AA,'user')" "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode=@V@ WHERE id=$GSE; $R"
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='asked',silent_reason=$PR28 WHERE id=$GSE; $R" support_sessions_silent_reason_chk   # gerekçe yalnız silent
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason='kısa gerekçe' WHERE id=$GSE; $R" support_sessions_silent_reason_chk   # < 20
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=CONCAT(' ',$PR28) WHERE id=$GSE; $R" support_sessions_silent_reason_chk   # kırpılmamış
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=CONCAT($PR28,CONVERT(X'E280AE' USING utf8mb4)) WHERE id=$GSE; $R" support_sessions_silent_reason_chk   # U+202E
run DENIED "$TX $UD1; $USS; UPDATE support_sessions SET consent_mode='silent',silent_reason=CONCAT($PR28,CHAR(13),'x') WHERE id=$GSE; $R" support_sessions_silent_reason_chk   # \r
# P28e (mimari-p28e §3; AC-380, 381, 386, 447; S-P28e-10, K-P28e-16/18/22): tenant_settings kayıt anahtarları + saklama + gözetimsiz
# kayıt aydınlatma izi; session_consents RECORDING + line_sha256; session_recordings (SELECT/INSERT/DELETE + sütun UPDATE),
# session_recording_parts (SELECT/INSERT/DELETE; UPDATE yok). Tetikleyici yok. Tümü geri alınan TX'te.
RID="'0000000000000000000GRANTRC'"; WREC="WHERE id=$RID"; UREC="UPDATE session_recordings SET"
SRC="id,tenant_id,session_id,basis,state,recorder_user_id,started_at,expires_at,updated_at"
SRV="$RID,'$GT','00000000000000000000GRANTS','CONSENT','ACTIVE',$GU,NOW(3),NOW(3)+INTERVAL 30 DAY,NOW(3)"
SR1="INSERT INTO session_recordings ($SRC) VALUES ($SRV)"
sr() { echo "INSERT INTO session_recordings ($SRC) VALUES (${SRV/$1/$2})"; }  # $1 → $2 değiştir
SPC="id,recording_id,tenant_id,series_no,part_no,offset_ms,duration_ms,size_bytes,storage_rel,key_ver"
SPV="'0000000000000000000GRANTP1',$RID,'$GT',0,7,35000,5000,1048576,CONCAT('$GT','/',REPEAT('a',24),'.rsf'),1"
SP1="INSERT INTO session_recording_parts ($SPC) VALUES ($SPV)"
sp() { echo "INSERT INTO session_recording_parts ($SPC) VALUES (${SPV/$1/$2})"; }
SP2="INSERT INTO session_recording_parts ($SPC) VALUES ('0000000000000000000GRANTP2',$RID,'$GT',1,0,40000,4000,524288,CONCAT('$GT','/',REPEAT('b',24),'.rsf'),1)"
CNT="$UREC size_bytes=1572864,part_count=2,duration_ms=9000,updated_at=NOW(3) $WREC"
SCL="INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source,consent_text_id,consent_sha256,line_sha256) VALUES"
scl() { echo "$SCL ('$1','00000000000000000000GRANTS','$GT',$2,$3,'UI',$4,$5)"; }   # id level decision text_id+sha line
RCT="'00000000000000000000GRANTC',SHA2($B,256)"
run_val "0,30,0" "SELECT CONCAT(recording_enabled,',',recording_retention_days,',',unattended_recording_enabled) FROM tenant_settings WHERE tenant_id='$GT'" "P28e varsayılanlar: kayıt kapalı, saklama 30 g, gözetimsiz kayıt kapalı"
run OK     "SELECT COUNT(*) FROM session_recordings; SELECT COUNT(*) FROM session_recording_parts"
# Ayar: aç (saklama 1..90) → gözetimsiz kayıt aydınlatma iziyle → ikisini aynı UPDATE'te kapat (iz kalır)
run OK     "$TX $US19 recording_enabled=1,recording_retention_days=90 $WT19; $US19 recording_retention_days=1 $WT19; $US19 unattended_recording_enabled=1,unattended_recording_ack_at=NOW(3),unattended_recording_ack_by=$GU $WT19; $US19 recording_enabled=0,unattended_recording_enabled=0 $WT19; $R"
run DENIED "$TX $US19 recording_retention_days=91 $WT19; $R" tenant_settings_recording_retention_chk
run DENIED "$TX $US19 recording_retention_days=0 $WT19; $R" tenant_settings_recording_retention_chk
run DENIED "$TX $US19 unattended_recording_enabled=1,unattended_recording_ack_at=NOW(3) $WT19; $R" tenant_settings_unattended_rec_chk   # kayıt kapalıyken
run DENIED "$TX $US19 recording_enabled=1,unattended_recording_enabled=1,unattended_recording_ack_at=NOW(3) $WT19; $US19 recording_enabled=0 $WT19; $R" tenant_settings_unattended_rec_chk
run DENIED "$TX $US19 recording_enabled=1,unattended_recording_enabled=1 $WT19; $R" tenant_settings_unattended_rec_ack_chk
run DENIED "$TX $US19 unattended_recording_ack_at=NOW(3),unattended_recording_ack_by='0000000000000000000NOUSER' $WT19; $R" tenant_settings_unattended_recording_ack_by_fkey
# Rıza (AC-381): RECORDING GRANTED oturumun VIEW metnini + cümle özetini taşır; REVOKED (müşteri durdurdu) metinsiz de olur
run OK     "$TX $CT1; $ADM; $(scl 0000000000000000000GRANTRV "'RECORDING'" "'GRANTED'" "$RCT" "$H1"); $(scl 0000000000000000000GRANTRW "'RECORDING'" "'REVOKED'" "NULL,NULL" "$H1"); $R"
run DENIED "$TX $ADM; $(scl 0000000000000000000GRANTRV "'RECORDING'" "'GRANTED'" "NULL,NULL" NULL); $R" session_consents_line_chk   # özet zorunlu
run DENIED "$TX $ADM; $(scl 0000000000000000000GRANTRV "'VIEW'" "'GRANTED'" "NULL,NULL" "$H1"); $R" session_consents_line_chk        # özet yalnız RECORDING
run DENIED "$TX $ADM; $(scl 0000000000000000000GRANTRV "'RECORDING'" "'GRANTED'" "NULL,NULL" "UPPER($H1)"); $R" session_consents_line_chk
run DENIED "$TX $ADM; $(scl 0000000000000000000GRANTRV "'RECORDING'" "'DENIED'" "NULL,NULL" "$H1"); $R" session_consents_recording_decision_chk
run DENIED "$TX $ADM; $(scl 0000000000000000000GRANTRV "'recording'" "'GRANTED'" "NULL,NULL" NULL); $R" session_consents_level_chk
run DENIED "$TX $CT1; $ADM; $(scl 0000000000000000000GRANTRV "'CONTROL'" "'GRANTED'" "$RCT" NULL); $R" session_consents_text_scope_chk   # P4 kuralı aynen
run DENIED "UPDATE session_consents SET line_sha256=NULL WHERE id='0000000000000000000GRANTRV'" "command denied"
# Yaşam döngüsü: ACTIVE → parçalar + sayaçlar → STOPPED{REVOKED} → elle silme (parçalar → DELETED{MANUAL}) → anonimleştirme DELETE
run OK     "$TX $ADM; $SR1; $SP1; $SP2; $CNT; $UREC state='STOPPED',stop_reason='REVOKED',stopped_at=NOW(3),updated_at=NOW(3) $WREC; DELETE FROM session_recording_parts WHERE recording_id=$RID; $UREC state='DELETED',delete_reason='MANUAL',deleted_at=NOW(3),size_bytes=0,part_count=0 $WREC; DELETE FROM session_recordings WHERE session_id='00000000000000000000GRANTS'; $R"
# Mutabakat MISSING (S-P28e-10): dosyası olmayan parça silinir, sayaç düşer; parça kalmazsa DELETED{MISSING} (süre kalabilir)
run OK     "$TX $ADM; $SR1; $SP1; $SP2; $CNT; $UREC state='STOPPED',stop_reason='SESSION_END',stopped_at=NOW(3) $WREC; DELETE FROM session_recording_parts WHERE id='0000000000000000000GRANTP1'; $UREC size_bytes=524288,part_count=1,duration_ms=4000 $WREC; DELETE FROM session_recording_parts WHERE id='0000000000000000000GRANTP2'; $UREC state='DELETED',delete_reason='MISSING',deleted_at=NOW(3),size_bytes=0,part_count=0 $WREC; $R"
run OK     "$TX $ADM; $(sr "'CONSENT','ACTIVE'" "'TENANT_POLICY','ACTIVE'"); $UREC state='STOPPED',stop_reason='POLICY_OFF',stopped_at=NOW(3) $WREC; $UREC state='DELETED',delete_reason='EXPIRED',deleted_at=NOW(3) $WREC; $R"
run OK     "$TX $ADM; $(sr "INTERVAL 30 DAY" "INTERVAL 1 DAY"); $R"
run OK     "$TX $ADM; $(sr "INTERVAL 30 DAY" "INTERVAL 90 DAY"); $R"
run OK     "$TX $ADM; $(sr "$GU" NULL); $R"
# Yetki sınırı: kimlik/oturum/tenant/basis/başlangıç/süre (K-P28e-22) güncellenemez; parçalar append-only; DDL yok
run DENIED "$UREC expires_at=NOW(3) $WREC" "command denied"
run DENIED "$UREC started_at=NOW(3) $WREC" "command denied"
run DENIED "$UREC basis='CONSENT' $WREC" "command denied"
run DENIED "$UREC session_id='00000000000000000000GRANTS' $WREC" "command denied"
run DENIED "$UREC tenant_id='00000000000000000000GRANTX' $WREC" "command denied"
run DENIED "UPDATE session_recording_parts SET size_bytes=1 WHERE id='0000000000000000000GRANTP1'" "command denied"
run DENIED "UPDATE session_recording_parts SET storage_rel=NULL WHERE id='0000000000000000000GRANTP1'" "command denied"
run DENIED "ALTER TABLE session_recordings ADD COLUMN x INT" "denied"
run DENIED "ALTER TABLE session_recording_parts ADD COLUMN x INT" "denied"
run DENIED "CREATE TRIGGER t_x BEFORE INSERT ON session_recordings FOR EACH ROW SET @a=1" "denied"
run DENIED "DROP TABLE session_recording_parts" "denied"
# CHECK'ler — session_recordings
enum_case session_recordings_basis_chk TENANT_POLICY tenant_policy "CONCAT('TEN',$AA,'NT_POLICY')" "$TX $ADM; $(sr "'CONSENT','ACTIVE'" "@V@,'ACTIVE'"); $R"
enum_case session_recordings_state_chk STOPPED stopped "CONCAT('ST',$OA,'PPED')" "$TX $ADM; $SR1; $UREC state=@V@,stop_reason='ERROR',stopped_at=NOW(3) $WREC; $R"
enum_case session_recordings_stop_chk SESSION_END session_end "CONCAT('S',$EA,'SSION_END')" "$TX $ADM; $SR1; $UREC state='STOPPED',stop_reason=@V@,stopped_at=NOW(3) $WREC; $R"
enum_case session_recordings_delete_chk MISSING missing "CONCAT('M',CONVERT(X'C38D' USING utf8mb4),'SSING')" "$TX $ADM; $SR1; $UREC state='DELETED',stop_reason='ERROR',stopped_at=NOW(3),delete_reason=@V@,deleted_at=NOW(3) $WREC; $R"
run DENIED "$TX $ADM; $SR1; $UREC state='STOPPED',stopped_at=NOW(3) $WREC; $R" session_recordings_stop_chk                     # nedensiz durma
run DENIED "$TX $ADM; $SR1; $UREC stop_reason='ERROR' $WREC; $R" session_recordings_stop_chk                                    # ACTIVE'de neden
run DENIED "$TX $ADM; $SR1; $UREC state='STOPPED',stop_reason='ERROR',stopped_at=NOW(3)-INTERVAL 1 HOUR $WREC; $R" session_recordings_stop_chk   # başlangıçtan önce
run DENIED "$TX $ADM; $SR1; $UREC state='STOPPED',stop_reason='ERROR',stopped_at=NOW(3),delete_reason='MANUAL' $WREC; $R" session_recordings_delete_chk
run DENIED "$TX $ADM; $SR1; $UREC state='DELETED',stop_reason='ERROR',stopped_at=NOW(3),delete_reason='MANUAL' $WREC; $R" session_recordings_delete_chk   # deleted_at yok
run DENIED "$TX $ADM; $SR1; $SP1; $UREC size_bytes=1048576,part_count=1 $WREC; $UREC state='DELETED',stop_reason='ERROR',stopped_at=NOW(3),delete_reason='MANUAL',deleted_at=NOW(3) $WREC; $R" session_recordings_delete_chk   # sayaç sıfırlanmadan
run DENIED "$TX $ADM; $SR1; $UREC part_count=1 $WREC; $R" session_recordings_counters_chk
run DENIED "$TX $ADM; $SR1; $UREC size_bytes=-1,part_count=1 $WREC; $R" session_recordings_counters_chk
run DENIED "$TX $ADM; $(sr "INTERVAL 30 DAY" "INTERVAL 91 DAY"); $R" session_recordings_expires_chk
run DENIED "$TX $ADM; $(sr "INTERVAL 30 DAY" "INTERVAL 12 HOUR"); $R" session_recordings_expires_chk
run DENIED "$TX $ADM; $(sr "$GU" "'kullanici'"); $R" session_recordings_recorder_chk
run DENIED "$TX $ADM; $SR1; $(sr "$RID" "'0000000000000000000GRANTRD'"); $R" "Duplicate entry"                           # oturum başına tek kayıt
run DENIED "$TX $GX; $ADM; $(sr "'$GT'" "'00000000000000000000GRANTX'"); $R" session_recordings_session_id_tenant_id_fkey   # başka tenant'ın oturumu
run DENIED "$TX $ADM; $SR1; $SP1; DELETE FROM session_recordings $WREC; $R" session_recording_parts_recording_id_tenant_id_fkey   # silme sırası: parça → kayıt
# CHECK'ler — session_recording_parts
run DENIED "$TX $ADM; $SR1; $(sp "0,7,35000" "0,60,35000"); $R" session_recording_parts_part_no_chk                          # K-P28e-16: 0..59
run DENIED "$TX $ADM; $SR1; $(sp ",5000,1048576" ",0,1048576"); $R" session_recording_parts_duration_chk
run DENIED "$TX $ADM; $SR1; $(sp ",5000,1048576" ",15001,1048576"); $R" session_recording_parts_duration_chk
run DENIED "$TX $ADM; $SR1; $(sp ",5000,1048576" ",5000,0"); $R" session_recording_parts_size_chk
run DENIED "$TX $ADM; $SR1; $(sp ",5000,1048576" ",5000,2097153"); $R" session_recording_parts_size_chk
run DENIED "$TX $ADM; $SR1; $(sp "CONCAT('$GT'" "CONCAT('00000000000000000000GRANTX'"); $R" session_recording_parts_storage_rel_chk   # öndek başka tenant
run DENIED "$TX $ADM; $SR1; $(sp "'.rsf')" "'.rs/')"); $R" session_recording_parts_storage_rel_chk
run DENIED "$TX $ADM; $SR1; $(sp "'.rsf'),1" "'.rsf'),0"); $R" session_recording_parts_key_ver_chk
run DENIED "$TX $ADM; $SR1; $SP1; $(sp "GRANTP1'" "GRANTP3'" | sed "s/REPEAT('a',24)/REPEAT('c',24)/"); $R" "Duplicate entry"   # aynı (bölüm, parça)
run DENIED "$TX $ADM; $SR1; $SP1; $(sp "GRANTP1',$RID,'$GT',0,7" "GRANTP3',$RID,'$GT',0,8"); $R" "Duplicate entry"           # aynı dosya iki satırda
SPX="'0000000000000000000GRANTP1',$RID,'00000000000000000000GRANTX',0,7,35000,5000,1048576,CONCAT('00000000000000000000GRANTX','/',REPEAT('a',24),'.rsf'),1"
run DENIED "$TX $GX; $ADM; $SR1; INSERT INTO session_recording_parts ($SPC) VALUES ($SPX); $R" session_recording_parts_recording_id_tenant_id_fkey   # başka tenant'ın kaydı
# Temizlik (FK sırasıyla)
run_mig OK "DELETE FROM tenant_purge_jobs WHERE tenant_id IN ('00000000000000000000GRANTT','00000000000000000000GRANTW'); DELETE FROM session_consents WHERE id IN ('00000000000000000000GRANT9','0000000000000000000GRANT10'); DELETE FROM support_sessions WHERE id IN ('00000000000000000000GRANT7','00000000000000000000GRANT8'); DELETE FROM customers WHERE id='00000000000000000000GRANTY'; DELETE FROM tenants WHERE id='00000000000000000000GRANTW'; DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"  # P16: app tenant/users silemez (tetikleyici) → migrator
# P13a `backup` kullanıcısı (mimari-p13 §4): yalnız 'backup'@'localhost'; DB'de SELECT, SHOW VIEW, TRIGGER; global yetki yok.
run_root 1 "SELECT COUNT(*) FROM mysql.user WHERE user='backup'" "backup kullanıcısı var (tek hesap)"
run_root "'backup'@'localhost'" "SELECT GROUP_CONCAT(DISTINCT GRANTEE) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE \"'backup'@%\"" "backup yalnız localhost (soket; ağdan kullanılamaz)"
run_root "SELECT,SHOW VIEW,TRIGGER" "SELECT GROUP_CONCAT(PRIVILEGE_TYPE ORDER BY PRIVILEGE_TYPE) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=\"'backup'@'localhost'\" AND TABLE_SCHEMA=DATABASE()" "backup: DB yetkisi tam olarak SELECT, SHOW VIEW, TRIGGER"
run_root 0 "SELECT (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=\"'backup'@'localhost'\" AND PRIVILEGE_TYPE<>'USAGE') + (SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=\"'backup'@'localhost'\" AND TABLE_SCHEMA<>DATABASE()) + (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'backup'@'localhost'\") + (SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=\"'backup'@'localhost'\")" "backup: global (PROCESS dahil)/başka DB/tablo/sütun yetkisi yok"
run_backup() { # $1 beklenen OK|DENIED, $2 sql (backup kullanıcısı, konteyner içinden soketle)
  out=$(docker exec -e BPW="${BACKUP_PW:-}" "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="${BPW:-$MYSQL_BACKUP_PASSWORD}" mysql -ubackup -N "$1" -e "$0"' "$2" "${DB:-remote}" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || { s=FAIL; FAILED=1; }
  printf '%s | beklenen=%-6s sonuç=%-6s | (backup) %s %s\n' "$s" "$1" "$got" "$2" "$( [ $got = DENIED ] && echo "-> ${out##*: }" )"
}
run_backup OK     "SELECT COUNT(*) FROM audit_logs; SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1"
run_backup DENIED "INSERT INTO audit_logs (action,entity,result) VALUES ('test.backup','audit_logs','success')"
run_backup DENIED "UPDATE tenants SET name='x' WHERE id='-'"
run_backup DENIED "DELETE FROM auth_sessions WHERE id='-'"
run_backup DENIED "CREATE TABLE x_backup (id INT)"
run_backup DENIED "ALTER TABLE users ADD COLUMN x INT"
run_backup DENIED "DROP TABLE request_refs"
run_backup DENIED "LOCK TABLES users READ"
# Gerçek döküm (yedek betiğiyle aynı bayraklar): hatasız, 3 tetikleyici ve _prisma_migrations içerir.
dump=$(docker exec -e BPW="${BACKUP_PW:-}" "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="${BPW:-$MYSQL_BACKUP_PASSWORD}" mysqldump -ubackup --single-transaction --no-tablespaces --triggers --set-gtid-purged=OFF "$0" 2>&1 >/tmp/rs-grant-dump.sql; rc=$?; n=$(grep -c "^/\*!50003 CREATE\*/ /\*!50017 DEFINER=.*\*/ /\*!50003 TRIGGER" /tmp/rs-grant-dump.sql); m=$(grep -c "INSERT INTO \`_prisma_migrations\`" /tmp/rs-grant-dump.sql); rm -f /tmp/rs-grant-dump.sql; [ "$m" -gt 0 ] && m=yes; echo "rc=$rc triggers=$n migrations=$m"' "${DB:-remote}" 2>&1)
[[ "$dump" == *"rc=0 triggers=23 migrations=yes" ]] && s=PASS || { s=FAIL; FAILED=1; }
printf '%s | beklenen=rc=0 triggers=23 migrations=yes | (backup) mysqldump --single-transaction --no-tablespaces --triggers -> %s\n' "$s" "${dump//$'\n'/ }"
# P13b G-P13b-5: audit-continuity.sql backup kullanıcısıyla çalışır ve tetikleyici özeti beklenen sabite eşit (tetikleyici
# değiştiren migration audit-continuity.sql'deki sabiti güncellemezse burada FAIL olur).
cont=$(docker exec -i -e BPW="${BACKUP_PW:-}" "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="${BPW:-$MYSQL_BACKUP_PASSWORD}" exec mysql -ubackup -NB "$0"' "${DB:-remote}" < "$(dirname "$0")/audit-continuity.sql" 2>&1)
[[ "$cont" == *'"triggers": {"ok": true, "count": 23,'* && "$cont" == *'"format": 2'* ]] && s=PASS || { s=FAIL; FAILED=1; }
printf '%s | beklenen=triggers.ok=true count=23 | (backup) audit-continuity.sql -> %s\n' "$s" "$(grep -o '"triggers": {[^}]*}' <<<"$cont" || echo "${cont:0:200}")"
# P13b D1/D2 (ADR-0020 m.2): geri yükleme migrator ile yapılır; güvenlik sınırı migrator'ın `*.*` üzerinde yetkisiz olmasıdır.
run_root 0 "SELECT COUNT(*) FROM mysql.user WHERE user=''" "anonim MySQL hesabı yok (force_created_at USER() muafiyeti; §7.11)"
run_root "migratorExtra=0" "$(sed -n "/^SELECT CONCAT('migratorExtra=',/,/;\$/p" "$(dirname "$0")/restore-sec-snapshot.sql")" "migrator: kendi DB'si dışında hiçbir yetki/rol/proxy/ek host yok (restore-sec-snapshot.sql ile aynı sorgu)"
run_migrator() { # $1 beklenen DENIED, $2 sql (migrator, konteyner içinden soketle; parola MIGRATOR_PW ya da konteyner env'i)
  out=$(docker exec -e MPW="${MIGRATOR_PW:-}" "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="${MPW:-$MYSQL_MIGRATOR_PASSWORD}" mysql -umigrator --protocol=socket --system-command=OFF --local-infile=0 -N "$1" -e "$0"' "$2" "${DB:-remote}" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || { s=FAIL; FAILED=1; }
  printf '%s | beklenen=%-6s sonuç=%-6s | (migrator) %s %s\n' "$s" "$1" "$got" "$2" "$( [ $got = DENIED ] && echo "-> ${out%%:*}" )"
}
run_migrator DENIED "CREATE USER 'rs_grant_probe'@'localhost' IDENTIFIED BY 'rs-grant-probe-123'"
run_migrator DENIED "GRANT SELECT ON *.* TO 'app'@'%'"
run_migrator DENIED "GRANT SELECT ON mysql.* TO 'app'@'%'"
run_migrator DENIED "SET PERSIST max_connections = @@global.max_connections"
run_migrator DENIED "INSERT INTO mysql.user (Host, User) VALUES ('localhost', 'rs_grant_probe')"
run_migrator DENIED "CREATE DATABASE rs_grant_probe"
run_migrator DENIED "CREATE DEFINER='root'@'localhost' TRIGGER rs_grant_probe BEFORE INSERT ON _prisma_migrations FOR EACH ROW SET @a = 1"
# Beklenmedik başarıya karşı temizlik (yukarıdakiler FAIL olsa da iz kalmasın).
docker exec "${CONTAINER:-rs-mysql-test}" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N "$0" -e "DROP USER IF EXISTS '"'"'rs_grant_probe'"'"'@'"'"'localhost'"'"'; RESET PERSIST IF EXISTS max_connections; DROP DATABASE IF EXISTS rs_grant_probe; DROP TRIGGER IF EXISTS rs_grant_probe; REVOKE IF EXISTS SELECT ON *.* FROM '"'"'app'"'"'@'"'"'%'"'"'"' "${DB:-remote}" >/dev/null 2>&1
exit $FAILED
