// P28c (AC-369): geçmiş katılımcı türetmesi — saf birim testi (audit satırları → katılımcılar).
import { describe, expect, it } from "vitest";
import { deriveParticipants } from "../../src/sessions/history-participants.ts";

let seq = 0;
const row = (action: string, newValue: object, result = "success") => ({
  id: BigInt(++seq),
  createdAt: new Date(Date.UTC(2026, 10, 16, 10, 0, seq)),
  userId: null,
  username: null,
  action,
  oldValue: null,
  newValue,
  result,
});
const iso = (s: number) => new Date(Date.UTC(2026, 10, 16, 10, 0, s)).toISOString();

describe("deriveParticipants (AC-369)", () => {
  it("AC-369: tek teknisyenli oturum → boş", () => {
    expect(deriveParticipants([])).toEqual([]);
  });

  it("AC-369: katılım/ayrılma/çıkarma/devir; fail satırları sayılmaz; rol son durum", () => {
    seq = 0;
    const rows = [
      row("session.participant_join", { userId: "A", role: "participant" }), // 1
      row("session.supervise_join", { userId: "B", role: "observer" }), // 2
      row("session.supervise_join", { failReason: "full" }, "fail"), // 3
      row("session.transfer", { fromUserId: "O", toUserId: "A" }), // 4
      row("session.participant_remove", { userId: "B", role: "observer" }), // 5
      row("session.participant_leave", { userId: "O", role: "participant", reason: "session_end" }), // 6
    ];
    const out = deriveParticipants(rows as never);
    expect(out).toEqual([
      { userId: "A", role: "owner", joinedAt: iso(1), leftAt: null, leaveReason: null, transferredAt: iso(4) },
      { userId: "B", role: "observer", joinedAt: iso(2), leftAt: iso(5), leaveReason: "removed", transferredAt: null },
      { userId: "O", role: "participant", joinedAt: null, leftAt: iso(6), leaveReason: "session_end", transferredAt: iso(4) },
    ]);
  });

  it("AC-369: ayrılıp yeniden katılan → ilk katılım korunur, ayrılma temizlenir", () => {
    seq = 0;
    const out = deriveParticipants([
      row("session.participant_join", { userId: "A" }),
      row("session.participant_leave", { userId: "A", reason: "disconnect" }),
      row("session.participant_join", { userId: "A" }),
    ] as never);
    expect(out[0]).toMatchObject({ joinedAt: iso(1), leftAt: null, leaveReason: null });
  });
});
