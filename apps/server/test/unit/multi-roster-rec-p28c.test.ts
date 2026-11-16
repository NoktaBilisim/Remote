// P28c K1c birim testleri: `rosterOf` değişmezleri (§4.4, `techRosterSchema`) ve kaydedici devri `recRecorderChanged`
// (§6.2, D-PC-6). Oda/Rooms yalnız kullanılan alanlarla kurulur; saat sahte.
import { techRosterSchema } from "@remote/contracts/ws-multi";
import { describe, expect, it, vi } from "vitest";
import { rosterOf, tidOf } from "../../src/signaling/members.ts";
import { recRecorderChanged } from "../../src/signaling/rec.ts";
import type { Rooms } from "../../src/signaling/rooms.ts";
import type { Member, MultiRoom, Room, TechConn } from "../../src/signaling/types.ts";
import { FakeClock } from "../helpers/ws.ts";

const multi = (controllerId: string): MultiRoom => ({
  tids: new Map(),
  controllerId,
  members: new Map(),
  invites: new Map(),
  removed: new Set(),
  cmdTimes: [],
  transferring: false,
  guestMulti: true,
  guestRosterTids: new Set(),
  logAt: new Map(),
});

const conn = (userId: string, rec = true) => {
  const sent: { t: string; upload?: unknown }[] = [];
  const c = {
    userId,
    username: `${userId}@x`,
    authSessionId: `as-${userId}`,
    connId: `c-${userId}`,
    peer: { rec, send: (m: { t: string }) => void sent.push(m) },
  } as unknown as TechConn;
  return { c, sent };
};

const member = (userId: string, c: TechConn | undefined, joined = true, role: Member["role"] = "participant"): Member =>
  ({ userId, username: `${userId}@x`, fullName: ` Üye ${userId} `, role, via: "invite", conn: c, joinedAudited: joined }) as Member;

const room = (over: Partial<Room> = {}): Room =>
  ({ sessionId: "S", tenantId: "T", technicianId: "own", technicianName: "Sahip", multi: multi("own"), ...over }) as Room;

describe("P28c rosterOf değişmezleri", () => {
  it("sahip her zaman ilk ve tek; sahip kopukken connected:false; tek kontrol sahibi; şema geçer", () => {
    const r = room();
    const out = rosterOf(r);
    expect(out).toEqual([{ tid: tidOf(r, "own"), name: "Sahip", role: "controller", owner: true, connected: false }]);
    expect(() => techRosterSchema.parse(out)).not.toThrow();
  });

  it("henüz WS'e katılmamış üye (rezervasyon) listede yok; kontrol üyede iken sahip participant; tid kalıcı", () => {
    const own = conn("own");
    const a = conn("a");
    const r = room({ tech: own.c });
    r.multi.members.set("a", member("a", a.c));
    r.multi.members.set("b", member("b", undefined, false));
    r.multi.members.set("o", member("o", undefined, true, "observer"));
    r.multi.controllerId = "a";
    const out = techRosterSchema.parse(rosterOf(r));
    expect(out.map((e) => [e.role, e.owner, e.connected])).toEqual([
      ["participant", true, true],
      ["controller", false, true],
      ["observer", false, false],
    ]);
    expect(out.filter((e) => e.owner)).toHaveLength(1);
    expect(out.filter((e) => e.role === "controller")).toHaveLength(1);
    expect(out[1]?.name).toBe("Üye a"); // kırpılır
    expect(rosterOf(r).map((e) => e.tid)).toEqual(out.map((e) => e.tid)); // (oturum, kullanıcı) başına sabit
    expect(new Set(out.map((e) => e.tid)).size).toBe(out.length);
  });

  it("boş/boşluk ad → 'Teknisyen'", () => {
    const r = room({ technicianName: "   " });
    expect(rosterOf(r)[0]?.name).toBe("Teknisyen");
  });
});

describe("P28c kaydedici devri (recRecorderChanged)", () => {
  const setup = (nextRec = true) => {
    const clock = new FakeClock();
    const drop = vi.fn();
    const issue = vi.fn(() => "YeniBelirtec");
    const rooms = { clock, rec: { dropUploadTokens: drop, issueUploadToken: issue }, live: () => true } as unknown as Rooms;
    const own = conn("own");
    const a = conn("a", nextRec);
    const r = room({ tech: own.c });
    r.multi.members.set("a", member("a", a.c));
    r.rec = { state: "active", rid: "R", basis: "policy", series: 1, nextPart: 3 } as unknown as Room["rec"];
    return { clock, drop, issue, rooms, own, a, r };
  };

  it("kontrol üyeye geçti: eski kaydedicinin belirteçleri hemen düşer, eskisine upload'sız rec.state, yenisine yeni seri + belirteç", () => {
    const { drop, issue, rooms, own, a, r } = setup();
    r.multi.controllerId = "a";
    recRecorderChanged(rooms, r, own.c);
    expect(drop).toHaveBeenCalledWith({ by: "conn", connId: "c-own" });
    expect(own.sent).toEqual([expect.objectContaining({ t: "rec.state", on: true })]);
    expect(own.sent[0]?.upload).toBeUndefined();
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ userId: "a", connId: "c-a" }));
    expect(a.sent).toEqual([expect.objectContaining({ t: "rec.state", upload: { token: "YeniBelirtec", series: 2, nextPart: 0 } })]);
    expect(r.rec?.recorderConnId).toBe("c-a");
  });

  it("yeni kontrol sahibi rec1 değil: belirteç verilmez, kaydedici dönüş süresi işler (eski belirteç yine düşer)", () => {
    const { drop, issue, rooms, own, a, r } = setup(false);
    r.multi.controllerId = "a";
    recRecorderChanged(rooms, r, own.c);
    expect(drop).toHaveBeenCalledTimes(1);
    expect(issue).not.toHaveBeenCalled();
    expect(a.sent).toEqual([]);
    expect(r.recGate?.recorderGone).toBeDefined();
  });

  it("kayıt yokken yalnız eski belirteçler düşer, mesaj gitmez", () => {
    const { drop, rooms, own, a, r } = setup();
    r.rec = undefined;
    r.multi.controllerId = "a";
    recRecorderChanged(rooms, r, own.c);
    expect(drop).toHaveBeenCalledTimes(1);
    expect([...own.sent, ...a.sent]).toEqual([]);
  });
});
