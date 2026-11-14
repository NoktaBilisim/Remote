# ADR-0028 — Gözetimsiz erişim: onaysız tam erişim ve bağlayıcı telafi kontrolleri (S24)
Tarih: 2026-11-14 · Durum: Kabul (çerçeve; P27 tasarım + güvenlik tehdit modeli turu zorunlu) · İlgili: AC-273..275, AC-293..297, R25, R30, R32, ADR-0022

## Bağlam
S24: kayıtlı cihaza yerel onay olmadan tam erişim. Ele geçirilmiş teknisyen hesabı yetkili cihazlara doğrudan erişir (R32, kullanıcı kabulü).
Kontrollerin hiçbiri yalnız arayüzde olamaz; cihaz tarafındaki yerel anahtar sunucudan değiştirilemez olmalı.

## Karar
- Ayrı imzalanabilir ikili (LocalSystem servis + oturum içi yardımcı), kalıcı `wss /ws/device`, cihaz Ed25519 anahtarı (DPAPI makine), tek kullanımlık kayıt kodu.
- Bağlantı ön koşulları sunucuda, sırayla: tenant aktif → `unattended.connect` → cihaz grant'i (yoksa 404) → step-up (tüketilir) → yerel anahtar açık →
  müşteride bildirim adresi → prod'da imzalı ikili listesi. Biri başarısızsa bağlantı yok.
- Cihaz tarafı: gösterge çizilmeden görüntü/girdi kanalı açılmaz (fail-closed); yerel anahtarı değiştiren protokol mesajı yoktur; olay günlüğü yazılır.
- İptal ≤ 10 sn, grant geri alma ≤ 5 sn: oda `applyPermChange` kalıbı ile açık bağlantı kesilir.
- Gözetimsiz oturum `support_sessions.mode=UNATTENDED` olarak sayılır (ADR-0027).

## Alternatifler
- Yerel onay penceresi: S24 ile reddedildi (kapsam dışı 7). - Ekran karartma: hiçbir fazda yok; gösterge kapatılamaz.

## Sonuçlar
- İmza listesi kontrolü cihaz beyanına dayanır; kimlik doğrulama değil kullanılabilirlik kapısıdır (P27 tehdit modelinde ele alınır).
- SignPath imzası olmadan prod'da özellik kapalı kalır (R30); proje takvimi imzaya bağlıdır.
