# ADR-0019 — Prod yerleşimi: staging yığını yerinde prod'a terfi eder (temiz kurulum), ayrı staging sonra
Tarih: 2026-11-14 · Durum: Kabul · İlgili: ADR-0015, ADR-0018, ADR-0020, K1, K3, `docs/mimari-p13.md` §7.2, runbook §8, §20

## Bağlam
K1 (2026-11-14): prod adresi `https://remote.noktabilisim.net`. Bu adreste bugün staging yayında. Yerleşim şöyle:
- host nginx → `127.0.0.1:4451`, compose projesi `remote`, dizin `/opt/remote/deploy`, ayrıca IP girişi `0.0.0.0:4450`.
- K3: aynı sunucu, ayrı IP yok.
- Sunucu paylaşımlı. Disk geçmişte %83'e çıktı.

Staging verisi test verisidir. Ayrıca prod'da hiç oluşmaması gereken kayıtlar içerir: P13a öncesi ad içeren `guest.*` audit satırları
(S-P13a-1). Staging sırları uzun süre ACCESS.txt, `.env.bak.*` ve oturum dökümleriyle dolaştı.

Betikler `remote` proje adına bağlı: `remote-mysql-1`, `RESTORE_EXPECT_PROJECT`, coturn log cron'u. Compose'da sabit değerler var:
`edge` alt ağı 172.30.0.0/24, caddy .2, web .3, `TRUSTED_PROXY_CIDR=172.30.0.2/31`, Caddy `trusted_proxies 172.30.0.128/32`,
4450/4451 portları. Bu yüzden aynı makinede ikinci bir yığın, parametreleştirme olmadan çalışamaz.

## Karar
1. **Yerinde terfi:** Prod, aynı dizinde (`/opt/remote`) ve aynı compose proje adıyla (`remote`) kurulur. Betikler ve runbook
   komutları değişmez. Terfi **temiz kurulumdur**:
   - Staging'in son yedeği (P13b koduyla imzalı) alınır ve scratch'te doğrulanır.
   - `docker compose down` yapılır. Yalnız bu projenin volume'ları (`remote_mysql_data`, `remote_uploads`, `remote_caddy_data`,
     `remote_caddy_config`, `remote_agent_downloads`) adıyla silinir. Filtresiz prune yasaktır.
   - **Bütün sırlar yeniden üretilir**: MySQL parolaları, `SESSION_REF_KEY`, `EDGE_PROXY_SECRET`, `APP_ENCRYPTION_KEYS`,
     `METRICS_TOKEN`, `TURN_SECRET`, Super Admin parolası.
   - Eski `.env.bak.*` dosyaları ve `ACCESS.txt` imha edilir.
   - Yeni volume'larla `up -d` yapılır. Bu kurulum aynı zamanda AC-88 prod ölçümüdür.
2. **Ortam etiketi:** `deploy/.env` `DEPLOY_ENV=production|staging|dev`. Yalnız deploy betikleri okur (`backup.sh` manifeste yazar;
   `restore.sh` hedefle karşılaştırır). Server okumaz, bu yüzden `env.ts`'e girmez (`MYSQL_BACKUP_PASSWORD` ile aynı gerekçeli
   istisna).
3. **IP girişi kapanır:** `CADDY_BIND=127.0.0.1`. 4450 yalnız loopback'te tanı amaçlı kalır. UFW `4450/tcp` kuralı ve pfSense 4450
   NAT'ı kaldırılır. `ALLOWED_ORIGINS` yalnız `https://remote.noktabilisim.net` olur. IP gömülü eski istemciler (≤ 0.8.1) ve diğer
   staging istemcileri `MIN_AGENT_VERSION` ile yeni Release'e zorlanır.
4. **Geçiş sırası:**
   - **A:** P13b kodu önce **staging'e** normal paket akışıyla çıkar ve qa ile güvenlik GEÇTİ alır.
   - **B:** Terfi yapılır.
   - B'nin geri dönüşü, müşteri yönlendirilmeden önce yapılabilir: prod volume'ları silinir, staging `.env` yedeği geri konur,
     `restore.sh --target staging` son imzalı staging yedeğiyle çalıştırılır. Müşteri prod'a yönlendirildikten sonra geri dönüş
     yoktur; ileri düzeltme uygulanır.
5. **Ayrı staging = P13c (Sonra, prod açılışından sonra, E11'in ilk kod paketinden önce).** Genişleme noktası:
   - Compose'da `EDGE_SUBNET`, sabit IP'ler, `TRUSTED_PROXY_CIDR`, Caddy `trusted_proxies` ve 4450/4451 portları env ile
     parametreleşir.
   - Staging ayrı proje (`remote-stg`, `/opt/remote-stg`), `stg.remote.noktabilisim.net` (yeni A kaydı + nginx vhost + LE), ayrı
     volume/DB/sır/yedek dizini/age anahtarı ve `DEPLOY_ENV=staging` ile kurulur.
   - TURN: önerilen varsayılan, staging'in yalnız prod coturn'ün **STUN**'unu kullanmasıdır (kimliksiz; relay yok). Relay testleri
     prod'da test firmasıyla yapılır.
   - Kaynak kontrolü (RAM, disk) P13c tasarımında yapılır.

## Alternatifler
- **Aynı sunucuda ayrı prod projesi (`remote-prod`) + staging'i yeni alt alana taşımak:** İki MySQL ve iki yığın gerekir; compose ve
  Caddy'deki sabit ağ/port değerleri, yedek konteyner adı ve TURN paylaşımı şimdi değişmek zorunda kalır. Prod açılışının yüzeyini
  büyütür ve disk riski yaratır. Reddedildi, P13c'ye bırakıldı.
- **Staging verisiyle prod'a geçmek (veriyi taşımak):** Test hesapları ve kayıtları, P13a öncesi ad içeren audit satırları ve uzun
  süre açıkta kalmış sırlar prod'a taşınır. Reddedildi.
- **Prod için yeni VM:** K3 kararıyla yok.

## Sonuçlar
- Prod açılışından P13c'ye kadar staging yoktur. Paket akışındaki "staging yayını" adımı bu sürede yerel ortamda yapılır:
  `scripts/e2e-real.sh` ve yerel compose `rsp13ae2e` kalıbı. Prod'a yalnız düzeltme ve operasyon değişikliği çıkar; yeni özellik
  (E11) P13c kurulmadan prod'a çıkmaz.
- Test-operatoru prod açılış kontrolleri için prod'da **"Nokta Test" firması** kullanılır. Kontroller bitince firma pasife alınır.
- Proje kökündeki `CLAUDE.md` "Prod açılışı P10 sonrası; öncesi yalnız staging (185.126.217.99:4450)" satırı terfiden sonra
  güncellenmelidir (kullanıcı/ana oturum; bu ADR değiştirmez).
