# ADR-0029 — Lobi göstergesi: bellekten okunan REST yoklaması (10 sn), `/ws/panel` genişletilmez

Tarih: 2026-11-15 · Durum: Kabul · Paket: P13b-L · Ayrıntı: `docs/mimari-lobi.md`

## Bağlam
Müşteri bekleme odasına girdiğinde teknisyen panelin her sayfasında en geç 10 sn içinde bunu görmeli
(AC-304..316). Lobi durumu tek server instance'ının belleğinde (`signaling/rooms.ts`, ADR-0005). Panelde bugün
anlık kanal olarak yalnız `/ws/panel` var. Bu kanal `support_requests.view` yetkisi ve tenant bağlamı ister
(mimari-protokol §5.3), tenant geneline yayın yapar (`queue.count`). AC-306 ise göstergenin yalnız
`sessions.view` ile çalışmasını ve **kullanıcıya özel** olmasını şart koşar (V-L2: yalnız kendi oturumları).

## Karar
1. Panel geneli (menü sayacı, toast, sekme başlığı): **`GET /api/v1/sessions/waiting`**. Hafif bir uç, yalnız
   bellekteki `Rooms`'u okur, DB'ye gitmez. İstemci panel kabuğundaki tek bir bileşenden (`LobbyNotifier`)
   10 sn'de bir yoklar. Sekme gizliyken de yoklar, çünkü sekme başlığı (AC-308) bu durumda gerekir.
2. Oturum listesi rozeti: mevcut `GET /sessions` yanıtına **`waitingGuests: number`** alanı eklenir. Liste
   zaten 10 sn'de bir yenilenir. ADMIN ve firma seçmemiş Super Admin de bu alanı yalnız listede görebildiği
   satırlar için alır.
3. `/ws/panel`'in kuralları, mesajları ve yetkisi değişmez.

## Alternatifler
| Seçenek | Neden seçilmedi |
|---|---|
| `/ws/panel`'i `sessions.view` ile açıp kullanıcıya özel `lobby.count` mesajı eklemek | Upgrade yetki kuralı değişir (artık iki ayrı yetkiden biri yeter). Hub'a kullanıcı bazlı yönlendirme eklenir, bugün yalnız tenant yayını var. `rooms` ile hub arasında yeni bir bağımlılık oluşur. Yetki PATCH'inde kapatma ve yeniden doğrulama kuralları iki yetkiye göre yeniden yazılır. Gecikme ~3 sn'ye iner, ama AC 10 sn'ye izin veriyor (V-L1). Güvenlik yüzeyi ve kod miktarı, kazanılan 7 sn'ye değmez |
| Ayrı `/ws/lobby` soketi | Sekme başına ikinci bir kalıcı soket açılır. Upgrade doğrulaması, 60 sn yeniden doğrulama ve 4401/4429 mantığı ikinci kez yazılır (ortak altyapı kopyalanmaz kuralı, CLAUDE.md) |
| Panel kabuğundan `GET /sessions?pageSize=100` yoklaması | Sayfalı DB sorgusudur (join + count). Her sayfada, her sekmede 10 sn'de bir çalışır. ADMIN'de başkalarının satırları da gelir; "yalnız kendi" süzmesi istemciye kalır (AC-309 arka uçta uygulanmalı) |
| SSE (`text/event-stream`) | Projede yok. Ters vekillerde (host nginx + Caddy) tampon ayarı ve yeni bir taşıma biçimi gerekir. Tek kullanım için yeni teknoloji eklenmez |

## Sonuçlar
- Olumlu: Yeni yetki, tablo, migration ya da soket yok. Uç bellekten O(oda sayısı) okur. Tenant ve sahiplik
  süzmesi sunucuda tek fonksiyondadır. Sunucu yeniden başlarsa hayalet rozet kalmaz (AC-315).
- Olumsuz: Gecikme en çok ~10 sn (R-L2, kabul edildi). Arka planda 5 dakikadan uzun gizli kalan sekmede
  Chromium zamanlayıcıları dakikada bire indirebilir. Bu durumda sekme başlığı en geç ~60 sn içinde güncellenir;
  sekme görünür olunca hemen yoklanır (mimari-lobi §9 R-L6). Her sekme ayrı yoklar ve ayrı toast gösterir (R-L4).
- Tek instance varsayımı (ADR-0005) bu uca da uygulanır. Çok instance'a geçişte paylaşımlı lobi durumu ön koşuldur (R-L1).
- **Genişleme noktası:** 10 sn yetmezse sunucuda `Rooms.attachGuest`/`leaveLobby`, `onLobbyChange(tenantId,
  technicianId)` kancasını çağırır. Hub bunu o kullanıcının soketlerine `lobby.count` olarak iletir. İstemcide
  depo (`setLobby`) kaynaktan bağımsızdır, yalnız veri kaynağı eklenir. Bu adım `/ws/panel` yetki kuralı
  değişikliği gerektirdiği için ayrı bir ADR ister.
