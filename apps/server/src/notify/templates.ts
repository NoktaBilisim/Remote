// Müşteri metin şablonları (P19 J3, mimari-e11 §8c.3; S-P19-11, S-P19-T8). Sabit Türkçe; müşteri metni, ret metni ve
// teknisyen serbest metni GİRMEZ. Değişkenler yalnız firma adı (≤ 30), talep kodu, oturum bağlantısı ve teknisyen "Ad S.".
// Ad süzgeci tüm kanallarda (e-posta dahil): alan adı/bağlantı gibi görünen içerik metne taşınmaz.
import type { NotifyKind } from "@remote/contracts/api/notify";
import type { MailContent } from "../mail/templates.ts";

const FIRM_MAX = 30;
const TECH_MAX = 20;
// Cc + Cf (bidi U+202A–202E, U+2066–2069, sıfır genişlik U+200B–200F dahil) + satır/paragraf ayırıcı.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** S-P19-T8: NFKC → görünmez/bidi atılır → şema ve `://` → `www.` → TLD benzeri nokta boşluğa → boşluk tekleşir. */
export function sanitizeTemplateName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[a-z][a-z0-9+.-]*:\/\//gi, "")
    .replace(/:\/\//g, "")
    .replace(/www\./gi, "")
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

export function linkMessage(firm: string, link: string, technician: string): string {
  return `${firmName(firm)} destek bağlantınız: ${link} — Teknisyen: ${techShortName(technician)}. Bağlantıyı kimseyle paylaşmayın.`;
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
