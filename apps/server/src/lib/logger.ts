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
  // sessionRef (P6 indirme ucu dosya adına kodu yazar → ref kodla eşdeğer gizli; G-10)
  "*.ref",
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
