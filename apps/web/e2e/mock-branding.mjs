// E2E sahte API — P12 marka ve kişiselleştirme (AC-81..85; contracts api/branding). Yalnız test.
// Çerez senaryoları (u-<senaryo>-<rastgele>): br (ADMIN, tüm yetkiler, firma "Demo Firma"), brfail (aynı, tema PATCH'i 500
// → geri alma), brsa (SUPER_ADMIN, firma seçmemiş). Durum oturum çerezi değerine bağlı: aynı çerezle açılan yeni tarayıcı
// bağlamı ("başka cihaz") aynı temayı/avatarı görür. Sunucu gibi: magic bytes (PNG/JPEG/WEBP) + 2 MB; adı "reject" içeren
// dosya 400 INVALID_IMAGE (sunucu reddi yolu); boyut/oran ihlali veya adı "srvdims" içeren dosya 400 + IMAGE_DIMENSIONS_MESSAGE. Yüklenen baytlar /api/v1/files/... altından geri sunulur.
import {
  AVATAR_MAX_ASPECT,
  DEFAULT_LOGO_URL,
  IMAGE_DIMENSIONS_MESSAGE,
  IMAGE_MIN_EDGE_PX,
  INVALID_IMAGE_MESSAGE,
  LOGO_MAX_ASPECT,
  PAYLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_MAX_BYTES,
  preferencesInputSchema,
  themeCookieValue,
} from "@remote/contracts/api/branding";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";

const TENANT = { id: "01JTENBR000000000000000001", name: "Demo Firma", slug: "demo" };
// Herkese açık "demo" firmasının logosu (login ?tenant=demo): 1×1 PNG
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const files = new Map([["/api/v1/files/logo/demo/public-demo-logo-0001.png", { type: "image/png", body: PNG_1PX }]]);
const stores = new Map();
let seq = 0;
const BRANDING_PER_MIN = 60;
const brandingHits = new Map(); // XFF → sayaç (test süresince pencere kapanmaz)

function st(cookie) {
  const m = cookie?.match(/^u-(br|brfail|brsa)-/);
  if (!m) return null;
  let s = stores.get(cookie);
  if (!s) {
    s = { kind: m[1], theme: "SYSTEM", avatarUrl: null, logoUrl: null, systemLogoUrl: null };
    stores.set(cookie, s);
  }
  return s;
}

const me = (s) => {
  const sa = s.kind === "brsa";
  return {
    user: {
      id: sa ? "01JUSBRSA00000000000000001" : "01JUSBR0000000000000000001",
      email: "marka@ornek.com",
      username: null,
      fullName: "Melis Marka",
      role: sa ? "SUPER_ADMIN" : "ADMIN",
      tenantId: sa ? null : TENANT.id,
      theme: s.theme,
      avatarUrl: s.avatarUrl,
      mustChangePassword: false,
    },
    permissions: sa ? [...PERMISSION_KEYS] : PERMISSION_KEYS.filter((k) => !k.startsWith("support_requests.")),
    tenant: sa ? null : TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
    logoUrl: (!sa && s.logoUrl) || s.systemLogoUrl || DEFAULT_LOGO_URL,
  };
};

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > UPLOAD_MAX_BYTES + 64 * 1024) return null; // sunucu gibi: sınır aşılınca okumayı bırak
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** multipart/form-data'dan `file` alanı (ad + bayt). */
function filePart(req, raw) {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers["content-type"] ?? "");
  if (!b) return null;
  const sep = Buffer.from(`--${b[1] ?? b[2]}`);
  let start = raw.indexOf(sep);
  while (start !== -1) {
    const next = raw.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const part = raw.subarray(start + sep.length + 2, next - 2);
    const headEnd = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, headEnd).toString();
    if (/name="file"/.test(head)) return { name: /filename="([^"]*)"/.exec(head)?.[1] ?? "", body: part.subarray(headEnd + 4) };
    start = next;
  }
  return null;
}

function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return ["image/png", "png"];
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ["image/jpeg", "jpg"];
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP")
    return ["image/webp", "webp"];
  return null;
}

/** Yüklemeyi doğrular ve saklar; hata yanıtını kendisi yazar (null döner). */
async function accept(req, res, { send, err }, kind) {
  const raw = await readRaw(req);
  if (!raw || raw.length > UPLOAD_MAX_BYTES + 16 * 1024) return (send(res, 413, err("PAYLOAD_TOO_LARGE", PAYLOAD_TOO_LARGE_MESSAGE)), null);
  const f = filePart(req, raw);
  const type = f && sniff(f.body);
  if (!f || !type || /reject/.test(f.name)) return (send(res, 400, err("INVALID_IMAGE", INVALID_IMAGE_MESSAGE)), null);
  if (f.body.length > UPLOAD_MAX_BYTES) return (send(res, 413, err("PAYLOAD_TOO_LARGE", PAYLOAD_TOO_LARGE_MESSAGE)), null);
  // Sunucu gibi boyut/oran reddi (aynı kod, ayrıntılı mesaj). PNG IHDR'den; adı "srvdims" içeren dosya da (istemci
  // ön kontrolünü geçen bir resmin sunucuda reddi yolu).
  const dims = type[0] === "image/png" ? [f.body.readUInt32BE(16), f.body.readUInt32BE(20)] : null;
  const limit = kind === "avatar" ? AVATAR_MAX_ASPECT : LOGO_MAX_ASPECT;
  const badDims = dims && (Math.min(...dims) < IMAGE_MIN_EDGE_PX || Math.max(...dims) > Math.min(...dims) * limit);
  if (badDims || /srvdims/.test(f.name)) return (send(res, 400, err("INVALID_IMAGE", IMAGE_DIMENSIONS_MESSAGE)), null);
  const url = `/api/v1/files/${kind}/e2e/${String(++seq).padStart(4, "0")}-randomized-name.${type[1]}`;
  files.set(url, { type: type[0], body: f.body });
  return url;
}

export async function handleBranding(req, res, { url, session, csrfOk, send, err }) {
  const path = url.split("?")[0];
  const m = req.method;

  // Herkese açık (oturumsuz): login logosu ve dosyalar
  if (m === "GET" && path === "/api/v1/public/branding") {
    // B-P12-1: sunucu gibi IP başına 60/dk (req.ip = web'in ilettiği XFF). XFF'siz istekler (web'in kendi IP'si) sayılmaz:
    // aksi hâlde paralel e2e'lerin /login açılışları ortak kovayı doldururdu. Test: e2e/p12-branding.spec.ts "B-P12-1".
    const ip = req.headers["x-forwarded-for"];
    if (typeof ip === "string" && ip) {
      const n = (brandingHits.get(ip) ?? 0) + 1;
      brandingHits.set(ip, n);
      if (n > BRANDING_PER_MIN) return (send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "60" }), true);
    }
    const slug = new URL(url, "http://x").searchParams.get("tenant");
    if (slug === TENANT.slug)
      return (send(res, 200, { name: TENANT.name, logoUrl: "/api/v1/files/logo/demo/public-demo-logo-0001.png" }), true);
    return (send(res, 200, { name: null, logoUrl: st(session)?.systemLogoUrl ?? DEFAULT_LOGO_URL }), true);
  }
  if (m === "GET" && files.has(path)) {
    const f = files.get(path);
    res.writeHead(200, { "Content-Type": f.type, "Cache-Control": "no-store" });
    return (res.end(f.body), true);
  }

  const s = st(session);
  if (!s) return false;
  if (m === "GET" && path === "/api/v1/auth/me") return (send(res, 200, me(s)), true);
  if (m !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);

  if (m === "PATCH" && path === "/api/v1/auth/me/preferences") {
    let body = {};
    try {
      let raw = "";
      for await (const c of req) raw += c;
      body = JSON.parse(raw || "{}");
    } catch {
      /* boş */
    }
    const p = preferencesInputSchema.safeParse(body);
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
    if (s.kind === "brfail") return (send(res, 500, err("INTERNAL", "Sunucu hatası oluştu.")), true);
    s.theme = p.data.theme;
    return (send(res, 200, { theme: s.theme }, [`rs_theme=${themeCookieValue(s.theme)}; Path=/; Max-Age=31536000; SameSite=Lax`]), true);
  }

  const av = path.match(/^\/api\/v1\/users\/(me|[0-9A-Z]{26})\/avatar$/);
  if (av && m === "POST") {
    const u = await accept(req, res, { send, err }, "avatar");
    if (u) {
      s.avatarUrl = u;
      send(res, 200, { avatarUrl: u });
    }
    return true;
  }
  if (av && m === "DELETE") return ((s.avatarUrl = null), send(res, 200, { avatarUrl: null }), true);

  if (path === "/api/v1/settings/logo" && m === "POST") {
    const u = await accept(req, res, { send, err }, "logo");
    if (u) {
      s.logoUrl = u;
      send(res, 200, { logoUrl: u });
    }
    return true;
  }
  if (path === "/api/v1/settings/logo" && m === "DELETE") return ((s.logoUrl = null), send(res, 200, { logoUrl: null }), true);

  if (path === "/api/v1/admin/settings/system-logo" && m === "POST") {
    if (s.kind !== "brsa") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const u = await accept(req, res, { send, err }, "system-logo");
    if (u) {
      s.systemLogoUrl = u;
      send(res, 200, { logoUrl: u });
    }
    return true;
  }

  // P15 (AC-233): sistem logosunu kaldır → varsayılan Nokta logosu
  if (path === "/api/v1/admin/settings/system-logo" && m === "DELETE") {
    if (s.kind !== "brsa") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    s.systemLogoUrl = null;
    return (send(res, 200, { logoUrl: DEFAULT_LOGO_URL }), true);
  }

  if (m === "GET" && path === "/api/v1/settings/tenant") {
    return (
      send(res, 200, {
        logoUrl: s.logoUrl,
        sessionTtlMin: 15,
        maxOpenSessions: 3,
        maxActiveHours: 4,
        maxFileMb: 100,
        retentionDays: 365,
        requireTech2fa: true,
        smtp: null,
      }),
      true
    );
  }
  return false;
}
