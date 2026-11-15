// P11 audit ekranı (AC-76, AC-124, AC-69; G-15/G-16; B-P10 SMTP koşulu). Gerçek MySQL; her test benzersiz action öneki.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, makeApp, testDb, testFixtureDb, type Session, type TestUser } from "../helpers/app.ts";
import { newId } from "../../src/lib/ids.ts";

let app: FastifyInstance;
let tA: string;
let tB: string;
let adminA: TestUser;
let adminB: TestUser;
let superAdmin: TestUser;
let sAdminA: Session;
let sSuper: Session;
const P = `p11${newId().toLowerCase().slice(-10)}`; // bu dosyanın action öneki

beforeAll(async () => {
  app = makeApp();
  await app.ready();
  tA = (await createTenant()).id;
  tB = (await createTenant()).id;
  adminA = await createUser({ tenantId: tA, role: "ADMIN" });
  adminB = await createUser({ tenantId: tB, role: "ADMIN" });
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  sAdminA = await loginAs(app, adminA);
  sSuper = await loginAs(app, superAdmin);
});
afterAll(async () => {
  await app.close();
  await testFixtureDb().$disconnect();
});

type Row = {
  tenantId?: string | null;
  userId?: string | null;
  username?: string | null;
  action: string;
  result?: string;
  newValue?: object;
  oldValue?: object;
  createdAt?: Date;
};
async function insert(r: Row): Promise<string> {
  // P13a: app'in created_at'i DB saatine zorlanır → geçmiş tarihli fikstür migrator bağlantısıyla.
  const row = await (r.createdAt ? testFixtureDb() : testDb()).auditLog.create({
    data: {
      tenantId: r.tenantId ?? null,
      userId: r.userId ?? null,
      username: r.username ?? null,
      action: r.action,
      entity: "p11_test",
      result: r.result ?? "success",
      ...(r.newValue ? { newValue: r.newValue } : {}),
      ...(r.oldValue ? { oldValue: r.oldValue } : {}),
      ipAddress: "203.0.113.5",
      userAgent: "vitest",
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    },
    select: { id: true },
  });
  return row.id.toString();
}

const list = (s: Session, qs: string) => app.inject({ method: "GET", url: `/api/v1/audit?${qs}`, headers: s.headers });
type Item = {
  id: string;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  userFullName: string | null;
  avatarUrl: null;
  newValue: unknown;
  oldValue: unknown;
  result: string;
};
const itemsOf = (body: string): Item[] => (JSON.parse(body) as { items: Item[] }).items;

describe("GET /audit (AC-76)", () => {
  it("AC-76/AC-69: Admin yalnız kendi tenant'ını görür; tenantId parametresi yok sayılır", async () => {
    const act = `${P}.scope`;
    const a = await insert({ tenantId: tA, action: act, userId: adminA.id, username: adminA.email });
    const b = await insert({ tenantId: tB, action: act });
    const sys = await insert({ tenantId: null, action: act });
    const res = await list(sAdminA, `action=${act}&tenantId=${tB}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const ids = itemsOf(res.body).map((i) => i.id);
    expect(ids).toEqual([a]);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(sys);
    const it0 = itemsOf(res.body)[0];
    expect(it0).toMatchObject({ tenantId: tA, userFullName: "Test Kullanıcı", avatarUrl: null, result: "success" });
    expect(it0?.tenantName).toMatch(/^Firma /);
  });

  it("AC-76: firma seçmemiş Super Admin tüm tenant'lar + sistem (NULL); tenantId filtresi; geçişte yalnız o tenant", async () => {
    const act = `${P}.super`;
    const a = await insert({ tenantId: tA, action: act });
    const b = await insert({ tenantId: tB, action: act });
    const sys = await insert({ tenantId: null, action: act });
    expect(
      itemsOf((await list(sSuper, `action=${act}`)).body)
        .map((i) => i.id)
        .sort(),
    ).toEqual([a, b, sys].sort());
    expect(itemsOf((await list(sSuper, `action=${act}&tenantId=${tB}`)).body).map((i) => i.id)).toEqual([b]);
    const s2 = await loginAs(app, superAdmin);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/admin/switch-tenant", headers: s2.headers, payload: { tenantId: tA } })).statusCode,
    ).toBe(200);
    expect(itemsOf((await list(s2, `action=${act}&tenantId=${tB}`)).body).map((i) => i.id)).toEqual([a]);
  });

  it("AC-76: filtreler — kullanıcı, tam işlem, önek (x.*), sonuç; boş sonuç", async () => {
    const pre = `${P}.filt`;
    const u1 = await insert({ tenantId: tA, action: `${pre}.login`, userId: adminA.id, result: "fail" });
    const u2 = await insert({ tenantId: tA, action: `${pre}.logout`, userId: adminB.id });
    await insert({ tenantId: tA, action: `${pre}x.other` }); // önek "pre." ile eşleşmemeli
    const ids = async (qs: string) =>
      itemsOf((await list(sAdminA, qs)).body)
        .map((i) => i.id)
        .sort();
    expect(await ids(`action=${pre}.*`)).toEqual([u1, u2].sort());
    expect(await ids(`action=${pre}.login`)).toEqual([u1]);
    expect(await ids(`action=${pre}.*&userId=${adminA.id}`)).toEqual([u1]);
    expect(await ids(`action=${pre}.*&result=fail`)).toEqual([u1]);
    const empty = await list(sAdminA, `action=${P}.yok`);
    expect(JSON.parse(empty.body)).toEqual({ items: [], nextCursor: null });
  });

  it("AC-76: keyset sayfalama — 50 + imleç, sıra created_at desc, id desc, tekrar/atlama yok", async () => {
    const act = `${P}.page`;
    const base = Date.now() - 60_000;
    const made: string[] = [];
    for (let i = 0; i < 53; i++)
      made.push(await insert({ tenantId: tA, action: act, createdAt: new Date(base + Math.floor(i / 2) * 1000) })); // eş zamanlı çiftler
    const r1 = JSON.parse((await list(sAdminA, `action=${act}`)).body) as { items: Item[]; nextCursor: string | null };
    expect(r1.items).toHaveLength(50);
    expect(r1.nextCursor).toEqual(expect.any(String));
    const r2 = JSON.parse((await list(sAdminA, `action=${act}&cursor=${r1.nextCursor}`)).body) as {
      items: Item[];
      nextCursor: string | null;
    };
    expect(r2.items).toHaveLength(3);
    expect(r2.nextCursor).toBeNull();
    const all = [...r1.items, ...r2.items].map((i) => i.id);
    expect(new Set(all).size).toBe(53);
    expect(all).toEqual([...made].sort((x, y) => Number(BigInt(y) - BigInt(x)))); // aynı saniyede id desc
  });

  it("AC-76: tarih — varsayılan son 30 gün; aralık > 731 gün, ters aralık ve bozuk imleç 400", async () => {
    const act = `${P}.range`;
    const old = await insert({ tenantId: tA, action: act, createdAt: new Date(Date.now() - 40 * 86_400_000) });
    const fresh = await insert({ tenantId: tA, action: act });
    expect(itemsOf((await list(sAdminA, `action=${act}`)).body).map((i) => i.id)).toEqual([fresh]);
    const day = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10);
    expect(itemsOf((await list(sAdminA, `action=${act}&from=${day(45 * 86_400_000)}`)).body).map((i) => i.id)).toEqual([fresh, old]);
    const long = await list(sAdminA, "from=2023-01-01&to=2025-06-01");
    expect(long.statusCode).toBe(400);
    expect(JSON.parse(long.body).error.fields.from).toMatch(/731/);
    expect((await list(sAdminA, "from=2026-02-02&to=2026-02-01")).statusCode).toBe(400);
    expect((await list(sAdminA, "cursor=bm90LWEtY3Vyc29y")).statusCode).toBe(400);
    // B-P11-5: imleç id'si BIGINT üst sınırını aşarsa 500 değil 400 fields.cursor
    const over = await list(sAdminA, `cursor=${Buffer.from("1762900000000.9223372036854775808").toString("base64url")}`);
    expect(over.statusCode).toBe(400);
    expect(JSON.parse(over.body).error.fields.cursor).toBeDefined();
    expect((await list(sAdminA, "page=2")).statusCode).toBe(400);
  });

  it("AC-76/AC-75 (G-15): okumada maske; mail.*/settings.*.test yalnız reason sınıfı — ham hata/yanıt kodu/banner yok", async () => {
    const leak = "554 5.7.1 <mx.example ESMTP Postfix> Relay denied";
    await insert({ tenantId: tA, action: `${P}.mask`, newValue: { password: "DuzSifre-1", token: "tok", name: "Ali" } });
    await insert({
      tenantId: tA,
      action: "mail.sent",
      newValue: { kind: P, recipient: "a***@x.test", reason: leak, responseCode: 554, response: leak, result: "fail" },
    });
    await insert({
      tenantId: tA,
      action: "settings.smtp.test",
      newValue: { recipient: "b***@x.test", reason: "auth", banner: leak, result: "fail" },
    });
    const masked = await list(sAdminA, `action=${P}.mask`);
    expect(itemsOf(masked.body)[0]?.newValue).toEqual({ password: "***", token: "***", name: "Ali" });
    expect(masked.body).not.toContain("DuzSifre-1");
    const mail = await list(sAdminA, "action=mail.*");
    expect(mail.body).not.toContain("Relay denied");
    expect(mail.body).not.toContain("554");
    expect(itemsOf(mail.body).find((i) => (i.newValue as { kind?: string }).kind === P)?.newValue).toEqual({
      kind: P,
      recipient: "a***@x.test",
      reason: "other",
      result: "fail",
    });
    const test = await list(sAdminA, "action=settings.smtp.test");
    expect(test.body).not.toContain("ESMTP");
    expect(itemsOf(test.body)[0]?.newValue).toEqual({ recipient: "b***@x.test", reason: "auth", result: "fail" });
  });

  it("AC-76: yetki — audit.view yoksa 403; USER audit.view ile yalnız kendi tenant'ı; oturumsuz 401", async () => {
    const act = `${P}.perm`;
    const mine = await insert({ tenantId: tB, action: act });
    await insert({ tenantId: tA, action: act });
    const plain = await loginAs(app, await createUser({ tenantId: tB }));
    expect((await list(plain, "")).statusCode).toBe(403);
    const viewer = await loginAs(app, await createUser({ tenantId: tB, perms: { "audit.view": true } }));
    expect(itemsOf((await list(viewer, `action=${act}`)).body).map((i) => i.id)).toEqual([mine]);
    expect((await app.inject({ method: "GET", url: "/api/v1/audit" })).statusCode).toBe(401);
  });
});

describe("audit değiştirilemez (AC-76, AC-123)", () => {
  it("AC-76: /audit, /audit/:id, /audit/export.csv için POST/PUT/PATCH/DELETE → 405 METHOD_NOT_ALLOWED + Allow; kayıt değişmez", async () => {
    const id = await insert({ tenantId: tA, action: `${P}.ro` });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      for (const [url, allow] of [
        ["/api/v1/audit", "GET, HEAD"],
        [`/api/v1/audit/${id}`, ""],
        ["/api/v1/audit/export.csv", "GET, HEAD"],
      ] as const) {
        const res = await app.inject({ method, url, headers: sAdminA.headers, payload: { action: "x" } });
        expect(res.statusCode, `${method} ${url}`).toBe(405);
        expect(res.headers.allow, `${method} ${url}`).toBe(allow);
        expect(JSON.parse(res.body).error.code).toBe("METHOD_NOT_ALLOWED");
      }
    }
    const still = await testDb().auditLog.findUniqueOrThrow({ where: { id: BigInt(id) }, select: { action: true } });
    expect(still.action).toBe(`${P}.ro`);
  });
});

describe("GET /audit/export.csv (AC-124)", () => {
  it("AC-124: BOM, ';', formül kaçışı; dışa aktarım audit'e yazılır (filtre özeti + satır)", async () => {
    const act = `${P}.csv`;
    await insert({ tenantId: tA, action: act, username: '=HYPERLINK("http://x")', newValue: { note: "@SUM(A1)" } });
    await insert({ tenantId: tA, action: act, username: "+90", userId: adminA.id });
    const res = await app.inject({ method: "GET", url: `/api/v1/audit/export.csv?action=${act}`, headers: sAdminA.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="audit-\d{8}-\d{4}\.csv"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const lines = res.body.split("\r\n");
    expect(lines[0]).toBe("\uFEFFTarih;Kullanıcı;Ad Soyad;İşlem;Varlık;Kayıt;Sonuç;IP adresi;Tarayıcı;Eski değer;Yeni değer");
    expect(lines).toHaveLength(4); // başlık + 2 + son boş
    expect(res.body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(res.body).toContain(";'+90;Test Kullanıcı;");
    expect(res.body).toContain(`"{""note"":""@SUM(A1)""}"`);
    const exp = await testDb().auditLog.findFirstOrThrow({
      where: { action: "audit.exported", userId: adminA.id },
      orderBy: { id: "desc" },
    });
    expect(exp).toMatchObject({ tenantId: tA, entity: "audit_logs", result: "success" });
    expect(exp.newValue).toMatchObject({ action: act, rows: 2, tenantId: null, userId: null, result: null });
  });

  it("AC-124: Super Admin (tüm tenant) CSV'sinde Firma sütunu; audit.export yoksa 403; 5/dk sınırı (6. → 429)", async () => {
    const act = `${P}.csv2`;
    await insert({ tenantId: tB, action: act });
    const res = await app.inject({ method: "GET", url: `/api/v1/audit/export.csv?action=${act}`, headers: sSuper.headers });
    expect(res.body.split("\r\n")[0]).toBe(
      "\uFEFFTarih;Firma;Kullanıcı;Ad Soyad;İşlem;Varlık;Kayıt;Sonuç;IP adresi;Tarayıcı;Eski değer;Yeni değer",
    );
    const viewer = await loginAs(app, await createUser({ tenantId: tB, perms: { "audit.view": true } }));
    expect((await app.inject({ method: "GET", url: "/api/v1/audit/export.csv", headers: viewer.headers })).statusCode).toBe(403);
    const s = await loginAs(app, await createUser({ tenantId: tB, role: "ADMIN" }));
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push((await app.inject({ method: "GET", url: `/api/v1/audit/export.csv?action=${act}`, headers: s.headers })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
