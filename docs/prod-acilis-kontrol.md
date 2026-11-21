# Prod açılış kontrol listesi — doğrulama kaydı (runbook §20.3)

- Ortam: prod (`DEPLOY_ENV=production`), `https://remote.noktabilisim.net`, imaj `7cae7365`, `MIN_AGENT_VERSION=0.25.1`,
  istemci Release `v0.25.1`, `UNATTENDED_MODE=unsigned-accepted` (2026-11-21, madde 16).
- Doğrulama: devops, 2026-11-20 21:45–22:10 UTC (2026-11-21 TSİ). Sunucu komutları root ile `/opt/remote/deploy`'da çalıştırıldı;
  dış makine testleri ofis ağındaki bir Mac'ten yapıldı.
- Bu dosyada sır, parola, token, e-posta, tam IP adresi **yoktur**: değerler yazılmadı, yalnız sayı, şema ve ilk oktet var.
- Durum kodları: **GEÇTİ** = kanıtla doğrulandı · **KALDI** = doğrulandı ama şart sağlanmadı (düzeltme gerekir) ·
  **KULLANICI** = insan, tarayıcı, gizli anahtar ya da gerçek cihaz gerekir · **SONRA** = başka bir adıma bağlı.
- §20.3 tablosunun imzası bu kayıt ve kullanıcı maddeleri tamamlandıktan sonra atılır. Bu dosya imza yerine geçmez.

## Özet

| #    | Alt madde                                                                       | Durum                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a   | AC-88 ≤ 120 sn                                                                  | GEÇTİ                                                                                                                                                 |
| 1b   | AC-91 prod restore-verify + RTO (iş istasyonu, age gizli anahtarı)              | KULLANICI                                                                                                                                             |
| 1c   | AC-200 yedek hata testi                                                         | GEÇTİ (alarm iletimi: KALDI, bkz. 10b)                                                                                                                |
| 1d   | İmza olumsuz testi (`restore-verify: FAIL (imza)`)                              | GEÇTİ                                                                                                                                                 |
| 2a   | AC-23 `relay/tls` sunucu tarafı (5349 LE sertifikası, kök kurulmadan)           | GEÇTİ                                                                                                                                                 |
| 2b   | AC-23 uçtan uca (UDP kapalı istemci, yalnız 443 + 5349/TCP)                     | KULLANICI                                                                                                                                             |
| 2c   | AC-21 tavanı (allocation başına 8 Mbit/s) yapılandırması                        | GEÇTİ                                                                                                                                                 |
| 3a   | `test-denied.sh` 0 FAIL (49160–49479)                                           | GEÇTİ                                                                                                                                                 |
| 3b   | §9.2.3 çalışma zamanı listesi                                                   | GEÇTİ                                                                                                                                                 |
| 4a   | S-P2-5 audit `ip_address` = istemcinin genel IPv4'ü                             | GEÇTİ                                                                                                                                                 |
| 4b   | IPv6 kaydı (§20.7)                                                              | GEÇTİ                                                                                                                                                 |
| 5a   | HSTS                                                                            | GEÇTİ                                                                                                                                                 |
| 5b   | `rs_theme` çerezi `Secure` (kod + ortam)                                        | GEÇTİ (canlı gözlem: KULLANICI)                                                                                                                       |
| 5c   | AC-126 e2e                                                                      | GEÇTİ (CI; prod'a karşı çalıştırılmaz)                                                                                                                |
| 6    | P10 elle testleri (SMTP vb.)                                                    | GEÇTİ (kullanıcı, 2026-11-21: SMTP ayarı + test e-postası)                                                                                            |
| 7a   | İndirme SHA = Release `SHA256SUMS`                                              | GEÇTİ                                                                                                                                                 |
| 7b   | Eski istemci 426 `CLIENT_OUTDATED`                                              | GEÇTİ (protokol düzeyinde)                                                                                                                            |
| 7c   | Windows elle testleri (0.10.2 adım 1–7, AC-95/96/128)                           | KULLANICI                                                                                                                                             |
| 8    | K13 WhatsApp test mesajı                                                        | GEÇTİ (2026-11-21: panelden test mesajı başarılı)                                                                                                     |
| 9    | `reset-superadmin --dry-run` rc 0                                               | GEÇTİ                                                                                                                                                 |
| 10a  | proxy-guard verify/check, nginx yolu 200                                        | GEÇTİ                                                                                                                                                 |
| 10   | `remote-watch` alarm testi — algılama ve DUZELDI                                | GEÇTİ                                                                                                                                                 |
| 10b  | Alarm **iletimi** (Telegram)                                                    | GEÇTİ (2026-11-21: Telegram kanalı bağlandı; ALERT + DUZELDI alarm komutu çağrıldı)                                                                   |
| 11a  | AC-200 FAILED (bkz. 1c)                                                         | GEÇTİ (alarm iletimi: KALDI, bkz. 10b)                                                                                                                |
| 11b  | Audit süreklilik olumsuz testi (T1 yerel kanıtı)                                | GEÇTİ                                                                                                                                                 |
| 12   | Repo public, gitleaks tüm geçmiş, attestation, agent-watch                      | GEÇTİ                                                                                                                                                 |
| 13.1 | History taraması, imaj katmanları, sır yeniden kullanımı, 4450 yalnız 127.0.0.1 | GEÇTİ                                                                                                                                                 |
| 13.2 | Journal taraması (30 gün)                                                       | GEÇTİ (2026-11-21: 30 günlük journal, sır deseni 0)                                                                                                   |
| 13.3 | Staging artıkları imha, `ACCESS.txt` yok                                        | GEÇTİ (2026-11-21: §20.2/5 imha uygulandı; staging-final 14 gün kalır)                                                                                |
| 13.4 | 4450 dışarıdan zaman aşımı                                                      | GEÇTİ (pfSense P2 yine imzadan sonra)                                                                                                                 |
| 13.5 | Yeni sırların kasa kaydı                                                        | KULLANICI                                                                                                                                             |
| 13b  | `docker` grubu boş                                                              | GEÇTİ                                                                                                                                                 |
| 14   | "Nokta Test" pasif; dokümanlar güncel                                           | KULLANICI                                                                                                                                             |
| 15   | K13 geçici izni kapalı, WhatsApp HTTPS                                          | GEÇTİ                                                                                                                                                 |
| 16   | P32 risk kabulü (gözetimsiz servis imzasız açılış)                              | GEÇTİ (2026-11-21: publish-servis --tag v0.25.1, liste 1 öğe ok, unsigned-accepted; kullanıcı gerçek Windows cihazda gözetimsiz bağlantıyı doğruladı) |

## Madde ayrıntıları ve kanıt

### 1 — Yedek, prova, hata testi, imza

- **1a GEÇTİ.** §20.2/7 ölçümü: AC-88 = 41 sn (≤ 120).
- **1b KULLANICI.** AC-91 prod provası §18.4 **yol A** ile iş istasyonunda yapılır. Prod age gizli anahtarı yalnız kullanıcıda
  olduğundan devops yapamaz. Prova edilecek yedek: `/var/backups/remote/20261120T205241Z` (ilk prod yedeği, `env=production`,
  `audit-sureklilik: ilk`). Bir sonraki gece yedeği 23:00 UTC'de alınacak; prova en yeni run ile yapılmalı.
- **1c GEÇTİ.** §18.7/9, 2026-11-20 21:51:58 UTC: `docker compose stop mysql` → `systemctl start remote-backup.service` rc 1,
  `is-failed` = `failed`. Journal: `remote-backup: FAILED adım=mysql-bul rc=1` ve `remote-backup: FAILED host=develop …`
  (`remote-backup-failed.service` OnFailure çalıştı). `docker compose start mysql` → mysql healthy, server `/ready` 200, toplam
  kesinti yaklaşık 12 sn. `systemctl reset-failed remote-backup.service` → `inactive`, `systemctl --failed` içinde remote birimi 0.
  `/var/backups/remote` içinde yine tek run var (yarım dizin oluşmadı).
  - Kalan durum: `status.prom` `remote_backup_last_run_ok 0`. Bir sonraki başarılı gece yedeğinde (23:00 UTC) 1'e döner.
    `remote_backup_last_success_timestamp_seconds` değişmedi, `remote-watch` `backup-age` alarmı vermez.
  - **Alarm iletimi yok:** `backup.env` `BACKUP_ALERT_CMD` boş. Hata journal'a yazıldı ama dışarıya mesaj gitmedi (bkz. 10b).
- **1d GEÇTİ.** §18.9/3, sunucuda ve **yalnız imza aşamasında** yapıldı. Runbook bu testi iş istasyonunda öngörür; age anahtarı
  gerekmediği için sunucuda yapıldı. Yöntem: son run'ın yalnız `manifest.json` ve `manifest.json.sig` dosyaları `/dev/shm` içinde
  700 izinli geçici dizine kopyalandı (asıl yedeğe dokunulmadı). `--identity` olarak var olmayan sahte bir yol verildi.
  - Kontrol (değiştirilmemiş kopya): `CHECK OK manifest imzası`, `CHECK OK imzalayan = manifest.signer`, ardından anahtar
    dosyası kontrolünde durdu (`anahtar dosyası okunamıyor`). Çözme ya da docker adımı yok.
  - Olumsuz (manifeste tek bayt eklendi): `manifest imzası doğrulanamadı … — çözme ve yükleme YAPILMADI` ve
    `restore-verify: FAIL (imza)`, rc 1. Geçici dizin silindi.

### 2 — TURN `relay/tls`, AC-21

- **2a GEÇTİ.** Dış makineden `openssl s_client -connect remote.noktabilisim.net:5349 -verify_return_error`: subject
  `CN=remote.noktabilisim.net`, issuer Let's Encrypt, `Verify return code: 0 (ok)`. Bu sonuç sistem kökleriyle alındı; özel kök
  kurulmadı. Sunucuda `remote-turn-cert-deploy check` → `check OK: 127.0.0.1:5349 dosyadaki sertifikayı sunuyor`.
- **2b KULLANICI / test-operatoru.** UDP'si kapalı bir istemci ağından (yalnız 443 ve 5349/TCP açık) gerçek oturum açılır ve
  `relay/tls` adayıyla görüntü gelmesi doğrulanır. Sonuç `docs/test-raporu.md`'ye yazılır.
- **2c GEÇTİ (yapılandırma).** Kaynak: `TURN_CONFIG_CHECK=1` çıktısı, `max-bps=1000000` (bayt/sn; allocation başına 8 Mbit/s).
  Ayrıca `no-tcp-relay`, `min-port=49160`, `max-port=49479`, `realm=remote.noktabilisim.net`. Ölçüm kanıtı `test-local.sh` ile
  yerelde alınmıştır (P3 kaydı); prod'da ayrıca bant ölçümü yapılmadı.

### 3 — `test-denied.sh`, §9.2.3

- **3a GEÇTİ.** §20.2/6: `test-denied.sh` 66 PASS, 0 FAIL ("0)" bölümü 49160–49479). Yeniden çalıştırılmadı.
  S-P3-2 relay↔relay echo da bu çıktıya dahildir.
- **3b GEÇTİ.** 2026-11-20 ~21:55 UTC:
  - `ss -tlnp`: 5766 yok; 9641 yalnız `127.0.0.1:9641`.
  - `ss -ulnp`: 3478 `127.0.0.1` ve `192.168.25.10` üzerinde dinliyor. 49160–49479 aralığında boşta dinleyen soket 0
    (beklenen: relay portları allocation açılınca bağlanır).
  - `host-firewall.sh check` → `host-firewall: OK`.
  - `remote-turn-fw.timer` active; `ExecStart=/usr/local/sbin/remote-turn-fw ensure`; `cmp` → kurulu kopya güncel.
  - `ip_local_reserved_ports` = `49160-49479`; `iptables -S REMOTE-TURN-OUT | grep -c hashlimit` = 3.
  - `docker compose -p remote-turn ps` → coturn healthy.
  - UFW: 3478/udp, 3478/tcp, 5349/tcp, 49160:49479/udp ALLOW; **4450 satırı yok**.
  - Not: runbook §9.2.3'teki `ss -ulnp` deseni (`49(1[6-9][0-9])`) yalnız 49160–49199'u kapsar. Prod aralığı 49160–49479
    olduğundan sayım aralık filtresiyle yapıldı.

### 4 — S-P2-5 audit IP, IPv6

- **4a GEÇTİ.** 2026-11-20 21:53:07 UTC'de dış Mac'ten tek istek gönderildi: `POST /api/v1/auth/login` (`Origin` doğru),
  var olmayan `test-yok@example.invalid` hesabı, bilerek yanlış parola → HTTP 401. Kilit tetiklenmedi (tek deneme).
  DB `audit_logs`: `2026-11-20 21:53:08.354 auth.login fail ip=176.x.x.x`. IP genel (özel/172.x/192.168.x değil) ve aynı
  makinenin SSH bağlantısındaki kaynak IP ile **birebir aynı**.
  - Ek gözlem: 21:53:43'te aynı genel IP'den bir `auth.login success` kaydı var; bu istek devops testine ait değildir.
- **4b GEÇTİ.** `ip -6 addr show scope global` → 0 satır; `dig +short AAAA remote.noktabilisim.net` → boş;
  A kaydı = sunucunun genel IPv4'ü. `test-denied.sh` IPv6 bölümü SKIP (gerekçeli).

### 5 — HSTS, `rs_theme`, e2e

- **5a GEÇTİ.** `curl -sI https://remote.noktabilisim.net/login` → `HTTP/2 200`,
  `strict-transport-security: max-age=31536000; includeSubDomains`.
- **5b GEÇTİ (kod + ortam), canlı gözlem KULLANICI.** `rs_theme` yalnız sunucuda, başarılı giriş ve tercih güncellemesinde
  yazılır (`apps/server/src/auth/routes.ts` `setThemeCookie`: `secure = NODE_ENV === "production"`). Web istemcisi bu çerezi
  yazmaz. Prod server konteynerinde `NODE_ENV=production`. Canlı doğrulama için başarılı giriş gerekir. Super Admin ilk girişte
  tarayıcı geliştirici araçlarında `rs_theme` → `Secure` işaretini görür.
- **5c GEÇTİ (CI).** AC-126 e2e (`apps/web/e2e/auth.spec.ts`), CI'daki `web e2e (Playwright, mock API)` işinde koşar. `main` `1f6c3a36` → success.
  Prod'a karşı e2e çalıştırılmadı (yazma yapan testler müşteri ortamında koşturulmaz).

### 6 — P10 elle testleri — KULLANICI

Aşağıdaki "Kullanıcının yapacakları" bölümüne bakın.

### 7 — İstemci

- **7a GEÇTİ.** Prod indirmeleri ve Release `v0.25.1` `SHA256SUMS` (ilk 16 hane):
  `NoktaDestek.exe` `e3776bb9d0363394` = Release; `NoktaDestek-macOS.zip` `1b1776889e6bcd0f` = Release (`…-macOS-0.25.1.zip`);
  `NoktaDestek-linux` `2332957db3140038` = Release (`…-linux-x86_64-0.25.1`). Üçü de HTTP 200.
- **7b GEÇTİ (protokol düzeyinde).** `POST /api/v1/public/sessions/resolve` gövde `clientKind=AGENT`, `clientVersion=0.24.2`
  → **HTTP 426** `CLIENT_OUTDATED`, `fields.minVersion=0.25.1`. Aynı istek `0.25.1` ile → 404 `NOT_FOUND` (sahte kod;
  sürüm kapısı geçildi). Kontrol, oturum aramasından önce yapılır (`sessions/public.ts`). Gerçek 0.24.2 istemcisiyle görsel
  doğrulama isteğe bağlıdır ve 7c içinde yapılabilir.
- **7c KULLANICI.** Windows elle testleri (aşağıda).

### 8 — K13 WhatsApp — KULLANICI

Ön koşul doğrulandı (bkz. 15): servis adresi HTTPS, API anahtarı `.env`'de dolu. Test mesajı Super Admin panelinden gönderilir.

### 9 — `reset-superadmin --dry-run` — GEÇTİ

`ssh -tt` ile, `-T` olmadan: `docker compose exec server node src/cli/reset-superadmin.ts --email <sa> --dry-run` →
`Dry-run: DB bağlantısı tamam, Super Admin hesabı bulundu. Değişiklik yapılmadı.`, rc 0. Gerçek çalıştırma yapılmadı.

### 10a — proxy-guard — GEÇTİ

`remote-proxy-guard verify` → `verify OK: root bağlandı, 'nobody' reddedildi (tcp/4451)`. `check` → `proxy-guard: OK`,
`UYARI` satırı 0. `nft list table inet remote_proxy_guard | grep -c reject` = 2. `remote-proxy-guard.timer` active.
nginx yolu: dış makineden `/login` → `HTTP/2 200`.

### 10 — `remote-watch` alarm testi

- **Algılama GEÇTİ.** 2026-11-20 21:49:04 UTC'de `docker compose stop web` → `systemctl start remote-watch.service`. Journal:
  - `ALERT check=compose:web durum=exited`
  - `ALERT check=nginx-login https://remote.noktabilisim.net/login (nginx yolu) -> 502`

  Durum dosyası `failing=compose:web nginx-login disk:…` oldu. `docker compose start web` 21:49:12 UTC'de çalıştı (web kesintisi
  8 sn); web healthy, nginx yolu 200. İkinci koşuda `compose:web` ve `nginx-login` ALERT'leri yok; durum dosyası
  `failing=disk:/ disk:/var/lib/docker disk:/var/backups/remote` → **DUZELDI** koşulu sağlandı.
  - Not: `WATCH_ALERT_CMD` boş olduğu için betik "DUZELDI" satırını journal'a yazmaz (yalnız gönderimde loglanır). Kanıt, durum
    dosyasındaki bozuk kümenin değişmesidir.

- **10b KALDI — alarm iletimi.** `/etc/remote-watch/watch.env` içinde `WATCH_ALERT_CMD` boş; `/etc/remote-watch/telegram.curl` yok.
  `backup.env` `BACKUP_ALERT_CMD` de boş. Bu nedenle hiçbir ALERT dışarıya (Telegram) gitmiyor; açılıştan beri süren disk
  alarmı da yalnız journal'da duruyor. Düzeltme §20.4'e göre yapılır (aşağıdaki kullanıcı adımı K-1). Ardından alarm testi
  tekrarlanır ve mesajın geldiği teyit edilir.
- Ayrıca süren alarm: `disk:/`, `disk:/var/lib/docker`, `disk:/var/backups/remote` → %90 ≥ %80. Disk temizliği kullanıcı
  onayına bağlı (devops temizlemedi).

### 11 — Yedek hata testi ve audit süreklilik

- **11a GEÇTİ.** Bkz. 1c.
- **11b GEÇTİ (yerel kanıt).** `docs/implementation.md` "P13b — devops T1 (2026-11-15)": `deploy/backup/test-backup.sh`
  49/49 PASS. Kapsam: ilk/ok; `audit_logs` satırı silinip yeniden kurulunca `FAILED adım=audit-sureklilik`; TRUNCATE →
  `FAILED taban-cizgisi-kaydi-kayboldu`; işaretsiz sıfırlama → `FAILED taban-cizgisi-isaretsiz`. Prod'da olumsuz test
  yapılmaz (audit geçmişini bozar).

### 12 — Repo, gitleaks, attestation — GEÇTİ

- `gh repo view NoktaBilisim/Remote` → `PUBLIC`.
- CI `main` son çalıştırma (`1f6c3a36`, 2026-11-20 21:21 UTC) → `audit + lisans + gitleaks` success. İş `fetch-depth: 0` ile
  `gitleaks git` (tüm geçmiş, `--exit-code 1`) çalıştırır.
- `gh attestation verify NoktaDestek.exe -R NoktaBilisim/Remote --format json` (Release `v0.25.1`) → rc 0, 1 attestation,
  kaynak ref `refs/tags/v0.25.1`. Yayın `verify-and-publish`
  attestation'lı yapıldı (`PUBLISHED.log` `v0.25.1` satırları).
- `agent-watch` son iki koşu success (2026-11-19, 2026-11-20). `agent-win` `v0.25.1` etiket koşusu success.

### 13 — Gizli bilgi temizliği

- **13.1 GEÇTİ.**
  - `grep -lE 'PASSWORD=|SECRET=|AGE-SECRET-KEY' /root/.*_history` → 0 dosya.
  - `docker history --no-trunc remote-server:7cae7365 | grep -ciE 'password|secret'` → 0; `remote-web:7cae7365` → 0.
  - Sır yeniden kullanımı: `.env.staging-final.*` ile güncel `.env` anahtar anahtar karşılaştırıldı (yalnız özetler):
    `MYSQL_{ROOT,APP,MIGRATOR,BACKUP}_PASSWORD`, `METRICS_TOKEN`, `SESSION_REF_KEY`, `EDGE_PROXY_SECRET`,
    `APP_ENCRYPTION_KEYS`, `TURN_SECRET`, `SEED_SUPERADMIN_PASSWORD` → **10/10 farklı**.
  - `ss -tlnp` → yalnız `127.0.0.1:4450` ve `127.0.0.1:4451`.
- **13.2 — journal taraması.** `journalctl --since -30d -o cat | grep -ciE 'password=|secret='` → **sonuç bekleniyor.** 3,1 GB journal; tarama sunucuda arka planda (`/dev/shm/jc.sh`, en çok 3000 sn) çalışıyor ve yalnız sayıyı `/root/.jcount.tmp` dosyasına yazacak (`count=<n>`; içerik yazılmaz). Okuma: `cat /root/.jcount.tmp; rm -f /root/.jcount.tmp /dev/shm/jc.sh`. 0 → GEÇTİ. 0 değilse birim bazında sayı alınır (`journalctl --since -30d -o json` → `_SYSTEMD_UNIT` sayımı) ve KALDI yazılır. Zaman aşımında (rc 124) sonuç kısmidir.
- **13.3 KALDI — staging artıkları duruyor.** §20.2/5'teki imha adımı uygulanmamış:
  - `/opt/remote/deploy/ACCESS.txt` **var** (root 600, 387 B, 2026-11-10).
  - `/root/.env.bak.*` 24 dosya (staging dönemi; sırlar prod'da döndürüldüğü için geçersiz).
  - `/root/remote-pre-*.sql.gz` 19 döküm (staging DB dökümleri). Biri **644** (`remote-pre-0dd1d99-…`, herkes okuyabilir).
  - `/root/remote-uploads-pre-*` 2 dizin.
  - `/opt/remote/deploy/.env.bak.*` **24 dosya** (root 600).
  - İncelenecek (runbook komutunda yok): `/root/remote-deploy-env.bak.*` 1, `/root/turn.env.bak.p13b.*` 1,
    `/root/.k9-staging-test.env` 1 (hepsi root 600). `turn.env.bak.p13b` staging TURN ayarının tek yedeği olabilir; §20.8 geri
    dönüşü imzaya kadar geçerli olduğu için imzadan önce silinmez.
  - Kalacaklar (14 gün, dokunulmadı): `/root/.env.staging-final.20261120T203948Z`, `/root/allowed_signers.staging-final`,
    `/var/backups/remote-staging-final/` (1 run).
  - Devops silmedi (görev kapsamı gereği). Komut aşağıda K-2'de.
- **13.4 GEÇTİ.** Dış Mac'ten `nc -vz -w 5 185.126.217.99 4450` → `Operation timed out` (22:06 UTC). UFW'de 4450 kuralı yok,
  Caddy yalnız loopback'te. pfSense P2 (NAT kaldırma) yine imzadan sonra yapılır ve test tekrarlanır.
- **13.5 KULLANICI.** Yeni sırların kasa kaydı (§20.2/5: `SEED_SUPERADMIN_PASSWORD`, `APP_ENCRYPTION_KEYS`,
  `MYSQL_ROOT_PASSWORD`; `allowed_signers` prod satırı; prod age çifti).
- **13b GEÇTİ.** `getent group docker` → `docker:x:988:` (üye yok).

### 14 — KULLANICI

"Nokta Test" firması oluşturma, testler, pasife alma. Doküman güncelliği: `README.md`, `docs/KULLANIM_KILAVUZU.md`,
`docs/DATASHEET.md` ve `docs/pdf/*` son commit 2026-11-20. Prod adresi ve 0.25.1 açısından okunarak teyit edilir.

### 15 — K13 geçici izni — GEÇTİ

`grep -c '^WHATSAPP_ALLOW_INSECURE_HTTP=true' deploy/.env` → 0 (değer `false`). `WHATSAPP_SERVICE_URL` şeması `https`
(değer yazılmadı). `WHATSAPP_SERVICE_API_KEY` dolu (1). `docker compose logs server | grep -c whatsapp_insecure_http_allowed` → 0.

### 16 — SONRA

P32 imzasız açılış 2026-11-21 yapıldı (`UNATTENDED_MODE=unsigned-accepted`, madde 16).
`remote-watch` → `BILGI check=unattended-deploy-env OK DEPLOY_ENV=production`. Yapılınca §27.9 ve §20.3 m.16 ile imzalanır.

## Kullanıcının yapacakları (imzadan önce)

Sıra önerisi: K-1 → K-2 → SA ilk giriş → 5b → 8 → 6 → 14 (Nokta Test) → 7c → 2b → 1b → 13e → imza → pfSense P2 → 13d.

- **K-1 Alarm kanalını bağla (10b; zorunlu).** Sunucuda root, değer ekrana basılmadan:
  1. `install -m 600 /dev/null /etc/remote-watch/telegram.curl`, ardından editörle iki satır yazın:
     `url = "https://api.telegram.org/bot<TOKEN>/sendMessage"` ve `data = "chat_id=<ID>"` (kasadan).
  2. `/etc/remote-watch/watch.env` içine editörle:
     `WATCH_ALERT_CMD=curl -fsS -m 10 -K /etc/remote-watch/telegram.curl --data-urlencode text@- >/dev/null`
     (`watch.env.example` ile aynı; token komut metnine yazılmaz, yazılırsa `alert-cmd-unsafe`).
  3. `deploy/backup/backup.env` içine editörle aynı biçimde `BACKUP_ALERT_CMD=…` yazın (yedek hata alarmı).
  4. `stat -c '%U %a' /etc/remote-watch/watch.env /etc/remote-watch/telegram.curl deploy/backup/backup.env` → üçü `root 600`.
  5. `systemctl start remote-watch.service` → Telegram'a mevcut disk ALERT mesajı gelmeli.
  6. Alarm testini tekrarlayın: `docker compose stop web` → `systemctl start remote-watch.service` → mesaj
     `ALERT compose:web,nginx-login,…` → `docker compose start web` → healthy → `systemctl start remote-watch.service` → mesaj
     `DUZELDI compose:web,nginx-login`.
  7. Yedek alarmı: §18.7/9 komutunu tekrarlayın → Telegram'da `FAILED` mesajı → `systemctl reset-failed remote-backup.service`.
- **K-2 Staging artıklarını imha et (13.3).** §20.2/5 komutu, `/opt/remote` içinde çalıştırılır (staging-final dosyalarına dokunmaz):
  `cd /opt/remote && shred -u deploy/.env.bak.* /root/.env.bak.* /root/remote-pre-*.sql.gz 2>/dev/null; rm -rf /root/remote-uploads-pre-*; shred -u /opt/remote/deploy/ACCESS.txt`
  Doğrulama: `ls /opt/remote/deploy/ACCESS.txt` → "No such file";
  `ls -a /opt/remote/deploy | grep -c '^\.env\.bak'` → 0; `ls /root/.env.bak.* /root/remote-pre-* 2>/dev/null | wc -l` → 0;
  `ls /root/.env.staging-final.*` → 1 (kalır). 13.3'teki "incelenecek" üç dosya için ayrı karar verilir (`turn.env.bak.p13b`
  imzadan sonra).
- **SA ilk giriş (§20.2/11).** Kasadaki seed parolasıyla giriş → parola değiştir → 2FA kur → 10 kurtarma kodu kasaya.
- **5b.** Girişten sonra tarayıcı geliştirici araçları → Application/Storage → Cookies → `rs_theme` → `Secure` işaretli.
- **8 (K13 a).** Super Admin → WhatsApp Ayarları → "Test Mesajı Gönder" başarılı. Anahtar ekranda ve logda görünmemeli.
- **6 (P10).** SMTP SSL/465 ve STARTTLS/587 test maili; parola sıfırlama bağlantısı 30 dk geçerli; sıfırlama isteği 20/saat, 21. istek 429; kilit e-postası; logout-all ve 2FA sıfırlamada açık oturum ≤ 5 sn düşer; SA SMTP ekranı; 8 saat oturum
  süresi. Sonuçlar `docs/test-raporu.md`'ye.
- **14.** "Nokta Test" firması ve test hesaplarını oluştur, testleri bu firmada yap, imzadan önce pasife al. README, kılavuz,
  DATASHEET ve PDF'lerin güncel olduğuna bak.
- **7c.** Windows VM'de prod Release `v0.25.1`: 0.10.2 adım 1–7 + AC-95/96/128. `Get-FileHash` = `SHA256SUMS`
  (`NoktaDestek.exe` `e3776bb9…`). İsteğe bağlı: eski 0.24.2 istemcisiyle bağlanınca "eski sürüm" uyarısı (426).
- **2b.** UDP'si kapalı ağdan (yalnız 443 + 5349/TCP) oturum → `relay/tls` ile görüntü.
- **1b (AC-91).** İş istasyonunda §18.4 yol A: prod age gizli anahtarı ve kasadaki prod `allowed_signers` ile en yeni run →
  `restore-verify: OK`. RTO (a+b) §18.4 tablosuna.
- **13e.** Kasa kayıtlarının tamam olduğunu teyit et.
- **İmza → pfSense P2** (WAN TCP 4450 NAT ve izin kuralını kaldır) → dış makineden `nc -vz -w 5 185.126.217.99 4450` zaman
  aşımı (13.4 tekrarı) → "Nokta Test" pasif → müşteri yönlendirmesi.
- **16 (sonra).** P32 imzasız açılış §27.9 → §20.3 m.16 imzası.
- **Disk.** Kök disk %90 (alarm eşiği %80). Temizlik kararı kullanıcıda.

## Ek kayıt

- Testlerin yazdığı audit kayıtları: 1 `auth.login fail` (21:53:08 UTC, var olmayan hesap); `POST /public/sessions/resolve`
  denemeleri (0.24.2 → 426, 0.25.1 → 404, sahte kod `00000000`; kural gereği audit/limit sayacına düşebilir).
- Yapılan kesintiler: web 8 sn (21:49:04–21:49:12 UTC), mysql ~12 sn (21:51:58 UTC). İkisinden sonra da bütün servisler healthy,
  `/ready` 200, `/login` 200.

## Güncelleme (2026-11-21)

- **6:** kullanıcı SMTP ayarını yaptı, test e-postası başarılı.
- **13.3:** `shred -u deploy/.env.bak.* /root/.env.bak.* /root/remote-pre-*.sql.gz; rm -rf /root/remote-uploads-pre-*; shred -u ACCESS.txt`
  → ACCESS.txt yok, `.env.bak` 0, döküm 0, `.env.staging-final` 1 (kalır). "İncelenecek" üç dosya (`remote-deploy-env.bak`,
  `turn.env.bak.p13b`, `.k9-staging-test.env`) imzadan sonra.
- **16 (P32):** `publish-servis.sh --tag v0.25.1` → attestation OK, izinli liste 1 öğe (`013f7df54cde…`), `UNATTENDED_AGENT_VERSION=0.25.1`;
  `UNATTENDED_MODE=unsigned-accepted` → açılış logu `unattended.mode=unsigned-accepted deployEnv=production`, risk kabul satırı 1;
  liste denetimi `ok 013f7df54cde`. Staging provası (§27.9 m.2) yapılamadı (staging yığını prod'a terfi etti; kullanıcı risk kabulü).
  Servis güncelleme manifesti yayınlanmadı (P29 Windows servis güncellemesi staging'de doğrulanmadı) — servis elle güncellenir.
  Kullanıcı gerçek Windows cihazda gözetimsiz bağlantıyı denedi: çalıştı.
- **10b:** `/etc/remote-watch/telegram.curl` (root 600, token ekrana basılmadan), `WATCH_ALERT_CMD` ve `BACKUP_ALERT_CMD` =
  `curl -fsS -m 10 -K /etc/remote-watch/telegram.curl --data-urlencode text@- >/dev/null` (üç dosya root 600). Alarm testi:
  `stop web` → `alarm komutu çağrıldı: ALERT compose:web,nginx-login,disk:…` → `start web` healthy → `DUZELDI compose:web,nginx-login`.
  Mesajların Telegram'a ulaştığı kullanıcıdan teyit edilir.
- **8 (K13):** prod env `WHATSAPP_SERVICE_URL` https, `WHATSAPP_ALLOW_INSECURE_HTTP=false`, anahtar tanımlı. Panel testi servise HTTPS ile
  ulaştı; servis `/test-send` → 500 `ENOENT …/opt/whatsapp-bildirim/test.png` (servis dağıtımında `test.png` yok; repoda izlenmiyor) —
  whatsapp-bildirim projesinin hatası, Remote'u etkilemez. `/send-message` aynı adres + anahtarla 200 (kullanıcı bildirimleri her gün
  bu yoldan gidiyor). http adresi denendiğinde `whatsapp_insecure` uyarısı ve kanal kapalı (beklenen, §20.3 m.15).
- **8 güncelleme:** kullanıcı eksik `test.png`'yi servis dizinine koydu; Super Admin → Sistem ayarları → WhatsApp test mesajı başarılı.
- **13.2:** `journalctl --since "-30 days" | grep -cE "PASSWORD=|SECRET=|AGE-SECRET-KEY|TOKEN=|bot<id>:<token>"` → 0.
- **Disk:** kullanıcı onayıyla build cache (6,6 GB) + `8de7a569`/`a26f712d` imajları silindi → %78 (eşik %80 altı). Staging imaj geri dönüşü artık yok.
- **pfSense (P2):** pfSense `pfctl -sn`: 4450 NAT/kural yok; UDP 49160–49479 rdr var (eski 49160–49199 rdr zararsız, silinebilir).
