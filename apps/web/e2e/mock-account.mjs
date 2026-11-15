// E2E sahte API — P10 hesap güvenliği + SMTP (mimari-api "Auth", /settings/tenant, /settings/smtp/test, /sessions/:id/email).
// Yalnız test. Girişle gelen yarı oturumlar: mfa@ornek.com (2FA etkin → kod adımı), zorunlu@ornek.com (ADMIN, 2FA yok → kurulum
// kapısı). Çerez senaryoları (u-<senaryo>-<rastgele>): acc (ADMIN, 2FA etkin, 2 kurtarma kodu, SMTP ayarlı), nosmtp (ADMIN,
// SMTP yok), accro (USER, yalnız settings.view), accbad (ADMIN; ilk GET /settings/tenant 500 — P14b AC-224). Sabitler: TOTP "123456", kurtarma "abcde-23456" (sunucu gibi normalize: tire/boşluk silinir, küçük harf), sıfırlama tokenı RESET_OK.
import {
  SMTP_INSECURE_AUTH_MESSAGE,
  SMTP_PORT_MESSAGE,
  SMTP_SEND_FAILED_MESSAGE,
  updateTenantSettingsInputSchema,
  smtpTestInputSchema,
} from "@remote/contracts/api/tenants";
import { sessionEmailInputSchema } from "@remote/contracts/api/sessions";
import { mfaRecoveryCodesInputSchema } from "@remote/contracts/api/auth";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import { handleP27a } from "./mock-p27a.mjs";

export const RESET_OK = "r".repeat(43);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const TENANT = { id: "01JTENACC00000000000000001", name: "Demo Firma", slug: "demo" };
const PASSWORD = "DogruSifre123!";
const logins = { "mfa@ornek.com": "mfa", "zorunlu@ornek.com": "setup" };

const stores = new Map();
function st(cookie) {
  const m = cookie?.match(/^a-(mfa|setup)-|^u-(acc|nosmtp|accro|accbad)-/);
  if (!m) return null;
  const kind = m[1] ?? m[2];
  let s = stores.get(cookie);
  if (s) return s;
  s = {
    kind,
    role: kind === "accro" ? "USER" : "ADMIN",
    stage: kind === "mfa" ? "verify" : kind === "setup" ? "setup" : "ok",
    enabled: kind !== "setup" && kind !== "nosmtp",
    rcLeft: kind === "acc" ? 2 : kind === "mfa" ? 10 : 0,
    usedRecovery: false,
    settings: {
      sessionTtlMin: 15,
      maxOpenSessions: 3,
      maxActiveHours: 4,
      maxFileMb: 100,
      retentionDays: 365,
      requireTech2fa: true,
      smtp:
        kind === "nosmtp"
          ? null
          : {
              host: "smtp.ornek.com",
              port: 587,
              security: "STARTTLS",
              user: "destek@ornek.com",
              fromName: "Demo Destek",
              fromEmail: "destek@ornek.com",
              hasPassword: true,
            },
    },
  };
  stores.set(cookie, s);
  return s;
}

const me = (s) => ({
  user: {
    id: "01JUSACC000000000000000001",
    email: s.kind === "setup" ? "zorunlu@ornek.com" : "deniz@ornek.com",
    username: null,
    fullName: "Deniz Güven",
    role: s.role,
    tenantId: TENANT.id,
    theme: "SYSTEM",
    mustChangePassword: false,
  },
  permissions: s.role === "USER" ? ["sessions.view", "settings.view"] : PERMISSION_KEYS.filter((k) => !k.startsWith("support_requests.")), // /ws/panel yalnız mock-requests'te
  tenant: TENANT,
  actingTenant: null,
  mfa: { enabled: s.enabled, required: s.role !== "USER", stage: s.stage, recoveryCodesLeft: s.enabled ? s.rcLeft : 0 },
});
const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.length ? i.path.join(".") : "_", i.message]));

export async function handleAccount(req, res, { url, session, csrfOk, send, err, readJson, sessionCookies }) {
  const path = url.split("?")[0];
  const post = req.method === "POST";
  // P27a: cihaz hatırlama senaryoları (hatirla@ / sa2fa@ girişleri, u-td* çerezleri)
  if (await handleP27a(req, res, { url, session, csrfOk, send, err, readJson, sessionCookies })) return true;

  if (post && path === "/api/v1/auth/login") {
    const body = req.__body ?? (await readJson(req));
    const kind = logins[String(body.login ?? "").toLowerCase()];
    if (!kind) {
      req.__body = body; // mock-api'nin kendi giriş işleyicisine devret
      return false;
    }
    if (body.password !== PASSWORD) return (send(res, 401, err("UNAUTHENTICATED", "Giriş bilgileri hatalı.")), true);
    const token = `a-${kind}-${Math.random().toString(36).slice(2)}`;
    const m = me(st(token));
    return (
      send(
        res,
        200,
        { user: m.user, mfaRequired: kind === "mfa", mfaSetupRequired: kind === "setup", mustChangePassword: false },
        sessionCookies(token),
      ),
      true
    );
  }
  if (post && path === "/api/v1/auth/password/forgot") {
    const { email } = await readJson(req);
    if (email === "yogun@ornek.com")
      return (
        send(res, 429, err("RATE_LIMITED", "Çok fazla istek. Lütfen biraz sonra tekrar deneyin."), [], { "Retry-After": "600" }),
        true
      );
    return (send(res, 202, {}), true);
  }
  if (post && path === "/api/v1/auth/password/reset") {
    const { token, next } = await readJson(req);
    if (token !== RESET_OK) return (send(res, 410, err("RESET_TOKEN_INVALID", "Bağlantı geçersiz veya süresi dolmuş.")), true);
    if (typeof next !== "string" || next.length < 12)
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { next: "En az 12 karakter." } })), true);
    return (send(res, 204, undefined), true);
  }
  // AC-10: oturum bağlantısını e-postayla gönder (her senaryo)
  const em = path.match(/^\/api\/v1\/sessions\/([^/]+)\/email$/);
  if (post && em) {
    if (!csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
    const p = sessionEmailInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    if (p.data.to === "limit@ornek.com")
      return (
        send(res, 429, err("RATE_LIMITED", "Saatte en çok 20 oturum bağlantısı e-postayla gönderilebilir."), [], { "Retry-After": "1800" }),
        true
      );
    if (p.data.to === "fail@ornek.com") return (send(res, 502, err("UPSTREAM", "Önce SMTP ayarlarını yapın")), true);
    return (send(res, 200, { sent: true }), true);
  }

  const s = st(session);
  if (!s) return false;
  if (req.method === "GET" && path === "/api/v1/auth/me") return (send(res, 200, me(s)), true);
  if (post && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);

  // P15 (AC-231): kurtarma kodlarını yenile — TOTP "123456" → 10 yeni kod; "000000" → 429 (5 hatalı deneme kilidi taklidi);
  // diğer → 400 fields.code. 2FA kurulu değilse 403 MFA_SETUP_REQUIRED.
  if (post && path === "/api/v1/auth/mfa/recovery-codes") {
    const p = mfaRecoveryCodesInputSchema.safeParse(await readJson(req));
    if (!s.enabled) return (send(res, 403, err("MFA_SETUP_REQUIRED", "Önce iki adımlı doğrulamayı kurun.")), true);
    if (p.success && p.data.code === "000000")
      return (send(res, 429, err("RATE_LIMITED", "Çok fazla deneme."), [], { "Retry-After": "300" }), true);
    if (!p.success || p.data.code !== "123456")
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } })), true);
    s.rcLeft = 10;
    s.regenerated = (s.regenerated ?? 0) + 1;
    const L = "ABCDEFGHIJ";
    const codes = Array.from({ length: 10 }, (_, i) => `RG${L[i]}${L[s.regenerated % 10]}Z-${L[i]}WXYZ`);
    return (send(res, 200, { codes }), true);
  }
  if (post && path === "/api/v1/auth/mfa/verify") {
    const b = await readJson(req);
    if (b.code === "123456" || (b.recoveryCode && b.recoveryCode.toLowerCase().replace(/[\s-]/g, "") === "abcde23456" && !s.usedRecovery)) {
      if (b.recoveryCode) {
        s.usedRecovery = true;
        s.rcLeft -= 1;
      }
      s.stage = "ok";
      return (send(res, 200, { user: me(s).user, recoveryCodesLeft: s.rcLeft }), true);
    }
    return (send(res, 401, err("UNAUTHENTICATED", "Kod hatalı.")), true);
  }
  if (post && path === "/api/v1/auth/mfa/setup") {
    if (s.enabled) return (send(res, 409, err("CONFLICT", "2FA zaten etkin.")), true);
    return (
      send(res, 200, {
        otpauthUrl: "otpauth://totp/Nokta:deniz@ornek.com?secret=JBSWY3DPEHPK3PXP&issuer=Nokta",
        qrDataUrl: PNG,
        secret: "JBSWY3DPEHPK3PXP",
      }),
      true
    );
  }
  if (post && path === "/api/v1/auth/mfa/enable") {
    const { code } = await readJson(req);
    if (code !== "123456") return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } })), true);
    s.enabled = true;
    s.stage = "ok";
    s.rcLeft = 10;
    return (send(res, 200, { recoveryCodes: Array.from({ length: 10 }, (_, i) => `kod${i}a-${String(10000 + i)}`) }), true);
  }
  if (post && path === "/api/v1/auth/logout-all") return (send(res, 200, { revokedSessions: 2 }), true);
  if (post && path === "/api/v1/auth/password/change") {
    const { current } = await readJson(req);
    if (current !== PASSWORD)
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { current: "Mevcut şifre hatalı." } })), true);
    return (send(res, 204, undefined), true);
  }

  if (path === "/api/v1/settings/tenant") {
    // P14b (AC-224): u-accbad-* → ilk GET 500 (hata + Tekrar dene), sonrakiler 200
    if (req.method === "GET" && s.kind === "accbad" && !s.failedOnce) {
      s.failedOnce = true;
      return (send(res, 500, err("INTERNAL", "Beklenmeyen hata.")), true);
    }
    if (req.method === "GET") return (send(res, 200, s.settings), true);
    if (req.method === "PUT") {
      if (s.role === "USER") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
      const p = updateTenantSettingsInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      // Sunucu tarafı alan hataları (istemci zaten engeller; eski istemci/yarış senaryosu): host "red.ornek.com"
      if (p.data.smtp?.host === "red.ornek.com")
        return (
          send(
            res,
            400,
            err("VALIDATION", "Doğrulama hatası", {
              fields: { "smtp.port": SMTP_PORT_MESSAGE, "smtp.security": SMTP_INSECURE_AUTH_MESSAGE },
            }),
          ),
          true
        );
      if (p.data.smtp && /^(10\.|127\.|192\.168\.)/.test(p.data.smtp.host))
        return (send(res, 400, err("HOST_NOT_ALLOWED", "Bu sunucu adresi kullanılamaz.")), true);
      // P13a: retentionDays 729 → sunucu alan hatası taklidi (istemci aralığı geçer, sunucu reddeder)
      if (p.data.retentionDays === 729)
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { retentionDays: "Sunucu bu süreyi reddetti" } })), true);
      // P14b (AC-224): maxFileMb 2047 → sunucu alan hatası taklidi
      if (p.data.maxFileMb === 2047)
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { maxFileMb: "Sunucu bu sınırı reddetti" } })), true);
      for (const k of ["sessionTtlMin", "maxActiveHours", "maxOpenSessions", "maxFileMb"])
        if (p.data[k] !== undefined) s.settings[k] = p.data[k];
      if (p.data.retentionDays !== undefined) s.settings.retentionDays = p.data.retentionDays;
      if (p.data.requireTech2fa !== undefined) s.settings.requireTech2fa = p.data.requireTech2fa;
      if (p.data.smtp === null) s.settings.smtp = null;
      else if (p.data.smtp) {
        const { password, ...rest } = p.data.smtp;
        s.settings.smtp = { ...rest, hasPassword: rest.user ? Boolean(password) || Boolean(s.settings.smtp?.hasPassword) : false };
      }
      return (send(res, 200, s.settings), true);
    }
  }
  if (post && path === "/api/v1/settings/smtp/test") {
    const p = smtpTestInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    // B-P10-1: sunucu hata sınıfını söylemez; tek genel mesaj
    if (p.data.to === "fail@ornek.com") return (send(res, 502, err("UPSTREAM", SMTP_SEND_FAILED_MESSAGE)), true);
    if (p.data.to === "limit@ornek.com")
      return (send(res, 429, err("RATE_LIMITED", "Dakikada en çok 5 test yapılabilir."), [], { "Retry-After": "60" }), true);
    return (send(res, 200, { ok: true, message: `Test maili ${p.data.to} adresine gönderildi.` }), true);
  }
  return false;
}
