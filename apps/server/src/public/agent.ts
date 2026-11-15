// GET /public/agent/download?ref= servis katmanı (P6, mimari-api public tablosu — bağlayıcı, P3 giriş şartı 1; AC-27,
// ADR-0006). Dosya adı kodu taşıdığından süresiz sessionRef kodla eşdeğer bir gizlidir: yalnız PENDING + süresi
// dolmamış oturumda yanıt verilir; geçersiz ref ve 410 kod yolu kovalarına (ipKey 10/dk + prefixKey 30/dk, aşımda
// 15 dk 429) başarısız deneme sayılır; ayrıca tüm istekler ipKey 20/dk. ref ve kod loga/audit'e yazılmaz (G-10).
import type { AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey, prefixKey } from "../lib/ip.ts";
import { assertLookupAllowed, consume, countFailedLookup, GONE, type PublicLimits } from "../sessions/public.ts";
import { parseSessionRef, sessionRef } from "../sessions/codes.ts";
import * as repo from "../sessions/repo.ts";
import { expireSession } from "../sessions/service.ts";
import type { AgentBinary } from "./agent-binary.ts";

/** Caddy'nin tek jenerik ikiliyi `Content-Disposition: attachment` ile sunduğu sabit konum (deploy/Caddyfile). */
export const agentDownloadLocation = (code: string): string => `/downloads/Destek-${code}.exe`;

const UNAVAILABLE = "İndirme şu anda kullanılamıyor. Biraz sonra tekrar deneyin ya da tarayıcıdan paylaşımı kullanın.";

interface AgentDownloadDeps {
  db: Db;
  limits: PublicLimits;
  refKey: string;
  binary: AgentBinary;
}

/** Geçerliyse yönlendirme konumu; aksi halde tipli hata (404/410/429/503). `ref` null = biçimsiz/eksik. */
export async function agentDownload(deps: AgentDownloadDeps, ctx: AuditContext, ref: string | null): Promise<string> {
  const { db, limits } = deps;
  const ip = ipKey(ctx.ip);
  const prefix = prefixKey(ctx.ip);
  consume(limits.downloadIp, ip, 60);
  assertLookupAllowed(limits, ip, prefix);
  const fail = (code: "NOT_FOUND" | NonNullable<(typeof GONE)[string]>): AppError => {
    countFailedLookup(limits, ip, prefix); // eşik aşıldıysa 429 fırlatır
    return new AppError(code);
  };

  const id = ref ? parseSessionRef(deps.refKey, ref) : null;
  const row = id ? await repo.findForDownload(db, id) : null;
  if (!row) throw fail("NOT_FOUND");
  const now = new Date();
  if (row.status === "PENDING" && row.expiresAt <= now) {
    await expireSession(db, ctx, row, now); // iş gecikse bile aynı istekte EXPIRED (AC-5 ile aynı)
    throw fail("SESSION_EXPIRED");
  }
  const gone = GONE[row.status];
  if (gone) throw fail(gone);
  if (!row.activeCode) throw fail("NOT_FOUND"); // PENDING'de kod CHECK ile dolu; savunma
  await assertAgentReady(deps.binary);
  return agentDownloadLocation(row.activeCode);
}

/** Bütünlük kapısı (G-07, S6-2): ikili AGENT_SHA256 ile eşleşmiyorsa / yoksa / yapılandırılmamışsa 503 NOT_READY. */
export async function assertAgentReady(binary: AgentBinary): Promise<void> {
  if ((await binary.check()) !== "ok") throw new AppError("NOT_READY", { message: UNAVAILABLE });
}

/** LG (§5.1, AC-411/412): K1 mesajındaki doğrudan indirme bağlantısı — yalnız ikili kapısı `ok` iken (aksi null, satır düşer). */
export interface AgentLinkDeps {
  binary: AgentBinary;
  sha256: string | undefined;
  refKey: string;
  publicBaseUrl: string;
}
export async function agentLinkFor(d: AgentLinkDeps, sessionId: string): Promise<{ url: string; sha256: string } | null> {
  if (!d.sha256 || (await d.binary.check()) !== "ok") return null;
  const url = `${d.publicBaseUrl.replace(/\/+$/, "")}/api/v1/public/agent/download?ref=${sessionRef(d.refKey, sessionId)}`;
  return { url, sha256: d.sha256 };
}
