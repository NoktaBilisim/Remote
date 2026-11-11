# QA Raporu — P7 Uzaktan kontrol — Tur 3
DURUM: GEÇTİ (Tur 3, 2026-11-11 — kısa regresyon). Tüm otomatik testler yeşil (tam e2e dahil), K6/K7/K8 üç tarafta tutarlı, QA-P7-T2-2 kapandı, QA-P7-T2-1 kısmen kapandı: bir satırlık tarih düzeltmesi kaldı, P8 öncesi yapılacak. Paketin kapanması için güvenlik P7 Tur 3 sonucu bekleniyor. Tur 1 ve Tur 2 aşağıda arşivde, Tur 3 bölümü dosyanın sonunda.

---
## Tur 1 (arşiv)

Tarih: 2026-11-11 · Denetçi: qa-denetci (kod değiştirilmedi) · Kapsam: commit edilmemiş P7 değişiklikleri (contracts, server signaling, agent-win, web konsol, e2e, DESIGN.md, implementation.md).

Özet: Otomatik testlerin hepsi yeşil, AC'lerin otomatik kanıtı güçlü. Çoğu sorun kod hatası değil. DÜZELTİLMELİ kararının iki nedeni var: (1) mimari §10.3'te P7 için istenen "bitti" kanıtı olan Windows elle test kaydı yok (Türkçe karakter, Alt+Tab, gösterge, kanca, UAC). Bu yüzden 7 AC kanıtsız (⚠️). (2) Protokol sapmaları "mimar onayı bekleyen" durumda ve AC-24/43 kanıtı bu kararlara bağlı. Ayrıca 3 küçük kod/sözleşme bulgusu var.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 temiz |
| `pnpm -r run typecheck` | 3/3 temiz |
| `pnpm -r run test` | contracts 39/39 · server unit 218/218 · web 114/114, kırmızı ve skip yok |
| `pnpm --filter @remote/server test:int` (geçici MySQL 8.4 `rs-mysql-qa-p7`, test sonrası silindi) | 22 dosya, **156/156** (P7 dosyası 14 test dahil) |
| `pnpm exec playwright test e2e/p7-control.spec.ts e2e/p5-collab.spec.ts e2e/p4-media.spec.ts` | **37 geçti / 31 atlandı / 0 kırmızı**. Atlananlar `mobile` projesindeki konsol testleri, gerekçe dosyada var: `test.skip(info.project.name !== "desktop", "konsol masaüstü akışı")`. P4 ve P5 regresyonu yok (AC-41 medyan 30 FPS) |
| Go (docker `golang:1.26.11-bookworm`, `apps/agent-win`) | `gofmt -l` boş · `go vet ./...` OK · `GOOS=windows go vet ./...` OK · `go test -race -count=1 ./...` **15/15 paket ok** · tüm paketler için Windows test ikilisi derlendi |

Tam e2e paketi (auth/guest/sessions/p6) bu turda koşulmadı. Yalnız P7 ve P4/P5 regresyonu koşuldu. Frontend raporundaki sonuç 147 geçti / 39 atlandı.

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-24 (izin sıfırlama, istemci) | ✅ (mimar kararı koşullu, QA-P7-1) | int: "AC-24: misafir koparsa kontrol VIEW + REVOKED/RECONNECT…"; Go: `TestAC24ReconnectResetsToViewOnly`, `TestTechDisconnectClosesGate`; `flow.go` `onHello`/WS kopması/PeerConnection `disconnected/failed/closed` → `closeControl`. Teknisyen kopmasında kapıyı istemcideki `peer.left/peer.joined{tech}` yorumu kapatıyor (sapma c) |
| AC-43 (monitör izni) | ✅ (mimar kararı koşullu, QA-P7-1) | int: "AC-43 (G-03): yalnız AGENT; yanıtlanmamış istek 30 sn…"; Go `TestAC43MonitorRequestNeedsConsent`; e2e "AC-43/105". Ret mesajı yok (sapma d), konsol 30 sn sonra "onaylamadı" diyor |
| AC-47 | ✅ | e2e "AC-47/48/49/99/50" (onaysız girdi 0, "Müşteri onayı bekleniyor…"). Metin AC'deki "Kontrol bekleniyor" ile birebir değil (QA-P7-6, düşük) |
| AC-48 | ⚠️ kanıtsız (otomatik kısım ✅) | Go `TestAC48TurkishCharsUseUnicode`, `TestAC48ShortcutsAltTabFunctionKeys`, `TestAC48CtrlAltDelAndWinLBlocked`, `TestAC48WheelAndButtons`; e2e'de input DC'de tık/klavye/Alt+Tab var. Mimari §10.3 "Türkçe karakter + Alt+Tab manuel test kaydı" istiyor, kayıt yok (QA-P7-2) |
| AC-49 | ⚠️ kanıtsız (otomatik kısım ✅) | Go `TestAC49CoordinatesMapToMonitorWithinTwoPixels` (sanal iki monitör), web `lib/control/input.test.ts`. Gerçek farklı DPI (%150) ±2 px ölçümü yok (adım 29) |
| AC-50 | ✅ | e2e (müşteri kısayolla kapatır, < 1 sn, sonra girdi 0); int "AC-111/AC-50"; Go `TestAC50AC111CloseButtonAndHotkeyCloseGate`; metin `p7.end.customer` "Kontrol müşteri tarafından kapatıldı" |
| AC-51 | ✅ | int "AC-51: remote_control.use yoksa FORBIDDEN, misafire iletilmez"; e2e "AC-51: … 'Kontrol iste' görünmez" |
| AC-99 | ✅ | Go `TestAC99ViewOnlyAtStartAndDenyThenCooldown`; int "AC-47/AC-99/AC-116"; e2e "AC-99/116" ("Kontrol reddedildi") |
| AC-100 | ⚠️ kanıtsız | Düğmeler `ui/screens_windows.go`'da var, ama "her zaman görünür + klavyeyle erişilebilir" için otomatik test ya da Windows kaydı yok (Win32 UI otomatik test edilemiyor, elle kayıt gerekli) |
| AC-101 | ✅ | Go `TestAC101ClosedGateAppliesZeroEvents`, `TestAC101CloseStopsInputWithin100ms`, `TestAC101CloseReleasesHeldKeysAndButtons`, `TestAC101GateConcurrentCloseIsRaceFree` (sahte enjektör: kapalı kapıda 0 olay). Mimari §10.3 ölçütü karşılanıyor |
| AC-102 | ⚠️ kanıtsız (mantık ✅) | Go `TestAC102HotkeyFallback`, `TestAC102NoHotkeyNoGrant` (control + flow). Gerçek `RegisterHotKey` ile "istemci arka plandayken çalışır" ve yedeğe düşüş için Windows kaydı yok (adım 31) |
| AC-103 (kontrol aktif göstergesi) | ⚠️ kanıtsız | Metin değişimi `overlay_windows.go`'da var, otomatik test yok. Her monitör / 1 sn topmost / kırmızı çerçeve P7 metniyle elle doğrulanmadı (adım 26) |
| AC-104 | ⚠️ kanıtsız (mantık ✅) | `TestAC104LocalInputSuspendsOneSecond`, `TestAC104LocalInputSuspendsRemote` (kapı ve Applier). Gerçek `WH_*_LL` kancası doğrulanmadı (adım 32) |
| AC-105 | ⚠️ kanıtsız (iletim ✅) | int "AC-105: env.state…", Go `TestAC105EnvStateReported`, e2e "AC-43/105" uyarıları. `env/probe_windows.go` (TokenElevation, OpenInputDesktop) gerçek UAC'de doğrulanmadı (adım 33) |
| AC-111 | ✅ | int "AC-111/AC-50: GRANTED → consent + audit…", "AC-111 (G-15): GRANTED kaydı yazılamazsa control.revoke{audit} + INTERNAL", "AC-111: … 1 sn içinde bitmezse (asılı DB)". Ret, kısayol ve UI kapanışı kayıtlı |
| AC-115 (control.revoke istemci) | ✅ | int "AC-115: applyPermChange…", "…yeniden doğrulamada control.revoke{permission} + caps.update", "pasifleştirilen teknisyenin tüm odaları … 4401", "rol değişimi…"; Go `TestAC115RevokeClosesGateAndReportsSystem`, `TestAC115CapsUpdateWithoutRemoteControlClosesGate`; e2e "AC-115/G-04". S-P3-8 giriş şartı karşılanıyor. "5 sn" hedefi P9/P10 servis çağrısıyla tamamlanacak (son paket P10, §11) |
| AC-116 | ✅ (mantık); diyalog UI'ı elle doğrulanmadı | Go `TestAC116ConsentTimingFocusAndInjection`, `TestAC116DialogNeverUnderCursor`, `TestAC116RequestCooldownAndSessionLimit`; int "AC-116 (G-03): … 6. RATE_LIMITED"; e2e "AC-99/116". Saf kurallar test edildi, Win32 bağlaması (`control_windows.go`: Enter/Space yutma, 1,5 sn) için adım 25 kaydı yok. Bu kayıt QA-P7-2'ye dahil |

## Düzeltilmeli (her madde bir ajana atanır)
1. **QA-P7-1 · Yüksek · [mimar]** `docs/mimari-protokol.md` sonundaki "P7 backend uygulama notları" 1–6 ve `docs/implementation.md` Frontend P7 sapma 1–3 hâlâ "mimar onayı bekleyen" durumda. Paket bu kararlar olmadan kapanamaz. Her biri için karar verilip §3 tablosuna işlenmeli:
   - (a) Teknisyenin "Kontrolü bırak"ı yalnız yerel duraklatma; müşteri izni açık kalıyor ve "Kontrole devam" yeni onay istemiyor. Karar: kabul mü, yoksa `control.release` (tech→S→guest, istemci kapıyı kapatır, REVOKED/… kaydı) mı eklenecek? AC ihlali yok, ama müşteri göstergesi "kontrol aktif" kalırken teknisyen durmuş görünüyor.
   - (b) İstek iptali mesajı yok. Hiçbir AC'yi etkilemiyor. Kabul ya da `control.cancel` kararı yeterli.
   - (c) Teknisyen kopması ve sekme değişiminde misafire `control.revoke` gitmiyor. AC-24 güvenliği, istemcinin `peer.left/peer.joined{tech}` yorumuna dayanıyor (`rooms.ts` `detachTech`/`attachTech` + `flow/control.go:208` `techChanged`). Davranış çalışıyor ve testli. Mimar ya bunu "sözleşme" olarak §4.3 madde 2'ye yazmalı ya da `control.revoke.reason += "reconnect"` kararını vermeli.
   - (d) Monitör reddi mesajı yok. AC-116'nın "reddedilen istekten sonra 30 sn" kuralı sunucuda "yanıtsız istek 30 sn" olarak uygulanıyor (`control.ts:107`). Teknisyen reddi 30 sn sonra "onaylamadı" diye öğreniyor. Kabul ya da `monitor.state{denied}` kararı gerekli.
   - Ayrıca not 2 (`INTERNAL` kodu), not 3 (GRANTED yalnız UI), not 4 (sunucunun teknisyene `control.state` göndermesi), not 5 (caps yalnız daralır) ve not 6 (oturum sonunda ayrı REVOKED yok, P8 zaman çizelgesi bunu nasıl gösterecek) için onay gerekli.
2. **QA-P7-2 · Yüksek · [backend-dev-Go + test-operatoru]** Mimari §10.3 P7 "bitti" kanıtı olarak istenen Windows elle test kaydı yok. `docs/implementation.md` "Windows'ta elle doğrulanacaklar" adım 25–36 staging'de gerçek Win10/11'de koşulmalı, sonuç (geçti/kaldı, ekran görüntüsü veya not) `docs/test-raporu.md`'ye P7 bölümü olarak yazılmalı. Bu kayıt AC-48, 49 (DPI), 100, 102, 103, 104, 105 ve AC-116'nın Win32 bağlamasını kanıtlar. En az şunlar kayıtta olmalı: Türkçe karakter (TR-Q ve EN-US düzen), Alt+Tab, arka planda kısayol ve yedeğe düşüş, Enter/Space ve ilk 1,5 sn tıklamanın izin vermemesi.
3. **QA-P7-3 · Orta · [backend-dev]** `packages/contracts/src/dc.ts:213` `keySchema.code` yalnız `z.string().min(1).max(32)`. Go `internal/input/messages.go:23` ise `^[A-Za-z0-9]{1,32}$` uyguluyor. Konsol de bu kurala göre gönderiyor (implementation.md). Tek kaynak ilkesi bozuk: contracts geçerli dediği bir mesajı Go düşürüyor. Beklenen: `code: z.string().regex(/^[A-Za-z0-9]{1,32}$/)`. Ayrıca `fixtures/dc-input.json` `invalid` listesine `{"t":"k","code":"Key-A","down":true}` eklenmeli ve iki tarafta da test geçmeli.
4. **QA-P7-4 · Düşük · [backend-dev]** `apps/server/src/signaling/control.ts:151-153` `onGranted` bekleyen bir istek (`c.state === "REQUESTED"`) olup olmadığına bakmıyor. VIEW durumunda gelen `control.state{GRANTED}` da kaydediliyor ve teknisyene iletiliyor. İzin kararı istemcide olduğu için güvenlik açığı değil, ama audit zaman çizelgesinde "istek olmadan izin" satırı oluşabiliyor. Beklenen: `c.state !== "REQUESTED"` ise metrik `grant_without_request` + kayıt/iletim yok (istemciye `control.revoke{admin}` gönderilmeli mi, mimar QA-P7-1 ile birlikte karar versin). Davranışa entegrasyon testi eklenmeli.
5. **QA-P7-5 · Düşük · [backend-dev]** `control.ts:89-93` `control.request` misafire **önce** iletiliyor, `control.requested` audit'i sonra yazılıyor ve hata yalnız loglanıyor. AC-111 isteği saymadığı için ihlal değil, ama P8 zaman çizelgesinde istek satırı sessizce eksik kalabilir. Beklenen: audit hatasında metrik `control_request_audit_failed`. İletimden önce yazılması tercih edilir, mimar ile hizalanmalı.
6. **QA-P7-6 · Düşük · [frontend-dev]** `apps/web/messages/tr.json:410` `p7.waiting` = "Müşteri onayı bekleniyor…". AC-47 metni "Kontrol bekleniyor". Ya AC metnine uyulmalı ya da proje-yöneticisi AC metnini güncellemeli. e2e assert'i buna göre değiştirilmeli.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| 1. AC'ler testle kanıtlı, testler yeşil | ❌ | Testler yeşil. AC-48/49/100/102/103/104/105 için elle Windows kaydı eksik (QA-P7-2) |
| 2. Lint/format/type temiz | ✅ | pnpm lint/typecheck, gofmt, iki vet temiz |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0 | ❌ | Bu rapor DÜZELTİLMELİ. Güvenlik raporu P7 için ayrıca bekleniyor |
| 4. test-operatoru tarama | ❌ | P7 için henüz koşulmadı |
| 5. Migration geri alınabilir + seed | ✅ (uygulanmaz) | Şema değişikliği yok (`session_consents` P4 CHECK kümesi yeterli). Entegrasyon testleri mevcut migration'larla yeşil |
| 6. Dokümantasyon güncel | ⚠️ | implementation.md ve DESIGN.md güncel. `docs/api.md`/CHANGELOG'da P7 WS/DC tipleri kontrol edilmedi; P13 teknik-yazar işi olabilir. mimari-protokol §3 tablosu yeni tiplerle güncellenmedi, notlar dosyanın sonunda (QA-P7-1) |
| 7. Sapmalar implementation.md'de gerekçeli | ✅ | Backend 6, Agent 9, Frontend 7 sapma gerekçeli. Mimar onayı QA-P7-1'de |
| Paket: yeni bağımlılık yok / AGPL-GPL yok | ✅ | Üç bölüm de "yeni bağımlılık yok" diyor, package.json ve go.mod diff'inde ekleme yok |

## Öneriler (zorunlu değil)
- Uzaktan kontrolde fare imleci görüntüye çizilmiyor (Agent sapma 9). Kullanılabilirlik için P7 sonrası ayrı bir iş açılması önerilir.
- `onView`'da `REQUESTED` iken gelen `VIEW/UI|HOTKEY` teknisyene ret değil "VIEW/UI" olarak gidiyor ve 30 sn sayacı başlamıyor. İstemci bu yolu üretmiyor gibi görünüyor, yine de birim testiyle sabitlenmesi önerilir.
- Tam e2e paketinin (auth/guest/sessions/p6) bir kez daha koşulması test-operatoru turunda yapılabilir.

## Olumlu
- Fail-closed (G-15) iki yoldan da (DB hatası ve asılı DB, 800 ms) entegrasyon testiyle kanıtlı. Geç commit edilen GRANTED, REVOKED ile dengeleniyor ve `epoch` ile eskimiş kayıt ayıklanıyor.
- Kapı denetimi Applier kilidi altında yapılıyor ve `Close` dinleyicisi aynı kilidi alıyor. Böylece AC-101 fiilen anında sağlanıyor; yarış testi `-race` ile yeşil.
- S-P3-8 giriş şartı (60 sn yeniden doğrulama: yetki tazeleme, rol değişimi, pasif kullanıcı, kopuk teknisyen odaları dahil) uçtan uca test edildi.
- Sözleşme fixture'ları (`ws-messages.json`, `dc-input.json`) iki tarafta (Vitest + go test) kullanılıyor.
- e2e'de gerçek WebRTC'li sahte istemci (`fake-agent.ts`) var. Her senaryoda axe 0 ihlal, konsol hatası 0.

---
# QA Raporu — P7 Uzaktan kontrol — Tur 2
DURUM: GEÇTİ

Tarih: 2026-11-11 · Denetçi: qa-denetci (kod değiştirilmedi) · Kapsam: Tur 1 sonrası mimar kararları (`docs/mimari-protokol.md` §3/§3.3 K1–K5, ADR-0013), dba migration `20261111050000_p7_consent_source_tech`, implementation.md "Backend / Agent / Frontend P7 — düzeltme turu 1".

Özet: Tüm otomatik testler yeşil, skip yalnız gerekçeli mobil konsol testleri. QA-P7-1, 3, 4, 5, 6 kapandı. QA-P7-2 (Windows elle test) P6 kuralıyla erteleniyor ve paketi engellemiyor, ama henüz "Sonra / açık" tablosuna yazılmadı (QA-P7-T2-1). Sunucu, konsol ve Go istemcisi §3.3 tablosuyla tutarlı. Tek protokol sapması (REQUESTED iken `control.request` → CONFLICT) gerekçeli ve konsol bu durumda istek gönderemiyor, ama mimari belgeye işlenmedi (QA-P7-T2-2).

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 temiz |
| `pnpm -r run typecheck` | 3/3 temiz |
| `pnpm -r run test` | contracts **43/43** · server unit **243/243** · web **117/117**. Kırmızı yok, skip yok |
| `pnpm --filter @remote/server test:int` (geçici MySQL 8.4 `rs-mysql-qa-p7t2`, `test-db.sh up` ile 6 migration uygulandı, P7 TECH dahil; test sonrası `down` ile silindi, `docker ps -a` boş) | **23 dosya / 179 test** yeşil (`signaling-control-p7` 36 test, `consent-source-p7` dahil) |
| `playwright test e2e/p7-control.spec.ts e2e/p5-collab.spec.ts e2e/p4-media.spec.ts` | **38 geçti / 32 atlandı / 0 kırmızı** (45 sn). Atlananlar `mobile` projesindeki konsol testleri, gerekçe dosyada var (`test.skip(... "konsol masaüstü akışı")`). P4/P5 regresyonu yok, AC-41 medyan 31 FPS. Bu koşuda P5 AC-39 axe zaman aşımı **görülmedi** |
| Go (docker `golang:1.26.11-bookworm`, `apps/agent-win`) | `gofmt -l` boş · `go vet ./...` OK · `GOOS=windows go vet ./...` OK · `go test -race -count=1 ./...` **15/15 paket ok** · tüm paketlerin Windows test ikilisi derlendi (hata 0) |

**Kararsızlık notu:** frontend-dev üç tam e2e koşusundan birinde P5 `AC-39 axe (light/dark)` testinin 30 sn zaman aşımına düştüğünü bildirdi. Bu turda bu test geçti. Tam paket (auth/guest/sessions/p6) zaman sınırı nedeniyle QA tarafından koşulmadı; frontend raporundaki son tam koşu 148 geçti / 40 atlandı. Kararsız test adayı olarak Öneriler'de.

## Tur 1 bulgularının kapanışı
| ID | Durum | Kanıt |
|---|---|---|
| QA-P7-1 (mimar kararları) | ✅ kapandı | `mimari-protokol.md` §3 tablo (`control.release`, `control.cancel`, `monitor.denied`, `control.revoke` += `reconnect`/`stale`, `error.INTERNAL`) ve §3.3 durum tablosu + K1–K5. ADR-0013 var. "P7 backend uygulama notları" 1–9 "karara bağlandı" olarak işaretli. (a) release, (b) cancel, (c) reconnect revoke, (d) monitor.denied, not 2–6 kararlı |
| QA-P7-2 (Windows elle test) | ⏸ ertelendi (P6 kuralı) | Bu ortamda Windows yok. Adım 25–42 (`implementation.md` Agent P7 + düzeltme turu 1) kullanıcı tarafından koşulacak. "Sonra / açık" kaydı **eksik**, bkz. QA-P7-T2-1 |
| QA-P7-3 (`keySchema.code`) | ✅ kapandı | `dc.ts` regex `^[A-Za-z0-9]{1,32}$`. `fixtures/dc-input.json` invalid listesinde `Key-A` ve 33 karakterlik kod var. Vitest `control-p7.test.ts` + `dc-input-fixtures.test.ts` ve Go fixture testi yeşil |
| QA-P7-4 (istek olmadan GRANTED) | ✅ kapandı | `control.ts` `onGranted`: `state !== REQUESTED` ise kayıt/iletim yok. VIEW'da misafire `control.revoke{stale}`, GRANTED'de yok sayılır, metrik `control_state_unexpected`. int: QA-P7-4 testleri (iptal sonrası, istek yokken, çift GRANTED) |
| QA-P7-5 (istek audit sırası) | ✅ kapandı | `auditBeforeForward`: audit iletimden önce yazılıyor, 800 ms sınırı var. Hata durumunda metrik `control_request_audit_failed` + log ref, istek yine iletiliyor (fail-closed yalnız açma yönünde, ADR-0013). Yazım sırasında iptal/kopma olursa istek gönderilmiyor (`superseded`). int: QA-P7-5 testleri |
| QA-P7-6 (AC-47 metni) | ✅ kapandı | `tr.json` `p7.waiting` = "Kontrol bekleniyor", açıklama `p7.waitingNote`'ta. e2e AC-47 assert'i bu metni bekliyor |

## §3.3 tutarlılık denetimi (sunucu ↔ konsol ↔ Go)
| Olay | Sunucu (`control.ts`) | Konsol (`machine.ts`, `use-tech-session.ts`) | Go (`flow/control.go`) | Sonuç |
|---|---|---|---|---|
| release (K1) | GRANTED: önce bellek VIEW, sonra misafire `control.release` + teknisyene `{VIEW,TECH}`, sonra REVOKED/TECH (granting sırasında `interrupt` ile dengeleme) | `k.release_all` → makine `ended{tech}` → `control.release`. "Kontrole devam" yeni istek | Kapı + kontrol diyaloğu kapanır, yanıt yok, "Teknisyen kontrolü bıraktı" | ✅ |
| cancel (K2) | REQUESTED → VIEW, `control.cancel`, `{VIEW,TECH}`, audit `control.cancelled`, consent yok. GRANTED → release. VIEW → yok say. Sayaç düşmez, 30 sn başlamaz | "Vazgeç" yalnız `requested`'de. Hak iade edilmez, bekleme yok | Diyalog kapanır, yanıt yok. Geç tıklama ile açılan kapı stale ile kapanır (`TestK2CancelClosesPromptAndLateGrantIgnored`) | ✅ |
| stale | VIEW'da gelen GRANTED → `control.revoke{stale}`, kayıt yok | Beklenmeyen GRANTED → yakalama yok + `control.release` (sunucu VIEW'da yok sayar) | Kapı açıksa `{VIEW,SYSTEM}`; sunucu VIEW'da bunu no-op yapar | ✅ |
| reconnect (K3) | `detachTech`/`attachTech`: önce `revoke{reconnect}`, sonra `peer.left/joined{tech}`. Bekleyen monitör temizlenir, GRANTED ise REVOKED/RECONNECT (`side:"tech"`) | `hello`/`closed` → idle, `monitorPending` temizlenir | revoke + `techChanged` (iki katman), metin yalnız kapı/diyalog açıksa | ✅ |
| monitor.denied (K4) | Yalnız bekleyen kimlikte işlenir: 30 sn bekleme + audit + iletim. 30 sn yanıtsızlık yedek yol. Bekleyen varken yeni istek CONFLICT | Eşleşen kimlikte hemen "reddetti", başka kimlik yok sayılır | Reddet/Esc/X → `monitor.denied{pendingMon}` | ✅ (bkz. Öneri 2) |
| REQUESTED iken yeni `control.request` | `error{CONFLICT}` ("Önceki kontrol isteği müşteride bekliyor."), iletilmez, sayaç değişmez (int "§3.3: bekleyen istek varken ikinci control.request CONFLICT…") | `canRequest` `requested`'de false (unit "AC-47"). Düğme `loading` olduğu için `disabled`. `requestControl` önce `canRequest`'e bakar. **Konsol bu durumda istek gönderemiyor.** Yeniden istek yalnız "Vazgeç" sonrası mümkün | `ctlReq.Admit` diyalog açıkken false (yedek katman) | ✅ davranış / ⚠️ belge (QA-P7-T2-2) |
| Oturum sonu (K5-d) | `closeControlOnEnd`: en iyi çabayla REVOKED/SYSTEM `{reason:"session_ended"}` | `session.ended` → idle | `SessionEnded` → `gate.Close` | ✅ |
| Misafirden RECONNECT/TECH (S7-10) | Şema refine → 1008 (uçtan uca int) | — | Go bu kaynakları gönderemez (signal testi) | ✅ |

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-24 | ✅ | int "AC-24…" + S7-4 sıralama testleri (revoke → peer.left / peer.joined). Go `TestAC24ReconnectResetsToViewOnly`, `TestK3ReconnectRevokeThenPeerLeft`, `TestK3PeerJoinedClosesPromptWithoutRevoke`. e2e K2/S7-2 (teknisyen yenilenince misafire `revoke:reconnect`, kapı kapalı). Mimar kararı artık koşulsuz (K3) |
| AC-43 | ✅ | int AC-43 + K4 (`monitor.denied` kimlik eşleşmesi, audit, 30 sn, yanıtsızlık yedeği, BROWSER). Go `TestAC43MonitorRequestNeedsConsent`, `TestK4MonitorDeniedSent`. e2e "AC-43/105" (≤ 2 sn "Müşteri monitör değişikliğini reddetti") |
| AC-47 | ✅ | e2e "AC-47/48/49/99/50" ("Kontrol bekleniyor", onaysız girdi 0). Unit "AC-47". QA-P7-6 kapandı |
| AC-48 | ✅ otomatik / Windows elle test bekliyor | Go `TestAC48*` (Unicode, Alt+Tab/F tuşları, Ctrl+Alt+Del/Win+L engeli, tekerlek). e2e input DC. Gerçek TR-Q/EN-US + Alt+Tab elle (adım 25–36) |
| AC-49 | ✅ otomatik / Windows elle test bekliyor | Go `TestAC49CoordinatesMapToMonitorWithinTwoPixels`, web `input.test.ts`. %150 DPI ±2 px ölçümü elle (adım 29) |
| AC-50 | ✅ | e2e (kısayolla kapanış < 1 sn, sonra girdi 0), int "AC-111/AC-50", Go `TestAC50AC111CloseButtonAndHotkeyCloseGate` |
| AC-51 | ✅ | int "AC-51" (FORBIDDEN, iletilmez), e2e "AC-51" |
| AC-99 | ✅ | Go `TestAC99ViewOnlyAtStartAndDenyThenCooldown`, int, e2e "AC-99/116" |
| AC-100 | Windows elle test bekliyor | Win32 düğmeleri otomatik test edilemiyor. "Erişime izin ver" artık diyaloğu öne getiriyor (S7-6), elle adım 39 |
| AC-101 | ✅ | Go `TestAC101*` + `TestS73ShutNeverBlocksAndClosesAtomically`, `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` (-race yeşil) |
| AC-102 | ✅ mantık / Windows elle test bekliyor | Go `TestAC102HotkeyFallback`, `TestAC102NoHotkeyNoGrant`. Gerçek `RegisterHotKey` elle (adım 31, 37) |
| AC-103 | Windows elle test bekliyor | Gösterge yalnız Win32 (`overlay_windows.go`), elle adım 26 |
| AC-104 | ✅ mantık / Windows elle test bekliyor | `TestAC104*`, `TestS77OpenListenerOnlyOnTransition`. Gerçek LL kanca elle (adım 32, 40) |
| AC-105 | ✅ iletim / Windows elle test bekliyor | int "AC-105", Go `TestAC105EnvStateReported`, e2e "AC-43/105". Gerçek UAC elle (adım 33, 42) |
| AC-111 | ✅ | int GRANTED fail-closed (hata + 800 ms), REVOKED/TECH (release), K5-d kapanış satırı. `consent-source-p7` TECH CHECK'ini gerçek MySQL'de doğruluyor |
| AC-115 | ✅ | int AC-115 (applyPermChange, 60 sn yeniden doğrulama, pasif kullanıcı, rol). Go `TestAC115*`, e2e "AC-115/G-04". "≤ 5 sn" P9/P10 çağrısına bağlı (implementation.md S7-11 notu) |
| AC-116 | ✅ mantık / Win32 bağlaması Windows elle test bekliyor | Go `TestAC116*`, int "AC-116 … RATE_LIMITED", e2e "AC-99/116". Enjekte tıklama/Alt+İ/1,5 sn elle (adım 25, 38, 39) |

"Windows elle test bekliyor" işaretli AC'lerin otomatik kısmı yeşil. Kullanıcıya bırakılan elle doğrulama P6 kuralıyla (`docs/arsiv/p6-qa-raporu.md`) ertelendi ve GEÇTİ kararını engellemiyor. Erteleme kaydı QA-P7-T2-1'de.

## Düzeltilmeli (GEÇTİ'yi engellemez; P8 başlamadan yapılmalı)
1. **QA-P7-T2-1 · Orta · [proje-yoneticisi]** `docs/gereksinimler.md`'de "Sonra / açık — P7'den" tablosu yok. P6 kuralıyla erteleme ancak bu kayıtla geçerli olur. Eklenecek satırlar:
   - **Windows elle testi (P7):** `implementation.md` adım 25–42 gerçek Win10 22H2 / Win11'de, staging'de koşulacak. Kanıtlanacak AC'ler: AC-48 (TR-Q + EN-US Türkçe karakter, Alt+Tab), AC-49 (%150 DPI ±2 px), AC-100, AC-102 (arka planda kısayol + F11 yedeği), AC-103 (her monitörde gösterge), AC-104 (LL kanca, S7-7 kur/kaldır), AC-105 (gerçek UAC/güvenli masaüstü), AC-116 Win32 bağlaması (Enter/Space, 1,5 sn, enjekte tıklama ve Alt+İ reddi; S7-5/S7-6), S7-3 (kısayol + sürekli hareket, 10 tekrar), S7-9 (yönetici uyarısı). Sahibi: test-operatoru + kullanıcı (+ backend-dev/Go düzeltme). Sonuç `docs/test-raporu.md` P7 bölümüne. Ne zaman: prod açılışından (P10) önce. Önerim: P8 kod turundan önce.
   - **P6 tablosundaki "P7 başlamadan / P7 öncesi" satırları yeniden tarihlenmeli:** "Windows elle testi" (P6) ve özellikle **"Fare imleci"** satırı. Bu satır "P7 öncesi (uzaktan kontrol imleçsiz kullanılamaz)" diyor ve hâlâ yapılmadı (Agent P7 sapma 9). P7 bu satır karşılanmadan kapanıyor. Yeni bir tarih ve sahip yazılmalı, ya da kullanıcıdan açık kabul alınmalı.
2. **QA-P7-T2-2 · Düşük · [mimar]** `docs/mimari-protokol.md` §3 `control.request` satırına ve §3.3 tablosuna Backend düzeltme turu 1 sapma 1 işlenmeli: "REQUESTED iken `control.request` → `error{CONFLICT}`, iletilmez, sayaç değişmez; yeniden istek için önce `control.cancel`". Aynı yere "granting/GRANTED iken → CONFLICT ('Kontrol zaten açık')" da eklenmeli. Kod ve testler var (`control.ts` `handleControlRequest`, int "§3.3: bekleyen istek varken…"), konsol uyumlu, ama "bağlayıcı" tablo bu satırı içermiyor.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| 1. AC'ler testle kanıtlı, testler yeşil | ✅ (Windows elle test kısmı ertelendi) | Tüm otomatik testler yeşil. Elle kısım QA-P7-T2-1 ile "Sonra"ya |
| 2. Lint/format/type temiz | ✅ | pnpm lint/typecheck, gofmt, iki vet temiz |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0 | ✅ qa / bekliyor güvenlik | `guvenlik-raporu.md`'de en son "P7 — Tur 1: DÜZELTİLMELİ (Yüksek 1)". Güvenlik Tur 2 sonucu paket kapanış şartı (CLAUDE.md paket kuralı) |
| 4. test-operatoru tarama | sıradaki adım | Akışta qa ‖ güvenlik sonrası. Tam e2e paketinin (auth/guest/sessions/p6) koşulması da bu turda yapılmalı |
| 5. Migration geri alınabilir + seed | ✅ | `20261111050000_p7_consent_source_tech`: tek atomik ALTER (CHECK genişletme) + `down.sql`. TECH satırı varsa geri alma bilerek başarısız oluyor (yasal kanıt), bu gerekçeli. Temiz DB'de 6 migration uygulandı, int yeşil |
| 6. Dokümantasyon güncel | ⚠️ | §3/§3.3, ADR-0013, db-notlari, implementation.md güncel. Eksikler: QA-P7-T2-1 (gereksinimler "Sonra") ve QA-P7-T2-2 (CONFLICT satırı). `docs/api.md`/CHANGELOG P13 teknik-yazar işi |
| 7. Sapmalar implementation.md'de gerekçeli | ✅ | Backend düzeltme sapma 1–5, Agent karar 1–7, Frontend "yok" |
| Yeni bağımlılık yok / AGPL-GPL yok | ✅ | Üç bölüm de "yeni bağımlılık yok" diyor |

## Öneriler (zorunlu değil)
1. **Go: yerel nedenle kapanan bekleyen kontrol diyaloğu sunucuya bildirilmiyor.** `flow/control.go` `closeControl` yalnız kapı açıksa `control.state` gönderiyor. PeerConnection `disconnected/failed` (`flow.go:638`) yalnız diyaloğu kapatırsa sunucu REQUESTED'de kalıyor ve konsol "Kontrol bekleniyor"da asılı kalıyor; teknisyenin "Vazgeç"e basması gerekiyor. Sunucu `onView` zaten REQUESTED'de gelen `{VIEW,SYSTEM}`i kayıt yazmadan VIEW'a çeviriyor. Bu yolda `{VIEW,SYSTEM}` göndermek tutarlılığı tamamlar. Bunun için mimar onayı gerekir ([mimar] + [backend-dev Go]). Monitör diyaloğu için de aynı durum geçerli (30 sn yedek yolla kapanıyor).
2. **Konsol monitör bekleme süresini yansıtmıyor.** `canRequestMonitor` 30 sn ret/yanıtsızlık beklemesine bakmıyor. Ret veya "onaylamadı" sonrasında ilk tıklama her zaman sunucudan `RATE_LIMITED` alıyor ("rate" notu). Konsol zamanlayıcısı sunucununkinden birkaç ms önce bitiyor. Bu aralıkta yapılan tıklama `CONFLICT` alırsa `machine.ts` `error` dalı CONFLICT'i işlemiyor ve `monitorPending` 30 sn boyunca yanlış gösteriliyor. Öneri: monitör için yerel 30 sn bekleme + CONFLICT'te `monitorPending` sıfırlama ([frontend-dev]).
3. P5 `AC-39 axe (light/dark)` e2e testi yük altında ara sıra 30 sn zaman aşımına düşüyor (frontend raporu, 3 tam koşudan 1'i). Kararsız test olarak izlenmeli. Gerekirse test süresi veya axe kapsamı daraltılmalı ([frontend-dev]).
4. S7-9 (`env.state.selfElevated`) mimar kararı bekliyor (Agent karar 5). Güvenlik Tur 2 ile birlikte kapatılmalı.

## Olumlu
- Kapatma yönünde hiçbir yol DB'yi beklemiyor (önce bellek + mesaj, sonra kayıt). Açma yönü fail-closed. Granting sırasındaki kapatma `interrupt` ile doğru aktörle dengeleniyor.
- K3 iki katmanlı uygulandı: sunucu revoke + istemci `peer.left/joined{tech}`. Sıra entegrasyon testiyle sabitlendi.
- Konsolun eşzamanlı makine kopyası (`ctl` ref) ile beklenmeyen-izin/bırak/vazgeç kararları render beklemeden veriliyor. Unit ve e2e testleri var.
- Go'da kanca/kısayol iş parçacığının kilit beklememesi (S7-3) ve olay-özgü enjeksiyon kaynağı (S7-5) testle sabitlendi. -race yeşil.
- TECH migration'ı yasal kanıtı koruyan geri alma notuyla yazıldı.

---
## Tur 3 — kısa regresyon (2026-11-11)
Denetçi: qa-denetci (kod değiştirilmedi). Kapsam: güvenlik Tur 2 düzeltmeleri (S7-12..S7-16) ve mimar kararları K6–K8. Kaynaklar: `implementation.md` "Backend P7 — düzeltme turu 2", "Agent P7 — düzeltme turu 2", "Frontend P7 — düzeltme turu 2"; `mimari-protokol.md` §3/§3.3; `gereksinimler.md` "Sonra / açık — P7'den".

### Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 temiz |
| `pnpm -r run typecheck` | 3/3 temiz |
| `pnpm -r run test` | contracts 43/43 · server unit 244/244 · web 124/124. Kırmızı ve skip yok |
| `test-db.sh up` (geçici MySQL 8.4 `rs-mysql-qa-p7t3`, port 33393, 6 migration) + `pnpm --filter @remote/server test:int` | **23 dosya / 186 test geçti**. Konteyner `down` ile silindi (doğrulandı) |
| `pnpm --filter @remote/web e2e` (**tam paket**, Tur 2'de koşulamamıştı) | **149 geçti / 41 atlandı / 0 kırmızı** (58 sn). Atlananların hepsinin gerekçesi dosyada: `mobile` projesinde konsol/masaüstü akışı (p4/p5/p6/p7, sessions sütun başlıkları) ve `E2E_REAL` gerektiren `p4-real`. Çıktıdaki `[WebServer] Failed to proxy … socket hang up` satırı mock WS kapanışında oluşan gürültü, test sonucunu etkilemiyor |
| Go (docker `golang:1.26.11-bookworm`, `apps/agent-win`) | `gofmt -l` boş · `go vet ./...` OK · `GOOS=windows GOARCH=amd64 go vet ./...` OK · `go test -race -count=1 ./...` **15/15 paket ok** |

Bildirilen sayılar (implementation.md) ile birebir aynı.

### Tur 2 bulgularının kapanışı
| ID | Durum | Kanıt |
|---|---|---|
| QA-P7-T2-1 (Sonra / açık kaydı) | ⚠️ kısmen kapandı | Eklenenler: `gereksinimler.md` "Sonra / açık — P7'den" tablosu (Windows elle testi P7: adım 25–42, AC-48/49/100/102/103/104/105/116 + S7-3/5/6/7/12; S7-11; govulncheck; AC-39 kararsız test; CHECK harf duyarsızlığı). P6 tablosundaki "Fare imleci" satırı yeniden tarihlendi ("P8 öncesi", gerekçeli). **Eksik:** P6 tablosundaki "Windows elle testi" (P6: AC-95/96/103/106/110/118/108/41) ve "TEST-NAT-3 / AC-41" satırlarının hedefi hâlâ "P7 başlamadan". P7 kapanırken bu hedef geçersiz oldu. Ayrıca P7 satırının "Ne zaman"ı "S7-12 düzeltmesinden sonra" yazıyor. S7-12 düzeltildiği için bu ifade artık bir son tarih vermiyor. Bkz. Düzeltilmeli 1 |
| QA-P7-T2-2 (CONFLICT satırı) | ✅ kapandı | §3 `control.request` satırında kontrol sırası (1)–(7) var: REQUESTED → CONFLICT "Önceki kontrol isteği müşteride bekliyor." (yeniden istek için önce `control.cancel`), GRANTED/granting → CONFLICT "Kontrol zaten açık.". §3.3 tablosuna iki satır eklendi. "P7 Tur 2 kararları" madde 10. Kod (`handleControlRequest`) ve int testi değişmedi, yeşil |

### K6 / K7 / K8 üç taraf tutarlılığı
| Karar | Sunucu | Go istemci | Konsol | Sonuç |
|---|---|---|---|---|
| K6: PC kopması ile bekleyen istek kapanır | `control.ts` `onView`: REQUESTED + `{VIEW, UI\|HOTKEY\|SYSTEM}` → VIEW, teknisyene `{VIEW, <source>}`. Consent yok, `deniedAt` ve sayaç değişmiyor. Audit `control.cancelled{by:"agent", source}` en iyi çabayla yazılıyor, metrik `cancelled_by_agent`. `onView` oda kuyruğunda (`enqueue`) koştuğu için granting penceresiyle çakışmıyor. int: K6 oda katmanı (SYSTEM/UI/HOTKEY) + gerçek WS | `flow.go` `onPeer` disconnected/failed/closed: `closeControl` sonucunda `ctlPrompt && !granted` ise tek `{VIEW,SYSTEM}`. Kapı açıksa `closeControl` zaten gönderiyor, mesaj çift gitmiyor. Sunucunun bildiği kapanışlarda (revoke, release/cancel, caps.update, peer.left/joined{tech}, hello) ve WS kopmasında mesaj yok. Monitör diyaloğu mesajsız kapanıyor. Testler: `TestK6PeerDropWithOpenPromptSendsViewSystemOnce`, `TestK6PeerDropGrantedIdleAndMonitorPrompt`, `TestK6ServerKnownClosuresSendNothingForPrompt` | `machine.ts`: `requested` + `{VIEW,SYSTEM}` → `ended{agent}`, `lastSent` sıfırlanıyor, bekleme yok, sayaç iade edilmiyor (sunucuyla aynı). Metin `p7.end.agent`. Unit K6 + e2e "K6" (2. istek gidiyor) | ✅ |
| K7: CONFLICT / RATE_LIMITED yansıtması | Protokol değişmedi (zarfa süre eklenmedi). Monitör: bekleyen varken CONFLICT, ret sonrası 30 sn RATE_LIMITED, etkin monitör → VALIDATION (S7-15) | — | Monitör: `MONITOR_BLOCK_MS = CONTROL_DENY_COOLDOWN_MS + 1 sn` (contracts sabitinden). `monitor.denied` / yanıtsızlık / CONFLICT / RATE_LIMITED / FORBIDDEN bekleme başlatıyor ve sayacı geri alıyor. VALIDATION → "zaten paylaşılıyor", bekleme yok. Kontrol CONFLICT: faz değişmiyor, sunucu metni `notice`'te. `Segmented` `disabled` + geri sayım. Unit K7 ×3 + e2e AC-43/105 geri sayım | ✅ |
| K8: `env.state.selfElevated` | Şema strict + zorunlu (contracts, fixture). `handleEnvState` yalnız AGENT, alanları yeniden kurarak iletiyor. `room.guestEnv` misafir kopmasında temizleniyor. GRANTED audit `selfElevated: "true"\|"false"\|"unknown"`. int: eksik alan → 1008, audit "unknown" sonra "true", BROWSER yok sayılıyor | `messages.go` `json:"selfElevated"` (omitempty yok). `helloEnv` her hello sonrası tek env.state gönderiyor (`closeControl`'den sonra, monitör seçiminden önce). `main.go` açılışta bir kez ölçüyor. Testler: `TestK8EnvStateAfterEveryHelloWithSelfElevated`, `TestK8EnvStateWithoutProbe` + signal fixture | `env.self` → `stage.tsx` kalıcı rozet (`role=status`, `ShieldUser` `aria-hidden`, `bg-warning-surface`/`text-warning` tokenları, metin mimarideki ile birebir). Kontrol engellenmiyor. hello/kopmada sıfırlanıyor. e2e `stage-self-elevated` + axe 0 | ✅ |

### Kabul kriterleri (Tur 3)
Tur 2 tablosu geçerli. Hiçbir AC'nin kanıtı zayıflamadı. Değişen kanıtlar:
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-43 | ✅ | int S7-15 (kopmada bekleyen istek temizleniyor, yeni bağlantının ilk `share.state`'i onay sayılmıyor, gerçek WS dahil). Etkin monitör → VALIDATION. e2e AC-43/105 (K7 geri sayımı) |
| AC-105 | ✅ iletim / Windows elle test bekliyor | K8 `selfElevated` uçtan uca (contracts + int + Go + e2e). Gerçek UAC elle (adım 33, 42) |
| AC-116 | ✅ mantık / Windows elle test bekliyor | S7-12: `control.OriginInjected`/`CharInjected` fail-closed (`TestS712*`, her IMO değeri, başarısız sorgu). Win32 bağlaması elle (adım 38'e eklendi) |
| AC-104 | ✅ mantık / Windows elle test bekliyor | S7-16 nesil sayaçlı kapı: `TestS716StaleHooksOffIgnoredAfterReopen`, `TestS716GenerationRaceFree` (-race yeşil). Elle adım 37 |
| AC-101 | ✅ | S7-13 `TestS713ReleaseExemptionOnlyForHeld` (basılı olmayanı bırakma 0 olay, jeton harcıyor) |

Diğer AC'ler (AC-24, 47, 48, 49, 50, 51, 99, 100, 102, 103, 111, 115) Tur 2'deki durumlarında kalıyor. Windows elle test bekleyenlerin erteleme kaydı artık `gereksinimler.md` P7 tablosunda.

### Düzeltilmeli (GEÇTİ'yi engellemez; P8 kod turundan önce)
1. **[proje-yoneticisi] `docs/gereksinimler.md` "Sonra / açık — P6'dan" tablosu.** "Windows elle testi" ve "TEST-NAT-3 / AC-41" satırlarının "Ne zaman" sütunu hâlâ "P7 başlamadan". Fare imleci satırında yapıldığı gibi yeni bir hedef yazılmalı ve kaymanın notu düşülmeli. Öneri: "P7 Windows elle testiyle aynı oturumda, P8 kod turundan önce". Aynı dosyada "Sonra / açık — P7'den" tablosundaki "Windows elle testi (P7)" satırının "Ne zaman"ı da somut bir hedefle değiştirilmeli (ör. "P8 kod turundan önce; en geç prod açılışı (P10) öncesi"). "S7-12 düzeltmesinden sonra" ifadesi artık son tarih vermiyor.

### Definition of Done (Tur 3)
| Madde | Durum | Not |
|---|---|---|
| 1. AC'ler testle kanıtlı, testler yeşil | ✅ (Windows elle kısım ertelendi, kayıtlı) | Unit, int, tam e2e ve Go -race yeşil |
| 2. Lint/format/type temiz | ✅ | pnpm lint/typecheck, gofmt, iki vet temiz |
| 3. qa GEÇTİ + güvenlik Kritik/Yüksek 0 | ✅ qa / güvenlik bekliyor | `guvenlik-raporu.md`'deki son P7 durumu: "Tur 2: DÜZELTİLMELİ (Yüksek 1: S7-12)". S7-12 kodda düzeltildi ve testi var, ancak güvenlik Tur 3 doğrulaması paket kapanış şartı |
| 4. test-operatoru tarama | sıradaki adım | Tam e2e paketi bu turda koşuldu (Tur 2'deki eksik giderildi) |
| 5. Migration + seed | ✅ | Bu turda yeni migration yok (K8 audit `newValue`'da). Temiz DB'de 6 migration uygulandı |
| 6. Dokümantasyon güncel | ✅ (bir satır tarih kaldı) | §3/§3.3 K6–K8, ADR-0013 Ek, DESIGN §6 (`segmented` disabled), implementation.md üç bölüm güncel. Kalan: Düzeltilmeli 1 |
| 7. Sapmalar gerekçeli | ✅ | Backend: VALIDATION seçimi, Peer eşlemesi. Agent: karar 1–5 (UIAccess sınırı kabul edildi). Frontend: "Yok" (`Segmented` küçük ek DESIGN'a işlendi) |
| Yeni bağımlılık yok / AGPL-GPL yok | ✅ | Üç bölüm de yeni bağımlılık yok diyor. `package.json` değişikliği yalnız contracts içi |

### Öneriler (zorunlu değil)
1. **[backend-dev Go] PeerConnection olayları bağlantıya göre etiketlenmiyor.** `flow.go` `handlers()` → `peerEvent{state}` hangi PC'den geldiğini taşımıyor. `hello` → `dropPeer` (eski PC `Close()`) sonrasında eski PC'nin geç gelen `closed` olayı, yeni PC döneminde açılmış bir kontrol diyaloğunu kapatabilir. K6 ile bu durumda yeni isteği `{VIEW,SYSTEM}` ile iptal de ettirir. Hata kapatma yönünde ve güvenli (§3.3 K6 kalan riskiyle aynı sınıf), ancak teknisyen nedensiz "Müşteri tarafında bağlantı kesildi" görebilir. Öneri: `handlers()`'a PC nesil numarası verilip `onPeer`'de güncel nesil dışındaki olaylar yok sayılsın. Windows elle testinde F5 + hemen "Kontrol iste" adımıyla gözlenebilir.
2. **[frontend-dev] `requested` fazında `{VIEW, UI|HOTKEY}`.** Sunucu K6 satırına göre bu kaynakları da iletiyor. Konsol bunları "Kontrol müşteri tarafından kapatıldı / kısayolla kapatıldı" olarak gösteriyor ve `lastSent` sıfırlanmıyor. Go istemci bu durumu üretmiyor (`closeControl` yalnız kapı açıkken gönderiyor), bu yüzden şu an gözlenemez. Tutarlılık için `requested`'deki her VIEW (DENIED hariç) `ended{agent}` olarak işlenebilir.
3. Tur 2'deki AC-39 axe kararsız test önerisi `gereksinimler.md` P7 tablosuna taşındı. Bu turdaki tam koşuda kararsızlık görülmedi (1 koşu).

### Olumlu
- K6 üç tarafta dar ve doğru kapsamlı: istemci yalnız sunucunun bilmediği kopmada gönderiyor. Sunucu müşteriye ret atfetmiyor (consent yok, bekleme yok) ama `control.requested`'in kapanışını audit'e yazıyor.
- K8 alanı `omitempty` olmadan ve strict şemayla eklendi. Eksik alanın 1008 vermesi gerçek WS testiyle sabitlendi. Audit'te `unknown` durumu var.
- S7-12 kararı saf ve test edilebilir bir pakete (`control/origin.go`) taşındı. S7-16 nesil sayacı Open/Shut yarışını tek atomik değerle kapatıyor.
- S7-15'te bağlantı kimliğiyle eşleme için yeni sayaç/epoch gerekmedi. Mutasyon kontrolüyle testlerin gerçekten koruduğu gösterildi.
- Tur 2'de eksik kalan tam e2e paketi yeşil, P1–P6 regresyonu yok.
