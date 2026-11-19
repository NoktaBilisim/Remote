// P28g K6 contracts (mimari-p28g §4.1–4.2, §13 S-P28g-12; AC-399, AC-403).
import { describe, expect, it } from "vitest";
import { AGENT_DOWNLOAD_OS, agentDownloadOsSchema, CLIENT_OS, JOIN_AUDIT_OS } from "../src/api/sessions.ts";
import { describeTimelineEvent, LINUX_NO_CONTROL_CANCELLED, OS_PERMISSION_CANCELLED, WAYLAND_NO_CONTROL_CANCELLED } from "../src/labels.ts";
import { CONTROL_SOURCES, controlStateSchema, GUEST_VIEW_SOURCES, serverOutboundSchema } from "../src/ws.ts";

describe("P28g indirme os ve clientOs (§3, §4.1)", () => {
  it("AC-403: indirme os enum'u windows|macos|linux; varsayılan windows; büyük harf / takma ad reddedilir", () => {
    expect(AGENT_DOWNLOAD_OS).toEqual(["windows", "macos", "linux"]);
    expect(agentDownloadOsSchema.parse(undefined)).toBe("windows");
    expect(agentDownloadOsSchema.parse("linux")).toBe("linux");
    for (const os of ["LINUX", "Linux", "linux ", "ubuntu", "x86_64", ""]) expect(agentDownloadOsSchema.safeParse(os).success).toBe(false);
  });

  it("AC-403: clientOs ve join audit os linux içerir (yeni enum yok, aynı kaynak)", () => {
    expect(CLIENT_OS).toContain("linux");
    expect(JOIN_AUDIT_OS).toEqual([...CLIENT_OS, "browser"]);
  });
});

describe("P28g control.state WAYLAND_NO_CONTROL (§4.2)", () => {
  it("AC-399: kaynak enum'larda; misafirden yalnız VIEW ile, GRANTED ile şema hatası; teknisyen yönünde iletilir", () => {
    expect(CONTROL_SOURCES).toContain("WAYLAND_NO_CONTROL");
    expect(GUEST_VIEW_SOURCES).toContain("WAYLAND_NO_CONTROL");
    expect(controlStateSchema.safeParse({ t: "control.state", state: "VIEW", source: "WAYLAND_NO_CONTROL" }).success).toBe(true);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "WAYLAND_NO_CONTROL" }).success).toBe(false);
    expect(serverOutboundSchema.safeParse({ t: "control.state", state: "VIEW", source: "WAYLAND_NO_CONTROL" }).success).toBe(true);
    for (const source of ["wayland_no_control", "WAYLAND", "WAYLAND_NO_CONTROL "])
      expect(controlStateSchema.safeParse({ t: "control.state", state: "VIEW", source }).success).toBe(false);
  });

  it("AC-399: zaman çizelgesi control.cancelled{by:agent, source:wayland_no_control} AC-399 metni; os_permission metni değişmez", () => {
    expect(WAYLAND_NO_CONTROL_CANCELLED).toBe("Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)");
    const ev = { action: "control.cancelled", details: { by: "agent", source: "wayland_no_control" } };
    expect(describeTimelineEvent(ev).label).toBe(WAYLAND_NO_CONTROL_CANCELLED);
    expect(describeTimelineEvent({ action: "control.cancelled", details: { by: "agent", source: "os_permission" } }).label).toBe(
      OS_PERMISSION_CANCELLED,
    );
  });

  it("P28g K10 (D-P28g-K1-2): control.cancelled{by:agent, source:linux_no_control} Linux metni; macOS AC-391 metni değişmez", () => {
    expect(LINUX_NO_CONTROL_CANCELLED).toBe("Müşterinin masaüstü uzaktan kontrole izin vermiyor (Linux)");
    expect(describeTimelineEvent({ action: "control.cancelled", details: { by: "agent", source: "linux_no_control" } }).label).toBe(
      LINUX_NO_CONTROL_CANCELLED,
    );
    expect(OS_PERMISSION_CANCELLED).toBe("Müşteri erişilebilirlik izni vermedi");
  });
});
