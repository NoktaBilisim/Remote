// K13 geçici çözümü (kullanıcı kararı 2026-11-15): `WHATSAPP_ALLOW_INSECURE_HTTP=true` iken WhatsApp hedefi için düz http
// (genel adres + anahtar) güvensiz sayılmaz; açılışta tek `whatsapp_insecure_http_allowed` alarmı; Super Admin görünümünde
// `insecureAllowed`. Bayrak kapalıyken (varsayılan) davranış ve SMS kuralı değişmez (regresyon).
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import type { Db } from "../../src/lib/db.ts";
import { isInsecureServiceTarget, isInsecureTargetAllowed } from "../../src/notify/service-url.ts";
import { WhatsappNotifier, type FetchLike } from "../../src/notify/whatsapp.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import type { SystemDeps } from "../../src/settings/system.ts";
import { getWhatsappSettings } from "../../src/settings/whatsapp.ts";
import { FAKE_WA_ENV_API_KEY } from "../helpers/secrets.ts";
import { FakeClock } from "../helpers/ws.ts";

const PUBLIC_HTTP = "http://203.0.113.10:3000";

function make(o: { url: string; apiKey?: string | null; production: boolean; allow?: boolean }) {
  const keys: (string | undefined)[] = [];
  const warns: Record<string, unknown>[] = [];
  const logged: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    keys.push(init.headers["x-api-key"]);
    return { ok: true, status: 200 };
  };
  const push = (obj: object, msg: string) => {
    warns.push(obj as Record<string, unknown>);
    logged.push(JSON.stringify(obj) + msg);
  };
  const n = new WhatsappNotifier({
    url: o.url,
    apiKey: o.apiKey ?? null,
    production: o.production,
    ...(o.allow === undefined ? {} : { allowInsecureHttp: o.allow }),
    publicBaseUrl: "https://rs.test",
    db: {} as Db,
    log: { info: () => undefined, warn: push, error: push },
    metrics: createMetrics(),
    clock: new FakeClock(),
    fetch,
  });
  return { n, keys, warns, logged };
}

describe("K13 service-url: allowInsecureHttp", () => {
  it("bayrak kapalı (varsayılan): production + http genel adres ve anahtar + düz http güvensiz (regresyon)", () => {
    expect(isInsecureServiceTarget(PUBLIC_HTTP, false, true)).toBe(true);
    expect(isInsecureServiceTarget(PUBLIC_HTTP, false, true, false)).toBe(true);
    expect(isInsecureServiceTarget("http://10.0.0.5:3000", true, true)).toBe(true); // anahtar + düz http (S-P13b-8)
    expect(isInsecureServiceTarget("http://10.0.0.5:3000", false, true)).toBe(false);
    expect(isInsecureServiceTarget("https://wa.example.com", true, true)).toBe(false);
    expect(isInsecureServiceTarget(PUBLIC_HTTP, true, false)).toBe(false); // geliştirme ortamı
    expect(isInsecureTargetAllowed(PUBLIC_HTTP, true, true, false)).toBe(false);
  });

  it("bayrak açık: düz http (genel adres, anahtar dahil) güvensiz sayılmaz; ayrıştırılamayan adres yine fail-closed", () => {
    expect(isInsecureServiceTarget(PUBLIC_HTTP, true, true, true)).toBe(false);
    expect(isInsecureServiceTarget("http://10.0.0.5:3000", true, true, true)).toBe(false);
    expect(isInsecureServiceTarget("http://a:99999", false, true, true)).toBe(true);
    expect(isInsecureServiceTarget("https://kul:sifre@wa.example.com", false, true, true)).toBe(true);
    expect(isInsecureTargetAllowed(PUBLIC_HTTP, true, true, true)).toBe(true);
    expect(isInsecureTargetAllowed("https://wa.example.com", true, true, true)).toBe(false); // zaten güvenli → uyarı yok
    expect(isInsecureTargetAllowed(PUBLIC_HTTP, true, false, true)).toBe(false); // geliştirmede kural yok → uyarı yok
    expect(isInsecureTargetAllowed("http://a:99999", false, true, true)).toBe(false);
  });
});

describe("K13 WhatsappNotifier", () => {
  it("bayrak kapalı: production + http genel adres + anahtar → kanal kapalı, istek yok, eski alarm (regresyon)", async () => {
    const { n, keys, warns } = make({ url: PUBLIC_HTTP, apiKey: FAKE_WA_ENV_API_KEY, production: true });
    expect(n.insecure).toBe(true);
    expect(n.insecureAllowed).toBe(false);
    expect(n.usable).toBe(false);
    expect((await n.test("+905321112233")).reason).toBe("insecure");
    expect(keys).toEqual([]);
    expect(warns.map((w) => w.alarm)).toEqual(["whatsapp_insecure"]);
  });

  it("bayrak açık: kanal açık, anahtar gönderilir, açılışta tek alarm; adres ve anahtar loga yazılmaz", async () => {
    const { n, keys, warns, logged } = make({ url: PUBLIC_HTTP, apiKey: FAKE_WA_ENV_API_KEY, production: true, allow: true });
    expect(n.insecure).toBe(false);
    expect(n.insecureAllowed).toBe(true);
    expect(n.usable).toBe(true);
    expect((await n.test("+905321112233")).ok).toBe(true);
    expect(keys).toEqual([FAKE_WA_ENV_API_KEY]);
    n.setUrl("http://203.0.113.11:3000", FAKE_WA_ENV_API_KEY); // panel kaydı uygulanır → yeni alarm yok
    expect(warns).toEqual([{ alarm: "whatsapp_insecure_http_allowed" }]);
    expect(logged.join("\n")).not.toContain("203.0.113");
    expect(logged.join("\n")).not.toContain(FAKE_WA_ENV_API_KEY);
  });

  it("bayrak açık: https adreste insecureAllowed false; ayrıştırılamayan adres kapalı (alarm whatsapp_invalid_url)", () => {
    const { n, warns } = make({ url: "https://wa.example.com", apiKey: FAKE_WA_ENV_API_KEY, production: true, allow: true });
    expect(n.usable).toBe(true);
    expect(n.insecureAllowed).toBe(false);
    n.setUrl("http://a:99999");
    expect(n.insecure).toBe(true);
    expect(n.insecureAllowed).toBe(false);
    expect(warns.map((w) => w.alarm)).toEqual(["whatsapp_insecure_http_allowed", "whatsapp_invalid_url"]);
  });
});

describe("K13 Super Admin WhatsApp görünümü (getWhatsappSettings)", () => {
  const deps = (allow: boolean): SystemDeps =>
    ({
      db: { systemSetting: { findUnique: async () => null } },
      whatsappEnvUrl: PUBLIC_HTTP,
      whatsappEnvApiKey: FAKE_WA_ENV_API_KEY,
      whatsappAllowInsecureHttp: allow,
      production: true,
    }) as unknown as SystemDeps;

  it("bayrak kapalı: insecure true, insecureAllowed false (regresyon)", async () => {
    const v = await getWhatsappSettings(deps(false));
    expect(v).toMatchObject({ url: PUBLIC_HTTP, source: "env", insecure: true, insecureAllowed: false, apiKeySource: "env" });
  });

  it("bayrak açık: insecure false, insecureAllowed true (panel sarı uyarı)", async () => {
    const v = await getWhatsappSettings(deps(true));
    expect(v).toMatchObject({ url: PUBLIC_HTTP, insecure: false, insecureAllowed: true });
  });
});

describe("K13 env WHATSAPP_ALLOW_INSECURE_HTTP", () => {
  const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };
  it("varsayılan ve boş false; true/false kabul; başka değer açılışı durdurur", () => {
    expect(loadEnv(base).WHATSAPP_ALLOW_INSECURE_HTTP).toBe(false);
    expect(loadEnv({ ...base, WHATSAPP_ALLOW_INSECURE_HTTP: "" }).WHATSAPP_ALLOW_INSECURE_HTTP).toBe(false);
    expect(loadEnv({ ...base, WHATSAPP_ALLOW_INSECURE_HTTP: "true" }).WHATSAPP_ALLOW_INSECURE_HTTP).toBe(true);
    expect(loadEnv({ ...base, WHATSAPP_ALLOW_INSECURE_HTTP: "false" }).WHATSAPP_ALLOW_INSECURE_HTTP).toBe(false);
    expect(() => loadEnv({ ...base, WHATSAPP_ALLOW_INSECURE_HTTP: "1" })).toThrow(/WHATSAPP_ALLOW_INSECURE_HTTP/);
  });
});
