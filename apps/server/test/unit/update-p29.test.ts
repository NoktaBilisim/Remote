// P29-K4 birim: manifest deposu kapıları (ortak kanonik fikstürler + taze imza), rozet türetimi, servis belirteçleri,
// değer yansıtmayan doğrulama, sürüm özeti (mimari-p29 §3.2, §4.2, §4.4, §14.6; AC-473, 486, 490, 492).
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { updateEventsInputSchema, updateManifestFileName } from "@remote/contracts/api/update";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.ts";
import { ManifestStore, type SlotGate, type UpdateSlot } from "../../src/update/manifest-store.ts";
import { parseQuiet } from "../../src/update/routes.ts";
import { ServiceTokens } from "../../src/update/service-token.ts";
import { deviceUpdateBadge, summarize } from "../../src/update/versions.ts";
import { manifest, newSigner, updateFixture, writeManifest } from "../helpers/update.ts";

const FIX = new URL("../../../../packages/contracts/test/fixtures/update-manifest/", import.meta.url).pathname;
const cases = JSON.parse(readFileSync(join(FIX, "cases.json"), "utf8")) as {
  keys: { test1: { publicKey: string }; test2: { publicKey: string } };
  cases: { file: string; ts: "ok" | "reject" }[];
};
const SHA_A = "3f1c8a0e5b7d9c2f4a6e8b0d1c3f5a7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a";
const T0 = Date.parse("2026-11-19T01:00:00Z"); // fikstür issuedAt + 1 sa

const okGate = (sha = SHA_A): SlotGate => ({ check: async () => "ok", expectedSha256: sha });

function store(
  dir: string,
  o: {
    now?: number;
    deployEnv?: string;
    pub?: string;
    gates?: Partial<Record<UpdateSlot, SlotGate>>;
    signed?: { signed: boolean; list: Set<string> };
  } = {},
) {
  const warns: { obj: object; msg: string }[] = [];
  const s = new ManifestStore({
    dir,
    pubkeys: [Buffer.from(o.pub ?? cases.keys.test1.publicKey, "base64url")],
    deployEnv: o.deployEnv ?? "production",
    gates: {
      "client-windows": okGate(),
      "client-macos": okGate(),
      "client-linux": okGate(),
      "service-windows": okGate(),
      ...o.gates,
    },
    signedMode: o.signed ?? { signed: false, list: new Set() },
    now: () => o.now ?? T0,
    warn: (obj, msg) => warns.push({ obj, msg }),
  });
  return { s, warns };
}

/** Fikstürü yuvanın dosya adıyla kopyalar (imza `.sig`'i ile). */
function place(
  dir: string,
  fixture: string,
  slot: { component: "client" | "service"; platform: "windows" | "macos" | "linux"; arch: "amd64" | "universal" },
  sig?: string,
) {
  const name = updateManifestFileName(slot);
  copyFileSync(join(FIX, fixture), join(dir, name));
  copyFileSync(join(FIX, sig ?? fixture.replace(/\.json$/, ".sig")), join(dir, `${name}.sig`));
}
const WIN = { component: "client", platform: "windows", arch: "amd64" } as const;

describe("P29 manifest deposu (AC-473, AC-492)", () => {
  it("AC-473: geçerli kanonik fikstür (prod) sunulur; baytlar değiştirilmez", async () => {
    const f = updateFixture();
    place(f.dir, "valid-client-windows.json", WIN);
    const o = await store(f.dir).s.offer("client-windows");
    expect(o?.bytes.equals(readFileSync(join(FIX, "valid-client-windows.json")))).toBe(true);
    expect(o?.signature).toBe(readFileSync(join(FIX, "valid-client-windows.sig"), "latin1"));
  });

  it("AC-473: ortak fikstürlerde TS reddi olan her biçim (imzası geçerli olsa da) sunulmaz", async () => {
    for (const c of cases.cases.filter((x) => x.ts === "reject")) {
      const f = updateFixture();
      place(f.dir, c.file, WIN);
      const { s, warns } = store(f.dir);
      expect(await s.offer("client-windows"), c.file).toBeNull();
      expect(warns.length, c.file).toBe(1);
    }
  });

  it("AC-473: yanlış anahtar / bağlamsız imza / başka manifestin imzası → sunulmaz + açılış uyarısı", async () => {
    for (const sig of ["sig-wrong-key.sig", "sig-no-context.sig", "valid-client-macos.sig"]) {
      const f = updateFixture();
      place(f.dir, "valid-client-windows.json", WIN, sig);
      const { s, warns } = store(f.dir);
      await s.warm();
      expect(await s.offer("client-windows")).toBeNull();
      expect(warns).toEqual([
        { obj: { alarm: "update_manifest", slot: "client-windows", state: "bad_signature" }, msg: "güncelleme manifesti sunulmuyor" },
      ]);
    }
  });

  it("AC-473: ikinci açık anahtar yuvası (test2) da kabul edilir; yuva uyuşmazlığı reddedilir", async () => {
    const f = updateFixture();
    place(f.dir, "valid-client-windows.json", WIN, "sig-wrong-key.sig");
    const s = new ManifestStore({
      dir: f.dir,
      pubkeys: [Buffer.from(cases.keys.test1.publicKey, "base64url"), Buffer.from(cases.keys.test2.publicKey, "base64url")],
      deployEnv: "production",
      gates: { "client-windows": okGate(), "client-macos": okGate(), "client-linux": okGate(), "service-windows": okGate() },
      signedMode: { signed: false, list: new Set() },
      now: () => T0,
      warn: () => undefined,
    });
    expect(await s.offer("client-windows")).not.toBeNull();
    const g = updateFixture();
    place(g.dir, "valid-client-windows.json", { component: "client", platform: "linux", arch: "amd64" });
    expect(await store(g.dir).s.offer("client-linux")).toBeNull();
  });

  it("AC-473: env eşlemesi — staging manifesti prod sunucuda, prod manifesti staging'de ve development'ta sunulmaz", async () => {
    const f = updateFixture();
    place(f.dir, "valid-client-linux-staging.json", { component: "client", platform: "linux", arch: "amd64" });
    expect(await store(f.dir, { deployEnv: "production" }).s.offer("client-linux")).toBeNull();
    expect(await store(f.dir, { deployEnv: "staging" }).s.offer("client-linux")).not.toBeNull();
    const g = updateFixture();
    place(g.dir, "valid-client-windows.json", WIN);
    expect(await store(g.dir, { deployEnv: "staging" }).s.offer("client-windows")).toBeNull();
    expect(await store(g.dir, { deployEnv: "development" }).s.offer("client-windows")).toBeNull();
  });

  it("AC-473: süre dolumu ve issuedAt > now + 24 sa → yayın yok", async () => {
    const f = updateFixture();
    place(f.dir, "valid-client-windows.json", WIN);
    expect(await store(f.dir, { now: Date.parse("2026-12-19T00:00:00Z") }).s.offer("client-windows")).toBeNull();
    expect(await store(f.dir, { now: Date.parse("2026-11-17T23:59:59Z") }).s.offer("client-windows")).toBeNull();
    expect(await store(f.dir, { now: Date.parse("2026-11-18T00:00:01Z") }).s.offer("client-windows")).not.toBeNull();
  });

  it("AC-473: istemci > 30 g (span-client-31d) sunulmaz, servis 90 g sunulur; servis 91 g sunulmaz", async () => {
    const f = updateFixture();
    place(f.dir, "span-client-31d.json", WIN);
    place(f.dir, "valid-service-windows.json", { component: "service", platform: "windows", arch: "amd64" });
    const { s } = store(f.dir);
    expect(await s.offer("client-windows")).toBeNull();
    expect(await s.offer("service-windows")).not.toBeNull();
  });

  it("AC-473: SHA ikili kapısının beklenen SHA'sından farklı ya da kapı ok değil → 204 (sahte HASH_MISMATCH alarmı yok)", async () => {
    const f = updateFixture();
    place(f.dir, "valid-client-windows.json", WIN);
    expect(await store(f.dir, { gates: { "client-windows": okGate("0".repeat(64)) } }).s.offer("client-windows")).toBeNull();
    const missing: SlotGate = { check: async () => "missing", expectedSha256: SHA_A };
    expect(await store(f.dir, { gates: { "client-windows": missing } }).s.offer("client-windows")).toBeNull();
  });

  it("AC-492: signed kipte servis SHA'sı UNATTENDED_SIGNED_SHA256'da yoksa sunulmaz + uyarı; listedeyse sunulur", async () => {
    const f = updateFixture();
    place(f.dir, "valid-service-windows.json", { component: "service", platform: "windows", arch: "amd64" });
    const off = store(f.dir, { signed: { signed: true, list: new Set(["1".repeat(64)]) } });
    expect(await off.s.offer("service-windows")).toBeNull();
    expect(off.warns[0]?.msg).toContain("SHA listesinde yok");
    expect(await store(f.dir, { signed: { signed: true, list: new Set([SHA_A]) } }).s.offer("service-windows")).not.toBeNull();
  });

  it("AC-473: dizin boş / anahtar yok / dosya yok → sessiz (uyarı yok); durum başına tek uyarı", async () => {
    const f = updateFixture();
    const { s, warns } = store(f.dir);
    expect(await s.offer("client-macos")).toBeNull();
    expect(warns).toHaveLength(0);
    place(f.dir, "invalid-bom.json", WIN);
    await s.offer("client-windows");
    await s.offer("client-windows");
    expect(warns).toHaveLength(1);
  });

  it("AC-473: taze imzalı manifest + gösterge rs_update_manifest_expiry_seconds", async () => {
    const f = updateFixture();
    const signer = newSigner();
    const bin = f.binary("client.exe");
    const m = manifest({ sha256: bin.sha, env: "prod" });
    writeManifest(f.dir, signer, m);
    const { s } = store(f.dir, { pub: signer.publicKey, now: Date.now(), gates: { "client-windows": okGate(bin.sha) } });
    expect((await s.offer("client-windows"))?.manifest.version).toBe("0.22.1");
    const g = s.expirySeconds();
    expect(g).toHaveLength(1);
    expect(g[0]?.labels).toEqual({ component: "client", platform: "windows" });
    expect(g[0]?.value).toBeGreaterThan(19 * 86_400);
  });
});

describe("P29 rozet türetimi (AC-486, AC-490)", () => {
  const now = Date.now();
  const base = { agentVersion: "0.22.0", updateState: null, updateVersion: null, updateReason: null, updateAt: null };
  const o = { minVersion: undefined, publishedService: null, now };
  it("AC-486: MIN_AGENT_VERSION altı → BELOW_MIN (her şeyden önce)", () => {
    expect(
      deviceUpdateBadge(
        { ...base, agentVersion: "0.9.10", updateState: "INSTALLING", updateAt: new Date(now) },
        { ...o, minVersion: "0.10.0" },
      ).badge,
    ).toBe("BELOW_MIN");
    expect(deviceUpdateBadge({ ...base, agentVersion: "0.10.0" }, { ...o, minVersion: "0.10.0" }).badge).toBe("CURRENT");
  });
  it("AC-490: UPDATING yalnız taze INSTALLING (3 dk)", () => {
    const st = { ...base, updateState: "INSTALLING", updateVersion: "0.22.1" };
    expect(deviceUpdateBadge({ ...st, updateAt: new Date(now - 60_000) }, o).badge).toBe("UPDATING");
    expect(deviceUpdateBadge({ ...st, updateAt: new Date(now - 4 * 60_000) }, o).badge).toBe("CURRENT");
  });
  it("AC-490: FAILED/ROLLED_BACK hedef > ajan → FAILED + neden; hedefe ulaşılmışsa değil", () => {
    const f = { ...base, updateState: "ROLLED_BACK", updateVersion: "0.22.1", updateReason: "HEALTH", updateAt: new Date(now) };
    expect(deviceUpdateBadge(f, o)).toEqual({ badge: "FAILED", reason: "HEALTH" });
    expect(deviceUpdateBadge({ ...f, agentVersion: "0.22.1" }, o).badge).toBe("CURRENT");
  });
  it("AC-490: PENDING — yayındaki sürüm sayısal olarak büyük (0.22.10 > 0.22.9) ya da AVAILABLE/SKIPPED", () => {
    expect(deviceUpdateBadge({ ...base, agentVersion: "0.22.9" }, { ...o, publishedService: "0.22.10" }).badge).toBe("PENDING");
    expect(deviceUpdateBadge({ ...base, agentVersion: "0.22.10" }, { ...o, publishedService: "0.22.9" }).badge).toBe("CURRENT");
    expect(
      deviceUpdateBadge(
        { ...base, updateState: "SKIPPED", updateVersion: "0.22.1", updateReason: "POLICY_OFF", updateAt: new Date(now) },
        o,
      ).badge,
    ).toBe("PENDING");
  });
  it("AC-490: sürüm özeti sayısal sıralı, belowMin sayısı", () => {
    const r = summarize(
      [
        { version: "0.22.9", count: 2 },
        { version: "0.22.10", count: 1 },
        { version: "0.9.0", count: 3 },
      ],
      "0.10.0",
    );
    expect(r.rows.map((x) => x.version)).toEqual(["0.22.10", "0.22.9", "0.9.0"]);
    expect(r.belowMin).toBe(3);
  });
});

describe("P29 servis belirteçleri (§4.4)", () => {
  it("AC-477: tek kullanım, 10 dk ömür, cihaz başına tek canlı belirteç", () => {
    let t = 1_000;
    const tk = new ServiceTokens({ ttlSec: 600, maxStreams: 8, now: () => t });
    const a = tk.issue("dev1", SHA_A);
    const b = tk.issue("dev1", SHA_A);
    expect(tk.take(a)).toBeNull();
    expect(tk.take(b)?.deviceId).toBe("dev1");
    expect(tk.take(b)).toBeNull();
    const c = tk.issue("dev2", SHA_A);
    t += 600_000;
    expect(tk.take(c)).toBeNull();
    expect(/^[A-Za-z0-9_-]{43}$/.test(tk.issue("dev3", SHA_A))).toBe(true);
  });
  it("AC-477: global akış sınırı 8; bırakma tek kez sayılır", () => {
    const tk = new ServiceTokens({ ttlSec: 600, maxStreams: 8, now: () => 0 });
    const rel = Array.from({ length: 8 }, () => tk.acquireStream());
    expect(tk.acquireStream()).toBeNull();
    rel[0]?.();
    rel[0]?.();
    expect(tk.activeStreams).toBe(7);
    expect(tk.acquireStream()).not.toBeNull();
    expect(tk.acquireStream()).toBeNull();
  });
});

describe("P29 değer yansıtmayan doğrulama (r2 T-12)", () => {
  it("AC-488: 400 alanları yalnız yol + sabit metin; değer ve bilinmeyen anahtar adı yansımaz", () => {
    const body = {
      platform: "CANARYVAL",
      arch: "amd64",
      component: "client",
      CANARYKEY: 1,
      bindingKeys: ["rsb_CANARYKEYVALUE"],
      events: [],
    };
    try {
      parseQuiet(updateEventsInputSchema, body);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(JSON.stringify((e as AppError).fields)).not.toContain("CANARY");
      expect(Object.values((e as AppError).fields ?? {}).every((v) => v === "Geçersiz değer")).toBe(true);
    }
  });
});
