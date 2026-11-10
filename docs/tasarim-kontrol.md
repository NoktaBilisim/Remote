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
