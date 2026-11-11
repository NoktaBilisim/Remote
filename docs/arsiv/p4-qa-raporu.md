# QA Raporu — P4 (tarayıcı modu medya hattı) — Tur 3
DURUM: GEÇTİ

## Tur 3 — Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 paket temiz (contracts, server, web) |
| `pnpm -r run typecheck` | 3/3 paket `tsc --noEmit` temiz |
| `pnpm -r run test` | contracts 2 dosya / 24 test, server 9 / 78, web 7 / 44 — **146 geçti, 0 kaldı, 0 skip** |

Birim testlerinde `.skip/.only/.todo` yok. e2e'deki `test.skip`'ler Tur 2'deki ile aynı ve hepsi gerekçeli (proje adı `desktop`
koşulu, `E2E_REAL`/`E2E_REAL_LOGIN2` ortam bayrağı). e2e bu turda çalıştırılmadı; kapsam yalnız doküman + iki küçük güvenlik düzeltmesi.

## Tur 3 — QA-P4-13 (DESIGN.md) doğrulaması
| DESIGN.md iddiası | Kod kanıtı | Uyum |
|---|---|---|
| §6 `console/stage.tsx`: `stage-tools`, Sığdır `Expand`/`object-contain`, %100 `ScanSearch`/`max-w-none`, kaydırma kabı `overflow-auto`+`tabIndex=0`+`role=region`+`aria-label`, odak halkası içe | `components/console/stage.tsx:100-125` (`focus-visible:-outline-offset-2`, `stage-scroll`) | ✅ |
| Tam ekran `secondary`, `Maximize`/`Minimize`, `aria-pressed`, `requestFullscreen` + `fullscreenchange`; `data-mode`, `data-fullscreen` | `stage.tsx:53-58`, `:95-96`, `:128-130` | ✅ |
| §6 Konsol pasif "Uzaktan kontrol": `secondary`+`disabled`, `MousePointer2`, görünür `text-xs text-fg-muted` neden + `aria-describedby` | `app/(panel)/sessions/[id]/console/console-view.tsx:88-96` | ✅ |
| §6/§6.1 `Segmented` opsiyonel `icon` (aria-hidden, `size-4`, solda, `gap-1.5`), min 44 px | `components/ui/segmented.tsx` (`icon?: ReactNode`, `min-h-11`, `gap-1.5`); çağrı `stage.tsx:124-125` | ✅ |
| §6 "Bu cihaz desteklenmiyor": form yerine kart, `surface`+`border`+`shadow-sm`, `MonitorX` `text-fg-muted`, `role=status`, `aria-labelledby`, `guest-unsupported`, eylem düğmesi yok | `app/session/[token]/guest-welcome.tsx:112-125` | ✅ |
| §6 "Paylaşım başlatılmadı": `Alert tone=danger` `share-denied`, kalın başlık, `secondary` Tekrar dene `RotateCw`, `loading`'de ikon gizli; desteklenmiyorsa düğmesiz `danger` | `app/session/[token]/guest-session.tsx:103-112` | ✅ |
| §6.1 `ui/segmented.tsx` ve `console/stage.tsx` satırları "yazıldı / ikonlu, P4" | DESIGN.md:104, :109 | ✅ |

QA-P4-13 **kapandı**. DESIGN.md anlatımı kodla birebir; yeni token veya ham renk/px eklenmemiş.

## Tur 3 — Güvenlik düşük bulgularının kapanışı (QA gözüyle)
- `packages/contracts/src/api/sessions.ts:107` `UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}͏᠎]/u` — Unicode kategorili; `packages/contracts/test/sessions.test.ts` (yeni, 4 test) suite'e dahil ve yeşil.
- `E2E_REAL_ALLOW=1` bayrağı `apps/server/scripts/e2e-real-users.ts`, `apps/web/playwright.real.config.ts`, `apps/web/package.json` ve `docs/implementation.md`'de tutarlı. Kesin kapanış kararı güvenlik raporunda.

## Tur 3 — Kabul kriterleri
Tur 2 tablosu (aşağıda) geçerli: tüm P4 AC'leri ✅. Bu turda kodda davranış değişikliği yalnız ad doğrulamasında (daha sıkı) ve testlerle kanıtlı; AC durumunu değiştiren bir şey yok.

## Tur 3 — Düzeltilmeli
Yok.

## Tur 3 — Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck / birim test yeşil | ✅ | 146/146 |
| Tüm AC kanıtlı | ✅ | Tur 2 tablosu |
| DESIGN.md güncel | ✅ | QA-P4-13 kapandı |
| Diğer DoD maddeleri | ✅ | Tur 2'den değişmedi |

## Tur 3 — Öneriler (zorunlu değil)
- e2e (`pnpm --filter @remote/web e2e`) paket kapanışında test-operatoru aşamasıyla birlikte bir kez daha koşulsun; bu tur kod değişikliği UI'ya dokunmadığı için engelleyici değil.

---

# Tur 2 (arşiv) — DURUM o turda: DÜZELTİLMELİ (QA-P4-13)

Tarih: 2026-11-11 · Denetçi: qa-denetci (kod değiştirmedi). Tur 1 bulguları aşağıda "Tur 1" başlığı altında değiştirilmeden duruyor.

## Tur 2 — Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 2/2, web **44/44**, server **78/78** |
| server `test:int` (test-db.sh up → test → down) | **103/103** (17 dosya); konteyner silindi |
| `pnpm --filter @remote/web e2e` (mock) | **116 geçti, 8 atlandı, 0 hata**. Atlananların 8'i de `mobile` projesinde, masaüstüne özel akışların kopyaları (`test.skip` gerekçeli: "konsol masaüstü akışı"; mobil müşteri AC-33 gereği lobiye giremiyor). Kabul edildi |
| `pnpm audit --audit-level high` | "No known vulnerabilities found" |
| Gerçek sunucu e2e (`e2e:real:users` → `e2e:real`) | **İlk denemede kuruldu, 5/5 geçti** (geçici MySQL + seed + `e2e-real-users.ts` "created, created" + `node src/server.ts` :3302 + standalone web :3218). Tur 1'deki "bağımsız kanıt yok" durumu kapandı; betik tekrarlanabilir |

## Tur 2 — Tur 1 maddelerinin durumu
| Madde | Durum | Kanıt |
|---|---|---|
| QA-P4-1 `ws` high | ✅ kapandı | web `ws` 8.21.0; audit temiz |
| QA-P4-2 AC-34 | ✅ | `p4-media.spec.ts:203` — düğme `disabled`, metin "Uzaktan kontrol", accessible description "Müşteri tarayıcı modunda: yalnız görüntüleme", ipucu görünür |
| QA-P4-3 AC-33 | ✅ | `guest.spec.ts:29` — mobil cihazda ve masaüstünde `getDisplayMedia` yokken `guest-unsupported` + tam AC metni, `join-form`/`join-browser` yok, axe temiz; `p4-media.spec.ts:113` mobil axe; `lib/device-support.ts` birim testli |
| QA-P4-4 AC-30 | ✅ | `p4-media.spec.ts:177` — ilk `getDisplayMedia` `NotAllowedError` ile reddedilir → "Paylaşım başlatılmadı" + `share-retry` → ikinci denemede müşteri `sharing`, teknisyen `data-share=sharing`. p4-real test adı "REAL AC-59" olarak düzeltildi |
| QA-P4-5 AC-43 | ✅ | `p4-media.spec.ts:215` — `data-mode` fit → actual → fit, tam ekran `data-fullscreen` true/false, klavyeyle |
| QA-P4-6 ABUSE_EMAIL env zinciri | ✅ | `.env.example`, `deploy/docker-compose.yml` (değersiz anahtar), runbook §3; env.ts boş dizeyi tanımsız sayıyor (`env-logger.test.ts` +2) |
| QA-P4-7 mimari-api | ✅ | `mimari-api.md:87` resolve `consentText{…,sha256}`, `abuseEmail: string\|null` (prod'da fallback yok); `:88` join `consentTextId` zorunlu, 400 `fields.consentTextId`, `customerName` kontrol/bidi reddi |
| QA-P4-8 AC-38 | ✅ | `guest.spec.ts:47` — `content-security-policy` `frame-ancestors 'none'`, varsa XFO `DENY` |
| QA-P4-9 AC-26/125 | ✅ | `p4-media.spec.ts:163` (karşılama kodu = konsol kodu, `mailto:` href); `guest.spec.ts:54` (`abuseEmail:null` → bağlantı gizli); backend `env-logger.test.ts:58-65` (prod'da fallback yok) |
| QA-P4-10 staging ölçümleri | ✅ ertelendi (mimar kararı, kabul) | `mimari.md:427` §10.3 P4 kararı, `gereksinimler.md:201-205` takip satırı (sahip, tetik: NAT açılınca, en geç P6 öncesi) |
| QA-P4-11 gerçek e2e tekrarlanabilirliği | ✅ | `apps/server/scripts/e2e-real-users.ts` + `e2e:real:users`; QA ilk denemede 5/5 koşturdu |
| QA-P4-12 sözleşme açığı | ✅ | Protokol `mimari-protokol.md:25,33`; sunucu `consent-p4.test.ts:136` (peer.joined `guestName`, yeniden bağlanan konsolda `hello.guestName` + son `share`, misafir ayrılınca `share.stopped`), `:169` (PENDING'de alan yok); istemci `machines.test.ts` (>1 bekleyende tahmin yok → "Müşteri"); gerçek e2e REAL AC-24 yenileme senaryosu geçti |

## Tur 2 — Kabul kriterleri (P4)
| AC | Durum | Kanıt |
|---|---|---|
| AC-23 | ✅ (ertelendi, mimar kararı) | Staging ölçümü `gereksinimler.md:205` takipte; P4 kapanışını beklemez (`mimari.md:427`) |
| AC-26 | ✅ | `p4-media.spec.ts:163` |
| AC-28 | ✅ | `p4-media.spec.ts:26` |
| AC-29 | ✅ | `consent-p4.test.ts` |
| AC-30 | ✅ | `p4-media.spec.ts:177` |
| AC-31 | ✅ | `p4-media.spec.ts` paylaş/durdur/yeniden; REAL 1 |
| AC-32 | ✅ | `p4-media.spec.ts`, int AC-32/59 |
| AC-33 | ✅ | `guest.spec.ts:29`, `p4-media.spec.ts:113` |
| AC-34 | ✅ | `p4-media.spec.ts:203` |
| AC-38 | ✅ | `guest.spec.ts:47` |
| AC-39 | ✅ | `p4-media.spec.ts` axe açık/koyu + 375 px, konsol koyu + klavye; `guest.spec.ts:29` desteklenmiyor ekranı axe |
| AC-40, AC-42 | ✅ (ertelendi, mimar kararı) | AC-23 ile aynı kayıt |
| AC-43 (kısmi) | ✅ | `p4-media.spec.ts:215` |
| AC-59 | ✅ | mock + REAL 1/2 |
| AC-112 | ✅ | mock + REAL 1 |
| AC-113 | ✅ | mock + REAL 4 |
| AC-114 | ✅ | mock + REAL 5, int |
| AC-125 | ✅ | `guest.spec.ts:54`, `p4-media.spec.ts:163`, env zinciri |
| AC-127 | ✅ | `consent-p4.test.ts` |

## Tur 2 — Düzeltilmeli
1. **QA-P4-13 (Düşük) [frontend-dev]** `DESIGN.md:87` ve `:105` (`console/stage.tsx`) ve §6.1 `ui/segmented.tsx` satırı (`:90`/`:101`) — bu turda eklenen görsel davranışlar DESIGN.md'de yok: sahne görüntü modları (Sığdır `Expand` / %100 `ScanSearch`, `overflow-auto` + `tabIndex=0` `role=region`, `data-mode`), Tam ekran (`Maximize`/`Minimize`, `aria-pressed`, `data-fullscreen`), `Segmented` opsiyonel `icon` prop'u, konsol üst barındaki pasif "Uzaktan kontrol" (`MousePointer2`, disabled + açıklama), müşteri "Bu cihaz desteklenmiyor" (`MonitorX`) ve "Paylaşım başlatılmadı" + "Tekrar dene" (`RotateCw`) durumları. Ortak standart §1.8 "yeni bileşen/token eklendiğinde DESIGN.md güncellenir"; implementation.md "Açık" satırı bunu kendisi kaydetmiş. Beklenen: bu satırlar DESIGN.md'ye işlensin (kod değişikliği gerekmez; QA tur 3'te yalnız doküman kontrolü yapılır).

## Tur 2 — Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck / unit / int / mock e2e yeşil | ✅ | |
| Gerçek sunucu e2e | ✅ | QA bağımsız koşturdu, 5/5 |
| Bağımlılık denetimi (audit high 0) | ✅ | |
| Tüm paket AC'leri kanıtlı | ✅ | 23/40/42 mimar kararıyla ertelendi |
| §10.3 bitti tanımı (sahte ekranla video) | ✅ | |
| §10.3 staging NAT/TURN ölçümü | ✅ ertelendi | `mimari.md:427` kararı |
| Tasarım-kod uyumu (mimari-api / protokol) | ✅ | QA-P4-7, QA-P4-12 işlendi |
| Env zinciri | ✅ | ABUSE_EMAIL, TURN_LISTEN_IPS (.env.example + compose + runbook) |
| DESIGN.md güncel | ❌ | QA-P4-13 |
| 5 durum / a11y / mobil / ikon kuralı | ✅ | Yeni durumlar ikonlu (MonitorX, RotateCw, MousePointer2, Expand, ScanSearch, Maximize) |
| Yeni bağımlılık | ✅ | Yok (yalnız `ws` sürüm yükseltmesi) |
| Kullanılmayan kod | ✅ | Tur 1 notu (`dc.ts`) geçerli; P5'te izlenir |

## Tur 2 — Öneriler (zorunlu değil)
- Staging `deploy/turn/.env`'e `TURN_LISTEN_IPS=auto` eklenmesi (devops notu; sunucuya dokunulmamış) NAT açılış işiyle birlikte yapılsın.
- Tur 1 önerileri (koyu tema axe: aktif oturum/bitiş ekranları; 400 `consentTextId` → yeniden resolve e2e; `track.onended` yolu) hâlâ açık.

## Tur 2 — Olumlu
- Tur 1'in 12 maddesinin 12'si kapandı; her biri gerçekten ilgili davranışı doğrulayan bir testle (ad etiketi değil, assertion) kanıtlandı.
- Gerçek sunucu e2e'si artık tek komutla tekrarlanabilir; QA ilk denemede yeşil aldı.
- `abuseEmail` prod davranışı (fallback yok) hem birimde hem UI'da (bağlantı gizlenir) test edilmiş.

---

# Tur 1 (arşiv) — QA Raporu P4
Tur 1 DURUM: DÜZELTİLMELİ (Tur 2 ile kapatıldı, yukarı bkz.)

Tarih: 2026-11-11 · Denetçi: qa-denetci (kod değiştirmedi). P3 raporu `docs/arsiv/p3-qa-raporu.md`'ye taşındı (dosya git'te izlenmediği için `git mv` yerine `mv` kullanıldı).

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 2/2, web 35/35, server 71/71 |
| server `test:int` (test-db.sh down → up → down) | **99/99** (17 dosya) |
| `pnpm --filter @remote/web e2e` | 106 geçti, 4 atlandı (yalnız masaüstü konsol testleri `mobile` projesinde atlanıyor; `test.skip` gerekçesi yazılı, kabul edilir) |
| `pnpm audit` | **2 açık (1 high, 1 moderate)**: `ws@8.18.3` (apps/web devDependency), GHSA-58qx-3vcg-4xpx vd.; CI `pnpm audit --audit-level high` bu yüzden **kırmızı** |
| Gerçek sunucu e2e (`E2E_REAL=1`, `playwright.real.config.ts`) | **QA doğrulayamadı.** Kurulum denendi: test DB + seed tamam, ancak QA'nın teknisyen oluşturma betiği (repoda yok, implementation.md "küçük bir Prisma betiği" diyor) `@prisma/client` ESM import hatası verdi; 5/5 test login'de zaman aşımı. Hata QA kurulumundadır, ürünü göstermez, ama bağımsız kanıt da yoktur; frontend'in "5/5 geçti" beyanı tek kaynak. Tur sınırı nedeniyle yeniden denenmedi. |
| Staging NAT/TURN ölçümü (AC-23, 40, 42) | `docs/test-raporu.md` yok; ölçüm yapılmamış |

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-23 TURN-TLS (UDP kapalı) | ⚠️ kanıtsız | Staging ölçümü yok (§10.3 bitti tanımı `docs/test-raporu.md`'de ister) |
| AC-26 karşılama, doğrulama kodu (iki tarafta) | ⚠️ | Kod karşılamada (`guest.spec.ts:12`) ve konsolda (`console-view.tsx:84`) görünür; **iki tarafın aynı kodu gösterdiğini doğrulayan test yok**. Tenant logosu P9'a ertelendi (sistem logosu; gerekçeli) |
| AC-28 ad + KVKK olmadan buton pasif | ✅ | `p4-media.spec.ts:26` (`join-browser` disabled) + join şeması |
| AC-29 onay kaydı + audit | ✅ | `consent-p4.test.ts` (tek VIEW/GRANTED/UI satırı, metin id+sha256, IP, UA; audit `guest.admitted.consent`; yarışta kaybeden TX yazmaz) |
| AC-30 iptal → "Paylaşım başlatılmadı" + "Tekrar dene" | ❌ | Metin farklı (`gs.denied`: "Ekran paylaşımı başlatılamadı…"), ayrı "Tekrar dene" butonu yok (şeritteki "Ekranımı paylaş" var); **iptal senaryosu hiçbir testte yok** (p4-real'deki "AC-30" adlı test müşteri bitirme testidir) |
| AC-31 paylaşım durdur → teknisyen 2 sn'de görür, yeniden paylaşım | ✅ | `p4-media.spec.ts:65-69`, server int share.state. (2 sn süre ölçülmüyor; Playwright varsayılan 5 sn bekler — kabul edilebilir yaklaşım) Tarayıcının kendi "Paylaşmayı durdur" butonu (`track.onended`) yolu test edilmemiş |
| AC-32 Oturumu Bitir → video 2 sn'de kesilir | ✅ | `p4-media.spec.ts:71-75`, int AC-32/59 |
| AC-33 desteklenmeyen/mobil cihaz ekranı | ❌ | Ayrı ekran yok; mobilde müşteri karşılama → KVKK → lobi → **teknisyen kabulü** sonrasına kadar ilerliyor, yalnız "Paylaş"a basınca `gs.unsupported` uyarısı çıkıyor (`use-guest-session.ts:121`, `guest-session.tsx:102`). Metin AC'dekinden farklı; test yok |
| AC-34 konsolda "Uzaktan kontrol" pasif + açıklama | ❌ | Konsolda buton ve "Müşteri tarayıcı modunda: yalnız görüntüleme" metni yok (`console-view.tsx` yalnız "Tarayıcı · yalnız görüntü" etiketi) |
| AC-38 `frame-ancestors 'none'` (P4: test) | ⚠️ kanıtsız | `proxy.ts:26` başlığı üretiyor; `/session/[token]` yanıtında bu direktifi doğrulayan test yok (`auth.spec.ts:176-179` frame-ancestors'ı kontrol etmiyor) |
| AC-39 axe iki tema + klavye | ✅ (kısmi uyarı) | `p4-media.spec.ts:103-139` karşılama+lobi açık/koyu axe, konsol koyu axe + klavyeyle kabul. Aktif oturum/paylaşım şeridi müşteri ekranı yalnız açık temada taranıyor; bitiş/ret ekranları taranmıyor (öneri) |
| AC-40 ilk kare p95 < 5/8 sn (staging) | ⚠️ kanıtsız | Ölçüm yok |
| AC-42 gecikme p95 < 400 ms (staging) | ⚠️ kanıtsız | Ölçüm yok |
| AC-43 (kısmi) Sığdır / %100 / tam ekran | ❌ | Konsolda görüntü modu denetimi yok (`components/console/stage.tsx`) |
| AC-59 konsol onay diyaloğu + müşteri "sonlandırıldı" | ✅ | `p4-media.spec.ts:135-137`, odak "Vazgeç"te (`data-autofocus`) |
| AC-112 lobi kabul kodu (UI) | ✅ | `p4-media.spec.ts:45-55` (hatalı kod kalan hak, doğru kod Aktif); sunucu tarafı P3 int |
| AC-113 ret (UI) | ✅ | `p4-media.spec.ts:79-90` |
| AC-114 Zorla sonlandır (UI) | ✅ | `p4-media.spec.ts:92-101` (onay, odak Vazgeç), int tenant sınırı/USER 403 |
| AC-125 dolandırıcılık uyarısı + "Kötüye kullanımı bildir" | ⚠️ | Uyarı testli (`fraud-warning`); `mailto:` bağlantısının varlığı/href'i test edilmiyor. Env zinciri eksik (QA-P4-6) |
| AC-127 consentTextId doğrulaması | ✅ | `consent-p4.test.ts` (yok/eski/başka tenant/bilinmeyen → 400, doğru → 200). Web'deki 400 → onay sıfırla + yeniden resolve yolu e2e'de yok (öneri) |

KVKK onay zinciri (resolve → join → admit → session_consents): resolve güncel metni + sha256 döner, join `consentTextId`'yi doğrular (nonce sonrası), admit TX'i `consumeForAdmit` → `session_consents` → audit sırasıyla yazar; yarış testleri tek satır garantisini kanıtlıyor. Zincir doğru.

## Düzeltilmeli
1. **QA-P4-1 (Yüksek) [frontend-dev]** `apps/web/package.json:38` — `ws` 8.18.3 high (bellek tüketimi DoS) + moderate açık; CI audit kırmızı → server ile aynı `8.21.0`'a sabitle, `pnpm audit --audit-level high` temiz olsun.
2. **QA-P4-2 (Yüksek) [frontend-dev]** AC-34 — konsol üst barına pasif "Uzaktan kontrol" butonu (`disabled` + `aria-describedby`) ve "Müşteri tarayıcı modunda: yalnız görüntüleme" açıklaması; e2e'de buton pasif + metin görünür doğrulansın.
3. **QA-P4-3 (Yüksek) [frontend-dev]** AC-33 — karşılama yüklenirken `navigator.mediaDevices?.getDisplayMedia` yoksa veya mobil cihazsa (ör. `pointer: coarse` + UA-CH `mobile`) form yerine "Bu cihaz desteklenmiyor; masaüstü Chrome, Edge veya Firefox kullanın" ekranı; müşteri lobiye girememeli. e2e: mobil projede bu ekran + `join-browser` yok. (Mevcut mobil axe testi buna göre güncellenir.)
4. **QA-P4-4 (Orta) [frontend-dev]** AC-30 — `getDisplayMedia` iptalinde (`NotAllowedError`) "Paylaşım başlatılmadı" mesajı ve "Tekrar dene" butonu; e2e'de `getDisplayMedia` reddedilecek şekilde stub'lanıp mesaj+buton+tekrar denemede paylaşım doğrulansın. `p4-real.spec.ts:111` test adındaki "AC-30" yanlış etiket, düzeltilsin.
5. **QA-P4-5 (Orta) [frontend-dev]** AC-43 (kısmi) — konsol sahnesinde "Sığdır" (`object-contain`), "%100" (doğal boyut + kaydırma) ve tam ekran (`requestFullscreen`) seçenekleri, ikonlu, klavyeyle erişilebilir; e2e'de mod değişimi doğrulansın. Kapsam dışı bırakılacaksa mimar §10.2 P4 satırından AC-43'ü çıkarsın.
6. **QA-P4-6 (Orta) [devops]** `ABUSE_EMAIL` yalnız `apps/server/src/env.ts:39`'da; `.env.example` (boş), `deploy/docker-compose.yml` server servisi ve `docs/runbook.md`'de yok (proje CLAUDE.md "yeni env" kuralı).
7. **QA-P4-7 (Orta) [mimar]** `docs/mimari-api.md:87` resolve yanıtında `abuseEmail` ve `consentText.sha256` yok; join gövdesinde `consentTextId` zorunluluğu/400 `fields.consentTextId` belirtilsin (implementation.md sapma #1 kapatılsın).
8. **QA-P4-8 (Orta) [frontend-dev]** AC-38 — `/session/<token>` yanıtında CSP `frame-ancestors 'none'` (ve `X-Frame-Options` varsa) doğrulayan e2e ekle.
9. **QA-P4-9 (Orta) [frontend-dev]** AC-26/AC-125 — tek e2e'de karşılamadaki `guest-verify-code` ile konsoldaki kodun eşitliği ve `mailto:` bağlantısının `href` değeri doğrulansın.
10. **QA-P4-10 (Orta) [devops / test-operatoru]** AC-23, 40, 42 — staging NAT + UDP kapalı ağda TURN-TLS bağlantısı, ilk kare p95 ve gecikme ölçümü `docs/test-raporu.md`'ye yazılsın (§10.3 bitti tanımı). Yapılamıyorsa ertelemenin mimar onayı gerekir.
11. **QA-P4-11 (Düşük) [frontend-dev]** Gerçek sunucu e2e'si tekrarlanabilir değil: teknisyen oluşturma betiği repoda yok. `apps/web/e2e/` altına (veya `apps/server/scripts/`) iki ADMIN oluşturan betik + tek komutluk kurulum eklensin; CI'da opsiyonel iş olarak koşabilsin.
12. **QA-P4-12 (Düşük) [mimar → backend-dev]** Bilinen sözleşme açığı: `hello`/`peer.joined` misafir adını taşımıyor, sunucu son `share.state`'i saklamıyor. İstemci tarafı geçici çözüm (`sessionStorage` + yeniden bildirim) çalışıyor ama başka sekme/cihazda konsol "Müşteri" gösterir ve lobide >1 bekleyen varken kabulde ad yanlış eşlenebilir (`implementation.md` Frontend P4 karar #4: "tek kişi varsa onun adı"). Mimar karar versin: `guestName` + `share` alanını `hello{tech}`/`peer.joined{guest}`'e eklemek (önerilen) veya P5'e ertelemeyi kayda geçirmek. Teknisyen yanlış müşteriyi görebileceği için ertelenecekse kabulde ad yerine "Müşteri" gösterilmesi daha güvenli.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck / unit / int / e2e yeşil | ✅ | |
| Bağımlılık denetimi (audit high 0) | ❌ | QA-P4-1 |
| Tüm paket AC'leri kanıtlı | ❌ | AC-30/33/34/43 ❌; 23/26/38/40/42/125 ⚠️ |
| §10.3 bitti tanımı: sahte ekranla teknisyen video (Playwright) | ✅ | `p4-media.spec.ts:61` `videoWidth>0` |
| §10.3 bitti tanımı: staging NAT/TURN-TLS ölçümü | ❌ | QA-P4-10 |
| Tasarım-kod uyumu / sapmalar gerekçeli | ⚠️ | Sapmalar implementation.md'de gerekçeli; mimari-api güncel değil (QA-P4-7) |
| Env zinciri (`.env.example`/compose/runbook) | ❌ | QA-P4-6 |
| 5 durum (boş/yükleniyor/hata/başarılı/kısmi) | ✅ | Konsol: bekleniyor, lobi, bağlanıyor, video, durdu, koptu, bitti; müşteri: karşılama, lobi, oturum, bitiş/ret/doldu/koptu |
| a11y (axe iki tema, klavye) | ✅ | Kısmi kapsam notu AC-39'da |
| Mobil (375 px taşma yok) | ✅ | Ama AC-33 ❌ |
| İkon kuralı (lucide, anlamlı) | ✅ | Power/CircleX/ArrowLeft/Eye vb.; ek bulgu yok |
| Yeni bağımlılık gerekçeli | ✅ | `ws` + `@types/ws` web devDependency, gerekçe implementation.md #7 (sürüm açık: QA-P4-1) |
| Kullanılmayan kod yok | ⚠️ | `packages/contracts/src/dc.ts` yalnız `apps/server/test/unit/dc.test.ts`'te kullanılıyor; P4'te DataChannel açılmıyor. Mimari §10.3 P4 dosya planında "yalnız temel" olarak var, sapma değil; P5'te tüketilmezse bulgu olur |
| Audit (onay, kabul, ret, sonlandırma) | ✅ | int testleri |

## Öneriler (zorunlu değil)
- Aktif oturum/paylaşım ekranı ve bitiş/ret ekranları için koyu tema axe taraması.
- Web'de 400 `fields.consentTextId` → onay sıfırlama + yeniden resolve akışına e2e (mock zaten 400 dönebiliyor).
- Tarayıcının kendi "Paylaşmayı durdur" düğmesi (`track.onended`) yolunu e2e'de `track.stop()` ile tetikleyerek AC-31'in ikinci yarısını kanıtla.
- `SessionView`'a müşteri adı (P8) gelene kadar "Zorla sonlandır" diyaloğunda teknisyen adı + başlangıç saati gösterilsin.

## Olumlu
- KVKK onay zinciri doğru ve yarış koşullarında test edilmiş (admit‖admit, admit‖cancel 50 tekrar; consent sayısı = kazanan admit).
- Eski/başka tenant/bilinmeyen metin aynı 400'ü döner; tenant varlığı sızmıyor.
- Medya yönü (recvonly offer + `replaceTrack`) paylaş/durdur/yeniden paylaşta yeniden anlaşma gerektirmiyor; sahte ekranla gerçek video karesi doğrulanıyor.
- Frontend'in gerçek sunucu e2e'si iki gerçek uyuşmazlık (paylaşım durumu, ad kaybı) yakalamış ve kayda geçirmiş.
