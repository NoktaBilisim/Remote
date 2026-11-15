import { describe, expect, it } from "vitest";
import { comboKey } from "@/lib/combobox";
import type { CustomerDetail } from "./contract";
import { buildCreate, buildPatch, draftOf, emptyDraft, isDirty, serverFieldErrors } from "./form";
import { customersApiPath, customersHref, parseCustomerParams, parseRequestCustomer, searchTerm } from "./query";

const ID = "01JC5ST0000000000000000001";
const detail: CustomerDetail = {
  id: ID,
  name: "Acme Ltd",
  status: "ACTIVE",
  downloadUrl: "https://x/api/v1/public/agent/request-download?ref=abcdefghijklmnop",
  fileName: "NoktaDestek-AcmeLtd-abcdefghijklmnop.exe",
  createdAt: "2026-11-12T08:00:00.000Z",
  lastRequestAt: null,
  requestCount: 0,
  fileLabel: "AcmeLtd",
  contactName: "Ayşe Yılmaz",
  phone: "+905321112233",
  email: null,
  note: "Satır 1\nSatır 2",
  refRotatedAt: null,
  passiveAt: null,
  anonymizedAt: null,
  sessionCount: 0,
};

describe("AC-166 liste URL durumu", () => {
  it("varsayılanlar URL'e yazılmaz; geçersiz değerler yok sayılır", () => {
    expect(parseCustomerParams({})).toEqual({ q: undefined, status: "active", page: 1 });
    expect(parseCustomerParams({ q: " şiş ", status: "passive", page: "3" })).toEqual({ q: "şiş", status: "passive", page: 3 });
    expect(parseCustomerParams({ q: "a", status: "x", page: "0" })).toEqual({ q: undefined, status: "active", page: 1 });
    expect(customersHref({ status: "active", page: 1 })).toBe("/customers");
    expect(customersHref({ q: "acme", status: "all", page: 2 })).toBe("/customers?q=acme&status=all&page=2");
    expect(customersApiPath({ status: "active", page: 1 })).toBe("/customers?status=active&page=1&pageSize=50");
  });
  it("arama en az 2, en çok 100 kod noktası; görünmez karakter yok", () => {
    expect(searchTerm("a")).toBeUndefined();
    expect(searchTerm("ab")).toBe("ab");
    expect(searchTerm("x".repeat(101))).toBeUndefined();
    expect(searchTerm("ab‮")).toBeUndefined();
  });
  it("AC-176 talep müşteri filtresi: general | ULID", () => {
    expect(parseRequestCustomer("general")).toBe("general");
    expect(parseRequestCustomer(ID)).toBe(ID);
    expect(parseRequestCustomer("none")).toBeUndefined();
    expect(parseRequestCustomer("abc")).toBeUndefined();
  });
});

describe("AC-167 müşteri formu", () => {
  it("oluşturma: ad zorunlu, boş isteğe bağlı alan gönderilmez", () => {
    const r = buildCreate({ ...emptyDraft(), name: "Acme Ltd", fileLabel: "AcmeLtd" });
    expect(r).toEqual({ ok: true, body: { name: "Acme Ltd", fileLabel: "AcmeLtd" } });
    const bad = buildCreate({ ...emptyDraft(), name: "A", fileLabel: "acme-ltd", email: "x@", phone: "12" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["email", "fileLabel", "name", "phone"]);
  });
  it("not alanında sekme karakteri yasak, satır sonu serbest", () => {
    const tab = buildCreate({ ...emptyDraft(), name: "Acme", note: "a\tb" });
    expect(tab.ok).toBe(false);
    if (!tab.ok) expect(tab.errors.note).toMatch(/sekme/);
    expect(buildCreate({ ...emptyDraft(), name: "Acme", note: "a\nb" }).ok).toBe(true);
  });
  it("AC-195 düzenleme: yalnız değişen alanlar; boşaltılan kişisel alan null", () => {
    const d = { ...draftOf(detail), contactName: "", note: detail.note ?? "" };
    expect(buildPatch(d, detail)).toEqual({ ok: true, body: { contactName: null } });
    expect(buildPatch(draftOf(detail), detail)).toEqual({ ok: true, body: {} });
    const noName = buildPatch({ ...draftOf(detail), name: " " }, detail);
    expect(noName.ok).toBe(false);
    expect(isDirty({ ...draftOf(detail), email: "a@b.co" }, draftOf(detail))).toBe(true);
  });
  it("sunucu alan hataları forma, tanınmayanlar form üstüne", () => {
    expect(serverFieldErrors({ name: "Bu adla bir müşteri zaten var", x: "?" })).toEqual({
      errors: { name: "Bu adla bir müşteri zaten var" },
      rest: ["?"],
    });
  });
});

describe("combobox klavye (WAI-ARIA)", () => {
  const s = (o: Partial<{ open: boolean; active: number; count: number; hasText: boolean }>) => ({
    open: true,
    active: -1,
    count: 3,
    hasText: true,
    ...o,
  });
  it("↓/↑ kapalıyken açar, açıkken dolaşır ve uçlarda döner", () => {
    expect(comboKey("ArrowDown", s({ open: false }))).toEqual({ kind: "open" });
    expect(comboKey("ArrowDown", s({ active: -1 }))).toEqual({ kind: "move", to: 0 });
    expect(comboKey("ArrowDown", s({ active: 2 }))).toEqual({ kind: "move", to: 0 });
    expect(comboKey("ArrowUp", s({ active: 0 }))).toEqual({ kind: "move", to: 2 });
    expect(comboKey("End", s({}))).toEqual({ kind: "move", to: 2 });
  });
  it("Enter seçer, Esc kapatır / kapalıyken temizler, Tab kapatır", () => {
    expect(comboKey("Enter", s({ active: 1 }))).toEqual({ kind: "select", index: 1 });
    expect(comboKey("Enter", s({ active: -1 }))).toEqual({ kind: "none" });
    expect(comboKey("Escape", s({}))).toEqual({ kind: "close" });
    expect(comboKey("Escape", s({ open: false }))).toEqual({ kind: "clear" });
    expect(comboKey("Escape", s({ open: false, hasText: false }))).toEqual({ kind: "none" });
    expect(comboKey("Tab", s({}))).toEqual({ kind: "close" });
  });
});
