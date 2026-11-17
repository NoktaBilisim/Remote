// P22-D (dba) — DB düzeyi kurallar (mimari-p22 §3.1, §3.3, §15.3; AC-264). Uygulama kodu yok: app bağlantısı (testDb) yetki/
// tetikleyici/CHECK'e tabi; migrator (testFixtureDb) EXPLAIN ve sayımlar için. Yalnız indeks migration'ı: tetikleyici sayısı 23.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb, testFixtureDb } from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";

const blob = (chars: number): Uint8Array<ArrayBuffer> => new Uint8Array(29 + chars);
/** Oturum sohbeti istemci kimliği (§3.1: ≥ 16 rastgele, `^[A-Za-z0-9_-]{16,36}$`). */
const cmid = (): string => randomBytes(18).toString("base64url");

interface Msg {
  sessionId?: string;
  requestId?: string;
  techId?: string;
  clientMsgId?: string | null;
}
const row = (tenantId: string, o: Msg) => ({
  id: newId(),
  tenantId,
  requestId: o.requestId ?? null,
  sessionId: o.sessionId ?? null,
  sender: o.techId ? "TECH" : "CUSTOMER",
  senderUserId: o.techId ?? null,
  clientMsgId: o.clientMsgId ?? null,
  bodyEnc: blob(3),
  bodyChars: 3,
});
const insert = (tenantId: string, o: Msg) => testDb().sessionMessage.create({ data: row(tenantId, o) });

/** Ham INSERT (app): MySQL hata numarasını (1062) Prisma'nın P2002 çevirisinden bağımsız doğrular. */
const rawInsert = (tenantId: string, o: Msg) => {
  const r = row(tenantId, o);
  return testDb().$executeRaw`INSERT INTO session_messages (id, tenant_id, request_id, session_id, sender, sender_user_id,
    client_msg_id, body_enc, body_chars) VALUES (${r.id}, ${r.tenantId}, ${r.requestId}, ${r.sessionId}, ${r.sender},
    ${r.senderUserId}, ${r.clientMsgId}, ${Buffer.from(r.bodyEnc)}, ${r.bodyChars})`;
};
const errorText = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return `${String(e)} ${JSON.stringify(e)}`;
  }
  return "OK";
};
const DUP = /1062|Duplicate entry/;
const UQ = "session_messages_session_client_key";

afterAll(async () => {
  await testDb().$disconnect();
  await testFixtureDb().$disconnect();
});

describe("P22-D session_messages UQ (session_id, sender, client_msg_id) — AC-264", () => {
  it("AC-264: aynı (session_id, sender, client_msg_id) ikinci INSERT → 1062 (UQ adı); Prisma → P2002", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" });
    const id = cmid();
    await insert(t.id, { sessionId: s.id, clientMsgId: id });
    const raw = await errorText(rawInsert(t.id, { sessionId: s.id, clientMsgId: id }));
    expect(raw).toMatch(DUP);
    expect(raw).toContain(UQ);
    await expect(insert(t.id, { sessionId: s.id, clientMsgId: id })).rejects.toMatchObject({ code: "P2002" });
    // TECH: UQ sender_user_id içermez (§3.1) → farklı teknisyen aynı kimlikle de 1062 (uygulama `chat.rejected{invalid}`).
    const u2 = await createUser({ tenantId: t.id });
    const tid = cmid();
    await insert(t.id, { sessionId: s.id, techId: u.id, clientMsgId: tid });
    expect(await errorText(rawInsert(t.id, { sessionId: s.id, techId: u2.id, clientMsgId: tid }))).toMatch(DUP);
    expect(await testDb().sessionMessage.count({ where: { sessionId: s.id } })).toBe(2);
  });

  it("AC-264: farklı gönderen / farklı oturum / NULL kimlik çakışmaz", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const s1 = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" });
    const s2 = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" });
    const id = cmid();
    await insert(t.id, { sessionId: s1.id, clientMsgId: id });
    await insert(t.id, { sessionId: s1.id, techId: u.id, clientMsgId: id }); // TECH ≠ CUSTOMER
    await insert(t.id, { sessionId: s2.id, clientMsgId: id }); // başka oturum
    await insert(t.id, { sessionId: s1.id }); // NULL client_msg_id (DB'de NULL'lanabilir; protokol zorunlu kılar)
    await insert(t.id, { sessionId: s1.id });
    expect(await testDb().sessionMessage.count({ where: { tenantId: t.id } })).toBe(5);
  });

  it("talep satırları etkilenmez: session_id NULL → yeni UQ'ya girmez; P18 UQ (request_id, sender, client_msg_id) aynen", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const r1 = await createRequestRow(t.id);
    const r2 = await createRequestRow(t.id);
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" });
    const id = cmid();
    await insert(t.id, { requestId: r1.id, clientMsgId: id });
    await insert(t.id, { requestId: r2.id, clientMsgId: id }); // başka talep, aynı kimlik
    await insert(t.id, { sessionId: s.id, clientMsgId: id }); // oturum satırı, aynı kimlik (§3.1: talep ↔ oturum ayrı satır)
    const p18 = await errorText(rawInsert(t.id, { requestId: r1.id, clientMsgId: id }));
    expect(p18).toMatch(DUP);
    expect(p18).toContain("session_messages_request_id_sender_client_msg_id_key");
    expect(await testDb().sessionMessage.count({ where: { tenantId: t.id } })).toBe(3);
  });

  it("şema: UQ var, P18 indeksleri duruyor; tetikleyici 23; app DDL yok", async () => {
    const ix = await testFixtureDb().$queryRaw<{ name: string; cols: string; nu: bigint | number }[]>`
      SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, MAX(NON_UNIQUE) AS nu
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'session_messages'
       GROUP BY INDEX_NAME ORDER BY INDEX_NAME`;
    const m = new Map(ix.map((x) => [x.name, `${x.cols}|${Number(x.nu)}`]));
    expect(m.get(UQ)).toBe("session_id,sender,client_msg_id|0");
    expect(m.get("session_messages_request_id_sender_client_msg_id_key")).toBe("request_id,sender,client_msg_id|0");
    expect(m.get("session_messages_session_id_tenant_id_created_at_idx")).toBe("session_id,tenant_id,created_at|1");
    const trg = await testFixtureDb().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE()`;
    expect(Number(trg[0]?.n)).toBe(23); // deploy/backup/lib.sh REMOTE_EXPECTED_TRIGGERS (P22 değiştirmez)
    await expect(testDb().$executeRawUnsafe(`ALTER TABLE session_messages DROP INDEX ${UQ}`)).rejects.toThrow(/denied/i);
  });

  it("§15.3 EXPLAIN: geçmiş okuma, özet sayımı, retention COUNT ve join'li DELETE IX(session_id, tenant_id, created_at)", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED" });
      ids.push(s.id);
    }
    await testDb().sessionMessage.createMany({
      data: ids.flatMap((sid) =>
        Array.from({ length: 25 }, (_, k) => row(t.id, { sessionId: sid, clientMsgId: cmid(), ...(k % 2 ? { techId: u.id } : {}) })),
      ),
    });
    // Retention anındaki gerçek hâl: parti aynı TX'te anonimleşmiş ve firmada PURGE_CUT'a kadar başka anonim oturumlar var.
    // (Anonim oturum yokken iyileştirici IX(tenant_id, anonymized_at, created_at) boş aralığını seçer — 0 satır, zararsız.)
    await testFixtureDb().$executeRaw`UPDATE support_sessions SET anonymized_at = UTC_TIMESTAMP(3) WHERE tenant_id = ${t.id}`;
    await testFixtureDb().$executeRawUnsafe("ANALYZE TABLE session_messages, support_sessions");
    const plan = async (sql: string, ...args: unknown[]) =>
      (await testFixtureDb().$queryRawUnsafe<{ table: string; key: string | null }[]>(`EXPLAIN ${sql}`, ...args)).map(
        (x) => `${x.table}:${x.key}`,
      );
    const IX = "session_messages_session_id_tenant_id_created_at_idx";
    const part = ids.slice(0, 10);
    const inList = part.map(() => "?").join(",");
    // Geçmiş (chat.history / GET /sessions/:id/chat): en yeni 100, sıralı.
    expect(
      await plan(
        `SELECT id, sender, sender_user_id, client_msg_id, body_enc, created_at FROM session_messages
          WHERE session_id = ? AND tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
        ids[0],
        t.id,
      ),
    ).toEqual([`session_messages:${IX}`]);
    // writeChatSummary (§15.4): iyileştirici GROUP BY sender için yeni UQ'yu (öneki session_id) seçebilir; ikisi de tek oturumun
    // satırlarıyla sınırlı (db-notlari "P22"). Tam tarama / tenant indeksi kabul edilmez.
    const sum = await plan(
      `SELECT sender, sender_user_id, COUNT(*) FROM session_messages WHERE session_id = ? AND tenant_id = ?
        GROUP BY sender, sender_user_id`,
      ids[0],
      t.id,
    );
    expect([[`session_messages:${IX}`], [`session_messages:${UQ}`]]).toContainEqual(sum);
    // Retention bütçesi COUNT (§15.3).
    expect(
      await plan(
        `SELECT session_id, COUNT(*) FROM session_messages WHERE tenant_id = ? AND session_id IN (${inList}) GROUP BY session_id`,
        t.id,
        ...part,
      ),
    ).toEqual([`session_messages:${IX}`]);
    // Retention DELETE join'i (§3.3): oturum PK, mesaj IX.
    const del = await plan(
      `DELETE m FROM session_messages m JOIN support_sessions s ON s.id = m.session_id AND s.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.session_id IN (${inList}) AND s.anonymized_at IS NOT NULL AND m.request_id IS NULL`,
      t.id,
      ...part,
    );
    expect(del).toContain(`m:${IX}`);
    expect(del.find((x) => x.startsWith("s:"))).toMatch(/^s:(PRIMARY|support_sessions_id_tenant_id_key)$/);
  });
});
