// E-posta şablonları (P10). Metin + basit HTML; tüm değişken içerik HTML-kaçışlı. Konu tek satır (CR/LF yok).
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
const base = (u: string): string => u.replace(/\/+$/, "");

function wrap(publicBaseUrl: string, bodyHtml: string): string {
  const logo = `${base(publicBaseUrl)}/img/logo.png`;
  return `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#1f2933"><p><img src="${esc(logo)}" alt="Logo" height="40"></p>${bodyHtml}</body></html>`;
}

const istanbul = (d: Date): string =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/** AC-10: logo, teknisyen adı, link, kısa kod, son geçerlilik (Europe/Istanbul). */
export function sessionLinkMail(o: { publicBaseUrl: string; firm: string; technician: string; link: string; code: string; expiresAt: Date }): MailContent {
  const code = `${o.code.slice(0, 4)} ${o.code.slice(4)}`;
  const until = istanbul(o.expiresAt);
  const subject = oneLine(`${o.firm} – uzak destek bağlantınız`);
  const text = `Merhaba,\n\n${o.technician} (${o.firm}) sizinle uzak destek oturumu başlatmak istiyor.\n\nBağlantı: ${o.link}\nKod: ${code}\nSon geçerlilik: ${until} (Türkiye saati)\n\nBu isteği siz beklemiyorsanız bağlantıyı açmayın.`;
  const html = wrap(o.publicBaseUrl, `<p>Merhaba,</p><p><b>${esc(o.technician)}</b> (${esc(o.firm)}) sizinle uzak destek oturumu başlatmak istiyor.</p><p><a href="${esc(o.link)}">Oturuma katıl</a></p><p>Kod: <b>${esc(code)}</b><br>Son geçerlilik: ${esc(until)} (Türkiye saati)</p><p>Bu isteği siz beklemiyorsanız bağlantıyı açmayın.</p>`);
  return { subject, text, html };
}

/** AC-66: sıfırlama bağlantısı (30 dk, tek kullanım). */
export function passwordResetMail(o: { publicBaseUrl: string; link: string; ttlMin: number }): MailContent {
  const subject = "Şifre sıfırlama isteği";
  const text = `Hesabınız için şifre sıfırlama istendi.\n\nBağlantı (${o.ttlMin} dk geçerli, tek kullanımlık): ${o.link}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.`;
  const html = wrap(o.publicBaseUrl, `<p>Hesabınız için şifre sıfırlama istendi.</p><p><a href="${esc(o.link)}">Şifremi sıfırla</a> (${o.ttlMin} dk geçerli, tek kullanımlık)</p><p>Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.</p>`);
  return { subject, text, html };
}

/** AC-65: hesap geneli kilit bildirimi. */
export function accountLockedMail(o: { publicBaseUrl: string; minutes: number }): MailContent {
  const subject = "Hesabınız geçici olarak kilitlendi";
  const text = `Hesabınıza çok sayıda hatalı giriş denemesi yapıldı; hesap ${o.minutes} dakika kilitlendi.\n\nDenemeler size ait değilse şifrenizi değiştirin ve yöneticinize bildirin.`;
  const html = wrap(o.publicBaseUrl, `<p>Hesabınıza çok sayıda hatalı giriş denemesi yapıldı; hesap <b>${o.minutes} dakika</b> kilitlendi.</p><p>Denemeler size ait değilse şifrenizi değiştirin ve yöneticinize bildirin.</p>`);
  return { subject, text, html };
}

/** B-P10-6: 2FA etkinleştirme bildirimi (hesabı şifreyle ele geçiren kendi TOTP'sini bağlarsa gerçek sahip haberdar olur). */
export function mfaEnabledMail(o: { publicBaseUrl: string }): MailContent {
  const subject = "İki adımlı doğrulama etkinleştirildi";
  const text = "Hesabınızda iki adımlı doğrulama etkinleştirildi ve diğer oturumlarınız kapatıldı.\n\nBu işlemi siz yapmadıysanız hemen yöneticinize başvurun; yönetici iki adımlı doğrulamayı sıfırlayabilir.";
  const html = wrap(o.publicBaseUrl, "<p>Hesabınızda <b>iki adımlı doğrulama etkinleştirildi</b> ve diğer oturumlarınız kapatıldı.</p><p>Bu işlemi siz yapmadıysanız hemen yöneticinize başvurun; yönetici iki adımlı doğrulamayı sıfırlayabilir.</p>");
  return { subject, text, html };
}

export function smtpTestMail(o: { publicBaseUrl: string; firm: string }): MailContent {
  const subject = oneLine(`${o.firm} – SMTP test e-postası`);
  const text = "Bu bir test e-postasıdır. SMTP ayarlarınız çalışıyor.";
  return { subject, text, html: wrap(o.publicBaseUrl, `<p>${esc(text)}</p>`) };
}

/** AC-151: WhatsApp şablonuyla aynı içerik (kişisel veri yok, mimari-e9 §13.5). */
export function newRequestMail(o: { publicBaseUrl: string; firm: string; requestCode: string }): MailContent {
  const panel = `${base(o.publicBaseUrl)}/requests`;
  const firm = oneLine(o.firm).slice(0, 60);
  const subject = oneLine(`Yeni destek talebi – ${firm}`);
  const text = `Yeni destek talebi – ${firm} – panelde görüntüleyin. Talep kodu: ${o.requestCode}\n${panel}`;
  return { subject, text, html: wrap(o.publicBaseUrl, `<p>Yeni destek talebi – ${esc(firm)} – panelde görüntüleyin. Talep kodu: <b>${esc(o.requestCode)}</b></p><p><a href="${esc(panel)}">${esc(panel)}</a></p>`) };
}
