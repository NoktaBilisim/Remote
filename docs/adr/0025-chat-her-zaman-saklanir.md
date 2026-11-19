# ADR-0025 — Chat her zaman saklanır (S25): sunucu aktarımlı chat, alan şifreleme, retention bağı

Tarih: 2026-11-14 · Durum: Kabul (çerçeve; ayrıntı P18/P22 tasarım turunda) · İlgili: AC-255, AC-264, AC-291, AC-292, R27, `docs/mimari-e11.md` §10.4

## Bağlam

S25: tüm firmalarda sohbet saklanır, kapatılamaz; oturum saklama süresine bağlıdır, anonimleştirmede silinir. Bugün chat DataChannel'da uçtan uca;
sunucu içeriği görmez. Taraflardan birinin kopya göndermesi (ayna) kanıt değeri taşımaz: gönderen taraf kaydı atlayabilir.

## Karar

1. Chat sinyalizasyon WS'i üzerinden **sunucu aktarımlı** olur: sunucu doğrular, `session_messages`'a yazar, sonra karşı tarafa iletir. Yazılamazsa iletmez.
2. `body_enc` AES-256-GCM (`lib/crypto.ts`, anahtar halkası), AAD tenant/oturum/mesaj id. Okuma yalnız `sessions.view_chat` + audit.
3. Retention: oturum anonimleştirme TX'inde mesajlar silinir (`app`'e koşullu DELETE, tetikleyiciyle zorlanır). Talep mesajları talep anonimleşince silinir.
4. WS chat desteklemeyen eski Windows istemciyle oturumda chat kapalıdır ("istemciyi güncelleyin"); DC `chat` mesajı yeni sürümlerde kaldırılır.

## Alternatifler

- Teknisyen konsolunun aynası: eski istemcilerle çalışır ama teknisyen kaydı bastırabilir; ihtilaf kanıtı zayıf. Reddedildi (yalnız geçiş için de değil).
- Chat'i DC'de bırakıp iki taraftan kopya: çift kayıt, tutarsızlık.

## Sonuçlar

- Chat artık uçtan uca değil; aydınlatma metni ve onay satırı bunu açıkça söyler (AC-291/292). Sunucu yükü ihmal edilebilir (metin, 5/sn sınır).
- Sunucu sızıntısında etki büyür (R27): alan şifreleme + anahtar rotasyonu runbook'ta.
- **Append-only istisnası (P18 H3, K-P18-10, S-P18-T2b):** `session_messages` satırları uygulama tarafından güncellenmez
  (`app`'e UPDATE yok). Tek istisna anahtar sızıntısı/emekliliği için yeniden şifrelemedir: `cli crypto:rewrap
session_messages --from <ver> [--dry]` yalnız `migrate` servisinde migrator bağlantısıyla çalışır, yalnız `body_enc`'i aynı
  AAD ile güncel anahtar sürümüne taşır ve `crypto.rewrap` audit'i yazar. Emeklilik ön koşulu `cli crypto:check-retire <ver>`
  = 0 (runbook §25.5). Talep mesajlarının AAD'si `session_messages.body:<tenant>|<request_id>|<id>` (P22 oturum satırında
  `session_id`).

## Ek r-P22 (2026-11-17, `docs/mimari-p22.md`)

Yeni ADR açılmadı (ADR-0040 kullanılmadı); karar çerçevesi değişmedi, aşağıdaki ayrıntılar eklendi:

- **m.1 gerçekleme:** oturum sohbeti `/ws/tech` + `/ws/guest` üzerinden `chat.send` → koşullu INSERT (oturum ACTIVE) → commit → fan-out.
  Yetenek belirteci `rs.cap.schat1`; tarayıcı misafir de açıkça bildirir. Çoklu teknisyende yayma Go misafirden sunucuya geçer (P28c §4.5 genişleme noktası).
- **Şema:** yeni tablo/sütun/tetikleyici/grant yok; yalnız idempotency için UQ (`session_id`,`sender`,`client_msg_id`). Oturum satırında
  `request_id` NULL (iki bağlı satır üretilmez). AAD üst bağı `session_id`.
- **m.3 gerçekleme:** `anonymizeSessionBatch` TX'inde `anonymized_at` UPDATE'inden **sonra**, anonim oturumlara join'li DELETE.
- **m.4 netleştirme:** eski istemci (≤ 0.20.x, Windows/macOS/Linux) ile sohbet kapalı; müşteri tarafındaki "güncelleyin" metni konsolun DC'den gönderdiği
  **sabit** sistem bildirimidir (kullanıcı içeriği değil, saklanmaz). Müşterinin DC'den yazdığı hiçbir yerde gösterilmez.
- **Audit:** mesaj başına audit yok (satır kendisi append-only kayıt); `session.chat_summary`, `session.chat_viewed`, `session.chat_rejected`.
- **Sınır:** 1.000 kod noktası (DC'deki 2.000 UTF-16'dan iner), 5/sn/gönderen.

### r-P22 r2 eki (2026-11-17, P22-0 güvenlik turu; `docs/mimari-p22.md` §15)

- **Kabul edilmiş artık risk (S-P22-2):** eski müşteri istemcisiyle (≤ 0.20.x) DataChannel kanalı teknik olarak durur; teknisyen tarayıcı araçlarıyla
  kayıtsız DC sohbeti gönderebilir, sunucu bunu göremez. Telafi: `session.chat_legacy` audit'i, kılavuzda teknisyen kuralı, eski konsol sekmesinin
  `/ws/tech` belirteç kapısıyla (4426) reddi. Kapatma yolu: P22-G 0.21.0 prod yayınından 60 gün sonra `rs.cap.schat1` bildirmeyen istemcinin kabul
  edilmemesi (K-P22-15; ayrı AC, Sonra).
- **Kanıt bütünlüğü artık riski (S-P22-9):** AAD gönderen alanlarını bağlamaz; yalnız migrator/DB yöneticisi gönderen alanını değiştirebilir. Sonra:
  yeni anahtar sürümüyle AAD v2 (`…|<id>|<sender>|<sender_user_id|"-">`).
- Mesaj başına audit yokluğu (K-P22-6) ve konsolun sabit DC bildirimi (K-P22-3) güvenlik turunda koşullu onaylandı.
