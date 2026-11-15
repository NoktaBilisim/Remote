// P16 G3 imha defteri CLI (ADR-0030 m.9, S16-5/S16-13; runbook §23.5). Geri yüklemeden SONRA, migrate imajında:
//   docker compose run --rm --no-deps -T migrate pnpm --filter @remote/server cli erasure:replay
//   docker compose run --rm --no-deps -T migrate pnpm --filter @remote/server cli erasure:verify
// DB `MIGRATE_DATABASE_URL` (migrator: P16 tetikleyicilerinden muaf — karar daha önce verildi). Defter salt okunur
// (`/var/lib/remote/erasure-ledger.jsonl`); bu araç deftere YAZMAZ.
// replay: defterdeki kullanıcılar mezar taşına çevrilir (alt tablolar silinir); satırı hâlâ duran firmalar PASSIVE ≥ 30 g
//   yapılır ve RUNNING iş FENCE'ten açılır (server'daki yürütücü siler). Audit `erasure.replayed` (yalnız sayılar).
// S16-16: deftere koşulsuz güvenilmez — defteri server süreci yazar (app ele geçirilirse satır eklenebilir). Satır yalnız
//   geri yüklenen DB ile tutarlıysa uygulanır: firma PASSIVE ve (`passive_at <= UTC − 16 g` ya da `tenant_purge_jobs`
//   satırı var); kullanıcı Super Admin değil ve firmaya bağlı. Tutarsız satır uygulanmaz, sayılır; çıkış 3 (restore.sh
//   server'ı başlatmaz; elle karar runbook §23.5). Meşru silmede bu koşullar her zaman sağlanır (30 g pasiflik, yedek ≤ 14 g).
// S16-20: firma koşulundaki iş satırı yalnız SCHEDULED/RUNNING/FAILED/DONE sayılır (CANCELLED iş silme izni değildir).
//   Kullanıcının yalnız `intent` satırı varsa (aynı id için `done`/fazsız satır yok → TX geri alınmış olabilir) ek koşul
//   `status = 'PASSIVE'` (mezar taşı yalnız PASSIVE'den yapılır; sonradan yeniden etkinleştirilmiş hesap → reddedilir).
// verify: defterdeki uygun kullanıcı yok/DELETED ve uygun firma satırı yok ise 0; değilse 1 (restore.sh yoklar).
//   Reddedilen (tutarsız) satırlar bekleyen sayılmaz, ayrı yazılır.
// Çıktıda kişisel veri yok (yalnız sayılar). Çıkış: 0 tamam · 1 doğrulama bekliyor · 2 kullanım · 3 tutarsız satır
// reddedildi (replay) · 5 DB/defter hatası.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deletedUserLabel, ERASURE_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import { cliAuditContext } from "../auth/superadmin-reset.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { createDb, type Db } from "../lib/db.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { ERASURE_LEDGER_PATH, readLedger, type LedgerContents } from "../ops/erasure-ledger.ts";

export const EXIT = { OK: 0, PENDING: 1, USAGE: 2, REJECTED: 3, ERROR: 5 } as const;

const unique = (xs: string[]): string[] => [...new Set(xs)];
const idsOf = (l: LedgerContents, type: "user" | "tenant"): string[] => unique(l.entries.filter((e) => e.type === type).map((e) => e.id));

/** S16-20: kullanıcı kimlikleri — `done` (ya da fazsız eski) satırı olanlar ve yalnız `intent` satırı olanlar. */
function userIdsOf(l: LedgerContents): { done: string[]; intentOnly: string[] } {
  const done = new Set(l.entries.filter((e) => e.type === "user" && e.phase !== "intent").map((e) => e.id));
  return { done: [...done], intentOnly: idsOf(l, "user").filter((id) => !done.has(id)) };
}

/** S16-16/S16-20: defter satırının geri yüklenen DB ile tutarlılık koşulları (takma ad `u` / `t`; NULL → 0, fail-closed). */
const USER_OK = Prisma.sql`(u.role <> 'SUPER_ADMIN' AND u.tenant_id IS NOT NULL)`;
const USER_INTENT_OK = Prisma.sql`(${USER_OK} AND u.status = 'PASSIVE')`;
const userOk = (intentOnly: boolean): Prisma.Sql => (intentOnly ? USER_INTENT_OK : USER_OK);
const TENANT_OK = Prisma.sql`COALESCE(t.status = 'PASSIVE' AND (t.passive_at <= UTC_TIMESTAMP(3) - INTERVAL 16 DAY
  OR EXISTS (SELECT 1 FROM tenant_purge_jobs j WHERE j.tenant_id = t.id AND j.state IN ('SCHEDULED', 'RUNNING', 'FAILED', 'DONE'))), 0)`;

type Outcome = "applied" | "noop" | "rejected";

/** Mezar taşı (ADR-0030 m.4 alanları; `users_deleted_chk` ile aynı) + alt tablolar. Zaten DELETED/yok → noop. */
async function replayUser(db: Db, id: string, intentOnly: boolean): Promise<Outcome> {
  return db.$transaction(async (tx) => {
    const cur = await tx.$queryRaw<{ ok: bigint | number }[]>`
      SELECT ${userOk(intentOnly)} AS ok FROM users u WHERE u.id = ${id} AND u.status <> 'DELETED' FOR UPDATE`;
    if (!cur[0]) return "noop";
    if (Number(cur[0].ok) !== 1) return "rejected";
    const n = await tx.$executeRaw`
      UPDATE users SET status = 'DELETED', deleted_at = UTC_TIMESTAMP(3), email = CONCAT('deleted+', id, '@invalid'),
        username = NULL, full_name = ${deletedUserLabel(id)}, password_hash = '!deleted', avatar_path = NULL,
        totp_secret_enc = NULL, totp_enabled = 0, totp_last_step = NULL, failed_login_count = 0, failed_window_at = NULL,
        locked_until = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3)
      WHERE id = ${id} AND status <> 'DELETED' AND role <> 'SUPER_ADMIN' AND tenant_id IS NOT NULL
        ${intentOnly ? Prisma.sql`AND status = 'PASSIVE'` : Prisma.empty}`;
    if (n === 0) return "noop";
    await tx.$executeRaw`DELETE FROM user_permissions WHERE user_id = ${id}`;
    await tx.$executeRaw`DELETE FROM recovery_codes WHERE user_id = ${id}`;
    await tx.$executeRaw`DELETE FROM password_reset_tokens WHERE user_id = ${id}`;
    await tx.$executeRaw`DELETE FROM auth_sessions WHERE user_id = ${id}`;
    return "applied";
  });
}

/** Satırı duran uygun firma → PASSIVE ≥ 30 g (gerekirse) + RUNNING iş FENCE'ten (açık iş varsa ona çevrilir). Satır yok → noop. */
async function replayTenant(db: Db, id: string): Promise<Outcome> {
  return db.$transaction(async (tx) => {
    const t = await tx.$queryRaw<{ ok: bigint | number }[]>`SELECT ${TENANT_OK} AS ok FROM tenants t WHERE t.id = ${id} FOR UPDATE`;
    if (!t[0]) return "noop";
    if (Number(t[0].ok) !== 1) return "rejected";
    await tx.$executeRaw`
      UPDATE tenants SET status = 'PASSIVE', passive_at = UTC_TIMESTAMP(3) - INTERVAL 30 DAY - INTERVAL 1 HOUR, updated_at = UTC_TIMESTAMP(3)
      WHERE id = ${id} AND NOT (status = 'PASSIVE' AND passive_at IS NOT NULL AND passive_at <= UTC_TIMESTAMP(3) - INTERVAL 30 DAY)`;
    const open = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenant_purge_jobs WHERE tenant_id = ${id} AND state IN ('SCHEDULED', 'RUNNING', 'FAILED') FOR UPDATE`;
    if (open[0]) {
      await tx.$executeRaw`
        UPDATE tenant_purge_jobs SET state = 'RUNNING', step = 'FENCE', counts = JSON_OBJECT(), attempts = 0, last_error = NULL,
          tenant_row_deleted_at = NULL, heartbeat_at = NULL, started_at = COALESCE(started_at, UTC_TIMESTAMP(3)),
          updated_at = UTC_TIMESTAMP(3)
        WHERE id = ${open[0].id}`;
      return "applied";
    }
    const by = await tx.$queryRaw<{ id: string }[]>`
      SELECT started_by AS id FROM tenant_purge_jobs WHERE tenant_id = ${id}
      UNION ALL (SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND tenant_id IS NULL AND status = 'ACTIVE' ORDER BY created_at, id LIMIT 1)
      LIMIT 1`;
    if (!by[0]) throw new Error("iş sahibi için Super Admin yok");
    await tx.$executeRaw`
      INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, attempts, preview_hash, started_by,
        started_at, created_at, updated_at)
      VALUES (${newId()}, ${id}, 'RUNNING', 'FENCE', UTC_TIMESTAMP(3), JSON_OBJECT(), 0, ${sha256Hex(newSecretToken())}, ${by[0].id},
        UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
    return "applied";
  });
}

export interface ReplayResult {
  users: number;
  tenants: number;
  rejectedUsers: number;
  rejectedTenants: number;
  invalid: number;
}

/** Defteri yeniden uygular (idempotent: ikinci koşu 0/0). `db` migrator bağlantısı olmalı. */
export async function replay(db: Db, ledgerPath: string = ERASURE_LEDGER_PATH): Promise<ReplayResult> {
  const l = await readLedger(ledgerPath);
  const result: ReplayResult = { users: 0, tenants: 0, rejectedUsers: 0, rejectedTenants: 0, invalid: l.invalid };
  const users = userIdsOf(l);
  for (const [id, intentOnly] of [...users.done.map((x) => [x, false] as const), ...users.intentOnly.map((x) => [x, true] as const)]) {
    const o = await replayUser(db, id, intentOnly);
    if (o === "applied") result.users += 1;
    else if (o === "rejected") result.rejectedUsers += 1;
  }
  for (const id of idsOf(l, "tenant")) {
    const o = await replayTenant(db, id);
    if (o === "applied") result.tenants += 1;
    else if (o === "rejected") result.rejectedTenants += 1;
  }
  await writeAudit(db, cliAuditContext(), {
    username: "cli",
    action: ERASURE_AUDIT.REPLAYED,
    entity: "erasure_ledger",
    result: result.rejectedUsers + result.rejectedTenants === 0 ? "success" : "fail",
    newValue: { ...result, ledgerLines: l.entries.length },
  });
  return result;
}

export interface VerifyResult {
  pendingUsers: number;
  pendingTenants: number;
  rejectedUsers: number;
  rejectedTenants: number;
  invalid: number;
}

async function countWhere(db: Db, table: "users" | "tenants", ids: string[], cond: Prisma.Sql): Promise<number> {
  if (ids.length === 0) return 0;
  const from = table === "users" ? Prisma.sql`users u` : Prisma.sql`tenants t`;
  const idCol = table === "users" ? Prisma.sql`u.id` : Prisma.sql`t.id`;
  const r = await db.$queryRaw<
    { n: bigint | number }[]
  >`SELECT COUNT(*) AS n FROM ${from} WHERE ${idCol} IN (${Prisma.join(ids)}) AND ${cond}`;
  return Number(r[0]?.n ?? 0);
}

export async function verify(db: Db, ledgerPath: string = ERASURE_LEDGER_PATH): Promise<VerifyResult> {
  const l = await readLedger(ledgerPath);
  const users = userIdsOf(l);
  const tenantIds = idsOf(l, "tenant");
  const live = Prisma.sql`u.status <> 'DELETED'`;
  const usersWhere = async (ok: boolean): Promise<number> => {
    let n = 0;
    for (const [ids, intentOnly] of [
      [users.done, false],
      [users.intentOnly, true],
    ] as const)
      n += await countWhere(
        db,
        "users",
        ids,
        ok ? Prisma.sql`${live} AND ${userOk(intentOnly)}` : Prisma.sql`${live} AND NOT ${userOk(intentOnly)}`,
      );
    return n;
  };
  return {
    pendingUsers: await usersWhere(true),
    pendingTenants: await countWhere(db, "tenants", tenantIds, Prisma.sql`${TENANT_OK} = 1`),
    rejectedUsers: await usersWhere(false),
    rejectedTenants: await countWhere(db, "tenants", tenantIds, Prisma.sql`${TENANT_OK} = 0`),
    invalid: l.invalid,
  };
}

const urlSchema = z.string().regex(/^mysql:\/\/.+/);

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: { out(s: string): void; err(s: string): void },
  ledgerPath: string = ERASURE_LEDGER_PATH,
): Promise<number> {
  const cmd = argv[0];
  if (argv.length !== 1 || (cmd !== "erasure:replay" && cmd !== "erasure:verify")) {
    io.err("kullanım: cli erasure:replay | erasure:verify\n");
    return EXIT.USAGE;
  }
  const url = urlSchema.safeParse(env.MIGRATE_DATABASE_URL);
  if (!url.success) {
    io.err("MIGRATE_DATABASE_URL tanımlı değil ya da geçersiz\n");
    return EXIT.USAGE;
  }
  const db = createDb(url.data);
  try {
    if (cmd === "erasure:replay") {
      const r = await replay(db, ledgerPath);
      io.out(
        `erasure:replay kullanici=${r.users} firma=${r.tenants} reddedilen_kullanici=${r.rejectedUsers} ` +
          `reddedilen_firma=${r.rejectedTenants} gecersiz_satir=${r.invalid}\n`,
      );
      if (r.rejectedUsers + r.rejectedTenants === 0) return EXIT.OK;
      io.err("erasure:replay: defter satırı geri yüklenen DB ile tutarsız (kurcalama şüphesi) — elle karar: runbook §23.5\n");
      return EXIT.REJECTED;
    }
    const v = await verify(db, ledgerPath);
    io.out(
      `erasure:verify bekleyen_kullanici=${v.pendingUsers} bekleyen_firma=${v.pendingTenants} ` +
        `reddedilen_kullanici=${v.rejectedUsers} reddedilen_firma=${v.rejectedTenants} gecersiz_satir=${v.invalid}\n`,
    );
    return v.pendingUsers + v.pendingTenants === 0 ? EXIT.OK : EXIT.PENDING;
  } catch (err) {
    io.err(`${cmd}: hata (${(err as Error).name})\n`);
    return EXIT.ERROR;
  } finally {
    await db.$disconnect();
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  process.exitCode = await main(process.argv.slice(2), process.env, {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
