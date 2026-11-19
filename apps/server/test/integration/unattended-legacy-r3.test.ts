// P28u r3 AC-451: r3 öncesi kayıtlar okunur kalır — `asked` / `silent` oturumlar, `silent_reason`, CANCELLED(consent_*) bitişleri,
// eski audit eylemleri; kullanıcıda saklı `unattended.silent` yetki satırı giriş, yetki ekranı ve kaydetmeyi bozmaz, kayıtta
// silinir (K-P28u-r3-8). Politika uçları ve `status.silentAllowed` kaldırıldı (K-P28u-r3-12).
import { RETIRED_PERMISSION_KEYS } from "@remote/contracts/permissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, loginAs, loginStepUp, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { readyK4 } from "../helpers/unattended-k4.ts";
import { LEGACY_REASON, legacySession } from "../helpers/unattended-legacy.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => live.close());

describe("P28u r3 eski kayıt okuma (AC-451)", () => {
  it("AC-451: eski silent oturum geçmiş detayında kip + gerekçe; consent_denied bitişli asked oturum listede ve consentMode filtresinde", async () => {
    const r = await readyK4(live);
    const silent = await legacySession(r, "silent");
    const denied = await legacySession(r, "asked", "consent_denied");
    const det = await live.app.inject({ method: "GET", url: `/api/v1/sessions/${silent}/history`, headers: r.s.headers });
    expect(det.statusCode).toBe(200);
    expect(det.json<{ unattended: unknown }>().unattended).toMatchObject({ consentMode: "silent", silentReason: LEGACY_REASON });
    const list = await live.app.inject({ method: "GET", url: "/api/v1/sessions?consentMode=asked", headers: r.s.headers });
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: { id: string; consentMode: string | null; endReason?: string | null }[] }>().items;
    expect(items.find((i) => i.id === denied)).toMatchObject({ consentMode: "asked" });
    expect(items.some((i) => i.id === silent)).toBe(false);
  });

  it("AC-451 K-P28u-r3-8 S-P28u-r3-3: saklı unattended.silent satırı giriş/me/kullanıcı ekranını bozmaz; kaydetmede silinir; yetki vermez", async () => {
    expect(RETIRED_PERMISSION_KEYS).toContain("unattended.silent");
    const r = await readyK4(live);
    const tech = await createUser({ tenantId: r.tenantId, role: "USER", perms: { "unattended.connect": true, "unattended.silent": true } });
    const ts = await loginAs(live.app, tech);
    const me = await live.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: ts.headers });
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain("unattended.silent");
    const admin = await loginStepUp(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    const get = await live.app.inject({ method: "GET", url: `/api/v1/users/${tech.id}`, headers: admin.headers });
    expect(get.statusCode).toBe(200);
    expect(get.body).not.toContain("unattended.silent");
    const patch = await live.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${tech.id}`,
      headers: { ...admin.headers, "if-match": get.headers.etag as string },
      payload: { permissions: { "unattended.connect": true, "sessions.view": true } }, // gerçek değişiklik → yazım
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(await testDb().userPermission.count({ where: { userId: tech.id, permKey: "unattended.silent" } })).toBe(0);
    // Eski web istemcisi kaldırılmış anahtarı gönderirse 400 (permissionMapSchema yalnız tanımlı anahtar).
    const etag = (await live.app.inject({ method: "GET", url: `/api/v1/users/${tech.id}`, headers: admin.headers })).headers.etag as string;
    const stale = await live.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${tech.id}`,
      headers: { ...admin.headers, "if-match": etag },
      payload: { permissions: { "unattended.silent": true } },
    });
    expect(stale.statusCode).toBe(400);
  });

  it("K-P28u-r3-12: politika uçları kaldırıldı (404); /unattended/status silentAllowed taşımaz", async () => {
    const r = await readyK4(live);
    const admin = await loginStepUp(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    expect((await live.app.inject({ method: "GET", url: "/api/v1/unattended/policy", headers: admin.headers })).statusCode).toBe(404);
    const put = await live.app.inject({
      method: "PUT",
      url: "/api/v1/unattended/policy",
      headers: admin.headers,
      payload: { silentEnabled: true, ack: true },
    });
    expect(put.statusCode).toBe(404);
    const st = await live.app.inject({ method: "GET", url: "/api/v1/unattended/status", headers: admin.headers });
    expect(st.statusCode).toBe(200);
    expect(st.json()).not.toHaveProperty("silentAllowed");
  });
});
