import { describe, expect, it } from "vitest";
import { forgetResume, linkTokenFromPath, readResume, resumeKey, writeResume } from "./guest-resume";

function fake() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const rec = { reconnectToken: "r".repeat(43), technicianName: "Mehmet", customerName: "Ayşe", verifyCode: "1234", sessionRef: "ref1" };

describe("guest-resume (TEST-P4-1)", () => {
  it("anahtar rs.resume.<özet>; link token'ı anahtarda yok, token'a bağlı ve kararlı", async () => {
    const tk = "A".repeat(43);
    const k = await resumeKey(tk);
    expect(k).toMatch(/^rs\.resume\.[0-9a-f]{32}$/);
    expect(k).not.toContain(tk);
    expect(await resumeKey(tk)).toBe(k);
    expect(await resumeKey("B".repeat(43))).not.toBe(k);
  });
  it("yazar/okur/siler; bozuk kayıt silinir", () => {
    const s = fake();
    writeResume("rs.resume.x", rec, s);
    expect(readResume("rs.resume.x", s)).toEqual(rec);
    forgetResume("rs.resume.x", s);
    expect(readResume("rs.resume.x", s)).toBeNull();
    s.setItem("rs.resume.x", JSON.stringify({ reconnectToken: "kısa" }));
    expect(readResume("rs.resume.x", s)).toBeNull();
    expect(s.m.size).toBe(0);
    s.setItem("rs.resume.y", "{bozuk");
    expect(readResume("rs.resume.y", s)).toBeNull();
  });
  it("depo yoksa sessiz", () => {
    expect(readResume("k", undefined)).toBeNull();
    expect(() => writeResume("k", rec, undefined)).not.toThrow();
  });
  it("yoldan link token'ı", () => {
    expect(linkTokenFromPath(`/session/${"a".repeat(43)}`)).toBe("a".repeat(43));
    expect(linkTokenFromPath("/sessions")).toBeNull();
  });
});
