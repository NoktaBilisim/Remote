import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsoleEnded } from "@/app/(panel)/sessions/[id]/console/console-parts";
import { UserState } from "@/app/(panel)/unattended/user-state";
import { DeviceBadges } from "@/app/(panel)/unattended/device-badges";
import { UN_DEVICE_POLL_MS } from "@/app/(panel)/unattended/use-device-poll";
import { UnattendedInfoSection } from "@/app/(panel)/history/[id]/unattended-info";
import { parseAuditParams, auditHref } from "@/lib/audit/query";
import { parseFilters } from "@/lib/history/query";
import type { DeviceListItem } from "./contract";
import { initialTech, techReducer } from "@/lib/webrtc/tech-machine";
import { autoControlDecision, interveneView, type AutoControlInput, type UnattendedInfo } from "./consent";

// P28u K7 + r3 (mimari-p28u §r3 r3.6, K-P28u-r3-6, S-P28u-r3-2; AC-429, 433, 435, 442, 445, 446, 451).
const U: UnattendedInfo = { deviceId: "01JDVP2700000000000000000A", deviceName: "PC" };
const R20 = "Sunucu bakım penceresi";

describe("interveneView (AC-442 r3)", () => {
  it("katılımlı oturum → null", () => expect(interveneView(null, "idle", true)).toBeNull());
  it("komutlar yalnız canlı + kontrol açıkken; intervene yok → pasif", () => {
    expect(interveneView({ ...U, intervene: true }, "idle", true)).toEqual({ showCommands: false, commandsDisabled: false });
    expect(interveneView({ ...U, intervene: true }, "requested", true)?.showCommands).toBe(false);
    expect(interveneView({ ...U, intervene: true }, "granted", true)).toEqual({ showCommands: true, commandsDisabled: false });
    expect(interveneView({ ...U, intervene: true }, "granted", false)?.showCommands).toBe(false);
    expect(interveneView(U, "granted", true)).toEqual({ showCommands: true, commandsDisabled: true });
  });
  it("S-P28u-r3-8: kontrol sahibi olmayan (katılımcı) konsolda komutlar görünmez", () => {
    expect(interveneView({ ...U, intervene: true }, "granted", true, false)?.showCommands).toBe(false);
    expect(interveneView({ ...U, intervene: true }, "granted", true, true)?.showCommands).toBe(true);
  });
});

describe("autoControlDecision (K-P28u-r3-6, S-P28u-r3-2)", () => {
  const base: AutoControlInput = { joins: 1, unattended: true, controller: true, canControl: true, phase: "idle" };
  /** Konsol kancasının yaptığını taklit eder: sıralı girdilerde kaç istek gider. */
  const run = (steps: AutoControlInput[]): number => {
    let seen = 0;
    let n = 0;
    for (const i of steps) {
      const r = autoControlDecision(seen, i);
      seen = r.seen;
      if (r.fire) n++;
    }
    return n;
  };
  it("katılım yok → istek yok", () => expect(run([{ ...base, joins: 0 }])).toBe(0));
  it("kontrol sahibi: katılımda tam 1 istek; yeniden çizim / faz değişimi ikinci istek üretmez", () => {
    expect(run([base, base, { ...base, phase: "requested" }, { ...base, phase: "granted" }, { ...base, phase: "idle" }])).toBe(1);
  });
  it("katılımcı / izleyici (kontrol sahibi değil) → 0", () => {
    expect(run([{ ...base, controller: false }])).toBe(0);
  });
  it("devir: katılımda sahip değildi, sonra kontrol sahibi oldu → 0 (bilinçli tıklama)", () => {
    expect(
      run([
        { ...base, controller: false },
        { ...base, controller: true },
        { ...base, controller: true },
      ]),
    ).toBe(0);
  });
  it("misafir ayrılıp yeniden katılınca (sayaç artar) 1 istek daha", () => {
    expect(run([base, { ...base, phase: "granted" }, { ...base, phase: "ended" }, { ...base, joins: 2, phase: "ended" }])).toBe(2);
  });
  it("katılımlı oturum, yetki yok ya da kontrol zaten istenmiş/açık → 0", () => {
    expect(run([{ ...base, unattended: false }])).toBe(0);
    expect(run([{ ...base, canControl: false }])).toBe(0);
    expect(run([{ ...base, phase: "requested" }])).toBe(0);
    expect(run([{ ...base, phase: "granted" }])).toBe(0);
  });
});

describe("tech-machine guestJoins (K-P28u-r3-6)", () => {
  const now = 1_000;
  const msg = (m: Record<string, unknown>) => ({ type: "msg", m: m as never, now }) as const;
  const hello = (peerPresent: boolean, active = true) => ({
    t: "hello",
    role: "tech",
    sessionId: "01JSESSION0000000000000000",
    maxEndsAt: active ? "2026-11-18T20:00:00.000Z" : null,
    peerPresent,
    iceServers: [],
    unattended: U,
  });
  it("PENDING hello → 0; peer.joined → 1; ayrılıp yeniden katılım → 2", () => {
    let s = techReducer(initialTech, msg(hello(false, false)));
    expect(s.guestJoins).toBe(0);
    s = techReducer(s, msg({ t: "peer.joined", role: "guest", guestKind: "AGENT" }));
    expect(s.guestJoins).toBe(1);
    s = techReducer(s, msg({ t: "peer.left", role: "guest" }));
    s = techReducer(s, msg({ t: "peer.joined", role: "guest", guestKind: "AGENT" }));
    expect(s.guestJoins).toBe(2);
  });
  it("konsol açılmadan kabul edilmiş cihaz (ACTIVE + peerPresent hello) → 1; misafir bağlıyken kendi WS yeniden bağlanınca artmaz", () => {
    let s = techReducer(initialTech, msg(hello(true)));
    expect(s.guestJoins).toBe(1);
    s = techReducer(s, { type: "closed", code: 1006, now });
    s = techReducer(s, msg(hello(true)));
    expect(s.guestJoins).toBe(1);
  });
  it("koparken misafir kayboldu ve geri geldi (peerLostSince) → hello ile artar", () => {
    let s = techReducer(initialTech, msg(hello(true)));
    s = techReducer(s, msg({ t: "peer.left", role: "guest" }));
    s = techReducer(s, msg(hello(true)));
    expect(s.guestJoins).toBe(2);
  });
});

describe("liste: kullanıcı durumu + outdated (AC-429, 435), yoklama 8 sn", () => {
  it("UserState: üç durum ikon+metin, bilinmiyor '—'", () => {
    expect(renderToStaticMarkup(createElement(UserState, { state: "locked" }))).toContain("Kilitli");
    expect(renderToStaticMarkup(createElement(UserState, { state: "none" }))).toContain("Oturum yok");
    expect(renderToStaticMarkup(createElement(UserState, { state: undefined }))).toContain("—");
  });
  it("outdated rozeti", () => {
    const d = {
      online: true,
      localEnabled: true,
      signatureOk: true,
      verified: true,
      notifyFailed: false,
      replacedAlert: false,
      name: "X",
      connectBlockedReason: "outdated",
    } as DeviceListItem;
    expect(renderToStaticMarkup(createElement(DeviceBadges, { device: d }))).toContain("Servis güncel değil");
  });
  it("yoklama ≤ 10 sn", () => expect(UN_DEVICE_POLL_MS).toBe(8_000));
});

describe("konsol bitişi: eski onay nedenleri metinle kalır, 'Yeniden dene' yok (r3)", () => {
  it("consent_denied etiketi + yalnız listeye dönüş", () => {
    const html = renderToStaticMarkup(createElement(ConsoleEnded, { end: "consent_denied" }));
    expect(html).toContain("Kullanıcı bağlantıyı reddetti.");
    expect(html).not.toContain("Yeniden dene");
    expect(html).not.toContain("/unattended/");
  });
});

describe("geçmiş: gözetimsiz bölüm (AC-446)", () => {
  it("kip, gerekçe (silent), zaman çizelgesi; boşta 'Müdahale yok'", () => {
    const html = renderToStaticMarkup(
      createElement(UnattendedInfoSection, {
        u: { consentMode: "silent", silentReason: R20, timeline: [{ at: "2026-11-16T10:00:00.000Z", kind: "lock", result: "success" }] },
      }),
    );
    expect(html).toContain("İzinsiz (eski)");
    expect(html).toContain(R20);
    expect(html).toContain("Oturum kilitlendi");
    const empty = renderToStaticMarkup(
      createElement(UnattendedInfoSection, { u: { consentMode: "asked", silentReason: R20, timeline: [] } }),
    );
    expect(empty).toContain("Müdahale yok");
    expect(empty).not.toContain(R20);
  });
});

describe("filtreler: consentMode (AC-445)", () => {
  it("audit: geçerli kip URL'ye yazılır, geçersiz yok sayılır", () => {
    const ok = parseAuditParams({ consentMode: "silent" }, { allowTenant: false, today: "2026-11-16" });
    expect(ok.filters.consentMode).toBe("silent");
    expect(auditHref(ok.filters)).toBe("/audit?consentMode=silent");
    expect(parseAuditParams({ consentMode: "x" }, { allowTenant: false, today: "2026-11-16" }).ignored).toEqual(["consentMode"]);
  });
  it("geçmiş listesi", () => {
    expect(parseFilters({ consentMode: "no_user" }).filters.consentMode).toBe("no_user");
  });
});
