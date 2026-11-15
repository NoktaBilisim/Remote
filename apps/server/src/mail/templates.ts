// E-posta şablonları (P10). Metin + basit HTML; tüm değişken içerik HTML-kaçışlı. Konu tek satır (CR/LF yok).
// P12 (AC-81): şablon yalnız gövde HTML'ini üretir; logo (firma → sistem → Nokta, mutlak public URL) gönderimde
// `MailService` tarafından `renderMailHtml` ile eklenir — tenant'ı bilen tek yer orası.
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

/** AC-10: logo, teknisyen adı, link, kısa kod, son geçerlilik (Europe/Istanbul). */
export function sessionLinkMail(o: { firm: string; technician: string; link: string; code: string; expiresAt: Date }): MailContent {
  const code = `${o.code.slice(0, 4)} ${o.code.slice(4)}`;
  const until = istanbul(o.expiresAt);
  const subject = oneLine(`${o.firm} – uzak destek bağlantınız`);
  const text = `Merhaba,\n\n${o.technician} (${o.firm}) sizinle uzak destek oturumu başlatmak istiyor.\n\nBağlantı: ${o.link}\nKod: ${code}\nSon geçerlilik: ${until} (Türkiye saati)\n\nBu isteği siz beklemiyorsanız bağlantıyı açmayın.`;
  const bodyHtml = `<p>Merhaba,</p><p><b>${esc(o.technician)}</b> (${esc(o.firm)}) sizinle uzak destek oturumu başlatmak istiyor.</p><p><a href="${esc(o.link)}">Oturuma katıl</a></p><p>Kod: <b>${esc(code)}</b><br>Son geçerlilik: ${esc(until)} (Türkiye saati)</p><p>Bu isteği siz beklemiyorsanız bağlantıyı açmayın.</p>`;
  return { subject, text, bodyHtml };
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
