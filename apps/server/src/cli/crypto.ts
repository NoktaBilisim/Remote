// P18 H3 — alan şifreleme anahtar emekliliği ve yeniden şifreleme CLI'ı (mimari-e11 §8b.13 S-P18-T2a/b; runbook §25.5;
// K-P18-10 — ADR-0025 append-only kuralının TEK istisnası). Yalnız `migrate` imajında, migrator bağlantısıyla:
//   docker compose run --rm migrate pnpm --filter @remote/server cli crypto:check-retire <ver>
//   docker compose run --rm -e APP_ENCRYPTION_KEYS migrate pnpm --filter @remote/server cli crypto:rewrap session_messages --from <ver> [--dry]
//   (`-e` değersiz: anahtar kabuk ortamından gelir; migrate servisinde kalıcı tanımlı değil — S-P18-K3)
// `app` kullanıcısına session_messages UPDATE verilmez (grants.sql); bu araç `MIGRATE_DATABASE_URL` ister.
// check-retire: `ASCII(body_enc) = <ver>` satır sayısı; 0 değilse sürüm halkadan çıkarılmaz (çıkış 1).
// rewrap: 500'lük partiler (id imleci) `FOR UPDATE` → çöz (aynı AAD) → en yüksek sürümle şifrele → `UPDATE body_enc`.
//   `--dry` yalnız çözülebilirliği sayar, yazmaz. Sonunda (hata yolunda da — S-P18-K2) audit
//   `crypto.rewrap {table, fromVer, toVer, rows, failed, batches, dry[, error]}` (username `system:cli`).
//   Çözülemeyen satır atlanır ve sayılır (çıkış 1). Gövde ASLA yazdırılmaz/loglanmaz.
// Çıkış: 0 tamam · 1 kalan/çözülemeyen satır var · 2 kullanım · 5 DB/anahtar hatası (aynı komut yeniden çalıştırılır).
import { z } from "zod";
import { CRYPTO_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import { cliAuditContext } from "../auth/superadmin-reset.ts";
import { parseEncryptionKeys } from "../env.ts";
import { aadFor, SecretBox } from "../lib/crypto.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { createDb, type Db } from "../lib/db.ts";

export const EXIT = { OK: 0, PENDING: 1, USAGE: 2, ERROR: 5 } as const;
export const REWRAP_BATCH = 500;
export const CLI_ACTOR = "system:cli";
const TABLES = ["session_messages"] as const;
type Io = { out(s: string): void; err(s: string): void };

const verSchema = z.coerce.number().int().min(1).max(255);
const urlSchema = z.string().regex(/^mysql:\/\/.+/);

/** S-P18-T2a: sürümle şifrelenmiş satır sayısı (emeklilik ön koşulu: 0). */
export async function countByVersion(db: Db, ver: number): Promise<number> {
  const r = await db.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM session_messages WHERE ASCII(body_enc) = ${ver}`;
  return Number(r[0]?.n ?? 0);
}

export interface RewrapResult {
  /** Commit edilmiş partilerde yeniden şifrelenen (dry: çözülebilen) satır. */
  rows: number;
  failed: number;
  toVer: number;
  /** Commit edilmiş parti sayısı. */
  batches: number;
}

/**
 * S-P18-T2b: `fromVer` ile şifreli satırları güncel sürüme taşır (aynı AAD). `dry` yazmaz. Her parti ayrı TX; sayaçlar
 * yalnız commit sonrası artar. S-P18-K2: ortada hata olursa da `crypto.rewrap {result:"fail", rows, failed, batches,
 * error:<ad>}` yazılır (önceki partiler kalıcıdır; yeniden çalıştırma idempotent — yalnız `fromVer` satırları seçilir).
 */
export async function rewrap(db: Db, box: SecretBox, fromVer: number, dry: boolean): Promise<RewrapResult> {
  const toVer = box.currentVersion;
  const out: RewrapResult = { rows: 0, failed: 0, toVer, batches: 0 };
  let errorName: string | null = null;
  let cursor = "";
  try {
    for (;;) {
      const batch = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; tenant_id: string; request_id: string | null; session_id: string | null; body_enc: Uint8Array }[]
        >`SELECT id, tenant_id, request_id, session_id, body_enc FROM session_messages
          WHERE ASCII(body_enc) = ${fromVer} AND id > ${cursor} ORDER BY id LIMIT ${REWRAP_BATCH} ${dry ? Prisma.empty : Prisma.sql`FOR UPDATE`}`;
        let done = 0;
        let failed = 0;
        for (const r of rows) {
          const aad = aadFor.sessionMessage(r.tenant_id, r.request_id ?? r.session_id ?? "", r.id);
          let plain: string;
          try {
            plain = box.decrypt(r.body_enc, aad);
          } catch {
            failed++;
            continue;
          }
          if (!dry) await tx.$executeRaw`UPDATE session_messages SET body_enc = ${Buffer.from(box.encrypt(plain, aad))} WHERE id = ${r.id}`;
          done++;
        }
        return { rows, done, failed };
      });
      out.rows += batch.done;
      out.failed += batch.failed;
      if (batch.rows.length > 0) out.batches++;
      const last = batch.rows.at(-1);
      if (!last || batch.rows.length < REWRAP_BATCH) break;
      cursor = last.id;
    }
  } catch (err) {
    errorName = err instanceof Error ? err.name : "Error";
    throw err;
  } finally {
    await writeAudit(db, cliAuditContext(), {
      username: CLI_ACTOR,
      action: CRYPTO_AUDIT.REWRAP,
      entity: "session_messages",
      result: errorName === null && out.failed === 0 ? "success" : "fail",
      newValue: {
        table: "session_messages",
        fromVer,
        toVer,
        rows: out.rows,
        failed: out.failed,
        batches: out.batches,
        dry,
        ...(errorName === null ? {} : { error: errorName }),
      },
    });
  }
  return out;
}

/** Argümanlar: `crypto:check-retire <ver>` | `crypto:rewrap session_messages --from <ver> [--dry]`. */
export async function main(argv: string[], env: NodeJS.ProcessEnv, io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  const usage = (): number => {
    io.err("kullanım: cli crypto:check-retire <ver> | cli crypto:rewrap session_messages --from <ver> [--dry]\n");
    return EXIT.USAGE;
  };
  let ver: number;
  let dry = false;
  if (cmd === "crypto:check-retire") {
    const v = verSchema.safeParse(rest[0]);
    if (rest.length !== 1 || !v.success) return usage();
    ver = v.data;
  } else if (cmd === "crypto:rewrap") {
    const [table, flag, raw, ...more] = rest;
    const v = verSchema.safeParse(raw);
    dry = more.length === 1 && more[0] === "--dry";
    if (!(TABLES as readonly string[]).includes(table ?? "") || flag !== "--from" || !v.success || (more.length > 0 && !dry))
      return usage();
    ver = v.data;
  } else return usage();

  const url = urlSchema.safeParse(env.MIGRATE_DATABASE_URL);
  if (!url.success) {
    io.err("MIGRATE_DATABASE_URL tanımlı değil ya da geçersiz (yalnız migrate servisi)\n");
    return EXIT.USAGE;
  }
  let box: SecretBox | null = null;
  if (cmd === "crypto:rewrap") {
    const keys = parseEncryptionKeys(env.APP_ENCRYPTION_KEYS ?? "");
    if (!keys) {
      io.err("APP_ENCRYPTION_KEYS tanımlı değil ya da geçersiz\n");
      return EXIT.USAGE;
    }
    if (!keys.has(ver)) {
      io.err(`sürüm ${ver} anahtar halkasında yok\n`);
      return EXIT.USAGE;
    }
    box = new SecretBox(keys);
    if (box.currentVersion === ver) {
      io.err(`sürüm ${ver} zaten güncel sürüm; önce yeni sürüm ekleyin\n`);
      return EXIT.USAGE;
    }
  }
  const db = createDb(url.data);
  try {
    if (!box) {
      const n = await countByVersion(db, ver);
      io.out(`crypto:check-retire tablo=session_messages surum=${ver} satir=${n}\n`);
      return n === 0 ? EXIT.OK : EXIT.PENDING;
    }
    const r = await rewrap(db, box, ver, dry);
    io.out(`crypto:rewrap tablo=session_messages kaynak=${ver} hedef=${r.toVer} satir=${r.rows} cozulemeyen=${r.failed} kuru=${dry}\n`);
    return r.failed === 0 ? EXIT.OK : EXIT.PENDING;
  } catch (err) {
    io.err(`${cmd}: hata (${(err as Error).name})\n`);
    return EXIT.ERROR;
  } finally {
    await db.$disconnect();
  }
}
