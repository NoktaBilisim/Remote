import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { PORTAL_CSRF_COOKIE, PORTAL_TENANT_COOKIE, type PortalAccountItem } from "@remote/contracts/api/portal";
import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "@/lib/api";
import { buildWebRequest, emptyDraft, readStored, readStoredAt } from "@/lib/web-request/flow";
import { publicRequestSource } from "@/lib/web-request/source";
import { permissionsPolicyFor } from "@/proxy";
import { accountBadges, createState, validateAccount } from "./accounts";
import { portalApi, portalGateTarget } from "./api";
import { isPortalPath, portalLoginPath, portalRedirect, tenantSlugFromCookieString, validSlug } from "./paths";
import { buildPortalRequest, portalFormInfo, portalRequestSource, portalStoreKey } from "./request-source";
import { pagesOf, parsePortalQuery, portalHref, requestFacts, sessionFacts } from "./view";

const ULID = "01JD0000000000000000000001";

describe("P21 portal yolları (r2 S-P21-3)", () => {
  it("giriş adresi yalnız geçerli slug ile ?tenant= taşır; reason eklenir; next yok", () => {
    expect(portalLoginPath("acme")).toBe("/portal/login?tenant=acme");
    expect(portalLoginPath("acme", "expired")).toBe("/portal/login?tenant=acme&reason=expired");
    expect(portalLoginPath("Acme!<x>")).toBe("/portal/login");
    expect(portalLoginPath(null, "logout")).toBe("/portal/login?reason=logout");
    expect(validSlug("a")).toBeNull();
  });
  it("proxy ön elemesi: portal yolunda çerez yoksa firmanın girişine; giriş sayfası ve panel yolları serbest", () => {
    expect(portalRedirect("/portal", false, "acme")).toBe("/portal/login?tenant=acme");
    expect(portalRedirect("/portal/requests/x", false, "bad slug")).toBe("/portal/login");
    expect(portalRedirect("/portal/login", false, null)).toBeNull();
    expect(portalRedirect("/portal", true, null)).toBeNull();
    expect(portalRedirect("/customers", false, null)).toBeNull();
    expect(portalRedirect("/portalx", false, null)).toBeNull();
    expect(isPortalPath("/portal/account")).toBe(true);
  });
  it("rs_portal_tenant çerezi doğrulanarak okunur", () => {
    expect(tenantSlugFromCookieString(`a=1; ${PORTAL_TENANT_COOKIE}=acme-tr`, PORTAL_TENANT_COOKIE)).toBe("acme-tr");
    expect(tenantSlugFromCookieString(`${PORTAL_TENANT_COOKIE}=%3Cx%3E`, PORTAL_TENANT_COOKIE)).toBeNull();
  });
});

describe("P21 Permissions-Policy (r2 S-P21-12)", () => {
  it("/portal microphone=() ve display-capture=(); /portal/new-request ekran paylaşımı için (self); /r ve panel değişmedi", () => {
    expect(permissionsPolicyFor("/portal")).toBe("camera=(), microphone=(), geolocation=(), display-capture=()");
    expect(permissionsPolicyFor("/portal/account")).toContain("display-capture=()");
    expect(permissionsPolicyFor("/portal/new-request")).toBe("camera=(), microphone=(), geolocation=(), display-capture=(self)");
    expect(permissionsPolicyFor("/r/x")).toBe("camera=(), microphone=(), geolocation=(), display-capture=(self)");
    expect(permissionsPolicyFor("/login")).toBe("camera=(), microphone=(self), geolocation=(), display-capture=(self)");
    expect(permissionsPolicyFor("/portalx")).toBe("camera=(), microphone=(self), geolocation=(), display-capture=(self)");
  });
});

describe("P21 portalApi (ADR-0039 çerez ayrımı)", () => {
  const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  it("yazmada CSRF portal çerezinden; panel çerezi kullanılmaz", async () => {
    let seen: RequestInit | undefined;
    await portalApi("POST", "/portal/requests", { a: 1 }, {
      fetch: async (_u, init) => ((seen = init), res(201, {})),
      cookie: () => `__Host-rs_csrf=panel; ${PORTAL_CSRF_COOKIE}=portal`,
    });
    expect((seen?.headers as Record<string, string>)[CSRF_HEADER]).toBe("portal");
  });
  it("403 MFA_REQUIRED panel 2FA ekranına yönlendirmez, ApiError olarak döner; ağ hatası NetworkError", async () => {
    const e = await portalApi("POST", "/portal/auth/login", {}, {
      fetch: async () => res(403, { error: { code: "MFA_REQUIRED", message: "Kod gerekli." } }),
      cookie: () => "",
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("MFA_REQUIRED");
    const n = await portalApi("GET", "/portal/me", undefined, { fetch: async () => Promise.reject(new Error("x")), cookie: () => "" }).catch((x: unknown) => x);
    expect(n).toBeInstanceOf(NetworkError);
  });
  it("kapı hataları: 401 → girişe (slug çerezden), 403 PASSWORD_CHANGE_REQUIRED → şifre ekranı", () => {
    expect(portalGateTarget(new ApiError(401, "UNAUTHENTICATED", ""), `${PORTAL_TENANT_COOKIE}=acme`)).toBe("/portal/login?tenant=acme&reason=expired");
    expect(portalGateTarget(new ApiError(403, "PASSWORD_CHANGE_REQUIRED", ""), "")).toBe("/portal/change-password");
    expect(portalGateTarget(new ApiError(409, "QUEUE_FULL", ""), "")).toBeNull();
  });
});

const info = {
  tenant: { name: "Demo", logoUrl: null },
  consentText: { id: ULID, version: 1, body: "x" },
  chatRetentionDays: 30,
  channels: { sms: true, whatsapp: false, email: true },
  businessHours: { openNow: true },
} as unknown as Parameters<typeof portalFormInfo>[0];
const draft = { ...emptyDraft(), customerName: "Ali Veli", phone: "05321234567", description: "Yazıcı çalışmıyor", consent: true };

describe("P21 K-P21-2 talep kaynağı adaptörü", () => {
  it("portal gövdesi ref/formToken/website taşımaz, kapalı kanal true olamaz; /r/ gövdesi aynen", () => {
    const r = buildPortalRequest({ ...draft, notify: { sms: true, whatsapp: true, email: false } }, "AbCdEfGhIjKlMnOpQrSt_-", info);
    expect(r.errors).toEqual({});
    for (const k of ["ref", "formToken", "website", "customerId", "tenantId"]) expect(r.body).not.toHaveProperty(k);
    expect((r.body as unknown as { notify: unknown }).notify).toEqual({ sms: true, whatsapp: false, email: false });
    const w = buildWebRequest(draft, { ref: "abcdefghijklmnop", formToken: "t".repeat(43), clientInstanceId: "AbCdEfGhIjKlMnOpQrSt_-", info: info as never });
    expect(Object.keys(w.body ?? {})).toContain("ref");
  });
  it("e-posta bildirimi e-postasız → fields.email (S-P21-6); onaysız → consent", () => {
    const r = buildPortalRequest({ ...draft, notify: { sms: false, whatsapp: false, email: true } }, "AbCdEfGhIjKlMnOpQrSt_-", info);
    expect(r.errors.email).toBeTruthy();
    expect(buildPortalRequest({ ...draft, consent: false }, "AbCdEfGhIjKlMnOpQrSt_-", info).errors.consent).toBeTruthy();
  });
  it("portal kaynağı: token yok/bekleme 0, sekme anahtarı kullanıcıya bağlı, ad/e-posta önceden dolu, indirme me.links", () => {
    const me = {
      user: { id: "U1", email: "a@b.co", fullName: "Ali Veli", theme: "SYSTEM", mustChangePassword: false, totpEnabled: false },
      customer: { name: "Acme" },
      provider: { name: "Demo", logoUrl: "/img/logo.png" },
      links: { downloadUrl: "/api/v1/public/agent/request-download?ref=x", fileName: "NoktaDestek-A-x.exe" },
    } as const;
    const s = portalRequestSource(me as never, () => false);
    expect(s.storeKey).toBe(portalStoreKey("U1"));
    expect(s.storeKey).not.toMatch(/^rs\.wr\.[a-z2-7]{16}$/);
    expect(s.initialDraft).toEqual({ customerName: "Ali Veli", email: "a@b.co" });
    expect(s.downloadHref).toBe(me.links.downloadUrl);
    expect(s.framed).toBe(false);
    expect(portalFormInfo(info)).toMatchObject({ formToken: "", minDelayMs: 0 });
    const p = publicRequestSource("abcdefghijklmnop");
    expect(p.storeKey).toBe("rs.wr.abcdefghijklmnop");
    expect(p.downloadHref).toBe("/api/v1/public/agent/request-download?ref=abcdefghijklmnop");
    expect(p.framed).toBe(true);
  });
  it("readStored(ref) eski davranış = readStoredAt(rs.wr.<ref>)", () => {
    const v = JSON.stringify({ requestSecret: "x", requestCode: "T-1" });
    const store = { getItem: (k: string) => (k === "rs.wr.r1" ? v : null) };
    expect(readStored("r1", store)).toEqual(readStoredAt("rs.wr.r1", store));
  });
});

describe("P21 portal geçmiş görünümü (K-P21-7)", () => {
  it("sorgu: bilinmeyen sekme/sayfa → varsayılan; sayfa sayısı; bağlantılar", () => {
    expect(parsePortalQuery({ tab: "sessions", page: "3" })).toEqual({ tab: "sessions", page: 3 });
    expect(parsePortalQuery({ tab: "x", page: "-1" })).toEqual({ tab: "requests", page: 1 });
    expect(parsePortalQuery({ page: "10001" }).page).toBe(1);
    expect(pagesOf(0)).toBe(1);
    expect(pagesOf(26)).toBe(2);
    expect(portalHref("requests")).toBe("/portal");
    expect(portalHref("sessions", 2)).toBe("/portal?tab=sessions&page=2");
  });
  it("meta: anonim kişi adı '—', süre biçimli, mod etiketi", () => {
    const r = requestFacts({ id: ULID, requestCode: "T-1", status: "PENDING", source: "WEB", priority: "HIGH", requesterName: null, createdAt: "2026-11-20T09:01:12.000Z", closedAt: null, sessionId: null });
    expect(r.requester).toBe("—");
    expect(r.closed).toBe("—");
    expect(r.priority).toBe("Yüksek");
    const s = sessionFacts({ id: ULID, status: "ENDED", mode: "AGENT", technicianName: "Ayşe", customerName: null, ticketNo: null, createdAt: "2026-11-20T09:01:12.000Z", startedAt: null, endedAt: null, durationSec: 1705 });
    expect(s.contact).toBe("—");
    expect(s.mode).toBe("İstemci");
    expect(s.duration).not.toBe("—");
  });
});

describe("P21 K6 portal hesapları", () => {
  const acc = (p: Partial<PortalAccountItem>): PortalAccountItem => ({
    id: ULID, email: "a@b.co", fullName: "Ali", status: "ACTIVE", totpEnabled: false, mustChangePassword: false,
    tempPasswordExpired: false, lastLoginAt: null, createdAt: "2026-11-20T09:01:12.000Z", passiveAt: null, ...p,
  });
  it("oluşturma: müşteri pasif/anonim veya 20 hesap → kapalı + neden", () => {
    expect(createState(true, 0)).toEqual({ enabled: true, reason: null });
    expect(createState(false, 0).enabled).toBe(false);
    expect(createState(true, 20).reason).toContain("20");
  });
  it("doğrulama: boş alan zorunlu, e-posta küçük harfe", () => {
    expect(validateAccount({ email: "", fullName: "" }).errors).toMatchObject({ email: "Bu alan zorunludur.", fullName: "Bu alan zorunludur." });
    expect(validateAccount({ email: " Ali@Ornek.COM ", fullName: "Ali Veli" }).body).toEqual({ email: "ali@ornek.com", fullName: "Ali Veli" });
  });
  it("rozetler: süre doldu 'bekliyor'un yerine; pasifte şifre rozetleri yok", () => {
    expect(accountBadges(acc({ mustChangePassword: true }))).toEqual(["mustChange"]);
    expect(accountBadges(acc({ mustChangePassword: true, tempPasswordExpired: true, totpEnabled: true }))).toEqual(["mfa", "tempExpired"]);
    expect(accountBadges(acc({ status: "PASSIVE", mustChangePassword: true, tempPasswordExpired: true }))).toEqual([]);
  });
});
