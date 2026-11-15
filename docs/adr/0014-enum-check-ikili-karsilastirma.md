# ADR-0014 — Enum CHECK kısıtlarında ikili (byte) karşılaştırma

Durum: Kabul · Tarih: 2026-11-11 · İlgili: ADR-0003 (MySQL + Prisma), ADR-0013, `docs/db-notlari.md` P7 gözlemi, `docs/gereksinimler.md` "Sonra / açık — P7'den"

## Bağlam

Tablolar `utf8mb4_unicode_ci` ile oluşturuldu. Bu harmanlama **harf duyarsız, aksan duyarsız ve PAD SPACE**'tir. Bu yüzden VARCHAR enum sütunlarındaki `CHECK (col IN ('UI','HOTKEY',…))` kısıtları `'tech'`i geçirir (dba P7'de denedi). Harmanlama kuralına göre `'TÉCH'` ve `'TECH '` de geçer; dba bunları da test edecek. Şu anda yazılan değerler doğru, çünkü tek kaynak uygulama sabitleri (contracts) ve zod strict. Ama DB'deki ikinci emniyet sanıldığından zayıf.

Bu P8 ile önem kazanıyor. P8 oturum geçmişi, zaman çizelgesi ve CSV, P11 ise audit filtreleri bu değerleri **okuyup etikete çevirecek**: `LABELS[value]`, exhaustive `switch`, `as SessionStatus` dönüşümü. Kanonik olmayan bir değer, sorguda `=` ile eşleşir (ci). Ama TS tarafında etiketsiz, boş ya da hatalı gösterilir. KVKK kanıtı olan `session_consents.source/decision` satırında bu kabul edilemez.

Uygulama dışında yazıcı olabilecekler var: elle SQL ile yapılan olay müdahalesi, P13 retention/anonimleştirme işi, ileride bir rapor aracı.

Kapsamdaki enum CHECK'leri (14 adet):

- `tenants.status`
- `users.role/theme/status`
- `tenant_settings.smtp_security`
- `audit_logs.result`
- `support_sessions.status/ended_by/mode`
- `session_consents.level/decision/source`
- `session_files.direction/result`

Biçim (REGEXP) CHECK'leri zaten `'c'` bayrağıyla harf duyarlı.

## Karar

**(b) CHECK'lerde ikili karşılaştırma.** Her enum CHECK'i şu biçime çevrilir: ``CAST(`col` AS BINARY) IN ('A','B',…)`` (NULL olabilen sütunlarda `` `col` IS NULL OR … `` korunur).

- `CAST(… AS BINARY)` VARBINARY üretir. Karşılaştırma byte byte yapılır ve **NO PAD**'dir: harf, aksan ve sondaki boşluk farkı reddedilir. `BINARY expr` operatörü kullanılmaz (MySQL 8.0.27+'da kullanımdan kalkıyor). `utf8mb4_bin` da kullanılmaz (PAD SPACE: `'TECH '` geçer).
- Sütun harmanlamaları **değişmez**. Sorgu davranışı ve indeksler aynı kalır. Prisma şeması değişmez; CHECK'ler drift karşılaştırmasına girmez.
- Aynı CHECK'lerdeki eşitlik ifadeleri değişmez: `status = 'PENDING'`, `role = 'SUPER_ADMIN'`, `level = 'VIEW'`. Enum CHECK değeri kanonik kıldığı için bunlar doğru kalır.
- **Kural (ileriye dönük):** yeni enum CHECK'leri doğrudan bu biçimde yazılır. Metin biçim CHECK'leri `REGEXP_LIKE(…, 'c')` kullanır. `docs/db-notlari.md` "Ortak" satırına işlenir.
- `support_sessions.end_reason` için CHECK **eklenmez**. Mimari §3.1, P3 kararı bu konuda değişmedi. Okuyan taraf bilinmeyen değeri ham gösterir (etiket yedeği, `mimari-api.md` "Oturum geçmişi").
- `audit_logs.action` serbest metindir (CHECK yok). P11 filtresi contracts'taki action listesiyle (zod enum) sınırlanır.

**Uygulama:** P8 içinde, dba, **ayrı migration** (`2026111107xxxx_enum_check_binary`, P8 `session_history` migration'ından sonra). P8 backend ve frontend ile paraleldir; onlar bu değişikliğe bağımlı değildir. P8 qa kapsamındadır. Ayrıntı ve test listesi: `docs/db-notlari.md` "ADR-0014 uygulaması".

## Alternatifler

- **(a) Sütunları `utf8mb4_bin` / `ascii_bin` harmanlamaya çevirmek:** Prisma şeması sütun harmanlamasını ifade edemiyor. Prisma'nın ileride ürettiği her `MODIFY COLUMN` sütunu sessizce tablo varsayılanına (ci) döndürür; kısıt fark edilmeden zayıflar ve drift kontrolü bunu güvenilir biçimde yakalamaz. Ayrıca 14 sütunda `MODIFY` gerekir (COPY; `audit_logs` dahil), sorgu semantiği de değişir. `utf8mb4_bin` PAD SPACE olduğu için sondaki boşluğu da çözmez. Reddedildi.
- **(c) Risk kabulü:** Bugün tek yazıcı uygulama. Ama P8/P11 okuyucuları kanonik değer varsayıyor, KVKK kanıt satırları var ve uygulama dışı yazıcılar mümkün. Düzeltmenin maliyeti şimdi en düşük seviyede: prod açık değil (P10), tablolar küçük. Sonra `audit_logs` (en hızlı büyüyen tablo) için COPY bakım penceresi ister. Reddedildi.
- **`REGEXP_LIKE(col, '^(A|B)$', 'c')`:** aynı sonucu verir ama okunması ve bakımı zordur. Reddedildi.

## Sonuçlar

- Yeni bağımlılık yok, kod değişmez. Uygulama sabitleri zaten kanonik yazıyor. Yalnız migration, `down.sql` ve `check-app-grants.sh` değişir.
- `ADD CHECK` ALGORITHM=COPY'dir: 6 tablo yeniden yazılır. Staging verisi küçük ve prod açık değil, bu yüzden kabul edildi. Her tablo tek `ALTER … DROP CHECK x, ADD CONSTRAINT x CHECK (…)` ile değişir; kısıtsız ara an olmaz.
- Mevcut satırlardan biri kanonik değilse ALTER 3819 ile atomik olarak başarısız olur. Önce ön kontrol sorgusu çalıştırılır (db-notlari). Kanonik olmayan satır bulunursa **elle düzeltilmez**, mimara bildirilir; çünkü consent satırları kanıttır.
- `down.sql` ci biçime döner. Geri dönüş genişletme yönünde olduğu için her zaman başarılı olur.
- P8/P11 okuyucularında etiket eşlemesi kanonik değer varsayabilir. Yedek (ham değer göster) yalnız CHECK'siz `end_reason` ve `action` için gerekir.
