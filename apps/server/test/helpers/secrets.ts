// Testlerde kullanılan SAHTE gizli değerler — tek yer (S-P3-5). Hiçbir ortamda geçerli değildir.
// .gitleaks.toml allowlist'i yalnız bu dosyayı ve test/helpers/app.ts'yi muaf tutar; yeni sahte secret buraya eklenir.
export const FAKE_TURN_SECRET = "test-turn-secret-0123456789-abcdefgh";
export const FAKE_TURN_SECRET_SHORT = "0123456789abcdef";
export const FAKE_TURN_SECRET_32 = "0123456789abcdef0123456789abcdef";
export const FAKE_METRICS_TOKEN = "metrics-token-0123456789";
// P10: APP_ENCRYPTION_KEYS (production modlu testler; 32 bayt 0x11).
export const FAKE_APP_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 0x11).toString("base64")}`;
// P10 (B-P10-2): sahte SMTP kimlik bilgisi (gerçek sunucu yok; şifreli saklama/maskeleme testleri).
export const FAKE_SMTP_PASSWORD = "Cok-Gizli-Sifre-1";
