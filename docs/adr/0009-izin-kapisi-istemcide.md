# ADR-0009 — Uzaktan kontrol izni istemci tarafında; kontrol sinyali WS, girdi DataChannel
Durum: Kabul · Tarih: 2026-11-10
## Bağlam
Girdi P2P DataChannel'dan akar; sunucu engelleyemez (NFR). Aynı zamanda izin olaylarının audit'i (AC-111) ve yetki kontrolü (AC-51) sunucu ister.
## Karar
- `control.request` ve `control.state` **WS** üzerinden: sunucu yetki/mod kontrolü yapar, consent + audit yazar, karşı tarafa iletir.
- Girdi olayları `input` **DataChannel**'ından; Go istemcide `gate` atomik bayrağı her `SendInput` öncesi kontrol edilir. Kapıyı yalnız yerel, enjekte olmayan kullanıcı eylemi açar; WS/DC mesajları açamaz.
- Kapanma tetikleyicileri: buton, Ctrl+Shift+F12, oturum sonu, kopma/yeniden bağlanma. Kapanma önce yerelde uygulanır, sonra bildirilir (bildirim başarısız olsa da kapı kapalı).
- Tarayıcı modunda `input` kanalı yok; sunucu `control.request`'i reddeder.
- r2 (G-03, G-04, G-09, G-15, G-21): izin diyaloğunda odak "Reddet", Enter/Space etkisiz, 1,5 sn gecikme, imleç altında açılmaz; sunucu ret sonrası 30 sn + oturumda ≤ 5 istek; `control.revoke` (yetki kaldırma / audit yazılamadı) kapıyı yalnız **kapatabilir**, açamaz; `caps` dışı DC istekleri reddedilir, `control.*` DC'de yoktur; kısayol alınamazsa yedek kısayol, o da yoksa kontrol verilemez.
## Alternatifler
Girdiyi sunucu üzerinden geçirmek (gecikme, sunucunun girdiyi görmesi — gizlilik); izni yalnız sunucuda tutmak (P2P'de atlanabilir).
## Sonuçlar
Güvenlik, istemci kodunun doğruluğuna bağlı → AC-101 testi zorunlu, gate paketi küçük ve %100 birim test kapsamlı.
