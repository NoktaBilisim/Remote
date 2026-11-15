// P18 H2 sözleşme testleri (mimari-e11 §8b.3, §8b.5; AC-256..258; S-P18-T3).
import { describe, expect, it } from "vitest";
import {
  assignRequestInputSchema,
  businessHoursSchema,
  compareQueue,
  holidayInputSchema,
  isValidTimeZone,
  listRequestsQuerySchema,
  priorityInputSchema,
  slaBreachedAt,
  updateRequestSettingsInputSchema,
} from "../src/api/requests.ts";
import { createCustomerInputSchema, updateCustomerInputSchema } from "../src/api/customers.ts";
import { userOptionsQuerySchema } from "../src/api/users.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { TR_HOLIDAYS, TR_HOLIDAY_YEARS } from "../src/holidays-tr.ts";
import { PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, effectivePermissions } from "../src/permissions.ts";
import { panelOutboundSchema } from "../src/ws-request.ts";

const day = (from: string, to: string) => [{ from, to }];
const week = (d: { from: string; to: string }[]) => [d, d, d, d, d, [], []];
const hours = (o: Record<string, unknown> = {}) => ({
  enabled: true,
  timeZone: "Europe/Istanbul",
  afterHoursMode: "REJECT",
  week: week(day("09:00", "18:00")),
  ...o,
});

describe("AC-257 kuyruk sırası (compareQueue, K-P18-4)", () => {
  const r = (id: string, priority: string, createdAt: string) => ({ id, priority, createdAt });
  it("AC-257: HIGH sonra gelse de önde; aynı öncelikte FIFO; eşit anda id", () => {
    const q = [
      r("A", "NORMAL", "2026-11-16T10:00:00.000Z"),
      r("B", "LOW", "2026-11-16T09:00:00.000Z"),
      r("C", "HIGH", "2026-11-16T11:00:00.000Z"),
      r("E", "NORMAL", "2026-11-16T10:00:00.000Z"),
      r("D", "NORMAL", "2026-11-16T09:30:00.000Z"),
    ].sort(compareQueue);
    expect(q.map((x) => x.id)).toEqual(["C", "D", "A", "E", "B"]);
    expect(compareQueue(r("X", "BILINMEYEN", "2026-11-16T09:00:00.000Z"), r("Y", "NORMAL", "2026-11-16T10:00:00.000Z"))).toBeLessThan(0);
  });
});

describe("AC-257 slaBreachedAt sınırları (K-P18-5)", () => {
  const due = "2026-11-16T10:00:00.000Z";
  const at = Date.parse(due);
  it("AC-257: tam due anı aşım değil, +1 ms aşım; SLA yoksa false", () => {
    expect(slaBreachedAt({ status: "PENDING", slaDueAt: due, closedAt: null }, at)).toBe(false);
    expect(slaBreachedAt({ status: "PENDING", slaDueAt: due, closedAt: null }, at + 1)).toBe(true);
    expect(slaBreachedAt({ status: "PENDING", slaDueAt: null, closedAt: null }, at + 1e9)).toBe(false);
  });
  it("AC-257: kapalı talepte bitiş = acceptedAt ?? closedAt (şimdiki zaman değil)", () => {
    expect(slaBreachedAt({ status: "ACCEPTED", slaDueAt: due, closedAt: due, acceptedAt: due }, at + 1e9)).toBe(false);
    expect(slaBreachedAt({ status: "EXPIRED", slaDueAt: due, closedAt: "2026-11-16T10:00:00.001Z" }, at)).toBe(true);
    expect(slaBreachedAt({ status: "ACCEPTED", slaDueAt: new Date(at), closedAt: new Date(at + 5), acceptedAt: new Date(at - 5) }, 0)).toBe(
      false,
    );
  });
});

describe("AC-258 businessHoursSchema", () => {
  it('AC-258: geçerli hafta; "24:00" bitiş kabul; aralık sırası serbest', () => {
    expect(businessHoursSchema.safeParse(hours()).success).toBe(true);
    expect(businessHoursSchema.safeParse(hours({ week: week(day("00:00", "24:00")) })).success).toBe(true);
    expect(
      businessHoursSchema.safeParse(
        hours({
          week: week([
            { from: "13:00", to: "18:00" },
            { from: "09:00", to: "12:00" },
          ]),
        }),
      ).success,
    ).toBe(true);
    expect(businessHoursSchema.safeParse(hours({ enabled: false, week: week([]) })).success).toBe(true);
  });
  it.each([
    ["from 24:00", hours({ week: week(day("24:00", "24:00")) })],
    ["to ≤ from", hours({ week: week(day("10:00", "09:00")) })],
    [
      "örtüşme",
      hours({
        week: week([
          { from: "09:00", to: "12:00" },
          { from: "11:00", to: "13:00" },
        ]),
      }),
    ],
    ["3 aralık", hours({ week: week([...day("01:00", "02:00"), ...day("03:00", "04:00"), ...day("05:00", "06:00")]) })],
    ["6 gün", hours({ week: week(day("09:00", "18:00")).slice(0, 6) })],
    ["açık ama hiç aralık yok", hours({ week: week([]) })],
    ["geçersiz saat dilimi", hours({ timeZone: "Mars/Olympus" })],
    ["bilinmeyen mod", hours({ afterHoursMode: "QUEUE" })],
    ["fazladan alan", hours({ extra: 1 })],
  ])("AC-258: reddedilir — %s", (_n, body) => {
    expect(businessHoursSchema.safeParse(body).success).toBe(false);
  });
  it("AC-258: saat dilimi IANA listesinden (UTC dahil), DB biçimi dışı ret", () => {
    expect(isValidTimeZone("Europe/Istanbul")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Istanbul; DROP")).toBe(false);
  });
});

describe("AC-258 tatil girdisi + TR listesi", () => {
  it("AC-258: gün/ad/openUntil kuralları", () => {
    expect(holidayInputSchema.safeParse({ day: "2026-10-28", name: " Arife ", openUntil: "13:00" }).data?.name).toBe("Arife");
    expect(holidayInputSchema.safeParse({ day: "2026-02-30", name: "x", openUntil: null }).success).toBe(false);
    expect(holidayInputSchema.safeParse({ day: "2026-10-28", name: "", openUntil: null }).success).toBe(false);
    expect(holidayInputSchema.safeParse({ day: "2026-10-28", name: "a‮b", openUntil: null }).success).toBe(false);
    expect(holidayInputSchema.safeParse({ day: "2026-10-28", name: "x", openUntil: "00:00" }).success).toBe(false);
    expect(holidayInputSchema.safeParse({ day: "2026-10-28", name: "x", openUntil: "24:00" }).success).toBe(false);
  });
  it("AC-258: 2026 ve 2027 listesi — günler tekil, şemadan geçer, arifeler 13:00", () => {
    expect(TR_HOLIDAY_YEARS).toEqual([2026, 2027]);
    for (const y of TR_HOLIDAY_YEARS) {
      const list = TR_HOLIDAYS[y] ?? [];
      expect(new Set(list.map((h) => h.day)).size).toBe(list.length);
      for (const h of list) {
        expect(holidayInputSchema.safeParse(h).success, h.day).toBe(true);
        expect(h.day.startsWith(String(y))).toBe(true);
        if (h.name.includes("arifesi")) expect(h.openUntil).toBe("13:00");
      }
      expect(list.filter((h) => h.name.includes("arifesi"))).toHaveLength(3);
    }
  });
});

describe("AC-256/257 girdi şemaları ve yetkiler", () => {
  it("AC-256: assign userId ULID | null; priority enum; liste `assigned` yalnız pending", () => {
    expect(assignRequestInputSchema.safeParse({ userId: null }).success).toBe(true);
    expect(assignRequestInputSchema.safeParse({ userId: "x" }).success).toBe(false);
    expect(priorityInputSchema.safeParse({ priority: "URGENT" }).success).toBe(false);
    expect(listRequestsQuerySchema.safeParse({ tab: "pending", assigned: "me" }).success).toBe(true);
    expect(listRequestsQuerySchema.safeParse({ tab: "history", assigned: "me" }).success).toBe(false);
    expect(userOptionsQuerySchema.parse({ assignable: "1" }).assignable).toBe(true);
  });
  it("AC-257: talep ayarı defaultPriority/defaultSlaMinutes opsiyonel (eski gövde geçerli), 5..1440", () => {
    const base = {
      waitMinutes: 30,
      trustedCidrs: [],
      whatsapp: { enabled: false, recipients: [] },
      email: { enabled: false, recipients: [] },
    };
    expect(updateRequestSettingsInputSchema.safeParse(base).success).toBe(true);
    expect(updateRequestSettingsInputSchema.safeParse({ ...base, defaultPriority: "HIGH", defaultSlaMinutes: 5 }).success).toBe(true);
    expect(updateRequestSettingsInputSchema.safeParse({ ...base, defaultSlaMinutes: 4 }).success).toBe(false);
    expect(updateRequestSettingsInputSchema.safeParse({ ...base, defaultSlaMinutes: 1441 }).success).toBe(false);
    expect(createCustomerInputSchema.safeParse({ name: "Acme", defaultPriority: "LOW", slaMinutes: 60 }).success).toBe(true);
    expect(updateCustomerInputSchema.safeParse({ slaMinutes: null }).success).toBe(true);
    expect(updateCustomerInputSchema.safeParse({ slaMinutes: 2000 }).success).toBe(false);
  });
  it("S-P18-T3: support_requests.assign ve .message tek tanımda; ADMIN açık, USER kapalı; açıklamalı", () => {
    expect(PERMISSION_KEYS).toContain("support_requests.assign");
    expect(PERMISSION_KEYS).toContain("support_requests.message");
    expect(effectivePermissions("ADMIN", [])).toEqual(expect.arrayContaining(["support_requests.assign", "support_requests.message"]));
    expect(effectivePermissions("USER", [])).not.toContain("support_requests.assign");
    expect(PERMISSION_DESCRIPTIONS["support_requests.message"]).toBe("Bekleyen talepte müşteriye mesaj yazar.");
    expect(ERROR_STATUS.OUTSIDE_HOURS).toBe(409);
    expect(ERROR_STATUS.CHAT_UNSUPPORTED).toBe(409);
  });
  it("AC-256: panel request.updated; request.new yeni alanlar opsiyonel (eski sekme/fikstür)", () => {
    const id = "01JC0000000000000000000000";
    expect(panelOutboundSchema.safeParse({ t: "request.updated", id, priority: "HIGH", assignedTo: null, slaDueAt: null }).success).toBe(
      true,
    );
    expect(panelOutboundSchema.safeParse({ t: "request.updated", id, priority: "HIGH", assignedTo: null }).success).toBe(false);
  });
});
