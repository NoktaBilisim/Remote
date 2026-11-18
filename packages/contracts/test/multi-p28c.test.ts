// P28c-K0 sözleşme testleri (mimari-p28c r2 §4, §9; AC-364..372). Fikstür `fixtures/multi.json` Go (internal/signal) ile ortaktır.
import { describe, expect, expectTypeOf, it } from "vitest";
import fx from "../fixtures/multi.json" with { type: "json" };
import {
  createInviteInputSchema,
  inviteIdSchema,
  joinWithReasonInputSchema,
  MULTI_ERROR_MESSAGES,
  sessionInviteParamsSchema,
} from "../src/api/multi.ts";
import {
  MULTI_AUDIT,
  MULTI_AUDIT_GROUP,
  MULTI_AUDIT_LABELS,
  MULTI_INVITE_EXPIRE_REASON_LABELS,
  MULTI_INVITE_EXPIRE_REASONS,
  MULTI_LEAVE_REASON_LABELS,
  MULTI_LEAVE_REASONS,
  SILENT_NOTIFY_EVENT_LABELS,
  SILENT_NOTIFY_EVENTS,
} from "../src/audit.ts";
import { chatSchema } from "../src/dc.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { FSRV_GATE_REASON_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import * as multi from "../src/ws-multi.ts";
import { guestInboundSchemaFor, serverOutboundSchema, techInboundSchema, WS_CLOSE, type TechInbound } from "../src/ws.ts";

type Schema = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: Schema, v: unknown) => s.safeParse(v).success;
const guestMulti = guestInboundSchemaFor(new Set(), false, false, true);
const guestPlain = guestInboundSchemaFor(new Set(), false, false, false);
const techTypes = techInboundSchema.options.map((o) => o.shape.t.value as string).sort();

describe("P28c yetkiler ve hata kodları", () => {
  it("AC-364/368: sessions.invite + sessions.supervise tek tanımdan; Admin açık, User kapalı; açıklamalar", () => {
    for (const k of ["sessions.invite", "sessions.supervise"] as const) {
      expect(PERMISSION_KEYS).toContain(k);
      expect(effectivePermissions("ADMIN", [])).toContain(k);
      expect(effectivePermissions("USER", [])).not.toContain(k);
      expect(PERMISSION_DESCRIPTIONS[k]).toBeTruthy();
    }
    expect(PERMISSION_DESCRIPTIONS["sessions.supervise"]).toContain("hassas");
  });

  it("AC-365/372: SESSION_FULL, CLIENT_UNSUPPORTED, JOIN_NOT_ALLOWED 409; INVITE_GONE 410; Türkçe metinler", () => {
    expect(ERROR_STATUS.SESSION_FULL).toBe(409);
    expect(ERROR_STATUS.CLIENT_UNSUPPORTED).toBe(409);
    expect(ERROR_STATUS.JOIN_NOT_ALLOWED).toBe(409);
    expect(ERROR_STATUS.INVITE_GONE).toBe(410);
    expect(ERROR_STATUS.MFA_SETUP_REQUIRED).toBe(403);
    expect(MULTI_ERROR_MESSAGES.SESSION_FULL).toBe("Oturum dolu");
    expect(MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED).toBe(FSRV_GATE_REASON_LABELS.UNSUPPORTED);
    expect(MULTI_ERROR_MESSAGES.INVITE_GONE).toBe("Davet artık geçerli değil");
    expect(MULTI_ERROR_MESSAGES.JOIN_NOT_ALLOWED).toBe("İzinli gözetimsiz bağlantıya ek teknisyen katılamaz");
  });
});

describe("P28c sabitler (fikstür — Go aynı dosyayı okur)", () => {
  it("AC-365/371: fikstür constants sözleşme sabitleriyle aynı; belirteç ve kapanış kodu", () => {
    const mod = multi as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(fx.constants)) {
      const actual = mod[k];
      expect(actual instanceof RegExp ? actual.source : actual, k).toEqual(v);
    }
    expect(fx.subprotocols.multi).toBe(multi.WS_CAP_MULTI);
    expect(WS_CLOSE.REMOVED).toBe(4403);
    expect(fx.sets).toEqual({
      rosterRoles: multi.ROSTER_ROLES,
      techRoles: multi.TECH_ROLES,
      memberRoles: multi.MEMBER_ROLES,
    });
  });
});

describe("P28c WS protokolü", () => {
  it("AC-366/372: multi1 misafir — sdp.answer/ice `to` zorunlu, tech.remove kabul; belirteçsiz sokette şema dışı", () => {
    for (const m of fx.valid.guestInbound) {
      expect(ok(guestMulti, m), JSON.stringify(m)).toBe(true);
      expect(ok(guestPlain, m), JSON.stringify(m)).toBe(false);
    }
    for (const m of fx.invalid.guestInbound) expect(ok(guestMulti, m), JSON.stringify(m)).toBe(false);
    // Eski (to'suz) yanıt yalnız belirteçsiz sokette geçer.
    expect(ok(guestPlain, { t: "sdp.answer", sdp: "v=0" })).toBe(true);
    // Tam şema (31) pano/yazdırma/fsrv/rec + multi birlikte.
    const full = guestInboundSchemaFor(new Set(["clipboard", "print"]), true, true, true);
    expect(ok(full, fx.valid.guestInbound[0])).toBe(true);
    expect(ok(full, { t: "rec.revoke" })).toBe(true);
    expect(ok(full, { t: "sdp.answer", sdp: "v=0" })).toBe(false);
  });

  it("AC-366: misafire giden roster (1..3, tid benzersiz, tek sahip, tek kontrol sahibi, userId yok) ve from'lu sdp/ice", () => {
    for (const m of fx.valid.guestOutbound) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.guestOutbound) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(false);
  });

  it("AC-367/369: teknisyen control.handover / session.transfer {to: tid}, member.leave; tech.remove teknisyenden reddedilir", () => {
    for (const m of fx.valid.techInbound) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.techInbound) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(false);
  });

  it("AC-366: teknisyen hello tid/techRole/roster ekleri; role (tech|guest) değişmez", () => {
    for (const m of fx.valid.techOutbound) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(true);
    // techRole "controller" değildir (kontrol sahipliği roster'da); role yeni değer almaz.
    for (const m of fx.invalid.techOutbound) expect(ok(serverOutboundSchema, m), JSON.stringify(m)).toBe(false);
  });

  it("D-PC-4: DC sohbeti `by` yalnız tid (ad taşımaz)", () => {
    for (const m of fx.valid.dcChat) expect(ok(chatSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.dcChat) expect(ok(chatSchema, m), JSON.stringify(m)).toBe(false);
  });
});

describe("P28c rol kapısı ROLE_MAY (D-PC-6 varsayılan-ret)", () => {
  it("AC-368: ROLE_MAY anahtarları teknisyen mesaj birliğinin TAMAMI (eksik/fazla yok)", () => {
    expect(Object.keys(multi.ROLE_MAY).sort()).toEqual(techTypes);
    // Tip düzeyi: her iki yön kapsanır.
    expectTypeOf<TechInbound["t"]>().toEqualTypeOf<multi.RoleMayType>();
  });

  it("AC-367/368: izleyici/katılımcı yalnız sdp.offer, ice, ice.restart, member.leave (+ P28d: katılımcı voice.*); bilinmeyen tip herkese kapalı", () => {
    const observer = { owner: false, controller: false, observer: true };
    expect(techTypes.filter((t) => multi.seatMay(t, observer)).sort()).toEqual(["ice", "ice.restart", "member.leave", "sdp.offer"]);
    const member = { owner: false, controller: false, observer: false };
    const allowed = techTypes.filter((t) => multi.seatMay(t, member));
    expect(allowed.sort()).toEqual(["ice", "ice.restart", "member.leave", "sdp.offer", "voice.end", "voice.join", "voice.request"]);
    const controllerMember = { owner: false, controller: true, observer: false };
    expect(multi.seatMay("control.request", controllerMember)).toBe(true);
    expect(multi.seatMay("clip.push", controllerMember)).toBe(true);
    expect(multi.seatMay("control.handover", controllerMember)).toBe(false);
    const ownerNotController = { owner: true, controller: false, observer: false };
    expect(multi.seatMay("control.handover", ownerNotController)).toBe(true);
    expect(multi.seatMay("session.transfer", ownerNotController)).toBe(true);
    expect(multi.seatMay("session.end", ownerNotController)).toBe(true);
    expect(multi.seatMay("control.request", ownerNotController)).toBe(false);
    expect(multi.seatMay("member.leave", ownerNotController)).toBe(false);
    const all = { owner: true, controller: true, observer: false };
    expect(multi.seatMay("bilinmeyen.tip", all)).toBe(false);
    expect(multi.seatMay("toString", all)).toBe(false);
  });
});

describe("P28c REST şemaları", () => {
  it("AC-364: davet girdisi ULID; davet kimliği 22 karakter base64url; ekstra alan reddedilir", () => {
    expect(ok(createInviteInputSchema, { userId: "01JD0000000000000000000001" })).toBe(true);
    expect(ok(createInviteInputSchema, { userId: "x" })).toBe(false);
    expect(ok(createInviteInputSchema, { userId: "01JD0000000000000000000001", role: "observer" })).toBe(false);
    for (const v of fx.rest.validInviteIds) expect(ok(inviteIdSchema, v), v).toBe(true);
    for (const v of fx.rest.invalidInviteIds) expect(ok(inviteIdSchema, v), v).toBe(false);
    expect(ok(sessionInviteParamsSchema, { id: "01JD0000000000000000000000", inviteId: fx.rest.validInviteIds[0] })).toBe(true);
  });

  it("AC-368 (r3 K-P28u-r3-9): kabul/İzle gövdesi yalnız {}; eski gerekçe alanı ve bilinmeyen alan reddedilir", () => {
    expect(ok(joinWithReasonInputSchema, {})).toBe(true);
    expect(ok(joinWithReasonInputSchema, { reason: "Müşteri arızası için ikinci görüş gerekiyor" })).toBe(false);
    expect(ok(joinWithReasonInputSchema, { silent: true })).toBe(false);
  });
});

describe("P28c audit (AC-370)", () => {
  it("AC-370: on eylem, benzersiz, session.* önekli, etiketli; Çoklu teknisyen grubu tümünü içerir", () => {
    const actions = Object.values(MULTI_AUDIT);
    expect(actions).toEqual([
      "session.invite",
      "session.invite_accept",
      "session.invite_reject",
      "session.invite_expire",
      "session.participant_join",
      "session.participant_leave",
      "session.participant_remove",
      "session.supervise_join",
      "session.control_handover",
      "session.transfer",
    ]);
    for (const a of actions) expect(MULTI_AUDIT_LABELS[a]).toBeTruthy();
    expect(MULTI_AUDIT_GROUP.label).toBe("Çoklu teknisyen");
    expect([...MULTI_AUDIT_GROUP.actions]).toEqual(actions);
    expect(MULTI_INVITE_EXPIRE_REASONS).toContain("revoked");
    for (const r of MULTI_INVITE_EXPIRE_REASONS) expect(MULTI_INVITE_EXPIRE_REASON_LABELS[r]).toBeTruthy();
    for (const r of MULTI_LEAVE_REASONS) expect(MULTI_LEAVE_REASON_LABELS[r]).toBeTruthy();
  });

  it("Y-PC-1: dört göz olayına join ve transfer eklendi, etiketli", () => {
    expect(SILENT_NOTIFY_EVENTS).toEqual(["connect", "policy", "recording_policy", "join", "transfer"]);
    for (const e of SILENT_NOTIFY_EVENTS) expect(SILENT_NOTIFY_EVENT_LABELS[e]).toBeTruthy();
  });
});
