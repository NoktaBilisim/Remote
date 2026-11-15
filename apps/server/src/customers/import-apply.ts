// Müşteri CSV içe aktarma uygulaması (customers/csv-import.ts `commitImport`): 500'lük partiler, parti başına TX.
// Ekleme: customers `createMany` (INSERT IGNORE; yarışta eklenen ad → skipped) → request_refs → satır audit'i.
// Güncelleme yalnız alanlar (ref/durum değişmez, anonim atlanır).
import { customerKeys, suggestFileLabel, type ImportResult } from "@remote/contracts/api/customers";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { customerAuditView, type CustomerAuditFields } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { newId, newTenantRef } from "../lib/ids.ts";
import type { RequestService } from "../requests/service.ts";
import type { ParsedRow } from "./import-rows.ts";
import * as repo from "./repo.ts";
import { withTxRetry } from "./service.ts";

type Tx = Prisma.TransactionClient;

const ENTITY = "customer";
const BATCH = 500;

const UPDATABLE = ["name", "contactName", "phone", "email", "note", "fileLabel", "defaultPriority", "slaMinutes"] as const;

/** Uygulamanın audit kimliği ve kapsamı (tüm partiler için aynı). */
interface ImportActor {
  ctx: AuditContext;
  who: { tenantId: string; userId: string; username: string };
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function createRow(r: ParsedRow, id: string, tenantId: string, userId: string, now: Date) {
  const contactName = (r.data.contactName as string | null | undefined) ?? null;
  const phone = (r.data.phone as string | null | undefined) ?? null;
  return {
    id,
    tenantId,
    name: r.name,
    ...customerKeys(r.name, contactName, phone),
    fileLabel: (r.data.fileLabel as string | undefined) ?? suggestFileLabel(r.name),
    requestRef: newTenantRef(),
    contactName,
    phone,
    email: (r.data.email as string | null | undefined) ?? null,
    note: (r.data.note as string | null | undefined) ?? null,
    defaultPriority: (r.data.defaultPriority as string | null | undefined) ?? null,
    slaMinutes: (r.data.slaMinutes as number | null | undefined) ?? null,
    status: "ACTIVE",
    createdBy: userId,
    createdAt: now,
  };
}

/** Bir ekleme partisinin TX gövdesi. Dönen: gerçekten eklenen sayı. */
async function insertBatchTx(tx: Tx, svc: RequestService, a: ImportActor, part: ParsedRow[], ids: string[]): Promise<number> {
  const { tenantId } = a.who;
  const now = new Date(svc.d.clock.now());
  const data = part.map((r, k) => createRow(r, ids[k] as string, tenantId, a.who.userId, now));
  // INSERT IGNORE: arada aynı adla eklenen müşteri (UQ tenant_id,name_key) → satır atlanır, parti geri alınmaz.
  await tx.customer.createMany({ data, skipDuplicates: true });
  const got = new Set((await repo.findMany(tx, tenantId, ids)).map((c) => c.id));
  const ok = data.filter((d) => got.has(d.id));
  if (ok.length > 0)
    await tx.requestRef.createMany({ data: ok.map((d) => ({ ref: d.requestRef, tenantId, customerId: d.id, createdAt: now })) });
  for (const d of ok)
    await writeAudit(tx, a.ctx, {
      ...a.who,
      action: CUSTOMER_AUDIT.CREATED,
      entity: ENTITY,
      entityId: d.id,
      result: "success",
      newValue: {
        ...customerAuditView({
          name: d.name,
          fileLabel: d.fileLabel,
          refPrefix: d.requestRef,
          ...(d.defaultPriority ? { defaultPriority: d.defaultPriority } : {}),
          ...(d.slaMinutes ? { slaMinutes: d.slaMinutes } : {}),
        }),
        source: "import",
      },
    });
  return ok.length;
}

/** Yeni müşteriler: parti başına TX (ref çakışması/geçici hata → tüm parti yeniden). */
export async function applyCreates(svc: RequestService, a: ImportActor, creates: ParsedRow[], res: ImportResult): Promise<void> {
  for (const part of chunks(creates, BATCH)) {
    const ids = part.map(() => newId());
    const n = await withTxRetry(() => svc.d.db.$transaction(async (tx) => insertBatchTx(tx, svc, a, part, ids)));
    res.created += n;
    res.skipped += part.length - n;
  }
}

/** Tek mevcut müşterinin güncellemesi; değişiklik yoksa ya da koşullu yazım 0 satırsa `false` (atlandı). */
async function updateOneTx(tx: Tx, a: ImportActor, id: string, row: ParsedRow, c: repo.CustomerRow): Promise<boolean> {
  const next: Record<(typeof UPDATABLE)[number], string | number | null> = {
    name: row.name,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    note: c.note,
    fileLabel: c.fileLabel,
    defaultPriority: c.defaultPriority,
    slaMinutes: c.slaMinutes,
  };
  for (const [f, v] of Object.entries(row.data)) next[f as keyof typeof row.data] = v;
  const changed = UPDATABLE.filter((f) => next[f] !== c[f]);
  if (changed.length === 0) return false;
  const n = await repo.update(
    tx,
    a.who.tenantId,
    id,
    {
      ...Object.fromEntries(changed.map((f) => [f, next[f]])),
      ...customerKeys(String(next.name), next.contactName as string | null, next.phone as string | null),
    },
    { anonymizedAt: null },
  );
  if (n === 0) return false;
  const pick = (src: CustomerAuditFields): CustomerAuditFields =>
    Object.fromEntries(changed.map((f) => [f, src[f]])) as CustomerAuditFields;
  await writeAudit(tx, a.ctx, {
    ...a.who,
    action: CUSTOMER_AUDIT.UPDATED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    oldValue: customerAuditView(pick(c as CustomerAuditFields)),
    newValue: { changed: [...changed], ...customerAuditView(pick(next as CustomerAuditFields)), source: "import" },
  });
  return true;
}

/** Bir güncelleme partisinin TX gövdesi. */
async function updateBatchTx(
  tx: Tx,
  a: ImportActor,
  part: { id: string; row: ParsedRow }[],
): Promise<{ updated: number; skipped: number }> {
  const cur = new Map(
    (
      await repo.findMany(
        tx,
        a.who.tenantId,
        part.map((u) => u.id),
      )
    ).map((c) => [c.id, c]),
  );
  let u = 0;
  let s = 0;
  for (const { id, row } of part) {
    const c = cur.get(id);
    if (!c || c.anonymizedAt) {
      s++; // anonim müşteri atlanır (AC-195)
      continue;
    }
    if (await updateOneTx(tx, a, id, row, c)) u++;
    else s++;
  }
  return { updated: u, skipped: s };
}

/** Çakışan adlar (`onConflict: update`): parti başına TX. */
export async function applyUpdates(
  svc: RequestService,
  a: ImportActor,
  updates: { id: string; row: ParsedRow }[],
  res: ImportResult,
): Promise<void> {
  for (const part of chunks(updates, BATCH)) {
    const { updated, skipped } = await svc.d.db.$transaction(async (tx) => updateBatchTx(tx, a, part));
    res.updated += updated;
    res.skipped += skipped;
  }
}
