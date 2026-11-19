# ADR-0042 — Prod'da imzasız gözetimsiz servis: ayrı `unsigned-accepted` modu, izinli SHA listesi, risk kabulü

Tarih: 2026-11-20 · Durum: **Önerildi r1** (güvenlik tasarım turu bekliyor; risk kullanıcı tarafından kabul edildi 2026-11-20) ·
İlgili: AC-523..AC-532, AC-297 (r4), AC-342, `docs/mimari-p32.md`, ADR-0010 (imzasız dağıtım), ADR-0028 (gözetimsiz erişim),
ADR-0040 (otomatik güncelleme)

## Bağlam

- Gözetimsiz servis (`NoktaDestekServis.exe`) Windows'ta SYSTEM hizmeti olarak çalışır. P27 tasarımı (K-P27-3, K-P27-22, AC-297 r3)
  prod'da bu servisi SignPath Authenticode imzası gelene kadar kapalı tutar: `UNATTENDED_MODE=unsigned` yalnız `DEPLOY_ENV=staging`.
- SignPath başvurusu sonuçlanmadı; kullanıcı 2026-11-20'de prod'da imzasız çalışmaya ve riski kabul etmeye karar verdi.
- Bugün `mode === "unsigned"` "TEST" anlamı da taşır: gösterge metnine "TEST — imzasız" öneki (`connect.ts`, `intervene.ts`),
  panelde "Gerçek müşteri cihazı kaydetmeyin" bandı. `production + unsigned → açılış hatası` kuralı, staging `.env`'inin prod'a
  kopyalanmasına karşı korkuluktur.
- Kapı cihaz beyanına dayanır; kimlik doğrulama değildir (AC-297 notu).

## Karar

1. `UNATTENDED_MODE`'a dördüncü değer eklenir: **`unsigned-accepted`**. Yalnız `DEPLOY_ENV ∈ {production, staging}` iken kabul edilir.
   Mod değerinin kendisi açık risk kabulüdür; ayrı bir bayrak eklenmez.
2. `unsigned` aynen kalır (yalnız staging, TEST etiketleri, `production + unsigned` açılış hatası).
3. `unsigned-accepted` **izinli SHA-256 listesi** ister (`UNATTENDED_SIGNED_SHA256`; ad tarihsel). Kapı: beyan edilen SHA listede ise
   imza beyanından bağımsız açık. Panelden indirilen ikilinin SHA'sı (`UNATTENDED_AGENT_SHA256`) listede olmak zorundadır.
4. Listeyi `deploy/agent/publish-servis.sh` doldurur (yayınladığı SHA'yı ekler); prod hedefe yalnız attestation'ı doğrulanmış Release
   etiketi gider (mevcut iki kilit). Elle yalnız çıkarma yapılır.
5. P29: servis manifesti `unsigned-accepted` modda da yalnız SHA listedeyse sunulur (K-P29-5 kuralı genişler).
6. Görünürlük: açılışta `alarm:"unattended_unsigned_risk_accepted"` warn logu, remote-watch BİLGİ satırı (alarm değil), Super Admin
   `/unattended` bilgi bandı, audit `gateMode` alanı. Müşteri göstergesinde TEST öneki yok.

## Alternatifler

- **A. `unsigned`'ı prod'da bir risk bayrağıyla açmak** (`UNATTENDED_UNSIGNED_RISK_ACCEPTED=true`): reddedildi. TEST anlamı taşıyan üç
  site `DEPLOY_ENV` dalı ister, "unsigned prod'da yasak" korkuluğu zayıflar (kopyalanan `.env` + tek satır bayrak), iki anahtar tek
  kararı ifade eder (sadelik ilkesi).
- **B. Listesiz imzasız mod** (prod'da her SHA kabul): reddedildi. Staging/yerel derleme prod'a bağlanabilir; açıklı sürümü tek hamlede
  kapatma yolu olmaz; P29'da güncellenen sürüm denetlenmez.
- **C. Listeyi yalnız `UNATTENDED_AGENT_SHA256` yapmak** (tek SHA): reddedildi. Yeni sürüm yayınlanınca henüz güncellenmemiş tüm
  cihazlar 4403 alır ve güncelleme teklifini de alamaz (kalıcı kilit).
- **D. SignPath'i beklemek (bugünkü durum)**: kullanıcı kararıyla reddedildi.
- **E. `UNATTENDED_SIGNED_SHA256`'yı `UNATTENDED_ALLOWED_SHA256` olarak yeniden adlandırmak**: şimdilik hayır (env, compose, betik,
  runbook değişikliği küçük pakette gereksiz yük); imza geldiğinde ele alınır.

## Sonuçlar

- (+) Gözetimsiz erişim prod'da kullanılabilir; Go servisi, DB ve API değişmez; geri dönüş tek satır (`UNATTENDED_MODE=off`).
- (+) `signed`'a geçiş yine yalnız env (runbook §27.5): imzalı Release yayınlanır, mod değişir.
- (+) Prod'a giden her servis ikilisi attestation'lı Release'tir ve listede izlenir (`PUBLISHED.log`).
- (−) **Kabul edilen risk R-P32-1 (Yüksek; kullanıcı 2026-11-20 "imzasız, risk kabul"):** Authenticode yok → yayıncı doğrulaması,
  SmartScreen itibarı ve AV güveni yok. Müşteri tarafında sahte bir "NoktaDestekServis" ikilisini ayırt etmek zorlaşır; AV/EDR
  servisi engelleyebilir. Liste beyana dayanır, değiştirilmiş ikili listedeki bir SHA'yı beyan edebilir — liste kimlik doğrulaması
  değildir. Telafi kontrolleri: oturumlu indirme, kayıt kodu (AC-273), cihaz başına yetki (AC-293), görünür gösterge (AC-294), yerel
  kapatma (AC-295), müşteri bildirimi (AC-296), attestation'lı yayın, P29 manifest imzası, izinli liste, acil `off`.
- (−) S-P29-T-1 (tek CI imzası, Kritik, 2026-11-19 kabul) için platform imzası ikinci kapı olamaz; P32 bu riski genişletmez ama
  azaltmaz da.
- (−) Liste elle temizlenir; unutulursa 20 öğe sınırında yayın durur (bilinçli fail-closed).
- Risk kaydı: bu bölüm + runbook §20.3 madde 16 (kullanıcı imzası) + `gereksinimler.md` §15.
