-- Audit süreklilik ölçümü (P13b D2 + G-P13b-5; docs/mimari-p13.md §7.6/1+3, ADR-0020 m.5, AC-301;
-- docs/db-notlari.md "P13b"). Salt okuma. Çalıştıran: deploy/backup/backup.sh, `backup` kullanıcısıyla (SELECT + TRIGGER
-- meta okuma yeter), konteyner içinden soketle. Önceki başarılı manifestte `audit.tail` varsa parametreleri önce verilir:
--   { [ -n "$PREV_DAY" ] && printf "SET @rs_prev_tail_day = '%s', @rs_prev_tail_until = '%s';\n" "$PREV_DAY" "$PREV_UNTIL"
--     cat mysql/audit-continuity.sql; } \
--   | docker exec -i "$CID" sh -c 'MYSQL_PWD="$MYSQL_BACKUP_PASSWORD" exec mysql -ubackup -NB "$MYSQL_DATABASE"'
--   (PREV_DAY ^[0-9]{4}-[0-9]{2}-[0-9]{2}$, PREV_UNTIL ^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$ ile
--   bash'te doğrulanır; değerler önceki İMZALI manifestten gelir.)
-- Çıktı: TEK satır JSON → manifest `audit` alanı (jq --argjson). Alanlar:
--   format          2 (P13b; `days` değerleri nesne). format yoksa/1 ise önceki manifest "ilk" sayılır.
--   instanceId      @@server_uuid: veri dizini kimliği. Yeni kurulum/yeni volume → değişir → karşılaştırma yok ("ilk").
--   maxId           audit_logs en büyük id (boşsa 0). TRUNCATE/yeniden oluşturma → azalır.
--   asOfUtcDate     ölçüm UTC günü T (dahil değil). measuredAtUtc: ölçüm anı (UTC, ms).
--   baseline        {id, at}: son `backup.audit_baseline_reset` audit satırı (yoksa {id:0, at:null}). Önceki manifestten
--                   farklıysa ve host işareti (S-P13b-1) aynı id'yi taşıyorsa taban çizgisi sıfırlanmıştır
--                   (`backup.sh --reset-audit-baseline`) → karşılaştırma yok + journal + BACKUP_ALERT_CMD (uyarı).
--   triggers        {count, digest, ok}: DB'deki tüm tetikleyicilerin (ad, tablo, zaman, olay, sıra, GÖVDE, DEFINER)
--                   SHA-256'sı; ok = digest bu dosyadaki beklenen sabite eşit. ok=false → FAILED adım=tetikleyici (taban
--                   çizgisinden bağımsız, mutlak). Tetikleyici değiştiren migration bu sabiti ve check-app-grants'i günceller.
--   days            {"YYYY-MM-DD": {n, h}}: [T−729, T−1] tamamlanmış UTC günleri (yalnız satırı olanlar). n = satır sayısı,
--                   h = SHA-256( id sırasıyla her satırın SHA-256(JSON_ARRAY(bütün sütunlar)) hex'lerinin birleşimi ).
--                   Sıralı ve kriptografik: UPDATE, sil+aynı sayıda ekle, yer değiştirme görünür. h=null → özet kesildi
--                   (gün > ~1 M satır, max_allowed_packet) → FAILED (yanlış OK verilmez).
--   tail            {day: T, until, n, h}: bugünün [T 00:00, until) satırları; until = ölçüm − 5 dk (kısa süren açık
--                   transaction'ların sonradan görünmesine pay). Ertesi çalıştırma bunu prevTail ile doğrular.
--   prevTail        @rs_prev_tail_* verilmişse aynı aralığın (önceki çalıştırmanın günü, < önceki until) BUGÜNKÜ {n, h}'si;
--                   verilmemişse null.
-- Karşılaştırma kuralı (backup.sh, devops) — önceki başarılı manifest P (asOfUtcDate = Pd), bugünkü T:
--   0. triggers.ok ≠ true → FAILED adım=tetikleyici (her durumda).
--   1. P yok / P.audit.format ≠ 2 / instanceId, env, host, database farklı → `audit-sureklilik: ilk` (yazılır, FAIL değil).
--   2. baseline.id ≠ P.audit.baseline.id:
--      a) baseline.at, P.audit.measuredAtUtc'den YENİ VE host işareti `$BACKUP_DIR/audit-baseline-reset.json` (root 600;
--         yalnız `backup.sh --reset-audit-baseline` yazar, restore.sh canlı yüklemeden sonra çağırır) id = baseline.id ise →
--         `audit-sureklilik: taban-cizgisi-sifirlandi id=<id> zaman=<at>` + alarm (uyarı), karşılaştırma yok. İşaret
--         imzalı manifeste (`auditContinuity.baselineMarker`) kopyalanır ve silinir.
--      b) baseline.at yeni ama işaret yok / id farklı → FAILED taban-cizgisi-isaretsiz (S-P13b-1: audit_logs'a INSERT
--         yapabilen app/migrator sahte bir sıfırlama satırıyla karşılaştırmayı atlatamaz).
--      c) değilse (kayıt yok/null, eski ya da azalmış — ör. TRUNCATE sıfırlama kaydını da sildi) →
--         FAILED taban-cizgisi-kaydi-kayboldu (Kritik, alarm).
--   3. FAILED adım=audit-sureklilik ⇔ maxId_T < maxId_P
--        VEYA (T−728) ≤ gün < Pd olan bir günde days_T[gün] ≠ days_P[gün] (anahtar yokluğu = {n:0, h:null}; n ve h birlikte)
--        VEYA prevTail ≠ P.audit.tail {n, h} (P.audit.tail.day ≥ T−728 ise).
--   En eski gün (T−729) retention payıdır; karşılaştırılmaz. Retention 730 günden eski satırı siler; pencerede ölçüm anında
--   730 günlük satır yoktur.
-- Kör kalan aralık (belgelenmiş sınır): bir satır, onu İLK ölçen çalıştırmadan sonra korunur. Ölçüm anından sonra
--   (ve son 5 dk'da) yazılan satır, ertesi çalıştırmaya kadar (≤ 24 sa + 5 dk) karşılaştırılmaz. Bu sürede silinir/
--   değiştirilirse görünmez; ertesi çalıştırmada maxId (silme sonda ise) dahi yakalamayabilir. Daha sık yedek (timer)
--   bu pencereyi daraltır; tam kapatma site dışı yalnız-yazılır kopyayla (ADR-0020 m.5, Sonra).
-- Performans: gün histogramı IX audit_logs_created_at_idx; içerik özeti satırları okur (JSON dahil). Ölçüm: db-notlari P13b.
-- Tutarlılık: tek SELECT = tek tutarlı okuma (InnoDB). Dökümle aynı anlık görüntü değildir; gerekmez.
SET SESSION group_concat_max_len = 4294967295;
SET @rs_now = UTC_TIMESTAMP(3), @rs_today = UTC_DATE();
SET @rs_until = GREATEST(CAST(@rs_today AS DATETIME(3)), @rs_now - INTERVAL 5 MINUTE);
SET @rs_ptd = STR_TO_DATE(@rs_prev_tail_day, '%Y-%m-%d'),
    @rs_ptu = STR_TO_DATE(@rs_prev_tail_until, '%Y-%m-%d %H:%i:%s.%f');
SELECT JSON_OBJECT(
    'format', 2,
    'instanceId', @@server_uuid,
    'maxId', (SELECT COALESCE(MAX(`id`), 0) FROM `audit_logs`),
    'asOfUtcDate', CAST(@rs_today AS CHAR),
    'measuredAtUtc', DATE_FORMAT(@rs_now, '%Y-%m-%d %H:%i:%s.%f'),
    'baseline', (SELECT JSON_OBJECT('id', COALESCE(MAX(`id`), 0),
                                    'at', DATE_FORMAT(MAX(`created_at`), '%Y-%m-%d %H:%i:%s.%f'))
                   FROM `audit_logs` WHERE `action` = 'backup.audit_baseline_reset'
                    AND `id` = (SELECT MAX(`id`) FROM `audit_logs` WHERE `action` = 'backup.audit_baseline_reset')),
    'triggers', (SELECT JSON_OBJECT('count', `c`, 'digest', `g`,
                                    -- BEKLENEN SABİT: tetikleyici değiştiren migration'la birlikte güncellenir
                                    -- (20261119000000_p18_request_comms sonrası 23 tetikleyici: audit 3 + P16 19 + P18 1;
                                    -- check-app-grants da sınar. P16 sonrası 22'nin sabiti: a4a6f552…13be; P13a 3: c1ce0877…50eb).
                                    -- 20261123000000_p28b_stored_files: sayı 23 kalır, support_sessions_update_guard gövdesi
                                    -- genişledi (file_mode dalı) → yeni sabit; P18..P27 sabiti f029d544…3c90.
                                    'ok', IF(COALESCE(`g` = '0fdacca7fc67a7b472827b603d65584803be5f749e319a70d5d008cb68a673e0', 0),
                                             CAST('true' AS JSON), CAST('false' AS JSON)))
                   FROM (SELECT COUNT(*) AS `c`, SHA2(GROUP_CONCAT(JSON_ARRAY(`TRIGGER_NAME`, `EVENT_OBJECT_TABLE`,
                                `ACTION_TIMING`, `EVENT_MANIPULATION`, `ACTION_ORDER`, `ACTION_STATEMENT`, `DEFINER`)
                                ORDER BY CAST(`TRIGGER_NAME` AS BINARY) SEPARATOR '\n'), 256) AS `g`
                           FROM information_schema.TRIGGERS WHERE `TRIGGER_SCHEMA` = DATABASE()) AS `t`),
    'days', (SELECT COALESCE(JSON_OBJECTAGG(`d`, JSON_OBJECT('n', `n`, 'h', `h`)), JSON_OBJECT())
               FROM (SELECT `d`, `n`, IF(`n` * 64 = LENGTH(`g`), SHA2(`g`, 256), NULL) AS `h`
                     FROM (SELECT CAST(DATE(`created_at`) AS CHAR) AS `d`, COUNT(*) AS `n`,
                                  GROUP_CONCAT(`rh` ORDER BY `id` SEPARATOR '') AS `g`
                       FROM (SELECT `id`, `created_at`,
                                    SHA2(JSON_ARRAY(`id`, `created_at`, `tenant_id`, `user_id`, `username`, `action`, `entity`,
                                                    `entity_id`, `old_value`, `new_value`, `ip_address`, `user_agent`,
                                                    `result`, `correlation_id`), 256) AS `rh`
                               FROM `audit_logs`
                              WHERE `created_at` >= @rs_today - INTERVAL 729 DAY AND `created_at` < @rs_today) AS `r`
                      GROUP BY `d`) AS `y`) AS `x`),
    'tail', (SELECT JSON_OBJECT('day', CAST(@rs_today AS CHAR), 'until', DATE_FORMAT(@rs_until, '%Y-%m-%d %H:%i:%s.%f'),
                                'n', COUNT(*),
                                'h', IF(COUNT(*) * 64 = COALESCE(LENGTH(GROUP_CONCAT(`rh` ORDER BY `id` SEPARATOR '')), 0),
                                        SHA2(COALESCE(GROUP_CONCAT(`rh` ORDER BY `id` SEPARATOR ''), ''), 256), NULL))
               FROM (SELECT `id`, SHA2(JSON_ARRAY(`id`, `created_at`, `tenant_id`, `user_id`, `username`, `action`, `entity`,
                                                  `entity_id`, `old_value`, `new_value`, `ip_address`, `user_agent`,
                                                  `result`, `correlation_id`), 256) AS `rh`
                       FROM `audit_logs` WHERE `created_at` >= @rs_today AND `created_at` < @rs_until) AS `r`),
    'prevTail', IF(@rs_ptd IS NULL OR @rs_ptu IS NULL, NULL,
        (SELECT JSON_OBJECT('day', CAST(@rs_ptd AS CHAR), 'until', DATE_FORMAT(@rs_ptu, '%Y-%m-%d %H:%i:%s.%f'),
                            'n', COUNT(*),
                            'h', IF(COUNT(*) * 64 = COALESCE(LENGTH(GROUP_CONCAT(`rh` ORDER BY `id` SEPARATOR '')), 0),
                                    SHA2(COALESCE(GROUP_CONCAT(`rh` ORDER BY `id` SEPARATOR ''), ''), 256), NULL))
           FROM (SELECT `id`, SHA2(JSON_ARRAY(`id`, `created_at`, `tenant_id`, `user_id`, `username`, `action`, `entity`,
                                              `entity_id`, `old_value`, `new_value`, `ip_address`, `user_agent`,
                                              `result`, `correlation_id`), 256) AS `rh`
                   FROM `audit_logs` WHERE `created_at` >= @rs_ptd AND `created_at` < @rs_ptu) AS `r`))
    ) AS `audit`;
