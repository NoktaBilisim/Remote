// E2E sahte API — P28b sunucu üzerinden dosya + ClamAV + Dosyalar ayarı (mimari-p28b §4–5; yalnız test).
// Bayt uçları (PUT parça, GET içerik) çerez/CSRF/Origin OKUMAZ: yalnız `Authorization: Bearer`. Belirteç URL'de olursa 404.
// Kullanıcılar: u-fsa-* Super Admin (ClamAV), u-fad-* Admin (Dosyalar; ClamAV testi başarılı), u-fadno-* Admin (test yok →
// anahtar pasif). Geçmiş indirmesi u-hfs-* (mock-history) + bu modüldeki link/içerik ucu. WS tarafı mock-ws.mjs (fsrvTech/Guest).
import { randomBytes } from "node:crypto";
import { updateTenantSettingsInputSchema } from "@remote/contracts/api/tenants";
import { clamavSettingsInputSchema } from "@remote/contracts/api/clamav";

const CHUNK = 1_048_576;
const tok = () => randomBytes(32).toString("base64url");
let seq = 0;
const fidOf = () => `01JFSRV${String(++seq).padStart(19, "0")}`;

/** fid → { sessionId, token, size, chunks, next, parts, name, purpose, pid, sha256, from, dlToken } */
export const fsrvFiles = new Map();
/** Oturum → gözlem (testin belirteç-URL denetimi): { urls: [], tokens: [], auth: [] } */
export const fsrvLog = new Map();
const logOf = (id) => fsrvLog.get(id) ?? fsrvLog.set(id, { urls: [], tokens: [] }).get(id);
let onUploaded = () => undefined;
export const setUploadedHook = (fn) => void (onUploaded = fn);

export function fsrvCreate(sessionId, from, m) {
  const fid = fidOf();
  const token = tok();
  fsrvFiles.set(fid, {
    sessionId,
    token,
    size: m.size,
    chunks: Math.ceil(m.size / CHUNK),
    next: 0,
    parts: [],
    name: m.name,
    purpose: m.purpose,
    pid: m.pid,
    sha256: m.sha256,
    from,
  });
  logOf(sessionId).tokens.push(token);
  return { fid, token, chunks: Math.ceil(m.size / CHUNK) };
}
/** Hazır içerikli dosya (konsola gelen teklif / geçmiş): içerik + indirme belirteci. */
export function fsrvStored(sessionId, name, content, from = "guest") {
  const fid = fidOf();
  const buf = Buffer.from(content);
  fsrvFiles.set(fid, { sessionId, token: null, size: buf.length, chunks: 1, next: 1, parts: [buf], name, purpose: "FILE", from });
  return fid;
}
export function fsrvDownloadToken(fid) {
  const f = fsrvFiles.get(fid);
  if (!f) return null;
  f.dlToken = tok();
  logOf(f.sessionId).tokens.push(f.dlToken);
  return f.dlToken;
}

async function raw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const bearer = (req) => /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;

/** PUT parça / GET içerik — çerez ve Origin denetiminden ÖNCE çağrılır. */
export async function handleFsrvBytes(req, res, { url, send, err }) {
  const path = url.split("?")[0];
  const up = path.match(/^\/api\/v1\/fsrv\/uploads\/([0-9A-Z]{26})\/chunks\/(\d+)$/);
  if (up && req.method === "PUT") {
    const f = fsrvFiles.get(up[1]);
    const body = await raw(req);
    if (f) logOf(f.sessionId).urls.push(url);
    if (!f || !f.token || bearer(req) !== f.token || url.includes(f.token)) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    const n = Number(up[2]);
    if (n < f.next) return (send(res, 200, { next: f.next, received: f.next * CHUNK }), true);
    if (n > f.next) return (send(res, 409, { next: f.next }), true);
    f.parts.push(body);
    f.next++;
    if (f.next < f.chunks) return (send(res, 200, { next: f.next, received: f.next * CHUNK }), true);
    f.token = null;
    send(res, 202, { state: "SCANNING" });
    setTimeout(() => onUploaded(up[1]), 50);
    return true;
  }
  const dl = path.match(/^\/api\/v1\/fsrv\/files\/([0-9A-Z]{26})\/content$/);
  if (dl && req.method === "GET") {
    const f = fsrvFiles.get(dl[1]);
    if (f) logOf(f.sessionId).urls.push(url);
    if (!f || !f.dlToken || bearer(req) !== f.dlToken) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    const buf = Buffer.concat(f.parts);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buf);
    return true;
  }
  const lg = req.method === "GET" && path.match(/^\/__e2e\/fsrv-log\/([0-9A-Z]{26})$/);
  if (lg) return (send(res, 200, fsrvLog.get(lg[1]) ?? { urls: [], tokens: [] }), true);
  return false;
}

// --- Geçmiş (u-hfs-*, mock-history RICH_ID) ---
const historyFiles = new Map();
export function storedFilesOf(sessionId) {
  if (!historyFiles.has(sessionId)) {
    const fid = fsrvStored(sessionId, "kurulum-notu.txt", "P28b geçmiş içeriği\n");
    historyFiles.set(sessionId, [
      {
        id: fid,
        direction: "TO_CUSTOMER",
        purpose: "FILE",
        name: "kurulum-notu.txt",
        sizeBytes: Buffer.byteLength("P28b geçmiş içeriği\n"),
        state: "CLEAN",
        expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        canDownload: true,
      },
      { id: fidOf(), direction: "TO_CUSTOMER", purpose: "PRINT", name: "belge.pdf", sizeBytes: 2048, state: "EXPIRED", canDownload: false },
      {
        id: fidOf(),
        direction: "TO_TECH",
        purpose: "FILE",
        name: "ek.zip",
        sizeBytes: 4096,
        state: "INFECTED",
        signature: "Eicar-Test-Signature",
        canDownload: false,
      },
      { id: fidOf(), direction: "TO_CUSTOMER", purpose: "FILE", name: "geri.txt", sizeBytes: 10, state: "REJECTED", canDownload: false },
    ]);
  }
  return historyFiles.get(sessionId);
}

// --- Kullanıcılar ve ayarlar ---
const states = new Map();
export function p28bUser(cookie) {
  const m = cookie?.match(/^u-(fsa|fad|fadno)-/);
  if (!m) return null;
  const sa = m[1] === "fsa";
  const st = states.get(cookie) ?? states.set(cookie, init(m[1])).get(cookie);
  return {
    user: {
      id: "01JUSERFSRV000000000000001",
      email: "yonetici@ornek.com",
      fullName: "Yönetici Kişi",
      role: sa ? "SUPER_ADMIN" : "ADMIN",
      mustChangePassword: false,
    },
    permissions: ["sessions.view", "settings.view", "settings.edit", "users.view"],
    tenant: sa ? null : { id: "01JTENANT", name: "Demo Firma" },
    actingTenant: null,
    st,
  };
}
function init(kind) {
  const GB = 1024 ** 3;
  return {
    clamav: { host: null, port: 3310, source: "env", lastTest: null, signatureAgeDays: null, stale: false },
    settings: {
      fileServerMode: false,
      fileRetentionDays: 1,
      avReady: kind !== "fadno",
      storage: { usedBytes: Math.round(18.5 * GB), quotaBytes: 20 * GB },
    },
  };
}
const fieldsOf = (e) => Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message]));

export async function handleP28b(req, res, { url, session, send, err, readJson }) {
  const who = p28bUser(session);
  if (!who) return false;
  const path = url.split("?")[0];
  const st = who.st;
  if (path === "/api/v1/admin/settings/clamav") {
    if (who.user.role !== "SUPER_ADMIN") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (req.method === "GET") return (send(res, 200, st.clamav), true);
    if (req.method === "PUT") {
      const p = clamavSettingsInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      if (p.data.host.startsWith("10.") || p.data.host === "dis.ornek.com")
        return (
          send(res, 400, err("HOST_NOT_ALLOWED", "Doğrulama hatası", { fields: { host: "Adres virüs tarama ağının dışında" } })),
          true
        );
      st.clamav = { ...st.clamav, host: p.data.host, port: p.data.port, source: "panel", lastTest: null, stale: false };
      return (send(res, 200, st.clamav), true);
    }
  }
  if (path === "/api/v1/admin/settings/clamav/test" && req.method === "POST") {
    const host = (await readJson(req)).host ?? st.clamav.host;
    // "eski" adlı hedef: imzalar 5 gün eski (AC-361); "kapali": ulaşılamaz
    if (host === "kapali")
      return (
        send(res, 200, {
          ok: false,
          eicarDetected: false,
          encryptedDetected: false,
          version: null,
          dbDate: null,
          signatureAgeDays: null,
          stale: false,
          message: "Virüs tarama servisine ulaşılamadı.",
        }),
        true
      );
    const age = host === "eski" ? 5 : 0;
    const dbDate = new Date(Date.now() - age * 86_400_000).toISOString();
    const r = {
      ok: true,
      eicarDetected: true,
      encryptedDetected: true,
      version: "ClamAV 1.5.4/27100",
      dbDate,
      signatureAgeDays: age,
      stale: age > 3,
    };
    st.clamav = {
      ...st.clamav,
      stale: r.stale,
      signatureAgeDays: age,
      lastTest: { ok: true, at: new Date().toISOString(), version: r.version, dbDate },
    };
    return (send(res, 200, r), true);
  }
  if (path === "/api/v1/settings/tenant") {
    if (req.method === "GET") return (send(res, 200, st.settings), true);
    if (req.method === "PUT") {
      const p = updateTenantSettingsInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      if (p.data.fileServerMode === true && !st.settings.fileServerMode) {
        if (!st.settings.avReady)
          return (
            send(
              res,
              409,
              err("AV_NOT_READY", "Önce virüs tarama bağlantısını başarıyla test edin", {
                fields: { fileServerMode: "Önce virüs tarama bağlantısını başarıyla test edin" },
              }),
            ),
            true
          );
        if (p.data.consentUpdated !== true)
          return (
            send(
              res,
              400,
              err("VALIDATION", "Doğrulama hatası", {
                fields: { consentUpdated: "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın" },
              }),
            ),
            true
          );
      }
      if (p.data.fileServerMode !== undefined) st.settings.fileServerMode = p.data.fileServerMode;
      if (p.data.fileRetentionDays !== undefined) st.settings.fileRetentionDays = p.data.fileRetentionDays;
      return (send(res, 200, st.settings), true);
    }
  }
  return false;
}

/** Geçmiş indirme bağlantısı (u-hfs-*, çerez + CSRF): 5 dk belirteç. */
export function handleStoredLink(req, res, { url, csrfOk, send, err }) {
  const m = req.method === "POST" && url.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/stored-files\/([0-9A-Z]{26})\/link$/);
  if (!m) return false;
  if (!csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const item = historyFiles.get(m[1])?.find((x) => x.id === m[2] && x.canDownload);
  if (!item) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
  const token = fsrvDownloadToken(m[2]);
  return (send(res, 200, { fid: m[2], token, expiresAt: new Date(Date.now() + 300_000).toISOString() }), true);
}
