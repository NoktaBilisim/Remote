// LG-3 sahte API (mimari-link-gonderme §4): POST /customer-send/options ve POST /customer-send.
// Sunucu gibi: metni TEK fonksiyon (`render`) üretir; önizleme ve "gönderilen" metin (sahte SMTP/WA yakalayıcısı,
// /__e2e/lg-outbox/<çerez>) aynı kaynaktan gelir (AC-407/427). Alıcı tetikleyicileri: "429" → 429 (Retry-After 2),
// "502" → 502 (ham sağlayıcı metniyle; arayüz göstermemeli), "409" → 409 CHANNEL_UNAVAILABLE.
import { customerSendInputSchema, customerSendOptionsInputSchema } from "@remote/contracts/api/customer-send";

const outbox = new Map();
const sentCount = new Map();

export const lgOutbox = (cookie) => outbox.get(cookie) ?? null;

const BASE = "http://localhost:3217";

function render(target, channel) {
  if (target.kind === "SESSION") {
    const text = `Demo Firma uzak destek: Ayşe T. sizinle oturum başlatmak istiyor.\nBağlantı: ${target.link}\nWindows programı: ${BASE}/api/v1/public/agent/download?ref=e2eref\nKod: 1234 5678 · Son geçerlilik: 15.11.2026 18:00 (TR)\nBeklemiyorsanız bağlantıyı açmayın, kimseyle paylaşmayın.`;
    return { subject: channel === "EMAIL" ? "Demo Firma – uzak destek bağlantınız" : null, text };
  }
  if (target.kind === "UNATTENDED_CODE") {
    const text = `Merhaba,\n\nDemo Firma, bilgisayarınıza uzaktan destek servisinin kurulması için bir kayıt kodu oluşturdu.\n\n1. Kurulum dosyasını indirin: ${BASE}/api/v1/public/unattended/download?t=${"x".repeat(43)}\n2. Dosyayı çalıştırın ve yönetici izni isteğini onaylayın.\n3. Kayıt kodu istendiğinde şunu girin: ${target.code}\n4. Kurulum tamamlanınca Demo Firma ile iletişime geçin.\n\nBu kurulumu siz istemediyseniz destek firmanızı arayın.`;
    return { subject: "Demo Firma – uzaktan destek servisi kurulumu", text };
  }
  const text = `Demo Firma destek bağlantılarınız:\nHızlı Destek programı (Windows): ${BASE}/api/v1/public/agent/request-download?ref=sisliref2345abcd\nBu bağlantılar firmanıza özeldir, paylaşmayın.`;
  return { subject: channel === "EMAIL" ? "Demo Firma – destek bağlantılarınız" : null, text };
}

/** O-LG-3 (mimari r2): kayıt kodu yalnız e-posta. */
const CHANNELS = { SESSION: ["EMAIL", "WHATSAPP", "SMS"], UNATTENDED_CODE: ["EMAIL"], CUSTOMER: ["EMAIL", "WHATSAPP"] };

function options(cookie, target) {
  const chs = CHANNELS[target.kind];
  const locked = target.kind === "UNATTENDED_CODE";
  const key = `${cookie}|${target.codeId ?? ""}`;
  return {
    kind: target.kind,
    channels: chs.map((channel) => ({ channel, available: true, block: null, settingsHref: null })),
    recipients: locked
      ? { email: [{ value: "it@acme.com.tr", source: "contact" }], phone: [] }
      : target.kind === "CUSTOMER"
        ? { email: [], phone: [{ value: "+905321112233", source: "customer" }] }
        : { email: [], phone: [] },
    recipientsLocked: locked,
    previews: Object.fromEntries(chs.map((c) => [c, render(target, c)])),
    remainingSends: locked ? 3 - (sentCount.get(key) ?? 0) : null,
  };
}

export async function handleLg(req, res, { url, session, csrfOk, send, err, readJson }) {
  const path = url.split("?")[0];
  if (req.method !== "POST" || (path !== "/api/v1/customer-send/options" && path !== "/api/v1/customer-send")) return false;
  if (!session) return (send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true);
  if (!csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const body = await readJson(req);
  if (path.endsWith("/options")) {
    const p = customerSendOptionsInputSchema.safeParse(body);
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
    return (send(res, 200, options(session, p.data.target)), true);
  }
  const p = customerSendInputSchema.safeParse(body);
  if (!p.success) {
    const fields = Object.fromEntries(p.error.issues.map((i) => [String(i.path[0] ?? "_"), i.message]));
    return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields })), true);
  }
  const { target, channel, to } = p.data;
  if (to.includes("429")) return (send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "2" }), true);
  if (to.includes("502")) return (send(res, 502, err("UPSTREAM", "smtp 550 relay denied by provider")), true);
  if (to.includes("409")) return (send(res, 409, err("CHANNEL_UNAVAILABLE", "kanal yok")), true);
  if (target.kind === "UNATTENDED_CODE") {
    if (to !== "it@acme.com.tr")
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { to: "Alıcı listede yok." } })), true);
    const key = `${session}|${target.codeId}`;
    const n = sentCount.get(key) ?? 0;
    if (n >= 3) return (send(res, 429, err("RATE_LIMITED", "Gönderim hakkı doldu."), [], { "Retry-After": "60" }), true);
    sentCount.set(key, n + 1);
  }
  outbox.set(session, { channel, to, ...render(target, channel) });
  return (send(res, 200, { sent: true }), true);
}
