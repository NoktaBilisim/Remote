# P28c K1 — Sunucu (backend-dev, ara not, 2026-11-16) — YARIM, devredilecek

Kaynak: `docs/mimari-p28c.md` r2, ADR-0035, implementation.md "P28c K0". `packages/contracts` değiştirilmedi.

**KONTRAT HAZIR (K1c, 2026-11-16)** — `packages/contracts` (typecheck + 254 test yeşil, pt-surface yalnız 2 ekleme):

- `hello` (role=tech) ve `peer.joined{role:"guest"}` (teknisyene): `guestMulti?: boolean` — kabul edilmiş misafir
  `rs.cap.multi1` bildirdi mi (kısa kopuklukta son değer). **Alan yok** = kabul edilmiş misafir yok; **`false`** = desteklemiyor →
  "Davet et"/"İzle" baştan pasif + AC-352 metni (`MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED`). Roster'a eklenmedi (misafire de gider).
- `GET /api/v1/sessions/:id/invites` → `OutgoingInvitesResponse { items: OutgoingInvite[] }`, `OutgoingInvite { inviteId, userId,
  inviteeName, expiresAt (ISO) }`, bitişe göre artan; `Cache-Control: no-store`. Kapı DELETE ile aynı: başka tenant/yok 404,
  sahip değil 403 (yetki anahtarı istemez). Sayfalama yok (koltukla sınırlı, `MAX_TECHS`). Devirde davetler yaşar → yeni sahip görür.

## Durum özeti

- `pnpm --filter @remote/server run lint` → temiz; `typecheck` → temiz; `vitest run test/unit` → 45 dosya, 634 geçti (1 atlandı).
- Mevcut entegrasyon (signaling*/unattended*/rec*/clip-print*/sessions*/pt-surface) → 35 dosyadan 32 geçti; kalan 3: `pt-surface`
  rota anlık görüntüsü (yeni 11 rota — `-u` ile güncellendi, diff yalnız ekleme), `unattended-connect-k3` ve `unattended-consent-k4`
  ilk koşuda yük altında düştü, tek başına tekrar koşunca geçti (kararsız; yeniden doğrulanmalı).
- Yeni `test/integration/multi-p28c.test.ts` (19 test): **5 geçti, 14 düştü — çoğu test fikstürü hatası** (aşağıda). Test DB kapatıldı.

## BİTEN (kod yazıldı, derleniyor)

| Dosya                                                            | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signaling/types.ts`                                             | `Member`, `Invite`, `MultiRoom` (oda alanları `room.multi` altında — sapma 1), `Peer.multi`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `signaling/members.ts` (yeni)                                    | `newTid` (randomBytes(8) base64url), `newMulti`, `tidOf`/`userOfTid`, `controllerOf`, `seatOf`, `techConns`, `sendTechs`, `sendController`, `seatsUsed`/`roomFull`, `techRoleOf`, `rosterOf` (sahip her zaman, üye ilk WS'den sonra, tam 1 sahip/1 kontrol sahibi), `broadcastRoster`, `sendRosterToGuest`, `ensureGuestKnows` (Y-PC-4 roster→offer sırası), `logOnce`                                                                                                                                                                  |
| `signaling/member-life.ts` (yeni)                                | `reserveMember` (60 sn → `no_show`), `attachMember` (ilk WS: `participant_join`/`supervise_join` + silent dört göz kancası, gerekçe metni sonra silinir), `detachMember` (120 sn pay → `disconnect`; kontrol sahibiyse `controllerLeft`), `leaveMember`, **`revokeMember` (tek geri alma yolu, 4403, `auth_revoked`)**, `revokeMemberEverywhere`, `setController` (kontrol kapanışı `control.revoke{reconnect}` + REVOKED/TECH `extra.reason` + `recRecorderChanged`), `membersTeardown` (`session_end` + `invite_expire{session_end}`) |
| `signaling/member-cmds.ts` (yeni)                                | `roomCmdLimited` (oda 10/dk), `handleHandover`, `handleTransfer` (TX: `lockTechnician(hedef)` + AC-11 `countOpen` + koşullu UPDATE + audit; commit sonrası hedef gitmişse ters UPDATE + `fail{target_gone}`; `transferring` finally), `swapOwner`, `handleMemberLeave`, `handleTechRemove` (`removed`, `participant_remove`), `relayTechToGuest` (`from`), `relayGuestToTech` (`to`, bilinmeyen düşer + log 1/dk)                                                                                                                       |
| `signaling/multi-audit.ts` (yeni)                                | `auditMulti`, `failAuditAllowed` (kullanıcı+oturum+failReason dakikada 1), `countInvite` (`rs_multi_invites_total`)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `signaling/handlers.ts`                                          | `seatOf` ile üye soketleri; **`seatMay` rol kapısı her teknisyen mesajından önce** (`error{FORBIDDEN}` + `rs_multi_denied_total{type}`); handover/transfer/member.leave; misafir şeması `multi`; `tech.remove`; share.state tüm teknisyenlere                                                                                                                                                                                                                                                                                           |
| `signaling/active.ts`                                            | `sendHelloTech(rooms, room, conn)` + `tid`/`techRole`/`roster`; ice.servers, süre uyarısı, `peer.joined{guest}` tüm teknisyenlere; misafir hello sonrası roster; `multi.startedAt`                                                                                                                                                                                                                                                                                                                                                      |
| `signaling/rooms.ts`                                             | `multi` kurulumu; sahip attach/detach'te kontrol yalnız sahip kontrol sahibiyse kapanır; multi1 misafire `peer.joined/left{tech}` yok (roster); teardown üyeleri kapsar; `endByTechnician` üyeyi `revokeMember`; `applyPermChange` üye dalı (`memberPermChange`); `techRooms` üyeli odalar; `isMember`; `silentNotify` kancası                                                                                                                                                                                                          |
| `signaling/control*.ts`, `clip-print.ts`, `fsrv.ts`, `collab.ts` | `room.tech` → `controllerOf`/`sendController` (kontrol işleri); `revokeControlFor` dışa açıldı                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `signaling/rec.ts`                                               | `recorderOf = controllerOf`; `rec.state` tüm teknisyenlere (upload yalnız kaydediciye); `recHelloTech(…, conn)`; `recTechDetached(…, wasRecorder)`; **`recRecorderChanged`** (eski belirteç paysız düşer, yeni bölüm + belirteç)                                                                                                                                                                                                                                                                                                        |
| `signaling/ws.ts`                                                | misafir `rs.cap.multi1` → `peer.multi`; `rs_multi_members{role}` göstergesi; 60 sn döngüde `revalidateMember`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `signaling/ws-auth.ts`                                           | `/ws/tech` üye dalı `memberUpgrade` (§4.3 `ws` + açılışta `joinSyncCheck`), `techConnOf`, `revalidateMember` (oturum düştü/rol değişti/kimlik oturumu farklı/uygunluk → `revokeMember`; oda bitmez)                                                                                                                                                                                                                                                                                                                                     |
| `signaling/rooms-device.ts`                                      | `revalidateDevice` `deviceAccess` ile + `revalidateDeviceMembers`; `finishDevice(…, technicianId)` üyeyi de düşürür (grantsRemoved yolu)                                                                                                                                                                                                                                                                                                                                                                                                |
| `unattended/device-access.ts` (yeni)                             | `deviceVerdict`, `deviceAccess`, `deviceAccessOk` (Super Admin bypass yok)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `unattended/connect.ts`                                          | `precheck` `deviceVerdict` kullanır (ret kodu/sırası değişmedi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `unattended/policy.ts`                                           | `finishSilent(…, technicianId)` üyeyi silent odalarda düşürür                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `unattended/intervene.ts`                                        | kilit/oturum kapatma yalnız kontrol sahibi (`room.multi.controllerId`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `unattended/mail.ts`                                             | `silentJoinMail` (`join`/`transfer`, sabit konu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `sessions/eligibility.ts` (yeni)                                 | **`eligibleToJoin(subject, room, via, phase, opts)`** (adım 1–7, 3', 6a, 6b gerekçe, 8'), `joinSyncCheck` (adım 9), `subjectOfAuth`, `subjectById`                                                                                                                                                                                                                                                                                                                                                                                      |
| `sessions/invites.ts` (yeni)                                     | aday listesi (toplu grant sorgusu), davet oluştur/geri çek/ret/kabul, gelen davetler, etkin oturumlar (gözetimsiz oda yalnız 5–6'yı geçene), İzle; adım 8 step-up yalnız gözetimsiz odada                                                                                                                                                                                                                                                                                                                                               |
| `sessions/routes-multi.ts` (yeni) + `app-routes.ts`              | 8 uç; yoklama 60/dk, kabul/İzle 20/dk; `rooms.silentNotify` → `sendSilentNotice` bağlama                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sessions/service.ts` + `routes.ts`                              | `GET /sessions/:id` üye kapsamı; sahip olmayan üyeye `techVerifyCode: ""`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Testler                                                          | `test/helpers/multi.ts`, `test/integration/multi-p28c.test.ts`, unit fikstürleri (`clip-print`, `signaling-fsrv-p28b`: `multi: newMulti(…)`), `pt-surface` anlık görüntüsü                                                                                                                                                                                                                                                                                                                                                              |

## K1b (2026-11-16) — devam

**Test durumu (son koşu, p28c-k1b-mysql):** `vitest run test/unit` + `multi-p28c` + `pt-surface` + `unattended-connect-k3` +
`unattended-consent-k4` → **50 dosya, 685 geçti, 1 atlandı, 0 düştü**. `multi-p28c.test.ts` **20/20** (gözetimsiz test 4 kez tekrar
koşuldu, kararlı). `pnpm -r run lint` ve `pnpm -r run typecheck` temiz. Go: `go test ./internal/signal/` (golang:1.26 konteyneri) ok, gofmt temiz.
unattended-connect-k3 / consent-k4 bu koşuda geçti → önceki düşüş yük altı kararsızlık (P28c kaynaklı değil).

**Bulunan gerçek hata (düzeltildi):** oturum devri (`swapOwner`) soketin yerini değiştiriyordu ama `close` dinleyicileri açılıştaki role
bağlıydı (sahip → `detachTech`, üye → `detachMember`). Devirden sonra yeni sahip kopunca `room.tech` hiç boşalmıyor, 120 sn bitiş
çalışmıyordu. `ws-auth.ts` `detachSeat`: kapanışta iki yol da soket kimliğiyle korunarak çağrılır (yalnız biri etkili).

**Test fikstürü düzeltmeleri (sunucu değil):** `helpers/multi.ts` her giriş/WS/genel istek ayrı IP (`nextIp`, `signIn(remoteAddress)`),
`startMultiLive` `TRUSTED_PROXY_CIDR=127.0.0.1/32` (aksi halde XFF yok sayılıyor, `/ws/tech` 31/dk IP kovası 429 veriyordu);
AC-364 fail audit beklentisi `["permission","tenant"]` (T8: (kullanıcı, oturum, gerekçe) dakikada 1); AC-367/368 geçersiz şemalı
mesajlar (`clip.pull cid`, `file.meta sha256`, `print.cancel pid`, `quality.summary` stat, `fsrv.cancel` ULID) soketi kapatıyordu;
AC-368 `supervise_join` yalnız `success` satırı; gözetimsiz kurguda sahibe grant + `unattended.*` yetkisi (yoksa revalidateDevice odayı
haklı olarak `permission` ile bitiriyordu — kararsızlığın kaynağı).

**Sözleşme ekleri (packages/contracts):**

- `api/sessions.ts`: `SessionParticipant` + `SESSION_PARTICIPANT_ROLES`; `SessionHistoryDetail.participants?`; `TIMELINE_DETAIL_KEYS`'e
  10 `session.*` P28c olayı (kimlik/gerekçe metni yok; yalnız rol, neden, `failReason`, `inviteeName`).
- `ws.ts`: S→misafir `ice.restart` `from?: tid` (multi1). Fikstür `fixtures/multi.json` valid/invalid örnek eklendi.
- Go `internal/signal/inbound.go`: `IceRestart.From` + `validOptTid` doğrulaması (yalnız signal paketi).

**Sunucu ekleri:** `sessions/history-participants.ts` (yeni; `deriveParticipants` saf + `participantsOf`), `history-detail.ts`
`participants` + aktör kuralı (katılımcı/izleyici/devreden → `TECH`); `member-cmds.ts` üye `ice.restart` multi1 misafire `from` ile
iletilir (sapma 7 kapandı).

**Yeni testler:** AC-369 geçmiş participants + zaman çizelgesi (entegrasyon), `test/unit/history-participants-p28c.test.ts` (3),
kabul 21. istek 429, revalidateDevice üye dalı (grant silinir → yalnız üye 4403).

## K1c (2026-11-16) — sözleşme ekleri + eksik testler

**Değişen dosyalar:** `packages/contracts/src/{ws.ts,ws-multi.ts,api/multi.ts}` + `test/__snapshots__/pt-surface.test.ts.snap`
(yalnız `OutgoingInvite`, `OutgoingInvitesResponse` eklendi); `apps/server/src/signaling/active.ts` (`hello`/`peer.joined`
`guestMulti`), `src/sessions/invites.ts` (`outgoingInvites`), `src/sessions/routes-multi.ts` (`GET /:id/invites`, `poll` kovası
`out:<user>`); testler `test/integration/multi-p28c.test.ts` (+9), `test/unit/multi-roster-rec-p28c.test.ts` (yeni, 6),
`test/helpers/multi.ts` (`ownerWithGuest` artık `joined` = sahibin aldığı `peer.joined` döner).

**Yeni testler:** AC-372 `guestMulti` (multi1 true / eski false / üye hello / sahip yeniden bağlanma); `GET /sessions/:id/invites`
(no-store, sıra, geri çek/kabul/süre dolumu sonrası boş, üye 403, başka tenant 404, biçimsiz 404); AC-11 devir sınırı (CONFLICT,
technician_id değişmez, `transfer fail{conflict}`); O-PC-2 `target_gone` (üretimde kanca YOK — testte `rooms.db.$transaction`
sarılır: gerçek TX commit olur, dönmeden hedef soketi kapanır → DB geri alınır, bellek değişmez, `fail{target_gone}`); geri alma
matrisi 5 satır (üye: applyPermChange / endByTechnician / kimlik oturumu iptali yedek döngü; sahip: endByTechnician / yedek döngü)
sahte saat hiç ilerlemeden etkili (anlık ≤ 5 sn; yedek döngü bir `revalidateMs` periyodunda — testte 300 ms, üretim 60 sn ≤ 60 sn);
`rosterOf` değişmezleri (tek sahip/tek kontrol sahibi, rezervasyon listede yok, kopuk sahip, ad kırpma, tid kalıcı) ve
`recRecorderChanged` (eski belirteç hemen düşer, eskisine upload'sız `rec.state`, yenisine yeni seri + belirteç; rec1 olmayan
kontrol sahibinde dönüş süresi; kayıt yokken mesaj yok).

**Ayrıca düzeltilen (K1'den kalan kırmızılar):** `test/helpers/tenant-matrix.ts` P28c uçlarını sınıflandırmıyordu (AC-69
"sınıfsız uç" testi düşüyordu) → 9 uç eklendi (`/:id/*` tenant + B→A 404 vakaları; `/invites`, accept/reject self; `/active` scoped).
`consent-p4` QA-P4-12 `peer.joined` tam eşleşmesine `guestMulti:false`; sunucu `pt-surface` rota anlık görüntüsü (+GET/HEAD
`/sessions/:id/invites`, yalnız ekleme).

**Doğrulama (p28c-k1c-mysql, 3423):** tam `pnpm --filter @remote/server exec vitest run` → 159 dosya, 1765 geçti, 1 atlandı,
1 düştü = AC-261 (`p19-notify-j3`, bilinen kararsız; tek başına 18/18 geçti). `pnpm -r run lint` / `typecheck` temiz, contracts
254/254, prettier temiz. Test DB kapatıldı (`p28c-k1b-mysql` da artık çalışmıyor).

**Not:** matristeki "sahip — applyPermChange" satırı yok: gözetimsiz olmayan odada sahibin yetki daralması odayı bitirmez (yalnız caps
daralır; P3 S-P3-8 davranışı). Gözetimsiz sahip dalı mevcut "gözetimsiz oda (bellek kurgusu)" testinde.

## BİTMEYEN / sıradaki ajan için

1. ~~**Prettier:**~~ K1c: değişen dosyalar `prettier --write` ile biçimlendi. şu dosyalar `prettier --list-different`'te: `sessions/{eligibility,history-participants,invites,service}.ts`,
   `signaling/{member-cmds,member-life,multi-audit}.ts`, `unattended/device-access.ts`, `test/helpers/multi.ts`,
   `test/integration/multi-p28c.test.ts` → `npx prettier --write` (otomatik izin reddi nedeniyle koşulamadı).
2. ~~**contracts `pt-surface`**~~ K1c: güncellendi (yalnız ekleme). yeni dışa aktarım `SESSION_PARTICIPANT_ROLES` → `pnpm --filter @remote/contracts exec
vitest run test/pt-surface.test.ts -u` (yalnız ekleme; koşulamadı). Bunun dışında contracts 253/254 geçti.
3. ~~**Test DB konteyneri `p28c-k1b-mysql`**~~ K1c: çalışmıyor. — `apps/server/scripts/test-db.sh down` izin reddi aldı; elle kapatılmalı.
4. ~~Eksik testler~~ — K1c'de yazıldı (yukarı).
5. ~~Tam koşu~~ K1c'de koşuldu (yukarı). — yalnız birim + ilgili alt küme.
6. `docs/implementation.md` "P28c K1" bölümü bu nottan yazılmalı.
7. Go ajanı (apps/agent-win, flow/rtc): `IceRestart.From` artık gelebilir; çoklu PC'de ilgili teknisyen bağlantısını yeniden kurmalı.

## Tasarımdan sapmalar (gerekçeli)

1. Oda alanları `room.multi` altında (`ownerTid` yerine `tidOf(room, technicianId)`; `tids` haritası (oturum, kullanıcı) başına sabit tid).
2. Step-up (adım 8) yalnız gözetimsiz odada kabul/İzle'de — gereksinimler AC-364 + tablo satırı "gözetimsizde davetliye step-up".
3. Kabulde başkasının/bilinmeyen davet → 410 `INVITE_GONE` (403 yerine; geçerli davet kimliği kâhini olmasın).
4. Dört göz e-postası (`join`) üyenin **ilk WS katılımında** (audit ile aynı an, bir kez); gerekçe metni o ana dek yalnız bellekte.
5. Teknisyen mesaj kovaları: lobi (`peer.pending`) yalnız sahip; kontrol/pano/yazdırma/env/monitör/fsrv yalnız kontrol sahibi;
   `ice.servers`, `peer.joined/left{guest}`, `share.state`, `session.warning`, `session.ended`, `rec.state`, roster tüm teknisyenlere.
6. Devir/kontrol devrinde misafire `control.revoke{reason:"reconnect"}` (K0 sapma 8). AC-11 sınırı aşımında da audit `failReason:"conflict"`.
7. ~~Üye `ice.restart` iletilmez~~ — K1b: sözleşmeye `from` eklendi, multi1 misafire `from` ile iletilir.
8. Kontrol sahibi üye `remote_control.use`'u kaybederse açık kontrol `revokeControlFor(permission)` ile kapanır (üye düşmez).

## frontend-dev için

- Teknisyen `hello`: `tid`, `techRole`, `roster` her zaman; rol değişimi yalnız `techs.roster` ile bildirilir (hello yeniden gönderilmez;
  konsol kendi rolünü roster'daki kendi `tid`'inden okur). Rol reddi `error{FORBIDDEN, "Yalnız kontrol sahibi kullanabilir."}`.
- Üye soketi kapanış: `4403 removed` (müşteri çıkardı / yetki düştü), `1000 left` (`member.leave`).
- `GET /sessions/:id` üyeye 200 döner, `techVerifyCode: ""`.
- **K2: geçmiş detayında participants göster** (`SessionHistoryDetail.participants`: ad, rol, katılım/ayrılma, `leaveReason`
  (`removed` = müşteri çıkardı), `transferredAt`); zaman çizelgesinde yeni `session.*` olaylarına Türkçe etiket; katılımcı aktörü `TECH`.
- Misafir (tarayıcı, multi1): S→misafir `ice.restart` artık `from` taşıyabilir → ilgili teknisyen PC'sinde ICE yeniden başlat.
