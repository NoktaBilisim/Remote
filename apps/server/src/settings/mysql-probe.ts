// MySQL bağlantı testi (P11; AC-77). Sürücü: Prisma adaptörünün zaten getirdiği `mariadb` paketi (yeni bağımlılık yok —
// mimarideki mysql2 yerine; sapma notu implementation.md "P11 — Backend"). pnpm katı yapısında doğrudan çözülemediği
// için `@prisma/adapter-mariadb`'nin kendi bağımlılığından çözülür. 10 sn KESİN zaman aşımı (sürücü süreleri + yarış).
// Hata sınıflandırılır; ham hata yalnız çağıranın loguna gider.
// P14a (AC-211): hedef ad bir kez çözülür (netguard `classifyHost`) ve o IP'ye bağlanılır. `requireTls` → TLS zorunlu +
// sertifika ayar adına göre doğrulanır; kurulamazsa sınıf `tls`. TLS yokken `allowPublicKeyRetrieval` (caching_sha2 açık
// anahtar akışı — karşı taraf sahte anahtarla düz şifreyi alabilir) yalnız loopback / özel ağ / tek etiketli (compose
// servis) adda açılır.
import { createRequire } from "node:module";
import { checkServerIdentity } from "node:tls";
import { isIP } from "node:net";
import { MYSQL_TEST_TIMEOUT_MS, type MysqlTestReason } from "@remote/contracts/api/system-settings";
import { classifyHost } from "../lib/netguard.ts";

export interface TextConnection {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  destroy(): void;
}
export interface MariadbDriver {
  createConnection(o: Record<string, unknown>): Promise<TextConnection>;
}

let driver: MariadbDriver | undefined;
/** `mariadb` sürücüsü (metin protokolü; testler de CREATE/DROP TRIGGER yetki denemesi için kullanır). */
export function mariadbDriver(): MariadbDriver {
  if (!driver) {
    const req = createRequire(import.meta.url);
    driver = createRequire(req.resolve("@prisma/adapter-mariadb"))("mariadb") as MariadbDriver;
  }
  return driver;
}

export interface ProbeTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  requireTls: boolean;
}

export type ProbeResult = { ok: true; latencyMs: number } | { ok: false; reason: MysqlTestReason; latencyMs: number; err: unknown };

const TIMEOUT = Symbol("timeout");

/**
 * mariadb hata → sınıf. 1045/1698/eklenti → auth; 1044/1049 → database; TLS (sunucu TLS'siz 45023, sertifika/el sıkışma
 * hataları, sunucu "güvenli taşıma gerekli" 3159) → tls; sürücü zaman aşımı → timeout; diğer → connect.
 */
export function classifyMysqlError(err: unknown): MysqlTestReason {
  const e = (typeof err === "object" && err !== null ? err : {}) as { errno?: unknown; code?: unknown; message?: unknown };
  const errno = typeof e.errno === "number" ? e.errno : 0;
  const code = typeof e.code === "string" ? e.code : "";
  const msg = typeof e.message === "string" ? e.message : "";
  if (
    errno === 45023 ||
    errno === 3159 ||
    /^ER_SELF_SIGNED|^ER_SERVER_SSL|CERT|SSL|TLS/i.test(code) ||
    /certificate|self[- ]signed|altnames|ssl not enabled/i.test(msg)
  )
    return "tls";
  if (
    errno === 1045 ||
    errno === 1698 ||
    errno === 1251 ||
    code === "ER_AUTHENTICATION_PLUGIN_NOT_SUPPORTED" ||
    code === "ER_ACCESS_DENIED_ERROR"
  )
    return "auth";
  if (errno === 1044 || errno === 1049 || code === "ER_BAD_DB_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") return "database";
  if (errno === 45012 || errno === 45026 || code === "ER_CONNECTION_TIMEOUT" || code === "ER_SOCKET_TIMEOUT" || code === "ETIMEDOUT")
    return "timeout";
  return "connect";
}

/** Sürücü bağlantı seçenekleri (çözümlenmiş IP + TLS + açık anahtar kuralı); birim testleri doğrudan sınar. */
export async function connectionOptions(
  t: ProbeTarget,
  timeoutMs: number,
  lookupAll?: (host: string) => Promise<string[]>,
): Promise<Record<string, unknown>> {
  const name = t.host.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  const { cls, ip } = await classifyHost(name, lookupAll);
  if (!ip) throw Object.assign(new Error("host unresolved"), { code: "ENOTFOUND" });
  // S14-3: karar çözülen adreslere göre; tek etiketli ad (compose servisi) da genel IP'ye çözülürse ayrıcalık yok.
  const localish = cls !== "public";
  return {
    host: ip,
    port: t.port,
    user: t.user,
    password: t.password,
    database: t.database,
    connectTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    // TLS'li bağlantıda şifre zaten şifreli kanalda gider; açık anahtar isteğine gerek yok (en az ayrıcalık).
    allowPublicKeyRetrieval: !t.requireTls && localish,
    ...(t.requireTls
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(isIP(name) ? {} : { servername: name }),
            // IP'ye bağlanılır; kimlik ayar adına (ya da IP literaline) göre doğrulanır.
            checkServerIdentity: (_h: string, cert: Parameters<typeof checkServerIdentity>[1]) => checkServerIdentity(name, cert),
          },
        }
      : {}),
  };
}

export async function probeMysql(
  t: ProbeTarget,
  timeoutMs = MYSQL_TEST_TIMEOUT_MS,
  drv: MariadbDriver = mariadbDriver(),
  lookupAll?: (host: string) => Promise<string[]>,
): Promise<ProbeResult> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const pending = connectionOptions(t, timeoutMs, lookupAll).then((o) => drv.createConnection(o));
  const work = (async () => {
    const conn = await pending;
    try {
      await conn.query("SELECT 1");
    } finally {
      await conn.end().catch(() => conn.destroy());
    }
  })();
  try {
    const out = await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => (timer = setTimeout(() => resolve(TIMEOUT), timeoutMs))),
    ]);
    const latencyMs = Date.now() - started;
    if (out === TIMEOUT) {
      // Geç gelen bağlantı sızmasın: kurulursa hemen kapatılır.
      pending.then(
        (c) => c.destroy(),
        () => undefined,
      );
      work.catch(() => undefined);
      return { ok: false, reason: "timeout", latencyMs, err: new Error("probe timeout") };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, reason: classifyMysqlError(err), latencyMs: Date.now() - started, err };
  } finally {
    clearTimeout(timer);
  }
}
