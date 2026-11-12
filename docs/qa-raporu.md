# QA Raporu — P8b-2 (Windows Go istemci 0.9.0) — Tur 2
DURUM: GEÇTİ

Kapsam: Bu tur yalnızca Tur 1 maddelerini (QA-P8b2-1, QA-P8b2-2, öneri 2 "1001 Release", öneri 3 "Tab sırası") ve güvenlik bulgularını (S8b2-1/2/3) doğrular. Gerileme de kontrol edildi. Düzeltme notu: `docs/implementation.md` "Backend (Go) P8b-2 — düzeltme turu 1". Windows elle testleri (Tur 1 listesi ve düzeltme notundaki a/b/c adımları) karara dahil edilmedi.

## Test sonucu
Komut: docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `GOFLAGS=-mod=readonly GOTOOLCHAIN=local`; sırasıyla `gofmt -l .`, `go test -count=1 ./...`, `go vet ./...`, `GOOS=windows GOARCH=amd64 go vet ./...`.
- `gofmt -l`: çıktı boş.
- `go test`: 17 paketin tamamı `ok` (request, remember, flow, api, ui, win dahil). FAIL yok, skip yok.
- `go vet` (linux + windows/amd64): temiz. Bu, `ui/request_windows.go` ve `screens_windows.go` için tek otomatik doğrulama.

## Tur 1 maddelerinin doğrulaması
| Madde | Durum | Kanıt |
|---|---|---|
| QA-P8b2-1 ölü/kopya anahtar üretimi | ✅ | `remember.NewDeviceKey` kaynakta ve testlerde yok (grep 0). Tek üretim yolu `request/run.go` `newKey()`; `clientInstanceId` ve `deviceKey` bunu kullanıyor. |
| QA-P8b2-2 silme hatası yutuluyor | ✅ | `forget()` başarısız olursa `forgetWarn` atanıyor; başarılı bir silmede temizleniyor. Uyarı formda `Notice` başında, bekleme ekranında `WaitView.Warning` olarak görünüyor. `reqWait` bu uyarıyı `Notice` ile birleştiriyor, yeniden bağlanma bildirimi onu silmiyor. "Bilgilerimi unut" başarısız olursa "silindi" yazılmıyor. Testler: `TestAC137ForgetFailureVisible` (talep gidiyor, `first.Warning == noticeForgetFail`) ve `TestAC137ForgetButtonFailureVisible` (uyarı doğrulama hatasında da kalıyor). |
| Öneri 2: 1001 Release | ✅ | `Outcome.Release(ReleaseKind)`: `ReleaseFailed` → `conn.Close(false)` (1001), REST iptal yok. `ReleaseAbandoned` → 1000; soket kopuksa REST iptal. `main.go:135-139`: `out.Failed` ise Failed, değilse Abandoned. `flow.Outcome.Failed` yalnızca ağ ya da protokol yollarında true (`flow.go:337,365,367,384`). Testler: `TestAC154ReleaseKinds` (1001 + 0 iptal, 1000, tek çalışma) ve `TestRunTicketDialFailureIsFailed`. |
| Öneri 3: Tab sırası | ✅ (klavye kaydı Windows elle) | "Kötüye kullanımı bildir" artık `fraudText`'ten hemen sonra oluşturuluyor (`request_windows.go:175`). Kod yorumu ve implementation.md AC-164 satırı (2241) aynı sırayı yazıyor. Açılış odağı `r.name`. |
| S8b2-1 kişi değişikliğinde açık rıza | ✅ | `rememberPlan` saf fonksiyonu: kutu işaretsizse kayıt yok. Hatırlanmış kişinin adı veya telefonu değişmiş ve kutu bu oturumda seçilmemişse (`!RememberChosen`) yine kayıt yok, dosya siliniyor, `deviceKey` gönderilmiyor. Kişi değişip kutu seçilmişse yeni `deviceKey` üretiliyor. UI tarafında programatik `SetText` sırasında `filling` bayrağı var, böylece EN_CHANGE müşteri düzenlemesi sayılmıyor. Müşteri dokunmamışsa kutu işaretsize çekiliyor. `BN_CLICKED` → `chosen`. Testler: `TestAC136RememberPlan` (6 durum) ve `TestAC136ChangedIdentityNotSavedWithoutOptIn` (kayıt yok + `forgot==1` + anahtar boş / yeni 22 karakterlik anahtar ≠ A'nınki). |
| S8b2-2 WS dial geri çekilmesi | ✅ | `dialRetryDelay`: 2→4→8→15 sn, üzerine 0..1 sn `crypto/rand` jitter. `Retry-After` alt sınır olarak kullanılıyor, en fazla 60 sn. Bekleme kalan bütçeye (110 sn) kırpılıyor. `DialError.RetryAfter` değeri `api.ParseRetryAfter` ile doluyor; REST ile aynı kural. 403 ve 426 kesin hata. Testler: `TestS8b22DialRetryDelay` ve `TestS8b22DialBackoffInWaitLoop` (20 sn → 4 → 8). |
| S8b2-3 Unicode biçim/bidi süzgeci + başlık yenileme | ✅ (başlık yenileme Windows elle) | `Display` tek süzgeç: Zl/Zp ve CR/LF/TAB boşluğa çevriliyor; Cc, Cf, U+034F ve U+180E siliniyor. Uygulandığı alanlar: tenant adı, `technicianName` (boşsa "Teknisyen"), `closed.message`, WS `error.message`, REST `message`/`fields`. Onay diyaloğuna farklı bir teknisyen adı gelirse `closeDlg` çağrılıyor; `finish()` geri çağrı yapmadığı için yanlışlıkla Decline yayılmıyor. Ardından yeni diyalog açılıyor ve 1,5 sn kilit yeniden başlıyor. Ad aynıysa yalnızca gövde güncelleniyor. Testler: `TestS8b23Display` ve `TestS8b23ServerTextsSanitized`. |

## 1001 kapanışı ile sunucu uyumu
`apps/server/src/requests/ws.ts:108-117`: Kapanış kodu 1000 ise `customerCancel` çalışıyor (ACCEPTED+PENDING oturumda `service.ts:330-348` → `customer_declined`). Diğer kodlarda talep yalnızca PENDING ise 120 sn kopma sayacı kuruluyor. ACCEPTED talebe dokunulmuyor ve 60 sn penceresi dolunca `connectTimeout(…, "connect_timeout")` (`service.ts:414,430-446`) → `CONNECT_FAILED` oluyor. İstemcinin `ReleaseFailed` davranışı (1001, REST iptal yok; soket zaten kopuksa da iptal yok) bu sözleşmeyle birebir uyumlu. Sunucu ve contracts değişmedi.

## Gerileme kontrolü
- Hatırlama: aynı kişi + işaretli → eski `deviceKey` korunuyor. İlk kez işaretleme → yeni anahtar. `create` başarısız olursa kayıt yapılmıyor (Save yalnızca `err == nil` dalında). Tur 1 AC-136/137 testleri yeşil.
- Talep oluşturma yeniden deneme politikası (`createRetryDelay`) değişmedi. `ParseRetryAfter` yeniden adlandırması `api` testlerinde yeşil.
- `forget` boş dizini temizleme davranışı (`remember.Store.Forget`) değişmedi.
- Yeni bağımlılık yok (go.mod/go.sum değişmedi).

## Kabul kriterleri (yalnızca bu turda etkilenenler)
| AC | Durum | Kanıt |
|---|---|---|
| 136 | ✅ | `TestAC136RememberPlan`, `TestAC136ChangedIdentityNotSavedWithoutOptIn` + Tur 1 testleri |
| 137 | ✅ (iz testi Windows elle) | `TestAC137ForgetFailureVisible`, `TestAC137ForgetButtonFailureVisible` + Tur 1 testleri |
| 154 | ✅ (diyalog Windows elle) | `TestAC154ReleaseKinds`, `TestS8b23ServerTextsSanitized` |
| 164 | ✅ (klavye kaydı Windows elle) | Tur 1 testi + oluşturma sırası kodda doğrulandı |
Tur 1'de ✅ olan diğer AC'ler: testler yeşil, gerileme yok.

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil, skip yok | ✅ | 17/17 paket ok |
| gofmt / vet (linux + windows) | ✅ | temiz |
| Ölü/kopya kod yok | ✅ | QA-P8b2-1 kapandı |
| Hata yutma yok | ✅ | QA-P8b2-2 kapandı |
| Güvenlik bulguları (S8b2-1/2/3) | ✅ | üçü de düzeltildi ve testlendi |
| Sözleşme uyumu (sunucu) | ✅ | 1000/1001 semantiği birebir |
| Yeni bağımlılık gerekçesi | ✅ | yeni bağımlılık yok |
| implementation.md güncel | ✅ | düzeltme turu tablosu + AC-164 satırı |
| Windows elle testleri | — | Karara dahil değil. Tur 1 listesine ek olarak düzeltme notundaki (a), (b), (c) adımları test-operatoru veya kullanıcı tarafından yapılmalı. |

## Öneriler (zorunlu değil)
1. [teknik-yazar] `docs/KULLANIM_KILAVUZU.md`'ye S8b2-1 cümlesi eklenmeli ("ad veya telefonu değiştirirseniz hatırla kutusu kendiliğinden kaldırılır…"). Şu an kılavuzda yok.
2. [backend-dev Go] Bağlantı koptuktan sonra ilk yeniden deneme beklemesiz yapılıyor; jitter yalnızca başarısız denemeden sonra devreye giriyor. Sunucu yeniden başladığında aynı NAT arkasındaki istemciler ilk turda eşzamanlı deniyor. İlk denemeye de 0..1 sn jitter eklenmesi düşünülebilir. Düşük öncelikli.

## Olumlu
- Hatırlama kararı saf bir fonksiyona (`rememberPlan`) ayrılmış ve tablo testiyle bütün dallar kapsanmış.
- `Display` tek noktadan uygulanıyor; REST ve WS metinleri aynı kuraldan geçiyor.
- Release semantiği kod yorumlarında sunucu davranışıyla birlikte açıklanmış ve tek seferlik (`sync.Once`).

---

# QA Raporu — P8b-2 (Windows Go istemci 0.9.0) — Tur 1
DURUM: DÜZELTİLMELİ

Kapsam: `apps/agent-win` (çalışma ağacı, commit edilmemiş P8b-2 değişiklikleri). Ölçüt: mimari.md §10 P8b-2 (satır 437, 457),
mimari-e9 §13 (r2), ADR-0004 r3, ADR-0006 r4, ADR-0016, mimari-protokol §5, AC 133, 134, 136–139, 141, 142, 154, 156, 157,
161–164 (istemci kısımları), kalite-standartlari. P8b-1 raporu: `docs/arsiv/p8b1-qa-raporu.md`.

Özet: işlev ve sözleşme uyumu iyi durumda. Testler yeşil, AC'lerin otomatik testlenebilir kısımları kanıtlı. DÜZELTİLMELİ
kararının nedeni iki küçük kalite maddesi: ölü/kopya kod (QA-P8b2-1) ve yutulan silme hatası (QA-P8b2-2). Windows elle
testleri bu karara dahil edilmedi; aşağıda kullanıcıya bırakılanlar olarak listelendi.

## Test sonucu
Docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `GOFLAGS=-mod=readonly`, `GOTOOLCHAIN=local`:

| Komut | Sonuç |
|---|---|
| `go test -count=1 -v ./...` | 17 paket ok, **176 PASS, 0 FAIL, 0 SKIP** |
| `go test -race` (request, remember, flow, api, pairing) | ok |
| `go vet ./...` | temiz |
| `GOOS=windows GOARCH=amd64 go vet ./...` | temiz |
| `GOOS=windows go test -c` (tüm paketler) | hepsi derleniyor |
| `gofmt -l .` | boş |

go.mod/go.sum değişmedi, yeni bağımlılık yok.

## Sunucu sözleşmesi uyumu (birebir kontrol)
| Konu | Sonuç |
|---|---|
| `createRequestInputSchema` alanları (ref, clientInstanceId 22, clientVersion, customerName, phone, email?, description, consentTextId, consentAccepted, deviceKey? 22) | ✅ `api.CreateRequestBody` aynı; `deviceKey` yalnız hatırla açıkken |
| `TenantRequestInfo` (tenant.name/logoUrl, consentText, waitMinutes, abuseEmail, minAgentVersion) | ✅ |
| `CreateRequestResponse` | ✅ |
| `/ws/request` mesajları (`requestOutboundSchema` strict, `request.closed` refine, `error` kodları) | ✅ `ParseServer` aynı kuralları uyguluyor; ortak fixture testi var (`TestAC154WsRequestMatchesContractsFixture`) |
| Giden mesajlar `request.cancel` / `request.decline` | ✅ |
| Subprotocol `rs.v1, rs.req.<sır>`, sorgu dizesi yok, Origin yok | ✅ (`ws.ts` 403 kuralları ile uyumlu) |
| Kapanış 1000: PENDING'de iptal, ACCEPTED + oturum PENDING'de vazgeçme (`customerCancel`) | ✅ İstemci 1000'i yalnız pencere kapatma, iptal zaman aşımı ve hello sonrası `Release` için kullanıyor |
| Kapanış 1001: ACCEPTED talebi değiştirmez (sunucu yalnız PENDING'de 120 sn sayacını kuruyor) | ✅ Onay süresi dolunca 1001, sunucuda CONNECT_FAILED olur |
| CANCELLING yarışı | ✅ Sunucu kabulü iptalden önce commit ederse ACCEPTED yolu decline olarak işleniyor; istemci CANCELLING'de gelen `request.accepted`'ı yok sayıp decline gönderiyor; yanıt gelmezse 4 sn sonra 1000 ile kapatıyor ve sunucu yine decline yapıyor. Her sıralamada sonuç CANCELLED |
| Upgrade 403 / 426 / 4409 / 1008 | ✅ 403 → "artık geçerli değil", 426 → eski sürüm ekranı, 4409/1008 → kesin son, yeniden bağlanma yok |
| 503 `NOT_READY` + `Retry-After` | ✅ En çok 2 deneme, bekleme 1..15 sn + jitter; diğer hatalar denenmiyor (S8b-8) |
| resolve `clientVersion` (G-E9-4) | ✅ |

## Sapma #1 kararı — hatırlanmış bilgiyle kutucuk işaretli açılıyor
**Kabul edildi (uyumlu).** Gerekçeler:
- AC-136 "varsayılan işaretsiz; müşteri kendisi işaretler" kuralı ilk açılışta ve "unut" sonrasında korunuyor. Dosya, müşteri kutucuğu kendisi işaretleyip gönderdiyse var.
- AC-137 "işaretsiz gönderimde dosya silinir" kuralı ile birlikte okunduğunda, kutucuk her açılışta işaretsiz gelseydi AC-136'daki "sonraki açılışta formu doldurur" davranışı ikinci gönderimde kendiliğinden bozulurdu. AC'ler kendi içinde ancak bu yorumla tutarlı.
- G-E9-13'ün güvenlik amacı (paylaşılan bilgisayar) ipucu satırı ve her zaman görünen "Bilgilerimi unut" düğmesiyle karşılanıyor.

Öneri: proje-yoneticisi, AC-136'ya "önceki tercih yoksa" açıklamasını değişiklik kaydıyla eklesin (aşağıda Öneriler).

## Kabul kriterleri (istemci kısımları)
| AC | Durum | Kanıt / eksik |
|---|---|---|
| 133 | ✅ (5 sn ve görsel kısım Windows elle) | `TestAC133RefFromFileNameMatchesContractsFixture`, `TestAC133InfoProblemsAndCodeMode` (TLS ve ağ ayrı mesaj, 404 ise yalnız kod yolu), `TestAC133OutdatedBlocksFormAndOpensFixedURL` (form açılmıyor, sabit URL), `TestAC133OutdatedAndDownloadURL`, `TestAC133TenantInfoGetWithRefNoOrigin`, `TestAC133ResolveOutdatedIsFinal`; firma adı yalnız sunucudan, footer `u.footer` |
| 134 | ✅ | `TestAC134FormMatchesContractsFixture` (ortak `request-form.json`), `TestAC134ValidateFieldErrorsAndOrder`, `TestAC134BoundaryLengths` |
| 136 | ✅ (DPAPI Windows elle) | `TestAC136SaveLoadOnlyAllowedFields`, `TestAC136CorruptOrForeignFileDeletedSilently`, `TestAC139AC154HappyPathRememberAndShare` (yalnız 201 sonrası yazım, deviceKey 22), `TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey`, `TestGE913StaleTmpRetriedOnce`; sapma #1 kabul edildi |
| 137 | ✅ (iz testi Windows elle) | `TestAC137ForgetRemovesFileAndEmptyDir`, `TestAC137ForgetKeepsNonEmptyDir`, `TestAC137ForgetClearsForm`. Not: işaretsiz gönderimde silme hatası yutuluyor (QA-P8b2-2) |
| 138 | ✅ betik / Windows elle | `trace-check.ps1 -Remember on` izin listesi yalnız klasör + `hatirla.bin`; dosya yoksa da hata veriyor |
| 139 | ✅ | `TestAC139StateOnlyWhileWaiting`, mutlu yol testi (kod, sıra); `codeText` "123 456"; geçen süre serverTime−createdAt |
| 141 | ✅ (5 sn / 3 sn ölçümü staging) | `TestAC141WindowCloseSendsCancelThenClose`, `TestAC141CancelTimeoutEndsWithIntent`, `TestAC141ReconnectAfterDropAnd403Ends`, `TestAC141CancelRequest204`; mutlu yol testinde kapatma: önce `request.cancel`, sonra 1000 |
| 142 | ✅ | `TestAC142ExpiredRecreateKeepsForm` (form dolu), `TestAC142AC157ClosedViews` |
| 154 | ✅ (p95 3 sn, enjekte tıklama, 1,5 sn Windows elle) | `TestAC154AcceptedThenShare`, `TestAC154ShareIgnoredBeforeAccept`, `TestAC154CancellingIgnoresLateAccept`, `TestAC154CancelRaceDeclinesLateAccept` (uçtan uca: decline gönderiliyor, onay ekranı açılmıyor), `TestAC154DeclineAndWindowCloseWhenAccepted`, `TestAC154WsRequestMatchesContractsFixture`; mutlu yolda `/ws/request` hello'ya kadar açık. Onay diyaloğu ortak P7 `consentDlg` (odak Vazgeç, `noKey`, kilit) |
| 156 | ✅ | `TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted` + değişmeyen P7 `session.run` testleri |
| 157 | ✅ (`&` görünümü Windows elle) | `TestAC142AC157ClosedViews`; ret metni `f.label` (`SS_NOPREFIX`) ile statik |
| 161 | ✅ | `TestAC161FileNameModesAreDisjoint`, `TestAC97*` testleri değişmeden yeşil |
| 162 | ✅ (Windows elle) | `main.go` `OutCodeMode` → `flow.Run(ctx, deps, "")`; `TestAC133InfoProblemsAndCodeMode` OutCodeMode sonucunu kanıtlıyor |
| 163 | ✅ (UAC yokluğu Windows elle) | `OutClose` → `exitOK`; kapatma yolu `TestAC136UncheckedSubmit…` içinde |
| 164 | ✅ (klavye kaydı Windows elle) | `TestAC134AC164ValidationErrorsFocusFirstField`; `BS_DEFPUSHBUTTON` "Destek iste", açıklama alanı `ES_WANTRETURN`'süz, `IsDialogMessage` kullanılıyor |

## Düzeltilmeli
1. **QA-P8b2-1 [Düşük]** `apps/agent-win/internal/remember/remember.go:151-158` ve `internal/request/run.go` `randomKey()`
   - Sorun: `remember.NewDeviceKey` üretimde hiçbir yerden çağrılmıyor; yalnız testte kullanılıyor. Aynı işi `run.go`'daki `randomKey()` yapıyor. Bu, kopya ve ölü kod (proje CLAUDE.md "kullanılmayan kod yok", kalite standardı).
   - Öneri: `deviceKey` üretimini `remember.NewDeviceKey()` ile yap ve hatasını ele al, ya da `NewDeviceKey`'i ve onun testini kaldır. Tek üretim yolu kalsın.
   - Atanan: backend-dev (Go).
2. **QA-P8b2-2 [Düşük]** `apps/agent-win/internal/request/run.go`, `form()` içindeki `if !f.Remember { r.forget() }`
   - Sorun: AC-137 gereği işaretsiz gönderimde dosya silinmeli; ancak `forget()` false dönerse hata sessizce yutuluyor. Müşteri dosyanın silindiğini sanıyor ama şifreli kişisel veri diskte kalıyor (hata yutma).
   - Öneri: silme başarısızsa talep yine gönderilsin, ama müşteriye `noticeForgetFail` gösterilsin (ör. bekleme ekranı `Notice` alanında ya da forma dönüşte).
   - Test: `memRemember.Forget` hata döndürdüğünde uyarının gösterildiğini doğrulayan bir birim testi ekle.
   - Atanan: backend-dev (Go).

## Windows elle testleri (kullanıcı / test-operatoru; DÜZELTİLMELİ kararına dahil edilmedi)
`docs/implementation.md` "Backend (Go) P8b-2 → Windows elle test adımları" 1–20. Özetle:
- iz testi `-Remember off/on`
- yeniden açılış ve ipucu
- "Bilgilerimi unut" (≤ 1 sn, klasör siliniyor)
- başka Windows kullanıcısıyla DPAPI
- klavye kaydı (AC-164)
- firma penceresinin ≤ 5 sn'de UAC'siz açılması ve footer
- ağ/TLS hata ekranları
- bekleme, sıra ≤ 10 sn, iptal ≤ 5 sn
- kopma ve yeniden bağlanma
- onay diyaloğu (p95 ≤ 3 sn, odak, 1,5 sn kilit, enjekte tıklama, FlashWindow)
- Vazgeç toast'ı, iptal–kabul yarışı, 60 sn süre dolumu
- ret metninde `&`
- 10 dk süre dolumu
- `MIN_AGENT_VERSION` eski sürüm akışı
- ref yenileme
- kod yolu (AC-161/162)
- iki tenant dosyası SHA-256 eşitliği

Ayrıca devops işi açık: `v0.9.0` etiketi, attestation ve staging ikili yayını.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Testler yeşil, skip yok | ✅ | 176 PASS, race temiz |
| Lint / vet / gofmt (linux + windows) | ✅ | |
| Her AC'nin otomatik kanıtı | ✅ | Windows'a özgü kısımlar elle teste kaldı |
| Sözleşme uyumu (contracts, fixture, sunucu) | ✅ | Yukarıdaki tablo |
| Sapmalar implementation.md'de gerekçeli | ✅ | 9 madde; #1 kabul edildi |
| Ölü/kopya kod yok | ❌ | QA-P8b2-1 |
| Hata yutma yok | ❌ | QA-P8b2-2 |
| Yeni bağımlılık / lisans | ✅ | Yok |
| Gizli bilgi loga/diske girmiyor | ✅ | Sır yalnız bellekte ve subprotocol'de; `deviceKey` DPAPI'li dosyada |
| Windows elle testleri ve yayın | açık (kullanıcı / devops) | Karara dahil değil |

## Öneriler (zorunlu değil)
1. **[proje-yoneticisi]** AC-136'ya şu açıklamayı değişiklik kaydıyla ekle: "varsayılan işaretsiz = önceki tercih yokken; hatırlanmış bilgiyle açılışta işaretli gelir".
2. **[backend-dev Go]** `main.go` `res.Release(false)`: `/ws/guest` hello'dan önce ağ yüzünden başarısız olursa 1000 gönderiliyor. Sunucu bunu `customer_declined` ("Müşteri vazgeçti") olarak yazıyor, ama gerçek neden bağlantı hatası. Kullanıcı Vazgeç'e basmadıysa 1001 gönderilirse sunucu CONNECT_FAILED ("Müşteri bağlanamadı") yazar; bu, durumu daha doğru yansıtır. Kararı mimar versin.
3. **[backend-dev Go]** `request_windows.go`: "Kötüye kullanımı bildir" düğmesi en son oluşturuluyor, bu yüzden Tab sırasında Kapat'tan sonra geliyor. Belgelenen Tab sırasına uymuyor; ya düğme fraud metninden hemen sonra oluşturulsun ya da implementation.md'deki sıra güncellensin.
4. **[backend-dev Go]** `request/ws.go`: sunucu `fullName.slice(0,100)` ile adı UTF-16 sınırında kesiyor; bu, yarım bir surrogate çifti bırakabilir. İstemci şu an bunu kabul ediyor. Etkisi yok, kayıt için yazıldı.

## Olumlu
- Durum makinesi saf mantık ve ayrı testlenmiş. İptal–kabul yarışı hem birim hem uçtan uca testle kapsanmış.
- 1000/1001 kapanış anlamları sunucuyla birebir uyumlu ve kodda açıklamalı.
- Strict şema kuralı tek yerde tutuluyor (`signal.DecodeStrict`), kopyalanmamış.
- 503 yeniden deneme politikası kota bilinciyle tasarlanmış.
- İndirme URL'si sabit biçimli ve yalnız https.
- Yeni bağımlılık yok.
