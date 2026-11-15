// Dış servise tek POST (P19 J3, mimari-e11 §8c.3; P25 webhook teslimi için genişleme noktası). Yeni bağımlılık yok
// (node:http/https). Kurallar:
//  - `guard` verilirse ad `NetGuard.resolve` ile BİR KEZ çözülür ve bağlantı `lookup` ile o IP'ye sabitlenir (SNI/Host = ad;
//    ikinci çözüm yok → DNS rebinding yok). Yasak hedef → `host_not_allowed` (istek gönderilmez).
//  - Yönlendirme izlenmez (3xx → `redirect`); yanıt gövdesi en çok 4 KB okunup atılır (asla döndürülmez/loglanmaz).
//  - Dönüş yalnız sınıflandırılmış neden; ham hata/yanıt yok. Dışa (API/audit) `timeout` → `unreachable` (`publicReason`).
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { AppError } from "./errors.ts";
import type { NetGuard } from "./netguard.ts";

export type OutboundOutcome = "ok" | "timeout" | "unreachable" | "unauthorized" | "http_error" | "redirect" | "host_not_allowed";
export type PublicOutcome = Exclude<OutboundOutcome, "timeout">;

const MAX_BODY_BYTES = 4 * 1024;

/** S-P19-T7: dış hostta kör port taraması sinyali olmasın — zaman aşımı ile bağlantı reddi dışarıda aynı. */
export const publicReason = (o: Exclude<OutboundOutcome, "ok">): Exclude<PublicOutcome, "ok"> => (o === "timeout" ? "unreachable" : o);

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  guard: NetGuard | null;
}

export async function postJson(url: string, body: unknown, o: PostJsonOptions): Promise<OutboundOutcome> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "unreachable";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "unreachable";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let pinned: string | null = null;
  if (o.guard) {
    try {
      pinned = await o.guard.resolve(host);
    } catch (err) {
      if (err instanceof AppError && err.code === "HOST_NOT_ALLOWED") return "host_not_allowed";
      return "unreachable";
    }
  }
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  const lookup: LookupFunction | undefined = pinned
    ? (_h, opts, cb) => {
        const family = isIP(pinned as string) === 6 ? 6 : 4;
        if (opts.all)
          (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned as string, family }]);
        else cb(null, pinned as string, family);
      }
    : undefined;
  const mod = u.protocol === "https:" ? https : http;
  return new Promise<OutboundOutcome>((resolve) => {
    let settled = false;
    const done = (r: OutboundOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = mod.request(
      {
        method: "POST",
        protocol: u.protocol,
        hostname: host,
        port: u.port === "" ? undefined : Number(u.port),
        path: `${u.pathname}${u.search}`,
        headers: { "Content-Type": "application/json", "Content-Length": String(payload.length), ...o.headers },
        ...(lookup ? { lookup } : {}),
        ...(u.protocol === "https:" ? { servername: isIP(host) ? undefined : host } : {}),
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let read = 0;
        res.on("data", (chunk: Buffer) => {
          read += chunk.length;
          if (read > MAX_BODY_BYTES) res.destroy();
        });
        const finish = (): void => {
          if (status >= 200 && status < 300) done("ok");
          else if (status >= 300 && status < 400) done("redirect");
          else if (status === 401 || status === 403) done("unauthorized");
          else done("http_error");
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    const timer = setTimeout(() => {
      done("timeout");
      req.destroy();
    }, o.timeoutMs);
    timer.unref();
    req.on("error", () => done("unreachable"));
    req.end(payload);
  });
}
