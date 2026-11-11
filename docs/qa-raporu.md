# QA Raporu — P8 Oturum geçmişi — Tur 1
DURUM: GEÇTİ

(Önceki paket raporları `docs/arsiv/` altında. Denetim tarihi 2026-11-11; kapsam commit edilmemiş P8 değişiklikleri + AC-39 e2e düzeltmesi + agent fare imleci.)

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (exit 0) |
| `pnpm -r run typecheck` | temiz (exit 0) |
| `pnpm -r run test` | contracts **49/49**, server **255/255**, web **136/136** — skip yok |
| `pnpm --filter @remote/server test:int` (geçici `mysql:8.4`, `test-db.sh up`, 8 migration + grants, sonra silindi) | **214/214**, 25 dosya, skip yok |
| AC-60 ölçümü (aynı koşu, 10.000 oturum, ANALYZE sonrası, 5 tekrar medyan) | ADMIN 8,5 ms · USER 12,5 ms · SUPER_ADMIN tüm tenant 7,7 ms · API uçtan uca ADMIN 30,3 ms (sınır 500 ms) |
| `prisma migrate diff --from-config-datasource --to-schema … --exit-code` | "No difference detected" (drift yok) |
| `deploy/mysql/check-app-grants.sh` (dba yöntemi: `APP_PW` konteyner env'inden, `CONTAINER`, `DB=remote`) | **148/148 PASS**, 0 FAIL |
| `pnpm --filter @remote/web e2e` (tam paket) | **174 geçti, 54 skip, 0 kırmızı** (1,2 dk) |
| Go (`golang:1.26.11-bookworm`): `gofmt -l`, `go vet` linux + `GOOS=windows`, `go test -race ./...`, windows test derlemesi | gofmt boş, vet temiz (iki hedef), 15 paket ok (`internal/capture` dahil), windows derleme ok |

Skip gerekçeleri: 54 skip'in tamamı gerekçeli — `test.skip(project !== "desktop", …)` (konsol/masaüstü akışlarının mobil projede atlanması; p4-media, p5-collab, p8-history `desktopOnly`) ve `p4-real.spec.ts` (`E2E_REAL` gerçek sunucu gerektirir). Gerekçesiz skip yok.

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-60 filtre (tarih/teknisyen/durum/müşteri/mod), sayfalı (25 / ≤100), 10k < 500 ms | ✅ | int `sessions-history-api-p8` "AC-60: varsayılan sayfa 25…", "tarih aralığı Europe/Istanbul günü", "durum, mod, teknisyen ve müşteri (% _ literal)", "sayfalama kararlı…pageSize üst sınırı 100", "AC-60 performans … üç rolde" (ölçüm yukarıda); contracts `listSessionsQuerySchema (AC-60)`; e2e `p8-history` "liste, sayfalama", "filtreler URL'de kalır", "istemci doğrulaması" |
| AC-61 rol kapsamı, IDOR 404 (G-22) | ✅ | int "USER yalnız kendi…filtre kapsamı genişletmez", "USER başka teknisyen/başka tenant 404 — :id, :id/history, PATCH" (ayrıca DB'de değişmedi kontrolü), "ADMIN … başka tenant 404", "SUPER_ADMIN firma seçmeden tüm tenant / seçiliyken yalnız o firma", "yetki any-of", "USER export'u yalnız kendi satırları"; tenant-isolation matrisi yeşil; e2e "kapsam dışı / olmayan oturum → bulunamadı" |
| AC-62 detay alanları | ✅ | int "başlangıç/bitiş/süre, müşteri, kalite, dosyalar, sonlandıran", "onay kayıtları (ip/UA yok) ve kontrol dönemleri (TECH kapanışı, selfElevated, kapanışsız dönem)", "zaman çizelgesi izin listesi + izdüşüm; file.* ve başka tenant yok", "ayrıştırılamayan kalite → null; 500 olay kırpma", "consumeForAdmit customer_name/email aynı UPDATE'te"; unit `deriveControlPeriods`, `projectDetails`; e2e "detay — özet, onay…dosyalar" |
| AC-63 ticket ≤50 / not ≤4000, CSV (BOM) yetkiyle | ✅ | int "ticketNo/not kaydedilir; audit yalnız ticketNo + not uzunluğu", "yalnız gönderilen alan; \"\"/null → NULL", "geçersiz 400; CSRF/Origin yoksa 403", "BOM, ; ayraç, CRLF…", "boş sonuç yalnız başlık; 6. istek 429 + Retry-After", "keyset 1205 satır eksiksiz/tekrarsız"; unit "50.000 üstü → 400 fields.to"; e2e "ticket + not", "yalnız görüntüleme yetkisi — form ve Dışa aktar yok", "Dışa aktar — filtreli CSV iner; 400 ve 429" |
| AC-124 CSV formül kaçışı (oturum CSV'si) | ✅ | unit `lib/csv` "= + - @ TAB CR ile başlayan hücre ' önekiyle", "RFC 4180"; int CSV testi gerçek hücrelerle (`'@Teknisyen`, `"'=HYPERLINK(""…"")"`, `'+905…`, `"'-2+3;""alıntı""\n…"`). Audit CSV'si P11 kapsamında (mimari §10.2 izlenebilirlik "P8, P11"); aynı `lib/csv.ts` kullanılacak |

## Düzeltilmeli
Yok (Kritik/Yüksek/Orta bulgu yok).

## Bulgular (düşük önem, paket kapanışını bloklamaz)
- **QA-P8-1 (Düşük) [test-operatoru]** — mimari §10.3 P8 "bitti" kanıtı "CSV Excel tr-TR'de doğru sütunlara açılır ve formüllü hücre metin kalır (manuel kayıt)" henüz yok (`docs/implementation.md:1934` açıkça devrediyor). Staging'de gerçek CSV ile elle doğrulanıp `docs/test-raporu.md`'ye yazılmalı. Paket sırasında zaten test-operatoru adımı; o adım tamamlanmadan P8 kapatılmamalı.
- **QA-P8-2 (Düşük) [backend-dev]** `apps/server/src/signaling/admit.ts` `customerOf` — ad 2 kod noktasından kısaysa (zod UTF-16 / DB CHAR_LENGTH farkı) hem ad hem e-posta NULL yazılıyor; e-posta da kaybolur (CHECK `customer_email` → `customer_name IS NOT NULL` gerektirdiği için). Sapma implementation.md/mimari §3.1 "backend-dev sapma notu (3)"te gerekçeli; kalıcı çözüm contracts `customerName` uzunluğunu kod noktasıyla saymak (sonraki uygun pakette). Kabul edildi, kayıt amaçlı.
- **QA-P8-3 (Bilgi)** CSV akışı `reply.raw` yerine `reply.send(Readable)` — mimari §5'ten sapma, gerekçeli (sapma notu 1), davranış başlık/test ile doğrulandı.

## Tasarım–kod uyumu
- API sözleşmesi (mimari-api "Oturum geçmişi (P8)" §1–§6) birebir: strict sorgu şeması, `historyScope` tek kaynak (5 uç, `{kind:"all"}` markalı tip — yalnız `historyScope` üretiyor), kapsam filtreyi ezer, `count`/`findMany` aynı `where`, N+1 yok, ikincil sıra `id`, LIKE kaçışı, Istanbul günü; PATCH kapsam koşulu UPDATE'te, UPDATE+audit tek TX, audit'te not metni yok (`noteLength`); CSV sırası hız sınırı → count (>50.000 → 400) → audit (müşteri arama metni yok) → keyset 1000'lik parti; başlıklar (`Content-Disposition`, `no-store`, `nosniff`) testli.
- Veri modeli: P8 migration (4 sütun, 3 indeks, CHECK'ler) + ayrı ADR-0014 migration; drift 0; grants 148/148. dba sapması IX(tenant_id,status,created_at) mimari §3.1'de gerekçeli.
- `audit/mask.ts` `ticketNo` izinli anahtar — AC-75'teki "ticket" WS bileti (`wsTicket`) içindir; ticket numarası gizli değil. Gerekçeli (sapma 4).
- Ölü kod: `repo.listInScope` kaldırıldı; `sessionScope`/`findInScope` cancel/terminate'te hâlâ kullanılıyor (ölü değil).
- Yeni bağımlılık yok; yeni env yok.

## Kalite taraması
- `any`/`as any`, `dangerouslySetInnerHTML`, boş `catch`, ham hex renk / `[Npx]` keyfi değer: P8 sunucu ve web dosyalarında (`history/**`, `lib/history/*`, `select-field.tsx`, `sessions/history*.ts`, `lib/csv.ts`) bulunmadı.
- Hata yutma yok: kalite özeti ayrıştırılamazsa uyarı logu + null (sözleşme gereği); akış hatası ref ile loglanıp yeniden fırlatılıyor.
- PII log: export audit'inde müşteri araması yok (testli); detay API'sinde IP/UA dönmüyor (testli).
- Frontend 5 durum: e2e "5 durum: boş, filtrede boş, sayfa dışı, hata + tekrar dene", loading iskeletleri (`loading.tsx` ×2), kısmi durumlar; a11y: axe açık + koyu, 390 px taşma yok (e2e); menü ikonu `History` (lucide) DESIGN.md'de.

## Definition of Done
| Madde | Durum | Not |
|---|---|---|
| Tüm AC'ler testle kanıtlı | ✅ | Tablo yukarıda |
| lint / typecheck / unit / int / e2e yeşil | ✅ | Hepsi exit 0 |
| Gerekçesiz skip yok | ✅ | 54 skip proje/ortam gerekçeli |
| Migration + drift + grants | ✅ | 8 migration, diff 0, 148/148 |
| AC-60 performans ölçümü (3 rol) | ✅ | ≤ 12,5 ms medyan |
| Tenant izolasyonu / yetki arka uçta | ✅ | int IDOR + any-of testleri |
| Audit (PATCH, export) + maskeleme | ✅ | testli |
| Sapmalar `implementation.md`/`db-notlari.md`'de gerekçeli | ✅ | Backend P8, Frontend P8, Agent fare imleci, ADR-0014 |
| Go agent (fare imleci) gofmt/vet/race | ✅ | linux + windows |
| Manuel Excel tr-TR CSV kanıtı (mimari §10.3) | ⏳ | QA-P8-1 — test-operatoru adımında |
| Dokümantasyon (README/CHANGELOG/kılavuz) | ⏳ | Paket sırasının teknik-yazar adımı |

## Öneriler (zorunlu değil)
- contracts `customerName` uzunluğunu kod noktasıyla sayan özel kontrol (QA-P8-2'yi kökten kapatır).
- Export audit'i akış başarıyla bitince ayrıca `rows_written` ile güncellemek mümkün değil (audit append-only); ileride akış hatasında `session.exported` `fail` satırı eklenebilir.

## Olumlu
- `historyScope`'un markalı tiple tek noktadan "tüm tenant" üretmesi; USER filtre ezme ve IDOR testleri DB yan etkisini de doğruluyor.
- CSV testi gerçek kötü niyetli hücrelerle uçtan uca; keyset imleci aynı `created_at` tuzağıyla (1205 satır) sınanmış.
- Migration'larda kilitleme notları ve ADR-0014 için kanonik-olmayan-veri koruması.
