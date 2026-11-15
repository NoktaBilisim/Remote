// P28a-K1 sözleşmeleri (mimari-p28 §4, §8, §14 r2; AC-343..352, 404). Ortak fikstür `fixtures/clip-print.json` (Go K3 aynı dosya).
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/clip-print.json" with { type: "json" };
import { AUDIT_ACTION_GROUPS } from "../src/api/audit.ts";
import { TIMELINE_ACTIONS } from "../src/api/sessions.ts";
import { CLIP_PRINT_AUDIT, CLIP_PRINT_AUDIT_LABELS } from "../src/audit.ts";
import { CLIP_CHUNK_B64_MAX } from "../src/dc-clip-print.ts";
import { ctlAllowed, parseCtlMessage, type CtlType } from "../src/dc.ts";
import { CLIP_RESULT_LABELS, describeTimelineEvent, PRINT_DECISION_LABELS, PRINT_RESULT_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import * as cp from "../src/ws-clip-print.ts";
import { CAPS, guestInboundSchema, guestInboundSchemaFor, serverOutboundSchema, techInboundSchema } from "../src/ws.ts";

const ALL = new Set<cp.GuestFeature>(["clipboard", "print"]);
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean => schema.safeParse(v).success;
const dc = (v: unknown): boolean => parseCtlMessage(JSON.stringify(v)) !== null;

/** Test içi UTF-8 kodlayıcı (paket lib'inde TextEncoder yok). */
function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const sym = (n: number): string => B64.charAt(n & 63);
function b64(bytes: readonly number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += sym(n >> 18) + sym(n >> 12) + (i + 1 < bytes.length ? sym(n >> 6) : "=") + (i + 2 < bytes.length ? sym(n) : "=");
  }
  return s;
}

describe("P28a yetki anahtarları (AC-404)", () => {
  it("AC-404 remote_control.clipboard ve file_transfer.print tek tanımda, açıklamalı", () => {
    expect(PERMISSION_KEYS).toContain("remote_control.clipboard");
    expect(PERMISSION_KEYS).toContain("file_transfer.print");
    expect(PERMISSION_DESCRIPTIONS["remote_control.clipboard"]).toMatch(/müşteri ayrıca izin verirse/);
    expect(PERMISSION_DESCRIPTIONS["file_transfer.print"]).toMatch(/yalnız Windows/);
  });

  it("AC-404 Admin varsayılan açık, User kapalı; print `file_transfer.use`'dan bağımsız", () => {
    expect(effectivePermissions("ADMIN", [])).toEqual(expect.arrayContaining(["remote_control.clipboard", "file_transfer.print"]));
    expect(effectivePermissions("USER", [])).toEqual([]);
    const user = effectivePermissions("USER", [{ permKey: "file_transfer.print", granted: true }]);
    expect(user).toEqual(["file_transfer.print"]);
  });
});

describe("P28a WS sözleşmesi (fikstür, Go ile ortak)", () => {
  it("AC-343/348 fikstür valid.tech teknisyen şemasından geçer, invalid.tech reddedilir (içerik/ad WS'den geçmez)", () => {
    for (const m of fixture.valid.tech) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fixture.invalid.tech) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(false);
  });

  it("AC-347/351 fikstür valid.guest özellikli misafir şemasından geçer; sunucuya özgü sonuç ve ad/hash reddedilir", () => {
    const s = guestInboundSchemaFor(ALL);
    for (const m of fixture.valid.guest) expect(ok(s, m), JSON.stringify(m)).toBe(true);
    for (const m of fixture.invalid.guest) expect(ok(s, m), JSON.stringify(m)).toBe(false);
  });

  it("AC-352 yeteneksiz sokette clip.*/print.* şema dışı (1008); şema bildirilen özelliğe göre seçilir", () => {
    for (const m of fixture.guestNoFeature) {
      expect(ok(guestInboundSchema, m)).toBe(false);
      expect(ok(guestInboundSchemaFor(new Set()), m)).toBe(false);
      expect(ok(guestInboundSchemaFor(ALL), m)).toBe(true);
    }
    const clipOnly = guestInboundSchemaFor(new Set(["clipboard"]));
    const printOnly = guestInboundSchemaFor(new Set(["print"]));
    expect(ok(clipOnly, { t: "clip.consent", on: true })).toBe(true);
    expect(ok(clipOnly, fixture.guestNoFeature[2])).toBe(false);
    expect(ok(printOnly, fixture.guestNoFeature[2])).toBe(true);
    expect(ok(printOnly, { t: "clip.consent", on: true })).toBe(false);
    // Mevcut misafir mesajları her şemada geçerli kalır (geri uyum).
    for (const s of [guestInboundSchema, clipOnly, printOnly, guestInboundSchemaFor(ALL)]) expect(ok(s, { t: "session.end" })).toBe(true);
  });

  it("AC-343/352 sunucu çıkışı: yeni tipler + guestFeatures/clipConsent; bilinmeyen özellik/caps reddedilir", () => {
    for (const m of fixture.valid.server) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fixture.invalid.server) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(false);
    expect(CAPS).toEqual(["remote_control", "file_transfer", "clipboard", "print"]);
  });

  it("AC-345/348 sabitler fikstürle (Go) aynı; alt protokol belirteçleri ve sonuç kümeleri", () => {
    const c = fixture.constants;
    expect({
      CLIP_MAX_BYTES: cp.CLIP_MAX_BYTES,
      CLIP_CHUNK_BYTES: cp.CLIP_CHUNK_BYTES,
      CLIP_MAX_CHUNKS: cp.CLIP_MAX_CHUNKS,
      CLIP_CHUNK_B64_MAX,
      CLIP_PER_MIN: cp.CLIP_PER_MIN,
      CLIP_PENDING_TIMEOUT_MS: cp.CLIP_PENDING_TIMEOUT_MS,
      CLIP_CONSENT_PER_MIN: cp.CLIP_CONSENT_PER_MIN,
      CLIP_GUEST_DEADLINE_MS: cp.CLIP_GUEST_DEADLINE_MS,
      PRINT_MAX_BYTES: cp.PRINT_MAX_BYTES,
      PRINT_MIN_BYTES: cp.PRINT_MIN_BYTES,
      PDF_MAGIC: cp.PDF_MAGIC,
      PRINT_CONSENT_TIMEOUT_MS: cp.PRINT_CONSENT_TIMEOUT_MS,
      PRINT_PENDING_TIMEOUT_MS: cp.PRINT_PENDING_TIMEOUT_MS,
      PRINT_PER_SESSION: cp.PRINT_PER_SESSION,
      PRINT_DENY_COOLDOWN_MS: cp.PRINT_DENY_COOLDOWN_MS,
      PRINT_GUEST_TRANSFER_DEADLINE_MS: cp.PRINT_GUEST_TRANSFER_DEADLINE_MS,
      ID_REUSE_WINDOW: cp.ID_REUSE_WINDOW,
      PRINT_RENDER_MAX_PX: cp.PRINT_RENDER_MAX_PX,
      PRINT_PIPE_FRAME_MAX: cp.PRINT_PIPE_FRAME_MAX,
      PRINT_MAX_PAGES: cp.PRINT_MAX_PAGES,
      CLIP_PRINT_ID_PATTERN: cp.CLIP_PRINT_ID_PATTERN.source,
    }).toEqual(c);
    expect(cp.CLIP_GUEST_DEADLINE_MS).toBeLessThan(cp.CLIP_PENDING_TIMEOUT_MS);
    expect(cp.PRINT_GUEST_TRANSFER_DEADLINE_MS + cp.PRINT_CONSENT_TIMEOUT_MS).toBeLessThan(cp.PRINT_PENDING_TIMEOUT_MS);
    expect(fixture.subprotocols).toEqual({ clipboard: cp.WS_GUEST_CAP_CLIP, print: cp.WS_GUEST_CAP_PRINT });
    expect(cp.GUEST_FEATURE_BY_SUBPROTOCOL[cp.WS_GUEST_CAP_CLIP]).toBe("clipboard");
    expect(cp.GUEST_FEATURE_BY_SUBPROTOCOL[cp.WS_GUEST_CAP_PRINT]).toBe("print");
    expect(fixture.results).toEqual({
      clip: [...cp.CLIP_RESULTS],
      clipGuest: [...cp.CLIP_GUEST_RESULTS],
      print: [...cp.PRINT_RESULTS],
      printGuest: [...cp.PRINT_GUEST_RESULTS],
      printDecisions: [...cp.PRINT_DECISIONS],
    });
    expect(cp.CLIP_RESULTS).toContain("SENSITIVE");
    expect(cp.PRINT_RESULTS).toContain("CANCELLED");
  });
});

describe("P28a DC sözleşmesi", () => {
  it("AC-345/350 fikstür valid.dc ctl şemasından geçer, invalid.dc reddedilir", () => {
    for (const m of fixture.valid.dc) expect(dc(m), JSON.stringify(m)).toBe(true);
    for (const m of fixture.invalid.dc) expect(dc(m), JSON.stringify(m)).toBe(false);
  });

  it("AC-345 ç ğ ı ö ş ü İ, emoji ve satır sonları: bayt sayısı + 8 KB base64 parçaları fikstürle birebir; her parça şemadan geçer", () => {
    for (const t of fixture.texts) {
      const bytes = utf8(t.text);
      expect(bytes.length, t.name).toBe(t.bytes);
      const chunks = [];
      for (let i = 0; i < bytes.length; i += cp.CLIP_CHUNK_BYTES) {
        const part = bytes.slice(i, i + cp.CLIP_CHUNK_BYTES);
        chunks.push({ seq: i / cp.CLIP_CHUNK_BYTES, last: i + cp.CLIP_CHUNK_BYTES >= bytes.length, b64: b64(part) });
      }
      expect(chunks, t.name).toEqual(t.chunks);
      for (const c of t.chunks) expect(dc({ t: "clip.data", cid: "aZ3_x-Q9LmN0pR7sT2uV1w", ...c })).toBe(true);
    }
    expect(fixture.texts.some((t) => t.chunks.length > 1)).toBe(true);
  });

  it("AC-343/348 misafir yetenek filtresi: clip.* yalnız clipboard, print.* yalnız print caps'iyle", () => {
    const clipT: CtlType[] = ["clip.ready", "clip.data"];
    const printT: CtlType[] = ["print.ready", "print.offer", "print.done"];
    for (const t of clipT) {
      expect(ctlAllowed(t, ["remote_control", "file_transfer", "print"])).toBe(false);
      expect(ctlAllowed(t, ["clipboard"])).toBe(true);
    }
    for (const t of printT) {
      expect(ctlAllowed(t, ["remote_control", "file_transfer", "clipboard"])).toBe(false);
      expect(ctlAllowed(t, ["print"])).toBe(true);
    }
    expect(ctlAllowed("file.offer", ["file_transfer"])).toBe(true);
    expect(ctlAllowed("chat", [])).toBe(true);
  });
});

describe("P28a audit ve etiketler (AC-347, 351)", () => {
  it("AC-347/351 CLIP_PRINT_AUDIT adları, Türkçe etiketleri, audit filtre grupları ve zaman çizelgesi", () => {
    expect(Object.values(CLIP_PRINT_AUDIT).sort()).toEqual(["clipboard.consent", "clipboard.transfer", "print.job"]);
    for (const a of Object.values(CLIP_PRINT_AUDIT)) {
      expect(CLIP_PRINT_AUDIT_LABELS[a]).toBeTruthy();
      expect(TIMELINE_ACTIONS).toContain(a);
    }
    const prefixes = AUDIT_ACTION_GROUPS.map((g) => g.prefix);
    expect(prefixes).toEqual(expect.arrayContaining(["clipboard.*", "print.*"]));
  });

  it("AC-345/349 sonuç etiketleri: her değer Türkçe, AC metinleriyle aynı", () => {
    for (const r of cp.CLIP_RESULTS) expect(CLIP_RESULT_LABELS[r]).toBeTruthy();
    for (const r of cp.PRINT_RESULTS) expect(PRINT_RESULT_LABELS[r]).toBeTruthy();
    for (const d of cp.PRINT_DECISIONS) expect(PRINT_DECISION_LABELS[d]).toBeTruthy();
    expect(CLIP_RESULT_LABELS.TOO_LARGE).toBe("Pano metni 64 KB sınırını aşıyor");
    expect(CLIP_RESULT_LABELS.EMPTY).toBe("Panoda metin yok");
    expect(CLIP_RESULT_LABELS.SENSITIVE).toBe("Pano içeriği gizli olarak işaretli, aktarılmadı");
    expect(PRINT_RESULT_LABELS.TIMEOUT).toBe("Müşteri yanıt vermedi");
    expect(PRINT_RESULT_LABELS.CANCELLED).toBe("Yazdırma iptal edildi");
  });

  it("AC-347/351 zaman çizelgesi metni yalnız sayı/sonuç gösterir", () => {
    expect(describeTimelineEvent({ action: "clipboard.consent", details: { on: true, by: "customer" } }).label).toBe(
      "Müşteri pano iznini açtı",
    );
    expect(
      describeTimelineEvent({ action: "clipboard.consent", details: { on: false, by: "system", reason: "control_closed" } }).label,
    ).toBe("Pano izni kendiliğinden kapandı");
    const tr = describeTimelineEvent({ action: "clipboard.transfer", details: { direction: "TO_TECH", bytes: 12, result: "SENSITIVE" } });
    expect(tr).toEqual({ label: "Müşteri panosu alındı (12 bayt)", note: "Pano içeriği gizli olarak işaretli, aktarılmadı", warn: false });
    const pj = describeTimelineEvent({
      action: "print.job",
      details: { decision: "APPROVED", pages: 3, sizeBytes: 100, result: "PRINTED" },
    });
    expect(pj).toEqual({ label: "Uzaktan yazdırma (3 sayfa)", note: "Yazıcıya gönderildi", warn: false });
  });
});
