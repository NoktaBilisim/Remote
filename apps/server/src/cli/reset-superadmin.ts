// P13b `reset-superadmin` CLI (mimari-p13 §7.7). Sunucuda root olarak, TTY ile çalışır:
//   docker compose exec server node src/cli/reset-superadmin.ts --email <e-posta> [--reset-mfa] [--dry-run]
// (`-T` verilmez). Geçici parola yalnız TTY'ye bir kez yazılır; stdout TTY değilse hiçbir işlem yapılmaz (çıkış 4) →
// parola journal'a ya da pipe'a düşmez. Logger parolayı hiç görmez. Çıkış kodları: 0 tamam · 2 kullanım hatası ·
// 3 bulunamadı · 4 TTY yok · 5 DB hatası.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { pino, type Logger } from "pino";
import { z } from "zod";
import { cliAuditContext, resetSuperadmin, type SuperadminResetInput } from "../auth/superadmin-reset.ts";
import { loadEnv } from "../env.ts";
import { createDb, type Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { createLogger } from "../lib/logger.ts";

export const EXIT = { OK: 0, USAGE: 2, NOT_FOUND: 3, NO_TTY: 4, DB: 5 } as const;

export interface CliIo {
  /** stdout bir terminal mi (parola yalnız buna yazılır). */
  isTTY: boolean;
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface CliRuntime {
  db: Db;
  logger: Logger;
  close: () => Promise<void>;
}

const USAGE = "kullanım: node src/cli/reset-superadmin.ts --email <e-posta> [--reset-mfa] [--dry-run]\n";
const emailSchema = z.string().trim().min(3).max(190).includes("@");

/** Argümanlar: yalnız bilinen bayraklar, konumsal argüman yok, `--email` bir kez ve '@' içeren değer. */
function parseCliArgs(argv: string[]): SuperadminResetInput | null {
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        email: { type: "string", multiple: true },
        "reset-mfa": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    });
    if (values.email?.length !== 1) return null;
    const email = emailSchema.safeParse(values.email[0]);
    if (!email.success) return null;
    return { email: email.data, resetMfa: values["reset-mfa"], dryRun: values["dry-run"] };
  } catch {
    return null;
  }
}

/** Varsayılan çalışma ortamı: doğrulanmış env (env.ts) + `app` kullanıcısıyla DB; log stderr'e (JSON). */
function defaultRuntime(): CliRuntime {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  return { db, logger: createLogger(env.LOG_LEVEL, pino.destination(2)), close: () => db.$disconnect() };
}

export async function runResetSuperadmin(argv: string[], io: CliIo, openRuntime: () => CliRuntime = defaultRuntime): Promise<number> {
  const input = parseCliArgs(argv);
  if (!input) {
    io.err(USAGE);
    return EXIT.USAGE;
  }
  if (!io.isTTY) {
    io.err("reset-superadmin: stdout bir terminal değil; işlem yapılmadı. `docker compose exec` komutunu -T olmadan çalıştırın.\n");
    return EXIT.NO_TTY;
  }

  let rt: CliRuntime;
  try {
    rt = openRuntime();
  } catch (err) {
    io.err(`reset-superadmin: yapılandırma okunamadı: ${err instanceof Error ? err.message : "bilinmeyen hata"}\n`);
    return EXIT.DB;
  }
  const ctx = cliAuditContext();
  try {
    const r = await resetSuperadmin(rt.db, ctx, input);
    if (r.kind === "not_found") {
      rt.logger.warn(
        { event: "superadmin_reset", result: "not_found", dryRun: input.dryRun, runId: ctx.requestId },
        "reset-superadmin: hesap bulunamadı",
      );
      io.err("Super Admin bulunamadı.\n");
      return EXIT.NOT_FOUND;
    }
    if (r.kind === "dry_run") {
      io.out("Dry-run: DB bağlantısı tamam, Super Admin hesabı bulundu. Değişiklik yapılmadı.\n");
      return EXIT.OK;
    }
    rt.logger.info(
      {
        event: "superadmin_reset",
        result: "success",
        userId: r.userId,
        mfaReset: r.mfaReset,
        revokedSessions: r.revokedSessions,
        runId: ctx.requestId,
      },
      "reset-superadmin tamamlandı",
    );
    io.out(
      [
        "Super Admin şifresi sıfırlandı.",
        `Geçici şifre (yalnız bir kez gösterilir): ${r.tempPassword}`,
        "Geçici şifre 24 saat geçerlidir; ilk girişte yeni şifre belirlenmesi zorunludur.",
        `Açık oturumlar iptal edildi: ${r.revokedSessions}.${r.mfaReset ? " İki adımlı doğrulama ve kurtarma kodları silindi." : ""}`,
        "Açık WebSocket bağlantıları bir sonraki yeniden doğrulamada kapanır.",
        "",
      ].join("\n"),
    );
    return EXIT.OK;
  } catch (err) {
    const ref = newId();
    rt.logger.error({ err, ref, event: "superadmin_reset", result: "error", runId: ctx.requestId }, "reset-superadmin DB hatası");
    io.err(`reset-superadmin: veritabanı hatası (ref ${ref}). Ayrıntı sunucu logunda.\n`);
    return EXIT.DB;
  } finally {
    await rt.close().catch(() => undefined);
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const io: CliIo = { isTTY: process.stdout.isTTY === true, out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) };
  void runResetSuperadmin(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
