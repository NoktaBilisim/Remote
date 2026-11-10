# Test Raporu — Tur 1 (P2: Destek oturumu oluşturma / müşteri karşılama)
DURUM: GEÇTİ
Ortam: gerçek yığın (`deploy/docker-compose.yml`: caddy + web + server + migrate + mysql 8.4.13), Caddy `https://localhost:4450` (tls internal), NODE_ENV=production, commit `89dccc4`, 2026-11-11.
Veri: seed (Super Admin + demo tenant, `NODE_ENV=development` ile), SQL ile demo tenant'a ADMIN "Ayşe Yılmaz" ve USER "Mehmet Öztürk" (utf8mb4 doğrulandı: `C59F`/`C3B6`; argon2id hash server konteynerindeki `argon2` ile; USER'a `sessions.view/create/delete` verildi). Sahte `.env` scratchpad'de üretildi, test sonunda silindi; `docker compose down -v` yapıldı.
Betik: `/private/tmp/claude-501/-Users-mennan--claude-spares-spare-XfEfpU/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/p2.mjs` (Playwright 1.65 + axe-core 4.14, Chromium). Ekran görüntüleri aynı klasörde `p2-test-*.png` (47 dosya).

## Özet
| Ölçüt | Sonuç |
|---|---|
| Taranan sayfa/durum | 13 (login, change-password, /sessions ADMIN boş+dolu, /sessions USER boş+dolu, müşteri geçerli / iptal / süresi dolmuş / geçersiz / biçimsiz, bilinmeyen rota oturumsuz+oturumlu) + yeni oturum diyaloğu + 409 diyaloğu |
| Konsol hatası (beklenmeyen) | 0. Yalnız tasarım gereği HTTP 404 dönen sayfalarda tarayıcının "Failed to load resource: 404" satırı; akışlarda beklenen 409/401 satırları |
| 4xx/5xx | 5xx yok. 404: geçersiz/biçimsiz müşteri token'ı, oturumlu bilinmeyen rota (beklenen) |
| Kırık asset/görsel | 0 |
| axe (WCAG 2.1 AA) açık + koyu | 0 ihlal (13 sayfa + açık diyalog) |
| 375 px yatay taşma | 0 (tüm sayfalar + diyalog) |
| Sunucu/web log hatası | 0; Caddy logunda `/session/<token>`, Cookie, ticket: 0 (G-10) |

## Bulgular
### [DÜŞÜK] TO-P2-1 409 uyarısında başlık ve mesaj aynı cümleyi tekrarlıyor
Sayfa/akış: /sessions → Yeni destek oturumu (açık oturum sınırında). Adımlar: 1. ADMIN ile 3 PENDING oturum aç. 2. "Yeni destek oturumu"na bas.
Beklenen: başlık + tek açıklama. Gerçekleşen: "Açık oturum sınırına ulaştınız" başlığı, ardından sunucu mesajı yine "Açık oturum sınırına ulaştınız. Yeni oturum için…", sonra yönlendirme cümlesi (aynı cümle iki kez). Kanıt: `p2-test-limit-409.png`, `limit-error` metni.
Atanan: frontend-dev (sunucu mesajı başlıkla aynıysa başlığı veya mesajın ilk cümlesini göstermeyin) — alternatif backend-dev mesaj metni.

### [DÜŞÜK] TO-P2-2 Diyalogdaki iki "Kopyala" düğmesi farklı görünümde
Sayfa: yeni oturum diyaloğu (açık/koyu, masaüstü/375). Adımlar: 1. Yeni destek oturumu aç.
Beklenen: aynı işlevli düğmeler aynı varyant. Gerçekleşen: link "Kopyala" kenarlıklı (secondary), oturum kodu "Kopyala" kenarlıksız (ghost); mobilde kod düğmesi metin gibi duruyor. Kanıt: `p2-test-new-session-dialog-dark.png`, `p2-test-new-session-dialog-375.png`.
Atanan: frontend-dev (DESIGN.md'ye göre tek varyant).

### [DÜŞÜK] TO-P2-3 375 px'te üst menüde kullanıcı adı/rol/firma görünmüyor
Sayfa: /sessions (ADMIN ve USER), mobil. Adımlar: 1. 375 px genişlikte giriş yap.
Beklenen: hangi hesapla/firmada olunduğu mobilde de anlaşılır (en az avatar/baş harf). Gerçekleşen: yalnız logo ve çıkış ikonu var. Kanıt: `p2-test-sessions-user-list-375.png`.
Atanan: frontend-dev (P12 avatar ile birlikte ele alınabilir).

Not (bulgu değil): Audit `ip_address` tüm kayıtlarda `172.30.0.128` (Docker Desktop/macOS ağ geçidi; userland proxy istemci IP'sini gizliyor). `session.resolve` kaydında da web adresi (.3) değil Caddy'nin gördüğü adres yazılıyor → S-P2-1 zinciri çalışıyor. Gerçek istemci IP'si Linux staging'de (185.126.217.99:4450) doğrulanmalı — devops.
Not: Oturumsuz bilinmeyen rota `/login?next=…`'e gider (proxy tasarımı); oturumluyken HTTP 404 + "Sayfa bulunamadı".

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Oturumsuz /sessions → login | ✅ | `/login?next=%2Fsessions` |
| Hatalı parola | ✅ | "E-posta/kullanıcı adı veya şifre hatalı.", login'de kalır |
| ADMIN giriş → yeni oturum | ✅ | link, 8 haneli kod (`#### ####`), 4 haneli doğrulama kodu, geri sayım + bitiş saati |
| Linki / kodu kopyala | ✅ | pano içeriği = link / kod |
| Müşteri sekmesi (çerezsiz) linki açar | ✅ | teknisyen "Ayşe Yılmaz" (Türkçe karakter doğru), doğrulama kodu panelle aynı, dolandırıcılık uyarısı |
| Panelden (satırdan) iptal → müşteri iptal ekranı | ✅ | 1,3–1,8 sn (≤ 5 sn) |
| Süresi dolmuş link (created/expires 30 dk geri alındı) | ✅ | "Bu destek bağlantısının süresi doldu", DB durumu EXPIRED |
| Geçersiz (43 karakter) / biçimsiz token | ✅ | HTTP 404, "Bağlantı geçersiz" |
| Açık oturum sınırı (3) → 409 | ✅ | uyarı + "listeden iptal ederek yer açın" (metin tekrarı TO-P2-1) |
| USER yalnız kendi oturumunu görür | ✅ | 1 satır, Teknisyen sütunu yok; `GET /api/v1/sessions/<ADMIN oturumu>` → 404; liste yanıtında ADMIN oturumu yok |
| ADMIN tenant geneli + Teknisyen sütunu | ✅ | USER'ın oturumu "Mehmet Öztürk" ile listede |
| Çerez silinip diyalog açılınca | ✅ | 401 → `/login?reason=expired`, "Oturumunuz sona erdi. Lütfen tekrar giriş yapın." |
| Çıkış → /login, sonra korumalı URL | ✅ | `/login?reason=logout` → `/login?next=%2Fsessions` |

## Kabul kriterleri (uçtan uca, P2 UI kısmı)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-1 / AC-3 / AC-9 oturum oluştur, link + kod + doğrulama kodu, kopyala | ✅ | gerçek API, pano okuma |
| AC-4 TTL / geri sayım | ✅ | diyalogda "15:00 kaldı (hh:mm'de sona erer)", listede kalan süre |
| AC-5 / AC-7 müşteri sayfası + süresi dolmuş ekranı | ✅ | geçerli + EXPIRED token |
| AC-8 iptal → müşteri ≤ 5 sn | ✅ | iki bağlamda gerçek yoklama |
| AC-11 açık oturum sınırı 409 | ✅ | 4. oturumda uyarı |
| AC-61 yönetici görünümü / USER yalıtımı | ✅ | UI + API 404 |
| AC-12 saatlik limit 429 | — | gerçek yığında denenmedi (15 oturum/saat sınırına ulaşılmadı); frontend e2e mock'ta kapsanıyor |

## Görsel gözlemler (ekran görüntülerinden)
- Liste (masaüstü, `p2-test-sessions-admin-list-light.png`): rozet, mono kod, geri sayım, ikon düğmeler hizalı; boş alan yok.
- Mobil liste (`p2-test-sessions-user-list-375.png`): tablo yerine kart, taşma yok; üst menüde kimlik bilgisi yok (TO-P2-3).
- Diyalog koyu tema (`p2-test-new-session-dialog-dark.png`): kontrast iyi; Kopyala varyant farkı (TO-P2-2). Mobil diyalogda "Kapat" altta, kaydırma gerektirmeden görünüyor.
- Müşteri sayfası 375 px (`p2-test-guest-valid-375.png`): logo açık kart içinde, teknisyen kartı + sarı uyarı okunaklı.
- Süresi dolmuş, koyu (`p2-test-guest-expired-dark.png`): logo açık zeminde (koyu tema kuralı uygulanmış), metin okunaklı.
- `p2-test-limit-409.png` diyalog yarı saydam görünüyor: görüntü açılış geçişi sırasında alındı (opacity animasyonu), hata sayılmadı.
