import { CSRF_COOKIE } from "@remote/contracts/api/auth";
import { describe, expect, it, vi } from "vitest";
import { buildStepUp, lowRecoveryLeft, stepUpErrorOf } from "@/lib/account/step-up";
import { api, ApiError, isUnauthenticated, setStepUpHandler, STEP_UP_CANCELLED_MESSAGE } from "@/lib/api";
import { userEtag } from "@/lib/users/contract";
import { lockedKeys, normalize, permsForRole } from "@/lib/users/permissions";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const stepUp401 = () => json(401, { error: { code: "MFA_STEP_UP_REQUIRED", message: "Doğrulama gerekli", requestId: "r1" } });
const deps = (f: typeof fetch) => ({ fetch: f, cookie: () => `${CSRF_COOKIE}=c` });

describe("AC-215: api istemcisi step-up yakalama", () => {
  it("AC-215: 401 MFA_STEP_UP_REQUIRED → diyalog → istek bir kez tekrarlanır", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(stepUp401())
      .mockResolvedValueOnce(json(200, { ok: true }));
    const h = vi.fn().mockResolvedValue(true);
    const off = setStepUpHandler(h);
    try {
      await expect(api("PUT", "/admin/settings/mysql", { a: 1 }, deps(f))).resolves.toEqual({ ok: true });
      expect(h).toHaveBeenCalledTimes(1);
      expect(f).toHaveBeenCalledTimes(2);
      expect(f.mock.calls[1]![1].body).toBe(JSON.stringify({ a: 1 }));
    } finally {
      off();
    }
  });

  it("AC-215: tekrar da step-up isterse döngü yok — ikinci 401 çağırana gider", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(stepUp401()));
    const h = vi.fn().mockResolvedValue(true);
    const off = setStepUpHandler(h);
    try {
      await expect(api("PUT", "/x", {}, deps(f))).rejects.toMatchObject({ status: 401, code: "MFA_STEP_UP_REQUIRED" });
      expect(f).toHaveBeenCalledTimes(2);
      expect(h).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it("AC-215: vazgeçilirse istek tekrarlanmaz; hata oturum düşmesi sayılmaz (girişe yönlendirme yok)", async () => {
    const f = vi.fn().mockResolvedValue(stepUp401());
    const off = setStepUpHandler(() => Promise.resolve(false));
    try {
      const e = await api("DELETE", "/x", undefined, deps(f)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toBe(STEP_UP_CANCELLED_MESSAGE);
      expect(isUnauthenticated(e)).toBe(false);
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
    expect(isUnauthenticated(new ApiError(401, "UNAUTHENTICATED", ""))).toBe(true);
  });

  it("AC-215: eşzamanlı iki istek tek diyalog açar", async () => {
    let n = 0;
    const f = vi.fn().mockImplementation(() => Promise.resolve(n++ < 2 ? stepUp401() : json(200, { ok: n })));
    let release: (v: boolean) => void = () => {};
    const h = vi.fn().mockImplementation(() => new Promise<boolean>((r) => (release = r)));
    const off = setStepUpHandler(h);
    try {
      const a = api("PUT", "/a", {}, deps(f));
      const b = api("PUT", "/b", {}, deps(f));
      await vi.waitFor(() => expect(h).toHaveBeenCalledTimes(1));
      release(true);
      await Promise.all([a, b]);
      expect(h).toHaveBeenCalledTimes(1);
      expect(f).toHaveBeenCalledTimes(4);
    } finally {
      off();
    }
  });

  it("AC-215: işleyici yoksa (giriş ekranları) 401 olduğu gibi fırlatılır", async () => {
    const f = vi.fn().mockResolvedValue(stepUp401());
    await expect(api("PUT", "/x", {}, deps(f))).rejects.toMatchObject({ code: "MFA_STEP_UP_REQUIRED" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("AC-215: girdi doğrulama — TOTP 6 hane, kurtarma kodu biçimi; boş alan zorunlu", () => {
    expect(buildStepUp("TOTP", "123456").body).toEqual({ method: "TOTP", code: "123456" });
    expect(buildStepUp("TOTP", "12345").error).toBeTruthy();
    expect(buildStepUp("TOTP", "").error).toBe("Bu alan zorunludur.");
    expect(buildStepUp("RECOVERY", "abcde-fghij").body).toEqual({ method: "RECOVERY", code: "ABCDE-FGHIJ" });
    expect(buildStepUp("RECOVERY", "x").error).toBeTruthy();
  });

  it("AC-215: hatalı kod 400 fields.code → alan temizlenir; 429 süreli kilit metni", () => {
    const wrong = stepUpErrorOf(new ApiError(400, "VALIDATION", "x", { code: "Kod hatalı" }), "TOTP");
    expect(wrong.clear).toBe(true);
    expect(wrong.message).toMatch(/Kod hatalı/);
    const locked = stepUpErrorOf(new ApiError(429, "RATE_LIMITED", "", undefined, undefined, 120), "TOTP");
    expect(locked).toEqual({ message: expect.stringContaining("2 dakika"), clear: false });
  });

  it("AC-215: kalan kurtarma kodu ≤ 3 → uyarı; TOTP'de ve 4+ kodda yok", () => {
    expect(lowRecoveryLeft({ method: "RECOVERY", recoveryCodesLeft: 3 })).toBe(3);
    expect(lowRecoveryLeft({ method: "RECOVERY", recoveryCodesLeft: 0 })).toBe(0);
    expect(lowRecoveryLeft({ method: "RECOVERY", recoveryCodesLeft: 4 })).toBeNull();
    expect(lowRecoveryLeft({ method: "TOTP" })).toBeNull();
  });
});

describe("AC-206: If-Match ve rol geri alma", () => {
  it("AC-206: PATCH isteği If-Match başlığını taşır", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { id: "u" }));
    await api("PATCH", "/users/u", { fullName: "A" }, deps(f), { headers: { "If-Match": userEtag(7) } });
    expect(f.mock.calls[0]![1].headers["If-Match"]).toBe('"v7"');
    expect(f.mock.calls[0]![1].headers.Accept).toBe("application/json");
  });

  it("AC-206: rol değiştirilip kaydetmeden geri alınınca kayıtlı ezmeler geri gelir", () => {
    const saved = normalize({ "sessions.view": true, "users.view": true });
    const locked = lockedKeys({ role: "SUPER_ADMIN", permissions: [] });
    const asAdmin = permsForRole("ADMIN", { role: "USER", perms: saved }, saved, locked);
    expect(Object.values(asAdmin).every(Boolean)).toBe(true);
    const back = permsForRole("USER", { role: "USER", perms: saved }, asAdmin, locked);
    expect(back).toEqual(saved);
    // Kayıtlı harita değişmeden kalır (kopya döner)
    back["sessions.view"] = false;
    expect(saved["sessions.view"]).toBe(true);
  });
});
