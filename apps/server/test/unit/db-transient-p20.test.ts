// P20 K1: ham sorgu kilitlenmesi (P2010 + originalCode) geçici sayılır → verme TX'i bir kez yeniden denenir.
import { describe, expect, it } from "vitest";
import { isTransientDbError } from "../../src/lib/db.ts";

const prismaErr = (code: string, cause: Record<string, unknown>) =>
  Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code, meta: { driverAdapterError: { cause } } });

describe("isTransientDbError (P20 K1)", () => {
  it("AC-254 / K0: $queryRaw 1213 (P2010, originalCode dizesi) ve 1205 geçici; diğer kodlar değil", () => {
    expect(isTransientDbError(prismaErr("P2010", { originalCode: "1213", kind: "TransactionWriteConflict" }))).toBe(true);
    expect(isTransientDbError(prismaErr("P2010", { originalCode: "1205" }))).toBe(true);
    expect(isTransientDbError(prismaErr("P2010", { originalCode: "1064" }))).toBe(false);
    expect(isTransientDbError(prismaErr("P2002", { code: 1213 }))).toBe(true);
    expect(
      isTransientDbError(
        Object.assign(new Error("x"), { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "1213" } } } }),
      ),
    ).toBe(false);
  });
});
