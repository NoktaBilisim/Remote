// P8 test-operatoru (QA-P8-1): gerçek sunucu CSV çıktısını diske yazar. Geçici olarak apps/server/test/integration/ altına
// kopyalanıp `TEST_DATABASE_URL=... pnpm --filter @remote/server exec vitest run test/integration/p8-csv-op.test.ts` ile koşar.
// Not/ticket PATCH API üzerinden yazılır (uçtan uca). Çıktı: CSV_OUT_DIR (varsayılan docs/img/p8).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, makeApp, testDb } from "../helpers/app.ts";

const HIST = { "sessions.view": true, "session_history.view": true, "session_history.edit": true, "session_history.export": true };
const OUT = process.env.CSV_OUT_DIR ?? resolve(process.cwd(), "../../docs/img/p8");
let app: FastifyInstance;

const CASES: Array<{ customer: string; ticket: string; note: string }> = [
  { customer: "Çağrı Işıkoğlu Şükrü İnce", ticket: "INC-1", note: "Türkçe: ç ğ ı ö ş ü Ç Ğ İ Ö Ş Ü" },
  { customer: "=1+1", ticket: "=SUM(A1:A2)", note: "=HYPERLINK(\"http://kotu.example\";\"tıkla\")" },
  { customer: "+905551112233", ticket: "+90", note: "+cmd|' /C calc'!A0" },
  { customer: "-Ali", ticket: "-42", note: "-2+3" },
  { customer: "@Veli", ticket: "@SUM", note: "@SUM(1,2)" },
  { customer: "Ad; Soyad", ticket: "T;1", note: "a;b;c" },
  { customer: "Ali \"Baba\"", ticket: "Q\"1", note: "çok \"tırnak\" ve ; ayraç\nikinci satır\r\nüçüncü" },
  { customer: "<script>alert(1)</script>", ticket: "' OR 1=1", note: "' OR 1=1 --" },
];

beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => app.close());

it("QA-P8-1: CSV dosyası (ADMIN ve SUPER_ADMIN/Firma sütunu)", async () => {
  const t = await createTenant();
  await testDb().tenant.update({ where: { id: t.id }, data: { name: "Örnek; \"Lojistik\" A.Ş." } });
  const tech = await createUser({ tenantId: t.id, perms: HIST });
  await testDb().user.update({ where: { id: tech.id }, data: { fullName: "Şule Güneş" } });
  const techS = await loginAs(app, tech);
  const base = Date.parse("2019-05-01T07:00:00Z");
  for (const [i, c] of CASES.entries()) {
    const id = newId();
    const createdAt = new Date(base + i * 60_000);
    await testDb().supportSession.create({
      data: {
        id, tenantId: t.id, technicianId: tech.id, tokenHash: sha256Hex(newId()), techVerifyCode: "1234", status: "ENDED", createdAt,
        expiresAt: new Date(createdAt.getTime() + 900_000), endedAt: new Date(createdAt.getTime() + 3_725_000), endedBy: "CUSTOMER",
        endReason: "customer", consumedAt: new Date(createdAt.getTime() + 5_000), mode: i % 2 ? "AGENT" : "BROWSER", customerName: c.customer,
      },
    });
    const p = await app.inject({ method: "PATCH", url: `/api/v1/sessions/${id}`, headers: techS.headers, payload: { ticketNo: c.ticket, note: c.note } });
    expect(p.statusCode, p.body).toBe(200);
  }
  const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
  const r = await app.inject({ method: "GET", url: "/api/v1/sessions/export.csv?sort=createdAt:asc&from=2019-05-01&to=2019-05-01", headers: admin.headers });
  expect(r.statusCode, r.body).toBe(200);
  writeFileSync(`${OUT}/p8-admin.csv`, r.rawPayload);
  writeFileSync(`${OUT}/p8-admin.headers.json`, JSON.stringify(r.headers, null, 2));
  const sa = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
  const r2 = await app.inject({ method: "GET", url: `/api/v1/sessions/export.csv?sort=createdAt:asc&from=2019-05-01&to=2019-05-01&tenantId=${t.id}`, headers: sa.headers });
  expect(r2.statusCode, r2.body).toBe(200);
  writeFileSync(`${OUT}/p8-superadmin.csv`, r2.rawPayload);
});
