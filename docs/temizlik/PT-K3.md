# PT-K3 — e2e fikstür temizliği (frontend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K3 (+ §1 kısıt 2, 4).
Davranış değişmez: yalnız "kopyayı ortak yardımcıya al" ve "kullanılmayanı sil" (artık kullanılmayan import'lar).
Seçiciler, adımlar, beklentiler, test adları, `describe` yapısı ve `skip` gerekçe metinleri aynı. `mock-*.mjs`,
`fake-agent.ts` ve e2e dışındaki hiçbir dosyaya dokunulmadı. Yeni bağımlılık yok.

## `apps/web/e2e/helpers.ts` (54 → 90 satır)

| Yardımcı                                          | Kaynak klonlar                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktopOnly(name, reason = "masaüstü akışı")`    | 17 dosyadaki yerel `const desktopOnly` (16'sı "masaüstü akışı"; `p19-j5` gerekçesi "paylaşılan sahte durum: tek proje" → dosyada `P19_ONLY` sabiti, 4 çağrıya ikinci argüman)                                                                                                                               |
| `sessionCookies(context, value)` (değer döner)    | oturum + CSRF çerezi ekleyen 11 dosya-yerel `signInXx` gövdesi ve 5 test içi satır içi kopya                                                                                                                                                                                                                |
| `signIn(context, scenario)` (artık değer döner)   | `signInCu` (customers), `signInAu` (p11, p12b, p13a), `signInBr` (p12), `signInAs` (p13bl, p14a), `signInRq` (p8b), `signInUs` (p9) → `signIn`; varsayılan senaryolu çağrılar açık yazıldı (`signIn(context, "rqcu")`, `"usadm"`); p18 ve p8b'deki satır içi `u-rqadm`/`u-rqcu`/`u-hu` kopyaları → `signIn` |
| `newSession(page)`                                | `POST /api/v1/sessions` + 201 beklentisi: p4-media, p13bl (yerel işlev), p5, p7, p15, p17 (satır içi)                                                                                                                                                                                                       |
| `scanBoth(browser, scenario, path, width, ready)` | p15 ve p16'daki birebir aynı iki tema tarama işlevi                                                                                                                                                                                                                                                         |
| `guardConsole(expectedNet?)`                      | auth.spec ve p13bl-lobby'deki yerel konsol bekçisi; dosyaya özgü beklenen ağ deseni parametreyle aynen geçirildi (varsayılan desen değişmedi)                                                                                                                                                               |

Bilinçli olarak yerel bırakılanlar (gövde farklı, birleştirmek davranış/okunurluk değiştirirdi):

- `signInP18(context, role, room)` (rastgele değil oda kimlikli değer) ve `signInP19(context, role)` (`newRoom()`
  sonekli): rol tip kısıtını korumak için tek satırlık sarmalayıcı olarak kaldı, gövdeleri `sessionCookies`.
- p18/p19 `scanBoth` (oda kimlikli oturum, p19'da oturumsuz seçenek ve sabit 390 px), auth.spec `axeScan` (legacy mod
  kapalı), auth.spec `sessionCookie` (sameSite'sız, CSRF'siz geçersiz çerez), p10'daki `s-gecersiz` çerezi, p12
  `rs_theme` çerezi, p7/p17 `liveAgent` (bekleme adımları farklı), auth/p10/p4-real `login` (imza ve seçiciler farklı).

## Satır sayıları (spec)

auth 206→198 · customers 366→355 · p10 428→427 · p11 451→441 · p12 402→393 · p12b 329→319 · p13a 258→248 ·
p13bl 472→442 · p14a 387→376 · p14b 252→251 · p15 368→348 · p16 250→236 · p17 72→65 · p18 371→351 · p19 363→354 ·
p4-media 323→313 · p5 729→723 · p7 451→445 · p8 416→415 · p8b 369→353 · p9 470→460. Toplam (helpers dahil)
211 ekleme / 395 silme.

## Doğrulama

- `playwright test --list`: önce = sonra **643 test / 24 dosya**; satır:sütun numaraları ayıklanınca liste birebir aynı
  (aynı sıra, aynı proje, aynı ad). `-c playwright.real.config.ts --list`: 5 test, birebir aynı (satır numarası dahil).
- Sayısal denetim (tüm spec'ler, önce→sonra): `desktopOnly(info` 152→152, `await expect` 2107→2107, `getByTestId(`
  1902→1902, `test.describe(` 7→7. Azalanlar yalnız helpers'a taşınan tek kopyalar: `expect(` −10 (6 × 201 beklentisi,
  2 × scanBoth axe, 2 × konsol bekçisi afterEach), `test.skip(` −17 (desktopOnly tanımları), `goto(` −2 (scanBoth).
- `eslint e2e` 0 uyarı, `tsc --noEmit` (apps/web) temiz, prettier yalnız değişen dosyalara.
- e2e koşusu (`pnpm --filter @remote/web e2e`, desktop + mobile + desktop-rtc + desktop-perf; K14 yarım değişiklikleri
  çalışma ağacında iken): **443 geçti, 200 atlandı (desktopOnly/proje koşulları), 0 başarısız**, 2,1 dk.
