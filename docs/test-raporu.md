# Test Raporu — Remote Support
DURUM: GEÇTİ (P4 sayfa testi tur 2, 2026-11-11 — TEST-P4-1/2/4/5 kapandı; TEST-P4-3 DÜŞÜK açık; ayrıntı en altta)

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
