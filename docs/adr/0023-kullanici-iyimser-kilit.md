# ADR-0023 — Kullanıcı düzenlemede iyimser kilit: `users.version` + If-Match + satır kilidi
Tarih: 2026-11-14 · Durum: Kabul · İlgili: AC-202, AC-206, AC-214, B-P9-2

## Bağlam
İki yönetici aynı kullanıcıyı düzenleyince son yazan kazanıyor (kayıp güncelleme); yetkisi düşürülen aktör eski yetkisiyle işlem tamamlayabiliyor.
`updated_at` ms çözünürlüğü ETag için güvenilir değil ve yetki değişimi ayrı tabloda (`user_permissions`).

## Karar
- `users.version INT UNSIGNED` her form alanı/yetki/durum değişiminde artar. `GET` `ETag: "v<n>"`; `PATCH` `If-Match` zorunlu (yoksa 428, uyuşmazsa 409 `STALE_WRITE`).
- Yazma TX'leri aktör+hedef satırlarını id sırasıyla `FOR UPDATE` kilitler (kilitlenme önlemi), aktör yetkisini TX içinde yeniden okur.
- Testler için servis `deps.afterLock` kancası alır; üretimde env bayrağı yoktur.

## Alternatifler
- `updated_at` ETag: çakışma ve ayrı tablo sorunu. - Pessimistic "düzenleme kilidi": terk edilen kilit yönetimi gerekir.

## Sonuçlar
- Web formu 409'da yeniden yükleme ister. CLI `reset-superadmin` version'ı artırmaz (form alanı değil).
