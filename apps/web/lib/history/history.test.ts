import { describe, expect, it } from "vitest";
import { formatDuration, istanbulDay } from "@/lib/format";
import { buildPatch, validateNote } from "./note";
import { checkCustomer, exportApiPath, historyHref, isCalendarDay, listApiPath, parseFilters } from "./query";

describe("AC-60 filtre URL durumu", () => {
  it("geçerli değerler okunur, varsayılanlar URL'e yazılmaz", () => {
    const { filters, ignored } = parseFilters({
      status: "ENDED",
      mode: "AGENT",
      from: "2026-11-01",
      to: "2026-11-10",
      customer: "  Ayşe ",
      page: "2",
      pageSize: "50",
    });
    expect(ignored).toEqual([]);
    expect(filters).toMatchObject({ status: "ENDED", mode: "AGENT", customer: "Ayşe", page: 2, pageSize: 50 });
    expect(historyHref({ ...filters, page: 1, pageSize: 25 })).toBe(
      "/history?from=2026-11-01&to=2026-11-10&status=ENDED&mode=AGENT&customer=Ay%C5%9Fe",
    );
    expect(listApiPath(parseFilters({}).filters)).toBe("/sessions?page=1&pageSize=25");
  });
  it("geçersiz değerler yok sayılır (sunucu strict 400 vermesin)", () => {
    const { filters, ignored } = parseFilters({ status: "X", from: "2026-02-30", pageSize: "101", technicianId: "abc", customer: "a‮" });
    expect(ignored.sort()).toEqual(["customer", "from", "pageSize", "status", "technicianId"]);
    expect(filters).toEqual({ page: 1, pageSize: 25 });
  });
  it("from > to → bitiş yok sayılır", () => {
    const { filters, ignored } = parseFilters({ from: "2026-11-10", to: "2026-11-01" });
    expect(filters.to).toBeUndefined();
    expect(ignored).toEqual(["to"]);
  });
  it("export yolu sayfalamayı taşımaz (AC-63)", () => {
    expect(exportApiPath({ status: "ENDED", page: 3, pageSize: 50 })).toBe("/sessions/export.csv?status=ENDED");
  });
  it("takvim günü ve müşteri denetimi", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(checkCustomer("a").error).toBe("short");
    expect(checkCustomer("x".repeat(101)).error).toBe("long");
    expect(checkCustomer("%_\\").value).toBe("%_\\");
  });
});

describe("biçim", () => {
  it("süre ve İstanbul günü", () => {
    expect(formatDuration(45)).toBe("45 sn");
    expect(formatDuration(725)).toBe("12 dk 5 sn");
    expect(formatDuration(3720)).toBe("1 sa 2 dk");
    expect(istanbulDay(Date.parse("2026-11-10T21:30:00Z"))).toBe("2026-11-11");
  });
});

describe("AC-63 not formu", () => {
  const init = { ticketNo: "INC-1", note: "eski" };
  it("yalnız değişen alanlar; boş → null; değişiklik yoksa null", () => {
    expect(buildPatch(init, init)).toBeNull();
    expect(buildPatch(init, { ticketNo: " INC-1 ", note: "eski" })).toBeNull();
    expect(buildPatch(init, { ticketNo: "", note: "eski" })).toEqual({ ticketNo: null });
    expect(buildPatch(init, { ticketNo: "INC-1", note: "" })).toEqual({ note: null });
  });
  it("uzunluk ve görünmez karakter hataları alan bazlı", () => {
    expect(validateNote({ ticketNo: "T".repeat(51), note: "n".repeat(4001) })).toEqual({
      ticketNo: "Ticket no en çok 50 karakter olabilir",
      note: "Not en çok 4000 karakter olabilir",
    });
    expect(validateNote({ note: "satır\nsekme\tserbest" })).toEqual({});
    expect(validateNote({ note: "gizli​karakter" }).note).toBe("Görünmez veya kontrol karakteri kullanılamaz");
  });
});

describe("P13a (AC-197) anonimleştirilmiş oturum", () => {
  it("anonymized bayrağı ve 409 SESSION_ANONYMIZED (contracts)", async () => {
    const { isAnonymized, isAnonymizedError } = await import("./anonymized");
    const { ApiError } = await import("@/lib/api");
    expect(isAnonymized({ anonymized: true })).toBe(true);
    expect(isAnonymized({ anonymized: false })).toBe(false);
    expect(isAnonymizedError(new ApiError(409, "SESSION_ANONYMIZED", "x"))).toBe(true);
    expect(isAnonymizedError(new ApiError(409, "CONFLICT", "x"))).toBe(false);
    expect(isAnonymizedError(new Error("x"))).toBe(false);
  });
});
