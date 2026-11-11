# Test Raporu — Remote Support
DURUM: GEÇTİ (P5 sayfa testi tur 2, 2026-11-11 — TEST-P5-1/2/3 kapandı; 1 DÜŞÜK yeni bulgu TEST-P5-4, engellemez; ayrıntı en altta)

## P3 staging altyapı kanıtı (2026-11-11, devops)
Kapsam: staging TURN (coturn) altyapısı, runbook §9.1–9.2.3. Uygulama (server/web) bu adımda güncellenmedi (P4 ile).
IP adresleri ve sırlar bu bölüme yazılmaz (`<public>` = staging genel IPv4, `<vm>` = VM özel IPv4, `<docker-gw>` = Docker köprü ağ geçitleri).

### 1. Kurulum (S-P3-T2-1 / S-P3-T2-2)
| Adım | Sonuç |
|---|---|
| `deploy/turn/.env` (600 root), `TURN_SECRET` 64 hex, `deploy/.env` ile aynı (sha256 karşılaştırması) | OK |
| `gen-cert.sh <public>` → IP SAN'lı sertifika, 365 gün; `turn.key` 65534 0400, `ca.key` root 0600 | OK |
| UFW: 3478/udp, 3478/tcp, 5349/tcp, 49160:49199/udp eklendi; mevcut 22/80/443 değişmedi | OK |
| `sudo ./host-firewall.sh install` → "uygulandı … IPv6 zinciri: var", kurulu kopya + systemd birimleri, rc=0 | OK |
| OUTPUT zinciri: ilk kural `-j REMOTE-TURN-OUT`, sonra ufw zincirleri; `ip_local_reserved_ports=49160-49199` | OK |
| `docker compose up -d` → `remote-turn-coturn-1` **healthy**; log: sertifika ve anahtar bulundu, `no-tls`/ERROR/deprecated yok | OK |

### 2. Runbook §9.2.3 kontrol listesi
| Kontrol | Çıktı (özet) | Sonuç |
|---|---|---|
| `ss -tlnp \| grep :5766` | boş | PASS (CLI kapalı) |
| `ss -tlnp \| grep :9641` | yalnız `127.0.0.1:9641` | PASS |
| `ss -tlnp` 3478/5349 | `127.0.0.1`, `[::1]`, `<vm>`, `<docker-gw>` (×8 thread) | bilgi — bkz. Bulgu 2 |
| `ss -ulnp` 3478 | `127.0.0.1`, `[::1]`, `<vm>`, `<docker-gw>`; relay portları yalnız allocation varken | bilgi |
| `sudo ./host-firewall.sh check` | `host-firewall: OK` | PASS |
| `TURN_CONFIG_CHECK=1` | `external-ip=<public>/<vm>`, `relay-ip=<vm>`, `allowed-peer-ip=<public>`, `cert`/`pkey` yolları | PASS |
| `systemctl is-active remote-turn-fw.timer` | `active` | PASS |
| `systemctl cat remote-turn-fw.service \| grep ExecStart` | `ExecStart=/usr/local/sbin/remote-turn-fw ensure` | PASS |
| `cmp /usr/local/sbin/remote-turn-fw ./host-firewall.sh` | "kurulu kopya güncel"; kurulu kopya root 0755, `/etc/default/remote-turn-fw` root 0644 (secret yok) | PASS |
| `journalctl -u remote-turn-fw -p err --since -1h` | boş | PASS |
| `curl 127.0.0.1:9641/metrics \| grep ^turn_` | 5 metrik satırı | PASS |

### 3. Sunucu içinden HMAC testi (`turnutils_uclient`, elle)
| Deneme | Sonuç |
|---|---|
| Geçerli HMAC, UDP / TCP / TLS (`-t -S`) | rc=0, hata yok — PASS |
| Yanlış secret | rc=255 (reddedildi) — PASS |

### 4. `sudo -E ./test-denied.sh` (staging, ~30 dk) — **60 PASS, 3 FAIL**
- Bölüm 1 (pozitif HMAC UDP/TCP/TLS, kontrol peer'ı, IPv6 relay reddi): 5 PASS; global IPv6 yok → INFO.
- Bölüm 2 (yanlış secret, süresi geçmiş username): 2 PASS.
- Bölüm 3 (denied-peer-ip her satırın ilk/son adresi): 2 FAIL dışında hepsi 403 PASS. Kendi IP'si SKIP (allowed-peer-ip).
  - FAIL `192.0.2.255` ("Cannot complete Allocation") ve FAIL local listedeki hipervizör satırı (`error 486`
    = allocation kotası): **403 değil kapasite/kota hatası** — 40 portluk aralık + `user-quota/total-quota` dolu iken
    allocation açılamadı; betiğin bekleme döngüsü yalnız 508'i tanıyor. Aynı iki peer test bitince elle yeniden denendi:
    ikisi de **`error 403`** → denied-peer-ip doğru; FAIL'ler test altyapısı kaynaklı (Bulgu 1).
- Bölüm 4 (host OUTPUT kuralı, S-P3-2):

| Satır | Sonuç |
|---|---|
| `host-firewall.sh check: kurallar yüklü` | PASS |
| relay → `<public>:3480` (aralık dışı) | PASS — echo yok, DROP +1 |
| relay → `<public>:3478` (TURN-in-TURN) | PASS — DROP +1 |
| relay → `<public>:53` | PASS — DROP +1 |
| relay → `<public>:49199` (aralık içi, relay↔relay) | **FAIL — echo dönmedi** (Bulgu 3) |

Test sonrası `iptables -L REMOTE-TURN-OUT -vn`: `-d <public>` kuralı 9 paket DROP (sayaçlar arttı), diğerleri 0.

### 5. Dış erişim (bu Mac'ten, 2026-11-11)
`nc -vz <public> 3478` ve `5349` zaman aşımı; 3478/udp STUN Binding yanıtı yok; 4450/tcp açık. **Beklenen:** üst NAT'ta
TURN yönlendirmeleri henüz açılmadı (runbook §8.2 tablosu kullanıcıya iletildi).

### Bulgular
1. **(Düşük, devops)** `test-denied.sh` bekleme döngüsü yalnız `error 508`'i yeniden deniyor; `486` (kota) ve
   "Cannot complete Allocation" da kapasite kaynaklıdır ve aynı beklemeyle tekrar denenmeli. Aksi halde yoğun koşuda yanlış FAIL verir.
2. **(Düşük, devops/güvenlik)** coturn açık `listening-ip` olmadan tüm arayüzleri dinliyor; paylaşımlı sunucuda diğer
   projelerin Docker köprü ağ geçitleri (`<docker-gw>`) üzerinden de 3478/5349 erişilebilir (kimlik doğrulaması gerekli,
   relay hedefleri denied-peer-ip ile kısıtlı). Öneri: `listening-ip=<vm>` + `127.0.0.1` (entrypoint üretir; healthcheck ve
   test 127.0.0.1 kullanır). P4/P13 öncesi değerlendirilir.
3. **(Bilgi, NAT bağımlı)** Aralık içi relay↔relay echo, staging'de genel IP VM'de yerel olmadığından paketin pfSense'e
   gidip **hairpin (NAT reflection)** ile geri dönmesini gerektirir; NAT kuralları açık değilken başarısız olması beklenir.
   Güvenlik özelliği (aralık dışı DROP) kanıtlandı; pozitif yol NAT + reflection açıldıktan sonra `test-denied.sh` yeniden
   koşularak kapatılır (runbook §8.2).


## P4 sayfa testi (2026-11-11, test-operatoru)
DURUM: DÜZELTİLMELİ
Ortam: yerel gerçek yığın — geçici MySQL 8.4 (`test-db.sh up`, migrate + seed + `e2e:real:users`), `apps/server` :3302 (`node src/server.ts`, TURN yok), web standalone :3218; Chromium sahte ekran bayrakları. Commit f9092da. Süreçler ve test DB kapatıldı.

### Özet
| Taranan sayfa/durum | Konsol hatası | 4xx/5xx | axe (açık+koyu) | 375 px taşma | Kırık link |
|---|---|---|---|---|---|
| 22 (login, panel, oturumlar, yeni oturum diyaloğu, şifre değiştir, 404, konsol: bekleniyor/lobi/aktif-video/bitti, müşteri: karşılama/lobi/paylaşım reddi/paylaşıyor/bitti/kullanılmış link/biçimsiz token 404/desteklenmiyor-mobil/reddedildi, yabancı konsol, zorla sonlandır diyaloğu) | 1 gerçek (TEST-P4-3); diğerleri beklenen 403/404/500 ağ kayıtları | Beklenmeyen 5xx 0 (server logunda error/5xx 0); 404/403/500 yalnız kasıtlı senaryolarda | 0 ihlal (tüm sayfalar, iki tema) | 0 | 0 |

- `pnpm --filter @remote/web e2e:real` (gerçek server + MySQL): **5/5 geçti** (AC-28..33/59/112, müşteri bitirir, AC-24 konsol yenileme, AC-113 ret, AC-114 zorla sonlandır).
- Keşif scriptleri: `docs/test-raporu/e2e/p4-tarama.mjs`, `p4-tarama-2.mjs` (apps/web dizininden, env ile). Ekranlar: `docs/img/p4/` (01–21; açık/koyu/375).

### Bulgular
#### TEST-P4-1 [YÜKSEK] Müşteri aktif oturumda sayfayı yenilerse (F5) oturuma dönemiyor
Akış: 1. Teknisyen oturum açar, müşteri katılır, kabul edilir, paylaşım başlar. 2. Müşteri sekmesini yeniler.
Beklenen: müşteri aynı oturuma (reconnectToken, 120 sn penceresi) geri döner ya da "yeniden bağlan" seçeneği görür.
Gerçekleşen: müşteri "Bu bağlantı zaten kullanıldı — teknisyeninizden yeni bir bağlantı isteyin" görür; konsol "Bağlantı koptu — 1:56 içinde dönmezse oturum sona erer" ile bekler, müşterinin dönüş yolu yok. 2/2 koşuda tekrarlandı.
Kanıt: `docs/img/p4/20-musteri-f5-sonrasi.png`, `21-konsol-musteri-f5-sonrasi.png`. Neden (tahmin): reconnectToken yalnız bellekte; yenilemede resolve tüketilmiş token'a 410 CONSUMED döner.
Atanan: frontend-dev (reconnectToken'ı sekme belleğinde/sessionStorage tutup yenilemede yeniden bağlanma) + backend-dev (CONSUMED token + geçerli reconnectToken yolu); gerekirse mimar kararı.

#### TEST-P4-2 [ORTA] Aktif oturumda konsol "Kalan süre" "—" gösteriyor
Akış: 1. Konsol açık (PENDING). 2. Müşteri katılır, teknisyen kabul eder → "Aktif".
Beklenen: `maxEndsAt`'e geri sayım. Gerçekleşen: "Kalan süre —" (kabulden 1,5 sn sonra ve video sürerken). Konsol yenilenince (hello ACTIVE) değer gelmesi muhtemel; canlı kabulde güncellenmiyor.
Kanıt: `docs/img/p4/11-konsol-video-light.png`.
Atanan: frontend-dev (kabul sonrası `maxEndsAt` kaynağı) — sunucu kabulde teknisyene `maxEndsAt` göndermiyorsa backend-dev.

#### TEST-P4-3 [DÜŞÜK] Konsol hatası: "Permissions policy violation: camera is not allowed in this document."
Akış: müşteri paylaşım sürerken sayfayı yeniler (TEST-P4-1 adımları). 2/2 koşuda müşteri sekmesinde görüldü; yenilemesiz akışlarda (gerçek e2e guardConsole) görülmüyor. Chromium sahte medya bayraklarının yan etkisi olabilir; gerçek tarayıcıda doğrulanmalı. Atanan: frontend-dev.

#### TEST-P4-4 [DÜŞÜK] Konsol üst barında "Oturumu bitir" 1280 px'te ikinci satıra düşüyor
"Uzaktan kontrol" + açıklama metni yer kaplıyor; düğme ayrı satırda. Kanıt: `11-konsol-video-light.png`. Atanan: frontend-dev.

#### TEST-P4-5 [DÜŞÜK] Bitiş/ret/kullanılmış link ekranlarında bağlam dışı alt bilgi
"Paylaşımı istediğiniz an durdurabilirsiniz. Ekranınız kaydedilmez." paylaşım yokken de görünüyor. Kanıt: `13-musteri-bitti-light.png`, `15-musteri-ret-light.png`. Atanan: frontend-dev.

Not (bulgu değil): tech2'nin tech1 konsol URL'si HTTP 200 + "Konsol yalnız oturumun teknisyenine açılır" uyarısı döner (veri sızmıyor; `18-yabanci-konsol.png`). Olmayan oturum konsolu da 200 + uyarı.

### Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Çıkışta korumalı URL (/sessions, konsol) → /login?next= | ✅ | |
| Login hatalı parola / boş form | ✅ | genel hata / alan hatası |
| Giriş → panel → oturumlar → yeni oturum diyaloğu | ✅ | link biçimi doğru |
| Konsol bekleniyor → lobi → yanlış/doğru kod → Aktif | ✅ | gerçek e2e + tarama |
| Paylaşım reddi (NotAllowedError) → "Paylaşım başlatılmadı" + Tekrar dene → paylaşım | ✅ | AC-30; `09-*` |
| Teknisyen videosu canlı, durdur/yeniden paylaş | ✅ | videoWidth>0 |
| Teknisyen bitirir → iki taraf bitiş; geri tuşu aktif göstermez; kullanılmış link → "zaten kullanıldı" | ✅ | |
| Müşteri F5 (aktif) | ❌ | TEST-P4-1 |
| Ret → "Teknisyen bağlantıyı reddetti"; aynı kaynak tekrar katılamaz (403) | ✅ | 403 sonrası müşteriye gösterilen mesaj doğrulanamadı (`17-*`) |
| Mobil (Pixel 7) → "Bu cihaz desteklenmiyor", katıl düğmesi yok | ✅ | AC-33; `14-*` |
| Biçimsiz token → HTTP 404 | ✅ | |
| Admin zorla sonlandır: düğme görünür, onayda odak "Vazgeç" | ✅ | iki tarafın bitişi gerçek e2e #5'te ✅; "yönetici tarafından" metni ve ≤5 sn ölçümü script seçici hatası nedeniyle bu turda ölçülemedi |
| Girdi: ad 1 karakter / 150 karakter (100'de kesilir) / SQL benzeri / `<img onerror>` | ✅ | düz metin gösterilir, çalışmaz, 5xx yok |
| Çift tıklama "Yeni destek oturumu" | ✅ | tek kayıt |
| Liste API 500 (route ile) → uyarı | ✅ | |
| Çıkış → geri tuşu → panel verisi yok | ✅ | |
| AC-38 frame-ancestors 'none' | ✅ | |

### Kabul kriterleri (uçtan uca)
| AC | Sonuç | Nasıl |
|---|---|---|
| AC-28 | ✅ | düğme pasif/aktif durumları, 2–100 sınırı |
| AC-30 | ✅ | sahte ret → Tekrar dene |
| AC-31, AC-32, AC-59 | ✅ | gerçek e2e #1, #2 |
| AC-33 | ✅ | Pixel 7 bağlamı |
| AC-34 | ✅ | "Uzaktan kontrol" pasif + açıklama (`11-*`) |
| AC-38 | ✅ | CSP başlığı |
| AC-39 | ✅ | axe 0 ihlal açık+koyu, tüm müşteri ekranları |
| AC-112, AC-113 | ✅ | gerçek e2e + tarama (403 tekrar katılım) |
| AC-114 | ✅ (kısmi) | gerçek e2e #5; metin/süre ölçümü bu turda yapılamadı |
| AC-125 | ✅ | uyarı + "Kötüye kullanımı bildir" mailto |
| AC-24 (teknisyen yenileme) | ✅ | gerçek e2e #3 |
| AC-23/40/42 | — | staging NAT/TURN bekliyor (QA-P4-10) |

### Görsel gözlemler
- Tüm sayfalarda açık/koyu tema okunaklı; logo koyu temada açık zeminli kartta (§1.5 uyumlu). 375 px'te taşma yok; lobi paneli mobilde düzgün (`08-konsol-lobi-375.png`).
- Konsol tema tercihinden bağımsız koyu (implementation karar 5, P12'ye dek).
- TEST-P4-4 ve TEST-P4-5 dışında hizalama/kontrast sorunu görülmedi.

### Koşulamayanlar
- AC-114 "yönetici tarafından sonlandırıldı" metni + ≤5 sn ölçümü (tarama scriptinde diyalog düğme seçicisi zaman aşımı; ürün hatası değil, gerçek e2e #5 akışı geçti).
- Ret sonrası 403'te müşteriye gösterilen hata metni (ekran `17-*` alındı, metin incelenmedi).
- Gerçek (sahte bayraksız) tarayıcıda TEST-P4-3 doğrulaması; staging TURN ölçümleri.

## P4 sayfa testi — tur 2 (2026-11-11, test-operatoru, dar kapsam)
DURUM: GEÇTİ
Ortam: tur 1 ile aynı yerel gerçek yığın — `test-db.sh up` (MySQL 8.4) + seed + `e2e:real:users`, `apps/server` :3302, web standalone :3218 (`e2e:real` webServer'ı ile yeniden build; rewrite hedefi build anında gömülür, `API_INTERNAL_URL` olmadan build'de `/api` → `server` host'una gider, 500). Viewport 1280×800. Süreçler ve test DB kapatıldı.
Betik: `docs/test-raporu/e2e/p4-tarama-3.mjs` (apps/web dizininden; env `E2E_REAL_LOGIN`, `E2E_REAL_PASSWORD`, `SHOTS`). Ekranlar: `docs/img/p4/t2-*.png`, sonuç `docs/img/p4/t2-sonuc.json`. 2 tam koşu yapıldı.

| Kontrol | Sonuç | Kanıt / not |
|---|---|---|
| `pnpm --filter @remote/web e2e:real` | ✅ 5/5 | 12,3 sn |
| TEST-P4-1 müşteri F5 #1 (aktif, paylaşırken) | ✅ kapandı | "Oturumunuza yeniden bağlanılıyor…" görüldü (1. koşu; ara ekran <100 ms sürdüğünden 2. koşuda yoklamaya yakalanmadı) → oturum ekranı "Ekranınız henüz paylaşılmıyor / Ekranımı paylaş", "kullanıldı" yok. `t2-02-musteri-f5-1.png` |
| TEST-P4-1 müşteri F5 #2 | ✅ | aynı sonuç; `t2-03-musteri-f5-2.png` |
| F5 sonrası konsol misafiri görür | ✅ (2/2) | "Ayşe Demir · Aktif", "Bağlantı koptu" yok |
| F5 sonrası "Ekranımı paylaş" → video | ✅ (2/2) | konsolda videoWidth=1920 (≤10 sn). Not: `data-share="sharing"` olduğu anda sahne birkaç yüz ms siyah (`t2-05-*` o ana ait) — bulgu değil |
| Oturum bitince müşteri F5 → "kullanıldı" | ✅ | "Bu bağlantı zaten kullanıldı"; `t2-07-*` |
| TEST-P4-2 kalan süre | ✅ kapandı | kabulden 1,5 sn sonra "4:00:00", 3 sn sonra "3:59:57" |
| TEST-P4-4 1280 px "Oturumu bitir" | ✅ kapandı | tek satır, h=44, durum rozetiyle aynı satır; `t2-01-konsol-aktif-1280.png` |
| TEST-P4-5 bitiş / ret ekranı alt bilgi | ✅ kapandı | "Ekranınız kaydedilmez" yok; `t2-06-*`, `t2-08-*`. Oturum ekranında (paylaşım bağlamı) duruyor, doğru |
| Ağ ≥400 / server 5xx / pageerror | ✅ 0 / 0 / 0 | |

Açık kalan: **TEST-P4-3 [DÜŞÜK]** müşteri sekmesinde "Permissions policy violation: camera is not allowed in this document." konsol hatası her koşuda 3 kez (ilk paylaşım + F5 sonrası 2 yeniden paylaşım) görüldü. Uncaught exception değil; Chromium sahte medya bayraklarının yan etkisi olabilir, gerçek tarayıcıda doğrulanmadı. Atanan: frontend-dev (bayraksız Chrome'da kontrol; gerçekse `getDisplayMedia` çağrısı/Permissions-Policy `camera=()` ilişkisi). Engelleyici değil.

## P5 sayfa testi (2026-11-11, test-operatoru)
DURUM: DÜZELTİLMELİ (1 YÜKSEK, 1 ORTA, 1 DÜŞÜK)
Ortam: gerçek yığın (scripts/e2e-real.sh adımları, çalışma ağacı anlık görüntüsü): MySQL 8.4 `rs-mysql-p5op`:33319, server :3312, web standalone :3228; dal `main` (son commit 0f1b89a + commit'lenmemiş P5 değişiklikleri). Chromium headless, `--disable-features=WebRtcHideLocalIpsWithMdns`, müşteride canvas sahte `getDisplayMedia` (1280x720, 30 fps). Kullanıcılar: iki ADMIN (rastgele parola); ikincisinde `user_permissions` `file_transfer.use=0`.
Spec: `docs/test-raporu/e2e/p5-op.spec.ts` + `p5op.config.ts` (geçici; ölçüm `expect.soft` + JSONL). Ekran görüntüleri: `docs/img/p5/` (01..20).

### Özet
| Ölçüt | Sonuç |
|---|---|
| Gezilen ekran | konsol (Sohbet/Dosyalar/Kalite, 1280 + 375, açık + koyu), müşteri oturum sayfası (1280 + 375, açık + koyu, kabul diyaloğu, PiP) |
| Konsol hata/uyarı, pageerror | 0 (iki taraf, tüm testler) |
| 4xx/5xx | 0; server logunda error/fatal 0 |
| axe (wcag2a/aa, 21aa) | konsol 6 tarama 0 ihlal; müşteri koyu 3 tarama 0; müşteri açık 2 taramada `scrollable-region-focusable` (TEST-P5-2) |
| 375 px yatay taşma | konsol 0 px, müşteri 0 px (açık/koyu, kabul diyaloğu dahil); ama uzun kelime balonda kırpılıyor (TEST-P5-3) |
| 1280 yerleşim | düzgün; konsol sahne + yan panel, müşteri tek sütun ortalı |

### Bulgular
#### TEST-P5-1 [YÜKSEK] 10 sn içinde 4. dosya teklifi sessizce düşüyor; gönderen kalıcı "onay bekleniyor"da kilitleniyor
Sayfa/akış: müşteri → teknisyen dosya gönderimi (teknisyen → müşteri de aynı kodu kullanıyor).
Adımlar: 1. Oturum aktif, müşteri Dosyalar sekmesi. 2. Arka arkaya küçük dosyalar gönder, her biri teknisyende kabul edilip `ok` olsun: kur.ps1, a.js, x.msi, y.scr (hepsi ~10 sn içinde). 3. 4. dosyayı (y.scr) gözle.
Beklenen: Teklif teknisyene ulaşır ya da gönderene açık bir ret/sınır mesajı gider; gönderen yeni dosya gönderebilir.
Gerçekleşen: Teknisyende kabul diyaloğu hiç açılmıyor; müşteri satırı "y.scr 1 B Karşı tarafın onayı bekleniyor" olarak ≥40 sn kalıyor; sonraki her gönderimde "Devam eden bir gönderim var; bitmesini bekleyin." — oturum boyunca dosya gönderme fiilen kilitleniyor. İki ayrı koşuda aynı sonuç (4. teklif).
Kök neden: `apps/web/lib/dc/files.ts` `OFFER_LIMIT = { max: 3, windowMs: 10_000 }`; `onOffer` sınırı aşan teklifi "hiç işlenmez (ret/meta yok)" — gönderene `file.reject` gitmiyor, gönderende teklif zaman aşımı yok (`activeOut()` "offered" durumunu aktif sayıyor).
Öneri: sınırı aşan teklife `file.reject` (auto: "rate") gönderilmesi ve/veya gönderende teklif zaman aşımı (ör. 60 sn). "offered" satırındaki iptal düğmesinin kilidi açıp açmadığı bu turda doğrulanmadı.
Kanıt: `docs/img/p5/20-musteri-teklif-gitmedi.png`; JSONL `offer-missing` kayıtları.
Atanan: frontend-dev

#### TEST-P5-2 [ORTA] Müşteri sohbet günlüğü kaydırılabiliyor ama klavyeyle odaklanılamıyor (axe serious)
Sayfa/akış: müşteri oturum sayfası, açık tema, 1280 ve 375 px.
Adımlar: 1. Sohbette birkaç mesaj ve 2000 karakterlik bir mesaj gönder (günlük `max-h-80` sınırını aşar). 2. axe çalıştır.
Beklenen: 0 ihlal. Gerçekleşen: `scrollable-region-focusable (serious): .max-h-80` (`components/collab/chat-panel.tsx` içindeki `role="log"` div'inde `tabIndex` yok). Konsolda yan panel daha yüksek olduğu için bu turda tetiklenmedi; içerik uzarsa aynı bileşen orada da ihlal üretir.
Öneri: kaydırılabilir `role="log"` kapsayıcıya `tabIndex={0}` ve görünür odak halkası.
Atanan: frontend-dev

#### TEST-P5-3 [DÜŞÜK] Boşluksuz uzun mesaj balonda kırpılıyor (iki tarafta)
Adımlar: 1. Sohbete boşluksuz 2000 karakter ("ÇÇÇ…") gönder. 2. Konsolu 1280'de, müşteri sayfasını 375 px'te aç.
Beklenen: satır kaydırılır (`overflow-wrap:anywhere`). Gerçekleşen: metin tek satırda kalıyor ve balon kenarında kesiliyor; konsolda başı, müşteride sonu görünmüyor (sayfa taşmıyor ama içerik okunamıyor).
Kanıt: `docs/img/p5/01-konsol-sohbet-1280.png`, `docs/img/p5/03-musteri-375.png`.
Atanan: frontend-dev

### Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Sohbet iki yön | ✅ | Enter ve Gönder çalışıyor; boş/boşluk mesajda Gönder pasif; `maxLength=2000`, karşıya 2000 karakter ulaşıyor |
| XSS/SQL denemesi (`<img onerror>`, `<script>`, `' OR 1=1 --`) | ✅ | düz metin olarak görünüyor; günlükte img/script 0; `__rsXss` iki tarafta tanımsız |
| Dosya teknisyen → müşteri (3 MB, Türkçe ad) | ✅ | indirilen dosya bayt bayt ve SHA-256 olarak aynı; `rapor-ğüşiöç.bin` adı korunuyor |
| Dosya müşteri → teknisyen | ⚠ | küçük dosyalar `ok` + SHA doğrulandı; 1 MB .zip bayt bayt karşılaştırması TEST-P5-1 kilidi nedeniyle koşturulamadı |
| Kabul diyaloğu | ✅ | Reddet varsayılan odakta, Kabul başta pasif; görünür olduktan 1,3–1,8 sn sonra aktif oluyor |
| Tehlikeli uzantı uyarısı | ✅ | `fatura.pdf.exe` için çift uzantı metni; .ps1/.js/.msi/.exe/.iso "çalıştırılabilir" uyarısı veriyor; .scr/.lnk/.docm/.reg TEST-P5-1 nedeniyle ölçülemedi |
| Ret → 30 sn otomatik ret penceresi | ✅ (tasarım) | retten sonraki teklif otomatik reddediliyor; satırda "son retten sonra 30 sn otomatik ret" yazıyor |
| İptal (100 MB, alıcı iptal ediyor) | ✅ | iki tarafta "İptal edildi", indirme sunulmuyor |
| Sınır üstü dosya (100 MB + 1 B) | ✅ | "Dosya 100 MB sınırını aşıyor." mesajı, teklif gitmiyor |
| Kalite paneli | ✅ | Bağlantı iyi, 30 FPS, ~640 kbps, RTT 0–1 ms, kayıp %0, 1280×720, Doğrudan |
| İşaretleme müşteri önizlemesinde | ✅ | kalem + mavi dikdörtgen (2 çizgi) müşteride görünüyor; geri al → 1, temizle → 0 |
| Lazer | ✅ | müşteride `data-laser=on`, kalıcı çizgi bırakmıyor (sönüm canvas alfasıyla yapılıyor) |
| Document PiP | ✅ | "Yüzen pencere" açılıyor; kapatınca önizleme sayfaya geri dönüyor |
| file_transfer yetkisi yok | ✅ | müşteride Dosyalar sekmesi ve file-input yok; konsolda "Bu oturumda dosya transferi yetkisi yok." yazıyor, gönder düğmesi yok |

### Görsel gözlemler
- Konsol, açık tema emüle edildiğinde de koyu görünüyor (kullanıcı teması DB'de SYSTEM). DESIGN.md'de konsol için koyu sahne kararı varsa sorun yok; yoksa ortak standart 1.6 ile çelişir. frontend-dev doğrulamalı (bulgu sayılmadı).
- Müşteri 375 px tam sayfa görüntüsünde paylaşım şeridi önizleme kartının üstüne biniyor gibi görünüyor. Bu, sticky eleman ile tam sayfa çekimin yan etkisi; normal kaydırmada görülmüyor.
- Koyu temada müşteri sayfası ve kabul diyaloğu okunaklı; logo açık bir kart üzerinde gösteriliyor.

### Koşturulamayanlar
- Müşteri → teknisyen yönünde büyük dosyada bayt bayt karşılaştırma ve .scr/.lnk/.docm/.reg uyarıları (TEST-P5-1 düzeltilince yeniden koşturulacak). Gönderen tarafın iptali bu turda denenmedi (mock e2e'de var).
- AC-41 (1080p ≥15 FPS) bu turda ölçülmedi.

## P5 sayfa testi — tur 2 (2026-11-11, test-operatoru, dar kapsam)
DURUM: GEÇTİ (TEST-P5-1 YÜKSEK, TEST-P5-2 ORTA, TEST-P5-3 DÜŞÜK kapandı; yeni 1 DÜŞÜK: TEST-P5-4)
Ortam: gerçek yığın (scripts/e2e-real.sh adımları, scratchpad'de çalışma ağacı kopyası, ayrı `.next`): MySQL 8.4 `rs-mysql-p5op`:33319, server :3312, web standalone :3228; Chromium headless, sahte `getDisplayMedia`. Web derlemesi `NEXT_PUBLIC_RS_E2E=1` ile alındı. Bu ayar yalnızca `__rsNoSelfThrottle` (alıcıda düşen teklif yolunu zorlamak için) ve `__rsSlowFileMs` (iptali aktarım sürerken yakalamak için) kancalarını açar. Zaman aşımı varsayılan 30 sn'de bırakıldı (`__rsOfferTimeoutMs` kullanılmadı).
Spec: `docs/test-raporu/e2e/p5-op2.spec.ts` + `p5op2.config.ts`. Sonuç: 4/4 geçti (T2-4 ilk koşuda TEST-P5-4 nedeniyle kırıldı, spec'e mesaj arası 250 ms eklenip yeniden koşturuldu). Konsol hata/uyarı 0, pageerror 0, 4xx/5xx 0, server logunda error/fatal 0. Görseller: `docs/img/p5/t2-*.png`.

### Doğrulama sonuçları
| Konu | Sonuç | Kanıt (ölçüm) |
|---|---|---|
| TEST-P5-1a: 4 hızlı teklif, gönderende sınır | ✅ | kur.ps1/a.js/x.msi kabul edildikten sonra 6,1. sn'de y.scr gönderildi. Gönderende "Kısa sürede en çok 3 dosya teklif edilebilir; birkaç saniye sonra tekrar deneyin." uyarısı çıktı, teknisyende teklif açılmadı, satır oluşmadı. 11,5 sn sonra y.scr normal gönderildi |
| TEST-P5-1b: alıcıda düşen teklif → "Yanıt yok" | ✅ | Gönderen öz-sınırı kapatılınca 4. teklif (d4.txt) teknisyene ulaşmıyor. Bekleme sırasında yeni gönderim "Devam eden bir gönderim var" uyarısı veriyor. **30,35 sn** sonra satır "Yanıt yok — teklif zaman aşımına uğradı, yeniden gönderebilirsiniz" oluyor; hemen ardından gelen `sonra.txt` teklif edildi, kabul edildi ve `ok` oldu. Kilit kalmıyor |
| "offered" satırında gönderen iptali | ✅ | Düşmüş e4.txt teklifi gönderende iptal edildi, satır `cancelled` oldu. Sonraki gönderim teknisyene "Onayınız bekleniyor" olarak ulaştı |
| Müşteri → teknisyen 1 MB (1 048 581 B .zip) | ✅ | indirilen dosya bayt bayt aynı, SHA-256 eşit, ad korunuyor |
| .scr / .lnk / .docm / .reg uyarısı | ✅ | dördünde de "Dikkat: çalıştırılabilir dosya türü…" çıkıyor (.ps1/.js/.msi de). normal.txt ve .zip için uyarı yok |
| Gönderen iptali (aktarım sürerken, iki yön) | ✅ | 2 MB dosya `sending` durumundayken gönderen iptal etti: müşteri→teknisyen ve teknisyen→müşteri yönünde iki tarafta da `cancelled` ("İptal edildi"), indirme düğmesi yok. Sonraki gönderim iki yönde de teklif edildi |
| TEST-P5-2: sohbet günlüğü klavye odağı | ✅ | `chat-log` öğesinde `tabIndex=0`. Müşteride 6., konsolda 24. Tab'da odak alıyor; görünür halka var (2 px solid, açık temada `rgb(10,108,176)`). Home tuşuyla kaydırma çalışıyor (scrollTop 1812 → 0) |
| TEST-P5-2: axe açık tema | ✅ | müşteri 1280 ve 375 px, konsol sohbet: 0 ihlal (wcag2a/aa/21aa). Günlük kaydırılabilir durumdayken ölçüldü |
| TEST-P5-3: boşluksuz 2000 karakter | ✅ | Müşteri (1280 ve 375 px) ile konsolda kırpılan balon yok (`scrollWidth > clientWidth` = 0), günlükte yatay taşma 0 px. En geniş balon günlükten dar (375 px'te 259/309 px). Sayfada yatay taşma 0 px |

### Bulgular
#### TEST-P5-4 [DÜŞÜK] Saniyede 5'ten fazla gönderilen sohbet mesajı alıcıda sessizce düşüyor, gönderende "gönderildi" görünüyor
Sayfa/akış: konsol → müşteri sohbeti (alıcı sınırı her iki yönde de aynı).
Adımlar: 1. Oturum aktif. 2. Konsolda 9 kısa mesajı aralarında beklemeden Enter ile gönder (1 sn'nin altında).
Beklenen: Ya tüm mesajlar karşı tarafa ulaşmalı ya da gönderen "mesaj gönderilemedi / yavaşlayın" uyarısı görmeli.
Gerçekleşen: Konsolda 9 mesaj görünüyor, müşteride yalnız 5 tane var. Ulaşmayan 4 mesaj için gönderende hiçbir uyarı çıkmıyor.
Kök neden: `apps/web/lib/dc/rate.ts` `IN_LIMITS.chat = 5` (mesaj/sn), aşan mesaj "sessizce düşer". Gönderen tarafta buna karşılık gelen bir sınır yok (TEST-P5-1'deki dosya teklifi sorununun sohbetteki karşılığı).
Etki: Normal yazışmada bu hıza ulaşılmaz; yapıştır + Enter tekrarında veya otomasyonda ortaya çıkar. Taşmanın kapsamı DÜŞÜK.
Öneri: Gönderende de aynı sınırla öz-sınırlama uygulanmalı ve aşımda `p5.chat` altında kısa bir uyarı gösterilmeli (dosyadaki `SELF_OFFER_LIMIT` yaklaşımı).
Kanıt: tur 2 ilk koşu, T2-4 `expect(chat-msg).toHaveCount(9)`: müşteride 5 alındı.
Atanan: frontend-dev

### Görsel gözlemler
- `t2-06-musteri-375-uzun-kelime.png`, `t2-07-konsol-uzun-kelime-1280.png`: odak halkası görünür. Halka içe doğru çizildiği için (`-outline-offset-2`) günlüğün en üstündeki ve soldaki satırlara biniyor: "E2E Teknisyen 1 · 07:13" etiketinin ilk harfi halkaya değiyor. Okunurluğu engellemiyor, bulgu sayılmadı. İstenirse günlük kapsayıcıya küçük bir iç boşluk (`p-1`) eklenebilir.
- `t2-03-musteri-yanit-yok.png` 1280 px'te düzgün. Dosya satırı kaydırma alanının altında kaldığı için durum metni ekran görüntüsünde değil, ölçümde doğrulandı.

### Not
- AC-41 (1080p ≥15 FPS) bu turun kapsamı dışında kaldı.

