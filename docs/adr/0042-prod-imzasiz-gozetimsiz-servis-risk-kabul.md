# ADR-0042 — Prod'da imzasız gözetimsiz servis: ayrı `unsigned-accepted` modu, izinli SHA listesi, risk kabulü

Tarih: 2026-11-20 · Durum: **Önerildi r2** (güvenlik tasarım turu S-P32-1..10 işlendi, mimari-p32 §14; risk kullanıcı tarafından kabul edildi 2026-11-20) ·
İlgili: AC-523..AC-533, AC-297 (r4), AC-342, `docs/mimari-p32.md`, ADR-0010 (imzasız dağıtım), ADR-0028 (gözetimsiz erişim),
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
4. Listeyi `deploy/agent/publish-servis.sh` doldurur: tüm ortamlarda yalnız `vX.Y.Z` (attestation'lı Release) SHA'sını ekler, `dir-*`
   / `*-unattested` listeye girmez; prod hedefe zaten yalnız attestation'ı doğrulanmış Release gider (mevcut iki kilit). Elle yalnız
   çıkarma yapılır; remote-watch listeyi `PUBLISHED.log` Release satırlarıyla karşılaştırır, eşleşmeyen SHA → ALERT.
5. P29: servis manifesti `unsigned-accepted` modda da yalnız SHA listedeyse sunulur (K-P29-5 kuralı genişler).
6. Görünürlük: açılışta `alarm:"unattended_unsigned_risk_accepted"` warn logu (`allowedCount`, `listFingerprint`), remote-watch her
   turda BİLGİ satırı + mod/liste değişiminde tek seferlik ALERT + `DEPLOY_ENV` beklenenden farklıysa ALERT, Super Admin
   `/unattended` bilgi bandı, audit `gateMode` + `binarySha256`. Müşteri göstergesinde TEST öneki yok.
7. Müşteriye giden AC-419 indirme bağlantısı (oturumsuz) **kapanmaz**; kayıt kodu mesajı (e-posta, SMS, WhatsApp) kanonik alan adını,
   dosya adını, sürümü ve SHA-256 kısaltmasını yazar ve "başka yoldan gönderilen dosyayı çalıştırmayın" uyarısını taşır (AC-533).
   Kılavuz SmartScreen "Yine de çalıştır"dan önce `Get-FileHash` ile SHA karşılaştırmasını anlatır (AC-532).

## Alternatifler

- **A. `unsigned`'ı prod'da bir risk bayrağıyla açmak** (`UNATTENDED_UNSIGNED_RISK_ACCEPTED=true`): reddedildi. TEST anlamı taşıyan üç
  site `DEPLOY_ENV` dalı ister, "unsigned prod'da yasak" korkuluğu zayıflar (kopyalanan `.env` + tek satır bayrak), iki anahtar tek
  kararı ifade eder (sadelik ilkesi).
- **B. Listesiz imzasız mod** (prod'da her SHA kabul): reddedildi. Staging/yerel derleme prod'a bağlanabilir; açıklı sürümü listeden
  kapatma yolu olmaz; P29'da güncellenen sürüm denetlenmez.
- **C. Listeyi yalnız `UNATTENDED_AGENT_SHA256` yapmak** (tek SHA): reddedildi. Yeni sürüm yayınlanınca henüz güncellenmemiş tüm
  cihazlar 4403 alır ve güncelleme teklifini de alamaz (kalıcı kilit).
- **D. SignPath'i beklemek (bugünkü durum)**: kullanıcı kararıyla reddedildi.
- **F. `unsigned-accepted`'te bağlantı gönderimini kapatmak** (yalnız oturumlu panel indirmesi): varsayılan olarak seçilmedi — P28
  bağlantı gönderme akışı prod'da işlevsiz kalır, müşteri dosyayı yine Admin'den başka yoldan (e-posta eki, USB) alır ve bu daha az
  doğrulanabilir. Kullanıcı §20.3 m.16 imzasında bunu seçebilir (mimari-p32 §13 m.3).
- **E. `UNATTENDED_SIGNED_SHA256`'yı `UNATTENDED_ALLOWED_SHA256` olarak yeniden adlandırmak**: şimdilik hayır (env, compose, betik,
  runbook değişikliği küçük pakette gereksiz yük); imza geldiğinde ele alınır.

## Sonuçlar

- (+) Gözetimsiz erişim prod'da kullanılabilir; Go servisi, DB ve API değişmez; geri dönüş tek satır (`UNATTENDED_MODE=off`).
- (+) `signed`'a geçiş yine yalnız env (runbook §27.5): imzalı Release yayınlanır, mod değişir.
- (+) Prod'a giden her servis ikilisi attestation'lı Release'tir ve listede izlenir (`PUBLISHED.log`).
- (−) **Kabul edilen risk R-P32-1 (Yüksek; kullanıcı 2026-11-20 "imzasız, risk kabul"):** Authenticode yok → yayıncı doğrulaması,
  SmartScreen itibarı ve AV güveni yok. Müşteri tarafında sahte bir "NoktaDestekServis" ikilisini ayırt etmek zorlaşır; AV/EDR
  servisi engelleyebilir. Liste beyana dayanır, değiştirilmiş ikili listedeki bir SHA'yı beyan edebilir — liste kimlik doğrulaması
  değildir. İndirme iki yoldan yapılır: oturumlu panel **ve** müşteriye giden AC-419 bağlantısı (oturumsuz; kayıt koduna bağlı,
  kod kullanılana ya da süresi dolana dek geçerli belirteç) — müşteri mesajla gelen bağlantıyı açıp SmartScreen'i geçmeye alışır;
  benzer alan adıyla gönderilen sahte mesaj bu alışkanlığı kullanabilir. Telafi kontrolleri: mesajda alan adı + dosya + sürüm + SHA
  ve uyarı (AC-533), kılavuzda `Get-FileHash` adımı, kayıt kodu (AC-273), cihaz başına yetki (AC-293), görünür gösterge (AC-294), yerel
  kapatma (AC-295), müşteri bildirimi (AC-296), attestation'lı yayın, P29 manifest imzası, izinli liste, acil `off`.
- (−) S-P29-T-1 (tek CI imzası, Kritik, 2026-11-19 kabul) için platform imzası ikinci kapı olamaz; P32 bu riski genişletmez ama
  azaltmaz da.
- (−) **Geri çekme bedeli (S-P32-2):** listeden çıkarılan SHA'daki cihaz 4403 alır ve P29 güncelleme teklifini de alamaz (aynı
  kimliği doğrulanmış soket) → her makinede elle yeniden kurulum. Bu yüzden olağan geri çekme iki aşamalıdır (önce düzeltilmiş sürüm
  yayılır, eski sürüm 0'a iner ya da 7 gün beklenir, sonra SHA çıkarılır); aktif istismarda hemen çıkarılır ve elle kurulum kabul
  edilir (runbook §27.9). Aşama 1 süresince açıklı sürüm bağlanmayı sürdürür. "Yalnız güncelleme" durumu (eski SHA yalnız
  `update.*` alır) **Sonra**.
- (−) Liste elle temizlenir; 16 öğede uyarı, 20'de yayın durur (bilinçli fail-closed; acil yol runbook §27.9).
- Risk kaydı: bu bölüm + runbook §20.3 madde 16 (kullanıcı imzası) + `gereksinimler.md` §15.
