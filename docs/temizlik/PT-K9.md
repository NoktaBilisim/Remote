# PT-K9 — `apps/server/src/requests/**` temizliği (ws.ts hariç)

Tarih: 2026-11-15 · Ajan: backend-dev · Tasarım: `docs/mimari-temizlik.md` §5 K9 (+ §1–4) · AC: gereksinimler §10 (AC-317, 318, 320, 321, 322, 324)
Davranış değişmez: HTTP uçları, hata kodları, audit eylem/alanları, metrik adları, SQL ve kilit sırası, TX sınırları aynı.

## Değişen / yeni dosyalar

| Dosya                                                                                                                                          | Önce → sonra (satır) | İş                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.ts`                                                                                                                                   | 1063 → 469           | `createCore` 264 satır/cx 29 (iç `admit` 195/cx 48, TX işlevi 97/cx 31) → 9 satırlık düzenleyici; web formu, iptal/bağlanma TX'leri devredildi       |
| `create-steps.ts` (yeni)                                                                                                                       | 252                  | TX öncesi adımlar: ön bakış, ip/önek/net48 sayımı, kaynak (ref/kayıt), engel/mesai/kanal/onay metni, bilinen kaynak, tenant kovası, mesai dışı reddi |
| `create-tx.ts` (yeni)                                                                                                                          | 260                  | Oluşturma TX'i + kod çakışması yeniden denemesi: kilit/yeniden doğrulama, bekleyen sınırları, bildirim bastırma, SLA, satır, audit                   |
| `create-after.ts` (yeni)                                                                                                                       | 104                  | Commit sonrası: kova sayımı, metrikler, `request.new`, kopma zamanlayıcısı, WhatsApp/e-posta                                                         |
| `web-form.ts` (yeni)                                                                                                                           | 106                  | `webFormInfo` gövdesi, bot kapısı (`webFormRejected`), `createWeb`'in zod + token kısmı                                                              |
| `cancel.ts` (yeni)                                                                                                                             | 131                  | `customerCancel` (iki dala bölündü), `resendFinal`, `cancelSystem`, `connectTimeout` TX'leri                                                         |
| `panel.ts`                                                                                                                                     | 628 → 273            | `acceptRequest` 117 → 20 satır; `toItem` cx 20 → `sourceState` çıkarıldı; ayarlar grubu yeniden dışa verilir                                         |
| `panel-accept.ts` (yeni)                                                                                                                       | 157                  | Kabul TX'i (`acceptTx`, `clientUnsupported`, `openSession`) + commit sonrası `afterAccept`                                                           |
| `panel-settings.ts` (yeni)                                                                                                                     | 247                  | Ayarlar grubu (ensureSettings, getSettings, updateSettings, rotateRef, whatsappTest, webFormUrl); iç klon giderildi                                  |
| `repo.ts`                                                                                                                                      | 534 → 296            | Ayar/oluşturma/okuma/geçiş sorguları kaldı; `export *` ile iki grup yeniden dışa verilir                                                             |
| `repo-panel.ts` (yeni)                                                                                                                         | 157                  | Panel liste/detay + P18 atama/öncelik sorguları                                                                                                      |
| `repo-sweep.ts` (yeni)                                                                                                                         | 100                  | Süpürücü + saklama/anonimleştirme sorguları                                                                                                          |
| `messages.ts`, `form-token.ts`, `calendar.ts`, `hub.ts`, `limits.ts`, `routes.ts`, `hours-routes.ts`, `block-routes.ts`, `jobs.ts`, `hours.ts` | —                    | Yalnız gereksiz `export` kaldırıldı (knip)                                                                                                           |

`ws.ts`'ye dokunulmadı (K10). Test dosyalarına dokunulmadı.

## Taşıma kuralı (§1-3) nasıl sağlandı

- `RequestService`'in tüm genel yöntemleri yerinde kaldı; taşınan gövdeleri `xxxOf(svc, …)` işlevlerine devreder
  (`customerCancel`, `cancelSystem`, `connectTimeout`, `webFormInfo`, `createWeb`). `vi.spyOn(RequestService.prototype, "resolveRef")`
  gibi testler etkilenmez: taşınan kod sınıf yöntemlerini yine `svc.x(...)` üzerinden çağırır (eski `this.x(...)`).
- `panel.ts` ayar işlevleri ve `repo.ts` sorgu grupları yeni dosyaya taşındı, eski dosya aynı adları **yeniden dışa verir**
  (`export { … } from "./panel-settings.ts"`, `export * from "./repo-panel.ts"`). Böylece K9 dosya listesi dışındaki hiçbir import
  satırı değişmedi (customers, bindings, jobs/retention, test yardımcıları). `vi.mock("…/requests/repo.ts")` (retention testleri)
  aynı modül yolunu taklit etmeye devam eder; `retentionTenants` çağıranı (`jobs/retention.ts`) repo.ts ad alanından çağırır.
- TX'li adımlar TX nesnesini parametre alır (`createTx(svc, tx, …)`, `lockAndRecheck(svc, tx, …)`, `acceptTx(w, tx)`,
  `openSession(w, tx, …)`); hiçbirinin kendi `db`'si yoktur.

## Davranış eşdeğerliği kanıtı (R-PT1)

Grep sayımı, `requests/*.ts` (ws.ts hariç), önce ↔ sonra:

| Çağrı             | Önce | Sonra |
| ----------------- | ---- | ----- |
| `writeAudit(`     | 27   | 27    |
| `metrics.inc(`    | 19   | 19    |
| `rateAudit(`      | 7    | 7     |
| `.limit(`         | 12   | 12    |
| `$transaction(`   | 21   | 21    |
| `hub.publish(`    | 10   | 10    |
| `lockSettings(`   | 8    | 8     |
| `outbox.enqueue(` | 3    | 3     |
| `new AppError(`   | 61   | 61    |
| `throw`           | 92   | 92    |

- SQL kilit satırları (`FOR UPDATE` / `FOR SHARE` içeren kod satırları) önce/sonra md5 aynı.
- String literal kümesi: hiçbir literal düşmedi; eklenenler yalnız yeni tip imzalarındaki adlar.
- Oluşturma sırası aynen: ref ön kontrolü → ön bakış → kapı öncesi kilit kontrolü → kapı → ip/önek/net48 → kayıt anahtarı →
  zod → sürüm → kaynak (+ kayıt kovası) → engel → mesai → (WEB) kanal → onay metni → ağ/cihaz → sır/id/süre → tenant kovası → TX
  [ayar FOR UPDATE → tenant FOR SHARE → müşteri FOR SHARE → kayıt UPDATE → bekleyen anlık görüntüsü → politika → INSERT → audit]
  → commit sonrası. Kabul TX'i: ayar → teknisyen → oturum ayarı → açık oturum → talep başı → müşteri FOR SHARE → kabul kodu →
  koşullu UPDATE → talep → oturum INSERT → audit → outbox (S-P19-T12).
- Web formu token tüketimi hâlâ ilk `await`'ten önce, senkron (`webFormCoreInput` sınıftan senkron başlatılır).

## Tasarımdan sapmalar (gerekçeli)

1. **Yeni dosya sayısı:** tasarım `create-steps.ts` diyor; tek dosya ~420 satır olacaktı (≤300 hedefi). Aşamaya göre üçe bölündü:
   `create-steps.ts` (TX öncesi), `create-tx.ts` (TX), `create-after.ts` (commit sonrası). Ek olarak `web-form.ts`, `cancel.ts`,
   `panel-settings.ts`, `repo-panel.ts`, `repo-sweep.ts`. Hepsi düz işlev; yeni sınıf/arayüz katmanı yok.
2. **Yeniden dışa verme (`panel.ts`, `repo.ts`):** §1-3 "dışa açık ad yerinde kalır" kuralının amacı (dosya listesi dışındaki import
   değişmez) yeniden dışa verme ile korunur. Aksi halde `repo.ts` (534) ve `panel.ts` yalnız iç yardımcı taşıyarak ≤300'e inemezdi;
   tasarım da açıkça "repo.ts → sorgu grupları" istiyor.
3. **`private` kaldırılan 3 alan:** `emailHour`, `alerted`, `outsideAudit` (`readonly` kaldı) — taşınan `notifyEmail`,
   tenant kovası uyarısı ve mesai dışı audit seyreltmesi bunları okur/yazar. Örnek başına durum aynı nesnede durur; davranış aynı.
4. **Yeni export'lar:** `service.ts` `tenantActive` (create-steps ön bakışı da kullanır), `panel-settings.ts` `who`
   (panel/panel-accept ortak). `RequestServiceDeps` dışa verilmez oldu (knip).
5. **`updateSettings` iç klonu:** UPDATE verisi ve audit `newValue` artık tek `nextSettings()` nesnesinden; alan sırası UPDATE'teki
   sırayla aynı (P19 alanları başta), audit şekli `auditShape` ile kurulduğundan JSON alan sırası da aynı.

## İstisnalar (görev başına ≤ 2)

1. **`service.ts` 469 satır (> 300):** kalan içerik sınıf alanları/kurucu, kısa ortak yardımcılar (kapı, ref çözümleme, kova/audit,
   kapanış yayını, bağlanma zamanlayıcıları) ve ince devretmelerdir; en uzun yöntem ≤ 25 satır. ≤ 300 için bunları da dışarı
   alıp sınıfı salt bir devretme cephesine çevirmek gerekirdi — kullanıcının "gereksiz soyutlama yok" ilkesine aykırı, okunurluğa
   katkısı yok. Dokunan böler kuralı (§9) geçerli.
2. (kullanılmadı)

## Ölçüm (pt-olcum kuralları: `max-lines-per-function` 40, `complexity` 15)

- K9 listesindeki işlevlerin hepsi hedefte: `createCore` 9 satır, eski `admit` → `admitCreate` ≤ 40, TX → `createTx` ≤ 40,
  `acceptRequest` 20, kabul TX'i `acceptTx` ≤ 40; karmaşıklık uyarısı yok (önce: 48, 31, 29, 20, 17).
- `updateSettings` 70 → ≤ 40.
- requests altında kalan > 40 işlevler K9 satırında listelenmemiş, dokunulmadı: `blocks.ts createBlock` 67, `hours.ts addHoliday` 42 /
  `importTrHolidays` 41, `messages.ts store` 54, `routes.ts supportRequestRoutes` 96 (Sonra / dokunan böler). ws.ts K10'da.
- 300 üstü kalan, K9'da listelenmeyen dosyalar: `messages.ts` 398, `hours.ts` 351, `blocks.ts` 338, `hub.ts` 322.
- knip (requests, ws.ts hariç): önceki 22 kullanılmayan export/tip → 0. jscpd: `panel.ts` iç klonu (10 satır) giderildi; requests
  içinde klon kalmadı.

## Doğrulama

| Adım                                                           | Sonuç                             |
| -------------------------------------------------------------- | --------------------------------- |
| `pnpm --filter @remote/server typecheck`                       | temiz                             |
| `pnpm --filter @remote/server lint`                            | temiz                             |
| `prettier --check` (değişen/yeni dosyalar)                     | temiz                             |
| Unit `pnpm --filter @remote/server test`                       | 30 dosya, 434 test geçti          |
| Test listesi (`vitest list`, 1619 test)                        | önce = sonra (dosya + ad birebir) |
| Entegrasyon (geçici MySQL `rs-pt-k9-*`, --max-connections=300) | bkz. aşağı                        |

Entegrasyon (`vitest run test/integration`, aynı geçici konteyner, önce ve sonra ayrı koşu):

- **Önce:** 796 testten 795 geçti, 1 başarısız. **Sonra:** 796 testten 795 geçti, aynı 1 başarısız.
- Başarısız test iki koşuda da aynı ve requests dışı: `customers-csv-p19.test.ts` "AC-263: 5 000 satır önizleme + uygulama ≤ 30 sn
  (yerel ölçüm)" — süre 34,6 sn (önce) / 33,7 sn (sonra). Bu bir performans eşiği; makinede paralel PT ajanları yük
  oluştururken koşuldu. K9 kodu bu yola girmiyor (CSV içe aktarma yalnız `ensureSettings`/`insertRequestRef` çağırır, ikisi de
  taşınmadan aynı gövdeyle yeniden dışa veriliyor).
- `pt-surface.test.ts` (rota tablosu anlık görüntüsü) geçti → HTTP uç listesi değişmedi.
- Not: sonraki koşu sırasında K10 aynı anda `signaling/**` ve `requests/ws.ts` üzerinde çalışıyordu; sonuç birlikte ölçüldü.
- Konteyner (`rs-pt-k9-53c65b`, port 35114) iş bitince silindi.

Bağımlılık eklenmedi. `docs/implementation.md`'ye yazılmadı (koordinatör talimatı).
