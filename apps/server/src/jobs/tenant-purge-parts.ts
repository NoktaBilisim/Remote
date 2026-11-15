// Firma silme veri adımlarının tablo parçaları (jobs/tenant-purge-repo.ts `DATA_STEPS`): her parça aynı koşulla sayım
// (önizleme) ve parti (yürütücü). Parti `LIMIT 500`; tablo adları sabit, firma kimliği her zaman bağlı parametre.
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type Tx = Prisma.TransactionClient;
type DbOrTx = Db | Tx;

const PURGE_BATCH = 500;

export const USERS_OF = (t: string) => Prisma.sql`SELECT u.id FROM users u WHERE u.tenant_id = ${t}`;

/** Tek tablo için sayım + parti (tablo adı sabit). `extra` ek WHERE koşulu (sabit SQL). */
export interface TablePart {
  table: string;
  count(db: DbOrTx, t: string): Promise<number>;
  batch(tx: Tx, t: string): Promise<number>;
}

export const n = (rows: { c: bigint | number }[]): number => Number(rows[0]?.c ?? 0);

export function byTenant(table: string): TablePart {
  const tbl = Prisma.raw(`\`${table}\``);
  return {
    table,
    count: async (db, t) => n(await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM ${tbl} WHERE tenant_id = ${t}`),
    batch: (tx, t) => tx.$executeRaw`DELETE FROM ${tbl} WHERE tenant_id = ${t} LIMIT ${PURGE_BATCH}`,
  };
}

/**
 * P16 düzeltme 2 (QA AC-206/AC-202 503): parti DELETE'i alt sorgu taşımaz. Tek tablolu `DELETE … WHERE user_id IN (SELECT …)
 * LIMIT` semi-join'e çevrilemez (EXPLAIN: hedefte `ALL` + `DEPENDENT SUBQUERY`) → REPEATABLE READ'de tablonun TAMAMINA
 * next-key X ve `users` satırlarına S kilidi; silme sürerken bütün firmalarda giriş/yetki yazımı bekler ya da 1213 alır.
 * Önce firmanın kullanıcı kimlikleri kilitsiz okunur (FENCE sonrası firmaya kullanıcı eklenmez; kalan satırı sonraki parti
 * ve USERS adımındaki FK RESTRICT yakalar), DELETE sabit listeyle `user_id` dizininde aralık okur (EXPLAIN: `range`).
 */
export function byTenantUser(table: string): TablePart {
  const tbl = Prisma.raw(`\`${table}\``);
  return {
    table,
    count: async (db, t) => n(await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM ${tbl} WHERE user_id IN (${USERS_OF(t)})`),
    batch: async (tx, t) => {
      const ids = (await tx.$queryRaw<{ id: string }[]>(USERS_OF(t))).map((r) => r.id);
      if (ids.length === 0) return 0;
      return tx.$executeRaw`DELETE FROM ${tbl} WHERE user_id IN (${Prisma.join(ids)}) LIMIT ${PURGE_BATCH}`;
    },
  };
}

export const unlinkBindings: TablePart = {
  table: "support_requests",
  count: async (db, t) =>
    n(await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM support_requests WHERE tenant_id = ${t} AND binding_id IS NOT NULL`),
  batch: (tx, t) =>
    tx.$executeRaw`UPDATE support_requests SET binding_id = NULL WHERE tenant_id = ${t} AND binding_id IS NOT NULL LIMIT ${PURGE_BATCH}`,
};
