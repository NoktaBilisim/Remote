# Test Raporu — P22-T (oturum sohbeti WS + KVKK; gerçek sunucu + gerçek web)

**DURUM: GEÇTİ (web + sunucu).** ENGELLEYİCİ ve YÜKSEK bulgu yok. Kritik 4 akışın (çift yönlü WS sohbeti ve yeniden bağlanma, eski istemci, AC-292, oturum detayı ve audit) tamamı gerçek sunucu ve gerçek web birlikte koşularak geçti. Ek olarak yetki toggle'ı, yetkisiz erişim ve IDOR kontrolleri de geçti. Koşulan akışlarda pageerror ve konsol hatası yok, 5xx yok. Proje axe kural setinde ihlal 0, 390 px'te taşma yok.

Bulgular: iki ORTA-altı (DÜŞÜK) bulgu ve bir doküman uyuşmazlığı. Hiçbiri geçişi engellemiyor.

Kapsam dışı: Go istemci 0.21.0 (P22-G) ve gerçek 0.19/0.20 istemciler. Bunlar aşağıdaki elle listede.

Ortam:
- Dal ve tarih: `claude/p22-06bd24` @ `97d2270`, 2026-11-18, Chromium (Playwright).
- Kaynak: çalışma ağacının APFS anlık görüntüsü (scratchpad). Worktree dosyalarına ve `.next`'e dokunulmadı.
- Sunucu: gerçek `apps/server` (`node src/server.ts`, NODE_ENV=development, 2FA kurulum zorunluluğu açık) :3483.
- Web: standalone derleme :3484 (`/api`, `/ws` → :3483).
- DB: `rs-p22-test` (127.0.0.1:33481). `pnpm db:seed` ile demo tenant + Super Admin eklendi, `e2e:real:users` ile iki ADMIN eklendi. Kimlik bilgileri rastgele üretildi, yalnız scratchpad'de (600 izinle) duruyor.
- Sahte API/WS yok. Müşteri ekran kaynağı sentetik canvas.

Dosyalar:
- Betikler: `docs/test-raporu/e2e/p22/`. `up.sh` yığını kurar. `lib.ts` API girişi + TOTP + step-up yardımcılarını içerir. `p22op.spec.ts` kritik 4 akışı, `p22op-b.spec.ts` yetki ve aydınlatma kontrollerini içerir. Config: `p22op.config.ts`.
- Ham sonuç: `akis.jsonl`.
- Ekranlar: `docs/img/p22/` (12 dosya).

Temizlik: server ve web süreçleri kapatıldı, 3483 ve 3484 boş. `rs-p22-test` konteyneri bırakıldı (bana ait değil). Seed'in eklediği demo tenant, iki ADMIN ve test oturumları DB'de kaldı.

## Özet

| Ölçüt | Sonuç |
| ----- | ----- |
| Koşu | `p22op.spec.ts`: 4/4 geçti (33 sn). `p22op-b.spec.ts`: 2/2 geçti (45 sn) |
| pageerror / konsol hatası (konsol + misafir) | 0 |
| 5xx | 0 |
| axe | 28 tarama. Proje kural setinde (wcag2a/2aa/21aa, `e2e/helpers.ts`) 0 ihlal. Kapsam: karşılama 1280/390 × açık/koyu, konsol sohbeti, misafir sohbeti, 4426 ekranı, eski istemci (konsol + misafir), geçmiş sohbeti, yetki ekranı. Ek `wcag21a` etiketi açıkken `/settings/consent-text` ve `/settings/general`'da 1 `label-content-name-mismatch` çıktı (D-3) |
| 390 px yatay taşma | 0 (karşılama, 4426, geçmiş, genel ayarlar) |
| Kırık link / sayfa-tarayıcı | **Koşulmadı.** Tarama spec içinde yapıldı; `sayfa-tarayici.mjs` projede `playwright` paketi olmadığı için çalışmıyor |

## Bulgular

### [DÜŞÜK] D-1 Audit ekranında P22 eylemleri ham kod olarak görünüyor

Sayfa/akış: `/audit` (Admin).
Adımlar:
1. Bir oturumda sohbet et, oturumu sonlandır.
2. `/history/<id>` → "Sohbeti göster".
3. `/audit` sayfasını aç.

Beklenen: diğer satırlar gibi Türkçe etiket ve altında kod (ör. "Yönetici sonlandırdı / session.terminated").
Gerçekleşen: `session.chat_viewed` ve `session.chat_summary` yalnız ham kodla görünüyor. `packages/contracts/src/labels.ts` içinde P22 eylemlerinin (`session.chat_viewed`, `session.chat_summary`, `session.chat_rejected`, `session.chat_history_sent`, `session.chat_legacy` vb.) etiketi yok. P28u K10'da gözetimsiz eylemler için aynı açık kapatılmıştı.
Kanıt: `docs/img/p22/audit-1280.png`
Atanan: frontend-dev (contracts `labels.ts` + gerekirse audit süzgeç grubu)

### [DÜŞÜK] D-2 Eski konsol sekmesi (4426) "Oturum sona erdi" + "Bitti" diyor; oturum aslında sürüyor

Sayfa/akış: `/sessions/<id>/console`, `rs.cap.schat1` bildirmeyen konsol sekmesi (`WebSocket` sarmalayıcısıyla taklit edildi).
Adımlar:
1. Aktif oturum.
2. Belirteçsiz sokete sahip ikinci konsol sekmesini aç.

Beklenen: metin doğru ("Konsol sürümü eski — sayfayı yenileyin." + "Sayfayı yenile" düğmesi). Ama başlık ve durum rozeti oturumun bittiğini söylememeli.
Gerçekleşen: kapanış kodu 4426, metin ve düğme doğru, canlı sekme etkilenmiyor (aşağıda). Ancak kart başlığı "Oturum sona erdi", üst bardaki rozet "Bitti", müşteri adı "Müşteri". Teknisyen yenilemeden önce oturumun kapandığını sanabilir. Etkisi düşük: düğme tek tıkla düzeltiyor.
Kanıt: `docs/img/p22/konsol-4426-1280-dark.png`
Atanan: frontend-dev

### [DÜŞÜK] D-3 Hesap menüsü `summary` erişilebilir adı görünen metinle uyuşmuyor (P22 dışı, önceden var)

Sayfa/akış: tüm panel sayfaları (ölçüm `/settings/general` ve `/settings/consent-text`).
Bulgu: axe `label-content-name-mismatch` (wcag21a, 2.5.3). `aria-label="Hesap menüsü: …"` görünen metni ("E1" + ad) içermiyor. Proje axe kural seti `wcag21a` etiketini taramadığı için CI'da görünmüyor.
Atanan: frontend-dev (fırsat bulunca)

### [Not / doküman] mimari-p22 §5.3 "403 mevcut `auth.forbidden` yoluna düşer"; kodda böyle bir audit yok

`sessions.view_chat` olmayan ADMIN2 için `GET /sessions/:id/chat` 403 döndü (doğru), ancak `auth.forbidden` satırı 0. Bu eylem adı `apps/server/src` ve `packages/contracts` içinde hiç geçmiyor. Ürün davranışı başka paketlerle tutarlı. Ya doküman cümlesi düzeltilmeli ya da yetkisiz okuma denemesi audit'e yazılmalı.
Atanan: mimar (karar) → backend-dev (gerekirse)

## Akış sonuçları (gerçek sunucu + gerçek web)

| Akış | Sonuç | Not / kanıt (`akis.jsonl`) |
| ---- | ----- | -------------------------- |
| ADMIN girişi + 2FA (kurulum → etkinleştirme → doğrulama) | ✅ | `sessions.view_chat` ADMIN'de varsayılan açık |
| AC-264 teknisyen → misafir | ✅ | Konsol "T1" yazdı, tarayıcı misafirde göründü |
| AC-264 misafir → teknisyen + XSS | ✅ | `<img src=x onerror=…>` metin olarak göründü. `img` 0, script çalışmadı (`xssFired:false`) |
| Önce kaydet + şifreli saklama | ✅ | `session_messages` = 2 (gönderilen 2). `body_enc` içinde düz metin araması 0 |
| Saklama notu iki tarafta | ✅ | Konsol: "Sohbet kayıt altına alınır ve oturum saklama süresi boyunca saklanır." Misafir: "Sohbet mesajları kayıt altına alınır ve 365 gün saklanır" (tenant ayarı 365) |
| Misafir yeniden bağlanma (çevrimdışı + soket kapandı, bu sırada teknisyen yazdı) | ✅ | Dönüşte 3 mesaj, sonuncusu "T2". 2 `chat.history` çerçevesi geldi, çift kayıt yok |
| Konsol yenileme | ✅ | Konsol geçmişten 3 mesajı gösterdi, DB 3 satır |
| Belirteçsiz konsol (eski sekme) → 4426 | ✅ (D-2) | `close` kodu `[4426]`, "Konsol sürümü eski — sayfayı yenileyin." + "Sayfayı yenile". Aynı kullanıcının canlı sekmesi "Aktif" kaldı ve sonrasında mesaj iletti ("T3") |
| Belirteçsiz misafir: konsol tarafı | ✅ | "Müşterinin istemcisi eski; sohbet için güncellemesi gerekir.", giriş pasif ("Sohbet kapalı (müşterinin istemcisi eski)") |
| Belirteçsiz misafir: misafir tarafı | ✅ | Misafire giden `chat.*` WS çerçevesi 0. Tarayıcı misafirde "Sohbet şu an kullanılamıyor." DC'den sabit `LEGACY_CHAT_NOTICE` **1 kez** geldi ("Bu sürümde sohbet kapalıdır… güncelleyin"). Gerçek Go ≤ 0.20 ekranında gösterimi elle listede (E-1/E-2) |
| Eski istemcili oturum özeti ve detayı | ✅ | `session_messages` 0. `session.chat_summary` `{legacy:true, tech:0, customer:0}`. Detayda "Müşteri eski istemci kullandığı için bu oturumda sohbet kapalıydı" |
| AC-264 oturum detayı (`/history/[id]`) | ✅ | Düğme "Sohbeti göster (4 mesaj)", 4 mesaj (talep yazışması yok). Sayfa açılışı audit **0**, tıklama **1** `session.chat_viewed` `{messages:4, requestMessages:0}`. Yenileme + ikinci tıklama yeni satır **eklemedi** (10 dk penceresi). 390 px taşma yok |
| Audit ekranında `session.chat_viewed` | ✅ (D-1) | Satır görünüyor, kullanıcı ve IP doğru, Türkçe etiket yok |
| `sessions.view_chat` toggle ekranı (AC-285) | ✅ | "Oturumlar" satırında anahtar var + hassas yetki notu. Kapatma audit'e `{permKey:"sessions.view_chat", granted:false}` olarak yazıldı. Test sonunda geri açıldı |
| Yetkisiz (ADMIN2, view_chat kapalı) | ✅ | `GET /sessions/:id/chat` 403. `GET /history` 200 ve `chat` alanı **yok**. Detayda "Sohbet" bölümü yok |
| IDOR: başka tenant oturumunun sohbeti | ✅ | 404 |
| AC-292 karşılama satırı | ✅ | "Sohbet mesajları kayıt altına alınır ve 365 gün saklanır", `join-browser`'ın hemen önceki kardeşi. `aria-describedby` satıra bağlı. Ad + onay girilince düğme etkin. 1280/390 × iki tema axe 0 |
| AC-291 aydınlatma bandı | ➖ gözlem | Seed v1 metni sohbet paragrafını içeriyor: `chatParagraphMissing:false`, iki sayfada bant yok (doğru). "Paragrafsız sürüm kaydet → bant → ekle" yolu gerçek sunucuda **koşulmadı** (sahte API e2e'sinde yeşil) |
| Gözetimsiz odada sohbet pasif | ➖ koşulmadı | Gerçek cihaz yok. Sahte e2e (`p22-chat.spec.ts`) + sunucu entegrasyon testi kapsıyor |

## Kabul kriterleri (uçtan uca)

| AC | Durum | Nasıl doğrulandı |
| -- | ----- | ---------------- |
| AC-264 sunucu aktarımı, önce kaydet, şifreli | ✅ | Gerçek WS iki yön, DB satır sayısı, şifreli alanda düz metin 0 |
| AC-264 eski istemcide iki tarafta kapalı | ✅ (web) / ELLE (Go) | Belirteçsiz tarayıcı misafir taklidi. Gerçek 0.19/0.20 E-1/E-2 |
| AC-264 detayda yalnız yetkiliye + görüntüleme audit'i | ✅ | Toggle + 403 + alan yok + `session.chat_viewed` 1 kez |
| AC-285 yeni yetki toggle ekranında | ✅ | `perm-sessions.view_chat` |
| AC-287 iki tema axe 0, 390 px | ✅ (not) | Proje kural setinde 0. **Not:** panel ekranlarının (konsol, geçmiş) "açık" görüntüsü alınırken uygulama hâlâ koyu temadaydı (`emulateMedia` değişimi + 200 ms bekleme yetmedi). Bu ekranlarda açık tema axe'ı bu turda güvenilir değil. QA Tur 2'deki sahte e2e iki temayı kapsıyor |
| AC-291 | ✅ (seed) / ➖ | Seed metni paragrafı içeriyor. Bant yolu gerçek sunucuda koşulmadı |
| AC-292 (tarayıcı karşılama) | ✅ | Yukarıda. Windows/macOS/Linux istemci yüzeyleri P22-G |

## Görsel gözlemler (ekran görüntülerinden)

- Konsol sohbeti (koyu, 1280): saklama notu `ShieldCheck` ile görünüyor. Balonlar okunaklı, XSS gövdesi düz metin. Gönder düğmesi ve giriş hizalı (`konsol-sohbet-1280-dark.png`).
- Eski istemci (konsol): uyarı bandı sarı, metin okunaklı. Giriş yer tutucusu "Sohbet kapalı (müşterinin istemcisi eski)". Boş durum metni ("Henüz mesaj yok. Ayşe Test ile buradan yazışabilirsiniz.") giriş pasifken biraz çelişkili ama zararsız (`konsol-eski-istemci-1280-light.png`, görüntü koyu temada; bkz. AC-287 notu).
- 4426 ekranı: D-2.
- Geçmiş sohbeti (1280 koyu ve 390 açık): gönderen + zaman satırı, teknisyen sağda, müşteri solda, taşma yok. 390 tam sayfa görüntüde yapışkan üst bar sayfa ortasında görünüyor; bu tam sayfa ekran görüntüsünün yan etkisi, hata değil.
- Audit: D-1.

## Elle test listesi (staging, ana oturum)

| # | Madde | Durum |
| - | ----- | ----- |
| E-1 | 0.19.0 (Windows/macOS) istemciyle oturum. Konsolda "istemci eski" + giriş pasif olmalı. Müşteri penceresinde "Bu sürümde sohbet kapalıdır… programı güncelleyin" bir kez görünmeli, sonraki DC `chat`'te en çok 60 sn'de bir. Müşterinin yazdığı konsolda görünmemeli. Oturum kopmamalı (T-P22-5) | ELLE |
| E-2 | 0.20.0 (Linux) istemciyle E-1'in aynısı | ELLE |
| E-3 | Yayından önce açık konsol sekmesi yayın sonrası 4426 almalı → "sayfayı yenileyin". Yenileyince düzelmeli (yerelde taklitle ✅) | ELLE |
| E-4 | Seed provası: staging'de `pnpm db:seed` sohbet paragraflı yeni aydınlatma sürümünü yazmalı (`consent_text.created{source:"seed"}`). Eski sürümle onay alınamamalı | ELLE |
| E-5 | Alarm provası: `rs_session_chat_rejected_total{reason="internal"}` > 0 → remote-watch uyarısı. `rs_ws_tech_outdated_total` ve `rs_session_chat_legacy_sessions_total` `/metrics`'te görünmeli | ELLE |
| E-6 | Retention: süresi dolan oturumun `session_messages` satırları silinmeli. Detayda "Sohbet saklama süresi dolduğu için silindi" görünmeli | ELLE |
| E-7 | Gözetimsiz bağlantıda konsol sohbet sekmesi "Gözetimsiz bağlantıda sohbet yoktur." göstermeli (gerçek cihazla) | ELLE |
| P22-G | Go 0.21.0: `schat1`, WS sohbeti, DC sohbetinin kaldırılması, `chat.state` gelmeden giriş pasif, üç platformun karşılama ve talep formunda AC-292 satırı | P22-G |

---

# Test Raporu — P28f (macOS istemci; web ekranları + elle liste)

DURUM: GEÇTİ (web arayüzü). ENGELLEYİCİ ve YÜKSEK bulgu yok. Bir ORTA bulgu var: konsol ve lobi, macOS istemcisini de "Hızlı Destek (Windows)" diye etiketliyor. İki DÜŞÜK bulgu var. 5xx yok (beklenen sahte 500/503 dışında), JS hatası (pageerror) yok, axe ihlali yok, yatay taşma yok, kırık link yok. Web tarafından denetlenen AC'lerde ❌ yok.
**Prod kapısı ayrı:** AC-389..395'in istemci tarafı ve güvenlik raporunun "prod öncesi elle şart" maddeleri gerçek Mac'te **hiç koşulmadı**. Aşağıdaki "P28f elle (kullanıcı) listesi"ndeki tüm maddeler ELLE ve sonuçsuz. Bu liste kapanmadan P28f prod'a çıkamaz (qa Tur 1 m.8).

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` (:4217). Audit için ikinci örnek `:3218` → os enjekte eden şeffaf vekil `:4218` → `:4217`. Dal `p28f` @ `52fc00c` + çalışma ağacı (eşzamanlı başka bir ajan `mac-guide.tsx`/`tr.json`'dan Mikrofon izin kartını kaldırdı; karşılama taraması bu değişiklikle **yeniden derlenip yeniden koşuldu**, 17:53 derlemesi). Konsol ve audit taramaları değişiklikten önceki derlemede (17:37) koştu; değişiklik bu ekranlara dokunmuyor. Tarih 2026-11-17, Chromium (Playwright 1.65), kullanıcı ajanı macOS Chrome 140 (`Macintosh; Intel Mac OS X 10_15_7`).

- **Betikler:** `docs/test-raporu/e2e/p28f/zz-p28f-op.spec.ts` (keşif + ekranlar), `p28f-op.config.ts`, `audit-os-proxy.mjs` (sahte API'de `os` alanlı katılım satırı yok ve audit listesi SSR, bu yüzden `page.route` yetmiyor; vekil yalnız `GET /api/v1/audit` ilk sayfasına 4 satır ekliyor). Koşu sırasında betikler `apps/web/` altına geçici kopyalandı, sonra silindi.
- **Ham sonuç:** `docs/test-raporu/e2e/p28f/tarama.jsonl`. Ekran görüntüleri `docs/img/p28f/` altında (24 dosya, 3,9 MB). Karşılamada her senaryodan 1280 açık + 375 koyu, konsolda 1280 açık/koyu + 375 açık, audit'te 1280 açık + 375 koyu tutuldu. Diğer iki kombinasyon tarandı (axe/taşma/konsol `tarama.jsonl`'da), görüntüleri silindi.
- **Kapsam dışı:** gerçek macOS istemcisi (Go/AppKit), imza/notarization, TCC. Bunlar aşağıdaki elle listede.
- **Temizlik:** başlatılan süreçler (mock 4217, web 3217/3218, vekil 4218) kapatıldı, portlar boş. Ürün kodu değiştirilmedi. Çalışma ağacındaki `CHANGELOG.md`, `README.md`, `docs/KULLANIM_KILAVUZU.md`, `docs/api.md`, `docs/DATASHEET.md`, `docs/pdf/*`, `mac-guide*`, `tr.json`, `p28f-macos.spec.ts`, `docs/guvenlik-raporu.md` değişiklikleri bu tura ait değil.

## Özet

| Ölçüt                                                                                                      | Sonuç                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mevcut e2e (ilk derleme) `p28f-macos` + `p6-agent-download` + `p7-control` + `p11-admin`, desktop + mobile | **49 geçti, 0 düştü, 41 atlandı** (mobil projede masaüstü senaryoları `skip`)                                                                                                                                   |
| Mevcut e2e (Mikrofon kartı kaldırıldıktan sonraki derleme) `p28f-macos` + `p6-agent-download`, desktop     | **18 geçti, 0 düştü, 1 atlandı**                                                                                                                                                                                |
| Keşif turu                                                                                                 | 9 karşılama senaryosu × 1280/375 × açık/koyu = **36 görünüm**. Ek olarak konsol OS_PERMISSION 4 görünüm, audit detayı 4 görünüm, link + klavye denetimi 1                                                       |
| Konsol hatası / pageerror                                                                                  | **0**. Yalnız senaryonun zorladığı ağ kayıtları görüldü: availability 500, `ERR_FAILED` (abort), download 503 (NOT_READY), indirmede `/downloads/*.zip` `ERR_ABORTED` (tarayıcı indirmeyi devraldığında normal) |
| 5xx                                                                                                        | Yalnız bilerek üretilenler (availability 500, download 503)                                                                                                                                                     |
| axe (WCAG 2.1 AA, tüm sayfa)                                                                               | 40 tam sayfa görünüm + 4 audit diyaloğu (bölge taraması) = 44 görünümde **0 ihlal**                                                                                                                             |
| Yatay taşma                                                                                                | 44 görünümde **0** (375 px dahil)                                                                                                                                                                               |
| Kırık link                                                                                                 | Yok. Karşılama sayfasında 2 link var: `mailto:` (kötüye kullanım) ve indirme `…/agent/download?ref=…&os=macos`. İndirme **302** veriyor, `Location` `…/downloads/Destek-<8 hane>.zip`                           |
| İndirme parametresi                                                                                        | `os=linux`, `os=`, `os=MACOS` → 400. `os=macos&os=windows` → 404 (sahte API davranışı; gerçek sunucuda doğrulanmadı)                                                                                            |
| Klavye                                                                                                     | Tab ile 5. adımda "Hızlı Destek uygulamasını indir"e ulaşılıyor, odak çizgisi görünür (`karsilama-prod-1280-light-odak.png`)                                                                                    |
| İkonlar                                                                                                    | İndir `Download`, rehber `CircleHelp`, Ekran Kaydı `ScreenShare`, Erişilebilirlik `MousePointerClick`, doğrula `FileCheck2`, tarayıcı `ScreenShare`; uyarılarda `TriangleAlert`. Hepsi anlamlı ve aynı setten   |

## Bulgular (öncelik sırasıyla)

### [ORTA] O-1 Konsol üst barı ve lobi, macOS müşterisini "Hızlı Destek (Windows)" diye gösteriyor

Sayfa/akış: teknisyen konsolu `/sessions/<id>/console` üst bar + lobi paneli; macOS istemcisiyle bağlanan müşteri.
Adımlar: 1. macOS istemcisiyle (`clientOs: "macos"`) oturuma katıl. 2. Konsolda müşteri adının altındaki türe bak (lobide "Kabul et" satırında da aynı metin var).
Beklenen: işletim sistemini belirtmeyen ya da doğru OS'u gösteren bir metin. Mimari §4.3'e göre OS rozeti "Sonra"; bu yüzden şimdilik nötr "Hızlı Destek uygulaması" yeterli.
Gerçekleşen: etiket sabit. `apps/web/messages/tr.json:301` `"cl.kindAgent": "Hızlı Destek (Windows)"`, kullanıldığı yerler `console-header.tsx:75` ve `components/console/lobby-panel.tsx:82` (`guest.kind === "AGENT"` → her zaman "(Windows)"). Aynı ekranda P28f'e özgü "Müşteri erişilebilirlik izni vermedi" (yalnız macOS'ta oluşur) mesajı da görünüyor. Teknisyen müşteriyi Windows sanıp yanlış kısayol (Ctrl/⌘, F12/fn) ya da yanlış yönlendirme verebilir.
Kanıt: kod satırları yukarıda. `konsol-os-permission-1280-light.png` etiketin konumunu gösteriyor. Sahte istemci Windows olduğu için görüntü tek başına çelişkiyi kanıtlamıyor; çelişki koddan çıkıyor. Gerçek macOS istemcisiyle teyit elle listede E-W1.
Atanan: frontend-dev

### [DÜŞÜK] D-1 1280 px konsolda bildirim (toast) sohbet "Gönder" düğmesinin üstüne biniyor

Sayfa/akış: konsol, 1280×900, OS_PERMISSION (aynı durum her toast'ta oluşur, P28f'e özgü değil).
Adımlar: 1. "Kontrol iste". 2. Müşteri `control.state{VIEW, OS_PERMISSION}` gönderir.
Beklenen: toast sohbet giriş alanını ve Gönder düğmesini örtmemeli.
Gerçekleşen: sağ alttaki toast yaklaşık 4 sn boyunca Gönder düğmesinin alt yarısını ve mesaj kutusunun sağ alt köşesini örtüyor. Kapat düğmesi var ve toast kendiliğinden kayboluyor; bu yüzden etkisi düşük.
Kanıt: `docs/img/p28f/konsol-os-permission-1280-light.png`, `…-1280-dark.png`
Atanan: frontend-dev

### [DÜŞÜK] D-2 503 NOT_READY sonrası macOS kurulum rehberi görünmeye devam ediyor

Sayfa/akış: karşılama `/session/<token>`, Mac UA, indirme 503 NOT_READY.
Adımlar: 1. "Hızlı Destek uygulamasını indir". 2. "Hızlı Destek şu anda indirilemiyor" uyarısı çıkar.
Beklenen: indirme mümkün değilken müşteriyi tarayıcı yoluna odaklamak. Rehber ya gizlenmeli ya da daraltılmalı.
Gerçekleşen: uyarı ve "Tarayıcıdan devam et" düğmesi doğru çalışıyor (odak ad alanına gidiyor; e2e yeşil). Ancak birincil indirme kartı ve 4 adımlık "Mac'te nasıl açılır" rehberi tam boy görünmeye devam ediyor. Müşteri indiremediği bir uygulamanın izin adımlarını okuyor.
Kanıt: `docs/img/p28f/karsilama-not-ready-503-1280-light.png`, `…-375-dark.png`
Atanan: frontend-dev

## Akış sonuçları

| Akış                                                               | Sonuç    | Not                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac UA, availability `{macos:true, macosTestBuild:false}` (prod)   | ✅       | Birincil "Hızlı Destek uygulamasını indir" (`data-os=macos`), "macOS 13 veya üstü · Apple Silicon ve Intel". Rehber `data-build=signed`: notarize metni, "Yine de Aç" adımı yok, "Nokta Destek hiçbir zaman 'Yine de Aç' istemez" uyarısı var. Doğrulama kodu ve sunucu adresi rehberde. SmartScreen rehberi yok. İkincil: "Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş" |
| Mac UA, `macosTestBuild:true` (staging)                            | ✅       | "TEST SÜRÜMÜ — imzasız" uyarısı. Rehber `data-build=test`, 2. adım "Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç". "asla istemez" uyarısı yok (S-P28f-8)                                                                                                                                                                                                                          |
| Mac UA, `macos:false`                                              | ✅       | İndirme kartı ve rehber yok. Birincil "Yalnız ekranımı tarayıcıdan paylaş"                                                                                                                                                                                                                                                                                                               |
| availability 500 / ağ hatası (abort) / şema dışı (e2e) / 429 (e2e) | ✅       | Fail-closed, yalnız tarayıcı yolu (S-P28f-15). Hata metni gösterilmiyor (tasarım gereği sessiz düşüş)                                                                                                                                                                                                                                                                                    |
| availability bekleniyor                                            | ✅       | İndirme yerine iskelet var, tarayıcı yolu kullanılabilir. Yanıt gelince kart beliriyor (e2e)                                                                                                                                                                                                                                                                                             |
| İndirme `os=macos`                                                 | ✅       | `Destek-<8 hane>.zip`. "İndirme başladı" durumu, rehber vurgulu (`border-primary`), URL değişmiyor                                                                                                                                                                                                                                                                                       |
| İndirme 503 NOT_READY                                              | ✅ (D-2) | "Hızlı Destek şu anda indirilemiyor" + "Tarayıcıdan devam et" → odak ad alanında                                                                                                                                                                                                                                                                                                         |
| iPad (Macintosh UA + dokunmatik)                                   | ✅       | Mac sayılmıyor, indirme yok (e2e)                                                                                                                                                                                                                                                                                                                                                        |
| Windows UA regresyonu                                              | ✅       | `data-os=windows`, SmartScreen rehberi, mac rehberi yok                                                                                                                                                                                                                                                                                                                                  |
| Konsol OS_PERMISSION (1280/375, açık/koyu)                         | ✅ (O-1) | Şerit: "Müşteri erişilebilirlik izni vermedi. Müşteri izni verdikten sonra yeniden isteyin. · ss:dd · bu oturumda 4 istek hakkı kaldı". Kırpma yok. Toast aynı metinle geliyor, "Kontrol reddedildi" yok, "Kontrol iste" hemen etkin (30 sn bekleme yok). axe 0, taşma 0. Konsol açık temada da koyu: DESIGN.md "Konsol varsayılan koyu" (tercih Sistem iken), bulgu değil               |
| Audit detayı "İşletim sistemi (beyan)" (1280/375, açık/koyu)       | ✅       | `guest.pending{os:"macos"}` → "macOS", `{os:"windows"}` → "Windows", `{os:"browser"}` → "Tarayıcı". `session.join{os:"<b>x</b>"}` → satır **gösterilmiyor** (bilinmeyen değer; HTML yorumlanmıyor, ham JSON `<pre>`'de metin). `os`'suz eski satırlar etkilenmiyor (p11-admin yeşil, birim testi). Diyalog axe 0                                                                         |
| Kırık link                                                         | ✅       | Yok                                                                                                                                                                                                                                                                                                                                                                                      |

## Kabul kriterleri (uçtan uca; yalnız web tarafı)

| AC                                                                   | Durum   | Nasıl doğrulandı                                                                                                                      |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AC-396 macOS karşılama düzeni Windows ile aynı                       | ✅      | Keşif 36 görünüm + e2e "AC-396" (birincil indir + ikincil tarayıcı, `os=macos` → `.zip`, 375 koyu / 1280 açık axe 0, iPad)            |
| AC-390 indirme yalnız `macos:true` iken; hata → tarayıcı (web kısmı) | ✅      | `macos:false`, 500, abort, 429, şema dışı, 503 NOT_READY senaryoları. İmza/notarization kısmı ELLE (E-K2)                             |
| AC-391 izin rehberi + OS_PERMISSION metni (web kısmı)                | ✅      | Rehberde Ekran Kaydı + Erişilebilirlik kartları. Konsolda OS_PERMISSION metni, ret yok, bekleme yok. Gerçek TCC akışı ELLE (E-T1..T6) |
| S-P28f-8 prod sayfası "Yine de Aç" istemez                           | ✅      | prod `data-build=signed` metni; test bandı yalnız `macosTestBuild:true`                                                               |
| S-P28f-15 availability fail-closed; audit `os` yalnız beyan          | ✅      | Hata senaryoları + audit bilinmeyen değer gizleniyor                                                                                  |
| AC-389, AC-392, AC-393, AC-394, AC-395                               | ⏳ ELLE | Web tarafında karşılığı yok. Aşağıdaki listede, hiçbiri koşulmadı                                                                     |

## Görsel gözlemler (ekran görüntülerinden)

- `karsilama-prod-1280-light.png`, `karsilama-prod-375-dark.png`: indirme kartı birincil (kalın çerçeve), rehber hemen altında. 1–4 numaralı adımlar hizalı. İzin kartları iç içe girintili, okunaklı. Sarı "Yine de Aç istemez" uyarısı iki temada da kontrastlı. Logo koyu temada açık zemin kartında (§1.5 kuralı). Güncel derlemede Mikrofon kartı yok (yalnız Ekran Kaydı + Erişilebilirlik); bu, r3 "macOS'ta ses yok" ile uyumlu.
- İkincil tarayıcı kartı, ad/onay girilmeden soluk (devre dışı) görünüyor; altında "Devam etmek için adınızı yazın ve aydınlatma metnini onaylayın." açıklaması var. Tutarlı.
- "Önerilen · tam destek" rozeti macOS'ta da aynı. macOS istemcide sesli görüşme yok (r3), yani "tam destek" ifadesi Windows'a göre biraz iddialı. Kartın açıklaması ("ekranınızı görür; sohbet ve dosya") doğru; bulgu sayılmadı, teknik-yazar/frontend bilgisine.
- `karsilama-testbuild-375-dark.png`: TEST SÜRÜMÜ bandı indirme kartının hemen altında, rehberden önce. 2. adım başlığı uzun ("macOS uygulamayı engellerse: Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç") ve 375'te 2 satıra kırılıyor; taşma yok.
- `karsilama-loading-1280-light.png`: iskelet üç çubuk, yükseklik indirme kartına yakın. Yanıt gelince düzen kayması küçük.
- `karsilama-macos-false-1280-light.png`: "Nasıl bağlanmak istersiniz?" altında tek kart var; boşluk dengeli.
- `konsol-os-permission-375-light.png`: araç çubuğu iki satıra kırılıyor, OS_PERMISSION notu "Kontrol iste" altında tam okunuyor. Toast alt kenarda, içerikle çakışmıyor (sahne aşağıda).
- `konsol-os-permission-1280-*.png`: D-1 (toast Gönder düğmesinin üstünde).
- `audit-os-macos-375-dark.png`: diyalog kaydırılabilir. "İşletim sistemi (beyan)" etiketi IP satırının altında. Değer düz metin, JSON `<pre>` içinde.

## P28f elle (kullanıcı) listesi

Kaynaklar: `docs/mimari-p28f.md` §14 elle listesi (r3), `docs/qa-raporu.md` "P28f Tur 1" → "ELLE", `docs/runbook.md` §28f.6, `docs/implementation.md` "P28f K2/K3 Elle listede kalanlar" ve "Elle (a)–(d)", `docs/guvenlik-raporu.md` "P28f Kod turu 3 — Prod öncesi elle şart".
**Hiçbiri koşulmadı. Sonuç sütunu boş bırakıldı; uydurma sonuç yok.** Ortam: staging (185.126.217.99:4450) TEST paketi (ad-hoc, `net.noktabilisim.destek.stg`) ve imza gelince prod adayı. Her test öncesi `tccutil reset ScreenCapture net.noktabilisim.destek.stg; tccutil reset Accessibility net.noktabilisim.destek.stg`. "Prod kapısı" sütunu: **Z** = prod öncesi zorunlu (güvenlik/qa şartı), **K** = AC kanıtı için gerekli.

| #                                             | Madde                                                                                                                                                   | Kaynak                                    | Beklenen                                                                                                                                                                                      | Kapı | Sonuç (GEÇTİ/KALDI · ortam · tarih)      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------- |
| **Güvenlik — prod öncesi şart**               |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-G1                                          | Fare Tuşları Sistem Ayarları'ndan açıkken (gerçek bundle) `defaults read com.apple.universalaccess mouseDriver`                                         | güvenlik tur 3 (a), impl. düzeltme 1      | `1`. Değilse `MouseKeysOn` doğru anahtara taşınır (ör. `History.MouseKeys` son `State`) ve sonuç `implementation.md`'ye yazılır. Not: geliştirme Mac'inde (26.3.1) anahtar yok                | Z    | ELLE — yapılmadı                         |
| E-G2                                          | Fare Tuşları ile üretilen tıklamada `localClick` alan değerleri (PID, StateID, UserData) kaydı                                                          | güvenlik tur 3 (b), tur 2 m.4b, impl. (b) | Değerler kayda geçer. Sahte kaynak tıklaması `localClick`'te reddedilir                                                                                                                       | Z    | ELLE — yapılmadı                         |
| E-G3                                          | Oturum ortasında Fare Tuşları açılır, tuş takımı 5 ve `I` enjekte edilir                                                                                | impl. (a)                                 | ≤ 2 sn içinde düşer. Pano anahtarı ve kontrol diyaloğunda 0 kabul. Bundle `com.apple.universalaccess`'i okuyamazsa tuş takımı ve harfler sürekli düşer (fail-closed); bu durum buraya yazılır | Z    | ELLE — yapılmadı                         |
| E-G4                                          | Oturum penceresi taşınır, pano anahtarına enjekte tıklama                                                                                               | impl. (c)                                 | Pencere üstünde düşer, pencere dışında geçer                                                                                                                                                  | Z    | ELLE — yapılmadı                         |
| E-G5                                          | S-P28f-1 sahte kaynaklar: Fare Tuşları, VoiceOver VO-Space, başka süreçten AXPress, HID kaynaklı sentetik tıklama; eller çekiliyken 60 sn sentetik akış | mimari §14 m.5, qa AC-392, runbook §28f.6 | %100 ret, 0 kabul. Gerçek fiziksel tıklama kabul edilir                                                                                                                                       | Z    | ELLE — yapılmadı                         |
| E-G6                                          | S-P28f-2 gösterge: ⌘H, başka uygulamadan ⌘⌥H, ⌘M, tam ekran, Görev Kontrolü, Sahne Yöneticisi, ekran takma/çıkarma                                      | mimari §14, qa AC-392 (AC-103)            | Gösterge ≤ 1 sn içinde geri gelir ya da kapı kapanır                                                                                                                                          | Z    | ELLE — yapılmadı                         |
| E-G7                                          | TEST bandının gerçek pencerede gizlenemezliği (ad-hoc / Team ID boş / farklı)                                                                           | qa AC-390                                 | Bant her zaman görünür                                                                                                                                                                        | K    | ELLE — yapılmadı                         |
| **Kurulum / açılış (AC-389, AC-390, AC-395)** |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-K1                                          | Safari ve Chrome ile indir → çift tık → karşılama                                                                                                       | qa AC-389                                 | ≤ 5 sn. Yönetici şifresi istenmez. İndirilenler'den çalışır                                                                                                                                   | K    | ELLE — yapılmadı                         |
| E-K2                                          | Prod paketi `spctl -a -vv`                                                                                                                              | qa AC-390                                 | "Notarized Developer ID". "Yine de Aç" gerekmez (Apple hesabı açılınca; R39)                                                                                                                  | Z    | ELLE — yapılmadı (imza yok)              |
| E-K3                                          | macOS 13 ve 14 (VM) + `arch -x86_64` dilimi / gerçek Intel                                                                                              | qa AC-389, runbook §28f.6                 | Açılır, karşılama gelir                                                                                                                                                                       | K    | ELLE — yapılmadı                         |
| E-K4                                          | Staging "Yine de Aç" yolu (macOS 15+ parola)                                                                                                            | runbook §28f.6                            | Sayfadaki TEST rehberi adımlarıyla açılır                                                                                                                                                     | K    | ELLE — yapılmadı                         |
| E-K5                                          | `sign-mac` + `attest-mac` + Release SHA256SUMS/attestation                                                                                              | qa AC-395                                 | CI yeşil, Release'te macOS satırı ve attestation var                                                                                                                                          | Z    | ELLE — yapılmadı (etiket + Apple hesabı) |
| **TCC izin akışı (AC-391)**                   |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-T1                                          | Ekran Kaydı izni yok → rehber → "Sistem Ayarları'nı aç" → izin → "İzni verdim, yeniden başlat"                                                          | mimari §14, qa AC-391                     | Uygulama `open -n --restart` ile döner. Kod korunur: hem klasör adından gelen hem elle girilen kod                                                                                            | K    | ELLE — yapılmadı                         |
| E-T2                                          | Aynı rehberde "Vazgeç"                                                                                                                                  | qa AC-391                                 | Temiz kapanış, iz yok                                                                                                                                                                         | K    | ELLE — yapılmadı                         |
| E-T3                                          | Erişilebilirlik izni yok, teknisyen "Kontrol iste"                                                                                                      | mimari §14, qa AC-391                     | Müşteride rehber. Teknisyende "Müşteri erişilebilirlik izni vermedi…", ret değil, 30 sn bekleme yok (web kısmı bu turda ✅)                                                                   | K    | ELLE — yapılmadı                         |
| E-T4                                          | Erişilebilirlik izni oturum sırasında verilir                                                                                                           | qa AC-391, impl. K3                       | Yeniden başlatmadan kontrol çalışır                                                                                                                                                           | K    | ELLE — yapılmadı                         |
| E-T5                                          | Olay musluğu yalnız Erişilebilirlik izinli bundle'da kurulur                                                                                            | qa AC-391, impl. K3                       | İzin yokken musluk yok, kapı açılmaz                                                                                                                                                          | K    | ELLE — yapılmadı                         |
| E-T6                                          | Gerçek `.app` kimliğiyle Ekran Kaydı izni (spike'ta izin barındıran uygulamaya atfedilmişti)                                                            | impl. K2                                  | İzin `net.noktabilisim.destek(.stg)`'ye atanır                                                                                                                                                | K    | ELLE — yapılmadı                         |
| **Girdi / ekran (AC-392)**                    |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-I1                                          | Fiziksel Control+Shift+F12 / F11, `.app` içinden, uygulama arka plandayken (AC-102)                                                                     | mimari §14 m.4                            | Kontrol durur. Sentetik tuş bunu tetiklemiyor; yalnız fiziksel tuşla doğrulanır                                                                                                               | K    | ELLE — yapılmadı                         |
| E-I2                                          | AC-105 kilit ekranı / hızlı kullanıcı değiştirme                                                                                                        | qa AC-392, impl. K2                       | Konsolda "Müşteri güvenli masaüstünde". Kilit açılınca görüntü geri gelir                                                                                                                     | K    | ELLE — yapılmadı                         |
| E-I3                                          | AC-105 parola alanına odak (`IsSecureEventInputEnabled`)                                                                                                | impl. (d), qa Tur 2                       | Konsol uyarısı ≤ 1 sn                                                                                                                                                                         | K    | ELLE — yapılmadı                         |
| E-I4                                          | AC-106 iki monitör, monitör değiştirme, işaretleme doğru ekranda; ekran çıkarma; harici ekran (negatif köken)                                           | qa AC-392, impl. K2/K3                    | Sıra, `MonitorRect` ve işaretleme doğru. Çıkarmada yeniden açılır                                                                                                                             | K    | ELLE — yapılmadı                         |
| E-I5                                          | AC-107 kapanış                                                                                                                                          | qa AC-392                                 | ≤ 3 sn                                                                                                                                                                                        | K    | ELLE — yapılmadı                         |
| E-I6                                          | AC-110 Retina + ölçekli çözünürlük, kip değişimi                                                                                                        | qa AC-392, impl. K2                       | Koordinat ±1–2 px, görüntü bozulmaz                                                                                                                                                           | K    | ELLE — yapılmadı                         |
| E-I7                                          | Tekerlek yönü; Türkçe Q klavyede metin; ⌘C/⌘V gerçek uygulamada (Ctrl→⌘ eşlemesi)                                                                       | qa AC-392, impl. K3                       | Doğru yön, doğru karakterler, kısayollar çalışır                                                                                                                                              | K    | ELLE — yapılmadı                         |
| E-I8                                          | AC-100 Tab / VoiceOver ile istemci pencerelerinde gezinme                                                                                               | qa AC-392                                 | Tüm denetimlere klavyeyle ulaşılır                                                                                                                                                            | K    | ELLE — yapılmadı                         |
| E-I9                                          | AC-98/125 karşılama penceresi (istemci)                                                                                                                 | qa AC-392                                 | Metinler ve teknisyen doğrulama kodu doğru                                                                                                                                                    | K    | ELLE — yapılmadı                         |
| E-I10                                         | Annex-B Chrome konsolunda çözülür, 709 renk etiketi doğru                                                                                               | impl. K2, K0s-2                           | Renk kayması yok                                                                                                                                                                              | K    | ELLE — yapılmadı                         |
| E-I11                                         | App Nap: uygulama arka planda, 10 dk oturum                                                                                                             | mimari §14 m.3                            | fps düşmez                                                                                                                                                                                    | K    | ELLE — yapılmadı                         |
| E-I12                                         | AC-117 karantinalı dosyada Gatekeeper uyarısı                                                                                                           | qa AC-392                                 | İndirilen dosya açılışında macOS uyarısı                                                                                                                                                      | K    | ELLE — yapılmadı                         |
| **P28a–P28e uyumu (AC-393)**                  |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-U1                                          | Pano iki yön + gizli içerik uyarısı + Evrensel Pano'ya gitmeme                                                                                          | qa AC-393                                 | Metin geçer, gizli içerik işaretlenir, Evrensel Pano'ya sızmaz                                                                                                                                | K    | ELLE — yapılmadı                         |
| E-U2                                          | Gerçek CUPS yazdırma ve "yazıcı yok" (r4: sayfa sayısı "yazıcıda belirlenir", yazıcı "Varsayılan yazıcı")                                               | qa AC-393, mimari r4                      | Yazdırılır. Yazıcı yoksa onaydan sonra "yazıcı yok"                                                                                                                                           | K    | ELLE — yapılmadı                         |
| E-U3                                          | P28b sunucu dosyası + İndirilenler TCC istemi                                                                                                           | qa AC-393                                 | Dosya karantinalı yere iner                                                                                                                                                                   | K    | ELLE — yapılmadı                         |
| E-U4                                          | P28c roster + "Çıkar"                                                                                                                                   | qa AC-393                                 | Liste doğru, çıkarma çalışır                                                                                                                                                                  | K    | ELLE — yapılmadı                         |
| E-U5                                          | P28e rıza kutusu + "Kaydı durdur"                                                                                                                       | qa AC-393                                 | Rıza sorulur, durdurma çalışır                                                                                                                                                                | K    | ELLE — yapılmadı                         |
| E-U6                                          | Ses: macOS `rs.cap.voice1` bildirmez (r3; A-PF-1 kullanıcı kararı bekliyor)                                                                             | qa AC-393                                 | Konsolda sesli görüşme macOS müşteride sunulmaz                                                                                                                                               | K    | ELLE — yapılmadı                         |
| **İz (AC-394)**                               |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-Z1                                          | Oturum sonrası `trace-check-mac.sh compare` (Metal önbelleği `DARWIN_USER_CACHE_DIR/<bundle id>`, `$TMPDIR` yeniden başlatma dosyası, `log show`)       | mimari §14 m.3, qa AC-394                 | İz 0                                                                                                                                                                                          | K    | ELLE — yapılmadı                         |
| E-Z2                                          | `tccutil reset ScreenCapture/Accessibility <bundle id>` ya da Sistem Ayarları "−"                                                                       | qa AC-394, runbook §28f.6                 | Kayıt silinir; kılavuzdaki adımla aynı                                                                                                                                                        | K    | ELLE — yapılmadı                         |
| **Web ↔ gerçek istemci**                      |                                                                                                                                                         |                                           |                                                                                                                                                                                               |      |                                          |
| E-W1                                          | Gerçek macOS istemcisiyle konsol üst barı / lobi türü (O-1) ve audit "İşletim sistemi (beyan)" = macOS                                                  | bu tur                                    | O-1 düzeltildikten sonra "(Windows)" görünmez. Audit `guest.pending` satırında "macOS"                                                                                                        | K    | ELLE — yapılmadı                         |

---

# Test Raporu — P28d (sesli görüşme; web arayüzü)

DURUM: DÜZELTİLMELİ. Bir YÜKSEK bulgu var: 1280 px konsol başlığında ses yuvası "Uzaktan kontrol" ile "Oturumu bitir" düğmelerini üst üste bindiriyor. Bir ORTA bulgu var: 375 px'te ses bildirimleri 5 px yatay taşma yapıyor. 5xx yok, JS hatası (pageerror) yok, axe ihlali yok, test edilen hiçbir AC ❌ değil.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` / `e2e/mock-ws.mjs` (:4217), dal `p28d` @ `68222ba`, 2026-11-17, Chromium (Playwright 1.65).

- **Betikler:** `docs/test-raporu/e2e/p28d/zz-p28d-op.spec.ts` (akış + ekranlar), `zz-p28d-olcum.spec.ts` (başlık ölçümü) ve `p28d-op.config.ts`. Koşu için `apps/web/` altına geçici kopyalandı, sonra silindi.
- **Ham sonuç:** `tarama.jsonl`, `olcum.jsonl`. Ekran görüntüleri `docs/img/p28d/` altında (11 dosya, 644 KB).
- **Kapsam dışı:** Windows istemcisi, gerçek mikrofon ve Windows tarafındaki AC-377 elle doğrulanacak (runbook §28d.7). Çok teknisyenli ses görünümleri (`canJoin`, `listening`, `noPerm`, `otherPending`, AC-378) birim testi ve staging ile doğrulanacak; sahte WS tek teknisyen bağlıyor.
- **Temizlik:** başlatılan süreçler kapatıldı, 3217/4217 boş. Çalışma ağacında bu turdan yalnız `docs/` altındaki dosyalar var. `apps/agent-win/.../third_party_notices.txt`, `NOTICE`, `docs/implementation.md` ve `docs/pdf/*` değişiklikleri bu tura ait değil.

## Özet

| Ölçüt                                    | Sonuç                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm web e2e (`playwright test`), bir kez | **564 geçti, 0 düştü, 242 atlandı** (2,5 dk). `p28d-voice.spec.ts` desktop'ta 6/6 yeşil. AC-376 @perf (desktop-perf) yeşil. Mobil projede P28d testlerinin hepsi `desktopOnly` olduğu için atlandı; mobil kapsamı bu turda 375 px ile tamamlandı.                                                   |
| Keşif turu                               | 6 senaryo (akış ×2 genişlik, onaysız/aygıt ×2, kopma, Permissions-Policy). 60 görünüm: açık/koyu × 1280/375, konsol + misafir.                                                                                                                                                                      |
| Konsol / pageerror                       | Konsol ve misafir sayfasında hata/uyarı **0**, pageerror **0**. Tek 4xx: `/r/ornek-firma` 404 (sahte API'de ref yok; beklenen).                                                                                                                                                                     |
| 5xx                                      | 0                                                                                                                                                                                                                                                                                                   |
| axe (WCAG 2.1 AA, bölge)                 | 60 görünümde **0 ihlal**. Kapsananlar: konsol boşta / bekleniyor / görüşmede / sessizde / tüm bildirimler, kalite paneli, misafir diyaloğu, çubuk (açık + sessizde), onaysız ve aygıt uyarıları.                                                                                                    |
| Taşma                                    | 375'te konsol bildirim durumlarında **5 px** (ORTA-1). 1280'de belge taşması yok, ancak başlık içinde öğeler üst üste biniyor (YÜKSEK-1).                                                                                                                                                           |
| İkonlar                                  | Anlamlı: Sesli görüşme `Phone`, bekleniyor `PhoneOutgoing`, katıl `PhoneIncoming`, mikrofon `Mic`/`MicOff`, bitir `PhoneOff`, dinleme `Headphones`, duyuru `Ear`, kulaklık önerisi `Headphones`.                                                                                                    |
| Permissions-Policy                       | `/r`, `/r/ornek-firma` → `microphone=()`; `/login`, `/sessions`, `/account`, konsol, misafir `/session/…` → `microphone=(self)`. `camera=()` her yerde. Gerçek gezinmede `document.featurePolicy.allowsFeature("microphone")`: konsol, `/sessions` ve misafir **true**, `/r/ornek-firma` **false**. |

## Bulgular

### [YÜKSEK] Y-1 1280 px konsol başlığı: ses yuvası "Uzaktan kontrol"u "Oturumu bitir"in üstüne taşıyor, müşteri adı okunmuyor

Sayfa/akış: teknisyen konsolu `/sessions/<id>/console`, tarayıcı misafiri bağlı, 1280×900 (TEST-P4-4 tek satır hedefi; `xl:flex-nowrap`).

Adımlar:

1. Ses yetkili teknisyen (`u-p28d-*`) oturum açar ve misafiri kabul eder; durum "Aktif" olur.
2. a) Mikrofon izni reddedilmişken "Sesli görüşme"ye basın (`micDenied` bildirimi), veya b) görüşmeyi başlatın (`talking`: "Mikrofon açık" + iki ikon düğme).

Beklenen: başlık tek satır kalır, düğmeler çakışmaz, müşteri adı ve "Müşteri tarayıcı modunda…" ipucu okunur.

Gerçekleşen:

- (a) "Uzaktan kontrol" sarmalayıcısı 71 px'e sıkışıyor. İçindeki 162 px'lik düğme x=1008–1170 aralığına taşıyor ve "Oturumu bitir"in (x=1091–1235) üstüne çiziliyor.
- `elementFromPoint` ile ölçüldü: "Oturumu bitir"in görünen sol yarısına (x≈1130–1154) tıklama `console-control`'e gidiyor. Bitir düğmesi soluk görünüyor.
- Müşteri adı bloğu 33 px'e iniyor ("A…", 8 satır).
- (b) Görüşmede "Müşteri tarayıcı modunda" ipucu "Oturumu bitir"in altında kalıyor, ad "A…" oluyor.
- Ses yuvası olmayan aynı ekranda (`u-plain`) başlık 74 px yüksek, ad bloğu 150 px ve çakışma yok. Bu fark P28d gerilemesi.
- Boşta durumda (yalnız "Sesli görüşme") bile ipucu 4 satıra kırılıyor ve ad "Ayşe …" diye kesiliyor. 1440 px'te çakışma yok.

Kanıt: `docs/img/p28d/konsol-mikrofon-izni-yok-1280-light.png`, `docs/img/p28d/konsol-gorusmede-1280-light.png`, `docs/test-raporu/e2e/p28d/olcum.jsonl` ("1280 micDenied", "1280 plain"). Mevcut e2e yakalamıyor, çünkü yalnız belge taşmasına bakıyor (0).

Atanan: frontend-dev

### [ORTA] O-1 375 px'te konsol ses bildirimleri belgeyi 5 px yatay taşırıyor

Sayfa/akış: konsol, 375×900.

Adımlar:

1. Mikrofon izni reddi, müşteri reddi, bekleme sürerken yenileme ("Çok fazla istek"), zaman aşımı veya müşteri aygıt hatası durumlarından birini oluşturun.
2. Ardından `scrollWidth - clientWidth` değerini ölçün.

Beklenen: 0.

Gerçekleşen: 5 px. `voice-controls` `shrink-0`, düğme (151 px) + `min-w-20 max-w-48` ipucu = 351 px, başlık iç genişliği ~343 px (sağ kenar 380 > 375). Boşta, bekleniyor ve görüşmede durumlarında taşma yok.

Kanıt: `docs/img/p28d/konsol-reddedildi-375-light.png` (ipucu sağ kenara değiyor), `tarama.jsonl` (`konsol-*-375` overflow 5).

Atanan: frontend-dev

### Gözlemler (bulgu değil)

- Misafir zaman aşımında bilgilendirilmiyor: diyalog sessizce kapanıyor. Konsol "Müşteri yanıt vermedi" gösteriyor. Tasarım gereği görünüyor, kayda geçti.
- Onaysız (unconfirmed) durum: Kabul sonrası sunucu yanıtı gelmezse misafir çubuğu ~5 sn "Mikrofon açık" gösteriyor. 5,4 sn'de mikrofon izi `ended` oluyor, çubuk kalkıyor, bilgi uyarısı çıkıyor (D-PD-K1-2'ye uygun). Uyarı konsol zaman aşımından sonra da kalıyor, yeni istekte kalkıyor.
- Çift tıklamayla "Kabul et"te diyalog kapanınca ikinci tık alttaki metni seçiyor (ekranda "Teknisyen" vurgulu). Zararsız, test kaynaklı.

## Akış sonuçları

| Akış                                                      | Sonuç | Not                                                                            |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| İzin reddi → istek gitmez, yönerge                        | ✅    | `micDenied`; voice.request 0 (e2e)                                             |
| İstek → misafir diyaloğu, odak Reddet, Kabul 1,5 sn kilit | ✅    | e2e kilit ölçümü; keşifte açılışta `disabled=true`, Tab ile Kabul'e geçilmiyor |
| İkinci istekte kilit yeniden                              | ✅    | açılışta `disabled=true`                                                       |
| Çift tıklama "Sesli görüşme"                              | ✅    | tek `voice.request` (1280 ve 375)                                              |
| Çift tıklama "Kabul et"                                   | ✅    | tek `voice.answer`, tek `getUserMedia`                                         |
| Kabul → iki tarafta "Mikrofon açık"                       | ✅    | konsol + misafir çubuğu                                                        |
| Sessize al (konsol + misafir)                             | ✅    | "Sessizde", iz `enabled=false`                                                 |
| Konsol bitirir → iki taraf mikrofon ≤ 1 sn                | ✅    | e2e; keşifte iki tarafta izler `ended`                                         |
| Müşteri bitirir → konsol `customerEnded`                  | ✅    | e2e                                                                            |
| Ret: Reddet / Esc / X düğmesi                             | ✅    | üçü de `rejected` bildirimi; ret mikrofon açmaz                                |
| Zaman aşımı (60 sn, kanca)                                | ✅    | konsol `timeout`, misafir diyaloğu kapanır                                     |
| Bekleme sürerken konsol yenileme                          | ✅    | düğme etkin; basınca sunucu `RATE_LIMITED` → "Çok fazla istek"                 |
| Onaysız (sunucu yanıtı düşer)                             | ✅    | ~5,4 sn'de mikrofon bırakılır, `voice-unconfirmed` uyarısı                     |
| Kabul sonrası mikrofon açılamaz                           | ✅    | misafir `voice-device` uyarısı, konsol `deviceEnded`                           |
| Görüşmede misafir sayfayı yeniler                         | ✅    | yenileme sonrası `getUserMedia` 0, konsol boşta, konsol mikrofonu bırakıldı    |
| Görüşmede konsol sekmesi kapanır                          | ✅    | misafir mikrofonu 8 ms'de `ended`, çubuk kalktı                                |
| Rızasız `voice.state{active}` (K-PD-2)                    | ✅    | e2e: mikrofon açılmaz, `voice.end{customer}`                                   |
| Eski istemci (voice1 yok)                                 | ✅    | e2e AC-379: pasif + AC-352 metni                                               |
| Kalite paneli "Ses kaybı"                                 | ✅    | "Ses kaybı %0" (1280, açık/koyu axe 0)                                         |
| 1280 başlık düzeni ses durumlarında                       | ❌    | Y-1                                                                            |
| 375 bildirim durumlarında taşma                           | ❌    | O-1                                                                            |

## Kabul kriterleri (uçtan uca, web tarafı; sahte API)

| AC                                              | Durum       | Nasıl doğrulandı                                           |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------- |
| AC-373 istek / diyalog / ret / zaman aşımı      | ✅          | e2e + keşif (Esc/X/çift tık/kilit yenileme)                |
| AC-374 aktif / sessize al / bitir ≤ 1 sn        | ✅          | e2e (ölçülü) + keşif                                       |
| AC-375 Opus + DTLS, kayıtta ses izi 0           | ✅          | e2e (SDP, WebM Tracks)                                     |
| AC-376 gecikme p95 < 325 ms, "Ses kaybı" satırı | ✅          | e2e @perf yeşil + kalite paneli                            |
| AC-377 (tarayıcı) mikrofon bırakma              | ✅          | e2e + kopma senaryoları; Windows yarısı elle (kapsam dışı) |
| AC-378 çoklu teknisyen sesi                     | kapsam dışı | birim + sunucu entegrasyon + staging                       |
| AC-379 eski istemci                             | ✅          | e2e                                                        |
| D-PD-1 Permissions-Policy                       | ✅          | başlık + `featurePolicy` (gerçek gezinme)                  |

Not: Y-1 ve O-1 AC davranışını bozmuyor, ancak 1280 tek satır (TEST-P4-4) ve 375 taşmasız standardını ihlal ediyor.

## Görsel gözlemler (ekran görüntülerinden)

- `konsol-mikrofon-izni-yok-1280-light.png`: "Uzaktan kontrol" düğmesi "Oturumu bitir"in üstüne biniyor, bitir düğmesi soluk. Ad "Tarayıcı · yalnız görüntü" dikey kırılıyor. İpucu başlığın sağ kenarına taşıyor (Y-1).
- `konsol-gorusmede-1280-light.png` / koyu: ad "A…", "Müşteri tarayıcı modunda" metni bitir düğmesinin altında (Y-1). "Mikrofon açık" hapı ve ikon düğmeler iki temada okunaklı.
- `konsol-kalite-1280-dark.png`: "Ses kaybı %0" satırı diğer satırlarla hizalı.
- `konsol-reddedildi-375-light.png`: bildirim metni sağ kenara dayanıyor (O-1). İki toast ("Sesli görüşme bitti · 1 sn", "Müşteri sesli görüşmeyi reddetti") alt kenarda üst üste, okunaklı.
- `misafir-diyalog-375-*.png`: diyalog ekrana sığıyor, başlık iki satır. "Kabul et" (birincil) üstte, "Reddet" altta, tam genişlik. Koyu temada kontrast yeterli (axe 0).
- `misafir-cubuk-375-light.png`, `misafir-cubuk-1280-light.png`, `misafir-cubuk-sessizde-375-dark.png`: çubuk sayfanın üstünde, "Konuşan: Mehmet Kaya". Düğmeler 375'te alt alta tam genişlik, 1280'de yan yana. Sessizde hapı nötr renk.
- `misafir-onaysiz-375-light.png`: bilgi uyarısı ekran paylaşımı şeridinin altında, okunaklı.

---

# Test Raporu — P28c K5 (çoklu teknisyen; web arayüzü)

DURUM: GEÇTİ. ENGELLEYİCİ, YÜKSEK ve ORTA bulgu yok, hiçbir AC ❌ değil. Tarama boyunca 5xx yok (yalnız bilerek enjekte edilenler), JS hatası (pageerror) yok, axe ihlali yok, taşma yok. İki DÜŞÜK bulgu ve birkaç gözlem var.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` (:4217), dal `p28c` @ `5675c1a`, 2026-11-17, Chromium.

- **Geçmiş katılımcıları için vekil:** sahte API'de katılımcı verisi yok. Sunucu tarafı istekler için geçirgen bir vekil kullanıldı (`docs/test-raporu/e2e/p28c-k5/history-proxy.mjs`, :4219). Vekil yalnız `GET /sessions/<RICH>/history` yanıtına 4 katılımcı ekler; ürün kodu değişmedi.
- **Betik:** `docs/test-raporu/e2e/p28c-k5/zz-k5-p28c.spec.ts` + `k5.config.ts`. Koşu için `apps/web/` altına geçici kopyalandı, sonra silindi.
- **Ham sonuç:** `tarama.jsonl`. Seçilmiş ekran görüntüleri `docs/test-raporu/e2e/p28c-k5/img/` altında.
- **Temizlik:** başlatılan süreçler kapatıldı (3217/4217/4219 boş).

## Özet

| Ölçüt                                                  | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm web e2e (`pnpm --filter @remote/web e2e`), bir kez | **556 geçti, 0 düştü, 235 atlandı** (2,2 dk). Atlananlar `desktopOnly` / proje ayrımı. Bilinen kararsız testlerin (S-P19-T12, p9-users, p13bl, AC-261, customers-csv-p19) hiçbiri düşmedi; tekrar koşu gerekmedi. TEST-P8-2 geçti. `p28c-multi.spec.ts` desktop + mobile yeşil.                                                                                                                                                              |
| Sayfa taraması                                         | 14 görünüm × açık/koyu × 1280/375 = **56 görünüm, 56 geçti**.                                                                                                                                                                                                                                                                                                                                                                                |
| Durum / klavye keşifleri                               | 5 senaryonun hepsi koştu. Bulgular aşağıda.                                                                                                                                                                                                                                                                                                                                                                                                  |
| HTTP                                                   | 4xx/5xx yalnız enjekte edilenler: `/sessions/active` 500, `invite-candidates` 500/409, davet POST 500, reddet 500. Panel kabuğunda P28c dışı kullanıcı `/sessions/active` 403 → bölüm gizli (beklenen).                                                                                                                                                                                                                                      |
| Konsol                                                 | Hata/uyarı yalnız enjekte edilen yanıtların "Failed to load resource" kaydı. pageerror 0.                                                                                                                                                                                                                                                                                                                                                    |
| axe (WCAG 2.1 AA)                                      | 56 görünümde bölge + sayfa taraması **0 ihlal**. Kapsananlar: koyu temada sahip rozeti `text-primary`/`bg-primary-surface`, "İzinsiz" çipi, `text-warning` pasiflik nedenleri, davet kartı, misafir listesi. Aktif liste yükleniyor/boş ve aday hata/409 durumları da 0.                                                                                                                                                                     |
| Taşma                                                  | Belge düzeyinde 0. Bölge içinde 0: uzun müşteri/teknisyen adı + `<script>` içeren satırlar `truncate` ile kırpılıyor, 375'te kartta sarılıyor.                                                                                                                                                                                                                                                                                               |
| İkonlar (lucide)                                       | Anlamlı ve tutarlı: Teknisyenler `Users`, Davet et `UserPlus`, Kontrolü ver `MousePointer2`, Oturumu devret `ArrowRightLeft`, Geri al `Undo2`, Ayrıl `LogOut`, Geri çek `X`, bağlantı yok `WifiOff`. Davet kartında Katıl `LogIn`, Reddet `UserX`, gözetimsiz `MonitorCog`. Etkin oturumlarda başlık/İzle `Eye`, izinsiz `EyeOff`, boş `MonitorSmartphone`. Aday arama `Search`, misafir Çıkar `UserX`, geçmişte `Users` / `ArrowRightLeft`. |
| XSS                                                    | `<script>alert(1)</script>` içeren müşteri adı, teknisyen adı ve katılımcı adı düz metin olarak çiziliyor; betik çalışmıyor (pageerror/dialog yok).                                                                                                                                                                                                                                                                                          |

## Bulgular

### [DÜŞÜK] D-1 "Reddet" 500 dönünce kart kayboluyor, sonraki yoklamada geri geliyor

Sayfa/akış: panel → davet bildirimi (`p28cinv`).

Adımlar:

1. `POST /sessions/invites/:id/reject` isteğini 500'e zorla.
2. "Reddet: SUNUCU-01" butonuna bas.
3. 5 sn bekle.

Beklenen: hata toast'ı çıkar, kart yerinde kalır (kullanıcı tekrar deneyebilir) ya da tutarlı biçimde düşer.

Gerçekleşen: "Beklenmeyen bir hata oluştu." toast'ı çıkıyor. Kart hemen düşüyor (2 → 1), sonraki yoklamada (5 sn) geri geliyor (→ 2). Kullanıcı reddettiğini sanır, kart "kendiliğinden" geri döner.

Kanıt: `tarama.jsonl` id `S-reddet-500` (`afterReject:1, afterPoll:2`); `img/durum-davet-reddet-500.png`.

Dosya: `apps/web/components/invite-notifier.tsx:88-90`. `finally { …; drop(i.inviteId) }` ifadesi 410 dışındaki hatalarda da kartı düşürüyor. Öneri: `drop` yalnız başarıda veya 410'da çağrılsın.

Atanan: frontend-dev

### [DÜŞÜK] D-2 Aynı kişiden gelen iki davet aynı toast metnini üretiyor

Sayfa/akış: panel, ilk yoklama. `p28cinv` hesabının Ayşe Sahip'ten iki daveti var.

Adımlar: `/sessions` sayfasını aç.

Beklenen: toast'lar ayırt edilebilir olsun (müşteri adı ya da "2 yeni davet").

Gerçekleşen: iki ayrı toast, ikisi de "Ayşe Sahip sizi bir oturuma davet ediyor". Kart listesi doğru, yani bilgi kaybı yok; yalnız gürültü.

Kanıt: `tarama.jsonl` `S-reddet-500.toastTxt`.

Dosya: `apps/web/components/invite-notifier.tsx:43` (`mt.newInvite` yalnız `from` alıyor).

Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                                                   | Sonuç        | Not                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Davet kartı → Katıl → katılımcı konsolu → panel (2 satır, sahip rozeti, Ayrıl onayı)                                   | ✅           | e2e + tarama, iki tema × iki genişlik                                                                                |
| Davet kartı → Reddet                                                                                                   | ✅           | 500'de D-1                                                                                                           |
| Süresi dolan davet kartı istemcide düşer                                                                               | ✅           | 3 sn'lik davet 4,5 sn sonra yok; boş bildirim alanı çizilmiyor                                                       |
| Etkin oturumlar → İzle (silent) → gerekçe (kısa → hata) → izleyici konsolu, sohbet salt okunur                         | ✅           |                                                                                                                      |
| Etkin oturumlar pasif nedenler: desteklemiyor / izinli gözetimsiz / dolu                                               | ✅           | `aria-describedby` neden metnine bağlı                                                                               |
| Etkin oturumlar yükleniyor → hata → Tekrar dene → liste; boş; yetkisiz (403) → bölüm gizli                             | ✅           | `img/durum-aktif-*.png`                                                                                              |
| Sahip: Davet et → arama → davet → bekleyen satır → koltuk dolu pasif → Geri çek                                        | ✅           |                                                                                                                      |
| Aday diyaloğu yükleniyor / hata + Tekrar dene / boş / 409 pasif uyarı / eşleşme yok                                    | ✅           | `img/durum-aday-*.png`                                                                                               |
| Davet POST 500 → diyalog açık kalır, FormError "Beklenmeyen bir hata oluştu."                                          | ✅           | `img/durum-davet-post-500.png`                                                                                       |
| Oturumu devret onayı (odak Vazgeç'te, Esc → odak tetikleyiciye döner)                                                  | ✅           |                                                                                                                      |
| Misafir "Bağlı teknisyenler": sahipte Çıkar yok, Çıkar onayı → listeden düşer                                          | ✅           | e2e (masaüstü). Tarama: iki tema × 1280/375, axe 0                                                                   |
| Geçmiş ayrıntısı Katılımcılar: rol, saat aralığı, "Müşteri çıkardı", "Ayrıldı", "Devir"                                | ✅           | Vekil fikstürüyle. Tek teknisyenli oturumda bölüm çizilmiyor ✅                                                      |
| Klavye: panel aç/kapa (Enter/Space), Tab ile Davet et'e erişim, diyalog odak tuzağı (8 Tab içeride), Esc + odak dönüşü | ✅           | Davet kartında Tab sırası Reddet → Katıl (kart başına)                                                               |
| Çevrimdışı teknisyen satırı (`WifiOff`)                                                                                | ⚠ kapsanmadı | Sahte WS'te `connected:false` roster fikstürü yok. Kod incelemesinde `text-danger` + ikon var, ekranda doğrulanmadı. |

## Kabul kriterleri (uçtan uca, arayüz)

| AC                                                  | Durum | Nasıl doğrulandı                                                                                     |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| AC-364 davet / bildirim / bekleyen davet / geri çek | ✅    | p28c-multi e2e + tarama + durum keşfi                                                                |
| AC-365 koltuk sınırı (Davet et pasif + neden)       | ✅    | e2e + `konsol-sahip` taraması                                                                        |
| AC-366 müşteri teknisyen listesi + Çıkar            | ✅    | e2e + `misafir-*` taraması                                                                           |
| AC-367 kontrol ver / geri al / devret onayı         | ✅    | e2e + `devret-onay` taraması (Kontrolü geri al butonu tetiklenmedi)                                  |
| AC-368 etkin oturumlar + İzle                       | ✅    | e2e + `aktif-*` + durumlar                                                                           |
| AC-369 geçmiş katılımcıları                         | ✅    | Vekil fikstürüyle `gecmis-katilimcilar` (4 görünüm). Not: mevcut e2e takımında bu bölümün testi yok. |
| AC-370 audit seçenek grubu                          | ✅    | e2e (tam takımda yeşil)                                                                              |
| AC-372 desteklemeyen istemci / izinli oda pasifliği | ✅    | e2e + `konsol-desteksiz` taraması + aday 409 uyarısı                                                 |
| AC-287 375 px taşma / axe                           | ✅    | 56 görünüm                                                                                           |

## Görsel gözlemler (ekran görüntülerinden)

- `aktif-uzun-ad-1280-dark.png`:
  - Uzun müşteri adı tek satırda "…" ile kırpılıyor.
  - "İzinsiz" çipi, teknisyen/başlangıç/"Teknisyen: 3/3" meta satırı ve sarı "Oturum dolu" nedeni okunaklı.
  - İzle butonu pasif görünümde.
  - Tablo yok (liste/kart), 1280'de taşma yok.
- `davet-uzun-ad-375-dark.png`: uzun ad ve `<script>` metni kart içinde sarılıyor; Reddet/Katıl butonları hedef boyutunda.
  - Gözlem: davet bildirimi breadcrumb ve h1'in **üstünde** çiziliyor (panel kabuğunda). Kasıtlı olabilir ama sayfa başlığını aşağı itiyor; mobilde ilk ekranı büyük ölçüde kaplıyor.
- `konsol-sahip-375-dark.png`:
  - Panel 2/3. Sahip rozeti mavi çip.
  - Kontrolü ver / Oturumu devret 375'te alt alta.
  - Bekleyen davet kesik çizgili satırda; geri çekme ikon butonu (`X`).
  - Pasif Davet et altında sarı neden metni.
  - "Kerem Yardımcı davet edildi" toast'ı panelin hemen altında; hiçbir kontrolü örtmüyor.
- `gecmis-katilimcilar-375-light.png`:
  - Katılımcılar bölümü düzgün sarılıyor.
  - "Müşteri çıkardı", "Ayrıldı", "Devir: 12:25:00" etiketleri ve "Oturum sonuna kadar" metni okunuyor.
  - Ekran görüntüsündeki ortadaki üst menü şeridi fullPage yapıştırma artefaktıdır (yapışkan başlık), ürün hatası değil.
- Diyaloglarda ilk odak:
  - Davet diyaloğunda kapat (X) butonunda; arama kutusunda olsa daha hızlı olurdu.
  - Gerekçe diyaloğunda bir butonda; gerekçe alanında olsa daha hızlı olurdu.
  - Bulgu değil, öneri.

---

# Test Raporu — P28e K10 (oturum kaydı; web arayüzü)

DURUM: DÜZELTİLMELİ. İki YÜKSEK bulgu var: "Kayıt yapılıyor" göstergesinde WCAG AA kontrast hatası (müşteri şeridi ve konsol rozeti). Ayrıca bir ORTA ve üç DÜŞÜK bulgu açık. 5xx yok (enjekte edilenler hariç), JS hatası (pageerror) yok, kırık iç link yok, 375 px'te yatay taşma yok. Staging'e dokunulmadı.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` (:4217), dal `p28e` @ `e911537`, 2026-11-16, yalnız Chromium. Betik: `docs/test-raporu/e2e/p28e-k10/zz-k10-p28e.spec.ts`. Koşu için `apps/web/e2e/` altına geçici olarak kopyalandı, sonra silindi. Ham sonuç: `tarama.jsonl`. Ekranlar scratch'te (136 PNG, kalıcı değil). Başlatılan süreçler kapatıldı (3217/4217 boş).

## Özet

| Ölçüt                                                                                  | Sonuç                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mevcut takım: `p28e-recording` + smoke (`auth`, `sessions`, `guest`), desktop + mobile | **119/119 geçti**, 7 atlandı. Atlananlar spec'te `desktopOnly`: mobilde 390 px tarama, Kaydı izle (MSE), 4 canlı kayıt akışı (rıza/durdur, 2 sn duraklatma, kota, teklif yok). Bir de `sessions` AC-61 testi mobilde atlandı.                                                                            |
| Regresyon `p8-history`, `p17-console`, `p28u-unattended`, `unattended`                 | **Koşulmadı.** Koordinatörün tur sınırı nedeniyle. K11 öncesi koşulmalı.                                                                                                                                                                                                                                 |
| Sayfa taraması: 31 görünüm × açık/koyu × 1440/375 = 124 + keşif E1–E9                  | 108 geçti, 21 kırmızı. Kırmızıların 12'si gerçek axe kontrast ihlali (aşağıda Y-1, Y-2). Kalanları, sıralı 1,2 saatlik koşuda canlı misafir/konsol akışlarındaki tarama betiği zaman aşımları (ürün hatası değil). Aynı akışlar mevcut spec'te yeşil. Bir kırmızı da E5 (O-1).                           |
| HTTP / konsol                                                                          | 31 görünümün hepsinde 200. Konsolda yalnız beklenen kayıtlar var: step-up 401, enjekte edilen 500, oynatıcı 429 ve 401. pageerror 0.                                                                                                                                                                     |
| axe (WCAG 2.1 AA)                                                                      | Ayarlar, geçmiş liste/detay, oynatıcı (hazır/yükleniyor/süresi doldu/hata), sil diyaloğu ve müşteri onay kutusu: 0 ihlal. **Müşteri "Kayıt yapılıyor" ve konsol rozeti: `color-contrast` ihlali.**                                                                                                       |
| 375 px taşma                                                                           | 0 (tüm görünümler)                                                                                                                                                                                                                                                                                       |
| İkonlar (lucide)                                                                       | Ayarlar sekmesi `Video` (aria-current=page), listedeki "Kayıt" işareti `Video` (`aria-label="Kayıtlı"`), Kaydı izle `Play`, Kaydı sil `Trash2`, silindi `Eraser`, gösterge `CircleDot`, Kaydı durdur `CircleStop`, onay kutusu `Video`. Breadcrumb'da `House` + `ChevronRight` var (DESIGN.md'ye uygun). |
| 5 durum                                                                                | Ayarlar: yükleniyor / hata / salt okunur / doğrulama hatası / başarı ✅. Liste (`?recorded=true`): dolu / boş / hata ✅. Detay meta: yükleniyor (iskelet) / hata (Tekrar dene) / silindi / yetkisiz ✅. Oynatıcı: loading / throttled (429) / expired ("Devam et") / error / ready ✅.                   |

## Bulgular

### [YÜKSEK] Y-1 Müşteri şeridinde "Kayıt yapılıyor" metni AA kontrastını karşılamıyor

Sayfa/akış: müşteri sayfası, rızalı kayıt sürerken (ve "Kayıt durdurulamadı, paylaşım duraklatıldı" durumunda).

Adımlar:

1. `p28ec` senaryosuyla oturum aç.
2. Müşteri adı, aydınlatma ve kayıt rızasını işaretle, sonra katıl.
3. Teknisyen kabul etsin, ardından Paylaş.
4. axe çalıştır.

Beklenen: kontrast ≥ 4.5:1 (AC-382'deki gizlenemeyen gösterge; müşteri tarafında en kritik metin).

Gerçekleşen: `color-contrast: .text-control-frame` ihlali çıkıyor. Kırmızı metin açık yeşil "paylaşılıyor" şeridinin üzerinde. Sonuç açık/koyu × 1440/375 dört varyantta da aynı.

Kanıt: `tarama.jsonl` id `musteri-kayit-suruyor`, `musteri-paylasim-duraklatildi`; ekran `musteri-kayit-suruyor-375-light.png` (scratch).

Dosya: `apps/web/components/guest/share-strip.tsx:25` (`text-control-frame`). Token ya da zemin değişmeli.

Not: mevcut e2e'nin axe taraması bu durumu kapsamıyor (yalnız ayar ve detay sayfası).

Atanan: frontend-dev

### [YÜKSEK] Y-2 Konsol "Kayıt yapılıyor" rozeti AA kontrastını karşılamıyor

Sayfa/akış: `/sessions/:id/console`, rızalı kayıt sürerken.

Adımlar: Y-1'deki 1–3. adımlar, ardından konsol sayfasında axe.

Gerçekleşen: `color-contrast: .self-start` (rozet `bg-danger-surface` + `text-control-frame`; içindeki "· Müşteri rızası" `text-fg-muted`). Dört varyantta da var.

Kanıt: `tarama.jsonl` id `konsol-kayit-suruyor`.

Dosya: `apps/web/components/console/rec-indicator.tsx` (rozet `className`).

Atanan: frontend-dev

### [ORTA] O-1 "Kaydı izle" isteği 401 dönünce girişe yönlendirmiyor

Adımlar:

1. `/history/<REC>` sayfasını aç.
2. `POST /sessions/:id/recording/view` isteği 401 dönsün (oturum düşmüş).
3. "Kaydı izle"ye tıkla.

Beklenen: diğer işleyiciler gibi `/login?reason=expired` yönlendirmesi.

Gerçekleşen: sayfada kalınıyor ve sunucu mesajı FormError olarak gösteriliyor. `useWatch` içinde `isUnauthenticated` denetimi yok. `useMeta` ve `DeleteDialog`'da bu denetim var.

Kanıt: `tarama.jsonl` E5 `urlAfter401: /history/01JSSP28E…`.

Dosya: `apps/web/app/(panel)/history/[id]/recording.tsx` `useWatch.start` catch bloğu.

Atanan: frontend-dev

### [DÜŞÜK] D-1 Saklama süresi alanında geçersiz değer sessizce reddediliyor

Adımlar:

1. `p28esole` ile `/settings/recording` sayfasını aç.
2. "Kayıt saklama süresi"ne sırayla boş, `0`, `-5`, `91` gir ve her birinde Kaydet'e bas.

Beklenen: 1–90 aralığı için alan hatası (`fields.*`, mimari §9 "alan hataları").

Gerçekleşen: PUT gitmiyor ama ekranda hiçbir hata metni ya da toast yok. `75` (firma süresini aşan) değeri ise doğru hata veriyor.

Not: `maxLength=2` nedeniyle `<script>` ve `' OR 1=1` girdileri 2 karaktere kesiliyor ve gönderilmiyor (güvenli).

Kanıt: `tarama.jsonl` E2.

Dosya: `apps/web/app/(panel)/settings/recording/recording-form.tsx`.

Atanan: frontend-dev

### [DÜŞÜK] D-2 Meta 404/403 dönerse "Kaydı izle" açıklamasız kayboluyor

Adımlar: `canView=true` olan detay sayfasında `GET /sessions/:id/recording` isteği 404 dönsün.

Gerçekleşen: özet meta ve "Kaydı sil" görünüyor, ama "Kaydı izle" neden yok belli değil.

Beklenen: kısa bir bilgi satırı (ör. "Kayıt bilgisi bulunamadı").

Kanıt: `tarama.jsonl` E6.

Atanan: frontend-dev

### [DÜŞÜK] D-3 Hata metninde sunucu mesajı ham gösteriliyor (doğrulanmalı)

Ayar PUT 500 ve "Kaydı izle" 500 durumlarında FormError'da sunucunun `message` alanı (testte "x") gösteriliyor. Ağ kopmasında ise Türkçe genel metin ("Sunucuya ulaşılamadı…") çıkıyor. Gerçek sunucunun 500 mesajı Türkçe ve genel ise sorun değil. `toUiError` 5xx için genel metne düşmeli mi, frontend-dev doğrulasın.

Kanıt: `tarama.jsonl` E3, E5.

Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                        | Sonuç | Not                                                               |
| ------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------- |
| Oturumsuz `/settings/recording`, `/history/:id`, `/history?recorded=true` → giriş           | ✅    | `next` parametresi korunuyor                                      |
| Ayar: onaysız açma → hata; gözetimsiz kutu + step-up; tek yönetici uyarısı; salt okunur     | ✅    |                                                                   |
| Ayar PUT 500 / ağ kopması                                                                   | ✅    | Hata gösteriliyor, değer korunuyor (D-3 notu)                     |
| Liste "Kayıtlı" süzgeci: URL'ye yazılıyor, yenilemede korunuyor, geri tuşu önceki URL       | ✅    | `?recorded=xyz` sessizce yok sayılıyor (3 satır)                  |
| Başka/olmayan kayıt `/history/<ULID>`                                                       | ✅    | "Oturum bulunamadı" + geri linki                                  |
| Çift tıklama: Kaydı izle → 1 POST /view; sil onayı → 1 DELETE                               | ✅    | Audit çiftlenmiyor                                                |
| Sil diyaloğu: odak Vazgeç'te; Esc kapatıyor, odak "Kaydı sil"e dönüyor                      | ✅    |                                                                   |
| Oynatıcı: gerçek WebM, 2 bölüm + boşluk, 429 bekleme, indirme yok                           | ✅    | Mevcut spec                                                       |
| Müşteri rıza → kayıt → Kaydı durdur ≤ 2 sn; onaysızda 2000 ms'de duraklama; kota uyarısı    | ✅    | Mevcut spec                                                       |
| Yetkisiz (`view_recording` yok): "Kaydı izle"/"Kaydı sil" yok, "Kaydı izleme yetkiniz yok." | ✅    | Liste "Kayıt" işareti görünür (AC-385 yalnız izlemeyi kısıtlıyor) |
| `POST /view` 401 → giriş                                                                    | ❌    | O-1                                                               |

## Kabul kriterleri (uçtan uca, UI)

| AC           | Sonuç | Nasıl doğrulandı                                                                                     |
| ------------ | ----- | ---------------------------------------------------------------------------------------------------- |
| AC-380       | ✅    | Spec + tarama (ayar ekranı 5 durum, 75 gün hatası). D-1 küçük eksik.                                 |
| AC-381       | ✅    | Onay kutusu varsayılan işaretsiz, teklif yoksa yok                                                   |
| AC-382       | ❌    | İşlev ✅ (≤ 2 sn, sekme başlığı, tüm teknisyenler). Gösterge AA kontrastını karşılamıyor (Y-1, Y-2). |
| AC-383       | ✅    | Spec: parçalar WebM, p>0 EBML ile başlamıyor                                                         |
| AC-384       | ✅    | Kota uyarısı `warning`, yükleme duruyor                                                              |
| AC-385       | ✅    | İzleme yalnız yetkiyle, indirme yok, izleme tıklama başına. 401 davranışı O-1.                       |
| AC-386       | ✅    | Elle silme + onay diyaloğu, silindi nedeni                                                           |
| AC-447 / 450 | ✅    | Gözetimsiz anahtar + step-up; kip ve gerekçe detayda                                                 |

## Görsel gözlemler

- Müşteri şeridi (375 açık): kırmızı "Kayıt yapılıyor" metni açık yeşil zeminde soluk duruyor (Y-1). Düğmeler (Paylaşımı durdur, Oturumu bitir, Kaydı durdur) sığıyor, taşma yok.
- Alt bilgi metni tüm müşteri ekranlarında güncel: "Paylaşımı istediğiniz an durdurabilirsiniz. Ekranınız yalnız izin verirseniz kaydedilir." Gerçek mobil cihazda "Bu cihaz desteklenmiyor" ekranında da aynı.
- Konsol ekranları tasarım gereği iki temada da koyu (`.theme-dark`).
- Sınırlar: yalnız sahte API ve Chromium. Safari/Firefox MSE ve gerçek sunucu kapsam dışı. Görsel incelemede yalnız seçilen birkaç ekrana bakıldı.

# Test Raporu — P28u K10 (gözetimsiz izinli/izinsiz bağlantı + müdahale; web arayüzü)

DURUM: GEÇTİ — engelleyici veya yüksek bulgu yok, 5xx yok, JS hatası yok. Bir ORTA bulgu açık (audit ekranında P28u eylemleri
ham anahtarla görünüyor), K11 öncesinde düzeltilmesi önerilir. Staging'e dokunulmadı (P28u henüz yayında değil).

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API `e2e/mock-api.mjs` (:4217), dal `p28u` @ `c6a83ff`,
2026-11-16. Betik `docs/test-raporu/e2e/p28u-k10/zz-k10-p28u.spec.ts` (koşu için `apps/web/e2e/` altına geçici kopyalandı, sonra
silindi), ham sonuç `tarama.jsonl`, ekranlar `docs/img/p28u/` (78 PNG). Başlatılan süreçler kapatıldı (3217/4217 boş).

## Özet

| Ölçüt                                                        | Sonuç                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright test p28u unattended` (mevcut takım)             | **41/41 geçti**, 9 atlandı (spec gereği masaüstüne özel akışlar mobil projede atlanıyor)                                                                                               |
| Sayfa taraması: 17 görünüm × açık/koyu × 1440/375 = 68 ekran | HTTP 200: 68/68. Konsol hatası/uyarısı 0 (yalnız step-up akışında beklenen `401 POST .../connect`). pageerror 0, 5xx 0, axe 0, 375 px yatay taşma 0, kırık iç link 0. En yavaş 1,54 sn |
| Konsolda "açık tema" ekranları koyu                          | Tasarım gereği: konsol `.theme-dark` ile, kullanıcı tercihi Sistem iken koyu açılıyor (DESIGN.md §"Konsol varsayılan koyu"). Bulgu değil; taramadaki 10 "tema" uyumsuzluğu bundan      |
| Keşif turu (E1–E9)                                           | 8/9 beklendiği gibi. E9'da DÜŞÜK bir gözlem var (aşağıda). E1'in son adımı betik hatasıyla zaman aşımına uğradı; ekran görüntüsüyle doğrulandı                                         |

Taranan görünümler: cihaz listesi; cihaz detayı (güncel / eski servis); Bağlan diyaloğu (sor, izinsiz + gerekçe hatası, step-up);
Ayarlar → Gözetimsiz erişim (açık / açma akışı + aydınlatma hatası / salt okunur); geçmiş (filtresiz, `consentMode=silent`, detay);
audit (`consentMode=asked`); konsol (izleme, Müdahale et onayı, kontrol, oturumu kapat onayı, eski servis).

## Bulgular

### [ORTA] Audit ekranı P28u (ve P27) gözetimsiz eylemlerini Türkçe etiket yerine ham anahtarla gösteriyor

Sayfa/akış: `/audit` (masaüstü tablo, mobil kart, ayrıntı diyaloğu başlığı, "İşlem" süzgeci seçenekleri).
Adımlar: 1. `auun` senaryosuyla giriş. 2. `/audit?consentMode=asked` aç (veya `silent`).
Beklenen: "Gözetimsiz bağlantı onayı (cihaz kullanıcısı)", "Gözetimsiz bağlantı isteği" gibi etiketler.
Gerçekleşen: satırda `unattended.consent` düz yazıyor. Aynı eşleme eksikliği `unattended.connect`, `control_toggle`, `lock`,
`logoff`, politika eylemi ve P27 eylemleri (`unattended.code.*`, `device.*`, `grant.changed`...) için de geçerli. Yalnız
`session.started` ve `session.ended` etiketli, çünkü bunlar `TIMELINE_ACTION_LABELS` üzerinden geliyor.
Neden: `apps/web/lib/audit/actions.ts` `AUDIT_ACTION_LABELS`, `@remote/contracts` `UNATTENDED_AUDIT_LABELS`'ı içermiyor.
Etiketler sözleşmede var (`packages/contracts/src/api/unattended.ts:397`).
Kanıt: `docs/img/p28u/audit-izinli-1440-light.png`, `audit-izinli-375-light.png`.
Atanan: frontend-dev

### [DÜŞÜK] Step-up diyaloğu metni bağlanma işleminde yanlış bağlamda

Sayfa/akış: `/unattended` → Bağlan → (izinsiz + gerekçe) → Bağlan.
Beklenen: işleme uygun bir metin, ör. "Bağlanmak için kimliğinizi doğrulayın".
Gerçekleşen: "Bu işlem hassas bir ayarı değiştirir." Bağlanma bir ayar değişikliği değil.
Kanıt: `docs/img/p28u/baglan-stepup-1440-light.png`. Atanan: frontend-dev

### [DÜŞÜK] "Kullanıcı oturumu kapatılsın mı?" onayı Esc ile kapanmıyor

Sayfa/akış: konsol, izinsiz kip → Müdahale et → onay → kontrol → "Kullanıcı oturumunu kapat".
Adımlar: onay diyaloğu açıkken Esc tuşuna bas.
Beklenen: diyalog kapanır (WAI-ARIA alertdialog Esc ile iptal edilir; odak zaten "Vazgeç"te).
Gerçekleşen: diyalog açık kalıyor. Güvenli tarafta: istek gitmiyor (logoff çağrısı 0). Kasıtlıysa DESIGN.md'ye not düşülmeli.
Kanıt: `tarama.jsonl` E9 `{"logoffDialog":1,"logoffCalls":0}`. Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                              | Sonuç | Not                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Liste: Kullanıcı sütunu (Aktif / Kilitli / —), "Servis güncel değil" rozeti, Bağlan pasif + neden | ✅    | İki tema, 1440/375                                                                                                                  |
| Bağlan diyaloğu "sor" (politika kapalı): bilgi metni, kutu yok                                    | ✅    |                                                                                                                                     |
| İzinsiz: gerekçe < 20, yalnız boşluk, 501 karakter → "Gerekçe 20–500 karakter olmalı"             | ✅    | 501'de sayaç "501 / 500" (girişe izin veriyor, gönderimde engelliyor)                                                               |
| İzinsiz: `<script>alert(1)</script> ' OR 1=1 --` gerekçesi                                        | ✅    | Gövdede düz metin gidiyor; diyalog/alert çalışmadı. Geçmişte gerekçe düz metin (`<b>` kaçışlı görünüyor)                            |
| Çift tıklama Bağlan / Doğrula                                                                     | ✅    | Step-up öncesi 1 POST, toplam 2 (401 + başarılı); çift kayıt yok                                                                    |
| Connect 500 / ağ kopması                                                                          | ✅    | Diyalogda hata metni ("Sunucuya ulaşılamadı..."), düğme yeniden etkin                                                               |
| Liste yoklaması 500                                                                               | ✅    | "Cihaz durumları güncellenemedi; son bilinen durum gösteriliyor" + son veri                                                         |
| Politika: açarken aydınlatma kutusu zorunlu; PUT 500 → hata                                       | ✅    | Hata metni sunucu mesajını gösteriyor                                                                                               |
| Oturumsuz erişim: `/unattended`, cihaz detayı, politika, geçmiş, audit                            | ✅    | Hepsi `/login?next=...` sayfasına yönleniyor. Not: `next` sorgu dizesini (`consentMode`) taşımıyor; mevcut davranış, bulgu değil    |
| Süzgeç: yenileme / geri tuşu / geçersiz `consentMode=xxx`                                         | ✅    | Yenilemede değer korunuyor, geri tuşunda filtresiz liste geliyor. Geçersiz değer yok sayılıyor (geçmiş 30, audit 9 satır), hata yok |
| Geri tuşu (konsol → liste)                                                                        | ✅    | Diyalog DOM'da gizli, ekranda görünmüyor (`keşif-geri-tusu-liste.png`)                                                              |
| Klavye: Esc Bağlan diyaloğunu kapatıyor, odak "Bağlan: AKTIF-PC"ye dönüyor                        | ✅    |                                                                                                                                     |
| Konsol: İzleniyor → Müdahale et onayı (odak Vazgeç) → Vazgeç → izlemede kalıyor, istek yok        | ✅    |                                                                                                                                     |
| Konsol: kontrol → kilitle / oturumu kapat onayı, eski serviste pasif düğme + "güncelleyin"        | ✅    | Mevcut e2e + ekranlar                                                                                                               |

## Kabul kriterleri (uçtan uca, web tarafı; mock API)

| AC                                             | ✅/❌    | Nasıl doğrulandı                                                                                            |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| AC-429                                         | ✅       | Liste Kullanıcı sütunu, iki tema / iki genişlik; e2e AC-429                                                 |
| AC-431                                         | ✅ (web) | "Sor" diyaloğu ve onay bekleme (K4 e2e). Cihazda onay diyaloğu Windows elle listesinde                      |
| AC-433                                         | ✅ (web) | Kip rozeti İzinli / İzinsiz / bekleme. Servis kip kararı ve logoff sonrası davranış Windows elle listesinde |
| AC-443                                         | ✅ (web) | Eski serviste kilitle / oturumu kapat pasif + neden, istek yok (e2e + ekran)                                |
| AC-430, 432, 435, 436, 437, 439, 442, 445, 446 | ✅       | Mevcut 41 e2e + keşif. AC-445 süzgeci doğru çalışıyor; etiket sorunu ORTA bulguda                           |

Windows elle test listesi (cihazda onay diyaloğu, gösterge, kilit / logoff, rejoin) kullanıcıda. Staging dumanı P28u yayınından sonra yapılacak.

## Görsel gözlemler (ekran görüntülerinden)

- Liste (1440 açık/koyu, 375 kart): rozetler ve ikonlu Kullanıcı sütunu okunaklı. Pasif Bağlan'ın altındaki neden metni iki satıra
  sarıyor, taşma yok.
- Bağlan diyaloğu 375 px (izinsiz): uyarı kutusu (sarı) ve hata metni koyu temada okunaklı. Tam sayfa görüntüde alt "Vazgeç"
  görünmüyor. Bu, `fullPage` çekimin sabit konumlu diyaloğu kırpmasından olabilir ("sor" diyaloğunda Vazgeç görünüyor).
  375×812 ekranda elle bir kez kaydırıp bakılması önerilir (`baglan-izinsiz-375-dark.png`).
- Politika 375 px: sabit "Kaydedilmemiş değişiklik" çubuğu tam sayfa görüntüde aydınlatma kutusunun üstüne biniyor. Bu bir çekim
  artefaktı; gerçek ekranda içerik çubuğun altına kaydırılabiliyor.
- Konsol: kip rozeti (İzinsiz: sarı, göz-kapalı ikonu; İzinli: yeşil), "İzleniyor" etiketi, "Müdahale et" düğmesi net. 375 px'te
  logoff onayında "Oturumu kapat" (danger) ve "Vazgeç" alt alta. "Müşteri kontrol izni verdi" toast'ı sahnenin üstünde (fullPage çekim).
- Geçmiş detayı koyu: "Gözetimsiz bağlantı" bölümü, kip, gerekçe ve ikonlu müdahale zaman çizelgesi okunaklı; "(başarısız)" kırmızı.
- Audit: tarih alanları `mm/dd/yyyy` görünüyor. Bunun nedeni headless Chromium'un yerel ayarı; P28u ile ilgisi yok.

---

# Test Raporu — P28b K9 (sunucuda dosya aktarımı + ClamAV + depolama kotası)

Önceki rapor (P28a K9) `docs/arsiv/p28a-test-raporu.md` dosyasına taşındı.

DURUM: DÜZELTİLMELİ. Web ve staging altyapı kapsamı geçti. Kimlikli staging dumanı ise koşulamadı: test hesapları
kullanılamıyor (B1). AC-357 uçtan uca ölçümü bu yüzden yapılamadı. Staging clamd'si eski imza veritabanıyla çalışıyor (B2).

Ortam:

- Yerel: dal `p28b` @ `6f6f7b2`. Staging'deki `ec713f2` ile `apps/` ve `packages/` farkı yok
  (`git diff --stat 6f6f7b2 ec713f2 -- apps packages` boş). Testler üretim derlemesiyle (standalone) koşuldu:
  `http://localhost:3217` + sahte API `e2e/mock-api.mjs` (:4217).
- Staging: `https://185.126.217.99:4450`, yığın `/opt/remote/deploy` (compose `remote`). `server`/`web` imajı
  `remote-server:ec713f2`/`remote-web:ec713f2`, `clamav`/`clamav-update` 1.5.4 (digest sabit). Hepsi healthy; tur
  sırasında yığın 08:48 UTC'de yeniden başlatılmıştı. Tarih 2026-11-16.
- Betikler `docs/test-raporu/e2e/p28b-k9/` altında: `zz-k9-p28b.spec.ts` sayfa taraması, `av-probe.ts` clamd dumanı,
  ham sonuç `tarama.jsonl`, ekranlar `shots/`. Geçici kopyalar silindi. Staging'de konteynere konan betik koşudan sonra
  silindi. Staging'de ayar, firma ve kullanıcı **değiştirilmedi**; sunucu modu açılmadı, geri alınacak test ayarı yok. Tek iz B1'deki giriş denemeleri (audit).

## Özet

| Ölçüt                                                              | Sonuç                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright test p28b p28a`                                        | **17/17 geçti**, 9 atlandı (spec gereği "konsol masaüstü akışı" mobilde atlanıyor; geçti sayılmadı)                                                                                                                         |
| Sayfa taraması (3 ekran + ClamAV-yok durumu, açık/koyu × 1440/390) | 16/16 görünüm: HTTP 200, konsol hata/uyarı 0, 4xx/5xx 0, axe 0, 390 px yatay taşma 0, kırık iç link 0, her biri ≤ 1,7 sn                                                                                                    |
| Hata durumu (API 500)                                              | **Test edilmedi**: üç ekranın verisi sunucu tarafında (SSR) çekiliyor, tarayıcı `route` ile 500'e zorlanamadı (12 "-hata" koşusu artefakt; spec'te `test.skip`). Mevcut e2e'de bu ekranlar için yükleme hatası testi de yok |
| Staging clamd dumanı (server konteynerinden, `ClamdClient` ile)    | PONG ✅, EICAR → `INFECTED Eicar-Test-Signature` ✅, şifreli zip → `SCAN_FAILED ENCRYPTED` ✅, öz-sınama `ok`. İmza: **daily 28177, 2026-11-08 (8 gün)** ❌ (B2)                                                            |
| 50 MB rastgele, yalnız clamd INSTREAM, 5 tekrar                    | 3,60 / 2,96 / 4,09 / 3,23 / 3,26 sn, hepsi `CLEAN`. Tarama payı ≤ 30 sn bütçesinin ~%14'ü. **Uçtan uca AC-357 değil**: yükleme ve şifre çözme dahil değil                                                                   |
| Yalıtım (`ops/check-av-isolation.sh remote`)                       | `SONUÇ: GEÇTİ (uyarı 0)`. D-r2-1 satırı (clamav → server:3001) PASS                                                                                                                                                         |
| Dış port taraması (operatör makinesi → `185.126.217.99:3310`)      | kapalı ✅ (AC-353)                                                                                                                                                                                                          |
| clamd açılış limitleri                                             | `Global size limit 536870912`, `File size limit 268435456`, "Alerting of encrypted archives _and_ documents enabled" ✅ (§28b.6 madde 4)                                                                                    |
| Host kaynak (K6 kapı 6)                                            | `free -m` available 6629 MB, clamav zaten çalışırken ölçüldü (≥ 4,5 GiB ✅); host swap 1803/4095 MB kullanımda; `/` %69 (29 GB boş)                                                                                         |
| clamd bellek (K6 kapı 4, R-P28b-1)                                 | 5 × 50 MB taramadan sonra `remote-clamav-1` 946 MiB / 3 GiB, OOMKilled=false, yeniden başlatma 0 ✅. Eşzamanlı yük tepesi ölçülmedi                                                                                         |
| Log kuralı (AC-361), `logs server --since 30m`                     | 416 satır. 43 karakterlik belirteç deseni ve `fileName`/`file_name` eşleşmesi 0, `fsrv` geçen satır 0. **Pencerede dosya trafiği olmadığı için kanıt değeri düşük**                                                         |

## Bulgular (öncelik sırasıyla)

### [YÜKSEK] B1 — Staging test hesapları kullanılamıyor; kimlikli K9 dumanı engellendi

Sayfa/akış: staging `POST /api/v1/auth/login`, `deploy/ACCESS.txt` hesapları.

Adımlar:

1. Sunucuda `ACCESS.txt`'teki SUPER_ADMIN ve ADMIN satırlarıyla `POST https://185.126.217.99:4450/api/v1/auth/login`
   isteği atılır (`Origin` doğru).
2. USER satırıyla aynı istek atılır.

Beklenen: test hesaplarıyla giriş yapılır, ClamAV testi ve firma sunucu modu API'den denenebilir.

Gerçekleşen:

- SUPER_ADMIN ve ADMIN `401 UNAUTHENTICATED` döndü: dosyadaki şifreler güncel değil. Üç istek turu yapıldı; ilk ikisi kimlik doğrulamaya ulaşmadı (yanlış adres, alan adı), yalnız üçüncüsü ulaştı. Her ayrıcalıklı hesapta 1 başarısız giriş (kilit sınırı 5) ve USER'da MFA kurulumunda bekleyen 1 oturum kaldı; staging'deki tek iz bunlar. 401'in sebebi şifre değişikliği olabileceği gibi kilitli/pasif/adı değişmiş hesap da olabilir
- USER `200` döndü ama `mfaSetupRequired: true`. TOTP kaydı test hesabının durumunu değiştireceği için yapılmadı.
- Sonuç olarak şu adımlar koşulamadı: Super Admin "Bağlantıyı Test Et", TEST firmasında sunucu modunu açma, oturumda EICAR
  yükleme, 50 MB uçtan uca yükleme+tarama ölçümü ve kota/uyarı metni.

Ek (güvenlik): `ACCESS.txt` alanlarını maskelemek için kullandığım `sed` boşlukla ayrılmış satırlarda eşleşmedi. Bu
yüzden üç şifre bu oturumun araç çıktısına (transkript) düştü. Repoya ya da rapora yazılmadı. **Üç hesabın şifresi de döndürülmeli** (USER'ınki hâlâ geçerli).

Öneri: K9 için TOTP'si kasada tutulan ayrı bir staging Super Admin + Admin test hesabı açılmalı (ya da `staging-users.sh`
`ACCESS.txt`'i güncel tutmalı). Ardından bu bölümdeki elle maddeler koşulmalı.

Atanan: devops

### [ORTA] B2 — Staging clamd 8 günlük imza veritabanıyla çalışıyor (ilk açılış yarışı)

Sayfa/akış: staging `clamav` / `clamav-update`, 08:48 UTC yeniden başlatma.

Adımlar:

1. `docker compose logs clamav-update` → `08:48:24 daily.cld updated (version: 28185)`.
2. `docker compose exec clamav sh -c 'printf "zVERSION\0" | nc localhost 3310'` komutu çalıştırılır.

Beklenen: clamd güncel daily'yi (28185) yükler. İmza yaşı ≤ 1–2 gün olur (§28b.3).

Gerçekleşen: `ClamAV 1.5.4/28177/Sun Nov 8 06:23:52 2026`. clamd 08:48:35'te imajdaki eski DB'yi yükledi; 08:58:37 SelfCheck "Database status OK" diyip yine yenisini almadı. 09:01:42 `remote-watch`: `ALERT check=av-signature-age imza yaşı 194 sa > 3 gün`. Bu, runbook §28b.3
"ilk açılış yarışı"dır. Panelde "imza eski" görünür, `av-signature-age` alarmı (> 3 gün) çalar. Yarış her yeniden
başlatmada tekrar edebilir.

Düzeltme: geçici çözüm runbook'taki `docker compose restart clamav`. Kalıcı çözüm için `clamav`'ın ilk freshclam
tamamlanmadan başlamaması düşünülmeli. Bu turda staging'e dokunulmadı.

Atanan: devops

### [DÜŞÜK] B3 — Yeniden başlatmadan sonra `av-up` ALERT (clamd erişilebilirken)

Sayfa/akış: `remote-watch` + server `rs_av_up`.

Adımlar:

1. Yığın 08:48'de yeniden başlatılır.
2. `journalctl -t remote-watch` çıktısına bakılır.

Gerçekleşen: 08:51:37'de `ALERT check=av-up rs_av_up=0 ardışık 2 yoklama`. Oysa 08:55'te server konteynerinden clamd'ye
PONG/EICAR/zip başarılı. Server'ın açılış yoklaması clamd imza yüklemesi (~60 sn) sırasında düştü. Sonraki yoklama 10 dk
sonra; bu sürede `rs_av_up` 0 kalıyor ve watch alarm üretiyor. Yanlış alarm. 08:59:44'te `rs_av_up 1` oldu; 09:01:42 watch turunda `av-up` alarmı tekrarlamadı (yalnız B2 alarmı). Not: "ardışık 2 yoklama"nın ilki 08:41 (yeniden başlatma öncesi örnek) — o anki durumu gözlemlemedim; 08:41 turu "OK (41 kontrol)" demiş.

Atanan: backend-dev (açılışta clamd hazır olana dek kısa aralıklı yoklama) | devops (watch eşiği)

## Akış sonuçları

| Akış                                                                                                     | Sonuç | Not                                                                          |
| -------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| e2e konsol: yükleme (2 parça) → tarama → müşteri onayı → teslim; belirteç URL'de yok                     | ✅    | desktop                                                                      |
| e2e konsol: virüslü + taranamadı metinleri iki tarafa, teslim yok                                        | ✅    | desktop                                                                      |
| e2e konsol: müşteriden gelen temiz dosya → kabul → indir + SHA-256                                       | ✅    | desktop                                                                      |
| e2e konsol: koyu tema + 390 px SERVER dosya paneli taşmaz, axe 0 (QA madde 8)                            | ✅    | desktop projesinde 390 px viewport ile                                       |
| e2e konsol: fsrv bildirmeyen istemci → dosya alanı kapalı + güncelleme metni                             | ✅    |                                                                              |
| e2e ayarlar: Dosyalar onay zorunlu, kullanım göstergesi; ClamAV testi yoksa anahtar pasif; ClamAV ekranı | ✅    | desktop + mobile                                                             |
| e2e geçmiş: sunucudaki dosyalar listesi + Bearer ile indirme                                             | ✅    | desktop + mobile                                                             |
| e2e misafir web SERVER modu                                                                              | ✅    | desktop                                                                      |
| p28a (pano/yazdırma) 3 test                                                                              | ✅    | regresyon yok                                                                |
| Staging: ClamAV "Bağlantıyı Test Et" (panel/API)                                                         | ⛔    | B1. Aynı denetim (PONG + EICAR + şifreli zip + VERSION) altyapı düzeyinde ✅ |
| Staging: TEST firmasında sunucu modu aç, EICAR yükle → INFECTED                                          | ⛔    | B1 (elle)                                                                    |
| Staging: 50 MB yükleme + tarama ≤ 30 sn (AC-357)                                                         | ⛔    | B1. Yalnız tarama ölçüldü: en çok 4,09 sn                                    |
| Staging: kota/uyarı metni                                                                                | ⛔    | B1. Metin yerelde doğrulandı ("Depolama kotası dolmak üzere…")               |

## Kabul kriterleri (uçtan uca)

| AC     | Durum               | Nasıl doğrulandı                                                                                                     |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AC-353 | ✅                  | e2e ClamAV ekranı (ağ dışı adres alan hatası). Staging 3310 dışarıya kapalı, yalıtım betiği GEÇTİ. Panel testi ⛔ B1 |
| AC-354 | ✅ web · ⛔ staging | e2e: test yoksa anahtar pasif + neden, açarken onay. Staging'de firma anahtarı denenemedi                            |
| AC-355 | ✅ web              | e2e yükleme → tarama → teslim                                                                                        |
| AC-356 | ✅ web              | e2e belirteç URL'de yok, yalnız `Authorization: Bearer`                                                              |
| AC-357 | ⛔ ölçülemedi       | Uçtan uca staging ölçümü B1 nedeniyle yok. clamd payı 50 MB'ta 2,96–4,09 sn (5 tekrar, amd64)                        |
| AC-358 | ✅ web · altyapı ✅ | e2e virüslü metni. Staging clamd EICAR → `Eicar-Test-Signature`                                                      |
| AC-359 | ✅ web · altyapı ✅ | e2e taranamadı metni. Şifreli zip → `ENCRYPTED`. Fail-closed staging oturumunda denenemedi                           |
| AC-360 | ✅ web              | e2e geçmiş listesi + indirme                                                                                         |
| AC-361 | ⚠️                  | e2e imza eski uyarısı ✅. Staging log taraması temiz ama dosya trafiği yok. Staging imzası gerçekten eski (B2)       |
| AC-362 | ✅ web · ⛔ staging | e2e kullanım göstergesi + kota uyarı metni                                                                           |
| AC-363 | ✅ web · ⏭ Windows  | e2e konsol/misafir bilgi satırı. Windows satırı elle                                                                 |

## Elle kalan maddeler

Bunlar kullanıcıda ya da B1 düzeltilince koşulacak.

- Staging (B1 sonrası):
  - Super Admin "Bağlantıyı Test Et": PONG + EICAR + şifreli zip + imza tarihi. Önce B2 düzeltilmeli, yoksa "imza eski" çıkar.
  - TEST firmasında sunucu modunu aç (step-up TOTP).
  - EICAR yükle → INFECTED.
  - 50 MB × 5 uçtan uca ≤ 30 sn (AC-357).
  - Kota uyarı metni.
  - Sonrasında sunucu modunu kapat. Ardından `logs server --since 30m`'i dosya adı/belirteç için yeniden tara (AC-361).
- Windows (0.13 istemci):
  - SERVER modunda istemcinin dosya alması (kabul → indir → SHA doğrulama).
  - SERVER modunda uzaktan yazdırma (`belge.pdf` taranıp yazıcıya).
  - AC-363 Windows bilgi satırı.
  - 0.13 istemcide AC-352 metni.
  - İz testi.
- PR CI'nin tamamı (Windows `agent-win`, `web e2e`, `test (MySQL 8.4)`): bu turda bakılmadı.

## Görsel gözlemler (ekran görüntülerinden)

`tarama.jsonl`'daki `dark:false` artefakt: kontrol yalnız `dark` sınıfına bakıyor; tema "Sistem" + koyu medya ile koyu açılıyor, ekranlarda doğrulandı. 8 mobil ekrandan 3'üne bakıldı (turlar idareli; kalanlar `shots/` altında). Kullanım çubuğunun renk token'ı kodda denetlenmedi (18,5/20 GB'ta yeşil, uyarı kutusu sarı — renk tutarlılığı frontend'e bilgi notu).

- `shots/dosyalar-mobile-dark.png`: 390 px koyu tema. Alt sekmeler iki satıra düzgün kırılıyor ve hepsinde ikon var. Anahtar
  "Kapalı" ve açıklama okunaklı. Kullanım çubuğu 18,5/20 GB, altında sarı uyarı kutusu ("Depolama kotası dolmak üzere…").
  Kontrast yeterli, taşma yok. Üst sekme çubuğunda solda kaydırma oku "‹fa" kesik görünüyor; bu, yatay kaydırma kalıbının
  beklenen hâli.
- `shots/clamav-mobile-light.png`: "Virüs tarama henüz yapılandırılmadı" bilgi kutusu, "Yapılandırılmadı" rozeti, Sunucu boş,
  Port 3310. "Bağlantıyı Test Et" pasif ve soluk ama okunaklı. Sekme ikonları anlamlı (kalkan = ClamAV).
- `shots/gecmis-dosyalar-mobile-dark.png`: uzun geçmiş sayfasının sonunda "Sunucudaki dosyalar" kartları var. Durumlar
  renkli ve metinli: "Teslim edildi — saklanıyor", "Yazdırma belgesi — saklanmaz", kırmızı "Dosya virüslü bulundu
  (Eicar-Test-Signature)". Yalnız saklanan dosyada "İndir" düğmesi var. Taşma yok.

## Staging ölçüm notu

Zaman çizelgesi, 2026-11-16 UTC:

- 08:48:22 server açıldı.
- 08:48:24 freshclam daily 28185'i indirdi.
- 08:48:35 clamd eski daily 28177'yi yükledi.
- 08:51:37 `remote-watch` `av-up` ALERT verdi (B3).
- 08:55 `av-probe.ts` koşuldu: PONG, EICAR, zip ve 5 × 50 MB tamam.
- 08:57:58 `rs_av_up 0`, `rs_av_signature_age_seconds -1`.
- 08:58:37 clamd `SelfCheck: Database status OK`. Yeni daily'yi **görmedi**, 28177'de kaldı (B2).
- 08:59:44 server'ın ikinci yoklamasından sonra `rs_av_up 1`, `rs_av_selftest_ok 1`,
  `rs_av_signature_age_seconds 700470` (≈ 8,1 gün > 3 gün → `av-signature-age` alarmı beklenir).

B3'teki alarm bu yüzden geçici. Server'ın 10 dakikalık yoklama aralığı açılışta yanlış alarm üretiyor.

- 09:01:42 `remote-watch`: `ALERT check=av-signature-age imza yaşı 194 sa > 3 gün`; `av-up` tekrarlamadı.

## K9 ek — staging uçtan uca (2026-11-16, devops)

B1'in ardından kullanıcı onayıyla staging'de **tek** test hesabı açıldı: `k9-test@staging.invalid`, SUPER_ADMIN, 2FA etkin.
Hesap `deploy/ops/k9-staging-account.sh` ile oluşturuldu (audit `user.created {source:"k9-staging-test"}` 1 satır). Duman testi
`deploy/ops/staging-smoke-p28b.sh` ile yapıldı. Kullanım runbook §28b.8'de. Kimlik yalnız staging host'unda,
`/root/.k9-staging-test.env` (root 600) dosyasında duruyor; rapora ve araç çıktısına değer düşmedi. Mevcut SUPER_ADMIN, ADMIN ve
USER hesaplarına dokunulmadı.

| Adım                                             | Sonuç                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard                                            | Yerelde (hostname ≠ `develop`) iki betik de "staging değil" diyerek çıktı. Staging'de `develop` + `DEPLOY_ENV=staging` olduğu için guard geçti                                                                         |
| Hesap betiği (2 koşu)                            | 1. koşu: hesap oluşturuldu, 2FA API'den kuruldu (setup → host'ta TOTP → enable, 10 kurtarma kodu dosyada). 2. koşu: "mevcut, parola değişmedi, 2FA tohumla doğrulandı" ✅ idempotent                                   |
| Giriş                                            | SUPER_ADMIN + TOTP, `mfa.stage=ok` ✅                                                                                                                                                                                  |
| (a) ClamAV "Bağlantıyı Test Et"                  | `ok=true`, PONG ✅, EICAR ✅, şifreli zip ✅, `ClamAV 1.5.4/28185`, imza yaşı **0 gün**, `stale=false` (B2 sonrası güncel). Ayar kaynağı `env→panel` oldu (ilk testin beklenen ve kalıcı yan etkisi; runbook §28b.2/7) |
| (b) Demo firmasında sunucu dosya modu            | `false → true` (`consentUpdated=true` ile), saklama süresi 1 gün ✅. Geri alma `true → false` ✅; DB'de `file_server_mode=0` doğrulandı                                                                                |
| (c) Destek oturumu                               | **Koşulamadı**: `POST /sessions` → 403 `FORBIDDEN`. Super Admin oturum açamıyor. Kod `sessions/service.ts:73` "oturum yalnız kendi firmanızda" (tasarım gereği, hata değil)                                            |
| (d) EICAR → INFECTED, (e) 50 MB → CLEAN + AC-357 | **Koşulamadı** (c'ye bağlı). AC-357 uçtan uca ölçümü hâlâ açık. Yalnız clamd dumanı var (yukarıda, 3–4 sn)                                                                                                             |
| (f) Log taraması                                 | **Koşulamadı** (dosya trafiği oluşmadı)                                                                                                                                                                                |
| (g) Temizlik                                     | Oturum açılmadı. Firma modu eski değerinde. Açık K9 oturumu yok, saklanan dosya yok, git ağacı (`/opt/remote`) temiz                                                                                                   |

Kalan iş: (c)–(f) için demo firmasında teknisyen olarak ikinci bir test hesabı gerekiyor (`k9-tech@staging.invalid`, ADMIN). Bu hesap
mevcut onayın dışında. Betikler hazır: `k9-staging-account.sh --tech` hesabı açar, `staging-smoke-p28b.sh` ise (a)–(g)'nin tamamını tek
koşuda yapar. Bunun için kullanıcı onayı gerekiyor.

### K9 ek 2 — teknisyen hesabıyla tam koşu (2026-11-16, koordinatör) — **GEÇTİ**

Kullanıcının ikinci onayıyla `k9-tech@staging.invalid` (ADMIN, demo firması, 2FA) `k9-staging-account.sh --tech` ile açıldı (kimlik yalnız
`/root/.k9-staging-test.env`). `staging-smoke-p28b.sh` ilk iki koşuda `/ws/tech` TLS el sıkışmasında `EPROTO` verdi: `ws` istemcisi SNI
gönderiyordu, Caddy `tls internal` IP sertifikasını SNI'siz seçer. `k9-staging.mjs`'te `servername: ""` (https.request ile aynı) → düzeldi.
Yarıda kalan koşularda geri alma çalıştı (oturum kapandı, `fileServerMode=false`).

| Adım                  | Sonuç                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| (a) ClamAV testi      | ok, PONG, EICAR, şifreli zip, `ClamAV 1.5.4/28185`, imza yaşı 0 gün                                        |
| (b) Sunucu dosya modu | `false → true` (aydınlatma onayı), saklama 1 gün                                                           |
| (c) Oturum            | açıldı, misafir kabul; oda `fileMode=SERVER`, misafir fsrv yeteneği var                                    |
| (d) EICAR             | `INFECTED`, imza `Eicar-Test-Signature`, misafire teklif **yok** ✅                                        |
| (e) 50 MB, 50 × 1 MiB | `CLEAN`; yükleme 0,9 sn, son parça → CLEAN 3,21 sn → **AC-357 (≤ 30 sn) GEÇTİ**                            |
| (f) Log taraması      | 12 iğne (2 dosya adı + belirteç önekleri): server 0, caddy 0 eşleşme; pozitif kontrol 51 satır ✅ (AC-361) |
| (g) Temizlik          | oturum `ENDED`, eicar `INFECTED`, 50 MB `REJECTED` (misafir reddi → disk silindi), `fileServerMode=false`  |

Bu ekle B1 kapandı; P28b K9 staging kapısı **GEÇTİ**. Elle kalan yalnız Windows istemci maddeleri (yukarıda).
