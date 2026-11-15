# Kabul kriterleri — E11 (bölüm A: G1–G4, AC-201..AC-244)

Tarih: 2026-11-14 Durum: ONAYLANDI (2026-11-14; mimari-e11 sonrası revizyon r2: AC-206, 215, 216, 224, 225, 241). Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler-e11.md`. Bölüm B (G5–G8): `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e11-b.md`. Tasarım: `docs/mimari-e11.md`, ADR-0021..0028.
Kural: her AC otomatik testle (birim/entegrasyon/e2e) ya da adı verilen elle ölçümle kanıtlanır. Bulgu kapatan AC'de kanıt, raporundaki yeniden üretim adımının artık başarısız olmasıdır.

## Uygulama durumu (P14a / P14b, 2026-11-15)

Kaynak: `docs/implementation.md` "P14a A0" … "P14a A4 + P14b B3 bölüm 2", güvenlik kod turu 2 (Kritik/Yüksek/Orta 0).
QA denetimi (`docs/qa-raporu.md`) sürüyor; "GEÇTİ" yazılana kadar durum "kodlandı"dır.

| AC                         | Durum                      | Not                                                                                                                                                                                              |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 201–207, 209–211, 213, 214 | Kodlandı, testli           | Adında AC no geçen entegrasyon testleri (`security-p14a-*`, `p14a-a3*`, `mail-starttls-p14a`)                                                                                                    |
| 208, 212                   | Kodlandı, testli           | Metrikler + runbook §22 alarm eşikleri (15 dk'da ≥ 20; 1 sa'te ≥ 10); `remote-watch` kontrolleri                                                                                                 |
| 215                        | Kodlandı, testli (sapmalı) | Step-up bugün MySQL/TURN/WhatsApp yazımlarında; SSO ve API anahtarı henüz yok (P24/P25). Audit adı `auth.step_up`, `method: TOTP\|RECOVERY`; hatalı kod 400. "Her girişte" kalan kod uyarısı yok |
| 216, 217, 218              | Kodlandı, testli           | 4429 `retry=<sn>` e2e; kalite borcu testleri; Prettier + CI `format:check`                                                                                                                       |
| 219                        | Bekliyor                   | `stability` iş akışının 20 koşusu push sonrası GitHub'da; "Kararsız testler" listesi şu an boş                                                                                                   |
| 220–224, 227–230           | Kodlandı, testli           | `e2e/p14b-ui.spec.ts`, birim testleri                                                                                                                                                            |
| 225                        | Kodlandı (sapmalı)         | Firma seçmemiş Super Admin'de teknisyen seçenekleri sayfadaki kayıtlardan (ipuçlu); Talepler ekranında teknisyen filtresi yok, müşteri filtresi zaten aramalı                                    |
| 226                        | Kodlandı, testli (sapmalı) | ≤ 500 ms e2e'de sahte API ile ölçüldü; gerçek sunucu ölçümü staging'de                                                                                                                           |

## G1 — Güvenlik ve kalite bulguları

- AC-201: 6 eski CHECK (`customers_file_label_chk`, `customers_phone_fmt_chk`, `support_requests_phone_fmt_chk`, `support_requests_client_version_fmt_chk`, `device_bindings_client_version_fmt_chk`, `tenant_request_settings_file_label_chk`) `\z` kullanır; sonu `\n` olan değerle INSERT 3819 döner; ön kontrol ihlal eden satır sayısını raporlar; `down.sql` eski hâle döner.
- AC-202: (B-P9-2) Kullanıcı yönetimi TX'i aktör ve hedef satırlarını id sırasıyla `FOR UPDATE` kilitler, aktörün rol/yetkisini TX içinde yeniden okur; paralel istekte yetkisi düşürülen aktörün işlemi 403 döner (gecikme kancalı test).
- AC-203: (B-P9-3/4) `/users` ve `/admin/*` yazma uçları kullanıcı başına 30/dk, `POST /users` 10/dk ile sınırlıdır; aşımda 429 `RATE_LIMITED` + `Retry-After`; 409 e-posta çakışması audit'e `result: "fail"` yazılır.
- AC-204: (B-P9-5) `assertGrantable`/`canManage`/kendi hesabı kaynaklı her 403 audit'e `result: "fail"`, `newValue: { denied: [anahtarlar] }` ile yazılır; PII yok.
- AC-205: (B-P9-6) Tenant pasife alınınca talep iptali ve kayıt geçersizleştirmesi pasif TX'iyle aynı commit'tedir; pasif → 30 sn içinde aktif senaryosunda pasif anından önceki hiçbir talep/kayıt geçerli kalmaz.
- AC-206: (r2) Kullanıcı PATCH'i `If-Match` ister; başlık yoksa 428 `PRECONDITION_REQUIRED`, araya giren değişiklikte 409 ve "Kayıt başkası tarafından değiştirildi, yeniden yükleyin" mesajı döner; rol değiştirilip kaydetmeden geri alınınca kayıtlı ezmeler ekranda geri gelir (e2e).
- AC-207: ADMIN aktör + kilitli anahtar + rol değişimi + tam yetki haritası PATCH → 200 ve fazladan audit satırı yok (`users-p9` entegrasyon).
- AC-208: (S-P2-4) Önek bazlı kod denemesi 429'ları `rs_guest_code_rate_limited_total{scope:"prefix"}` metriğinde sayılır; runbook'ta alarm eşiği (15 dk'da ≥ 20) yazılıdır.
- AC-209: (S8b-8) Kapı 503 `NOT_READY` yanıtında IP/önek kovası tüketilmez, tenant kovası yalnız commit sonrası artar; 5 ardışık 503 sonrası geçerli istek 201 alır.
- AC-210: (S8b2-2) Güvenilen CIDR'dan gelen `/ws/request` upgrade'leri `wsUpgrade` kovasından muaftır; CIDR dışı aynı yük 429 alır.
- AC-211: (B-P11-3) MySQL ayarında "TLS gerekli" seçeneği vardır; seçiliyken TLS'siz sunucu testi `tls` hata sınıfı döner; TLS kapalıyken `allowPublicKeyRetrieval` yalnız loopback/özel ağ/compose servis adında açılır.
- AC-212: (B-P11-4) Başarısız MySQL testleri `rs_mysql_test_failed_total` metriğinde sayılır; runbook'ta alarm eşiği yazılıdır.
- AC-213: SMTP 587 + STARTTLS için iki test: yanlış sertifika adı → `tls` hatası, ileti gitmez; STARTTLS ilan etmeyen sunucu → gönderim yok.
- AC-214: (B-P10-6) Paralel `mfa/setup` yarışı gecikme kancasıyla 20 ardışık koşuda deterministik 409 üretir.
- AC-215: (T33, r2 — K-E11-1) WhatsApp/TURN/MySQL sistem ayarı değişikliği, SSO ayarı ve API anahtarı üretimi son 5 dk içinde step-up doğrulaması ister; değilse 401 `MFA_STEP_UP_REQUIRED` ve arayüz kod sorar. TOTP'si kurulu olmayan kullanıcıya 403 `MFA_SETUP_REQUIRED` döner. Step-up'ta geçerli **TOTP veya kurtarma kodu** kabul edilir; kurtarma kodu kullanılırsa tüketilir (ikinci kullanımda ret) ve audit'e `auth.step_up{method:"RECOVERY"}` yazılır (kod içermez); TOTP ile `method:"TOTP"` (r3, 2026-11-15: ad mimari §4.2 ve koda hizalandı). Telafi kontrolleri (AC-273, ADR-0022 r2): audit'e kod değil `method` ve kalan kod sayısı yazılır, "Kurtarma kodunuz kullanıldı" e-postası gider, kalan kod ≤ 3 ise yenileme uyarısı gösterilir.
- AC-216: (r2) `/ws/panel` hız sınırına takıldığında sunucu bağlantıyı close kodu **4429** ve gerekçede `retry=<sn>` ile kapatır (WS'de `Retry-After` başlığı kullanılmaz); istemci bu süre kadar bekleyip sessizce yeniden bağlanır; 12 sayfa/dk gezintide konsol hatası 0 (e2e).
- AC-217: Kalite borcu testle kapanır: `SYSTEM_AUDIT` JSDoc koda uyar + `_` önekli entegrasyon testi; web `canonicalWaUrl` contracts'tan gelir; çağrılmayan global retention fonksiyonları silinir; mysql/turn "değişmeyen PUT → audit yok" testi; `RETENTION_DEFAULT_DAYS` contracts'ta; CI'da shellcheck; `startup-check.ts` birim testi; `globals.css` koyu token kopyaları eşitlik testi.
- AC-218: Tek biçimlendirici kararı yazılıdır (ADR); biçimlendirici seçilirse CI `format:check` ana dalda 0 fark verir.
- AC-219: Entegrasyon ve e2e paketleri CI'da 20 ardışık koşuda 0 kararsız hata verir; `docs/implementation.md` kararsız test listesi boştur.

## G2 — UI ve erişilebilirlik

- AC-220: `/users/<olmayan id>` ve `/customers/<olmayan id>` belge yanıtı HTTP 404'tür ve sayfada tek h1 "… bulunamadı" vardır.
- AC-221: Kapalı ve kilitli toggle izi iki temada zemine karşı ≥ 3:1 kontrast verir (WCAG 1.4.11; token DESIGN.md'de).
- AC-222: 375/390 px'te menüdeki etkin öğe görünür alandadır ve kaydırılabilir menüde kaydırma ipucu vardır (e2e görünürlük kontrolü).
- AC-223: Müşteriler `status=all` boş durumu varsayılan boş durumla aynıdır ("Yeni müşteri" + yardım) ve sayfada tek "Müşteriye nasıl gönderilir?" diyaloğu vardır.
- AC-224: (r2) Ayarlar'da oturum süresi (`sessionTtlMin` — oturum linki geçerlilik süresi ve `maxActiveHours` — aktif oturumun en uzun süresi), açık oturum sınırı ve dosya boyutu sınırı alanları vardır; mevcut `PUT /settings/tenant` sınırlarıyla alan bazlı doğrulanır, audit'e eski→yeni yazılır; 5 durum, iki temada axe 0.
- AC-225: (r2) Geçmiş ve Talepler ekranındaki filtre seçenekleri sayfadaki kayıtlardan değil seçenek uçlarından gelir (rol kapsamıyla): **teknisyen** seçenekleri tam liste olarak gelir (150 teknisyenli fixture'da 150 seçenek); **müşteri** ve **firma** seçenekleri aramalı seçicidir, yazılan metne göre sunucudan en çok 20 sonuç döner.
- AC-226: Firma seçicide arama vardır; 250 firmalı fixture'da yazılan ada göre sunucu `q` ile ≤ 500 ms'de süzülür, klavyeyle seçilebilir.
- AC-227: (TEST-P5-4) Gönderen tarafta sohbet saniyede 5 mesajla sınırlıdır; aşımda "Çok hızlı yazıyorsunuz" uyarısı görünür, alıcıda sessiz düşme 0.
- AC-228: Kaydedilmemiş oturum notu varken uygulama içi geri tuşu "Kaydedilmemiş değişiklikler var" onayı gösterir.
- AC-229: `file.type` boş gelen `.webp` istemcide reddedilmez; karar sunucuda magic bytes ile verilir.
- AC-230: 256 MB üzerine yazma uyarısı bileşen testinde eşik altı/üstü iki durumla doğrulanır.

## G3 — Küçük özellikler

- AC-231: Hesap sayfasında "Kurtarma kodlarını yenile" vardır; geçerli TOTP ile `POST /auth/mfa/recovery-codes` 10 yeni kod döner, eski kodlar anında geçersizleşir, kodlar yalnız bir kez gösterilir; yanlış TOTP 5 denemede kilitlenir; audit `mfa.recovery_regenerated` (kod içermez).
- AC-232: Super Admin, başka bir Super Admin'in şifresini panelden sıfırlayabilir (geçici şifre bir kez gösterilir, ilk girişte değişim zorunlu, hedefin tüm oturumları kapanır, step-up AC-215); kendi şifresini bu yolla sıfırlayamaz; audit yazılır. Tek Super Admin varsa yol CLI'dır (P13b, AC-299).
- AC-233: Sistem ayarlarında "Sistem logosunu kaldır" vardır; onaydan sonra login ve PDF varsayılan Nokta logosuna döner; `app` yetkisi grants.sql + `check-app-grants.sh` ile doğrulanır; audit yazılır.
- AC-234: Paylaşım başlatılamadığında istemcinin neden kodu ve yöntemi (`share.state.reason/method`) teknisyen konsolunda Türkçe etiketle 2 sn içinde görünür; bilinmeyen kod ham gösterilir; 0.10.x istemciyle konsol hatasız çalışır.
- AC-235: (G-E9-17) Admin, IP/önek (IPv4 /32–/24, IPv6 /128–/48) veya cihaz anahtarı engeller; engelli kaynaktan talep, diğer reddedilen taleplerle aynı tek tip yanıtı alır ve kuyruğa düşmez; engel isteğe bağlı süreli (1 sa–süresiz), listelenebilir, kaldırılabilir; tenant izolasyonu; tenant başına ≤ 1.000 kayıt; audit yazılır; Talepler ekranında "Bu kaynağı engelle" kısayolu vardır.
- AC-236: Müşteri ekranında teknisyen avatarı, oturuma bağlı ve ≤ 10 dk geçerli imzalı URL ile gösterilir; oturum bitince URL 403 döner; avatarı olmayan teknisyende baş harf rozeti kalır.
- AC-237: `users.delete` anahtarı G4 kalıcı kullanıcı silme ucunu korur; anahtarsız Admin'e silme düğmesi görünmez ve uç 403 döner.
- AC-238: (S-P5-T2-4) `session_files` raporlayan tarafı (`TECH|CUSTOMER`) taşır; geçmiş ve CSV yalnız teknisyen raporlu ya da iki tarafça eşleşen satırı "doğrulanmış" gösterir; yalnız müşteri raporlu satır "Müşteri bildirimi" etiketiyle görünür.
- AC-239: (S12) Tenant ayarı "Talep kabulünde kabul kodu iste" açıkken kabul, müşterinin okuduğu 4 haneli kodla tamamlanır (AC-112 kuralları); kapalıyken bugünkü akış değişmez.

## G4 — Kalıcı silme (K27) ve dosya temizliği

- AC-240: Anonimleştirilmiş oturum, talep, onay ve bilgisayar kaydı satırları, anonimleşmeden 30 gün sonra gece işinde FK sırasına uygun kalıcı silinir; ikinci koşu 0 satır siler; `retention.run` audit'i silinen sayıları içerir.
- AC-241: (r2 — K-E11-4) Admin, pasif bir kullanıcıyı kalıcı siler (onay diyaloğunda kullanıcı adını yazarak); kişisel alanlar silinir, geçmiş ve audit ekranında "Silinmiş kullanıcı #<kısa id>" görünür, avatar dosyası diskten silinir; aktif kullanıcıda düğme pasiftir. Audit satırlarındaki eski `username` değeri değiştirilmez (audit değiştirilemezliği), audit saklama süresi (730 gün) dolunca satırla birlikte silinir; o güne kadar audit ekranında ve CSV'sinde **maskelenmiş** gösterilir (ör. `a***@***`), açık hâli hiçbir görünüm ucundan dönmez (entegrasyon testi).
- AC-242: Super Admin, en az 30 gündür pasif bir firmayı kalıcı siler (firma adını yazarak onay); firmanın tüm satırları (audit hariç, audit saklama süresine tabi) ve `uploads/{tenantId}/` klasörü silinir; işlem tek iş olarak ilerler, kesilirse kaldığı yerden sürer.
- AC-243: Haftalık yetim dosya taraması, DB'de karşılığı olmayan `uploads/` dosyalarını 7 gün sonra siler; bulunan/silinen sayısı metrikte ve audit'te görünür.
- AC-244: Kalıcı silmede yedeklerin en geç 14 gün içinde düştüğü kılavuzda ve runbook'ta yazılıdır; silinen firmanın yedekten geri yüklenmesi runbook'ta tanımlıdır.
