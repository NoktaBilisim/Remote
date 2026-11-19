// E2E sahte API — P29 istemci otomatik güncelleme arayüzü (mimari-p29 §4.8, §6; AC-485, 486, 490, 491). Yalnız test.
// Sorgu/gövdeler gerçek contracts şemalarıyla ayrıştırılır (strict: bilinmeyen alan → 400). Çerez u-p29<senaryo>-<rastgele>:
//   p29adm    ADMIN: unattended.connect+manage, settings.view+edit. 5 cihaz (5 rozet), yayın dolu, belowMin 1.
//   p29ro     USER: unattended.connect + settings.view (ayar salt okunur).
//   p29sa     SUPER_ADMIN, firma bağlamında (actingTenant); `scope=all` → tüm firma sayıları.
//   p29brk    ADMIN: /unattended/versions ve GET /settings/client-update ilk istekte 500 (sonra 200 → "Tekrar dene").
//   p29nopub  ADMIN: yayın bilgisi yok (kısmi şerit).
//   p29empty  ADMIN: cihaz yok (şerit çizilmez, liste boş durumu).
// PUT /settings/client-update gövdeyi strict şemayla ayrıştırır (ihlal → 400 fields.autoUpdate); gövdeler kancada:
// GET /__e2e/p29/puts/<çerez>.
import { clientUpdateSettingsSchema } from "@remote/contracts/api/update";
import { deviceVersionsQuerySchema, listDevicesQuerySchema } from "@remote/contracts/api/unattended";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const TENANT = { id: "01JTNP29V0000000000000000A", name: "Demo Firma", slug: "demo" };
const SELF = "01JMSP29V0000000000000000A";
export const P29 = {
  CUR: "01JDVP29V0000000000000000A",
  PEN: "01JDVP29V0000000000000000B",
  UPD: "01JDVP29V0000000000000000C",
  FAIL: "01JDVP29V0000000000000000D",
  LOW: "01JDVP29V0000000000000000E",
  OTHER: "01JDVP29V0000000000000000F",
};
const KINDS = /^u-(p29adm|p29ro|p29sa|p29brk|p29nopub|p29empty)-/;

export function p29User(cookie) {
  const m = cookie?.match(KINDS);
  if (!m) return null;
  const kind = m[1];
  const sa = kind === "p29sa";
  const perms =
    kind === "p29ro"
      ? ["unattended.connect", "settings.view"]
      : ["unattended.connect", "unattended.manage", "settings.view", "settings.edit"];
  return {
    kind,
    user: {
      id: SELF,
      email: "p29@ornek.com",
      username: null,
      fullName: "Gül Yönetici",
      role: sa ? "SUPER_ADMIN" : kind === "p29ro" ? "USER" : "ADMIN",
      tenantId: sa ? null : TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: perms,
    tenant: sa ? null : TENANT,
    actingTenant: sa ? TENANT : null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const dev = (o) => ({
  customerId: "01JCSP29V0000000000000000A",
  customerName: "Acme Ltd.",
  online: true,
  localEnabled: true,
  signatureOk: true,
  lastSeenAt: iso(-60_000),
  lastSessionAt: null,
  grantCount: 1,
  canConnect: true,
  connectBlockedReason: null,
  verified: true,
  notifyFailed: false,
  replacedAlert: false,
  userState: "active",
  agentVersion: "0.22.1",
  updateBadge: "CURRENT",
  updateReason: null,
  updateVersion: null,
  ...o,
});
const DEVICES = [
  dev({ id: P29.CUR, name: "GUNCEL-PC" }),
  dev({ id: P29.PEN, name: "BEKLEYEN-PC", agentVersion: "0.22.0", updateBadge: "PENDING", updateVersion: "0.22.1" }),
  dev({ id: P29.UPD, name: "KURULAN-PC", agentVersion: "0.22.0", updateBadge: "UPDATING", updateVersion: "0.22.1" }),
  dev({
    id: P29.FAIL,
    name: "HATALI-PC",
    agentVersion: "0.22.0",
    updateBadge: "FAILED",
    updateReason: "HASH_MISMATCH",
    updateVersion: "0.22.1",
  }),
  dev({
    id: P29.LOW,
    name: "ESKI-PC",
    agentVersion: "0.21.0",
    updateBadge: "BELOW_MIN",
    online: false,
    canConnect: false,
    connectBlockedReason: "offline",
  }),
];
const DETAIL = { osVersion: "Windows 11 Pro 23H2", signed: true, lastIp: null, registeredIp: null, registeredAt: null, grants: null };

const PUBLISHED = {
  service: { version: "0.22.1", expiresAt: iso(60 * 86_400_000) },
  client: {
    windows: { version: "0.22.1", expiresAt: iso(20 * 86_400_000) },
    macos: null,
    linux: { version: "0.22.1", expiresAt: iso(20 * 86_400_000) },
  },
};
const NO_PUB = { service: null, client: { windows: null, macos: null, linux: null } };
const rowsOf = (devices) => {
  const m = new Map();
  for (const d of devices) m.set(d.agentVersion, (m.get(d.agentVersion) ?? 0) + 1);
  return [...m.entries()].map(([version, count]) => ({ platform: "windows", component: "service", version, count }));
};

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (!s) {
    s = {
      devices: kind === "p29empty" ? [] : DEVICES.map((d) => ({ ...d })),
      autoUpdate: true,
      versionsFails: kind === "p29brk" ? 1 : 0,
      settingsFails: kind === "p29brk" ? 1 : 0,
      puts: [],
    };
    stores.set(cookie, s);
  }
  return s;
}

/** Test kancası: son PUT gövdeleri (GET /__e2e/p29/puts/<çerez>). */
export function p29Puts(cookie) {
  return stores.get(cookie)?.puts ?? [];
}

/** true → yanıt verildi. */
export async function handleP29(req, res, { url, session: cookie, csrfOk, send, err, readJson }) {
  const who = p29User(cookie);
  if (!who) return false;
  const [path, qs = ""] = url.split("?");
  const q = Object.fromEntries(new URLSearchParams(qs));
  const s = store(cookie, who.kind);
  const m = req.method;
  const ok = (status, body) => (send(res, status, body, [], { "Cache-Control": "no-store" }), true);
  if (m === "GET" && path === "/api/v1/auth/me") return ok(200, who);
  if (m !== "GET" && !csrfOk) return ok(403, err("CSRF_INVALID", "CSRF doğrulaması başarısız."));
  if (path === "/api/v1/unattended/status") return ok(200, { mode: "signed", available: true, notifyChannel: true });
  if (m === "GET" && path === "/api/v1/unattended/devices") {
    const p = listDevicesQuerySchema.safeParse(q);
    if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
    const items = s.devices.filter((d) => !p.data.version || d.agentVersion === p.data.version);
    return ok(200, { items, nextCursor: null });
  }
  if (m === "GET" && path === "/api/v1/unattended/versions") {
    const p = deviceVersionsQuerySchema.safeParse(q);
    if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
    if (p.data.scope === "all" && who.user.role !== "SUPER_ADMIN") return ok(403, err("FORBIDDEN", "Yetkiniz yok."));
    if (s.versionsFails > 0) {
      s.versionsFails--;
      return ok(500, err("INTERNAL", "Sunucu hatası oluştu."));
    }
    const rows = rowsOf(s.devices);
    // Tüm firmalar: başka firmanın 7 cihazı yalnız sayı olarak eklenir (cihaz adı yok)
    if (p.data.scope === "all") rows.push({ platform: "windows", component: "service", version: "0.20.0", count: 7 });
    const below = s.devices.filter((d) => d.updateBadge === "BELOW_MIN").length + (p.data.scope === "all" ? 7 : 0);
    return ok(200, { published: who.kind === "p29nopub" ? NO_PUB : PUBLISHED, rows, belowMin: below });
  }
  const dm = m === "GET" && path.match(/^\/api\/v1\/unattended\/devices\/([0-9A-Z]{26})$/);
  if (dm) {
    const d = s.devices.find((x) => x.id === dm[1]);
    return d ? ok(200, { ...d, ...DETAIL }) : ok(404, err("NOT_FOUND", "Bulunamadı."));
  }
  if (path === "/api/v1/settings/client-update") {
    if (m === "GET") {
      if (s.settingsFails > 0) {
        s.settingsFails--;
        return ok(500, err("INTERNAL", "Sunucu hatası oluştu."));
      }
      return ok(200, { autoUpdate: s.autoUpdate });
    }
    if (m === "PUT") {
      if (!who.permissions.includes("settings.edit")) return ok(403, err("FORBIDDEN", "Yetkiniz yok."));
      const body = await readJson(req);
      s.puts.push(body);
      const p = clientUpdateSettingsSchema.safeParse(body);
      if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { autoUpdate: "Geçersiz değer" } }));
      s.autoUpdate = p.data.autoUpdate;
      return ok(200, { autoUpdate: s.autoUpdate });
    }
  }
  return false;
}

/** Audit satırları (mock-audit `auupd`; `base` ile tamamlanır, en yeni önce). AC-491 etiket vakaları. */
export function p29AuditRows(base, iso) {
  const dv = (o) => base({ userId: null, username: "device", userFullName: null, entity: "unattended_devices", entityId: P29.FAIL, ...o });
  const nv = (o) => ({ fromVersion: "0.22.0", version: "0.22.1", platform: "windows", component: "service", source: "device", ...o });
  return [
    dv({
      id: "2906",
      createdAt: iso(60_000),
      action: "client.update.failed",
      result: "fail",
      newValue: nv({ reason: "MANIFEST_SIGNATURE" }),
    }),
    base({
      id: "2905",
      createdAt: iso(120_000),
      action: "client.update.failed",
      result: "fail",
      userId: null,
      username: "client",
      userFullName: null,
      entity: "device_bindings",
      entityId: "01JBNP29V0000000000000000A",
      newValue: nv({ reason: "DOWNGRADE", component: "client", source: "binding" }),
    }),
    dv({ id: "2904", createdAt: iso(180_000), action: "client.update.installed", newValue: nv({}) }),
    dv({ id: "2903", createdAt: iso(240_000), action: "client.update.available", newValue: nv({}) }),
    dv({ id: "2902", createdAt: iso(300_000), action: "client.update.rolled_back", result: "fail", newValue: nv({ reason: "HEALTH" }) }),
    dv({ id: "2901", createdAt: iso(360_000), action: "client.update.skipped", newValue: nv({ reason: "POLICY_OFF" }) }),
    base({
      id: "2900",
      createdAt: iso(420_000),
      action: "settings.client_update",
      entity: "tenant_settings",
      entityId: "01JAT00000000000000000000A",
      oldValue: { autoUpdate: true },
      newValue: { autoUpdate: false },
    }),
  ];
}
