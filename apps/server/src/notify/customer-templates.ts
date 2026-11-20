// LG müşteri gönderim şablonları (mimari-link-gonderme §5; AC-407, 410, 412, 418, 422, 424). Tek giriş `renderFor`:
// önizleme (`POST /customer-send/options`) ve gönderim (yeni uç + eski K1 uçları) aynı fonksiyondan geçer → metin karakter
// karakter aynı. Müşteri/kişi adı, talep metni ve serbest metin girmez. Firma/teknisyen adı `sanitizeTemplateName` +
// D-LG-4 süzgecinden (WhatsApp biçim karakterleri `* _ ~ \``, uzun rakam dizileri) geçer; e-posta HTML'i kaçışlıdır.
import type { CustomerSendChannel, MessagePreview } from "@remote/contracts/api/customer-send";
import type { MailContent } from "../mail/templates.ts";
import { firmName, sanitizeTemplateName, techShortName } from "./templates.ts";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string): string =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
const istanbul = (d: Date): string =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

/** D-LG-4: WA biçim karakterleri, açılı ayraç (AC-424: düz metinde de ham etiket yok) ve ≥ 5 haneli rakam dizileri girmez. */
const WA_FORMAT = /[*_~`<>]/g;
const DIGIT_RUN = /\+?\d(?:[\s\-.()/]*\d){4,}/g;
const clean = (s: string): string => s.replace(WA_FORMAT, "").replace(DIGIT_RUN, "").replace(/\s+/g, " ").trim();
const F = (raw: string): string => clean(firmName(raw)) || "Destek";
const T = (raw: string): string => clean(techShortName(raw)) || "Teknisyen";
/** E-postada teknisyenin süzülmüş tam adı (P10 gövdesi; AC-424). */
const fullName = (raw: string): string => clean(sanitizeTemplateName(raw)).slice(0, 60) || "Teknisyen";

export interface SessionTemplateInput {
  kind: "SESSION";
  firm: string;
  technician: string;
  link: string;
  /** 8 haneli oturum kodu. */
  code: string;
  expiresAt: Date;
  /** AC-411/412: ikili kapısı `ok` ise doğrudan indirme bağlantısı ve SHA-256; değilse null (satır metne girmez). */
  agent: { url: string; sha256: string } | null;
}
export interface UnattendedTemplateInput {
  kind: "UNATTENDED_CODE";
  firm: string;
  downloadUrl: string;
  /** Gösterim biçimi `XXXX-XXXX-XXXX-XXXX`. */
  code: string;
  expiresAt: Date;
  sha256: string;
}
export interface CustomerTemplateInput {
  kind: "CUSTOMER";
  firm: string;
  downloadUrl: string | null;
  webFormUrl: string | null;
  /** P31 (§15.3, AC-520): sunucunun genel kökeni (`PUBLIC_BASE_URL`, sondaki `/` yok) — kaynak satırı. */
  origin: string;
}
export type TemplateInput = SessionTemplateInput | UnattendedTemplateInput | CustomerTemplateInput;

/** Önizleme + gönderim çıktısı; `bodyHtml` yalnız EMAIL'de (önizlemeye girmez, aynı satırlardan üretilir). */
export interface Rendered extends MessagePreview {
  bodyHtml: string | null;
}

const short = (text: string): Rendered => ({ subject: null, text, bodyHtml: null });
const asMail = (r: Rendered): MailContent => ({ subject: r.subject ?? "", text: r.text, bodyHtml: r.bodyHtml ?? `<p>${esc(r.text)}</p>` });

/** K1 SMS (qa LG tur 1 madde 7): istemci satırı ve uyarı yok → en kötü durumda (firma 30, kısa ad 20) UCS-2 ≤ 3 parça. */
function sessionSms(i: SessionTemplateInput): string {
  const code = `${i.code.slice(0, 4)} ${i.code.slice(4)}`;
  return [`${F(i.firm)} uzak destek (${T(i.technician)}):`, i.link, `Kod: ${code} · Son: ${istanbul(i.expiresAt)} (TR)`].join("\n");
}

function sessionShort(i: SessionTemplateInput): string {
  const code = `${i.code.slice(0, 4)} ${i.code.slice(4)}`;
  return [
    `${F(i.firm)} uzak destek: ${T(i.technician)} sizinle oturum başlatmak istiyor.`,
    `Bağlantı: ${i.link}`,
    ...(i.agent ? [`Windows programı: ${i.agent.url}`] : []),
    `Kod: ${code} · Son geçerlilik: ${istanbul(i.expiresAt)} (TR)`,
    "Beklemiyorsanız bağlantıyı açmayın, kimseyle paylaşmayın.",
  ].join("\n");
}

function sessionMail(i: SessionTemplateInput): Rendered {
  const firm = F(i.firm);
  const tech = fullName(i.technician);
  const code = `${i.code.slice(0, 4)} ${i.code.slice(4)}`;
  const until = istanbul(i.expiresAt);
  const agentText = i.agent
    ? `\n\nWindows 10 / 11 için destek programı: ${i.agent.url}\nDosya adı "Destek-" ile başlar. SHA-256: ${i.agent.sha256}`
    : "";
  const agentHtml = i.agent
    ? `<p>Windows 10 / 11 için destek programı: <a href="${esc(i.agent.url)}">${esc(i.agent.url)}</a><br>Dosya adı "Destek-" ile başlar. SHA-256: ${esc(i.agent.sha256)}</p>`
    : "";
  return {
    subject: oneLine(`${firm} – uzak destek bağlantınız`),
    text: `Merhaba,\n\n${tech} (${firm}) sizinle uzak destek oturumu başlatmak istiyor.\n\nBağlantı: ${i.link}\nKod: ${code}\nSon geçerlilik: ${until} (Türkiye saati)${agentText}\n\nBu isteği siz beklemiyorsanız bağlantıyı açmayın.`,
    bodyHtml: `<p>Merhaba,</p><p><b>${esc(tech)}</b> (${esc(firm)}) sizinle uzak destek oturumu başlatmak istiyor.</p><p><a href="${esc(i.link)}">Oturuma katıl</a></p><p>Kod: <b>${esc(code)}</b><br>Son geçerlilik: ${esc(until)} (Türkiye saati)</p>${agentHtml}<p>Bu isteği siz beklemiyorsanız bağlantıyı açmayın.</p>`,
  };
}

function unattendedMail(i: UnattendedTemplateInput): Rendered {
  const firm = F(i.firm);
  const until = istanbul(i.expiresAt);
  const lines = [
    "Merhaba,",
    `${firm}, bilgisayarınıza uzaktan destek servisinin kurulması için bir kayıt kodu oluşturdu.`,
    `1. Kurulum dosyasını indirin: ${i.downloadUrl}\n   Dosya: NoktaDestekServis.exe (Windows 10 / 11) · SHA-256: ${i.sha256}\n2. Dosyayı çalıştırın ve yönetici izni isteğini onaylayın.\n3. Kayıt kodu istendiğinde şunu girin: ${i.code}\n4. Kurulum tamamlanınca ${firm} ile iletişime geçin.`,
    `Kod ve bağlantı ${until} (Türkiye saati) tarihine kadar geçerlidir; kod bir kez kullanılabilir.`,
    "Bu kurulumu siz istemediyseniz destek firmanızı arayın.",
  ];
  const html = [
    "<p>Merhaba,</p>",
    `<p>${esc(firm)}, bilgisayarınıza uzaktan destek servisinin kurulması için bir kayıt kodu oluşturdu.</p>`,
    `<ol><li>Kurulum dosyasını indirin: <a href="${esc(i.downloadUrl)}">${esc(i.downloadUrl)}</a><br>Dosya: NoktaDestekServis.exe (Windows 10 / 11) · SHA-256: ${esc(i.sha256)}</li>`,
    "<li>Dosyayı çalıştırın ve yönetici izni isteğini onaylayın.</li>",
    `<li>Kayıt kodu istendiğinde şunu girin: <b>${esc(i.code)}</b></li><li>Kurulum tamamlanınca ${esc(firm)} ile iletişime geçin.</li></ol>`,
    `<p>Kod ve bağlantı ${esc(until)} (Türkiye saati) tarihine kadar geçerlidir; kod bir kez kullanılabilir.</p>`,
    "<p>Bu kurulumu siz istemediyseniz destek firmanızı arayın.</p>",
  ];
  return { subject: oneLine(`${firm} – uzaktan destek servisi kurulumu`), text: lines.join("\n\n"), bodyHtml: html.join("") };
}

function unattendedShort(i: UnattendedTemplateInput): string {
  return [
    `${F(i.firm)} uzaktan destek servisi kurulumu.`,
    `1) İndirin: ${i.downloadUrl}`,
    "2) Çalıştırıp yönetici iznini onaylayın.",
    `3) Kayıt kodu: ${i.code}`,
    `Son geçerlilik: ${istanbul(i.expiresAt)} (TR), tek kullanımlık.`,
    "Bu kurulumu siz istemediyseniz destek firmanızı arayın.",
  ].join("\n");
}

const customerLinks = (i: CustomerTemplateInput): [string, string][] => [
  ...(i.downloadUrl ? ([["Hızlı Destek programı (Windows)", i.downloadUrl]] as [string, string][]) : []),
  ...(i.webFormUrl ? ([["Destek talebi formu", i.webFormUrl]] as [string, string][]) : []),
];
const CUSTOMER_WARN = "Bu bağlantılar firmanıza özeldir, paylaşmayın.";
/** P31 (mimari-p31 §15.3, S-P31-2; AC-520): kaynağa çapa. Köken sunucu ayarından gelir (firma adı süzgecinden geçmez). */
const sourceLine = (origin: string): string => `Bağlantı her zaman ${origin}/ ile başlar; dosya eki göndermeyiz.`;

function customerShort(i: CustomerTemplateInput): string {
  return [
    `${F(i.firm)} destek bağlantılarınız:`,
    ...customerLinks(i).map(([l, u]) => `${l}: ${u}`),
    CUSTOMER_WARN,
    sourceLine(i.origin),
  ].join("\n");
}

function customerMail(i: CustomerTemplateInput): Rendered {
  const firm = F(i.firm);
  return {
    subject: oneLine(`${firm} – destek bağlantılarınız`),
    text: customerShort(i),
    bodyHtml: `<p>${esc(firm)} destek bağlantılarınız:</p><ul>${customerLinks(i)
      .map(([l, u]) => `<li>${esc(l)}: <a href="${esc(u)}">${esc(u)}</a></li>`)
      .join("")}</ul><p>${esc(CUSTOMER_WARN)}</p><p>${esc(sourceLine(i.origin))}</p>`,
  };
}

/** AC-407: tek giriş noktası — önizleme ve gönderim yalnız bunu çağırır. */
export function renderFor(channel: CustomerSendChannel, input: TemplateInput): Rendered {
  const email = channel === "EMAIL";
  switch (input.kind) {
    case "SESSION":
      if (email) return sessionMail(input);
      return short(channel === "SMS" ? sessionSms(input) : sessionShort(input));
    case "UNATTENDED_CODE":
      return email ? unattendedMail(input) : short(unattendedShort(input));
    case "CUSTOMER":
      return email ? customerMail(input) : short(customerShort(input));
  }
}

export const previewOf = (r: Rendered): MessagePreview => ({ subject: r.subject, text: r.text });
export const mailOf = (r: Rendered): MailContent => asMail(r);
