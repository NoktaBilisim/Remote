// E-posta şablonları (P10). Metin + basit HTML; tüm değişken içerik HTML-kaçışlı. Konu tek satır (CR/LF yok).
// P12 (AC-81): şablon yalnız gövde HTML'ini üretir; logo (firma → sistem → Nokta, mutlak public URL) gönderimde
// `MailService` tarafından `renderMailHtml` ile eklenir — tenant'ı bilen tek yer orası.
import { mailOf, renderFor } from "../notify/customer-templates.ts";

export interface MailContent {
  subject: string;
  text: string;
  bodyHtml: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string): string =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
const base = (u: string): string => u.replace(/\/+$/, "");

/** Tam HTML: mutlak logo adresi + gövde. */
export function renderMailHtml(logoUrl: string, bodyHtml: string): string {
  return `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#1f2933"><p><img src="${esc(logoUrl)}" alt="Logo" height="40"></p>${bodyHtml}</body></html>`;
}

const istanbul = (d: Date): string =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

/**
 * AC-10 (P10) → LG (§5.1): K1 e-postası `notify/customer-templates.ts` `renderFor("EMAIL", SESSION)`'dan gelir (kopya yok).
 * `agent` verilmezse indirme satırı yoktur.
 */
export function sessionLinkMail(o: {
  firm: string;
  technician: string;
  link: string;
  code: string;
  expiresAt: Date;
  agent?: { url: string; sha256: string } | null;
}): MailContent {
  return mailOf(renderFor("EMAIL", { kind: "SESSION", ...o, agent: o.agent ?? null }));
}

/** AC-66: sıfırlama bağlantısı (30 dk, tek kullanım). */
export function passwordResetMail(o: { link: string; ttlMin: number }): MailContent {
  const subject = "Şifre sıfırlama isteği";
  const text = `Hesabınız için şifre sıfırlama istendi.\n\nBağlantı (${o.ttlMin} dk geçerli, tek kullanımlık): ${o.link}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.`;
  const bodyHtml = `<p>Hesabınız için şifre sıfırlama istendi.</p><p><a href="${esc(o.link)}">Şifremi sıfırla</a> (${o.ttlMin} dk geçerli, tek kullanımlık)</p><p>Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.</p>`;
  return { subject, text, bodyHtml };
}

/** AC-65: hesap geneli kilit bildirimi. */
export function accountLockedMail(o: { minutes: number }): MailContent {
  const subject = "Hesabınız geçici olarak kilitlendi";
  const text = `Hesabınıza çok sayıda hatalı giriş denemesi yapıldı; hesap ${o.minutes} dakika kilitlendi.\n\nDenemeler size ait değilse şifrenizi değiştirin ve yöneticinize bildirin.`;
  const bodyHtml = `<p>Hesabınıza çok sayıda hatalı giriş denemesi yapıldı; hesap <b>${o.minutes} dakika</b> kilitlendi.</p><p>Denemeler size ait değilse şifrenizi değiştirin ve yöneticinize bildirin.</p>`;
  return { subject, text, bodyHtml };
}

/** B-P10-6: 2FA etkinleştirme bildirimi (hesabı şifreyle ele geçiren kendi TOTP'sini bağlarsa gerçek sahip haberdar olur). */
export function mfaEnabledMail(): MailContent {
  const subject = "İki adımlı doğrulama etkinleştirildi";
  const text =
    "Hesabınızda iki adımlı doğrulama etkinleştirildi ve diğer oturumlarınız kapatıldı.\n\nBu işlemi siz yapmadıysanız hemen yöneticinize başvurun; yönetici iki adımlı doğrulamayı sıfırlayabilir.";
  const bodyHtml =
    "<p>Hesabınızda <b>iki adımlı doğrulama etkinleştirildi</b> ve diğer oturumlarınız kapatıldı.</p><p>Bu işlemi siz yapmadıysanız hemen yöneticinize başvurun; yönetici iki adımlı doğrulamayı sıfırlayabilir.</p>";
  return { subject, text, bodyHtml };
}

/**
 * P14a (AC-215, ADR-0022 telafi kontrolü): step-up'ta kurtarma kodu kullanıldı. Kod içermez; kalan sayı ≤ 3 ise yenileme
 * önerisi (AC-231 yolu).
 */
export function recoveryCodeUsedMail(o: { remaining: number }): MailContent {
  const subject = "Kurtarma kodunuz kullanıldı";
  const low = o.remaining <= 3 ? " Kurtarma kodlarınız azaldı; hesap sayfanızdan yenileyin." : "";
  const text = `Hesabınızda bir hassas işlemi onaylamak için kurtarma kodu kullanıldı. Kalan kurtarma kodu: ${o.remaining}.${low}\n\nBu işlemi siz yapmadıysanız hemen şifrenizi değiştirin ve yöneticinize başvurun.`;
  const bodyHtml = `<p>Hesabınızda bir hassas işlemi onaylamak için <b>kurtarma kodu kullanıldı</b>. Kalan kurtarma kodu: <b>${o.remaining}</b>.${esc(low)}</p><p>Bu işlemi siz yapmadıysanız hemen şifrenizi değiştirin ve yöneticinize başvurun.</p>`;
  return { subject, text, bodyHtml };
}

/**
 * P27a (AC-335a, K-P27a-10): "Bu cihazı 30 gün hatırla" ile yeni cihaz hatırlandı. Belirteç ve bağlantı içermez; UA özeti
 * kullanıcı girdisinden türediği için kaçışlı ve tek satır.
 */
export function trustedDeviceCreatedMail(o: { uaSummary: string; ip: string; at: Date }): MailContent {
  const device = oneLine(o.uaSummary);
  const ip = oneLine(o.ip);
  const when = istanbul(o.at);
  const subject = "Yeni cihaz hatırlandı";
  const advice = "Siz değilseniz Hesabım → Hatırlanan cihazlar → Tümünü kaldır ve şifrenizi değiştirin.";
  const text = `Hesabınızda yeni bir cihaz 30 gün boyunca hatırlanacak şekilde kaydedildi.\n\nCihaz: ${device}\nIP: ${ip}\nZaman: ${when} (Türkiye saati)\n\n${advice}`;
  const bodyHtml = `<p>Hesabınızda <b>yeni bir cihaz</b> 30 gün boyunca hatırlanacak şekilde kaydedildi.</p><p>Cihaz: ${esc(device)}<br>IP: ${esc(ip)}<br>Zaman: ${esc(when)} (Türkiye saati)</p><p>${esc(advice)}</p>`;
  return { subject, text, bodyHtml };
}

/** P27a (AC-335b, K-P27a-11): hatırlanan cihaz belirtecinin yeniden kullanımı tespit edildi. Belirteç/bağlantı yok. */
export function trustedDeviceReuseMail(o: { at: Date }): MailContent {
  const when = istanbul(o.at);
  const subject = "Hatırlanan cihaz belirteci yeniden kullanıldı";
  const text = `Hatırlanan bir cihazın belirteci başka bir yerde kullanıldı (${when}, Türkiye saati); güvenliğiniz için tüm hatırlanan cihazlarınız kaldırıldı ve açık oturumlarınız kapatıldı.\n\nSiz değilseniz şifrenizi değiştirin.`;
  const bodyHtml = `<p>Hatırlanan bir cihazın belirteci <b>başka bir yerde kullanıldı</b> (${esc(when)}, Türkiye saati); güvenliğiniz için tüm hatırlanan cihazlarınız kaldırıldı ve açık oturumlarınız kapatıldı.</p><p>Siz değilseniz şifrenizi değiştirin.</p>`;
  return { subject, text, bodyHtml };
}

export function smtpTestMail(o: { firm: string }): MailContent {
  const subject = oneLine(`${o.firm} – SMTP test e-postası`);
  const text = "Bu bir test e-postasıdır. SMTP ayarlarınız çalışıyor.";
  return { subject, text, bodyHtml: `<p>${esc(text)}</p>` };
}

/** AC-151: WhatsApp şablonuyla aynı içerik (kişisel veri yok, mimari-e9 §13.5). */
export function newRequestMail(o: { publicBaseUrl: string; firm: string; requestCode: string }): MailContent {
  const panel = `${base(o.publicBaseUrl)}/requests`;
  const firm = oneLine(o.firm).slice(0, 60);
  const subject = oneLine(`Yeni destek talebi – ${firm}`);
  const text = `Yeni destek talebi – ${firm} – panelde görüntüleyin. Talep kodu: ${o.requestCode}\n${panel}`;
  return {
    subject,
    text,
    bodyHtml: `<p>Yeni destek talebi – ${esc(firm)} – panelde görüntüleyin. Talep kodu: <b>${esc(o.requestCode)}</b></p><p><a href="${esc(panel)}">${esc(panel)}</a></p>`,
  };
}
