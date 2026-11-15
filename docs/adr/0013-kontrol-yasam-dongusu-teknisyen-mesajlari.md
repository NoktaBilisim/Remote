# ADR-0013 — Kontrol yaşam döngüsü: teknisyen bırakma/iptal mesajları ve iki katmanlı kapı kapatma

Durum: Kabul · Tarih: 2026-11-11 · İlgili: ADR-0009, `docs/mimari-protokol.md` §3.3

## Bağlam

P7 geliştirmesinde protokolde boşluklar çıktı: (1) teknisyenin "Kontrolü bırak"ı yalnız konsolda yerel duraklatmaydı, müşteri tarafında kapı açık kalıyordu (müşteri teknisyenin kontrolü bıraktığını sanırken izin açık); (2) bekleyen isteği geri çekme yoktu, müşteri vazgeçilmiş bir isteği sonradan onaylayabiliyordu; (3) teknisyen koptuğunda sunucu misafire kapatma göndermiyordu, kapanış yalnız istemcinin `peer.left` yorumuna bağlıydı; (4) monitör reddi teknisyene bildirilmiyor, audit'lenmiyordu; (5) oturum sonunda açık kontrolün kapanış kaydı yoktu.

## Karar

- Yeni WS mesajları: `control.release` ve `control.cancel` (tech→S→guest), `monitor.denied` (guest→S→tech). `control.revoke.reason` kümesine `reconnect` ve `stale` eklenir.
- `control.state.source` kümesine `TECH` eklenir (yalnız sunucu üretir); `session_consents.source` CHECK'i `TECH`'i kabul edecek şekilde genişletilir (dba migration). Audit adları: `control.released`, `control.cancelled`, `monitor.granted`, `monitor.denied`.
- Kapı kapatma iki katmanlıdır: sunucu kapatma mesajı gönderir **ve** istemci bağlantı olaylarından (peer.left/joined{tech}, hello, kopma) kendiliğinden kapatır. Kapatma yönündeki hiçbir yol DB yazımını beklemez; açma yönü (GRANTED) fail-closed kalır.
- Çapraz yarışlar: GRANTED'deki iptal = bırakma; VIEW'daki geç GRANTED → `control.revoke{stale}`; konsol beklemediği GRANTED'de yakalama başlatmaz, `control.release` yollar.
- Sunucu oda durumu bilgi ve kayıt amaçlıdır; tek izin kaynağı istemci kapısıdır (ADR-0009 değişmez). Yeni mesajların hiçbiri kapıyı **açamaz**.

## Alternatifler

- Bırakmayı yerel duraklatma olarak bırakmak: müşteri onayı teknisyenin niyetinden bağımsız açık kalır; reddedildi (en az ayrıcalık).
- Bırakma için `source = SYSTEM` kullanıp şemayı değiştirmemek: consent kaydı aktörü yanlış gösterir (KVKK/denetim kanıtı); reddedildi. Migration küçük (yalnız CHECK; tablo küçük, prod henüz açık değil).
- Teknisyen kopmasında yalnız istemci katmanı: tek hata noktası; reddedildi. Yalnız sunucu katmanı: WS koptuğunda mesaj ulaşmaz; reddedildi → ikisi birlikte.
- Monitör isteği için de iptal mesajı: monitör onayı VIEW kapsamında ve düşük riskli; eklenmedi (genişleme noktası: `monitor.cancel`, aynı §3.3 tablosuna satır).

## Sonuçlar

- contracts (ws.ts, audit.ts, fixtures), sunucu `signaling/control.ts`, Go `internal/{signal,flow,control}`, konsol `lib/control/machine.ts` ve dba migration'ı değişir. Yeni bağımlılık yok.
- 5 istek sınırı iptal/bırakma sonrası yeni isteklerle tükenir; bu bilinçli (müşteriye en çok 5 diyalog). Konsol kalan hakkı gösterir.
- P8 zaman çizelgesi her GRANTED için bir kapanış satırı bulur (UI/HOTKEY/RECONNECT/SYSTEM/TECH).

## Ek — P7 Tur 2 (2026-11-11)

Kaynak: `docs/qa-raporu.md` Tur 2 (QA-P7-T2-2, Öneri 2), `docs/guvenlik-raporu.md` P7 Tur 2 (S7-9). Ayrıntı `docs/mimari-protokol.md` §3.3 K6–K8.

- **Bekleyen isteğin istemci tarafında kapanması (K6):** PeerConnection koptuğunda (WS açık) Go istemci açık kontrol diyaloğunu kapatır ve `control.state{VIEW, SYSTEM}` gönderir. Sunucu REQUESTED'de bunu iptal gibi işler: consent satırı yok (müşteriye ret atfedilmez), 30 sn bekleme yok, sayaç düşmez, audit `control.cancelled{by:"agent"}`. Yeni mesaj tipi veya şema değişikliği yok. Alternatif `VIEW/DENIED` reddedildi (müşteri reddetmedi; 30 sn bekleme haksız başlar, KVKK kaydı yanlış olur). Alternatif "yalnız konsol 30 sn sonra kendisi düşsün" reddedildi (sunucu REQUESTED'de kalır, yeni istek CONFLICT alır).
- **REQUESTED/GRANTED iken `control.request` → `error{CONFLICT}`** belgelendi (QA-P7-T2-2).
- **CONFLICT/RATE_LIMITED yansıtması (K7):** `error` zarfına `retryAt` eklenmedi; kurallar sabit ve contracts'ta, konsol yerel sayaç + 1 sn payla yansıtır. Genişleme noktası: kurallar tenant ayarına bağlanırsa `error`'a isteğe bağlı `retryAfterMs` eklenir.
- **S7-9 (K8):** `env.state.selfElevated: boolean` (zorunlu) eklenir; GRANTED audit `newValue`'suna yazılır; konsolda uyarı rozeti. Kontrol engellenmez (yönetici gerektiren destek işi meşru; izin müşteride). P7 Tur 2 içinde uygulanır — P7 istemcisi yayımlanmadan strict şema değişikliği uyumluluk maliyeti taşımaz. Migration yok.
