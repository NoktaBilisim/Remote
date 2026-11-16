// P27 firma içi güvenlik e-postaları (mimari-p27 §7.1 r2, K-P27-20; O-P27-5, D-P27-4, O-P27-r2-1; AC-337, 339): outbox'a
// girmez; commit sonrası (SMTP bildiriminde kayıttan ÖNCE) en iyi çaba `mail.sendForTenant` — her gönderim `mail.sent` audit'i
// MailService'te. Alıcı: firmadaki etkin (ACTIVE, ADMIN|USER) ve verilen yetkilerden birine sahip kullanıcılar, çağıran hariç.
// Şablonlar burada (mail/templates.ts paralel P27a işinde; K4 isterse oraya taşır — implementation.md P27-K2).
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { effectivePermissions, type PermissionKey, type Role } from "@remote/contracts/permissions";
import { maskEmail } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import type { MailService, SmtpConfig } from "../mail/service.ts";
import type { MailContent } from "../mail/templates.ts";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const istanbul = (d: Date): string =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

function content(subject: string, lines: string[]): MailContent {
  return { subject, text: lines.join("\n\n"), bodyHtml: lines.map((l) => `<p>${esc(l)}</p>`).join("") };
}

/** O-P27-5: yeni gözetimsiz cihaz kaydı (cihaz adı, müşteri, kayıt IP'si, saat). */
export function deviceRegisteredMail(o: { device: string; customer: string; ip: string; at: Date }): MailContent {
  return content("Yeni gözetimsiz cihaz kaydedildi", [
    `"${o.device}" adlı cihaz ${o.customer} müşterisi için gözetimsiz erişime kaydedildi (${istanbul(o.at)}, IP ${o.ip}).`,
    'Cihaz, bir teknisyene yetki verilene kadar panelde "Yeni — doğrulanmadı" olarak görünür. Bu kaydı müşteriyle doğrulayın; tanımıyorsanız cihazı iptal edin.',
  ]);
}

/** D-P27-4: bir kullanıcı kendine cihaz yetkisi verdi. */
export function selfGrantMail(o: { user: string; device: string; at: Date }): MailContent {
  return content("Gözetimsiz cihaz yetkisi: kendine yetki verildi", [
    `${o.user}, "${o.device}" cihazına bağlanma yetkisini kendine verdi (${istanbul(o.at)}).`,
    "Bu işlem beklenmiyorsa cihazın teknisyen yetkilerini kontrol edin.",
  ]);
}

/** O-P27-r2-1: etkin cihaz varken SMTP ayarı değişiyor (ESKİ yapılandırmayla gönderilir). */
export function smtpChangeNoticeMail(o: { user: string; devices: number; at: Date }): MailContent {
  return content("Bildirim e-postası (SMTP) ayarı değiştiriliyor", [
    `${o.user}, firmanın SMTP ayarını değiştiriyor (${istanbul(o.at)}). Firmada ${o.devices} etkin gözetimsiz cihaz var; müşterilere giden bağlantı bildirimleri bu ayarla gönderilir.`,
    "Bu değişiklik beklenmiyorsa ayarı ve gözetimsiz cihazları hemen kontrol edin.",
  ]);
}

/** Firmadaki etkin yetki sahiplerinin e-postaları (çağıran hariç). */
export async function holdersOf(db: Db, tenantId: string, perms: readonly PermissionKey[], exceptUserId: string | null): Promise<string[]> {
  const users = await db.user.findMany({
    where: { tenantId, status: "ACTIVE", role: { in: ["ADMIN", "USER"] }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { email: true, role: true, permissions: { select: { permKey: true, granted: true } } },
  });
  return users.filter((u) => effectivePermissions(u.role as Role, u.permissions).some((k) => perms.includes(k))).map((u) => u.email);
}

export interface InternalNotice {
  db: Db;
  mail: MailService;
  ctx: AuditContext;
  tenantId: string;
  actor: { userId: string | null; username: string };
  perms: readonly PermissionKey[];
  kind: string;
  entity: string;
  entityId: string;
  content: MailContent;
  /** Verilirse bu yapılandırmayla (O-P27-r2-1: eski SMTP); yoksa firmanın güncel kaydı. */
  cfg?: SmtpConfig | null;
}

/** Alıcılara sırayla gönderir; dönen: başarısız gönderim var mı (alıcı yoksa false). Hata fırlatmaz. */
export async function sendInternalNotice(n: InternalNotice): Promise<{ sent: number; failed: number }> {
  const to = await holdersOf(n.db, n.tenantId, n.perms, n.actor.userId);
  let sent = 0;
  let failed = 0;
  for (const addr of to) {
    const meta = { tenantId: n.tenantId, ...n.actor, kind: n.kind, entity: n.entity, entityId: n.entityId };
    const out = await n.mail.sendForTenant(n.ctx, meta, addr, n.content, n.cfg).catch(() => ({ ok: false }));
    if (out.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

// ------------------------------------------------------------------------------------------- SMTP değişikliği (AC-336, O-P27-r2-1)

export interface SmtpInput {
  host: string;
  port: number;
  security: string;
  user: string | null;
  password?: string | undefined;
  fromName: string | null;
  fromEmail: string;
}

/** Kayıtlı SMTP ile gelen değer farklı mı (şifre verildiyse değişmiş sayılır; `null` = SMTP kaldırılıyor). */
export async function smtpWillChange(db: Db, tenantId: string, next: SmtpInput | null): Promise<boolean> {
  const cur = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      smtpHost: true,
      smtpPort: true,
      smtpSecurity: true,
      smtpUser: true,
      smtpFromName: true,
      smtpFromEmail: true,
      smtpPassEnc: true,
    },
  });
  if (!cur) return next !== null;
  if (next === null) return cur.smtpHost !== null || cur.smtpPassEnc !== null;
  if (next.password !== undefined && next.user !== null) return true;
  const a = [cur.smtpHost, cur.smtpPort, cur.smtpSecurity, cur.smtpUser, cur.smtpFromName, cur.smtpFromEmail];
  const b = [next.host, next.port, next.security, next.user, next.fromName, next.fromEmail];
  return JSON.stringify(a) !== JSON.stringify(b) || (next.user === null && cur.smtpPassEnc !== null);
}

/** D-P27-6 / AC-339: kurtarma koduyla yapılan step-up ile gözetimsiz bağlantı açıldı. */
export function recoveryConnectMail(o: { user: string; device: string; at: Date; ip: string }): MailContent {
  return content("Gözetimsiz bağlantı kurtarma koduyla açıldı", [
    `${o.user}, "${o.device}" cihazına kurtarma koduyla doğrulama yaparak gözetimsiz bağlantı açtı (${istanbul(o.at)}, IP ${o.ip}).`,
    "Bu bağlantı beklenmiyorsa kullanıcının hesabını ve cihaz yetkilerini hemen kontrol edin.",
  ]);
}

// ------------------------------------------------------------------------------------------- P28u dört göz (AC-436, 441)
// mimari-p28u §9.2 (D-P28u-4, K-P28u-14): konu SABİT, gerekçe yalnız gövdede (düz metin; HTML sürümünde `esc`). URL yok. Commit
// sonrası süreç içi 3 deneme (0 / 10 / 30 sn) → ≤ 60 sn; her deneme `unattended.silent.notify` (alıcı maskeli) + `mail.sent`
// (MailService). Son deneme de başarısızsa audit `result:fail` + metrik; bağlantı sürer. Yeniden başlatmada bekleyen deneme
// kaybolur (ADR-0005 kabulü).

export const SILENT_CONNECT_SUBJECT = "İzin istenmeden bağlanıldı";
export const SILENT_POLICY_SUBJECT = "Gözetimsiz erişim politikası değişti";
/** §9.2: deneme gecikmeleri (ms; ilk deneme hemen). */
export const SILENT_NOTICE_DELAYS_MS: readonly number[] = [0, 10_000, 30_000];

/** İzinsiz bağlantı: bağlanan, cihaz, müşteri, saat, gerekçe. */
export function silentConnectMail(o: { user: string; device: string; customer: string; at: Date; reason: string }): MailContent {
  return content(SILENT_CONNECT_SUBJECT, [
    `${o.user}, ${o.customer} müşterisinin "${o.device}" cihazına kullanıcıdan izin istemeden gözetimsiz bağlantı açtı (${istanbul(o.at)}).`,
    `Gerekçe: ${o.reason}`,
    "Bu bağlantı beklenmiyorsa kullanıcının yetkilerini ve firmanın gözetimsiz erişim politikasını hemen kontrol edin.",
  ]);
}

/** Politika değişikliği: değiştiren, eski → yeni, saat. */
export function silentPolicyMail(o: { user: string; old: boolean; next: boolean; at: Date }): MailContent {
  const label = (v: boolean): string => (v ? "açık" : "kapalı");
  return content(SILENT_POLICY_SUBJECT, [
    `${o.user}, "İzin istemeden bağlanma" politikasını değiştirdi: ${label(o.old)} → ${label(o.next)} (${istanbul(o.at)}).`,
    "Bu değişiklik beklenmiyorsa gözetimsiz erişim ayarlarını hemen kontrol edin.",
  ]);
}

/** §9.2 alıcıları: diğer etkin `unattended.manage` sahipleri; boşsa işlemi yapan + etkin Admin'ler (tekil). */
export async function silentRecipients(db: Db, tenantId: string, actor: { userId: string; email: string }): Promise<string[]> {
  const others = await holdersOf(db, tenantId, ["unattended.manage"], actor.userId);
  if (others.length > 0) return [...new Set(others)];
  const admins = await db.user.findMany({ where: { tenantId, status: "ACTIVE", role: "ADMIN" }, select: { email: true } });
  return [...new Set([actor.email, ...admins.map((a) => a.email)])];
}

export interface SilentNoticeDeps {
  db: Db;
  mail: MailService;
  metrics: { inc(name: string, labels?: Record<string, string>): void };
  log: { error(obj: object, msg: string): void };
  /** Testler: sahte bekleme; varsayılan `setTimeout` (unref). */
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
}

export interface SilentNotice {
  ctx: AuditContext;
  tenantId: string;
  actor: { userId: string; email: string };
  event: "connect" | "policy";
  entity: "support_sessions" | "tenant_settings";
  entityId: string;
  content: MailContent;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((res) => {
    setTimeout(res, ms).unref();
  });

/** Bir alıcıya ≤ 3 deneme; her deneme audit'lenir. Dönen: teslim edildi mi. */
async function deliverWithRetry(d: SilentNoticeDeps, n: SilentNotice, to: string): Promise<boolean> {
  const delays = d.delaysMs ?? SILENT_NOTICE_DELAYS_MS;
  const sleep = d.sleep ?? realSleep;
  const meta = { tenantId: n.tenantId, userId: n.actor.userId, username: n.actor.email, entity: n.entity, entityId: n.entityId };
  for (let i = 0; i < delays.length; i += 1) {
    if ((delays[i] ?? 0) > 0) await sleep(delays[i] ?? 0);
    const out = await d.mail
      .sendForTenant(n.ctx, { ...meta, kind: `unattended_silent_${n.event}` }, to, n.content)
      .catch(() => ({ ok: false }));
    await writeAudit(d.db, n.ctx, {
      ...meta,
      action: UNATTENDED_AUDIT.SILENT_NOTIFY,
      result: out.ok ? "success" : "fail",
      newValue: { event: n.event, recipient: maskEmail(to), result: out.ok ? "success" : "fail", attempt: i + 1 },
    });
    if (out.ok) return true;
  }
  return false;
}

/** Commit sonrası çağrılır (beklenmez); hata fırlatmaz. */
export async function sendSilentNotice(d: SilentNoticeDeps, n: SilentNotice): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const to = await silentRecipients(d.db, n.tenantId, n.actor);
    const results = await Promise.all(to.map((addr) => deliverWithRetry(d, n, addr)));
    for (const ok of results) {
      d.metrics.inc("rs_unattended_silent_notify_total", { result: ok ? "ok" : "fail" });
      if (ok) sent += 1;
      else failed += 1;
    }
  } catch (err) {
    d.log.error({ err, event: "unattended_silent_notify_failed" }, "dört göz e-postası gönderilemedi");
  }
  return { sent, failed };
}
