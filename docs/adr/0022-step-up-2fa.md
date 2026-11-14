# ADR-0022 — Step-up 2FA: oturum başına `step_up_at`, 5 dakika, TOTP veya kurtarma kodu
Tarih: 2026-11-14 · Durum: Kabul (r2: K-E11-1 kullanıcı kararı 2026-11-14) · İlgili: ADR-0008, AC-215, AC-232, AC-266, AC-268, AC-273

## Bağlam
Hassas işlemler (sistem ayarları, SSO, API anahtarı, Super Admin kurtarma, her gözetimsiz bağlantı) girişteki 2FA'dan bağımsız taze bir kanıt ister.
Oturum opak ve DB'dedir (ADR-0008).

## Karar
- `auth_sessions.step_up_at DATETIME(3) NULL`. `POST /auth/step-up {method: TOTP|RECOVERY, code}`: TOTP (`totp_last_step` tekrar koruması) veya kurtarma kodu (aynı TX'te tüketilir; P10 doğrulama fonksiyonu). İki yöntem ortak kilit sayacı; başarıda alanı yazar.
- Tek ortak guard `requireStepUp(maxAgeSec = 300)`; eksikse 401 `MFA_STEP_UP_REQUIRED`; TOTP'siz kullanıcıda 403 `MFA_SETUP_REQUIRED`.
- Gözetimsiz bağlantı (P27) step-up'ı **tüketir** (bağlantı başına bir kez; `step_up_at` NULL'lanır).
- **Kurtarma kodu kabul edilir (K-E11-1, kullanıcı kararı).** Telafi kontrolleri: audit `auth.step_up` `{method, remaining}` (kod yazılmaz); kullanıcıya "Kurtarma kodunuz kullanıldı" e-postası (SMTP varsa); kalan ≤ 3 ise diyalog ve hesap sayfasında yenileme uyarısı (AC-231).
- Arayüz: api istemcisi kodu yakalar, diyalog açar (TOTP / "Kurtarma kodu kullan"), isteği bir kez tekrarlar.

## Alternatifler
- İstek başına TOTP başlığı: her çağrıda kod, kötü UX ve kod tekrar riski. - Ayrı kısa ömürlü step-up token'ı: ek çerez/başlık yüzeyi; oturum satırı yeterli.

## Sonuçlar
- Oturum çalınırsa saldırgan 5 dk penceresini kullanabilir (gözetimsizde tüketim bunu bağlantı başına sınırlar). Tek migration sütunu; geri alınabilir.
- Kurtarma kodu kabulü, şifre + kurtarma kodları birlikte sızarsa step-up'ı aşmaya izin verir; kodların tek kullanımlık olması, e-posta bildirimi ve audit bu riski görünür kılar. AC-273 metni "TOTP" diyor; gereksinimde "TOTP veya kurtarma kodu" olarak revize edilmeli.
