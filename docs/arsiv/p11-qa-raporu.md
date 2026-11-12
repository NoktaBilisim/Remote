# QA Raporu — P11 Tur 2
DURUM: GEÇTİ

Tarih: 2026-11-13. Kapsam: Tur 1 "Düzeltilmeli" maddeleri ve implementation.md "Düzeltme turu 1" (backend `:3314`, frontend `:3380`), tüm test takımı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 temiz, 0 uyarı |
| `pnpm -r run typecheck` | 3/3 temiz |
| `pnpm -r run test` | contracts 71/71, web 218/218, server 324/324 |
| server `test:int` (yeni geçici `rs-mysql-qa-p11t2:33392`, mysql 8.4.13 + bayrak; `down` ile silindi) | **46 dosya, 445/445 geçti** |
| `pnpm --filter @remote/web e2e` (1. koşu) | 262 geçti, **1 hata**, 95 atlandı. Hata P10 testinde: `p10-account.spec.ts:190` `getByTestId('toast')`, ekranda 2 toast olduğu için strict mode ihlali |
| aynı test tek başına, `--repeat-each=5` | 5/5 geçti |
| `pnpm --filter @remote/web e2e` (2. tam koşu) | **264 geçti, 0 hata**, 95 atlandı (proje bazlı, gerekçeli: "masaüstü akışı" / "mobil düzen") |

Değerlendirme: Hata, yük altında önceki toast'un hâlâ ekranda olmasından kaynaklanan kararsız bir P10 test seçicisi. P11 kodundan kaynaklanan bir gerileme bulunmadı (izole 5/5, tam takım tekrarı yeşil). Engelleyici değil; Öneriler'de atandı.

## Tur 1 maddelerinin doğrulaması
| Madde | Durum | Kanıt |
|---|---|---|
| 1 [backend-dev] PUT'ta hedef değişince kayıtlı şifre yeni hosta taşınıyordu | ✅ KAPANDI | `system.ts:109`: kayıtlı secret varken host/port/user farklı ve şifre boşsa TX içinde 400 `fields.password`. Şifre hedefe bağlı AAD ile saklanıyor (`crypto.ts:19` `aadFor.mysqlSecret`). Çözülemezse `hasPassword:false` döner, test `secret_unreadable` döner ve probe çağrılmaz. int `settings-p11.test.ts:125` "AC-78 (B-P11-1)…": host, port ve user değişiminin üçü de 400, satır/secret değişmiyor; iki adımlı akışta `probes` boş; `value_json` elle değiştirildiğinde de probe çağrılmıyor; yeni şifre girilince yalnız o şifre gidiyor ve eski şifre probe girdisinde yok. e2e: port/kullanıcı değişiminde hata şifre alanına düşüyor (`aria-invalid`, odak) |
| 2 [frontend-dev] P11 ekranları koyu temada ve taşma için taranmıyordu | ✅ KAPANDI | `p11-admin.spec.ts` sonunda light/dark döngüsü + `emulateMedia({ colorScheme })` var. Her temada 1280 ve 390 px'te `/audit`, ayrıntı penceresi (masaüstü satır ve mobil kart), aydınlatma metni, MySQL (hata Alert'i açıkken) ve TURN için axe 0 ihlal + yatay taşma yok. Temanın gerçekten uygulandığı da (`color-scheme`) doğrulanıyor. Tam koşuda p11-admin'in 17 koşusu geçti |

Güvenlik düzeltmelerinin (B-P11-2..6) QA tarafından doğrulaması:
- latencyMs: başarısızlıkta `null`; sözleşme `number | null`, int'te doğrulandı.
- Global 20/dk kova eklendi.
- İmleçte BIGINT taşması 400 dönüyor (birim + int).
- Aydınlatma metni için tenant başına 10/saat sınırı: 429 → `toUiError` ile form hatası, `error-message.ts:21` kilit tonu.
- TLS uyarısı arayüzde her zaman görünür.
- Sapmalar ve risk kabulü (B-P11-4) implementation.md'de gerekçeli.
- `guvenlik-raporu.md` P11 doğrulama turu: Kritik 0, Yüksek 0 (2 madde "Sonra").

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-76 | ✅ | int `audit-p11` (kapsam, filtre, keyset, 405 + Allow, maske, taşan imleç 400); e2e kritik akış, filtreler, 5 durum, iki tema |
| AC-77 | ✅ | int gerçek MySQL testi, 5/dk + global 20/dk; birim 10 sn kesin zaman aşımı; e2e MySQL akışı |
| AC-78 | ✅ | int `AC-78: PUT şifreyi AES-256-GCM…`, `AC-78 (B-P11-1)…` (hedef bağı), TURN secret testi; e2e şifre forma yazılmıyor, boşsa korunuyor |
| AC-123 | ✅ | int `audit-immutability-p11` (metin protokolü; app UPDATE/DELETE/TRIGGER/ALTER reddi; SET TIMESTAMP atlatması kapalı), `db-grants` |
| AC-124 | ✅ | int `AC-124: BOM, ';', formül kaçışı…`, Firma sütunu, 429; birim formül kaçışı; e2e CSV |
| AC-29 (P11 kısmı) | ✅ | int yeni sürüm, `changed:false`, 409, 10/saat; e2e sayaç, onay, salt okunur |
| Sonra-açık P11 satırı (SMTP için yalnız `reason`) | ✅ | `audit/view.ts` izdüşümü; int "ham hata/yanıt kodu/banner yok" |

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| 1. AC'ler testle kanıtlı, testler yeşil | ✅ | Tüm AC ✅. Birim, int ve e2e yeşil (e2e'deki tek kararsız P10 testi tekrarda ve izole koşuda yeşil) |
| 2. Lint / type-check temiz | ✅ | Prettier talimat gereği çalıştırılmadı |
| 3. qa GEÇTİ; güvenlik Kritik/Yüksek 0 | ✅ | Bu rapor GEÇTİ; guvenlik-raporu P11 doğrulama turu Kritik 0, Yüksek 0 |
| 4. test-operatoru taraması | sırada | Akıştaki bir sonraki adım (qa sonrası); QA kapsamında değil |
| 5. Migration geri alınabilir, seed güncel | ✅ | `down.sql` + guard; dba kaydında up→down→up sonrası şemada fark yok, 320/320 grant kontrolü |
| 6. Dokümantasyon güncel | sırada | mimari, mimari-api, db-notlari, implementation, runbook §15, DESIGN.md güncel. README, api.md, kılavuz ve CHANGELOG teknik-yazar adımında güncellenecek |
| 7. Sapmalar gerekçeli | ✅ | implementation.md P11 + Düzeltme turu 1 (AAD geçişi, şifresiz kayıtta ret olmaması, risk kabulü, tenant kovası) |

## Öneriler (zorunlu değil)
1. [frontend-dev] `apps/web/e2e/p10-account.spec.ts:190`: `getByTestId('toast')` iki toast olduğunda strict mode'a takılıyor (tam takımda 1/2 koşuda kırmızı). Seçici metne göre daraltılmalı (`getByTestId('toast').filter({ hasText: "SMTP ayarları kaydedildi" })`) ya da önceki toast'un kapanması beklenmeli.
2. [frontend-dev] Aydınlatma metni PUT 429 (10/saat) için e2e senaryosu yok; genel `toUiError` yolu doğru ama kanıtı birim/e2e düzeyinde eklenebilir.
3. Tur 1 öneriler bölümü geçerliliğini koruyor (`SYSTEM_AUDIT` JSDoc'unda `***`/`changed` farkı, `_` içeren önek testi).

---

# QA Raporu — P11 Tur 1
Tarih: 2026-11-13 · Kapsam: P11 (AC-76, 77, 78, 123, 124 + AC-29 aydınlatma metni) · `git diff HEAD` (commit edilmemiş)

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | 3/3 temiz (0 uyarı) |
| `pnpm -r run typecheck` | 3/3 temiz |
| `pnpm -r run test` | contracts 71/71 · web 218/218 · server 323/323 |
| server `test:int` (geçici `rs-mysql-qa-p11:33391`, mysql 8.4.13, `@@log_bin=1`, `@@log_bin_trust_function_creators=1`; sonra `down`) | **46 dosya, 442/442 geçti** |
| `pnpm --filter @remote/web e2e` | **262 geçti, 0 hata, 93 atlandı**. Atlamaların hepsi proje bazlı ve gerekçeli (`desktopOnly` "masaüstü akışı" / "mobil düzen"); P11 spec'inde gerekçesiz `skip` yok |

## Kabul kriterleri
| AC | Durum | Kanıt / eksik |
|---|---|---|
| AC-76 audit ekranı: filtre (tarih/kullanıcı/işlem/sonuç), sayfalı, avatar, DELETE/PUT 405 | ✅ | int `audit-p11`: kapsam (Admin, USER, Super Admin, geçiş), filtreler + önek, keyset 53 kayıt/tekrarsız, 731 gün/ters aralık/bozuk imleç 400, okuma maskesi, 4 metot × 3 yol 405 + `Allow`, kayıt değişmiyor. e2e: `AC-76 kritik akış`, `AC-76 filtreler URL'de`, boş/hata/daha-fazla-hata, mobil kart, yetkisiz durum. Avatar şu an baş harf rozeti (`avatarUrl` P12'ye kadar null). Gerekçesi sözleşmede yazılı |
| AC-77 MySQL ayar ekranı + "Bağlantıyı Test Et" ≤ 10 sn | ✅ | int: gerçek MySQL'e karşı başarı/kimlik/db/bağlanamadı sınıfları, 429, yalnız SUPER_ADMIN. unit: kesin 10 sn zaman aşımı ve geç gelen bağlantının kapatılması. e2e: `AC-77/78 Super Admin MySQL` |
| AC-78 gizli değer forma yazılmaz, boşsa korunur, AES-256-GCM, audit | ⚠️ | Saklama/maske/korunma int ve e2e ile kanıtlı (`AC-78: PUT şifreyi AES-256-GCM…`, TURN testi). **Ancak** belgelenen güvenlik kararı (sapma 3: "kayıtlı şifre başka sunucuya gönderilmez") PUT yolundan aşılıyor ve bunun testi yok. Bkz. Düzeltilmeli 1 |
| AC-123 app kullanıcısı audit UPDATE yapamaz, tetikleyiciyi silemez/değiştiremez; migration ayrı kullanıcı | ✅ | int `audit-immutability-p11` (metin protokolü; 1295 yanlış pozitifi dışlanıyor): app UPDATE/DELETE/DROP·CREATE TRIGGER/ALTER/TRUNCATE/RENAME/GRANT reddi, migrator için bile UPDATE SIGNAL, 730 gün sınırı, `SET TIMESTAMP`/time_zone atlatma denemesi. Ayrıca `db-grants.test.ts` düzeltildi |
| AC-124 audit CSV formül kaçışı | ✅ | int `AC-124: BOM, ';', formül kaçışı` (`'=HYPERLINK`, `'+90`, JSON içinde `@`), Firma sütunu, 403, 5/dk → 429; unit `AC-124` (=, +, -, @, TAB, CR); e2e kritik akışta CSV |
| AC-29 aydınlatma metni düzenleme (P11'e ait) | ✅ | int: yeni sürüm, `changed:false`, audit'te gövde yok, 403/izolasyon, eşzamanlılık (tek güncel sürüm). e2e: sayaç/onay/sürüm geçmişi, salt okunur |
| Sonra-açık P11 satırı (audit'te SMTP için yalnız `reason`) | ✅ | `audit/view.ts` izinli alan izdüşümü. int: `554 … Relay denied`, banner ve yanıt kodu yanıtta yok, `reason` biçim dışıysa `other` |

## Düzeltilmeli
1. **[backend-dev]** `apps/server/src/settings/system.ts` `saveMysqlSettings` (yaklaşık satır 87–108) ile `testMysql`.
   - **Sorun:** PUT'ta host/port/kullanıcı değiştirilip şifre boş bırakılırsa eski `secret_enc` yeni hedefe bağlı olarak saklanıyor. Ardından boş şifreyle yapılan `POST /admin/settings/mysql/test` çağrısında `sameTarget(rec.core)` doğru dönüyor ve **eski sunucunun şifresi yeni (saldırgan kontrollü olabilecek) hosta gönderiliyor**. Bu, implementation.md "P11 — Backend" sapma 3'teki güvenlik kararını ("kayıtlı DB şifresi başka bir sunucuya gönderilemez") iki adımda aşıyor. Aynı açık, panel kaydı yokken env şifresi için yok; yalnız panel secret'ı için var.
   - **Beklenen:** PUT'ta kayıtlı secret varken host, port veya user önceki kayıttan (kayıt yoksa çalışan `DATABASE_URL`'den) farklıysa ve `password` boşsa → 400 `fields.password` = `MYSQL_PASSWORD_REQUIRED_MESSAGE`. Alternatif: secret NULL'lanır ve `hasPassword:false` döner. Hangisi seçilirse implementation.md'ye yazılmalı.
   - **Test:** `settings-p11.test.ts`'e "kayıtlı şifreyle PUT (host değişik, şifre boş) → 400 (veya secret silinir); ardından test → 400 `fields.password`, probe çağrılmaz" senaryosu eklenmeli.
2. **[frontend-dev]** `apps/web/e2e/p11-admin.spec.ts`.
   - **Sorun:** P11 ekranları (`/audit`, ayrıntı diyaloğu, `/admin/settings/mysql`, `/admin/settings/turn`, `/settings/consent-text`) yalnız varsayılan (açık) temada axe ile taranıyor. Dosyada `colorScheme`/`dark` geçmiyor. Projeler/CLAUDE.md §1.6–1.8 "her ekran iki temada kontrol edilir" diyor ve önceki paketlerde (P8 `p8-history.spec.ts:239`, P8b AC-164, P4/P5) bu desen var.
   - **Beklenen:** P8'deki `for (const scheme of ["light","dark"])` + `page.emulateMedia({ colorScheme })` deseniyle bu dört sayfa ve audit ayrıntı diyaloğu için iki temada axe 0 ihlal + 1280/390 px'te yatay taşma yok testi.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| 1. AC'ler testle kanıtlı, testler yeşil | ❌ | Testler yeşil. AC-78 ⚠️ (Düzeltilmeli 1: güvenlik kararının PUT yolu kanıtsız ve hatalı) |
| 2. Lint / format / type-check temiz | ✅ | lint 0 hata 0 uyarı, typecheck temiz. Prettier talimat gereği çalıştırılmadı |
| 3. qa GEÇTİ; güvenlik Kritik/Yüksek 0 | ❌ | Bu rapor DÜZELTİLMELİ. Güvenlik raporu ayrı (bu turda görülmedi) |
| 4. test-operatoru taraması | ❌ | Henüz yapılmadı (sıra: düzeltme sonrası) |
| 5. Migration geri alınabilir, seed güncel | ✅ | `down.sql` + `p11_down_guard_chk`; db-notlari'nde up→down→up drift 0, 320/320 grant kontrolü kayıtlı. `seed-consent.ts` `publishConsentText`'e bağlandı. QA bu turda down'ı ayrıca koşmadı; dba kaydına dayanır |
| 6. Dokümantasyon güncel | ⚠️ | mimari, mimari-api, db-notlari, implementation, runbook §15 ve DESIGN.md güncel. README/api.md/KULLANIM_KILAVUZU/CHANGELOG P11 için teknik-yazar aşamasında güncellenmeli (henüz değil) |
| 7. Sapmalar implementation.md'de gerekçeli | ✅ | Gerekçeli sapmalar: mysql2→mariadb (yeni bağımlılık yok), test hatası 200 `{ok:false}`, TURN DELETE satır silmez, SYSDATE tetikleyicisi, indeks değişimi, keyset, `changed:false`, `/audit/:id` `Allow` boş. Ayrıca mimari/mimari-api'ye sapma notu olarak işlendi |

## Öneriler (zorunlu değil)
- `testMysql`: panel kaydı secret'sızken ve hedef env ile aynıyken env şifresi kullanılıyor; panel secret'lı ama hedef env ile aynıysa 400 dönüyor. Bu davranış tutarlı ama belgede yok; implementation.md'ye tek cümle eklenebilir.
- `SYSTEM_AUDIT` JSDoc'u `password: "***"` diyor, kod `password: "changed"` yazıyor (mask.ts `***` yapıyor). Sonuç doğru, yorum kod ile hizalanabilir.
- Audit işlem önek filtresi için `_` içeren bir önekle (`tenant_settings.*`) entegrasyon testi eklenebilir. `escapeLike` P8'de doğrulanmış, risk düşük.

## Olumlu
- Audit okuma tarafında yeniden maskeleme ve dış gönderim kayıtları için izinli alan izdüşümü güvenlik koşulunu sağlam karşılıyor.
- Tetikleyicide `SET TIMESTAMP` ile atlatma deneyle bulunmuş ve SYSDATE+UTC ile kapatılmış. 1295 yanlış pozitifi tespit edilip `db-grants` testi düzeltilmiş.
- Keyset sayfalama, üst sınırlı sayım, CSV'de yarım dosya bırakmama ve 405'in kimlik doğrulamadan önce deterministik olması yerinde kararlar.
- MySQL yoklamasında kesin zaman aşımı ve geç kurulan bağlantının kapatılması birim testle kanıtlı.
- Frontend 5 durumu (boş/hata/daha-fazla-hata/yetkisiz/yükleniyor) e2e ile kanıtlı. Menü ikonları anlamlı (`ScrollText`, `ServerCog`, `Database`, `Waypoints`, `FileText`). P11 dosyalarında ham renk/px bulunmadı.

DURUM: DÜZELTİLMELİ
