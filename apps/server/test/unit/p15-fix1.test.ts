// P15 düzeltme turu 1 — DB'siz birim testleri: S15-5 (engel önbelleği hata temizleyicisi) ve AC-238 fid'siz eşleme kuralı.
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { RequestBlockCache } from "../../src/requests/blocks.ts";
import { groupFileReports } from "../../src/sessions/history.ts";

describe("S15-5 engel önbelleği", () => {
  it("S15-5: eski yüklemenin hatası, invalidate sonrası başlayan yeni yüklemeyi önbellekten silmez", async () => {
    let calls = 0;
    const pending: { reject: (e: Error) => void }[] = [];
    const db = {
      requestBlock: {
        findMany: () => {
          calls++;
          if (calls === 1) return new Promise((_res, reject) => pending.push({ reject }));
          return Promise.resolve([]);
        },
      },
    } as unknown as Db;
    const cache = new RequestBlockCache(db, () => Date.now());
    const p1 = cache.match("t1", "203.0.113.5", null); // P1 yükleme başlar (askıda)
    cache.invalidate("t1"); // yazma
    expect(await cache.match("t1", "203.0.113.5", null)).toBeNull(); // P2 yüklendi (calls = 2)
    pending[0]?.reject(new Error("db down")); // P1 hata verir
    await expect(p1).rejects.toThrow("db down");
    await cache.match("t1", "203.0.113.5", null);
    expect(calls).toBe(2); // P2 önbellekte kaldı; ek DB okuması yok
  });

  it("S15-5: yüklemenin kendi hatası önbelleğe girmez (sonraki istek yeniden dener)", async () => {
    let calls = 0;
    const db = {
      requestBlock: {
        findMany: () => (++calls === 1 ? Promise.reject(new Error("x")) : Promise.resolve([])),
      },
    } as unknown as Db;
    const cache = new RequestBlockCache(db, () => Date.now());
    await expect(cache.match("t1", "203.0.113.5", null)).rejects.toThrow("x");
    expect(await cache.match("t1", "203.0.113.5", null)).toBeNull();
    expect(calls).toBe(2);
  });
});

type Row = { id: string; reportedBy: string; matchKey: string | null; direction: string; sha256: string; sizeBytes: bigint };
const row = (id: string, reportedBy: "TECH" | "CUSTOMER", matchKey: string | null, sha = "a", size = 10n): Row => ({
  id,
  reportedBy,
  matchKey,
  direction: "TO_CUSTOMER",
  sha256: sha.repeat(64),
  sizeBytes: size,
});

describe("AC-238 fid'siz rapor eşlemesi", () => {
  it("AC-238: fid'siz müşteri raporu aynı içerikteki eşsiz TECH raporuyla birleşir → doğrulanmış (gösterilen satır TECH)", () => {
    const g = groupFileReports([row("c1", "CUSTOMER", "k-legacy"), row("t1", "TECH", "k-fid")]);
    expect(g).toEqual([{ row: expect.objectContaining({ id: "t1" }), verified: true }]);
  });

  it("AC-238: eşi olmayan fid'siz müşteri raporu 'Müşteri bildirimi' kalır; farklı boyut/özet eşlenmez", () => {
    const g = groupFileReports([row("c1", "CUSTOMER", "k1"), row("t1", "TECH", "k2", "a", 11n), row("t2", "TECH", "k3", "b")]);
    expect(g.map((x) => [x.row.id, x.verified])).toEqual([
      ["c1", false],
      ["t1", true],
      ["t2", true],
    ]);
  });

  it("AC-238: eşleme bire bir — iki müşteri raporu tek TECH raporunu paylaşamaz; zaten eşli TECH grubu kullanılmaz", () => {
    const g = groupFileReports([
      row("t0", "TECH", "kf"),
      row("c0", "CUSTOMER", "kf"),
      row("c1", "CUSTOMER", "k1"),
      row("c2", "CUSTOMER", "k2"),
      row("t1", "TECH", "k3"),
    ]);
    expect(g.filter((x) => x.verified)).toHaveLength(2);
    expect(g.filter((x) => !x.verified).map((x) => x.row.id)).toEqual(["c2"]);
  });

  it("AC-238: eski satırlar (match_key NULL) reported_by'a göre — S15-2 sonrası TO_CUSTOMER CUSTOMER", () => {
    const g = groupFileReports([row("o1", "CUSTOMER", null, "c"), row("o2", "TECH", null, "d")]);
    expect(g.map((x) => [x.row.id, x.verified])).toEqual([
      ["o1", false],
      ["o2", true],
    ]);
  });
});
