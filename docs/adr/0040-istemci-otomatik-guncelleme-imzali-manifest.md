# ADR-0040 — İstemci otomatik güncelleme: Ed25519 imzalı manifest, oturum dışı yerinde kurulum, eski ikili gözetmen

Tarih: 2026-11-19 · Durum: **Önerildi r2** (K0g güvenlik turu S-P29-T-1..12 işlendi, `docs/mimari-p29.md` §14; T-1 kullanıcı risk kabulü 2026-11-19) · İlgili: AC-470..AC-493, `docs/gereksinimler-p29.md`,
`docs/mimari-p29.md`, ADR-0004 (Go istemci), ADR-0010 (imzasız dağıtım), ADR-0012 (agent kökeni), ADR-0028 (gözetimsiz erişim), ADR-0037 (macOS),
ADR-0038 (Linux)

## Bağlam

- Bugün yeni istemci sürümü elle dağıtılır. Tek mekanizma eski sürümü kilitlemektir: `MIN_AGENT_VERSION` → 426, gözetimsizde 409
  `DEVICE_OUTDATED`. Özellikle gözetimsiz servis kimse başında değilken eskir.
- Platform imzası yoktur: SignPath (Windows Authenticode) ve Apple Developer hesabı yok, Linux tasarım gereği imzasız (ADR-0010, ADR-0038 m.11).
  SignPath/Apple kararı kullanıcıdadır (S-P29-6). Bu nedenle güncelleme kanalının bütünlüğü kendi imzamıza dayanmak zorundadır.
- Sunucu, istemcinin indirdiği ikilileri bugün yalnız SHA-256 kapısıyla sunar. Ele geçirilmiş sunucu senaryosunda bu yeterli değildir.
- macOS TCC izinleri kod imzası kimliğine bağlıdır (ADR-0037 Bağlam). Developer ID'de kimlik "bundle kimliği + Team ID" olduğu için güncellemede
  korunur. Ad-hoc imzada kimlik cdhash'tir ve her derlemede değişir.
- Sadelik ilkesi geçerlidir: tek ekran, tek yol, en az yeni bağımlılık. AGPL/GPL yasaktır.

## Karar

1. **Güven kökü (r2: tek CI imzası, kullanıcı risk kabulü — Sonuçlar):** her ortam (prod, staging) için ayrı bir Ed25519 anahtar çifti vardır. İstemciye derlemede iki açık anahtar yuvası (etkin +
   yedek) gömülür. Açık anahtarlar repodaki `build/update-keys/<env>.pub` dosyalarındadır.
   Özel anahtar yalnız onaylı GitHub ortamının secret'ıdır (`agent-update-sign`, `agent-update-sign-stg`). Yedek tohum çevrimdışı saklanır.
   PR ve yer tutucu adresli derlemelere anahtar gömülmez; bu derlemelerde güncelleyici kapalıdır.
2. **Manifest:** her ikili için ayrı bir manifest üretilir. Manifest katı JSON'dur ve şu alanları taşır: `schema, env, platform, arch,
component, version, sha256, size, issuedAt, expiresAt (≤ 90 g), minUpdaterVersion`.
   İmza `"rs-update-manifest-v1\n"` önekiyle ham baytlar üzerinden atılır. Manifest kanonik JSON'dur (sabit alan sırası, boşluksuz, ASCII); doğrulayıcı yeniden serileştirilmiş baytın ham bayta eşitliğini ister (r2 T-11). Süre: istemci ≤ 30 g, servis ≤ 90 g (r2 T-7). CI, nihai (imzalı/notarize edilmiş) baytlardan üretir.
   İmzalayıcı ve doğrulayıcı aynı Go paketidir (stdlib `crypto/ed25519`); yeni bağımlılık yoktur.
3. **Doğrulama istemcidedir; sunucuya güvenilmez.** Sunucu manifest üretmez ve değiştirmez, baytları olduğu gibi aktarır. Yalnız şu
   koşullardan biri sağlanmazsa manifesti sunmaz: imza, ortam, süre, yayımlanmış ikili SHA'sı, `signed` kip SHA listesi.
   İstemci indirmeyi yalnız gömülü kökenin sabit yolundan, TLS ile ve yönlendirme olmadan yapar. Kabul koşulları:
   - İmza gömülü anahtarlardan biriyle geçerli.
   - `env`, `platform`, `arch` ve `component` istemcinin kendisiyle eşleşiyor.
   - Manifestin süresi dolmamış.
   - Sürüm çalışan sürümden büyük ve görülen en yüksek sürümden küçük değil.
   - İndirilen dosyanın SHA-256'sı ve boyutu manifestle aynı.
   - Çalışan ikili platform imzalıysa yeni ikili de aynı yayıncıyla imzalı.
     Doğrulanan bayt kurulan bayttır: hash, yazılan akış üzerinden hesaplanır ve dosya paylaşımsız tutamaçla tutulur.
4. **Kurulum oturum yokken yapılır.** Taşınabilir istemcide yeni sürüm bir sonraki açılışta devreye girer.
   - **Windows servis:** eski ikili, `--update-apply` kipinde gözetmen olarak çalışır. Yeni ikiliyi yerine koyar ve 60 sn sağlık denetimi
     yapar (`device.ready`). Denetim geçmezse eski ikiliye döner ve o sürümü 24 sa denemez. Kurulum sırasında sunucu 409 `DEVICE_UPDATING` döner.
   - **Windows taşınabilir:** çalışan exe yeniden adlandırılır, aynı adla yenisi konur. Eski kopya gizli `.eski` olarak kalır ve sonraki
     açılışta silinir.
   - **Linux:** ELF yerinde değiştirilir (`rename(2)`, kip korunur).
   - **macOS:** paket yalnız Developer ID + aynı Team ID + notarization geçerliyse yerinde değiştirilir. Aksi durumda yalnız bildirim
     gösterilir; bugün durum budur.
   - Konum yazılamıyorsa her platformda yalnız bildirim gösterilir.
5. **Bildirim:** servis olayları kimlikli WS'ten (`update1` yeteneği), taşınabilir istemcinin olayları public uçtan gelir. Taşınabilir
   istemci varsa kayıt anahtarlarını gövdede gönderir. Kimlikli olaylar ilgili tenant'ın audit'ine `client.update.*` olarak yazılır.
   Kimliksiz olaylar yalnız metriğe girer. Hız sınırları uygulanır; metrik etiketleri yalnız enum değerlerinden oluşur.
6. **Politika:** tenant'ta tek anahtar vardır (`client_auto_update`, varsayılan Açık). Politika yalnız kimlik kanallarından taşınır: WS,
   `bindings/status` ve müşteri dosyası ref'i. Bir bilgisayarda birden çok firma kaydı varsa kapalı olan kazanır. Tenant'ı bilinmeyen
   istemci için politika Açık'tır.
7. **`MIN_AGENT_VERSION` değişmez.** Güncelleme uçları bu kapıdan muaftır. Runbook sırası: önce yayın, sonra asgari sürümün yükseltilmesi.

## Tersine çevrilen / değişen kararlar

| Kaynak                           | Eski karar                                                                        | ADR-0040 ile                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `mimari-e11.md` §8d.13           | "Otomatik güncelleme yok (imza olmadan güvenli değil); SignPath sonrası ayrı ADR" | SignPath beklenmez; güvenlik kendi Ed25519 manifest imzamızla sağlanır. Bu ADR o "ayrı ADR"dir                                 |
| `mimari-p27.md` §1               | Otomatik güncelleme Sonra; yeni sürüm elle kurulur                                | Servis kendini günceller (gözetmen + geri dönüş). Elle kurulum yolu (`--install` → `Update`) yedek olarak kalır                |
| `mimari-p28f.md` §1 kapsam dışı  | macOS otomatik güncelleme yok                                                     | Kapsamda, ancak yalnız Developer ID dalında yerinde değiştirilir; bugün yalnız bildirim                                        |
| ADR-0010                         | İmzasız, elle dağıtım                                                             | İkililer imzasız kalır. Güncelleme bütünlüğü manifest imzasıyla sağlanır; elle dağıtım ilk 0.22.0 kurulumu için sürer          |
| K-P20-2 (`mimari-e11.md` §8d.14) | Exe kopyalanmaz                                                                   | Yan klasöre kopya yine yoktur. Aynı yolda yerinde değiştirilir; geçici gizli `.eski` sapması kabul edilir (mimari-p29 §13 D-3) |
| ADR-0038 m.11                    | Paket yöneticisi/AppImage yok                                                     | Değişmez; yerinde ELF değiştirmeyle karşılanır                                                                                 |

## Alternatifler

- **A. Platform imzasını (SignPath/Apple) beklemek:** reddedildi. Ne zaman geleceği belli değil ve servis kilidi (AC-435) bugünün sorunu.
  İmza gelirse AC-476 ek kapı olarak devreye girer.
- **B. Yalnız TLS + sunucu SHA kapısı:** reddedildi. Ele geçirilmiş sunucu tüm istemcilere kod dağıtabilir.
- **C. TUF / go-tuf, minisign, Sparkle, Squirrel, WinSparkle gibi hazır çerçeveler:** reddedildi.
  - Yeni bağımlılık ve öğrenme yükü getirirler. Rol/delegasyon karmaşıklığı tek yayıncı için gereksizdir.
  - Sparkle/Squirrel platforma özgüdür; üç platform ve servis için tek yol sağlamazlar.
  - TUF'un yeniden oynatma/dondurma korumasının özü süre sınırı ve `maxSeen` ile karşılanır.
  - Genişleme noktası: manifest `schema` alanı ve `minUpdaterVersion` ileride TUF benzeri bir biçime geçişe izin verir.
- **D. Tek manifest (tüm ikililer):** reddedildi. Servis manifesti ayrıca tutulamaz (AC-492) ve yayın betikleri bağımsızdır.
- **E. Servisin ImagePath'ini sürüm klasörüne çevirmek:** reddedildi. Atomik olurdu, ancak Run, Uninstall, olay kaynağı ve uygulama
  anahtarlarının hepsi yol değişikliğine uğrardı. Dosya değiştirme penceresi milisaniyedir (risk R-P29-11).
- **F. Gözetmeni ProgramData'ya kopyalayıp çalıştırmak:** reddedildi. AV "dropper" örüntüsüne girer; kurulu imaj zaten yeniden
  adlandırılabilir.
- **G. Linux'ta yalnız bildirim:** reddedildi. Yerinde `rename(2)` hem atomik hem kökensiz, ve değer kaybı gereksiz.

## Sonuçlar

- (+) Gözetimsiz servis kendiliğinden güncellenir ve AC-435 kilidi pratikte kalkar. Bozuk sürüm otomatik geri alınır.
- (+) Sahte, eski ya da başka ortama ait sürüm kurulmaz ve reddedilmesi alarm üretir.
- (−) **Kabul edilen risk (S-P29-T-1, kullanıcı 2026-11-19: "Tek imza, risk kabul").** Tek güven kökü CI ortam anahtarıdır. Etiket,
  onay, yayın ve sunucu erişimi aynı hesapta toplandığından "anahtar + sunucu" pratikte tek varlıktır. Bu hesap ele geçirilirse tüm gözetimsiz
  servislerde SYSTEM kodu çalıştırılabilir (R-P29-1, Kritik). 2-of-2 imza tasarlanmadı; genişleme noktası olarak mimari-p29 §14.1'de durur.
  Kalan sertleştirmeler:
  - Ortam secret'ı + onaylı environment (yalnız `v*`, yönetici atlaması kapalı) ve etiket ruleset'i.
  - Yedek anahtar ve rotasyon; attestation (kimliği sabitlenmiş doğrulama).
  - Alarm (`source="device"` ≥ 1).
  - Staging-önce 24 sa yayın kuralı.
  - Önerilen: donanım 2FA ve SSH anahtar koruması.
- (−) ≤ 0.21.x istemciler için son bir elle kurulum gerekir (R-P29-5).
- (−) Windows taşınabilir istemcide sonraki açılışa kadar görünür, yürütülemez bir `<ad>.eski` dosya kalır (r2 T-8: gizli öznitelik yok; MOTW
  yeni dosyaya kopyalanır).
- (−) Kabul edilen kalan riskler (r2):
  - T-7: ele geçirilmiş sunucu, taşınabilir istemciyi eski ama imzalı bir ara sürüme çekebilir. Sınır: istemci manifesti ≤ 30 g; açıklı
    sürüm yeniden imzalanmaz ve `MIN_AGENT_VERSION` yükseltilir.
  - T-12: donma saldırısı (hiç manifest sunmamak). Tespit: süre metriği ve dağılım.
- r2 sertleştirmeleri (mimari-p29 §14):
  - Kanonik manifest baytı (T-11).
  - Servis gözetmeninde tekillik mutex'i + nonce (T-4). Önyükleme kurtarma kancası SCM `RUN_COMMAND` → `--update-recover`;
    `PendingFileRenameOperations` geri dönüş için kullanılmaz (T-3).
  - İmza adımında tohum stdin ile, imzalayıcı ön işte stdlib-only derlenir, yeniden imza iki işe bölünür (T-2).
  - Olay `source` etiketi (T-5); belirteç `Authorization` başlığında (T-10).
- (−) macOS'ta Developer ID gelene kadar yalnız bildirim yapılır.
- Geri dönüş: `publish-manifest.sh --withdraw` manifesti kaldırır, istemciler 204 alır ve güncellemez. Ayrıca `UPDATE_MANIFEST_DIR` boş
  bırakılabilir. Kod tarafında güncelleyici, gömülü anahtarsız derlemeyle kapatılır.
