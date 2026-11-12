// Metin protokolüyle tek SQL ifadesi (P11, db-notlari "Test bulgusu"). CREATE/DROP TRIGGER ve RENAME TABLE prepared
// statement protokolünde 1295 ("not supported") döner; Prisma `$executeRawUnsafe` ile "reddedildi" görünür ama yetki
// sınanmamış olur (yanlış pozitif). Sürücü: Prisma adaptörünün `mariadb` bağımlılığı (src/settings/mysql-probe.ts).
import { mariadbDriver } from "../../src/settings/mysql-probe.ts";

/** Yetki reddi: 1142 tablo, 1227 global, 1044 DB, 1370 rutin, 1410 grant; mesaj "command denied"/"access denied". */
export const PRIVILEGE_DENIED = /command denied|access denied|1142|1227|1044|1370|1410/i;

export async function textQuery(databaseUrl: string | undefined, sql: string): Promise<unknown> {
  if (!databaseUrl) throw new Error("veritabanı URL'si tanımlı değil (scripts/test-db.sh up)");
  const u = new URL(databaseUrl);
  const conn = await mariadbDriver().createConnection({
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    allowPublicKeyRetrieval: true,
  });
  try {
    return await conn.query(sql);
  } finally {
    await conn.end();
  }
}

/** Reddedilmeli; hata metni + kod döner (1295 = protokol hatası → yetki sınanmadı, test başarısız sayılmalı). */
export async function rejectionText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error("ifade reddedilmeliydi");
  const e = err as Error & { errno?: unknown; meta?: unknown };
  return `${e.message} errno=${String(e.errno ?? "")} ${JSON.stringify(e.meta ?? {})}`;
}
