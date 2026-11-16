// P28b clamd TCP istemcisi (mimari-p28b §7.2, K-P28b-8, K-P28b-16, K-P28b-23; AC-353, 359). Bağımlılık yok: `zPING`,
// `zVERSION`, `zINSTREAM` (uint32 BE uzunluk | veri … | 0). Hedef: host her bağlantıda çözülür, TÜM adresler
// `CLAMAV_ALLOWED_CIDR` içinde olmalı (ağ, yayın ve ağ geçidi = ilk adres hariç); bağlantı çözülen IP'ye. Bağlantı aşaması
// (PING + INSTREAM soketinin kurulması, ilk veri baytından önce) ≤ 15 sn yeniden denenir; veri yazıldıktan sonra yeniden
// deneme YOK (fail-closed). Akış sınırında clamd yanıtı yazıp kapatır: yanıt `data` ile biriktirilir, kapanışta sınıflanır.
import { lookup } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { AV_EICAR_SIGNATURE, AV_ENCRYPTED_PREFIX, AV_LIMITS_PREFIX, AV_MAX_SCAN_TIME_SIGNATURE } from "@remote/contracts/api/clamav";
import {
  AV_CONNECT_RETRY_INTERVAL_MS,
  AV_CONNECT_RETRY_MS,
  AV_CONNECT_TIMEOUT_MS,
  AV_SIGNATURE_PATTERN,
  type AvScanReason,
} from "@remote/contracts/ws-fsrv";
import { canonicalIp } from "../lib/netguard.ts";

const STREAM_PIECE = 65_536;
const MAX_REPLY = 4096;

export type ScanVerdict =
  { state: "CLEAN" } | { state: "INFECTED"; signature: string | null } | { state: "SCAN_FAILED"; reason: AvScanReason };

/** §7.2 tablo (sıra: MaxScanTime genel Limits'ten önce). İmza biçim dışıysa null ("bilinmeyen imza"). */
export function classifyReply(raw: string): ScanVerdict {
  const r = raw.replace(/\0+$/, "").trim();
  if (r === "stream: OK") return { state: "CLEAN" };
  const m = /^stream: (.+) FOUND$/.exec(r);
  if (m?.[1]) {
    const sig = m[1];
    if (sig.startsWith(AV_ENCRYPTED_PREFIX)) return { state: "SCAN_FAILED", reason: "ENCRYPTED" };
    if (sig === AV_MAX_SCAN_TIME_SIGNATURE) return { state: "SCAN_FAILED", reason: "TIMEOUT" };
    if (sig.startsWith(AV_LIMITS_PREFIX)) return { state: "SCAN_FAILED", reason: "LIMIT" };
    return { state: "INFECTED", signature: AV_SIGNATURE_PATTERN.test(sig) ? sig : null };
  }
  if (/^INSTREAM size limit exceeded\. ERROR$/.test(r)) return { state: "SCAN_FAILED", reason: "LIMIT" };
  return { state: "SCAN_FAILED", reason: "ERROR" };
}

/** `ClamAV 1.5.4/28177/Sun Nov  8 06:23:52 2026` → sürüm metni ve imza tarihi (C ctime, UTC). */
export function parseVersion(raw: string): { version: string; dbDate: Date | null } | null {
  const r = raw.replace(/\0+$/, "").trim();
  if (!/^ClamAV \S+/.test(r) || r.length > 200) return null;
  const parts = r.split("/");
  const date = parts.length >= 3 ? parseCtime(parts.slice(2).join("/")) : null;
  return { version: r, dbDate: date };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseCtime(s: string): Date | null {
  const m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1] ?? "");
  if (mon < 0) return null;
  const d = new Date(Date.UTC(Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- hedef (K-P28b-16) ----

function v4(addr: string): number | null {
  if (isIP(addr) !== 4) return null;
  return addr.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

/** Adres izinli alt ağın içinde mi (ağ adresi, yayın ve ağ geçidi = ilk kullanılabilir adres hariç). IPv4-mapped normalleşir. */
export function inAllowedCidr(ip: string, cidr: string | undefined): boolean {
  if (!cidr || ip.includes("%")) return false;
  const [net, bits] = cidr.split("/");
  const base = net ? v4(net) : null;
  const a = v4(canonicalIp(ip));
  if (base === null || a === null || bits === undefined) return false;
  const size = 2 ** (32 - Number(bits));
  const first = base - (base % size);
  return a > first + 1 && a < first + size - 1;
}

/** D-r2-1: kaynak adres alt ağın HERHANGİ bir adresi mi (ağ geçidi dahil; `av` ağından gelen istek reddi). */
export function inCidrRange(ip: string | undefined, cidr: string | undefined): boolean {
  if (!cidr || !ip) return false;
  const [net, bits] = cidr.split("/");
  const base = net ? v4(net) : null;
  const a = v4(canonicalIp(ip));
  if (base === null || a === null || bits === undefined) return false;
  const size = 2 ** (32 - Number(bits));
  return a - (a % size) === base - (base % size);
}

export type LookupAll = (host: string) => Promise<string[]>;
const defaultLookup: LookupAll = async (h) => (await lookup(h, { all: true, verbatim: true })).map((a) => a.address);

/** Çözülen tüm adresler izinliyse ilk adres; değilse / çözülemezse null. */
export async function resolveAllowed(host: string, cidr: string | undefined, lookupAll: LookupAll = defaultLookup): Promise<string | null> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  let ips: string[];
  try {
    ips = isIP(h) ? [h] : await lookupAll(h);
  } catch {
    return null;
  }
  if (ips.length === 0 || !ips.every((ip) => inAllowedCidr(ip, cidr))) return null;
  return canonicalIp(ips[0] ?? "");
}

// ---- bağlantı ----

export interface ClamdTarget {
  host: string;
  port: number;
}

export interface ClamdOptions {
  cidr: string | undefined;
  lookupAll?: LookupAll;
  /** Yalnız testler: sahte clamd'ye bağlanmak için (CIDR denetimi yine çalışır; dönen IP yerine bu adres kullanılır). */
  dialHost?: (resolvedIp: string) => string;
  connectTimeoutMs?: number;
  retryIntervalMs?: number;
  retryTotalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ClamdUnavailable extends Error {
  readonly why: "not_allowed" | "unreachable";
  constructor(why: "not_allowed" | "unreachable") {
    super(why);
    this.why = why;
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function dial(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolveP, reject) => {
    const s = new Socket();
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error("connect_timeout"));
    }, timeoutMs);
    s.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    s.connect(port, host, () => {
      clearTimeout(t);
      s.removeAllListeners("error");
      resolveP(s);
    });
  });
}

/** Tek komut gönderip `\0`'a ya da kapanışa kadar yanıt toplar. */
function command(sock: Socket, cmd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolveP, reject) => {
    let acc = "";
    const done = (err: Error | null): void => {
      clearTimeout(t);
      sock.destroy();
      if (err) reject(err);
      else resolveP(acc);
    };
    const t = setTimeout(() => done(new Error("reply_timeout")), timeoutMs);
    sock.on("data", (d: Buffer) => {
      acc += d.toString("utf8");
      if (acc.includes("\0") || acc.length > MAX_REPLY) done(null);
    });
    sock.once("error", (e) => done(acc ? null : e));
    sock.once("close", () => done(acc ? null : new Error("closed")));
    sock.write(`z${cmd}\0`);
  });
}

export class ClamdClient {
  private readonly o: Required<Omit<ClamdOptions, "dialHost" | "cidr">> & Pick<ClamdOptions, "dialHost" | "cidr">;

  constructor(o: ClamdOptions) {
    this.o = {
      cidr: o.cidr,
      lookupAll: o.lookupAll ?? defaultLookup,
      connectTimeoutMs: o.connectTimeoutMs ?? AV_CONNECT_TIMEOUT_MS,
      retryIntervalMs: o.retryIntervalMs ?? AV_CONNECT_RETRY_INTERVAL_MS,
      retryTotalMs: o.retryTotalMs ?? AV_CONNECT_RETRY_MS,
      now: o.now ?? Date.now,
      sleep: o.sleep ?? realSleep,
      ...(o.dialHost ? { dialHost: o.dialHost } : {}),
    };
  }

  /** Hedef izinli mi (PUT/test ucu, `HOST_NOT_ALLOWED`). */
  async allowed(host: string): Promise<boolean> {
    return (await resolveAllowed(host, this.o.cidr, this.o.lookupAll)) !== null;
  }

  private async connect(t: ClamdTarget): Promise<Socket> {
    const ip = await resolveAllowed(t.host, this.o.cidr, this.o.lookupAll);
    if (ip === null) throw new ClamdUnavailable("not_allowed");
    return dial(this.o.dialHost ? this.o.dialHost(ip) : ip, t.port, this.o.connectTimeoutMs);
  }

  /** Tek deneme (test ucu / yoklama): yanıt metni; bağlanamazsa hata. */
  async once(t: ClamdTarget, cmd: "PING" | "VERSION", timeoutMs = 5_000): Promise<string> {
    return command(await this.connect(t), cmd, timeoutMs);
  }

  /** Bağlantı aşaması: PING `PONG` + INSTREAM soketi; ≤ retryTotalMs (yalnız ilk veri baytından önce). */
  async openStream(t: ClamdTarget, deadline: number): Promise<Socket> {
    const until = Math.min(this.o.now() + this.o.retryTotalMs, deadline);
    for (;;) {
      try {
        const pong = await this.once(t, "PING", this.o.connectTimeoutMs);
        if (pong.replace(/\0+$/, "").trim() === "PONG") return await this.connect(t);
      } catch (err) {
        if (err instanceof ClamdUnavailable) throw err;
      }
      if (this.o.now() + this.o.retryIntervalMs >= until) throw new ClamdUnavailable("unreachable");
      await this.o.sleep(this.o.retryIntervalMs);
    }
  }

  /**
   * INSTREAM: veri akışı + sıfır uzunluk; yanıt biriktirilip sınıflanır. `deadline` (60 sn bütçe) aşılırsa TIMEOUT.
   * Veri yazılırken kopma (yanıt boş) → ERROR; clamd sınır yanıtı yazıp kapatırsa (EPIPE) biriken yanıt sınıflanır.
   */
  async instream(t: ClamdTarget, source: AsyncIterable<Buffer>, deadline: number): Promise<ScanVerdict> {
    let sock: Socket;
    try {
      sock = await this.openStream(t, deadline);
    } catch {
      return { state: "SCAN_FAILED", reason: "UNAVAILABLE" };
    }
    return streamTo(sock, source, Math.max(0, deadline - this.o.now()));
  }
}

async function streamTo(sock: Socket, source: AsyncIterable<Buffer>, budgetMs: number): Promise<ScanVerdict> {
  let reply = "";
  let closed = false;
  let timedOut = false;
  const finished = new Promise<void>((r) => {
    sock.on("data", (d: Buffer) => {
      if (reply.length < MAX_REPLY) reply += d.toString("utf8");
      if (reply.includes("\0")) r();
    });
    sock.on("error", () => r());
    sock.on("close", () => {
      closed = true;
      r();
    });
  });
  const timer = setTimeout(() => {
    timedOut = true;
    sock.destroy();
  }, budgetMs);
  const write = (b: Buffer): Promise<boolean> =>
    new Promise((r) => {
      if (closed || sock.destroyed) return r(false);
      sock.write(b, (err) => r(!err));
    });
  try {
    if (!(await write(Buffer.from("zINSTREAM\0")))) return finish();
    outer: for await (const data of source) {
      for (let off = 0; off < data.length; off += STREAM_PIECE) {
        const piece = data.subarray(off, off + STREAM_PIECE);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(piece.length);
        if (!(await write(Buffer.concat([len, piece])))) break outer;
      }
    }
    await write(Buffer.alloc(4));
    await finished;
  } catch {
    // kaynak okunamadı / soket hatası — biriken yanıt varsa sınıflanır, yoksa ERROR
  }
  return finish();

  function finish(): ScanVerdict {
    clearTimeout(timer);
    sock.destroy();
    if (timedOut) return { state: "SCAN_FAILED", reason: "TIMEOUT" };
    if (!reply) return { state: "SCAN_FAILED", reason: "ERROR" };
    return classifyReply(reply);
  }
}

/** EICAR (D-P28b-1) ve şifreli zip öz-sınama yanıtlarının "kesin yanlış" sınıfı (§7.3). */
export function selfTestJudgement(eicar: ScanVerdict, encrypted: ScanVerdict): "ok" | "misconfigured" | "unreachable" {
  const eOk = eicar.state === "INFECTED" && eicar.signature === AV_EICAR_SIGNATURE;
  const zOk = encrypted.state === "SCAN_FAILED" && encrypted.reason === "ENCRYPTED";
  if (eOk && zOk) return "ok";
  const definite = (v: ScanVerdict): boolean => v.state === "CLEAN" || v.state === "INFECTED";
  const eWrong = !eOk && definite(eicar);
  const zWrong = !zOk && (definite(encrypted) || (encrypted.state === "SCAN_FAILED" && encrypted.reason === "LIMIT"));
  return eWrong || zWrong ? "misconfigured" : "unreachable";
}
