# QA Raporu — P10 (hesap güvenliği + SMTP) — Tur 2
DURUM: GEÇTİ

Tarih: 2026-11-12 · Denetçi: qa-denetci · Kapsam: AC-10 (rev.), 65 (rev.), 66, 67, 68, 78 (SMTP), 79, 80, 115 (logout-all, 2FA sıfırlama), 122, 151 + Tur 1 Düzeltilmeli 1–5 + güvenlik B-P10-1..9 regresyonu.
Çalışma ağacı (son commit beb97ea + diff/untracked). apps/agent-win kapsam dışı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (exit 0) |
| `pnpm -r run typecheck` | temiz (exit 0, web dahil) |
| `pnpm -r run test` | contracts 68/68 · web 205/205 · server unit 304/304 · skip 0 |
| server `test:int` (`rs-mysql-p10qa2:33334`, sonra `down`, konteyner silindi) | 42 dosya, 408/408 · skip 0 · ilk koşuda yeşil |
| `pnpm --filter @remote/web e2e` | 243 geçti · 84 atlandı · 0 hata |

- e2e'deki 84 atlama Tur 1'deki gibi gerekçeli (desktop/mobile proje filtreleri, `p4-real` `E2E_REAL` yoksa).
- `mail-tls-p10.test.ts` openssl ister: CI `ci.yml` entegrasyon işi `runs-on: ubuntu-24.04` (openssl ön yüklü), yerelde macOS LibreSSL ile de geçti. Sertifika test anında üretiliyor, depoya özel anahtar girmiyor.

## Tur 1 maddelerinin kapanışı
| # | Durum | Kanıt |
|---|---|---|
| 1 (AC-151 bildirim) | ✅ kapandı | `account-p10` "AC-151: yeni talep → ayarlı her alıcıya e-posta…": iki alıcı, gerçek public talep ucu (`requestClient.createReq`), gövdede ad/soyad/telefon (iki biçim)/e-posta/açıklama yok, talep kodu var; `request.notify{channel:email}` ×2 + `mail.sent{kind:request_notify}` ×2; SMTP portu 25 (kapalı) → talep yine 201, `request.notify` fail ×2 |
| 2 (AC-115) | ✅ kapandı | "logout-all sonrası … 5 sn içinde biter" ve "Admin 2FA sıfırlayınca …": gerçek sinyal odası (`startLive` + `admitted`), misafire `session.ended{reason:auth_revoked}` ≤ 5000 ms (süre ayrıca ölçülüyor), DB `status: ENDED, endReason: auth_revoked` |
| 3 (AC-10 içerik) | ✅ kapandı | Entegrasyon: teknisyen adı, link, `Intl` Europe/Istanbul son geçerlilik, `<img src="…/img/logo.png"`, biçimli kod; audit `subject` + `m***@example.test`. Unit: şablon HTML kaçışı, konu tek satır |
| 4 (yanıltıcı test adı) | ✅ kapandı | Test gerçek dinleyen sunucuyla `/ws/panel` ve `/ws/tech` yarım oturum çerezini HTTP 401/403 ile reddettiğini, `/users` 403 `MFA_REQUIRED` döndüğünü doğruluyor |
| 5 (prod kanalı) | ✅ kapandı | `app.ts:133` production + `mfaSetupEnforcement:false` → throw; unit "B-P10-3: NODE_ENV=production iken buildApp(...) hata fırlatır"; `makeApp` prod env'de varsayılanı `true` yapıyor |

## Kabul kriterleri
| AC | Durum | Kanıt (test adı) |
|---|---|---|
| AC-10 (rev.) | ✅ | `account-p10` "AC-10: kendi bekleyen oturumu gönderilir…" (içerik, yabancı link/token 400, başkasının oturumu 404, 21. istek 429 + Retry-After) + unit "AC-10 şablon"; e2e başarı/429 |
| AC-65 (rev.) | ✅ | "AC-65: 20. hatalı denemede kilit + bildirim e-postası"; B-P10-9 saatte 1 kilit e-postası |
| AC-66 | ✅ | "AC-66: her durumda 202; bağlantı 30 dk, tek kullanımlık…", "süresi dolmuş bağlantı 410…" |
| AC-67 | ✅ | Kurulum aşaması, doğrulama aşaması (tekrar oynatma, kurtarma kodu tek kullanım), yarım oturum WS/veri reddi, 5 (hesap+IP) / 15 (hesap geneli) → 429, USER tenant ayarı, 2FA sıfırlama; unit RFC 6238 vektörleri, HMAC kurtarma kodu |
| AC-68 | ✅ | "logout-all diğer oturumları anında geçersiz kılar", "30 dk hareketsizlik ve 8 sa mutlak süre" |
| AC-78 (SMTP) | ✅ | "AC-78/AC-79: şifre şifreli saklanır…" + unit AAD bağlama (B-P10-8) |
| AC-79 | ✅ | Sunucu testi + unit şema (port allowlist, Yok+kimlik reddi) + web `account.test.ts` + e2e |
| AC-80 | ✅ | "test maili gönderilir + audit…", "bağlanılamazsa 502 tek genel mesaj, sabit süre tabanı…" |
| AC-115 | ✅ | Bkz. madde 2 |
| AC-122 | ✅ | "özel/loopback/link-local hedef … 400 HOST_NOT_ALLOWED", unit B-P10-4 IPv6 (mapped, NAT64, 6to4, Teredo, ULA…), B-P10-1 kendi genel IP reddi, `mail-tls-p10` servername doğrulaması |
| AC-151 | ✅ | Kanal kapısı + test maili + bildirim testi (madde 1) |

## Düzeltilmeli
Yok.

## Regresyon / sözleşme uyumu (B-P10-1..9)
- Sözleşme değişiklikleri (`SMTP_ALLOWED_PORTS`, `SMTP_PORT_MESSAGE`, `SMTP_INSECURE_AUTH_MESSAGE`, `SMTP_SEND_FAILED_MESSAGE`) web'de tek kaynaktan (`lib/account/contract.ts`) tüketiliyor; `SMTP_ERROR_MESSAGES` kodda hiçbir yerde kalmadı. Sunucu alan anahtarları (`smtp.port`, `smtp.security`) web `smtpServerFields` ile eşleşiyor; mock (`mock-account.mjs`) aynı sabitleri sözleşmeden import ediyor.
- "Yok" seçiliyken web `user: ""` gönderiyor; sözleşme `smtpUserSchema` boşu `null`'a çeviriyor → sunucu reddetmiyor (e2e + unit yeşil).
- AAD: tüm `encrypt/decrypt` çağrıları (`auth/account.ts`, `mail/service.ts`, `tenants/service.ts`) `aadFor` kullanıyor; AAD'siz çağrı kalmadı. `schema.prisma` `code_hash` yorumu HMAC olarak güncellenmiş.
- P1–P9 entegrasyon dosyaları (`requests-p8b-2`, `ops-headers`, `db-busy-p8b`, `security-p8b-fix2`) yeni `makeApp` varsayılanıyla yeşil.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Unit + entegrasyon + e2e yeşil, gerekçesiz skip yok | ✅ | 68+205+304, 408/408, e2e 243/0 hata |
| Her AC'nin testi var ve gerçekten AC'yi doğruluyor | ✅ | Tur 1 boşlukları kapandı |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | mimari-api P10 sapma notu (9)–(13), implementation.md düzeltme turları |
| Tenant izolasyonu her uçta | ✅ | Değişiklik yok; tenant-matrix yeşil |
| Gizli bilgi şifreli/maskeli, loga yazılmaz | ✅ | AES-GCM + AAD, HMAC kurtarma kodu, test şifresi `FAKE_SMTP_PASSWORD` |
| Çoklu yazmalar transaction'da | ✅ | `mfaEnable` koşullu UPDATE (B-P10-6), `mfaVerify` sır `tx` ile |
| Dış çağrı zaman aşımı + genel hata | ✅ | deneme tavanı 12 sn, tek genel mesaj, sabit süre tabanı (unit + int) |
| Yeni env kurallara uygun | ✅ | Bu turda yeni env yok |
| Migration + grants + down guard | ✅ | Bu turda şema değişikliği yok (yalnız yorum) |
| Yeni bağımlılık gerekçeli, AGPL/GPL yok | ✅ | Yeni bağımlılık yok |
| Frontend 5 durum, a11y, ikon, token | ✅ | Port `SelectField`, Yok'ta pasif kimlik alanları, e2e axe yeşil |
| implementation.md güncel | ✅ | Backend + Frontend "Düzeltme turu 1" |

## Öneriler (zorunlu değil)
- `auth/session.ts:36` `setupEnforced` modül düzeyinde global ve her `buildApp` çağrısı onu eziyor (`app.ts:134`). Üretimde tek uygulama örneği olduğu için etkisi yok; ama testte aynı dosyada ikinci bir uygulama açılınca ilk uygulamanın davranışı da değişiyor. Örnek: `account-p10.test.ts:229/245` `startLive({mfaSetupEnforcement:false})` sonrası dosyanın kalan testleri (AC-68 süre, SMTP, AC-66, AC-65, AC-10, AC-151) ana uygulamada zorlama **kapalı** koşuyor. Bu testlerin hiçbiri kurulum aşamasını doğrulamadığı için AC kanıtı geçersizleşmiyor; yine de "P10 testleri zorlama açık koşar" iddiası dosyanın ikinci yarısı için doğru değil. Öneri: bayrağı uygulama örneğine taşımak (ör. `AuthContext`/decorate) ve AC-115 testlerinde `mfaSetupEnforcement: true` kullanmak.
- `docs/mimari-api.md` P10 sapma notu (7) hâlâ `SMTP_ERROR_MESSAGES`'tan söz ediyor; (11) onu geçersiz kılıyor. (7)'ye "(11) ile değişti" notu eklenebilir.
- Etkileşimli SMTP hatasında yanıt ≥ 12 sn: web'deki yükleniyor durumu buna göre ayarlanmış; test-operatoru turunda gerçek sürede kullanıcı deneyimi gözlenmeli.
- Kurtarma kodu yenileme ucu (Tur 1 önerisi) hâlâ açık; gereksinim değişikliği → proje-yöneticisi.

## Olumlu
- Yeni testler gerçek davranışı ölçüyor: gerçek WS odası ve ≤ 5 sn ölçümü, gerçek public talep ucu ve PII'nin olmadığına dair negatif doğrulamalar, TLS servername için gerçek TLS el sıkışması (yanlış adda ileti gitmediği de doğrulanıyor).
- Sabit süre tabanı (anında ret ile zaman aşımı arasındaki fark < 250 ms) unit testte ölçülüyor; port/TLS ayrımı yanıt süresinden okunamıyor.
- Web, kayıtlı geçersiz portu sessizce değiştirmek yerine "artık desteklenmiyor" diye gösteriyor; veri kaybı yok.
