import { PERMISSION_MODULES } from "@remote/contracts/permissions";
import { describe, expect, it } from "vitest";
import { buildCreate, buildPatch, draftOf, emptyDraft } from "./customers/form";
import type { CustomerDetail } from "./customers/contract";
import { parsePanelMessage, type SupportRequestItem } from "./requests/contract";
import {
  buildHoliday,
  buildHours,
  copyMondayToWeekdays,
  filterTimeZones,
  hoursDirty,
  holidayYears,
  toHoursState,
} from "./requests/business-hours";
import {
  applyUpdate,
  closedSlaView,
  formatSlaRemaining,
  matchesAssigned,
  parseAssigned,
  serverOffset,
  slaView,
  sortQueue,
  withP18Defaults,
} from "./requests/p18";
import { checkMessageBody, mergeMessages, newClientMsgId } from "./requests/thread";
import { actionLabel, buildMatrix } from "./users/permissions";

const ME = "01JUSRQ0000000000000000001";
const OTHER = "01JUSRQ0000000000000000002";
const it0 = (o: Partial<SupportRequestItem>): SupportRequestItem =>
  withP18Defaults({
    id: "01JRQ00000000000000000000A",
    requestCode: "123456",
    networkMatch: "NONE",
    knownDevice: false,
    status: "PENDING",
    cancelReason: null,
    createdAt: "2026-11-15T10:00:00.000Z",
    closedAt: null,
    waitSec: 0,
    customerName: "A",
    customerPhone: null,
    customerEmail: null,
    description: null,
    clientVersion: "0.11.0",
    acceptedBy: null,
    rejectMessage: null,
    sessionId: null,
    customerFirm: null,
    viaBinding: false,
    bindingRevoked: false,
    staleSource: false,
    ...o,
  } as SupportRequestItem);

describe("AC-257: kuyruk sırası compareQueue ile", () => {
  it("AC-257: yüksek öncelik sonra gelse de önde; aynı öncelikte FIFO", () => {
    const a = it0({ id: "01JRQ00000000000000000000A", createdAt: "2026-11-15T10:00:00.000Z" });
    const b = it0({ id: "01JRQ00000000000000000000B", createdAt: "2026-11-15T10:05:00.000Z", priority: "HIGH" });
    const c = it0({ id: "01JRQ00000000000000000000C", createdAt: "2026-11-15T09:00:00.000Z", priority: "LOW" });
    const d = it0({ id: "01JRQ00000000000000000000D", createdAt: "2026-11-15T10:01:00.000Z" });
    expect(sortQueue([a, c, d, b]).map((x) => x.id.at(-1))).toEqual(["B", "A", "D", "C"]);
  });
  it("AC-256/257: request.updated öncelik + atama uygular ve yeniden sıralar; filtreye uymayan düşer", () => {
    const a = it0({ id: "01JRQ00000000000000000000A" });
    const b = it0({ id: "01JRQ00000000000000000000B", createdAt: "2026-11-15T10:05:00.000Z" });
    const u = { id: b.id, priority: "HIGH" as const, assignedTo: { id: OTHER, name: "Can" }, slaDueAt: null };
    const r = applyUpdate([a, b], u, undefined, ME);
    expect(r.items.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(r.items[0]!.assignedTo?.name).toBe("Can");
    expect(applyUpdate([a, b], u, "none", ME).items.map((x) => x.id)).toEqual([a.id]);
    expect(applyUpdate([a], { ...u, assignedTo: { id: ME, name: "Ben" } }, "me", ME).missing).toBe(true);
    expect(applyUpdate([a], u, undefined, ME).missing).toBe(false);
  });
  it("AC-256: atama filtresi", () => {
    expect(parseAssigned("me")).toBe("me");
    expect(parseAssigned(["none"])).toBe("none");
    expect(parseAssigned("x")).toBeUndefined();
    expect(matchesAssigned({ assignedTo: null }, "none", ME)).toBe(true);
    expect(matchesAssigned({ assignedTo: { id: ME, name: "x" } }, "me", ME)).toBe(true);
    expect(matchesAssigned({ assignedTo: { id: OTHER, name: "x" } }, "me", ME)).toBe(false);
  });
  it("eski veri: P18 alanı yoksa NORMAL / atanmamış / SLA yok", () => {
    const x = withP18Defaults({ id: "x" } as SupportRequestItem);
    expect([x.priority, x.assignedTo, x.slaDueAt, x.slaBreached, x.afterHours]).toEqual(["NORMAL", null, null, false, false]);
  });
});

describe("AC-257: SLA göstergesi (sunucu saati ofsetiyle)", () => {
  const due = "2026-11-15T10:10:00.000Z";
  const dueMs = Date.parse(due);
  it("AC-257: tam hedef anı aşım değil, +1 ms aşım; sunucu bayrağı her zaman aşım", () => {
    expect(slaView(it0({ slaDueAt: due }), dueMs, 0)).toEqual({ kind: "remaining", ms: 0 });
    expect(slaView(it0({ slaDueAt: due }), dueMs + 1, 0).kind).toBe("breached");
    expect(slaView(it0({ slaDueAt: due }), dueMs - 65_000, 0)).toEqual({ kind: "remaining", ms: 65_000 });
    expect(slaView(it0({ slaDueAt: due, slaBreached: true }), dueMs - 1000, 0).kind).toBe("breached");
    expect(slaView(it0({}), dueMs, 0).kind).toBe("none");
    expect(slaView(it0({ slaDueAt: due }), null, 0)).toEqual({ kind: "due", at: due });
  });
  it("AC-257: ofset istemci saatini sunucuya hizalar", () => {
    // istemci saati 60 sn geride: sunucuda hedef geçti
    expect(slaView(it0({ slaDueAt: due }), dueMs - 30_000, 60_000).kind).toBe("breached");
    const items = [it0({ createdAt: "2026-11-15T10:00:00.000Z", waitSec: 120 })];
    expect(serverOffset(items, Date.parse("2026-11-15T10:01:00.000Z"))).toBe(60_000);
    expect(serverOffset([], 0)).toBe(0);
    expect(serverOffset(items, Date.parse("2030-01-01T00:00:00.000Z"))).toBe(0);
  });
  it("kalan süre metni", () => {
    expect(formatSlaRemaining(3_900_000)).toBe("1 sa 05 dk");
    expect(formatSlaRemaining(249_000)).toBe("4 dk 09 sn");
    expect(formatSlaRemaining(12_400)).toBe("12 sn");
  });
});

describe("AC-255: mesaj gövdesi ve yazışma birleştirme (S-P18-T8)", () => {
  it("AC-255: contracts requestMessageBodySchema ile — NFC + trim, 1..1000 kod noktası, ≤ 20 satır, Cc/Cf yok", () => {
    expect(checkMessageBody("  merhaba \n")).toEqual({ ok: true, body: "merhaba" });
    expect(checkMessageBody("   ")).toMatchObject({ ok: false, empty: true });
    expect(checkMessageBody("ş".repeat(1000)).ok).toBe(true);
    expect(checkMessageBody("a".repeat(1001))).toMatchObject({ ok: false, empty: false, message: expect.stringMatching(/1000/) });
    expect(checkMessageBody(Array(21).fill("x").join("\n"))).toMatchObject({ ok: false, message: expect.stringMatching(/20 satır/) });
    expect(checkMessageBody("a\u202Eb").ok).toBe(false);
    expect(checkMessageBody("a\u0007b").ok).toBe(false);
    expect(checkMessageBody("e\u0301")).toEqual({ ok: true, body: "é" });
  });
  it("clientMsgId biçimi", () => {
    for (let i = 0; i < 20; i++) expect(newClientMsgId()).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
  });
  it("yankı: iyimser satır sonda; sunucu satırları tekil ve sıralı", () => {
    const m = (id: string, at: string) => ({ id, sender: "CUSTOMER" as const, senderName: null, body: id, createdAt: at });
    const cur = [m("01A", "2026-11-15T10:00:00Z"), { ...m("tmp-1", "2026-11-15T10:02:00Z"), pending: "sending" as const }];
    const out = mergeMessages(cur, [m("01B", "2026-11-15T10:01:00Z"), m("01A", "2026-11-15T10:00:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["01A", "01B", "tmp-1"]);
  });
  it("panel request.activity (contracts) ayrıştırılır; gövde taşıyan sürüm reddedilir", () => {
    const ok = {
      t: "request.activity",
      id: "01JRQ00000000000000000000A",
      kind: "message",
      sender: "CUSTOMER",
      at: "2026-11-15T10:00:00.000Z",
    };
    expect(parsePanelMessage(JSON.stringify(ok))?.t).toBe("request.activity");
    expect(parsePanelMessage(JSON.stringify({ ...ok, body: "x" }))).toBeNull();
    const upd = { t: "request.updated", id: ok.id, priority: "HIGH", assignedTo: null, slaDueAt: null };
    expect(parsePanelMessage(JSON.stringify(upd))?.t).toBe("request.updated");
  });
});

describe("AC-258: mesai saatleri ve tatil formu", () => {
  const view = {
    enabled: true,
    timeZone: "Europe/Istanbul",
    afterHoursMode: "ACCEPT" as const,
    week: [[{ from: "09:00", to: "18:00" }], [], [], [], [], [], []],
  };
  it("AC-258: geçerli takvim + 24:00; hata yolları alan anahtarına", () => {
    const st = toHoursState(view);
    expect(buildHours({ ...st, week: st.week.map((d, i) => (i === 5 ? [{ from: "10:00", to: "24:00" }] : d)) }).input?.week[5]).toEqual([
      { from: "10:00", to: "24:00" },
    ]);
    const bad = buildHours({ ...st, week: st.week.map((d, i) => (i === 2 ? [{ from: "18:00", to: "09:00" }] : d)) });
    expect(bad.errors["week.2.0.to"]).toBeTruthy();
    expect(buildHours({ ...st, week: st.week.map(() => []) }).errors.week).toMatch(/en az bir/);
    expect(buildHours({ ...st, timeZone: "Mars/Olympus" }).errors.timeZone).toBe("Geçersiz saat dilimi");
    expect(buildHours({ ...st, enabled: false, week: st.week.map(() => []) }).input).toBeTruthy();
  });
  it("kirli algısı, hafta içine kopyalama, saat dilimi araması", () => {
    const st = toHoursState(view);
    expect(hoursDirty(st, toHoursState(view))).toBe(false);
    const c = copyMondayToWeekdays(st);
    expect(c.week.slice(0, 5).every((d) => d.length === 1)).toBe(true);
    expect(c.week[5]).toEqual([]);
    expect(hoursDirty(c, st)).toBe(true);
    expect(filterTimeZones(["Europe/Istanbul", "America/New_York"], "new york")).toEqual(["America/New_York"]);
  });
  it("tatil girdisi: boş kapanış = tam gün; geçersiz alanlar", () => {
    expect(buildHoliday({ day: "2026-10-28", name: " Arife ", openUntil: "13:00" }).input).toEqual({
      day: "2026-10-28",
      name: "Arife",
      openUntil: "13:00",
    });
    expect(buildHoliday({ day: "2026-01-01", name: "Yılbaşı", openUntil: "" }).input?.openUntil).toBeNull();
    const e = buildHoliday({ day: "2026-02-30", name: "", openUntil: "25:00" }).errors;
    expect(Object.keys(e).sort()).toEqual(["day", "name", "openUntil"]);
    expect(holidayYears(2026)).toEqual(expect.arrayContaining([2025, 2026, 2027, 2028]));
  });
});

describe("AC-257: müşteri formu öncelik/SLA", () => {
  it("AC-257: oluşturmada boş = gönderilmez; değer → gövde; geçersiz SLA alan hatası", () => {
    expect(buildCreate({ ...emptyDraft(), name: "Acme" })).toEqual({ ok: true, body: { name: "Acme" } });
    expect(buildCreate({ ...emptyDraft(), name: "Acme", defaultPriority: "HIGH", slaMinutes: "60" })).toEqual({
      ok: true,
      body: { name: "Acme", defaultPriority: "HIGH", slaMinutes: 60 },
    });
    const bad = buildCreate({ ...emptyDraft(), name: "Acme", slaMinutes: "2" });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.slaMinutes).toMatch(/5–1440/);
  });
  it("AC-257: düzenlemede firma varsayılanına dönüş null gönderir", () => {
    const c = { id: "x", name: "Acme", fileLabel: "Acme", defaultPriority: "LOW", slaMinutes: 30 } as unknown as CustomerDetail;
    const d = draftOf(c);
    expect(d.defaultPriority).toBe("LOW");
    expect(buildPatch({ ...d, defaultPriority: "", slaMinutes: "" }, c)).toEqual({
      ok: true,
      body: { defaultPriority: null, slaMinutes: null },
    });
    expect(buildPatch(d, c)).toEqual({ ok: true, body: {} });
  });
});

describe("S-P18-T3: yeni yetkiler toggle ekranında otomatik", () => {
  it("S-P18-T3: support_requests.assign ve .message matriste, etiketli", () => {
    const sr = buildMatrix(PERMISSION_MODULES).find((r) => r.module === "support_requests")!;
    expect(sr.other.map((o) => o.key)).toEqual(expect.arrayContaining(["support_requests.assign", "support_requests.message"]));
    expect(actionLabel("assign")).toBe("Ata / öncelik");
    expect(actionLabel("message")).toBe("Mesaj yaz");
  });
});

describe("§8b.8 geçmiş detayı SLA satırı (closedSlaView)", () => {
  const due = "2026-11-15T10:10:00.000Z";
  it("hedef yok → none (satır gösterilmez)", () => {
    expect(closedSlaView({ slaDueAt: null, slaBreached: null })).toEqual({ kind: "none" });
    expect(closedSlaView({ slaDueAt: null, slaBreached: true })).toEqual({ kind: "none" });
  });
  it("sunucu kararı aynen: true → aşıldı, false → içinde", () => {
    expect(closedSlaView({ slaDueAt: due, slaBreached: true })).toEqual({ kind: "breached" });
    expect(closedSlaView({ slaDueAt: due, slaBreached: false })).toEqual({ kind: "met" });
  });
  it("hedef var, karar null → yalnız hedef saati", () => {
    expect(closedSlaView({ slaDueAt: due, slaBreached: null })).toEqual({ kind: "due", at: due });
  });
});
