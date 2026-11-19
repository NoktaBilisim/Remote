// /metrics (Prometheus metin biçimi, AC-89). Yalnız `METRICS_TOKEN` Bearer ile; token tanımlı değilse 404.
// Caddy dışarıya kapatır (mimari-api "Operasyon"). Etiketlerde IP/oturum kimliği/kod yok (düşük kardinalite).
// prom-client yerine küçük sayaç (yalnız sayaç + gösterge gerekiyor; bağımlılık eklenmedi).
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.ts";
import { safeEqual } from "../lib/ids.ts";
import { REC_METRICS } from "../rec/types.ts";

/** P28e `rs_rec_part_bytes` kova sınırları (bayt; parça ≤ 2 MiB). */
export const REC_PART_BYTES_BUCKETS = [65_536, 262_144, 524_288, 1_048_576, 1_572_864, 2_097_152] as const;

/** P22 `rs_session_chat_store_seconds` kova sınırları (sn). */
export const SESSION_CHAT_STORE_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] as const;

type Labels = Record<string, string>;

export class Metrics {
  private readonly counters = new Map<string, Map<string, number>>();
  /** Sayı ya da etiket değeri → sayı (`""` anahtarı etiketsiz seri; P8b `rs_ws_connections{role}`). */
  private readonly gauges = new Map<string, () => number | Record<string, number>>();
  private readonly help = new Map<string, string>();
  /** Etiketsiz histogram: sınırlar, kova sayaçları (kümülatif değil), toplam, sayı. */
  private readonly histograms = new Map<string, { le: readonly number[]; counts: number[]; sum: number; count: number }>();

  histogram(name: string, help: string, le: readonly number[]): void {
    this.help.set(name, help);
    if (!this.histograms.has(name)) this.histograms.set(name, { le, counts: le.map(() => 0), sum: 0, count: 0 });
  }

  /** Kayıtsız ada gözlem sessizce yok sayılır (`inc` kalıbı). */
  observe(name: string, value: number): void {
    const h = this.histograms.get(name);
    if (!h) return;
    const i = h.le.findIndex((b) => value <= b);
    if (i >= 0) h.counts[i] = (h.counts[i] ?? 0) + 1;
    h.sum += value;
    h.count += 1;
  }

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
    for (const [name, h] of this.histograms) {
      out.push(`# HELP ${name} ${this.help.get(name) ?? ""}`, `# TYPE ${name} histogram`);
      let acc = 0;
      h.le.forEach((b, i) => {
        acc += h.counts[i] ?? 0;
        out.push(`${name}_bucket{le="${b}"} ${acc}`);
      });
      out.push(`${name}_bucket{le="+Inf"} ${h.count}`, `${name}_sum ${h.sum}`, `${name}_count ${h.count}`);
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
  m.counter("rs_bindings_issued_total", "Verilen/yenilenen bilgisayar kayıtları (P8c; renewed: true|false; P20 multi: true|false)");
  m.counter("rs_binding_invalid_total", "Geçersiz bilgisayar kaydı denemeleri (P8c; rs_request_ref_invalid_total'a da sayılır)");
  m.counter(
    "rs_binding_denied_total",
    "Verilmeyen bilgisayar kayıtları (P8c B-P8c-4; reason: stale_source|inactive|rate|no_offer|browser; P20: capacity|no_multi)",
  );
  m.counter("rs_bindings_revoked_total", "Geçersizleştirilen bilgisayar kayıtları (P8c; reason)");
  m.counter("rs_request_ref_invalid_total", "Geçersiz firma ref'i denemeleri (P8b; alarm > 100/dk)");
  m.counter("rs_request_rate_limited_total", "Talep hız/bekleyen sınırı aşımları (bucket)");
  m.counter("rs_web_requests_total", "Web talep formu gönderimleri (P19; result: created|rejected)");
  m.counter("rs_web_form_rejected_total", "Web formu bot kapısı retleri (P19 S-P19-1; reason: fast|token|honeypot|token_store_full)");
  m.counter("rs_notify_suppressed_total", "Bastırılan müşteri durum bildirimleri (P19 S-P19-12; reason: pending_duplicate)");
  // P19 J3 (§8c.3, §8c.7; J6 remote-watch sözleşmesi): outbox yalnız son durumları sayar, rate_limited hariç.
  m.counter("rs_link_send_total", "Müşteriye bağlantı gönderimleri (P19 AC-260, LG; kind, channel, result: ok|<neden>)");
  m.counter("rs_agent_download_total", "Hızlı Destek istemci indirme yönlendirmeleri (P28f §8.3; os: windows|macos)");
  m.counter("rs_unattended_download_total", "LG public servis indirme (result: ok|not_found|not_ready|rate_limited)");
  m.counter(
    "rs_sms_send_total",
    "SMS çağrıları (P19; result: ok|timeout|unreachable|unauthorized|http_error|redirect|host_not_allowed|unconfigured|invalid_phone)",
  );
  m.counter(
    "rs_notify_outbox_total",
    "Müşteri durum bildirimi son durumları (P19 AC-261; channel, result: sent|failed; rate_limited hariç)",
  );
  m.counter("rs_notify_outbox_latency_seconds_sum", "Bildirim oluşturma → son durum süresi toplamı (sn; channel)");
  m.counter("rs_notify_outbox_latency_seconds_count", "Bildirim oluşturma → son durum sayısı (channel)");
  m.counter("rs_notify_rate_limited_total", "Tavana takılan müşteri bildirimleri (P19 S-P19-12; scope, channel)");
  m.counter("rs_notify_outbox_cleaned_total", "7 gün temizliğinde silinen outbox satırları (P19)");
  m.counter("rs_sms_key_unreadable_total", "Çözülemeyen firma SMS anahtarı (P19 S-P19-T6; P18 çözme alarmından ayrı)");
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
  m.counter(
    "rs_request_messages_rejected_total",
    "Reddedilen talep mesajları (P18; reason: rate|cap|closed|unsupported|tenant_rate; P20 S-P18-K7: validation)",
  );
  m.counter("rs_request_messages_read_total", "Panelden talep mesajı okumaları (P18 S-P18-T10; PENDING okuma audit'siz)");
  m.counter("rs_crypto_decrypt_failures_total", "Alan şifresi çözülemeyen satırlar (P18 S-P18-T2; table) — alarm > 0");
  m.counter("rs_calendar_fallback_total", "Kurulamayan mesai takvimi → Europe/Istanbul + SLA yok (P18 S-P18-T12; tenant)");
  m.counter(
    "rs_retention_rows_total",
    "Saklama işinin değiştirdiği/sildiği satırlar (P13a; kind: sessions|consents|files|requests|customers|bindings|audit|auth_sessions|reset_tokens|trusted_devices)",
  );
  m.counter("rs_retention_failures_total", "Saklama işinde başarısız adımlar (P13a; firma adımı, global adım, audit yazımı)");
  m.counter("rs_sessions_ended_total", "Sinyalizasyon üzerinden biten oturumlar (reason)");
  m.counter(
    "rs_control_total",
    "Uzaktan kontrol olayları (P7, §3.3; event: {control|monitor}_request_{forwarded|forbidden|browser|no_guest|conflict|cooldown|limit|invalid_monitor|already_active|superseded}, *_request_audit_failed, granted, denied, cancelled, cancelled_by_agent, cancelled_os_permission, os_permission_ignored, cancelled_wayland_no_control, wayland_no_control_ignored, cancelled_linux_no_control, released, released_by_cancel, {release|cancel}_ignored, revoked_{ui|hotkey|system}, revoke_{permission|audit|admin|reconnect|session_ended}, reset_guest_gone, grant_audit_{error|timeout}, grant_without_cap, control_state_unexpected, monitor_{granted|denied}, monitor_denied_{unexpected|ignored}, caps_narrowed, {control_state|env_state}_ignored)",
  );
  // P28a (mimari-p28 §8.2): pano/yazdırma — içerik/kimlik etiketi yok.
  m.counter("rs_clipboard_transfer_total", "Pano aktarımları (P28a; direction: TO_CUSTOMER|TO_TECH, result)");
  m.counter("rs_print_job_total", "Uzaktan yazdırma işleri (P28a; result)");
  m.counter(
    "rs_clip_print_denied_total",
    "Pano/yazdırma kapı retleri ve yok sayılan mesajlar (P28a; kind: clip|print|consent, reason: permission|no_guest|feature|control|consent|pending|rate|cooldown|limit|reuse|unmatched_report|unmatched_cancel)",
  );
  // P27 (mimari-p27 §7.3): gözetimsiz erişim sayaçları (tenant etiketi yok). Çevrimiçi göstergesi hub ile (K3) kaydedilir.
  m.counter(
    "rs_unattended_connect_total",
    "Gözetimsiz bağlantı istekleri (mode: ask — r3 tek kip; result: ok|forbidden|not_found|step_up|local_disabled|no_contact|no_channel|unsigned|offline|outdated|busy|limit)",
  );
  m.counter("rs_unattended_device_auth_total", "Cihaz kimlik doğrulamaları (result; unauth_cap dahil)");
  m.counter("rs_unattended_register_total", "Cihaz kayıt denemeleri (result: ok|invalid_code|cap|disabled|rate)");
  m.counter("rs_unattended_sessions_ended_total", "Biten gözetimsiz oturumlar (reason)");
  // P28u (mimari-p28u §9.4; tenant etiketi yok)
  // r3: `rs_unattended_consent_total` kaldırıldı (onay diyaloğu yok). Dört göz sayacı yalnız P28e `recording_policy` e-postası için.
  m.counter("rs_unattended_silent_notify_total", "Dört göz e-postası denemeleri — P28e kayıt politikası (result: ok|fail)");
  m.counter("rs_unattended_intervene_total", "Müdahale komutları (cmd: lock|logoff, result: ok|<failReason>)");
  m.counter("rs_unattended_rejoin_total", "Oturum kapatma sonrası yeniden katılım (result: ok|<failReason>)");
  m.counter("rs_unattended_device_msg_rejected_total", "Yok sayılan cihaz mesajları — başka oda / tekrar / eşleşmeyen (t)");
  m.counter("rs_unattended_device_replaced_total", "Aynı cihazın yeniden bağlanıp eski soketi düşürmesi (4409)");
  // P28e (mimari-p28e §11.2; tenant etiketi yok). `rs_rec_active` göstergesi sinyal katmanında (`bindRec`) kaydedilir.
  m.counter(REC_METRICS.PART_TOTAL, "Kayıt parça yüklemeleri (result: ok|dup|order|quota|rate|invalid|gone|busy|stopped|nosource)");
  m.counter(REC_METRICS.STOP_TOTAL, "Duran kayıtlar (reason: revoked|quota|session_end|error|policy_off)");
  m.counter(REC_METRICS.BYTES_TOTAL, "Kabul edilen kayıt parça baytları (düz metin)");
  m.histogram(REC_METRICS.PART_BYTES, "Kabul edilen kayıt parçası boyutu (bayt)", REC_PART_BYTES_BUCKETS);
  m.counter(REC_METRICS.VIEW_THROTTLED_TOTAL, "İzleme çekiş bütçesi aşımları (429; S-P28e-3)");
  // P28c (mimari-p28c §8; tenant etiketi yok). Etiketsiz "… 0" satırı remote-watch multi-denied alarmının işaretidir.
  // `rs_multi_members` göstergesi sinyal katmanında (ws.ts) kaydedilir.
  m.counter("rs_multi_denied_total", "Rol kapısı retleri (type: teknisyen mesaj tipi)");
  m.counter("rs_multi_invites_total", "Davet sonuçları (result: sent|accepted|rejected|expired)");
  // P28d (mimari-p28d §6; tenant etiketi yok). `rs_voice_active` göstergesi sinyal katmanında (ws.ts) kaydedilir.
  m.counter("rs_voice_calls_total", "Sesli görüşme istek sonuçları (result: accepted|rejected|timeout)");
  m.counter(
    "rs_voice_denied_total",
    "Sesli görüşme kapı retleri ve düşen mesajlar (code: permission|unattended|no_guest|client_unsupported|conflict|cooldown|limit|not_talker|stale_call)",
  );
  // P22 (mimari-p22 §7.2, r2 §15.2; tenant etiketi yok, gövde yok). Alarm: `rejected{reason="internal"}` 5 dk'da > 0.
  m.counter("rs_session_chat_messages_total", "Saklanıp iletilen oturum sohbeti mesajları (sender: TECH|CUSTOMER)");
  m.counter(
    "rs_session_chat_rejected_total",
    "Reddedilen oturum sohbeti gönderimleri (reason: rate|cap|invalid|forbidden|not_active|outdated|internal)",
  );
  m.counter("rs_session_chat_legacy_sessions_total", "Eski (rs.cap.schat1 bildirmeyen) misafirli kabul edilen oturumlar");
  m.counter("rs_session_chat_reads_total", "Oturum geçmişinden sohbet okumaları (GET /sessions/:id/chat)");
  m.histogram("rs_session_chat_store_seconds", "Oturum sohbeti INSERT süresi (sn)", SESSION_CHAT_STORE_BUCKETS);
  m.counter("rs_ws_tech_outdated_total", "rs.cap.schat1 bildirmediği için 4426 ile kapatılan /ws/tech soketleri (eski konsol)");
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
