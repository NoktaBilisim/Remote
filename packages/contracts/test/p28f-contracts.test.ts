// P28f K6 contracts (mimari-p28f §4.1–4.2, §5.4; S-P28f-9, S-P28f-15; AC-390, AC-391, AC-396).
import { describe, expect, it } from "vitest";
import { agentDownloadOsSchema, resolveSessionInputSchema, TIMELINE_DETAIL_KEYS } from "../src/api/sessions.ts";
import { DANGEROUS_EXT, fileNameWarning, sanitizeFileName } from "../src/files.ts";
import { CLIENT_OS_LABELS, describeTimelineEvent, OS_PERMISSION_CANCELLED } from "../src/labels.ts";
import { controlStateSchema, serverOutboundSchema } from "../src/ws.ts";

describe("P28f resolve clientOs (S-P28f-15)", () => {
  it("AC-396: clientOs isteğe bağlı enum (windows|macos|linux), iki dalda da; geçersiz değer reddedilir", () => {
    for (const clientOs of ["windows", "macos", "linux", undefined])
      for (const k of [{ code: "12345678" }, { token: "a".repeat(43) }])
        expect(resolveSessionInputSchema.safeParse({ ...k, clientKind: "AGENT", ...(clientOs ? { clientOs } : {}) }).success).toBe(true);
    for (const clientOs of ["darwin", "MACOS", "", 1, null])
      expect(resolveSessionInputSchema.safeParse({ code: "12345678", clientKind: "AGENT", clientOs }).success).toBe(false);
  });

  it("AC-396: indirme os varsayılanı windows; yalnız windows|macos (P28g: + linux, p28g-contracts.test.ts)", () => {
    expect(agentDownloadOsSchema.parse(undefined)).toBe("windows");
    expect(agentDownloadOsSchema.parse("macos")).toBe("macos");
    for (const os of ["LINUX", "MACOS", ""]) expect(agentDownloadOsSchema.safeParse(os).success).toBe(false);
  });

  it("AC-396: guest.pending zaman çizelgesinde os anahtarı; etiketler", () => {
    expect(TIMELINE_DETAIL_KEYS["guest.pending"]).toContain("os");
    expect(CLIENT_OS_LABELS).toEqual({ windows: "Windows", macos: "macOS", linux: "Linux", browser: "Tarayıcı" });
  });
});

describe("P28f control.state OS_PERMISSION (§4.2)", () => {
  it("AC-391: misafirden yalnız VIEW ile; teknisyen yönünde iletilir", () => {
    expect(controlStateSchema.safeParse({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" }).success).toBe(true);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "OS_PERMISSION" }).success).toBe(false);
    expect(serverOutboundSchema.safeParse({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" }).success).toBe(true);
  });

  it("AC-391: zaman çizelgesi control.cancelled{by:agent, source:os_permission} metni", () => {
    const ev = { action: "control.cancelled", details: { by: "agent", source: "os_permission" } };
    expect(describeTimelineEvent(ev).label).toBe(OS_PERMISSION_CANCELLED);
    expect(describeTimelineEvent({ action: "control.cancelled", details: { by: "agent", source: "SYSTEM" } }).label).toBe(
      "İstek müşteri tarafında bağlantı kesilince kapandı",
    );
  });
});

describe("P28f tehlikeli uzantılar (S-P28f-9)", () => {
  it("S-P28f-9: macOS türleri listede; gizli (baştaki noktalı) adlar uyarı alır; zip/pages uyarısız", () => {
    for (const e of "command tool app pkg mpkg dmg scpt scptd applescript terminal webloc inetloc fileloc workflow action mobileconfig kext dylib bundle plugin prefpane osax zsh bash csh ksh py rb pl saver".split(
      " ",
    ))
      expect(DANGEROUS_EXT.has(e)).toBe(true);
    expect(fileNameWarning(sanitizeFileName("Kurulum.APP"))).toBe("dangerous");
    expect(fileNameWarning(sanitizeFileName("fatura.pdf.command"))).toBe("double_extension");
    expect(fileNameWarning(sanitizeFileName(".zshrc"))).toBe("dangerous");
    expect(fileNameWarning(sanitizeFileName("../../.bash_profile"))).toBe("dangerous");
    expect(fileNameWarning(sanitizeFileName("arsiv.zip"))).toBe("none");
    expect(fileNameWarning(sanitizeFileName("notlar.pages"))).toBe("none");
  });
});
