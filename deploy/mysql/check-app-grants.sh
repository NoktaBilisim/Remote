#!/bin/bash
# app DB kullanıcısının yetki sınırı kontrolü (G-15, AC-123 kullanıcı ayrımı). Kullanım:
#   APP_PW=<app parolası> CONTAINER=<mysql konteyner adı> DB=<veritabanı> ./check-app-grants.sh
# Beklenen tüm satırlar PASS; FAIL varsa çıkış kodu 1. Geçici tenant/kullanıcı ekler ve sonunda siler; audit_logs'a kalıcı satır yazmaz.
FAILED=0
run() { # $1 beklenen, $2 sql, $3 (ops.) DENIED'de hata mesajında beklenen metin (ör. kısıt adı)
  out=$(docker exec -e MYSQL_PWD="$APP_PW" "${CONTAINER:-rs-mysql-test}" mysql -uapp "${DB:-remote}" -N -e "$2" 2>&1)
  if [ $? -eq 0 ]; then got=OK; else got=DENIED; fi
  [ "$got" = "$1" ] && s=PASS || s=FAIL
  [ "$s" = PASS ] && [ "$got" = DENIED ] && [ -n "${3:-}" ] && [[ "$out" != *"$3"* ]] && s=FAIL
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
run DENIED "DELETE FROM consent_texts WHERE id='00000000000000000000GRANTC'"
run DENIED "ALTER TABLE consent_texts ADD COLUMN x INT"
run DENIED "START TRANSACTION; $CT1; $CT ('00000000000000000000GRANTD','00000000000000000000GRANTT',2,'v2',SHA2('v2',256),1,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT1; $CT ('00000000000000000000GRANTD','00000000000000000000GRANTT',1,'v2',SHA2('v2',256),0,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT ('00000000000000000000GRANTC','00000000000000000000GRANTT',1,'metin',SHA2('baska',256),1,NOW(3)); ROLLBACK"
run DENIED "START TRANSACTION; $CT ('00000000000000000000GRANTC','00000000000000000000GRANTT',0,'metin',SHA2('metin',256),1,NOW(3)); ROLLBACK"
run OK     "START TRANSACTION; $CT1; $ADM; $SC ('00000000000000000000GRANTV','00000000000000000000GRANTS','00000000000000000000GRANTT','VIEW','GRANTED','UI','00000000000000000000GRANTC',SHA2($B,256),'203.0.113.7','ua'),('00000000000000000000GRANTW','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','DENIED','SYSTEM',NULL,NULL,NULL,NULL); ROLLBACK"
run DENIED "UPDATE session_consents SET ip=NULL WHERE id='00000000000000000000GRANTV'"
run DENIED "DELETE FROM session_consents WHERE id='00000000000000000000GRANTV'"
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
run DENIED "DELETE FROM session_files WHERE id='00000000000000000000GRANTF'"
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
enum_case tenant_settings_smtp_security_chk SSL ssl "CONCAT('SS',CONVERT(X'C4B9' USING utf8mb4))" "$TX UPDATE tenant_settings SET smtp_security=@V@ WHERE tenant_id='00000000000000000000GRANTT'; $R"
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
run DENIED "DELETE FROM tenant_request_settings WHERE tenant_id='00000000000000000000GRANTT'"
run DENIED "ALTER TABLE tenant_request_settings ADD COLUMN x INT"
run DENIED "$TX $RS ('00000000000000000000GRANTT','ABCDEFGHIJK23456','GrantTest','[]','[]','[]',NOW(3)); $R" tenant_request_settings_ref_fmt_chk
run DENIED "$TX $RS ('00000000000000000000GRANTT','abcdefghijk23456','Grant-Test','[]','[]','[]',NOW(3)); $R" tenant_request_settings_file_label_chk
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
run DENIED "DELETE FROM support_requests WHERE id='00000000000000000000GRANTR'"
run DENIED "ALTER TABLE support_requests ADD COLUMN x INT"
# Talep CHECK negatifleri (beklenen kısıt adıyla).
run DENIED "$TX $(rq "'123456'" "'12345A'"); $R" support_requests_code_fmt_chk
run DENIED "$TX $(rq "'+905301112233'" "'05301112233'"); $R" support_requests_phone_fmt_chk
run DENIED "$TX $(rq "'0.9.0'" "'0.9'"); $R" support_requests_client_version_fmt_chk
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
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); UPDATE support_sessions SET status='ACTIVE',consumed_at=NOW(3),mode='BROWSER' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_request_mode_chk
run DENIED "$TX $RQ; $ACC; INSERT INTO support_sessions (id,tenant_id,technician_id,token_hash,active_code,tech_verify_code,status,expires_at,created_at,updated_at,request_id) VALUES ('00000000000000000000GRANTS',$T,$H1,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'),('00000000000000000000GRANT1',$T,$H2,NULL,'0427','PENDING',NOW(3)+INTERVAL 60 SECOND,NOW(3),NOW(3),'00000000000000000000GRANTR'); $R" support_sessions_request_id_tenant_id_key
run DENIED "$TX $SS ('00000000000000000000GRANTS',$T,$H1,'48291376','0427','PENDING',$E15,NULL,NOW(3),NOW(3)); UPDATE support_sessions SET guest_net_key='203.0.113.0/24',guest_ip_key='203.0.113.7' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_guest_keys_chk
run DENIED "$TX $ADM; UPDATE support_sessions SET guest_net_key='203.0.113.0/24' WHERE id='00000000000000000000GRANTS'; $R" support_sessions_guest_keys_chk
run OK     "$TX $ADM; UPDATE support_sessions SET customer_name='Ayse Yilmaz',customer_email=CONCAT(REPEAT('a',240),'@example.test') WHERE id='00000000000000000000GRANTS'; $R"
run DENIED "$TX $RQ; $ACC; $RSR; INSERT INTO session_consents (id,session_id,tenant_id,level,decision,source,request_id) VALUES ('00000000000000000000GRANTW','00000000000000000000GRANTS','00000000000000000000GRANTT','CONTROL','DENIED','SYSTEM','00000000000000000000GRANTR'); $R" session_consents_request_scope_chk
run DENIED "UPDATE session_consents SET request_id=NULL WHERE id='00000000000000000000GRANTV'"
# Temizlik (FK sırasıyla)
run OK     "DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"
exit $FAILED
