# Gereksinimler — P13b Prod açılışı

Tarih: 2026-11-14 (r2 2026-11-15: AC-303 WhatsApp servis anahtarı, güvenlik S-P13b-3) Durum: ONAYLANDI (kullanıcı kararları K1, K3 — 2026-11-14; S-P13b-3 — 2026-11-15). Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (ayrılmaz parçasıdır).
Tasarım: `/Users/mennan/Projeler/Remote/docs/mimari-p13.md` §7 (bağlayıcı), ADR-0018 (TURN 5349, 443 risk kabulü), ADR-0019 (staging'in yerinde prod'a terfisi), ADR-0020 (yedek imzası ve site dışı kanca).

## 1. Amaç

Staging yığınını `https://remote.noktabilisim.net` adresinde prod'a terfi ettirmek; yedek bütünlüğünü, Super Admin kurtarmasını ve prod izlemeyi tamamlamak; imzalı açılış kontrol listesiyle gerçek müşteriye açılmak.

## 2. Kararlar (kapanış kayıtları)

| #        | Soru / karar                        | Kapanış (kullanıcı)                                                                                                                                                                                                                                                               | Kaynak                                                                                        |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| S2 / K1  | Yayın alan adı ve TLS sertifikası   | **Kapandı (2026-11-14):** `remote.noktabilisim.net`, Let's Encrypt (host nginx vhost → caddy 127.0.0.1). Staging yığını `/opt/remote` içinde **yerinde prod'a terfi eder**: temiz kurulum, yeni volume'lar ve yeni sırlar, `DEPLOY_ENV=production`; IP:4450 imzadan sonra kapanır | ADR-0019, mimari-p13 §7.2                                                                     |
| S3 / K3  | TURN-TLS 443 ayrı IP/VM             | **Kapandı (2026-11-14):** aynı sunucu (185.126.217.99); TURN-TLS **5349/TCP**, 443 yok; relay aralığı 49160–49479/udp; genel CA (LE) sertifikası                                                                                                                                  | ADR-0018, mimari-p13 §7.4                                                                     |
| K-P13b-4 | Site dışı yedek hedefi              | **Açık:** hedef belli değil. P13b'de hedeften bağımsız kanca kurulur (AC-300); hedef seçimi ve WORM Sonra                                                                                                                                                                         | ADR-0020 m.4                                                                                  |
| S-P13b-3 | WhatsApp bildirim servisi kimliksiz | **Karar (2026-11-15):** servis artık `X-API-Key` başlığını zorunlu tutar; Remote anahtarı gönderir. P13b kapsamına alındı (AC-303)                                                                                                                                                | güvenlik raporu S-P13b-3, `docs/implementation.md` (WhatsApp API anahtarı — backend/frontend) |

## 3. Kapsam

### Kapsamda

- Yerinde terfi, sır yenileme, IP:4450'nin kapanması (§7.2, §7.12).
- TURN prod: 5349, genişletilmiş relay aralığı, LE sertifikası ve yenileme kancası, `test-denied.sh` yeni aralık (AC-21, 22, 23 revize).
- HSTS `includeSubDomains` (AC-126 revize).
- Yedek imzası, migrator ile yükleme, CHECKSUM, prod hedef kilidi (AC-298); audit süreklilik denetimi (AC-301); site dışı kanca (AC-300).
- `reset-superadmin` CLI (AC-299).
- Prod izleme `remote-watch` (AC-302).
- WhatsApp servis anahtarı (`X-API-Key`): Super Admin ayarı + `WHATSAPP_SERVICE_API_KEY` env (AC-303).
- S-P13a-8: `file.transfer*` audit kayıtlarında dosya adı ve sha256 yerine yalnız uzantı ve boyut (§7.11).
- Anonim MySQL hesabı kontrolü (`check-app-grants.sh`, §7.11).
- AC-88 ve AC-91/AC-200 prod tekrarı; Windows istemci prod Release'i (repo public, attestation); imzalı prod açılış kontrol listesi (§7.13; P10 elle testleri ve Windows 0.10.2 elle testleri dahil).

### Kapsam DIŞI (açıkça)

1. Ayrı staging ortamı → **P13c** (aşağıdaki "Ortamlar" notu).
2. TURN 443 → risk kabulü (R4); ek IP gelirse ADR-0018 m.6 ile yeniden açılır.
3. Site dışı hedefin seçimi/kurulumu ve WORM audit kopyası (I-P11-1'in tamamlanması) → hedef belli olunca.
4. Prometheus/Alertmanager → Sonra (genişleme noktası `status.prom`).
5. ICE başarısızlığında "kurumsal güvenlik duvarı" tanı mesajı → Sonra (E11 G2'ye önerilir).
6. Prod IPv6 → VM'de global IPv6 yok; açılışta yokluğu kayda geçer, eklenirse runbook §9.2.2 adımları önce yapılır.
7. whatsapp-bildirim servisinin kendisindeki anahtar üretimi/rotasyonu ve diğer tüketicilerin (başka projeler) uyarlanması → o servisin ve projelerin işi; Remote yalnız anahtarı saklar ve gönderir.

## 4. Kabul kriterleri

### Revize edilen AC'ler (yeni metin)

- **AC-23 (revize):** UDP'nin kapalı olduğu ve yalnız 443/TCP ile 5349/TCP çıkışına izin verilen ağda bağlantı TURN-TLS (5349) ile kurulur; müşteri makinesine kök sertifika kurulmaz (prod ölçümü). Yalnız 443/TCP açık ağlar desteklenmez (ADR-0018 risk kabulü).
- **AC-91 (revize):** MySQL günlük yedeklenir, 14 gün saklanır; runbook'taki geri yükleme prosedürü prod'da (P13b; sonraki aylarda aylık prova) başarıyla uygulanmış olur.
- **AC-126 (revize):** mevcut metne eklenir: "`Strict-Transport-Security: max-age=31536000; includeSubDomains` başlığı bulunur."
- **AC-200 (revize):** mevcut metinde "Staging'deki provanın süresi" ifadesi "Prod provasının süresi" olur; geri kalanı değişmez. İmza ve kanca maddeleri AC-298 ve AC-300'dedir.

### Yeni AC'ler

- **AC-298:** (yedek bütünlüğü, ADR-0020 m.1–3) Her yedek manifesti imzalanır; `restore.sh` imzası olmayan ya da geçersiz yedeği çözmeden reddeder. Döküm migrator ile ve istemci komutları kapalıyken (`--system-command=OFF`) yüklenir; `CREATE USER`/global `GRANT` içeren döküm yüklenemez. Uygulama tablolarının `CHECKSUM TABLE` değerleri scratch ve canlıda eşittir. `--target production` ortam etiketi, `--confirm` ve TTY onayı olmadan çalışmaz; başka ortamın yedeği prod'a yüklenemez. (Test: imzasız / bozuk imza / değiştirilmiş manifest → FAIL, çözme yok; kurcalanmış döküm → yükleme FAIL ve kalıcı iz yok; yanlış ortam → ret.)
- **AC-299:** (`reset-superadmin` CLI, §7.7) Yalnız SUPER_ADMIN hesabı için çalışır; geçici parola yalnız TTY'ye bir kez yazılır; ilk girişte değişim zorunludur; hedefin açık oturumları iptal edilir; `--reset-mfa` isteğe bağlıdır; audit `auth.superadmin_reset` yazılır (parola içermez); TTY yoksa çıkış kodu 4'tür; parola loga düşmez (AC-90).
- **AC-300:** (site dışı kanca, §7.6/4–5) Kanca tanımlıysa yalnız tamamlanmış ve imzalı çalıştırma dizinini alır; kanca hatası yerel yedeği geçersiz kılmaz ama alarm komutunu çağırır (`OFFSITE-FAILED`); kanca tanımsızsa her çalıştırmada uyarı satırı yazılır ve durum dosyasında `offsite_configured 0` görünür; kanca komut metni loglanmaz.
- **AC-301:** (audit süreklilik, §7.6/3) Tamamlanmış geçmiş günlerin audit kayıt sayısı değişirse ya da en büyük audit id azalırsa yedek `FAILED adım=audit-sureklilik` ile biter ve alarm çalışır (test: TRUNCATE ve tek satır DELETE).
- **AC-302:** (prod izleme, §7.8) `remote-watch` kontrollerinden biri bozulunca ≤ 10 dk içinde alarm komutu çağrılır; aynı alarm en çok 6 saatte bir tekrarlanır; düzelince bir kez "düzeldi" bildirimi gider (test: `docker compose stop web` → ALERT → `start` → düzeldi).
- **AC-303:** (WhatsApp servis anahtarı, güvenlik S-P13b-3, 2026-11-15) Remote, whatsapp-bildirim servisine yaptığı her çağrıda (bildirim ve test) `X-API-Key` başlığını gönderir. Aşağıdakilerin her biri testle kanıtlanır:
  1. **Ayar alanı:** Super Admin › Sistem ayarları › WhatsApp servisi ekranında "Servis anahtarı" alanı vardır. Alan maskelidir (göster/gizle), kayıtlı anahtar forma geri yazılmaz; alan boş bırakılırsa mevcut anahtar korunur. Kaynak rozeti "Kayıtlı (panel)" / "Kayıtlı (env)" / "Tanımlı değil" gösterir. Uzunluk/biçim dışı değer alan hatası verir (`fields.apiKey`).
  2. **Saklama ve gizlilik:** Anahtar DB'de şifreli saklanır. Hiçbir API yanıtında (GET dahil) anahtar ya da parçası dönmez, yalnız "var/yok" ve kaynak bilgisi döner. Uygulama ve proxy loglarında anahtar görünmez. Audit kaydına `***` olarak yazılır.
  3. **Adresle eşleşme:** Anahtar adresle birlikte izlenir. Etkin adres panelde kayıtlı adresse panel anahtarı, env adresiyse (`WHATSAPP_SERVICE_URL`) `WHATSAPP_SERVICE_API_KEY` gönderilir. Bir kaynağın anahtarı öteki kaynağın adresine gönderilmez.
  4. **Köken değişimi:** Kayıtlı adresin kökeni (şema + host + port) değişirken yeni anahtar girilmezse kayıt 400 `VALIDATION` ile reddedilir (`fields.apiKey = WA_API_KEY_REENTER`) ve hata alanda gösterilir. Aynı köken içinde (yalnız yol değişikliği) anahtar korunur.
  5. **401 davranışı:** Servis 401 dönerse Super Admin ve tenant test yanıtlarında "Servis anahtarı reddetti." mesajı gösterilir. Bildirim gönderiminde yeniden deneme yapılmaz; başarısızlık audit'e `reason: "unauthorized"` ile yazılır.
  6. **Değiştirme ve silme:** "Anahtarı kaldır" yalnız panel anahtarını siler ve onay diyaloğu ister. Anahtar ekleme, değiştirme ve silme işlemleri audit'e eski → yeni (`***` / yok) olarak yazılır. Bu uçlarda B-P12b-5 hız sınırı (10/dk) ve AC-215 kuralları değişmeden uygulanır.
  7. **Ortam değişkeni:** `WHATSAPP_SERVICE_API_KEY`, `.env.example`'da boş, `env.ts`'te aynı şemayla doğrulanmış ve `deploy/docker-compose.yml` server servisinde tanımlıdır. Runbook env tablosunda yer alır. Değeri yalnız root 600 `deploy/.env`'dedir.

AC eşlemesi ve görev paketleri: mimari-p13 §7.14, §7.16. AC-303'ün uygulama ve test kaydı: `docs/implementation.md` (WhatsApp API anahtarı — backend/frontend).

## 5. Riskler

| #           | Risk                                                                                                                                   | Etki                              | Azaltma                                                                                                                                                                                                                                                                                                       | Sahibi                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R4 (güncel) | Kurumsal ağlarda yalnız 443 açık olabilir; 443 sunucuda dolu, TURN 5349'da                                                             | Yüksek: o ağlarda medya kurulamaz | **Risk kabulü (ADR-0018).** Kullanım kılavuzu ve DATASHEET'te **ağ gereksinimleri** dokümanı (443/TCP, 3478 UDP/TCP, 5349/TCP, 49160–49479/UDP allowlist); 5349 bağlantı başarısızlıkları **3 ayda bir** gözden geçirilir; **ayda ≥ 3 vaka** görülürse ek IP talebi ve TURN 443 (ADR-0018 m.6) yeniden açılır | kullanıcı + devops      |
| R34         | Yerinde terfi sırasında geri dönüş gerekirse kesinti                                                                                   | Orta                              | §7.12 geri dönüş adımları (yalnız imzadan önce), son staging yedeği 14 gün tutulur                                                                                                                                                                                                                            | devops                  |
| R35         | Site dışı kopya yokken sunucu kaybı                                                                                                    | Yüksek (veri kaybı)               | Kanca + `offsite_configured 0` uyarısı her çalıştırmada (AC-300); `remote-watch` hatırlatması; hedef seçimi kullanıcıda (K-P13b-4)                                                                                                                                                                            | kullanıcı               |
| R36         | P13c'ye kadar ayrı staging yok; prod'da test yapılır                                                                                   | Orta                              | Prod kontrolleri yalnız "Nokta Test" firmasıyla yapılır ve firma açılıştan sonra pasife alınır; yeni kod yerelde (`scripts/e2e-real.sh`) denenir                                                                                                                                                              | devops + test-operatoru |
| R38         | WhatsApp servis anahtarı düz HTTP adreste gönderilirse yolda okunabilir; servis tarafında anahtar değişirse bildirimler sessizce durur | Orta                              | Düz HTTP'de kanal K13 gereği kapalıdır (fail-closed); TLS ters vekil önerisi (§6 K13); 401'de net mesaj ve audit `unauthorized` (AC-303/5); "Test Mesajı Gönder" ile doğrulama                                                                                                                                | devops + kullanıcı      |

## 6. Notlar

- **Ortamlar:** P13c'ye kadar ayrı staging yoktur. Paket akışındaki staging adımı yerel ortamda (`scripts/e2e-real.sh`, ayrı compose projesi) yapılır; prod kontrolleri "Nokta Test" firmasıyla yapılır. **P13c** (`remote-stg`, `stg.remote.noktabilisim.net`, ayrı DB/sır/yedek) prod açılışından hemen sonra ve **E11 kod paketlerinden önce** kurulur; E11 özellikleri P13c'den önce prod'a çıkmaz (ADR-0019 m.5, K-P13b-5).
- **K13 (WhatsApp):** prod açılışı WhatsApp'a bağlı değildir. Prod'da kanal **kapalı başlayabilir** (ayar ekranında uyarı, log'da `whatsapp_insecure`, karar kaydı; Admin'ler e-posta bildirimini kullanır). whatsapp-bildirim servisini başka projeler de kullandığından IP kısıtı yerine **TLS ters vekil** önerilir; kurulunca kanal açılır (K-P13b-2). Servis anahtarı (AC-303) TLS'in yerini tutmaz; ikisi birlikte uygulanır.
- **Açık kararlar** (mimari-p13 §7.17): K-P13b-1 Release sürümü (vars. `v1.0.0`), K-P13b-2 K13 yolu (vars. kapalı açılış), K-P13b-3 `ABUSE_EMAIL`, K-P13b-4 site dışı hedef, K-P13b-5 P13c zamanı. Sahibi kullanıcı.
- Toplam: AC-298..AC-303 ile proje **303 kabul kriteri**ne çıkar.
