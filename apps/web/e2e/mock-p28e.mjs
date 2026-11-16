// E2E sahte API — P28e-K7 oturum kaydı arayüzü (mimari-p28e r2 §5, §6). Yalnız test; sözleşme contracts api/recording.ts,
// ws-rec.ts. Çerez u-p28e<senaryo>-<rastgele>:
//   p28eadm   ADMIN: settings.view+edit, session_history.view+edit, sessions.view_recording; ayar kapalı başlar.
//   p28esole  aynı; soleManager=true, kayıt açık + gözetimsiz kapalı başlar (tek yönetici uyarısı).
//   p28ero    ayarlar salt okunur (settings.view), geçmiş yalnız view (izleme/silme yok).
//   p28ebusy  p28eadm + parça GET'inde ilk istek 429 Retry-After: 1 (S-P28e-3).
// Kayıt parçaları: konsol PUT'u (Bearer yükleme belirteci) ya da test kancası POST /__e2e/rec-seed/:rid ile depolanır;
// oynatıcı GET'i yalnız izleme belirteciyle. /__e2e/rec-parts/:rid: depolanan parçaların özeti (ilk 4 bayt hex, süre, boyut).
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import {
  deleteRecordingInputSchema,
  putRecordingSettingsInputSchema,
  recBearerSchema,
  recPartParamsSchema,
} from "@remote/contracts/api/recording";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const TENANT = { id: "01JTNP28E0000000000000000A", name: "Demo Firma", slug: "demo" };
const SELF = "01JMSP28E0000000000000000A";
export const P28E = {
  REC: "01JSSP28E0000000000000000A", // katılımlı, rıza, durdu (revoked)
  SIL: "01JSSP28E0000000000000000B", // gözetimsiz silent, firma politikası
  DEL: "01JSSP28E0000000000000000C", // kayıt silindi (elle)
  RID_REC: "01JRDP28E0000000000000000A",
  RID_SIL: "01JRDP28E0000000000000000B",
};
const KINDS = /^u-(p28eadm|p28esole|p28ero|p28ebusy)-/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const tok = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export function p28eUser(cookie) {
  const m = cookie?.match(KINDS);
  if (!m) return null;
  const kind = m[1];
  const ro = kind === "p28ero";
  const perms = ["sessions.view", "settings.view", "session_history.view"];
  if (!ro) perms.push("settings.edit", "session_history.edit", "sessions.view_recording");
  return {
    kind,
    user: {
      id: SELF,
      email: "p28e@ornek.com",
      username: null,
      fullName: "Elif Yönetici",
      role: "ADMIN",
      tenantId: TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: perms,
    tenant: TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

/** Kayıt parçaları (rid → Map("s:p" → {bytes, durationMs, start})). Konsol PUT'u ve seed kancası yazar. */
export const recParts = new Map();
/** Yükleme belirteçleri (token → rid) — mock-ws `rec.state.upload` üretir. */
export const uploadTokens = new Map();
const viewTokens = new Map();

export function newUploadToken(rid) {
  const t = tok();
  uploadTokens.set(t, rid);
  return t;
}

function seriesOf(rid) {
  const m = recParts.get(rid) ?? new Map();
  const byS = new Map();
  for (const [k, v] of m) {
    const [s, p] = k.split(":").map(Number);
    (byS.get(s) ?? byS.set(s, []).get(s)).push({ p, ...v });
  }
  let at = 0;
  const out = [];
  for (const s of [...byS.keys()].sort((a, b) => a - b)) {
    const parts = byS.get(s).sort((a, b) => a.p - b.p);
    // test kancası `gapMs` ile bölümden önce boşluk bırakılabilir
    at += parts[0].gapMs ?? 0;
    const offsetMs = at;
    const items = parts.map((x) => {
      const it = { p: x.p, offsetMs: at, durationMs: x.durationMs };
      at += x.durationMs;
      return it;
    });
    out.push({ s, offsetMs, parts: items });
  }
  return { series: out, durationMs: at, sizeBytes: [...m.values()].reduce((a, v) => a + v.bytes.length, 0) };
}

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (!s) {
    const sole = kind === "p28esole";
    s = {
      settings: { enabled: sole, retentionDays: 30, unattendedEnabled: false, maxRetentionDays: 60, soleManager: sole },
      deleted: new Set([P28E.DEL]),
      stepUpUntil: 0,
      busy: kind === "p28ebusy",
      views: 0,
      puts: [],
    };
    stores.set(cookie, s);
  }
  return s;
}

const settingsView = (s) => ({ ...s.settings, storage: { usedBytes: 6_442_450_944, quotaBytes: 21_474_836_480 } });

function historyItem(id, s) {
  const base = {
    id,
    status: "ENDED",
    code: null,
    createdAt: iso(-3_600_000),
    startedAt: iso(-3_500_000),
    endedAt: iso(-3_000_000),
    expiresAt: iso(-3_000_000),
    durationSec: 500,
    customerName: id === P28E.SIL ? null : "Ayşe Yılmaz",
    customerEmail: null,
    customerFirm: null,
    technician: { id: SELF, name: "Elif Yönetici" },
    tenant: null,
    mode: id === P28E.SIL ? "UNATTENDED" : "BROWSER",
    source: "TECH",
    waitSec: null,
    ticketNo: null,
    endedBy: "TECH",
    endReason: "tech",
    anonymizedAt: null,
    consentMode: id === P28E.SIL ? "silent" : null,
  };
  return { ...base, hasRecording: !s.deleted.has(id) };
}

function recordingSummary(id, s, who) {
  const canView = who.permissions.includes("sessions.view_recording");
  const canDelete = who.permissions.includes("session_history.edit");
  if (id === P28E.DEL || s.deleted.has(id))
    return {
      state: "deleted",
      basis: "consent",
      deleteReason: "manual",
      durationMs: 15_000,
      expiresAt: iso(86_400_000),
      canView: false,
      canDelete: false,
    };
  const rid = id === P28E.SIL ? P28E.RID_SIL : P28E.RID_REC;
  const { durationMs } = seriesOf(rid);
  return {
    state: "stopped",
    basis: id === P28E.SIL ? "tenant_policy" : "consent",
    stopReason: id === P28E.SIL ? "session_end" : "revoked",
    durationMs: durationMs || 15_000,
    expiresAt: iso(29 * 86_400_000),
    canView,
    canDelete,
  };
}

function detail(id, s, who) {
  return {
    ...historyItem(id, s),
    customerEmail: null,
    note: null,
    terminatedBy: null,
    quality: null,
    files: [],
    consents: [],
    controlPeriods: [],
    timeline: [],
    request: null,
    ...(id === P28E.SIL ? { unattended: { consentMode: "silent", silentReason: "Gece bakım penceresi", timeline: [] } } : {}),
    recording: recordingSummary(id, s, who),
  };
}

const IDS = [P28E.REC, P28E.SIL, P28E.DEL];

/** Bayt uçları (çerez/CSRF/Origin okunmaz — yalnız Bearer) ve test kancaları; genel denetimlerden önce çağrılır. */
export async function handleRecBytes(req, res, { url, send, err }) {
  const path = url.split("?")[0];
  const seed = req.method === "POST" && path.match(/^\/__e2e\/rec-seed\/([0-9A-Z]{26})$/);
  if (seed) {
    const body = JSON.parse((await readRaw(req)).toString() || "{}");
    const m = body.from ? new Map(recParts.get(body.from) ?? []) : new Map();
    for (const x of body.parts ?? [])
      m.set(`${x.s}:${x.p}`, { bytes: Buffer.from(x.b64, "base64"), durationMs: x.durationMs, gapMs: x.gapMs });
    recParts.set(seed[1], m);
    return (send(res, 200, { n: m.size }), true);
  }
  const sum = req.method === "GET" && path.match(/^\/__e2e\/rec-parts\/([0-9A-Z]{26})$/);
  if (sum) {
    const m = recParts.get(sum[1]) ?? new Map();
    return (
      send(
        res,
        200,
        [...m.entries()].map(([k, v]) => ({
          k,
          size: v.bytes.length,
          durationMs: v.durationMs,
          start: v.start ?? null,
          head: v.bytes.subarray(0, 4).toString("hex"),
        })),
      ),
      true
    );
  }
  const pm = path.match(/^\/api\/v1\/rec\/([^/]+)\/series\/([^/]+)\/parts\/([^/]+)$/);
  if (!pm) return false;
  const pp = recPartParamsSchema.safeParse({ rid: pm[1], s: pm[2], p: pm[3] });
  if (!pp.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
  const bearer = recBearerSchema.safeParse(req.headers.authorization ?? "");
  const { rid, s, p } = pp.data;
  if (req.method === "PUT") {
    if (!bearer.success || uploadTokens.get(bearer.data) !== rid) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (req.headers["content-type"] !== "video/webm") return (send(res, 400, err("VALIDATION", "İçerik türü")), true);
    const dur = Number(req.headers["x-rec-duration-ms"]);
    const start = req.headers["x-rec-series-start-ms"];
    if (!(dur >= 1 && dur <= 15000) || (p === 0) !== (start !== undefined)) return (send(res, 400, err("VALIDATION", "Başlık")), true);
    if (req.headers.cookie) return (send(res, 400, err("VALIDATION", "Çerez gönderilmemeli")), true);
    const bytes = await readRaw(req);
    const m = recParts.get(rid) ?? recParts.set(rid, new Map()).get(rid);
    const have = [...m.keys()].filter((k) => k.startsWith(`${s}:`)).length;
    if (m.has(`${s}:${p}`)) return (send(res, 200, { next: have }), true);
    if (p !== have) return (send(res, 409, { next: have }), true);
    m.set(`${s}:${p}`, { bytes, durationMs: dur, start: start ? Number(start) : undefined });
    return (send(res, 200, { next: p + 1 }), true);
  }
  if (req.method === "GET") {
    const v = bearer.success ? viewTokens.get(bearer.data) : null;
    if (!v || v.rid !== rid) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    const st = v.store;
    if (st.busy) {
      st.busy = false;
      return (send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "1" }), true);
    }
    const part = recParts.get(rid)?.get(`${s}:${p}`);
    if (!part) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    res.writeHead(200, {
      "Content-Type": "video/webm",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    });
    return (res.end(part.bytes), true);
  }
  return false;
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** true → istek işlendi. */
export async function handleP28e(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = p28eUser(session);
  if (!who) return false;
  const s = store(session, who.kind);
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const m = req.method;
  const ok = (st, body, h) => (send(res, st, body, [], h), true);

  if (m === "GET" && path === "/api/v1/settings/recording") return ok(200, settingsView(s));
  if (m === "GET" && path === "/api/v1/sessions") {
    const items = IDS.map((id) => historyItem(id, s)).filter((x) => q.get("recorded") !== "true" || x.hasRecording);
    return ok(200, { items, page: 1, pageSize: 25, total: items.length });
  }
  const hd = m === "GET" && path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/history$/);
  if (hd) return IDS.includes(hd[1]) ? ok(200, detail(hd[1], s, who)) : ok(404, err("NOT_FOUND", "Bulunamadı."));
  const meta = m === "GET" && path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/recording$/);
  if (meta) {
    const id = meta[1];
    if (!who.permissions.includes("sessions.view_recording") || s.deleted.has(id) || !IDS.includes(id))
      return ok(404, err("NOT_FOUND", "Bulunamadı."));
    const rid = id === P28E.SIL ? P28E.RID_SIL : P28E.RID_REC;
    const sum = recordingSummary(id, s, who);
    const x = seriesOf(rid);
    return ok(200, {
      id: rid,
      state: sum.state,
      basis: sum.basis,
      stopReason: sum.stopReason,
      startedAt: iso(-3_500_000),
      stoppedAt: iso(-3_000_000),
      durationMs: x.durationMs,
      sizeBytes: x.sizeBytes,
      expiresAt: sum.expiresAt,
      ...(id === P28E.SIL ? { consentMode: "silent", silentReason: "Gece bakım penceresi" } : {}),
      series: x.series,
      canDelete: sum.canDelete,
    });
  }
  if (m === "GET") return false;
  if (!csrfOk) return ok(403, err("CSRF_INVALID", "CSRF doğrulaması başarısız."));
  if (m === "POST" && path === "/api/v1/auth/step-up") {
    const p = stepUpInputSchema.safeParse(await readJson(req));
    if (!p.success || (p.data.method === "totp" && p.data.code !== "123456"))
      return ok(400, err("VALIDATION", "Kod hatalı", { fields: { code: "Kod hatalı" } }));
    s.stepUpUntil = Date.now() + 300_000;
    return ok(200, { stepUpUntil: iso(300_000), method: p.data.method });
  }
  if (m === "PUT" && path === "/api/v1/settings/recording") {
    if (!who.permissions.includes("settings.edit")) return ok(403, err("FORBIDDEN", "Yetkiniz yok."));
    const p = putRecordingSettingsInputSchema.safeParse(await readJson(req));
    if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
    const b = p.data;
    const cur = s.settings;
    if (b.enabled && !cur.enabled && b.consentUpdated !== true)
      return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { consentUpdated: "Onay gerekli" } }));
    if (b.unattendedEnabled && !cur.unattendedEnabled) {
      if (b.employeeNoticeAck !== true)
        return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { employeeNoticeAck: "Onay gerekli" } }));
      if (Date.now() > s.stepUpUntil) return ok(401, err("MFA_STEP_UP_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın."));
    }
    if (b.retentionDays > cur.maxRetentionDays)
      return ok(
        400,
        err("VALIDATION", "Doğrulama hatası", { fields: { retentionDays: "Kayıt saklama süresi firma oturum saklama süresini aşamaz" } }),
      );
    Object.assign(cur, { enabled: b.enabled, retentionDays: b.retentionDays, unattendedEnabled: b.enabled && b.unattendedEnabled });
    if (cur.unattendedEnabled && b.employeeNoticeAck) cur.unattendedAckAt = iso();
    return ok(200, settingsView(s));
  }
  const vw = m === "POST" && path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/recording\/view$/);
  if (vw) {
    if (!who.permissions.includes("sessions.view_recording")) return ok(404, err("NOT_FOUND", "Bulunamadı."));
    s.views++;
    const t = tok();
    viewTokens.set(t, { rid: vw[1] === P28E.SIL ? P28E.RID_SIL : P28E.RID_REC, store: s });
    return ok(200, { token: t, idleTtlMs: 300_000, maxUntil: iso(3_600_000) });
  }
  const del = m === "DELETE" && path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/recording$/);
  if (del) {
    if (!deleteRecordingInputSchema.safeParse(await readJson(req)).success) return ok(400, err("VALIDATION", "Onay gerekli"));
    s.deleted.add(del[1]);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/** Test kancası: izleme sayısı (audit `recording.view` tıklama başına). */
export const p28eViews = (cookie) => stores.get(cookie)?.views ?? 0;
export { TOKEN as REC_TOKEN_RE };
