// /metrics (Prometheus metin biçimi, AC-89). Yalnız `METRICS_TOKEN` Bearer ile; token tanımlı değilse 404.
// Caddy dışarıya kapatır (mimari-api "Operasyon"). Etiketlerde IP/oturum kimliği/kod yok (düşük kardinalite).
// prom-client yerine küçük sayaç (yalnız sayaç + gösterge gerekiyor; bağımlılık eklenmedi).
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.ts";
import { safeEqual } from "../lib/ids.ts";

type Labels = Record<string, string>;

export class Metrics {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges = new Map<string, () => number>();
  private readonly help = new Map<string, string>();

  counter(name: string, help: string): void {
    this.help.set(name, help);
    if (!this.counters.has(name)) this.counters.set(name, new Map());
  }

  gauge(name: string, help: string, read: () => number): void {
    this.help.set(name, help);
    this.gauges.set(name, read);
  }

  inc(name: string, labels: Labels = {}, by = 1): void {
    const series = this.counters.get(name);
    if (!series) return;
    const key = Object.entries(labels)
      .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, "_")}"`)
      .join(",");
    series.set(key, (series.get(key) ?? 0) + by);
  }

  render(): string {
    const out: string[] = [];
    for (const [name, series] of this.counters) {
      out.push(`# HELP ${name} ${this.help.get(name) ?? ""}`, `# TYPE ${name} counter`);
      if (series.size === 0) out.push(`${name} 0`);
      for (const [key, v] of series) out.push(`${name}${key ? `{${key}}` : ""} ${v}`);
    }
    for (const [name, read] of this.gauges) out.push(`# HELP ${name} ${this.help.get(name) ?? ""}`, `# TYPE ${name} gauge`, `${name} ${read()}`);
    return `${out.join("\n")}\n`;
  }
}

export function createMetrics(): Metrics {
  const m = new Metrics();
  m.counter("rs_ws_connections_total", "Kabul edilen WS bağlantıları (role)");
  m.counter("rs_ws_rejected_total", "Reddedilen WS upgrade istekleri (role, reason)");
  m.counter("rs_ws_closed_policy_total", "1008 ile kapatılan bağlantılar (reason)");
  m.counter("rs_admit_total", "guest.admit sonuçları (result)");
  m.counter("rs_file_meta_total", "file.meta sonuçları (result; P5)");
  m.counter("rs_file_meta_rate_limited_total", "file.meta kota aşımları (class: accepted|declined|sender; S-P5-T2-3)");
  m.counter("rs_sessions_ended_total", "Sinyalizasyon üzerinden biten oturumlar (reason)");
  m.counter(
    "rs_control_total",
    "Uzaktan kontrol olayları (P7, §3.3; event: {control|monitor}_request_{forwarded|forbidden|browser|no_guest|conflict|cooldown|limit|invalid_monitor|already_active|superseded}, *_request_audit_failed, granted, denied, cancelled, cancelled_by_agent, released, released_by_cancel, {release|cancel}_ignored, revoked_{ui|hotkey|system}, revoke_{permission|audit|admin|reconnect|session_ended}, reset_guest_gone, grant_audit_{error|timeout}, grant_without_cap, control_state_unexpected, monitor_{granted|denied}, monitor_denied_{unexpected|ignored}, caps_narrowed, {control_state|env_state}_ignored)",
  );
  return m;
}

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (req, reply) => {
    const token = app.env.METRICS_TOKEN;
    if (!token) throw new AppError("NOT_FOUND");
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), token)) throw new AppError("UNAUTHENTICATED");
    void reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8").header("Cache-Control", "no-store");
    return app.metrics.render();
  });
}
