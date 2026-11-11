# ADR-0012 — Public müşteri uçlarında Agent için Origin kuralı
Durum: Kabul · Tarih: 2026-11-11 · İlgili: ADR-0006, ADR-0008, G-10, G-20, AC-14, P3 giriş şartı 3

## Bağlam
`POST /public/sessions/resolve` ve `POST /public/sessions/join` bugün `checkOrigin` ile `Origin ∈ ALLOWED_ORIGINS`
ister (`apps/server/src/sessions/routes.ts`). Go istemci (P6) tarayıcı değildir, `Origin` göndermez → bu haliyle 403 alır.
Bu uçlar çerezsizdir; klasik CSRF (kurbanın kimliğiyle işlem) yoktur. Origin'in burada koruduğu tek şey **tarayıcı
kaynaklıdır**: kötü niyetli bir sitenin ziyaretçilerinin tarayıcılarını dağıtık kod deneme (T1 brute-force'u
binlerce IP'ye yayma) ve lobi spam'i için kullanması. Tarayıcı `Origin` başlığını **sahte gönderemez ve kaldıramaz**
(çapraz kökenli POST'ta her zaman gönderir; özel durumlarda `null`). Tarayıcı dışı saldırgan ise her başlığı istediği
gibi yazar; ona karşı koruma hız sınırları (ipKey + prefixKey) ve lobi/admitCode zinciridir (T1), Origin değil.

## Karar
Seçenek B — **Origin yoksa yalnız Agent, Origin varsa yalnız izinli tarayıcı** (WS `/ws/guest` kuralıyla aynı, mimari-protokol §1):
1. Tek guard: `checkPublicClient(req, kind)` (`apps/server/src/auth/guards.ts`; `checkOrigin` yanında, kopyalanmaz).
   - `Origin` başlığı **var** → `ALLOWED_ORIGINS` içinde olmalı **ve** `kind === "BROWSER"`; değilse 403 `CSRF_INVALID`.
   - `Origin` başlığı **yok** → `kind === "AGENT"` olmalı **ve** istekte `Sec-Fetch-Site` / `Sec-Fetch-Mode` başlığı
     bulunmamalı (bunlar yalnız tarayıcıdan gelir; Origin'siz tarayıcı isteğini ayıklar); değilse 403 `CSRF_INVALID`.
   - `User-Agent` hiçbir karara girmez (G-20).
2. `kind` kaynağı: resolve'da gövdedeki `clientKind`; join'de **istemci beyanı değil**, resolve'un ürettiği `joinNonce`
   kaydına bağlanmış `kind` (nonce kind-bağlı). Join gövdesinde `clientKind` alanı yoktur. Ticket `kind`'ı nonce'tan,
   WS `guestKind`'ı ticket'tan gelir → zincir boyunca tek beyan, değiştirilemez.
3. Hız sınırları ve audit `clientKind`'dan bağımsızdır (Agent ayrı bütçe almaz; aynı ipKey/prefixKey kovaları).
4. Uygulanan uçlar: `POST /public/sessions/resolve`, `POST /public/sessions/join`. GET uçları (`status`, `agent/download`,
   branding, logo) Origin istemez (durum değiştirmez).

## Alternatifler
- **A. Sabit, belgelenmiş Origin değeri** (ör. `Origin: app://nokta-destek`), `ALLOWED_ORIGINS`'e eklenir. Reddedildi:
  değer açık kaynak repoda ve binary'de; tarayıcı dışı herkes gönderebilir → güvenlik katkısı sıfır. Üstelik
  `ALLOWED_ORIGINS` oturumlu uçların CSRF kontrolünde de kullanıldığından sihirli değer o yüzeye de yayılır.
  Tarayıcı bu değeri üretemediği için B ile eşdeğer korur ama daha fazla hareketli parça taşır.
- **C. Public uçlarda Origin kontrolünü tamamen kaldırmak.** Reddedildi: dağıtık tarayıcı tabanlı deneme vektörü açılır.
- **D. Agent'a ayrı uç (`/public/agent/resolve`).** Reddedildi: aynı iş kuralı iki uçta; B tek guard ile çözer.

## Sonuçlar
- Kötü niyetli site ziyaretçi tarayıcısıyla resolve/join yapamaz (Origin var ama izinsiz → 403); `clientKind=AGENT`
  beyanı tarayıcıda işe yaramaz (Origin var → yalnız BROWSER). Tarayıcı dışı saldırganın Agent beyanı ona ekstra
  yetki vermez: kontrol izni istemcideki kapıdadır (ADR-0009), kabul teknisyen admitCode'undadır (ADR-0006, T1).
- Testler (P3 entegrasyon): {Origin izinli, yok, izinsiz, `null`} × {BROWSER, AGENT} × {Sec-Fetch var/yok} matrisi;
  BROWSER nonce'u ile Origin'siz join → 403; AGENT nonce'u ile Origin'li join → 403.
- Mimari: tehdit T27 (§5.2), mimari-api ortak kurallar + public tablo, mimari-protokol §1 ile tutarlı.
