# ADR-0015 — Alan adı: host nginx TLS sonlandırır, Caddy'ye loopback HTTP (4451)

Durum: Kabul · Tarih: 2026-11-12 · İlgili: ADR-0002 (tek TLS girişi), G-10 (log), G-11 (istemci IP), runbook §8.3

## Bağlam

Staging `https://remote.noktabilisim.net` (portsuz, Let's Encrypt) üzerinden yayınlanacak. 80/443'ü paylaşımlı
sunucunun host nginx'i tutuyor (başka siteler, certbot). Caddy 443'ü alamaz; ACME HTTP-01/TLS-ALPN Caddy'ye ulaşamaz.
Mevcut IP girişi `https://185.126.217.99:4450` (`tls internal`) geçiş süresince çalışmaya devam etmeli.

## Karar

- nginx (yalnız yeni vhost `remote.noktabilisim.net`) TLS'i sonlandırır; sertifika `certbot certonly --webroot`
  (`/var/www/remote-acme`, deploy hook `nginx -t && systemctl reload nginx`). Diğer vhost'lara dokunulmaz.
- nginx → `http://127.0.0.1:4451`. Caddy'de ikinci site `http://:4451`; compose bu portu **yalnız** `127.0.0.1`'e yayımlar.
  Yönlendirme, ops uçlarının kapatılması, gövde sınırları, log filtresi, güvenlik başlıkları tek yerde kalır
  (snippet `remote_app`, iki site de import eder). nginx CSP/HSTS eklemez (uygulama/Caddy üretir).
  Neden 4450'ye `proxy_ssl_verify off` değil: iç CA'ya güvensiz hop + Caddy 4450 sitesi `SITE_HOST` (IP) ile
  eşleşir; alan adı Host'u için ikinci TLS sitesi ve iç CA'yı nginx'e taşımak gerekirdi.
- İstemci IP (G-11): nginx `X-Forwarded-For $remote_addr` ile istemcinin gönderdiğini **ezer**. Caddy 4451 dinleyicisinde
  `trusted_proxies static 172.30.0.128/32` (remote_edge ağ geçidi; host→published port userland-proxy üzerinden bu
  adresten gelir) + `trusted_proxies_strict`. Tüm `reverse_proxy` bloklarında `header_up X-Forwarded-For {client_ip}`
  → server/web tek değer görür; server `TRUSTED_PROXY_CIDR=172.30.0.2/31` değişmez. 4450'de `trusted_proxies` yok,
  `{client_ip}` = bağlantı adresi (önceki davranış).
- `SITE_HOST` IP olarak kalır (4450 sitesi ve `default_sni`); `PUBLIC_BASE_URL` alan adına geçer, `ALLOWED_ORIGINS`
  geçiş süresince iki origin'i içerir.

## Sonuçlar

- Windows istemci ve tarayıcılar için kök sertifika kurulumu gerekmez (alan adı üzerinden).
- Ağ geçidi değişirse (ağ yeniden yaratılıp farklı geçit alırsa) gerçek IP kaybolur, tüm istemciler geçit adresinden
  görünür (sahtecilik değil, ortak limit). Kontrol runbook §8.3. Cloudflare kaydı "proxied" yapılırsa istemci IP'si
  Cloudflare adresi olur — kayıt "DNS only" kalmalı.
- nginx hata logu `crit` (istek satırı sorgu dizesi içerir, G-10); 502/504 teşhisi erişim logu + Caddy logundan.
