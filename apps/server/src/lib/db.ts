// Prisma istemcisi (Prisma 7 + MySQL sürücü bağdaştırıcısı; dba sapma notu (5)).
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.ts";

export type Db = PrismaClient;

/**
 * Etkileşimli TX varsayılanları (QA-P8b-1). Prisma'nın 2 sn `maxWait`'i, havuz (10 bağlantı) bir satır kilidinde
 * (ör. talep oluşturmada `tenant_request_settings … FOR UPDATE`) sıraya girince yük altında aşılıyor → P2028 → 500.
 * `maxWait` havuzun bağlantı alma süresinin (`acquireTimeout` 20 sn) altında kalır; yine de aşılırsa
 * hata `isTransientDbError` ile 503 `NOT_READY` + `Retry-After`'a çevrilir (errors.ts).
 */
export const TX_OPTIONS = { maxWait: 8_000, timeout: 15_000 } as const;

/**
 * Talep oluşturma TX'i (G-E9-10: ilk ifade ayar satırı kilidi). S8b-5: TX'e girmeden önce süreç içi kapıdan geçer
 * (`requests/service.ts` `REQUEST_GATE`: tenant başına 2, toplam 4 eşzamanlı) → havuzun en çok 4 bağlantısını tutar,
 * kilit kuyruğu kısa kalır. Bu yüzden genel TX'lerden ayrı ve kısa: bağlantı 3 sn'de alınamazsa veya TX 10 sn'yi
 * aşarsa geri alınır → 503 NOT_READY + Retry-After (errors.ts).
 */
export const REQUEST_TX_OPTIONS = { maxWait: 3_000, timeout: 10_000 } as const;

/** Havuzdan bağlantı alma üst sınırı (mariadb varsayılanı 10 sn); URL'de verilmişse ona uyulur. */
const ACQUIRE_TIMEOUT_MS = 20_000;

function withPoolDefaults(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("acquireTimeout")) url.searchParams.set("acquireTimeout", String(ACQUIRE_TIMEOUT_MS));
  return url.toString();
}

export const createDb = (databaseUrl: string): Db =>
  new PrismaClient({ adapter: new PrismaMariaDb(withPoolDefaults(databaseUrl)), transactionOptions: TX_OPTIONS });

/** Geçici DB çekişmesi: TX başlatılamadı/zaman aşımı (P2028), deadlock (P2034 / 1213), kilit bekleme (1205), havuz zaman aşımı (45028). */
const TRANSIENT_PRISMA = new Set(["P2028", "P2034"]);
const TRANSIENT_MYSQL = new Set([1205, 1213, 45028]);

export function isTransientDbError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; code?: unknown; meta?: { driverAdapterError?: { cause?: { code?: unknown } } } };
  if (typeof e.name !== "string" || !e.name.startsWith("PrismaClient")) return false;
  if (typeof e.code === "string" && TRANSIENT_PRISMA.has(e.code)) return true;
  const mysqlCode = e.meta?.driverAdapterError?.cause?.code;
  return typeof mysqlCode === "number" && TRANSIENT_MYSQL.has(mysqlCode);
}

/**
 * Tekil kısıt ihlalinde (P2002) ihlal edilen indeks adı (ör. `PRIMARY`, `customers_request_ref_key`); değilse null.
 * Prisma 7 sürücü bağdaştırıcısı adı `meta.driverAdapterError.cause.constraint.index`'te taşır.
 */
export function conflictIndex(err: unknown): string | null {
  const e = err as { code?: unknown; meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } } | null;
  if (typeof e !== "object" || e === null || e.code !== "P2002") return null;
  const idx = e.meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof idx === "string" ? idx : "";
}
