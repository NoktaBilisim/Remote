# PT-K2 — sunucu entegrasyon test fikstürü temizliği (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K2 (+ §1 kısıt 2).
Davranış değişmez: yalnız "dosya-yerel yardımcıyı ortak yardımcıya al, çağrıyı değiştir" ve artık kullanılmayan
import'ların silinmesi. Assertion, test adı, `describe` yapısı aynı. `apps/server/src`, `test/helpers/app.ts` ve
`pt-surface.test.ts`'e dokunulmadı. Yeni bağımlılık yok. Yardımcılar saf: IP sayaçları, uygulama örneği, gelen kutusu ve
sunucu listesi çağıran dosyada kalır.

## Yeni yardımcılar

| Dosya                       | Ad                                                                          | Kaynak kopyalar                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/helpers/auth.ts`      | `signIn(app, user, remoteAddress)`                                          | `security-p14a-auth/-users/-tenants`, `tenants-p9`, `users-p9` (5 birebir gövde). Dosyaya özgü IP ifadesi yerel `nextIp()` olarak aynen kaldı |
|                             | `sessionOf(res)`                                                            | çerez kavanozu: `account-p10` `jar`, `p15-backend`, `branding-api-p12`, `p18-messages-h3` (aynı `Session` üretir)                             |
|                             | `login(app, tenantId, { role, perms })` → `{ user, s }`                     | `customers-p8c-api`, `customers-csv-p19`, `requests-p8b-5`, `requests-p8b-6`                                                                  |
| `test/helpers/mail-tls.ts`  | `makeTlsCert(prefix)`, `tlsMailService({port,cert,seen})`, `closeSmtp`      | `mail-tls-p10`, `mail-starttls-p14a` (openssl sertifikası + TLS posta servisi)                                                                |
|                             | `startInboxSmtp(inbox)`, `loopbackNetguard()`, `inboxTransport(() => port)` | `account-p10`, `security-p14a-auth` (düz metin sahte SMTP + netguard + 2525 taşıyıcı)                                                         |
| `test/helpers/db-grants.ts` | `errorText`                                                                 | `audit-immutability-p11`, `branding-p12`, `retention-p13a-db`, `security-p14a-db`, `security-p15-db`, `whatsapp-setting` (6)                  |
|                             | `rejectsWith(p, needle)`                                                    | `customers-p8c-db`, `session-history-p8`, `session-files-p5` (3 birebir)                                                                      |
|                             | `inRolledBackTx`, `TERMINATORS`                                             | `audit-immutability-p11` + `retention-p13a-db`; `security-p14a-db` + `security-p15-db` (LS/PS artık ` `/` ` kaçışıyla; değer aynı)            |

Çağrı uyarlamaları: `signIn(u)` → `signIn(app, u, nextIp())` (tenants-p9 `signIn(x, live.app)` → `signIn(live.app, x, nextIp())`);
`login(l, …)` → `login(l.app, …)`; `customers-csv-p19` varsayılan rolü ADMIN idi → rolsüz 3 çağrıya `{ role: "ADMIN" }` açık
yazıldı; `requests-p8b-6` dönüşü `{ id, s }` idi → 2 okuma `x.user.id` / `admin.user.id`. Argüman değerlendirme sırası
(IP sayacının artışı `createUser`'dan sonra, `inject`'ten önce) aynı.

## Bilinçli olarak yerel bırakılanlar (gövde farklı)

- **`boot` ×7 (tümü yerel):** 7 gövde 5 farklı (env birleşimi, `signaling.clock`, pino log yakalama, firma/teknisyen kurulumu,
  dönüş biçimi `{l, rc}` / `{live, rc}` / `Live` / bağlam nesnesi). Hepsinin ortak işi dosya-yerel `live` yuvasını atamak
  (dosyanın `afterEach`'i kapatır; `customers-p8c-api:339` ve `requests-p8b-4:337` yuvaya doğrudan da yazar). Saf bir yardımcı
  bu atamayı yapamaz; ince sarmalayıcı (`const b = await x(); live = b.live; return …`) orijinalden uzun olur ve hiçbir
  satır kazandırmaz. İki pino yakalama kopyası (bindings-p20/p8c, 2 satır) için izinli dosyalarda uygun yer yok → yerel.
- `account-p10` `signIn`: parola parametresi, `{ s, body }` dönüşü ve gövdeli hata metni farklı → yerel; kavanozu `sessionOf`.
- `p15-backend` `signIn`: 200 denetimi yok; ortak `signIn`'e geçmek giriş hatasında fırlatma davranışı eklerdi → tek satırlık
  yerel sarmalayıcı (`sessionOf(await app.inject(...))`).
- `branding-api-p12` `login`, `p18-messages-h3` `loginAs`: hata metni / XFF başlığı farklı → yerel, gövdeleri `sessionOf`.
- `p19-notify-j3` `login` (giriş kovası sıfırlama) yerel.
- `audit-immutability-p11`, `retention-p13a-db` `rejectsWith(p, RegExp)` ve `branding-p12` `rejectsWith(p, chk)`: ortak
  `rejectsWith`'ten farklı beklenti mesajı / `new RegExp` → tek satır yerel, `errorText` ortak.
- `whatsapp-setting` `upsert` (TX geri alma, oturum değişkeni sıfırlaması yok) ve `audit-immutability-p11` migrator
  (`createDb` tembel) ile `retention-p13a-db` migrator (`testFixtureDb`) farklı → yerel.

## Doğrulama

- `vitest list` (main + 3 seri proje, dummy DB URL ile): önce = sonra **1619 test / 109 dosya**; dosya+proje başına sıralı
  ad listesi birebir aynı (entegrasyon 1386 test / 79 dosya). Dosyalar arası sıra koşudan koşuya değişiyor (paralel toplama).
- Sayısal denetim (`test/integration/*.test.ts`, önce → sonra): `it(` 793 → 793, `describe(` 260 → 260, `it.each` 1 → 1,
  `writeAudit` 13 → 13. `expect(` 4246 → 4234 (−12 = `errorText` 6×1 + `rejectsWith` 3×2, helper'da 3 tek kopya),
  `.toX(` eşleştiricileri 4422 → 4408 (−12 aynı kopyalar + SMTP başında `toString` ×2), `signIn(` 72 → 66 (−6 tanım),
  `login(` 67 → 63 (−4 tanım). Çağrı sayıları aynı.
- `tsc --noEmit` (apps/server) temiz, `eslint test/integration test/helpers` 0 uyarı, prettier yalnız değişen 24 + yeni 3 dosya.
- Entegrasyon (`vitest run test/integration`, kendi konteyneri `rs-pt-k2-6709ae`, mysql 8.4.13, `--max-connections=300`,
  `test-db.sh` ile; K11/K12 yarım `src` değişiklikleri çalışma ağacındayken): önce **796/796**, sonra **796/796**, 0 kırmızı
  (K11/K12 kaynaklı kırmızı gözlenmedi). Unit 434/434. Konteyner adıyla silindi.
- Diff: 24 test dosyası, 132 ekleme / 494 silme + 3 yeni yardımcı (185 satır).
