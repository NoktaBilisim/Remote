# ADR-0018 — Prod TURN aynı sunucuda: 3478 + 5349 TLS (443 yok), Let's Encrypt sertifikası, risk kabulü
Tarih: 2026-11-14 · Durum: Kabul · İlgili: ADR-0007 (r6 ile kısmen bunun yerine geçer), ADR-0015, ADR-0019, AC-21, AC-22, AC-23,
R4, K3, `docs/mimari-p13.md` §7.4, runbook §9

## Bağlam
ADR-0007 prod için ayrı VM ve ayrı genel IP'de `tls-listening-port=443` öngörüyordu. Gerekçe R4'tü: kurumsal ağların bir kısmı
yalnız 443/TCP çıkışına izin verir. Kullanıcı 2026-11-14'te K3'ü kapattı: **prod aynı sunucuda (185.126.217.99, VM 192.168.25.10)
çalışacak, ayrı IP yok.** Bu IP'de 80/443'ü host nginx tutuyor ve başka siteler de orada yayında (ADR-0015). Alan adı (K1)
`remote.noktabilisim.net` olarak belirlendi. Staging TURN-TLS sertifikası özel CA'dan geldiği için müşteri makinesine kök kurulmadan
yalnız-TLS yolu çalışmıyordu (TEST-NAT-1).

## Karar
1. **Portlar (prod = bugünkü staging düzeni):** 3478/UDP+TCP (STUN, TURN), 5349/TCP (TURN-TLS), relay **49160–49479/UDP**
   (320 port, 1:1 NAT, kaynak adres korunur). 443 kullanılmaz. coturn `network_mode: host` ve host OUTPUT kuralı (ADR-0007 r5 m.4)
   aynen kalır.
2. **Kapasite (S4: 50 eşzamanlı oturum):** Tarayıcı her TURN URL'si için ayrı allocation açar, bu yüzden oturum başına en çok 6
   allocation gerekir. 50 × 6 = 300 eder; `total-quota=300` olur, 20 port boşta kalır. `user-quota=8` değişmez. Paylaşımlı sunucunun
   diğer sitelerini korumak için toplam relay tavanı 500 Mbit/s'dir; coturn `bps-capacity` allocation başına bant rezerve ettiği için (62 allocation'da 486, G-P13b-1 ölçümü) `TURN_BPS_CAPACITY=0` kalır ve tavan host'ta `host-firewall.sh` hashlimit kurallarıyla (`TURN_FW_RELAY_MAX_BPS=62500000` bayt/sn) uygulanır (r2, 2026-11-14).
   Oturum tavanı AC-21'deki 8 Mbit/s'tir. coturn `max-bps` bayt/sn cinsinden olduğundan karşılığı `TURN_MAX_BPS=1000000`'dir.
   Bugünkü `8000000` değeri 64 Mbit/s eder. devops bunu ölçerek doğrular (mimari-p13 §7.4).
3. **Ad:** TURN URL'lerinde uygulamanın adı kullanılır (`remote.noktabilisim.net`); yeni DNS kaydı açılmaz. `TURN_REALM` da aynı addır.
   `TURN_URLS=stun:remote.noktabilisim.net:3478,turn:remote.noktabilisim.net:3478?transport=udp,turn:remote.noktabilisim.net:3478?transport=tcp,turns:remote.noktabilisim.net:5349?transport=tcp`.
4. **Sertifika (genel CA):** Let's Encrypt, **ayrı certbot kaydı** `--cert-name remote-turn -d remote.noktabilisim.net`. Kayıt ayrı
   özel anahtar taşır; web sertifikasının anahtarı coturn'e verilmez. Doğrulama HTTP-01 ile, host nginx'teki mevcut
   `remote.noktabilisim.net` vhost'unun 80 bloğundaki `/var/www/remote-acme` webroot'u üzerinden yapılır. nginx'e ve DNS'e
   dokunulmaz. Deploy hook'u (root'a ait kurulu kopya `/usr/local/sbin/remote-turn-cert-deploy`) `fullchain.pem` ve `privkey.pem`'i
   `deploy/turn/certs/turn.{crt,key}`'e atomik olarak kopyalar (sahip 65534, anahtar 0400). Ardından coturn'e `SIGUSR2` gönderir
   (sertifikayı yeniden okur). 5349'dan sunulan sertifikanın parmak izi yeni sertifikayla karşılaştırılır; eşleşmezse
   `restart coturn` yapılır ve journal'a uyarı yazılır. Açık oturumlar ICE restart ile yeniden bağlanır. `gen-cert.sh` (özel CA) yalnız
   yerel ve CI testinde kalır.
5. **AC-23:** Ölçüt, "UDP kapalı, yalnız **5349/TCP** çıkışı açık ağda TURN-TLS ile bağlantı kurulur (prod ölçümü)" olarak revize
   edilir. "Yalnız 443 açık ağ" senaryosu desteklenmez (**risk kabulü**, aşağıda).
6. **Ek IP gelirse geçiş yolu (kod değişikliği yok):** pfSense'te `<yeni IP>:443/TCP → 192.168.25.10:5349` port çevirisi yapılır.
   coturn ve nginx'e dokunulmaz. DNS'te `turn.noktabilisim.net` A kaydı yeni IP'ye yönlendirilir. Bu ad için ikinci bir LE kaydı
   alınır (HTTP-01 için yeni IP'nin 80'i geçici olarak 5349 yerine ACME'ye, ya da DNS-01). `TURN_URLS`'e
   `turns:turn.noktabilisim.net:443?transport=tcp` eklenir (panel ya da `.env`). İstemci yeniden derlenmez, çünkü ICE sunucuları
   sunucudan gelir.

## Risk kabulü (R4)
- **Etki:** Yalnız 443/TCP çıkışına izin veren veya TLS'i 443 dışında engelleyen kurumsal güvenlik duvarlarının arkasındaki müşteride
  P2P kurulamazsa TURN da kurulamaz ve oturum görüntüsüz kalır. Teknisyen başka kanala (telefonla yönlendirme, müşterinin başka ağı)
  geçer.
- **Azaltma:** (a) Kılavuz ve DATASHEET'e "ağ gereksinimleri" eklenir: `remote.noktabilisim.net` için 443/TCP, 3478/UDP+TCP, 5349/TCP
  ve 49160–49479/UDP çıkışı. Kurumsal müşteriye BT allowlist metni verilir. (b) Prod açılışında AC-23 5349 ile ölçülür. (c) Sahadan
  gelen "TURN kurulamadı" vakaları sayılır: `rs_admit_*` ve konsol ICE hatası. Ayda ≥ 3 vaka olursa ek IP talebi yeniden açılır
  (madde 6).
- **Kabul eden:** kullanıcı (K3 kararı, 2026-11-14). Gözden geçirme tarihi: prod açılışından 3 ay sonra.

## Alternatifler
- 443'ü host nginx `stream` + `ssl_preread` (SNI/ALPN) ile coturn'le paylaşmak: Paylaşımlı sunucudaki **tüm** sitelerin 443
  dinleyicisini stream katmanına taşımayı gerektirir. Diğer servislere müdahale riski yüksektir; ADR-0007'deki ret gerekçesi geçerlidir.
- TURN'ü web sertifikasıyla (aynı anahtar) çalıştırmak: Ek certbot kaydı gerekmez, ama coturn ele geçirilirse web TLS anahtarı da
  sızar. Ayrı kayıt maliyetsizdir.
- `turn.noktabilisim.net` adını şimdi açmak: Yeni DNS kaydı ve nginx'te ACME bloğu gerekir. Aynı IP'de kazancı yoktur; ek IP gelince
  açılır (madde 6).
- DNS-01 (Cloudflare API): Sunucuda zone düzenleme yetkili bir token tutmayı gerektirir; HTTP-01 mevcut düzenle çalıştığı için
  reddedildi.

## Sonuçlar
- ADR-0007'nin "ayrı VM, 443, `turn.<domain>`" maddeleri prod için geçersizdir (ADR-0007 r6). HMAC credential, denied-peer-ip,
  host OUTPUT kuralı, IPv6 ve log saklama maddeleri değişmeden geçerlidir.
- TURN'ün kendi IP'si uygulama IP'siyle aynı olduğu için S-P3-2 kuralı (host OUTPUT) prod'da da **kapanış şartıdır**.
- Relay aralığının genişlemesi pfSense, UFW, `host-firewall.sh` (`ip_local_reserved_ports`) ve `test-denied.sh` değişikliği
  gerektirir. Ağ yöneticisi talebi açılış sırasının ilk adımıdır.
- Sertifika yenilemesi nginx vhost'unun 80 bloğuna bağlıdır. vhost kaldırılırsa TURN sertifikası yenilenmez; `remote-watch`
  sertifika kontrolü bu durumu yakalar (mimari-p13 §7.9).
