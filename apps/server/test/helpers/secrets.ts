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
// P11 (B-P11-2): panel TURN secret'ı (settings-p11 entegrasyon testi).
export const FAKE_P11_TURN_SECRET = "p11-turn-secret-0123456789abcdefghij";
// P13b (S-P13b-3/7): WhatsApp servis anahtarı (`x-api-key`; env ve panel). Sahte servis dışında hiçbir yere gitmez.
export const FAKE_WA_ENV_API_KEY = "fake-wa-env-api-key-0123456789";
export const FAKE_WA_PANEL_API_KEY = "fake-wa-panel-api-key-0123456789";
