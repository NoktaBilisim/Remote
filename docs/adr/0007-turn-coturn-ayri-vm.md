# ADR-0007 — coturn ayrı VM/public IP, TURN-TLS 443, HMAC kısa ömürlü credential
Durum: Kabul, r2 (G-05, G-13, K3) · Tarih: 2026-11-10
## Bağlam
Kurumsal ağlarda çoğu zaman yalnız 443/TCP açık (R4); publish sunucusunda 443 dolu.
## Karar
- coturn ayrı VM, ayrı public IP: `listening-port=3478` (UDP/TCP), `tls-listening-port=443`, `min-port=49160 max-port=49200` (UDP relay), `fingerprint`, `use-auth-secret`, `static-auth-secret=<TURN_SECRET>`, `realm=<domain>`, `no-cli`, `no-multicast-peers`, `no-loopback-peers`, `no-tcp-relay`, `user-quota=4`, `total-quota=200`, `max-bps=8000000`, `bps-capacity=<K3>`, `prometheus`.
- `denied-peer-ip` iki katman (G-05): (a) **sabit liste** `turnserver.base.conf` (repo): 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, 255.255.255.255, ::/128, ::1, ::ffff:0:0/96, 64:ff9b::/96, 100::/64, 2001::/32, 2001:db8::/32, 2002::/16, fc00::/7, fe80::/10, ff00::/8; (b) **ortam listesi** `denied-peer-ip.local.conf` (git-ignore; public repoya altyapı IP'si yazılmaz): publish sunucusu 185.126.217.99, sağlayıcı bloğu 185.126.217.0/24, Proxmox yönetim IP'si, TURN'ün kendi IP'si. `entrypoint.sh` ikisini birleştirir (coturn sürümü CIDR kabul etmiyorsa satırlar `a-b` aralık biçiminde yazılır). TURN'ün kendi relay IP'si relay↔relay için `allowed-peer-ip` ile açılır. Doğrulama `test-denied.sh` (`turnutils_uclient`, her satıra negatif deneme).
- Credential (server `signaling/turn.ts`): `username = <unixExpiry>:<sessionId>`, `credential = base64(HMAC-SHA1(secret, username))`, `expiry = min(now + kalan oturum süresi, now + 60 dk)` (G-13, AC-21). İstemciye yalnız bu çift ve **yalnız admit sonrası** gider (G-01). Bitişten 5 dk önce sunucu `ice.servers` gönderir, teknisyen ICE restart yapar (mevcut yeniden bağlanma yolu; yeni mekanizma yok). Alarm: `turn_allocations > 2×active_sessions+10`.
- ICE sunucu sırası: `stun:turn:3478`, `turn:...:3478?transport=udp`, `turn:...:3478?transport=tcp`, `turns:turn.<domain>:443?transport=tcp`.
- Sertifika: TURN VM'de Let's Encrypt (`turn.<domain>`), yenileme sonrası coturn reload (runbook).
- Ortamlar (K3): dev/staging'de coturn publish sunucusunda (185.126.217.99) farklı portlarda; prod öncesi ayrı IP + 443 kararı. Staging'de TURN = uygulama IP'si olduğundan host güvenlik duvarı yalnız 22/4450/TURN portlarını açar (mimari §8.3).
## Alternatifler
443'ü SNI ile paylaşma (publish sunucusundaki mevcut servise müdahale; reddedildi); yalnız 5349 (kurumsal ağlarda kapalı); Pion TURN gömülü (coturn daha olgun).
## Sonuçlar
Ek VM maliyeti; relay bant genişliği TURN VM'de (R7, K3). Secret rotasyonu çift secret ile kesintisiz.
