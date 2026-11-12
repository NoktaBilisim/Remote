# Tasarım Kontrol Listesi Kararları — Remote Support
Kaynak: `~/.claude/checklists/tasarim-kontrol-listesi.md` · Tarih: 2026-11-10 · Ayrıntı: `docs/mimari.md` (§ numaraları), ADR'ler `docs/adr/`.
Karar: **Kapsamda** / **Sonra** / **Kapsam dışı**. Bakılmamış madde yoktur.

## 1. Kimlik ve Erişim
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Kimlik doğrulama yöntemi | Kapsamda: e-posta/kullanıcı adı + şifre + TOTP 2FA. SSO/LDAP, magic link: Sonra | Ortak std. 1.3; mimari §5.1 | P1, P10 |
| Şifre politikası, sıfırlama, kilit, brute-force | Kapsamda: ≥12 kar., argon2id, 30 dk tek kullanımlık sıfırlama, 5 hata → 15 dk kilit + IP 20/dk | AC-64..66 | P1, P10 |
| Yetkilendirme modeli, IDOR | Kapsamda: rol + `permissions` toggle; `tenantScope` + sahiplik; başka tenant → 404 | §5.1, AC-61, 69 | P1→ |
| Oturum yönetimi | Kapsamda: opak DB oturumu, boşta 30 dk / mutlak 8 sa, çoklu cihaz serbest, "tüm cihazlardan çıkış" | ADR-0008, AC-68 | P10 |
| Davet / onay / hesap silme (KVKK) | Kapsamda: Admin kullanıcı oluşturur (geçici şifre + zorunlu değişim); kullanıcı silme = soft + PII anonimleştirme; self-servis kayıt Kapsam dışı (kötüye kullanım, R6); e-posta daveti Sonra | §3, P9 | P9 |
| Servis hesapları / API anahtarları | Kapsam dışı: public API yok. TURN secret ve metrics token rotasyonu Kapsamda (runbook) | ADR-0007, §8 | P3, P13 |
| Müşteri (misafir) erişimi | Kapsamda: token/kod → nonce → ticket → reconnect token zinciri, hepsi hash | §5.1, ADR-0006 | P2, P3 |

## 2. Veri Modeli
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| created_at/updated_at/deleted_at/created_by | Kapsamda: tüm tablolarda created/updated; `deleted_at` yalnız tenants/users; `created_by` consent_texts ve system_settings (`updated_by`); audit_logs append-only (updated_at yok) | §3.1 | dba her paket |
| Silme stratejisi | Kapsamda: soft (tenant/user), hard yalnız retention işiyle; FK `RESTRICT`, cascade yok | §3 | P13 (retention) |
| Para | Kapsam dışı: finansal veri yok | — | — |
| Tarih/saat | Kapsamda: `DATETIME(3)` UTC, gösterim Europe/Istanbul `date-fns-tz` (yaz saati kütüphanede) | §3 | tümü |
| Benzersizlik / indeks / partition | Kapsamda: §3.1 indeksleri, `active_code` global UQ, `token_hash` UQ. Partition Kapsam dışı (3 yılda ~250k oturum) | §3.1, §7 | dba |
| Migration / geri alma / seed | Kapsamda: Prisma Migrate + elle `down.sql`, expand→contract; seed: Super Admin (env'den şifre), demo tenant, varsayılan aydınlatma metni | §8.3 | P1→ |
| Audit izi | Kapsamda: §3.3, maskeleme, DB tetikleyicisi | AC-74, 75, 76 | P1, P11 |
| Multi-tenant izolasyon | Kapsamda: tek DB, `tenant_id`, repository imzası zorunlu, otomatik çapraz test | Ortak std. 1.3, V1 | P1→ |
| Dosya/ek yönetimi | Kapsamda: yalnız logo/avatar, `uploads/{tenant_id}/` rastgele ad, 2 MB, magic bytes, sharp. Oturum dosyaları sunucuda yok (P2P). Virüs taraması Kapsam dışı (içerik sunucuya gelmez); imzalı URL Kapsam dışı (avatar oturumlu uçtan, logo rastgele adla public) | §5.2 T16, AC-84 | P12 |
| Kalıcı olmayan durum | Kapsamda: oda/nonce/ticket bellekte | ADR-0005 | P3 |

## 3. API ve Entegrasyon
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| API sözleşmesi önce / versiyon | Kapsamda: `docs/mimari-api.md` + zod `packages/contracts`, `/api/v1`. OpenAPI üretimi Sonra (public API yok; genişleme: `zod-to-openapi`) | §4 | P1→ |
| Standart hata formatı | Kapsamda: `{error:{code,message,fields,requestId}}`; kullanıcıya Türkçe mesaj, logda teknik ayrıntı | mimari-api | P1 |
| Sayfalama/sıralama/filtre | Kapsamda: page/pageSize (25, ≤100), izinli sort alanları | AC-60 | P8, P11 |
| Rate limiting / idempotency | Kapsamda: login, resolve, oturum oluşturma, WS mesaj; `@fastify/rate-limit` bellek içi. Idempotency key Kapsam dışı (ödeme yok); join tek kullanımlık nonce ile doğal idempotent | §5.2 | P1–P3 |
| Timeout / retry / circuit breaker | Kapsamda: SMTP 10 sn + 1 retry, MySQL test 10 sn. Circuit breaker Kapsam dışı (tek dış servis SMTP, düşük hacim) | §7 | P10, P11 |
| Webhook | Kapsam dışı: webhook yok | — | — |
| CORS | Kapsamda: kapalı (aynı origin, Caddy); WS Origin allowlist | ADR-0002 | P1, P3 |
| WS/DC sözleşmesi | Kapsamda: `docs/mimari-protokol.md`, zod strict, Go fixture testi | ADR-0004 | P3–P7 |

## 4. Güvenlik (tasarım aşamasında)
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Tehdit modeli (STRIDE) | Kapsamda: 25 tehdit (T1–T26, T15–T18 dahil), güvenlik raporu Tur 0 izlenebilirliği mimari §5.5; güven varsayımı: uygulama sunucusu TCB içinde (T25) | mimari §5.2, §5.5 | — |
| Giriş noktaları | Kapsamda (envanter): REST public (`/public/*`), REST oturumlu, `/ws/tech`, `/ws/guest`, DataChannel'lar (`ctl`/`file`/`input`), TURN 3478/443, upload uçları, agent indirme, Caddy 4450 | §5.2 | — |
| Girdi doğrulama / çıktı kodlama | Kapsamda: REST + WS + DC mesajları zod `strict()` (alıcı tarafında da doğrulanır — DC karşı uçtan gelir, güvenilmez); React metin bağlama; `dangerouslySetInnerHTML` ESLint ile yasak; Go istemci Win32 düz metin | AC-17, 35 | P1→ |
| Gizli bilgi yönetimi | Kapsamda: `.env` repo dışı + zod `env.ts`; panel gizlileri AES-256-GCM, anahtar sürümlü (`APP_ENCRYPTION_KEYS`) → rotasyon; formda geri yazılmaz. Harici secret manager Sonra (tek sunucu) | §3.2, AC-78 | P1, P11 |
| Hassas veri sınıflandırma / şifreleme | Kapsamda: §5.3 tablo; in-transit TLS 1.2+ (Caddy), DTLS-SRTP medya, TURN-TLS; at-rest yalnız gizli alanlar şifreli + yedek `age` ile şifreli. Disk şifreleme sunucu seviyesinde Sonra (devops önerisi) | §5.3, §8.3 | P1, P13 |
| Log maskeleme | Kapsamda: pino redaksiyon + audit mask + `/session/<token>` path maskesi; log tarama testi | AC-90, 75 | P1 |
| Bağımlılık taraması / SBOM / lisans / secret | Kapsamda: `pnpm audit` + `govulncheck` (Kritik/Yüksek 0), `license-checker` + `go-licenses` (AGPL/GPL yasak, K7 kararına kadar), SBOM CycloneDX CI artefaktı, gitleaks | AC-94, R8 | P1, P6 |
| Güvenlik başlıkları / CSRF | Kapsamda: nonce CSP, HSTS, `frame-ancestors 'none'`, nosniff, no-referrer, Permissions-Policy; CSRF double-submit + Origin | §5.4, ADR-0008 | P1 |
| Yönetici paneli ayrı yetki + 2FA/IP | Kapsamda: Super Admin uçları rol kontrolü, Admin/Super Admin 2FA zorunlu. IP allowlist Sonra (tenant ayarı olarak genişleme noktası `guards.ts`) | AC-67 | P10 |
| WebSocket güvenliği | Kapsamda: upgrade öncesi Origin + çerez/ticket, 64 KB, 50 msg/sn, ping/pong, IP başına 20 WS | AC-14..19 | P3 |
| Brute-force (oturum kodu) | Kapsamda: 8 hane, ipKey 10/dk + prefixKey 30/dk (15 dk blok), global = alarm; **lobi + teknisyen admitCode kabulü** (K6 kapandı, G-01/G-02) | ADR-0006 | P2, P3 |
| Uzaktan kontrol yetkisi | Kapsamda: sunucu yetki + mod kontrolü, istemci izin kapısı, enjekte tıklama yok sayma, kısayol | ADR-0009, T4, T5 | P7 |
| TURN kötüye kullanımı | Kapsamda: credential admit sonrası, ≤ 60 dk + yenileme; genişletilmiş `denied-peer-ip` + ortam dosyası; `max-bps`; oran alarmı (G-05, G-13) | ADR-0007, AC-21, 22 | P3 |
| İstemci bütünlüğü | Kapsamda: imza yok; tekrarlanabilir build, SHA256SUMS, **GitHub attestation + deploy'da doğrulama + günlük dış gözcü**, ldflags-only URL, DLL arama güvenliği (G-07, G-08); SignPath başvurusu P6 ile paralel. Pinning Kapsam dışı; SAS Sonra (G-14) | ADR-0010 | P6 |
| Açık kaynak repo gizli bilgi | Kapsamda: `.env*` ignore, `.env.example` boş anahtarlar, CI gitleaks (bulgu = kırmızı), fixture'larda gerçek değer yok | T18 | P1 |
| Dosya yükleme | Kapsamda: magic bytes, yeniden kodlama, SVG yok, 2 MB, tenant klasörü | T16, AC-84 | P12 |
| Kötüye kullanım (dolandırıcılık) | Kapsamda: self-servis kayıt yok, kimlik + alan adı gösterimi, sabit uyarı, `mailto:` bildirim, her monitörde topmost gösterge, tenant firma doğrulaması (runbook); gizli mod Kapsam dışı; oturum sonu özeti Sonra (AC-107 çelişkisi) (G-17) | R6, T3 | P4, P6, P7, P13 |
| Canlı yetki iptali / zorla sonlandırma | Kapsamda: `/terminate`, `endByTechnician`, `control.revoke`, 60 sn WS doğrulama (G-04) | mimari §5.1, akış A5 | P3, P7, P9, P10 |
| İç ağ SSRF (ayar test uçları) | Kapsamda: `netguard.ts` (G-12) | T22 | P10 |
| CSV enjeksiyonu | Kapsamda: `csv.ts` (G-16) | T23 | P8, P11 |

## 5. Kullanıcı Deneyimi ve Arayüz
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| 5 durum | Kapsamda: her liste/form; konsol bağlantı durumları (bekliyor / bağlanıyor / aktif / koptu-yeniden bağlanıyor / bitti) | Kalite std. | P2→ |
| Form doğrulama | Kapsamda: zod şeması web'de de (contracts), alan bazlı hata, `fields` sunucudan forma | mimari-api | P1→ |
| Yıkıcı işlem onayı / undo | Kapsamda: iptal/sonlandır/pasife al onaylı; müşterinin "Kontrolü kapat" onaysız ve anlık. Undo Kapsam dışı (işlemler geri alınamaz nitelikte) | gereksinimler §9 | P2, P4, P9 |
| Responsive | Kapsamda: yönetim ekranları responsive; konsol ≥1280 px; mobil müşteri "desteklenmiyor" ekranı | AC-33 | P4 |
| Erişilebilirlik | Kapsamda: WCAG 2.1 AA, axe e2e, istemci butonları klavye erişimli | AC-39, 100 | tümü |
| Yerelleştirme | Kapsamda: Türkçe, i18n anahtar dosyası (`apps/web/messages/tr.json`, kütüphane yok — basit `t()`); İngilizce Sonra; RTL Kapsam dışı | NFR | P1 |
| Bildirim stratejisi | Kapsamda: Sonner toast; e-posta yalnız link/sıfırlama; push Kapsam dışı | gereksinimler §9 | P2, P10 |
| Yavaş ağ / optimistic update | Kapsamda: adaptif bitrate (WebRTC), kalite uyarısı, 120 sn reconnect; optimistic update yok (sunucu onayı beklenir) | AC-24, 45 | P3–P5 |
| Başlıklar / breadcrumb / 404/500 | Kapsamda: sayfa başlıkları, panel breadcrumb, 404/500 + müşteri 410 ekranları | AC-5 | P1, P2 |
| Tasarım token'ları | Kapsamda: `DESIGN.md` + Tailwind theme CSS değişkenleri, açık/koyu; lint ile ham renk yasağı | AC-87, std. 1.8 | P1, P12 |
| İstemci (Win32) UI | Kapsamda: Türkçe, DPI PerMonitorV2, %100/125/150 test, gösterge her zaman üstte | AC-103, 110 | P6 |

## 6. Performans ve Ölçek
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Beklenen yük | Kapsamda: 50 eşzamanlı oturum, ~100 WS; 1 yıl ~80k oturum, 3 yıl ~250k; audit ~2M satır/yıl | S4 varsayılan, §7 | — |
| N+1 / indeks / ağır rapor | Kapsamda: §3.1 indeksleri, liste `include` yok; ayrı okuma yolu Kapsam dışı (hacim düşük) | AC-60 | P8 |
| Önbellek | Kapsamda (minimum): yalnız `tenant_settings` 30 sn bellek, PUT'ta invalidation; başka önbellek yok | §7 | P3 |
| Arka plan işleri / kuyruk | Kapsamda: süreç içi zamanlayıcı (expiry, retention); kuyruk (BullMQ) Sonra — genişleme `jobs/` | ADR-0005 | P2, P13 |
| Büyük liste / export | Kapsamda: CSV stream, cursor partileri, 50.000 satır sınırı | §7 | P8, P11 |
| Performans bütçesi | Kapsamda: karşılama JS ≤150 KB gz, LCP <2,5 sn; konsol ≤300 KB; istemci ≤40 MB, açılış ≤5 sn; medya hedefleri AC-40..42, 57 | NFR | P4–P6 |
| Medya ölçeği (TURN bant genişliği) | Kapsamda: 4 Mbps tavan; TURN VM ayrı; kapasite ölçümü staging'de | R7, K3 | P4 |

## 7. Operasyon ve Gözlemlenebilirlik
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Yapılandırılmış log / korelasyon | Kapsamda: pino JSON, `requestId`, WS bağlantı ID, seviye `LOG_LEVEL` | AC-90 | P1 |
| Metrik / alarm / health | Kapsamda: `/health`, `/ready`, `/metrics` (token + iç ağ), coturn Prometheus; alarm eşikleri §8.2 | AC-88, 89 | P1, P3, P13 |
| Hata izleme | Sonra: self-hosted Sentry/GlitchTip; şimdi `requestId` kullanıcıya gösterilir | §8.2 | — |
| Yedekleme + geri yükleme testi | Kapsamda: günlük dump, 14 gün, şifreli, aylık geri yükleme testi | AC-91 | P13 |
| Ortamlar / feature flag | Kapsamda: dev, staging, prod (compose + env farkı). Feature flag Kapsam dışı (paket sırası yeter) | §8.3 | P1, P13 |
| CI/CD + rollback | Kapsamda: lint → type → test → build → bağımlılık/lisans/gitleaks taraması → tekrarlanabilir istemci build + SHA256SUMS; deploy elle tetiklenen workflow; rollback önceki imaj etiketi | AC-94 | P1, P6, P13 |
| Sıfır kesintili migration / bakım modu | Kısmen: expand→contract migration Kapsamda; sıfır kesinti Kapsam dışı (tek instance; deploy aktif oturumları düşürür → bakım penceresi + "aktif oturum var" kontrolü runbook'ta) | ADR-0005 | P13 |
| Runbook | Kapsamda: servis düştü, TURN çalışmıyor, sertifika süresi doldu, **istemci yayını + attestation doğrulama + dış gözcü alarmı** (G-25), denied-peer-ip güncelleme (G-05), staging güvenlik duvarı, tenant firma doğrulaması ve kötüye kullanım bildirimi (G-17), veri bozuldu/geri yükleme, TURN secret rotasyonu, SignPath başvurusu | AC-92 (rev.) | P13 |

## 8. Uyumluluk ve Hukuk
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| KVKK | Kapsamda: sürümlü aydınlatma metni (`consent_texts`), açık onay kaydı (görüntüleme ve kontrol ayrı), retention 90–730 gün, anonimleştirme; silme talebi = Admin oturum kaydını anonimleştirir (Sonra: ekran; şimdi retention + runbook prosedürü) | §3.4, AC-29 | P4, P13 |
| Çerez politikası | Kapsamda: yalnız zorunlu çerezler (`rs_session`, `rs_csrf`, tema `localStorage`); bilgi notu, banner gerekmez | — | P1 |
| 3. parti lisanslar / proje lisansı | Kapsamda: **Apache-2.0** (K7 kapandı, ADR-0011); RustDesk'ten kod alınmaz (`NOTICE`); AGPL/GPL bağımlılık yasak, CI lisans taraması; coturn (BSD) ayrı süreç; H.264 MF codec OS lisansıyla | R8, ADR-0011 | P1, P6 |
| Finansal veri | Kapsam dışı: finansal işlem yok | — | — |

## 9. Proje Yönetimi
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Kapsam dışı listesi | Kapsamda: gereksinimler §3 (10 madde) geçerli; mimari ek kapsam dışı: OpenAPI, çoklu instance, feature flag | gereksinimler | — |
| Ölçülebilir AC | Kapsamda: AC-1..111 + önerilen AC-112..128 (mimari §13 değişiklik talebi), §11'de hepsi eşlendi | §11, §13 | — |
| Riskler / açık sorular | Kapsamda: R1–R10 + mimari §12 (K1, K3 kısmen, K8, K9, K10 açık; K2, K6, K7 kapandı) | §12 | — |
| Definition of Done | Kapsamda: kalite std. + paket kuralları (mimari §10.1, §10.3) | §10 | — |
| Dokümantasyon planı | Kapsamda: README, docs/api.md (mimari-api.md'den), KULLANIM_KILAVUZU (AppLocker/AV allowlist rehberi dahil), DATASHEET, PDF'ler, ADR'ler, runbook | AC-93 | P13 |

## "Sonra" listesi (unutulmasın)
SSO/LDAP, magic link, e-posta daveti, OpenAPI üretimi, harici secret manager, IP allowlist, disk şifreleme, Sentry/GlitchTip, kuyruk (BullMQ), çoklu instance (Redis RoomBus), KVKK silme talebi ekranı, İngilizce arayüz, SAS/DTLS parmak izi doğrulaması (G-14), oturum sonu müşteri özeti (G-17), OpenSSF Scorecard (G-18), WS relay yedek taşıma (ADR-0011), SignPath Foundation imzalama başvurusu (ADR-0010), VP9/AV1 codec + gereksinimlerdeki Sonra maddeleri (kayıt, çoklu teknisyen, ses, clipboard, macOS/Linux, SMS/WhatsApp link, ITSM).

---
# E9 — Müşteri destek talebi (P8b) kontrol listesi kararları
Tarih: 2026-11-12 (r2: güvenlik tasarım turu E9 G-E9-1..14 işlendi) · Ayrıntı: `docs/mimari-e9.md` (§ numaraları), ADR-0016, ADR-0004 r3, ADR-0006 r4. Yukarıdaki genel kararlar geçerlidir; burada yalnız E9'un etkilediği maddeler yazılır. Her madde karara bağlandı.

## 1. Kimlik ve Erişim
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Kimlik doğrulama yöntemi | Kapsamda: müşteri hesapsız — tenantRef (bağlam) → talep sırrı (256 bit, yalnız istemci belleği) → wsTicket → reconnectToken | §5.1, ADR-0016 | P8b-1, P8b-2 |
| Şifre / brute-force | Kapsamda: geçersiz ref/sır ipKey 10/dk, 15 dk blok; global = alarm. Şifre değişikliği yok | §5.4, T28 | P8b-1 |
| Yetkilendirme / IDOR | Kapsamda: `support_requests.view/accept` (tek tanım), `settings.edit` ayarlar; `tenantScope` tüm talep uçlarında, başka tenant 404; Super Admin firma seçmeli; kuyruk tenant genelinde (V17 — "yalnız kendi" kuralı bilinçli olarak uygulanmaz) | §4, AC-147/148 | P8b-1 |
| Oturum yönetimi | Kapsamda: `/ws/panel` 60 sn `auth_sessions` + yetki yeniden doğrulaması, kullanıcı başına ≤ 5 soket; müşteri tarafında oturum yok | protokol §5.3 | P8b-1 |
| Davet / hesap silme (KVKK) | Kapsamda: "Bilgilerimi unut" (yerel), sunucuda saklama + anonimleştirme işi. Sunucudaki talep için bireysel silme talebi ekranı **Sonra** (genel "KVKK silme talebi ekranı" maddesiyle birlikte; şimdi runbook prosedürü) | §3.6 | P8b-1, P8b-2 |
| Servis hesapları / API anahtarları | Kapsamda: tenantRef yenileme (rotasyon, AC-131). WhatsApp servisi kimliksiz — anahtar yok; URL yalnız env | §3.1, T33 | P8b-1 |

## 2. Veri Modeli
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| created/updated/deleted/created_by | Kapsamda: iki yeni tabloda created/updated; soft delete yok (talepler retention'la anonimleşir); `accepted_by`/`rejected_by` kim bilgisi | §3.1–3.2 | P8b-1 (dba) |
| Silme stratejisi | Kapsamda: anonimleştirme (P8b-1), hard delete P13 (önce oturum, sonra talep; FK RESTRICT) | §3.6 | P8b-1, P13 |
| Para | Kapsam dışı: finansal veri yok | — | — |
| Tarih/saat | Kapsamda: UTC `DATETIME(3)`; bekleme süresi istemcide `serverTime` ile (saat kayması etkilemez); gösterim Europe/Istanbul | §3.2, protokol §5.1 | P8b-1, P8b-2 |
| Benzersizlik / indeks / partition | Kapsamda: UQ `request_ref`, `secret_hash`, `support_sessions.request_id`; 5 indeks (§3.2). Partition Kapsam dışı (tenant başına ≤ 50 bekleyen; yıllık hacim oturumlarla aynı mertebe) | §3.2 | P8b-1 |
| Enum / CHECK | Kapsamda: ADR-0014 ikili CHECK (status, cancel_reason), durum ↔ alan tutarlılık CHECK'leri, telefon/ref/label REGEXP `'c'`; anonimleştirmeyle çelişmeyen PII CHECK'i | §3.2 | P8b-1 |
| Migration / geri alma / seed | Kapsamda: expand-only migration + `down.sql` (talep oturumu yokken), P2 CHECK ayrımı; seed: aydınlatma metni yeni sürüm (yerel saklama + süre) | §8 | P8b-1 |
| Audit izi | Kapsamda: 11 olay (§12); ad/telefon/açıklama audit'e yazılmaz; alıcı telefonları maskeli | §12, AC-160 | P8b-1 |
| Multi-tenant izolasyon | Kapsamda: `tenant_id` her satırda; hub tenant anahtarı soket bağlamından; AC-69 aracı 9 uç + 2 WS | T35, AC-148 | P8b-1 |
| Dosya/ek | Kapsam dışı: talepte ek yok. Firma dosyası = mevcut tek ikili (yükleme yok) | ADR-0006 r4 | — |
| Kalıcı olmayan durum | Kapsamda: hub soketleri, 120 sn/60 sn zamanlayıcılar, WhatsApp denemeleri bellekte; yeniden başlatmada süpürücü toparlar | §3.5 | P8b-1 |

## 3. API ve Entegrasyon
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Sözleşme önce / versiyon | Kapsamda: mimari-api "Destek talepleri (P8b)", protokol §5, zod `api/requests.ts` + `ws-request.ts`, Go ortak fixture; `/api/v1`, WS `rs.v1` | §4 | P8b-1 |
| Hata formatı / kodlar | Kapsamda: mevcut zarf + 5 yeni kod (`REQUEST_REF_INVALID`, `REQUEST_PENDING`, `REQUEST_TAKEN`, `REQUEST_CLOSED`, `QUEUE_FULL`); müşteriye Türkçe metin, ayrıntı log | §12 | P8b-1 |
| Sayfalama / filtre | Kapsamda: bekleyenler sayfasız (≤ 50), geçmiş sekmesi 30 gün sayfalı + durum filtresi; oturum geçmişine `source` filtresi | mimari-api | P8b-1 |
| Rate limit / idempotency | Kapsamda: §5.4 + **r2 §13.6** (IPv6 /48 kovası, ağ öneki başına 10 bekleyen, ≥ 40'ta yalnız bilinen kaynak, tenant kilitlenmez, güvenilen CIDR muafiyeti); WhatsApp tenant 30/sa, alıcı 10/sa, global 300/sa + özet. Idempotency key Kapsam dışı: kabul/ret/decline koşullu UPDATE ile doğal idempotent | §5.4, §13.5–13.6 | P8b-1 |
| Timeout / retry / circuit breaker | Kapsamda: WhatsApp 8 sn × 3 deneme (0/+5/+20 sn, ≤ 60 sn); test tek deneme. Circuit breaker Kapsam dışı (düşük hacim; başarısızlık oranı alarmı yeter) | §6 | P8b-1 |
| Webhook | Kapsam dışı: whatsapp-bildirim'den geri çağrı yok | — | — |
| CORS | Kapsamda: değişmez (kapalı); public POST'lar yalnız Origin'siz AGENT (ADR-0012) — tarayıcıdan talep Kapsam dışı (web formu Sonra) | §4 | P8b-1 |
| WS sözleşmesi | Kapsamda: `/ws/request`, `/ws/panel`, `/ws/guest` ön-kabul yolu | protokol §5 | P8b-1, P8b-2 |

## 4. Güvenlik
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Tehdit modeli | Kapsamda: T28–T38 + güvenlik tasarım turu E9 G-E9-1..14 (r2, mimari-e9 §13): talep–kişi bağı (`requestCode` + bilinen kaynak, kayıtlı numaradan arama), onay tazeliği (her kabulde tek tık), asgari sürüm, WhatsApp içeriği, kova atlatma | §5.2, §13 | P8b-1, P8b-2 |
| Giriş noktaları | Kapsamda (envanter eki): 4 public REST, 9 panel REST, `/ws/request`, `/ws/panel`, firma `/downloads/NoktaDestek-*`, istemci dosya adı ve hatırlama dosyası, WhatsApp çıkışı | §4 | — |
| Girdi doğrulama / çıktı kodlama | Kapsamda: zod strict (ad/telefon/e-posta/açıklama/ret mesajı, Cc/Cf/bidi reddi), Go aynı kurallar (fixture); React metin; Win32 statik metin; WhatsApp şablonu sunucuda | T37, T38, AC-134 | P8b-1, P8b-2 |
| Gizli bilgi yönetimi | Kapsamda: `WHATSAPP_SERVICE_URL` env (gizli değil); talep sırrı hash; yeni gizli anahtar yok | §8 | P8b-1 |
| Hassas veri / şifreleme | Kapsamda: §5.3; yerel dosya DPAPI; **r2:** WhatsApp'a kişisel veri gitmez (yurt dışı aktarım yok); prod'da güvensiz WhatsApp adresi → kanal kapalı (fail-closed); K13 prod ön koşulu: TLS/özel ağ + güvenlik duvarında yalnız Remote sunucusu | T34, §13.5, ADR-0004 r3 | P8b-1, P13 |
| Log maskeleme | Kapsamda: `requestSecret`, subprotocol `rs.req.*`, firma indirme yolu (Caddy), ref yalnız ilk 4 karakter audit'te; telefon maskeli | T31, §8 | P8b-1 (devops: Caddy) |
| Bağımlılık / SBOM | Kapsamda: yeni bağımlılık yok; mevcut tarama | — | — |
| Başlıklar / CSRF | Kapsamda: panel durum değiştiren uçlar Origin + CSRF; `/ws/panel` Origin + çerez; CSP `connect-src` mevcut (aynı host) | §4 | P8b-1 |
| Yönetici paneli ayrı yetki + 2FA/IP | Kapsamda: ayarlar `settings.edit`; 2FA P10 (prod ön koşulu değişmez); IP allowlist Sonra (genel karar) | — | P10 |
| İstemci bütünlüğü | Kapsamda: firma dosyası aynı ikili (AC-130 testi), `agent-watch` firma adıyla da indirir; sunucu URL ldflags-only değişmez | T32 | P8b-1 (devops), P8b-2 |
| Kötüye kullanım | Kapsamda: sınırlar, ref yenileme, dolandırıcılık uyarısı + "Kötüye kullanımı bildir" (AC-125); **r2:** 6 haneli talep kodu (gösterim) + bilinen kaynak bayrağı + "firmanın kayıtlı numarasından arayın, kodu sorun" ipucu/kılavuz; resmi alan adında keyfi adlı firma bağlantısı `forward_auth` ile 404; ret mesajında bağlantı/telefon yasak; asgari istemci sürümü (`CLIENT_OUTDATED`). Talepte zorunlu kabul kodu (S12) Sonra listesinin başında | T29, §13.1, §13.4, §13.7 | P8b-1, P8b-2 |

## 5. Kullanıcı Deneyimi ve Arayüz
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| 5 durum | Kapsamda: Talepler (yükleniyor/boş "Bekleyen talep yok"/hata/kısmi — anonimleştirilmiş kayıt PII yok/başarılı), ayar ekranı, istemci (bağlanılıyor/form/gönderiliyor/bekliyor/sonuç: kabul, ret, süre doldu, iptal, ağ/TLS hatası) | AC-133, 146 | P8b-1, P8b-2 |
| Form doğrulama | Kapsamda: alan bazlı, istemci ve sunucu aynı kurallar; sunucu `fields` istemcide ilgili alana; ilk hatalı alana odak | AC-134, 164 | P8b-2 |
| Yıkıcı işlem onayı / undo | Kapsamda: "Bağlantıyı yenile" ve "Reddet" onaylı (hazır mesaj varsayılan); "Kabul et" teknisyende onaysız (yarışta 409); **müşteride kabul sonrası her seferinde "Ekranımı paylaş / Vazgeç" (r2, odak Vazgeç, 1,5 sn, otomatik onay yok)**; müşterinin "İptal" ve "Bilgilerimi unut" anlık. Undo Kapsam dışı | §13.3 | P8b-1, P8b-2 |
| Responsive | Kapsamda: Talepler ekranı mobilde kart listesi (dokunma hedefi ≥ 44 px); istemci sabit pencere, DPI PerMonitorV2 | DESIGN.md | P8b-1, P8b-2 |
| Erişilebilirlik | Kapsamda: WCAG 2.1 AA; toast `aria-live="polite"`, ses tek başına bildirim değil; istemci Tab sırası ad→telefon→e-posta→açıklama→hatırla→KVKK→Gönder, Enter gönderir (KVKK işaretsizse pasif) | AC-164 | P8b-1, P8b-2 |
| Yerelleştirme | Kapsamda: Türkçe; süre Europe/Istanbul; telefon TR öncelikli normalizasyon | AC-134 | — |
| Bildirim stratejisi | Kapsamda: panel toast + ses (birincil), sekme başlığı, `queue.alert` yoğunluk bandı; WhatsApp yalnız "yeni talep – firma – talep kodu – panel" (kişisel veri yok, r2); e-posta P10; müşteriye dış bildirim Kapsam dışı. `/ws/panel` çıkış/yetki kaybında anında kapanır (r2) | §6, §13.5, §13.7 | P8b-1, P10 |
| Çevrimdışı / yavaş ağ | Kapsamda: `/ws/request` 120 sn tolerans + otomatik yeniden bağlanma (1, 2, 4, 8… ≤ 15 sn geri çekilme); panel WS yeniden bağlanma + REST ile yeniden çekme; optimistic update yok | protokol §5 | P8b-1, P8b-2 |
| Başlıklar / breadcrumb | Kapsamda: "Talepler", "Ayarlar › Destek talepleri"; menü ikonu lucide `Inbox`, ayar `Download`/`MessageCircle` | Ortak std. 1.8 | P8b-1 |
| Tasarım token'ları | Kapsamda: DESIGN.md tokenları; rozet ve toast mevcut bileşenler | — | P8b-1 |

## 6. Performans ve Ölçek
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Beklenen yük | Kapsamda: tenant ≤ 50 bekleyen, sistem ≤ 500 `/ws/request` + ≤ 100 `/ws/panel`; tenant başına 60 talep/sa üst sınır | §1, §5.4 | — |
| N+1 / indeks | Kapsamda: liste tek sorgu + `acceptedBy` select; sıra hesabı ≤ 50 satırlık indeks taraması; 1.000 kayıt < 500 ms ölçümü | §3.2, §7 | P8b-1 |
| Önbellek | Kapsamda (minimum): `tenant_request_settings` mevcut 30 sn tenant ayar önbelleği kalıbıyla, PUT/rotate'te invalidation (eski ref anında geçersiz olmalı) | §7 | P8b-1 |
| Arka plan işleri | Kapsamda: 30 sn süpürücü (expiry, connect_failed, pasif tenant), günlük anonimleştirme, WhatsApp denemeleri süreç içi. Kuyruk (BullMQ) Sonra | §2, §7 | P8b-1 |
| Büyük liste / export | Kapsamda: oturum CSV'sine 2 sütun (mevcut akış); talep CSV'si Kapsam dışı (gereksinimde yok) | mimari-api | P8b-1 |
| Performans bütçesi | Kapsamda: panel bildirimi p95 ≤ 3 sn, kabul→bağlantı p95 ≤ 3 sn, WhatsApp ≤ 60 sn, istemci açılış ≤ 5 sn, ikili ≤ 40 MB (değişmez) | NFR E9 | P8b-1, P8b-2 |

## 7. Operasyon
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Log / korelasyon | Kapsamda: `requestId` (HTTP) + talep kimliği log alanı (`supportRequestId`); PII loglanmaz | §8 | P8b-1 |
| Metrik / alarm | Kapsamda: 6 metrik + 2 alarm (ref_invalid, WhatsApp başarısızlık oranı) | §8 | P8b-1 (devops) |
| Hata izleme | Sonra (genel karar) | — | — |
| Yedekleme | Kapsamda: mevcut dump yeni tabloları kapsar | §8 | — |
| Ortamlar / feature flag | Kapsamda: staging `https://remote.noktabilisim.net`; feature flag Kapsam dışı — tenant WhatsApp anahtarı ve yetkiler yeterli | §1, §8 | P8b-1 |
| CI/CD / rollback | Kapsamda: mevcut hat; istemci `v0.9.0` etiketi + attestation; rollback: önceki imaj + `down.sql` (talep oturumu yoksa) | §8 | P8b-1, P8b-2 |
| Sıfır kesinti | Kapsam dışı (genel karar); deploy bekleyen talepleri 120 sn içinde yeniden bağlanırsa korur | §3.5 | — |
| Runbook | Kapsamda: WhatsApp servisi düştü/numara engellendi, ref sızdı → yenile, tenant kovası kilidi, seed aydınlatma sürümü notu, `down.sql` koşulu, Caddy matcher | §8 | P8b-1 (devops) |

## 8. Uyumluluk
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| KVKK | Kapsamda: aydınlatma + onay aynı formda, her talepte ayrı onay kaydı; **paylaşım anında ayrıca tek tık onay, `session_consents` bu anın IP/UA'sı + `request_id` (r2)**; hatırla kutucuğu varsayılan **işaretsiz** (kullanıcı kararı r2); `deviceKey` yalnız hatırlama açıkken; WhatsApp'a kişisel veri yok; saklama + anonimleştirme (`net_key`, `device_hash` dahil) | §3.6, §13 | P8b-1, P8b-2 |
| Çerez / lisans | Kapsamda: yeni çerez yok; ses `localStorage`; yeni bağımlılık yok | — | — |
| Finansal | Kapsam dışı | — | — |

## 9. Proje Yönetimi
| Madde | Karar | Gerekçe / nerede | Paket |
|---|---|---|---|
| Kapsam dışı listesi | Kapsamda: gereksinimler-e9 §3 (8 madde) | — | — |
| Ölçülebilir AC | Kapsamda: AC-129..164 tamamı mimari-e9 §11'de eşlendi; AC-151 → P10 | §11 | — |
| Riskler / açık sorular | Kapsamda: R11–R18 → T28–T38; S12–S17 varsayılanlarla kapandı (K12); K13–K15 açık | §12 | — |
| DoD | Kapsamda: genel DoD + mimari §10.3 P8b satırları | mimari §10.3 | — |
| Dokümantasyon | Kapsamda: README (env `WHATSAPP_SERVICE_URL`), docs/api.md, kılavuz ("Destek iste", "Talepler", "Ayarlar › Destek talepleri", "tanımadığınız talebi telefonla doğrulayın"), DATASHEET, akış A6, CHANGELOG | §2.3 | P8b-1, P8b-2 (teknik-yazar) |

## E9 "Sonra" listesi
**Talepte zorunlu kabul kodu (S12 — r2'de öne alındı, G-E9-1)**, WhatsApp servis API anahtarı (servis destekleyince), gözetimsiz erişim (S7), web talep formu (`checkPublicClient(BROWSER)` genişleme noktası), talep atama/öncelik/SLA/mesai saatleri, kabul öncesi mesajlaşma, talepte kabul kodu (S12), müşteriye durum bildirimi, talep için KVKK silme ekranı, WhatsApp grup alıcısı, talep CSV'si, çok instance hub (Redis).
