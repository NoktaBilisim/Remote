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
import { aadFor, NOTIFY_RECIPIENT_KEY_VERSION, SecretBox } from "../lib/crypto.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { createDb, type Db } from "../lib/db.ts";

const EXIT = { OK: 0, PENDING: 1, USAGE: 2, ERROR: 5 } as const;
export const REWRAP_BATCH = 500;
export const CLI_ACTOR = "system:cli";
// P19 J3 (S-P19-T6): firma SMS anahtarı da yeniden şifrelenir (AAD etkin kökene bağlı; `sms_url` NULL satırlarda köken
// `SMSPORTAL_URL`'den — komuta `-e SMSPORTAL_URL` verilmezse bu satırlar çözülemez sayılır). Outbox alıcısı için rewrap yok
// (`recipient_enc` dakikalar içinde NULL'lanır; check-retire sayar, sayım 0 olana dek beklenir).
const TABLES = ["session_messages", "tenant_settings.sms_api_key"] as const;
type Io = { out(s: string): void; err(s: string): void };

const verSchema = z.coerce.number().int().min(1).max(255);
const urlSchema = z.string().regex(/^mysql:\/\/.+/);

/** S-P18-T2a: sürümle şifrelenmiş satır sayısı (emeklilik ön koşulu: 0). */
async function countByVersion(db: Db, ver: number): Promise<number> {
  const r = await db.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM session_messages WHERE ASCII(body_enc) = ${ver}`;
  return Number(r[0]?.n ?? 0);
}

/** S-P19-T6: emeklilik kapsamı — tablo başına sayım (toplam > 0 → sürüm halkadan çıkarılmaz). */
export async function countAllByVersion(db: Db, ver: number): Promise<Record<string, number>> {
  const n = async (q: Promise<{ n: bigint | number }[]>): Promise<number> => Number((await q)[0]?.n ?? 0);
  return {
    session_messages: await countByVersion(db, ver),
    "tenant_settings.sms_api_key_enc": await n(
      db.$queryRaw`SELECT COUNT(*) AS n FROM tenant_settings WHERE sms_api_key_enc IS NOT NULL AND ASCII(sms_api_key_enc) = ${ver}`,
    ),
    "notification_outbox.recipient_enc": await n(
      db.$queryRaw`SELECT COUNT(*) AS n FROM notification_outbox WHERE recipient_enc IS NOT NULL AND ASCII(recipient_enc) = ${ver}`,
    ),
  };
}

/** S-P19-T6: `tenant_settings.sms_api_key_enc` yeniden şifreleme (aynı AAD; köken tenant `sms_url` ?? `envSmsUrl`). */
async function rewrapSmsKeys(db: Db, box: SecretBox, fromVer: number, dry: boolean, envSmsUrl: string): Promise<RewrapResult> {
  const toVer = box.currentVersion;
  const out: RewrapResult = { rows: 0, failed: 0, toVer, batches: 0 };
  let errorName: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ tenant_id: string; sms_url: string | null; sms_api_key_enc: Uint8Array }[]>`SELECT tenant_id,
        sms_url, sms_api_key_enc FROM tenant_settings WHERE sms_api_key_enc IS NOT NULL AND ASCII(sms_api_key_enc) = ${fromVer}
        ${dry ? Prisma.empty : Prisma.sql`FOR UPDATE`}`;
      for (const r of rows) {
        const url = r.sms_url ?? envSmsUrl;
        let plain: string;
        let aad: string;
        try {
          aad = aadFor.smsApiKey(r.tenant_id, new URL(url).origin);
          plain = box.decrypt(r.sms_api_key_enc, aad);
        } catch {
          out.failed++;
          continue;
        }
        if (!dry)
          await tx.$executeRaw`UPDATE tenant_settings SET sms_api_key_enc = ${Buffer.from(box.encrypt(plain, aad))} WHERE tenant_id = ${r.tenant_id}`;
        out.rows++;
      }
      if (rows.length > 0) out.batches = 1;
    });
  } catch (err) {
    errorName = err instanceof Error ? err.name : "Error";
    out.rows = 0;
    throw err;
  } finally {
    await writeAudit(db, cliAuditContext(), {
      username: CLI_ACTOR,
      action: CRYPTO_AUDIT.REWRAP,
      entity: "tenant_settings",
      result: errorName === null && out.failed === 0 ? "success" : "fail",
      newValue: {
        table: "tenant_settings.sms_api_key",
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

interface RewrapResult {
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
    io.err(
      "kullanım: cli crypto:check-retire <ver> | cli crypto:rewrap session_messages|tenant_settings.sms_api_key --from <ver> [--dry]\n",
    );
    return EXIT.USAGE;
  };
  let ver: number;
  let dry = false;
  let table: string = TABLES[0];
  if (cmd === "crypto:check-retire") {
    const v = verSchema.safeParse(rest[0]);
    if (rest.length !== 1 || !v.success) return usage();
    ver = v.data;
  } else if (cmd === "crypto:rewrap") {
    const [t, flag, raw, ...more] = rest;
    const v = verSchema.safeParse(raw);
    dry = more.length === 1 && more[0] === "--dry";
    if (!(TABLES as readonly string[]).includes(t ?? "") || flag !== "--from" || !v.success || (more.length > 0 && !dry)) return usage();
    ver = v.data;
    table = t as string;
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
      const counts = await countAllByVersion(db, ver);
      for (const [t, n] of Object.entries(counts)) io.out(`crypto:check-retire tablo=${t} surum=${ver} satir=${n}\n`);
      // S-P19-T13: recipient_hash sabit sürümü emekliye ayrılırsa 24 sa tavan sayımı bir kez sıfırlanır.
      if (ver === NOTIFY_RECIPIENT_KEY_VERSION)
        io.err(
          `uyarı: sürüm ${ver} NOTIFY_RECIPIENT_KEY_VERSION; emeklilikten önce sabiti yeni sürüme taşıyın (bildirim tavan sayımı 24 sa sıfırlanır)\n`,
        );
      return Object.values(counts).some((n) => n > 0) ? EXIT.PENDING : EXIT.OK;
    }
    const r =
      table === "session_messages" ? await rewrap(db, box, ver, dry) : await rewrapSmsKeys(db, box, ver, dry, env.SMSPORTAL_URL ?? "");
    io.out(`crypto:rewrap tablo=${table} kaynak=${ver} hedef=${r.toVer} satir=${r.rows} cozulemeyen=${r.failed} kuru=${dry}\n`);
    return r.failed === 0 ? EXIT.OK : EXIT.PENDING;
  } catch (err) {
    io.err(`${cmd}: hata (${(err as Error).name})\n`);
    return EXIT.ERROR;
  } finally {
    await db.$disconnect();
  }
}
