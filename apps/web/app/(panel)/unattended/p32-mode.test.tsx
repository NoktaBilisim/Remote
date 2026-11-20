import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { UNATTENDED_RISK_BANNER, UNATTENDED_TEST_BANNER, type DeviceListItem, type UnattendedStatus } from "@/lib/unattended/contract";
import { installNote, isRiskAccepted, modeBanners } from "@/lib/unattended/errors";
import { DeviceBadges } from "./device-badges";
import { gateBody, ModeBanner, pickTenantRisk, UnattendedShell, type UnAccess } from "./unattended-shell";

const st = (mode: string, available = true): UnattendedStatus => ({ mode, available, notifyChannel: true }) as unknown as UnattendedStatus;
const SHA = "0123456789abcdef".repeat(4);
const RISK = "Gözetimsiz servis kod imzasız çalışıyor (risk kabul, ADR-0042). Kurulumda Windows SmartScreen uyarısı görülebilir.";

describe("P32 kapı bantları (AC-526, AC-527c)", () => {
  it("unsigned-accepted: Super Admin yalnız risk bandını görür, TEST bandı yok", () => {
    expect(modeBanners(st("unsigned-accepted"), true)).toEqual(["risk"]);
    const html = renderToStaticMarkup(<ModeBanner status={st("unsigned-accepted")} superAdmin />);
    expect(html).toContain('data-testid="un-risk-banner"');
    expect(html).toContain(RISK);
    expect(html).not.toContain("un-test-banner");
    expect(html).toContain('role="status"');
  });
  it("unsigned-accepted: Admin/User bant görmez", () => {
    expect(modeBanners(st("unsigned-accepted"), false)).toEqual([]);
    expect(renderToStaticMarkup(<ModeBanner status={st("unsigned-accepted")} superAdmin={false} />)).toBe("");
  });
  it("staging unsigned: TEST bandı aynen kalır, risk bandı yok (Super Admin dahil)", () => {
    expect(modeBanners(st("unsigned"), true)).toEqual(["test"]);
    const html = renderToStaticMarkup(<ModeBanner status={st("unsigned")} superAdmin />);
    expect(html).toContain(UNATTENDED_TEST_BANNER);
    expect(html).not.toContain("un-risk-banner");
  });
  it("signed ve off değişmez", () => {
    expect(modeBanners(st("signed"), true)).toEqual([]);
    expect(modeBanners(st("off", false), true)).toEqual(["off"]);
  });
  it("firma seçmemiş Super Admin: yalnız risk bandı + 'firma seçin' boş durumu (QA P32 tur 1 m.2)", () => {
    const sa: UnAccess = { connect: true, manage: true, pickTenant: true, history: true, superAdmin: true };
    const shell = (status: UnattendedStatus | undefined, access = sa) =>
      renderToStaticMarkup(
        <UnattendedShell access={access} status={status} createBlock={null}>
          {gateBody(access)}
        </UnattendedShell>,
      );
    const html = shell(st("unsigned-accepted", false));
    expect(html).toContain('data-testid="un-risk-banner"');
    expect(html).toContain('data-testid="un-pick-tenant"');
    expect(html).not.toContain("un-off-banner");
    expect(html).not.toContain("un-test-banner");
    expect(html).not.toContain("un-create-code");
    expect(html.indexOf("un-risk-banner")).toBeLessThan(html.indexOf("un-pick-tenant"));
    for (const other of [st("unsigned"), st("signed"), st("off", false), undefined]) expect(shell(other)).not.toContain("un-risk-banner");
    expect(pickTenantRisk({ ...sa, connect: false, manage: false }, st("unsigned-accepted"))).toBe(false);
    expect(pickTenantRisk({ ...sa, pickTenant: false }, st("unsigned-accepted"))).toBe(false);
  });
  it("metin tek kaynak: contracts = mimari §4.7", () => {
    expect(UNATTENDED_RISK_BANNER).toBe(RISK);
  });
});

describe("P32 kayıt kodu kurulum notu (S-P32-8, AC-527)", () => {
  it("yalnız unsigned-accepted'te; SHA ilk 8…son 8", () => {
    expect(isRiskAccepted(st("unsigned-accepted"))).toBe(true);
    expect(isRiskAccepted(st("signed"))).toBe(false);
    expect(isRiskAccepted(null)).toBe(false);
    expect(installNote(true, SHA)).toBe("Windows 'Bilinmeyen yayıncı' gösterebilir; SHA-256: 01234567…89abcdef");
    expect(installNote(false, SHA)).toBeNull();
  });
  it("yanıtta SHA yoksa SHA parçası yazılmaz", () => {
    expect(installNote(true, undefined)).toBe("Windows 'Bilinmeyen yayıncı' gösterebilir.");
  });
});

describe("P32 cihaz rozeti (AC-531)", () => {
  const dev = (o: Partial<DeviceListItem>) =>
    ({
      id: "01JDVP3200000000000000000A",
      name: "MUHASEBE-PC",
      online: true,
      localEnabled: true,
      signatureOk: true,
      verified: true,
      notifyFailed: false,
      replacedAlert: false,
      connectBlockedReason: null,
      ...o,
    }) as unknown as DeviceListItem;
  it("listede olmayan sürüm → 'İzinli sürüm değil' + ipucu", () => {
    const html = renderToStaticMarkup(<DeviceBadges device={dev({ signatureOk: false })} />);
    expect(html).toContain('data-testid="un-badge-unsigned"');
    expect(html).toContain("İzinli sürüm değil");
    expect(html).toContain('title="Servisi güncelleyin ya da yeniden yayınlayın"');
    expect(html).not.toContain(">İmzasız<");
  });
  it("izinli sürümde rozet yok; ayrıntıdaki imza satırı anahtarı değişmedi", () => {
    expect(renderToStaticMarkup(<DeviceBadges device={dev({})} />)).not.toContain("un-badge-unsigned");
    expect(t("un.d.unsigned")).toBe("İmzasız");
  });
});
