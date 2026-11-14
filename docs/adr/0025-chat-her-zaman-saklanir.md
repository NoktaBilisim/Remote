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
