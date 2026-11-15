// Müşteri metin şablonları (P19 J3, mimari-e11 §8c.3; S-P19-11, S-P19-T8). Sabit Türkçe; müşteri metni, ret metni ve
// teknisyen serbest metni GİRMEZ. Değişkenler yalnız firma adı (≤ 30), talep kodu, oturum bağlantısı ve teknisyen "Ad S.".
// Ad süzgeci tüm kanallarda (e-posta dahil): alan adı/bağlantı gibi görünen içerik metne taşınmaz.
import type { NotifyKind } from "@remote/contracts/api/notify";
import type { MailContent } from "../mail/templates.ts";

const FIRM_MAX = 30;
const TECH_MAX = 20;
// Cc + Cf (bidi U+202A–202E, U+2066–2069, sıfır genişlik U+200B–200F dahil) + satır/paragraf ayırıcı.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu;

// S-P19-K4: NFKC sonrası noktaya dönmeyen nokta varyantları (IDNA ayırıcıları): U+3002 。 (U+FF61 ｡ ve U+FE12 ︒ NFKC ile buna
// döner), U+FE52 ﹒ ve U+2024 ․ (NFKC '.' verir; savunma derinliği). Hepsi '.' sayılır → aşağıdaki kurallar uygulanır.
const DOT_VARIANTS = /[\u3002\uFF61\uFE12\uFE52\u2024\uFF0E]/g;
const IPV4_LIKE = /\d{1,3}(?:\.\d{1,3}){3}/g;

/**
 * S-P19-T8/K4: NFKC → görünmez/bidi atılır → nokta varyantları '.' → şema ve `://` → `www.` → IPv4 biçimi ve TLD benzeri
 * nokta boşluğa → boşluk tekleşir.
 */
export function sanitizeTemplateName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(DOT_VARIANTS, ".")
    .replace(/[a-z][a-z0-9+.-]*:\/\//gi, "")
    .replace(/:\/\//g, "")
    .replace(/www\./gi, "")
    .replace(IPV4_LIKE, (m) => m.replace(/\./g, " "))
    .replace(/\.(?=[a-z]{2,}\b)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const cut = (s: string, n: number): string => [...s].slice(0, n).join("").trim();

/** Firma adı: süzgeç + ≤ 30; boş kalırsa "Destek". */
export function firmName(raw: string): string {
  const s = cut(sanitizeTemplateName(raw), FIRM_MAX);
  return s === "" ? "Destek" : s;
}

/** Teknisyen: ilk sözcük + son sözcüğün baş harfi + "." (≤ 20); tek sözcükse yalnız o. */
export function techShortName(raw: string): string {
  const w = sanitizeTemplateName(raw).split(" ").filter(Boolean);
  const first = w[0] ?? "";
  if (w.length < 2) return cut(first, TECH_MAX) || "Teknisyen";
  const initial = [...(w.at(-1) ?? "")][0] ?? "";
  return cut(`${cut(first, TECH_MAX - 3)} ${initial.toLocaleUpperCase("tr-TR")}.`, TECH_MAX);
}

export function statusMessage(kind: NotifyKind, firm: string, code: string): string {
  const f = firmName(firm);
  switch (kind) {
    case "REQ_ACCEPTED":
      return `${f}: ${code} numaralı destek talebiniz kabul edildi, teknisyen bağlanıyor.`;
    case "REQ_REJECTED":
      return `${f}: ${code} numaralı destek talebiniz şu an karşılanamadı.`;
    case "REQ_EXPIRED":
      return `${f}: ${code} numaralı destek talebinizin bekleme süresi doldu. Yeniden talep oluşturabilirsiniz.`;
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** E-posta: aynı metin + mevcut çerçeve (logo `MailService` ekler). */
export function statusMail(kind: NotifyKind, firm: string, code: string): MailContent {
  const text = statusMessage(kind, firm, code);
  return { subject: `${firmName(firm)} – destek talebi ${code}`, text, bodyHtml: `<p>${esc(text)}</p>` };
}

// ------------------------------------------------------------------------------------------- P27 gözetimsiz (AC-296, 337)
// Bağlantı/URL yok (mimari-p27 §7.1). Cihaz adı beyandır → aynı ad süzgecinden geçer; adresler yalnız maskeli.

const DEVICE_MAX = 40;
const istanbul = (d: Date): string =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
const deviceName = (raw: string): string => cut(sanitizeTemplateName(raw), DEVICE_MAX) || "Cihaz";
const mail = (subject: string, lines: string[]): MailContent => ({
  subject,
  text: lines.join("\n\n"),
  bodyHtml: lines.map((l) => `<p>${esc(l)}</p>`).join(""),
});

export interface StartedInfo {
  firm: string;
  device: string;
  technician: string;
  at: Date;
}

/** UNATTENDED_STARTED (SMS/WA metni). */
export function startedMessage(o: StartedInfo): string {
  return `${firmName(o.firm)}: "${deviceName(o.device)}" bilgisayarınıza ${istanbul(o.at)} itibarıyla gözetimsiz uzaktan bağlantı başladı — Teknisyen: ${techShortName(o.technician)}.`;
}

export function startedMail(o: StartedInfo): MailContent {
  return mail(`${firmName(o.firm)} – gözetimsiz uzaktan bağlantı başladı`, [
    startedMessage(o),
    "Bu bağlantıyı beklemiyorsanız destek firmanızı arayın.",
  ]);
}

/** UN_CONTACTS_CHANGED: maskeli adres farkı, değiştiren kullanıcı, saat. */
export function contactsChangedMail(o: { firm: string; user: string; added: string[]; removed: string[]; at: Date }): MailContent {
  const f = firmName(o.firm);
  return mail(`${f} – gözetimsiz erişim bildirim adresleri değişti`, [
    `${f} firmasında gözetimsiz erişim bildirim adresleriniz ${istanbul(o.at)} tarihinde ${techShortName(o.user)} tarafından değiştirildi.`,
    ...(o.added.length > 0 ? [`Eklenen: ${o.added.join(", ")}`] : []),
    ...(o.removed.length > 0 ? [`Kaldırılan: ${o.removed.join(", ")}`] : []),
    "Bu değişikliği siz istemediyseniz destek firmanızı arayın.",
  ]);
}

/** UN_DEVICE_REGISTERED: cihaz adı, kayıt IP'si, saat. */
export function deviceRegisteredCustomerMail(o: { firm: string; device: string; ip: string; at: Date }): MailContent {
  const f = firmName(o.firm);
  return mail(`${f} – yeni cihaz gözetimsiz erişime kaydedildi`, [
    `"${deviceName(o.device)}" adlı bilgisayar ${istanbul(o.at)} tarihinde ${o.ip} IP adresinden ${f} gözetimsiz erişimine kaydedildi.`,
    "Bu kaydı siz başlatmadıysanız destek firmanızı arayın.",
  ]);
}
