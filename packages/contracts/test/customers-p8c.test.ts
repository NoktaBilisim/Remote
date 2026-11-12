import { describe, expect, it } from "vitest";
import bindingsFixture from "../fixtures/bindings.json" with { type: "json" };
import customersFixture from "../fixtures/customers.json" with { type: "json" };
import { bindingRevokeInputSchema, bindingStatusInputSchema, bindingKeySchema, BINDING_FORGOTTEN_MESSAGE, BINDING_INVALID_MESSAGE, BINDING_NO_SOURCE_MESSAGE } from "../src/api/bindings.ts";
import {
  createCustomerInputSchema,
  customerFirmNameSchema,
  customerKeys,
  customerNoteSchema,
  foldKey,
  listCustomersQuerySchema,
  suggestFileLabel,
  updateCustomerInputSchema,
} from "../src/api/customers.ts";
import { CANCEL_REASONS, createRequestInputSchema, listRequestsQuerySchema } from "../src/api/requests.ts";
import { createSessionInputSchema, listSessionsQuerySchema, SESSION_CSV_COLUMNS } from "../src/api/sessions.ts";
import { CANCEL_REASON_LABELS, CUSTOMER_STATUS_LABELS, viaBindingLabel } from "../src/labels.ts";
import { PERMISSION_KEYS, effectivePermissions } from "../src/permissions.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { guestInboundSchema, serverOutboundSchema } from "../src/ws.ts";
import { panelOutboundSchema } from "../src/ws-request.ts";

const fx = customersFixture as unknown as {
  fold: [string, string][];
  sameKey: string[][];
  label: [string, string][];
  validNames: string[];
  invalidNames: string[];
  validNotes: string[];
  invalidNotes: string[];
};
const bx = bindingsFixture as unknown as {
  validKeys: string[];
  invalidKeys: string[];
  valid: Record<string, unknown[]>;
  invalid: Record<string, unknown[]>;
  messages: Record<string, string>;
};

const REQ = {
  clientInstanceId: "AAAAAAAAAAAAAAAAAAAAAA",
  clientVersion: "0.10.0",
  customerName: "Ayşe Yılmaz",
  phone: "05321234567",
  description: "Yazıcı çalışmıyor, yardım lütfen",
  consentTextId: "01JC0000000000000000000000",
  consentAccepted: true,
};
const KEY = "rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("P8c contracts — müşteriler", () => {
  it("AC-165: customers.* tek tanımda; ADMIN varsayılan açık, USER kapalı", () => {
    for (const k of ["customers.view", "customers.create", "customers.edit", "customers.delete"] as const) {
      expect(PERMISSION_KEYS).toContain(k);
      expect(effectivePermissions("ADMIN", [])).toContain(k);
      expect(effectivePermissions("USER", [])).not.toContain(k);
    }
  });

  it("AC-167: foldKey fixture (Türkçe/harf duyarsız) ve aynı anahtar grupları", () => {
    for (const [input, out] of fx.fold) expect(foldKey(input)).toBe(out);
    for (const group of fx.sameKey) expect(new Set(group.map(foldKey)).size).toBe(1);
  });

  it("AC-167: suggestFileLabel fixture ve fileLabel şeması", () => {
    for (const [name, label] of fx.label) {
      expect(suggestFileLabel(name)).toBe(label);
      expect(/^[A-Za-z0-9]{1,20}$/.test(suggestFileLabel(name))).toBe(true);
    }
  });

  it("AC-167: ad, not şemaları (not'ta \\t yasak, CRLF → LF), boş → null", () => {
    for (const n of fx.validNames) expect(customerFirmNameSchema.safeParse(n).success).toBe(true);
    for (const n of fx.invalidNames) expect(customerFirmNameSchema.safeParse(n).success).toBe(false);
    for (const n of fx.validNotes) expect(customerNoteSchema.safeParse(n).success).toBe(true);
    for (const n of fx.invalidNotes) expect(customerNoteSchema.safeParse(n).success).toBe(false);
    expect(customerNoteSchema.parse("a\r\nb")).toBe("a\nb");
    expect(customerNoteSchema.parse("")).toBeNull();
    expect(customerFirmNameSchema.safeParse("x".repeat(101)).success).toBe(false);
  });

  it("AC-167/195: oluşturma ve PATCH şemaları (telefon E.164, boşaltma, ad boşaltılamaz, en az bir alan)", () => {
    const c = createCustomerInputSchema.parse({ name: "  Örnek A.Ş. ", phone: "0532 123 45 67", email: "", contactName: "" });
    expect(c).toMatchObject({ name: "Örnek A.Ş.", phone: "+905321234567", email: null, contactName: null });
    expect(createCustomerInputSchema.safeParse({ name: "AB", phone: "12" }).success).toBe(false);
    expect(createCustomerInputSchema.safeParse({ name: "AB", email: "x@" }).success).toBe(false);
    expect(createCustomerInputSchema.safeParse({ name: "AB", fileLabel: "a-b" }).success).toBe(false);
    expect(createCustomerInputSchema.safeParse({ name: "AB", extra: 1 }).success).toBe(false);
    expect(updateCustomerInputSchema.parse({ phone: null, note: "" })).toEqual({ phone: null, note: null });
    expect(updateCustomerInputSchema.safeParse({}).success).toBe(false);
    expect(updateCustomerInputSchema.safeParse({ name: null }).success).toBe(false);
    expect(updateCustomerInputSchema.safeParse({ fileLabel: "" }).success).toBe(false);
  });

  it("AC-166: liste sorgusu (vars. active/50, q ≥ 2, boş q yok sayılır, üst 100)", () => {
    expect(listCustomersQuerySchema.parse({})).toMatchObject({ status: "active", page: 1, pageSize: 50, sort: "name:asc" });
    expect(listCustomersQuerySchema.parse({ q: "  " }).q).toBeUndefined();
    expect(listCustomersQuerySchema.safeParse({ q: "a" }).success).toBe(false);
    expect(listCustomersQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("AC-166: customerKeys — search_key name_key ile başlar, telefon rakamları", () => {
    const k = customerKeys("ŞİŞLİ Ltd.", "Çağrı Öz", "+905321234567");
    expect(k.nameKey).toBe("sisli ltd.");
    expect(k.searchKey).toBe("sisli ltd. cagri oz 905321234567");
    expect(customerKeys("AB", null, null).searchKey.startsWith("ab")).toBe(true);
  });

  it("AC-175/179: etiketler ve rozet metni", () => {
    expect(CUSTOMER_STATUS_LABELS.PASSIVE).toBe("Pasif");
    expect(CANCEL_REASON_LABELS.CUSTOMER_PASSIVE).toBe("Müşteri pasife alındı");
    expect(viaBindingLabel(null)).toBe("Kayıtlı bilgisayar — Genel");
    expect(SESSION_CSV_COLUMNS.indexOf("Müşteri firma")).toBe(SESSION_CSV_COLUMNS.indexOf("Kaynak") + 1);
  });

  it("AC-176/179/180: filtreler ve oturum oluşturma gövdesi", () => {
    expect(listRequestsQuerySchema.parse({ customer: "general" }).customer).toBe("general");
    expect(listRequestsQuerySchema.safeParse({ customer: "none" }).success).toBe(false);
    expect(listSessionsQuerySchema.parse({ customerFirm: "none" }).customerFirm).toBe("none");
    expect(createSessionInputSchema.parse({})).toEqual({});
    expect(createSessionInputSchema.safeParse({ customerId: "x" }).success).toBe(false);
    expect(createSessionInputSchema.safeParse({ other: 1 }).success).toBe(false);
    expect(CANCEL_REASONS).toEqual(expect.arrayContaining(["CUSTOMER_PASSIVE", "BINDING_REVOKED"]));
  });
});

describe("P8c contracts — bilgisayar kaydı", () => {
  it("AC-185: BINDING_INVALID 404 ve istemci metinleri fixture ile aynı", () => {
    expect(ERROR_STATUS.BINDING_INVALID).toBe(404);
    expect(bx.messages.invalid).toBe(BINDING_INVALID_MESSAGE);
    expect(bx.messages.forgotten).toBe(BINDING_FORGOTTEN_MESSAGE);
    expect(bx.messages.noSource).toBe(BINDING_NO_SOURCE_MESSAGE);
  });

  it("AC-184: anahtar biçimi (rsb_ + 43) — oturum token/ref biçimlerinden ayrı", () => {
    for (const k of bx.validKeys) expect(bindingKeySchema.safeParse(k).success).toBe(true);
    for (const k of bx.invalidKeys) expect(bindingKeySchema.safeParse(k).success).toBe(false);
  });

  it("AC-181: WS binding.* fixture'ları", () => {
    for (const m of bx.valid.guestInbound ?? []) expect(guestInboundSchema.safeParse(m).success).toBe(true);
    for (const m of bx.invalid.guestInbound ?? []) expect(guestInboundSchema.safeParse(m).success).toBe(false);
    for (const m of bx.valid.serverOutbound ?? []) expect(serverOutboundSchema.safeParse(m).success).toBe(true);
    for (const m of bx.invalid.serverOutbound ?? []) expect(serverOutboundSchema.safeParse(m).success).toBe(false);
    for (const m of bx.valid.statusInput ?? []) expect(bindingStatusInputSchema.safeParse(m).success).toBe(true);
    for (const m of bx.invalid.statusInput ?? []) expect(bindingStatusInputSchema.safeParse(m).success).toBe(false);
    for (const m of bx.valid.revokeInput ?? []) expect(bindingRevokeInputSchema.safeParse(m).success).toBe(true);
    for (const m of bx.invalid.revokeInput ?? []) expect(bindingRevokeInputSchema.safeParse(m).success).toBe(false);
  });

  it("AC-182/191: talep gövdesi ref | bindingKey — tam biri; 0.9.1 gövdesi aynen geçer", () => {
    expect(createRequestInputSchema.safeParse({ ...REQ, ref: "abcdefghijklmnop" }).success).toBe(true);
    expect(createRequestInputSchema.safeParse({ ...REQ, bindingKey: KEY }).success).toBe(true);
    expect(createRequestInputSchema.safeParse({ ...REQ, ref: "abcdefghijklmnop", bindingKey: KEY }).success).toBe(false);
    expect(createRequestInputSchema.safeParse(REQ).success).toBe(false);
  });

  it("AC-176: request.new müşteri firma + rozet alanları zorunlu", () => {
    const base = { t: "request.new", id: "01JC0000000000000000000000", requestCode: "123456", customerName: "A", preview: "x", networkMatch: "NONE", knownDevice: false, createdAt: "2026-11-12T10:00:00.000Z" };
    expect(panelOutboundSchema.safeParse(base).success).toBe(false);
    expect(panelOutboundSchema.safeParse({ ...base, customerFirm: { id: "01JC0000000000000000000001", name: "F" }, viaBinding: true, bindingRevoked: false, staleSource: false }).success).toBe(true);
  });
});
