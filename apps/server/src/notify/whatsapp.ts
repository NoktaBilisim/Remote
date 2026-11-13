// WhatsApp bildirimi (P8b, mimari-e9 §6, §13.5; AC-150, AC-152; ortak standart 2.2). whatsapp-bildirim servisi:
// `POST {URL}/send-message {phoneNumber, message}` ve `POST {URL}/test-send {phoneNumber}`. Yeni bağımlılık yok (fetch).
//  - İçerik tek şablon: firma adı + talep kodu + sabit panel bağlantısı. Kişisel veri / müşteri metni YOK (r2).
//  - Fail-closed: production'da `http://` ve özel/loopback olmayan adres → kanal kapalı (gönderim ve test yapılmaz).
//  - 3 deneme (hemen, +5 sn, +20 sn), her çağrı 8 sn zaman aşımı; talebi engellemez (asenkron, süreç içi zamanlayıcı —
//    yeniden başlatmada bekleyen deneme kaybolur, panel bildirimi birincil kanal).
//  - Sınırlar (sabit saatlik pencere): tenant 30/sa (alıcı başına sayılır), alıcı 10/sa, sistem 300/sa. Aşımda mesaj
//    bastırılır; pencere sonunda bastırılan her alıcıya tek özet (özet de sınıra dahil). Bastırma audit'i pencere başına
//    tenant için 1 kez; global aşım alarm logu.
//  - Son sonuç alıcı başına audit `request.notify{channel, recipient(maske), result, attempts}`. Numara loga yazılmaz.
//  - P12b (AC-196): etkin adres çalışırken değişir (`setUrl`): açılışta ve Super Admin PUT/DELETE sonrası panel kaydı
//    (`system_settings.whatsapp`) > env. configured/insecure/usable her zaman etkin adresten; güvensiz adrese geçişte alarm.
import { WA_TEST_MESSAGES, type WhatsappTestReason } from "@remote/contracts/api/system-settings";
import { BlockList, isIP } from "node:net";
import { maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { Clock } from "../signaling/types.ts";

export const WA_TIMEOUT_MS = 8_000;
export const WA_RETRY_DELAYS_MS = [0, 5_000, 20_000] as const;
export const WA_LIMITS = { tenantPerHour: 30, recipientPerHour: 10, globalPerHour: 300 } as const;
const HOUR_MS = 3_600_000;
const FIRM_MAX = 60;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "manual" }) => Promise<{ ok: boolean; status: number; body?: { cancel(): Promise<void> } | null }>;

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface WhatsappDeps {
  /** Başlangıç adresi (env `WHATSAPP_SERVICE_URL`); panel kaydı `setUrl` ile uygulanır. */
  url: string;
  production: boolean;
  publicBaseUrl: string;
  db: Db;
  log: Log;
  metrics: Metrics;
  clock: Clock;
  fetch?: FetchLike;
}

const PRIVATE = new BlockList();
for (const [net, bits] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["169.254.0.0", 16], ["100.64.0.0", 10]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** Host özel ağ/loopback mu (yalnız IP sabitleri ve `localhost`; DNS çözülmez — ad her zaman "genel" sayılır). */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost") return true;
  const family = isIP(h);
  if (family === 4) return PRIVATE.check(h, "ipv4");
  if (family === 6) return PRIVATE.check(h, "ipv6");
  return false;
}

/** §13.5 fail-closed: production + `http://` + özel olmayan host → güvensiz. */
export function isInsecureServiceUrl(url: string, production: boolean): boolean {
  if (!isParsableServiceUrl(url)) return true; // B-P12b-1: ayrıştırılamayan adres her ortamda fail-closed
  if (!production) return false;
  const u = new URL(url);
  return u.protocol === "http:" && !isPrivateHost(u.hostname);
}

/** WHATWG ile ayrıştırılabilir http(s) adresi mi (DB CHECK yalnız regex; `http://a:99999` CHECK'ten geçer). */
export function isParsableServiceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "";
  } catch {
    return false;
  }
}

/** Firma adı: tek satır, WhatsApp biçim karakterleri (`* _ ~ \``) yok, ≤ 60 karakter. */
export function firmLabel(name: string): string {
  return [...name.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim()].slice(0, FIRM_MAX).join("");
}

/** Kişisel verisiz şablon (§13.5): satır 1 firma + talep kodu, satır 2 sabit panel bağlantısı. */
export function newRequestMessage(firm: string, requestCode: string, publicBaseUrl: string): string {
  return `Yeni destek talebi – ${firmLabel(firm)} – panelde görüntüleyin. Talep kodu: ${requestCode}\n${panelLink(publicBaseUrl)}`;
}

export function summaryMessage(firm: string, count: number, publicBaseUrl: string): string {
  return `Son 1 saatte ${count} yeni destek talebi daha – ${firmLabel(firm)} – panelde görüntüleyin.\n${panelLink(publicBaseUrl)}`;
}

const panelLink = (base: string): string => `${base.replace(/\/+$/, "")}/requests`;

/** Servis `phoneNumber` biçimi `+` olmadan (`905…`). */
const servicePhone = (e164: string): string => e164.replace(/^\+/, "");

interface Window {
  start: number;
  tenant: Map<string, number>;
  recipient: Map<string, number>;
  global: number;
  /** `${tenantId}|${phone}` → bastırılan sayı + firma adı. */
  suppressed: Map<string, { tenantId: string; phone: string; firm: string; count: number }>;
  suppressedAudited: Set<string>;
  globalAlarmed: boolean;
}

export type SendResult = "success" | "fail";
/** Tek çağrı sonucu: başarı ya da sınıflandırılmış neden (ayrıntı yalnız log). */
export type PostOutcome = "ok" | Exclude<WhatsappTestReason, "unconfigured" | "insecure">;
export interface WhatsappTestOutcome {
  ok: boolean;
  message: string;
  reason: WhatsappTestReason | null;
}

/** Servis yolu: `{url}/send-message` (adres yolu korunur; sondaki `/` kırpılır). */
const endpoint = (base: string, path: string): string => `${base.replace(/\/+$/, "")}${path}`;

export class WhatsappNotifier {
  private url: string;
  private insecureNow: boolean;
  private readonly d: WhatsappDeps;
  private readonly fetchFn: FetchLike;
  private win: Window;
  private flushTimer: unknown;
  private readonly pending = new Set<unknown>();
  private closed = false;

  constructor(d: WhatsappDeps) {
    this.d = d;
    this.fetchFn = d.fetch ?? ((url, init) => fetch(url, init));
    this.url = "";
    this.insecureNow = false;
    this.setUrl(d.url);
    this.win = this.newWindow(this.windowStart(d.clock.now()));
  }

  /** Etkin adres (yalnız Super Admin görünümü ve testler; tenant yanıtlarına girmez). */
  get effectiveUrl(): string {
    return this.url;
  }

  get configured(): boolean {
    return this.url !== "";
  }

  get insecure(): boolean {
    return this.insecureNow;
  }

  /**
   * Etkin adresi değiştirir (AC-196: yeniden başlatma yok; sonraki gönderim/test yeni adrese). Boş → yapılandırılmamış.
   * Güvensiz adrese geçişte alarm logu (adres loga yazılmaz). Sürmekte olan denemeler sonraki çağrıda yeni adresi kullanır.
   */
  setUrl(url: string): void {
    if (url === this.url && url !== "") return;
    // B-P12b-1: önce sınıflandır (fırlatmaz), sonra ata — yarım güncelleme yok; ayrıştırılamayan adres → kanal kapalı.
    const invalid = url !== "" && !isParsableServiceUrl(url);
    const insecure = url !== "" && (invalid || isInsecureServiceUrl(url, this.d.production));
    this.url = url;
    this.insecureNow = insecure;
    if (invalid) this.d.log.error({ alarm: "whatsapp_invalid_url" }, "WhatsApp servis adresi ayrıştırılamıyor: kanal kapalı");
    else if (insecure) this.d.log.warn({ alarm: "whatsapp_insecure" }, "WhatsApp servisi güvenli yapılandırılmamış (production + http + genel adres): kanal kapalı");
  }

  /** Kanal kullanılabilir mi (ayar ekranı ve gönderim kapısı). */
  get usable(): boolean {
    return this.configured && !this.insecure && !this.closed;
  }

  private windowStart(t: number): number {
    return Math.floor(t / HOUR_MS) * HOUR_MS;
  }

  private newWindow(start: number): Window {
    return { start, tenant: new Map(), recipient: new Map(), global: 0, suppressed: new Map(), suppressedAudited: new Set(), globalAlarmed: false };
  }

  /** Pencere döndüyse bastırılanların özetini gönderir (yeni pencerenin sınırına dahil). */
  private rotate(): void {
    const start = this.windowStart(this.d.clock.now());
    if (start === this.win.start) return;
    const old = this.win;
    this.win = this.newWindow(start);
    for (const s of old.suppressed.values()) this.enqueue(s.tenantId, s.phone, summaryMessage(s.firm, s.count, this.d.publicBaseUrl), "summary");
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.closed) return;
    const at = this.win.start + HOUR_MS;
    this.flushTimer = this.d.clock.setTimeout(() => {
      this.flushTimer = undefined;
      this.rotate();
    }, Math.max(0, at - this.d.clock.now()));
  }

  /** Sınır kontrolü + sayım; izin yoksa false (bastırıldı). */
  private allow(tenantId: string, phone: string): boolean {
    const w = this.win;
    const t = w.tenant.get(tenantId) ?? 0;
    const r = w.recipient.get(phone) ?? 0;
    if (w.global >= WA_LIMITS.globalPerHour) {
      if (!w.globalAlarmed) {
        w.globalAlarmed = true;
        this.d.log.warn({ alarm: "whatsapp_global_cap" }, "WhatsApp sistem geneli saatlik sınırı aşıldı");
      }
      return false;
    }
    if (t >= WA_LIMITS.tenantPerHour || r >= WA_LIMITS.recipientPerHour) return false;
    w.tenant.set(tenantId, t + 1);
    w.recipient.set(phone, r + 1);
    w.global += 1;
    return true;
  }

  /**
   * Yeni talep bildirimi (AC-150). Talep commit'inden sonra çağrılır; beklenmez. `firm` = tenants.name.
   */
  notifyNewRequest(tenantId: string, firm: string, recipients: readonly string[], requestCode: string): void {
    if (!this.usable || recipients.length === 0) return;
    this.rotate();
    const message = newRequestMessage(firm, requestCode, this.d.publicBaseUrl);
    let suppressed = false;
    for (const phone of recipients) {
      if (this.allow(tenantId, phone)) {
        this.enqueue(tenantId, phone, message, "new");
        continue;
      }
      suppressed = true;
      const key = `${tenantId}|${phone}`;
      const s = this.win.suppressed.get(key) ?? { tenantId, phone, firm, count: 0 };
      s.count += 1;
      this.win.suppressed.set(key, s);
    }
    if (suppressed) {
      this.scheduleFlush();
      this.d.metrics.inc("rs_request_notify_total", { channel: "whatsapp", result: "suppressed" });
      if (!this.win.suppressedAudited.has(tenantId)) {
        this.win.suppressedAudited.add(tenantId);
        void this.audit(tenantId, null, "suppressed", 0);
      }
    }
  }

  private enqueue(tenantId: string, phone: string, message: string, kind: "new" | "summary"): void {
    if (kind === "summary" && !this.allow(tenantId, phone)) return; // özet de sınıra dahil
    this.attempt(tenantId, phone, message, 1);
  }

  private attempt(tenantId: string, phone: string, message: string, n: number): void {
    const delay = WA_RETRY_DELAYS_MS[n - 1] ?? 0;
    const run = (): void => {
      void this.post("/send-message", { phoneNumber: servicePhone(phone), message }).then(async (outcome) => {
        if (this.closed) return;
        const ok = outcome === "ok";
        if (ok || n >= WA_RETRY_DELAYS_MS.length) {
          this.d.metrics.inc("rs_request_notify_total", { channel: "whatsapp", result: ok ? "ok" : "failed" });
          await this.audit(tenantId, phone, ok ? "success" : "fail", n);
          return;
        }
        this.attempt(tenantId, phone, message, n + 1);
      });
    };
    if (delay === 0) return run();
    const h = this.d.clock.setTimeout(() => {
      this.pending.delete(h);
      if (!this.closed) run();
    }, delay);
    this.pending.add(h);
  }

  private async audit(tenantId: string, phone: string | null, result: "success" | "fail" | "suppressed", attempts: number): Promise<void> {
    const ctx: AuditContext = { ip: "", userAgent: "notify", requestId: "" };
    try {
      await writeAudit(this.d.db, ctx, {
        tenantId,
        username: "system",
        action: "request.notify",
        entity: "support_requests",
        result: result === "fail" ? "fail" : "success",
        newValue: { channel: "whatsapp", recipient: phone ? maskPhone(phone) : null, result, attempts },
      });
    } catch (err) {
      this.d.log.error({ err, event: "notify_audit_failed" }, "bildirim audit'i yazılamadı");
    }
  }

  /**
   * Tek çağrı, 8 sn zaman aşımı; 2xx → ok. 3xx → `redirect` (izlenmez, S8b-1: `redirect: "manual"`), diğer → `http_error`,
   * zaman aşımı → `timeout`, ağ → `unreachable`. Ayrıntı log (durum kodu/hata adı; numara, adres, yanıt gövdesi yok).
   */
  private async post(path: string, body: { phoneNumber: string; message?: string }): Promise<PostOutcome> {
    if (!this.usable) return "unreachable";
    const ctrl = new AbortController();
    // Zaman aşımı enjekte saatten (realClock unref'li); denemeler arası beklemelerle aynı saat → test edilebilir.
    const timer = this.d.clock.setTimeout(() => ctrl.abort(), WA_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(endpoint(this.url, path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal, redirect: "manual" }); // S8b-1: 3xx izlenmez (SSRF)
      void res.body?.cancel().catch(() => undefined); // B-P12b-6: gövde okunmaz/yansıtılmaz; soket ve tampon bırakılır
      if (res.ok) return "ok";
      this.d.log.warn({ event: "whatsapp_http_error", status: res.status, path }, "WhatsApp servisi hata döndürdü");
      return res.status >= 300 && res.status < 400 ? "redirect" : "http_error";
    } catch (err) {
      const timedOut = ctrl.signal.aborted;
      this.d.log.warn({ event: timedOut ? "whatsapp_timeout" : "whatsapp_unreachable", path, err: err instanceof Error ? err.name : "unknown" }, "WhatsApp servisine ulaşılamadı");
      return timedOut ? "timeout" : "unreachable";
    } finally {
      this.d.clock.clearTimeout(timer);
    }
  }

  /**
   * "Test mesajı gönder" (AC-152, AC-196): etkin adrese tek deneme, 8 sn. Yapılandırılmamış/güvensiz → istek GÖNDERİLMEZ
   * (`reason` unconfigured/insecure). Mesajlar sabit (`WA_TEST_MESSAGES`); servis yanıtı yansıtılmaz.
   */
  async test(phone: string): Promise<WhatsappTestOutcome> {
    const pre: WhatsappTestReason | null = !this.configured ? "unconfigured" : this.insecure ? "insecure" : null;
    const outcome: PostOutcome | WhatsappTestReason = pre ?? (await this.post("/test-send", { phoneNumber: servicePhone(phone) }));
    if (outcome === "ok") return { ok: true, message: WA_TEST_MESSAGES.ok, reason: null };
    return { ok: false, message: WA_TEST_MESSAGES[outcome], reason: outcome };
  }

  close(): void {
    this.closed = true;
    this.d.clock.clearTimeout(this.flushTimer);
    for (const h of this.pending) this.d.clock.clearTimeout(h);
    this.pending.clear();
  }
}
