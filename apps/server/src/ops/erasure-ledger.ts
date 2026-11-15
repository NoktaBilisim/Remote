// P16 (ADR-0030 m.9, S16-5, S16-13) imha defteri: DB DIŞINDA, yalnız eklenen JSONL (0600). Satır
// `{v:1, type:"tenant"|"user", id, jobId?, phase?, at}` — kişisel veri yok. Kullanıcı satırı (G4) mezar taşı TX'inde
// denetimlerden sonra `phase:"intent"`, commit'ten sonra `phase:"done"` (S16-18; `phase`sız eski satır = done); firma satırı
// FENCE adımındaki her turda (`phase:"started"`, S16-18; tekrar zararsız) ve DONE'da (`phase:"done"`) yazılır (G3).
// Geri yüklemeden sonra `cli erasure:replay` (src/cli/erasure.ts) bu satırları yeniden uygular. Yol sabit (volume
// `remote_ledger` → /var/lib/remote); testler başka yol verir.
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ERASURE_LEDGER_PATH = "/var/lib/remote/erasure-ledger.jsonl";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type TenantPhase = "started" | "done";
/** S16-18: `intent` mezar taşı TX'inde (denetimler geçtikten sonra), `done` commit'ten sonra. Replay ikisini aynı işler. */
export type UserPhase = "intent" | "done";
/** Çağıranın verdiği satır (sürüm alanı `append` ekler). Okunan kullanıcı satırında `phase` yoksa eski biçimdir (= done). */
export type ErasureEntry =
  | { type: "user"; id: string; phase?: UserPhase; at: string }
  | { type: "tenant"; id: string; jobId: string; phase: TenantPhase; at: string };
export type LedgerLine = ErasureEntry & { v: 1 };

export class ErasureLedger {
  readonly path: string;
  private readonly onFailure: () => void;

  /** `onFailure`: yazım hatası sayacı (`rs_erasure_ledger_write_failed_total`); hata yine çağırana fırlar. */
  constructor(path: string = ERASURE_LEDGER_PATH, onFailure: () => void = () => {}) {
    this.path = path;
    this.onFailure = onFailure;
  }

  /** Tek satır ekler (O_APPEND; dosya yoksa 0600 açılır) + fsync. Hata çağırana fırlar — çağıran alarm loglar. */
  async append(entry: ErasureEntry): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await appendFile(this.path, `${JSON.stringify({ v: 1, ...entry })}\n`, { mode: 0o600, flag: "a" });
      const fh = await open(this.path, "r");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}

/** Tek satırı doğrular; kural dışıysa null (bilinmeyen alan, biçimsiz kimlik/an, yanlış tür). */
export function parseLedgerLine(line: string): LedgerLine | null {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || typeof o.id !== "string" || !ULID.test(o.id)) return null;
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return null;
  if (o.type === "user") {
    if (Object.keys(o).length === 4) return { v: 1, type: "user", id: o.id, at: o.at };
    if (Object.keys(o).length !== 5 || (o.phase !== "intent" && o.phase !== "done")) return null;
    return { v: 1, type: "user", id: o.id, phase: o.phase, at: o.at };
  }
  if (o.type !== "tenant" || typeof o.jobId !== "string" || !ULID.test(o.jobId)) return null;
  if (o.phase !== "started" && o.phase !== "done") return null;
  return Object.keys(o).length === 6 ? { v: 1, type: "tenant", id: o.id, jobId: o.jobId, phase: o.phase, at: o.at } : null;
}

export interface LedgerContents {
  entries: LedgerLine[];
  /** Geçersiz (boş olmayan) satır sayısı — yarım kalmış son satır dahil. */
  invalid: number;
}

/** Defteri okur; dosya yoksa boş. Satırlar sırayla, tekrarlar korunur (uygulama idempotenttir). */
export async function readLedger(path: string = ERASURE_LEDGER_PATH): Promise<LedgerContents> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], invalid: 0 };
    throw err;
  }
  const out: LedgerContents = { entries: [], invalid: 0 };
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const e = parseLedgerLine(line);
    if (e) out.entries.push(e);
    else out.invalid += 1;
  }
  return out;
}
