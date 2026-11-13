# QA Raporu — P12b (WhatsApp servisi sistem ayarı) — Tur 3
Tarih: 2026-11-13 · Denetçi: qa-denetci · Kapsam: Tur 2 "Düzeltilmeli 1" (runbook a–e), runbook ↔ kod karşılaştırması
DURUM: GEÇTİ

## Test sonucu
Bu turda yalnız `docs/runbook.md` değişti, kod değişmedi; testler yeniden koşulmadı. Geçerli sonuçlar Tur 2'den:
- lint ve typecheck temiz
- birim testler: contracts 75, web 243, server 347
- `test:int`: 50 dosya, 491/491
- e2e (p12b, p11-admin, p8b): 42 geçti, 0 hata, 30 atlandı (`desktopOnly` gerekçeli)

## Tur 2 maddesinin durumu (runbook ↔ kod)
| Alt madde | Durum | Runbook | Kod karşılığı |
|---|---|---|---|
| (a) `whatsapp_invalid_url` alarmı | ✅ | §12.5 satır 725 (error seviyesi, her ortam, `reason: insecure`, yapılacaklar); §17.4 satır 1334 | `notify/whatsapp.ts:164` `log.error({ alarm: "whatsapp_invalid_url" })`, adres loga yazılmıyor |
| (b) `insecure` nedeni ayrıştırılamayan adresi de kapsar | ✅ | §17.4 satır 1331 | `isInsecureServiceUrl` → `!isParsableServiceUrl` ise `true` (her ortam); `test()` `reason: "insecure"` |
| (c) 429 satırında global tavan | ✅ | §17.4 satır 1332: kişi başı 5/dk, ortak 20/dk, tenant ayrı kova 5/dk | `routes.ts` `waTestLimits` (6/21 eşik → 5/20); `requests/limits.ts:80` `waTest` 6 eşik → tenant 5/dk |
| (d) "backend bu turda ekliyor" ifadesi | ✅ | §17.1: "`apps/server/src/env.ts` aynı `waServiceUrlSchema` ile doğrular" (eski ifade kalmadı) | `env.ts` `WHATSAPP_SERVICE_URL: waServiceUrlSchema.default(...)` |
| (e) Super Admin / tenant test ucu ayrımı | ✅ | §3 satır 61: Super Admin 200 `{ok:false}`, tenant 502 `UPSTREAM`, ikisi de istek göndermeden | `settings/system.ts` `testWhatsapp` → `notifier.test` (ön kontrol, 200); `requests/panel.ts` `whatsappTest` `configured`/`insecure` → `AppError("UPSTREAM")` |

Runbook'taki env kuralı (küçük harf http/https, userinfo/`?`/`#`/boşluk/kontrol yok, ≤ 200, sondaki `/` kırpılır, uymazsa server açılmaz, boş = varsayılan) Tur 2'de olduğu gibi `env.ts` ve `waServiceUrlSchema` ile birebir.

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-196 (a–l) | ✅ | Tur 2 tablosu, değişmedi: `whatsapp-admin-p12b.test.ts`, `whatsapp-runtime-p12b.test.ts`, `whatsapp-setting.test.ts`, contracts `whatsapp-setting-p12b.test.ts`, e2e `p12b-whatsapp.spec.ts` |
| AC-152 r3 | ✅ | Tur 2 tablosu, değişmedi |

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| AC'ler testle kanıtlı | ✅ | |
| Lint / typecheck / testler yeşil, gerekçesiz skip yok | ✅ | Tur 2 sonuçları; kod değişmedi |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | B-P12b-4 ve PUT/DELETE hız sınırı `implementation.md`'de kayıtlı (Düşük, Sonra) |
| Güvenlik, PII ve audit | ✅ | |
| Frontend 5 durum + a11y | ✅ | |
| Migration, geri alma, grant | ✅ | |
| Dokümantasyon (runbook dahil) güncel | ✅ | a–e kapandı |

## Öneriler (zorunlu değil)
- Çoklu instance'a geçilirse PUT/DELETE sonrası adresin diğer süreçlere yayılması gerekir. `serialQueue` yalnız süreç içinde çalışıyor (ADR-0005).
- Tenant ve Super Admin test uçlarının yanıt biçimleri (502 ve 200 `ok:false`) ileride tek biçimde birleştirilebilir.

## Olumlu
- Runbook alarm tablosu, sorun giderme tablosu ve env satırı artık koddaki davranışla birebir. Tenant ve Super Admin test uçlarının farkı açıkça yazılmış.
