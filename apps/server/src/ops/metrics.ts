// /metrics (Prometheus metin biçimi, AC-89). Yalnız `METRICS_TOKEN` Bearer ile; token tanımlı değilse 404.
// Caddy dışarıya kapatır (mimari-api "Operasyon"). Etiketlerde IP/oturum kimliği/kod yok (düşük kardinalite).
// prom-client yerine küçük sayaç (yalnız sayaç + gösterge gerekiyor; bağımlılık eklenmedi).
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.ts";
import { safeEqual } from "../lib/ids.ts";

type Labels = Record<string, string>;

export class Metrics {
  private readonly counters = new Map<string, Map<string, number>>();
  /** Sayı ya da etiket değeri → sayı (`""` anahtarı etiketsiz seri; P8b `rs_ws_connections{role}`). */
  private readonly gauges = new Map<string, () => number | Record<string, number>>();
  private readonly help = new Map<string, string>();

  counter(name: string, help: string): void {
    this.help.set(name, help);
    if (!this.counters.has(name)) this.counters.set(name, new Map());
  }

  gauge(name: string, help: string, read: () => number | Record<string, number>): void {
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
    for (const [name, read] of this.gauges) {
      out.push(`# HELP ${name} ${this.help.get(name) ?? ""}`, `# TYPE ${name} gauge`);
      const v = read();
      if (typeof v === "number") out.push(`${name} ${v}`);
      else for (const [role, n] of Object.entries(v)) out.push(role === "" ? `${name} ${n}` : `${name}{role="${role}"} ${n}`);
    }
    return `${out.join("\n")}\n`;
  }
}

export function createMetrics(): Metrics {
  const m = new Metrics();
  m.counter("rs_ws_connections_total", "Kabul edilen WS bağlantıları (role)");
  m.counter("rs_ws_rejected_total", "Reddedilen WS upgrade istekleri (role, reason)");
  m.counter("rs_ws_closed_policy_total", "1008 ile kapatılan bağlantılar (reason)");
  m.counter("rs_mail_total", "Gönderilen e-postalar (P10; kind, result: ok|connect|auth|tls|rejected|not_configured)");
  m.counter("rs_admit_total", "guest.admit sonuçları (result)");
  m.counter("rs_file_meta_total", "file.meta sonuçları (result; P5)");
  m.counter("rs_file_meta_rate_limited_total", "file.meta kota aşımları (class: accepted|declined|sender; S-P5-T2-3)");
  m.counter("rs_requests_created_total", "Oluşturulan destek talepleri (P8b; P8c via: ref|binding)");
  m.counter("rs_bindings_issued_total", "Verilen/yenilenen bilgisayar kayıtları (P8c; renewed: true|false)");
  m.counter("rs_binding_invalid_total", "Geçersiz bilgisayar kaydı denemeleri (P8c; rs_request_ref_invalid_total'a da sayılır)");
  m.counter(
    "rs_binding_denied_total",
    "Verilmeyen bilgisayar kayıtları (P8c B-P8c-4; reason: stale_source|inactive|rate|no_offer|browser)",
  );
  m.counter("rs_bindings_revoked_total", "Geçersizleştirilen bilgisayar kayıtları (P8c; reason)");
  m.counter("rs_request_ref_invalid_total", "Geçersiz firma ref'i denemeleri (P8b; alarm > 100/dk)");
  m.counter("rs_request_rate_limited_total", "Talep hız/bekleyen sınırı aşımları (bucket)");
  m.counter(
    "rs_guest_code_rate_limited_total",
    "Kod/agent indirme yolunda 429 (P14a AC-208; scope: ip|prefix — alarm: 15 dk'da prefix >= 20)",
  );
  m.counter("rs_mysql_test_failed_total", "Başarısız MySQL bağlantı testleri (P14a AC-212; class: connect|auth|tls|timeout|other)");
  m.counter("rs_request_gate_rejected_total", "Talep oluşturma kapısı dolu → 503 (reason: full|timeout; S8b-5)");
  m.counter("rs_request_notify_total", "Talep bildirimleri (channel, result: ok|failed|suppressed)");
  m.counter("rs_requests_outside_hours_total", "Mesai dışı talepler (P18 AC-258; mode: ACCEPT|REJECT, legacy: true|false — S-P18-T6)");
  m.counter("rs_request_sla_breached_total", "SLA hedefi aşılarak kapanan talepler (P18 AC-257; kapanışta bir kez)");
  // P18 H3 sayaçları (kayıt H2'de; remote-watch H5 alarmları bu adlara bağlı): artıran kod H3 mesajlaşmasıdır.
  m.counter("rs_request_messages_total", "Kabul öncesi talep mesajları (P18 AC-255; sender: TECH|CUSTOMER)");
  m.counter("rs_request_messages_rejected_total", "Reddedilen talep mesajları (P18; reason: rate|cap|closed|unsupported|tenant_rate)");
  m.counter("rs_crypto_decrypt_failures_total", "Alan şifresi çözülemeyen satırlar (P18 S-P18-T2; table) — alarm > 0");
  m.counter("rs_calendar_fallback_total", "Kurulamayan mesai takvimi → Europe/Istanbul + SLA yok (P18 S-P18-T12; tenant)");
  m.counter(
    "rs_retention_rows_total",
    "Saklama işinin değiştirdiği/sildiği satırlar (P13a; kind: sessions|consents|files|requests|customers|bindings|audit|auth_sessions|reset_tokens)",
  );
  m.counter("rs_retention_failures_total", "Saklama işinde başarısız adımlar (P13a; firma adımı, global adım, audit yazımı)");
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
