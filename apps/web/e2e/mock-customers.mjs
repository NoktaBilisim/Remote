// E2E sahte API — müşteri firmalar (P8c-1; mimari-api "Müşteriler ve bilgisayar kaydı (P8c)"). Yalnız test.
// Kullanıcılar mock-requests'teki rqcu (ADMIN + customers.*) ve rqcuro (USER, customers.view; geçmiş yetkisi yok).
// Durum senaryoları (rqcu yetkileriyle, QA P8c-1 Tur 2 #2): rqcuempty (müşteri yok), rqcubroken (liste ve detay Talepler
// sekmesi İLK istekte 500, sonra 200 → "Tekrar dene"), rqcuslow (liste ve Talepler sekmesi 1,5 sn gecikmeli → iskelet).
// Tohum: "Şişli Bilişim Ltd." (aktif; bekleyen talep B kayıtlı bilgisayardan), "Eski Firma A.Ş." (pasif).
import { createCustomerInputSchema, foldKey, updateCustomerInputSchema } from "@remote/contracts/api/customers";
import { requestUser, RQ, store } from "./mock-requests.mjs";

const BASE = process.env.MOCK_PUBLIC_BASE_URL ?? "http://localhost:3217";
export const CU = { SISLI: "01JC5ST0000000000000000001", OLD: "01JC5ST0000000000000000002" };
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const A32 = "abcdefghijklmnopqrstuvwxyz234567";
const ref = () => Array.from({ length: 16 }, () => A32[Math.floor(Math.random() * 32)]).join("");
let seq = 10;
const newId = () => `01JC5ST${String(seq++).padStart(19, "0")}`;

const link = (c) =>
  c.status === "ACTIVE"
    ? { downloadUrl: `${BASE}/api/v1/public/agent/request-download?ref=${c.ref}`, fileName: `NoktaDestek-${c.fileLabel}-${c.ref}.exe` }
    : { downloadUrl: null, fileName: null };
const detail = (c, s) => {
  const reqs = [...s.pending, ...s.history].filter((r) => r.customerFirm?.id === c.id);
  const last =
    reqs
      .map((r) => r.createdAt)
      .sort()
      .at(-1) ?? null;
  const rest = { ...c };
  delete rest.ref;
  return { ...rest, ...link(c), lastRequestAt: last, requestCount: reqs.length, sessionCount: 0 };
};
const listItem = (c, s) => {
  const d = detail(c, s);
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    downloadUrl: d.downloadUrl,
    fileName: d.fileName,
    createdAt: d.createdAt,
    lastRequestAt: d.lastRequestAt,
    requestCount: d.requestCount,
  };
};
const cust = (o) => ({
  fileLabel: "Firma",
  contactName: null,
  phone: null,
  email: null,
  note: null,
  refRotatedAt: null,
  passiveAt: null,
  anonymizedAt: null,
  createdAt: iso(-30 * 86_400_000),
  ...o,
});

const stores = new Map();
function cstore(cookie, kind) {
  let c = stores.get(cookie);
  if (c) return c;
  const s = store(cookie, kind);
  const sisli = cust({
    id: CU.SISLI,
    name: "Şişli Bilişim Ltd.",
    status: "ACTIVE",
    fileLabel: "SisliBilisimLtd",
    ref: "sisliref2345abcd",
    contactName: "Ayşe Yılmaz",
    phone: "+905321112233",
  });
  const old = cust({
    id: CU.OLD,
    name: "Eski Firma A.Ş.",
    status: "PASSIVE",
    fileLabel: "EskiFirma",
    ref: "eskiref234567abc",
    passiveAt: iso(-86_400_000),
  });
  const b = s.pending.find((x) => x.id === RQ.B);
  if (b) Object.assign(b, { customerFirm: { id: CU.SISLI, name: sisli.name, status: "ACTIVE" }, viaBinding: true });
  c = { list: kind === "rqcuempty" ? [] : [sisli, old], fails: new Set() };
  stores.set(cookie, c);
  return c;
}

/** POST /sessions `customerId` çözümü (mock-sessions): yalnız aynı kullanıcının AKTİF müşterisi. */
export function customerRef(cookie, id) {
  const c = stores.get(cookie)?.list.find((x) => x.id === id && x.status === "ACTIVE");
  return c ? { id: c.id, name: c.name, status: c.status } : null;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? "_"), i.message]));

export async function handleCustomers(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = requestUser(session);
  const path = url.split("?")[0];
  const isCust = path.startsWith("/api/v1/customers") || /^\/api\/v1\/support-requests\/[0-9A-Z]{26}\/revoke-binding$/.test(path);
  // rqcu*: talep deposu ilk istekte müşteri tohumuyla eşlenir (talep B kayıtlı bilgisayardan, Şişli'ye bağlı)
  if (who && /^rqcu/.test(who.kind)) cstore(session, who.kind);
  if (!isCust || !who) return false;
  const can = (p) => who.permissions.includes(p);
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const s = store(session, who.kind);
  const c = cstore(session, who.kind);
  // rqcubroken: her uç (liste / sekme) ilk istekte 500; rqcuslow: aynı uçlar 1,5 sn gecikir
  const scenario = async (key) => {
    if (who.kind === "rqcuslow") await new Promise((r) => setTimeout(r, 1500));
    if (who.kind !== "rqcubroken" || c.fails.has(key)) return false;
    c.fails.add(key);
    send(res, 500, err("INTERNAL", "Sunucu hatası."));
    return true;
  };
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);

  const rb = path.match(/^\/api\/v1\/support-requests\/([0-9A-Z]{26})\/revoke-binding$/);
  if (rb && req.method === "POST") {
    // Sunucu (§15.2): customers.edit VE support_requests.view
    if (!can("customers.edit") || !can("support_requests.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const it = [...s.pending, ...s.history].find((x) => x.id === rb[1]);
    if (!it) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (!it.viaBinding) return (send(res, 409, err("CONFLICT", "Bu bilgisayarın kaydı zaten geçersiz")), true);
    Object.assign(it, { viaBinding: false, bindingRevoked: true });
    if (it.status === "PENDING") {
      s.pending = s.pending.filter((x) => x.id !== it.id);
      s.history.unshift({ ...it, status: "CANCELLED", cancelReason: "BINDING_REVOKED", closedAt: iso() });
    }
    return (send(res, 204, undefined), true);
  }

  if (path === "/api/v1/customers/options" && req.method === "GET") {
    if (!can("customers.view") && !can("support_requests.view") && !can("session_history.view"))
      return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const k = foldKey(q.get("q") ?? "");
    const items = c.list
      .filter((x) => (q.get("status") === "all" || x.status === "ACTIVE") && foldKey(x.name).includes(k))
      .sort((a, b) => foldKey(a.name).localeCompare(foldKey(b.name)))
      .slice(0, 20)
      .map((x) => ({ id: x.id, name: x.name, status: x.status }));
    return (send(res, 200, { items }), true);
  }
  if (!can("customers.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  if (path === "/api/v1/customers/general-link" && req.method === "GET")
    return (send(res, 200, { downloadUrl: s.settings.downloadUrl, fileName: s.settings.fileName }), true);
  if (path === "/api/v1/customers" && req.method === "GET") {
    if (await scenario("list")) return true;
    const st = q.get("status") ?? "active";
    const k = foldKey(q.get("q") ?? "");
    const all = c.list
      .filter((x) => st === "all" || x.status === (st === "passive" ? "PASSIVE" : "ACTIVE"))
      .filter((x) => !k || `${foldKey(x.name)} ${foldKey(x.contactName ?? "")} ${(x.phone ?? "").replace(/\D/g, "")}`.includes(k))
      .sort((a, b) => foldKey(a.name).localeCompare(foldKey(b.name)));
    const page = Number(q.get("page") ?? 1);
    const pageSize = Number(q.get("pageSize") ?? 50);
    return (
      send(
        res,
        200,
        { items: all.slice((page - 1) * pageSize, page * pageSize).map((x) => listItem(x, s)), page, pageSize, total: all.length },
        [],
        { "Cache-Control": "no-store" },
      ),
      true
    );
  }
  if (path === "/api/v1/customers" && req.method === "POST") {
    if (!can("customers.create")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const p = createCustomerInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    if (c.list.some((x) => foldKey(x.name) === foldKey(p.data.name)))
      return (
        send(res, 409, err("CONFLICT", "Bu adla bir müşteri zaten var", { fields: { name: "Bu adla bir müşteri zaten var" } })),
        true
      );
    const n = cust({ id: newId(), status: "ACTIVE", ref: ref(), createdAt: iso(), ...p.data, fileLabel: p.data.fileLabel ?? "Firma" });
    c.list.push(n);
    return (send(res, 201, detail(n, s)), true);
  }
  const one = path.match(/^\/api\/v1\/customers\/([0-9A-Z]{26})(?:\/(rotate-ref|deactivate|reactivate|requests|sessions))?$/);
  const x = one && c.list.find((y) => y.id === one[1]);
  if (!one) return false;
  if (!x) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
  const action = one[2];
  if (!action && req.method === "GET") return (send(res, 200, detail(x, s)), true);
  if (!action && req.method === "PATCH") {
    if (!can("customers.edit")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const p = updateCustomerInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    for (const [k, v] of Object.entries(p.data)) if (v !== undefined) x[k] = v;
    return (send(res, 200, detail(x, s)), true);
  }
  if (action === "requests" && req.method === "GET") {
    if (!can("support_requests.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (await scenario(`requests:${x.id}`)) return true;
    const items = [...s.pending, ...s.history]
      .filter((r) => r.customerFirm?.id === x.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (send(res, 200, { items, page: 1, pageSize: 25, total: items.length }), true);
  }
  if (action === "sessions" && req.method === "GET") {
    if (!can("session_history.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    return (send(res, 200, { items: [], page: 1, pageSize: 25, total: 0 }), true);
  }
  if (req.method === "POST" && action) {
    if (!can(action === "deactivate" ? "customers.delete" : "customers.edit"))
      return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (action === "rotate-ref") {
      if (x.status !== "ACTIVE") return (send(res, 409, err("CONFLICT", "Müşteri pasif.")), true);
      Object.assign(x, { ref: ref(), refRotatedAt: iso() });
    } else if (action === "deactivate") {
      if (x.status !== "ACTIVE") return (send(res, 409, err("CONFLICT", "Zaten pasif.")), true);
      Object.assign(x, { status: "PASSIVE", passiveAt: iso() });
    } else {
      if (x.status === "ACTIVE") return (send(res, 409, err("CONFLICT", "Zaten aktif.")), true);
      Object.assign(x, { status: "ACTIVE", passiveAt: null, ref: ref(), refRotatedAt: iso() });
    }
    return (send(res, 200, detail(x, s)), true);
  }
  return false;
}
