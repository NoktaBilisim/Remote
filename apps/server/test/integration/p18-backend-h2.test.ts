// P18 H2 — atama, öncelik, SLA, mesai/tatil (mimari-e11 §8b.2–8b.7, §8b.13; AC-256, 257, 258; S-P18-T5/T6/T7/T12).
// Gerçek MySQL + canlı sunucu (panel WS). Mesai testleri sahte saatle (talep `created_at` = saat).
import type {
  BusinessHoursView,
  HolidayImportResponse,
  HolidayItem,
  HolidayListResponse,
  SupportRequestItem,
  SupportRequestListResponse,
  SupportRequestSettings,
  TenantRequestInfo,
} from "@remote/contracts/api/requests";
import { ASSIGNEE_INVALID_MESSAGE, HOLIDAYS_MAX } from "@remote/contracts/api/requests";
import type { CustomerDetail } from "@remote/contracts/api/customers";
import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import type { UserOptionsResponse } from "@remote/contracts/api/users";
import { TR_HOLIDAYS } from "@remote/contracts/holidays-tr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import { createCustomerRow, createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { FakeClock } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const db = () => testDb();
type Res = { statusCode: number; json: <T>() => T; headers: Record<string, unknown>; body: string };
const err = (r: Res) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;
let ipSeq = 0;
const nextIp = () => `203.0.${113 + (Math.floor(ipSeq / 200) % 10)}.${(ipSeq++ % 200) + 20}`;

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: PROXY });
});
afterAll(() => live.close());

const call = (
  s: Session,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  extra: Record<string, string> = {},
) =>
  live.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...s.headers, ...extra },
    ...(payload === undefined ? {} : { payload }),
  }) as Promise<Res>;

async function tenantWithAdmin() {
  const t = await createTenant();
  const ref = await createRequestSettings(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  return { t, ref, admin, s: await loginAs(live.app, admin) };
}

describe("AC-256 atama", () => {
  it("AC-256: yetkisiz 403; başka tenant / pasif / kabul yetkisiz / Super Admin → 400; atanana request.updated; audit eski→yeni", async () => {
    const { t, s } = await tenantWithAdmin();
    const r = await createRequestRow(t.id);
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const techS = await loginAs(live.app, tech);
    const rc = requestClient(live.app, live.base);
    const panel = await rc.panelWs(techS.token);
    await waitMsg(panel, "queue.count");

    // yetkisiz: view + accept var, assign yok → 403
    expect((await call(techS, "POST", `/support-requests/${r.id}/assign`, { userId: tech.id })).statusCode).toBe(403);
    expect((await call(techS, "POST", `/support-requests/${r.id}/priority`, { priority: "HIGH" })).statusCode).toBe(403);

    const other = await createTenant();
    const foreign = await createUser({ tenantId: other.id, role: "ADMIN" });
    const passive = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS, status: "PASSIVE" });
    const noAccept = await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true } });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    for (const u of [foreign, passive, noAccept, sa]) {
      const res = await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: u.id });
      expect(res.statusCode, res.body).toBe(400);
      expect(err(res).fields?.userId).toBe(ASSIGNEE_INVALID_MESSAGE);
    }
    expect((await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: "x" })).statusCode).toBe(400);

    const ok = await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: tech.id });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<SupportRequestItem>().assignedTo).toEqual({ id: tech.id, name: "Test Kullanıcı" });
    expect(await waitMsg(panel, "request.updated")).toEqual({
      t: "request.updated",
      id: r.id,
      priority: "NORMAL",
      assignedTo: { id: tech.id, name: "Test Kullanıcı" },
      slaDueAt: null,
    });
    const row = await db().supportRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.assignedTo).toBe(tech.id);
    expect(row.assignedAt).not.toBeNull();
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "request.assigned" } });
    expect(a).toMatchObject({ tenantId: t.id, oldValue: { assignedTo: null }, newValue: { assignedTo: tech.id }, result: "success" });

    // aynı atama → değişiklik/audit yok; kaldırma → audit
    expect((await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: tech.id })).statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { entityId: r.id, action: "request.assigned" } })).toBe(1);
    const un = await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: null });
    expect(un.json<SupportRequestItem>().assignedTo).toBeNull();
    expect(await db().auditLog.count({ where: { entityId: r.id, action: "request.assigned" } })).toBe(2);

    // "Bana atananlar" / "atanmamış" filtresi
    await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: tech.id });
    const mine = (await call(techS, "GET", "/support-requests?tab=pending&assigned=me")).json<SupportRequestListResponse>();
    expect(mine.items.map((i) => i.id)).toEqual([r.id]);
    const none = (await call(techS, "GET", "/support-requests?tab=pending&assigned=none")).json<SupportRequestListResponse>();
    expect(none.items).toHaveLength(0);
    panel.ws.close();
  });

  it("AC-256: başka tenant'ın talebi 404; kapalı talep 409 REQUEST_CLOSED; K-P18-3 atanmış talebi başkası kabul edebilir", async () => {
    const { t, s } = await tenantWithAdmin();
    const other = await tenantWithAdmin();
    const foreignReq = await createRequestRow(other.t.id);
    expect((await call(s, "POST", `/support-requests/${foreignReq.id}/assign`, { userId: null })).statusCode).toBe(404);
    expect((await call(s, "POST", `/support-requests/${foreignReq.id}/priority`, { priority: "LOW" })).statusCode).toBe(404);

    const r = await createRequestRow(t.id);
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: tech.id });
    const acc = await call(s, "POST", `/support-requests/${r.id}/accept`, {});
    expect(acc.statusCode, acc.body).toBe(200);
    const closed = await call(s, "POST", `/support-requests/${r.id}/assign`, { userId: null });
    expect(closed.statusCode).toBe(409);
    expect(err(closed).code).toBe("REQUEST_CLOSED");
    expect(err(await call(s, "POST", `/support-requests/${r.id}/priority`, { priority: "HIGH" })).code).toBe("REQUEST_CLOSED");
  });

  it("AC-256: /users/options?assignable=1 yalnız aynı tenant, ACTIVE, view+accept yetkili kullanıcılar", async () => {
    const { t, admin, s } = await tenantWithAdmin();
    const ok = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS, status: "PASSIVE" });
    await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true } });
    await createUser({ tenantId: t.id, role: "ADMIN", perms: { "support_requests.accept": false } });
    const res = (await call(s, "GET", "/users/options?assignable=1")).json<UserOptionsResponse>();
    expect(res.items.map((i) => i.id).sort()).toEqual([admin.id, ok.id].sort());
    // assign yetkisi olmayan USER yalnız kendisini görür (mevcut kural)
    const techS = await loginAs(live.app, ok);
    expect((await call(techS, "GET", "/users/options?assignable=1")).json<UserOptionsResponse>().items.map((i) => i.id)).toEqual([ok.id]);
  });
});

describe("S-P18-T5 atama yaşam döngüsü", () => {
  it("S-P18-T5: pasife alma aynı TX'te bekleyen atamayı kaldırır; audit reason user_inactive; panele request.updated; kapalı talep dokunulmaz", async () => {
    const { t, s } = await tenantWithAdmin();
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const watcher = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const rc = requestClient(live.app, live.base);
    const panel = await rc.panelWs((await loginAs(live.app, watcher)).token);
    await waitMsg(panel, "queue.count");
    const pending = await createRequestRow(t.id);
    const closedReq = await createRequestRow(t.id);
    await call(s, "POST", `/support-requests/${pending.id}/assign`, { userId: tech.id });
    await call(s, "POST", `/support-requests/${closedReq.id}/assign`, { userId: tech.id });
    await db().supportRequest.update({ where: { id: closedReq.id }, data: { status: "EXPIRED", closedAt: new Date() } });
    panel.msgs.length = 0;

    const d = await call(s, "POST", `/users/${tech.id}/deactivate`, {});
    expect(d.statusCode, d.body).toBe(204);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: pending.id } })).assignedTo).toBeNull();
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: closedReq.id } })).assignedTo).toBe(tech.id);
    const a = await db().auditLog.findFirstOrThrow({
      where: { entityId: pending.id, action: "request.assigned" },
      orderBy: { id: "desc" },
    });
    expect(a.newValue).toEqual({ assignedTo: null, reason: "user_inactive" });
    expect(a.oldValue).toEqual({ assignedTo: tech.id });
    expect(await waitMsg(panel, "request.updated")).toMatchObject({ id: pending.id, assignedTo: null });
    panel.ws.close();
  });

  it("S-P18-T5: support_requests.accept yetkisinin kaldırılması atamayı kaldırır; firma pasife alma da", async () => {
    const { t, s } = await tenantWithAdmin();
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const r1 = await createRequestRow(t.id);
    await call(s, "POST", `/support-requests/${r1.id}/assign`, { userId: tech.id });
    const etag = (await call(s, "GET", `/users/${tech.id}`)).headers.etag as string;
    const p = await call(s, "PATCH", `/users/${tech.id}`, { permissions: { "support_requests.accept": false } }, { "if-match": etag });
    expect(p.statusCode, p.body).toBe(200);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: r1.id } })).assignedTo).toBeNull();

    const tech2 = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const r2 = await createRequestRow(t.id);
    await call(s, "POST", `/support-requests/${r2.id}/assign`, { userId: tech2.id });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const saS = await loginAs(live.app, sa);
    const dt = await call(saS, "POST", `/admin/tenants/${t.id}/deactivate`, {});
    expect(dt.statusCode, dt.body).toBe(200);
    const row = await db().supportRequest.findUniqueOrThrow({ where: { id: r2.id } });
    expect(row).toMatchObject({ assignedTo: null, status: "CANCELLED", cancelReason: "TENANT_PASSIVE" });
    expect(
      await db().auditLog.count({
        where: { entityId: r2.id, action: "request.assigned", newValue: { equals: { assignedTo: null, reason: "user_inactive" } } },
      }),
    ).toBe(1);
  });
});

describe("AC-257 öncelik, kuyruk, varsayılanlar, SLA", () => {
  it("AC-257: HIGH sonra gelse de position 1; aynı öncelikte FIFO; öncelik değişimi kuyruğu ve sırayı günceller (audit)", async () => {
    const { t, ref, s } = await tenantWithAdmin();
    const rc = requestClient(live.app, live.base);
    const a = (await rc.createReq(ref, nextIp())).json<{ requestId: string; position: number }>();
    const b = (await rc.createReq(ref, nextIp())).json<{ requestId: string; position: number }>();
    expect([a.position, b.position]).toEqual([1, 2]);
    // firma varsayılanı HIGH → sonra gelen HIGH talep 1. sırada
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { defaultPriority: "HIGH" } });
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; position: number }>();
    expect(c.position).toBe(1);
    const list = (await call(s, "GET", "/support-requests?tab=pending")).json<SupportRequestListResponse>();
    expect(list.items.map((i) => i.id)).toEqual([c.requestId, a.requestId, b.requestId]);
    expect(list.items[0]?.priority).toBe("HIGH");

    const p = await call(s, "POST", `/support-requests/${b.requestId}/priority`, { priority: "HIGH" });
    expect(p.statusCode, p.body).toBe(200);
    const after = (await call(s, "GET", "/support-requests?tab=pending")).json<SupportRequestListResponse>();
    expect(after.items.map((i) => i.id)).toEqual([b.requestId, c.requestId, a.requestId]); // HIGH'lar kendi içinde FIFO
    const states = await live.app.requests.statesOf(t.id);
    expect(states.get(b.requestId)?.position).toBe(1);
    expect(states.get(a.requestId)?.position).toBe(3); // pozisyon artabilir (§8b.3)
    const au = await db().auditLog.findFirstOrThrow({ where: { entityId: b.requestId, action: "request.priority_changed" } });
    expect(au).toMatchObject({ oldValue: { priority: "NORMAL" }, newValue: { priority: "HIGH" } });
  });

  it("AC-257: müşteri varsayılanı > firma varsayılanı; SLA dondurulur (ayar sonradan değişse de); ayar ucu alanları", async () => {
    const { t, ref, s } = await tenantWithAdmin();
    const put = await call(s, "PUT", "/settings/support-requests", {
      waitMinutes: 30,
      trustedCidrs: [],
      whatsapp: { enabled: false, recipients: [] },
      email: { enabled: false, recipients: [] },
      defaultPriority: "LOW",
      defaultSlaMinutes: 45,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<SupportRequestSettings>()).toMatchObject({ defaultPriority: "LOW", defaultSlaMinutes: 45 });
    const sa = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "settings.support_requests.updated" } });
    expect(sa.newValue).toMatchObject({ defaultPriority: "LOW", defaultSlaMinutes: 45 });

    const rc = requestClient(live.app, live.base);
    const g = (await rc.createReq(ref, nextIp())).json<{ requestId: string }>();
    const gr = await db().supportRequest.findUniqueOrThrow({ where: { id: g.requestId } });
    expect(gr).toMatchObject({ priority: "LOW", slaMinutes: 45, afterHours: false });
    expect(gr.slaDueAt?.getTime()).toBe(gr.createdAt.getTime() + 45 * 60_000);

    const cust = await createCustomerRow(t.id);
    const patch = await call(s, "PATCH", `/customers/${cust.id}`, { defaultPriority: "HIGH", slaMinutes: 10 });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json<CustomerDetail>()).toMatchObject({ defaultPriority: "HIGH", slaMinutes: 10 });
    const cu = await db().auditLog.findFirstOrThrow({ where: { entityId: cust.id, action: "customer.updated" } });
    expect(cu.newValue).toMatchObject({ defaultPriority: "HIGH", slaMinutes: 10 });
    const m = (await rc.createReq(cust.requestRef, nextIp())).json<{ requestId: string }>();
    const mr = await db().supportRequest.findUniqueOrThrow({ where: { id: m.requestId } });
    expect(mr).toMatchObject({ priority: "HIGH", slaMinutes: 10 });

    // dondurma: ayar değişimi mevcut talebi etkilemez
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { defaultSlaMinutes: 600 } });
    await call(s, "POST", `/support-requests/${g.requestId}/priority`, { priority: "HIGH" });
    const again = await db().supportRequest.findUniqueOrThrow({ where: { id: g.requestId } });
    expect(again.slaDueAt?.getTime()).toBe(gr.slaDueAt?.getTime());

    // müşteri oluştururken alanlar
    const created = await call(s, "POST", "/customers", {
      name: `Öncelikli ${newId().slice(-6)}`,
      defaultPriority: "LOW",
      slaMinutes: null,
    });
    expect(created.json<CustomerDetail>()).toMatchObject({ defaultPriority: "LOW", slaMinutes: null });
  });

  it("AC-257: liste slaBreached (sınır) ve oturum geçmişi CSV 'SLA aşıldı' Evet/Hayır/boş", async () => {
    const { t, admin, s } = await tenantWithAdmin();
    const now = Date.now();
    const late = await createRequestRow(t.id, { createdAt: new Date(now - 10 * 60_000) });
    const fine = await createRequestRow(t.id, { createdAt: new Date(now - 10 * 60_000) });
    await db().supportRequest.update({ where: { id: late.id }, data: { slaMinutes: 5, slaDueAt: new Date(now - 5 * 60_000) } });
    await db().supportRequest.update({ where: { id: fine.id }, data: { slaMinutes: 60, slaDueAt: new Date(now + 50 * 60_000) } });
    const list = (await call(s, "GET", "/support-requests?tab=pending")).json<SupportRequestListResponse>();
    const byId = new Map(list.items.map((i) => [i.id, i]));
    expect(byId.get(late.id)?.slaBreached).toBe(true);
    expect(byId.get(fine.id)?.slaBreached).toBe(false);

    for (const id of [late.id, fine.id]) expect((await call(s, "POST", `/support-requests/${id}/accept`, {})).statusCode).toBe(200);
    await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" }); // talepsiz
    const csv = await call(s, "GET", "/sessions/export.csv");
    expect(csv.statusCode, csv.body).toBe(200);
    const lines = csv.body
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter(Boolean);
    expect(lines[0]?.endsWith(";Dosyalar;SLA aşıldı")).toBe(true);
    const lastCells = lines.slice(1).map((l) => l.slice(l.lastIndexOf(";") + 1));
    expect(lastCells.sort()).toEqual(["", "Evet", "Hayır"]);
  });

  it("AC-257 / §8b.8: oturum geçmişi detayı request.slaDueAt + request.slaBreached (CSV ile aynı hesap; SLA'sız null, talepsiz request null)", async () => {
    const { t, admin, s } = await tenantWithAdmin();
    const now = Date.now();
    const late = await createRequestRow(t.id, { createdAt: new Date(now - 10 * 60_000) });
    const fine = await createRequestRow(t.id, { createdAt: new Date(now - 10 * 60_000) });
    const none = await createRequestRow(t.id, { createdAt: new Date(now - 10 * 60_000) });
    const lateDue = new Date(now - 5 * 60_000);
    const fineDue = new Date(now + 50 * 60_000);
    await db().supportRequest.update({ where: { id: late.id }, data: { slaMinutes: 5, slaDueAt: lateDue } });
    await db().supportRequest.update({ where: { id: fine.id }, data: { slaMinutes: 60, slaDueAt: fineDue } });
    await db().supportRequest.update({ where: { id: none.id }, data: { slaMinutes: null, slaDueAt: null } });
    for (const id of [late.id, fine.id, none.id])
      expect((await call(s, "POST", `/support-requests/${id}/accept`, {})).statusCode).toBe(200);
    const detailOf = async (requestId: string) => {
      const sess = await db().supportSession.findFirstOrThrow({ where: { requestId }, select: { id: true } });
      const res = await call(s, "GET", `/sessions/${sess.id}/history`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json<SessionHistoryDetail>();
    };
    expect((await detailOf(late.id)).request).toMatchObject({ slaDueAt: lateDue.toISOString(), slaBreached: true });
    expect((await detailOf(fine.id)).request).toMatchObject({ slaDueAt: fineDue.toISOString(), slaBreached: false });
    expect((await detailOf(none.id)).request).toMatchObject({ slaDueAt: null, slaBreached: null });
    const plain = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" });
    const pr = await call(s, "GET", `/sessions/${plain.id}/history`);
    expect(pr.json<SessionHistoryDetail>().request).toBeNull();
  });
});

describe("AC-258 mesai ve tatil uçları", () => {
  it("AC-258: GET varsayılan (settings.view), PUT settings.edit; '24:00' kabul; geçersiz 400; audit; USER yalnız view → PUT 403", async () => {
    const { t, s } = await tenantWithAdmin();
    const g = (await call(s, "GET", "/settings/business-hours")).json<BusinessHoursView>();
    expect(g).toMatchObject({ enabled: false, timeZone: "Europe/Istanbul", afterHoursMode: "ACCEPT", openNow: true });
    expect(g.week).toHaveLength(7);
    const body = {
      enabled: true,
      timeZone: "America/New_York",
      afterHoursMode: "REJECT",
      week: [[{ from: "00:00", to: "24:00" }], [], [], [], [], [], []],
    };
    const put = await call(s, "PUT", "/settings/business-hours", body);
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<BusinessHoursView>()).toMatchObject({ enabled: true, timeZone: "America/New_York", afterHoursMode: "REJECT" });
    expect(put.json<BusinessHoursView>().week[0]).toEqual([{ from: "00:00", to: "24:00" }]);
    const a = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "settings.business_hours_updated" } });
    expect(a.newValue).toMatchObject({ enabled: true, timeZone: "America/New_York", afterHoursMode: "REJECT" });
    const bad = await call(s, "PUT", "/settings/business-hours", {
      ...body,
      week: [[{ from: "10:00", to: "09:00" }], [], [], [], [], [], []],
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(err(bad).fields ?? {}).some((k) => k.startsWith("week"))).toBe(true);
    expect((await call(s, "PUT", "/settings/business-hours", { ...body, timeZone: "Mars/Olympus" })).statusCode).toBe(400);

    const viewer = await createUser({ tenantId: t.id, role: "USER", perms: { "settings.view": true } });
    const vs = await loginAs(live.app, viewer);
    expect((await call(vs, "GET", "/settings/business-hours")).statusCode).toBe(200);
    expect((await call(vs, "PUT", "/settings/business-hours", body)).statusCode).toBe(403);
    expect((await call(vs, "POST", "/settings/holidays", { day: "2026-12-31", name: "x", openUntil: null })).statusCode).toBe(403);
  });

  it("AC-258: tatil ekle/listele/sil; aynı gün 409; başka tenant 404; TR içe aktarma tekrar edilebilir; listede olmayan yıl 400", async () => {
    const { t, s } = await tenantWithAdmin();
    const add = await call(s, "POST", "/settings/holidays", { day: "2026-12-31", name: "Yıl sonu", openUntil: "13:00" });
    expect(add.statusCode, add.body).toBe(201);
    const h = add.json<HolidayItem>();
    expect(h).toMatchObject({ day: "2026-12-31", name: "Yıl sonu", openUntil: "13:00" });
    const dup = await call(s, "POST", "/settings/holidays", { day: "2026-12-31", name: "Tekrar", openUntil: null });
    expect(dup.statusCode).toBe(409);
    expect(err(dup).code).toBe("CONFLICT");

    const imp = (await call(s, "POST", "/settings/holidays/import-tr", { year: 2026 })).json<HolidayImportResponse>();
    expect(imp).toEqual({ added: TR_HOLIDAYS[2026]?.length, skipped: 0 });
    expect((await call(s, "POST", "/settings/holidays/import-tr", { year: 2026 })).json<HolidayImportResponse>()).toEqual({
      added: 0,
      skipped: TR_HOLIDAYS[2026]?.length,
    });
    expect((await call(s, "POST", "/settings/holidays/import-tr", { year: 2030 })).statusCode).toBe(400);
    const list = (await call(s, "GET", "/settings/holidays?year=2026")).json<HolidayListResponse>();
    expect(list.items).toHaveLength((TR_HOLIDAYS[2026]?.length ?? 0) + 1);
    expect(list.items.find((x) => x.day === "2026-10-28")?.openUntil).toBe("13:00");
    expect((await call(s, "GET", "/settings/holidays?year=2027")).json<HolidayListResponse>().items).toHaveLength(0);
    expect(await db().auditLog.count({ where: { tenantId: t.id, action: "settings.holidays_imported" } })).toBe(2);

    const other = await tenantWithAdmin();
    expect((await call(other.s, "DELETE", `/settings/holidays/${h.id}`)).statusCode).toBe(404);
    expect((await call(s, "DELETE", `/settings/holidays/${h.id}`)).statusCode).toBe(204);
    expect((await call(s, "DELETE", `/settings/holidays/${h.id}`)).statusCode).toBe(404);
    const rm = await db().auditLog.findFirstOrThrow({ where: { entityId: h.id, action: "settings.holiday_removed" } });
    expect(rm.oldValue).toEqual({ day: "2026-12-31", name: "Yıl sonu", openUntil: "13:00" });
  });

  it("S-P18-T12: tatil ≤ 200 sınırı satır kilidi altında — 199 varken eşzamanlı iki ekleme: biri 201, biri 409", async () => {
    const { t, admin, s } = await tenantWithAdmin();
    await db().businessHoliday.createMany({
      data: Array.from({ length: HOLIDAYS_MAX - 1 }, (_, i) => ({
        id: newId(),
        tenantId: t.id,
        day: new Date(Date.UTC(2030, 0, 1 + i)),
        name: `Gün ${i}`,
        createdBy: admin.id,
      })),
    });
    const [a, b] = await Promise.all([
      call(s, "POST", "/settings/holidays", { day: "2031-06-01", name: "A", openUntil: null }),
      call(s, "POST", "/settings/holidays", { day: "2031-06-02", name: "B", openUntil: null }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await db().businessHoliday.count({ where: { tenantId: t.id } })).toBe(HOLIDAYS_MAX);
  });
});

describe("AC-258 mesai dışı talep (sahte saat)", () => {
  let fl: Live;
  const clock = new FakeClock();
  beforeAll(async () => {
    fl = await startLive({ env: PROXY, signaling: { clock } });
  });
  afterAll(() => fl.close());

  /** Bugün + yarın (İstanbul) tatil, diğer günler 00:00–24:00 → şimdi kapalı, açılış öbür gün 00:00 İstanbul. */
  async function closedTenant(mode: "ACCEPT" | "REJECT", sla: number | null = null) {
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const now = clock.now();
    const localDay = (offsetDays: number) => new Date(now + 3 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
    await db().tenantRequestSettings.update({
      where: { tenantId: t.id },
      data: {
        hoursEnabled: true,
        afterHoursMode: mode,
        defaultSlaMinutes: sla,
        businessHours: [0, 1, 2, 3, 4, 5, 6].map(() => [{ from: "00:00", to: "24:00" }]),
      },
    });
    for (const d of [0, 1])
      await db().businessHoliday.create({
        data: { id: newId(), tenantId: t.id, day: new Date(`${localDay(d)}T00:00:00.000Z`), name: "Tatil", createdBy: admin.id },
      });
    const opening = Date.parse(`${localDay(2)}T00:00:00.000Z`) - 3 * 3_600_000;
    return { t, ref, opening };
  }

  it("AC-258: REJECT — 0.12.0 → 409 OUTSIDE_HOURS + nextOpeningAt; 0.11.0 → 429 QUEUE_FULL aynı mesaj, Retry-After yok, hız alarmı beslenmez (S-P18-T6)", async () => {
    clock.t = Date.now();
    const { t, ref, opening } = await closedTenant("REJECT");
    const rc = requestClient(fl.app, fl.base);
    const info = (await rc.tenantInfo(ref, nextIp())).json<TenantRequestInfo>();
    expect(info.businessHours).toEqual({ openNow: false, nextOpeningAt: new Date(opening).toISOString(), afterHoursMode: "REJECT" });

    const modern = await rc.createReq(ref, nextIp(), { version: "0.12.0" });
    expect(modern.statusCode).toBe(409);
    expect(err(modern).code).toBe("OUTSIDE_HOURS");
    expect(err(modern).fields?.nextOpeningAt).toBe(new Date(opening).toISOString());
    expect(err(modern).message).toMatch(/^Mesai dışındayız\. Sonraki açılış: \d{2}\.\d{2}\.\d{4} 00:00 \(GMT\+3\)$/);

    const legacy = await rc.createReq(ref, nextIp(), { version: "0.11.0" });
    expect(legacy.statusCode).toBe(429);
    expect(err(legacy).code).toBe("QUEUE_FULL");
    expect(err(legacy).message).toBe(err(modern).message);
    expect(legacy.headers["retry-after"]).toBeUndefined();
    expect(await db().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);
    const metrics = fl.app.metrics.render();
    expect(metrics).toContain('rs_requests_outside_hours_total{mode="REJECT",legacy="true"} 1');
    expect(metrics).toContain('rs_requests_outside_hours_total{mode="REJECT",legacy="false"} 1');
    expect(metrics).not.toMatch(/rs_request_rate_limited_total\{bucket="tenant"\}/);
    expect(fl.app.requests.d.limits.tenantAll.count(t.id)).toBe(0); // kova tüketilmez
  });

  it("S-P18-T7: outside_hours audit'i tenant başına dakikada 1 satır (count ile); her deneme metrikte", async () => {
    clock.t = Date.now();
    const { t, ref } = await closedTenant("REJECT");
    const rc = requestClient(fl.app, fl.base);
    for (let i = 0; i < 3; i++) expect((await rc.createReq(ref, nextIp(), { version: "0.12.0" })).statusCode).toBe(409);
    const rows = () =>
      db().auditLog.findMany({ where: { tenantId: t.id, action: "request.created", result: "fail" }, orderBy: { id: "asc" } });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]?.newValue).toMatchObject({ reason: "outside_hours", count: 1 });
    clock.t += 60_000;
    expect((await rc.createReq(ref, nextIp(), { version: "0.12.0" })).statusCode).toBe(409);
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all[1]?.newValue).toMatchObject({ reason: "outside_hours", count: 3 }); // bastırılan 2 + bu
  });

  it("S-P18-T6: bindingKey yolunda da mesai reddi (ref ile aynı sırada)", async () => {
    clock.t = Date.now();
    const { t, ref } = await closedTenant("REJECT");
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const done = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" });
    const key = `rsb_${newSecretToken()}`;
    await db().deviceBinding.create({
      data: {
        id: newId(),
        tenantId: t.id,
        keyHash: sha256Hex(key),
        clientVersion: "0.12.0",
        firstSessionId: done.id,
        lastSessionId: done.id,
        lastUsedAt: new Date(clock.now()),
      },
    });
    const rc = requestClient(fl.app, fl.base);
    const res = await rc.createReq(ref, nextIp(), { version: "0.12.0", extra: { ref: undefined, bindingKey: key } });
    expect(res.statusCode, res.body).toBe(409);
    expect(err(res).code).toBe("OUTSIDE_HOURS");
  });

  it("AC-258: ACCEPT — after_hours=1, SLA açılıştan başlar; panel request.new alanları; açık an yoksa due NULL", async () => {
    clock.t = Date.now();
    const { t, ref, opening } = await closedTenant("ACCEPT", 30);
    const rc = requestClient(fl.app, fl.base);
    const res = await rc.createReq(ref, nextIp(), { version: "0.12.0" });
    expect(res.statusCode, res.body).toBe(201);
    const row = await db().supportRequest.findUniqueOrThrow({ where: { id: res.json<{ requestId: string }>().requestId } });
    expect(row.afterHours).toBe(true);
    expect(row.slaDueAt?.toISOString()).toBe(new Date(opening + 30 * 60_000).toISOString());
    expect(fl.app.metrics.render()).toContain('rs_requests_outside_hours_total{mode="ACCEPT",legacy="false"}');

    // takvim açık ama hiç açık an yok (DB'de mümkün) → SLA NULL, talep alınır
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { businessHours: [[], [], [], [], [], [], []] } });
    fl.app.requests.calendars.invalidate(t.id);
    const n = await rc.createReq(ref, nextIp(), { version: "0.12.0" });
    expect(n.statusCode, n.body).toBe(201);
    const nr = await db().supportRequest.findUniqueOrThrow({ where: { id: n.json<{ requestId: string }>().requestId } });
    expect(nr).toMatchObject({ afterHours: true, slaMinutes: 30, slaDueAt: null });
  });

  it("S-P18-T12: geçersiz saat dilimi → Europe/Istanbul + metrik; mesai kapalı sayılmaz (REJECT'te bile alınır), SLA NULL", async () => {
    clock.t = Date.now();
    const { t, ref } = await closedTenant("REJECT", 30);
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { timeZone: "Mars/Olympus" } });
    fl.app.requests.calendars.invalidate(t.id);
    const res = await requestClient(fl.app, fl.base).createReq(ref, nextIp(), { version: "0.12.0" });
    expect(res.statusCode, res.body).toBe(201);
    const row = await db().supportRequest.findUniqueOrThrow({ where: { id: res.json<{ requestId: string }>().requestId } });
    expect(row).toMatchObject({ afterHours: false, slaDueAt: null });
    expect(fl.app.metrics.render()).toContain(`rs_calendar_fallback_total{tenant="${t.id}"}`);
  });

  it("AC-258: ayar yazımı önbelleği geçersiz kılar — PUT sonrası ilk talep yeni kuralla", async () => {
    clock.t = Date.now();
    const { t, ref } = await closedTenant("REJECT");
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginAs(fl.app, admin);
    const rc = requestClient(fl.app, fl.base);
    expect((await rc.createReq(ref, nextIp(), { version: "0.12.0" })).statusCode).toBe(409);
    const put = await fl.app.inject({
      method: "PUT",
      url: "/api/v1/settings/business-hours",
      headers: s.headers,
      payload: { enabled: false, timeZone: "Europe/Istanbul", afterHoursMode: "REJECT", week: [[], [], [], [], [], [], []] },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await rc.createReq(ref, nextIp(), { version: "0.12.0" })).statusCode).toBe(201);
  });
});
