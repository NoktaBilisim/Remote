// P22-GQ: gerçek konsol (Playwright) ↔ Go istemci 0.21.0 flow katmanı (zz_p22g_live_test.go probu) ↔ gerçek sunucu.
// Yalnız yerel. Koşu: up.sh notu (docs/test-raporu.md "P22-GQ"). Gövde/parola yazdırılmaz; sonuç $OUT/akis.jsonl.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { api, cancelLeftovers, login, USERS } from "./lib";

const OUT = process.env.P22_OUT ?? "/tmp";
const PROBE = process.env.P22G_PROBE!;
mkdirSync(`${OUT}/img`, { recursive: true });
const rec = (o: Record<string, unknown>) => appendFileSync(`${OUT}/akis.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");

function sql(q: string): string {
  const u = new URL(process.env.TEST_DATABASE_URL!);
  return execFileSync("docker", ["exec", "-e", `MYSQL_PWD=${decodeURIComponent(u.password)}`, "rs-p22-test", "mysql", "-N", "-uapp", "remote", "-e", q], {
    encoding: "utf8",
  }).trim();
}

type Ev = Record<string, any>;
class Probe {
  proc!: ChildProcess;
  constructor(
    readonly name: string,
    readonly out = `${OUT}/probe-${name}.jsonl`,
    readonly cmd = `${OUT}/probe-${name}.cmd`,
  ) {}
  start(code: string, mode = "") {
    writeFileSync(this.out, "");
    writeFileSync(this.cmd, "");
    this.proc = spawn(PROBE, ["-test.run", "TestP22GLive", "-test.v", "-test.timeout", "9m"], {
      env: { ...process.env, P22G_UPSTREAM: "http://127.0.0.1:3483", P22G_CODE: code, P22G_OUT: this.out, P22G_CMD: this.cmd, P22G_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    this.proc.stdout!.on("data", (b) => (log += b));
    this.proc.stderr!.on("data", (b) => (log += b));
    this.proc.on("exit", () => writeFileSync(`${OUT}/probe-${this.name}.log`, log));
  }
  evs(): Ev[] {
    return existsSync(this.out) ? readFileSync(this.out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  }
  async wait(pred: (e: Ev) => boolean, ms = 30_000, what = "olay"): Promise<Ev> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const e = this.evs().find(pred);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`probe ${this.name}: ${what} gelmedi`);
  }
  lastChat(): Ev | undefined {
    return this.evs().filter((e) => e.ev === "chat").at(-1);
  }
  send(line: string) {
    appendFileSync(this.cmd, line + "\n");
  }
}

/** Konsoldaki ctl DataChannel'ını yakalar (eski DC `chat` enjeksiyonu için). */
function dcHook() {
  (window as any).__dcs = [];
  const P = window.RTCPeerConnection;
  class HP extends P {
    createDataChannel(l: string, i?: RTCDataChannelInit) {
      const dc = super.createDataChannel(l, i);
      (window as any).__dcs.push(dc);
      return dc;
    }
  }
  (window as any).RTCPeerConnection = HP;
}

let tech: BrowserContext;
let page: Page;
const occurrences = (s: string, sub: string) => s.split(sub).length - 1;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  tech = await browser.newContext();
  await login(tech, USERS.a1);
  page = await tech.newPage();
  await page.addInitScript(dcHook);
  page.on("pageerror", (e) => rec({ t: "pageerror-tech", e: String(e).slice(0, 200) }));
  page.on("console", (m) => m.type() === "error" && rec({ t: "console-tech", e: m.text().slice(0, 200) }));
});

test("G1 Go istemci ↔ konsol: AC-292 resolve, iki yön, DC chat yok, yeniden bağlanma + chat.history", async () => {
  await cancelLeftovers(tech);
  const s = (await api(tech, "POST", "/sessions", {})).json as { id: string; code: string };
  const days = Number(sql(`select ts.retention_days from tenant_settings ts join tenants t on t.id=ts.tenant_id where t.slug='demo'`));
  await page.goto(`/sessions/${s.id}/console`);
  const p = new Probe("g1");
  p.start(s.code);
  try {
    const feats = await p.wait((e) => e.ev === "features", 10_000, "features");
    const w = await p.wait((e) => e.ev === "welcome", 20_000, "welcome");
    rec({ t: "g1-welcome", features: feats.features, days: w.days, dbDays: days, line: w.line });
    expect(feats.features).toContain("rs.cap.schat1");
    expect(w.days).toBe(days);
    expect(w.line).toBe(`Sohbet mesajları kayıt altına alınır ve ${days} gün saklanır`);
    const lobby = await p.wait((e) => e.ev === "lobby", 20_000, "lobby");
    await page.getByTestId("admit-input").fill(lobby.code);
    await page.getByTestId("admit-submit").click();
    await expect(page.getByTestId("console-status")).toHaveText("Aktif", { timeout: 30_000 });
    await p.wait((e) => e.ev === "active", 20_000, "active");
    // giriş chat.state{true} gelene kadar pasif
    const chats0 = p.evs().filter((e) => e.ev === "chat");
    const on = await p.wait((e) => e.ev === "chat" && e.enabled === true, 20_000, "chat.state{true}");
    rec({ t: "g1-state", firstChatEnabled: chats0[0]?.enabled ?? null, firstStatus: chats0[0]?.status ?? null, enabledStatus: on.status });

    // Konsol → Go
    await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 15_000 });
    const notOutdated = (await page.getByTestId("chat-outdated").count()) === 0;
    await page.getByTestId("chat-input").fill("K1 konsoldan merhaba");
    await page.keyboard.press("Enter");
    const k1 = await p.wait((e) => e.ev === "chat" && String(e.text).includes("K1 konsoldan merhaba"), 15_000, "K1");
    rec({ t: "g1-tech-to-go", notOutdated, notify: k1.notify, techPrefix: /Teknisyen/.test(k1.text) });

    // Go → konsol (XSS benzeri gövde düz metin)
    const g1 = `G1 istemciden <script>alert(1)</script> ' OR 1=1`;
    p.send(`send ${g1}`);
    await expect(page.getByTestId("chat-msg").last()).toHaveText(g1, { timeout: 15_000 });
    const pendingSeen = p.evs().some((e) => e.ev === "chat" && String(e.text).includes("Siz (gönderiliyor…)"));
    const settled = await p.wait((e) => e.ev === "chat" && String(e.text).includes("G1 istemciden") && !String(e.text).includes("gönderiliyor"), 10_000, "G1 onay");
    const rowsA = Number(sql(`select count(*) from session_messages where session_id='${s.id}'`));
    const scripts = await page.getByTestId("chat-log").locator("script").count();
    rec({ t: "g1-go-to-tech", pendingSeen, settledHasSiz: /Siz/.test(settled.text), clear: p.evs().some((e) => e.ev === "chat" && e.clear), rowsA, scriptsInLog: scripts });
    expect(rowsA).toBe(2);
    await page.screenshot({ path: `${OUT}/img/konsol-go-istemci-sohbet-1280.png` });

    // Eski DC `chat` (≤ 0.20 biçimi) konsoldan ctl kanalına: Go göstermemeli, kanal/oturum sürmeli
    const revBefore = p.lastChat()?.rev;
    const dcInfo = await page.evaluate(() => {
      const ctl = ((window as any).__dcs as RTCDataChannel[]).filter((d) => d.label === "ctl").at(-1);
      if (!ctl || ctl.readyState !== "open") return { sent: false, state: ctl?.readyState ?? "yok" };
      ctl.send(JSON.stringify({ t: "chat", id: "01JDCCHAT0000000000000000A", text: "DC-SIZINTI eski kanal", ts: Date.now() }));
      return { sent: true, state: ctl.readyState };
    });
    await page.waitForTimeout(3000);
    const ctlAfter = await page.evaluate(() => ((window as any).__dcs as RTCDataChannel[]).filter((d) => d.label === "ctl").at(-1)?.readyState ?? "yok");
    const leaked = p.evs().some((e) => String(e.text ?? "").includes("DC-SIZINTI"));
    const consoleLeak = (await page.getByTestId("chat-log").innerText()).includes("DC-SIZINTI");
    rec({ t: "g1-dc-chat", ...dcInfo, revBefore, revAfter: p.lastChat()?.rev, leaked, consoleLeak, ctlAfter, status: await page.getByTestId("console-status").textContent() });
    expect(leaked).toBe(false);

    // Yeniden bağlanma: Go soketi düşer; kopukken teknisyen K2 yazar, müşteri G2 yazar (bekler) → dönüşte history + yeniden gönderim
    const dropAt = Date.now() - 50;
    p.send("drop");
    const off = await p.wait((e) => e.ev === "chat" && e.enabled === false && Date.parse(e.ts) >= dropAt, 15_000, "drop sonrası pasif");
    await page.waitForTimeout(1500);
    await page.getByTestId("chat-input").fill("K2 kopukken teknisyen");
    await page.keyboard.press("Enter");
    p.send("send G2 kopukken müşteri");
    await page.waitForTimeout(1500);
    const g2Local = p.lastChat();
    p.send("up");
    await p.wait((e) => e.ev === "dial" && e.reconnect === true && Date.parse(e.ts) >= dropAt, 30_000, "yeniden dial");
    // Kopukken giriş pasif: "send" yok sayılır (arayüzde kutu pasif). Dönüşte chat.history ile K2 gelir.
    const back = await p.wait(
      (e) => e.ev === "chat" && e.enabled === true && String(e.text).includes("K2 kopukken teknisyen") && Date.parse(e.ts) >= dropAt,
      30_000,
      "history K2",
    );
    const g2Ignored = !String(back.text).includes("G2 kopukken");
    p.send("send G2 kopukken müşteri");
    await expect(page.getByTestId("chat-msg").last()).toHaveText("G2 kopukken müşteri", { timeout: 15_000 });
    const rowsB = Number(sql(`select count(*) from session_messages where session_id='${s.id}'`));
    const dupG1 = occurrences(back.text, "G1 istemciden");
    const dupK1 = occurrences(back.text, "K1 konsoldan");
    const final = await p.wait((e) => e.ev === "chat" && String(e.text).includes("G2 kopukken") && !String(e.text).includes("gönderiliyor"), 10_000, "G2 onay");
    const dupK2 = occurrences(final.text, "K2 kopukken");
    const goG2 = occurrences(final.text, "G2 kopukken");
    const consoleG2 = (await page.getByTestId("chat-msg").allTextContents()).filter((x) => x === "G2 kopukken müşteri").length;
    rec({
      t: "g1-reconnect",
      offStatus: off.status,
      g2Ignored,
      g2WhileOffline: g2Local ? { enabled: g2Local.enabled, pending: String(g2Local.text).includes("G2"), status: g2Local.status, restore: g2Local.restore } : null,
      rowsB,
      dupG1,
      dupK1,
      dupK2,
      goG2,
      consoleG2,
      wsDials: p.evs().filter((e) => e.ev === "proxy-ws").length,
    });
    expect(rowsB).toBe(4);
    expect(dupG1).toBe(1);
    expect(consoleG2).toBe(1);
    await page.screenshot({ path: `${OUT}/img/konsol-go-istemci-yeniden-baglanma-1280.png` });

    // Müşteri bitirir
    p.send("end");
    const outc = await p.wait((e) => e.ev === "outcome", 20_000, "outcome");
    const summary = sql(`select new_value from audit_logs where action='session.chat_summary' and entity_id='${s.id}' limit 1`);
    rec({ t: "g1-end", title: outc.title, failed: outc.failed, summary });
  } finally {
    p.proc.kill();
  }
});

test("G2 AC-292 sunucu chatRetentionDays vermezse istemci katılmaz (join 0)", async () => {
  await cancelLeftovers(tech);
  const s = (await api(tech, "POST", "/sessions", {})).json as { id: string; code: string };
  const p = new Probe("g2");
  p.start(s.code, "noretention");
  try {
    const outc = await p.wait((e) => e.ev === "outcome", 30_000, "outcome");
    const w = p.evs().find((e) => e.ev === "welcome");
    const st = sql(`select status from support_sessions where id='${s.id}'`);
    rec({ t: "g2-noretention", welcomeDays: w?.days, proxy: p.evs().find((e) => e.ev === "proxy-resolve"), title: outc.title, body: outc.body, joins: outc.joins, wsDials: outc.wsDials, status: st });
    expect(outc.joins).toBe(0);
    expect(outc.title).toBe("Bağlantı başlatılamadı");
  } finally {
    p.proc.kill();
    await api(tech, "POST", `/sessions/${s.id}/cancel`, {});
  }
});
