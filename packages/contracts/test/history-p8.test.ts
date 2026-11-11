// P8 oturum geçmişi sözleşmesi: liste sorgusu, PATCH şeması, etiketler (AC-60, 63; mimari-api "Oturum geçmişi (P8)").
import { describe, expect, it } from "vitest";
import { joinSessionInputSchema, listSessionsQuerySchema, updateSessionInputSchema } from "../src/api/sessions.ts";
import { END_REASON_LABELS, describeTimelineEvent, labelOf } from "../src/labels.ts";

describe("listSessionsQuerySchema (AC-60)", () => {
  it("AC-60: varsayılanlar ve geçerli filtreler", () => {
    expect(listSessionsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, sort: "createdAt:desc" });
    const q = listSessionsQuerySchema.parse({ status: "ENDED", mode: "AGENT", from: "2026-01-01", to: "2026-01-31", customer: "  Ayşe ", page: "2", pageSize: "100", sort: "createdAt:asc" });
    expect(q).toMatchObject({ customer: "Ayşe", page: 2, pageSize: 100, mode: "AGENT" });
  });

  it("AC-60: geçersiz girdi reddedilir (bilinmeyen parametre, pageSize > 100, geçersiz gün, from > to, kısa/kontrol karakterli müşteri)", () => {
    const bad = [
      { foo: "1" },
      { pageSize: "101" },
      { page: "0" },
      { from: "2026-02-30" },
      { from: "2026-1-1" },
      { from: "2026-02-02", to: "2026-02-01" },
      { customer: "A" },
      { customer: "Ay‮şe" },
      { mode: "agent" },
      { status: ["ENDED", "ACTIVE"] },
      { sort: "id:desc" },
    ];
    for (const b of bad) expect(listSessionsQuerySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    const r = listSessionsQuerySchema.safeParse({ from: "2026-02-02", to: "2026-02-01" });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toEqual(["to"]);
  });
});

describe("updateSessionInputSchema (AC-63)", () => {
  it("AC-63: ticketNo ≤ 50 (trim), note ≤ 4000, \"\" ve null → null, \\n \\t notta serbest", () => {
    expect(updateSessionInputSchema.parse({ ticketNo: "  INC-1 " })).toEqual({ ticketNo: "INC-1" });
    expect(updateSessionInputSchema.parse({ ticketNo: "", note: "" })).toEqual({ ticketNo: null, note: null });
    expect(updateSessionInputSchema.parse({ note: null })).toEqual({ note: null });
    expect(updateSessionInputSchema.parse({ note: "a\r\nb" })).toEqual({ note: "a\nb" });
    expect(updateSessionInputSchema.parse({ ticketNo: "x".repeat(50), note: "ç".repeat(3998) + "\n\t" }).note).toHaveLength(4000);
  });

  it("AC-63: boş gövde, bilinmeyen alan, uzunluk aşımı, Cc/bidi/sıfır genişlik reddedilir", () => {
    const bad: unknown[] = [
      {},
      { ticketNo: "x".repeat(51) },
      { note: "n".repeat(4001) },
      { note: "x", extra: 1 },
      { ticketNo: "INC\n1" },
      { ticketNo: "INC‮1" },
      { note: "satır\rx" },
      { note: "a​b" },
      { note: "a\u0000b" },
      { ticketNo: 5 },
    ];
    for (const b of bad) expect(updateSessionInputSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe("joinSessionInputSchema.customerName uzunluğu kod noktasıyla (QA-P8-2)", () => {
  const base = { joinNonce: "a".repeat(43), consentTextId: "01HZZZZZZZZZZZZZZZZZZZZZZZ", consentAccepted: true as const };
  const ok = (customerName: string) => joinSessionInputSchema.safeParse({ ...base, customerName }).success;
  it("tek emoji (1 kod noktası) reddedilir; iki emoji ve 100 emoji (200 UTF-16 birimi) kabul; 101 kod noktası red", () => {
    expect(ok("😀")).toBe(false);
    expect(ok("😀😀")).toBe(true);
    expect(ok("😀".repeat(100))).toBe(true);
    expect(ok("a".repeat(101))).toBe(false);
    expect(ok("Al")).toBe(true);
  });
});

describe("labels.ts", () => {
  it("bilinmeyen end_reason ve action ham gösterilir, boş bırakılmaz", () => {
    expect(labelOf(END_REASON_LABELS, "max_duration")).toBe("En uzun süre doldu");
    expect(labelOf(END_REASON_LABELS, "yeni_neden")).toBe("yeni_neden");
    expect(labelOf(END_REASON_LABELS, null)).toBe("");
    expect(labelOf(END_REASON_LABELS, "toString")).toBe("toString");
    expect(describeTimelineEvent({ action: "x.y", details: {} }).label).toBe("x.y");
  });

  it("zaman çizelgesi metinleri (§3 tablo)", () => {
    expect(describeTimelineEvent({ action: "control.requested", details: { request: 2 } }).label).toBe("Kontrol istendi (2/5)");
    expect(describeTimelineEvent({ action: "control.granted", details: { selfElevated: true } })).toEqual({ label: "Kontrol verildi", note: "Müşteri istemcisi yönetici olarak çalışıyordu", warn: true });
    expect(describeTimelineEvent({ action: "control.granted", details: { selfElevated: null } }).note).toBe("Yönetici durumu bilinmiyor");
    expect(describeTimelineEvent({ action: "control.granted", details: { selfElevated: false } }).note).toBeNull();
    expect(describeTimelineEvent({ action: "control.revoked", details: { source: "HOTKEY" } }).label).toBe("Müşteri kapattı (kısayol)");
    expect(describeTimelineEvent({ action: "control.revoked", details: { source: "RECONNECT", side: "tech" } }).label).toBe("Teknisyen bağlantısı koptu");
    expect(describeTimelineEvent({ action: "control.revoked", details: { source: "SYSTEM", reason: "audit" } }).label).toBe("Kayıt yazılamadı — güvenlik için kapatıldı");
    expect(describeTimelineEvent({ action: "control.cancelled", details: { by: "agent" } }).label).toBe("İstek müşteri tarafında bağlantı kesilince kapandı");
    expect(describeTimelineEvent({ action: "monitor.denied", details: { monitorId: 2 } }).label).toBe("Monitör 2 reddedildi");
    expect(describeTimelineEvent({ action: "session.ended", details: { reason: "customer" } }).label).toBe("Oturum bitti (Müşteri bitirdi)");
  });
});
