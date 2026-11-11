-- P7 (ADR-0013, mimari §3.1 + §10.2 P7 dba notu, mimari-protokol §3.3 K1): session_consents.source kümesine
-- `TECH` eklenir — teknisyenin kontrolü bırakması/iptali (`control.release`, GRANTED iken `control.cancel`)
-- CONTROL/REVOKED/TECH satırı yazar. Bırakmayı SYSTEM ile kaydetmek aktörü yanlış gösterirdi (ADR-0013, reddedildi).
--
-- ELLE YAZILDI (dba): Prisma CHECK ifade edemez (P4 migration'ındaki elle eklenen CHECK'in genişletilmesi);
-- schema.prisma'da yalnız yorum değişti, `migrate diff` boş üretir.
-- Kilitleme notu: MySQL'de CHECK değiştirmek = DROP + ADD; ADD CHECK ALGORITHM=COPY (tablo yeniden yazılır,
-- yazma kilitli). Tablo küçük (oturum başına birkaç satır) ve prod henüz açık değil (P10) → kabul.
-- Tek ALTER: kısıtsız ara an yok; ifade genişlediği için mevcut satırlar ihlal üretmez.
-- Veri taşıma yok. Geri alma: down.sql (TECH satırı varsa bilerek başarısız olur — onay kaydı yasal kanıttır).
ALTER TABLE `session_consents`
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_source_chk` CHECK (`source` IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH'));
