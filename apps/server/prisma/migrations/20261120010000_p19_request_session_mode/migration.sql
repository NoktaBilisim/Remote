-- P19 J2 (backend; docs/mimari-e11.md §8c.2 m.5, AC-259): web talebi kabulünde oturum `mode = 'BROWSER'` olur (BROWSER
-- ön-kabul). P8b'nin `support_sessions_request_mode_chk` kısıtı talep oturumunu yalnız AGENT'a bağlıyordu → J1'de
-- gevşetilmemişti (sapma notu: docs/implementation.md "P19 J2", mimari §8c.1). Kısıt düşürülür: `support_sessions_mode_chk`
-- (`mode IS NULL OR mode IN ('AGENT','BROWSER')`, ikili) zaten geçerli değer kümesini korur; talep ↔ kaynak eşleşmesi tablo
-- arası olduğundan CHECK ile ifade edilemez (servis: `source='WEB'` ⇒ BROWSER ön-kabul, `/ws/guest` türü ticket'tan).
-- Kilit: DROP CHECK yalnız meta veri (INPLACE, yeniden yazım yok). Tetikleyici yok → toplam 23 aynı.
ALTER TABLE `support_sessions` DROP CHECK `support_sessions_request_mode_chk`;
