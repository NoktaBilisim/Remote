# QA Raporu — P8c-2 (Windows istemci 0.10.0) — Tur 2
DURUM: GEÇTİ

Kapsam (dar): Tur 1 "Düzeltilmeli" 1–2'nin kapanışı + gerileme. Düzeltme notu: `docs/implementation.md` "P8c-2 — düzeltme turu 1". S1 güvenlik tarafından kabul edildi.

## Test sonucu
Komut (repo salt okunur, golang:1.26.11-bookworm@sha256:dc40a13b…, GOFLAGS=-mod=readonly, GOTOOLCHAIN=local):
`test -z "$(gofmt -l .)" && go vet ./... && GOOS=windows go vet ./... && go test -count=1 ./...`
- gofmt temiz; `go vet` (linux) ve `GOOS=windows go vet` temiz (zincir `&&`, VET_OK/WINVET_OK basıldı).
- `go test`: 18 paketin hepsi `ok`, FAIL yok. Çıkış kodu 0. Gerileme yok.

## Tur 1 Düzeltilmeli — doğrulama
| # | Durum | Kanıt |
|---|---|---|
| 1 formView RememberNote koşulsuz (AC-188) | ✅ Kapandı | `request.Deps.BindingEnabled` (`internal/request/run.go:41`); `launch/run.go:101` `rd.BindingEnabled = d.Flow.Binding != nil`; form satırı `run.go:307` `r.rememberNote()` → `request/home.go:22` bayrak kapalıyken boş. Testler: `request.TestAC188FormNoteOnlyWhenBindingEnabled` (false → boş, true → dolu), `launch.TestNoStoreDisablesBinding` genişletildi: depo yok → form satırı boş, depo var → dolu, IDN gömülü adres (`https://bücher.example`) → boş. Karşılama ekranı kuralıyla (`flow/binding.go rememberNote`) artık tutarlı. |
| 2 AC-193 izlenebilirlik | ✅ Kapandı | `implementation.md` "AC-193 izlenebilirlik" tablosu her değişen eski testi eski/yeni ad, değişiklik türü ve assert değişimiyle listeliyor; gerekçe (AC-186/188 → AC-137/138) yazılı. Doğrulandı: `TestAC137ForgetRemovesFileAndEmptyDir` geri getirildi (`remember_test.go:208`), `"yanlış sürüm"` vakası geri geldi (`remember_test.go:271`), HEAD'deki 6 eski test adının tamamı mevcut. Assert'i değişen tek eski test `TestAC136SaveLoadOnlyAllowedFields` açıkça belirtilmiş (v 1→2, anahtar araması tırnaklı; yasak anahtar listesi aynı). `request/run_test.go` + `hardening_test.go` diff'inde yalnız sahte nesne (fakeAPI/fakeUI/memRemember) eklemeleri var, assert satırı değişmemiş — beyanla uyumlu. |

Ek olarak düzeltme turunda gelen güvenlik maddeleri (B-P8c2-1/2) ve Öneri 1 (S5 daraltma) testleriyle birlikte yeşil: `TestBP8c21Status404WithoutCodeKeepsBinding`, `TestBP8c22OfferInLobbyIgnored`, `TestS5OnlyBindingErrorCodesSwallowed`. Ayrıntılı inceleme bu turun kapsamı dışında; testler geçiyor.

## Kabul kriterleri (Tur 1'e göre değişenler)
| AC | Durum | Not |
|---|---|---|
| AC-188 (istemci) | ✅ | Düzeltilmeli 1 kapandı (yukarıda). |
| AC-193 (istemci) | ✅ | Düzeltilmeli 2 kapandı; eski testler yeşil, değişiklikler gerekçeli. |
| AC-191 (istemci) | ⚠️ süreç gereği | Kod tarafı ✅. `v0.10.0` yayını (`SHA256SUMS` + attestation) tasarım gereği QA GEÇTİ'den sonra devops tarafından yapılır; QA kararını bloke etmez, yayın sonrası doğrulanmalıdır. |
| Diğerleri (AC-181..187, 189, 190) | ✅ | Tur 1 kanıtları geçerli; gerileme yok. |

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Tüm AC'ler testle kanıtlı | ✅ | AC-191 yayın adımı hariç (süreç gereği QA sonrası) |
| Testler yeşil, skip yok | ✅ | 18 paket ok |
| gofmt / vet (linux + windows) | ✅ | Temiz |
| implementation.md güncel | ✅ | "P8c-2 — düzeltme turu 1" + AC-193 tablosu |
| Yeni bağımlılık yok | ✅ | go.mod/go.sum değişmedi (beyan; Tur 1'de doğrulandı) |
| Yayın (SHA256SUMS + attestation) | Bekliyor | devops, bu GEÇTİ sonrası |

## Öneriler (zorunlu değil)
1. [devops] Tur 1 Öneri 4 güncellendi: geçerli tekrarlanabilir derleme SHA'sı artık `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3` (ilk turdaki `716e9f98…` geçersiz). Yayındaki `SHA256SUMS` bununla eşleşmeli; runbook satırına yazın.
2. [test-operatoru] Windows adım 10'a eklenen senaryoyu (kodsuz 404 → kayıt korunur, "Sunucuya ulaşılamıyor" + "Tekrar dene") ve IDN adreste form satırının görünmediğini elle doğrulayın.

## Olumlu
- Düzeltme dar ve hedefli; bayrak tek yerden (launch) dolduruluyor, karşılama ve form aynı kuralı izliyor.
- İzlenebilirlik tablosu eksiksiz ve kodla birebir; kaldırılan eski testler geri getirildi.

---

# QA Raporu — P8c-2 (Windows istemci 0.10.0) — Tur 1
DURUM: DÜZELTİLMELİ

Kapsam: `apps/agent-win` commit edilmemiş değişiklikleri (17 dosya değişti, +682/−215; yeni `internal/launch`, `api/bindings.go`, `flow/binding.go`, `remember/{data,origin}.go`, `request/home.go`, `ui/home*.go`), AC-181..190, AC-191 (istemci), AC-193; tasarım `docs/mimari-e10.md` §8, §12.2, §13, §15 r2; uygulama notu `docs/implementation.md` "P8c-2 — İstemci 0.10.0". P8c-1 raporu: `docs/arsiv/p8c1-qa-raporu.md`.
Windows elle testleri karara dahil edilmedi; yalnız AC'leri kapsayıp kapsamadıkları değerlendirildi.

## Test sonucu
Komut (repo kökü salt okunur, golang:1.26.11-bookworm@sha256:dc40a13b…):
`gofmt -l . ; go vet ./... && GOOS=windows go vet ./... && go test -count=1 -v ./...`
- gofmt: temiz (çıktı yok). `go vet` (linux) ve `GOOS=windows go vet`: temiz.
- `go test`: 18 paket `ok`, **228 test PASS, 0 FAIL, 0 SKIP**. Çıkış kodu 0.
- Yeni testler: `launch` (karar tablosu + 9 akış: satır 1–8, T43 yabancı köken, AC-185/186/187, Store yok), `remember` (v2, v1 yükseltme, ClearPersonal/ClearBinding/ForgetAll, `CanonicalOrigin`), `signal` (`fixtures/bindings.json` ile `binding.offer/issued` sıkı, `binding.request` kodlama), `api` (status gövde/yeniden deneme yok, revoke tek kısa deneme, ref XOR bindingKey), `flow` (teklif→istek→issued yalnız admit sonrası, teklifsiz, hata yutma, lobide kapanış), `request` (AC-182/185/186/190, kapanış nedenleri, fixture metinleri), `ui` (Tab sırası).
- go.mod/go.sum değişmedi; yeni bağımlılık yok.
- Not: sunucu/web (AC-1..164 TS testleri) bu turda koşulmadı; bu pakette sunucu/web/contracts dosyası değişmedi (git status), durumları P8c-1 turundakiyle aynı.

## Sunucu sözleşmesiyle uyum
| Konu | Sunucu / contracts | İstemci | Sonuç |
|---|---|---|---|
| `POST /api/v1/public/bindings/status` | `strictObject{bindingKey, clientVersion}`; yanıt `TenantRequestInfo` + `customer` (Genel'de null) | `BindingStatus` aynı iki alan, yalnız gövdede; `Customer *struct{Name}` | Uyumlu |
| `POST …/bindings/revoke` | `strictObject{bindingKey}` → her durumda 204 | 2 sn, tek deneme, yanıt gövdesi beklenmez | Uyumlu |
| `POST /public/requests` | ref XOR bindingKey | `Ref`/`BindingKey` `omitempty`, kayıtla talepte `deviceKey` yok | Uyumlu (test `TestAC182CreateRequestRefXorBindingKey`, `TestAC182BindingModeRequestUsesKeyNoRefNoDeviceKey`) |
| `binding.request` | `strictObject{t, id?, previousKey?: rsb_…43}` | `ID`/`PreviousKey` `omitempty`, gönderimden önce biçim denetimi | Uyumlu (boş anahtar gönderilmez) |
| `binding.offer` / `binding.issued` | `{t}` / `{t, bindingKey, tenantName≤120, customerFirmName: string\|null, renewed}` | Sıkı ayrıştırıcı, `customerFirmName` zorunlu/null | Uyumlu (fixture testi) |
| Mesaj sırası | offer yalnız admit sonrası; istek teklifsiz → `error CONFLICT`; sınır → `RATE_LIMITED` | Teklif başına ≤ 1 istek, istenmemiş issued yazılmaz, istek sonrası ilk `error` yutulur | Uyumlu |
| Hata kodları | `BINDING_INVALID` (status/oluşturma, tek tip 404), `CUSTOMER_PASSIVE`, `BINDING_REVOKED` kapanış nedenleri | status: `BINDING_INVALID` veya herhangi 404 → kayıt silinir (K24 geri alma ile tutarlı); oluşturma: `BINDING_INVALID`; iki neden genel metin | Uyumlu |
| Metinler | `BINDING_INVALID_MESSAGE`, `BINDING_FORGOTTEN_MESSAGE`, `BINDING_NO_SOURCE_MESSAGE` | Aynı dizeler, `TestAC185MessagesMatchContractsFixture` | Uyumlu |

## Kabul kriterleri
| AC | Durum | Kanıt (test adı) veya eksik |
|---|---|---|
| AC-181 | ✅ | `TestAC181OfferRequestIssuedOnlyAfterAdmit`, `TestAC181NoOfferNoRequest`, `TestAC181LobbyCloseNoBinding` (onaysız kapanışta yazılmaz), `TestAC181BindingDisabledIgnoresOffer`, `TestAC181V2BindingAndPersonalCoexist`, `TestAC181BindingServerMessagesStrict`; `TestAC187KeeperSavesCanonicalAndReportsChange` (kanonik köken yazımı). DPAPI yazımı `dpapi_windows.go` (vet temiz; çalışma kanıtı Windows adım 3). Tarayıcı modu Go istemcide yok; sunucu tarafı P8c-1'de kanıtlı. |
| AC-182 | ✅ (5 sn süresi Windows adım 5) | `TestAC182AC183AC190DecideTable` (öncelik kuralları 1–3), `TestAC182Row1CodeFlowResolvedOnceWithNotice`, `TestAC182Row4And5RefFile`, `TestAC190Row7And8BareFile`, `TestAC182BindingModeRequestUsesKeyNoRefNoDeviceKey`, `TestAC182BindingStatusBodyOnlyNoOrigin`; kayıt satırı `TestAC189HomeTabOrder` içinde `registeredText`. |
| AC-183 | ✅ | `TestAC183Row2ExpiredCodeWithBindingOpensBindingHome`, `TestAC183Row3ExpiredCodeNoBindingShowsMessageAndCode`. |
| AC-184 (istemci) | ✅ | İstemci anahtarı yalnız status/revoke/requests gövdesinde ve `binding.request.previousKey`'de kullanır (`TestAC182BindingStatusBodyOnlyNoOrigin`); resolve/join/TURN'e gitmez (kod incelemesi `launch/run.go`, `request/run.go`); kayıtla talep paylaşım için AC-154 onay yolunu aynen izler. Sunucu reddi P8c-1'de kanıtlı. |
| AC-185 | ✅ | `TestAC185StatusInvalidClearsBindingKeepsPersonal` (launch + request), `TestAC185CreateInvalidReturnsToHome`, `TestAC185BindingStatusInvalidNotRetried`, `TestAC185ClearBindingKeepsPersonal`, `TestAC185MessagesMatchContractsFixture`. |
| AC-186 | ✅ (1 sn ve iz testi Windows adım 12) | `TestAC186ForgetComputerDeletesThenRevokes` (önce yerel silme, sonra revoke), `TestAC186ForgetAllRemovesFileTmpAndEmptyDir`, `TestAC186ClearPersonalKeepsBindingAndRenewsDeviceKey` ("Bilgilerimi unut" kaydı korur), `TestAC186RevokeBindingSingleShortAttempt`, `TestAC186ForgetComputer`. |
| AC-187 | ✅ | `TestAC187SaveBindingOverwritesSingleRecord`, `TestAC187KeeperSavesCanonicalAndReportsChange`; `main.go:127` `EndedNote(ChangedText)`. Not: değişiklik firma/müşteri **görünen adlarıyla** karşılaştırılır (bkz. Öneriler 2). |
| AC-188 (istemci) | ⚠️ | `TestAC188NoticeText`; karşılamada satır yalnız kayıt etkinken (`flow/binding.go rememberNote`). **Eksik:** talep formunda satır koşulsuz gösterilir (Düzeltilmeli 1). Seed metni P8c-1. İz testi Windows adım 3/12. |
| AC-189 | ✅ | `TestAC189HomeTabOrder` (Destek iste → Bağlantı kodum var → Bu bilgisayarı unut → Kötüye kullanımı bildir); `home_windows.go` Enter `IsDialogMessage`, pasif "Destek iste" `v.Support` korumalı; dolandırıcılık uyarısı ve footer (sunucu/sürüm/SHA-256) ekranda. "Teknisyenden kod aldım" → "Bağlantı kodum var". |
| AC-190 | ✅ | `TestAC190NoSourceSupportDisabledCodeEnabled`, `TestAC190Row7And8BareFile`, `TestAC182AC183AC190DecideTable`. |
| AC-191 (istemci) | ⚠️ | İstemci kısmı ✅: 0.9.x davranışı değişmedi, `MIN_AGENT_VERSION` değişmedi (sunucu dosyası değişmedi). **Kanıtsız:** 0.10.0 `SHA256SUMS` + attestation ile yayımlanmadı (devops, QA sonrası `v0.10.0` etiketi). İki tekrarlanabilir derleme aynı SHA (implementation.md) — doğrulanmadı, yalnız beyan. |
| AC-193 (istemci) | ⚠️ | 18 paketin eski testleri yeşil. Ancak AC metni "AC-1..AC-164 testleri **değiştirilmeden**" der; değişen eski testler gerekçesiz (Düzeltilmeli 2). Eski akışların çalışması Windows adım 15. |

Kapsam dışı (bilgi): AC-192 staging ölçümü (Windows adım 16).

## Tasarımdan sapmalar (S1–S6) — QA kararı
| # | Karar | Gerekçe |
|---|---|---|
| S1 IDNA yerine ASCII-LDH/IP kanonik köken | Kabul (QA açısından) — güvenlik ayrıca karar verir | Fail-closed: IDN host'ta kayıt hiç kullanılmaz/gönderilmez; `TestGE106CanonicalOrigin` tablo testi; go.mod değişmedi. `docs/mimari-e10.md`'ye uygulama notu düşülmüş. |
| S2 Ana ekran her kaynakta | Kabul | AC-189 "iki yolu tek yerde" bunu gerektirir. |
| S3 Satır 3'te 404 de "gone" | Kabul | §8.1 tablosu "404 / 410" der; kod girişi ana ekrandaki "Bağlantı kodum var" ile aynı alana gider. |
| S4 `deviceKey` yenileme | Kabul | §8.3 "`ClearPersonal` yeniler" ile tutarlı; test `TestAC186ClearPersonalKeepsBindingAndRenewsDeviceKey`. |
| S5 İstekten sonraki ilk `error` yutulur | Kabul (öneri ile) | Sunucu `binding.ts` istek sonrası yalnız `FORBIDDEN/CONFLICT/RATE_LIMITED/INTERNAL` gönderir; §8.4 "error yok sayılır" der. Bkz. Öneriler 1. |
| S6 Genel kayıtta `customerName` yazılmaz | Kabul | `omitempty` ile `null` anlamca eşdeğer; okuma tarafı alanın yokluğunu kabul ediyor. |
| (ek) `main.go` 161 satır (hedef ≤ 100) | Kabul (gerekçeli) | implementation.md'de yazılı; davranış değişmesin diye UI kurulumu taşınmadı. |
| (ek) §12.2'deki `agent-win.yml`, `request/policy.go` değişmedi | Kabul | Sürüm etiketten okunuyor (yazılı); `policy.go` değişikliği gerekmedi. |

## Düzeltilmeli
1. [backend-dev] `apps/agent-win/internal/request/run.go:304` — `formView` `RememberNote`'u koşulsuz `remember.NoticeText(...)` ile doldurur. Kayıt kapalıyken (Store nil / `CanonicalOrigin` başarısız, S1 IDN durumu — `launch/run.go:49` `d.Flow.Binding` atanmaz) talep formu "Oturumdan sonra bu bilgisayar … için hatırlanır" der ama kayıt yazılmaz; karşılama ekranı ise (`flow/binding.go rememberNote`) aynı durumda satırı gizler. → `request.Deps`'e kayıt-etkin bayrağı ekleyin (launch `requestDeps`'te `d.Flow.Binding != nil` ile doldurulsun), bayrak kapalıyken `RememberNote` boş olsun; `launch/run_test.go` `TestNoStoreDisablesBinding`'e form görünümünde satırın boş olduğunu, kayıt etkin senaryoda dolu olduğunu doğrulayan assert ekleyin.
2. [backend-dev] `docs/implementation.md` "P8c-2" bölümü — AC-193 "AC-1..AC-164 testleri değiştirilmeden" der; şu eski testler değişti ve gerekçesi yazılı değil: `internal/remember/remember_test.go` (`TestAC137ForgetRemovesFileAndEmptyDir` kaldırıldı → `TestAC186ForgetAllRemovesFileTmpAndEmptyDir`; bozuk dosya tablosundan `"yanlış sürüm" v2` vakası çıkarıldı; `sample`/`Save`/`Forget` API'si değişti), `internal/request/run_test.go` ve `hardening_test.go` (`remember.Data` → `remember.Personal`, `Load/Save/Forget` → `LoadPersonal/SavePersonal/ClearPersonal`; `fakeUI.RequestHome` varsayılanı `HomeSupport`). → "AC-193 izlenebilirlik" alt başlığıyla her değişen test için: eski ad, yeni ad, değişikliğin türü (yalnız tip/API uyarlaması mı, assert değişti mi) ve AC-186/AC-188'in AC-137/AC-138'i değiştirmesi gerekçesini yazın; assert'i değişen bir AC-1..164 testi varsa açıkça belirtin.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Tüm AC'ler testle kanıtlı | ❌ | AC-188 (form satırı koşulu), AC-191 (yayın), AC-193 (test değişikliği gerekçesi) |
| Testler yeşil, skip yok | ✅ | 228 PASS / 0 FAIL / 0 SKIP |
| gofmt / vet (linux + windows) | ✅ | Temiz |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | S1–S6 yazılı ve kabul edilebilir; sözleşme birebir |
| Yeni bağımlılık yok / gerekçeli | ✅ | go.mod/go.sum değişmedi |
| Hata yutma yalnız tasarımda izinli yerlerde | ✅ | `SaveBinding` hatası ve istek sonrası `error` (§8.4); revoke en iyi çaba (AC-186) |
| Gizli bilgi log/hata metninde yok | ✅ | Anahtar yalnız gövdede; `api` hata metinlerine yazılmıyor (kod incelemesi) |
| Ölü kod / kullanılmayan soyutlama | ✅ | Tespit edilmedi |
| implementation.md güncel | ❌ | Düzeltilmeli 2 |
| CHANGELOG 0.10.0 | ✅ | Kök `CHANGELOG.md` değişmiş |
| Windows elle test adımları AC'leri kapsıyor | ✅ | 16 adım AC-181..190, 193 ve 192'yi kapsıyor (bkz. Öneriler 3) |
| Yayın (SHA256SUMS + attestation) | ❌ | Henüz yok — devops, QA GEÇTİ sonrası |

## Öneriler (zorunlu değil)
1. [backend-dev] S5: `flow/binding.go` istek sonrası `error`'u kod ne olursa olsun yutuyor. Bekleyen istek varken alakasız bir sunucu hatası (başka bir mesaja yanıt) gelirse sessizce kaybolur. Yutmayı sunucunun kayıt yolunda gönderdiği kodlarla (`FORBIDDEN`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`) sınırlamak daha sağlam olur.
2. [backend-dev] AC-187: `keeper.Issued` değişikliği görünen adlarla karşılaştırır; aynı ada sahip iki farklı tenant arasında geçişte "artık … için kayıtlı" bilgisi gösterilmez. Önceki kaydın kökeni farklıysa da bilgi gösterilmesi düşünülebilir.
3. [test-operatoru] Adım 2'deki Tab sırası (kaynaksız ekranda "Kötüye kullanımı bildir" yok, son öğe "Kapat") AC-189'un dört düğmeli sırasını doğrulamaz; adım 5'e (kayıtlı ana ekran, kötüye kullanım adresi tanımlı) açık Tab sırası + Enter kontrolü ekleyin.
4. [devops] Yayın sonrası `SHA256SUMS` değerinin implementation.md'deki tekrarlanabilir derleme SHA'sıyla (`716e9f98…`) eşleştiğini runbook satırına yazın.

## Olumlu
- Karar tablosu (`launch.Decide`) saf ve tablo testli; §8.1'in 8 satırı birebir.
- Sözleşme metinleri ve mesaj şemaları `packages/contracts/fixtures` üzerinden test ediliyor; drift riski düşük.
- Kanonik köken eşleşmesi (T43, G-E10-6) fail-closed; yabancı kökenli kayıt kullanılmıyor ve silinmiyor (`TestT43ForeignOriginBindingIgnoredNotDeleted`).
- "Bu bilgisayarı unut" önce yerel siler, sonra yalnız aynı kökene revoke gönderir.
- Bağımlılık eklenmeden IDNA kısıtı aşıldı; go.mod/go.sum dokunulmadı.
