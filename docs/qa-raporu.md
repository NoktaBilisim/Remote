# QA Raporu — P8b-1 Tur 3 (E9 müşteri destek talebi — sunucu + panel)
DURUM: DÜZELTİLMELİ

Tarih: 2026-11-12 · Denetçi: qa-denetci · Girdi: `implementation.md` "QA-P8b-12/13 kök neden" ve "Backend P8b-1 — düzeltme turu 2" (S8b-5, S8b-6, QA Öneri 1).
Tek engel: `test:int` ilk tam koşusunda yeni S8b-5 testi zamanlama eşiğinde kırmızı oldu (QA-P8b-14). Tur 2'nin iki açığı (QA-P8b-12, QA-P8b-13) kapandı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0) |
| `pnpm -r run typecheck` | hatasız |
| `pnpm -r run test` | contracts 50/50, server 281/281 (16 dosya), web 159/159 (17 dosya) |
| `cd apps/server && pnpm test:int` 1. koşu (geçici MySQL 8.4 `rs-mysql-qa3:33321`, 9 migration; yük ort. ~26) | **297/298, 1 KIRMIZI** + 1 unhandled rejection |
| aynı dosya tek başına ×3 (yük ort. 16–19) + `test:int` 2. tam koşu | 6/6 ×3; **34 dosya, 298/298 yeşil**. Konteyner silindi |
| `pnpm --filter @remote/web e2e` (tek koşu; `retries` tanımlı değil) | **188 geçti, 0 kırmızı, 68 atlandı** (Tur 2'deki 2 kırmızı yeşil; atlamaların gerekçesi değişmedi) |

`it.skip/fails/todo` yok.

Kırmızı test: `test/integration/security-p8b-fix2.test.ts:36` "AC-143/S8b-5: iki tenant'ta kilit 4 sn tutulurken 60 eşzamanlı talep sürerken giriş + /auth/me < 2 sn". `expected 2632.85 to be less than 2000` (`:62`). Ardından `FastifyError: Fastify has already been closed` unhandled rejection geldi (`test/helpers/requests.ts:110`). Assertion fırlayınca `flood` beklenmeden `afterEach` app'i kapatıyor, `retryNotReady` döngüsü de kapalı app'e istek atmaya devam ediyor.

## Tur 2 bulgularının durumu
| # | Durum | Kanıt |
|---|---|---|
| QA-P8b-12 (AC-149) | KAPANDI | `e2e/p8b-requests.spec.ts:66,75,87` olaydan önce, sayfa geçişinden sonra ve 4401 sonrası `expect.poll(openSockets) ≥ 1`. Sabit `waitForTimeout` kaldırıldı. Mock `GET /__e2e/rq/sockets/<çerez>` yalnız `readyState=1` soketleri sayıyor. Tam e2e koşusunda yeşil |
| QA-P8b-13 (AC-161) | KAPANDI | Kök neden ürün hatasıydı ve doğru yerde düzeltildi: `lib/control/machine.ts:227`, `requested` fazında gelen `{VIEW, TECH}` artık yok sayılıyor. Birim testi `machine.test.ts:168` "QA-P8b-13/K2" geç gelen iptal onayından sonra fazın `requested` kaldığını, `canCancel` sonucunu ve sonraki GRANTED'ın işlendiğini doğruluyor. `e2e/p7-control.spec.ts:287-303`: "Vazgeç" görünürlüğü ve `data-phase="ended"` açıkça bekleniyor, test gevşetilmedi. Tam e2e koşusunda yeşil |

## Kabul kriterleri (Tur 2'ye göre değişenler; diğerleri Tur 2'deki gibi ✅)
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| 143 | ✅ | `requests-p8b` ve `db-busy-p8b`, `retryNotReady` (QA Öneri 1) ile: 50×201 + 10×429, 500 yok. Kapı (S8b-5) davranışı `security-p8b-fix2:72` (503 + Retry-After 5, gövde temiz, tenant kovası tüketilmiyor) testiyle kanıtlı. Zamanlama testinin kararsızlığı QA-P8b-14'te |
| 149 | ✅ | e2e AC-149 tam koşuda yeşil (QA-P8b-12). p95 ≤ 3 sn staging ölçümü test-operatoru aşamasında |
| 161 | ✅ | `machine.test.ts:168` + e2e TEST-P7-3 tam koşuda yeşil |
| 65 (S8b-6) | ✅ | `security-p8b-fix2:128,145,158,169`: fail-closed kilit, DB ve bellek birlikte sayılıyor, audit düşse de sayaç yazılıyor, başarılı giriş yedek kovayı sıfırlıyor, alarm logunda PII yok |

## Düzeltilmeli
1. **QA-P8b-14** [backend-dev] `apps/server/test/integration/security-p8b-fix2.test.ts:59-62`. Sorun: mutlak `elapsed < 2_000` eşiği yük altında (yük ort. ~26) 2.633 ms ile kırmızı oldu. Ölçülen süre giriş hash'ini (CPU) de içerdiği için kapı yerine ortamı ölçüyor. Beklenen: ayrım kapının kendisinden kanıtlansın.
   - (a) Flood sürerken `gate.running ≤ global` ve DB'de kilit bekleyen bağlantı sayısı (veya havuzda boş bağlantı) assert edilsin.
   - (b) Zaman eşiği tutulacaksa kilit süresine göre göreli olsun, ör. `elapsed < holdMs - 1_000`. Bu eşik ayrımı yine korur: kapı yokken ~4 sn.
   - (c) Zamanlama assertion'ından önce `flood` ve `holds` `Promise.allSettled` ile beklensin (veya `try/finally`). Böylece test düşünce kapalı app'e istek atan unhandled rejection oluşmaz.
   - Doğrulama: `test:int` yüklü makinede (e2e ile eşzamanlı) en az 2 tam koşu yeşil olmalı.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Birim testleri yeşil | ✅ | 490/490 |
| Entegrasyon testleri yeşil | ❌ | 1. tam koşuda 1 kırmızı ve 1 unhandled rejection (QA-P8b-14); tekrar koşuda yeşil, yani kararsız |
| e2e yeşil | ✅ | 188/188, 68 gerekçeli atlama |
| Tur 2 açıkları kapandı | ✅ | QA-P8b-12, QA-P8b-13 |
| Kök neden belgeli, sapmalar gerekçeli | ✅ | `implementation.md` QA-P8b-12/13, S8b-5/6 bölümleri |
| Yeni bağımlılık | ✅ | yok (`src/lib/gate.ts` süreç içi, bağımlılıksız) |

## Öneriler (zorunlu değil)
1. `ConcurrencyGate` için birim testi (FIFO sırası, `full`/`timeout` ayrımı, `release` sonrası kuyruğun ilerlemesi) entegrasyon testindeki zamanlama bağımlılığını azaltır.

## Olumlu
- QA-P8b-13'te belirti (e2e) yerine ürün hatası bulundu. Gerçek sunucu sıralamasıyla (`control.ts:170/177`) gerekçelendirildi ve testler gevşetilmeden kapatıldı.
- QA-P8b-12'de sabit bekleme yerine gözlenebilir senkron noktası (açık soket sayısı) kullanıldı.
- S8b-5 ayrım kanıtı (kapı 100/100 iken test kırmızı) `implementation.md`'de belgeli.

---

# QA Raporu — P8b-1 Tur 2 (E9 müşteri destek talebi — sunucu + panel)
DURUM: DÜZELTİLMELİ

Tarih: 2026-11-12 · Denetçi: qa-denetci · Girdi: `implementation.md` "Backend P8b-1 — düzeltme turu 1" ve "(testler)".
Tek engel: e2e tam koşusunda 2 kırmızı (kararsız; biri P8b-1 kapsamında AC-149). Sunucu tarafı (Tur 1 bulgularının tamamı) kapandı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (3 paket) |
| `pnpm -r run typecheck` | hatasız |
| `pnpm -r run test` | contracts 50/50, server 276/276, web 158/158 |
| `cd apps/server && pnpm test:int` (tek başına, yük ort. ~9; geçici MySQL 8.4 `rs-mysql-qa2:33319`, 9 migration + grants; sonra silindi) | **33 dosya, 292/292 yeşil**, `it.fails`/`skip`/`todo` yok |
| `pnpm --filter @remote/web e2e` (ayrı, tek koşu; yük ort. 22–27, başka ajanlar da koşuyordu) | **186 geçti, 2 KIRMIZI, 68 atlandı** |

e2e kırmızıları:
1. `e2e/p8b-requests.spec.ts:58` "AC-149: /ws/panel — yeni talep toast…": `toast` "Yeni destek talebi: Yeni Müşteri" 3 sn içinde görünmedi.
2. `e2e/p7-control.spec.ts:277` "TEST-P7-3: yenileme sonrası hak sayacı korunur": `control-cancel` 30 sn bulunamadı (P7 regresyonu, AC-161).

İkisi tek başına 3 ardışık koşuda 2/2 yeşil (7,2–7,3 sn) → kararsız. AC-149 için olası kök neden test senkronizasyonu: test, rozetteki `3` (REST ilk sayımı) görünür görünmez `hook(page,"new")` çağırıyor; `e2e/mock-requests.mjs:4` olayı yalnız o anda açık `/ws/panel` soketlerine itiyor. Soket henüz açılmadıysa olay kaybolur ve toast hiç gelmez (yük bunu tetikler, kök neden yarış).
Tur 1'de atlanan 68 testin gerekçesi değişmedi (proje/gerçek-ortam ayrımı); yeni gerekçesiz atlama yok.

### AC-143 "60 eşzamanlı" kararlılık değerlendirmesi (koordinatör sorusu)
- **Ürün davranışı kabul edilebilir.** Kök neden ölçülerek bulunmuş (P2028, varsayılan `maxWait` 2 sn + `FOR UPDATE` seri kuyruğu). Düzeltme: `TX_OPTIONS`/`SERIAL_TX_OPTIONS` (`src/lib/db.ts`); geçici DB hataları (P2028/P2034/1205/1213/45028) `src/lib/errors.ts:81` ile 503 `NOT_READY` + `Retry-After: 5` olarak dönüyor ve `alarm:"db_busy"` logu yazılıyor. 500 artık dönmüyor. TX geri alındığı için 503 hiçbir sınırı delmez (50 üst sınırı korunur), yeniden deneme güvenlidir. 429 yerine 503 seçimi doğru: 429 müşteriye AC-143'ün "çok yoğunuz, firmanızı arayın" kararını yanlış yere gösterirdi. Seçim `mimari-api.md` §hata tablosu `NOT_READY` satırına işlenmiş. Tur 1'deki "5xx almamalı" ifademi bu kapsamda "500 almamalı; aşırı yükte kontrollü 503 + Retry-After kabul" olarak daraltıyorum.
- **Kabul kriteri karşılanıyor.** AC-143 "60 paralel → tam 50" testi normal koşulda yeşil (bu turda 292/292). `db-busy-p8b.test.ts` eski hatayı deterministik olarak yeniden üretiyor: kilit 3 sn tutulurken (eski maxWait 2 sn'yi aşar) 60 talepten tam 50×201 ve 10×429 `QUEUE_FULL` dönüyor, hiç 5xx yok. Havuz dolu olduğunda 503 + Retry-After dönüyor; gövdede SQL/stack yok ve havuz boşalınca aynı istek 200 alıyor. Bu iki test davranışı doğru doğruluyor.
- **Sınır:** `requests-p8b.test.ts:117` aşırı yükte (yük ort. 45–53 / 14 çekirdek) 503'leri kırmızı sayıyor. Ürün değişmezini (≤ 50 kabul, 500 yok) değil ortamı ölçüyor. Engel değil, Öneri 1'e bakın. İstemci tarafında 503'ün `Retry-After`'a uyarak otomatik yeniden denenmesi P8b-2'nin işi (Öneri 2).

## Tur 1 bulgularının durumu
| # | Durum | Kanıt |
|---|---|---|
| QA-P8b-1 | KAPANDI | Kök neden `implementation.md`'de; `db-busy-p8b.test.ts` (2 test); 500 → 503 eşlemesi; `test:int` 292/292. Yalnız aşırı yükte kalan 503'ler yukarıda değerlendirildi |
| QA-P8b-2 | KAPANDI | `requests-p8b-6.test.ts:60` AC-156 (ilk seviye VIEW, istenmemiş GRANTED → revoke{stale}, DENIED + 30 sn bekleme → GRANTED, HOTKEY → REVOKED, şema reddi 1008) + `:104` revoke{permission}/caps.update |
| QA-P8b-3 | KAPANDI | `requests-p8b-5.test.ts:38` eski `consentTextId` → 400 `fields.consentTextId`, satır yazılmaz, metin/sha/`consentedAt`/IP dolu; `:72` `session_consents.request_id` |
| QA-P8b-4 | KAPANDI | `requests-p8b-5.test.ts:99,118,129,151,174`. Kodda da düzeltildi: `requests/routes.ts:38` view+accept, `requests/panel.ts:147` Super Admin reti 403. `tenant-matrix.ts` yorum atfı düzeltildi |
| QA-P8b-5 | KAPANDI | `requests-p8b-5.test.ts:186` `request.accepted{sessionId,waitSec}`, `request.rejected{message}`, tüm `request.*` audit'lerinde ad/telefon/e-posta/açıklama taraması |
| QA-P8b-6 | KAPANDI | `requests-p8b-5.test.ts:223` (IP 4. → 429, /24 11. → 429, komşu /24 serbest, IPv6 /64), `:255` güvenilen CIDR muafiyeti + örnek sınırı |
| QA-P8b-7 | KAPANDI | `unit/requests-ref-p8b.test.ts:32-55` `fileLabelOf`; `requests-p8b-6.test.ts:152` iki tenant → farklı ad, aynı ikili, SHA-256 = `AGENT_SHA256` (Caddyfile eşleştirici + rewrite çözümüyle). Gerçek Caddy kanıtı Öneri 3'te |
| QA-P8b-8 | KAPANDI | `requests-p8b-6.test.ts:187` AC-146, 1.000 kayıt + gürültü tenant'ı: medyan 6–7 ms (< 500 ms), sonuç `implementation.md`'de |
| QA-P8b-9 | KAPANDI | `requests-p8b-5.test.ts:309` (detayda talep alanları, CSV Kaynak/Bekleme, `=HYPERLINK` kaçışı), `:340` (e-posta, `ip_key`, `net_key`, `device_hash` null; retention 90/730) |
| QA-P8b-10 | KAPANDI | `requests-p8b.test.ts` adları düzeltildi (AC-143, 153, 142, 133/§13.4, 147/148, 139/154, 154, 132) |
| QA-P8b-11 | KAPANDI | `signaling/admit.ts:103,145` talep yolunda `guest.admitted` newValue'da ad yok; `security-p8b-fix1.test.ts` assert ediyor |

## Kabul kriterleri (Tur 1'e göre değişenler; diğerleri Tur 1'deki gibi ✅)
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| 129 | ✅ | `unit/requests-ref-p8b` AC-129 (80 bit, RFC 4648), `requests-p8b-5:273` (ayar uçları 403/401) |
| 130 | ✅ | QA-P8b-7 kanıtı |
| 135 | ✅ | QA-P8b-3 kanıtı |
| 143 | ✅ | `requests-p8b:117` (yeşil), `db-busy-p8b` (deterministik yük), `requests-p8b-5:223,255` |
| 146 | ✅ | e2e AC-146 + `requests-p8b-6:187` performans |
| 147 | ✅ | `requests-p8b-5:99,118` |
| 148 | ✅ | `requests-p8b-5:129,151,174` |
| 149 | ⚠️ | e2e AC-149 tam koşuda **kırmızı** (kararsız; QA-P8b-12). p95 ≤ 3 sn staging ölçümü test-operatoru aşamasında |
| 150 | ✅ | `requests-p8b-2` AC-150 (300/sa dahil) bu turda yeşil |
| 156 | ✅ | QA-P8b-2 kanıtı |
| 157 | ✅ | `requests-p8b:180`, `requests-p8b-5:186` |
| 158 | ✅ | `requests-p8b:304`, `requests-p8b-5:309` |
| 159 | ✅ | `requests-p8b:292`, `requests-p8b-5:340` |
| 160 | ✅ | `requests-p8b-5:186`, `security-p8b-fix1` (S8b-3, QA-P8b-11, pending.ip/pending.prefix) |
| 161 | ⚠️ | `test:int` 292/292 (AC-7 dahil). e2e `TEST-P7-3` tam koşuda kırmızı, tek başına yeşil (QA-P8b-13) |

## Düzeltilmeli
| # | Önem | AC | Dosya | Ajan | Sorun → beklenen |
|---|---|---|---|---|---|
| QA-P8b-12 | Orta | 149 | `apps/web/e2e/p8b-requests.spec.ts:58-64` (+ gerekirse `e2e/mock-requests.mjs`) | frontend-dev | `hook(page,"new")`, `/ws/panel` soketi açılmadan çağrılabiliyor. Mock olayı yalnız açık soketlere ittiği için olay kayboluyor ve toast gelmiyor (tam koşuda kırmızı, tek başına yeşil). Beklenen: hook'tan önce soketin bağlandığını bekleyen deterministik bir senkron noktası. Örneğin mock'a o çerezin açık soket sayısını dönen bir uç eklenir ve `expect.poll` ile ≥ 1 beklenir, ya da hook soket yoksa olayı kuyruğa alıp bağlanınca iter. Rozet `3`'ü senkron noktası olarak kullanmayın (REST'ten geliyor). Ürün kodu değişmez. Kanıt: `pnpm --filter @remote/web e2e` tam koşu 0 kırmızı |
| QA-P8b-13 | Düşük | 161 | `apps/web/e2e/p7-control.spec.ts:277-295` | frontend-dev | TEST-P7-3'te `control-cancel` tam koşuda 30 sn bulunamadı (tek başına 3/3 yeşil). Beklenen: döngüde `req(page).click()` sonrası iptal düğmesinin görünür olmasını açıkça bekleyin (agent log poll'undan önce/sonra sıra), kök neden `implementation.md`'ye; tam e2e koşusunda yeşil |

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Birim testleri yeşil | ✅ | 484/484 |
| Entegrasyon testleri yeşil | ✅ | 292/292, `it.fails` kalmadı |
| e2e yeşil | ❌ | 186/188, 2 kararsız kırmızı (QA-P8b-12, -13) |
| Her AC'de adında AC numarası olan test | ✅ | 135, 156, 160 eklendi; yanlış adlar düzeltildi |
| §10.3 bitti kanıtları | ✅ | 60→50 ✅, iki tenant aynı ikili ✅ (sunucu düzeyi), 1.000 kayıt < 500 ms ✅, 50 tekrar çift kabul ✅, axe ✅; panel p95 test-operatoru'nda |
| Sözleşme değişikliği belgelendi | ✅ | 503 `NOT_READY` + `Retry-After` `mimari-api.md`'de; frontend notu `implementation.md`'de |
| Yeni bağımlılık / env / tablo | ✅ | Yok |
| Ham renk/px, `any`, yutulan hata | ✅ | Değişen dosyalarda bulgu yok; `errors.ts` 503 dalı log yazıyor (yutmuyor), gövdede SQL/stack yok |
| Sapmalar gerekçeli | ✅ | 503 seçimi, S8b-2 yan etkisi (admit öncesi mesaj yok sayılır), Kaynak: `implementation.md` |

## Öneriler (zorunlu değil)
1. `requests-p8b.test.ts:117`: 503 yanıtlarını `Retry-After`'a uyarak (testte kısaltılmış bekleme ile) yeniden deneyin, ardından "tam 50 × 201, 10 × 429, hiç 500 yok" diye assert edin. Böylece test ortam yükünü değil, istemci anlamıyla ürün değişmezini ölçer.
2. P8b-2 giriş şartı: Go istemcisi talep oluştururken 503 `NOT_READY`'yi `Retry-After` ile sınırlı sayıda otomatik denesin ve müşteriye "çok yoğunuz" (429) mesajıyla karıştırılmayan bir bekleme durumu göstersin. Panel de 503'ü genel hata yerine "yoğunluk, tekrar deneyin" olarak göstersin.
3. devops: `deploy/test-caddy.sh`'e ikinci firma adı ve iki indirmenin SHA-256 eşitliği satırı eklensin (gerçek Caddy kanıtı).
4. `alarm:"db_busy"` için runbook'a eşik/alarm satırı eklensin (sık görülüyorsa havuz/kaynak yetersizliği).

## Olumlu
- QA-P8b-1 kök nedeni tahminle değil ölçümle bulundu (CPU kısıtlama deneyi). Eski hata deterministik bir testle sabitlendi.
- Testler yazılırken bulunan üretim hataları (AC-147 view şartı, AC-148 Super Admin reti) önce `it.fails` ile kayda alındı, sonra düzeltildi. İz sürülebilir bir akış.
- TX içi sorgu sayısı 10'dan 6'ya indi (`pendingSnapshot`). Davranış değişmedi, kilit süresi kısaldı.

---

# Önceki tur
## QA Raporu — P8b-1 Tur 1 (E9 müşteri destek talebi — sunucu + panel)
DURUM: DÜZELTİLMELİ

Tarih: 2026-11-12 · Denetçi: qa-denetci · Önceki rapor: `docs/arsiv/p8-qa-raporu.md`
Kapsam: mimari §10 P8b-1 satırı — AC-129..132, 134 (sunucu), 135, 139..150, 152, 153, 154 (sunucu), 155, 156 (sunucu regresyonu), 157..161, 164 (panel).

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (3 paket) |
| `pnpm -r run typecheck` | hatasız |
| `pnpm -r run test` | contracts 50/50, server 270/270, web 158/158 |
| `cd apps/server && pnpm test:int` (geçici MySQL 8.4 `rs-mysql-qa:33317`, 9 migration + grants uygulandı; konteyner sonra silindi) | **3 KIRMIZI / 265 yeşil (29 dosya, 268 test)** |
| `pnpm --filter @remote/web e2e` | 188 geçti, 68 atlandı, 0 kırmızı |

Kırmızı entegrasyon testleri (e2e ile aynı anda koşuldu; makinede başka bir `rs-mysql-test` konteyneri de çalışıyordu):
1. `requests-p8b.test.ts` "AC-140: 60 eşzamanlı talepte tam 50 kabul edilir" — **50 yerine 32 adet 201** döndü.
2. `requests-p8b-2.test.ts` "AC-150: sistem geneli 300/sa" — `request.notify` audit poll'u süresinde dolmadı (satır 192).
3. `signaling-rooms.test.ts` "AC-7: oda admit‖admit 50 kez" — 20 sn test zaman aşımı (P3 regresyonu, AC-161).

**Yeniden koşu (yük yokken):** üç dosya tek başına 2 kez → 39/39 yeşil; tam `pnpm test:int` yeniden → 29 dosya **268/268 yeşil**. Sonuç: kırmızılar yük bağımlı (flaky). 60 paralel talepte 28 yanıtın 201/429 dışı olması, Prisma interaktif TX varsayılan `maxWait=2000 ms` (`src/lib/db.ts:7` `transactionOptions` yok) ile `lockSettings ... FOR UPDATE` seri kuyruğunun yük altında bağlantı/TX bekleme süresini aşması (P2028 → 500) ile uyumlu; kod hiçbir 5xx'i yakalamıyor. Kesin kod denetçice ölçülmedi (backend doğrulayacak).

Atlanan testler: p8b e2e'de atlamalar `desktopOnly` / `mobile` proje ayrımı (gerekçeli). Diğer 68 atlama önceki paketlerin gerçek-ortam/proje ayrımı atlamaları; P8b-1'de yeni gerekçesiz atlama yok.

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| 129 | ⚠️ | e2e `AC-129/131/152: ayarlar…` (kopyala, UI). Sunucu: `settings.edit` olmayan kullanıcıya ayar uçları 403 yalnız `requests-p8b-2` "PUT doğrulama … settings.e…" içinde dolaylı; tenantRef ≥ 64 bit rastgelelik (16 × base32 = 80 bit) kodda var, testle doğrulanmıyor |
| 130 | ⚠️ | `requests-p8b-4` "AC-130/132: request-download 302 → /downloads/NoktaDestek-<label>-<ref>.exe". **"İki tenant indirmesi aynı ikili / aynı SHA-256" testi yok**; `file_label` birim testi (Türkçe karakter, 20 sınırı, boş ad — mimari-e9 §9) bulunamadı |
| 131 | ✅ | `requests-p8b-2` "AC-131: rotate-ref — eski ref anında 404 …, audit yalnız ilk 4 karakter"; e2e onaylı yenile. (İstemci mesajı P8b-2) |
| 132 | ✅ | `requests-p8b-4` "G-E9-11: forward_auth … aynı 404 gövdesi" (pasif tenant + bilinmeyen ref) + "request-download … IP başına 30/sa" |
| 134 (sunucu) | ✅ | `unit/requests-contract-p8b` AC-134 testleri (ortak fixture) + `requests-p8b` strict gövde |
| 135 | ⚠️ | Kod (`requests/service.ts:177`) eski `consentTextId` → 400 uyguluyor, ama **testi yok**; talep başına onay kaydının (sürüm, zaman, IP, talep kimliği) DB'de yazıldığı test edilmiyor; seed aydınlatma metninin yeni sürümü yalnız `consentText.version: 1` ile kontrol ediliyor |
| 139 | ✅ | `requests-p8b` "AC-134/135: talep oluşturulur (201…)" (sır, kod, position), "AC-139/145: … request.state" |
| 140 | ✅ | `unit` "AC-140: yalnız tanımlı geçişler; tüm (kaynak, hedef) çiftleri" |
| 141 | ✅ | `requests-p8b` "AC-141: iptal ucu…", "AC-141: /ws/request normal kapanış (1000)…"; `requests-p8b-3` "AC-141: 120 sn kopukluk…" (+ panel `request.removed`) |
| 142 | ✅ | `requests-p8b-3` "AC-142: bekleme süresi dolan talep… EXPIRED; kabul 409"; ayar aralığı `requests-p8b-2` PUT doğrulama |
| 143 | ❌ | 60 paralel → tam 50 testi yük altında **kırmızı (32 × 201)**, tekrarda yeşil (kararsız). IP başına 3 / önek başına 10 **bekleyen** sınırlarının ayrı testi bulunamadı (yalnız saatlik kovalar test ediliyor). Bilinen kaynak eşiği ✅ (`requests-p8b-4` AC-143) |
| 144 | ✅ | `requests-p8b-4` AC-144 testleri (ip/prefix/net48, ref_invalid 15 dk, tenant 60/120 + queue.alert, audit dk'da 1). Sahte XFF: helper `PROXY` env ile `x-forwarded-for` güvenilir vekil üzerinden; AC-121 mevcut testi geçerli |
| 145 | ✅ | `requests-p8b-3` "AC-145: tenant pasife alınınca … TENANT_PASSIVE" (P9 çağırıcısı P9 giriş şartı) |
| 146 | ⚠️ | e2e AC-146 (iki test: kuyruk, ipucu, düz metin, rozet, geçmiş sekmesi, boş/hata/yükleniyor). **"1.000 kayıtta < 500 ms" ölçümü yok** (§10.3 "bitti" kanıtı) |
| 147 | ⚠️ | Birim (tek tanım, varsayılanlar) + `requests-p8b` yetkisiz 403 (accept, liste). **`view` var / `accept` yok kullanıcısının accept/reject uçlarında 403 aldığını** gösteren test yok; 9 uç × rol matrisi (mimari-e9 §9) yok — `scoped` sınıfı matristen muaf ve yorumdaki `requests-isolation-p8b.test.ts` dosyası **mevcut değil** |
| 148 | ⚠️ | Tenant A/B 404 ✅ (`requests-p8b` "AC-148/149…", `/ws/panel` izolasyonu). **Super Admin seçili/seçilmemiş tenant bağlamı sunucu testi yok** (yalnız e2e mock) |
| 149 | ⚠️ | e2e AC-149 (toast, Görüntüle, rozet, başlık, ses tercihi). p95 ≤ 3 sn staging ölçümü test-operatoru'na kalır (henüz yok) |
| 150 | ⚠️ | `requests-p8b-2` AC-150 testleri kapsamlı; "sistem geneli 300/sa" yük altında kırmızı, tekrarda yeşil (kararsız) |
| 152 | ✅ | `requests-p8b-2` AC-152 (PUT, doğrulama sınırları, audit eski→yeni maskeli, test ucu 5/dk, fail-closed) + e2e |
| 153 | ✅ | `requests-p8b` "AC-142: çift kabul 50 tekrarda tek kazanan…" (adı yanlış, içerik AC-153), "AC-143: açık oturum sınırında… PENDING kalır" (adı yanlış), REJECTED/EXPIRED sonrası 409; e2e AC-153 |
| 154 (sunucu) | ✅ | `requests-p8b` "AC-139/145: … ön-kabullü hello" (sırsız/sahte ticket 401/403, tek kullanımlık), "AC-145: başka talebin ticket'ı…"; `requests-p8b-3` decline. Kodda `recordViewConsent(..., requestId)` var; `session_consents.request_id` dolu olduğu assert edilmiyor (Öneri) |
| 155 | ✅ | `requests-p8b-3` "AC-155: … 60 sn … CONNECT_FAILED" + süpürücü yedek yolu |
| 156 (sunucu regresyon) | ❌ | **Talep kaynaklı oturumda P7 kontrol akışı regresyon testi yok** (grep `AC-156`: 0 test). §13.2 caps testleri (`hello.caps`) var, ama kontrol izni akışı (AC-99..104) talep oturumunda koşulmuyor |
| 157 | ⚠️ | `requests-p8b` "AC-157…" + birim + e2e. **Ret mesajının audit'e yazıldığı (`request.rejected{message}`) test edilmiyor** |
| 158 | ⚠️ | `requests-p8b` "AC-158: … source=REQUEST ve waitSec" + e2e. Detayda yalnız `request.id` assert ediliyor (ad/telefon/e-posta/açıklama/zamanlar değil); CSV "Kaynak/Bekleme" sütunları başlıkta var (`sessions-history-api-p8`), **yeni sütunlarda formül kaçışı testi yok** |
| 159 | ⚠️ | `requests-p8b` "AC-159…": ad, telefon, açıklama, IP null. **E-posta, `ip_key`, `net_key`, `device_hash` null olduğu assert edilmiyor**; saklama süresinin tenant `retention_days`'e göre (90/730 sınırları) uygulandığı yalnız varsayılan 365 ile test ediliyor |
| 160 | ⚠️ | Olay bazında dağınık kanıt (created, cancelled, expired, connect_failed, notify, rate_limited, updated, ref_rotated, whatsapp.test). **`request.accepted` ve `request.rejected` audit kayıtları hiçbir testte assert edilmiyor**; AC-160 adlı test yok |
| 161 | ⚠️ | AC-1..128 tekrarda yeşil; ilk (yüklü) koşuda `signaling-rooms.test.ts` AC-7 zaman aşımı — kararsız (QA-P8b-1) |
| 164 (panel) | ✅ | e2e "AC-164: Talepler ve Ayarlar — axe 0 ihlal (light/dark)" (1280/390 axe, 1440 taşma) |

## Düzeltilmeli
| # | Önem | AC | Dosya | Ajan | Sorun → beklenen |
|---|---|---|---|---|---|
| QA-P8b-1 | Orta | 143, 150, 161 | `apps/server/test/integration/requests-p8b.test.ts:117`, `requests-p8b-2.test.ts:177`, `signaling-rooms.test.ts:109`; `src/requests/service.ts:208-252` | backend-dev | Entegrasyon testleri kırmızı. 60 paralel talepte 50 yerine 32 adet 201: diğer 28 yanıtın kodu belirlenip kök neden bulunmalı (Prisma interaktif TX `maxWait`/`timeout` aşımı veya kilit beklemesi → 500 ise bu üretim hatasıdır: yük altında meşru talep 201 ya da 429 almalı, 5xx almamalı). Yük yokken yeşil, eşzamanlı e2e yükünde kırmızı. Beklenen: 28 yanıtın kodunu yük altında kaydet; 5xx ise talep TX'ine açık `maxWait`/`timeout` ver veya kilit bekleme hatasını 429 `QUEUE_FULL`/`RATE_LIMITED`'a çevir (yük altında meşru talep 5xx almamalı); `pnpm test:int` e2e ile eşzamanlı 3 ardışık koşuda yeşil; AC-7 ve AC-150 300/sa testlerinin süre/poll payı yük için gözden geçirilsin. Kök neden `implementation.md`'ye |
| QA-P8b-2 | Orta | 156 | `apps/server/test/integration/` (yeni) | backend-dev | Talep kaynaklı oturumda P7 kontrol izni akışı (ilk seviye VIEW, `control.request` → müşteri onayı → GRANTED, ret/cooldown) için `AC-156` adlı regresyon testi ekle |
| QA-P8b-3 | Orta | 135 | `requests-p8b.test.ts` | backend-dev | Eski (`isCurrent=false`) `consentTextId` → 400 `fields.consentTextId` testi; talep satırında `consentTextId`, `consentSha256`, `consentedAt`, `ip` dolu assert'i |
| QA-P8b-4 | Orta | 147, 148 | `test/helpers/tenant-matrix.ts:12`, yeni test | backend-dev | (a) yalnız `view` yetkili kullanıcı accept/reject → 403, liste/detay 200; (b) Super Admin firma seçmeden talep uçları → beklenen hata, seçili tenant'ta yalnız o tenant'ın talepleri, kabul/ret 403 (sapma 2); (c) yorumdaki var olmayan `requests-isolation-p8b.test.ts` referansı düzeltilsin |
| QA-P8b-5 | Orta | 160, 157 | `requests-p8b.test.ts` | backend-dev | `request.accepted{sessionId, waitSec}` ve `request.rejected{message}` audit satırlarını assert eden ve açıklama/ad/telefon metninin hiçbir `request.*` audit'inde bulunmadığını tarayan `AC-160` testi |
| QA-P8b-6 | Orta | 143 | `requests-p8b-4.test.ts` | backend-dev | Bekleyen sınırları: aynı ipKey'den 4. bekleyen → 429, aynı /24 (veya /48)'ten 11. bekleyen → 429, güvenilen CIDR'de muafiyet testi |
| QA-P8b-7 | Orta | 130 | yeni test | backend-dev | `file_label` birim testi (Türkçe karakter → ASCII, ≤ 20, boş ad) + iki tenant'ın indirme yolunun aynı volume ikilisine çözüldüğünü gösteren test (veya CI `test-caddy.sh` adımında iki firma adının aynı SHA-256'yı verdiği assert'i — devops) |
| QA-P8b-8 | Orta | 146 | `apps/server/scripts/perf-*.ts` veya entegrasyon | backend-dev | `GET /support-requests?tab=history` 1.000 kayıtla < 500 ms ölçümü (§10.3 bitti kanıtı); sonuç `implementation.md`'ye |
| QA-P8b-9 | Düşük | 158, 159 | `requests-p8b.test.ts:292-320` | backend-dev | AC-159: `customerEmail`, `ipKey`, `netKey`, `deviceHash` null assert'i; AC-158: detay `request` alanları (ad, telefon, e-posta, açıklama, `waitSec`) ve CSV Kaynak/Bekleme formül kaçışı |
| QA-P8b-10 | Düşük | izlenebilirlik | `requests-p8b.test.ts` | backend-dev | Test adlarındaki AC numaraları yanlış: "AC-140: 60 eşzamanlı" → AC-143; "AC-142: çift kabul" → AC-153; "AC-143: açık oturum sınırı" → AC-153; "AC-144: süresi dolan PENDING" → AC-142; "AC-152: MIN_AGENT_VERSION" → AC-133/§13.4; "AC-148/149: yetkisiz" → AC-147/148; "AC-139/145", "AC-145: başka talebin ticket'ı" → AC-154; "AC-131/150: bilinmeyen ref" → AC-132 |
| QA-P8b-11 | Düşük | 160 | `apps/server/src/signaling/admit.ts:140` | backend-dev | `guest.admitted{via:"request"}` `newValue`'da müşteri adı (`name`) var; mimari-e9 §13.7 `{ requestId, acceptedBy }` diyor. Ya ad kaldırılsın ya da sapma (P3/P4 kod yolu ile tutarlılık) `implementation.md`'de gerekçelensin |

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Birim testleri yeşil | ✅ | 478/478 |
| Entegrasyon testleri yeşil | ❌ | Yük altında 3 kırmızı, tekrarda 268/268 yeşil — kararsız (QA-P8b-1) |
| e2e yeşil | ✅ | 188/188 |
| Her AC'de adında AC numarası olan test | ❌ | 135, 156, 160 testsiz; yanlış numaralı testler (QA-P8b-10) |
| §10.3 bitti kanıtları | ❌ | 50 tekrar çift kabul ✅; 60→50 kırmızı; iki tenant aynı ikili yok; 1.000 kayıt < 500 ms yok; panel p95 staging ölçümü test-operatoru'nda; axe iki tema ✅ |
| Yeni env → .env.example + env.ts + compose + runbook | ✅ | `WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION` dördünde de var |
| Yeni tablo → grants.sql | ✅ | `tenant_request_settings`, `support_requests` (DELETE/DDL yok) + `check-app-grants.sh` CHECK testleri |
| Permissions tek tanım | ✅ | `packages/contracts/src/permissions.ts:11` |
| Menü ikonları | ✅ | Talepler `Inbox`, Ayarlar `Settings` (lucide) |
| Yeni bağımlılık | ✅ | Yok (contracts `package.json` yalnız exports) |
| Ham renk/px, `any`, yutulan hata (P8b dosyaları) | ✅ | Taramada bulgu yok; `requests/ws.ts:98` boş catch JSON parse → `null` (bilinçli, şema reddine düşer) |
| Sapmalar `implementation.md`'de gerekçeli | ✅ | Backend 1–8, Frontend kararlar, dba (mimari §10 notu) |

## Öneriler (zorunlu değil)
- AC-154: `session_consents.request_id`'nin talep yolunda dolu, kod yolunda NULL olduğunu assert et.
- `WHATSAPP_SERVICE_URL` varsayılanlı olduğu için "Servis yapılandırılmamış" 502 dalı erişilemez (backend notu); P10'da sadeleştirilebilir.

## Olumlu
- Sunucu tarafı test turu kapsamlı: WhatsApp sınırları/fail-closed, zamanlayıcılar `FakeClock` ile, 426 dört yolda, soket sınırları, forward_auth firma yolu.
- grants + CHECK kısıtları ayrıca `check-app-grants.sh` ile sınanıyor; durum makinesi tüm çiftlerde birim testli.
- Panel axe iki temada 0 ihlal; açıklama/ret mesajı düz metin (bağlantı yok) e2e ile doğrulanıyor.
