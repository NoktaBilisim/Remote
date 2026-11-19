/*
 * Audit işlem (action) adlarının Türkçe etiketleri ve filtre grupları (AC-76). Ad listesi contracts'taki sabitlerden
 * (`@remote/contracts/audit`) ve sunucunun yazdığı diğer adlardan gelir; bilinmeyen ad HAM gösterilir (labels.ts kuralı).
 * Grup = adın ilk bölümü (`auth.login` → `auth`); grup filtresi API'ye `auth.*` öneki olarak gider.
 */
import {
  AUTH_AUDIT,
  BACKUP_AUDIT,
  BINDING_AUDIT,
  CLIP_PRINT_AUDIT_LABELS,
  CONTROL_AUDIT,
  CUSTOMER_AUDIT,
  MAIL_AUDIT,
  LG_AUDIT_LABELS,
  MULTI_AUDIT_GROUP,
  MULTI_AUDIT_LABELS,
  P16_AUDIT_LABELS,
  P18_AUDIT_LABELS,
  P19_NOTIFY_AUDIT_LABELS,
  P19_REQUEST_AUDIT_LABELS,
  RECORDING_AUDIT_GROUP_LABELS,
  RECORDING_AUDIT_LABELS,
  RETENTION_AUDIT,
  VOICE_AUDIT_GROUP_LABELS,
  VOICE_AUDIT_LABELS,
  CHAT_AUDIT_LABELS,
  CLIENT_UPDATE_AUDIT,
  CLIENT_UPDATE_AUDIT_GROUP,
  CLIENT_UPDATE_AUDIT_LABELS,
  CLIENT_UPDATE_SETTINGS_AUDIT,
  SYSTEM_AUDIT,
  TENANT_AUDIT,
  USER_AUDIT,
  deletedUserLabel,
} from "@remote/contracts/audit";
import { UNATTENDED_AUDIT_LABELS } from "@remote/contracts/api/unattended";
import {
  UPDATE_CLIENT_REPORTED_PREFIX,
  UPDATE_REASON_LABELS,
  UPDATE_REJECTED_LABEL,
  isUpdateSecurityReason,
  type UpdateReason,
} from "@remote/contracts/api/update";
import { AUDIT_ACTION_GROUPS } from "./contract";
import { CLIENT_OS_FIELD_LABEL, CLIENT_OS_LABELS, labelOf, OUTBOUND_REASON_LABELS, TIMELINE_ACTION_LABELS } from "@remote/contracts/labels";
import type { JoinAuditOs } from "@remote/contracts/api/sessions";

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  ...TIMELINE_ACTION_LABELS,
  // P28c (§9, AC-370): çoklu teknisyen olayları
  ...MULTI_AUDIT_LABELS,
  "auth.login": "Giriş",
  "auth.logout": "Çıkış",
  "auth.locked": "Hesap kilitlendi",
  "auth.password_change": "Şifre değiştirildi",
  [AUTH_AUDIT.MFA_SETUP]: "2FA kurulumu başlatıldı",
  [AUTH_AUDIT.MFA_ENABLED]: "2FA etkinleştirildi",
  [AUTH_AUDIT.MFA_VERIFY]: "2FA doğrulaması",
  [AUTH_AUDIT.LOGOUT_ALL]: "Tüm cihazlardan çıkış",
  [AUTH_AUDIT.PASSWORD_RESET_REQUESTED]: "Şifre sıfırlama istendi",
  [AUTH_AUDIT.PASSWORD_RESET]: "Şifre sıfırlandı",
  [AUTH_AUDIT.SUPERADMIN_RESET]: "Super Admin şifresi sunucudan sıfırlandı",
  [USER_AUDIT.CREATED]: "Kullanıcı oluşturuldu",
  [USER_AUDIT.UPDATED]: "Kullanıcı güncellendi",
  [USER_AUDIT.PERMISSION_CHANGED]: "Yetki değiştirildi",
  [USER_AUDIT.DEACTIVATED]: "Kullanıcı pasife alındı",
  [USER_AUDIT.REACTIVATED]: "Kullanıcı yeniden etkinleştirildi",
  [USER_AUDIT.MFA_RESET]: "2FA sıfırlandı",
  [TENANT_AUDIT.CREATED]: "Firma oluşturuldu",
  [TENANT_AUDIT.UPDATED]: "Firma güncellendi",
  [TENANT_AUDIT.DEACTIVATED]: "Firma pasife alındı",
  [TENANT_AUDIT.REACTIVATED]: "Firma yeniden etkinleştirildi",
  [TENANT_AUDIT.SWITCHED]: "Firmaya geçildi",
  [TENANT_AUDIT.SETTINGS_UPDATED]: "Firma ayarları güncellendi",
  [MAIL_AUDIT.SENT]: "E-posta gönderildi",
  [MAIL_AUDIT.SESSION_EMAIL]: "Oturum bağlantısı e-postası",
  [MAIL_AUDIT.SMTP_TEST]: "SMTP test maili",
  [MAIL_AUDIT.EMAIL_TEST]: "Talep bildirimi test maili",
  "settings.whatsapp.test": "WhatsApp test mesajı",
  "settings.support_requests.updated": "Talep ayarları güncellendi",
  "settings.support_requests.ref_rotated": "Talep bağlantısı yenilendi",
  [SYSTEM_AUDIT.CONSENT_TEXT_UPDATED]: "Aydınlatma metni yeni sürüm",
  [SYSTEM_AUDIT.MYSQL_UPDATED]: "MySQL ayarı güncellendi",
  [SYSTEM_AUDIT.MYSQL_TEST]: "MySQL bağlantı testi",
  [SYSTEM_AUDIT.TURN_UPDATED]: "TURN ayarı güncellendi",
  [SYSTEM_AUDIT.TURN_DELETED]: "TURN ortam değerlerine döndü",
  [SYSTEM_AUDIT.WHATSAPP_UPDATED]: "WhatsApp servis adresi güncellendi",
  [SYSTEM_AUDIT.WHATSAPP_DELETED]: "WhatsApp servisi ortam değerine döndü",
  [SYSTEM_AUDIT.AUDIT_EXPORTED]: "Audit log dışa aktarıldı",
  "session.updated": "Oturum notu/ticket güncellendi",
  "session.exported": "Oturum geçmişi dışa aktarıldı",
  "session.resolve": "Oturum bağlantısı açıldı",
  "session.join": "Müşteri katıldı",
  "file.transfer": "Dosya aktarımı",
  "file.transfer.sender_report": "Dosya gönderim raporu",
  "file.meta.rejected_by_db": "Dosya kaydı reddedildi",
  "file.meta.rate_limited": "Dosya teklifi sınırlandı",
  "request.created": "Talep oluşturuldu",
  "request.accepted": "Talep kabul edildi",
  "request.rejected": "Talep reddedildi",
  "request.cancelled": "Talep iptal edildi",
  "request.expired": "Talebin süresi doldu",
  "request.connect_failed": "Talep bağlanamadı",
  "request.notify": "Talep bildirimi",
  "request.rate_limited": "Talep sınırlandı",
  [CUSTOMER_AUDIT.CREATED]: "Müşteri oluşturuldu",
  [CUSTOMER_AUDIT.UPDATED]: "Müşteri güncellendi",
  [CUSTOMER_AUDIT.REF_ROTATED]: "Müşteri bağlantısı yenilendi",
  [CUSTOMER_AUDIT.DEACTIVATED]: "Müşteri pasife alındı",
  [CUSTOMER_AUDIT.REACTIVATED]: "Müşteri yeniden etkinleştirildi",
  [CUSTOMER_AUDIT.ANONYMIZED]: "Müşteri anonimleştirildi",
  // P19 (AC-263): CSV dışa/içe aktarma
  [CUSTOMER_AUDIT.EXPORTED]: "Müşteriler dışa aktarıldı",
  [CUSTOMER_AUDIT.IMPORTED]: "Müşteriler içe aktarıldı",
  [BINDING_AUDIT.ISSUED]: "Bilgisayar kaydedildi",
  [BINDING_AUDIT.REVOKED]: "Bilgisayar kaydı iptal edildi",
  [BINDING_AUDIT.DENIED]: "Bilgisayar kaydı reddedildi",
  [CONTROL_AUDIT.CAPS_CHANGED]: "Teknisyen yetkileri daraldı",
  // P13a (AC-199): günlük saklama işi (sistem, yalnız sayılar)
  [RETENTION_AUDIT.RUN]: "Saklama süresi işi",
  // P13b (G-P13b-5): yedek audit süreklilik taban çizgisi
  [BACKUP_AUDIT.AUDIT_BASELINE_RESET]: "Yedek audit taban çizgisi sıfırlandı",
  // P16 (AC-240..243): kalıcı silme, firma silme işi, yetim dosya taraması (`uploads.*`), migration kaydı (`migration.*`)
  ...P16_AUDIT_LABELS,
  // P18 (talep iletişimi) ve P19 (web talep formu)
  ...P18_AUDIT_LABELS,
  ...P19_REQUEST_AUDIT_LABELS,
  ...P19_NOTIFY_AUDIT_LABELS,
  // LG (AC-420, AC-425): müşteriye bağlantı gönderme ve oturumsuz servis indirme
  ...LG_AUDIT_LABELS,
  // P28a (AC-347, 351): pano izni/aktarımı ve uzaktan yazdırma
  ...CLIP_PRINT_AUDIT_LABELS,
  // P27/P28u (AC-273…, 431, 436, 439, 441, 443–445): gözetimsiz kayıt/cihaz/bağlantı/onay/müdahale + politika
  // (`settings.unattended_silent`). `unattended.session.*` TIMELINE etiketiyle aynı metin.
  ...UNATTENDED_AUDIT_LABELS,
  // P28e (mimari-p28e §11.1; AC-388): recording.start/stop/view/view.end/delete/expired + `settings.recording`
  ...RECORDING_AUDIT_LABELS,
  // P28d (mimari-p28d §6; AC-379): voice.request/accept/reject/join/end
  ...VOICE_AUDIT_LABELS,
  // P22 (mimari-p22 §7.1; test-raporu D-1): oturum sohbeti görüntüleme/özet/ret/eski istemci/geçmiş gönderimi
  ...CHAT_AUDIT_LABELS,
  // P29 (mimari-p29 §4.7; AC-491): client.update.* + `settings.client_update`
  ...CLIENT_UPDATE_AUDIT_LABELS,
};

/**
 * P16 (AC-241): satırdaki aktör adı — `actorLabel` (canlı kullanıcıda ad, silinmişte "Silinmiş kullanıcı #…"), yoksa
 * eski alanlar. `tombstone`: aktör kalıcı silinmiş (avatar "#", DESIGN §6).
 */
export function auditActor(a: {
  userId: string | null;
  username: string | null;
  userFullName: string | null;
  actorLabel?: string | null;
}): { name: string | null; tombstone: boolean } {
  const name = a.actorLabel ?? a.userFullName ?? a.username;
  return { name, tombstone: Boolean(a.userId && a.actorLabel && a.actorLabel === deletedUserLabel(a.userId)) };
}

/** Dış gönderim `reason` etiketleri tek kaynak: contracts (`OUTBOUND_REASON_LABELS`, mimari-p13 §3). */
export { OUTBOUND_REASON_LABELS };
export const reasonLabel = (reason: string): string => labelOf(OUTBOUND_REASON_LABELS, reason);

/** Grup (adın ilk bölümü) → Türkçe başlık: contracts `AUDIT_ACTION_GROUPS` (`auth.*` → "Giriş ve hesap güvenliği"). */
const AUDIT_GROUP_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(AUDIT_ACTION_GROUPS.map((g) => [g.prefix.slice(0, -2), g.label])),
  // P28e: `recording.*` → "Kayıt" (contracts grup listesinde yok; etiket tablosundan birleştirilir)
  ...RECORDING_AUDIT_GROUP_LABELS,
  // P28d: `voice.*` → "Sesli görüşme"
  ...VOICE_AUDIT_GROUP_LABELS,
  // P29: `client.update.*` → "İstemci güncelleme" (contracts grup listesinde yok; `client.` öneki yalnız bu grupta)
  client: CLIENT_UPDATE_AUDIT_GROUP.label,
};

/**
 * P28c (§9; K0 sapma 3): çoklu teknisyen eylemleri `session.*` önekli olduğundan önek grubu ("Oturum") onları ayıramaz →
 * ayrı "Çoklu teknisyen" seçenek grubu; "tümü" seçeneği yok (tek önekle ifade edilemez), yalnız tek tek eylem süzgeci.
 */
const MULTI_GROUP = "~multi";
const MULTI_ACTIONS: ReadonlySet<string> = new Set(MULTI_AUDIT_GROUP.actions);
const groupOf = (action: string): string => (MULTI_ACTIONS.has(action) ? MULTI_GROUP : (action.split(".")[0] ?? action));
export const actionLabel = (action: string): string => labelOf(AUDIT_ACTION_LABELS, action);
export const groupLabel = (group: string): string => (group === MULTI_GROUP ? MULTI_AUDIT_GROUP.label : labelOf(AUDIT_GROUP_LABELS, group));

const CLIENT_UPDATE_ACTIONS: ReadonlySet<string> = new Set(Object.values(CLIENT_UPDATE_AUDIT));
const objOf = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** P29: `client.update.*` satırının bilinen nedeni (`new_value.reason`); başka eylem / bilinmeyen değer → null. */
export function clientUpdateReason(item: { action: string; newValue: unknown }): UpdateReason | null {
  if (!CLIENT_UPDATE_ACTIONS.has(item.action)) return null;
  const r = objOf(item.newValue)?.reason;
  return typeof r === "string" && Object.hasOwn(UPDATE_REASON_LABELS, r) ? (r as UpdateReason) : null;
}

/** Ayrıntıdaki "Neden" satırı (Türkçe etiket) — yalnız `client.update.*` satırında, bilinen nedende. */
export function clientUpdateReasonLabel(item: { action: string; newValue: unknown }): string | null {
  const r = clientUpdateReason(item);
  return r ? UPDATE_REASON_LABELS[r] : null;
}

/**
 * AC-491 tek özel durum (§4.7, §14.4): `failed` + güvenlik nedeni → "Güncelleme reddedildi (imza)"; `binding` kaynaklı
 * (istemci beyanı, doğrulanmamış) `failed` satırının önüne "İstemci bildirdi: ". Diğer satırlar → null (genel etiket).
 */
export function clientUpdateLabel(item: { action: string; newValue: unknown }): string | null {
  if (item.action !== CLIENT_UPDATE_AUDIT.FAILED) return null;
  const reason = clientUpdateReason(item);
  const base = isUpdateSecurityReason(reason)
    ? `${UPDATE_REJECTED_LABEL} (${UPDATE_REASON_LABELS[reason]})`
    : (CLIENT_UPDATE_AUDIT_LABELS[CLIENT_UPDATE_AUDIT.FAILED] ?? item.action);
  return objOf(item.newValue)?.source === "binding" ? `${UPDATE_CLIENT_REPORTED_PREFIX}${base}` : base;
}

/**
 * AC-491 (QA P29 tur 1): `client.update.*` ve `settings.client_update` satırlarında ham eylem anahtarı hiçbir yerde
 * gösterilmez (tablo, kart, ayrıntı, aria). Diğer gruplarda P11 davranışı (etiketin altında ham ad) korunur.
 */
export const hidesRawAction = (action: string): boolean => CLIENT_UPDATE_ACTIONS.has(action) || action === CLIENT_UPDATE_SETTINGS_AUDIT;

/** Satır etiketi (tablo, kart, ayrıntı): özel durum varsa o, yoksa `actionLabel`. */
export const auditItemLabel = (item: { action: string; newValue: unknown }): string => clientUpdateLabel(item) ?? actionLabel(item.action);

interface ActionOptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Filtre seçenekleri: grup başına önce "<grup> — tümü" (`grup.*`), sonra tam adlar (etikete göre sıralı).
 * `selected` listede yoksa (ör. URL'den gelen bilinmeyen ad) ham haliyle eklenir → seçim kaybolmaz.
 */
export function actionOptionGroups(selected?: string, extra: readonly string[] = []): ActionOptionGroup[] {
  const names = new Set([...Object.keys(AUDIT_ACTION_LABELS), ...extra]);
  if (selected && !selected.endsWith(".*")) names.add(selected);
  const byGroup = new Map<string, string[]>();
  for (const a of names) {
    const g = groupOf(a);
    byGroup.set(g, [...(byGroup.get(g) ?? []), a]);
  }
  if (selected?.endsWith(".*") && !byGroup.has(selected.slice(0, -2))) byGroup.set(selected.slice(0, -2), []);
  return [...byGroup.entries()]
    .map(([g, acts]) => ({ g, label: groupLabel(g), acts }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"))
    .map(({ g, label, acts }) => ({
      label,
      options: [
        ...(g === MULTI_GROUP ? [] : [{ value: `${g}.*`, label: `${label} — tümü` }]),
        ...acts.map((a) => ({ value: a, label: actionLabel(a) })).sort((x, y) => x.label.localeCompare(y.label, "tr")),
      ],
    }));
}

/**
 * Dış gönderim / test kayıtları (`mail.*`, `session.email`, `settings.*.test`): detayda yalnız `reason` gösterilir
 * (sunucu da süzer; arayüz ek alan basmaz — alıcı, konu, ham hata ekrana gelmez).
 */
const MAIL_ACTIONS: ReadonlySet<string> = new Set(Object.values(MAIL_AUDIT));
export const isMailAction = (action: string): boolean =>
  MAIL_ACTIONS.has(action) || groupOf(action) === "mail" || /^settings\.[a-z_]+\.test$/.test(action);

type AuditPayload = { kind: "json"; oldValue: string | null; newValue: string | null } | { kind: "reason"; reason: string | null };

const pretty = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};
const reasonOf = (v: unknown): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = (v as Record<string, unknown>).reason;
  return typeof r === "string" || typeof r === "number" ? String(r) : null;
};

/** Detay diyaloğunda gösterilecek değer (düz metin; HTML olarak YORUMLANMAZ — çağıran `<pre>` metin düğümüne basar). */
export function auditPayload(item: { action: string; oldValue: unknown; newValue: unknown }): AuditPayload {
  if (isMailAction(item.action)) return { kind: "reason", reason: reasonOf(item.newValue) ?? reasonOf(item.oldValue) };
  return { kind: "json", oldValue: pretty(item.oldValue), newValue: pretty(item.newValue) };
}

/**
 * P28f (mimari-p28f §4.1): katılım başarı satırındaki (`guest.pending`; sözleşmede `session.join` olarak da anılır) `os`
 * müşteri beyanıdır — etiket ve değerler contracts `CLIENT_OS_FIELD_LABEL` / `CLIENT_OS_LABELS`.
 */
const CLIENT_OS_ACTIONS: ReadonlySet<string> = new Set(["guest.pending", "session.join"]);
export { CLIENT_OS_FIELD_LABEL };

/** Bilinen `os` değerinin etiketi; eski satır (alan yok), başka eylem ya da bilinmeyen değer → `null` (satır gösterilmez). */
export function auditClientOs(item: { action: string; newValue: unknown }): string | null {
  if (!CLIENT_OS_ACTIONS.has(item.action)) return null;
  const v = item.newValue;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const os = (v as Record<string, unknown>).os;
  return typeof os === "string" && Object.hasOwn(CLIENT_OS_LABELS, os) ? CLIENT_OS_LABELS[os as JoinAuditOs] : null;
}
