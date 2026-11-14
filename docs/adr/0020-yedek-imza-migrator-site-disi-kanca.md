# ADR-0020 — Yedek bütünlüğü (manifest imzası, migrator ile yükleme) ve hedeften bağımsız site dışı gönderim kancası
Tarih: 2026-11-14 · Durum: Kabul · İlgili: AC-91, AC-200, S-P13a-2, S-P13a-6, I-P11-1, ADR-0019, `docs/mimari-p13.md` §4, §7.7

## Bağlam
- P13a yedeği gizli ama kimliği doğrulanmamış: age, alıcının açık anahtarını bilen herkesin geçerli yedek üretmesine izin verir.
  Geri yükleme root ile yapılıyor. Güvenlik raporu (S-P13a-2), site dışı kopyadan **önce** imza, migrator ile yükleme ve tam
  karşılaştırma istiyor.
- Site dışı hedef henüz belli değil (S3, NAS, başka sunucu, restic deposu olabilir).
- I-P11-1: audit tetikleyicileri `migrator`'a karşı koruma sağlamaz; migrator `DROP TRIGGER` ya da `TRUNCATE` çalıştırabilir.
  Kötü niyetli ya da hatalı bir migration ile bu olabilir.

## Karar
1. **İmza:** `ssh-keygen -Y sign` (OpenSSH, ed25519, ad alanı `remote-backup`) kullanılır. Yeni paket eklenmez; minisign eklenmez.
   - **İmza anahtarı:** sunucuda üretilir, `/etc/remote-backup/manifest_ed25519` (root 600, parolasız; gözetimsiz çalışır), sunucudan
     çıkmaz.
   - **İmzalanan dosya:** `backup.sh` manifesti tamamlayınca `manifest.json.sig` üretir. Manifest şifreli dosyaların sha256'larını
     içerir, böylece imza bütün çalıştırmayı kapsar. İmza anahtarı yoksa ya da imza başarısızsa `FAILED adım=imza` verilir (yedek
     geçersiz sayılır).
   - **Doğrulama:** `allowed_signers` dosyasıyla yapılır. Dosya sunucuda `/etc/remote-backup/allowed_signers` (root 644) olarak durur;
     kopyası parola kasasında ve iş istasyonundadır. `restore.sh` sırası: önce imza doğrulanır, sonra sha256'lar, sonra çözme. İmza
     yoksa ya da geçersizse çalıştırma durur. **İmzasız yedek için atlama seçeneği yoktur**; P13a dönemi imzasız yedekler yalnız
     staging'e aittir.
   - **Anahtar rotasyonu:** `allowed_signers`'a yeni satır eklenir; eski satıra `valid-before` yazılır ve satır 15 gün tutulur.
   - **Tehdit sınırı:** Sunucu root'unu ele geçiren sahte yedek imzalayabilir. Bu kapsam dışıdır, çünkü root zaten her şeyi
     yapabilir. Korunan senaryo, **site dışı hedefe yazabilen** birinin yedeği değiştirmesidir.
2. **Geri yüklemede yetki sınırı:**
   - Döküm `migrator` kullanıcısıyla ve `mysql --system-command=OFF` ile yüklenir. migrator `*.*` üzerinde yetkisizdir: `CREATE USER`,
     global `GRANT`, `SET PERSIST`, `INSTALL COMPONENT` ve `mysql` şemasına yazma 1044/1227 ile reddedilir ve yükleme FAIL olur.
   - Tetikleyici DEFINER'ı ve `force_created_at` muafiyeti migrator'dır, bu yüzden audit `created_at` korunur.
   - Scratch MySQL'de aynı migrator hesabı `01-users.sh` ile kurulur.
   - Yükleme öncesi ve sonrası **yetki anlık görüntüsü** alınır. P13a'daki liste kalır, `mysql.user` anonim hesap sayısı (= 0)
     eklenir.
   - Uygulama tablolarının **`CHECKSUM TABLE`**'ı scratch ile canlı arasında birebir karşılaştırılır.
3. **Ortam kilidi:**
   - Manifest `env` (`DEPLOY_ENV`) ve `host` alanı taşır.
   - `--target staging|production`, `deploy/.env` `DEPLOY_ENV` ile aynı olmalıdır.
   - `--target production` ek olarak şunları ister: `--confirm <db>@<hostname -s>`, TTY'de `PRODUCTION-<hostname -s>` yazılması
     (TTY yoksa ret) ve manifest `env=production`. **Başka ortamın yedeği prod'a yüklenemez.**
4. **Site dışı kanca (hedeften bağımsız):** `backup.env` `BACKUP_OFFSITE_CMD` tanımlanır.
   - **Ne zaman çalışır:** Yerel yedek imzalanıp `.partial`'dan son adına taşındıktan **sonra**, root olarak, `timeout
     ${BACKUP_OFFSITE_TIMEOUT_SEC:-1800}` ile.
   - **Komuta verilen ortam değişkenleri:** `REMOTE_BACKUP_RUN_DIR`, `REMOTE_BACKUP_RUN`, `REMOTE_BACKUP_DIR`, `REMOTE_BACKUP_HOST`,
     `REMOTE_BACKUP_ENV`.
   - **Dizin içeriği:** yalnız 4 dosya (`db.sql.gz.age`, `uploads.tar.gz.age`, `manifest.json`, `manifest.json.sig`). Dizin
     eşitlemesi yapan araçlar `.partial-*` ve `.lock`'u hariç tutmak zorundadır.
   - **Hata:** Kanca hatası ya da zaman aşımı **yerel yedeği geçersiz kılmaz** (birim başarılı biter). Journal'a
     `remote-backup: OFFSITE-FAILED` yazılır ve `BACKUP_ALERT_CMD` çağrılır.
   - **Tanımsızsa:** her çalıştırmada `remote-backup: OFFSITE-UNCONFIGURED` (uyarı) yazılır.
   - **Durum dosyası:** `/var/lib/remote-backup/status.prom` (Prometheus metin biçimi; genişleme noktası: node_exporter textfile).
   - **Hedef seçim şartları** (hedef belirlendiğinde kabul ölçütü):
     - (a) Sunucudaki kimlik yalnız **yazabilir**; silemez ve üzerine yazamaz. Nesne kilidi, append-only depo ya da sunucuya
       verilmeyen ayrı bir silme kimliği kullanılır.
     - (b) Saklama 14 gün + 1 gündür. KVKK: aydınlatma metni "yedekler 14 gün". Daha uzun saklama metin değişikliği gerektirir.
     - (c) Yurt dışı konum KVKK aktarım değerlendirmesi gerektirir. Yedek şifrelidir ama kişisel veri içerir.
5. **I-P11-1 (audit'in harici kopyası):**
   - **Kopya:** Ayrı bir log akışı kurulmaz. Her gece alınan imzalı döküm `audit_logs`'u içerir; site dışı hedefe "yalnız yazılabilir"
     kimlikle gönderilmesi harici ve eklenebilir-yalnız kopyayı oluşturur.
   - **Tespit (hedeften bağımsız, bu pakette):** `backup.sh` manifeste `audit.maxId` ve tamamlanmış UTC günlerinin satır sayılarını
     (son 729 gün) yazar. Önceki başarılı çalıştırmaya göre `maxId` azalırsa (TRUNCATE) ya da önceki çalıştırmanın gününden **önceki**
     herhangi bir günün sayısı değişirse yedek `FAILED adım=audit-sureklilik` verir ve alarm çalışır.
   - Tetikleyici sayısı denetimi (S-P13a-4) aynen kalır.
   - Tam "WORM" özelliği hedef seçimiyle tamamlanır (Sonra).

## Alternatifler
- minisign: İmza biçimi daha sade, ama host'a yeni paket gerekir. OpenSSH zaten kurulu ve bakımı sürüyor. Geri dönüş kolay:
  `restore.sh`'te doğrulayıcı tek fonksiyondur.
- age ile imza: age imzalamaz.
- Geri yüklemeyi root ile sürdürüp yalnız karşılaştırmaya güvenmek: Tespit sonradandır, kalıcı hesap ya da değişken bırakabilir.
  migrator önleyicidir.
- Audit için ayrı akış (syslog/rsyslog → uzak, WORM log hizmeti): Hedef belli değil. Ek servis ve ağ bağımlılığı getirir.
  Dökümdeki kopya ve süreklilik denetimi bugünkü tehdide (kötü migration) yeter. Sonra.
- Kanca başarısızsa birimi `failed` yapmak: "FAILED = yerel yedek yok (Kritik)" anlamını bozar. Site dışı hata "Uyarı" düzeyindedir.

## Sonuçlar
- Operatörün yeni ön koşulları: `allowed_signers` kopyası ve age özel anahtarı birlikte kasada durur.
- `restore.sh` P13a dönemi imzasız yedekleri reddeder. Staging'in son yedeği P13b koduyla alınmalıdır (ADR-0019 sıra A).
- Kanca root olarak çalışır. `backup.env` için P13a'nın root ve 600 denetimi bu yüzden zorunlu kalır.
- Kanca parametreleri env ile verilir; komut argümanına sır yazılmaz. Hedef kimliği hedef aracının kendi dosyasında (root 600)
  tutulur.
