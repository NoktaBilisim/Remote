# Mimari — P29 İstemci otomatik güncelleme + sürüm bildirimi (AC-470..AC-493)

Tarih: 2026-11-19 · Durum: **r2** (güvenlik tasarım turu K0g "DÜZELTİLMELİ" işlendi — S-P29-T-1..12 kararları §14; T-1 = **tek imza, kullanıcı risk kabulü 2026-11-19**) · r1 2026-11-19 · Dal: `claude/p29-auto-update` · Sürüm **0.22.0** (istemci + servis + sunucu). **§14 önceki bölümlerle çelişirse §14 geçerlidir.**
Girdiler: `docs/gereksinimler-p29.md` (AC-470..493, V-P29-1..12, R-P29-1..10, S-P29-1..6), `docs/mimari-e11.md` §8d.13, `docs/mimari-p27.md`
(§5.3 kurulum, K-P27-15 klasör ACL), `docs/mimari-p28f.md` + ADR-0037 (macOS, TCC), `docs/mimari-p28g.md` + ADR-0038 (Linux tek ELF), ADR-0010
(imzasız dağıtım), ADR-0014 (enum CHECK), ADR-0005 (tek instance). Yeni ADR: **ADR-0040** "İstemci otomatik güncelleme — imzalı manifest".
Kontrol listesi: `docs/tasarim-kontrol.md` "P29". Ana oturum kararı (2026-11-19): S-P29-1..5 gereksinimdeki varsayılanlarla; S-P29-6 (SignPath /
Apple) kullanıcıda — P29 **platform imzası olmadan** çalışır, imza gelirse AC-476 kendiliğinden devreye girer.

**Sadelik:** tek güncelleyici paketi (`internal/update`), tek doğrulama işlevi (`update.Verify`), tek kural ("oturum yokken, doğrulanmış baytı aynı
yere koy"). Tenant'ta tek anahtar. Kullanıcıya düğme yok; istemcide tek bilgi satırı. Yeni Go/npm bağımlılığı yok (Go `crypto/ed25519`, Node
`node:crypto`).

---

## 1. Özet ve kısıtlar

| Kapsamda                                                                                                       | Kapsam dışı / Sonra (neden)                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| İkili başına Ed25519 imzalı manifest (CI), ortama özel anahtar çifti, 2 açık anahtar yuvası                    | Platform imzası (SignPath/Apple) — kullanıcı kararı bekliyor; gelirse AC-476 ek kapı (K-P29-13)                  |
| Windows gözetimsiz servis: tam otomatik, eski ikili gözetmen + sağlık denetimi + geri dönüş                    | Bakım penceresi, kademeli yayın, kanal, pin, "şimdi güncelle" — Sonra (S-P29-2/3/4)                              |
| Windows taşınabilir istemci: yerinde, aynı adla; sonraki açılışta yeni sürüm                                   | Çalışan istemcinin kendini yeniden başlatması — yok (S-P29-5)                                                    |
| Linux tek ELF: **yerinde değiştirme** (K-P29-11)                                                               | `.deb/.rpm/AppImage`, paket deposu — kapsam dışı (ADR-0038 m.11)                                                 |
| macOS: yalnız Developer ID + aynı Team ID iken yerinde; aksi (bugün **her zaman**) yalnız bildir (K-P29-10)    | Ad-hoc/TEST paketin yerinde değişmesi — TCC izni düşer, yapılmaz                                                 |
| Olay bildirimi: servis WS üzerinden, taşınabilir istemci public uç üzerinden; audit `client.update.*` + metrik | Kimliksiz istemcinin audit'e yazılması — yok (V-P29-6)                                                           |
| Panel: gözetimsiz liste "Sürüm" sütunu + rozet + sürüm dağılımı; Ayarlar → İstemciler tek anahtar              | Ayrı "Yayın durumu" ekranı — açık karar A-P29-1 (§13); dağılım başlığında yayındaki sürüm satırı yeterli sayıldı |
| `DEVICE_UPDATING` (409), audit etiketleri, runbook (anahtar, rotasyon, yayın sırası, alarm)                    | Downgrade / acil geri alma — yok; düzeltme daha yüksek sürümle (V-P29-7)                                         |

Kısıtlar: tek instance (ADR-0005) → güncelleniyor bayrağı ve indirme belirteçleri bellekte; MySQL 8 + Prisma; repo açık kaynak (açık anahtarlar
repoda, özel anahtar yalnız GitHub ortam secret'ı). **Paralel P22-G** (oturum sohbeti) şu dosyalara dokunur, P29 bunlara **dokunmaz**:
`apps/agent-win/internal/{flow,signal,dc,rtc}/*`, `internal/request/chat*`, `internal/api/requests.go`, `internal/ui/uicore/accept.go`,
`packages/contracts/src/{ws-chat,chat,ws}.ts`. Ortak dosyalarda (`contracts/src/{audit,errors,permissions,ws-device}.ts`, `api/bindings.ts`,
`api/unattended.ts`, `messages/tr.json`, `lib/audit/actions.ts`, `env.ts`, `schema.prisma`, `implementation.md`) **yalnız ekleme**.

### 1.1 Kararlar (K-P29-n)

| No       | Karar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Gerekçe                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-P29-1  | **Güven kökü (r2: tek imza, S-P29-T-1 kullanıcı risk kabulü 2026-11-19):** ortam başına (prod, staging) ayrı Ed25519 anahtar çifti; yalnız CI imzası. İstemciye derlemede **iki açık anahtar yuvası** (etkin + yedek) gömülür: `-ldflags -X config.updateEnv=prod\|staging -X config.updateKeys=<b64url>,<b64url>`. Açık anahtarlar repoda `apps/agent-win/build/update-keys/{prod,staging}.pub`. PR/yer tutucu derlemede anahtar **gömülmez** → güncelleyici kapalı (fail-closed). Sertleştirmeler §14.1 (onaylı ortam, etiket ruleset'i, yedek/rotasyon, attestation, alarm, staging-önce kuralı). 2-of-2 imza tasarlanmadı; genişleme noktası §14.1 | AC-472, V-P29-9; kullanıcı kararı: tek yayıncı için ikinci çevrimdışı imza adımı istenmedi, risk yazılı kabul edildi                                                                                                                            |
| K-P29-2  | **Manifest = ikili başına bir dosya** `update-<component>-<platform>-<arch>.json` + `.sig` (Release'te en çok 4 çift). AC-470'teki "tek manifest" **her ikili için tek manifest** olarak okunur (sapma §13 D-1)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Sunucu yalnız servis manifestini tutabilmeli (AC-492); yayın betikleri ikili başına bağımsız (publish-*.sh); her manifest kendi ikilisinin kapısıyla eşlenir                                                                                    |
| K-P29-3  | **İmzalanan bayt:** `"rs-update-manifest-v1\n" ‖ manifest dosyasının ham baytları`; imza 64 bayt, `.sig` = base64url (dolgusuz, 86 karakter). Manifest **kanonik JSON** (r2, §14 T-11: sabit alan sırası, boşluksuz, yalnız ASCII; BOM, yinelenen anahtar, sonda veri yok); doğrulayıcı `kanonik(ayrıştır(bayt)) == bayt` ister; ≤ 2 KiB; sunucu ve istemci baytları **olduğu gibi** taşır (`manifest` = ham baytların base64'ü)                                                                                                                                                                                                                       | Bağlam öneki başka bir imzanın manifest sayılmasını önler; tek biçim → sunucu (zod) ile istemci (Go) farklı ayrıştıramaz                                                                                                                        |
| K-P29-4  | **Sürüm dili** mevcut `DEVICE_VERSION_PATTERN` (`\d{1,3}.\d{1,3}.\d{1,3}`), sayısal üçlü karşılaştırma; ön sürüm etiketi yok → semver kitaplığı yok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Tek grammar; Go ve TS'te 10 satır                                                                                                                                                                                                               |
| K-P29-5  | **Sunucu yalnız aktarır ama kapılar:** manifestleri `UPDATE_MANIFEST_DIR`'den okur, açılışta ve dosya değişince imzayı `UPDATE_MANIFEST_PUBKEYS` ile doğrular. Bir manifest ancak **hepsi** doğruysa sunulur: imza geçerli; `env` = `DEPLOY_ENV` eşlemesi (`production→prod`, `staging→staging`); süresi dolmamış; `sha256` = ilgili ikili kapısının beklenen SHA'sı (`AGENT_SHA256`/`MAC_AGENT_SHA256`/`LINUX_AGENT_SHA256`/`UNATTENDED_AGENT_SHA256`) **ve** kapı `ok`; servis için `UNATTENDED_MODE=signed` iken SHA `UNATTENDED_SIGNED_SHA256` listesinde. Aksi 204 + durum başına bir kez `warn` log                                              | AC-473, AC-492; hash kapısı rutin yayın sırasında (manifest önce, ikili sonra) sahte `HASH_MISMATCH` güvenlik alarmını önler (AC-489). Sunucu manifest üretmez, değiştirmez                                                                     |
| K-P29-6  | **İndirme adresleri istemcide sabit, aynı köken:** Windows `/downloads/NoktaDestek.exe`, macOS `/downloads/NoktaDestek-macOS.zip`, Linux `/downloads/NoktaDestek-linux` (mevcut Caddy kodsuz yolları + kapı); servis `GET /api/v1/public/agent/update/service-file?t=` (tek kullanımlık belirteç, §4.4). Yönlendirme reddedilir; manifestte URL **yok**                                                                                                                                                                                                                                                                                                | V-P29-10 (yeni depolama yolu yok); AC-477; servis ikilisi bugün public değil (P27: Caddy görmez) — bu kural korunur                                                                                                                             |
| K-P29-7  | **Politika kimlik kanallarından gelir, anonim uçtan değil:** `tenant_settings.client_auto_update` (vars. TRUE). Servis: WS `update.offer.policy`. Kayıtlı Windows bilgisayar: `POST /public/bindings/status` yanıtına `autoUpdate` (ek alan). Müşteri dosyası (`NoktaDestek-<label>-<ref>.exe`, kayıtsız): `GET /public/agent/update?ref=` → `policy` (ref gizli değil; desen dışı/geçersiz/pasif ref = `auto`, yalnız politikası kapalı tenant'ın geçerli ref'i `notify` — 80 bit + 60/sa ile pratikte oracle değil, S-P29-T-9). Birden çok firma kaydında **kapalı olan kazanır**. Tenant bilinmiyorsa (Genel bağlantı, macOS, Linux) `auto`         | AC-485, V-P29-3; anonim manifest yanıtına tenant verisi konmaz (ref yoksa yanıt herkese aynı)                                                                                                                                                   |
| K-P29-8  | **Servis güncellemesi = eski ikili gözetmen** (`NoktaDestekServis.exe --update-apply`, argümansız/yolsuz; yalnız LocalSystem jetonuyla çalışır): servis doğrulanmış dosyayı `%ProgramData%\NoktaDestek Servis\Guncelleme\yeni.bin`'e (DataDirSDDL, `Gelen\` değil) yazar, gözetmeni **proclimit job'ı dışında** düz SYSTEM alt süreci olarak başlatır ve durur; gözetmen yer değiştirir, yeni servisi başlatır, 60 sn sağlık bekler, gerekirse geri döner (§5.3)                                                                                                                                                                                       | AC-480/481; bozuk yeni ikili kendini geri alamaz, eski ikili alabilir; ProgramData'dan exe çalıştırmak (dropper örüntüsü, R-P29-2) yok                                                                                                          |
| K-P29-9  | **Windows taşınabilir (B), r2 (S-P29-T-8):** aynı klasörde `<ad>.yeni` (yürütülemez uzantı, **gizli öznitelik yok**, paylaşımsız tutamaç) → çalışan `<ad>` → `<ad>.eski` → `<ad>.yeni` → `<ad>` (iki `MoveFileEx`, `WRITE_THROUGH`; ikincisi başarısızsa ilki geri alınır). PE yalnız son adımda `.exe` olur. Asıl dosyada `Zone.Identifier` (MOTW) varsa yeni dosyaya kopyalanır. `.eski` yeni sürümün **ilk açılışında** silinir. Konum yazılamaz / sabit disk değil / ağ yolu → yalnız bildir                                                                                                                                                       | Çalışan exe üzerine yazılamaz ama yeniden adlandırılabilir; yan klasöre kopya yok (K-P20-2); MOTW politikası korunur. Sonraki açılışa kadar görünür `.eski` kalır → D-3                                                                         |
| K-P29-10 | **macOS (C):** yerinde değiştirme **yalnız** çalışan paket Developer ID imzalı ve Team ID = gömülü `config.TeamID` **ve** yeni paket (zip açıldıktan sonra, yer değiştirmeden önce) `SecStaticCodeCheckValidity` + aynı Team ID + notarization (`SecAssessment`) geçerse. Aksi halde `skipped(MANUAL_ONLY)` + "Yeni sürüm var — indirme bağlantısından alın". Translocation → `NOT_WRITABLE`. Yer değiştirme = paket klasörünün atomik yeniden adlandırılması (`.Nokta Destek.app.eski`, sonraki açılışta silinir)                                                                                                                                     | ADR-0037 Bağlam: TCC kimliği Developer ID'de bundle kimliği + Team ID (güncellemede korunur), ad-hoc'ta cdhash (her derlemede değişir → Ekran Kaydı/Erişilebilirlik izni düşer, R-P29-6). Apple hesabı olmadığından bugün macOS = yalnız bildir |
| K-P29-11 | **Linux (D): yerinde ELF değiştirme** (seçenek i). Aynı klasörde `O_EXCL` + `0600` geçici `.<ad>.yeni` → yazarken SHA-256 → `fchmod` asıl dosyanın kipine (`u+x` korunur) → `fsync` → `rename(2)` (atomik; çalışan süreç eski inode'u kullanır) → klasör `fsync`. Kurulum oturum sonunda, süreç çıkmadan hemen önce. Yazılamaz / farklı sahip / `noexec` bağlama → yalnız bildir                                                                                                                                                                                                                                                                       | ADR-0038 tek dosya ilkesi; root yok, TCC benzeri kimlik yok, artık dosya yok; `ExeCode()` yalnız açılışta okunur (swap sonrası `" (deleted)"` sorunu doğmaz). (ii) yalnız bildir → değer kaybı; (iii) paket yöneticisi → kapsam dışı            |
| K-P29-12 | **Kurulum yalnız oturum yokken** (AC-479). Servis: `Core.Active()==false` + bekleyen `connect` yok; WS'ye `update.state{installing}` gönderir, 2 sn içinde `connect` gelirse kurulumu iptal eder ve oturumdan sonra yeniden dener. Sunucu bayrağı bellekte (hub, 3 dk TTL) → `POST /devices/:id/connect` ön denetiminde **çevrimiçi denetiminden önce** 409 `DEVICE_UPDATING` (step-up tüketilmez). Taşınabilir istemci: oturum sürerken indirir/doğrular, kurulum oturum bitince (tepside boşta; tek seferlikte çıkıştan önce)                                                                                                                        | AC-479; TX öncesi ön denetim step-up tüketmez (mevcut sıra)                                                                                                                                                                                     |
| K-P29-13 | **Platform imzası (AC-476):** çalışan ikili platform imzalıysa (Windows `WinVerifyTrust` geçerli → yayıncı sertifika özeti; macOS Developer ID → Team ID) yeni ikili aynı yayıncıyla geçerli imzalı olmalı, aksi `PLATFORM_SIGNATURE`. Çalışan imzasızsa yalnız manifest. Bugün tüm platformlar imzasız dalda                                                                                                                                                                                                                                                                                                                                          | S-P29-6 kullanıcıda; imza gelince kod değişmeden devreye girer                                                                                                                                                                                  |
| K-P29-14 | **Düşürme/yeniden oynatma:** kabul koşulu `version > çalışan` **ve** `version ≥ maxSeen`. `maxSeen` servis için `Guncelleme\durum.json`'da kalıcı; taşınabilir istemcide süreç belleğinde. Süre: **istemci manifesti `expiresAt − issuedAt ≤ 30 g`, servis ≤ 90 g** (r2, S-P29-T-7); `issuedAt > now + 24 sa` → "yayın yok" (saat geri). Kalan risk (ele geçirilmiş sunucunun eski ama imzalı ara sürüm sunması, ya da hiç sunmaması — donma) **kabul**, ADR-0040 Sonuçlar                                                                                                                                                                             | AC-475; S-P29-T-7 kabul gerekçesi §14                                                                                                                                                                                                           |
| K-P29-15 | **`minUpdaterVersion`:** manifesti kurabilecek en eski güncelleyici. Çalışan < değer → kurmaz, `skipped(MANUAL_ONLY)` + indirme bilgisi. 0.22.0 yayınında `0.22.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Manifest/kurulum biçimi ileride kırılırsa eski güncelleyiciyi güvenle durdurur                                                                                                                                                                  |
| K-P29-16 | **Olay kanalları:** servis → WS `update.event` (yetenek `update1`, `device.auth` kimliği); taşınabilir → `POST /api/v1/public/agent/update-events` (gövdede ≤ 5 `bindingKeys`, URL'de asla). Kimlikli olay ilgili her tenant'ın audit'ine; kimliksiz yalnız metrik                                                                                                                                                                                                                                                                                                                                                                                     | AC-487/488; mevcut cihaz/kayıt kimliği yeniden kullanılır, yeni anahtar yok                                                                                                                                                                     |
| K-P29-17 | **Olay kuyruğu:** servis ≤ 20 olay `durum.json`'da (kalıcı); taşınabilir ≤ 20 olay süreç belleğinde. `installed` olayını taşınabilir istemcide **eski süreç** yer değiştirme başarılı olunca gönderir                                                                                                                                                                                                                                                                                                                                                                                                                                                  | AC-487; taşınabilir istemci diske olay yazmaz (AC-484); "yerelde" = süreç ömrü (sapma §13 D-4)                                                                                                                                                  |
| K-P29-18 | **Cihaz durumu DB'de:** `unattended_devices.update_state/update_version/update_reason/update_at` (rozetler buradan; audit'ten türetilmez). Kayıtlı bilgisayar (binding) için yeni alan yok; sürüm dağılımı yalnız gözetimsiz cihazları kapsar                                                                                                                                                                                                                                                                                                                                                                                                          | AC-490; `device_bindings`'te platform alanı yok ve `status` yan etkisiz (K21) — dağılıma eklemek yeni yazma yolu açardı (A-P29-2)                                                                                                               |
| K-P29-19 | **`MIN_AGENT_VERSION`'a dokunulmaz;** güncelleme uçları (manifest, servis dosyası, olay) bu kapıdan **muaftır**, eski istemci de güncelleme bulabilsin. Runbook sırası: yayınla → cihazlar geçsin (dağılım) → `MIN_AGENT_VERSION`'ı yükselt                                                                                                                                                                                                                                                                                                                                                                                                            | AC-486; kilit yalnız güncellenmemişleri yakalar                                                                                                                                                                                                 |
| K-P29-20 | **Yeni yetki yok:** politika `settings.view/edit`, sürüm dağılımı ve sütun `unattended.view`; Super Admin "Tüm firmalar" kapsamı rol denetimiyle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | V-P29-12                                                                                                                                                                                                                                        |
| K-P29-21 | **Tepsi süreci (`--tray`)** eski imajla çalışmaya devam eder; boru `status` yanıtına (ek alan) `version` eklenir, tepsi kendi sürümünden farklıysa kurulu yoldan `--tray` ile yeniden başlar ve çıkar. Boru protokolü yalnız eklemeyle değişir (eski tepsi ↔ yeni servis uyumlu)                                                                                                                                                                                                                                                                                                                                                                       | Eski tepsi yeni servisle konuşabilmeli; kullanıcı fark etmez                                                                                                                                                                                    |

> **r4 ile değişti (2026-11-20, mimari-p28f §15):** K-P29-10 / K-P29-13 davranışı aynı (macOS yalnız bildir, zip inmez); gerekçe artık "Developer ID yok (kullanıcı kararı)". Ad-hoc prod zip için de `update-client-macos-universal.json` üretilir (K-P28f-r4-7); darwin platform imza kapısına hiç ulaşılmaz.

## 2. Bileşenler ve sorumluluklar

```mermaid
flowchart LR
  subgraph CI["GitHub Actions (agent-win.yml)"]
    B[build/sign/attest] --> M["update-manifest işi\nortam agent-update-sign(-stg)\ncmd/update-sign"]
    M --> R["Release / staging artifact\nupdate-*.json + .sig"]
  end
  R -->|publish-manifest.sh\n(imza + attestation doğrulanır)| V[("agent_downloads volume\n/data/downloads/update/")]
  subgraph Server["apps/server"]
    MS["update/manifest-store.ts\nimza+env+süre+SHA kapısı"]
    PU["GET /public/agent/update"]
    SF["GET /public/agent/update/service-file?t="]
    EV["POST /public/agent/update-events"]
    WS["/ws/device update.* (update1)"]
    HUB["DeviceHub updating TTL"]
    PANEL["/unattended/devices (+version) · /unattended/versions · /settings/client-update"]
  end
  V --> MS
  MS --> PU & WS
  subgraph Agent["apps/agent-win"]
    UP["internal/update\nVerify · Check · Download · Decide · Queue"]
    SV["servis: --update-apply gözetmen"]
    WP["Windows taşınabilir"]
    MP["macOS (Team ID dalı / yalnız bildir)"]
    LP["Linux ELF"]
  end
  UP --> SV & WP & MP & LP
  WP & MP & LP -->|HTTPS| PU & EV
  SV -->|WS| WS
  SV -->|HTTPS + belirteç| SF
  WS --> HUB
  PANEL --> Web["apps/web: liste sütunu, rozet, dağılım, Ayarlar → İstemciler, audit etiketleri"]
```

| Bileşen                                                    | Sorumluluk                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent-win/cmd/update-sign` (yeni, stdlib)            | `sign`: SHA256SUMS + sürüm + ortamdan manifest üretir, `UPDATE_SIGNING_KEY` (ortam değişkeni, base64 32 bayt tohum) ile imzalar; `verify`: CI ve testte doğrular. Manifest kodu `internal/update/manifest.go` ile **ortak** (üreten = doğrulayan)                                                       |
| `internal/update` (yeni Go paketi)                         | Manifest ayrıştırma + `Verify` (AC-474 sırası), sürüm karşılaştırma, denetim zamanlayıcı (açılış + 24 sa ± 2 sa), indirici (aynı köken, yönlendirme yok, ≤ 2×boyut, yazarken SHA), karar (politika, oturum, yazılabilirlik), olay kuyruğu, ileti tablosu `messages.go`                                  |
| `internal/update/install_{windows,darwin,linux}.go`        | Taşınabilir yer değiştirme (K-P29-9/10/11) ve sonraki açılış temizliği                                                                                                                                                                                                                                  |
| `internal/servis/update*.go`                               | Servis tarafı: `update1` yeteneği, `update.offer` işleme, `Guncelleme\` klasörü, `durum.json`, gözetmen `--update-apply`, sağlık işareti, geri dönüş, olay günlüğü, `DisplayVersion` öz-onarımı                                                                                                         |
| `apps/server/src/update/*` (yeni)                          | `manifest-store.ts` (oku, doğrula, kapıla, stat anahtarlı önbellek), `routes.ts` (public uçlar), `service-token.ts` (tek kullanımlık belirteç, bellek), `events.ts` (doğrula, kimlik çöz, hız sınırı, audit, metrik), `device-update.ts` (WS mesajları, cihaz durum sütunları), `versions.ts` (dağılım) |
| `apps/server/src/unattended/hub.ts` / `connect.ts`         | `markUpdating(id, ttl)` / `isUpdating(id)`; ön denetimde `DEVICE_UPDATING`                                                                                                                                                                                                                              |
| `apps/web`                                                 | Liste "Sürüm" sütunu + rozet, dağılım şeridi, `/settings/clients` sayfası, audit etiketleri                                                                                                                                                                                                             |
| `deploy/agent/publish-manifest.sh` + `verify-manifest.mjs` | Release'ten manifest çiftini indirir, attestation + imza (Node `crypto.verify`) + SHA256SUMS ile doğrular, volume'a atomik koyar                                                                                                                                                                        |

## 3. Veri modeli

Tek migration **`20261128000000_p29_client_update`** (P22-G paralelse zaman damgası birleştirmede ayarlanır). Yeni tablo **yok** → `grants.sql`
değişmez (tablo düzeyi UPDATE mevcut; yalnız açıklayıcı yorum satırı eklenir). INSTANT/INPLACE `ADD COLUMN`, kilit yok.

### 3.1 `tenant_settings`

| Alan                 | Tip                             | Kural                                                                                           |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `client_auto_update` | `BOOLEAN NOT NULL DEFAULT TRUE` | Mevcut firmalar TRUE (AC-485 varsayılan Açık). Prisma `clientAutoUpdate Boolean @default(true)` |

### 3.2 `unattended_devices` (yalnız ekleme)

| Alan             | Tip                | Kural                                                                                                                                   |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `update_state`   | `VARCHAR(12) NULL` | `AVAILABLE \| INSTALLING \| FAILED \| ROLLED_BACK \| SKIPPED`; CHECK ikili karşılaştırma (ADR-0014). NULL = olay yok                    |
| `update_version` | `VARCHAR(20) NULL` | Hedef sürüm; CHECK `REGEXP '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\z'`                                                                  |
| `update_reason`  | `VARCHAR(24) NULL` | `FAILED/SKIPPED/ROLLED_BACK` nedeni (§4.1 enum); CHECK: `update_state IN ('FAILED','SKIPPED','ROLLED_BACK')` ise NOT NULL, değilse NULL |
| `update_at`      | `DATETIME(3) NULL` | Son olay zamanı (sunucu saati)                                                                                                          |

Yazma kuralları: `available/failed/rolled_back/skipped` olayı ve `update.state{installing}` → dört alan birlikte (koşullu UPDATE `WHERE id=? AND tenant_id=?
AND revoked_at IS NULL`). `device.auth` yeni `agent_version` ≥ `update_version` ise dört alan NULL'a çekilir (kurulum tamam; `installed` olayı
da aynı işi yapar). İndeks: yeni yok — dağılım `GROUP BY agent_version` mevcut `(tenant_id, revoked_at, name)` ile tenant başına ≤ birkaç yüz
satır; Super Admin "tüm firmalar" tam tarama (tablo küçük, `unattended.view` sayfası, 60 sn önbellek).

Rozet türetimi (sunucu, `versions.ts` tek işlev `deviceUpdateBadge`; öncelik sırası):

1. `MIN_AGENT_VERSION` dolu ve `agent_version < MIN` → `BELOW_MIN` "Asgari sürümün altında" (kırmızı).
2. `update_state=INSTALLING` ve `update_at > now−3 dk` → `UPDATING` "Güncelleniyor".
3. `update_state ∈ {FAILED, ROLLED_BACK}` ve `update_version > agent_version` → `FAILED` "Güncelleme başarısız (<neden>)".
4. Yayındaki servis sürümü (sunulabilir manifest) `> agent_version` ya da `update_state ∈ {AVAILABLE, SKIPPED}` → `PENDING` "Güncelleme bekliyor".
5. Aksi → `CURRENT` "Güncel". (Sunulabilir manifest yoksa 4. madde yalnız DB durumuna bakar.)

### 3.3 Silme stratejisi

Yeni varlık yok; alanlar cihaz satırıyla birlikte silinir (mevcut gece temizliği / firma silme). Audit satırları mevcut saklama süresine tabidir.
Down: dört sütun + `client_auto_update` `DROP COLUMN` (`down.sql`, ön denetimsiz; veri kaybı yalnız durum).

## 4. API sözleşmesi (zod tek kaynak `packages/contracts/src/api/update.ts` — yeni yaprak modül)

### 4.1 Sabitler ve şemalar

```
UPDATE_MANIFEST_CONTEXT = "rs-update-manifest-v1\n"
UPDATE_ENVS = ["prod","staging"]; UPDATE_PLATFORMS = ["windows","macos","linux"]
UPDATE_ARCHES = ["amd64","universal"]          // windows/linux amd64, macOS universal
UPDATE_COMPONENTS = ["client","service"]       // service yalnız windows/amd64
updateManifestSchema = strictObject({
  schema: literal(1), env, platform, arch, component,
  version: DEVICE_VERSION_PATTERN, sha256: /^[a-f0-9]{64}$/, size: int 1..104857600,
  issuedAt: ISO-8601 UTC, expiresAt: ISO-8601 UTC (issuedAt < expiresAt ≤ issuedAt+90 g),
  minUpdaterVersion: DEVICE_VERSION_PATTERN })            // ≤ 2048 bayt
UPDATE_EVENT_TYPES = ["available","installed","failed","rolled_back","skipped"]   // installing yalnız update.state (§4.3)
UPDATE_FAIL_REASONS = ["DOWNLOAD","HASH_MISMATCH","MANIFEST_SIGNATURE","PLATFORM_SIGNATURE","DOWNGRADE","EXPIRED","ENV_MISMATCH","INSTALL","HEALTH"]
UPDATE_SKIP_REASONS = ["POLICY_OFF","NOT_WRITABLE","MANUAL_ONLY"]
UPDATE_SECURITY_REASONS = ["MANIFEST_SIGNATURE","PLATFORM_SIGNATURE","DOWNGRADE","HASH_MISMATCH","ENV_MISMATCH"]  // AC-489
updateEventSchema = strictObject({ type, version, fromVersion, reason?: (fail|skip enum; type'a göre refine), at: ISO })
```

`HEALTH` = servis sağlık denetimi geçmedi
(`rolled_back` olayının nedeni). `MANUAL_ONLY` AC-487 listesine **ek** (macOS ad-hoc, `minUpdaterVersion`; sapma §13 D-5).

### 4.2 `GET /api/v1/public/agent/update?platform=&arch=&component=client[&ref=]` (kimliksiz; ADR-0012 AGENT kuralı)

- Sorgu zod (`platform/arch/component`); geçersiz → 400 `VALIDATION`; `ref` desen dışıysa 400 **değil**, sessizce `auto` (r2, T-9). `component=service` bu uçta **kabul edilmez** (400; servis WS kullanır).
- 200 `{ manifest: base64(ham bayt), signature: b64url(64), policy: "auto"|"notify" }`; sunulabilir manifest yoksa **204**. Sunucu yalnız hash
  ile kapılar (K-P29-5), istemci her şeyi yeniden doğrular.
- `ref` (isteğe bağlı, müşteri dosyası `[a-z2-7]{16}`): aktif ref'in tenant'ında `client_auto_update=false` → `notify`; ref yok/desen dışı/geçersiz/pasif → `auto`
  (yanıt kodu aynı; DB araması desenden bağımsız her istekte tek sorgu; ref başarısız arama kovasına sayılmaz). Pratikte oracle değil (80 bit, 60/sa; T-9). Ref loga yazılmaz (`maskUrl`).
- Başlıklar: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Hız: IP (IPv6 /64) başına 60/sa → 429 `RATE_LIMITED`.
- `MIN_AGENT_VERSION` uygulanmaz (K-P29-19). Eski sunucuda uç yok → 404 → istemci sessiz (AC-493).

### 4.3 WS `/ws/device` eki (`packages/contracts/src/ws-device.ts` — yalnız ekleme; `docs/mimari-protokol.md` P27 bölümüne "P29 eki")

Yetenek: alt protokol belirteci `rs.cap.update1` → `DeviceFeature "update1"` (`DEVICE_FEATURES`'e ek, `DEVICE_ANNOUNCED_FEATURES`'e ek).
Sunucu `update.*` mesajlarını **yalnız** `hub.has(id,"update1")` iken gönderir/kabul eder; eski servis (≤ 0.21) hiç görmez (AC-493).

| Yön | Mesaj                  | Alanlar                                               | Kural                                                                                                                                                                                                                                |
| --- | ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S→C | `update.offer`         | `manifest` (b64), `signature`, `policy: auto\|notify` | **Belirteç yok.** `device.ready`'den hemen sonra (sunucunun P29 desteğini de duyurur), servis `update.check` gönderince ve politika değişince (≤ 60 sn; AC-485). Manifest değişince itme **yok**; servis bir sonraki denetimde görür |
| S→C | `update.none`          | —                                                     | Sunulabilir servis manifesti yok (AC-492'deki "uç 204" karşılığı)                                                                                                                                                                    |
| S→C | `update.token`         | `version`, `token` (b64url 32 bayt)                   | Yalnız `update.token.request`'e yanıt; `policy=auto`, `version` = sunulabilir manifest sürümü ve > cihaz sürümü iken; aksi `update.none`                                                                                             |
| C→S | `update.check`         | —                                                     | 24 sa ± 2 sa; cihaz başına 4/sa (fazlası yok sayılır)                                                                                                                                                                                |
| C→S | `update.token.request` | `version`                                             | Servis, offer'ı doğruladıktan sonra **0–120 dk rastgele gecikmeyle** ister (indirme sapması, §8); cihaz başına 4/sa                                                                                                                  |
| C→S | `update.state`         | `phase: "installing"`, `version`                      | `installing`'in **tek** kanalı: sunucu `hub.markUpdating(id, 3 dk)` + DB `INSTALLING` + metrik; audit yok                                                                                                                            |
| C→S | `update.event`         | `updateEventSchema`                                   | §4.6 işleme; cihaz başına 10/sa (AC-488), fazlası yok sayılır + metrik `rate_limited`                                                                                                                                                |

**Eski sunucu kuralı (AC-493, §9.5 geri alma):** mevcut `device-ws.ts` bilinmeyen `t`'de soketi 1008 ile kapatır. Bu yüzden servis `update.*`
mesajı (check, token.request, state, event) **yalnız** o bağlantıda sunucudan `update.offer` veya `update.none` almışsa gönderir. Bunları
almadıysa (eski sunucu) güncelleme kapalıdır ve olay kuyrukta bekler (Go birim testi: sahte eski sunucuyla 0 `update.*` mesajı).

Mesaj boyutu mevcut 4 KiB sınırında (manifest ≤ 2 KiB + base64 ≈ 2,8 KiB). `deviceInboundSchema` ayrımlı birleşimine dört tür eklenir.

### 4.4 `GET /api/v1/public/agent/update/service-file` + `Authorization: Bearer <token>` (kimliksiz, belirteçli; r2 T-10 — sorgu dizesi kabul edilmez)

- Belirteç: yalnız `update.token` ile (servisin kendi isteğine yanıt) üretilir, 32 bayt rastgele, bellekte `{deviceId, sha256, exp: now+10 dk}`, **tek kullanım** (ilk GET'te silinir),
  cihaz başına en çok 1 canlı belirteç. Geçersiz/kullanılmış/süresi dolmuş → 404 (tek tip). IP başına 20/dk.
- Akış dosyası `UNATTENDED_AGENT_PATH`; gönderimden önce `unattendedBinary.check()==="ok"` (stat anahtarlı önbellek, **istek başına hash yok**) ve kapının beklenen SHA'sı = belirteçteki `sha256` → aksi 503 `NOT_READY`.
- Global eşzamanlı akış sınırı **8** → aşımda 503 + `Retry-After: 300`; istemci en az bu kadar bekler (T-10). İstemci gövdeyi `size+1` baytta keser.
- `Content-Type: application/octet-stream`, `Cache-Control: no-store`. Belirteç yalnız `Authorization` başlığında (Caddy filtresi zaten siler, logger REDACT `req.headers.authorization`). Audit yok (olay zaten gelir), metrik `rs_agent_update_download_total{component,result}`.

### 4.5 `POST /api/v1/public/agent/update-events` (kimliksiz veya kayıt anahtarlı)

Gövde (≤ 8 KiB): `{ platform, arch, component: "client", bindingKeys?: string[≤5], events: updateEvent[1..20] }`. Yanıt **204** (her durumda,
geçersiz anahtar dahil — anahtar oracle'ı yok); biçim hatası 400; hız aşımı 429.

- Hız (r2, T-5): IP (IPv6 /64) 10 istek/sa **ve** 30 olay/sa; istek başına en çok 5 anahtar çözümü; kimlik (her geçerli `binding.keyHash`) 10 olay/sa. Aşan olaylar yazılmaz, `rs_agent_update_total{result="rate_limited"}`.
- Kimlik: her `bindingKey` mevcut `resolveUsable` ile çözülür (iptal/pasif → yok sayılır); `last_used_at` **değişmez**. Çözülen her kayıt için
  ilgili tenant'a audit (§4.7). Hiçbiri çözülmezse yalnız metrik (V-P29-6).
- `bindingKey` yalnız gövdede; logger REDACT `*.bindingKeys`; 400 `VALIDATION` yanıtı ve logu zod ayrıntısında **değer yansıtmaz** (yalnız yol/kod; T-12, yanıt zarfı testi).

### 4.6 Olay işleme (servis ve taşınabilir ortak: `update/events.ts`)

1. zod; `version`/`fromVersion` desen; `platform/component/result` etiketleri yalnız enum'dan (kimliksiz girdiden sürüm **etiketi** üretilmez).
2. Metrik (r2, T-5): `rs_agent_update_total{platform,component,result=<type>,source}`; `failed` + güvenlik nedeni → `rs_agent_update_rejected_total{reason,source}`; `source = device | binding | anonymous` (enum, kimlik kanalından; istemci beyan etmez). Alarm kuralı §14 T-5.
3. Kimlikliyse audit (§4.7); servis ise cihaz durum sütunları (§3.2).
4. Periyodik "güncelim" olayı yoktur (istemci göndermez); denetim sayısı yalnız `rs_agent_update_check_total{platform,component,result}`.

### 4.7 Audit (`packages/contracts/src/audit.ts` — yeni `CLIENT_UPDATE_AUDIT`, yalnız ekleme)

```
CLIENT_UPDATE_AUDIT = { AVAILABLE:"client.update.available", INSTALLED:"client.update.installed",
  FAILED:"client.update.failed", ROLLED_BACK:"client.update.rolled_back", SKIPPED:"client.update.skipped" }
```

| Alan                        | Değer                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `user_id` / `username`      | NULL / `device` (servis) veya `client` (kayıtlı bilgisayar)                                                                |
| `entity` / `entity_id`      | `unattended_devices`/deviceId veya `device_bindings`/bindingId                                                             |
| `new_value`                 | `{ fromVersion, version, reason?, platform, component, source: "device"\|"binding" }` (r2 T-5; anahtar, belirteç, yol yok) |
| `result`                    | `failed`, `rolled_back` → `fail`; diğerleri `success`                                                                      |
| `ip_address` / `user_agent` | mevcut kural                                                                                                               |

`available` sürüm başına bir kez (istemci tekilleştirir; sunucu ayrıca servis için `update_state=AVAILABLE AND update_version=v` ise yazmaz).
Etiketler (`CLIENT_UPDATE_AUDIT_LABELS`): "İstemci güncellemesi bulundu", "İstemci güncellendi", "İstemci güncellemesi başarısız",
"İstemci güncellemesi geri alındı", "İstemci güncellemesi atlandı". AC-491: liste hücresinde `failed` + güvenlik nedeni → "Güncelleme reddedildi
(imza|platform imzası|eski sürüm|bütünlük|ortam)" (`lib/audit/actions.ts` içinde `actionLabel` için tek özel durum işlevi `clientUpdateLabel`).
Filtre grubu "İstemci güncelleme" (5 eylem).

### 4.8 Panel uçları

| Uç                                                       | Yetki                                                        | Girdi / Çıktı                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/unattended/devices` (değişir, ek alan)      | `unattended.view` (mevcut)                                   | Satıra `agentVersion`, `updateBadge: CURRENT\|PENDING\|UPDATING\|FAILED\|BELOW_MIN`, `updateReason?`, `updateVersion?`; sorguya `version=` süzgeci (desen)                                                                                                   |
| `GET /api/v1/unattended/versions[?scope=all]`            | `unattended.view`; `scope=all` yalnız Super Admin (aksi 403) | `{ published: { service: {version, expiresAt} \| null, client: {windows, macos, linux} }, rows: [{platform:"windows", component:"service", version, count}], belowMin: n }`; tenant kapsamı `tenantScope(req)` — başka tenant 404 değil, yalnız kendi verisi |
| `GET /api/v1/settings/client-update`                     | `settings.view`                                              | `{ autoUpdate: boolean }`                                                                                                                                                                                                                                    |
| `PUT /api/v1/settings/client-update`                     | `settings.edit` (step-up **yok**, AC-485)                    | `{ autoUpdate }` → 200 aynı gövde; audit `settings.client_update` `{old,new}` (`tenant_settings`/tenantId); değişince açık `update1` soketlerine yeni `update.offer`/politika (≤ 60 sn)                                                                      |
| `POST /api/v1/public/bindings/status` (değişir, ek alan) | —                                                            | Yanıta `autoUpdate: boolean` (eski istemci yok sayar; `BindingInfo` zod `.extend`)                                                                                                                                                                           |

Yeni hata kodu (`contracts/errors.ts`, yalnız ekleme): `DEVICE_UPDATING` (409) "Cihaz güncelleniyor, birazdan tekrar deneyin."

## 5. Güvenlik tasarımı (ADR-0040)

### 5.1 İstemci doğrulama sırası (`update.Verify`, tüm platformlar — tek işlev, AC-474)

Girdi: manifest baytları, imza, gömülü `{env, keys[≤2]}`, çalışan `{platform, arch, component, version}`, `maxSeen`, saat.

1. Gömülü anahtar yoksa → güncelleyici kapalı (olay yok).
2. Manifest ≤ 2 KiB ve imza 64 bayt; `ed25519.Verify(k, CONTEXT‖bayt, imza)` iki yuvadan biriyle → aksi `MANIFEST_SIGNATURE`.
3. Katı ayrıştırma (bilinmeyen alan, eksik alan, `schema≠1`) → `MANIFEST_SIGNATURE` (imzalı ama okunamayan = güvenilmez).
4. `env ≠ gömülü env` → `ENV_MISMATCH`. `platform/arch/component` uyuşmuyor → olay yok, "yayın yok" (sunucu hatası, güvenlik olayı değil).
5. `now > expiresAt` ya da `expiresAt − issuedAt > 90 g` → `EXPIRED`.
6. `version ≤ çalışan` ya da `version < maxSeen` → `DOWNGRADE` (eşit sürüm = güncel, olay yok). Geçerse `maxSeen = max(maxSeen, version)`.
7. `çalışan < minUpdaterVersion` → `skipped(MANUAL_ONLY)`.
8. İndirme: yalnız gömülü köken + sabit yol, TLS (mevcut `api.Client` taşıyıcısı, sistem kökleri), `CheckRedirect` → hata; gövde
   `size`'ı aşarsa (en çok 2×size okuma, AC-477) → `DOWNLOAD`; uzunluk ≠ size → `HASH_MISMATCH`; SHA-256 yazarken hesaplanır, ≠ → `HASH_MISMATCH`.
9. Platform imzası (K-P29-13) → `PLATFORM_SIGNATURE`.
10. Hata durumunda geçici dosya **silinir**; kurulum sayacı artmaz.

**TOCTOU kuralı (R-P29-9):** doğrulanan bayt = kurulan bayt. Geçici dosya `O_EXCL`/`CREATE_NEW` ile yalnız sahibin erişebildiği konumda açılır;
SHA, diske yazılan akış üzerinden hesaplanır; Windows'ta tutamaç **paylaşımsız** (`share=0`) açık tutulur, kapatılmadan `FlushFileBuffers`,
kapatıldıktan hemen sonra yeniden adlandırılır. Servis gözetmeni ayrıca `yeni.bin`'i `share=FILE_SHARE_READ` ile açar, SHA'yı **aynı tutamaçtan**
yeniden hesaplar ve Program Files'taki `.yeni` dosyasına aynı tutamaçtan kopyalar (kopyalanan akışın SHA'sı da karşılaştırılır). Arada araya
girebilecek tek aktör SY/BA'dır (klasör ACL'si), o da zaten Program Files'a yazabilir → sınır yerel yöneticidir.

### 5.2 Taşınabilir kurulum (B, C, D) ortak akış

```
açılış: (sonraki açılış temizliği: kendi adının .eski kopyasını sil) → Check (24 sa ± 2 sa zamanlayıcı)
  → 204/404/ağ hatası: sessiz, sonraki dönem (AC-478)
  → Verify(1–7) → available olayı (sürüm başına 1; AC-485 "yalnız available bildirir")
  → policy=notify → skipped(POLICY_OFF) (sürüm başına 1) + bilgi satırı "Yeni sürüm var — indirme bağlantısı"
  → yazılabilirlik denetimi (deneme dosyası oluştur-sil; Windows sabit disk; macOS translocation; Linux sahip+noexec)
      başarısız → skipped(NOT_WRITABLE) + aynı bilgi satırı
  → indir + Verify(8–9) (oturum sürüyor olabilir; indirme düşük öncelik)
  → oturum yok anına kadar bekle → yer değiştir (K-P29-9/10/11) → installed olayı (eski süreç)
     → bilgi satırı (bir kez) "Yeni sürüm (x.y.z) hazır — programı sonraki açışınızda kullanılacak" (AC-482)
```

Bilgi satırı Windows'ta ana ekran (`launch/home_text.go`), macOS/Linux'ta mevcut karşılama/bitiş ekranının bilgi alanı; metinler `internal/update/messages.go`
tek tablosunda (P22-G'nin `flow/messages*.go` dosyalarına dokunulmaz). İndirme bağlantısı: kayıtlı firma varsa tenant'ın mevcut müşteri indirme
bağlantısı (bindings yanıtındaki bilgi), yoksa sunucunun karşılama adresi (`https://<köken>/`).

### 5.3 Windows servis akışı (A, AC-479..481)

```
servis (eski, SYSTEM)                                   gözetmen (eski ikili, --update-apply, SYSTEM)
1 update.offer + Verify(1–7) → available olayı; policy=notify → skipped(POLICY_OFF), dur (panel "Güncelleme bekliyor")
1b 0–120 dk rastgele bekle → update.token.request → update.token
2 Guncelleme\ (DataDirSDDL; yoksa createSecureDir, varsa VerifyDir)
3 GET service-file?t= → yeni.bin (CREATE_NEW, share=0), Verify(8–9)
4 durum.json {phase:"staged", target, prev, sha256, nonce}
5 oturum yok + bekleyen connect yok → update.state{installing}
  2 sn bekle (connect gelirse → iptal, sonra yeniden)
6 gözetmeni başlat (CreateProcess, job dışı, ağsız argüman) ───▶ 7 jeton = LocalSystem değilse çık; durum.json oku (phase=staged)
  servis kendi işini bitirir                                 8 yeni.bin'i aç (share=READ) → SHA → Program Files\NoktaDestekServis.exe.yeni'ye aynı tutamaçtan kopya + SHA
                                                             9 servisi durdur (≤ 20 sn; mevcut stopService)
                                                            10 MoveFileEx(exe → exe.eski) → MoveFileEx(exe.yeni → exe) [2. başarısız → 1. geri]
                                                               durum.json phase=swapped
                                                            11 servisi başlat; 60 sn boyunca 1 sn'de bir: SCM durumu + durum.json phase=healthy?
yeni servis: açılışta durum.json phase=swapped görür → device.auth → device.ready
  → kendi sürümü = target ise phase=healthy(nonce) yazar ─────▶ 12a healthy → yeni.bin sil, phase=done, çık (kendi imajı exe.eski'yi silemez)
  → installed olayı (prev→target), DisplayVersion = kendi sürümü
                                                            12b 60 sn doldu / SCM STOPPED → servisi durdur → exe → exe.bozuk, exe.eski → exe
                                                               → başlat → phase=rolled_back, blocked{target, until: now+24 sa}, çık
eski servis yeniden: phase=rolled_back → rolled_back(HEALTH) olayı + olay günlüğü; target 24 sa denenmez
```

- SCM kurtarma eylemleri (3×10 sn yeniden başlat) değişmez: gözetmenin `Control(Stop)` ile durdurması kurtarmayı tetiklemez; yeni ikili çökerse
  SCM yeniden başlatır, gözetmen 60 sn içinde `healthy` görmezse geri döner. Geri dönüş toplamı ≤ 20 + 2 + 60 + 20 + bağlantı ≈ 2 dk (AC-480).
- **Artık dosya temizliği:** gözetmen kendi çalışan imajını silemez (`exe.eski` = gözetmen, açık tepsi süreçleri de tutabilir). Silme
  servis açılışında yapılır: servis her açılışta `phase ∈ {done, rolled_back}` ise `exe.eski` ve `exe.bozuk`'u siler; silinemezse (kullanımda)
  24 sa'te bir yeniden dener. Tepsi süreçleri sürüm farkında yeniden başladığından (K-P29-21) en geç bir sonraki denemede serbest kalır.
- **Gözetmensiz durumlar (`durum.json` faz kuralı, servis açılışında):**
  - `phase=swapped` ve kendi sürümü = target: yeni servis normal akışla `device.ready` sonrası `healthy` yazar ve gözetmen yoksa (PID ölü)
    tamamlamayı kendisi yapar (`installed` olayı, `phase=done`).
  - `phase=swapped` ve kendi sürümü = prev: gözetmen geri dönüşü bitirememiş; `rolled_back(INSTALL)` bildirilir, 24 sa blok.
  - **Yeniden başlatma 60 sn penceresinde** (gözetmen ölür, bozuk yeni ikili açılışta çökmeye devam eder): kendini kurtaramaz → **R-P29-15**.
    Aday önlem (K0s spike'ı doğrular, güvenlik turuna soru): gözetmen yer değiştirmeden önce `MoveFileEx(exe.eski → exe, MOVEFILE_DELAY_UNTIL_REBOOT
\| REPLACE_EXISTING)` kaydeder, `healthy` sonrası kaydı geri alır; böylece pencere içinde yeniden başlatmada Windows eski ikiliyi geri koyar.
    Spike olumsuzsa kurtarma = kurulumu yeniden çalıştırmak (runbook).
  - İki `MoveFileEx` arasında güç kesintisi (`exe` yok, servis başlamaz) → R-P29-11; kurtarma: kurulumu yeniden çalıştırmak (`Install`→`Update`, kayıt korunur).
- Korunanlar (AC-481): `device.key` (DPAPI makine), HKLM `LocalEnabled`, servis kaydı/ImagePath (yol aynı), Run ve Uninstall (yalnız
  `DisplayVersion` yeni servis açılışında öz-onarımla), klasör ACL'leri (yeni dosya aynı Program Files klasöründe oluşur → aynı miras ACL, kurulumdaki
  `copyFile` ile aynı). `deviceId` değişmez → panelde aynı cihaz, grant'lar aynı.
- Olay günlüğü (AC-489): `EvUpdate` 1010 kuruldu, 1011 geri dönüldü, 1012 reddedildi (neden) — `eventlog_windows.go` kalıbı.
- `--update-apply` kip tablosuna eklenir (`mode.go`); kullanıcı çalıştırırsa jeton denetiminde çıkar; `yeni.bin` SY/BA dışında okunamaz.
- `durum.json` (≤ 8 KiB, atomik yaz): `{maxSeen, phase, target, prev, sha256, nonce, blocked:{version,until}, availableSent:[ver], queue:[≤20 olay]}`.

### 5.4 Tehdit modeli (STRIDE özeti; K0g güvenlik turu S-P29-n numaralarını ekler)

| Tehdit                                           | Saldırgan elinde     | Sonuç / önlem                                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sahte sunucu / MITM                              | Ağ                   | TLS + gömülü köken; manifest imzası olmadan kurulum yok → yalnız hizmet engelleme                                                                                                                                                                      |
| Ele geçirilmiş sunucu (anahtar yok)              | Sunucu               | Kendi manifestini imzalayamaz; eski imzalı manifesti yeniden sunabilir → süre ≤ 90 g + `maxSeen` (K-P29-14); yalnız gerçek ama eski sürüm. Sahte ikili → `HASH_MISMATCH` + alarm                                                                       |
| Sızmış imza anahtarı (sunucu yok)                | Anahtar              | İstemci yalnız gömülü kökenden indirir → sunucuya ikili ve manifest koyamadan etkisiz                                                                                                                                                                  |
| Anahtar + sunucu (pratikte tek hesap, S-P29-T-1) | İkisi                | **Kritik — kullanıcı tarafından kabul edilen risk (2026-11-19, tek imza).** Sertleştirmeler §14.1: onaylı ortam secret'ı, etiket ruleset'i, yedek anahtar/rotasyon, attestation, alarm, staging-önce 24 sa kuralı; platform imzası gelince ikinci kapı |
| Ele geçirilmiş CI / workflow                     | Repo yazma           | Ortam koruması (onaylayıcı + etiket ruleset'i), Action'lar SHA sabit; özel anahtar log/artifact'a yazılmaz (`::add-mask::`, AC-471)                                                                                                                    |
| Staging manifesti prod'a                         | Staging anahtarı     | Prod istemci staging anahtarını gömmez + `env` alanı (AC-472)                                                                                                                                                                                          |
| Downgrade / replay                               | Sunucu               | §5.1 adım 5–6                                                                                                                                                                                                                                          |
| Servis klasörüne yerel yazma / TOCTOU            | Yerel kullanıcı      | `Guncelleme\` SY/BA; kullanıcı yazamaz; `Gelen\` kullanılmaz; aynı tutamaçtan doğrula-kopyala (§5.1)                                                                                                                                                   |
| Taşınabilir klasöre yerel yazma                  | Aynı kullanıcı       | Aynı güven sınırı (kullanıcı exe'yi zaten değiştirebilir); paylaşımsız tutamaç                                                                                                                                                                         |
| Sahte olay seli / audit kirletme                 | Ağ                   | Kimliksiz audit'e girmez; IP 30/sa, kimlik 10/sa, cihaz WS 10/sa; metrik etiketleri yalnız enum                                                                                                                                                        |
| Belirteçle servis ikilisi sızması                | Log okuyucu          | Tek kullanım, 10 dk, loglanmaz; ikili zaten açık kaynak derlemesi (gizli değil, yalnız public listelenmiyor)                                                                                                                                           |
| `DEVICE_UPDATING` ile bağlantı engelleme         | Ele geçirilmiş cihaz | Yalnız kendi cihazı; 3 dk TTL, yenileme `update.state` 4/sa                                                                                                                                                                                            |
| AV/EDR "dropper" algısı (R-P29-2)                | —                    | Yan klasöre kopya yok, ProgramData'dan exe çalıştırma yok, gözetmen kurulu yoldaki imaj; yayın öncesi AV kapısı güncelleme senaryosuyla                                                                                                                |

### 5.5 Hassas veri ve başlıklar

Yeni kişisel veri yok (sürüm, hash, neden). `bindingKeys`, servis belirteci, ref, imza anahtarı hiçbir log/audit/metrikte yok. Public uçlarda
`Cache-Control: no-store`, `nosniff`; Origin kuralı ADR-0012 (AGENT). Özel anahtar: GitHub ortam secret'ı → yalnız `update-sign` sürecinin ortam
değişkeni; betik `set +x`, `::add-mask::`, diske yazılmaz.

## 6. Web rotaları ve ekranlar (DESIGN.md "Vitrin" tokenları; `lucide-react`; iki tema; 390 px; axe 0)

| Rota                                                                      | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 5 durum                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/unattended` (liste)                                                     | Yeni sütun **Sürüm** (`agentVersion` + rozet metni; renk yalnız ek bilgi): Güncel (`CircleCheck`), Güncelleme bekliyor (`Clock`), Güncelleniyor (`RefreshCw`, dönmez — hareket yok), Güncelleme başarısız (<neden>) (`TriangleAlert`), Asgari sürümün altında (`ShieldAlert`, tehlike tokenı). Üstte **sürüm dağılımı şeridi**: "Yayındaki servis sürümü x.y.z" + sürüm → cihaz sayısı düğmeleri; tıklayınca `?version=` süzgeci (URL'de, geri alınabilir "Süzgeci kaldır"). Super Admin'de "Tüm firmalar" anahtarı (`scope=all`, salt sayılar, cihaz adı yok) | yükleniyor (şerit iskeleti), boş ("Henüz gözetimsiz cihaz yok" mevcut), hata (yeniden dene), kısmi (yayın bilgisi yok → yalnız dağılım, "Yayın bilgisi alınamadı"), başarılı |
| `/unattended/[id]`                                                        | Mevcut sürüm satırına rozet + son güncelleme olayı ("0.22.0 → 0.22.1, 19.11.2026 14:02, başarısız: bütünlük")                                                                                                                                                                                                                                                                                                                                                                                                                                                  | mevcut                                                                                                                                                                       |
| `/settings/clients` (yeni; kenar menüsü "İstemciler", ikon `MonitorDown`) | Tek anahtar "İstemcileri otomatik güncelle" + açıklama "Kapalıyken programlar yeni sürümü kurmaz, yalnız haber verir. Asgari sürüm kuralı yine uygulanır." İyimser kayıt yok, kaydet düğmesi + Sonner toast                                                                                                                                                                                                                                                                                                                                                    | yükleniyor, hata, başarılı (boş/kısmi uygulanmaz)                                                                                                                            |
| `/audit`                                                                  | "İşlem" süzgecine "İstemci güncelleme" grubu; satır etiketi §4.7; ayrıntıda neden etiketi                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | mevcut                                                                                                                                                                       |

Metinler `messages/tr.json` (`upd.*` anahtarları, yalnız ekleme). Rozetler yalnız renkle değil metinle (a11y).

## 7. Dosya / klasör planı

| Alan           | Yeni                                                                                                                                                                                                                                               | Değişen (yalnız ekleme işaretli: +)                                                                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB             | `prisma/migrations/20261128000000_p29_client_update/{migration.sql,down.sql}`                                                                                                                                                                      | `schema.prisma` (+), `prisma/sql/grants.sql` (+ yorum), `docs/db-notlari.md` (+)                                                                                                                                                                                                                                   |
| contracts      | `src/api/update.ts`                                                                                                                                                                                                                                | `ws-device.ts` (+ `update1`, 5 mesaj), `errors.ts` (+ `DEVICE_UPDATING`), `audit.ts` (+ `CLIENT_UPDATE_AUDIT`, etiketler, `settings.client_update`), `api/unattended.ts` (+ liste alanları, versions şeması), `api/bindings.ts` (+ `autoUpdate`), `package.json` exports (+)                                       |
| server         | `src/update/{manifest-store,routes,service-token,events,device-update,versions,settings-route}.ts` + testler                                                                                                                                       | `env.ts` (+2 değişken), `app-routes.ts` (+ kayıt), `unattended/{hub,connect,device-ws,device-msg,repo,routes}.ts` (+), `bindings/service.ts` (+ `autoUpdate`), `ops/metrics.ts` (+), `lib/logger.ts` (+ REDACT `*.bindingKeys`)                                                                                    |
| web            | `app/(panel)/settings/clients/page.tsx`, `app/(panel)/unattended/(list)/version-strip.tsx`, `components/update-badge.tsx`                                                                                                                          | `unattended/(list)/page.tsx` + tablo (+ sütun), `unattended/[id]/page.tsx` (+), `side-nav.tsx` / `app-routes.ts` (+ İstemciler), `lib/audit/actions.ts` (+ `clientUpdateLabel`), `messages/tr.json` (+)                                                                                                            |
| Go ortak       | `internal/update/{manifest,verify,version,check,download,decide,queue,messages}.go` + `_test.go`, `internal/update/install_{windows,darwin,linux}.go`, `internal/api/update.go`, `cmd/update-sign/main.go`, `build/update-keys/{prod,staging}.pub` | `internal/config/config.go` (+ `updateEnv`, `updateKeys`), `internal/api/bindings.go` (+ `AutoUpdate` alanı)                                                                                                                                                                                                       |
| Go servis      | `internal/servis/{update.go,update_windows.go,update_apply_windows.go,update_test.go}`                                                                                                                                                             | `mode.go` (+ `--update-apply`), `wire.go`/`wsdevice.go` (+ mesajlar, `update1`), `eventlog_windows.go` (+ 1010–1012), `registry_windows.go` (+ DisplayVersion öz-onarım), `pipecmd.go` (+ `version` alanı), `cmd/noktadestek-servis/main.go` (+ kip), `internal/servisui` tepsi (+ sürüm farkında yeniden başlama) |
| Go taşınabilir | —                                                                                                                                                                                                                                                  | `cmd/noktadestek/{main.go,main_darwin.go,main_linux.go}` (+ güncelleyici başlatma ve oturum sonu kancası), `internal/launch/{home.go,home_text.go}` (+ bilgi satırı), `internal/tray/resident.go` (+ 24 sa zamanlayıcı kancası)                                                                                    |
| CI / deploy    | `deploy/agent/{publish-manifest.sh,verify-manifest.mjs,test-publish-manifest.sh}`                                                                                                                                                                  | `.github/workflows/agent-win.yml` (+ `update-manifest`, `update-manifest-stg`, `update-resign` işleri; build ldflags), `build/build*.sh` (+ ldflags), `deploy/docker-compose.yml` (+ server env), `.env.example` (+), `docs/runbook.md` (+ §29)                                                                    |
| Doküman        | `docs/mimari-p29.md`, ADR-0040                                                                                                                                                                                                                     | `tasarim-kontrol.md` (+), `mimari-e11.md` (+ satır), `mimari-protokol.md` (+ P29 eki), `api.md`, kılavuz, DATASHEET, CHANGELOG 0.22.0                                                                                                                                                                              |

**P22-G'ye dokunulmayanlar:** `internal/{flow,signal,dc,rtc}/*`, `internal/request/chat*`, `internal/api/requests.go`, `internal/ui/uicore/accept.go`,
`contracts/src/{ws-chat,chat,ws}.ts`. Oturum sonu kancası `flow` paketine değil `cmd/noktadestek/*` içindeki `flow.Run` dönüşüne bağlanır.

## 8. Performans ve ölçek

- Denetim isteği ≤ 2 KiB (GET + kısa sorgu); yanıt ≤ 4 KiB. Manifest okuma: stat anahtarlı önbellek, en çok 60 sn'de bir `stat` (AC-473 "≤ 5 dk").
- 24 sa ± 2 sa rastgele sapma (+ açılış) → 200 cihazın indirmesi güne yayılır; servis ikilisi ≈ 15 MB × 200 = 3 GB/gün ≈ 0,3 Mbit/s ortalama (AC NFR ≤ %50).
- Servis kurulum kesintisi: dur (≤ 20 sn) + yer değiştir (< 1 sn) + başla (< 5 sn) ≤ 30 sn; sağlık denetimi ek.
- Belirteç ve güncelleniyor bayrağı bellekte (tek instance). Dağılım sorgusu tenant başına tek `GROUP BY`, Super Admin 60 sn önbellek.

## 9. Operasyon

### 9.1 Env / ayar

| Değişken                  | Nerede                                                                                                          | Kural                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPDATE_MANIFEST_DIR`     | `env.ts`, compose `server`, `.env.example` (boş)                                                                | İsteğe bağlı; production'da yalnız `/data/downloads/update` (refine, `*_PATH_FIXED` kalıbı). Boş = güncelleme ucu her zaman 204                                                       |
| `UPDATE_MANIFEST_PUBKEYS` | aynı                                                                                                            | Virgüllü, en çok 2 adet base64url 32 bayt (gizli değil). `UPDATE_MANIFEST_DIR` doluysa zorunlu (refine). Ortama göre `build/update-keys/<env>.pub` ile aynı                           |
| GitHub ortamları          | `agent-update-sign` (prod, `v*` etiketi, required reviewer) · `agent-update-sign-stg` (yalnız `main`, dispatch) | Secret `UPDATE_SIGNING_KEY` (her ortamda kendi tohumu). Repo/org secret'ı **değil**; repo değişkenleri `UPDATE_SIGNING_ENABLED` / `UPDATE_SIGNING_ENABLED_STG` (`1` = imza işi koşar) |

Compose: server'a `UPDATE_MANIFEST_DIR: /data/downloads/update` (sabit) ve `UPDATE_MANIFEST_PUBKEYS: ${UPDATE_MANIFEST_PUBKEYS:-}`; `agent_downloads`
zaten server'da salt okunur bağlı. Caddy değişmez (`handle /downloads/*` 404 `update/` alt yolunu da kapsar — `deploy/test-caddy.sh`'e bir 404 satırı).

### 9.2 Yayın sırası (runbook §31; AC-492)

1. Etiket `vX.Y.Z` → mevcut zincir → `update-manifest` (onay) → Release (ikililer + `update-*.json(.sig)`).
2. `UNATTENDED_MODE=signed` ise yeni servis SHA'sı `UNATTENDED_SIGNED_SHA256` listesine eklenir, server yeniden başlatılır.
3. İkililer: `verify-and-publish.sh`, `publish-servis.sh`, `publish-linux.sh`, (`publish-mac.sh`) — sunucu kapıları yeni SHA'ya geçer.
4. `publish-manifest.sh --tag vX.Y.Z` (imza + attestation + SHA256SUMS + manifest SHA = yayımlanmış ikili SHA denetimi) → volume.
   Sıra karışırsa sunucu hash kapısı (K-P29-5) manifesti sunmaz; alarm üretmez.
5. Dağılım şeridinde cihazlar geçince eski SHA listeden çıkarılır; gerekiyorsa `MIN_AGENT_VERSION` yükseltilir (K-P29-19).
   Staging: `workflow_dispatch` (server_url=stg) → `update-manifest-stg` → artifact `agent-update-stg` → `publish-manifest.sh --stg-run <id>`.

### 9.3 Anahtar yaşam döngüsü (runbook §31.2)

- Üretim: çevrimdışı makinede `go run ./cmd/update-sign keygen` (stdlib) → tohum (secret) + açık anahtar (`build/update-keys/<env>.pub`, PR ile).
  Her ortam için **etkin + yedek** çift; yedek tohum çevrimdışı iki kopya (kasa), GitHub'a konmaz.
- Rotasyon (planlı / sızıntı): yedek tohum ortam secret'ına konur; yeni yedek üretilir; `.pub` = {eski yedek, yeni yedek}; bir sürüm yayınlanır
  (eski istemciler eski yedekle doğrular). Sızıntıda ayrıca sunucu tarafı `UPDATE_MANIFEST_PUBKEYS`'ten sızan anahtar hemen çıkarılır (sunucu o
  anahtarla imzalı manifesti sunmaz).
- Kayıp (iki tohum birden): otomatik güncelleme kanalı kapanır; yeni anahtarlı sürüm **elle** dağıtılır (R-P29-5 ile aynı yol).
- Süre: `expiresAt` 90 g. `update-resign` (dispatch, girdi: etiket) aynı ikililer için yeni `issuedAt/expiresAt` ile yeniden imzalar
  (`gh release upload --clobber`). Sunucu `rs_update_manifest_expiry_seconds{component,platform}` gauge'u + < 14 g `warn` log; runbook alarmı.

### 9.4 Log / metrik / alarm

`rs_agent_update_total{platform,component,result}`, `rs_agent_update_rejected_total{reason}`, `rs_agent_update_check_total{platform,component,result}`,
`rs_agent_update_download_total{component,result}`, `rs_unattended_agent_versions{version}` (DB'den, kimlikli; desen dışı → `other`),
`rs_update_manifest_expiry_seconds`. Alarm: `rejected_total` artışı ≥ 1 → inceleme (AC-489); manifest < 14 g; açılışta geçersiz imzalı manifest `warn`.

### 9.5 Migration / rollback

Sıra: migration → server + web (eski istemcilerle uyumlu, AC-493) → Go 0.22.0 elle dağıtım (son elle kurulum, R-P29-5) → 0.22.1 manifestiyle
staging tam tur. Geri alma: server/web önceki imaj (yeni sütunlar okunmaz, zarar yok); `down.sql` gerekirse. Yayımlanmış hatalı istemci → daha
yüksek düzeltme sürümü (V-P29-7). Acil durdurma: `publish-manifest.sh --withdraw <component>` manifest dosyasını volume'dan kaldırır → 204.

### 9.6 CI işleri (`agent-win.yml`, yalnız ekleme)

- **Build ldflags:** etiket ve `main` push → `updateEnv=prod`, `updateKeys=$(build/update-keys/prod.pub)`; dispatch staging → `staging`; PR ve yer tutucu → boş.
  Tekrarlanabilirlik denetimi değişmez (ldflags deterministik).
- **`update-manifest`** (yalnız `v*`; `needs: [approve, attest, attest-mac?, attest-linux]`; `environment: agent-update-sign`; izin `contents: read`,
  `attestations: write`, `id-token: write`): son ikililerin SHA256SUMS'ından (imzalı/notarize edilmiş baytlar) manifest üretir — macOS zip'i
  yalnız `sign-mac` başarılıysa; `cmd/update-sign sign` + `verify` (+ alan eksikse kırmızı); manifestleri attest eder; artifact `agent-update`.
  Atlama: iş düzeyinde `if: vars.UPDATE_SIGNING_ENABLED == '1'` (repo değişkeni; ortam secret'ı `if:` içinde okunamaz — SignPath kalıbı);
  değişken var ama secret boşsa ilk adım `exit 0` ile manifest üretmeden biter. Her iki durumda `release` işi manifestsiz sürer (fail-closed, AC-471).
- **`release`**: `agent-update` varsa `update-*.json` + `.sig` Release'e eklenir ve SHA256SUMS'a girer; Release notuna "Güncelleme manifesti: var/yok".
- **`update-manifest-stg`** (dispatch + `main` + staging adresi; `environment: agent-update-sign-stg`): staging artifact'ı için aynı adımlar.
- **`update-resign`** (dispatch, girdi etiket, `environment: agent-update-sign`): §9.3.
- Log taraması: imza adımı çıktısında 43+ karakterlik base64 dizisi aranır (gitleaks + basit grep), varsa kırmızı (AC-471).

## 10. Test stratejisi

| Seviye                            | Komut                                                                                                                         | Kapsam (AC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go birim (Linux)                  | `docker run --rm -v "$PWD/apps/agent-win":/src -w /src golang:1.26 go test -race ./internal/update/... ./cmd/update-sign/...` | `Verify` negatif fikstürleri 8+ (imza, katı ayrıştırma, env ×4 kombinasyon, süre, 90 g, downgrade, `maxSeen` replay 0.23.0→0.22.5, hash, boyut, 2×size kesme, yönlendirme reddi), kurulum sayacı 0 (474, 475, 472, 477); sahte saatle 24 sa ± 2 sa (478); politika "kapalı olan kazanır" (485); olay kuyruğu ≤ 20 ve tekil `available` (487); `minUpdaterVersion` (K-P29-15); sign↔verify gidiş-dönüş (470)                                                                                                                                                                                                                                                                                                                        |
| Go birim (Linux, `install_linux`) | aynı                                                                                                                          | ELF yer değiştirme: kip korunur, atomik (yarıda kesme fikstürü → eski dosya sağlam), yazılamaz/sahip farklı → `NOT_WRITABLE`, artık dosya yok (482, 483, 484)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Go birim (Windows runner)         | `go test ./internal/servis/... ./internal/update/...`                                                                         | Çalışan exe'yi yeniden adlandırma, `.eski` sonraki açılış silme, paylaşımsız tutamaç, `--update-apply` jeton reddi, `durum.json` faz makinesi (staged→swapped→healthy / rolled_back / güç kesintisi kurtarma), 2 sn `connect` iptali, 24 sa blok (479, 480, 481, 482, 483)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Go birim (macOS runner)           | `go test ./internal/update/...`                                                                                               | Ad-hoc → `MANUAL_ONLY`; translocation → `NOT_WRITABLE`; Team ID uyuşmazlığı → `PLATFORM_SIGNATURE` (476, 483)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Vitest (server)                   | `pnpm --filter @remote/server test`                                                                                           | manifest-store kapıları (imza, env, süre, SHA ≠ kapı → 204, `signed` mod listede yok → 204, açılış uyarısı) (473, 492); `GET /public/agent/update` 60/sa, `ref` politikası, `component=service` 400, no-store; service-file belirteci tek kullanım/süre/SHA; update-events IP 30/sa + kimlik 10/sa → 429, kimliksiz audit yok, çoklu bağlama → çoklu tenant audit, anahtar oracle'ı yok (487, 488, 489); WS `update1` olmayan cihaza mesaj yok (493); `DEVICE_UPDATING` step-up tüketmez (479); `device.auth` sonrası durum temizliği; rozet türetimi 5 durum + `BELOW_MIN` (486, 490); versions IDOR + `scope=all` 403 (490); settings PUT audit + soketlere yayın (485); `MIN_AGENT_VERSION` güncelleme uçlarını kapılamaz (486) |
| Vitest (contracts)                | `pnpm --filter @remote/contracts test`                                                                                        | Manifest şeması, olay refine'ı, `ws-device` birleşimi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Playwright e2e                    | `pnpm --filter @remote/web e2e`                                                                                               | Liste sütunu + rozetler + dağılım süzgeci, iki tema, 390 px, axe 0, 5 durum (490); Ayarlar → İstemciler (485); audit süzgeci ve Türkçe etiket, ham anahtar görünmez (491)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CI                                | `agent-win.yml`                                                                                                               | imza doğrulama, eksik alan kırmızı, anahtarsız atlama + Release'te manifest yok, log taraması (470, 471); `deploy/agent/test-publish-manifest.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Elle (test-operatoru)             | staging                                                                                                                       | **0.22.0 → 0.22.1 tam tur**: servis (kurulum + kasıtlı bozuk sağlık sürümüyle geri dönüş), Windows taşınabilir (yerinde, salt okunur klasör, USB), Linux, macOS (yalnız bildir dalı); iz testi güncelleme senaryosu; AV kapısı (480, 481, 482, 483, 484, 493)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 11. Görev paketleri ve atama (P29-K0g..K12)

| Paket | Ajan                  | İş                                                                                                                                                                                   | Bağımlı                 | Paralel          |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------- |
| K0g   | guvenlik              | Tasarım turu: ADR-0040 + §5 tehdit modeli, S-P29-n                                                                                                                                   | —                       | —                |
| K0s   | backend-dev (Go)      | Windows spike: çalışan exe yeniden adlandırma (servis + tepsi açıkken), job dışı SYSTEM alt sürecin servis durunca yaşaması, SCM kurtarma etkileşimi; sonuç `docs/implementation.md` | K0g ile paralel         | ‖ K0g            |
| K1    | dba                   | Migration `20261128000000_p29_client_update` + down + schema + db-notlari                                                                                                            | K0g                     | ‖ K2, K3         |
| K2    | backend-dev           | contracts: `api/update.ts`, `ws-device` eki, errors, audit + etiketler, unattended/bindings ekleri                                                                                   | K0g                     | ‖ K1, K3         |
| K3    | backend-dev (Go)      | `internal/update` ortak + `cmd/update-sign` + `config` ldflags + `api/update.go` + birim testleri                                                                                    | K0g                     | ‖ K1, K2         |
| K4    | backend-dev           | Sunucu §4 tümü + env + metrik + Vitest                                                                                                                                               | K1, K2                  | ‖ K5, K6, K7, K8 |
| K5    | frontend-dev          | §6 ekranlar + e2e                                                                                                                                                                    | K2 (K4 e2e için)        | ‖ K4, K6–K8      |
| K6    | devops                | CI işleri §9.6, build ldflags, açık anahtar dosyaları (staging çifti üretimi talimatı), publish-manifest + test, compose, `.env.example`, runbook §31                                | K3                      | ‖ K4, K5, K7, K8 |
| K7    | backend-dev (Go)      | Servis §5.3 (`update*.go`, `--update-apply`, WS, olay günlüğü, tepsi, DisplayVersion)                                                                                                | K3, K0s, K2             | ‖ K8             |
| K8    | backend-dev (Go)      | Taşınabilir: Windows K-P29-9, Linux K-P29-11, macOS K-P29-10, bilgi satırı, oturum sonu kancası                                                                                      | K3                      | ‖ K7             |
| K9    | qa-denetci ‖ guvenlik | AC/DoD + kod güvenlik denetimi                                                                                                                                                       | K4–K8                   | ‖                |
| K10   | ilgili geliştiriciler | Düzeltme döngüsü                                                                                                                                                                     | K9                      | —                |
| K11   | test-operatoru        | Staging 0.22.0 → 0.22.1 tam tur (§10 elle), AV kapısı                                                                                                                                | K10 + K6 staging yayını | —                |
| K12   | teknik-yazar          | README, api.md, kılavuz ("Otomatik güncelleme" bölümü, rol bazlı), DATASHEET, CHANGELOG 0.22.0, PDF                                                                                  | K11                     | —                |

Dosya sınırı: K7 yalnız `internal/servis*`, `servisui`, `cmd/noktadestek-servis`; K8 yalnız `internal/update/install_*`, `launch`, `tray`,
`cmd/noktadestek`; ikisi de `internal/update` ortak dosyalarına K3 sonrası yalnız ekleme yapar.

## 12. Kabul kriterleri eşlemesi

| AC  | Bileşen / uç                                                                  | Paket                | Not                                            |
| --- | ----------------------------------------------------------------------------- | -------------------- | ---------------------------------------------- |
| 470 | `cmd/update-sign`, `update-manifest` işi, Release                             | K3, K6               | İkili başına manifest (D-1)                    |
| 471 | GitHub ortamı, atlama kuralı, log taraması                                    | K6                   | —                                              |
| 472 | `config.updateEnv/updateKeys`, `Verify` adım 4                                | K3, K6               | —                                              |
| 473 | `manifest-store.ts`, `GET /public/agent/update`                               | K4                   | Sunucu SHA alanını okur/kapılar (D-2)          |
| 474 | `update.Verify`                                                               | K3                   | —                                              |
| 475 | `Verify` adım 6, `maxSeen`                                                    | K3, K7               | Taşınabilirde bellek (D-4)                     |
| 476 | K-P29-13                                                                      | K7, K8               | Bugün imzasız dal                              |
| 477 | `download.go`, `Guncelleme\` ACL                                              | K3, K7               | —                                              |
| 478 | `check.go` zamanlayıcı                                                        | K3                   | —                                              |
| 479 | K-P29-12, hub `isUpdating`, `connect.ts`                                      | K4, K7, K8           | —                                              |
| 480 | §5.3 gözetmen                                                                 | K7                   | —                                              |
| 481 | §5.3 korunanlar                                                               | K7                   | —                                              |
| 482 | K-P29-9/10/11, bilgi satırı                                                   | K8                   | macOS bugün yalnız bildir (D-6)                |
| 483 | yazılabilirlik denetimi                                                       | K8                   | —                                              |
| 484 | temizlik + iz testi                                                           | K8, K11              | Windows/macOS `.eski` (D-3)                    |
| 485 | `tenant_settings.client_auto_update`, `/settings/clients`, politika kanalları | K1, K4, K5           | —                                              |
| 486 | rozet `BELOW_MIN`, K-P29-19                                                   | K4, K5               | —                                              |
| 487 | olay türleri, kuyruk, metrik                                                  | K3, K4, K7, K8       | `MANUAL_ONLY`, `installing`, `HEALTH` ek (D-5) |
| 488 | `update-events`, WS `update.event`, audit                                     | K4                   | —                                              |
| 489 | güvenlik nedenleri, metrik, olay günlüğü, runbook alarmı                      | K4, K6, K7           | —                                              |
| 490 | liste sütunu, `/unattended/versions`                                          | K4, K5               | Dağılım yalnız gözetimsiz cihaz (A-P29-2)      |
| 491 | audit etiketleri                                                              | K2, K5               | —                                              |
| 492 | manifest-store `signed` kapısı + runbook                                      | K4, K6               | —                                              |
| 493 | `update1` yeteneği, 404 sessizliği, staging tam tur, dokümanlar               | K4, K7, K8, K11, K12 | —                                              |

## 13. Açık kararlar, sapmalar ve riskler

**Gereksinim sapmaları (proje-yöneticisi AC metnini düzeltir ya da kullanıcı onaylar):**

| #   | AC       | Sapma                                                                                                                | Gerekçe                                                                                                                                      |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 470      | "Tek manifest" → ikili başına tek manifest                                                                           | AC-492 yalnız servis manifestini tutmayı gerektirir; bağımsız yayın                                                                          |
| D-2 | 473      | "Sunucu manifest içeriğini doğrulamaz" → sunucu `env/expiresAt/sha256`'yı **okur** ve kapılar (üretmez, değiştirmez) | AC-492 ve sahte alarm önleme (K-P29-5) bunu gerektirir                                                                                       |
| D-3 | 484, 482 | Windows taşınabilir (ve ileride macOS) yer değiştirmede sonraki açılışa kadar gizli `.<ad>.eski` kalır               | Çalışan imaj silinemez; yönetici hakkı/yardımcı süreç olmadan başka yol yok. Program bir daha açılmazsa kalır; kılavuz + iz testi bunu bilir |
| D-4 | 475, 487 | Taşınabilir istemcide `maxSeen` ve olay kuyruğu süreç belleğinde                                                     | İz bırakmama (AC-484); macOS/Linux'ta kalıcı depo yok                                                                                        |
| D-5 | 487      | Ek değerler: `update.state{installing}` (olay değil, yalnız durum), `failed(HEALTH)`, `skipped(MANUAL_ONLY)`         | Rozet "Güncelleniyor", geri dönüş nedeni, macOS/`minUpdaterVersion` dalı                                                                     |
| D-6 | 482      | macOS bugün yerinde güncellenmez (yalnız bildir)                                                                     | TCC (K-P29-10); Developer ID gelince kod değişmeden açılır                                                                                   |
| D-7 | 473      | Servis manifesti `GET` ucundan değil WS `update.offer`'dan; AC-492'deki "uç 204" = `update.none`                     | Belirteç ve politika kimlikli kanalda; servis ikilisi public değil                                                                           |

**Açık kararlar:**

| #       | Konu                                                        | Varsayılan                                                                                                                                                                                                      | Sahibi                       |
| ------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A-P29-1 | Rol tablosundaki Super Admin "Yayın durumu ekranı" (AC yok) | Ayrı ekran yok; dağılım şeridinin "Yayındaki sürüm" satırı + `scope=all` + metrik yeterli. İstenirse `/admin/update-status` Sonra (genişleme noktası: `GET /unattended/versions` yanıtındaki `published` alanı) | kullanıcı / proje-yöneticisi |
| A-P29-2 | Kayıtlı bilgisayar (binding) sürümlerinin dağılıma girmesi  | Girmez; yalnız audit. Gerekirse `device_bindings.client_version` olay işlemede güncellenir (tek UPDATE) — Sonra                                                                                                 | proje-yöneticisi             |
| A-P29-3 | Tenant politikasının Super Admin sistem varsayılanı         | Yok (kimliksiz = Açık, V-P29-3)                                                                                                                                                                                 | —                            |

**Riskler (gereksinim R-P29-1..10'a ek):**

| #        | Risk                                                                                                              | Etki                      | Önlem                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| R-P29-11 | Gözetmen iki `MoveFileEx` arasında güç kesintisi → servis exe'si yok                                              | Orta (olasılık çok düşük) | ms penceresi; runbook: servis kurulumunu yeniden çalıştır (kayıt korunur); `durum.json` kurtarma kuralı |
| R-P29-12 | Sağlık denetimi sunucu kesintisinde yanlış geri dönüş                                                             | Düşük                     | Kurulum yalnız WS bağlıyken başlar; geri dönüş zararsız, 24 sa sonra yeniden denenir                    |
| R-P29-13 | Eski tepsi ↔ yeni servis boru uyumsuzluğu                                                                         | Orta                      | Boru yalnız eklemeyle değişir; tepsi sürüm farkında yeniden başlar (K-P29-21); Windows birim testi      |
| R-P29-15 | Servis 60 sn sağlık penceresinde asılı kalır (çökmez) ve makine yeniden başlatılır → kurtarma kancası tetiklenmez | Orta (olasılık düşük)     | §14.3 önyükleme kurtarma kancası çöken durumu kapsar; asılı durum runbook elle kurtarma                 |
| R-P29-14 | MOTW'süz indirilen yeni exe'nin SmartScreen/AV davranışı farklı                                                   | Orta                      | AV kapısı güncelleme senaryosuyla (K11); WDSI bildirimi                                                 |

## 14. r2 — Güvenlik bulgusu kararları (`docs/guvenlik-raporu.md` "P29 tasarım turu (K0g)", 2026-11-19: DÜZELTİLMELİ — Yüksek 1 / Orta 4 / Düşük 7)

Bu bölüm bağlayıcıdır; §1–§13 ile çelişirse burası geçerlidir. Kod paketleri (K3/K6/K7) bu kararlara göre yazılır.

| Bulgu                                                                    | Önem   | Karar                                                                                                                                             | Mimari yeri                                | Paket                            |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| S-P29-T-1 Tek güven kökü tek hesapta                                     | Yüksek | **Kabul edilen risk (kullanıcı 2026-11-19: "Tek imza, risk kabul").** 2-of-2 imza tasarlanmadı. Tek CI imzası kalır; sertleştirmeler §14.1        | K-P29-1, §14.1, ADR-0040 Sonuçlar, R-P29-1 | devops (K6), teknik-yazar        |
| S-P29-T-2 İmza işi anahtar yüzeyi                                        | Orta   | Düzeltildi: §14.2                                                                                                                                 | §9.3, §9.6                                 | devops (K6), backend-dev Go (K3) |
| S-P29-T-3 Reboot / güç kesintisi, `DELAY_UNTIL_REBOOT`                   | Orta   | Düzeltildi: `PendingFileRenameOperations` **kullanılmaz**; tek önyükleme kurtarma kancası (SCM `FailureActions` → `--update-recover`), §14.3      | §5.3, R-P29-11/15                          | K0s, K7                          |
| S-P29-T-4 Gözetmen tekilliği / SCM yarışı                                | Orta   | Düzeltildi: `Global\NoktaDestekServisUpdate` mutex + `apply.nonce` + servis gözetmeni başlattıktan sonra çıkmaz, §14.3                            | §5.3                                       | K7                               |
| S-P29-T-5 Kimliksiz olayla sahte alarm                                   | Orta   | Düzeltildi: `source` etiketi/alanı, alarm yalnız `device` için ≥ 1, diğerleri oran eşiği; istek kovası, §14.4                                     | §4.5–4.7, §9.4                             | K2, K4, K5, K6                   |
| S-P29-T-6 `Guncelleme\` reparse/sahip, artık `.yeni`                     | Düşük  | Düzeltildi: §14.3 m.6                                                                                                                             | §5.1, §5.3                                 | K7                               |
| S-P29-T-7 Taşınabilirde `maxSeen` bellekte                               | Düşük  | **Kabul** (gerekçe §14.5) + istemci manifesti ≤ 30 g, aylık yeniden imza, açıklı sürüm yeniden imzalanmaz + `MIN_AGENT_VERSION`                   | K-P29-14, §9.3, ADR Sonuçlar               | K3, K6                           |
| S-P29-T-8 Gizli `.eski`, AV, MOTW                                        | Düşük  | Düzeltildi: gizli öznitelik yok, `.eski`/`.yeni` yürütülemez uzantı, MOTW kopyalanır, AV kapısı Defender + 1 EDR                                  | K-P29-9, D-3                               | K8, K11, K12                     |
| S-P29-T-9 `?ref=` "ayrım sızdırmaz"                                      | Düşük  | **Kabul** (metin düzeltildi: pratikte oracle değil); desen dışı ref → sessizce `auto`; `maskUrl` testi                                            | K-P29-7, §4.2                              | K4                               |
| S-P29-T-10 Belirteç sorguda, hash kapısı, eşzamanlılık                   | Düşük  | Düzeltildi: `Authorization: Bearer`, önbellekli kapı, global 8 akış + `Retry-After`, `size+1` kesme                                               | §4.4                                       | K4, K7                           |
| S-P29-T-11 Katı JSON tanımı                                              | Düşük  | Düzeltildi: kanonik JSON, §14.6                                                                                                                   | K-P29-3, §5.1                              | K2, K3, K4                       |
| S-P29-T-12 Attestation kimliği, hata yansıtma, Linux geçici dosya, donma | Düşük  | Düzeltildi (donma = kabul edilen kalan risk), §14.7                                                                                               | §4.5, §9.2, K-P29-11                       | K4, K6, K8                       |
| Diğer: saat kayması                                                      | —      | `issuedAt > now+24 sa` → "yayın yok"; `EXPIRED` güvenlik nedeni **değil** (`UPDATE_SECURITY_REASONS`'ta yok); `available`/`failed` sürüm başına 1 | §5.1                                       | K3                               |
| Diğer: sürüm ≤ çalışan (orkestratör kararı 2026-11-19, K3)               | —      | §5.1 adım 6 daraltıldı: `version ≤ çalışan` → sessiz "yayın yok" (olay/alarm yok); yalnız `çalışan < version < maxSeen` → `DOWNGRADE`             | §5.1                                       | K3                               |
| Diğer: TLS kök sabitleme                                                 | —      | Yok (sistem kökleri); bütünlük imzaya dayanır                                                                                                     | §5.1                                       | —                                |
| Diğer: metrik kardinalitesi                                              | —      | `rs_unattended_agent_versions{version}` en çok 50 değer, fazlası `other`                                                                          | §9.4                                       | K4                               |
| Diğer: AC-490 IDOR ifadesi                                               | —      | Gereksinim metni düzeltildi: dağılımda başka tenant cihazı **sayılmaz**; cihaz detayı 404 (mevcut)                                                | `gereksinimler-p29.md` AC-490              | proje-yöneticisi (yapıldı)       |

### 14.1 T-1 — kabul edilen risk ve kalan sertleştirmeler (kullanıcı kararı 2026-11-19)

Risk: platform imzası yokken manifest anahtarı, tüm gözetimsiz servislerde SYSTEM kod çalıştırma yetkisidir. Etiket itme, ortam onayı, yayın ve
sunucu erişimi aynı hesapta toplandığından "anahtar + sunucu" pratikte tek varlıktır. Kullanıcı bunu **yazılı kabul etti**. Kayıt yerleri:
ADR-0040 Sonuçlar, `gereksinimler-p29.md` R-P29-1, `docs/guvenlik-raporu.md` T-1 satırı.

Kalan (zorunlu) sertleştirmeler:

1. Özel anahtar yalnız `agent-update-sign` **ortam secret'ı**; ortam required reviewer, "deployment branches and tags: yalnız `v*`", "Allow
   administrators to bypass" **kapalı**. Varsa "Prevent self-review" açılır; tek kişilik ekipte açılamıyorsa bu durum risk kabulüne dahildir.
2. Etiket ruleset'i (`v*` yalnız depo yöneticisi, silme/yeniden yazma yasak).
3. Yedek anahtar çevrimdışı, rotasyon prosedürü (§9.3); sızıntıda sunucu `UPDATE_MANIFEST_PUBKEYS`'ten hemen çıkarır.
4. Attestation: Release ikilileri ve manifestler attest edilir; `publish-manifest.sh` kimliği sabitleyerek doğrular (§14.7).
5. Alarm: `rs_agent_update_rejected_total{source="device"}` ≥ 1 → inceleme; manifest süresi < 14 g.
6. **Staging-önce kuralı** (runbook §31): prod manifesti, aynı sürüm staging'de ve kendi test cihazımızda 24 sa sorunsuz çalıştıktan sonra
   `publish-manifest.sh` ile yayımlanır. Gecikme, kötü niyetli bir yayını fark etmek için zaman tanır.
7. Önerilir (zorunlu değil, runbook): GitHub hesabında donanım anahtarıyla 2FA, sunucu root SSH anahtarının parola/donanımla korunması.

Genişleme noktası (kullanıcı ileride isterse): 2-of-2 imza. Manifest biçimi değişmez; ek `.sig2` dosyası, rol önekli bağlam
(`rs-update-manifest-v1/offline\n`), istemcide ikinci anahtar kümesi (`config.updateOfflineKeys`) ve `minUpdaterVersion` yükseltilerek eski
güncelleyicilerin tek imzayla kurmaya devam etmesi engellenir. Platform imzası (SignPath/Apple) gelirse AC-476 ikinci kapı olur.

### 14.2 T-2 — imza işi anahtar yüzeyi (devops, backend-dev Go)

- Tohum **yalnız tek adımda ve stdin ile** verilir (`update-sign sign --key-stdin`). `env:` adım düzeyindedir (iş düzeyinde değil); imzalayıcı
  tohumu kullandıktan sonra bellekten siler.
- İmzalayıcı, imza işinden **önceki anahtarsız işte** `GOFLAGS=-mod=readonly GOPROXY=off` ile derlenir. `go list -deps ./cmd/update-sign`
  çıktısında yalnız stdlib ve kendi paketlerimiz bulunmalıdır, aksi kırmızı. İkili artifact olarak imza işine geçer.
- İmza işi: `actions/checkout` yalnız `build/update-keys/` (sparse) ve `persist-credentials: false`; `actions/cache` ve `setup-go` önbelleği
  **yok**; başka betik çalışmaz; izinler `contents: read` (+ attestation için `attestations: write`, `id-token: write`).
- `update-resign` iki iştir. (i) Anahtarlı iş (`contents: read`) artifact üretir. (ii) Anahtarsız iş (`contents: write`) Release'e yükler.
  Etiket girdisi `run:` içine `${{ }}` ile değil `env:` ile geçer ve `^v[0-9]+\.[0-9]+\.[0-9]+$` ile doğrulanır. Yeniden imzalanan manifestin
  `version/sha256/size/platform/arch/component/env/minUpdaterVersion` alanları önceki Release manifestiyle birebir aynı olmalıdır; yalnız
  `issuedAt/expiresAt` değişir, aksi kırmızı.
- Log taraması regex ile değil **bilinen değerle**: imza adımı stdout/stderr'i dosyaya `tee` eder, adım sonunda tohumun base64, base64url ve
  hex biçimlerini o dosyada `grep -F` ile arar (değer yalnız bellekte); eşleşme → kırmızı. İmza ve SHA'lar yanlış pozitif vermez.
- Tüm yeni `uses:` 40 haneli SHA ile sabitlenir (G-18).

### 14.3 T-3, T-4, T-6 — servis gözetmeni (K0s doğrular, K7 uygular)

1. **Tekillik (T-4):** gözetmen `Global\NoktaDestekServisUpdate` mutex'ini (DACL yalnız SY) alamazsa çıkar. Servis her denemede yeni `nonce`
   üretir, `durum.json` ve `Guncelleme\apply.nonce` dosyalarına yazar. Gözetmen yalnız `phase=staged` ve iki nonce eşitse ilerler.
   Mutex sahipliyken veya `phase ∈ {staged, swapping, swapped}` iken servis ikinci gözetmen başlatmaz.
2. Servis gözetmeni başlattıktan sonra **çıkmaz** ve çökmez; `SERVICE_STOPPED`'a yalnız gözetmenin `Control(Stop)`'u ile geçer. Böylece SCM
   kurtarma eylemi tetiklenmez. (§5.3 adım 6 "servis kendi işini bitirir" ifadesinin yerine geçer.)
3. **Önyükleme kurtarma kancası (T-3):** gözetmen yer değiştirmeden önce servisin SCM `FailureActions` değerini `durum.json`'a yedekler.
   İlk eylemi `SC_ACTION_RUN_COMMAND` yapar; komut `"<kurulu yol>\NoktaDestekServis.exe.eski" --update-recover`. `phase=done` veya
   `rolled_back` sonrası eski eylemleri geri yükler. Yeni ikili açılışta çökerse (yeniden başlatma sonrası dahil) SCM eski ikiliyi çalıştırır.
   - `--update-recover`: argümansız/yolsuz, yalnız LocalSystem jetonuyla, aynı mutex'le ve yalnız `phase ∈ {swapping, swapped}` iken çalışır.
     Geri dönüşü yapar (12b ile aynı), `rolled_back(HEALTH)` olarak işaretler.
   - `MoveFileEx(..., MOVEFILE_DELAY_UNTIL_REBOOT)` / `PendingFileRenameOperations` geri dönüş için **kullanılmaz**. Geri alınamayan bir kayıt
     haftalar sonra sessiz düşürme yaratabilir. Yalnız artık silme için kabul edilir.
   - K0s şunları doğrular: RUN_COMMAND'ın hangi hesapla çalıştığı; `exe` yokken (R-P29-11) SCM başlatma hatasını "failure" sayıp saymadığı.
     Saymıyorsa yedek çözüm, yalnız yer değiştirme süresince var olan bir `ONSTART` SYSTEM zamanlanmış görevidir (aynı komut, `done`'da
     silinir). Kalıcılık IOC'si sayıldığı için bu yalnız spike olumsuzsa kullanılır.
4. **Yer değiştirme:** `durum.json` `phase=swapping` yer değiştirmeden **önce** fsync'li yazılır. K0s önce tek adımı dener:
   `SetFileInformationByHandle(FileRenameInfoEx, REPLACE_IF_EXISTS | POSIX_SEMANTICS)` ile `exe.yeni → exe`. Tepsi imajı eşlenmişken bu
   başarısız olursa iki adımlı akış kalır; her iki `MoveFileEx` çağrısı `MOVEFILE_WRITE_THROUGH` ile yapılır. Tek adım başarılıysa R-P29-11
   penceresi kalkar.
5. Kalan risk R-P29-15 daralır: yeni servis çökmeden asılı kalır **ve** makine yeniden başlatılır. Runbook'a kurtarma komutu eklenir
   (`sc.exe failure` geri yükleme + `--install`).
6. **Klasör ve artıklar (T-6):** `VerifyDir` = `FILE_FLAG_OPEN_REPARSE_POINT` ile aç; `FILE_ATTRIBUTE_REPARSE_POINT` → ret. Sahip SY/BA,
   DACL korumalı ve yalnız SY/BA ACE olmalı; değilse klasör silinir, yeniden oluşturulur ve olay 1012 yazılır. `yeni.bin` ve `exe.yeni`
   açılmadan önce varsa silinir. `durum.json` ≤ 8 KiB katı şemadır; bilinmeyen alan varsa `phase` yok sayılır. Kalan sınır yerel yöneticidir
   (**kabul**).

### 14.4 T-5 — olay kaynağı ve alarm

- `source` sunucuda kimlik kanalından belirlenir, istemci beyan etmez: `device` = WS cihaz anahtarı, `binding` = en az bir geçerli kayıt anahtarı,
  `anonymous` = diğerleri. Metrik etiketi ve audit `new_value.source` olarak yazılır.
- Alarm (runbook §31): `rejected_total{source="device"}` ≥ 1 → inceleme. `binding`/`anonymous` için eşik: 1 sa içinde ≥ 3 farklı IP/kimlik.
  Not: "istemci beyanı, doğrulanmamış".
- Panel (AC-491): `binding` kaynaklı `failed` satırının etiketi "İstemci bildirdi: Güncelleme reddedildi (…)"; `device` kaynaklıda §4.7 etiketi.
- Hız: IP (IPv6 /64) 10 istek/sa + 30 olay/sa; istek başına en çok 5 anahtar çözümü (§4.5).

### 14.5 T-7 ve T-9 — kabul gerekçeleri

- **T-7 kabul:** taşınabilir istemcide `maxSeen` bellektedir (iz bırakmama; macOS/Linux'ta depo yok). Saldırının ön koşulu sunucunun
  ele geçirilmesidir. Sonuç, bizim imzaladığımız gerçek ama eski bir sürümle sınırlıdır.
  Sınırlayıcılar:
  - İstemci manifesti en çok 30 gün geçerlidir ve `update-resign` ile ayda bir yenilenir; servis 90 gün kalır (servis `maxSeen`'i kalıcıdır).
  - Güvenlik düzeltmesinde açıklı sürümün manifesti bir daha yeniden imzalanmaz ve `MIN_AGENT_VERSION` düzeltme sürümüne yükseltilir;
    ara sürüme çekilen istemci bağlanamaz ve güncellemeye devam eder.
    Kayıtlı Windows bilgisayarda `maxSeen`'i kayıt dosyasına eklemek Sonra'ya bırakıldı.
- **T-9 kabul:** yalnız politikası kapalı tenant'ın geçerli ref'i `notify` döner. 80 bit + 60/sa ile kaba kuvvet imkânsızdır ve ref zaten
  dosya adında açıktır. Desen dışı ref 400 değil `auto` döner. Caddy sorgu dizesini siler; `maskUrl` testi eklenir.

### 14.6 T-11 — kanonik manifest biçimi (K2 TS + K3 Go, ortak fikstür)

- Bayt: UTF-8, yalnız ASCII (0x20–0x7E), BOM yok, boşluk/yeni satır yok, sonda veri yok.
- Nesne: alanlar **sabit sırada** `schema, env, platform, arch, component, version, sha256, size, issuedAt, expiresAt, minUpdaterVersion`.
  Hepsi zorunludur; yinelenen veya fazladan anahtar → ret; anahtar adları büyük/küçük harfe duyarlı ve birebir.
- Değerler: `schema` ve `size` ondalık tamsayıdır (baştaki sıfır, işaret, üs yok); diğerleri kaçış karakteri içermeyen dizgidir; zamanlar
  `YYYY-MM-DDTHH:MM:SSZ` biçimindedir.
- Doğrulama: ayrıştır → kanonik serileştir → ham baytla **birebir eşit** olmalı; aksi `MANIFEST_SIGNATURE`. Go tarafında `json.Decoder` +
  `Token()` ile sıra ve yineleme denetimi yapılır. Sunucu (zod) aynı kuralı uygular.
- Fikstür: `packages/contracts/test/fixtures/update-manifest/*.json` (geçerli + yinelenen anahtar, `Sha256` harf farkı, BOM, sonda veri, boşluk,
  sıra farkı). İki dil aynı fikstürü kullanır.
- İmzalayıcı yalnız kanonik biçim yazar.

### 14.7 T-8, T-10, T-12 — kalan düzeltmeler

- T-8: K-P29-9 r2 satırı. `.eski` görünür ve yürütülemez uzantılıdır; kılavuz ve iz testi (AC-484 sapması D-3) bunu bilir. MOTW (`Zone.Identifier`
  ADS) varsa yeni dosyaya kopyalanır. AV kapısı (K11) Defender ve en az bir EDR ile "güncelleme senaryosunu" kapsar.
- T-10: §4.4 r2.
- T-12:
  - `publish-manifest.sh` attestation'ı `gh attestation verify <dosya> --repo <repo> --signer-workflow <repo>/.github/workflows/agent-win.yml
--source-ref refs/tags/vX.Y.Z --cert-oidc-issuer https://token.actions.githubusercontent.com` ile doğrular.
  - `update-events` 400 yanıtı değer yansıtmaz (§4.5).
  - Linux geçici dosyası `.<ad>.yeni-<rastgele 8 hex>`, `O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC`, kip `0600`. Klasör herkese yazılabilir ve
    sticky değilse `NOT_WRITABLE`.
  - **Donma saldırısı** (ele geçirilmiş sunucu hiç manifest sunmaz) kabul edilen kalan risktir; tespit `rs_update_manifest_expiry_seconds` ve
    dağılım şeridiyle yapılır (ADR-0040 Sonuçlar).

### 14.8 K2 / K4 şema ve sözleşme değişiklikleri (r2 özeti)

| Yer                                     | r1                                        | r2                                                                                                                |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `api/update.ts` manifest                | `strictObject`                            | + **kanonik bayt kuralı** (`isCanonicalManifest(bytes)`) ve ortak fikstür; tek imza (`signature`) — değişmedi     |
| `api/update.ts` olay                    | —                                         | Olay şeması değişmez; sunucu tarafında `source` enum'u (`device\|binding\|anonymous`) eklenir (istemciden gelmez) |
| `GET /public/agent/update`              | `?ref=` desen dışı → 400                  | desen dışı `ref` → `auto` (400 yalnız platform/arch/component için)                                               |
| `GET /public/agent/update/service-file` | `?t=`                                     | `Authorization: Bearer <token>`; sorgu reddedilir; global 8 akış → 503 + `Retry-After`                            |
| `POST /public/agent/update-events`      | IP 30 olay/sa                             | + IP 10 istek/sa, istek başına ≤ 5 anahtar çözümü; 400 değer yansıtmaz                                            |
| Audit `client.update.*` `new_value`     | —                                         | + `source`                                                                                                        |
| Metrikler                               | `{platform,component,result}`, `{reason}` | + `source` etiketi; `rs_unattended_agent_versions` ≤ 50 değer                                                     |
| `ws-device.ts`                          | —                                         | Değişiklik yok                                                                                                    |
| Manifest süresi                         | ≤ 90 g                                    | istemci ≤ 30 g, servis ≤ 90 g (doğrulayıcı `component`'e göre)                                                    |
