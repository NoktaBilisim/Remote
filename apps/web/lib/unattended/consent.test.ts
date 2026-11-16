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
import { awaitingConsent, buildConnectBody, interveneView, reasonLength, showControlButton, type UnattendedInfo } from "./consent";

// P28u K7 (mimari-p28u §10; AC-429, 430, 435, 437, 439, 442, 445, 446).
const U: UnattendedInfo = { deviceId: "01JDVP2700000000000000000A", deviceName: "PC" };
const R20 = "Sunucu bakım penceresi";

describe("buildConnectBody (AC-430, 437)", () => {
  it("kutu işaretsiz → {} (izinli istek; gerekçe yok sayılır)", () => {
    expect(buildConnectBody(false, "x")).toEqual({ body: {} });
  });
  it("işaretli: gerekçe 20–500 kod noktası, kırpılır", () => {
    expect(buildConnectBody(true, "  kısa  ")).toEqual({ error: "Gerekçe 20–500 karakter olmalı" });
    expect(buildConnectBody(true, `  ${R20}  `)).toEqual({ body: { silent: true, reason: R20 } });
    expect("error" in buildConnectBody(true, "a".repeat(501))).toBe(true);
    expect("error" in buildConnectBody(true, `${R20}‮`)).toBe(true);
  });
  it("sayaç kırpılmış kod noktası sayar", () => {
    expect(reasonLength("  ab😀 ")).toBe(3);
  });
});

describe("interveneView / showControlButton (AC-439, 442)", () => {
  it("katılımlı oturum → null", () => expect(interveneView(null, "idle", true)).toBeNull());
  it("silent + kontrol yok → izleniyor; kontrol açık → İzlemeye dön + komutlar", () => {
    const s = { ...U, consentMode: "silent" as const, intervene: true };
    expect(interveneView(s, "idle", true)).toMatchObject({ monitoring: true, canReturn: false, showCommands: false });
    expect(interveneView(s, "granted", true)).toMatchObject({
      monitoring: false,
      canReturn: true,
      showCommands: true,
      commandsDisabled: false,
    });
    expect(showControlButton(s, "idle")).toBe(false);
    expect(showControlButton(s, "granted")).toBe(true);
  });
  it("asked/no_user: izleme yok; komutlar yalnız kontrol açıkken; intervene yok → pasif", () => {
    const a = { ...U, consentMode: "asked" as const };
    expect(interveneView(a, "idle", true)).toMatchObject({ monitoring: false, showCommands: false });
    expect(interveneView(a, "granted", true)).toMatchObject({ showCommands: true, commandsDisabled: true, canReturn: false });
    expect(showControlButton(a, "idle")).toBe(true);
  });
  it("kip yoksa onay bekleniyor", () => {
    expect(awaitingConsent(U)).toBe(true);
    expect(awaitingConsent({ ...U, consentMode: "no_user" })).toBe(false);
    expect(awaitingConsent(null)).toBe(false);
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

describe("konsol bitişi: consent_denied/timeout → Yeniden dene (AC-432)", () => {
  it("cihaz ayrıntısına bağlantı + step-up notu", () => {
    const html = renderToStaticMarkup(createElement(ConsoleEnded, { end: "consent_denied", deviceId: U.deviceId }));
    expect(html).toContain("Kullanıcı bağlantıyı reddetti.");
    expect(html).toContain(`/unattended/${U.deviceId}`);
    expect(html).toContain("step-up");
    expect(renderToStaticMarkup(createElement(ConsoleEnded, { end: "tech", deviceId: U.deviceId }))).not.toContain("Yeniden dene");
  });
});

describe("geçmiş: gözetimsiz bölüm (AC-446)", () => {
  it("kip, gerekçe (silent), zaman çizelgesi; boşta 'Müdahale yok'", () => {
    const html = renderToStaticMarkup(
      createElement(UnattendedInfoSection, {
        u: { consentMode: "silent", silentReason: R20, timeline: [{ at: "2026-11-16T10:00:00.000Z", kind: "lock", result: "success" }] },
      }),
    );
    expect(html).toContain("İzinsiz");
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
