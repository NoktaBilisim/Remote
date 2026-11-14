// S-P5-8 (gerçek MySQL): JS ve MySQL Unicode sürüm farkıyla temizlenmiş ad DB CHECK'e (3819) takılırsa kayıt sessizce
// kaybolmaz — audit `file.meta.rejected_by_db` (S-P13a-8: ad/sha256 yok, uzantı) ve istemciye `error{VALIDATION}`.
// Sürüm farkı test ortamında üretilemediği için sanitizeFileName, CHECK'i ihlal eden tek bir adı aynen geçirecek şekilde sarılır.
import type { FileMeta } from "@remote/contracts/ws";
import { describe, expect, it, vi } from "vitest";
import { admitGuest } from "../../src/signaling/admit.ts";
import { handleFileMeta } from "../../src/signaling/collab.ts";
import { testDb } from "../helpers/app.ts";
import { makeRooms, roomFixture } from "../helpers/ws.ts";

const DRIFT = "unicode-farki."; // sondaki nokta → session_files_file_name_chk ihlali
vi.mock("@remote/contracts/files", async (orig) => {
  const a = await orig<typeof import("@remote/contracts/files")>();
  return { ...a, sanitizeFileName: (n: string) => (n === DRIFT ? n : a.sanitizeFileName(n)) };
});

const SHA = "cd".repeat(32);
const EXT = null; // "unicode-farki." → sondaki noktadan sonra uzantı yok
const meta = (o: Partial<FileMeta> = {}): FileMeta => ({ t: "file.meta", direction: "TO_CUSTOMER", fileName: DRIFT, sizeBytes: 10, sha256: SHA, result: "OK", ...o });

describe("S-P5-8 file.meta DB CHECK reddi", () => {
  it("AC-55/S-P5-8: CHECK 3819 → audit file.meta.rejected_by_db (S-P13a-8: ad ve sha256 yok, yalnız uzantı), VALIDATION; sonraki kayıt etkilenmez", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms, ["sessions.create", "file_transfer.use"]);
    const g = fx.guest();
    expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: g.peer }, meta())).toBe("rejected_by_db");
    expect(g.peer.of("error").at(-1)?.code).toBe("VALIDATION");
    expect(await testDb().sessionFile.count({ where: { sessionId: fx.session.id } })).toBe(0);
    const a = await testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.meta.rejected_by_db" } });
    expect(a.map((x) => [x.entityId, x.username, x.result, x.newValue])).toEqual([
      [fx.session.id, "customer", "fail", { sessionId: fx.session.id, direction: "TO_CUSTOMER", ext: EXT, sizeBytes: "10", result: "OK" }],
    ]);
    expect(JSON.stringify(a.map((x) => x.newValue))).not.toContain(SHA);
    expect(await testDb().auditLog.count({ where: { tenantId: fx.tenant.id, action: "file.transfer" } })).toBe(0); // TX geri alındı
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: g.peer }, meta({ fileName: "normal.txt" }))).toBe("recorded");
  });
});
