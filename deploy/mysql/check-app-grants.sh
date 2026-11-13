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
run DENIED "DELETE FROM customers WHERE id='00000000000000000000GRANTK'"
run DENIED "ALTER TABLE customers ADD COLUMN x INT"
run DENIED "UPDATE request_refs SET customer_id=NULL WHERE ref='cccccccccccccccc'"
run DENIED "DELETE FROM request_refs WHERE ref='cccccccccccccccc'"
run DENIED "ALTER TABLE request_refs ADD COLUMN x INT"
run DENIED "$TX $RR ('cccccccccccccccc','00000000000000000000GRANTT',NULL); $RR ('cccccccccccccccc','00000000000000000000GRANTT',NULL); $R" PRIMARY
run DENIED "$TX $RR ('CCCCCCCCCCCCCCCC','00000000000000000000GRANTT',NULL); $R" request_refs_ref_fmt_chk
run DENIED "$TX $CU1; $GX; $RR ('cccccccccccccccc','00000000000000000000GRANTX','00000000000000000000GRANTK'); $R" request_refs_tenant_id_customer_id_fkey
run DENIED "$TX $(cu "'Grant Musteri'" "'A'"); $R" customers_name_chk
run DENIED "$TX $(cu "'Grant Musteri'" "CONCAT('Grant',$RTLO,'exe')"); $R" customers_name_chk
run DENIED "$TX $(cu "'GrantMusteri'" "'Grant-Musteri'"); $R" customers_file_label_chk
run DENIED "$TX $(cu "'cccccccccccccccc'" "'cccccccccccccc01'"); $R" customers_ref_fmt_chk
run DENIED "$TX $(cu "'grant musteri 905301112233'" "'baska 905301112233'"); $R" customers_search_key_chk
run DENIED "$TX $(cu "'grant musteri','grant musteri 9" "' grant musteri',' grant musteri 9"); $R" customers_name_key_chk
run DENIED "$TX $CU1; $UC status='passive',passive_at=NOW(3) $WC; $R" customers_status_chk
run DENIED "$TX $CU1; $UC status='PASSIVE' $WC; $R" customers_passive_chk
run DENIED "$TX $CU1; $UC passive_at=NOW(3) $WC; $R" customers_passive_chk
run DENIED "$TX $CU1; $UC phone='05301112233' $WC; $R" customers_phone_fmt_chk
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
run DENIED "$TX $CU1; $ADM; $DB1; $UB issue_count=0 $WB; $R" device_bindings_issue_count_chk
run DENIED "$TX $CU1; $ADM; $DB1; $UB active_session_id=NULL $WB; $R" "generated column"
run DENIED "DELETE FROM device_bindings WHERE id='00000000000000000000GRANTB'"
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
run DENIED "DELETE FROM password_reset_tokens WHERE id='00000000000000000000GRANTP'"
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
run_root 2 "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='audit_logs' AND ((TRIGGER_NAME='audit_logs_no_update' AND EVENT_MANIPULATION='UPDATE') OR (TRIGGER_NAME='audit_logs_retention_only_delete' AND EVENT_MANIPULATION='DELETE')) AND ACTION_TIMING='BEFORE'" "audit_logs tetikleyicileri var (BEFORE UPDATE + BEFORE DELETE)"
run_root 0 "SELECT (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND PRIVILEGE_TYPE<>'USAGE') + (SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\") + (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND PRIVILEGE_TYPE IN ('TRIGGER','ALTER','DROP','CREATE','INDEX','REFERENCES','GRANT OPTION'))" "app: global/DB yetkisi yok, hiçbir tabloda TRIGGER/ALTER/DROP/CREATE/INDEX yok"
run_root 0 "SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_NAME='audit_logs' AND PRIVILEGE_TYPE NOT IN ('SELECT','INSERT')" "app: audit_logs yalnız SELECT/INSERT (DELETE P13)"
run_root 0 "SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=\"'app'@'%'\" AND TABLE_NAME='audit_logs'" "app: audit_logs sütun düzeyi UPDATE yok"
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
# Temizlik (FK sırasıyla)
run OK     "DELETE FROM users WHERE id='00000000000000000000GRANTU'; DELETE FROM tenant_settings WHERE tenant_id='00000000000000000000GRANTT'; DELETE FROM tenants WHERE id='00000000000000000000GRANTT'"
exit $FAILED
