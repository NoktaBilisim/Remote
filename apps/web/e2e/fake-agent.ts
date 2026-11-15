import type { Browser, Page } from "@playwright/test";

/**
 * Sahte Hızlı Destek istemcisi (yalnız e2e, P7): boş bir sayfada WS + gerçek RTCPeerConnection. Teklifi yanıtlar,
 * canvas akışını gönderir, `share.state{monitors}` bildirir, `input` kanalına gelenleri `__inputs`e, kontrol/monitör
 * isteklerini sayaçlara yazar. Kararlar (izin ver/reddet/kapat) test tarafından `agentSend` ile verilir — Go
 * istemcisinin izin diyaloğu buradaki konu değildir (o P7 agent testlerinde).
 * P7 düzeltme 1: Go `gate` taklidi — test `control.state{GRANTED}` yollayınca açılır; `VIEW`, `control.release`,
 * `control.cancel`, her `control.revoke` (reconnect/stale dahil), `caps.update` kapatır (§3.3 K1–K3).
 * `closes` gelen kapatma mesajlarını sırayla tutar (`release`, `cancel`, `revoke:<neden>`).
 * `asked`: yanıtlanmamış bir `control.request` müşteriye ulaştı (Go izin diyaloğu açık) — testler karar mesajını
 * ancak bundan sonra yollar; aksi halde GRANTED sunucuya istekten önce varıp `stale` sayılır (QA-P8b-13).
 */
export interface AgentLog {
  inputs: { t: string; [k: string]: unknown }[];
  controlRequests: number;
  monitorRequests: number[];
  revokes: string[];
  caps: string[][];
  closes: string[];
  gate: boolean;
  asked: boolean;
}

export async function startFakeAgent(browser: Browser, sessionId: string, features: string[] = []): Promise<Page> {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  // about:blank → loopback WS tarayıcıda engelleniyor; sahte sunucunun kendi kökenine (JSON ucu) gidilir
  await a.goto(`http://127.0.0.1:4217/__e2e/ws-log/${sessionId}`);
  await a.evaluate(
    async ({ url, sessionId, features }) => {
      type W = Window & { __agent: AgentLogLike & { send: (m: unknown) => void } };
      interface AgentLogLike {
        inputs: unknown[];
        controlRequests: number;
        monitorRequests: number[];
        revokes: string[];
        caps: string[][];
        closes: string[];
        gate: boolean;
        asked: boolean;
        p28: string[];
      }
      const w = window as unknown as W;
      // P28a: özellik bildirimi (`rs.cap.clip1`, `rs.cap.print1`) — Windows istemci gibi
      const ws = new WebSocket(url, ["rs.v1", `rs.e2eagent.${sessionId}`, ...features]);
      const send = (m: unknown) => {
        const x = m as { t?: string; state?: string };
        if (x.t === "control.state") {
          w.__agent.gate = x.state === "GRANTED";
          w.__agent.asked = false;
        }
        return ws.readyState === 1 && ws.send(JSON.stringify(m));
      };
      const close = (why: string) => {
        w.__agent.gate = false;
        w.__agent.asked = false;
        w.__agent.closes.push(why);
      };
      w.__agent = {
        inputs: [],
        controlRequests: 0,
        monitorRequests: [],
        revokes: [],
        caps: [],
        closes: [],
        gate: false,
        asked: false,
        p28: [],
        send,
      };
      const cv = document.createElement("canvas");
      cv.width = 1280;
      cv.height = 720;
      const g = cv.getContext("2d")!;
      let n = 0;
      const draw = () => {
        g.fillStyle = n++ % 2 ? "#2a6" : "#26a";
        g.fillRect(0, 0, 1280, 720);
      };
      draw();
      setInterval(draw, 200);
      const track = cv.captureStream(10).getVideoTracks()[0]!;
      let pc: RTCPeerConnection | null = null;
      const queue: RTCIceCandidateInit[] = [];
      ws.onmessage = async (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "sdp.offer") {
          pc?.close();
          pc = new RTCPeerConnection();
          pc.onicecandidate = (ev) =>
            ev.candidate?.candidate &&
            send({
              t: "ice",
              candidate: ev.candidate.candidate,
              sdpMid: ev.candidate.sdpMid ?? undefined,
              sdpMLineIndex: ev.candidate.sdpMLineIndex ?? undefined,
            });
          pc.ondatachannel = (ev) => {
            if (ev.channel.label === "input") ev.channel.onmessage = (x) => w.__agent.inputs.push(JSON.parse(String(x.data)));
          };
          await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
          for (const c of queue.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
          const tr = pc.getTransceivers().find((x) => x.receiver.track.kind === "video");
          if (tr) {
            tr.direction = "sendonly";
            await tr.sender.replaceTrack(track);
          }
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          send({ t: "sdp.answer", sdp: ans.sdp });
          send({
            t: "share.state",
            state: "sharing",
            monitors: [
              { id: 0, name: "Ekran 1", w: 1280, h: 720, primary: true },
              { id: 1, name: "Ekran 2", w: 1280, h: 720, primary: false },
            ],
            activeMonitor: 0,
          });
        } else if (m.t === "ice") {
          const c = { candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex };
          if (pc?.remoteDescription) await pc.addIceCandidate(c).catch(() => undefined);
          else queue.push(c);
        } else if (m.t === "control.request") {
          w.__agent.controlRequests++;
          w.__agent.asked = true;
        } else if (m.t === "monitor.request") w.__agent.monitorRequests.push(m.monitorId);
        else if (m.t === "control.revoke") {
          w.__agent.revokes.push(m.reason);
          close(`revoke:${m.reason}`);
        } else if (m.t === "control.release") close("release");
        else if (m.t === "control.cancel") close("cancel");
        else if (typeof m.t === "string" && (m.t.startsWith("clip.") || m.t.startsWith("print."))) {
          w.__agent.p28.push(m.t);
          // Go istemci gibi: iptal edilen iş `print.report{CANCELLED}` ile kapanır (§4.3 print.cancel)
          if (m.t === "print.cancel") send({ t: "print.report", pid: m.pid, decision: "NONE", result: "CANCELLED", sizeBytes: 0 });
        } else if (m.t === "caps.update") {
          w.__agent.caps.push(m.caps);
          if (!m.caps.includes("remote_control")) w.__agent.gate = false;
        }
      };
      await new Promise<void>((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = () => rej(new Error("agent ws"));
      });
    },
    { url: "ws://127.0.0.1:4217/ws/guest", sessionId, features } /* istemci gibi doğrudan sunucuya (Next yok) */,
  );
  return a;
}

export const agentSend = (a: Page, m: unknown) =>
  a.evaluate((x) => (window as unknown as { __agent: { send: (m: unknown) => void } }).__agent.send(x), m);
/** P28a: misafire ulaşan clip.* / print.* mesaj tipleri. */
export const agentP28 = (a: Page) => a.evaluate(() => (window as unknown as { __agent: { p28: string[] } }).__agent.p28);
export const agentLog = (a: Page) =>
  a.evaluate(() => {
    const { inputs, controlRequests, monitorRequests, revokes, caps, closes, gate, asked } = (window as unknown as { __agent: AgentLog })
      .__agent;
    return { inputs, controlRequests, monitorRequests, revokes, caps, closes, gate, asked } as AgentLog;
  });
