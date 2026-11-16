# P28c K2 — Web (frontend-dev, 2026-11-16)

Kaynak: `docs/mimari-p28c.md` r2 §4.1, §4.4, §4.5, §5, §6.1, §9, §10; ADR-0035; K0 adları. Yalnız `apps/web/**` değişti.
Koordinatör bu notu `docs/implementation.md`'ye taşır (DESIGN.md eklentileri de aşağıda — dosya sahipliği nedeniyle oraya yazılmadı).

## Rotalar

| Yol                          | Auth  | Ne yapar                                                                                                                                                                                             |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sessions`                  | evet  | + "Firmadaki etkin oturumlar" bölümü (yalnız `sessions.supervise`, firma bağlamı); satırda "İzle" (silent → gerekçe diyaloğu → step-up)                                                              |
| `/sessions/[id]/console`     | evet  | Sahip olmayan kullanıcı ACTIVE oturuma **üye** olarak bağlanır (rol `hello`/roster'dan); üye değilse ilk `hello`'dan önce kapanış → "Bu konsol yalnız …" (`notMember`). PENDING oturum yalnız sahibe |
| Tüm panel sayfaları          | evet  | Davet bildirimi kartı (`InviteNotifier`, 5 sn yoklama; Super Admin hariç)                                                                                                                            |
| `/history/[id]`              | evet  | + "Katılımcılar" bölümü (sunucu `participants` gönderirse) ; çoklu teknisyen olayları zaman çizelgesinde Türkçe                                                                                      |
| `/session/[token]` (müşteri) | hayır | + "Bağlı teknisyenler" (ad + rol, "Çıkar" onaylı), katılım bildirimi 3 sn, çok eşli sohbet                                                                                                           |
| `/audit`                     | evet  | Eylem süzgecinde "Çoklu teknisyen" grubu (tek tek eylem; "tümü" yok)                                                                                                                                 |

Yetki toggle'ları (`sessions.invite`, `sessions.supervise`): `PERMISSION_MODULES`'tan otomatik (K0 `tr.json` etiketleri); ek iş yok.

## Yapılanlar

- **Konsol** (`components/console/techs-panel.tsx`, `invite-dialog.tsx`): "Teknisyenler n/3" açılır paneli (ad, rol, "Oturum sahibi" rozeti,
  bağlantı koptu); sahip + `sessions.invite`: "Davet et" (aday listesi + arama; yükleniyor/boş/hata/pasif/liste), bekleyen davet satırı +
  "Geri çek" (`DELETE`), "Kontrolü ver" / "Kontrolü geri al" (`control.handover`), "Oturumu devret" (onay, odak Vazgeç; `session.transfer`).
  Üye: "Oturumdan ayrıl" (onay; `member.leave` → yerel `left`, yeniden bağlanma yok). Komuttan sonra 5 sn içindeki WS `error` toast.
- **Rol kapısı:** yer roster'daki kendi `tid` satırından (`lib/multi/roster.ts seatOf`; devirde yeni hello gerekmez). Kontrol sahibi
  değilken "Kontrol iste", işaretleme, pano/yazdırma (`FeatureReason "notController"`), dosyalar **pasif** + "Yalnız kontrol sahibi
  kullanabilir"; izleyicide sohbet girişi yerine "İzleyici olarak sohbete yazamazsınız". `quality.summary`, `file.meta`, `rec.error` WS
  gönderimleri `seatMay` ile süzülür. Sahip değilse "Oturumu bitir" ve boş doğrulama kodu gösterilmez. Gözetimsiz müdahale yalnız kontrol sahibi.
- **Kapanış kodları:** 4403 → `removed` ("müşteri sizi çıkardı ya da yetkiniz kaldırıldı" — kod ikisini ayırmaz), `left`, `notMember`.
- **Pasif durumlar (AC-372, V-PC-5):** `asked` gözetimsiz odada "Davet et" baştan pasif + `JOIN_NOT_ALLOWED` metni; misafir `multi1`
  yoksa aday listesi 409 `CLIENT_UNSUPPORTED` → AC-352 metni, düğme pasif; koltuk doluysa (roster + bekleyen ≥ 3) pasif + neden.
- **Davet bildirimi** (`components/invite-notifier.tsx`): kart "<Ad> sizi <müşteri> oturumuna davet ediyor", kalan süre, Katıl/Reddet;
  yeni davette toast; silent → gerekçe diyaloğu (`components/multi/join-reason-dialog.tsx`, P28u `ReasonField` yeniden kullanıldı);
  step-up `lib/api` + `StepUpProvider`; `MFA_SETUP_REQUIRED` → "Önce 2FA kurun"; 401 → giriş, 403/404 → dur, 429 → Retry-After.
- **Etkin oturumlar** (`app/(panel)/sessions/active-sessions.tsx`): 10 sn yoklama, skeleton/boş/hata/liste; dolu / desteklemiyor /
  `asked` satırında İzle pasif + neden.
- **Müşteri tarayıcısı:** `rs.cap.multi1` bildirilir (`guestProtocols`). `lib/webrtc/guest-peers.ts`: tid başına PeerConnection,
  yanıt/ICE `to`, kabul listesi (yalnız son roster'da + bağlı + **DOM'a çizilmiş** tid; çizimden önce gelen teklif bekletilir; roster
  görüldükten sonra `from`'suz/bilinmeyen teklif düşer; roster'dan düşen/kopan eş kapanır), ikincil göndericilerde `setParameters`
  (`LOW_FPS`/`LOW_BPS`, kontrol sahibinde tavan kalkar; rol değişiminde yeniden), dosya/işaretleme yalnız kontrol sahibinin eşi,
  sohbet yayma (müşteri → tüm eşler `by`'sız; teknisyen mesajı izleyici değilse gösterilir ve diğer eşlere `by=tid` ile iletilir;
  teknisyenden gelen `by`'lı mesaj düşer). Teknisyen varlığı roster'dan; yeni bağlanan teknisyene `share.state` yeniden bildirilir.
  Roster hiç gelmezse eski tek eş yolu aynen (P5 gerçek WebRTC e2e yeşil).
- **Sohbet `by`:** konsol adı kendi roster'ından çözer, çözemezse "Müşteri" (`chatAuthor`).
- **Audit:** `MULTI_AUDIT_LABELS` → `AUDIT_ACTION_LABELS`; `MULTI_AUDIT_GROUP` ayrı seçenek grubu.
- **Geçmiş:** "Katılımcılar" (ad, rol, katılma–ayrılma); zaman çizelgesi etiketi contracts'ta yoksa `MULTI_AUDIT_LABELS`'tan.

## Değişen / eklenen dosyalar (apps/web)

Yeni: `lib/multi/{roster,errors}.ts`, `lib/multi/multi-p28c.test.ts`, `lib/webrtc/{guest-peers,sender-caps}.ts`,
`components/console/{techs-panel,invite-dialog}.tsx`, `components/guest/techs-list.tsx`, `components/invite-notifier.tsx`,
`components/multi/{use-join.ts,join-reason-dialog.tsx}`, `app/(panel)/sessions/active-sessions.tsx`, `app/(panel)/history/[id]/participants.tsx`,
`e2e/mock-p28c.mjs`, `e2e/p28c-multi.spec.ts`.
Değişen: `lib/webrtc/{tech-machine,use-tech-session,guest-machine,use-guest-session,peer,signal,machines.test}.ts`, `lib/dc/{chat,use-collab}.ts`,
`lib/clip/{feature-state,use-clip-print}.ts`, `lib/audit/actions.ts`, `components/collab/{chat-panel,files-panel}.tsx`,
`components/console/collab-side.tsx`, `components/guest/guest-collab.tsx`, konsol `page/console-view/console-header/console-stage/console-parts`,
`app/(panel)/{layout,sessions/page}.tsx`, `app/(panel)/unattended/connect-dialog.tsx` (`ReasonField` export), `app/session/[token]/guest-session.tsx`,
geçmiş `page/timeline.tsx`, `messages/tr.json` (`mt.*`, `c.reason.{removed,left,notMember}`, `cp.r.notController`), `e2e/mock-{api,ws}.mjs`.

## DESIGN.md eklentileri (koordinatör ekler)

İkonlar: Teknisyenler → `Users`, Davet et → `UserPlus`, Kontrolü ver → `MousePointer2`, Kontrolü geri al → `Undo2`, Oturumu devret →
`ArrowRightLeft`, Oturumdan ayrıl → `LogOut`, Daveti geri çek → `X`, İzle → `Eye`, Katıl → `LogIn`, Reddet / Çıkar → `UserX`,
bağlantı koptu → `WifiOff`, panel aç/kapa → `ChevronDown`. Yeni primitif yok; `Dialog`, `Button`, `EmptyState`, `Skeleton`, `Avatar`,
`LoadError`, `FormError`, `Alert` kullanıldı.

## Sapmalar / sözleşme boşlukları (backend-dev / koordinatör)

1. **`SessionHistoryDetail.participants` contracts'ta yok** (mimari §9 tanımlı). Web yerel tipi savunmacı okur; alan gelmezse bölüm çizilmez. K1 tipi contracts'a eklemeli.
2. **Zaman çizelgesi etiketleri** (`describeTimelineEvent`, contracts labels) P28c eylemlerini bilmiyor; web geçici olarak `MULTI_AUDIT_LABELS`'a düşer. Notlar (rol/neden) için contracts eki gerekir.
3. **Bekleyen giden davetler için GET ucu yok** ve roster'da userId yok → "Geri çek" satırları yalnız bu sekmenin 201 yanıtlarından; sayfa yenilenince kaybolur (koltuk sunucuda doğru). Roster'a aynı adla biri girince satır görüntüden kalkar (yalnız görüntü).
4. **Konsolda misafirin `multi1` yeteneği yerel bilinmiyor** (hello/peer.joined'da alan yok) → "Davet et" pasifliği `invite-candidates` 409'undan öğrenilir (panel ilk açılışta etkin görünür). İstenirse `guestFeatures`'a `multi` değeri eklenebilir.
5. **4403** müşteri çıkarması ile yetki düşmesini ayırmaz → tek metin.
6. **WS `error` istek kimliği taşımaz** → devir/ayrılma hataları "son 5 sn içindeki komut" sezgisiyle toast.
7. Gözetimsiz odada Go yardımcısı/gösterge K3'te; web yalnız tarayıcı misafiri.

## Yapılmayanlar / bilinen eksikler

- **Gerçek sunucuyla (K1) uçtan uca deneme yapılmadı**; e2e sahte API/WS ile. Tarayıcı misafirinde çok eşli medya (iki teknisyen aynı
  anda, ana/düşük akış, roster dışı `from` reddi) **e2e ile değil yalnız birim testle** (`offerDecision`, `senderEncodings`) doğrulandı;
  AC-371 ölçümü staging'de (K5).
- Müşteri sayfasındaki "Bağlı teknisyenler" + "Çıkar" için e2e yok (sahte WS misafire roster göndermiyor); bileşen birim testi de yok.
- Audit sayfasında "Çoklu teknisyen" grubu e2e'de sınanmadı (birim test var).
- Kontrol devrinde konsol tarafında ek iş yok (misafir iz takası yapar); konsol yalnız roster'la yeniden çizer.

## Doğrulama

- `pnpm --filter @remote/web run lint` → temiz; `typecheck` → temiz; `test` → 53 dosya, 499 test (yeni `lib/multi/multi-p28c.test.ts` 14).
- `npx playwright test e2e/p28c-multi.spec.ts --project=desktop --project=mobile` → 9 geçti (1 masaüstü-only atlandı); 375 px açık/koyu axe 0.
- Tam `--project=desktop --project=mobile` → 531 geçti, 0 hata; `--project=desktop-rtc` (P5 gerçek WebRTC) → 20 geçti.
