# ADR-0021 — P13c ayrı staging: parametreleştirme, yalnız STUN, staging istemci artifact

Tarih: 2026-11-14 · Durum: Kabul · İlgili: ADR-0019 m.5, ADR-0018, `docs/mimari-e11.md` §3

## Bağlam

ADR-0019 prod'u staging'in yerinde terfisiyle açtı; ayrı staging P13c'ye bırakıldı ve E11 kod paketlerinin ön koşulu oldu. Compose ve Caddy'de
sabit alt ağ/IP/port, betiklerde sabit konteyner adı var. Sunucu tek, paylaşımlı; ayrı IP yok (K3).

## Karar

1. Compose/Caddy değerleri env ile parametreleşir; **varsayılanlar bugünkü prod değerleridir** (prod `.env` değişmez, `compose config` farkı 0).
2. Staging: proje `remote-stg`, `/opt/remote-stg`, `stg.remote.noktabilisim.net` (nginx vhost + LE), 127.0.0.1:4460/4461, edge 172.30.1.0/24,
   ayrı DB/volume/sır/age anahtarı/yedek dizini, `DEPLOY_ENV=staging`. Prod ile hiçbir sır ortak değildir.
3. TURN: staging yalnız prod coturn **STUN**'unu kullanır (kimliksiz). Relay testleri prod'da "Nokta Test" firmasında.
4. Staging Windows istemcisi `workflow_dispatch` ile ayrı sunucu adresiyle derlenir; Release'e yayımlanmaz.
5. Betiklerde konteyner adı `${COMPOSE_PROJECT_NAME}` ile türetilir; manifestteki `DEPLOY_ENV` karşılaştırması ortamlar arası geri yüklemeyi engeller.

## Alternatifler

- Ayrı VM: K3 ile yok. - Staging'e ayrı coturn: aynı portlar çakışır, ek IP yok; reddedildi. - Staging'i prod verisinin kopyasıyla çalıştırmak: KVKK; reddedildi.

## Sonuçlar

- Sunucuda RAM/disk yükü artar; P13c kabulünde ölçülür (disk < %80). Relay yolu staging'de test edilemez (bilinen sınır).
- Paket akışındaki staging adımı yeniden gerçek ortamda yapılır; yerel e2e kalıbı yedek olarak kalır.
