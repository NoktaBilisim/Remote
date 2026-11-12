# QA Raporu — P9 (Kullanıcı/yetki/tenant yönetimi) — Tur 2
DURUM: GEÇTİ

Kapsam: P9 Tur 1 Düzeltilmeli #1'in kapanışı ve regresyon. Kontrol edilen dosyalar: `apps/web/lib/users/form.ts`, `lib/users/users.test.ts`, `e2e/mock-users.mjs`, `e2e/p9-users.spec.ts`, `apps/server/src/lib/ids.ts` (yalnız yorum), `docs/gereksinimler-sonra-acik.md`, `docs/implementation.md` (P9 düzeltme turu 1 notları). `apps/agent-win` kapsam dışıdır, ayrı denetleniyor.
Önceki tur: Tur 1 (DÜZELTİLMELİ, 1 madde). Önceki paketin raporu: `docs/arsiv/p8c2-qa-raporu.md`.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | contracts, server, web: hata ve uyarı yok |
| `pnpm -r run typecheck` | contracts, server, web: hata yok |
| `pnpm --filter @remote/contracts test` | 7 dosya / 68 ✓ |
| `pnpm --filter @remote/web test` | 19 dosya / 193 ✓ (Tur 1'de 191'di, +2 yeni birim testi) |
| `pnpm --filter @remote/server test` (unit) | 17 dosya / 285 ✓ |
| server `test:int` (geçici DB `rs-mysql-p9qa2:33327`, `test-db.sh up` ile açıldı, sonra `down` ile silindi) | 40 dosya / 384 ✓ |
| `pnpm --filter @remote/web e2e` | 221 geçti, 78 atlandı, 0 kaldı (Tur 1'de 220/77; yeni test masaüstünde koşuyor, mobilde atlanıyor) |
| gitleaks v8.30.1 (docker, `.gitleaks.toml`) | `apps/server/src`, `apps/web/{e2e,lib,app}`, `packages`, `docs`: hepsi çıkış 0 |

Atlanan 78 testin tamamı gerekçeli `desktopOnly` / `test.skip(name !== "desktop", …)` kalıbından geliyor. Bulgu değil.

## Tur 1 #1'in kapanışı
**Sorun:** USER→ADMIN yükseltmede kilitli anahtar sunucuda açılıyor ve 403 dönüyordu.

**Sonuç: kapandı.**
- **İstemci:** `form.ts:156-171` `buildUpdateUser`, rol değiştiğinde `Object.keys(perms)` ile tüm anahtarları ekrandaki değerleriyle gönderiyor. Rol değişmezse yalnız değişen anahtarlar gidiyor (eski davranış).
- **Sunucu kuralıyla karşılaştırma** (`apps/server/src/users/service.ts`):
  - `normalizeRows` (82-90) değeri şu sırayla belirliyor: önce gövde, sonra mevcut ezme, en son yeni rolün varsayılanı. Gövdede açıkça yer alan anahtar ekrandaki değeri alıyor.
  - `updateUser` (163-167) `diffKeys(before, after)` ile yalnız etkin kümede değişen anahtarları `assertGrantable`'a veriyor.
  - Kilitli anahtar ekranda eski değerinde kalıyor (`applyRoleDefaults`) ve bu değer gönderiliyor. Böylece `before == after`, anahtar diff'e girmiyor, 403 oluşmuyor.
- **Sunucu tarafı kanıtı:** `users-p9.test.ts:193`, `{ role: "ADMIN", permissions: { "audit.export": false } }` → 200.
- **Mock eşdeğerliği:** `mock-users.mjs:182-199` PATCH kuralı sunucuyla aynı mantıkta. Etkin kümede değişen anahtar aktörde yoksa 403 ve `fields["permissions.<k>"]` dönüyor. Kendi hesabında 403 yalnız gerçek değişiklikte. Mock'un POST kuralı (`grantsForeign`) da sunucunun `assertGrantable(after)` kuralıyla eşdeğer.
- **Testler:**
  - `users.test.ts` "rol değişince (USER→ADMIN) kilitli anahtar açıkça false gider…": sunucu kuralının kopyasıyla sunucunun hesapladığı kümenin ekranla aynı olduğunu ve diff'te yabancı anahtar kalmadığını gösteriyor. Eski davranışın kilitli anahtarı açtığını da negatif kontrol olarak doğruluyor.
  - "…elle eski değerine çekilirse…": PATCH gövdesinin `PERMISSION_KEYS` kümesinin tamamını içerdiğini doğruluyor.
  - `p9-users.spec.ts:188` "AC-73 rol yükseltme…":
    - Yalnız rol içeren ham PATCH → 403, `fields` = `["permissions.audit.export"]`.
    - UI üzerinden kayıt → 200, gövde `audit.export:false`, `users.delete:true`.
    - Sayfa yeniden yüklenince rol ADMIN, `audit.export` kapalı, `settings.edit` açık.
  - Mevcut AC-73 testindeki (`:167`) beklenti hatalı davranışı kodluyordu ("anahtar hiç yok"). Doğru şekilde "açıkça false" olarak değişmiş. Testin kapsamı zayıflamamış.

**Yan etki / yetki yükseltme analizi (sorun yok):**
- **Değişmeyen anahtar AC-73'e takılmıyor.** Açıkça gönderilen ama etkin değeri değişmeyen anahtar `diffKeys`'e girmiyor. `normalizeRows` rol varsayılanına eşit satırları atıyor, dolayısıyla gereksiz ezme satırı oluşmuyor. `permissionAudits` yalnız diff üzerinden yazdığı için sahte AC-74 audit satırı da oluşmuyor.
- **Yetki yükseltme yolu yok.**
  - Kilitsiz anahtarlar tanımı gereği aktörde bulunan anahtarlar.
  - Kilitli bir anahtar için iki durum var:
    - Değeri değişirse `assertGrantable` 403 veriyor.
    - Hedefte açıksa daha işlemin başında `canManage` 403 veriyor.
  - Gövde, sözleşme şemasıyla (`permissionMapSchema`) tanım dışı anahtarlara kapalı.
- **Rol değişmeyen PATCH'lerde davranış aynı.** Yalnız değişen anahtarlar gidiyor. Bunu "güncelleme: yalnız değişen alanlar…" birim testi doğruluyor.

**Diğer düzeltmeler:**
- `ids.ts` değişikliği yalnız satır içi `// gitleaks:allow` yorumu. Davranış aynı, gitleaks temiz.
- `gereksinimler-sonra-acik.md`'de B-P9-2..6 sahip ve zaman bilgisiyle "Sonra" tablosunda.
- `implementation.md`'de backend ve frontend için "Düzeltme turu 1" notları gerekçeli yazılmış.

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-4 | ✅ | `tenants-p9` "AC-4: session_ttl_min 15–30 dışı → 400 …"; settings.view / settings.edit yoksa 403 |
| AC-69 | ✅ | `tenant-isolation.test.ts` + `helpers/tenant-matrix.ts` (`system` sınıfı); `users-p9` "AC-69: liste … yalnız kendi tenant'ı", "Super Admin hesabı /users/:id ile görünmez (404)" |
| AC-70 | ✅ | `tenants-p9`: oluşturma, düzenleme, liste, detay, geçiş, pasife alma (giriş 401, oturum iptali, kod oturumu CANCELLED, 5 sn) |
| AC-71 | ✅ | `users-p9` "detay tanımdaki HER anahtarı içerir"; web birim testi (matris, grup, mixed); e2e grup aç/kapat ve klavye |
| AC-72 | ✅ | `permissions-ac72-p9` (`vi.mock` ile geçici modül); web `users.test.ts` "AC-72 geçici modül" |
| AC-73 | ✅ | API: `users-p9` (`:98`, `:188`, `:193`). UI: `p9-users.spec.ts:146` ve `:188` (rol yükseltmede 200, kilitli anahtar kapalı kalıyor); `users.test.ts` iki yeni test |
| AC-74 | ✅ | `users-p9` "her yetki değişikliği ayrı audit satırı …" ve "rol değişimi user.updated + permission_changed"; aynı TX |
| AC-115 (P9 payı) | ✅ | `users-p9` pasif / yetki / rol canlı yansıma testleri (5 sn); `tenants-p9` "AC-70/AC-115" |
| AC-145 (servis yolu) | ✅ | `tenants-p9` "AC-70/AC-145: … bekleyen talep TENANT_PASSIVE" |

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Testler yeşil (unit, int, e2e) | ✅ | 68 + 193 + 285 + 384 + 221 (0 kalan) |
| Lint / typecheck temiz | ✅ | |
| Paketin tüm AC'leri test kanıtlı | ✅ | Tablo yukarıda |
| Katman düzeni ve repo imzasında tenant kapsamı | ✅ | Tur 1'den beri değişmedi (sunucu tarafında yalnız yorum değişti) |
| Sayfalı listeler (üst sınır 100) | ✅ | |
| Transaction ve audit aynı TX'te; canlı etkiler commit'ten sonra | ✅ | |
| Gizli bilgi / PII log yok; gitleaks temiz | ✅ | B-P9-1 kapandı; gitleaks çıkış 0 |
| `any` yok, hata yutma yok, ölü kod yok | ✅ | Yeni kodda bulunmadı |
| Frontend 5 durum, a11y, ikonlar, iki tema | ✅ | e2e axe açık/koyu ve durum testleri yeşil |
| Yeni bağımlılık / env / grant / şema | ✅ | Yok |
| Sapmalar gerekçeli | ✅ | `implementation.md` P9 düzeltme turu 1 |
| Bilinen işlevsel hata yok | ✅ | Tur 1 #1 kapandı |
| Ertelenen bulgular kayıtlı | ✅ | B-P9-2..6 `gereksinimler-sonra-acik.md` |

## Öneriler (zorunlu değil)
1. **[frontend-dev] Kayıp güncelleme.** Rol değişiminde tüm anahtarlar gönderildiği için, sayfa açıkken başka bir yöneticinin yaptığı kilitsiz anahtar değişikliği ekrandaki eski değerle ezilir. Yetki yükseltmesi yok (kilitli anahtarlarda sunucu 403 verir), ama kayıp güncelleme var. Detaya `updatedAt` / ETag ekleyip PATCH'te `If-Match` ile 409 dönmek düşünülebilir. B-P9-2 (TOCTOU) ile birlikte ele alınabilir.
2. **[frontend-dev] Rol geri alındığında ezmeler kayboluyor.** `user-editor.tsx:62-65`: rol önce değiştirilip sonra kaydedilmeden eski role döndürülürse kilitsiz anahtarlar eski rolün varsayılanına iner. Kaydedilmiş ezmeler (ör. USER'da `sessions.view` açık) ekranda kaybolur ve kaydedilirse kapanır. Kayıt çubuğu değişikliği gösterdiği için sessiz bir hata değil. Yine de rol `base.role`'a dönünce `basePerms` geri yüklenebilir.
3. **[backend-dev] Eksik entegrasyon testi.** `users-p9`'a, rol değişiminde tam yetki haritasıyla PATCH testi eklenebilir: istemcinin artık gönderdiği gövde biçimi, ADMIN aktör ve kilitli anahtar ile → 200, ek audit satırı yok. Şu an bu davranış sunucu kodundan ve web birim testindeki kural kopyasından çıkarılıyor.
4. Tur 1 öneri 1-3 (`users.delete` ucu, firma seçicide arama, yükseltmede odaların bitmesi notu) hâlâ açık.

## Olumlu
- Düzeltme minimal: yalnız `buildUpdateUser` değişti, editör ve sunucu dokunulmadı. Gerekçe yorumda ve `implementation.md`'de doğru anlatılıyor.
- Birim testi sunucu kuralını kopyalayıp negatif kontrolle (eski davranışın 403 üreteceği) birlikte doğruluyor. e2e testi önce hatayı yeniden üretiyor (ham PATCH 403), sonra düzeltmeyi ve kalıcılığı gösteriyor.
- Mock PATCH kuralı sunucuyla aynı mantığa getirildi. Böylece Tur 1'deki "mock gerçek kuralı taklit etmiyor" boşluğu kapandı.
