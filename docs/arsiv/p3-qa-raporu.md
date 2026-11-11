# QA Raporu — P3 (sinyalizasyon + TURN) — Tur 2
DURUM: GEÇTİ

Tarih: 2026-11-11. Denetçi: qa-denetci (kod değiştirilmedi). Tur 1 bulguları aşağıda (arşiv olarak) korunmuştur.

## Tur 2

### Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (3 paket) |
| `pnpm -r run typecheck` | temiz (3 paket) |
| `pnpm -r run test` | contracts 2/2, server unit 69/69, web 23/23 — skip yok |
| `test-db.sh down` → `up` + `pnpm --filter @remote/server test:int` → `down` | **93/93** (16 dosya; Tur 1: 85/15), 3 migration temiz uygulandı, skip yok |
| `deploy/turn/test-local.sh` | **62 PASS, 0 FAIL** (Tur 1: 57) — bölüm 4 host OUTPUT kuralı: aralık içi echo, aralık dışı 3480/3478/53 DROP; idempotent apply; 5766 dinlenmiyor |
| `pnpm --filter @remote/web e2e` | 97 passed, 1 skipped (gerekçeli: `sessions.spec.ts:115` mobilde masaüstü tablo başlığı yok) |
| `pnpm audit` | No known vulnerabilities (`ws` 8.21.0) |

### Tur 1 bulgularının kapanışı
| Bulgu | Durum | Kanıt |
|---|---|---|
| QA-P3-1 (AC-7 join 410 audit) | ✅ kapandı | `public/service.ts:28-30,51-58` `goneAudit` (GONE durumları + `addGuest` içinden `SESSION_CONSUMED`). Test `signaling-fix1` "AC-7 (QA-P3-1): tüketilmiş oturumda join → 410…": 410 + kod, tam **1** `session.join` `result=fail` `{reason}`, dump'ta nonce/token/kod yok |
| QA-P3-2a (AC-19 ping/pong) | ✅ kapandı | "AC-19 (QA-P3-2a)": `pingMs:50`, `autoPong:false` soket 1006 (terminate) ile, ≥100 ms (2 aralık) sonra kapanıyor; pong veren soket OPEN |
| QA-P3-2b (AC-120 log tarama) | ✅ kapandı | "AC-120: join → ticket WS → admit → reconnect…": gerçek `createLogger("trace", sink)`; joinNonce, wsTicket, 2 reconnectToken, link token, auth token, admitCode (hatalı deneme dahil) ve alan adları logda yok; sorguda ticket 403 ve logda "ws upgrade reddedildi" var (sink'in gerçekten yazdığı doğrulanıyor) |
| QA-P3-2c (test adı) | ✅ kapandı | `test/unit/signaling.test.ts:41` "AC-18: 50 mesaj/sn…" |
| QA-P3-3 (AC-89 metrik) | ✅ kapandı | `ws.ts:60` `rs_ws_connections` gauge (`wss.clients.size`), `app.ts:115` `rs_active_sessions` (`rooms.activeCount`), `rs_resolve_failed` (`_total` kalktı). `signaling-lifecycle:80-81` serilerin varlığı + eski adın yokluğu; runbook §9.8 alarm adları güncel |
| QA-P3-4 (AC-113 pending audit) | ✅ kapandı | "AC-113 (QA-P3-4)": 1 `guest.pending`, `newValue` anahtarları tam `[guestId, guestKind, name]`, admitCode yok |
| QA-P3-5 (`endByTechnician`) | ✅ kapandı | "AC-115 (QA-P3-5)": iki ACTIVE oda, 4 tarafa `session.ended{auth_revoked}`, teknisyene 4401 ×2, DB ENDED/SYSTEM/auth_revoked + oda başına 1 audit, `rooms.size=0`. Çağıran uç P7/P9 (mimari §10.2 P7, S-P3-8) — gerekçeli |
| QA-P3-6 (ADR/mimari notu) | ✅ kapandı | ADR-0007 r5 m.1-3 (`::/128` yok + regresyon kuralı, `a-b` yazımı, `no-cli`/`no-loopback-peers`); mimari §3.1:122 `consumed_at` = başlangıç, `end_reason` küçük harf |

### Regresyon ve ek kontroller
- Tur 1'de ✅ olan AC'ler (6, 13-18, 20-22, 24, 25, 112, 114) testleri yeşil; yeni kod (S-P3-1 `maxPayload`→1009, S-P3-4 expiry→oda kapanışı, S-P3-7 `/ws/tech` IP limiti) `signaling-fix1` içinde ayrıca test edilmiş.
- **Env zinciri `TURN_CRED_TTL_MIN` = 20:** `env.ts:35` `.default(20)` (5..60) · `.env.example:32-33` (boş, açıklama 20) · `deploy/docker-compose.yml:93` `${TURN_CRED_TTL_MIN:-20}` · runbook:183 tablo ve :272 rotasyon adımı 20 · unit `signaling.test.ts:69` varsayılan 20. Tutarlı.
- **host-firewall.sh tutarlılığı:** aralık `turnserver.base.conf` (49160-49199) kaynaklı, runbook §9.2.1 kuralı ve UFW satırı aynı aralık; runbook kurulum sırası (§9.2 adım: install coturn'den önce), `check`, `uninstall`, timer, `TURN_FW_SELF_IPS` belgeli; CI `turn` işi `bash -n host-firewall.sh` + `print` + `test-local.sh` (bölüm 4 dahil) koşuyor; entrypoint ve turn compose yorumları runbook §9.2.1'e atıf yapıyor. Tutarsızlık yok (yalnız ADR'deki eski port tavanı, bkz. Öneriler).
- **Kullanılmayan kod:** `apps/server/src` dışa aktarımları tarandı; yalnız-tanım dosyasında kullanılan tipler (`AdmitResult`, `GuestState`, `IceGrant`, `RoomsDeps`, `CounterOptions`, `PublicClientKind`, `parseFrame`) kendi dosyalarında kullanılıyor — ölü kod değil. `endByTechnician` artık testli ve çağıranı planlı.

### Kabul kriterleri (P3, Tur 2)
| AC | Durum | Kanıt |
|---|---|---|
| AC-6, 13-18, 20, 21, 24, 25, 112, 114 | ✅ | Tur 1 kanıtları geçerli, testler yeşil |
| AC-7 | ✅ | resolve: `sessions-public` "AC-5, AC-7…"; join: `signaling-fix1` "AC-7 (QA-P3-1)" |
| AC-19 | ✅ | `signaling-fix1` "AC-19 (QA-P3-2a)" |
| AC-22 | ✅ | `test-local.sh` 62 PASS (her aralık ilk/son + `::`); ADR-0007 r5 notu |
| AC-89 | ✅ (sunucu) | `/metrics` 404/401/200 + `rs_ws_connections`, `rs_active_sessions`, `rs_resolve_failed`; TURN tahsis sayısı coturn exporter (`turn_*`, test-local sayıyor), panel P13 — gerekçeli |
| AC-113 | ✅ (sunucu) | `signaling-rooms` "AC-113…" + `signaling-fix1` "AC-113 (QA-P3-4)", ret listeli oda ömrü (S-P3-4) |
| AC-115 (sunucu) | ✅ | "AC-115/G-04…4401" + "AC-115 (QA-P3-5)" |
| AC-120 | ✅ | reconnect çakışma 403+audit + `signaling-fix1` "AC-120" log taraması |

### Düzeltilmeli
Yok.

### Definition of Done (Tur 2)
| Madde | Durum | Not |
|---|---|---|
| İki sahte istemcili offer/answer/ICE | ✅ | `signaling-ws` AC-20 |
| Çapraz oturum sızıntısı yok | ✅ | |
| coturn HMAC + test-denied her aralık + host OUTPUT kuralı | ✅ | 62 PASS |
| Lobi testleri, admit öncesi iceServers yok, atomik admit + yarış | ✅ | |
| Testler yeşil, gerekçesiz skip yok | ✅ | tek skip gerekçeli (e2e mobil) |
| Her P3 AC'si testle kanıtlı | ✅ | |
| Kullanılmayan kod yok | ✅ | |
| Bağımlılık gerekçesi / güvenlik açığı | ✅ | yalnız `ws` (§10.4); `pnpm audit` temiz |
| Env zinciri | ✅ | `TURN_CRED_TTL_MIN` 20 her katmanda |
| Sapmalar gerekçeli | ✅ | implementation.md Backend/DevOps "Düzeltme turu 1" |
| Audit olayları | ✅ | join 410 fail + guest.pending artık testli |
| Tenant izolasyonu | ✅ | |

### Öneriler (zorunlu değil)
- [mimar] `docs/adr/0007-turn-coturn-ayri-vm.md:6` hâlâ `max-port=49200` diyor; kod/runbook/firewall 49199 (40 port). Tek satır düzeltme.
- [backend-dev] `docs/implementation.md:441` (sapma 7) hâlâ "`rs_resolve_failed_total` gauge olarak yayınlanır" diyor; :475 ile çelişiyor — eski cümle güncellenmeli.
- [backend-dev] AC-7 join yolunda `SESSION_EXPIRED`/`SESSION_CANCELLED` ve `addGuest` kaynaklı `SESSION_CONSUMED` dalları ayrı ayrı test edilmemiş (aynı `goneAudit` kullanılıyor); parametrik bir test ucuz bir sigorta olur.
- Tur 1 önerileri (AC-114 Super Admin çapraz tenant terminate testi, terminate ret audit'i) geçerli.
- `host-firewall.sh` staging çalışma zamanı kanıtı (runbook §9.2.3, güvenlik raporu) test-operatoru turunda toplanmalı.

### Olumlu
- Tur 1'in tüm maddeleri testle kapatılmış; testler gerçekten kriteri ölçüyor (log taraması gerçek logger + sink'in yazdığını doğrulayan pozitif kontrol, ping testi `autoPong:false` ile gerçek kaçırma).
- 1009 durumunda dinleyicisiz `error` olayının süreci düşürmesi entegrasyon testinde yakalanıp düzeltilmiş.
- host-firewall kuralı CI'da gerçek ağ ad alanında idempotentlik ve DROP sayaçlarıyla doğrulanıyor.

---
## Tur 1 (arşiv)


Tarih: 2026-11-11. Denetçi: qa-denetci (kod değiştirilmedi). P2 raporu: `docs/arsiv/p2-qa-raporu.md`.

### Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (exit 0) |
| `pnpm -r run typecheck` | temiz (exit 0) |
| `pnpm -r run test` | contracts 2/2, server unit 69/69, web 23/23 — skip yok |
| `test-db.sh up` + `pnpm --filter @remote/server test:int` | **85/85** (15 dosya), skip yok |
| `deploy/turn/test-local.sh` | **57 PASS, 0 FAIL** (HMAC UDP/TCP/TLS, her denied aralığın ilk/son adresi + `::` 403, kontrol peer'ları izinli) |
| `pnpm --filter @remote/web e2e` (regresyon) | 97 passed, 1 skipped (gerekçeli: `sessions.spec.ts:115` mobilde masaüstü tablo başlığı yok) |

### Kabul kriterleri (P3 kapsamı)
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-6 | ✅ | `signaling-rooms` "AC-6/AC-8: admit‖cancel 50 kez"; join tüketmez (oturum PENDING kalır, AC-113 testi) |
| AC-7 | ⚠️ | 410 + audit fail yalnız resolve yolunda kanıtlı (`sessions-public` "AC-5, AC-7 (QA-P2-1…)"). **Join** yolunda tüketilmiş oturum 410 `SESSION_CONSUMED` döner ama audit `result=fail` yazılmaz ve testi yok → QA-P3-1 |
| AC-13 | ✅ | `signaling-lifecycle` "AC-13: max süre 5 dk kala session.warning…" (sahte saat, DB ENDED/SYSTEM) |
| AC-14 | ✅ | `signaling-ws` "AC-14: sorgu dizesi, rs.v1 eksik, tekrar kullanılan ticket ve izinsiz Origin → 403" + "ADR-0012" matrisi |
| AC-15 | ✅ | `signaling-ws` "AC-15: teknisyen soketi yalnız oturum sahibine…" |
| AC-16 | ✅ | `signaling-ws` (nonce ikinci kez `NONCE_INVALID`); 60 sn süre `DEFAULT_TIMING.nonceMs` + `OneTimeStore` unit "tek kullanımlık ve süreli" |
| AC-17 | ✅ | `signaling-ws` "AC-17/18/19: geçersiz JSON, ekstra alan, 64 KB aşımı…→ 1008" |
| AC-18 | ✅ | aynı test (50/sn → 1008) + unit TokenBucket (test adı yanlışlıkla "AC-19") |
| AC-19 | ⚠️ kanıtsız | Ping 30 sn / 2 kaçırma → terminate `signaling/ws.ts:174-184` kodda var, **otomatik testi yok** (implementation "Kalanlar"da kabul edilmiş). Test adlarındaki "AC-19" etiketi rate-limit'i ölçüyor → QA-P3-2 |
| AC-20 | ✅ | `signaling-ws` "AC-20: offer/answer/ICE yalnız aynı odanın…", "çapraz oturum sızıntısı yok (iki eşzamanlı oda)" |
| AC-21 | ✅ | unit "AC-21: username=<bitiş>:<sessionId>…", rooms "admit öncesi … iceServers yok", lifecycle ICE yenileme; coturn `max-bps` (entrypoint) + test-local HMAC |
| AC-22 | ✅ (not) | `turnserver.base.conf` + `test-denied.sh` her aralığın ilk/son adresi 403. `::/128` satırı coturn 4.18 hatası nedeniyle kaldırıldı, `::` ayrıca negatif test ediliyor; ADR-0007'ye not düşülmedi → QA-P3-6 |
| AC-24 | ✅ (sunucu) | `signaling-lifecycle` "AC-24/G-10…" (peer.left, yeni token, hello). Kontrol izni sıfırlama P7 |
| AC-25 | ✅ | `signaling-lifecycle` "AC-25: misafir 120 sn içinde dönmezse ENDED{timeout}…" |
| AC-89 | ⚠️ | `/metrics` 404/401/200 testli; ancak AC "WS bağlantı **sayısı**" istiyor, yalnız `rs_ws_connections_total` sayacı var (anlık gösterge yok); `rs_active_rooms` PENDING lobi odalarını da sayar (aktif oturum ≠ oda) → QA-P3-3. TURN tahsis sayısı coturn exporter'da (P13'e devir gerekçeli) |
| AC-112 | ✅ (sunucu) | `signaling-rooms` "AC-112: admit öncesi…", "yanlış kod…5. hatada lobi boşalır", "lobi en çok 3"; `signaling-ws` "lobideki misafirin SDP'si 1008" |
| AC-113 | ✅ (sunucu) | `signaling-rooms` "AC-113: ret…", "§3.1: lobi 5 dk / ticket 60 sn". `guest.pending` audit'i kodda var (`public/service.ts:50`) ama hiçbir testte doğrulanmıyor → QA-P3-4 |
| AC-114 | ✅ (sunucu) | `signaling-lifecycle` "AC-114: terminate…"; çapraz tenant `tenant-matrix`. Super Admin yolu ayrı test edilmiyor (öneri) |
| AC-115 (sunucu) | ⚠️ | 60 sn yeniden doğrulama testli ("AC-115/G-04…4401"). `rooms.endByTechnician` (`rooms.ts:208`) çağıransız **ve testsiz** → QA-P3-5 |
| AC-120 | ⚠️ | Misafir reconnect çakışması 403 + audit testli. AC'nin şart koştuğu "log tarama testi" WS ticket / reconnect token için **yok**: `logs.test.ts` yalnız HTTP yollarını tarar, sinyalizasyon testleri `silentLog` kullanır → QA-P3-2 |

### Düzeltilmeli
1. **QA-P3-1** (Orta) [backend-dev] `apps/server/src/public/service.ts:43-49` — join'de `SESSION_CONSUMED/EXPIRED/CANCELLED` (ve `addGuest` içinden gelen `SESSION_CONSUMED`) 410'u audit'siz dönüyor; AC-7 "410 + audit `result=fail`" ister. → resolve ile aynı biçimde `session.join` `result=fail` (neden kodu, token/kod yazmadan) audit'i yaz; entegrasyon testi: nonce al → oturumu ACTIVE yap → join 410 + 1 fail audit.
2. **QA-P3-2** (Orta) [backend-dev] `apps/server/test/integration/` — (a) AC-19 için test: `pingMs` küçük verilmiş `startLive` + pong'u yanıtlamayan ham soket (ör. `ws` istemcisinde `autoPong:false` veya soketi `pause`) → 2 ping sonra kapanış; (b) AC-120 log taraması: `createLogger("trace", sink)` ile canlı uygulamada join → ticket ile WS → reconnect (geçerli + çakışan + sorgu dizesinde sızmış ticket) akışı; logda `wsTicket`, `reconnectToken`, `joinNonce` ve `admitCode` geçmediği assert edilsin. (c) `test/unit/signaling.test.ts:40` adı "AC-19" → "AC-18" düzeltilsin.
3. **QA-P3-3** (Düşük) [backend-dev] `apps/server/src/app.ts:114`, `signaling/ws.ts` — AC-89: `rs_ws_connections` gösterge (`wss.clients.size`, role etiketli ya da toplam) ve `rs_active_sessions` (admitted odası olan oda sayısı) ekle; `rs_resolve_failed_total` adı gösterge için `_total` sonekli (Prometheus kuralı: counter olarak yayınla veya adı değiştir). `/metrics` testine bu serilerin varlığı eklensin.
4. **QA-P3-4** (Düşük) [backend-dev] `signaling-rooms`/`signaling-ws` testleri — AC-113 "bekleme audit'e yazılır": join sonrası `guest.pending` audit kaydı (1 adet, `customerName` dışında token/kod yok) assert edilsin.
5. **QA-P3-5** (Düşük) [backend-dev] `apps/server/src/signaling/rooms.ts:207-211` — `endByTechnician` mimari §10.2 P3'te istendiği için kalabilir (P1'de kullanıcı pasifleştirme/logout-all ucu yok; gerekçe kabul), ancak testsiz bırakılamaz. → iki odası olan teknisyen için entegrasyon testi: her iki odada `session.ended{auth_revoked}`, teknisyene 4401, DB ENDED/SYSTEM + audit. (Alternatif: P9'a kadar kaldır ve implementation.md'de belirt.)
6. **QA-P3-6** (Düşük) [mimar] `docs/adr/0007-turn-coturn-ayri-vm.md` — `::/128` satırının coturn 4.18'de tüm adresleri reddettiği ve kaldırıldığı (yerine `test-denied.sh` `::` negatif testi), `no-loopback-peers`/`no-cli` farkları ve `denied-peer-ip` `a-b` aralık yazımı ADR'ye not olarak işlensin; DBA notu gereği mimari §3.1'e `started_at` yerine `consumed_at` ve `end_reason` küçük harf kararı düşülsün.

### Definition of Done (mimari §10.3 P3 + kalite standartları)
| Madde | Durum | Not |
|---|---|---|
| İki sahte istemcili entegrasyon testi offer/answer/ICE aktarır | ✅ | `signaling-ws` AC-20 |
| Çapraz oturum sızıntısı yok | ✅ | iki eşzamanlı oda testi; tenant-matrix +3 rota |
| coturn `turnutils_uclient` HMAC + `test-denied.sh` her aralık + local liste negatif kaydı | ✅ | `deploy/turn/test-local.sh`, CI `turn` job'ı |
| Lobi testleri (§9) yeşil | ✅ | signaling-rooms 9/9 |
| Admit öncesi `iceServers` yok | ✅ | misafir + teknisyen tarafı (sapma 1) |
| Admit tek atomik koşullu UPDATE, yarış testleri | ✅ | admit‖admit, admit‖cancel ×50 |
| Testler yeşil, skip gerekçesiz yok | ✅ | server/contracts/web unit+int'te skip yok |
| Her P3 AC'si testle kanıtlı | ❌ | AC-7 (join), AC-19, AC-89, AC-120 ⚠️ |
| Kullanılmayan kod yok | ❌ | `endByTechnician` çağıransız ve testsiz (QA-P3-5) |
| Bağımlılık gerekçesi | ✅ | yalnız `ws` + `@types/ws` (§10.4 onaylı); prom-client eklenmedi |
| Env zinciri (.env.example + env.ts + compose + runbook + CI) | ✅ | `TURN_URLS/TURN_SECRET/TURN_CRED_TTL_MIN/METRICS_TOKEN` dördünde de var; env.ts `TURN_SECRET` min 32 coturn ile uyumlu; CI sahte değerler |
| Sapmalar implementation.md'de gerekçeli | ✅ | Backend 13 madde, DevOps kararlar, DBA notu |
| Contracts tek kaynak + fixture | ✅ | `contracts/src/ws.ts` strict discriminatedUnion; `fixtures/ws-messages.json` + `ws-fixtures.test.ts` |
| Tenant izolasyonu | ✅ | terminate `tenantId` kapsamlı UPDATE, başka tenant 404; tech WS yalnız sahip |
| Audit olayları | ⚠️ | pending/admitted/rejected/admit fail/ended/terminated/reconnect.conflict yazılıyor; join 410 fail eksik (QA-P3-1) |

### Öneriler (zorunlu değil)
- AC-114 için Super Admin'in başka tenant oturumunu sonlandırma testi.
- Bekleyen oturumda teknisyen auth'u iptal edilince DB'de PENDING kalması (Kalanlar) — P4'te iptal ile kapatmayı değerlendirin.
- `terminate` 403/404/409 yanıtları için `session.terminated` `result=fail` audit'i (yetki denemesi izlenebilirliği).

### Olumlu
- Upgrade doğrulaması sıkı: sorgu dizesi reddi, subprotocol'de tek kimlik, ticket tek kullanımlık, `kind` nonce'tan (ADR-0012).
- Admit yarışları DB düzeyinde 50'şer turla kanıtlanmış; zamanlayıcılar sahte saatle deterministik test ediliyor.
- coturn fail-closed entrypoint, secret komut satırında değil, imaj digest'le sabit; ADR'deki `::` hatası testle yakalanıp belgelenmiş.
- Sapmalar eksiksiz ve gerekçeli belgelenmiş.
