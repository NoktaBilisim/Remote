## LG — tur 2

# QA Raporu — LG (müşteriye bağlantı gönderme) Tur 2 (dar kapsam: tur 1 maddelerinin kapanışı)

DURUM: GEÇTİ

Tarih: 2026-11-15 · Dal `p27-wip`, commit edilmemiş çalışma ağacı. Kod değiştirilmedi, staging'e bağlanılmadı.

## Test sonucu

| Komut | Sonuç |
| --- | --- |
| `pnpm -r run lint` | yeşil (çıkış 0) |
| `pnpm -r run typecheck` | yeşil (çıkış 0) |
| `pnpm -r run test` | contracts 173/173, web 411/411, server 484/484; skip 0 |
| Entegrasyon `lg-send` + `p19-notify-j3` + `tenant-isolation` (ayrı konteyner `rs-qa2-lg-3006bc`, `test-db.sh` aynı kabukta; iş sonunda silindi, `rs-mysql-test`'e dokunulmadı) | **45/45, 3 dosya**, skip 0 |
| Playwright `lg-send.spec.ts` | 7 geçti / 0 kaldı / 5 skip (skip'ler `desktopOnly`/`mobileOnly` proje ayrımı; tur 1 ile aynı desen) |

## Tur 1 maddelerinin durumu

| Madde | Durum | Kanıt |
| --- | --- | --- |
| 1. AC-411 testi | ✅ | `lg-send.test.ts` "AC-411…": ikili kapısı açık uygulamada gönderilen WhatsApp metni = önizleme; metinden `agent/download?ref=` çıkarılıyor; PENDING'de 302 `/downloads/Destek-*.exe`; `createdAt/expiresAt` geriye çekilince aynı URL 410 |
| 2. E-posta gönderilen = önizleme | ✅ | MIME çözücü (iç içe multipart, QP/base64, kodlanmış konu) `lg-send.test.ts:116-160`; K2 `:194-195` ve K1 `:422-423` `mail.text`/`mail.subject` `toBe(preview…)` |
| 3. AC-406 kanal matrisi | ✅ | "AC-406 kanal kombinasyonu matrisi" 4 test: WA `usable=false` ve SMS yok → `unconfigured`; `settings.view` yok → `settingsHref:null`; WA ayar bağlantısı yalnız Super Admin; K2 `no_recipient`; K2 ikili kapısı kapalı → EMAIL `unconfigured`; hiç kullanılabilir kanal yok → `previews` boş + gönderim 409. "Boş `channels`" yerine yetkili kanal yoksa 403 dönüyor; bu davranış testte kanıtlı ve implementation.md'de gerekçeli, kabul |
| 4. AC-419 iptal edilmiş kod | ✅ | Tek tip 404 testinde `DELETE /registration-codes/:id` → 204, ardından aynı 404 gövdesi (`bodies.size === 1`) |
| 5. AC-410 karar | ✅ | `gereksinimler-link-gonderme.md:76` metni güncellendi: e-postada süzülmüş tam ad, SMS'te istemci satırı yok (koordinatör kararı). Kod değişmedi, AC ile kod artık tutarlı |
| 6. Dokümantasyon (AC-428) | ✅ | Kılavuz "Teknisyen ve Admin için: Müşteriye gönder" (`:2544-2676`): üç akış, kanal koşulları, K2'nin yalnız e-postayla gitmesi ve gerekçesi, kodun yeniden gönderilemeyeceği, kod başına 3 hak, public indirme bağlantısı, sınırlar, rol ayrımı, mesaj tablosu. `api.md` `:241-243`, `:3095-3213` (iki uç + public indirme), `:2897` K1 SMS farkı. CHANGELOG "Eklendi — Müşteriye bağlantı gönderme". Runbook §12.3 K13 bitiş koşulu ve K3 riski. PDF'ler md'lerden sonra üretilmiş (23:41:56); `KULLANIM_KILAVUZU.pdf` 89 sayfa, "Müşteriye gönder", "SMS'te yoktur", "en çok 3 kez" metinleri pypdf ile bulundu |
| 7. SMS ≤ 3 parça | ✅ (kabul) | `customer-templates.ts:72-77` `sessionSms`: istemci satırı ve uyarı satırı yok. Mimari §5.1 sapma notu (`:273`), AC-410 metni ve implementation.md güncellendi. Birim `p19-notify-j3` ≤ 3×67 ve SMS'te `agent/download` yok. **Uyarı satırının çıkarılması kabul edilebilir.** Gerekçe: en kötü durumda metin 201 karakter sınırına zaten dayanıyor, yer kalmıyor. Gönderen firma ve teknisyen adı SMS'te duruyor. WhatsApp ve e-postada uyarı korunuyor. Kısa uyarı ekleyen eski P19 SMS'iyle fark bilinçli ve belgeli. Etkisi Öneri 1'de |

## Kabul kriterleri

Tur 1'deki ⚠️/❌ satırlar: AC-406 ✅, AC-407 ✅, AC-410 ✅, AC-411 ✅, AC-419 ✅, AC-428 ✅. Diğer AC'ler tur 1'de ✅ idi; bu turdaki koşuda ilgili testler yine yeşil.

## Düzeltilmeli

Yok.

## Definition of Done

| Madde | ✅/❌ | Not |
| --- | --- | --- |
| Lint / typecheck / unit / int / e2e yeşil | ✅ | Yukarıdaki tablo; tam `test:int` bu turda koşulmadı (dar kapsam), tur 1'de 945/945 idi |
| Her AC'nin kanıtı var | ✅ | AC-405..428 |
| Tasarım-kod uyumu | ✅ | SMS sapması mimari §5.1'de kayıtlı |
| Dokümantasyon (kılavuz, api.md, CHANGELOG, runbook, PDF) | ✅ | Madde 6 |
| Diğer DoD maddeleri | ✅ | Tur 1'den değişiklik yok |

## Öneriler (zorunlu değil)

1. SMS uzunluk testi (`p19-notify-j3.test.ts:43`) kaynak olarak 26 karakterlik `https://remote.example.com` kullanıyor. Prod alan adı `https://remote.noktabilisim.net` 31 karakter. Elle hesap (ölçülmedi): firma 30 + kısa ad 20 olan en kötü durumda metin yaklaşık 200 karakterden 205'e çıkar ve 4. parçaya taşabilir. Öneri:
   - testi prod uzunluğunda kökenle koşmak;
   - gerekirse `Son geçerlilik:` ifadesini kısaltmak (ör. `Son:`).
   
   Bu kısaltmayla açılan yere "Paylaşmayın." uyarısı da sığabilir.
2. Tur 1 öneri 2–4 (targets.ts başlık yorumu, kova geri alma, anonim müşteri K3 409 testi) açık; bu turun kapsamı dışında.

## Olumlu

- Dört test maddesi AC metnine birebir karşılık geliyor. AC-411, sahte bir URL yerine gönderilen mesajdan çıkarılan bağlantıyla doğrulanıyor.
- E-posta eşitliği gerçek MIME çözümüyle kanıtlanıyor; totoloji kalmadı.
- Kılavuz, K2'nin neden yalnız e-postayla gittiğini teknik olmayan dille anlatıyor. "İndirildi" kaydının yalnız bir ipucu olduğu da açıkça yazıyor.

---

## LG — tur 1

# QA Raporu — LG (müşteriye bağlantı gönderme) Tur 1

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `p27-wip`, commit edilmemiş çalışma ağacı. Kod değiştirilmedi, staging'e bağlanılmadı.
Kaynak: `docs/gereksinimler-link-gonderme.md` (AC-405..428), `docs/mimari-link-gonderme.md` r2, implementation.md LG-2/LG-3.

## Test sonucu

| Komut | Sonuç |
| --- | --- |
| `pnpm -r run lint` | yeşil, uyarı 0 |
| `pnpm -r run typecheck` | yeşil |
| `pnpm -r run test` | contracts 173/173, web 411/411, server 484/484 |
| `pnpm test:int` (ayrı konteyner `rs-qa-lg-681dcc`, port 33419; iş sonunda silindi, `rs-mysql-test`'e dokunulmadı) | **945/945, 93 dosya**, skip 0. Tenant-matrix düzeltmesinden sonra tam takım yeşil (AC-69 dahil) |
| Playwright: `lg-send`, `p10-account`, `p19-j5`, `unattended`, `customers` | 97 geçti / 0 kaldı / 37 skip. Skip'ler `desktopOnly` ayrımından geliyor; önceki turlardakiyle aynı desen |

## Kabul kriterleri

| AC | Durum | Kanıt veya eksik |
| --- | --- | --- |
| 405 | ✅ | e2e `lg-send` "AC-405…": düğme sayısı 1, eski test-id'ler 0. Aynı bileşen `code-dialog` ve `customers/[id]` içinde kullanılıyor; eski iki bileşen silindi |
| 406 | ⚠️ | Entegrasyonda yalnız 3 durum var: K2 yalnız EMAIL, K3 SMTP yok, K1 tüm kanallar ve yetki varyantı. AC'nin istediği "her kanal kombinasyonu" matrisi yok (madde 3) |
| 407 | ⚠️ | WhatsApp için birebir eşitlik kanıtlı (K1, K3 entegrasyon `toBe(preview)`). E-postada eşitlik kanıtlanmadı: K2 testi yalnız kod ve belirteç `toContain` yapıyor; K1 e-posta hiç karşılaştırılmıyor. e2e eşitliği mock-lg'nin kendi `render`ından geldiği için totolojik (madde 2) |
| 408 | ✅ | e2e K1: 502 genel metin (ham "relay" yok), 409, 429 geri sayım, başarı satırı, diyalog açık kalıyor. Ayrı testte hata + tekrar dene ve boş durum |
| 409 | ✅ | Entegrasyon "AC-409" (`fields.to`); e2e istemci e-posta hatası ve E.164 önizlemesi |
| 410 | ⚠️ | Birim "AC-410" alanları doğruluyor. Ancak K1 e-postası `techShortName` yerine süzülmüş tam ad kullanıyor (implementation.md sapma 2). AC metni "her kanalda kısa ad" diyor; karar gerekiyor (madde 5) |
| 411 | ⚠️ | Mesajdaki bağlantının `public/agent/download?ref=` olduğu kodda doğru (`agentLinkFor`). AC'nin istediği "gönderilen bağlantı süresi dolunca 410" testi yok; mevcut `agent-download.test.ts` gönderilen mesajın ref'ini kullanmıyor (madde 1) |
| 412 | ✅ | Birim "AC-412": e-postada SHA, "Destek-", "Windows 10 / 11" var; kısa metinde SHA yok; `agent:null` iken "download" yok |
| 413 | ✅ | Entegrasyon "AC-413/414": send_link yoksa yalnız EMAIL ve WA 403, başka teknisyen 404, yanlış bağlantı 400 `fields.link` |
| 414 | ✅ | Audit `session.email` ve `session.link_sent` doğru. P10/P19 entegrasyon dosyaları değişmedi ve yeşil. Birimde yalnız şablon beklentileri güncellendi (`p19-notify-j3`, `security-p10`; izinli) |
| 415 | ✅ | Entegrasyon "AC-415/416/D-LG-5": başka kodun metni 400 `fields.code`, tüketilmiş 409, iptal 409 |
| 416 | ✅ | Aynı test: başka kullanıcı, başka firma ve manage'siz durumlar 404; kapı kapalı 409 `UNATTENDED_DISABLED` |
| 417 | ✅ | "AC-417": listede olmayan alıcı 400, inbox sayısı değişmiyor; WA 400 `fields.channel` |
| 418 | ✅ | Birim "AC-418" |
| 419 | ⚠️ | 200, başlıklar, 503 sırası, IP 20/dk, O-LG-2 ve tek tip 404 kanıtlı (kullanılmış, süresi dolmuş, müşteri pasif, firma pasif, kapı kapalı). AC'deki dört durumdan **iptal edilmiş kod** testte yok; mimari §12 de istiyor (madde 4) |
| 420 | ✅ | "AC-407/418/420": 4. gönderim 429, `sent_count`=3, audit'te kod ve belirteç yok; havuz K1 ile ortak ("AC-420/423") |
| 421 | ✅ | Pasif müşteri 409 (entegrasyon); düğme yetkiye bağlı (e2e). Aktif müşteride `downloadUrl` hep dolu olduğu için "bağlantısız" dalı pratikte erişilmez |
| 422 | ✅ | Ref yenilendikten sonra önizleme yeni ref'i içeriyor; uyarı metni birim testte |
| 423 | ✅ | send_link yoksa 403; audit maskeli, URL ve ref yok, `links:["download"]`; ortak havuzda 429 |
| 424 | ✅ | Birim "AC-424 / D-LG-4": üç şablon × EMAIL/WA, subject, text ve HTML'de `evil.com` ve `<b>x` yok |
| 425 | ✅ | "AC-425 log" telefon, e-posta, `download?t=`, oturum token'ı ve kayıt kodu desenini arıyor, bulamıyor. Redact yolları eklendi |
| 426 | ✅ | e2e iki tema axe 0, 360 px taşma yok, Esc (iç diyalog), ok tuşu; ikonlar `Mail`/`MessageCircle`/`MessageSquareText` |
| 427 | ✅ (not) | Üç akış e2e'de yeşil. Mock-API deseni mimari §12 ile uyumlu; gerçek metin eşitliği AC-407 kapsamında |
| 428 | ❌ | `KULLANIM_KILAVUZU.md` içinde "Müşteriye gönder" yok; `api.md` içinde `customer-send` yok (LG-5 teknik-yazar, madde 6) |

## Düzeltilmeli

1. [backend-dev] `apps/server/test/integration/lg-send.test.ts` K1 bloğu — AC-411 testi yok. Beklenen: `options` önizlemesinden `public/agent/download?ref=` değerini çıkar, oturumu süresi dolmuş hâle getir, aynı ref'e GET at ve 410 bekle. `agentLinkFor` kapısı açık olsun (ikili + `AGENT_SHA256` env'i).
2. [backend-dev] `lg-send.test.ts:136-146` ve `:353-363` — e-posta için "gönderilen = önizleme" kanıtı yok. Beklenen: MIME text/plain parçasını çözüp (QP/base64) `preview.text` ile `toBe` karşılaştır, konu ile `preview.subject` aynı olsun. Bunu K2 e-posta ve K1 e-posta (yeni uç) için yap.
3. [backend-dev] AC-406 kanal matrisi — Beklenen: birim ya da entegrasyon test tablosu. Kapsaması gereken durumlar:
   - WA `usable=false` → `unconfigured`
   - SMS kullanılamaz → `unconfigured`
   - `settings.view` yok → `settingsHref:null`
   - WA ayar bağlantısı yalnız Super Admin'de
   - K2 bildirim adresi yok → `no_recipient`
   - K2 ikili kapısı kapalı → EMAIL `unconfigured` (KD-LG3)
   - Hiç kanal yok → boş `channels`/`previews`
4. [backend-dev] `lg-send.test.ts:225-256` — tek tip 404 testine iptal edilmiş kod durumu eklenmeli. Akış: `liveToken` → `DELETE /registration-codes/:id` → aynı gövdeyle 404 (AC-419, mimari §12).
5. [proje-yoneticisi] AC-410 ile kod arasında çelişki var: K1 e-postasında `techShortName` yerine süzülmüş tam ad kullanılıyor (P10 gövdesini korumak için). İki seçenek var:
   - (a) AC-410 metni "e-postada süzülmüş tam ad" olarak güncellenir.
   - (b) [backend-dev] `customer-templates.ts:84` `fullName` yerine `T()` kullanılır ve AC-10 beklentisi güncellenir.

   Karar implementation.md'ye yazılır.
6. [teknik-yazar] AC-428 için `docs/KULLANIM_KILAVUZU.md`'ye "Müşteriye gönder" bölümü eklenmeli. İçeriği:
   - üç akış
   - kanal koşulları; K2'nin yalnız e-postayla gittiği (O-LG-3)
   - kayıt kodunun yeniden gönderilemeyeceği, kod başına 3 hak

   Ayrıca `docs/api.md` güncellenmeli: `POST /customer-send/options`, `POST /customer-send`, `GET|HEAD /public/unattended/download` ve K1 metin değişikliği. Ardından CHANGELOG ve PDF yeniden üretilir. Not: mimari §13 bu işi LG-4 GEÇTİ'den sonraya koyuyor. 1–5 kapandığında bu madde tek açık kalırsa koordinatör doküman turunu başlatabilir; AC-428 ✅ ancak bu iş tamamlanınca olur.
7. [mimar] SMS uzunluğu sapması: K1 SMS'i UCS-2'de 6–7 parça, mimari §5.1 "2–3 parça" diyor. Maliyet 2–3 kat artıyor ve tenant tavanı 200/sa. Kısaltma kararı ya da §5.1 metninin güncellenmesi gerekiyor; seçenekler: ref'i kısaltmak, SMS'te istemci satırını düşürmek. Karar implementation.md'ye yazılır.

## Definition of Done

| Madde | ✅/❌ | Not |
| --- | --- | --- |
| Lint / typecheck / unit / int / e2e yeşil | ✅ | Yukarıdaki tablo |
| Her AC'nin kanıtı var | ❌ | 406, 407, 411, 419 ⚠️; 410 karar bekliyor; 428 ❌ |
| Tasarım-kod uyumu | ⚠️ | Sözleşme §4.1, uçlar, hata sırası, audit eylemleri ve kovalar uyumlu. Sapmalar gerekçeli: `customer-actions.tsx` yerine `page.tsx`, radyo grubu, `sms_tr_only` bloğu üretilmiyor (400 `fields.to` ile karşılanıyor, kabul edilebilir). SMS parça sayısı kararı açık (madde 7) |
| Tenant izolasyonu | ✅ | Tüm sorgularda `tenantId` var; tenant-matrix'e yeni uçlar eklendi, AC-69 yeşil |
| Yetki arka uçta | ✅ | `targets.ts` K1 403/404, K2 404, K3 403 |
| Audit + maskeleme | ✅ | `unattended.code.sent`, `customer.link_sent`, `unattended.code.downloaded`; web etiketleri `LG_AUDIT_LABELS` |
| Log/metrikte PII yok | ✅ | AC-425 testi; metrik etiketleri `kind/channel/result` |
| Migration + grants | ✅ | `20261122000000_link_send`; `lg-schema.test.ts` CHECK, UNIQUE ve koşullu artışı doğruluyor |
| Yeni bağımlılık | ✅ | Yok |
| 5 durum + a11y + iki tema + 360 px | ✅ | e2e |
| Dokümantasyon (kılavuz, api.md, CHANGELOG, PDF) | ❌ | Madde 6 |

## Öneriler (zorunlu değil)

1. `customer-send/service.ts:207`: SMS dalına ulaşılamıyor (şema ve `CHANNELS_BY_KIND` önce reddediyor). Kaldırılabilir ya da `assertNever` yapılabilir.
2. `targets.ts:1-3` başlık yorumu sırayı 403 → 400 → 409 diye yazıyor; K1 kodunda 409 (PENDING) bağlantı 400'ünden önce. Yorum düzeltilmeli.
3. `service.ts:156`: `hitSendBuckets` TX içinde bellek kovasını harcıyor; sonraki audit yazımı başarısız olursa kova geri alınmıyor. Etkisi düşük, mevcut K1 deseniyle aynı.
4. Anonim müşteri için K3 409 testi eklenebilir (kod var, test yok).

## Olumlu

- Tek `renderFor` kaynağı. Eski `linkMessage` ve `sessionLinkMail` kopyası kaldırıldı.
- K1'in yeni uçtan eski servis fonksiyonlarına delegasyonu temiz; P10/P19 entegrasyon testleri değişmeden yeşil.
- Güvenlik turu maddeleri testlerle kapanmış: O-LG-1 dört durum, O-LG-2 yazım sınırları, D-LG-2 sırası ve firma pasif, D-LG-3 amaç ayrımı, D-LG-5.
- Belirteç tasarımı (PRF, yalnız hash, tek tip 404) ve `sent_count` DB CHECK'i iki katmanlı.

---

## P27 — kod turu 3

# QA Raporu — P27 (gözetimsiz erişim) Tur 3 (kısa doğrulama)

DURUM: GEÇTİ

Tarih: 2026-11-15 · Dal `p27-wip` @ `86ed103` (PR NoktaBilisim/Remote#10). İncelenen commit'ler: `9f12760` (K12 web + D-P27-K5 Go +
tur 2 doküman maddeleri) ve `86ed103` (Windows öz testi düzeltmesi + kaldırıcı çalışma dizini). Kod değiştirilmedi, staging'e
bağlanılmadı. Windows elle testleri (AC-274/289/342, implementation.md "P27 — düzeltme turu 2" adım 1–4) önceki turlardaki gibi
kullanıcıda bekliyor; kod/CI ayağı bu raporun kapsamı.

## Test sonucu

| Kaynak                                         | Sonuç                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI `86ed103` — ci.yml (run 43746307740)        | lint + type-check, shellcheck + actionlint, audit+lisans+gitleaks, coturn, build (+ Docker) **pass**. `test (MySQL 8.4)`: contracts 173/173, web 408/408, server 461/461; `test:int` **923/923** (91 dosya)                                                                                                                                  |
| CI `86ed103` — web e2e (Playwright, mock API)  | **pass**: 480 geçti / 0 kaldı / 203 skip (skip'ler `desktopOnly`/`mobileOnly` proje ayrımı — önceki turlarla aynı desen). `unattended.spec.ts:198` "kısmi durum…" **desktop ve mobile yeşil**                                                                                                                                                |
| CI `86ed103` — agent-win.yml (run 43746307788) | gofmt+vet+`test -race`+govulncheck+lisans, `go test (Windows)` (trace-check `-Servis` öz testi dahil), build 1/2–2/2, tekrarlanabilirlik + SHA256SUMS **pass**                                                                                                                                                                               |
| CI atlananlar                                  | SignPath, ONAY, attestation, Release — yalnız etiket yolunda (gerekçeli, AC-252/297)                                                                                                                                                                                                                                                         |
| Ara commit `9f12760` (bilgi)                   | `go test (Windows)` kırmızıydı (öz testte `MoveFileEx(DELAY_UNTIL_REBOOT)` runner'da başarısız) → `86ed103` CI adımında kayıt `PendingFileRenameOperations`'a doğrudan yazılıp geri alınarak düzeltildi. e2e'de `p15.spec.ts:173` (AC-235, 409 sonrası odak) 1 kez kırmızı; `86ed103`'te web kodu değişmeden yeşil → kararsız test (Öneri 1) |

## Tur 2 maddelerinin durumu

| Madde                                                   | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. api.md pasif müşteri 409 + `/register` 404 notu      | ✅    | `docs/api.md:3009` hata sütununda `CONFLICT` (müşteri pasif); `:3023-3026` "Pasif müşteri (D-P27-K2)" — mesaj metni koddaki `registration.ts:73` ile birebir, `/register` aynı 404 `REGISTRATION_CODE_INVALID` + kod tüketilmez, `cancelledRegistrations` audit                                                                        |
| 2. SMTP bilgi e-postası koşulu + `smtpChangeNotice`     | ✅    | `docs/api.md:3018-3021` "eski SMTP kaydı varsa … yoksa gönderim denenmez"; `:3028-3034` tablo `unattendedDevices` + `sent/failed/no_recipients/no_previous_config`. Kılavuz `:2735-2738` "Eski bir SMTP ayarı kayıtlıysa … yoksa ya da başka yönetici yoksa e-posta gitmez"                                                            |
| 3. Kılavuz + mesaj tablosu + CHANGELOG (D-P27-K2) + PDF | ✅    | Kılavuz `:2863-2864` (kodlar silinir, pasife kod yok, **Yeniden aktif et**), `:2938` mesaj satırı; CHANGELOG `:50-56` (K1–K4 dördü de). PDF (pypdf): `KULLANIM_KILAVUZU.pdf` 86 sayfa, "kayıt kodları silinir", "Müşteri pasif; kayıt kodu oluşturulamaz", "Eski bir SMTP ayarı kayıtlıysa", "Cihaz bağlanıyor" metinleri var          |
| 4. Runbook §27.2 adım 5 açılış logu + menü/düğme adları | ✅    | `docs/runbook.md:3418-3420` `grep -m1 unattended.mode` → `unattended.mode=unsigned deployEnv=staging` (kod `server.ts:26` ile eşleşiyor); "backend açık işi" kaldırıldı. §27 giriş, adım 6, §27.6, §27.8: **Gözetimsiz cihazlar** / **Servis programını indir** / **Cihazı iptal et** (`tr.json` `nav.unattended`, `un.code.download`) |

## Yeni değişikliklerin AC/DoD etkisi

- **K12 web (implementation.md "P27 — K12 düzeltmeleri"):** gözetimsiz konsolda doğrulama/oturum kodu gizli + "Cihaz bağlanıyor…"
  (`console-overlay.test.ts` 6 test + e2e `p17-console.spec.ts` "K12: gözetimsiz konsol bekleme…" axe dahil); arama 64 sınırı
  (`unattended.spec.ts` "K12: arama kutusu sözleşme sınırında (64)" — `maxlength`, kırpma, URL `q`); olmayan/bozuk/yetkisiz cihaz
  gerçek HTTP 404 (`unattended.spec.ts` "K12: … HTTP 404" üç durumu `res.status()` ile doğruluyor; `[id]/page.tsx:147,153` `notFound()`);
  modül ikonu tek kaynak `lib/module-icons.ts` (`Record<ModuleKey, LucideIcon>` — std. 1.8 derleme zamanında zorlanıyor). Rotalar
  tablosu güncel. Sapma (ayrıntıda iskelet yok, 404 `<title>`) gerekçeli. Kılavuz adım 3 konsol metni güncellendi. Test-operatoru
  tur 2 GEÇTİ (`docs/test-raporu.md`).
- **D-P27-K5 Go kaldırıcı (implementation.md "P27 — düzeltme turu 2"):** mimari §5.3 sapması (`%TEMP%` → `%SystemRoot%\Temp\NoktaDestekServis-kaldir-<16 hex>`,
  SY/BA korumalı DACL, SHA eşitliği, her çıkış yolunda yeniden başlatmada silme) **gerekçeli** (`%ProgramData%` neden seçilmedi dahil)
  ve `docs/mimari-p27.md` §5.3'e not düşülmüş; runbook §27.7 iz testi UYARI davranışı eklendi; `uninstall_test.go` 3 test +
  CI `-Servis` öz testinde iki yeni durum (kayıtsız kopya → çıkış 1, kayıtlı → çıkış 0) yeşil. AC-289/AC-274 otomatik ayağı korunuyor.
  Güvenlik tur 3: D-P27-K5 kapandı, Kritik/Yüksek 0.
- **`86ed103`:** kaldırıcı `ShellExecute` çalışma dizini = kopya klasörü (güvenlik tur 3 BİLGİ önerisinin uygulanması; Program
  Files'ın tanıtıcıyla tutulup iz kalmasını önler). Davranış daraltması, sözleşme değişikliği yok.

## Kabul kriterleri

Tur 1–2'deki ✅'ler değişmedi. Bu turda durumu değişenler:

| AC     | Durum                                | Kanıt / eksik                                                                                                    |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| AC-288 | ✅                                   | Tur 2 madde 1–3 kapandı (yukarıda); PDF güncel                                                                   |
| AC-290 | ✅                                   | Tur 2'de yalnız doküman nedeniyle bekliyordu; doküman maddeleri kapandı                                          |
| AC-289 | ✅ (+ Windows'ta elle test bekliyor) | CI `-Servis` öz testi D-P27-K5 kopya klasörü durumlarıyla genişledi, `86ed103`'te yeşil; tekrarlanabilirlik pass |
| AC-274 | elle test bekliyor (değişmedi)       | Otomatik kısmi kanıt + yeni kaldırma kopyası testleri; Windows elle testi kullanıcıda                            |

## Düzeltilmeli

Yok.

## Definition of Done

| Madde                                            | ✅/❌ | Not                                                                                                             |
| ------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1. AC'lerin tamamı testle kanıtlı, testler yeşil | ✅    | `86ed103`'te tüm CI işleri yeşil (test:int 923/923, e2e 480/0, Go + Windows). Windows elle testleri kullanıcıda |
| 2. Lint/format/type-check temiz                  | ✅    | CI pass; gofmt pass                                                                                             |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0           | ✅    | Bu rapor GEÇTİ; `docs/guvenlik-raporu.md` "P27 — kod turu 3" GEÇTİ (0/0/0/0)                                    |
| 4. test-operatoru sayfa taraması                 | ✅    | `docs/test-raporu.md` "P27a + P27 — sayfa testi tur 2" GEÇTİ                                                    |
| 5. Migration geri alınabilir, seed güncel        | ✅    | Bu turlarda migration yok                                                                                       |
| 6. Dokümantasyon güncel                          | ✅    | Tur 2 dört maddesi kapandı; PDF'ler yeniden üretildi (pypdf metin kontrolü)                                     |
| 7. Sapmalar implementation.md'de gerekçeli       | ✅    | D-P27-K5 konum sapması + K12 sapmaları gerekçeli; mimari-p27 §5.3 notu var                                      |

## Öneriler (zorunlu değil)

1. [frontend-dev] `apps/web/e2e/p15.spec.ts:212` — 409 sonrası `expect(cidr).toBeFocused()` `9f12760` CI'ında bir kez kırmızı,
   kod değişmeden yeşile döndü (kararsız). Odak verme zamanlaması (409 hatası render'ı sonrası `focus()`) incelenip test
   deterministik hale getirilmeli; tekrar kırmızı CI paket kapısını boşuna tutar.
2. [backend-dev] `docs/implementation.md:10360` `.github/workflows/agent-win.yml` satırı hâlâ "`MoveFileEx(…, DELAY_UNTIL_REBOOT)` kayıtlı
   → çıkış 0" diyor; `86ed103`'te öz test kaydı `PendingFileRenameOperations`'a doğrudan yazıyor ve kaldırıcı çalışma dizini
   değişikliği hiç yazılmamış. "P27 — düzeltme turu 2"ye iki satırlık ek not.
3. Tur 2'deki öneriler (`settingsTx` 41 satır, remote-watch P27 alarmları, SignPath iki-PE) prod açılışından önce kapanmalı.
   (`rs_unattended_device_auth_total{revoked|tenant_passive}` runbook §27.8'e eklendi — tur 2 önerisi kapandı.)

## Olumlu

- Tur 2'nin dört doküman maddesi kodla birebir eşleşen metinlerle kapandı (409 mesajı, log satırı, menü/düğme adları); PDF gerçekten
  yeniden üretilmiş.
- K12 düzeltmeleri adı K12 olan, davranışı gerçekten ölçen testlerle geldi (HTTP durum kodu, `maxlength` + URL, axe).
- Mobil kararsızlığın kök nedeni (hidrasyon öncesi `fastForward`) bulunup test düzeltildi, ürün davranışı değiştirilmedi.
- D-P27-K5 sapması mimariye, runbook'a ve CI öz testine birlikte işlenmiş; Windows CI kırmızısı aynı gün kök nedeniyle giderildi.

---

## P27 — kod turu 2

# QA Raporu — P27 (gözetimsiz erişim) Tur 2 (doğrulama)

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `p27-wip` @ `81568e5` · PR NoktaBilisim/Remote#10. Kod değiştirilmedi, staging'e bağlanılmadı.
Kalan sebep yalnız dokümantasyon tutarlılığı (kod ve testler bu turda temiz).

## Test sonucu

| Kaynak                                                                                                   | Sonuç                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CI `test (MySQL 8.4)` (run 43744023035)                                                                  | unit: contracts 173/173 · web 402/402 · server 461/461; tam `test:int` **923/923**, 91 dosya, skip yok                            |
| CI lint + type-check, shellcheck + actionlint, audit+lisans+gitleaks, coturn, Docker build               | pass                                                                                                                              |
| CI agent-win: gofmt+vet+`test -race`+govulncheck, `go test (Windows)`, build 1/2–2/2, tekrarlanabilirlik | pass                                                                                                                              |
| CI `web e2e (Playwright, mock API)`                                                                      | rapor anında **pending**. Bu commit `apps/web`'e dokunmuyor (tur 1: 474/0); sonucu koordinatör `gh pr checks 10` ile teyit etmeli |
| CI atlananlar                                                                                            | SignPath, onay, attestation, Release — yalnız etiket yolunda (gerekçeli, AC-252/297)                                              |
| Yerel `scripts/pt-olcum.sh` (geçici DB, kapsam koşusu dahil; konteyner silindi)                          | vitest server 1384 geçti (unit + entegrasyon), web 402, contracts 173; exit 0                                                     |
| Yerel işlev ölçümü (max-lines-per-function 40)                                                           | `src/unattended/**` **0 aşım**; tur 1'deki 6 işlevin hiçbiri listede yok                                                          |

## Tur 1 maddelerinin durumu

| Madde                                    | Durum                                 | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. AC-296 SMS/WA testi                   | ✅                                    | `unattended-outbox-k4.test.ts:84` "AC-296: firmada SMS/WhatsApp açık + telefonlu adres → EMAIL + SMS + WHATSAPP; kapalı ya da telefonsuzda yalnız EMAIL; aynı numara bir kez". Test `enqueueStarted`'ı (admit TX'inin çağırdığı işlev) dört durumda koşuyor: ayar satırı yok → yalnız EMAIL; bayrak açık + telefon yok → yalnız EMAIL; iki adres + aynı telefon → tek SMS + tek WHATSAPP (maske karşılaştırmalı) + 3 EMAIL; bayrak kapalı → yalnız EMAIL. `notify.ts:22-25` dalı artık çalıştırılıyor. CI'da yeşil |
| 2. 6 işlevin ≤ 40 satıra bölünmesi       | ✅                                    | Yerel ölçümde `routes.ts`, `contacts.ts`, `device-ws.ts`, `registration.ts`, `service.ts`, `connect-tx.ts` için aşım yok; `register.ts` ayrıldı (dosyalar ≤ 300)                                                                                                                                                                                                                                                                                                                                                   |
| 3. Kılavuz / DATASHEET / CHANGELOG + PDF | ✅ (yeni tutarlılık açıkları aşağıda) | Kılavuz §"Gözetimsiz erişim" (satır 2712–2933): SMTP ön koşulu + 409 mesajı (2720–2737, 2926), UAC/standart kullanıcı uyarısı (2780, 2875–2877), prod'da imzaya kadar kapalı (2916–2918). DATASHEET 23–26, 70–71, 129–134 (UAC + "imza alındıktan sonra canlıda açılır"). CHANGELOG "Eklendi — P27 … prod'da kapalı". PDF'ler yeniden üretilmiş: pypdf ile KULLANIM_KILAVUZU.pdf 86 sayfa / 40 "gözetimsiz", DATASHEET.pdf 7 eşleşme, iki PDF'te de "standart kullanıcı" geçiyor                                   |

## Kabul kriterleri

Tur 1'deki ✅'ler değişmedi. Bu turda durumu değişenler:

| AC     | Durum                                | Kanıt / eksik                                                                                                                                                                                                                                |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-296 | ✅                                   | Yukarıdaki madde 1 + tur 1'deki e-posta testleri                                                                                                                                                                                             |
| AC-342 | ✅ (+ Windows'ta elle test bekliyor) | Kod/test ayağı tur 1; kılavuz ve DATASHEET'te UAC uyarısı var                                                                                                                                                                                |
| AC-288 | ⚠️                                   | Bölüm yazıldı, ama düzeltme turu 1'in davranış değişiklikleri (pasif müşteri 409 / kodların silinmesi, `smtpChangeNotice` yeni değerleri) dokümanlara girmedi. Düzeltilmeli 1–3                                                              |
| AC-275 | ✅                                   | `unattended-device-ws-k3` "AC-275 D-P27-K1 …" (iptal/firma pasifi hub'a eklemeden önce → 4401), `unattended-register` "AC-275 D-P27-K2 …" (pasif müşteriye kod 409; pasife almada kodlar silinir; pasif müşteride kayıt 404, kod tüketilmez) |
| AC-339 | ✅                                   | `unattended-register` "AC-339 D-P27-K3: aynı IPv6 /64 … 429; başka /64 etkilenmez"                                                                                                                                                           |
| AC-336 | ✅                                   | `unattended-api` "AC-336 D-P27-K4 … no_recipients; … no_previous_config"                                                                                                                                                                     |
| AC-290 | ⏳                                   | qa DÜZELTİLMELİ (yalnız doküman)                                                                                                                                                                                                             |

## Düzeltilmeli

1. [teknik-yazar] `docs/api.md:3008` — `POST /registration-codes` hata sütununda pasif müşteri için 409 `CONFLICT`
   ("Müşteri pasif; kayıt kodu oluşturulamaz.") yok. Beklenen: hata listesine eklenmeli. Aynı bölümde `POST /unattended/register`
   için "müşteri pasif/anonim → geçersiz kodla aynı 404 `REGISTRATION_CODE_INVALID`, kod tüketilmez" notu.
2. [teknik-yazar] `docs/api.md:3019-3020` ve `docs/KULLANIM_KILAVUZU.md:2735-2736` — "kayıttan önce diğer yöneticilere (eski ayarla)
   bilgi e-postası gider" koşulsuz yazılmış. Kodda (`tenants/routes.ts` `smtpChangeGuard`) eski SMTP kaydı yoksa e-posta
   denenmiyor (`no_previous_config`), alıcı yoksa `no_recipients`. Beklenen: api.md'de audit
   `tenant_settings.updated.newValue.smtpChangeNotice` = `sent | failed | no_recipients | no_previous_config` ve
   `unattendedDevices` belgelenir; kılavuzda "eski SMTP ayarı varsa" koşulu eklenir.
3. [teknik-yazar] `docs/KULLANIM_KILAVUZU.md:2860` + "Sık karşılaşılan mesajlar (Gözetimsiz erişim)" tablosu (2922–2933) +
   `CHANGELOG.md` P27 bölümü — D-P27-K2 davranışı eksik. Beklenen: "Müşteri pasife alınınca cihazları iptal edilir **ve
   kullanılmamış kayıt kodları silinir**; pasif müşteriye kayıt kodu üretilemez"; mesaj tablosuna "Müşteri pasif; kayıt kodu
   oluşturulamaz." → "Önce müşteriyi **Yeniden aktif et**". CHANGELOG'a aynı madde. Ardından `scripts/build-docs.sh` ile PDF'ler.
4. [devops] `docs/runbook.md` §27.2 adım 5 (yaklaşık satır 3418) — "açılış logu `unattended.mode=<mod> deployEnv=<env>` server'da
   henüz yok — backend açık işi" yanlış: `apps/server/src/server.ts:26` bu logu yazıyor. Beklenen: parantez kaldırılıp doğrulama
   komutu (`docker compose logs server --since 5m | grep -m1 unattended.mode` → `unattended.mode=unsigned deployEnv=staging`)
   doğrudan adıma yazılır. Aynı bölümde menü adı "Gözetimsiz erişim" (§27 giriş ve adım 6) arayüzdeki "Gözetimsiz cihazlar"
   (`nav.unattended`) ve düğme adı "Servis programını indir" ile eşitlenir.

## Definition of Done

| Madde                                            | ✅/❌ | Not                                                                                                                                    |
| ------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. AC'lerin tamamı testle kanıtlı, testler yeşil | ✅    | Tüm kod AC'leri kanıtlı; test:int 923/923, unit yeşil, Go yeşil. e2e bu commit için pending (web değişmedi). Windows elle testleri K12 |
| 2. Lint/format/type-check temiz                  | ✅    | CI pass                                                                                                                                |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0           | ❌    | qa DÜZELTİLMELİ (yalnız doküman)                                                                                                       |
| 4. test-operatoru sayfa taraması                 | ❌    | Bu tur çalışma ağacında `docs/test-raporu.md` değişikliği ve `docs/img/p27-k12/` görüldü (sürüyor); sonuç bu raporda değerlendirilmedi |
| 5. Migration geri alınabilir, seed güncel        | ✅    | Düzeltme turunda migration yok                                                                                                         |
| 6. Dokümantasyon güncel                          | ❌    | Düzeltilmeli 1–4                                                                                                                       |
| 7. Sapmalar implementation.md'de gerekçeli       | ✅    | "P27 — düzeltme turu 1 / Tasarımdan sapmalar" 1–2 (pasif müşteriye 409 seçimi, ekle → yeniden oku) gerekçeli                           |

## İncelenen ek alanlar (tur 1'de incelenmeyenler)

- `deploy/agent/publish-servis.sh`: ortam kilidi fail-closed (production → yalnız `vX.Y.Z`; `--dir` etiketi `dir-…` olduğu için
  prod'a gidemez), `--no-attestation` yalnız `ALLOW_UNATTESTED=staging`, SHA/PE/≤40 MB/UPX/`asInvoker` denetimi, ağsız yardımcı
  konteynerle atomik volume yazımı, `.env` yedeği (son 5), konteyner içinden SHA eşitliği. Bulgu yok.
- `deploy/docker-compose.yml:143-155, 242`: `DEPLOY_ENV` `:?` ile zorunlu, `UNATTENDED_*` yalnız server'da, `unattended_downloads`
  salt okunur ve yalnız server'a bağlı. Boş `UNATTENDED_MODE` → `env.ts:189-193` boş = tanımsız → `off`. `.env.example` 102–118
  boş anahtarlar. CLAUDE.md "yeni env" kuralı sağlanıyor.
- Runbook §27: ortam tablosu, staging açılışı, imza gelince `signed` geçişi, acil kapatma, metrik adları (`rs_unattended_*` adları
  ve `bad_sig`/`unauth_cap`/`cap` değerleri kodla eşleşiyor). Tek bulgu Düzeltilmeli 4.

## Öneriler (zorunlu değil)

- `apps/server/src/tenants/settings.ts:100` `settingsTx` 41 satır (P27a `mfaRememberDevice` + P27 `auditExtra` eklemeleriyle 40'ı
  geçti); `tenants/routes.ts:58` `adminTenantRoutes` 70 → 71 (PT sonrası baseline'da zaten > 40). Dokunan böler kuralıyla bir
  sonraki dokunuşta bölünmeli.
- Runbook §27.8 alarm listesine D-P27-K1'in yeni `rs_unattended_device_auth_total{result="revoked"|"tenant_passive"}` değerleri
  (bilgi düzeyi) eklenebilir.
- Tur 1 K9 açıkları (remote-watch P27 alarmları, SignPath iki-PE) prod açılışından önce kapanmalı.

## Olumlu

- Tur 1'in üç maddesi kod tarafında eksiksiz kapandı; AC-296 testi dört ayrı durumu ve aynı numaranın tekilleştirilmesini
  maskeli değerle doğruluyor.
- Güvenlik bulguları (D-P27-K1..K4) adı AC içeren testlerle kapatılmış; tam entegrasyon CI'da 923/923, yerelde 1384/1384.
- Teknik-yazar bölümü kapsamlı: rol tablosu, kurulum sırası, rozetler, kapanış mesajları ve ortam bantları kodla uyumlu;
  PDF'ler gerçekten güncel.
- Dağıtım betiği ve compose kablolaması fail-closed ve runbook ile tutarlı.

---

## P27 — kod turu 1

# QA Raporu — P27 (gözetimsiz erişim) Tur 1 (K11)

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `p27-wip` @ `c05f8b9` (çalışma ağacı temiz) · PR NoktaBilisim/Remote#10. Kod değiştirilmedi,
staging'e bağlanılmadı. Yerel DB açılmadı (CI `test (MySQL 8.4)` tam koşusu kullanıldı).

## Test sonucu

| Kaynak                                                                                                                       | Sonuç                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI `lint + type-check`                                                                                                       | pass                                                                                                                                                       |
| CI unit (`pnpm -r run test`)                                                                                                 | contracts 173/173 · web 402/402 (45 dosya) · server 461/461 (33 dosya)                                                                                     |
| CI `test (MySQL 8.4)` — tam `test:int`                                                                                       | **916/916**, 91 dosya, skip yok                                                                                                                            |
| CI `web e2e (Playwright, mock API)`                                                                                          | 474 geçti / 0 kırmızı / 203 atlama — proje bazlı (desktop-yalnız/mobile-yalnız) bilinen atlamalar; `unattended.spec.ts` 3 masaüstü-yalnız atlama gerekçeli |
| CI agent-win: gofmt+vet+`test -race`+govulncheck+lisans, `go test (Windows)`, build 1/2–2/2, tekrarlanabilirlik + SHA256SUMS | hepsi pass (Windows işinde `trace-check -Servis` öz testi dahil)                                                                                           |
| CI shellcheck+actionlint, audit+lisans+gitleaks, coturn, Docker build                                                        | pass                                                                                                                                                       |
| CI atlananlar                                                                                                                | SignPath imzası, onay, Release, attestation — yalnız etiket/onay yolunda koşar (gerekçeli, AC-252/AC-297)                                                  |
| Yerel `docker golang:1.26` `go vet ./... && go test -race ./...`                                                             | 26 paket ok, exit 0                                                                                                                                        |
| Yerel `scripts/pt-olcum.sh boyut fonk`                                                                                       | yeni üretim dosyası > 500 yok; P27'nin yeni server dosyalarının hepsi ≤ 300; **6 yeni backend işlevi > 40 satır** (aşağıda)                                |

Tek kırmızı yok. Önceki turlarda görülen kararsız testler (`unattended-register` AC-273/337, `tenant-purge-meta-p16`,
`p19-notify-j3`, `retention-p13a-job`) bu CI koşusunda yeşil.

## Kabul kriterleri

"Elle test bekliyor" = otomatik kanıtın yapılabilen kısmı var; kalan kısım yalnız gerçek Windows'ta doğrulanabilir
(implementation.md P27 K5/K6/K6b/K7 elle test adımları; K12 / kullanıcı Windows testi). Eksik sayılmadı.

| AC     | Durum                                                                                   | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-273 | ✅ (+ elle test bekliyor: Windows olay günlüğü)                                         | `unattended-connect-k3` "AC-273 AC-296: bağlan → … ACTIVE UNATTENDED + onay + audit + outbox", "aynı step-up ile ikinci bağlantı → 401"; `unattended-register` tek kullanım + eşzamanlı kayıt; `unattended-api` kod üretimi step-up; `unattended-device-ws-k3` kötü imza/`device.unregister`; Go `TestAC273*` (wsdevice fikstür, DeviceAuthConnectAndRevoke, HeadlessAutoDecisions, ControlRequestGrantedUnattendedWithoutUI). Kurtarma kodu e-postası/≤3 uyarısı AC-215 (P10/P15) testlerinde; `stepUpMethod=recovery_code` k3 |
| AC-274 | elle test bekliyor                                                                      | Secure Desktop/kilit ekranı, yeniden başlatma ≤ 2 dk, iz bırakmadan kaldırma yalnız Windows'ta. Otomatik kısmi: `TestAC274NotInstalledOffersInstall`, `TestAC274InstalledShowsUninstallAndInfo`, K6b `desktop` testleri, CI `trace-check -Servis` öz testi                                                                                                                                                                                                                                                                      |
| AC-275 | ✅                                                                                      | k3 "iptal → revoked + 4401, oda device_revoked ile biter (≤ 10 sn), sonra 404"; `unattended-api` "iptal 204 … ikinci iptal 409"; `unattended-k3-fallback` AC-338/275 ≤ 60 sn yedek; e2e liste (durum/rozetler) + ayrıntı (iptal ad yazarak, yetkiler)                                                                                                                                                                                                                                                                           |
| AC-293 | ✅                                                                                      | `unattended-api` "yeni cihazda yetki yok; … ayrıntı 404", grant adayı 400; k3 "zincir sırası — grant yok 404", "yetki geri alma → permission (≤ 5 sn)"; audit eski→yeni (`unattended-api` AC-337 grant testi); e2e teknisyen yalnız grant'lı cihaz                                                                                                                                                                                                                                                                              |
| AC-294 | ✅ (+ elle test bekliyor: tüm monitör/kilit ekranında görsel)                           | Go `TestAC294IndicatorFailureNeverDialsGuest` (fail-closed), `…ShownWithServerTextBeforeDial`, `…LostDuringSessionEndsWithIndicatorFailed`, `TestAC294VerifyLayout`, `TestAC294DesktopChangeRebuildsIndicatorThenResumes`; server k3 `indicator_failed`                                                                                                                                                                                                                                                                         |
| AC-295 | ✅ (+ elle test bekliyor: tepsi/ayar penceresi, standart kullanıcı vs yönetici)         | k3 `device.state{false}` → `local_disabled`; fallback DB'de kapalı ≤ 60 sn; Go `TestAC295*` (sunucudan açma mesajı yok, boru `enable` reddi, kapatma yardımcıyı öldürür, yarış); e2e "Yerel olarak kapalı" rozeti                                                                                                                                                                                                                                                                                                               |
| AC-296 | ⚠️ kanıtsız (kısmi)                                                                     | E-posta yolu ✅ (k3 outbox satırı, `unattended-outbox-k4` "UNATTENDED_STARTED → … SENT", içerik testi, adres yoksa bağlantı yok k3 zinciri, ≤ 5 adres `unattended-api`). **"Tenant'ta SMS/WhatsApp açıksa onlara da" için test yok**: `unattended/notify.ts:22-25` dalı hiçbir testte çalıştırılmıyor (tüm testler yalnız `EMAIL` satırı bekliyor). Madde 1                                                                                                                                                                     |
| AC-297 | ✅                                                                                      | `env-deploy` "AC-297: kapı …"; `unattended-register` signed modda imzasız beyan 409 + kod tüketilmez; `unattended-device-ws-k3` signed → 4403; `unattended-api` mod off → 409; e2e off bandı; Go `TestAC297GateCloseRetriesAndLogsOnce`                                                                                                                                                                                                                                                                                         |
| AC-285 | ✅                                                                                      | contracts `unattended-p27` "AC-285: … tek tanımdan gelir; Admin açık, User kapalı"; web `users.test.ts` AC-72 etiketleri                                                                                                                                                                                                                                                                                                                                                                                                        |
| AC-286 | uygulanamaz                                                                             | P27 yeni dış servis ayarı eklemiyor (mevcut SMTP; step-up koruması AC-336'da)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AC-287 | ✅                                                                                      | e2e `unattended.spec.ts` liste: menü ikonu (`MonitorCog`), iki tema axe 0, 390 px taşma yok; kod diyaloğu axe; boş/hata/kısmi durum testleri                                                                                                                                                                                                                                                                                                                                                                                    |
| AC-288 | ⚠️ (dokümantasyon adımı)                                                                | `KULLANIM_KILAVUZU.md`, `DATASHEET.md`, `CHANGELOG.md`'de "gözetimsiz" geçmiyor. Zincirde teknik-yazar adımı sonra gelir; paket kapanmadan zorunlu. Madde 3                                                                                                                                                                                                                                                                                                                                                                     |
| AC-289 | ✅ (+ elle test bekliyor: gerçek kurulumda `trace-check.ps1 -Servis on/off`)            | CI tekrarlanabilirlik (iki ikili SHA eşit) + Windows işinde `trace-check -Servis` öz testi                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AC-290 | ⏳                                                                                      | Güvenlik kod turu 1 GEÇTİ (K0/Y0); qa bu rapor (DÜZELTİLMELİ)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AC-336 | ✅                                                                                      | `unattended-api` "SMTP kaydı yoksa kod üretimi 409 NOTIFY_CHANNEL_UNAVAILABLE …", "etkin cihaz varken SMTP değişikliği step-up ister; audit unattendedDevices"; k3 zincirinde SMTP yok; `unattended-outbox-k4` "3 denemede FAILED → rozet + audit; sonraki başarılı rozeti kaldırır"; e2e "AC-336 SMTP kaydı yok: Bağlan ve Kayıt kodu oluştur pasif + neden" + rozet                                                                                                                                                           |
| AC-337 | ✅                                                                                      | `unattended-api` adres kaydı step-up + eski ∪ yeni satırları + maskeli audit, "Yeni — doğrulanmadı" ilk grant'a kadar + kayıt IP'si; `unattended-outbox-k4` içerik maskeli fark + değiştiren; `unattended-register` `UN_DEVICE_REGISTERED` + manage e-postası; e2e ayrıntı (rozet kalkar) + müşteri adresleri step-up                                                                                                                                                                                                           |
| AC-338 | ✅ (+ elle test bekliyor: tepsi PID eşleşmesi gerçek SCM'de)                            | k3 eşzamanlı → 409 DEVICE_BUSY, iptal ‖ kabul → ACTIVE yok; `unattended-k3-fallback` üç sahte saatli ≤ 60 sn testi; Go `TestAC338LocalOffComesFromHKLMNotPipe`, `TestAC338UnverifiedWins`, `TestAC338PipeErrorClassification`, `TestAC338SecondConnectBusyAndNoConsole`                                                                                                                                                                                                                                                         |
| AC-339 | ✅                                                                                      | `unattended-device-ws-k3` IP başına 5 / süreç tavanı 503, `ipChanged`, 4409 + `replacedAlert` + audit 10 dk'da 1; `unattended-register` başarısız tavan + IP kilidi; `unattended-api` selfGrant e-postası; k3 kurtarma koduyla bağlantı e-postası; e2e rozet                                                                                                                                                                                                                                                                    |
| AC-340 | ✅ (+ elle test bekliyor: önceden oluşturulmuş klasör, junction, `trace-check -Servis`) | Go `TestAC340DirACLExactSet`, `TestAC340FileACLAndOwner`, `TestAC340KeyPromotedToSystemScope`, `TestAC340IncomingFinalPath`, `TestAC340QuotedImagePath`, `TestAC340NoEnvURLOrInsecureTLS` (Windows CI)                                                                                                                                                                                                                                                                                                                          |
| AC-341 | ✅ (+ elle test bekliyor: jeton/job gerçek süreçte)                                     | Go `TestAC341HelperDependencyBoundary` (URL/MessageBox/os/exec yok), `TestAC341OnlyAllowedPrivileges`, `TestAC341MainFirstCallIsDllsafe`, `TestAC341HelperInput*`                                                                                                                                                                                                                                                                                                                                                               |
| AC-342 | ⚠️ kanıtsız (kısmi)                                                                     | Kod ve test ayağı ✅: Go `TestAC342DesktopChangeUnverifiedIndicatorNoFramesNoInputThenIndicatorFailed`, `…NotVerifiedWithinDefaultTwoSeconds…`, `…FramesAndInputDroppedWhileDesktopChanges`; `env-deploy` 4 test; e2e TEST bandı + kayıt kodu UAC satırı. **Eksik:** AC "kullanım kılavuzu, DATASHEET … UAC/standart kullanıcı uyarısını açıkça yazar" diyor; iki dokümanda yok. Madde 3                                                                                                                                        |

## Düzeltilmeli

1. [backend-dev] `apps/server/test/integration/` (yeni test, ör. `unattended-outbox-k4.test.ts`) — AC-296 "firmada SMS/WhatsApp
   açıksa onlara da" dalı (`src/unattended/notify.ts:22-25`) testsiz. Beklenen: `tenant_request_settings.notify_sms_enabled` /
   `notify_whatsapp_enabled` açık ve adreste telefon varken admit sonrası `UNATTENDED_STARTED` için EMAIL + SMS + WHATSAPP
   satırları; kapalıyken ya da telefon yokken yalnız EMAIL; aynı numara iki kez yazılmaz. Test adı "AC-296 …".
2. [backend-dev] İşlev ≤ 40 satır kuralı (pt-olcum `fonk`, prettier sonrası) — P27'nin yeni işlevleri: `unattended/routes.ts:66`
   `unattendedRoutes` 65, `unattended/contacts.ts:82` `putContacts` 43, `unattended/device-ws.ts:101` `open` 42,
   `unattended/registration.ts:161` `registerTx` 42, `unattended/service.ts:212` `putGrants` 42, `unattended/connect-tx.ts:64`
   `openDeviceSession` 41. Beklenen: davranış değişmeden yardımcıya bölünmüş, ölçümde 0 aşım (frontend K8 aynı kuralı kapattı).
3. [teknik-yazar] `docs/KULLANIM_KILAVUZU.md`, `docs/DATASHEET.md`, `CHANGELOG.md` (+ PDF'ler) — gözetimsiz erişim bölümü hiç yok.
   AC-342 metni: "oturumdaki Windows kullanıcısı yöneticiyse teknisyen UAC onayı verebilir; standart kullanıcı hesabı önerilir"
   kılavuzda ve DATASHEET'te açıkça; AC-336 notu: bölüm başında SMTP ön koşulu ve "Bildirim e-postası yapılandırılmamış" 409 mesajı;
   DATASHEET'te prod'da imza gelene kadar kapalı (AC-297/R30), yalnız kodda olan özellikler (AC-288).

## Definition of Done

| Madde                                            | ✅/❌ | Not                                                                                                                                               |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. AC'lerin tamamı testle kanıtlı, testler yeşil | ❌    | Testler yeşil; AC-296 (SMS/WA) ve AC-342/288 (doküman) eksik. Windows elle testleri K12'de                                                        |
| 2. Lint/format/type-check temiz                  | ✅    | CI `lint + type-check` pass; Go gofmt/vet/staticcheck pass                                                                                        |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0           | ❌    | Güvenlik ✅ (K0/Y0/O0/D4); qa DÜZELTİLMELİ                                                                                                        |
| 4. test-operatoru sayfa taraması                 | ❌    | Henüz koşulmadı (zincirde sonra)                                                                                                                  |
| 5. Migration geri alınabilir, seed güncel        | ✅    | `20261121010000_p27_unattended/down.sql` korumalı; grants 730/730 (CI); cihaz seed'i bilinçli yok (gerekçeli)                                     |
| 6. Dokümantasyon güncel                          | ❌    | runbook §27 ✅, implementation.md ✅; kılavuz/DATASHEET/CHANGELOG/PDF ❌ (madde 3)                                                                |
| 7. Sapmalar implementation.md'de gerekçeli       | ✅    | K0..K9 + kapanış bölümlerinde sapmalar gerekçeli (outbox admit TX'inde, `/ws/device` ayrı WSS, temizlik retention adımı, `permission` nedeni vb.) |

## Öneriler (zorunlu değil)

- `test/integration/unattended-k8-gaps.test.ts:41,56,65,80` — test adları "AC-339" diyor ama `deviceId` geçmiş filtresi ve
  `unattendedGrantable` seçenek ucunu doğruluyor (AC-339 ile ilgisiz). Adlar AC-275/AC-293'e (ayrıntıda son oturumlar,
  yetki ekranı) çevrilmeli; izlenebilirlik yanıltıcı.
- `unattended/routes.ts` rota eklentisi bölünürken (madde 2) panel uçları ile kayıt eklentisi ayrı işlevlere alınabilir.
- K9 açıkları: `deploy/ops/remote-watch.sh` P27 alarm otomasyonu ve SignPath iki-PE yapılandırması (devops/repo sahibi) prod
  açılışından önce kapanmalı (şu an prod'da `UNATTENDED_MODE=off`, engel değil).
- Outbox paylaşılan kuyruk kaynaklı test kırılganlığı (implementation.md kapanış "Yapılmayan" 2) bu koşuda görünmedi; tekrar
  ederse `describe.sequential` / firma kancası.

## İncelenmeyen alanlar (tur sınırı)

- Yerel DB ile hedefli tekrar koşu yapılmadı (CI tam koşusu esas alındı); kararsız testler tek koşuyla değerlendirildi.
- Go `internal/servis*`, `servisui`, `cmd/noktadestek-servis` kodu satır satır okunmadı; kanıt test adları + CI Windows işi.
- Web `unattended/**` bileşenlerinde ayrıntılı a11y/klavye incelemesi ve tasarım token taraması yalnız grep düzeyinde yapıldı.
- `deploy/` compose, `publish-servis.sh` ve runbook §27 içerik doğrulaması yapılmadı (CI shellcheck/actionlint/compose geçti).

## Olumlu

- Tam `test:int` 916/916, Go `-race` linux + Windows CI, e2e 474/0 — P27 tek turda tamamen yeşil.
- Ön koşul zinciri, TX içi yeniden denetim ve yedek ≤ 60 sn kesme sahte saatle gerçekten test edilmiş (3 ayrı sunucu, paylaşılan
  saat sorunu giderilmiş).
- AC-342 kapı mantığı Go'da kare/girdi sayacıyla doğrulanıyor; AC-341 sınırı AST testiyle derleme düzeyinde korunuyor.
- Yeni üretim dosyalarının hepsi ≤ 300 satır; `rooms.ts` 429 → 294 ve `outbox.ts` 391 → 297 "dokunan böler" uygulandı; yeni
  bağımlılık yok; `any`/yutulan hata/ham renk taraması temiz.

---

## P27a — kod turu 2

# QA Raporu — P27a (2FA "bu cihazı 30 gün hatırla") Tur 2

DURUM: GEÇTİ

Tarih: 2026-11-15 · Dal `p27-wip` @ `2c70be9` + çalışma ağacı (P27 WIP de var; yalnız P27a denetlendi) · Kapsam: Tur 1
"Düzeltilmeli" 1-3 + güvenlik D-P27a-K1/K2 düzeltmeleri (`implementation.md` "P27a — düzeltme turu 1"). Kod değiştirilmedi,
staging'e bağlanılmadı. **Kapsam dışı:** `auth/service.ts`'te paralel yürüyen D-P27a-K3 (login TX'inde kullanıcı satırı
`FOR SHARE`) değişikliği bu turda değerlendirilmedi; testler o dosyanın o anki (yarım olabilecek) hâliyle koştu.

## Test sonucu

Ortam: geçici `rs-qa-p27a2-db` (mysql 8.4, `--max-connections=300 --log-bin-trust-function-creators=1`, doğrulandı `1 1 300`),
kullanıcılar `deploy/mysql/init/01-users.sh`, CI env'i; iş sonunda silindi.

| Komut                                                                                          | Sonuç                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate` · `check-app-grants.sh`                                                      | tüm migration'lar temiz · 730/730 PASS                                                                                                                                                                                                              |
| `pnpm -r run lint` · `pnpm -r run typecheck`                                                   | temiz · 0 hata                                                                                                                                                                                                                                      |
| `pnpm format:check`                                                                            | 3 dosya farklı: `customers/write-tx.ts`, `docs/implementation.md` (P27-K8 rota tablosu), `docs/guvenlik-raporu.md` — üçü de P27/güvenlik raporu; P27a düzeltme dosyaları (`src/auth`, `test`, `form-error.tsx`, p27a spec) `prettier --check` temiz |
| `pnpm -r run test` (unit)                                                                      | contracts 172/172 · web 402/402 · server 456/456                                                                                                                                                                                                    |
| Hedefli ×2: `p27a-*`, `account-p10`, `p15-backend`, `security-p14a-auth`, `tenant-isolation`   | 1. koşu **110/110**, 2. koşu **110/110** (8 dosya)                                                                                                                                                                                                  |
| `pnpm --filter @remote/server test:int` (tam, 1 kez)                                           | 886/890 — 4 kırmızı, **hiçbiri P27a değil** (aşağıda)                                                                                                                                                                                               |
| `playwright test e2e/p27a-trusted-device.spec.ts` (3217/4217, çakışma yok; `next build` dahil) | 14/14 (desktop + mobile), skip yok                                                                                                                                                                                                                  |

Tam koşudaki kırmızılar (P27 WIP, P27a dışı):

1. `pt-surface` AC-318 — rota anlık görüntüsünde yeni `/unattended/*` uç(lar)ı (P27-K3/K4).
2. `unattended-k3-fallback` AC-338 ×2 (AC-293 / AC-295 yedek yeniden doğrulama) — P27-K3.
3. `retention-p13a-job` AC-199 — saklama audit'inde `"unattendedCodes": "***"` (sayı yerine maskeli dize; audit maskeleyicisi
   `Codes` adlı anahtarı gizli sayıyor). Kaynak: koşu sırasında değişen `jobs/retention*.ts` + yeni `jobs/unattended-cleanup.ts`
   (P27). Aynı satırdaki P27a sayacı `trustedDevices: 0` sayı, doğru.

Tur 1'in kararsız kırmızıları (`account-p10` AC-67, `p15-backend` AC-231, `security-p14a-auth` AC-215, `enable 503`) ne iki
hedefli koşuda ne tam koşuda görüldü. Test yardımcısı `enroll`'daki 503 yeniden denemesi kaldırılmış olmasına rağmen yeşil.

## Tur 1 maddelerinin durumu

| #                                       | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 [backend] AC-69 sınıfsız 3 uç         | ✅    | `test/helpers/tenant-matrix.ts:55-57` `"self"`; `tenant-isolation` AC-69 sınıflandırma testi 3 koşuda yeşil                                                                                                                                                                                                                                                            |
| 2 [backend] `enableTx` kilitlenme       | ✅    | `auth/account.ts:154-161` kilitsiz `findMany` + PK `updateMany`; `:162` `deleteForLockedUser` (`trusted-device-repo.ts:151`); `:117-122` 1213/P2034'te (`isTransientDbError`) tek yeniden deneme. Geri alınan TX yazmadığı için çift yazım yok; `CONFLICT` vb. geçici olmayan hatalar yeniden denenmez                                                                 |
| 3 [frontend] `FormError` kontrast + axe | ✅    | `components/form-error.tsx:12` `opacity-80` kaldırıldı (ton rengi `Alert`'ten, yeni token yok); `e2e/p27a-trusted-device.spec.ts:90-95` hata durumunda "Hata kodu" satırı görünür iken açık + koyu `axeScan` = [] — desktop+mobile yeşil                                                                                                                               |
| D-P27a-K1 `rotate` gone/mismatch        | ✅    | `trusted-device-repo.ts:110-117` (0 satırda `FOR SHARE` yeniden okuma); `trusted-device.ts:245-246`; testler `p27a-repo` "satır silinmişse gone", `p27a-rotation` "satır arada silinirse… reuse audit/e-posta yok, oturumlar açık" + "özet değişmişse yine yeniden kullanım" (kanca `beforeRotate` yalnız testte; `auth/service.ts:210` üretim çağrısı kanca vermiyor) |
| D-P27a-K2 ortak sahiplik                | ✅    | `trusted-device.ts:195` `ownsTrustedDevice` hem `classify` (`:206`) hem `currentTrustedDeviceId` (`:295`, + `trustedDeviceLive`); test `p27a-rotation` "AC-329 D-P27a-K2: profil 'Bu cihaz' … kullanıcı + firma ve süre"                                                                                                                                               |
| Dosya boyu                              | ✅    | `trusted-device.ts` 299 satır; `trusted-device-notify.ts` 45, `trusted-device-ua.ts` 30; davranış/sözleşme değişmedi                                                                                                                                                                                                                                                   |

### tenant-isolation değişikliği izolasyonu zayıflatıyor mu? — Hayır

- HEAD'de `"self"` sınıfındaki tek GET `/api/v1/auth/me` idi; pozitif kontrol (`B tenantId yanıtta`) aynen ona uygulanmaya
  devam ediyor (`tenant-isolation.test.ts:37`). Yani mevcut hiçbir uç için denetim gevşemedi.
- Sızıntı denetimi (`idsOf(fx.a)` hiçbiri yanıtta yok) tüm self GET'lere — yeni cihaz listesi dahil — koşulsuz uygulanıyor;
  `200` beklentisi de duruyor. `selfGets` içinde `/auth/me` varlığı hâlâ zorunlu (`:29`).
- Pozitif kontrolün cihaz listesine uygulanmaması doğru: yanıt şeması `tenantId` taşımaz; uygulansaydı test yanlış
  kırmızı verirdi.
- Sınırlılık (bulgu değil, öneri): fikstürde A'nın güvenilir cihaz satırı yok ve `idsOf` cihaz id'si içermiyor; bu yüzden
  matristeki cihaz listesi sızıntı denetimi pratikte boş. Kullanıcılar/firmalar arası cihaz izolasyonunun asıl kanıtı
  P27a testlerinde: `p27a-auth` AC-329 "liste yalnız kendi cihazları" ve "başkasının id'si / olmayan id 404",
  `p27a-repo` "tekil silme: başka kullanıcının satırı 0", "firma geneli silme yalnız o firma", login'de
  `p27a-auth` AC-326 "başka kullanıcının geçerli belirteci yok sayılır".

## Kabul kriterleri

| AC                          | Durum | Kanıt veya eksik                                                                                                                                                                                                   |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-325..328, 330..334, 335a | ✅    | Tur 1 kanıtları geçerli; ilgili testler bu turda iki hedefli + bir tam koşuda yeşil                                                                                                                                |
| AC-329                      | ✅    | API `p27a-auth.test.ts:329,346,356` + D-P27a-K2 testi; UI 5 durum + hata durumunda açık/koyu axe 0 ihlal (`p27a-trusted-device.spec.ts:82-98`)                                                                     |
| AC-335                      | ✅    | lint/typecheck/unit/e2e yeşil; P10/P14a/P15 auth testleri ve `tenant-isolation` 3 koşuda değişmeden yeşil; kalan integration kırmızıları P27 WIP. `format:check` kırmızısı P27 dosyalarında (P27a dosyaları temiz) |
| AC-335b                     | ✅    | Tur 1 kanıtları + D-P27a-K1 testleri (`gone` reuse'tan ayrıldı, `mismatch` reuse kaldı)                                                                                                                            |

## Düzeltilmeli

Yok (P27a kapsamında).

P27 paketine not (bu paketi bloklamaz; P27 QA turunda ele alınmalı): `pt-surface` anlık görüntüsü, `unattended-k3-fallback`
AC-338 ×2, `retention-p13a-job` AC-199 (`unattendedCodes` maskelenmesi — anahtar adı ya da maskeleyici istisnası), ve 3 dosyalık
prettier farkı. P27a commit'lenirken bu dosyalar P27a commit'ine karışmamalı.

## Definition of Done

| Madde                                 | ✅/❌ | Not                                                                                                                                                                 |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm AC'ler kanıtlı                    | ✅    | 13/13                                                                                                                                                               |
| Testler yeşil (unit/integration/e2e)  | ✅    | P27a ve etkilenen dosyalar 2×110/110; tam koşuda kırmızılar yalnız P27 WIP                                                                                          |
| Lint / typecheck / format             | ✅    | lint + typecheck temiz; format farkı yalnız P27/rapor dosyalarında                                                                                                  |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅    | `deleteForLockedUser`, yeniden deneme, `RotateResult`, `currentTrustedDeviceId` imzası, dosya bölünmesi `implementation.md`'de gerekçeli; HTTP sözleşmesi değişmedi |
| Katman/`any`/hata yutma/PII log       | ✅    | yeniden deneme yalnız geçici DB hatasında, diğerleri fırlatılır; `any` yok                                                                                          |
| Transaction                           | ✅    | `enableTx` tek TX, kullanıcı satırı ilk ifadede X kilitli; `rotate` ek okuma aynı TX'te                                                                             |
| Frontend 5 durum + a11y               | ✅    | hata durumu axe açık+koyu 0 ihlal                                                                                                                                   |
| İkonlar / token / tema                | ✅    | yeni ham renk/opaklık yok                                                                                                                                           |
| Yeni bağımlılık / env / grants        | ✅    | yok; grants 730/730 (`FOR SHARE` `app` kullanıcısıyla testte çalışıyor)                                                                                             |

## Öneriler (zorunlu değil)

- [güvenlik ile] `account.ts:154` "diğer oturumlar" artık kilitsiz (anlık görüntü) okunuyor; anlık görüntü TX içindeki ilk
  tutarlı okumada (`recoveryCode.count`) alındığından, bu andan sonra commit olan eşzamanlı bir girişin oturumu iptal
  edilmeden kalabilir (eski kilitli UPDATE boşluk kilidiyle bunu engelliyordu). O oturum `mfa_passed=0` ile doğar ve kullanıcı
  artık TOTP'li olduğundan ikinci adım ister; risk düşük, ama güvenlik raporunda kabul olarak yazılması iyi olur.
- `tenant-matrix.ts` `twoTenants`'a A için bir güvenilir cihaz satırı ve `idsOf`'a id'si eklenirse matristeki cihaz listesi
  sızıntı denetimi anlam kazanır.

## Olumlu

- Kilitlenme kökü (boşluk/next-key kilidi) hedeflendi; yeniden deneme yalnız güvenlik ağı. Test yardımcısındaki 503 yeniden
  denemesi kaldırılıp yine yeşil kalması düzeltmenin gerçek olduğunu gösteriyor.
- D-P27a-K1 için `FOR SHARE` seçimi gerekçeli (RR anlık görüntüsü silinen satırı gösterirdi) ve gecikme kancalı testle kanıtlı.
- Kontrast düzeltmesi yeni token eklemeden yapıldı; axe testi düzeltme geri alınınca kırmızı olduğu (implementation.md) belirtilmiş.

---

## P27a — kod turu 1

# QA Raporu — P27a (2FA "bu cihazı 30 gün hatırla") Tur 1

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `p27-wip` @ `2c70be9` (ağaçta P27 WIP de var; yalnız P27a denetlendi) · Kaynak: `docs/gereksinimler.md` §11
(AC-325..335, 335a, 335b), `docs/mimari-p27a.md` r3, `docs/implementation.md` P27a K1..K5. Kod değiştirilmedi.

## Test sonucu

Ortam: geçici `rs-qa-p27a-db` (mysql 8.4.13, `--max-connections=300 --log-bin-trust-function-creators=1`), kullanıcılar
`deploy/mysql/init/01-users.sh`, CI ile aynı env; iş sonunda silindi. **Tüm migration'lar (P27 dahil) uygulandı.**

| Komut                                                                                            | Sonuç                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate`                                                                                | 26 migration + grants temiz                                                                           |
| `check-app-grants.sh`                                                                            | 730/730 PASS (trusted_devices DML OK; ALTER/DROP/TRIGGER DENIED; CHECK'ler)                           |
| `pnpm format:check` · `pnpm -r run lint` · `pnpm -r run typecheck`                               | temiz / temiz / 0 hata                                                                                |
| `pnpm -r run test` (unit)                                                                        | contracts 172/172 · web 391/391 · server 456/456                                                      |
| `pnpm --filter @remote/server test:int` (tam)                                                    | **846/850 — 4 kırmızı** (aşağıda)                                                                     |
| Hedefli yeniden koşu ×2 (account-p10, p15-backend, security-p14a-auth, p27a-*, tenant-isolation) | 1. koşu 103/105, 2. koşu 104/105                                                                      |
| `playwright test p27a-trusted-device p10-account p14a-a4`                                        | 58 geçti / 0 kaldı / 18 skip (skip'ler mevcut mobile kapsam dışı P10/P14a testleri; P27a'da skip yok) |

Kırmızılar:

1. **Deterministik, P27a payı var:** `tenant-isolation.test.ts` "AC-69: uygulamadaki her uç sınıflandırılmış" —
   sınıfsız 15 uç; 3'ü P27a: `GET /api/v1/auth/trusted-devices`, `DELETE /api/v1/auth/trusted-devices/:id`,
   `DELETE /api/v1/auth/trusted-devices` (kalan 12'si `/unattended/*`, P27).
2. **Kararsız (her koşuda farklı test):** `account-p10` AC-67, `p15-backend` AC-231 ×2 (tam koşu), `security-p14a-auth`
   AC-215 "hatalı kod 400…" (hedefli 1. koşu, `503 NOT_READY`). Hepsinin ortak noktası test kurulumundaki
   `POST /auth/mfa/enable`'ın eşzamanlı dosyalarda InnoDB deadlock'a düşüp 503 vermesi; sonraki adımda kullanıcıda TOTP
   olmadığı için `MFA_SETUP_REQUIRED` görülüyor. K3 notunda kaynağı açık bırakılmış: `enableTx` içindeki
   "diğer oturumları iptal" `auth_sessions` UPDATE'inin next-key kilidi. P27a `enableTx`'e `deleteForUser` ekledi
   (aynı TX'te ek kilit), yani P27a bu yolu genişletti; AC-335 "P10/P14a/P15 auth testleri değişmeden yeşil" ister.

**Bilinen açık (1) — AC-215 kurtarma kodlu step-up 500:** yeniden üretilemedi. `security-p14a-auth` "kurtarma koduyla
step-up" testi tam koşuda ve iki hedefli koşuda **geçti**. K3'ün 500'ü, P27 migration'ı (`20261121010000_p27_unattended`)
uygulanmadan P27 WIP koduyla (support_sessions.device_id, notification_outbox session_id/event_id, SMTP step-up)
çalışan DB'den kaynaklanmış olmalı; bu turda P27 migration'ı uygulanınca kaybolur. Kök neden P27a kodunda değil.
Aynı testin kararsız 503'ü yukarıdaki madde 2'dir.

## Kabul kriterleri

| AC      | Durum | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-325  | ✅    | `p27a-auth.test.ts:71` (çerez öznitelikleri Max-Age 2592000, Domain yok, yalnız SHA-256, +30 g, audit created), `:97` (işaretsiz), `:105` (kurtarma + rememberDevice 400), `:131` (Super Admin yok sayılır); e2e `p27a-trusted-device.spec.ts:18,41` (varsayılan işaretsiz, kurtarma modunda gizli)                                                                                       |
| AC-326  | ✅    | `p27a-auth.test.ts:154` (mfa:"remembered", used audit, last_used/ip, expires sabit, döndürme), `:174` (hatalı şifre 401 + kilit 423, satır değişmez), `:188` (süresi dolmuş → TOTP + çerez silme), `:203` (başkasının belirteci), `:214` (iki çerez), `:221` (mustChangePassword), `:230` (setup aşaması); kod sırası `auth/service.ts:177-203` (kilit → şifre → geçici şifre → belirteç) |
| AC-327  | ✅    | `p27a-auth.test.ts:247` (step_up_at NULL, `DELETE /users/:id` 401 MFA_STEP_UP_REQUIRED)                                                                                                                                                                                                                                                                                                   |
| AC-328  | ✅    | auth dalı `p27a-auth.test.ts:265,276,290,300,314`; kullanıcı/firma dalı `p27a-revoke.test.ts:57` (Admin 2FA sıfırlama), `:69` (pasif), `:80` (firma pasif), `:95` (ayar kapatma); hepsi `revokedTrustedDevices` audit'iyle                                                                                                                                                                |
| AC-329  | ⚠️    | API ✅ `p27a-auth.test.ts:329,346,356,374`; UI 5 durum ✅ `p27a-trusted-device.spec.ts:51,82,94`. Eksik: hata durumu axe'la taranmıyor ve taranırsa `FormError` istek kimliği satırı `color-contrast` ihlali veriyor (K5 notu, `components/form-error.tsx:12`) — erişilebilirlik koşulu kanıtsız/ihlalli                                                                                  |
| AC-330  | ✅    | `p27a-revoke.test.ts:138` (sayı yalnız süresi dolmamış, forget-devices + audit admin), `:158` (kendi 403, başka firma 404, geniş yetkili 403, yetkisiz 403, fazla alan 400); e2e `:101` (onaylı diyalog + axe)                                                                                                                                                                            |
| AC-331  | ✅    | `p27a-revoke.test.ts:95,127`; `p27a-auth.test.ts:117,131,141`; unit `trusted-device.test.ts:18,22`; e2e `:115`                                                                                                                                                                                                                                                                            |
| AC-332  | ✅    | `p27a-auth.test.ts:392` (11. cihaz, audit limit, paralel iki oluşturma); `p27a-repo.test.ts:72,88`                                                                                                                                                                                                                                                                                        |
| AC-333  | ✅    | `p27a-auth.test.ts:410` (log + audit + mail'de gizli/özet yok, log yakalamalı), `:329` (yanıt gövdesi); unit `trusted-device-token.test.ts:17,25`, `trusted-device.test.ts:54` (UA ≤ 80)                                                                                                                                                                                                  |
| AC-334  | ✅    | `p27a-revoke.test.ts:183` (saklama), `:193` (purge), `:211` (KVKK erasure); `tenant-purge-meta-p16` yeşil; grants 730/730                                                                                                                                                                                                                                                                 |
| AC-335  | ❌    | lint/typecheck/format/unit/e2e yeşil; **integration kırmızı**: `tenant-isolation` AC-69 (P27a uçları sınıfsız, deterministik) + P10/P14a/P15 auth testlerinde `mfa/enable` deadlock kaynaklı kararsız kırmızılar                                                                                                                                                                          |
| AC-335a | ✅    | `p27a-auth.test.ts:410` (tek e-posta, UA, bağlantı/belirteç yok), `:441` (SMTP yok → `not_configured`, yanıt 200); unit `trusted-device.test.ts:80` (IP/saat/kaçış)                                                                                                                                                                                                                       |
| AC-335b | ✅    | `p27a-rotation.test.ts:33` (aynı id, expires sabit, Max-Age kalan), `:54` (T0→T1→T2→T0: tüm cihaz + T2 oturumu iptal, yeni oturum açık mfa_passed=0, audit fail {count, revokedSessions}, e-posta), `:86` (başkasının id'si / olmayan / biçimsiz → hiçbir şey silinmez), `:108` (paralel aynı nesil)                                                                                      |

## Düzeltilmeli

1. [backend-dev] `apps/server/test/helpers/tenant-matrix.ts:18-36` (ROUTE_CLASSES) — P27a'nın 3 profil ucu sınıfsız,
   `tenant-isolation.test.ts:21` deterministik kırmızı → `"GET /api/v1/auth/trusted-devices"`,
   `"DELETE /api/v1/auth/trusted-devices/:id"`, `"DELETE /api/v1/auth/trusted-devices"` satırlarını `"self"` sınıfıyla
   (`auth/me`, `logout-all` gibi, satır 24/29) ekle. (`/unattended/*` 12 uç P27 paketinin işi.)
2. [backend-dev] `apps/server/src/auth/account.ts` `enableTx` (≈ satır 124-160) — eşzamanlı ilk etkinleştirmelerde
   InnoDB deadlock → 503 `NOT_READY`; tam integration koşusunda `account-p10` AC-67, `p15-backend` AC-231 ×2,
   `security-p14a-auth` AC-215 (hatalı kod) kararsız kırmızı. P27a bu TX'e `deleteForUser` ekledi; AC-335 gerilemesiz
   yeşil ister → "diğer oturumları iptal" UPDATE'ini önce PK'ları seçip `id IN (...)` ile güncelleyecek biçimde
   (next-key/gap kilidi almadan) yeniden yaz ya da TX'i deadlock'ta (P2034/1213) bir kez yeniden dene; ardından
   `pnpm --filter @remote/server test:int` 3 ardışık koşuda 0 kırmızı olduğunu `implementation.md`'ye yaz.
3. [frontend-dev] `apps/web/components/form-error.tsx:12` — istek kimliği satırı `opacity-80` yüzünden `danger`
   zemininde axe `color-contrast` ihlali; AC-329 hata durumunda görünür → opaklığı kaldırıp DESIGN.md'deki uygun
   ön plan tokenını kullan; `apps/web/e2e/p27a-trusted-device.spec.ts:82` "boş durum ve hata" testine hata durumunda
   `axeScan(page, "[data-testid=acc-td]")` (açık + koyu) ekle, 0 ihlal beklensin.

## Definition of Done

| Madde                                 | ✅/❌ | Not                                                                                                                                           |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm AC'ler kanıtlı                    | ❌    | AC-335 ❌, AC-329 ⚠️                                                                                                                          |
| Testler yeşil (unit/integration/e2e)  | ❌    | unit + e2e yeşil; integration 4 kırmızı (1 deterministik P27a)                                                                                |
| Lint / typecheck / format             | ✅    | temiz                                                                                                                                         |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅    | `byTenant` purge, bileşik FK indeksi, repo ad birleştirme, `trusted-device.ts` ~350 satır — hepsi `implementation.md` P27a K1-K5'te gerekçeli |
| Katman/`any`/hata yutma/PII log       | ✅    | gizli değer yalnız `Set-Cookie`; log yalnız `userId` + `trustedDevice` türü; commit sonrası bildirim hataları loglanıyor, yutulmuyor          |
| Transaction                           | ✅    | oluşturma/döndürme/reuse/tüm iptal noktaları çağıranın TX'inde; kullanıcı satırı `FOR UPDATE`                                                 |
| Sayfasız liste                        | ✅    | liste `take: 10` (kullanıcı başına üst sınır)                                                                                                 |
| Audit log                             | ✅    | created/used/revoked(user/admin/limit)/reuse + toplu iptal satırlarında `revokedTrustedDevices`                                               |
| Frontend 5 durum + a11y               | ❌    | 5 durum var; hata durumunda kontrast ihlali (madde 3)                                                                                         |
| İkonlar / token / tema                | ✅    | `MonitorCheck`, `Laptop`, `Trash2`, `MonitorX`, `RotateCw` (lucide); ham renk/px yok; axe açık+koyu                                           |
| Yeni bağımlılık / env / grants        | ✅    | bağımlılık ve env yok; `grants.sql` + check-app-grants güncel                                                                                 |

## Öneriler (zorunlu değil)

- `consumeAtLogin` (`trusted-device.ts:224-252`): süresi dolmuş ama özeti tutmayan satır da "yeniden kullanım" sayılıp
  tüm cihazları siliyor. Spec'e aykırı değil (AC-335b "kaç nesil önce" der) ama süresi dolmuş satırı reuse dışında
  tutmak yanlış alarmı azaltır; güvenlikle birlikte değerlendirilebilir.
- `trusted-device.ts` 349 satır (hedef 300): bildirimler (`notify*`, `afterTrustedDeviceReuse`) ayrı dosyaya alınabilir.

## Olumlu

- Döndürme koşullu UPDATE + reuse aile iptali + paralel yarış testleri (AC-335b) eksiksiz; tek yol repo (T9) uygulanmış.
- AC-333 log/audit/mail/yanıt gövdesi sızıntı testi gerçek log yakalamasıyla yapılmış.
- Super Admin hariç tutması üç katmanda (politika, repo firmasız hata, UI) ve test edilmiş.
- grants 730/730; P27 migration'ı bu turda temiz uygulanıyor.

---

# QA Raporu — PT (kod temizliği) Tur 4

DURUM: GEÇTİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `e219894` (temiz) · Kapsam: yalnız Tur 3 "Düzeltilmeli" 1 (HEAD CI kanıtı). Kod
değişmedi, yerelde test koşulmadı, staging'e bağlanılmadı.

Özet: Tur 3'ün tek açık maddesi kapandı. Son kod değişikliğini (`64e6301`) içeren `90dfe1d` için `ci` ve `agent-win`
koşularının tüm işleri **success**. Bu işler arasında Tur 3'te iptal olan `test (MySQL 8.4)` ve `web e2e` de var.
`e219894` yalnız belge değiştiriyor. Onun koşuları rapor anında hâlâ sürüyordu (aşağıdaki birleştirme koşuluna bakın).

## Test sonucu (Tur 4)

| SHA              | `ci`                                                                                                                                                | `agent-win`                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `90dfe1d`        | 43729189569 **success**: lint + type-check, test (MySQL 8.4), web e2e (Playwright), build (+ Docker), audit + lisans + gitleaks, coturn, shellcheck | 43729189584 **success**: gofmt + vet + test -race + govulncheck, go test (Windows), build 1/2 ve 2/2, tekrarlanabilirlik. SignPath, ONAY, attestation, Release: skipped (PR'da beklenen) |
| `e219894` (HEAD) | 43729991671 rapor anında **in_progress**                                                                                                            | 43729991799 rapor anında **in_progress**                                                                                                                                                 |

`git diff 90dfe1d e219894` `docs/` dışında boş, yani kod `90dfe1d` ile aynı. `e219894`'ün değiştirdiği iki belge
(`docs/qa-raporu.md`, `docs/temizlik/sonuc.md`) yerelde `prettier --check` ile temiz. Bu yüzden `e219894` CI'ında
format kaynaklı bir kırılma beklenmiyor.

## Tur 3 maddesinin durumu

| Tur 3 maddesi                     | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — HEAD `ci` + `agent-win` yeşil | ✅    | `gh run view` ile iş bazında doğrulandı: 43729189569 ve 43729189584, headSha `90dfe1d`. `sonuc.md:322-325` Kalan iş 8 bu numaraları ve sonuçları doğru yazıyor. `259a6f0` ci 43728760018 "cancelled (yeni push)" olarak düzeltildi. Seçim yazılmış: kanıt `90dfe1d`'ye bağlanır, belge commit'inin CI'ı birleştirmeden önce yeşil görülür |

## Kabul kriterleri

| AC             | Durum | Kanıt veya eksik                                                     |
| -------------- | ----- | -------------------------------------------------------------------- |
| AC-317..AC-324 | ✅    | Tur 2-3'teki gibi. Artık CI kanıtı da var (`90dfe1d` ci + agent-win) |

## Düzeltilmeli

Yok.

Birleştirme koşulu (madde değil, `sonuc.md`'deki kendi taahhüdü): `e219894` ci 43729991671 ve agent-win 43729991799
`main`'e birleştirmeden önce success görülmeli. Kırmızı biterse kod aynı olduğu için R-PT8 (kararsız test
karşılaştırması) uygulanır.

## Definition of Done (Tur 4)

| Madde                                         | ✅/❌ | Not                                                        |
| --------------------------------------------- | ----- | ---------------------------------------------------------- |
| Lint / typecheck / format temiz               | ✅    | `90dfe1d` ci lint + type-check success                     |
| Unit + entegrasyon testleri yeşil             | ✅    | `90dfe1d` ci test (MySQL 8.4) success                      |
| Go test + vet + staticcheck (linux + windows) | ✅    | `90dfe1d` agent-win success (go test Windows dahil)        |
| e2e (Playwright) yeşil                        | ✅    | `90dfe1d` ci web e2e success                               |
| Güvenlik taraması (audit, gitleaks, lisans)   | ✅    | `90dfe1d` ci audit + lisans + gitleaks success             |
| Belgeler güncel ve tutarlı                    | ✅    | `sonuc.md` Kalan iş 8, `implementation.md` PT bölümü       |
| K8 Windows elle testi                         | ✅    | Kapsam dışı: istemci yayın kapısı (K-PT-4), PT'yi bağlamaz |

## Öneriler (zorunlu değil)

- `sonuc.md` "Test koşuları" tablosu hâlâ yalnız `e280551` koşusunu gösteriyor. `90dfe1d` numaraları yalnız Kalan iş
  8'de var. Bir sonraki belge düzenlemesinde tabloya da eklenebilir.

## Olumlu

- Tur 3'teki "kapanmamış işi kapalı gösterme" sorunu düzeltildi. Üstü çizili gösterim artık gerçek yeşil koşulara
  dayanıyor.

---

# QA Raporu — PT (kod temizliği) Tur 3

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `90dfe1d` (temiz) · Kapsam: yalnız Tur 2 "Düzeltilmeli" 1–2. Kod değişmedi
(`90dfe1d` yalnız `docs/`), test yerelde koşulmadı. Staging'e bağlanılmadı, ACCESS.txt okunmadı.

Özet: Belge maddesi (Tur 2 Düzeltilmeli 1) tam kapandı. Kalan tek engel CI kanıtı. `259a6f0`'ın `ci` koşusu yeşil
bitmedi, **iptal edildi** (`90dfe1d` itilince eşzamanlılık grubu yüzünden). İptal olan işler `test (MySQL 8.4)` ve
`web e2e`. Yani `64e6301` kod düzeltmesi için CI'da henüz bir test sonucu yok. HEAD `90dfe1d` koşuları rapor anında
sürüyordu.

## Test sonucu (Tur 3)

| SHA              | `ci`                                                                                                                                                                                                                               | `agent-win`                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `e280551`        | 43727719947 **success**                                                                                                                                                                                                            | 43727719960 **success**               |
| `259a6f0`        | 43728760018 **cancelled**: lint+type, build, audit/gitleaks, coturn, shellcheck success. **`test (MySQL 8.4)` ve `web e2e (Playwright)` cancelled.** Neden: aynı dalda `90dfe1d` itildi, eşzamanlılık grubu eski koşuyu iptal etti | 43728760055 **success**               |
| `90dfe1d` (HEAD) | 43729189569 rapor anında **queued**: bekliyor                                                                                                                                                                                      | 43729189584 **in_progress**: bekliyor |

Yerelde test koşulmadı. Tur 2'deki server unit 435/435 ve mutasyon sağlaması (`64e6301`) geçerliliğini koruyor:
`90dfe1d` yalnız belgedir (`git show --stat`: `gereksinimler.md`, `implementation.md`, `mimari-temizlik.md`,
`qa-raporu.md`, `temizlik/sonuc.md`).

## Tur 2 maddelerinin durumu

| Tur 2 maddesi                                              | Durum | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — `sonuc.md` / `implementation.md` eski durum satırları  | ✅    | `sonuc.md:8-12` durum notu: AC-317..324 GEÇTİ, K8 = yayın kapısı (K-PT-4), `64e6301` PT ölçümü dışında. Özet tablo `:22` AC-317 "GEÇTİ (K18 istisnası)", `:29` AC-324 "GEÇTİ (gerekçeli sapma)". `:276-280` K18 paragrafı "§5 K18 satırı ve §1-2 test istisnası eklendi". `:295` Elle test satırında "istemci yayın kapısı (K-PT-4)". Kalan iş 7-8 güncel. Test koşuları e2e hücresi CI `e280551` (43727719947). `implementation.md:8994` Elle test, `:9005` K18 "eklendi", `:9008` AC-322 "revize edildi (K-PT-3), GEÇTİ". `mimari-temizlik.md:294-297` ve `gereksinimler.md` K-PT-3: 6 gövde, `login` ×2. Eski ifadeler için grep ("ekleniyor", "QA Düzeltilmeli 6", "PT kapanış koşulu", "karar mimar") PT bölümlerinde sonuç vermedi |
| 2 — HEAD `ci` + `agent-win` yeşil, numaralar `sonuc.md`'de | ❌    | `259a6f0` ci iptal oldu, `90dfe1d` ci/agent-win sürüyor. `sonuc.md:322-323` Kalan iş 8'in üstü çizilmiş ("~~HEAD CI~~") ama metni "ci koşusu … yeniden doğrulanır" diyor. Yani kapanmamış bir iş kapalı gösteriliyor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Kabul kriterleri

| AC             | Durum | Kanıt veya eksik                                                                                                       |
| -------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-317..AC-323 | ✅    | Tur 2'de olduğu gibi, değişiklik yok                                                                                   |
| AC-324         | ✅    | Kapanış raporu artık kendi içinde tutarlı (Tur 2 Düzeltilmeli 1 kapandı). §5 tam, `implementation.md` PT bölümü güncel |

## Düzeltilmeli

1. **[devops]** HEAD'in (`90dfe1d` ya da sonraki SHA) `ci` (43729189569) ve `agent-win` (43729189584) koşuları
   **success** bitmeli. Özellikle `test (MySQL 8.4)` ve `web e2e` işleri, çünkü `64e6301` bu işlerden hiç geçmedi.
   Koşular bittikten sonra:
   - `sonuc.md` "Kalan iş" 8'e ve "Test koşuları" tablosuna HEAD koşu numaralarını ve sonucunu yaz.
   - `259a6f0` ci 43728760018'i "cancelled (yerine geçen koşu: …)" olarak düzelt.
   - Üstü çizili gösterimi ancak koşular yeşil olunca bırak.

   Kırmızı biterse R-PT8 uygulanır: 3 tekrar ve kararsız test listesiyle (Kararsız-1..3) karşılaştırma. Yalnız bu
   belge commit'ini itmek yeni bir koşu başlatır ve süren koşuyu iptal eder. Bu yüzden ya sonuçlar belgeye yazılıp
   **yeni koşu da yeşil** bitmeli, ya da sonuç numaraları bir sonraki ilgisiz commit'e bırakılmalı. Hangisinin
   seçildiği `sonuc.md`'de belirtilmeli.

## Definition of Done (Tur 3)

| Madde                                              | ✅/❌ | Not                                                                      |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| Lint / typecheck / format temiz                    | ✅    | Tur 1-2. `259a6f0` ci lint+type success                                  |
| Unit + entegrasyon testleri yeşil                  | ✅    | Yerelde Tur 1-2 (435/435 + entegrasyon 796). CI kanıtı aşağıdaki satırda |
| Go test + vet + staticcheck (linux + windows)      | ✅    | `259a6f0` agent-win success                                              |
| e2e (Playwright) yeşil                             | ✅    | `e280551` ci success. `64e6301`/`90dfe1d` web'e dokunmuyor               |
| HEAD CI yeşil                                      | ❌    | `259a6f0` ci cancelled, `90dfe1d` bekliyor. Düzeltilmeli 1               |
| Her AC ✅                                          | ✅    | AC-317..324                                                              |
| Tasarım ↔ kod uyumu, sapmalar gerekçeli            | ✅    | K-PT-3/4, §5 K18                                                         |
| Davranış değişmedi / bilinçli düzeltme ayrı commit | ✅    | `64e6301`                                                                |
| Yeni bağımlılık yok                                | ✅    | `90dfe1d` yalnız belge                                                   |
| `implementation.md` kaydı / PT bulguları           | ✅    | Güncel                                                                   |

## Olumlu

- Tur 2'deki belge düzeltmesinin tüm alt maddeleri, isteğe bağlı K-PT-3 "6 gövde + `login` ×2" dahil, beş belgede
  tutarlı işlendi. Grep ile kalan eski ifade bulunmadı.
- `64e6301` PT ölçümünün dışında tutuldu ve bu açıkça yazıldı (434 → 435).

---

# QA Raporu — PT (kod temizliği) Tur 2

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `259a6f0` (temiz) · Kapsam: yalnız Tur 1 "Düzeltilmeli" 1–6 ve `64e6301`
(`fix(jobs)` PT-K11-B1). Baştan tam denetim yapılmadı. Kod değiştirilmedi, staging'e bağlanılmadı, ACCESS.txt okunmadı.

Özet: Tur 1'in esas maddeleri kapandı. AC-317 için K18 istisnası, AC-322 revizyonu (K-PT-3), §5 K18 satırı,
`implementation.md` PT bölümü ve K8 kararı (K-PT-4) yazıldı. `64e6301` düzeltmesi doğru ve regresyon testi gerçekten
koruyor: test eski kodda kırmızı, yeni kodda yeşil. DÜZELTİLMELİ kararının iki nedeni var. (1) Aynı commit'te güncellenen
`sonuc.md` ve `implementation.md`'de, yeni kararlarla çelişen eski durum satırları kalmış. Örneğin K8 testi bir yerde
"PT kapanış koşulu", K-PT-4'te "PT'yi engellemez" diye geçiyor. (2) HEAD'in CI koşusu denetim sırasında bitmedi.
Kalan iş yalnız belge ve CI kanıtı. Kod tarafında açık bulgu yok.

## Test sonucu (Tur 2)

| Komut                                                                                      | Sonuç                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @remote/server exec vitest run test/unit/scheduler.test.ts`                 | 4/4 geçti                                                                                                                                                                                                                                                                             |
| Mutasyon sağlaması: scratch worktree'de `64e6301` testleri + `e280551`'in `scheduler.ts`'i | yeni test **kırmızı**: `expected "vi.fn()" to be called 1 times, but got 2 times` (`scheduler.test.ts:90`). Diğer 3 test yeşil. Worktree kaldırıldı                                                                                                                                   |
| `pnpm --filter @remote/server run test` (unit)                                             | 30 dosya, **435/435**. 434'e eklenen tek test PT-K11-B1. PT dışı `fix:` olarak belgelenmiş (sonuc.md, PT liste karşılaştırması `e280551`'e göre)                                                                                                                                      |
| server `typecheck` / `lint`, kök `pnpm format:check`                                       | temiz / temiz / temiz                                                                                                                                                                                                                                                                 |
| GitHub `e280551` (PT'nin son commit'i)                                                     | `ci` 43727719947 **success**: lint/type, test MySQL 8.4, web e2e Playwright, build, audit/gitleaks, coturn, shellcheck. `agent-win` 43727719960 **success**: go test Windows, `-race`/vet/govulncheck, build, SHA256SUMS. Yalnız etiketle çalışan yayın işleri tasarım gereği atlandı |
| GitHub HEAD `259a6f0` (`64e6301` dahil)                                                    | `agent-win` 43728760055 **success** (son kontrol). `ci` 43728760018 rapor anında **in_progress**                                                                                                                                                                                      |

Entegrasyon, e2e ve Go yerelde yeniden koşulmadı. `64e6301` yalnız `scheduler.ts` ile unit testine dokunuyor; Tur 2'deki
belge commit'i kod içermiyor.

## Tur 1 maddelerinin durumu

| Tur 1 maddesi                                           | Durum | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. §5 K18 satırı, §1-2 test istisnası, AC-317 revizyonu | ✅    | `mimari-temizlik.md:21-25` istisna (yalnız K18; yeni ad yok, assertion silinmez). `:207` K18 satırında dosya listesi `e280551`/`1374d99` ile uyumlu. `gereksinimler.md` AC-317 altında tarihli _Revizyon_ var.                                                                                                                                                                                                                           |
| 2. AC-322 (`boot`/`signIn` yerel)                       | ✅    | Yol (a) seçilmiş: AC-322 _Revizyon_ ve K-PT-3 (`mimari-temizlik.md:294`). QA grep'i: `boot` 7 dosya. `requests-p8b-5` ile `customers-p8c-api` gövdeleri metin olarak aynı, ama her biri kendi dosyasının `live` değişkenine atıyor; revizyon bunu açıkça gerekçe sayıyor. Küçük yanlışlık: K-PT-3 "5 farklı gövde" diyor, metin olarak 6 farklı gövde var. K-PT-3'te `login` ×2 geçmiyor (gereksinimler'de geçiyor). Öneri, engel değil. |
| 3. `sonuc.md` tutarlılığı                               | ⚠️    | Kapananlar: Go sayısı tek yöntemle 397/423, 398/424/458'in kaynağı açıklandı, baseline.md düzeltildi. Başlık `e280551`/33 commit. Test koşuları tablosu güncel. > 300 dosya dosya dosya teyit edildi (`sonuc.md:165-182`). K1 ignore ve K18 sapma listesinde. **Kalan:** durum notu ve özet tabloda eski "açık" ifadeleri duruyor (Düzeltilmeli 1).                                                                                      |
| 4. `implementation.md` PT bölümü                        | ⚠️    | Bölüm var (görev notları, bulgular, sapmalar, `docs/temizlik/` gerekçesi). PT-K11-B1 "kapandı" olarak işaretli. **Kalan:** üç satırda eski durum yazıyor (Düzeltilmeli 1).                                                                                                                                                                                                                                                               |
| 5. HEAD için CI yeşil                                   | ⚠️    | `e280551` için `ci` ve `agent-win` tamamen yeşil; bu, Tur 1'in istediği SHA'ydı. HEAD `259a6f0` `64e6301` kod değişikliğini içeriyor ve koşusu sürüyor. Koşu bağlantıları sonuc.md'ye yazılmamış (Düzeltilmeli 2).                                                                                                                                                                                                                       |
| 6. K8 Windows elle testi                                | ✅    | K-PT-4 (`mimari-temizlik.md:299-302`, mimar kararı): test PT birleştirmesini değil, bir sonraki istemci sürümünün yayınını engeller. Gerekçe: staging deploy'u exe yayınlamıyor. Takip satırı `docs/test-raporu.md` "PT — Windows elle duman testi" (sonuç sütunu boş, bekliyor). QA bu kararı kabul eder.                                                                                                                               |
| PT-K11-B1 (`64e6301`)                                   | ✅    | `TimedJob.stoppable` kaldırıldı. `startTimedJob.arm` her işte `isStopped()` denetliyor. Aralık, ilk tetik ve log davranışı aynı. Regresyon testi sürmekte olan saklama turunda `stop()` ve `release()` sonrası 3 gün ilerletiyor: `run` 1 kez çağrılıyor, `getTimerCount() === 0`. Mutasyonla kanıtlandı (eski kodda 2 kez). PT-K11.md'deki "P27/P28 sınırları" `stoppable`'sız güncellendi.                                             |

## Kabul kriterleri (Tur 2)

| AC     | Durum | Kanıt veya eksik                                                                                                                                                                                                                                        |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-317 | ✅    | Revize metne göre: test adları ve sayıları `e280551`'de baseline'la aynı (Tur 1: 1230/386/142, Go 397/423). K18 gövde eklemeleri istisna kapsamında. `e280551` CI e2e ve Go Windows yeşil. 435. test PT sonrası `fix:` ve ayrıca belgelenmiş.           |
| AC-318 | ✅    | Tur 1, değişiklik yok.                                                                                                                                                                                                                                  |
| AC-319 | ✅    | Tur 1'deki tek engel yöntemin kabulüydü; §1-2 istisnası ve AC-317 revizyonu bunu çözdü. Sayılar `sonuc.md`'den alındı; QA kapsamı yeniden ölçmedi.                                                                                                      |
| AC-320 | ✅    | Tur 1 + `sonuc.md` dosya dosya > 300 teyidi.                                                                                                                                                                                                            |
| AC-321 | ✅    | Tur 1, değişiklik yok.                                                                                                                                                                                                                                  |
| AC-322 | ✅    | Revize metne göre (K-PT-3). Klon hedefleri 2/16.                                                                                                                                                                                                        |
| AC-323 | ✅    | Tur 1 + Tur 2 server lint/typecheck/format.                                                                                                                                                                                                             |
| AC-324 | ⚠️    | Gereken belgeler var (§5 tam, `implementation.md` "PT bulguları", kapanış raporu). Ancak kapanış raporunun özet tablosu AC-317'yi hâlâ "belge ⚠️", AC-324'ü "K18 §5 satırı ⚠️" gösteriyor. "Tüm AC'leri gösteren kapanış raporu" kendi içinde tutarsız. |

## Düzeltilmeli

1. **[devops]** Belge durum satırlarını `259a6f0`'daki kararlara göre güncelle. Yalnız metin değişikliği; sayılar doğru.
   - `docs/temizlik/sonuc.md:8-14` durum notu: "Açık kalanlar: AC-317 ve AC-324 için K18 test istisnası ve §5 K18 satırı …; AC-322 … (mimar kararı …)" yazıyor. Bunlar yapıldı. Açık kalan yalnız HEAD CI ve K8 yayın kapısı olmalı (K-PT-4).
   - `sonuc.md:25` AC-317 "belge ⚠️" → GEÇTİ (revize AC). `sonuc.md:32` AC-324 "K18 §5 satırı ⚠️" → "4 sapma, gerekçeli; GEÇTİ".
   - `sonuc.md:283-284` "§5'e K18 satırı … mimar tarafından ekleniyor … o güncelleme girene kadar AC-317 ve AC-324 ⚠️" → "eklendi (`mimari-temizlik.md` §1-2, §5)".
   - `sonuc.md:326-327` ("Kalan iş" 7): K8 için "QA Düzeltilmeli 6" yerine "istemci yayın kapısı (K-PT-4), PT'yi engellemez" yaz. `sonuc.md` "PT bulguları" tablosundaki "Elle test" satırına da aynı notu ekle.
   - `docs/implementation.md` "Gerekçeli sapmalar" K18 satırı: "§5 K18 satırı ve §1-2 test istisnası mimar tarafından ekleniyor (QA Düzeltilmeli 1)" → "eklendi". AC-322 satırı: "AC metniyle çelişiyor, karar mimar → proje-yoneticisinde" → "AC revize edildi (K-PT-3)". "PT bulguları" tablosundaki "Elle test" satırı: "PT kapanış koşulu (QA Düzeltilmeli 6)" → "istemci yayın kapısı (K-PT-4), `docs/test-raporu.md`".
   - (isteğe bağlı) `mimari-temizlik.md` K-PT-3: "5 farklı gövde" → 6 (metin olarak; ya da "`live` ataması nedeniyle hepsi dosyaya bağlı"); `login` ×2'yi gereksinimlerdeki gibi ekle.
2. **[devops]** HEAD'in (`259a6f0` ya da Düzeltilmeli 1'den sonraki SHA) `ci` ve `agent-win` koşuları **yeşil** bitmeli. Koşu numaraları ve sonuçları `sonuc.md` "Test koşuları" tablosuna yazılmalı. `e280551` için: `ci` 43727719947 ve `agent-win` 43727719960, ikisi de success. Kırmızı biterse R-PT8 (3 tekrar, kararsız test listesiyle karşılaştırma) uygulanmalı.

## Definition of Done (Tur 2)

| Madde                                                     | ✅/❌ | Not                                                                               |
| --------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| Lint / typecheck / format temiz                           | ✅    | Tur 1 tümü + Tur 2 server ve format                                               |
| Unit + entegrasyon testleri yeşil                         | ✅    | Tur 1 + server unit 435/435 (`64e6301` dahil)                                     |
| Go test + vet + staticcheck (linux + windows)             | ✅    | Tur 1 + `e280551` agent-win (Windows go test, `-race`) success                    |
| e2e (Playwright) yeşil                                    | ✅    | `e280551` ci "web e2e (Playwright, mock API)" success. `64e6301` web'e dokunmuyor |
| HEAD CI yeşil                                             | ❌    | `259a6f0` agent-win success, ci sürüyor — Düzeltilmeli 2                          |
| Her AC ✅                                                 | ❌    | AC-324 ⚠️ (kapanış raporunda tutarsız durum) — Düzeltilmeli 1                     |
| Tasarım ↔ kod uyumu (dosya sahipliği, sapmalar gerekçeli) | ✅    | §5 K18 satırı, K1 ignore notu, K-PT-3/4                                           |
| Davranış değişmedi (PT) / bilinçli düzeltme ayrı commit   | ✅    | `64e6301` ayrı `fix:` commit'i, belgelenmiş, regresyon testli                     |
| Yeni bağımlılık yok                                       | ✅    | `64e6301`/`259a6f0` paket dosyalarına dokunmuyor                                  |
| `implementation.md` kaydı / PT bulguları                  | ✅    | Bölüm var; eski durum satırları Düzeltilmeli 1'de                                 |

## Olumlu

- PT-K11-B1 düzeltmesi en küçük doğru değişiklik: bayrak kaldırıldı ve dört iş tek kurala bağlandı. Test sahte
  zamanlayıcıyla sürmekte olan tur senaryosunu tam kuruyor. Ayrıca bekleyen zamanlayıcı kalmadığını
  (`getTimerCount() === 0`) da doğruluyor.
- Go test sayısı çelişkisinin kökü (Benchmark ve derleyici kapanışları) belgelendi; baseline da aynı yöntemle düzeltildi.
- K8 için verilen karar (yayın kapısı) somut bir takip satırına bağlandı. Belirsiz bir "sonra" olarak bırakılmadı.

---

# Tur 1 (önceki tur, arşiv)

Tarih: 2026-11-15 · Dal `pt-wip` @ `e280551` (temiz) · Aralık `14b2629..pt-wip` (33 commit) · Denetçi: qa-denetci (kod değiştirilmedi)

Özet: Kod tarafı sağlam: lint, typecheck, format temiz. vitest unit, entegrasyon ve Go test/vet/staticcheck/deadcode yeşil.
Sözleşme diff'i yalnız K1. knip 0/0, jscpd 2/16 ve > 500 satırlık dosya sayısı bağımsız olarak doğrulandı. Test diff'inde
assertion silinmemiş, `skip`/`only` eklenmemiş, test adı değişmemiş. **Düzeltilmesi gerekenler davranışla ilgili değil.**
Üç AC'nin (317, 322, 324) yazılı metni karşılanmıyor ve tasarım belgesine işlenmemiş: K18 görevi §5'te yok, test
gövdelerine yeni senaryo eklenmiş ve dosya-yerel `boot`/`signIn` tanımları duruyor. Ayrıca `sonuc.md`'de çelişkili
satırlar var ve HEAD için CI kanıtı yok.

## Test sonucu

| Komut (QA tarafından koşuldu)                                                                                        | Sonuç                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r run lint`                                                                                                   | temiz (çıkış 0)                                                                                                                                              |
| `pnpm -r run typecheck`                                                                                              | temiz (çıkış 0)                                                                                                                                              |
| `pnpm format:check`                                                                                                  | temiz ("All matched files use Prettier code style")                                                                                                          |
| `pnpm -r run test` (unit)                                                                                            | contracts 142/142 (18 dosya), web 386/386 (43), server 434/434 (30)                                                                                          |
| server entegrasyon `vitest run test/integration` (kendi MySQL 8.4 konteynerim `rs-qa-pt-b13d72`, iş sonunda silindi) | **796/796** geçti, 0 skip                                                                                                                                    |
| Go `go test -count=1 ./...` (golang:1.26, linux)                                                                     | 21 paket ok                                                                                                                                                  |
| Go `go vet` linux / `GOOS=windows`                                                                                   | 0 / 0                                                                                                                                                        |
| Go `GOOS=windows go test` derlemesi (`-exec /bin/true`)                                                              | derlendi (çıkış 0)                                                                                                                                           |
| staticcheck v0.8.2 linux / windows                                                                                   | 0 / 0                                                                                                                                                        |
| deadcode v0.52.0 `-test` windows                                                                                     | 0                                                                                                                                                            |
| `scripts/pt-olcum.sh <scratch> knip jscpd boyut fonk i18n`                                                           | knip server/web export ve tip anahtarı yok (= 0); jscpd üretim 2 / toplam 16; > 500 üretim 0+0+1+2 = 3; i18n ölü aday 8 (dinamik `us.r/us.m`)                |
| Playwright e2e tam koşu                                                                                              | **yapılmadı** (tur sınırı; geliştiricinin raporladığı 443/0 bağımsız doğrulanmadı)                                                                           |
| GitHub CI `ci` + `agent-win` (HEAD `e280551`)                                                                        | **bitmedi**: denetim sırasında `in_progress`. `440aa07` ikisi de success; `11dd81e` ve `1bb205f` `ci` failure (kararsız e2e olduğu söyleniyor, doğrulanmadı) |
| Go `go test -race`, kapsam yeniden ölçümü                                                                            | **yapılmadı** (kapsam sayıları `sonuc.md`'den alındı, bağımsız doğrulanmadı)                                                                                 |

Skip: unit ve entegrasyonda yok. e2e'de 200 "skipped" görülüyor (`desktopOnly` proje filtresi; baseline ile aynı tasarım).

## Kabul kriterleri

| AC     | Durum | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-317 | ⚠️    | **Doğrulanan:** vitest sayıları 1230 (434+796) / 386 / 142 = baseline. 71 test dosyası diff'inde `skip`/`only` eklenmemiş (tek `test.skip` satırı taşınan `desktopOnly` tanımı). `it`/`test`/`describe`/`func Test` adı eklenmemiş, silinmemiş (pt-surface baseline'da var). Azalan `expect` sayıları ortak yardımcılara taşınmış: örnekler `rejectsWith` → `helpers/db-grants.ts`, `newSession`/`scanBoth` → `e2e/helpers.ts`, Go `noCall`/`startAdmitted`/`expectServerParse`; okundu, gövdeler birebir. **Eksik 1:** K18 test dosyalarına fikstür dışı değişiklik yapmış. `scheduler.test.ts` "AC-5" testine outbox ve purge zamanlayıcı senaryosu, `lib/dc/p5.test.ts` ve `p5-teklif.test.ts`'e yeni iptal/dispose senaryoları, Go `signal_test`, `files_test`, `logo_test`'e yeni tablo satırları, `capture/select_test.go`'da sahte yapı değişikliği eklenmiş. AC metni "test dosyalarındaki değişiklik yalnız fikstür/yardımcı çağrısıdır" diyor; değişiklikler testi güçlendiriyor ama bu istisna kayıtlı değil (mimari §1-2, gereksinim). **Eksik 2:** Go liste sayısı: QA `go test -list . ./... \| grep -c ^Test` = **397**, sonuc.md 398. Windows sayısı sonuc.md içinde iki yerde farklı (424 ve 458). Yöntem farkı olabilir; uzlaştırılmadı. **Eksik 3:** HEAD için e2e ve CI kanıtı bağımsız değil. |
| AC-318 | ✅    | `git diff 14b2629..pt-wip -- apps/server/prisma packages/contracts/src .env.example deploy go.mod go.sum` yalnız K1 (`api/{customers,requests,sessions}.ts` + yeni `shared.ts`). `env.ts`'te tek `export` kaldırma, env kümesi aynı. `pt-surface` testleri entegrasyon (796) ve contracts (142) koşusunda yeşil. Döngü testi `[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AC-319 | ⚠️    | Kapsam QA tarafından yeniden ölçülmedi. `sonuc.md` K18 tablosu her paket için ≥ baseline gösteriyor. Ancak yükseliş, AC-317 ile çatışan test gövdesi eklemeleriyle elde edildi (bkz. AC-317 Eksik 1). Bu yöntemin kabulü mimar kararı gerektiriyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC-320 | ✅    | Bağımsız ölçüm: > 500 üretim dosyası 3 (contracts `api/requests.ts`, Go `win_windows.go`, `mf_windows.go`; izinli). web > 300 dosya 0, server 9, Go 9. §5 hedefleri ve 2 gerekçeli istisna (K6 `classify` cx 17, K9 `service.ts` 469) notlarda var. "Yeni > 300 dosya yok" iddiası sonuc.md'de "teyit edilmedi" diye işaretli; QA de dosya bazında teyit etmedi (bkz. Düzeltilmeli 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC-321 | ✅    | knip üretim export/tip 0/0 (QA ölçümü; yalnız test yardımcılarında 1+16 / 6+1 var, AC dışı). deadcode windows `-test` 0 (QA). `@types/smtp-server` kaldırılmış. i18n: 8 aday dinamik `us.r/us.m` öneki (sonuc.md gerekçesi).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AC-322 | ❌    | jscpd üretim 25 → 2, toplam 70 → 16 ✅. `desktopOnly` tek tanım ✅ (16+1 yerel tanım silinmiş, `e2e/helpers.ts:24`). **Karşılanmayan:** AC metni "sunucu entegrasyon testlerinde `signIn`/`boot`/`errorText`/`login` dosya-yerel tanımı kalmaz" diyor. Grep sonucu: `boot` **7 dosyada** (ör. `requests-p8b-3.test.ts:21`, `bindings-p20.test.ts:33`, `customers-csv-p19.test.ts:21`), `signIn` **2 dosyada** (`account-p10.test.ts:66`, `p15-backend.test.ts:52`). PT-K2.md gerekçe veriyor (gövde farkı) ama AC revize edilmemiş. sonuc.md özetteki "GEÇTİ" kararı bu maddede yanlış.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC-323 | ✅    | lint, typecheck, format (QA koşusu), go vet ve staticcheck linux + windows 0 (QA koşusu). staticcheck `agent-win.yml`'de (K16 `d49f4ee`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AC-324 | ⚠️    | QA'nın commit bazında sahiplik karşılaştırmasının (33 commit) sonuçları şöyle. (a) **K18'in §5'te satırı yok.** `e280551` ve `1374d99` K10, K11, K13, K14 ve K15'e ait 24 üretim dosyasına ve K2/K3 dışındaki test dosyalarına dokunuyor. Değişiklikler sıralı, eşzamanlı çakışma yok; ama mimari §6'daki "durur, mimara döner, tabloya işlenir" adımı yapılmamış. `PT-K18.md` ve `implementation.md` kaydı da yok. (b) K1 (`c661ea0`) `.gitignore` ve `.prettierignore`'a dokunmuş (graphify-out). Liste dışı, sonuc.md sapma listesinde yok. (c) "PT bulguları" AC'nin istediği `docs/implementation.md` yerine `docs/temizlik/PT-Kn.md` ve `sonuc.md`'de. `implementation.md`'de yalnız PT-K0/K1 başlığı var; gerekçe yalnız PT-K9.md'de ("koordinatör talimatı"). (d) Kalan liste dışı dosyalar `DESIGN.md` (K13, K15c) ve `gereksinimler.md` (K0 AC-321 revizyonu); bunlar gerekçeli.                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Düzeltilmeli

1. **[mimar]** `docs/mimari-temizlik.md` §5: **PT-K18** satırını ekle. İçerik: dosya listesi (`e280551` ve `1374d99` diff'i), ajan, iş ("knip kalanı export kaldırma + kapsam telafisi"). §1-2'ye de K18 test istisnasını yaz: mevcut `it`/`Test` gövdelerine assertion ve senaryo eklemek serbest; yeni ad yok, mevcut assertion'a dokunulmaz. `docs/gereksinimler.md` §10 AC-317'ye AC-321'deki gibi tarihli bir _Revizyon_ notu ekle (AC-319 ile çatışmanın çözümü). Bu iki belge güncellenmeden AC-317 ve AC-324 ✅ olamaz.
2. **[mimar → proje-yoneticisi]** AC-322 karşılanmıyor. `boot` 7 dosyada ve `signIn` 2 dosyada (`account-p10`, `p15-backend`) dosya-yerel olarak duruyor. İki yol var, biri seçilmeli:
   - (a) AC-322'ye revizyon notu: "gövdesi farklı olanlar yerinde kalır, gerekçe PT-K2.md". Bu yalnız belge değişikliği.
   - (b) [backend-dev] bu tanımları parametreli ortak yardımcıya taşı; davranış ve assertion aynı kalmalı.
3. **[devops]** `docs/temizlik/sonuc.md` K18 sonrası tutarlı hale getirilmeli:
   - AC-323 tablosu ve "Test koşuları" tablosunda lint, typecheck, format, e2e ve `-race` için "yapılmadı" yazıyor; üstteki durum notu ise koşulduklarını söylüyor. Tablolar güncellenmeli.
   - AC-317 tablosunda Go windows 424, Go bölümünde 458 yazıyor. Tek sayıya ve tek yönteme indirilmeli. QA'nın linux `go test -list` sayımı 397, belgedeki 398; fark açıklanmalı.
   - Başlıktaki "Ölçülen kod `440aa07`" ve AC-324'teki "28 commit" `e280551` / 33 commit olarak güncellenmeli.
   - AC-324 sapma listesine K1'in `.gitignore` ve `.prettierignore` değişikliği ile K18 eklenmeli.
   - AC-322 satırındaki "dosya-yerel tanımlar kaldırıldı / grep yapılmadı" ifadesi gerçek durumla değiştirilmeli (bkz. madde 2).
   - AC-320'deki "yeni > 300 dosya yok" iddiası baseline `liste300` ile dosya dosya teyit edilip sonuç yazılmalı.
4. **[devops]** `docs/implementation.md` sonuna "PT bulguları ve görev notları" başlığı ekle. İçerik: `docs/temizlik/PT-K2..K18.md` ve `sonuc.md` bağlantıları, açık bulgular (PT-K11-B1, PT-K15c-B1) ve notların neden burada değil `docs/temizlik/` altında tutulduğunun gerekçesi (koordinatör kararı). AC-324 bunu istiyor.
5. **[devops]** HEAD `e280551` için GitHub `ci` (lint, typecheck, unit, entegrasyon, Playwright desktop + mobile) ve `agent-win` (Windows test + staticcheck) koşuları **yeşil** bitmeli. Koşu bağlantıları sonuc.md'ye yazılmalı. Kırmızı biterse kararsız test listesiyle karşılaştırılıp 3 tekrar kuralı (R-PT8) uygulanmalı.
6. **[test-operatoru]** PT-K8 Windows elle duman testi (PT-K8.md A–H grupları: `--tray`, ikinci örnek, tepsi, çoklu firma ana ekranı, talep formu ve bekleme, logo/tema, kod oturumu). R-PT2 gereği K8 Windows UI'ı otomatik testsiz böldü. PT kapanmadan, en geç P27 kodu başlamadan önce yapılmalı; sonuç `docs/test-raporu.md`'ye yazılmalı.

## Definition of Done

| Madde                                                        | ✅/❌ | Not                                                                                                                 |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / format temiz                              | ✅    | QA koşusu                                                                                                           |
| Unit + entegrasyon testleri yeşil                            | ✅    | 142 / 386 / 434 + 796                                                                                               |
| Go test + vet + staticcheck (linux + windows)                | ✅    | QA koşusu (Windows için yalnız derleme; çalıştırma CI'da)                                                           |
| e2e (Playwright desktop + mobile) yeşil                      | ❌    | HEAD için bağımsız kanıt yok (QA koşmadı, CI bitmedi) — madde 5                                                     |
| Her AC ✅                                                    | ❌    | AC-322 ❌; AC-317, 319, 324 ⚠️                                                                                      |
| Tasarım ↔ kod uyumu (dosya sahipliği, sapmalar gerekçeli)    | ❌    | K18 §5'te yok; K1 `.gitignore` belgelenmemiş — madde 1, 3                                                           |
| Davranış değişmedi (mekanik dönüşüm)                         | ✅    | Örneklenen diff'ler ve güvenlik PT turu GEÇTİ (`docs/guvenlik-raporu.md`); sözleşme ve rota anlık görüntüleri yeşil |
| Yeni bağımlılık yok (yalnız PT-D1 `@vitest/coverage-v8` MIT) | ✅    | `@types/smtp-server` kaldırıldı; `go.mod`/`go.sum` diff boş                                                         |
| `implementation.md` kaydı / PT bulguları                     | ❌    | Madde 4                                                                                                             |
| Gizli bilgi, `any`, hata yutma, PII log yeni eklenmedi       | ✅    | Diff taramasında bulgu yok (mekanik bölme; örneklem incelemesi)                                                     |

## Açık konular — nereye işlenmeli (öneri)

| Konu                                                                                                                                       | Öneri                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PT-K11-B1 (`scheduler` saklama işi `stop()` sonrası yeniden kuruluyor, Düşük)                                                              | `gereksinimler.md` §9 "Sonra" tablosuna satır (atanan backend-dev, `fix:`). P27 gözetimsiz erişimde uzun yaşayan süreç olduğu için P27 öncesi kapatılması önerilir.                                                      |
| PT-K15c-B1 (`ConsentForm` 400 `body` hatasında odak etkisiz, a11y)                                                                         | §9 "Sonra" (frontend-dev `fix:`); a11y kalemi olduğu için bir sonraki test-operatoru taramasında kontrol edilmeli.                                                                                                       |
| Kararsız testler: `p13bl-lobby` AC-305 (1/6), `p5-collab` TEST-P5-1, `customers-csv-p19` AC-263 (33–35 sn)                                 | `docs/test-raporu.md` "Kararsız testler" bölümü + §9 "Sonra" tek satır "test kararlılığı işi". AC-305 CI'ı kırdığı (`11dd81e`, `1bb205f`) için öncelikli. AC-263 için eşik ya da CI makinesi kararı proje-yoneticisinde. |
| K8 Windows elle duman testi                                                                                                                | Sonra'ya **değil**: PT kapanış koşulu (Düzeltilmeli 6).                                                                                                                                                                  |
| "Sonra" listeleri (server/web > 60 satır işlevler, `splitServerFields` ikizi, contracts `api/requests.ts` bölünmesi, knip CI kararı PT-D4) | §9 "Sonra (PT, 2026-11-15)" tek satır + `sonuc.md` bağlantısı. "Dokunan böler" kuralı (mimari §9) P27/P28 mimari turunda görev olarak yazılmalı.                                                                         |

## Öneriler (zorunlu değil)

- `scripts/pt-olcum.sh` testler adımına Go test listesi için yöntemi açıkça yazan bir alan eklenmeli (`-list` ile `nm` farkı). 397/398/424/458 karışıklığı buradan çıkıyor.
- Kapsam telafisi için testi adı verilen kritere bağlı tutun: `scheduler.test.ts` "AC-5" testi artık outbox ve purge senaryosunu da taşıyor. Sonraki pakette ayrı ve adı doğru bir test olarak bölünmesi izlenebilirliği artırır.

## Olumlu

- Sözleşme korkuluğu (K1 `pt-surface`: rota tablosu, ad kümesi, WS tipleri, hata kodları, döngü) gerçek bir güvence ağı. Geçici bozma ile sağlaması yapılmış.
- Ölçüm tekrarlanabilir: QA aynı betikle aynı knip, jscpd ve boyut sayılarını aldı.
- 71 test dosyasında assertion kaybı yok. Yardımcıya taşınan her assertion yeni yerinde birebir duruyor.
- Bulgular düzeltilmeden kaydedilmiş (R-PT9'a uyulmuş). Güvenlik PT turu Kritik/Yüksek/Orta/Düşük 0.
