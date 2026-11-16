// P28u-K4 oda başına hız sınırları (sahte saat): müdahale 6/dk (`intervene.ts` ön koşul zinciri, 429 RATE_LIMITED; mimari-p28u
// §5.3, AC-442) ve gözetimsiz odada kontrol isteği 30/dk (`unattended-control.ts`, K-P28u-16; AC-439). Dakika dolunca kova açılır.
// Soket mesaj kovaları (TokenBucket) aynı sahte saatle dolar: turlar arası 1 sn ilerletilir (toplam < 60 sn, pencere içinde).
import { INTERVENE_PER_MIN } from "@remote/contracts/api/unattended";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNATTENDED_CONTROL_PER_MIN } from "../../src/signaling/unattended-control.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { grantControl, helperIn, readyK4, silentPending, techConsole } from "../helpers/unattended-k4.ts";
import { FakeClock } from "../helpers/ws.ts";

// Test başına ayrı sahte saat + sunucu: bir testin ilerlettiği saat ötekinin PENDING oturumunu (gerçek saatle 60 sn) düşürmesin.
let faked: Live;
let clock: FakeClock;
beforeEach(async () => {
  clock = new FakeClock();
  faked = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { clock, revalidateMs: 60_000 } });
});
afterEach(async () => faked.close());

type Intervene = { t: "intervene"; sessionId: string; id: string };
const metric = (series: string): number => {
  const line = faked.app.metrics
    .render()
    .split("\n")
    .find((x) => x.startsWith(`${series} `));
  return line ? Number(line.split(" ").pop()) : 0;
};

async function silentRoom() {
  const r = await readyK4(faked);
  const { sessionId, ticket } = await silentPending(faked, r);
  const helper = await helperIn(faked, ticket);
  const { ws } = await techConsole(faked, r, sessionId);
  return { r, sessionId, helper, tech: ws };
}

describe("P28u-K4 hız sınırları (sahte saat)", () => {
  it("AC-442: müdahale oda başına 6/dk — 7. kilit 429 RATE_LIMITED (cihaza gitmez); 60 sn sonra yeniden kabul", async () => {
    expect(INTERVENE_PER_MIN).toBe(6);
    const { r, sessionId, helper, tech } = await silentRoom();
    await grantControl(tech, helper);
    const lock = () =>
      faked.app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/unattended/lock`, headers: r.s.headers, payload: {} });
    const answered = async () => {
      const p = lock();
      const m = (await r.device.waitFor("intervene" as never)) as unknown as Intervene;
      r.device.send({ t: "intervene.result", sessionId, id: m.id, cmd: "lock", ok: true });
      expect((await p).statusCode).toBe(200);
    };
    for (let i = 0; i < INTERVENE_PER_MIN; i++) {
      await answered();
      clock.advance(1_000);
    }
    const seventh = await lock();
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(r.device.msgs.some((m) => m.t === ("intervene" as never))).toBe(false);
    clock.advance(60_000);
    await answered();
  });

  it("AC-439 K-P28u-16: gözetimsiz kontrol isteği 30/dk — 31. istek RATE_LIMITED + metrik, yardımcıya gitmez; 60 sn sonra açılır", async () => {
    expect(UNATTENDED_CONTROL_PER_MIN).toBe(30);
    const { helper, tech } = await silentRoom();
    const series = 'rs_control_total{event="unattended_rate"}';
    const before = metric(series);
    for (let i = 0; i < UNATTENDED_CONTROL_PER_MIN; i++) {
      await grantControl(tech, helper);
      tech.send({ t: "control.release" });
      await helper.waitFor("control.release");
      clock.advance(1_000);
    }
    tech.send({ t: "control.request" });
    expect((await tech.waitFor("error")).code).toBe("RATE_LIMITED");
    expect(metric(series)).toBe(before + 1);
    expect(helper.msgs.some((m) => m.t === "control.request")).toBe(false);
    clock.advance(60_000);
    await grantControl(tech, helper);
  });
});
