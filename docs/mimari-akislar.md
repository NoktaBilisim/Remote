# Sequence Akışları
Ana belge: `docs/mimari.md` §2. Mesaj adları `docs/mimari-protokol.md`, uçlar `docs/mimari-api.md` ile birebirdir.

## A1. Oturum oluşturma + tarayıcı modu katılımı
```mermaid
sequenceDiagram
  autonumber
  participant T as Teknisyen konsolu
  participant S as apps/server
  participant DB as MySQL
  participant C as Müşteri tarayıcısı
  T->>S: POST /api/v1/sessions (çerez, CSRF)
  S->>S: yetki sessions.create, limit (açık ≤3, 20/sa)
  S->>DB: INSERT support_sessions(token_hash, active_code(8), tech_verify_code, PENDING, expires_at)
  S-->>T: {link, code(8), techVerifyCode, expiresAt}
  T->>S: WS /ws/tech?sessionId (Origin+çerez+sahiplik)
  S-->>T: hello{peerPresent:false}
  Note over T,C: Link e-posta/kopyala ile iletilir
  C->>S: GET /session/{token} (Next sayfası, tüketmez)
  C->>S: POST /public/sessions/resolve {token, clientKind:BROWSER}
  S-->>C: tenant, teknisyen, techVerifyCode, consentText, joinNonce(60 sn)
  C->>C: Ad + KVKK onayı + dolandırıcılık uyarısı → "Paylaşımı Başlat" → getDisplayMedia
  C->>S: POST /public/sessions/join {joinNonce, name, consentTextId}
  S->>S: consentTextId tenant+is_current? (G-24); lobi ≤3? ret listesi?
  S-->>C: wsTicket, admitCode (yalnız bu misafire) — tüketim YOK
  C->>S: WS /ws/guest (Sec-WebSocket-Protocol: rs.v1, rs.ticket.*)
  S-->>C: lobby.wait{expiresAt} → "Teknisyen onayı bekleniyor — kodunuz 4821"
  S-->>T: peer.pending{guestId, name, BROWSER} (audit guest.pending)
  Note over T,C: Teknisyen telefonda kodu sorar, müşteri okur (G-01)
  T->>S: guest.admit{admitCode}
  alt kod eşleşmez
    S-->>T: error ADMIT_CODE_INVALID (5. hatada lobi boşalır)
  else eşleşir
    S->>DB: TX: UPDATE … SET ACTIVE, consumed_at, active_code=NULL, mode=BROWSER WHERE id AND status=PENDING AND expires_at>now (count=1?) → session_consents(VIEW,GRANTED, join anındaki onay), audit guest.admitted
    Note over S,DB: count=0 (iptal/süre doldu/çift admit kazandı) → rollback, misafire session.ended, teknisyene error CONFLICT (mimari-protokol §3.2)
    S-->>C: hello{iceServers(HMAC, ≤60 dk), reconnectToken, caps}
    S-->>T: peer.joined{guestKind:BROWSER}
  end
  T->>S: sdp.offer (recvonly video + ctl, file DC)
  S->>C: sdp.offer
  C->>S: sdp.answer (+ ekran track)
  S->>T: sdp.answer
  T-->>C: ice ↔ ice (sunucu üzerinden)
  T-->C: DTLS-SRTP medya (P2P veya TURN)
  C->>S: share.state{sharing}
```
Not (P3 giriş şartı 2): tüketim **yalnız** admit'teki tek atomik koşullu UPDATE ile olur; resolve ve join okur ama yazmaz, iptal/süre dolumu ile yarışta tek kazanan InnoDB satır kilidiyle belirlenir (mimari-protokol §3.2; P2 kalıbı `sessions/repo.ts` `cancelPending`). Resolve/join Origin kuralı: tarayıcı Origin'li + `clientKind=BROWSER` (ADR-0012).
Not: getDisplayMedia join'den önce çağrılır; müşteri seçimi iptal ederse join yapılmaz (AC-30). Ret: `guest.reject{guestId}` → misafire `session.ended{rejected}`, oturum PENDING, kod geçerli (AC-113). Admit öncesi misafirden gelen `sdp.*`/`ice` → 1008.

## A2. Go istemci modu — kodla eşleme
```mermaid
sequenceDiagram
  autonumber
  participant C as Müşteri tarayıcısı
  participant S as apps/server
  participant A as Go istemci
  participant T as Teknisyen konsolu
  C->>S: GET /public/agent/download?ref
  S-->>C: Destek-48291376.exe (aynı jenerik binary, yalnız dosya adı farklı; yalnız PENDING+süresi dolmamış, kod yolu hız sınırı — mimari-api)
  A->>A: SetDefaultDllDirectories(SYSTEM32) (G-08); os.Executable() → regex (\d{8}) ; yoksa kod giriş alanı
  A->>S: POST /public/sessions/resolve {code, clientKind:AGENT} (TLS doğrulamalı, Origin YOK → yalnız AGENT kabul, ADR-0012)
  alt 404/410/429
    S-->>A: hata → "Kod geçersiz/süresi doldu" (AC-97)
  else geçerli
    S-->>A: tenant, logo, teknisyen, techVerifyCode, consentText, joinNonce
  end
  A->>A: Karşılama (alan adı, sürüm, SHA-256 ilk 8, uyarı) + KVKK onayı + monitör seçimi (AC-98, 106, 125, 128)
  A->>S: POST /public/sessions/join
  S-->>A: wsTicket, admitCode
  A->>S: WS /ws/guest (subprotocol ticket, Origin yok, kind=AGENT)
  S-->>A: lobby.wait → bekleme ekranı "Teknisyeninize şu kodu söyleyin: 4821"
  S-->>T: peer.pending{guestId, name, AGENT}
  T->>S: guest.admit{admitCode} (müşterinin okuduğu kod)
  S->>S: TX: atomik koşullu UPDATE (count=1) + consent + audit (A1 ile aynı, mimari-protokol §3.2)
  S-->>A: hello{iceServers, reconnectToken, caps}
  S-->>T: peer.joined{guestKind:AGENT}
  T->>S: sdp.offer (video recv + ctl, file, input DC)
  S->>A: sdp.offer
  A->>S: sdp.answer (H.264 track)
  Note over A: gate=CLOSED, "Ekranınız izleniyor" göstergesi (AC-103)
  A->>S: share.state{sharing, monitors[]}
```

## A3. Kontrol izni ver / reddet / kapat
```mermaid
sequenceDiagram
  autonumber
  participant T as Teknisyen konsolu
  participant S as apps/server
  participant A as Go istemci (izin kapısı)
  T->>S: control.request
  S->>S: remote_control.use? guestKind=AGENT? değilse error FORBIDDEN (AC-51, 34)
  S->>S: ret sonrası 30 sn / oturumda 5 istek aşıldı mı? → error RATE_LIMITED (G-03)
  S->>A: control.request
  A->>A: Diyalog: odak "Reddet", Enter/Space etkisiz, 1,5 sn sonra etkin, imleç altında değil; enjekte tıklama yok sayılır
  alt Reddet
    A->>S: control.state{VIEW, source:DENIED}
    S->>S: session_consents(CONTROL,DENIED) + audit
    S->>T: control.state → "Kontrol reddedildi"
  else İzin ver
    A->>A: gate=OPEN, kırmızı "Uzaktan kontrol aktif — <ad>" çerçevesi
    A->>S: control.state{GRANTED, UI}
    S->>S: audit yazılamazsa → control.revoke{audit} (fail-closed, G-15)
    S->>T: control.state → input göndermeye başla
    T-->>A: input DC: m.move / m.btn / k ...
    A->>A: gate.IsOpen() && !localSuspend → SendInput
  end
  Note over A: Müşteri "Kontrolü kapat" veya Ctrl+Shift+F12
  A->>A: gate=CLOSED (anında; sonraki input düşer, AC-101)
  A->>S: control.state{VIEW, UI|HOTKEY}
  S->>S: session_consents(CONTROL,REVOKED) + audit (AC-111)
  S->>T: control.state → "Kontrol müşteri tarafından kapatıldı" (≤1 sn, AC-50)
  Note over T: Teknisyen "Kontrolü bırak" / bekleyen istekte "Vazgeç" (ADR-0013, protokol §3.3)
  T->>S: control.release | control.cancel
  S->>A: control.release | control.cancel
  A->>A: gate=CLOSED, açık diyalog kapanır (yanıt yok)
  S->>T: control.state{VIEW, TECH}
  S->>S: release: session_consents(CONTROL,REVOKED,TECH) + audit control.released · cancel: audit control.cancelled
  Note over S,A: Teknisyen kopması: S→A control.revoke{reconnect} + peer.left{tech}; A ikisinden biriyle kapıyı kapatır (iki katman)
```

## A4. Kopma, yeniden bağlanma, sonlandırma
```mermaid
sequenceDiagram
  autonumber
  participant T as Teknisyen
  participant S as apps/server
  participant G as Müşteri (A veya C)
  G--xS: WS kopar (ping 2 kez yanıtsız / close)
  S->>S: room.controlState=VIEW, disconnectTimer=120 sn
  S->>T: peer.left{disconnect}
  G->>G: gate=CLOSED; üstel bekleme (1,2,4,8 sn…)
  G->>S: WS /ws/guest (subprotocol rs.reconnect.<token>, ≤120 sn)
  alt guestSocket hâlâ bağlı
    S-->>G: 403 + audit reconnect.conflict (G-10)
  else
    S->>S: hash eşleşir → timer iptal, hello{reconnectToken yeni, iceServers}; lobi yok, kontrol VIEW
  end
  S->>T: peer.joined → T yeni offer (ICE restart / yeni PC)
  alt 120 sn doldu (iki taraf da yoksa veya guest gelmedi)
    S->>S: ENDED(end_reason=timeout) + audit (AC-25)
  end
  T->>S: session.end (onay diyaloğu sonrası, AC-59)
  S->>S: ENDED(ended_by=TECH), quality_summary kaydı
  S->>G: session.ended{tech}
  G->>G: AGENT: gate kapalı, yarım .part silinir (%TEMP% yazımı yok, ADR-0004 r2), 3 sn içinde çıkış (AC-107)
```
Teknisyen tarafı kopması da aynı 120 sn kuralı ile; teknisyen sayfayı yenilediğinde çerez + sahiplik ile odaya döner.
Max süre (AC-13): `maxDurationTimer` 5 dk kala `session.warning`, sonunda `session.ended{max_duration}`.
İptal (AC-8): `POST /cancel` → DB CANCELLED + `active_code=NULL` + açık resolve/guest soketlerine `session.ended{cancelled}`; join TX'i `status=PENDING` koşullu UPDATE yapar (yarış yok).

## A5. Yönetici zorla sonlandırma ve canlı yetki iptali (G-04)
```mermaid
sequenceDiagram
  autonumber
  participant AD as Admin / Super Admin
  participant S as apps/server
  participant T as Teknisyen konsolu
  participant G as Müşteri (A veya C)
  AD->>S: POST /sessions/:id/terminate (sessions.terminate, aynı tenant)
  S->>S: ENDED(ended_by=ADMIN, terminated_by) + audit session.terminated
  S->>T: session.ended{admin}
  S->>G: session.ended{admin} → AGENT: gate kapalı, 3 sn'de çıkış
  AD->>S: POST /users/:id/deactivate · logout-all · reset-mfa · tenant pasif
  S->>S: auth_sessions revoke → rooms.endByTechnician(userId)
  S->>T: session.ended{auth_revoked} + 4401
  S->>G: session.ended{auth_revoked}
  AD->>S: PATCH /users/:id (remote_control.use=false)
  S->>S: rooms.applyPermChange → controlState=VIEW
  S->>G: control.revoke{permission} + caps.update
  G->>G: gate=CLOSED → control.state{VIEW, SYSTEM}
  Note over S,T: Ek emniyet: /ws/tech 60 sn'de bir auth_sessions doğrular
```

## A7. Bilgisayar kaydı (P8c; mimari-e10 §2.1, §3.4, §15.1–15.4; ADR-0017)
### A7a. Kayıt verilmesi (her başarılı istemci oturumu)
```mermaid
sequenceDiagram
  autonumber
  participant C as Go istemci (≥ 0.10.0, AGENT)
  participant S as apps/server (/ws/guest + bindings/service)
  participant DB as MySQL
  C->>S: /ws/guest (ticket) → admit (kod yolunda lobi kabulü / talep yolunda ön-kabul)
  S->>C: hello{iceServers, reconnectToken, caps}
  S->>C: binding.offer{} (yalnız AGENT + clientVersion ≥ 0.10.0; teklif bu bağlantıya işlenir)
  C->>S: binding.request{previousKey?} (previousKey yalnız dosyadaki köken bu sunucuysa)
  S->>S: kapılar: ADMITTED değil → 1008 · BROWSER → FORBIDDEN · teklifsiz → CONFLICT · oturum başına > 3 → RATE_LIMITED
  S->>DB: TX: oturum ACTIVE+AGENT, tenant aktif, müşteri FOR SHARE ACTIVE
  S->>DB: §15.1 bayat kaynak: ref yenilemeden önce açılmış / iptal edilmiş kayıttan açılmış talep → ret
  S->>DB: §15.3: cur = active_session_id FOR UPDATE · prev = key_hash FOR UPDATE
  alt cur var
    S->>DB: cur yerinde yenilenir (previousKey yok sayılır)
  else prev aynı tenant
    S->>DB: prev yerinde yenilenir (müşteri bağı §15.4 korunur)
  else prev başka tenant
    S->>DB: prev REPLACED (hash NULL) + audit kaybeden tenant'a → INSERT
  else
    S->>DB: INSERT (key_hash = SHA-256)
  end
  S->>DB: audit binding.issued → COMMIT (UQ ihlali / kilitlenme → bir kez yeniden dene)
  S->>C: binding.issued{bindingKey, tenantName, customerFirmName, renewed} (yalnız isteyen sokete)
  Note over S,C: Ret: error{CONFLICT,"Kayıt verilemedi"} + audit binding.denied{reason} + rs_binding_denied_total; oturum sürer
  C->>C: DPAPI dosyasına yazar (hata sessiz)
```

### A7b. Kayıtla talep
```mermaid
sequenceDiagram
  autonumber
  participant C as Go istemci
  participant S as apps/server
  participant DB as MySQL
  participant P as Panel (teknisyen)
  C->>S: POST /public/bindings/status {bindingKey, clientVersion}
  S-->>C: 200 TenantRequestInfo + customer{name} · biçim dışı/yok/geçersiz → tek 404 BINDING_INVALID (req.ref_invalid kovası)
  C->>S: POST /public/requests {bindingKey, …}
  S->>S: ip/önek/net48 kovaları (muaf değil, K20) → req.create.binding 6/sa
  S->>DB: TX: ayar FOR UPDATE → müşteri FOR SHARE ACTIVE → device_bindings koşullu UPDATE last_used_at (0 → BINDING_INVALID) → kayıt başına 1 bekleyen → INSERT (customer_id, binding_id) → audit
  S->>P: request.new{customerFirm, viaBinding:true}
  Note over C,P: Sonrası E9 akışı (/ws/request, kabul, "Ekranımı paylaş"); A7a ile kayıt yenilenir
  P->>S: (kötüye kullanım) POST /support-requests/:id/revoke-binding (customers.edit + support_requests.view)
  S->>DB: TX: kayıt ADMIN_REVOKED + bekleyenleri BINDING_REVOKED + audit
  S->>C: request.closed{CANCELLED, BINDING_REVOKED}
  Note over C: 404 BINDING_INVALID herhangi bir adımda → istemci kaydı siler, AC-185 metni, "Bağlantı kodum var"
```

### A7c. "Bu bilgisayarı unut"
```mermaid
sequenceDiagram
  autonumber
  participant U as Müşteri
  participant C as Go istemci
  participant S as apps/server
  U->>C: "Bu bilgisayarı unut"
  C->>C: yerel dosya + tmp + boşsa klasör ≤ 1 sn silinir (anahtar bellekte kalır)
  C->>S: POST /public/bindings/revoke {bindingKey} (2 sn zaman aşımı, en iyi çaba)
  S-->>C: 204 (her durumda; etkin satır → FORGOTTEN + hash NULL + audit)
  C->>U: "Bu bilgisayar unutuldu"
```
