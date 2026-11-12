// P8c-1 birim testleri: K19 müşteri audit görünümü (AC-173/195), 0.9.x kapanış nedeni eşlemesi (AC-191),
// seed müşteri sabitlerinin contracts anahtar türetmesiyle tutarlılığı (migrate imajı contracts'a bağımlı değil).
import { readFile } from "node:fs/promises";
import { customerKeys, suggestFileLabel } from "@remote/contracts/api/customers";
import { describe, expect, it } from "vitest";
import { customerAuditView, maskEmail } from "../../src/audit/mask.ts";
import { legacyClosed } from "../../src/requests/hub.ts";

describe("AC-173 / AC-195 customerAuditView", () => {
  it("AC-173: izinli liste — ad/etiket/durum açık, ref 4 karakter, kişi/not <dolu>, telefon/e-posta maskeli; null korunur", () => {
    const v = customerAuditView({ name: "Firma", fileLabel: "Firma", status: "ACTIVE", refPrefix: "abcdefghijklmnop", contactName: "Ayşe Yılmaz", phone: "+905321112233", email: "ayse@ornek.com", note: "gizli not" });
    expect(v).toMatchObject({ name: "Firma", fileLabel: "Firma", status: "ACTIVE", refPrefix: "abcd", contactName: "<dolu>", note: "<dolu>", email: "a***@ornek.com" });
    const s = JSON.stringify(v);
    for (const raw of ["Ayşe", "Yılmaz", "gizli not", "5321112233", "ayse@", "efgh"]) expect(s).not.toContain(raw);
    expect(customerAuditView({ contactName: null, phone: null, email: null, note: null })).toEqual({ contactName: null, phone: null, email: null, note: null });
    expect(customerAuditView({})).toEqual({});
  });

  it("AC-195: maskEmail yalnız ilk harf + alan adı", () => {
    expect(maskEmail("mehmet@ornek.com")).toBe("m***@ornek.com");
    expect(maskEmail("bozuk")).toBe("***");
  });
});

describe("AC-191 0.9.x kapanış nedeni eşlemesi", () => {
  it("AC-191: CUSTOMER_PASSIVE / BINDING_REVOKED → TENANT_PASSIVE; bilinen nedenler ve diğer mesajlar aynen", () => {
    expect(legacyClosed({ t: "request.closed", status: "CANCELLED", reason: "CUSTOMER_PASSIVE" })).toEqual({ t: "request.closed", status: "CANCELLED", reason: "TENANT_PASSIVE" });
    expect(legacyClosed({ t: "request.closed", status: "CANCELLED", reason: "BINDING_REVOKED" })).toEqual({ t: "request.closed", status: "CANCELLED", reason: "TENANT_PASSIVE" });
    expect(legacyClosed({ t: "request.closed", status: "CANCELLED", reason: "CUSTOMER" })).toEqual({ t: "request.closed", status: "CANCELLED", reason: "CUSTOMER" });
    expect(legacyClosed({ t: "request.closed", status: "EXPIRED" })).toEqual({ t: "request.closed", status: "EXPIRED" });
  });
});

describe("AC-168 seed müşteri sabitleri", () => {
  it("AC-168: seed.ts DEMO_CUSTOMER nameKey/fileLabel/searchKey contracts türetmesiyle aynı", async () => {
    const src = await readFile(new URL("../../prisma/seed.ts", import.meta.url), "utf8");
    const field = (k: string) => new RegExp(`${k}: "([^"]*)"`).exec(src.slice(src.indexOf("const DEMO_CUSTOMER")))?.[1] ?? "";
    const name = field("name");
    const keys = customerKeys(name, field("contactName"), field("phone"));
    expect(field("nameKey")).toBe(keys.nameKey);
    expect(field("fileLabel")).toMatch(/^[A-Za-z0-9]{1,20}$/); // etiket düzenlenebilir (AC-167); öneri: suggestFileLabel
    expect(suggestFileLabel(name)).toMatch(/^OrnekMusteri/);
    expect(`${keys.nameKey} deneme yetkili ${field("phone").replace(/\D/g, "")}`).toBe(keys.searchKey);
  });
});
