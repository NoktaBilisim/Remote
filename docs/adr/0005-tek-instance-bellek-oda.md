# ADR-0005 — Tek instance, oda durumu bellekte
Durum: Kabul · Tarih: 2026-11-10
## Bağlam
Hedef 50 eşzamanlı oturum (≈100 WS). Redis/çoklu instance operasyon yükü getirir.
## Karar
Oda, join nonce, ws ticket, kontrol durumu `signaling/rooms.ts` içinde bellek (Map). Kalıcı olay (durum, consent, file meta, quality) DB'ye anında yazılır. Açılışta `ACTIVE` kalmış oturumlar `ENDED(SERVER_RESTART)`.
## Alternatifler
Redis pub/sub + sticky session (gerek yok); DB'de oda durumu (her mesajda DB, gecikme).
## Sonuçlar
Sunucu yeniden başlatması aktif oturumları düşürür (deploy bakım penceresinde). Genişleme noktası: `rooms.ts` dışa yalnız `RoomRegistry` fonksiyonlarını açar; çoklu instance gerekirse Redis adaptörü bu dosyanın arkasına eklenir.
