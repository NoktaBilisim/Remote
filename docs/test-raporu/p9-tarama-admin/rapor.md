# Sayfa Tarama Raporu

Base: http://localhost:3228  Tarih: 2026-11-12T13:55:54.000Z

| Ölçüt | Değer |
|---|---|
| Taranan sayfa | 24 |
| HTTP hatası / açılamayan | 2 |
| Konsol/JS hatası olan sayfa | 2 |
| Erişilebilirlik bulgusu | 3 |
| Mobilde yatay kaydırma | 0 |
| > 3 sn açılan | 0 |

## Sayfalar

| Rota | Durum | Süre | Konsol | JS | 4xx/5xx istek | A11y | Mobil yatay |
|---|---|---|---|---|---|---|---|
| /login | 200 | 640 ms | 0 | 0 | 0 | 0 |  |
| /change-password | 200 | 559 ms | 0 | 0 | 0 | 0 |  |
| / | 200 | 619 ms | 0 | 0 | 0 | 0 |  |
| /sessions | 200 | 618 ms | 0 | 0 | 0 | 0 |  |
| /requests | 200 | 625 ms | 0 | 0 | 0 | 0 |  |
| /customers | 200 | 632 ms | 0 | 0 | 0 | 0 |  |
| /history | 200 | 617 ms | 0 | 0 | 0 | 0 |  |
| /settings/support-requests | 200 | 613 ms | 0 | 0 | 0 | 2 |  |
| /users | 200 | 626 ms | 0 | 0 | 0 | 0 |  |
| /users?status=passive | 200 | 624 ms | 0 | 0 | 0 | 0 |  |
| /users?role=ADMIN | 200 | 623 ms | 0 | 0 | 0 | 0 |  |
| /users/01M780K15Q61T2G0VASPHS215X | 200 | 623 ms | 0 | 0 | 0 | 0 |  |
| /users/01M780K158DPZEQZP6G8RY58S7 | 200 | 626 ms | 0 | 0 | 0 | 0 |  |
| /users/00000000000000000000000000 | 200 | 629 ms | 0 | 0 | 0 | 1 |  |
| /admin/tenants | 200 | 611 ms | 0 | 0 | 0 | 0 |  |
| /settings/tenant | 404 | 588 ms | 1 | 0 | 1 | 0 |  |
| /yok-boyle-sayfa | 404 | 590 ms | 1 | 0 | 1 | 0 |  |
| /requests?tab=history | 200 | 626 ms | 0 | 0 | 0 | 0 |  |
| /customers/01M780K0K4QJ00SJ2ZQKKXWX75 | 200 | 622 ms | 0 | 0 | 0 | 0 |  |
| /requests?tab=history&status=ACCEPTED | 200 | 618 ms | 0 | 0 | 0 | 0 |  |
| /requests?tab=history&status=CANCELLED | 200 | 620 ms | 0 | 0 | 0 | 0 |  |
| /requests?tab=history&status=EXPIRED | 200 | 621 ms | 0 | 0 | 0 | 0 |  |
| /requests?tab=history&status=REJECTED | 200 | 613 ms | 0 | 0 | 0 | 0 |  |
| /requests?tab=history&status=CONNECT_FAILED | 200 | 621 ms | 0 | 0 | 0 | 0 |  |

## Kırık linkler

| Rota | Durum | Bulunduğu sayfa |
|---|---|---|
| /settings/tenant | 404 | (başlangıç listesi) |
| /yok-boyle-sayfa | 404 | (başlangıç listesi) |

## Detaylar

### /settings/support-requests  (200, Destek talepleri ayarları · Nokta Uzaktan Destek)
- A11y: erişilebilir adı olmayan buton: <button id="_R_7aaav5ubtdivb_" type="button" role="switch" aria-checked="false" aria-labelledby="_R_
- A11y: erişilebilir adı olmayan buton: <button id="_R_vaaav5ubtdivb_" type="button" role="switch" aria-checked="false" aria-labelledby="_R_

### /users/00000000000000000000000000  (200, Kullanıcılar · Nokta Uzaktan Destek)
- A11y: sayfada h1 yok

### /settings/tenant  (404, Sayfa bulunamadı · Nokta Uzaktan Destek)
- Konsol: [error] Failed to load resource: the server responded with a status of 404 (Not Found)
- İstek: 404 GET http://localhost:3228/settings/tenant

### /yok-boyle-sayfa  (404, Sayfa bulunamadı · Nokta Uzaktan Destek)
- Konsol: [error] Failed to load resource: the server responded with a status of 404 (Not Found)
- İstek: 404 GET http://localhost:3228/yok-boyle-sayfa