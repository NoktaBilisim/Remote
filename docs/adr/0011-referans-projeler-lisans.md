# ADR-0011 — Referans projelerden alınanlar (MeshCentral, RustDesk), WS relay yedeği, proje lisansı

Durum: Kabul — lisans **Apache-2.0** kesinleşti (kullanıcı kararı K7) · Tarih: 2026-11-10

## Bağlam

Kullanıcı MeshCentral (Apache-2.0) ve RustDesk (AGPL-3.0) projelerinden **tasarım ilhamı** istedi; kod kopyalanmaz, istemci Go kalır.

## Alınanlar

| Kaynak                  | Fikir                                                        | Bizdeki karşılığı                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MeshCentral Assistant   | Kurulumsuz, kullanıcı yetkisinde destek aracı                | Hızlı Destek istemcisi (ADR-0004)                                                                                                                                                                                      |
| MeshCentral Assistant   | Bağlantı öncesi onay istemi                                  | Karşılama + KVKK onayı (AC-98)                                                                                                                                                                                         |
| MeshCentral             | İzin bitleri (görüntüle / kontrol / dosya)                   | `session_consents.level`; istemcide ayrı kapılar: `view` (varsayılan), `control` (gate, ADR-0009), dosya her transferde ayrı kabul (AC-36). Tek bit maskesi yerine açık durumlar — daha az hata                        |
| MeshCentral             | Kullanıcıya görünür bildirim çubuğu                          | Topmost gösterge şeridi "Ekranınız izleniyor" / "Uzaktan kontrol aktif — <ad>" + "Kontrolü kapat" butonu şeridin üzerinde (AC-103)                                                                                     |
| MeshCentral relay       | Tüm trafiği HTTPS/443 WebSocket relay ile taşıma             | **Sonra** (aşağıda)                                                                                                                                                                                                    |
| RustDesk hbbs/hbbr      | Rendezvous (eşleştirme) ile relay'in ayrı servisler olması   | apps/server (sinyalizasyon) ve coturn (relay) ayrı süreç/VM (ADR-0007)                                                                                                                                                 |
| RustDesk portable mod   | Tek exe, kurulum yok                                         | Aynı; kalıcılık yok (AC-108)                                                                                                                                                                                           |
| RustDesk yakalama       | Değişen bölge / kare atlama                                  | DXGI `AccumulatedFrames==0` / `AcquireNextFrame` timeout → kare kodlanmaz; sabit ekranda ~1 FPS keyframe-dışı "heartbeat"; fare imleci ayrı (DXGI pointer shape) → konsolda imleç overlay'i (bant genişliği tasarrufu) |
| RustDesk codec seçimi   | VP8/VP9/H.264 müzakeresi                                     | SDP'de öncelik H.264 (MF donanım) → VP8 fallback (K4); VP9/AV1 Sonra. Seçim SDP müzakeresiyle, özel protokol yok                                                                                                       |
| RustDesk input modeli   | Fare mutlak koordinat, klavye "keycode + unicode" ikili modu | DC `input`: normalize mutlak koordinat, `code` (fiziksel tuş) + opsiyonel `key` (Unicode; Türkçe karakter) — mimari-protokol §4.3                                                                                      |
| RustDesk izin ver/kapat | Bağlantı sırasında izinlerin anlık açılıp kapanması          | Kontrol kapısı anında kapanır, bildirim sonradan (ADR-0009)                                                                                                                                                            |

## WS relay yedeği (MeshCentral tarzı) — karar: **Sonra**

- İhtiyaç: yalnız 443 açık ağlar. Bunu **TURN-TLS 443** (ayrı IP, ADR-0007) zaten karşılar; WebRTC şifrelemesi korunur.
- Kalan boşluk: TLS-inceleyen (DPI/MITM) kurumsal proxy'ler ve yalnız HTTP CONNECT proxy'li ağlar (TURN-TLS çoğunlukla geçer, bazı DPI'lar kırar).
- Maliyet (şimdi yapılırsa): kodlanmış kareleri WS üzerinden taşıyan ikinci medya hattı (agent paketleyici + tarayıcıda WebCodecs çözücü + canvas), input/chat/dosya için ikinci taşıma, sunucuda medya trafiği (NFR "medya uygulama sunucusundan geçmez" ihlali → ayrı relay servisi), uçtan uca şifrelemenin yeniden tasarımı. Tahmini 2–3 paket → gereksiz kod yükü kuralıyla çelişir.
- Genişleme noktası: agent `internal/rtc` ve web `lib/webrtc/peer.ts` tek giriş noktasıdır; relay gerekirse bu dosyaların yanına `transport/wsrelay` eklenir, DC mesaj sözleşmesi (mimari-protokol §4) aynen taşınır. Tetikleyici: staging/sahada TURN-TLS başarısızlık oranı > %5.

## Proje lisansı — KARAR: Apache-2.0 (K7 kapandı)

RustDesk'ten (AGPL-3.0) **kod alınmaz**; yalnız tasarım fikri. `LICENSE` Apache-2.0 tam metni, `NOTICE` referans projeleri "inspired by" olarak anar. CI lisans kuralı kalıcıdır: AGPL/GPL bağımlılık yasak. Değerlendirilen seçenekler:

| Seçenek                   | Artı                                                                                                               | Eksi                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Apache-2.0 (önerilen)** | Patent hükmü, kurumsal kullanıma dost, MeshCentral ile aynı; bağımlılıklar (Pion MIT, Next MIT, coturn BSD) uyumlu | RustDesk kodu **alınamaz** (AGPL Apache'ye girmez) — zaten yalnız ilham alınıyor                         |
| AGPL-3.0                  | RustDesk kod parçaları alınabilir; başkasının kapalı SaaS yapmasını engeller                                       | Kurumsal benimseme düşer; tüm ağ bileşenleri için kaynak açma yükümlülüğü; gelecekte lisans değişimi zor |
| MIT                       | En basit                                                                                                           | Patent hükmü yok                                                                                         |

Öneri gerekçesi: kod kopyalanmayacağı için AGPL'nin tek getirisi kullanılmıyor; Apache-2.0 SignPath Foundation şartlarını (OSI lisansı) da karşılar. SignPath Foundation başvurusu (ADR-0010) OSI lisansı şartını bu kararla karşılar.

## Sonuçlar

İlham alınan her öğe mevcut paketlere dağıtıldı (P6/P7); yeni paket yok. `NOTICE` dosyası referans projeleri "inspired by" olarak anar (kod yok).
