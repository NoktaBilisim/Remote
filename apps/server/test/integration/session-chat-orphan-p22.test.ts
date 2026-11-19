// P22-B1 S-P22-4: süreç yeniden başlatma süpürücüsü (`endOrphanedActive`) her oturumu kendi TX'inde kapatır ve
// `session.chat_summary`'yi DB'den sayar. Süpürücü TÜM ACTIVE oturumları kapatır → vitest RETENTION_SERIAL projesinde (tek başına).
import { randomBytes } from "node:crypto";
import { CHAT_AUDIT } from "@remote/contracts/audit";
import { describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import { insertIfActive, storeChat } from "../../src/sessions/chat.ts";
import { endOrphanedActive } from "../../src/sessions/service.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";

const cid = (): string => randomBytes(16).toString("base64url");

describe("S-P22-4 yeniden başlatma süpürücüsü", () => {
  it("S-P22-4: oda bellekteyken süreç yeniden başlar → süpürücü kapatır → özet var, sayılar = COUNT(session_messages)", async () => {
    const t = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "USER" });
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status: "ACTIVE" });
    const quiet = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status: "ACTIVE" });
    const d = { db: testDb(), secrets: new SecretBox(null), insert: insertIfActive };
    const now = Date.now();
    const put = (sender: "TECH" | "CUSTOMER", i: number) =>
      storeChat(d, {
        tenantId: t.id,
        sessionId: s.id,
        sender,
        senderUserId: sender === "TECH" ? tech.id : null,
        clientMsgId: cid(),
        body: `m${i}`,
        now: new Date(now + i),
      });
    for (let i = 0; i < 3; i++) await put("TECH", i);
    for (let i = 3; i < 5; i++) await put("CUSTOMER", i);
    expect(await endOrphanedActive(testDb(), new Date())).toBeGreaterThanOrEqual(2);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ENDED");
    const sum = await testDb().auditLog.findMany({ where: { entityId: s.id, action: CHAT_AUDIT.SUMMARY } });
    expect(sum).toHaveLength(1);
    expect(sum[0]?.newValue).toEqual({ tech: 3, customer: 2, senderUserIds: [tech.id], legacy: false });
    expect(await testDb().sessionMessage.count({ where: { sessionId: s.id } })).toBe(5);
    // Mesajsız oturum: özet yok. Kapanmış oturuma yazım 0 satır (not_active).
    expect(await testDb().auditLog.count({ where: { entityId: quiet.id, action: CHAT_AUDIT.SUMMARY } })).toBe(0);
    expect((await put("TECH", 9)).kind).toBe("not_active");
  });
});
