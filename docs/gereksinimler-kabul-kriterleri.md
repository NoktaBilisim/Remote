# Kabul Kriterleri — Remote Support
Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (bölüm 5). Tarih: 2026-11-11. Durum: TASLAK.
Her AC için adı AC numarasını içeren en az bir otomatik test yazılır (kalite standardı). "Staging testi" ibareli AC'ler gerçek ağda ölçülür ve sonuç `docs/test-raporu.md`'ye yazılır.

## Dosya yapısı
Boyut nedeniyle AC'ler iki parçadadır; bu dosya ile birlikte tek doküman sayılır. AC numaraları `docs/mimari.md` §11 ile birebir aynıdır; numara değiştirilmez, silinen AC numarası yeniden kullanılmaz.

| Parça | Epikler | AC |
|---|---|---|
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e1-e4.md` | E1 Oturum yaşam döngüsü, E2 Sinyalizasyon, E3 Tarayıcı modu + karşılama, E4 Teknisyen konsolu | AC-1..AC-59, AC-112, 113, 114, 117, 119, 120, 125, 127 |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e5-e8.md` | E5 Oturum geçmişi, E6 Ortak platform, E7 Operasyon, E8 Windows istemcisi | AC-60..AC-111, AC-115, 116, 118, 121, 122, 123, 124, 126, 128 |

## Epik bazında sayım
| Epik | AC sayısı | Yeni AC'ler (2026-11-11) |
|---|---|---|
| E1 | 14 | AC-114 |
| E2 | 15 | AC-112, AC-113, AC-120 |
| E3 | 16 | AC-125, AC-127 |
| E4 | 22 | AC-117, AC-119 |
| E5 | 5 | AC-124 |
| E6 | 29 | AC-115, AC-121, AC-122, AC-123, AC-126 |
| E7 | 7 | — |
| E8 | 20 | AC-116, AC-118, AC-128 |
| **Toplam** | **128** | **17** |

## Değişiklik kaydı
- 2026-11-10: İlk sürüm, AC-1..AC-111.
- 2026-11-11: `docs/mimari.md` §13 AC değişiklik talebi işlendi (kaynak: `docs/guvenlik-raporu.md` Tur 0, kullanıcı kararları K3/K6/K7/K8).
  - 22 revizyon: AC-3, 6, 7, 10, 14, 21, 22, 26, 27, 36, 61, 65, 75, 92, 94, 96, 97, 98, 102, 103, 109, 111.
  - 17 yeni AC: AC-112..AC-128.
  - K8: kod imzalama sertifikası yok; istemci imzasız dağıtılır, güven tekrarlanabilir build + SHA-256 + GitHub build attestation ile sağlanır (ADR-0010). Bu nedenle AC-27, AC-92, AC-94, AC-96 metinlerinde imza ifadesi kaldırıldı.
  - Her revize/yeni AC'nin sonunda kaynak notu vardır (örn. "(G-01)").
