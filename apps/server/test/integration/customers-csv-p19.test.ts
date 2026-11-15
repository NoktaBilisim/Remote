// P19 J4 müşteri CSV dışa/içe aktarma — gerçek MySQL + uygulama. AC-263 (`;`+BOM+formül kaçışı, gidiş-dönüş, önizleme
// sayıları, satır hata raporu, atla/güncelle, benzersiz yeni ref, 5 000 satır süresi, audit satır + özet); S-P19-4
// (previewId kullanıcı+tenant'a bağlı), S-P19-8 (5 001 satır 413, kapanmamış tırnak), S-P19-14 (yetki bileşimi).
import { CUSTOMER_CSV_COLUMNS, type ImportPreview, type ImportResult } from "@remote/contracts/api/customers";
import { csvRow } from "@remote/contracts/csv";
import { afterEach, describe, expect, it } from "vitest";
import { createTenant, testDb, type Session } from "../helpers/app.ts";
import { login } from "../helpers/auth.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";

const C = "/api/v1/customers";
const BOM = "\uFEFF";
type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
async function boot(): Promise<Live> {
  live = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
  return live;
}

async function admin(l: Live) {
  const t = await createTenant();
  return { tenantId: t.id, ...(await login(l.app, t.id, { role: "ADMIN" })) };
}

function multipart(data: Buffer | string) {
  const boundary = `----rs${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.csv"\r\nContent-Type: text/csv\r\n\r\n`,
  );
  const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return {
    payload: Buffer.concat([head, body, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    boundary,
  };
}
const preview = (l: Live, s: Session, csv: Buffer | string) => {
  const m = multipart(csv);
  return l.app.inject({
    method: "POST",
    url: `${C}/import/preview`,
    headers: { ...s.headers, "content-type": `multipart/form-data; boundary=${m.boundary}` },
    payload: m.payload,
  });
};
const commit = (l: Live, s: Session, previewId: string, onConflict: "skip" | "update") =>
  l.app.inject({ method: "POST", url: `${C}/import/commit`, headers: s.headers, payload: { previewId, onConflict } });
const exportCsv = (l: Live, s: Session, q = "") => l.app.inject({ method: "GET", url: `${C}/export.csv${q}`, headers: s.headers });

/** Pasif (+ isteğe bağlı anonim) müşteri: CHECK `customers_passive_chk` için durum + passiveAt birlikte. */
async function passiveRow(tenantId: string, name: string, anonymized = false) {
  const c = await createCustomerRow(tenantId, { name });
  await testDb().customer.update({
    where: { id: c.id },
    data: { status: "PASSIVE", passiveAt: new Date(), ...(anonymized ? { anonymizedAt: new Date() } : {}) },
  });
  return c;
}
const csvOf = (rows: string[][]) => BOM + csvRow(CUSTOMER_CSV_COLUMNS) + rows.map((r) => csvRow(r)).join("");
async function previewOk(l: Live, s: Session, csv: string): Promise<ImportPreview> {
  const r = await preview(l, s, csv);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<ImportPreview>();
}
async function commitOk(l: Live, s: Session, id: string, mode: "skip" | "update"): Promise<ImportResult> {
  const r = await commit(l, s, id, mode);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<ImportResult>();
}

describe("AC-263 dışa aktarma", () => {
  it("AC-263: `;` + BOM + CRLF + formül kaçışı, ref yok, Content-Disposition, audit customer.exported", async () => {
    const l = await boot();
    const a = await admin(l);
    const create = await l.app.inject({
      method: "POST",
      url: C,
      headers: a.s.headers,
      payload: { name: "=HYPERLINK(1)", phone: "+905321112233", note: "a;b\nc", defaultPriority: "HIGH", slaMinutes: 30 },
    });
    expect(create.statusCode, create.body).toBe(201);
    const r = await exportCsv(l, a.s);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="musteriler-\d{8}\.csv"$/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body.startsWith(BOM + "Ad;Yetkili kişi;Telefon;E-posta;Not;Dosya etiketi;Varsayılan öncelik;SLA (dk);Durum\r\n")).toBe(true);
    expect(r.body).toContain(`'=HYPERLINK(1);;'+905321112233;;"a;b\nc";HYPERLINK1;Yüksek;30;Aktif\r\n`);
    const ref = (await testDb().customer.findFirstOrThrow({ where: { tenantId: a.tenantId } })).requestRef;
    expect(r.body).not.toContain(ref);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: a.tenantId, action: "customer.exported" } });
    expect(audit.newValue).toEqual({ count: 1, status: "all" });
  });

  it("AC-263: customers.export yoksa 403; 11. istek/dk 429", async () => {
    const l = await boot();
    const t = await createTenant();
    const u = await login(l.app, t.id, { role: "USER", perms: { "customers.view": true } });
    expect((await exportCsv(l, u.s)).statusCode).toBe(403);
    const a = await login(l.app, t.id, { role: "ADMIN" });
    for (let i = 0; i < 10; i++) expect((await exportCsv(l, a.s)).statusCode).toBe(200);
    expect((await exportCsv(l, a.s)).statusCode).toBe(429);
  });

  it("AC-263: anonimleşmiş müşterinin kişisel hücreleri boş; status filtresi", async () => {
    const l = await boot();
    const a = await admin(l);
    await passiveRow(a.tenantId, "Anonim Firma", true);
    await createCustomerRow(a.tenantId, { name: "Aktif Firma", phone: "+905321112244" });
    const passive = (await exportCsv(l, a.s, "?status=passive")).body;
    expect(passive).toContain("Anonim Firma;;;;;AnonimFirma;;;Pasif\r\n");
    expect(passive).not.toContain("Aktif Firma");
  });
});

describe("AC-263 içe aktarma önizleme", () => {
  it("AC-263: önizleme sayıları, satır hata raporu (fiziksel satır no), dosyada tekrar, uyarı, başka tenant'taki ad create", async () => {
    const l = await boot();
    const a = await admin(l);
    await createCustomerRow(a.tenantId, { name: "Var Olan Ltd" });
    const other = await createTenant();
    await createCustomerRow(other.id, { name: "Yeni Bir" });
    const csv =
      BOM +
      "ad;TELEFON;e-posta;Not;Fazla\r\n" +
      'Yeni Bir;05321112233;;"iki\r\nsatır";x\r\n' + // 2-3
      "var olan LTD;;;;\r\n" + // 4 conflict
      "X;abc;kötü;;\r\n" + // 5 hata: ad, telefon, e-posta
      "yeni bir;;;;\r\n" + // 6 tekrar
      '"kapanmadı;;;;\r\n';
    const p = await previewOk(l, a.s, csv);
    expect(p.total).toBe(5);
    expect(p.counts).toEqual({ create: 1, conflict: 1, error: 3 });
    expect(p.warnings).toEqual([expect.stringContaining("Fazla")]);
    expect(p.rows.map((r) => [r.line, r.kind])).toEqual([
      [2, "create"],
      [4, "conflict"],
      [5, "error"],
      [6, "error"],
      [7, "error"],
    ]);
    expect(p.rows[0]?.phone).toBe("+905321112233");
    expect(p.errors.filter((e) => e.line === 5).map((e) => e.column)).toEqual(["Ad", "Telefon", "E-posta"]);
    expect(p.errors.find((e) => e.line === 6)?.message).toContain("2. satırda");
    expect(p.errors.find((e) => e.line === 7)?.message).toBe("Kapanmamış tırnak işareti");
    expect(p.previewId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("AC-263 S-P19-8: UTF-8 olmayan dosya 400; Ad sütunu yok 400; 5 001 satır 413; boş 400; dosyasız 400", async () => {
    const l = await boot();
    const a = await admin(l);
    const latin = await preview(l, a.s, Buffer.from([0x41, 0x64, 0x0d, 0x0a, 0xfe, 0x41]));
    expect(latin.statusCode).toBe(400);
    expect(latin.json<ErrBody>().error.message).toContain("UTF-8");
    expect((await preview(l, a.s, "Telefon\r\n1\r\n")).statusCode).toBe(400);
    expect((await preview(l, a.s, "Ad\r\n")).statusCode).toBe(400);
    const big = await preview(l, a.s, `Ad\r\n${Array.from({ length: 5001 }, (_, i) => `F${i}`).join("\r\n")}`);
    expect(big.statusCode).toBe(413);
    expect(big.json<ErrBody>().error.message).toBe("En çok 5.000 satır");
    const none = await l.app.inject({ method: "POST", url: `${C}/import/preview`, headers: a.s.headers, payload: {} });
    expect(none.statusCode).toBe(400);
  });

  it("AC-263: önizleme 10/sa/kullanıcı (11. 429)", async () => {
    const l = await boot();
    const a = await admin(l);
    for (let i = 0; i < 10; i++) expect((await preview(l, a.s, "Ad\r\nFirma A\r\n")).statusCode).toBe(200);
    expect((await preview(l, a.s, "Ad\r\nFirma A\r\n")).statusCode).toBe(429);
  });
});

describe("AC-263 S-P19-14 yetki bileşimi", () => {
  it("AC-263 S-P19-14: import açık + create kapalı → önizleme ve uygulama 403; view kapalı → önizleme 403; update + edit kapalı → 403", async () => {
    const l = await boot();
    const t = await createTenant();
    const noCreate = await login(l.app, t.id, { role: "USER", perms: { "customers.view": true, "customers.import": true } });
    expect((await preview(l, noCreate.s, "Ad\r\nA Firma\r\n")).statusCode).toBe(403);
    expect((await commit(l, noCreate.s, "a".repeat(22), "skip")).statusCode).toBe(403);
    const noView = await login(l.app, t.id, { role: "USER", perms: { "customers.create": true, "customers.import": true } });
    expect((await preview(l, noView.s, "Ad\r\nA Firma\r\n")).statusCode).toBe(403);
    const noImport = await login(l.app, t.id, { role: "USER", perms: { "customers.view": true, "customers.create": true } });
    expect((await preview(l, noImport.s, "Ad\r\nA Firma\r\n")).statusCode).toBe(403);
    const noEdit = await login(l.app, t.id, {
      role: "USER",
      perms: { "customers.view": true, "customers.create": true, "customers.import": true },
    });
    const p = await previewOk(l, noEdit.s, "Ad\r\nA Firma\r\n");
    expect((await commit(l, noEdit.s, p.previewId, "update")).statusCode).toBe(403);
    // önizleme tüketilmedi: skip ile uygulanabilir
    expect((await commitOk(l, noEdit.s, p.previewId, "skip")).created).toBe(1);
  });
});

describe("AC-263 içe aktarma uygulama", () => {
  it("AC-263: atla — yeni müşterilere benzersiz yeni ref (request_refs), audit satır + özet; previewId tek kullanımlık (428)", async () => {
    const l = await boot();
    const a = await admin(l);
    await createCustomerRow(a.tenantId, { name: "Var Olan" });
    const p = await previewOk(
      l,
      a.s,
      csvOf([
        ["Bir Ltd", "Ali", "05321112233", "a@b.co", "", "", "Düşük", "60", "Pasif"],
        ["İki Ltd", "", "", "", "", "IkiX", "", "", ""],
        ["var olan", "", "", "", "", "", "", "", ""],
      ]),
    );
    const res = await commitOk(l, a.s, p.previewId, "skip");
    expect(res).toEqual({ total: 3, created: 2, updated: 0, skipped: 1, failed: 0 });
    const rows = await testDb().customer.findMany({ where: { tenantId: a.tenantId, name: { in: ["Bir Ltd", "İki Ltd"] } } });
    expect(rows.map((r) => r.status)).toEqual(["ACTIVE", "ACTIVE"]); // Durum yok sayılır
    const bir = rows.find((r) => r.name === "Bir Ltd");
    expect(bir).toMatchObject({ phone: "+905321112233", contactName: "Ali", defaultPriority: "LOW", slaMinutes: 60, fileLabel: "BirLtd" });
    expect(rows.find((r) => r.name === "İki Ltd")?.fileLabel).toBe("IkiX");
    const refs = await testDb().requestRef.findMany({ where: { customerId: { in: rows.map((r) => r.id) } } });
    expect(new Set(refs.map((r) => r.ref))).toEqual(new Set(rows.map((r) => r.requestRef)));
    expect(new Set(rows.map((r) => r.requestRef)).size).toBe(2);
    const created = await testDb().auditLog.findMany({ where: { tenantId: a.tenantId, action: "customer.created" } });
    expect(created).toHaveLength(2);
    expect(created[0]?.newValue).toMatchObject({ source: "import" });
    expect(JSON.stringify(created.map((x) => x.newValue))).not.toContain("5321112233");
    const summary = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: a.tenantId, action: "customer.imported" } });
    expect(summary.newValue).toEqual({ total: 3, created: 2, updated: 0, skipped: 1, failed: 0, onConflict: "skip" });
    const again = await commit(l, a.s, p.previewId, "skip");
    expect(again.statusCode).toBe(428);
    expect(again.json<ErrBody>().error.code).toBe("PREVIEW_REQUIRED");
  });

  it("AC-263: güncelle — yalnız alanlar (ref/durum değişmez), anonim atlanır, audit customer.updated source import", async () => {
    const l = await boot();
    const a = await admin(l);
    const c = await passiveRow(a.tenantId, "Güncel Firma");
    const anon = await passiveRow(a.tenantId, "Anon Firma", true);
    const p = await previewOk(l, a.s, "Ad;Telefon;Not\r\nGÜNCEL firma;0532 111 22 55;yeni not\r\nAnon Firma;05321112266;x\r\n");
    expect(p.counts).toEqual({ create: 0, conflict: 2, error: 0 });
    const res = await commitOk(l, a.s, p.previewId, "update");
    expect(res).toEqual({ total: 2, created: 0, updated: 1, skipped: 1, failed: 0 });
    const after = await testDb().customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({
      name: "GÜNCEL firma",
      phone: "+905321112255",
      note: "yeni not",
      status: "PASSIVE",
      requestRef: c.requestRef,
    });
    expect((await testDb().customer.findUniqueOrThrow({ where: { id: anon.id } })).phone).toBeNull();
    const upd = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "customer.updated" } });
    expect(upd.newValue).toMatchObject({ source: "import", changed: ["name", "phone", "note"] });
  });

  it("AC-263: gidiş-dönüş — dışa aktarılan dosya içe aktarılınca (güncelle) değişiklik yok; başka tenant'a aynı alanlarla eklenir", async () => {
    const l = await boot();
    const a = await admin(l);
    for (const body of [
      { name: "=Formül Ltd", phone: "+905321112233", email: "x@y.co", note: 'çok\nsatır; "tırnak"', contactName: "@Ayşe" },
      { name: "Sade", defaultPriority: "NORMAL", slaMinutes: 15, fileLabel: "SadeX" },
    ])
      expect((await l.app.inject({ method: "POST", url: C, headers: a.s.headers, payload: body })).statusCode).toBe(201);
    const csv = (await exportCsv(l, a.s)).body;
    const p = await previewOk(l, a.s, csv);
    expect(p.counts).toEqual({ create: 0, conflict: 2, error: 0 });
    expect(await commitOk(l, a.s, p.previewId, "update")).toEqual({ total: 2, created: 0, updated: 0, skipped: 2, failed: 0 });
    const b = await admin(l);
    const pb = await previewOk(l, b.s, csv);
    expect((await commitOk(l, b.s, pb.previewId, "skip")).created).toBe(2);
    const pick = (
      rows: {
        name: string;
        contactName: string | null;
        phone: string | null;
        email: string | null;
        note: string | null;
        fileLabel: string;
        defaultPriority: string | null;
        slaMinutes: number | null;
      }[],
    ) =>
      rows
        .map(({ name, contactName, phone, email, note, fileLabel, defaultPriority, slaMinutes }) => ({
          name,
          contactName,
          phone,
          email,
          note,
          fileLabel,
          defaultPriority,
          slaMinutes,
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
    expect(pick(await testDb().customer.findMany({ where: { tenantId: b.tenantId } }))).toEqual(
      pick(await testDb().customer.findMany({ where: { tenantId: a.tenantId } })),
    );
    const lines = (body: string) => body.split("\r\n").sort();
    expect(lines((await exportCsv(l, b.s)).body)).toEqual(lines(csv));
  });

  it("AC-263 S-P19-4: başka kullanıcının / başka tenant'ın previewId'si 428; eşzamanlı ikinci uygulama 409", async () => {
    const l = await boot();
    const a = await admin(l);
    const p = await previewOk(l, a.s, "Ad\r\nTek Firma\r\n");
    const other = await login(l.app, a.tenantId, { role: "ADMIN" });
    expect((await commit(l, other.s, p.previewId, "skip")).statusCode).toBe(428);
    const b = await admin(l);
    expect((await commit(l, b.s, p.previewId, "skip")).statusCode).toBe(428);
    // aynı tenant'ta iki önizleme; eşzamanlı uygulamada biri 409
    const big = `Ad\r\n${Array.from({ length: 600 }, (_, i) => `Eş Firma ${i}`).join("\r\n")}`;
    const p1 = await previewOk(l, a.s, big);
    const p2 = await previewOk(l, other.s, `Ad\r\n${Array.from({ length: 600 }, (_, i) => `Başka Firma ${i}`).join("\r\n")}`);
    const [r1, r2] = await Promise.all([commit(l, a.s, p1.previewId, "skip"), commit(l, other.s, p2.previewId, "skip")]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.statusCode === 409)?.json<ErrBody>().error.message).toBe("Başka bir içe aktarma sürüyor");
  });

  it("AC-263: 5 000 satır önizleme + uygulama ≤ 30 sn (yerel ölçüm)", async () => {
    const l = await boot();
    const a = await admin(l);
    const csv = csvOf(
      Array.from({ length: 5000 }, (_, i) => [
        `Toplu Firma ${i}`,
        `Kişi ${i}`,
        `0532${String(1000000 + i)}`,
        `k${i}@ornek.co`,
        "",
        "",
        "",
        "",
        "",
      ]),
    );
    const t0 = performance.now();
    const p = await previewOk(l, a.s, csv);
    expect(p.counts.create).toBe(5000);
    const res = await commitOk(l, a.s, p.previewId, "skip");
    const ms = performance.now() - t0;
    expect(res.created).toBe(5000);
    expect(await testDb().requestRef.count({ where: { tenantId: a.tenantId, customerId: { not: null } } })).toBe(5000);
    expect(ms).toBeLessThan(30_000);
  });
});
