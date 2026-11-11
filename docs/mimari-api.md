# REST API Sözleşmesi — Remote Support
Ana belge: `docs/mimari.md` §4. Şemalar `packages/contracts/src/api/*.ts` içinde zod ile tanımlanır; bu tablo bağlayıcıdır.

## Ortak kurallar
- `sessionRef`: `base64url(HMAC-SHA256(SESSION_REF_KEY, sessionId))` + id; tahmin edilemez, token değildir (tüketim sağlamaz).
- Taban: `/api/v1`. JSON, UTF-8. Kimlik: `__Host-rs_session` çerezi (HttpOnly, Secure, SameSite=Strict, Path=/).
- Origin: durum değiştiren **tüm** isteklerde (POST/PUT/PATCH/DELETE, login ve public uçlar dahil) `Origin` başlığı zorunludur ve `ALLOWED_ORIGINS` (boşsa `PUBLIC_BASE_URL` origin'i) içinde olmalıdır; yoksa/izinsizse 403 `CSRF_INVALID`. **Tek istisna** public `resolve`/`join`: Origin yoksa yalnız `kind=AGENT` kabul edilir (aşağıda "Public istemci türü", ADR-0012).
- CSRF: oturumlu durum değiştiren uçlar ayrıca `X-CSRF-Token` başlığı ister (double-submit: `__Host-rs_csrf` çerezi, SameSite=Strict); eksik/eşleşmiyorsa 403 `CSRF_INVALID`. Login (henüz çerez yok) ve public müşteri uçları (çerezsiz) `X-CSRF-Token` istemez.
- Şifre değişimi zorunluyken (`mustChangePassword=true`) yalnız GET `/auth/me`, POST `/auth/logout`, POST `/auth/password/change` serbesttir; diğer oturumlu uçlar 403 `PASSWORD_CHANGE_REQUIRED`.
- Uç sırası: auth → yetki (`requirePerm`) → tenant kapsamı (`tenantScope`) → zod doğrulama → servis → yanıt.
- Hata gövdesi: `{ "error": { "code": "SESSION_EXPIRED", "message": "<Türkçe, kullanıcıya>", "fields"?: {"ttlMinutes":"15-30 arası olmalı"}, "requestId": "<ulid>" } }`.
- Sayfalama: `?page=1&pageSize=25` (üst 100), yanıt `{ items, page, pageSize, total }`; sıralama `?sort=createdAt:desc` (izinli alan listesi uçta sabit).
- Başka tenant kaydı / yetkisiz sahiplik → **404** (varlığı sızdırmaz; AC-61, AC-69). Yetki anahtarı yok → 403.
- Hata kodu → HTTP (tek kaynak `packages/contracts/src/errors.ts` `ERROR_STATUS`; yeni kod önce oraya eklenir, sonra bu tabloya):

| Kod | HTTP | Anlam | Paket |
|---|---|---|---|
| `VALIDATION` | 400 | zod doğrulama hatası (`fields` dolu) | P1 ✓ |
| `HOST_NOT_ALLOWED` | 400 | SMTP host özel/loopback IP'ye çözümlendi (netguard) | P10 |
| `INVALID_IMAGE` | 400 | Yükleme türü/içeriği geçersiz (magic bytes) | P9 |
| `UNAUTHENTICATED` | 401 | Oturum yok/geçersiz; login'de genel hatalı kimlik mesajı | P1 ✓ |
| `FORBIDDEN` | 403 | Yetki anahtarı yok / ret listesi | P1 ✓ |
| `CSRF_INVALID` | 403 | Origin eksik/izinsiz veya `X-CSRF-Token` eksik/eşleşmiyor | P1 ✓ |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `mustChangePassword=true` iken serbest olmayan uç | P1 ✓ |
| `NOT_FOUND` | 404 | Kayıt yok / başka tenant / sahiplik yok | P1 ✓ |
| `METHOD_NOT_ALLOWED` | 405 | Audit log'a PUT/PATCH/DELETE | P11 |
| `CONFLICT` | 409 | Durum uygun değil (ör. PENDING/ACTIVE değil), tekil alan çakışması (email) | P2 |
| `OPEN_SESSION_LIMIT` | 409 | Teknisyenin açık (PENDING) oturum üst sınırı dolu | P2 |
| `LOBBY_FULL` | 409 | Lobide bekleyen misafir sınırı dolu | P3 |
| `SESSION_EXPIRED` | 410 | Oturum/link/kod süresi dolmuş | P2 |
| `SESSION_CONSUMED` | 410 | Token/kod admit ile tüketilmiş (AC-7) | P2 |
| `SESSION_CANCELLED` | 410 | Oturum iptal edilmiş (AC-8) | P2 |
| `NONCE_INVALID` | 410 | `joinNonce` süresi dolmuş/kullanılmış | P3 |
| `RESET_TOKEN_INVALID` | 410 | Şifre sıfırlama tokenı geçersiz/süresi dolmuş | P10 |
| `PAYLOAD_TOO_LARGE` | 413 | Yükleme > 2 MB | P9 |
| `ACCOUNT_LOCKED` | 423 | Giriş kilidi (hesap+IP veya hesap geneli); `Retry-After` (sn) | P1 ✓ |
| `RATE_LIMITED` | 429 | Hız sınırı; `Retry-After` | P1 ✓ |
| `INTERNAL` | 500 | Beklenmeyen hata (ayrıntı yalnız log, `requestId`) | P1 ✓ |
| `UPSTREAM` | 502 | SMTP/MySQL/dış servis testi başarısız | P10 |
| `NOT_READY` | 503 | `/ready`: DB'ye ulaşılamıyor veya migration uygulanmamış | P1 ✓ |

✓ = `errors.ts`'te mevcut. Diğerleri ilgili paket `errors.ts`'e ekler; 410 için genel `GONE` kodu **kullanılmaz**, nedeni belirten kod döner.

## Yetki anahtarları (`packages/contracts/src/permissions.ts` — tek tanım, AC-72)
| Modül | Anahtar ön eki | Alt yetkiler |
|---|---|---|
| Oturumlar | `sessions` | view, create, edit, delete(iptal), terminate (aktif oturumu zorla sonlandır, G-04) |
| Uzaktan kontrol | `remote_control` | use |
| Dosya transferi | `file_transfer` | use |
| Oturum geçmişi | `session_history` | view, edit(not/ticket), export |
| Kullanıcılar | `users` | view, create, edit, delete |
| Ayarlar | `settings` | view, edit |
| Audit log | `audit` | view, export |
Rol kuralı: SUPER_ADMIN tümü + sistem uçları (rol kontrolü, toggle değil). ADMIN varsayılan tümü açık; USER tümü kapalı (AC-73).

## Auth (`/auth`)
| Uç | Girdi | Çıktı | Hatalar | Yetki / AC |
|---|---|---|---|---|
| POST `/auth/login` | `{ login: string(3..190), password: string(1..200), tenantSlug?: string }` — `login` `@` içeriyorsa **yalnız email**, içermiyorsa **yalnız username** ile aranır | `{ user, mfaRequired: bool, mustChangePassword: bool }` + `__Host-rs_session` + `__Host-rs_csrf` çerezleri | 400 `VALIDATION`, 401 `UNAUTHENTICATED` (genel mesaj; yok/pasif kullanıcı/pasif tenant aynı), 403 `CSRF_INVALID` (Origin), 423 `ACCOUNT_LOCKED` (+`Retry-After`; kilitliyken doğru şifre de 423), 429 `RATE_LIMITED` | Public (Origin zorunlu); IP 20/dk; hesap+IP 15 dk'da 5. hatalı → 423; AC-64, AC-65 |
| POST `/auth/mfa/verify` | `{ code: /^\d{6}$/ \| recoveryCode: string(10..12) }` | `{ user }` | 401, 429 (5/5dk) | Yarı oturum; AC-67 |
| POST `/auth/mfa/setup` · `/auth/mfa/enable` | — · `{ code }` | `{ otpauthUrl, qrDataUrl }` · `{ recoveryCodes: string[10] }` | 400 | Oturumlu |
| POST `/auth/logout` | — (boş gövde kabul) | 204, sunucu oturumu iptal + iki çerez `Max-Age=0` | 401 `UNAUTHENTICATED`, 403 `CSRF_INVALID` — **401/403'te de çerezler temizlenir**; sunucu oturumu yalnız geçerli CSRF ile iptal edilir | Oturum + CSRF; `mustChangePassword` iken serbest; AC-65 |
| POST `/auth/logout-all` | — | 204 (diğer auth_sessions revoked + `rooms.endByTechnician`, G-04) | — | AC-68, 115 |
| POST `/auth/password/change` | `{ current: string(1..200), next: string(12..200) }` (`next` ≠ `current`) | 204 + **yeni oturum** (`__Host-rs_session`) + **yeni CSRF çerezi**; eski oturum ve kullanıcının diğer oturumları iptal | 400 `VALIDATION` (yanlış mevcut şifre dahil), 401 `UNAUTHENTICATED` (oturum yok; ya da aynı oturumda **5 hatalı mevcut şifre → oturum iptal**, yeniden giriş), 403 `CSRF_INVALID` | Oturum + CSRF; `mustChangePassword` iken serbest; AC-66 |
| POST `/auth/password/forgot` | `{ email }` | 202 (her durumda aynı) | 429 | AC-66 |
| POST `/auth/password/reset` | `{ token, next }` | 204 | 410 | AC-66 |
| GET `/auth/me` | — | `{ user, permissions: string[], tenant, actingTenant? }` | 401 | — |
| PATCH `/auth/me` | `{ fullName?, theme? }` | `{ user }` | 400 | AC-85 |

## Destek oturumları (`/sessions`) — teknisyen
| Uç | Girdi | Çıktı | Hatalar | Yetki / AC |
|---|---|---|---|---|
| POST `/sessions` | `{}` | `{ id, link, code (8 hane), techVerifyCode, expiresAt, status }` (link **yalnız bu yanıtta** — düz token DB'de yok, GET `/:id` link döndürmez; `code` PENDING iken GET `/:id`'de de döner, G-22) | 409 `OPEN_SESSION_LIMIT`, 429 (20/sa/teknisyen) | sessions.create; AC-1..4, 11, 12 |
| GET `/sessions?status=&from=&to=&technicianId=&tenantId=&customer=&mode=&page=&pageSize=&sort=` | sorgu (şema: aşağıda "Oturum geçmişi (P8)" §1) | `{ items: SessionListItem[], page, pageSize, total }` + `Cache-Control: no-store` | 400 `VALIDATION`, 403 `FORBIDDEN` | `sessions.view` **veya** `session_history.view` (any-of; konsol listesi ve geçmiş ekranı aynı uç); kapsam §2 (USER yalnız kendi); AC-60, 61 |
| GET `/sessions/:id` | — | `SessionView` (konsol özeti; P2 şekli, değişmez) | 404 | sessions.view; USER yalnız `technician_id = user.id` (G-22); kapsam §2 |
| GET `/sessions/:id/history` | — | `SessionHistoryDetail` (§3: başlangıç/bitiş/süre, müşteri, onay kayıtları, kontrol dönemleri, zaman çizelgesi, kalite, dosyalar, sonlandıran) + `Cache-Control: no-store` | 404 | session_history.view; kapsam §2; AC-61, 62 |
| POST `/sessions/:id/cancel` | — | `{ status: "CANCELLED" }` | 404, 409 (PENDING değil) | sessions.delete; AC-8 |
| POST `/sessions/:id/end` | — | `{ status: "ENDED" }` | 404, 409 | sessions.edit; AC-59 |
| POST `/sessions/:id/terminate` | `{ reason?: string(≤200) }` | `{ status: "ENDED", endedBy: "ADMIN" }` | 404, 409 (ACTIVE değil) | sessions.terminate (ADMIN aynı tenant) / SUPER_ADMIN; `rooms` → `session.ended{admin}`; audit `session.terminated`; AC-114 (G-04) |
| POST `/sessions/:id/email` | `{ to: email }` | `{ sent: true }` | 404, 429 (20/sa/teknisyen, G-23), 502 | sessions.create; AC-10 |
| PATCH `/sessions/:id` | `z.strictObject({ ticketNo?: string \| null, note?: string \| null })` (kurallar §4) | `SessionHistoryDetail` | 400 `VALIDATION`, 404, 403 `CSRF_INVALID` | session_history.edit + Origin + CSRF; kapsam §2 (USER yalnız kendi); audit `session.updated` (§4); AC-61, 63 |
| GET `/sessions/export.csv?<liste filtreleri>` | liste sorgusu (`page`/`pageSize` yok sayılır) | `text/csv; charset=utf-8`, UTF-8 BOM, `;` ayraç, akış (§5) | 400 `VALIDATION` (> 50.000 satır), 403, 429 `RATE_LIMITED` (5/dk/kullanıcı) | session_history.export; kapsam §2; hücreler `lib/csv.ts` ile formül kaçışlı (G-16); audit `session.exported`; AC-61, 63, 124 |
Not: Link plain token'ı DB'de yok (AC-2). PENDING iken tekrar göstermek için token yanıtta tek sefer verilir; konsol sayfası belleğinde tutar. Kaybolursa "Yeni link üret" = iptal + yeni oturum (basit, ADR-0006).

### Oturum geçmişi (P8) — bağlayıcı ayrıntı (mimar, 2026-11-11; AC-60..63, 124)
Şemalar `packages/contracts/src/api/sessions.ts`'e eklenir (P2 tipleri genişletilir, kırılmaz). Enum etiketleri (Türkçe) tek yerde `packages/contracts/src/labels.ts`'te durur; web ve CSV aynı eşlemeyi kullanır. Enum sütunları DB'de ikili CHECK ile kanoniktir (ADR-0014). CHECK'i olmayan `end_reason` ve audit `action` için bilinmeyen değer **ham** gösterilir; boş bırakılmaz, hata atılmaz.

**1. Liste sorgusu** (`listSessionsQuerySchema`, `z.strictObject`; bilinmeyen parametre 400):
| Parametre | Şema | Anlam |
|---|---|---|
| `status` | `enum(SESSION_STATUSES)?` | Tek değer |
| `mode` | `enum(["AGENT","BROWSER"])?` | AC-60 "istemci/tarayıcı". `mode` NULL olan oturumlar (hiç admit edilmemiş) bu filtreyle eşleşmez |
| `from`, `to` | `/^\d{4}-\d{2}-\d{2}$/?`, geçerli takvim günü | `created_at` üzerinde, **Europe/Istanbul günü** (UTC+3, DST yok): `from` 00:00 dahil, `to` ertesi gün 00:00 hariç. `from > to` → 400 `fields.to` |
| `technicianId` | ULID? | ADMIN/SUPER_ADMIN; USER'da **yok sayılır** (kapsam ezer) |
| `tenantId` | ULID? | Yalnız SUPER_ADMIN, firma seçilmemişken (§2). Diğer rollerde ve firma seçiliyken yok sayılır |
| `customer` | trim, 2..100, `UNSAFE_NAME_CHARS` yok | `customer_name` içinde geçen (ci, `LIKE %x%`). `%`, `_`, `\` **literal** aranır (servis kaçışlar; test). Adı olmayan (P8 öncesi) oturumlar eşleşmez |
| `page`, `pageSize` | mevcut (1.., 1..100, vars. 25) | Toplamı aşan sayfa → boş `items` (hata değil) |
| `sort` | `enum(["createdAt:desc","createdAt:asc"])`, vars. `createdAt:desc` | İkincil sıra her zaman `id` aynı yön (kararlı sayfalama). Genişleme: `endedAt` eklenecekse buraya ve indekse |

`SessionListItem` = mevcut `SessionView` + `{ mode: "AGENT"|"BROWSER"|null, startedAt: string|null` (= `consumed_at`, mimari §3.1 P3 kararı), `durationSec: number|null` (`startedAt` ve `endedAt` doluysa `floor((endedAt−startedAt)/1000)`, aksi halde null; ACTIVE için UI canlı süreyi kendisi hesaplar), `customerName: string|null, ticketNo: string|null, tenant: { id, name } | null` (yalnız SUPER_ADMIN firma seçmeden listelerken dolu) `}`. Listede e-posta ve not **yok** (veri en aza indirme). `count` ve `findMany` aynı `where` ile çalışır. N+1 yoktur (`technician`, `tenant` tek `select`).

**2. Rol kapsamı (AC-61, G-22).** Tek fonksiyon `historyScope(auth)` (sessions/service.ts). Liste, `:id`, `:id/history`, PATCH ve export **aynı** kapsamı kullanır:
| Rol | Kapsam (repository `where`) |
|---|---|
| USER | `tenant_id = etkin tenant AND technician_id = user.id` |
| ADMIN | `tenant_id = etkin tenant` |
| SUPER_ADMIN, firma seçili (`actingTenant`) | `tenant_id = actingTenant` |
| SUPER_ADMIN, firma seçili değil | **tüm tenant'lar**. Açık bir `{ kind: "all" }` değeriyle ifade edilir; `tenantId` atlanarak elde edilmez. Bu değeri yalnız `historyScope` üretebilir. `tenantId` sorgu filtresi isteğe bağlıdır. Yalnız bu 5 uçta geçerlidir; diğer uçlarda `tenantScope` kuralı (firma seçimi zorunlu) değişmez |
Kapsam dışı ya da var olmayan id her uçta **404** `NOT_FOUND` döner, varlık sızdırılmaz. AC-69 test aracı bu 5 ucu iki tenant fixture'ı ve iki USER ile gezer: başka tenant → 404, aynı tenant başka teknisyen (USER) → 404, ADMIN → 200. Export'ta kapsam dışı satır 0 olmalı.

**3. `SessionHistoryDetail`** (GET `/sessions/:id/history` ve PATCH yanıtı; AC-62). Yapısı: `SessionListItem` + aşağıdaki alanlar.
| Alan | Kaynak / kural |
|---|---|
| `customerEmail: string\|null` | `support_sessions.customer_email` |
| `endedBy`, `endReason` | mevcut. UI `endReason`'ı etiketler (bilinmeyen → ham değer). `endedBy=ADMIN` ise `terminatedBy: { id, name } \| null` |
| `note: string\|null` | AC-63 |
| `quality: QualitySummary \| null` | `quality_summary` JSON'u contracts `qualitySummarySchema` ile ayrıştırılır. Ayrıştırılamazsa null döner ve log'a uyarı düşer (500 değil) |
| `files: { id, direction, fileName, sizeBytes, sha256, result, createdAt }[]` | `session_files`, `created_at` artan, en çok 500. İçerik yok (AC-55) |
| `consents: { id, at, level, decision, source, consentText: { id, version, sha256 } \| null }[]` | Tüm `session_consents` satırları ("onay kayıtları"), `created_at, id` artan, en çok 500. **`ip` ve `user_agent` API'de dönmez** (veri en aza indirme; kanıt DB'de kalır, hukuki talepte dba çıkarır) |
| `controlPeriods: { grantedAt, revokedAt: string\|null, revokedSource: "UI"\|"HOTKEY"\|"RECONNECT"\|"SYSTEM"\|"TECH"\|null, revokedReason: string\|null, selfElevated: boolean\|null }[]` | **Sunucu türetir** ("kontrol verilme/geri alınma zamanları"): `level=CONTROL` satırları sırayla eşleştirilir; her `GRANTED`, ardından gelen ilk `REVOKED` ile kapanır. Kapanış yoksa `revokedAt/revokedSource = null` olur; UI "Kapanış kaydı yok" yazar, bitiş zamanı **tahmin edilmez** (ADR-0013 K5-d). `revokedReason`: aynı oturumun ilk `control.revoked`/`control.released` audit'inden, `created_at ≥ revokedAt − 1 sn` koşuluyla alınır (`newValue.reason`; `released` için `"tech"`). `selfElevated`: GRANTED'den sonraki ilk `control.granted` audit'inin `newValue.selfElevated` alanı (`"true"`→true, `"false"`→false, `"unknown"`/yok → null). Eşleşmeyen audit → null (tahmin yok) |
| `timeline: TimelineEvent[]`, `timelineTruncated: boolean` | Aşağıda; `at, id` artan, en çok 500 olay |

`TimelineEvent = { at, action, actor: "TECH"|"CUSTOMER"|"ADMIN"|"SYSTEM", actorName: string|null, result: "success"|"fail", details: Record<string, string|number|boolean|null> }`. Kaynak sorgu: `audit_logs WHERE tenant_id = <oturumun tenant'ı> AND entity = 'support_sessions' AND entity_id = <id> AND action IN (<izin listesi>)`. Bu sorgu yeni `IX(tenant_id, entity, entity_id, created_at)` indeksini kullanır (dba P8). `details` ham `new_value`'dan üretilmez: **eylem başına izinli alan izdüşümüdür**. Listede olmayan anahtar dönmez; IP, UA ve maskeli değer hiç dönmez. Actor şöyle belirlenir: `user_id = technician_id` → TECH; başka bir `user_id` → ADMIN; `username='customer'` → CUSTOMER; `username='system'` ya da `user_id` NULL → SYSTEM. `actorName`: TECH/ADMIN için `users.full_name`, CUSTOMER için oturumun `customerName`'i (lobi olaylarında `details.name`), SYSTEM için null.
| `action` (izin listesi; contracts `CONTROL_AUDIT` + oturum olayları) | `details` izdüşümü | UI gösterimi (etiket `labels.ts`) |
|---|---|---|
| `session.created` | `ttlMin` | "Oturum oluşturuldu" |
| `guest.pending`, `guest.rejected` | `name` | "Lobiye katıldı" / "Teknisyen reddetti" |
| `guest.admitted` · `guest.admit` (fail) | `name`, `guestKind` · `reason` | "Kabul edildi" · "Yanlış kabul kodu" |
| `reconnect.conflict` | — | "Yeniden bağlanma reddedildi" |
| `control.requested` | `request` (1..5) | "Kontrol istendi (n/5)" |
| `control.granted` | `selfElevated` (boolean\|null) | "Kontrol verildi". `true` → uyarı rozeti "Müşteri istemcisi yönetici olarak çalışıyordu"; `null` → "Yönetici durumu bilinmiyor" (düz metin, rozet yok); `false` → ek yok |
| `control.denied` | — | "Müşteri reddetti" |
| `control.revoked` | `source` (consent kaynağı), `reason` (`permission`\|`audit`\|`admin`\|`session_ended`\|`superseded`\|`disconnect`), `side` (`guest`\|`tech`) | `source` UI → "Müşteri kapattı (pencere)", HOTKEY → "Müşteri kapattı (kısayol)", RECONNECT → `side`'a göre "Müşteri/Teknisyen bağlantısı koptu", SYSTEM → `reason` etiketi ("Teknisyen yetkisi kaldırıldı" / "Kayıt yazılamadı — güvenlik için kapatıldı" / "Yönetici sonlandırdı" / "Oturum sona erdi" / "Açılırken kapatıldı") |
| `control.released` | `via` (`release`\|`cancel`) | "Teknisyen kontrolü bıraktı" (consent `source=TECH`) |
| `control.cancelled` | `by` (`tech`\|`agent`; alan yoksa `tech`), `source` | `tech` → "Teknisyen isteği geri çekti"; `agent` → "İstek müşteri tarafında bağlantı kesilince kapandı" (müşteriye ret **atfedilmez**) |
| `monitor.requested` · `monitor.granted` · `monitor.denied` | `monitorId` | "Monitör n istendi / paylaşıldı / reddedildi" |
| `session.caps_changed` | `oldCaps` (`old_value.caps`), `newCaps` (`new_value.caps`), virgüllü metin | "Teknisyen yetkileri daraldı" |
| `session.cancelled` · `session.expired` · `session.terminated` · `session.ended` | — · — · `reason` (≤200, düz metin) · `reason` (→ `endReason`), `endedBy` | "İptal edildi" · "Süresi doldu" · "Yönetici sonlandırdı" · "Oturum bitti (<neden etiketi>)" |
Kapsam dışı action'lar (`session.resolve`, `session.join`, `file.*`, `file.meta.*`) zaman çizelgesine girmez. Dosyalar `files`'ta, operasyon olayları P11 audit ekranında görünür. Consent kaynağı etiketleri (onay kayıtları tablosu): UI "Müşteri (pencere)", HOTKEY "Müşteri (kısayol)", RECONNECT "Bağlantı koptu", SYSTEM "Sistem", **TECH "Teknisyen"**. Seviye: VIEW "Ekran görüntüleme", CONTROL "Uzaktan kontrol". Karar: GRANTED "Verildi", DENIED "Reddedildi", REVOKED "Geri alındı". Tarayıcı modu (BROWSER) oturumlarda kontrol yoktur; `controlPeriods` boş döner ve UI "Tarayıcı modunda uzaktan kontrol yoktur" yazar. Tüm metinler `textContent` ile basılır; `customerName`, `note` ve `details.name` asla HTML olarak işlenmez.

**4. PATCH `/sessions/:id` (AC-63).** `z.strictObject` kuralları:
- En az bir alan gelmelidir; aksi halde 400.
- `ticketNo`: trim, 0..50, `UNSAFE_NAME_CHARS` (Cc/Cf/Zl/Zp) yok.
- `note`: 0..4000 (zod `.length` UTF-16 birimi sayar; bu sayı her zaman DB `CHAR_LENGTH`'ten ≥ olduğu için CHECK tetiklenmez). `\n` ve `\t` serbest; diğer Cc ile bidi/sıfır genişlik Cf karakterleri yasak.
- Boş metin ve `null` → NULL yazılır (CHECK: boş metin saklanmaz). Alan gönderilmezse değişmez.
- Durum kısıtı yok (her durumda düzenlenebilir). Eşzamanlılıkta son yazan kazanır (kabul).
- UPDATE `where` içinde kapsam koşulu bulunur; `count=0` → 404.
- Audit `session.updated` (entity `support_sessions`): `oldValue/newValue = { ticketNo, noteLength }`. **Not metni audit'e yazılmaz**, çünkü audit 730 gün tutulur ve oturum retention'ını aşar (KVKK). Uzunluk ve değişti bilgisi yeterlidir.

**5. CSV (`lib/csv.ts`, AC-63, 124; P11 audit CSV aynı modülü kullanır)**
- Biçim: UTF-8 BOM, ayraç `;` (tr-TR Excel liste ayracı), satır sonu `\r\n`.
- Hücre işleme sırası: (1) **formül kaçışı**: ilk karakteri `=`, `+`, `-`, `@`, `\t` (U+0009) ya da `\r` (U+000D) olan hücrenin başına `'` eklenir; (2) RFC 4180 tırnaklama: `;`, `"`, `\r` veya `\n` içeren hücre `"…"` içine alınır ve `"` iki kez yazılır.
- Kaçış **tüm** metin hücrelerine uygulanır, başlık satırı dahil. Sayısal sütunlar sunucuda üretilir ve negatif olamaz.
- Başlık ve sütunlar (sabit sıra): `Oturum No; [Firma — yalnız SUPER_ADMIN firma seçmeden]; Oluşturma; Başlangıç; Bitiş; Süre; Durum; Mod; Teknisyen; Müşteri; Ticket No; Sonlandıran; Bitiş nedeni; Not`.
- Değer biçimleri: zamanlar Europe/Istanbul `YYYY-MM-DD HH:mm:ss`; süre `HH:MM:SS` (boşsa boş hücre); enum'lar `labels.ts` Türkçe etiketiyle, `end_reason` bilinmiyorsa ham değerle yazılır.
- E-posta, onay kayıtları ve zaman çizelgesi CSV'ye **girmez**. Genişleme noktası: ayrı "detay CSV" ucu.
- Akış: önce `count`. Sonuç > 50.000 ise 400 `VALIDATION` döner, `fields.to` = "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın" (yarım dosya üretilmez). Değilse `id` imleciyle 1000'lik partiler `reply.raw`'a yazılır.
- Başlıklar: `Content-Disposition: attachment; filename="oturumlar-YYYYMMDD-HHmm.csv"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Akış başladıktan sonra hata olursa bağlantı kesilir ve log'a ref yazılır; dosya yarım kalır, istemci indirme hatası görür.
- Audit `session.exported` (entity `support_sessions`, `entity_id` NULL): `newValue = { status, mode, from, to, technicianId, tenantId, customerFilter: bool, rows }`. Müşteri arama metni yazılmaz.
- Hız sınırı 5/dk/kullanıcı (`rate.ts`).

**6. Performans (AC-60, 10.000 kayıtta ilk sayfa < 500 ms).** İndeks eşlemesi:
| Kapsam | Kullanılan indeks |
|---|---|
| ADMIN | `(tenant_id, created_at)`; status filtresiyle `(tenant_id, status, created_at)` |
| USER | `(technician_id, created_at)` |
| SUPER_ADMIN, tüm tenant'lar | yeni `IX(created_at)` (dba P8; P13 retention da kullanır) |
`mode` ve `customer` artık filtredir (residual). Ölçüm, P8 "bitti" kanıtında üç rol için ayrı ayrı alınır.

## Public müşteri uçları (`/public`) — çerezsiz, kimliksiz
| Uç | Girdi | Çıktı | Hatalar | Koruma / AC |
|---|---|---|---|---|
| POST `/public/sessions/resolve` | `{ token: string(43) } \| { code: /^\d{8}$/ }`, `clientKind: "BROWSER"\|"AGENT"` | `{ sessionRef (opak), tenant:{name,logoUrl}, technician:{name,avatarUrl?}, techVerifyCode (müşterinin teknisyeni teyidi; müşteriyi doğrulamaz — G-01), consentText:{id,version,body,sha256} (sha256 = `body` UTF-8 hex; onay ekranı ve `session_consents` aynı sürümü gösterir), abuseEmail: string \| null, expiresAt, joinNonce, nonceExpiresAt }` — `abuseEmail`: `ABUSE_EMAIL` env; prod'da tanımsızsa **null** (UI "Kötüye kullanımı bildir" bağlantısını gizler); Super Admin e-postası fallback'i **yalnız** `NODE_ENV!=='production'` (QA-P4-7, K10) | 404 (kod yok), 410 `SESSION_EXPIRED`/`SESSION_CONSUMED`/`SESSION_CANCELLED` | Başarısız kod: `ipKey` 10/dk + `prefixKey` 30/dk, aşımda o anahtar 15 dk 429; token 30/dk/ipKey; global sayaç yalnız metrik/alarm (G-02, G-11); `checkPublicClient(req, clientKind)` (ADR-0012); resolve tüketmez; `joinNonce` `kind`'a bağlanır; AC-3, 5, 6, 16, 26, 97 |
| POST `/public/sessions/join` | `{ joinNonce, customerName: string(2..100), customerEmail?: email, consentTextId (zorunlu), consentAccepted: true }` — `customerName` trim sonrası; Unicode `Cc`/`Cf` (kontrol, bidi U+202A–202E/U+2066–2069, sıfır genişlik U+200B–200F/U+FEFF) içeriyorsa red | `{ wsTicket, admitCode (4 hane, yalnız bu misafire), technicianName }` — **iceServers ve reconnectToken yok** (admit sonrası `hello`'da, G-01/G-13) | 400 `VALIDATION` `fields.consentTextId` (eksik ya da oturumun tenant'ının `is_current` sürümü değil — G-24, QA-P4-7), 400 `VALIDATION` `fields.customerName` (uzunluk veya kontrol/bidi/sıfır-genişlik karakter), 403 (ret listesindeki ipKey), 409 `LOBBY_FULL`, 410 (nonce/oturum PENDING değil) | `checkPublicClient(req, nonce.kind)` — gövdede `clientKind` yok (ADR-0012); tek kullanımlık nonce (bellekte, aynı senkron adımda kontrol+silme); `status='PENDING' AND expires_at > now` olmayan oturumda 410 (okuma yeterli — tüketim yarışı admit'te tek atomik UPDATE ile çözülür, mimari-protokol §3.2); join **tüketmez**, misafiri lobiye alır (audit `guest.pending`: ad, ip); tüketim + consent kaydı `guest.admit` TX'inde; AC-6, 7, 16, 28, 29, 98, 112, 113, 127 |
| GET `/public/sessions/status?ref=<sessionRef>` | — | `{ status }` | 404 | Karşılama sayfası/istemci join öncesi 2 sn'de bir yoklar → iptalde "Oturum iptal edildi" (AC-8); IP 60/dk |
| GET `/public/tenants/:slug/branding` | — | `{ name, logoUrl }` | 404 → sistem logosu | Login logosu; AC-82 |
| GET `/public/files/logo/:tenantId/:file` | — | resim | 404 | AC-81, 84 |
| GET `/public/agent/download?ref=<sessionRef>` | — | 302 → `Location: /downloads/Destek-<8 hane>.exe`; `Cache-Control: no-store`; çerez yok; oturumu tüketmez. 302 yanıtına `Content-Disposition` **konmaz** (tarayıcılar 3xx'teki `Content-Disposition`'ı yok sayar; dosya adı son yanıttan gelir — QA-P6-5). Son yanıtı Caddy verir: `@agentExe` = `/downloads/NoktaDestek.exe` ve `/downloads/Destek-<8 hane>.exe` → volume'daki **aynı** jenerik ikili, `200`, `Content-Disposition: attachment; filename="<istenen ad>"`, `Content-Type: application/octet-stream`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; diğer `/downloads/*` → 404. Statik yol kodu doğrulamaz (her 8 hane aynı ikiliyi verir), bu yüzden sızıntı/oracle değildir; Caddy erişim logunda yol `/downloads/Destek-***`, `Content-Disposition` yanıt başlığı silinir (G-10) | 404 (ref geçersiz/HMAC uyuşmaz), 410 `SESSION_EXPIRED`/`SESSION_CONSUMED`/`SESSION_CANCELLED`, 429 `RATE_LIMITED` (+`Retry-After`), **503 `NOT_READY`** — ikili kapısı kapalı: volume'daki dosyanın SHA-256'sı `AGENT_SHA256` ile uyuşmuyor, `AGENT_SHA256`/`AGENT_BINARY_PATH` boş ya da dosya yok (fail-closed; ayrı hata kodu yok, contracts değişmez; geçişte bir kez `alarm:"agent_binary"` logu). Aynı kapı dağıtım yolunda da geçerlidir: Caddy `@agentExe` öncesi `forward_auth` → iç uç `/internal/agent-ready` (kapı "ok" değilse 503) — doğrudan `/downloads/*` isteği de 503 alır (S6-2) | **Bağlayıcı (P3 giriş şartı 1, P6'da yazılır):** yalnız `status='PENDING' AND expires_at > now` oturumda yanıt verir (dosya adı kodu taşıdığından süresiz `sessionRef` kodu süresi dışında sızdırmaz); hız sınırı kod yoluyla **aynı kovalar**: geçersiz/410 yanıt başarısız deneme sayılır (`ipKey` 10/dk + `prefixKey` 30/dk, aşımda 15 dk 429; `rs_resolve_failed_total` sayacı), ayrıca tüm istekler `ipKey` 20/dk; `ref` loga/audit'e yazılmaz (G-10). AC-27, ADR-0006 |

### Public istemci türü (ADR-0012)
`checkPublicClient(req, kind)` — `apps/server/src/auth/guards.ts`, resolve ve join'de; WS `/ws/guest` aynı kuralı ticket `kind` ile uygular.
| `Origin` | `kind` | Sonuç |
|---|---|---|
| var, `ALLOWED_ORIGINS` içinde | `BROWSER` | geçer |
| var (izinli, izinsiz veya `null`) | `AGENT` | 403 `CSRF_INVALID` |
| var, izinsiz / `null` | `BROWSER` | 403 `CSRF_INVALID` |
| yok, `Sec-Fetch-Site`/`Sec-Fetch-Mode` de yok | `AGENT` | geçer |
| yok | `BROWSER` ya da `Sec-Fetch-*` mevcut | 403 `CSRF_INVALID` |
`kind`: resolve'da gövde `clientKind`; join'de `joinNonce` kaydındaki `kind` (istemci beyanı değil). Hız sınırları `kind`'dan bağımsız.

## Yönetim
| Uç | Girdi | Çıktı | Hatalar | Yetki / AC |
|---|---|---|---|---|
| GET/POST `/users`, GET/PATCH `/users/:id` | `{ email, fullName, role: ADMIN\|USER, permissions: Record<key,bool> }` | kullanıcı (+ geçici şifre yalnız oluşturmada) | 403 (sahip olmadığı yetki), 404, 409 email | users.*; AC-71, 73, 74 |
| POST `/users/:id/deactivate` · `/users/:id/reset-mfa` | — | 204 | 404 | users.edit; ikisi de auth_sessions revoke + `rooms.endByTechnician` (G-04, AC-115). PATCH `/users/:id` yetki değişimi → `rooms.applyPermChange` |
| GET/PUT `/settings/tenant` | tenant_settings alanları (gizliler boşsa korunur) | ayarlar (gizliler `hasPassword: bool`) | 400 | settings.*; AC-4, 78, 79 |
| POST `/settings/smtp/test` | `{ to: email }` | `{ ok, message }` (mesaj genel: "Sunucuya bağlanılamadı" / "Kimlik reddedildi" / "TLS hatası"; ayrıntı yalnız sunucu logunda) | 400 `HOST_NOT_ALLOWED` (çözümlenen IP özel/loopback/link-local/CGNAT/Docker — `lib/netguard.ts`; bağlantı çözümlenen IP'ye, SNI=host), 429 (5/dk/tenant), 502 | settings.edit; AC-80, 122 (G-12). Aynı netguard kontrolü PUT `/settings/tenant` SMTP host kaydında |
| PUT `/settings/consent-text` | `{ body: string(50..20000) }` | yeni sürüm | 400 | settings.edit; AC-29 |
| POST/DELETE `/settings/logo` | multipart `file` | `{ logoUrl }` | 400 `INVALID_IMAGE`, 413 | settings.edit; AC-81, 84 |
| POST/DELETE `/users/:id/avatar` (`me` dahil) | multipart | `{ avatarUrl }` | 400, 413, 404 | kendi veya users.edit; AC-83, 84 |
| GET `/files/avatar/:tenantId/:file` | — | resim | 404 (tenant uyuşmazlığı) | Oturumlu; AC-84 |
| GET `/audit?from&to&userId&action&result&page` · GET `/audit/export.csv` (formül kaçışlı, G-16) | sorgu | sayfalı | — ; PUT/PATCH/DELETE → 405 | audit.view/export; AC-76 |
| GET/POST/PATCH `/admin/tenants`, POST `/admin/tenants/:id/deactivate`, POST `/admin/switch-tenant` `{ tenantId\|null }` | tenant alanları | tenant | 404 | SUPER_ADMIN; AC-70 |
| GET/PUT `/admin/settings/mysql`, POST `/admin/settings/mysql/test` | `{ host, port=3306, database, user, password? }` | `{ ok, message, latencyMs }` (10 sn timeout) | 502, 429 (5/dk) | SUPER_ADMIN (host kısıtı yok — DB iç ağda olabilir); audit; AC-77, 78 |
| GET/PUT `/admin/settings/turn` | `{ urls: string[], secret? }` | (secret maskeli) | 400 | SUPER_ADMIN; AC-78 |
| POST/DELETE `/admin/settings/system-logo` | multipart | — | 400 | SUPER_ADMIN; AC-82 |

## Operasyon (proxy dışına kapalı)
`GET /health` → 200 `{ status: "ok" }` (süreç canlı), `GET /ready` → 200 `{ status: "ready", migration }` / 503 `NOT_READY` (DB ping + migration sürümü); ikisi `/api` dışında, Caddy dışarıya 404, `GET /metrics` (Prometheus metin; `METRICS_TOKEN` Bearer zorunlu ve Caddy'de yalnız iç ağ) — AC-88, 89.
`GET /internal/agent-ready` (P6 düzeltme 1, S6-2/G-07): Caddy `forward_auth` iç ucu — `/downloads/*` sunulmadan önce ikili `AGENT_SHA256` ile eşleşirse 204, değilse 503 `NOT_READY` (Caddy yanıtı istemciye döner, dosya sunulmaz). Yalnız güvenilen proxy soketinden (`TRUSTED_PROXY_CIDR`; tanımsızsa loopback) + `X-Forwarded-Method` başlıklı GET; aksi 404. Caddy `/internal/*`'ı dışarıya 404'ler.
