import { CLIENT_UPDATE_AUDIT } from "@remote/contracts/audit";
import { describe, expect, it } from "vitest";
import { actionLabel, actionOptionGroups, auditItemLabel, clientUpdateReasonLabel, groupLabel } from "@/lib/audit/actions";
import { devicesApiPath, devicesHref, parseDeviceParams, versionsApiPath } from "./query";
import { publishedParts, sortVersionRows, updateBadgeLabel, updateTarget } from "./update";

describe("P29 sürüm süzgeci (AC-490)", () => {
  it("version yalnız x.y.z; scope yalnız all", () => {
    expect(parseDeviceParams({ version: "0.22.1", scope: "all" })).toMatchObject({ version: "0.22.1", scope: "all" });
    expect(parseDeviceParams({ version: "0.22", scope: "x" })).toMatchObject({ version: undefined, scope: undefined });
    expect(parseDeviceParams({ version: "1.2.3-beta" }).version).toBeUndefined();
  });
  it("href version + scope taşır; API yolu scope göndermez", () => {
    const p = { state: "all" as const, version: "0.22.0", scope: "all" as const };
    expect(devicesHref(p)).toBe("/unattended?version=0.22.0&scope=all");
    expect(devicesApiPath(p)).toBe("/unattended/devices?state=all&version=0.22.0&limit=50");
    expect(versionsApiPath(true)).toBe("/unattended/versions?scope=all");
    expect(versionsApiPath(false)).toBe("/unattended/versions");
  });
});

describe("P29 rozet metni", () => {
  it.each([
    ["CURRENT", null, "Güncel"],
    ["PENDING", null, "Güncelleme bekliyor"],
    ["UPDATING", null, "Güncelleniyor"],
    ["FAILED", "HASH_MISMATCH", "Güncelleme başarısız (bütünlük)"],
    ["FAILED", "toString", "Güncelleme başarısız"],
    ["BELOW_MIN", null, "Asgari sürümün altında"],
  ] as const)("%s/%s → %s", (b, r, out) => expect(updateBadgeLabel(b, r)).toBe(out));
  it("hedef sürüm yalnız bekleyen/sürende ve farklıysa", () => {
    expect(updateTarget("PENDING", "0.22.0", "0.22.1")).toBe("0.22.1");
    expect(updateTarget("FAILED", "0.22.0", "0.22.1")).toBeNull();
    expect(updateTarget("UPDATING", "0.22.1", "0.22.1")).toBeNull();
  });
  it("yayın satırı: hepsi null → kısmi (null); sıra yeni sürüm önce", () => {
    expect(publishedParts({ service: null, client: { windows: null, macos: null, linux: null } })).toBeNull();
    const p = publishedParts({ service: { version: "0.22.1", expiresAt: "x" }, client: { windows: null, macos: null, linux: null } });
    expect(p?.[0]).toEqual({ label: "Servis", version: "0.22.1" });
    expect(
      sortVersionRows([
        { version: "0.9.10", platform: "windows" },
        { version: "0.22.0", platform: "windows" },
      ]).map((r) => r.version),
    ).toEqual(["0.22.0", "0.9.10"]);
  });
});

describe("P29 audit (AC-491)", () => {
  const f = (newValue: unknown) => ({ action: CLIENT_UPDATE_AUDIT.FAILED, newValue });
  it("Türkçe etiketler, ham anahtar değil", () => {
    for (const a of Object.values(CLIENT_UPDATE_AUDIT)) expect(actionLabel(a)).not.toBe(a);
    expect(actionLabel("client.update.installed")).toBe("İstemci güncellendi");
    expect(actionLabel("settings.client_update")).toBe("İstemci otomatik güncelleme ayarı değişti");
  });
  it("güvenlik nedeni → reddedildi; binding → İstemci bildirdi öneki; diğerleri genel", () => {
    expect(auditItemLabel(f({ reason: "MANIFEST_SIGNATURE", source: "device" }))).toBe("Güncelleme reddedildi (imza)");
    expect(auditItemLabel(f({ reason: "DOWNGRADE", source: "binding" }))).toBe("İstemci bildirdi: Güncelleme reddedildi (eski sürüm)");
    expect(auditItemLabel(f({ reason: "DOWNLOAD", source: "device" }))).toBe("İstemci güncellemesi başarısız");
    expect(auditItemLabel(f({ reason: "DOWNLOAD", source: "binding" }))).toBe("İstemci bildirdi: İstemci güncellemesi başarısız");
    expect(auditItemLabel(f(null))).toBe("İstemci güncellemesi başarısız");
    expect(auditItemLabel({ action: CLIENT_UPDATE_AUDIT.SKIPPED, newValue: { reason: "POLICY_OFF", source: "binding" } })).toBe(
      "İstemci güncellemesi atlandı",
    );
    expect(auditItemLabel({ action: "auth.login", newValue: { reason: "MANIFEST_SIGNATURE" } })).toBe("Giriş");
  });
  it("neden etiketi yalnız bilinen değerde", () => {
    expect(clientUpdateReasonLabel(f({ reason: "ENV_MISMATCH" }))).toBe("ortam");
    expect(clientUpdateReasonLabel(f({ reason: "__proto__" }))).toBeNull();
    expect(clientUpdateReasonLabel({ action: "mail.sent", newValue: { reason: "HEALTH" } })).toBeNull();
  });
  it("filtre grubu 'İstemci güncelleme' (5 eylem + tümü)", () => {
    expect(groupLabel("client")).toBe("İstemci güncelleme");
    const g = actionOptionGroups().find((x) => x.label === "İstemci güncelleme");
    expect(g?.options.map((o) => o.value)).toEqual(expect.arrayContaining(["client.*", ...Object.values(CLIENT_UPDATE_AUDIT)]));
    expect(g?.options).toHaveLength(6);
  });
});
