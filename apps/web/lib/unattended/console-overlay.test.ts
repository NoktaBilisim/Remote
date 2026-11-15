import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsoleHeader } from "@/app/(panel)/sessions/[id]/console/console-header";
import { stageOverlay, type OverlayInput } from "@/components/console/stage-overlay";
import { MODULE_ICONS } from "@/lib/module-icons";
import { initialTech, type TechState } from "@/lib/webrtc/tech-machine";
import { PERMISSION_MODULES } from "@remote/contracts/permissions";
import type { SessionView } from "@remote/contracts/api/sessions";

// K12 (mimari-p27 §4.6): gözetimsiz odada sahne ve üst bar müşteri/kod metni göstermez; katılımlı oturum değişmez.
const UN = { deviceId: "01JXN0000000000000000DEV01", deviceName: "MUHASEBE-PC" };
const waiting = (o: Partial<TechState> = {}): TechState => ({ ...initialTech, phase: "waiting", ...o });
const overlay = (state: TechState) =>
  renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      stageOverlay({
        state,
        now: 0,
        lobby: null,
        verifyCode: "4033",
        sessionCode: "61960375",
        endedNote: null,
        secureDesktop: false,
      } satisfies OverlayInput),
    ),
  );

const session = {
  id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  techVerifyCode: "4033",
  expiresAt: "2026-11-15T12:15:00.000Z",
} as unknown as SessionView;
const header = (state: TechState) =>
  renderToStaticMarkup(
    createElement(ConsoleHeader, {
      session,
      state,
      name: "Ali",
      now: Date.parse("2026-11-15T12:00:00.000Z"),
      controlHint: "h",
      onConfirm: () => {},
    }),
  );

describe("K12: gözetimsiz konsol sahnesi", () => {
  it("bekleme: 'Cihaz bağlanıyor…', müşteri/doğrulama kodu metni yok", () => {
    const html = overlay(waiting({ unattended: UN }));
    expect(html).toContain("Cihaz bağlanıyor…");
    expect(html).toContain('data-testid="stage-unattended-wait"');
    expect(html).not.toContain("Müşteri bekleniyor");
    expect(html).not.toContain("Doğrulama kodu");
    expect(html).not.toContain("4033");
  });
  it("katılımlı bekleme değişmedi: müşteri bekleniyor + doğrulama + oturum kodu", () => {
    const html = overlay(waiting());
    expect(html).toContain("Müşteri bekleniyor");
    expect(html).toContain("Doğrulama kodu");
    expect(html).toContain("4033");
    expect(html).toContain("Oturum kodu");
  });
});

describe("K12: gözetimsiz konsol üst barı", () => {
  it("gözetimsizde 'Kod geçerliliği' ve 'Doğrulama kodu' yok; rozet ve cihaz adı var", () => {
    const html = header(waiting({ unattended: UN }));
    expect(html).not.toContain("console-verify-code");
    expect(html).not.toContain("console-left");
    expect(html).toContain("MUHASEBE-PC");
    expect(html).toContain("console-unattended");
  });
  it("gözetimsiz canlı oturumda en uzun süre kalır, doğrulama kodu yine yok", () => {
    const html = header({ ...initialTech, phase: "live", unattended: UN, maxEndsAt: "2026-11-15T20:00:00.000Z" });
    expect(html).toContain("console-left");
    expect(html).not.toContain("console-verify-code");
  });
  it("katılımlı oturum değişmedi: kod geçerliliği + doğrulama kodu görünür", () => {
    const html = header(waiting());
    expect(html).toContain("console-left");
    expect(html).toContain("console-verify-code");
  });
});

describe("K12: modül ikonu tek kaynak", () => {
  it("her yetki modülünün ikonu var; gözetimsiz erişim MonitorCog", () => {
    for (const m of PERMISSION_MODULES) expect(MODULE_ICONS[m.key], m.key).toBeTruthy();
    expect(MODULE_ICONS.unattended.displayName).toBe("MonitorCog");
  });
});
