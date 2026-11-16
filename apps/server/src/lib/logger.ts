// pino JSON log (mimari §8.2, AC-90). Gövde loglanmaz; başlıklardan yalnız redakte edilmiş olanlar.
// URL'de sorgu dizesi hiç yazılmaz, /session/<token> → /session/*** (T2).
import { pino, type DestinationStream, type Logger } from "pino";

export function maskUrl(url: string): string {
  const path = url.split("?")[0] ?? "";
  return path.replace(/\/session\/[^/]+/g, "/session/***");
}

const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-csrf-token']",
  "req.headers['sec-websocket-protocol']",
  "res.headers['set-cookie']",
  "*.password",
  "*.current",
  "*.next",
  "*.token",
  "*.nonce",
  "*.ticket",
  "*.secret",
  // S-P13b-3: WhatsApp servis anahtarı (savunma; değer zaten loglanmaz).
  "*.apiKey",
  // sessionRef (P6 indirme ucu dosya adına kodu yazar → ref kodla eşdeğer gizli; G-10)
  "*.ref",
  // P8b (G-E9-9): talep sırrı, kabulde iletilen ticket ve cihaz anahtarı (yollar tam anahtar adıyla eşleşir).
  "*.requestSecret",
  "*.wsTicket",
  "*.deviceKey",
  // P19 (§8c.2 m.8): web formu token'ı ve gizli alan.
  "*.formToken",
  "*.website",
  // P8c (mimari-e10 §5.6, §15.6): kayıt anahtarı + müşteri kişisel alanları (savunma; gövdeler zaten loglanmaz).
  "*.bindingKey",
  "*.previousKey",
  // P20 (§8d.2): çoklu firma kaydı anahtar listesi.
  "*.previousKeys",
  "*.contactName",
  "*.phone",
  "*.email",
  "*.note",
  // P18 H3 (S-P18-T9): talep mesajı gövdesi — hiçbir derinlikte loglanmaz (savunma; servis gövdeli nesne loglamaz).
  // LG (§8, AC-425): müşteri gönderim gövdesi alıcı, kayıt kodu ve oturum bağlantısı (savunma; gövde zaten loglanmaz).
  "body.to",
  "body.target.code",
  "body.target.link",
  "*.target.code",
  "*.target.link",
  "body",
  "*.body",
  "*.*.body",
  // P28e (S-P28e-6): kayıt yükleme belirteci `rec.state.upload.token` / `hello.rec.upload.token` (savunma; WS gövdesi zaten loglanmaz).
  "*.upload.token",
  "*.*.upload.token",
];

interface LoggableRequest {
  method: string;
  url: string;
}
interface LoggableReply {
  statusCode: number;
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: "***" },
      serializers: {
        req: (req: LoggableRequest) => ({ method: req.method, url: maskUrl(req.url) }),
        res: (res: LoggableReply) => ({ statusCode: res.statusCode }),
      },
    },
    destination,
  );
}
