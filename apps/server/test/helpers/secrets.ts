// Testlerde kullanılan SAHTE gizli değerler — tek yer (S-P3-5). Hiçbir ortamda geçerli değildir.
// .gitleaks.toml allowlist'i yalnız bu dosyayı ve test/helpers/app.ts'yi muaf tutar; yeni sahte secret buraya eklenir.
export const FAKE_TURN_SECRET = "test-turn-secret-0123456789-abcdefgh";
export const FAKE_TURN_SECRET_SHORT = "0123456789abcdef";
export const FAKE_TURN_SECRET_32 = "0123456789abcdef0123456789abcdef";
export const FAKE_METRICS_TOKEN = "metrics-token-0123456789";
