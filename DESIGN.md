# DESIGN.md — Remote Support (Nokta Uzaktan Destek) tasarım sistemi

Her UI işinden önce okunur (ortak standart §1.8).
**Onaylı hedef görünüm:** `docs/tasarim/` altındaki tıklanabilir taslaklar (2026-11-11 kullanıcı onayı;
dizin `docs/tasarim/index.html`). Taslak = onaylı hedef görünüm; paketler ekranları bunlara göre uygular,
sapma gerekirse gerekçesi `docs/implementation.md`'ye yazılır. Taslak HTML/CSS'i kopyalanmaz — React
bileşenleri bu belgedeki token ve primitiflerle yazılır (taslaktaki üst "taslak çubuğu" ürünün parçası değildir). Token'ların tek kaynağı
`apps/web/app/globals.css`; bu belge anlamlarını ve kullanım kurallarını tanımlar.
Yeni token/bileşen eklendiğinde bu dosya da güncellenir.

## 1. İlkeler
- Yönetim paneli / iş uygulaması: sade, veri odaklı; gradyan, emoji, gereksiz kart yok.
- **Ham renk/px yasak.** Tailwind'in varsayılan paleti kapalıdır (`--color-*: initial`); yalnız
  aşağıdaki anlamsal sınıflar derlenir (`bg-surface`, `text-fg-muted` …).
- JSX `style` prop'u yasak (CSP nonce, G-19; ESLint `react/forbid-dom-props`).
- Arayüz dili Türkçe; metinler `apps/web/messages/tr.json`, erişim `t("anahtar")`.

## 2. Renk token'ları (açık / koyu)
Koyu tema P1'de işletim sistemi tercihine (`prefers-color-scheme`) göre; kullanıcı tercihi (DB, flaşsız) P12.

| Token (Tailwind) | CSS değişkeni | Açık | Koyu | Kullanım |
|---|---|---|---|---|
| `canvas` | `--rs-canvas` | #f5f7fa | #0e1318 | Sayfa zemini |
| `surface` | `--rs-surface` | #ffffff | #151b22 | Kart, üst menü, kenar çubuğu, input |
| `surface-muted` | `--rs-surface-muted` | #eef2f6 | #1d252e | Hover, aktif menü, iskelet |
| `border` | `--rs-border` | #d5dce4 | #303a45 | Çerçeveler |
| `fg` / `fg-muted` | `--rs-fg` / `--rs-fg-muted` | #1b2129 / #56606c | #e6ebf0 / #9ba7b3 | Metin / ikincil metin (≥ 4.5:1) |
| `primary` / `primary-hover` / `on-primary` | `--rs-primary…` | #0a6cb0 / #085a93 / #fff | #56b0ec / #79c1f1 / #08131d | Ana eylem; Nokta logosundaki mavinin erişilebilir tonu |
| `danger` (+`-surface`) | `--rs-danger…` | #b42318 / #fdeceb | #ff8a80 / #3b1714 | Hata, yıkıcı işlem |
| `warning` (+`-surface`) | `--rs-warning…` | #8a5300 / #fff3d6 | #e9b949 / #33260a | Uyarı, kilit (423/429) |
| `success` (+`-surface`) | `--rs-success…` | #17723a / #e6f4ea | #4cc06a / #12301b | Başarı |
| `ring` | `--rs-ring` | = primary | = primary | Odak halkası (2px outline, 2px offset) |
| `logo-surface` | `--rs-logo-surface` | #ffffff | #f5f7fa | Logo kartı — siyah "nokta" yazısı koyu temada da okunur |
| `primary-surface` | `--rs-primary-surface` | #e6f0f9 | #10283a | Bilgi kutusu, seçili menü/segment, "Bekliyor" rozeti, kendi sohbet balonu |
| `overlay` | `--rs-overlay` | rgb(14 19 24 / .5) | rgb(0 0 0 / .62) | Diyalog arka perdesi (`::backdrop`) |
| `stage` / `on-stage` | `--rs-stage` / `--rs-on-stage` | #10151b / #c3ccd5 | #07090c / #c3ccd5 | Konsolda uzak ekran sahnesi — iki temada koyu, müşteri ekranı tema rengiyle karışmaz |
| `control-frame` / `on-control` | `--rs-control-frame` / `--rs-on-control` | #d92d20 / #fff | aynı | "Uzaktan kontrol aktif" çerçevesi ve etiketi (AC-103); koyu `danger` (#ff8a80) alarm gibi okunmadığı için ayrı |
| `annotate` | `--rs-annotate` | #e0218a | aynı | Lazer noktası (P5) — UI renklerinden ayrışır, her ekran içeriğinde seçilir |
| `annot-red` / `annot-yellow` / `annot-green` / `annot-blue` (P5) | `--rs-annot-red/-yellow/-green/-blue` | #ef3b2d / #f5c518 / #22c55e / #3b8bf6 | aynı | İşaretleme kalem/ok/dikdörtgen renkleri (protokol `annot.stroke.color` 4 değer). Uzak ekran içeriği üstünde çizildiği için temadan bağımsız; canvas `annotPalette()` ile CSS değişkeninden okur. Araç çubuğunda renk örneği yalnız renge dayanmaz: düğmenin `aria-label`'ı renk adı, seçili olan `aria-pressed` + `ring-2 ring-fg` |

## 3. Diğer token'lar
- **Boşluk:** Tailwind 4px ızgarası (`--spacing: 0.25rem`); yalnız 4/8 katları.
- **Radius:** `rounded-sm` 6px, `rounded-md` 8px (buton, input), `rounded-lg` 12px (kart).
- **Gölge:** `shadow-sm` (input, buton), `shadow-md` (kart), `shadow-lg` (diyalog, toast, kaydet çubuğu). İki temada ayrı değer.
- **Font:** sistem yığını (`font-sans`, `font-mono`); dış font yok (CSP `'self'`). Gövde 16px mobil / 14px ≥ sm.
- **Dokunma hedefi:** etkileşimli öğeler `min-h-11` (44px).
- **Animasyon:** `ease-out` = `cubic-bezier(0.23,1,0.32,1)`, `ease-in-out` = `cubic-bezier(0.77,0,0.175,1)`;
  yalnız transform/opacity; buton `active:scale-[0.97]`; menü/sekme anında; `prefers-reduced-motion` → yalnız opacity.

## 4. İkonlar
- Tek set: `lucide-react`. Boyut `size-4` (buton/satır içi), `size-5` (menü). Renk `currentColor` (token'dan).
- Dekoratif ikon `aria-hidden`; yalnız ikonlu buton `aria-label`'lı.
- Menü/breadcrumb/link listesinde her başlığın anlamlı ikonu olur. Atananlar: Ana sayfa → `House`,
  Çıkış → `LogOut`, Giriş → `LogIn`, Şifre → `KeyRound`, Tekrar dene → `RotateCw`, Şifre göster → `Eye/EyeOff`,
  Bulunamadı → `SearchX`, Destek (boş durum) → `MonitorSmartphone`.
- Taslaklarla eklenenler: Oturumlar → `MonitorSmartphone`, Oturum geçmişi → `History`, Kullanıcılar → `Users`,
  Kullanıcı (breadcrumb) → `UserRound`, Ayarlar → `Settings`, Audit log → `ScrollText`, Yeni oturum → `Plus`,
  Kopyala → `Copy`, E-posta gönder → `Mail`, İptal → `CircleX`, Kalan süre → `Timer`, Süresi doldu/bekleme → `Hourglass`,
  Kontrol iste → `Hand`, Kontrol sizde → `MousePointerClick`, Kalem → `PenLine`, Lazer → `CircleDot`, Ok → `MoveUpRight`,
  Dikdörtgen → `Square`, İşaret sil → `Eraser`, Monitör/konsol → `Monitor`, Tam ekran → `Maximize`, Oturumu bitir → `Power`,
  Sohbet → `MessageSquare`, Dosyalar → `Paperclip`, Bilgi → `Info`, Gönder → `Send`, Yükle/İndir → `Upload`/`Download`,
  Kabul/Reddet → `UserCheck`/`UserX`, Bağlantı kalitesi → `Signal`, Koptu → `WifiOff`, Dolandırıcılık uyarısı/yükseltilmiş
  pencere → `ShieldAlert`, Kötüye kullanım bildir → `Flag`, Ekran paylaş/durdu → `ScreenShare`/`ScreenShareOff`,
  Paylaşımı durdur → `CircleStop`, Yalnız görüntü → `Eye`, Şifreli bağlantı → `Lock`, Tema → `Sun`/`Moon`/`Laptop`,
  Avatar kaldır → `Trash2`, Bağlantı zaten kullanıldı → `Link2Off` (P2), 2FA sıfırla → `KeyRound`, Hata → `CircleAlert`, Uyarı → `TriangleAlert`.
- P5 ile eklenenler: Geri al (işaretleme) → `Undo2`, Yüzen pencere (Document PiP) → `PictureInPicture2`, Yüzen pencereyi kapat → `X`,
  Dosya/aktarım iptal → `CircleX`, Tehlikeli dosya türü → `ShieldAlert`, Bağlanıyor → `LoaderCircle`.

## 5. Logolar (ortak standart §1.5)
- Kaynak `/Users/mennan/Projeler/NOKTA_LOGO` → `apps/web/public/img/` (kopya; çizilmez). Üretim betiği:
  `pnpm --filter @remote/web icons`.
- `logo.png` login ekranı; `nokta-kucuk.png` üst menü/kenar. Her ikisi `BrandLogo` içinde `logo-surface` kartında.
- Favicon `nokta-kucuk.png`'den kareye tamamlanır: `favicon.ico` (16/32/48), `favicon-32x32.png`, `apple-touch-icon.png` (180).
- `next/image` kullanılmaz (satır içi style üretir → CSP); sabit boyutlu `<img>`.

## 6. Bileşen primitifleri (`apps/web/components`)
| Bileşen | Amaç |
|---|---|
| `ui/button.tsx` | `primary` / `secondary` / `ghost` / `danger` (dolu `danger` zemin, yıkıcı onay: Oturumu bitir) / `danger-ghost` (`danger` çerçeve+metin, hover `danger-surface`: Paylaşımı durdur, Ayrıl) (P4); `loading` → spinner + disabled + `aria-busy`; min 44 px, `:active scale(.97)` |
| `ui/text-field.tsx` | Etiketli input; `error` (aria-invalid + describedby), `hint`, `revealable` şifre göster/gizle |
| `ui/alert.tsx` | `danger` / `locked` (role=alert) · `warning` / `success` (role=status) |
| `brand-logo.tsx` | `full` (login) / `mark` (üst menü) |
| `breadcrumb.tsx` | Panel konum çubuğu; ilk öğe her zaman Ana sayfa |
| `form-error.tsx` | Form üstü sunucu hatası + `requestId` |
| `load-error.tsx` | Sayfa verisi alınamadı + "Tekrar dene" |
| `ui/badge.tsx` (P2) | `StatusBadge`: oturum durumu rozeti (metin + nokta; "Lobide" P3) |
| `ui/dialog.tsx` (P2) | Native `<dialog>` + `showModal`; ilk odak `data-autofocus` öğesi (React `autoFocus` kapalı diyalogda çalışmaz); kendi `ToastViewport`'unu taşır |
| `ui/code-display.tsx` (P2) | 8 hane `4829 1376` (4+4) ve 4 haneli doğrulama kodu; `sm`/`lg`; `xl` (P4): müşteri lobisindeki 4 haneli kabul kodu — hane başına `surface-muted` kutu, mono `text-4xl`/`sm:text-5xl`, `aria-label` rakamları tek tek okutur |
| `guest/share-strip.tsx` (P4) | Müşteri paylaşım şeridi; `data-state` = `idle` / `sharing` / `stopped` / `reconnecting` (`reconnecting` → `role=alert`, `warning` renk). İkonlar: `ScreenShare` (paylaş), `ScreenShareOff` (durdu), `CircleStop` (durdur, `danger-ghost`), `LoaderCircle` (başlıyor/yeniden bağlanıyor), `Power` (oturumu bitir) |
| `console/stage.tsx` (P4) | Konsol sahnesi: `stage`/`on-stage` zemini (iki temada koyu), `<video>`, `data-share` = `unknown`/`sharing`/`stopped`; durum mesajları ikonla: `Hourglass` (müşteri bekleniyor), `ScreenShareOff` (paylaşım durdu), `WifiOff` (bağlantı koptu), `LoaderCircle` (bağlanıyor). **Görüntü modları (AC-43):** yalnız paylaşım görünürken sağ üstte araç grubu (`data-testid=stage-tools`): `Segmented` **Sığdır** (`Expand`; `object-contain`, varsayılan) / **%100** (`ScanSearch`; doğal boyut, `max-w-none`, kaydırma kabı `overflow-auto` + `tabIndex=0` + `role=region` + `aria-label` → klavyeyle odaklanıp ok tuşlarıyla kaydırılır, odak halkası içe) ve `secondary` **Tam ekran** düğmesi (`Maximize` / çıkışta `Minimize` + "Tam ekrandan çık", `aria-pressed`; `requestFullscreen` sahne `<section>`'ına, durum `fullscreenchange`'ten okunur, Esc ile çıkış tarayıcıda). Kök öznitelikler: `data-mode` = `fit`/`actual`, `data-fullscreen` = `true`/`false`. Mod geçişi anında (animasyonsuz) |
| `console/lobby-panel.tsx` (P4) | Bekleyen katılımcılar (≤3, `Users`), kabul kodu girişi (4 hane, `inputmode=numeric`, Enter ile gönder, `UserCheck`), kalan hak uyarısı (`warning`), satır başına `Reddet` (`UserX`, `aria-label="Reddet: <ad>"`) |
| Konsol koyu teması (P4) | `/sessions/[id]/console` kökünde `.theme-dark` sınıfı: kullanıcının tema tercihinden bağımsız koyu token seti (`:root:has(.theme-dark)`, §8; kullanıcı tercihi P12); üst çubuk `ArrowLeft` (oturumlara dön), `Power` (bitir, `danger`), `CircleX` (iptal) |
| Konsol pasif "Uzaktan kontrol" (P4, AC-34) | Tarayıcı modundaki canlı oturumda üst çubukta `secondary` + `disabled` düğme (`MousePointer2`, "Uzaktan kontrol"); nedeni yanında görünür `text-xs text-fg-muted` metinle yazılır ve düğmeye `aria-describedby` ile bağlanır (yalnız `title`/tooltip değil). Etkin kontrol akışı P7 `console/control-button.tsx` |
| `ui/empty-state.tsx` · `ui/skeleton.tsx` · `ui/segmented.tsx` · `ui/avatar.tsx` (P2) | Boş durum · iskelet · `aria-pressed` filtre grubu (min 44 px, anında geçiş; seçenek başına opsiyonel `count` ve P4'te opsiyonel `icon` — `aria-hidden` lucide `size-4`, etiketin solunda, `gap-1.5`; ikon yalnız etiketi destekler, ikon-only seçenek yok) · baş harf rozeti |
| Müşteri: "Bu cihaz desteklenmiyor" (P4, AC-33) | `/session/[token]` karşılama ekranında, istemcide ekran paylaşımı API'si yoksa veya cihaz mobil/yalnız dokunmatikse (`lib/device-support.ts`) katılım formu **yerine** gösterilen kart: `surface` + `border` + `shadow-sm`, `MonitorX` (`text-fg-muted`), başlık + "masaüstü Chrome, Edge veya Firefox" yönlendirmesi; `role=status`, `aria-labelledby`, `data-testid=guest-unsupported`. Sunucu render'ında bilinmez → form gösterilir (hidrasyon sonrası karar). Eylem düğmesi yok (yapılabilecek tek şey başka cihaz); teknisyen kartı, dolandırıcılık uyarısı ve kalan süre görünür kalır |
| Müşteri: Hızlı Destek indirme + SmartScreen rehberi (P6, AC-27) | `session/[token]/agent-download.tsx`. Yalnız Windows masaüstünde (`isWindowsDesktop`, hidrasyon sonrası) "Nasıl bağlanmak istersiniz?" içinde birincil seçenek: `border-2 border-primary` kart bağlantı (`Download`, "Önerilen · tam destek" hapı `primary-surface`); tarayıcı seçeneği o zaman ikincil (`border border-border`, AC metni). Altında hep görünen rehber kartı: `CircleHelp` başlık, numaralı 4 adım (numara `primary-surface` daire), adım 2-3'te `aria-hidden` şema kutusu (`canvas` zemin, "Ek bilgi" / "Yine de çalıştır" vurgulu), `FileCheck2` ile SHA256SUMS `details`. Durumlar: kontrol (`LoaderCircle`, `aria-busy`), başladı `Alert success`, 503 `Alert warning` + `secondary` **Tarayıcıdan devam et** (`ScreenShare`), 429 `locked`, hata `danger`; 410/404 bitiş ekranı. macOS/Linux/mobilde hiç render edilmez |
| Müşteri: "Paylaşım başlatılmadı" (P4) | Paylaşım penceresi iptal edilir/izin verilmezse share-strip altında `Alert tone=danger` (`data-testid=share-denied`): kalın başlık "Paylaşım başlatılmadı" + ne yapılacağı + `secondary` **Tekrar dene** (`RotateCw`; basınca `loading` spinner'ı ikonun yerini alır). Paylaşım başlayınca kendiliğinden kalkar. Tarayıcı API'yi hiç desteklemiyorsa düğmesiz `danger` uyarı ("güncel Chrome, Edge veya Firefox") |
| `collab/chat-panel.tsx` (P5) | Sohbet (konsol yan panel + müşteri "Teknisyenle iletişim"). Kapsayıcı `role=log` + `aria-live=polite` (içinde `<ol>`; rol listeyi ezmesin diye ayrı), en çok `max-h-80` kaydırmalı, `tabIndex=0` + içe odak halkası (`outline-ring`, klavyeyle kaydırma), yeni mesajda en alta kayar. Balon: kendi → sağda `primary-surface`, karşı taraf → solda `surface-muted`; üstünde "Siz"/ad · `<time>` (`formatTime`). Metin React metin düğümü (`whitespace-pre-wrap wrap-anywhere`, `li` `min-w-0` — boşluksuz uzun metin de satır kaydırır; HTML yorumlanmaz). Girdi `textarea` 2 satır, Enter gönderir / Shift+Enter satır, 2000 karakter (son 200'de sayaç). Gönder ikon-only (`Send`, `aria-label`); DC hazır değilken girdi + düğme pasif, düğmede `LoaderCircle`. Durumlar: boş (`MessageSquare` + "Henüz mesaj yok"), bağlanıyor, gönderim hatası (`role=alert`, `danger`), liste. Okunmamış sayı sekme rozetinde (`Segmented.count`) |
| `collab/files-panel.tsx` (P5) | Dosyalar: `secondary` **Dosya gönder** (`Upload`; gizli `input[type=file]`), altında sınır metni (tenant `maxFileMb`, "İçerik sunucudan geçmez"). Satır (`file-row`, `data-status`): yön ikonu `Upload`/`Download`, ad (`truncate` + `title`), boyut (`formatBytes`), etkin aktarımda iptal (`CircleX`, ghost, `aria-label` adla), gönderim/alımda `<progress>` (`accent-primary`, `aria-label`), durum metni `role=status` (tamam → `success`, bozuk/sınır → `danger`, diğer → `fg-muted`); alıcıda yalnız `ok` ise **İndir** bağlantısı (`Download`, blob URL, min 44 px). Gönderen teklifi 30 sn yanıtsız kalırsa satır `timeout` ("Yanıt yok…", `warning`), gönderim kilidi açılır. Hata `Alert danger` (sınır aşımı, meşgul, kısa sürede 3'ten fazla teklif). Yetki yoksa gönderim yerine `Alert warning` "dosya transferi yetkisi yok" (konsol); müşteride sekme hiç yok |
| Dosya kabul diyaloğu (P5, AC-116/117, G-03) | `Dialog role=alertdialog size=sm`; başlık "<ad> size bir dosya göndermek istiyor", açıklama ad + boyut (`break-all`). **Varsayılan odak "Reddet"** (`secondary`, `UserX`, hep etkin — güvenli eylem); **"Kabul et"** (`primary`, `UserCheck`) açılıştan **1,5 sn sonra** etkin (tıklama/Enter tuzağı). Esc/kapat = ret. Tehlikeli uzantı → içerikte `Alert danger` (`ShieldAlert` + "çalıştırılabilir dosya türü"; çift uzantıda "gerçek türü gizlenmiş olabilir"). Gelen teklif, panel başka sekmedeyken **Dosyalar sekmesine geçirir** (onay görünmeden beklemez). Tek bekleyen teklif; retten sonra 30 sn gelenler otomatik ret (satırda neden) |
| `console/quality-panel.tsx` (P5, AC-44/45) | Konsol "Kalite" sekmesi. Ölçüm yokken `Signal` + "Ölçüm bekleniyor". Üstte seviye hapı `role=status`: **iyi** `success-surface`/`success`, **zayıf** `warning-surface`/`warning` (3 sn süren RTT > 300 ms / kayıp > %5 / FPS < 5), **kötü** `danger-surface`/`danger` (RTT > 600 ms / kayıp > %10 / FPS < 2); renk yalnız değil — "Bağlantı zayıf — gecikme yüksek" gibi metin. Altında `<dl>` iki sütun: kare hızı, bit hızı, RTT, kayıp, çözünürlük, bağlantı tipi (Doğrudan/STUN/TURN); sayılar `formatNumber`, `tabular-nums`, sağa hizalı; değer yoksa "—". §6.1'deki `quality-meter` bu bileşendir |
| İşaretleme araç çubuğu + katman (P5, AC-56/57) | `console/collab-side.tsx` `AnnotToolbar`: `role=toolbar`, yalnız "Sığdır" modunda sahnede. Araçlar `PenLine` / `MoveUpRight` / `Square` / `CircleDot` (lazer) — `aria-pressed`, yeniden tıklama aracı kapatır (çizim kapalı = sahne normal); ayırıcı; 4 renk örneği (`annot-*` noktası, `aria-label` renk adı); ayırıcı; `Undo2` geri al, `Eraser` temizle. Düğmeler ikon-only `size-11` (44 px), `aria-label` + `title`. `collab/annot-layer.tsx`: video üstünde `canvas role=img` (`aria-label`), koordinatlar `object-contain` içerik alanına normalize; teknisyende `cursor-crosshair touch-none`, müşteride `pointer-events-none` (yalnız gösterim; girdi olayı üretmez). Lazer 1 sn'de söner (`annotate` rengi). Test kancası: `data-strokes`, `data-laser` |
| Müşteri iletişim + yüzen pencere (P5, AC-37) | `guest/guest-collab.tsx`: "Teknisyenle iletişim" kartı (`surface`, `shadow-sm`); `file_transfer` yeteneği varsa `Segmented` Sohbet/Dosyalar, yoksa yalnız sohbet. Önizleme altında `secondary` **Yüzen pencere** (`PictureInPicture2`) yalnız Document PiP destekleyen tarayıcıda; açıkken önizleme pencereye taşınır, yerinde `role=status` metin + **Yüzen pencereyi kapat** (`X`) |
| `ui/toast.tsx` (P2) | Kendi küçük toast'ımız (Sonner değil: nonce'suz `<style>` enjekte eder → CSP). `useToast()(mesaj, "success"\|"danger")`, 4 sn, en çok 3, `aria-live=polite` |

### 6.1 Onaylı yeni primitifler (kod, ilk kullanıldığı pakette yazılır — şimdi yazılmaz)
| Bileşen | Amaç | İlk paket |
|---|---|---|
| `ui/badge.tsx` | Oturum durumu: Bekliyor (`primary-surface`), Lobide (`warning`, nabız noktası), Aktif (`success`), Bitti, İptal (`danger`), Süresi doldu (içi boş nokta) | P2 |
| `ui/dialog.tsx` | Native `<dialog>` + `showModal` (odak tuzağı), `overlay` perdesi, giriş `scale(.95)+opacity`, `shadow-lg`; yıkıcı onayda odak "Vazgeç"te | P2 |
| `ui/code-display.tsx` | 8 haneli kod (4+4 gruplu, mono), teknisyen doğrulama kodu, 4 haneli büyük kabul kodu kutuları | P2 (büyük kutu P3) |
| `ui/empty-state.tsx` | İkon + başlık + açıklama + eylem | P2 |
| `ui/skeleton.tsx` | `surface-muted` + pulse | P2 |
| `ui/segmented.tsx` | Filtre (Tümü/Açık/Bitmiş), monitör seçimi, tema seçimi; konsol Sığdır/%100 (ikonlu, P4) | P2 |
| `ui/avatar.tsx` | Resim yoksa baş harf rozeti; üst menüde her genişlikte görünür (ad/rol/firma mobilde `sr-only`) | P2 (yükleme P12) |
| `ui/toast` | Kopyalandı, gönderildi, kaydedildi — **yazıldı (Sonner yerine kendi bileşen, §6)** | P2 |
| `guest/share-strip.tsx` | Müşteri "Ekranınız paylaşılıyor / durdu / koptu" şeridi — **yazıldı (§6)** | P4 |
| `console/stage.tsx` | `stage` zemini, video, durum mesajları, uyarı çipleri, görüntü modları + tam ekran, kontrol çerçevesi — **yazıldı (§6; kontrol çerçevesi P7)** | P4 |
| `console/quality-meter.tsx` | FPS, bit hızı, RTT, kayıp, yol (P2P / "TURN · TLS 443") — **yazıldı: `console/quality-panel.tsx` (§6)** | P5 |
| `console/lobby-panel.tsx` | Bekleyen katılımcılar (≤3), kabul kodu girişi, kalan hak, Reddet — **yazıldı (§6)** | P3 (UI P4) |
| `ui/tabs.tsx` | Konsol sağ paneli Sohbet / Dosyalar / Kalite — **yazılmadı: `ui/segmented.tsx` (`aria-pressed` + `count` rozeti) kullanıldı; yeni primitif yok** | P5 |
| `console/annotation-toolbar.tsx` + overlay | Kalem, lazer, ok, dikdörtgen, geri al, temizle — **yazıldı: `AnnotToolbar` (`console/collab-side.tsx`) + `collab/annot-layer.tsx` (§6); 4 renk `annot-*`, lazer `annotate`** | P5 |
| `console/control-button.tsx` | Kontrol durum makinesi: kapalı → istendi → aktif → kapatıldı/reddedildi (30 sn geri sayım, kalan istek) | P7 |
| `ui/switch.tsx` | `role="switch"`, açık/kapalı/kısmi (`mixed`), kilitli (sahip olunmayan yetki) | P9 |
| `admin/permission-matrix.tsx` | `PERMISSION_MODULES`'tan üretilen modül × eylem tablosu, satır başına "Tümü"; dar ekranda kart | P9 |
| `ui/save-bar.tsx` | Kaydedilmemiş değişiklik çubuğu (Vazgeç/Kaydet) + ayrılma uyarısı | P9 |
| Win32 pencereleri (Go) | Karşılama, kontrol izni diyaloğu, üst durum çubuğu — yerel Win32 açık görünüm, web token'ı kullanılmaz | P6 / P7 |

## 7. Durumlar (her ekran)
Yükleniyor (iskelet: `surface-muted` + `animate-pulse`), boş (ikon + açıklama + yönlendirme),
hata (`LoadError` / `FormError`, tekrar dene), kısmi, başarılı. Form gönderiminde alanlar ve buton disabled.

## 8. Onaylı tasarım kararları (2026-11-11, taslak onayı)
- **Konsol varsayılan koyu:** kullanıcı tema tercihi kaydedilmemişse konsol koyu açılır; tercih varsa ona uyar. Konsol ≥ 1280 px, kaydırmasız: üst bar (müşteri, durum, süre, doğrulama kodu, kalite) + araç çubuğu + sahne + 360 px sağ panel.
- **Müşteri ekranları** (karşılama, lobi, tarayıcı modu oturumu) tarayıcı/işletim sistemi temasına uyar (Sistem); hesap yok, DB tercihi yok.
- **Tarayıcı modunda işaretleme** yalnız müşterinin sekmesindeki önizlemede görünür; gerçek masaüstü üstüne çizim yalnız Hızlı Destek istemcisinde (overlay).
- **Kötüye kullanım adresi** (`ABUSE_EMAIL`, K10) açık. Güncelleme (S-P4-1): production'da `ABUSE_EMAIL` boşsa "Kötüye kullanımı bildir" bağlantısı **gizlenir** (Super Admin e-postasına düşülmez). Taslaktaki adres yer tutucudur.
- **Bildirim:** sohbette okunmamış rozeti + toast + sekme başlığında okunmamış sayısı (`(2) Konsol: …`); ses yok.
- **Bağlantı yolu** kalite göstergesinde protokolüyle yazılır: "Doğrudan (P2P) · UDP", "TURN · UDP 3478", "TURN · TLS 443".
- **Kontrol çerçevesi** iki temada sabit kırmızı (`control-frame`); kontrol istendi/reddedildi durumları araç çubuğunda metinle, renge dayanmadan gösterilir.
- **Lobi** birden çok bekleyeni listeler; beklenmeyen kişi için "Reddet" her satırda; hatalı kabul kodunda kalan hak yazılır.
- **Karşılama sırası:** teknisyen + doğrulama kodu → dolandırıcılık uyarısı → ad + aydınlatma onayı → iki yol (Hızlı Destek önerilen / tarayıcıdan yalnız görüntü). SmartScreen rehberi numaralı adım + şema kutusu, ekran görüntüsüz.
- **Win32 istemci** temadan bağımsız yerel açık görünüm; izin diyaloğunda odak "Reddet"te, "İzin ver" 1,5 sn pasif (altında dolan çubuk — zamanı temsil ettiği için `linear` istisnası).
- **Temsili içerik istisnası:** taslaklardaki müşteri ekranı yer tutucusu ve Win32 renkleri sabit hex'tir; ürün token'ı değildir, ürüne taşınmaz.
