# ADR-0035 — Çoklu teknisyen: mesh, bellek üyeliği, ana/düşük akış, tek kontrol sahibi

Tarih: 2026-11-16 · Durum: Kabul r2 (mimar; güvenlik tasarım turu Y-PC-1..4, O-PC-1..5, D-PC-1..7 işlendi) · İlgili: AC-364..372, R43, ADR-0005, ADR-0009, ADR-0013, ADR-0029, `docs/mimari-p28c.md`

## Bağlam

Oturumda bugün tek teknisyen var (`Room.tech`); offer'ı teknisyen verir, misafir tek PeerConnection'la yanıtlar. P28c en çok 3 teknisyen,
davet, süpervizör izlemesi, kontrol devri ve oturum devri ister. Müşteri yüklemesi ≥ 10 Mbps varsayılır. Kontrol sahibinde ≥ 15 FPS,
diğerlerinde ≥ 5 FPS olmalı, bant yetmezse önce izleyici düşmeli (AC-371). Kullanıcı kararı: sadelik, en az yeni tablo/mesaj.

## Karar

1. **Mesh:** misafir her teknisyenle ayrı PeerConnection kurar (≤ 3). Teknisyen offer verir (mevcut); sunucu `sdp/ice`'yi `from`/`to`
   (oda içi opak `tid`) ile yönlendirir. Sunucu medya taşımaz.
2. **Bellek üyeliği, migration yok:** üyeler, davetler, çıkarılanlar `Room`'da (ADR-0005). Geçmişteki katılımcılar ve devir zamanı AC-370
   audit olaylarından türetilir. Oturum devri yalnız `support_sessions.technician_id` UPDATE'idir.
3. **İki akış:** kontrol sahibinin eşi ana akışı alır; diğer eşler sabit tavanlı (8 FPS, 1 Mbps) düşük akışı alır. Go istemcide tek
   yakalama + iki kodlayıcı + `ReplaceTrack`; tarayıcıda sender `setParameters`.
4. **Tek kontrol sahibi:** müşteri makinesinde yan etkisi olan her iş (girdi, pano, yazdırma, dosya, işaretleme) yalnız kontrol sahibinden;
   sunucu `roleMay` + misafir DC kapısı (iki katman, ADR-0009). Davet/devir yalnız oturum sahibi.
5. **Yetenek belirteci `rs.cap.multi1`:** bildirmeyen misafire çoklu teknisyen alanı/mesajı gönderilmez; davet/izle 409 ve düğmeler pasif.
6. **Davet bildirimi REST yoklama** (ADR-0029 kalıbı), `/ws/panel` genişletilmez.
7. **(r2) Tek uygunluk ve tek geri alma yolu:** katılım koşulları yalnız `eligibleToJoin(user, room, via, phase)` (`request`/`ws`/`revalidate`);
   rezervasyon kimlik oturumuna bağlı. Üyenin her geri alınışı (yetki, grant, politika, hesap, oturum) yalnız `revokeMember`; üyenin
   oturumu düşmesi odayı bitirmez. Cihaz erişimi tek yardımcı `deviceAccessOk`.
8. **(r2) Gizli izleyici yok:** sunucu roster'ı offer'dan önce gönderir; misafir yalnız roster'da olup ekranda çizilmiş `tid`'in offer'ını
   kabul eder.
9. **(r2) Gözetimsiz kipler:** `silent` odaya katılım gerekçe + dört göz e-postası ister; `asked` odada ek katılım kapalıdır (oturum
   ortası rıza diyaloğu yerine — yardımcıda yeni durum makinesi gerektirmez).

## Alternatifler

- **SFU (mediasoup/LiveKit):** müşteri tek akış yükler, ölçeklenir; ama yeni servis, TURN/ağ yapılandırması, işletim yükü ve uçtan uca
  şifreleme iddiasının değişmesi. 3 teknisyen için gereksiz. Reddedildi (genişleme noktası: `from/to` SFU'ya taşınır).
- **Teknisyen konsolunun yeniden yayını (sahip → diğerleri):** müşteri yükü değişmez ama sahibin ağı ve sekmesi kritik yol olur, sahip
  kopunca hepsi düşer. Reddedildi.
- **Tek kodlayıcı, aynı iz tüm eşlere:** en basit Go değişikliği; 1080p'de 3 × ~4,7 Mbps > 10 Mbps ve öncelik yok — AC-371'i karşılamaz.
  Reddedildi.
- **`session_participants` tablosu:** sorgusu kolay; ama audit ile çift kayıt ve migration. Reddedildi.
- **Katılımcıya dosya/yazdırma yetkisi:** misafirde çok eşli dosya/onay yönlendirmesi gerektirir; AC istemiyor. Reddedildi (kontrol devri yeter).

## Sonuçlar

- (+) Sunucu ve DB değişikliği küçük; mevcut 1:1 akış aynen çalışır (eski istemci = tek teknisyen).
- (+) Öncelik yapısal: ana akışın bütçesi ikincil teknisyenlerden etkilenmez.
- (−) Müşteri yüklemesi teknisyen sayısıyla artar (R43); zayıf hatta ikincil akış da sorun olabilir — 3 tavanı ve 1 Mbps sınırı bunu bağlar.
- (−) Go istemcide ikinci kodlayıcı CPU/donanım oturumu kullanır; yalnız ikincil eş varken açılır, donanım yetmezse yazılıma düşer (AC-245 yolu).
- (−) Sohbet DC'de misafir tarafından yayılır; P22 sunucu sohbeti gelince yayma sunucuya taşınır.
- (r2) `asked` gözetimsiz odada çoklu teknisyen yoktur; ihtiyaç doğarsa mevcut onay diyaloğu `tid` ile yeniden kullanılır (genişleme noktası).
- Bellek modeli tek instance varsayımına (ADR-0005) daha çok bağlanır; çok instance'a geçişte üyelik paylaşılan depoya taşınmalıdır.
