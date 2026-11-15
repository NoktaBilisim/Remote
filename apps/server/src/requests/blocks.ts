// P15 (AC-235, G-E9-17; mimari-e11 §6, db-notlari "P15 → Backend notları"): talep engelleri.
//  - Kapı: `/public/requests` oluşturmada tenant başına BELLEK önbelleği (etkin satırlar; IP bellekte baytsal karşılaştırılır).
//    Yazmada (ekle/kaldır) o tenant'ın önbelleği geçersiz kılınır; süre dolumu karşılaştırma anında denetlenir (tek
//    instance, ADR-0005). Eşleşme → çağıran mevcut tek tip ret yanıtını döner (kuyruğa düşmez).
//  - Yazma: ekleme TX'i tenant satırı FOR UPDATE → COUNT < 1.000 → aynı hedefin süresi dolmuş satırı DELETE → INSERT;
//    P2002 → 409. Kaldırma `deleteMany({id, tenantId})`, 0 → 404. Audit aynı TX'te.
import { isIPv4, isIPv6 } from "node:net";
import {
  REQUEST_BLOCK_EXISTS_MESSAGE,
  REQUEST_BLOCK_NO_SOURCE_MESSAGE,
  REQUEST_BLOCKS_LIMIT_MESSAGE,
  REQUEST_BLOCKS_MAX,
  type CreateRequestBlockData,
  type ListRequestBlocksQuery,
  type RequestBlockItem,
  type RequestBlockKind,
  type RequestBlockListResponse,
} from "@remote/contracts/api/request-blocks";
import { checkBlockCidr } from "@remote/contracts/api/requests";
import { REQUEST_BLOCK_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";

// ---------------- IP ↔ bayt ----------------

/** İstemci IP'si → 4 ya da 16 bayt; IPv4-eşlemeli IPv6 4 bayta indirgenir, zone id atılır. Geçersizse null. */
export function ipBytes(ip: string): Buffer | null {
  let addr = ip.split("%")[0] ?? ip;
  if (isIPv4(addr)) return Buffer.from(addr.split(".").map(Number));
  if (!isIPv6(addr)) return null;
  // Gömülü IPv4 kuyruğu (::ffff:1.2.3.4) → iki 16 bitlik grup.
  const dot = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (dot) {
    const [p1, p2, p3, p4] = [dot[2], dot[3], dot[4], dot[5]].map(Number) as [number, number, number, number];
    addr = `${dot[1] ?? ""}${((p1 << 8) | p2).toString(16)}:${((p3 << 8) | p4).toString(16)}`;
  }
  const [head = "", tail] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  const out = Buffer.alloc(16);
  [...left, ...fill, ...right].forEach((h, i) => out.writeUInt16BE(parseInt(h, 16), i * 2));
  // IPv4-eşlemeli IPv6 → 4 bayt (db-notlari P15: kapı ve kayıt aynı biçimi kullanır).
  if (out.subarray(0, 10).every((x) => x === 0) && out[10] === 0xff && out[11] === 0xff) return Buffer.from(out.subarray(12));
  return out;
}

/** Normalize CIDR (contracts `checkBlockCidr` çıktısı) → [ağ, yayın] baytları. */
export function cidrRange(cidr: string): { from: Buffer; to: Buffer } {
  const [addr = "", bitsRaw = ""] = cidr.split("/");
  const from = ipBytes(addr);
  if (!from) throw new Error("geçersiz CIDR");
  const bits = Number(bitsRaw);
  const to = Buffer.from(from);
  for (let i = 0; i < to.length; i++) {
    const keep = Math.max(0, Math.min(8, bits - i * 8));
    const hostMask = keep === 8 ? 0 : 0xff >> keep;
    from[i] = (from[i] ?? 0) & ~hostMask & 0xff;
    to[i] = (to[i] ?? 0) | hostMask;
  }
  return { from, to };
}

/** [ağ, yayın] → CIDR metni (liste görünümü). */
export function rangeCidr(from: Uint8Array, to: Uint8Array): string {
  let bits = 0;
  for (let i = 0; i < from.length; i++) {
    const x = ((from[i] ?? 0) ^ (to[i] ?? 0)) & 0xff;
    if (x === 0) {
      bits += 8;
      continue;
    }
    bits += 8 - Math.ceil(Math.log2(x + 1));
    break;
  }
  if (from.length === 4) return `${[...from].join(".")}/${bits}`;
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((from[i] ?? 0) << 8) | (from[i + 1] ?? 0));
  const r = checkBlockCidr(`${groups.map((g) => g.toString(16)).join(":")}/${bits}`);
  return r.ok ? r.cidr : `${groups.map((g) => g.toString(16)).join(":")}/${bits}`;
}

// ---------------- Kapı önbelleği ----------------

interface CachedBlock {
  from: Buffer | null;
  to: Buffer | null;
  deviceKeyHash: string | null;
  expiresAt: number | null;
}

export class RequestBlockCache {
  private readonly byTenant = new Map<string, Promise<CachedBlock[]>>();
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number) {
    this.db = db;
    this.now = now;
  }

  invalidate(tenantId: string): void {
    this.byTenant.delete(tenantId);
  }

  private load(tenantId: string): Promise<CachedBlock[]> {
    let p = this.byTenant.get(tenantId);
    if (!p) {
      const at = new Date(this.now());
      p = this.db.requestBlock
        .findMany({
          where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
          select: { ipFrom: true, ipTo: true, deviceKeyHash: true, expiresAt: true },
          take: REQUEST_BLOCKS_MAX,
        })
        .then((rows) =>
          rows.map((r) => ({
            from: r.ipFrom ? Buffer.from(r.ipFrom) : null,
            to: r.ipTo ? Buffer.from(r.ipTo) : null,
            deviceKeyHash: r.deviceKeyHash,
            expiresAt: r.expiresAt?.getTime() ?? null,
          })),
        );
      this.byTenant.set(tenantId, p);
      // Hata önbelleğe girmez (sonraki istek yeniden dener). S15-5: yalnız kendi yüklemesini siler; arada `invalidate` +
      // yeni yükleme olduysa o korunur.
      p.catch(() => {
        if (this.byTenant.get(tenantId) === p) this.byTenant.delete(tenantId);
      });
    }
    return p;
  }

  /** Engelli mi: "ip" | "device" | null. `deviceKeyHash` = talep satırındaki `device_hash` biçimi (tenant'a bağlı özet). */
  async match(tenantId: string, ip: string, deviceKeyHash: string | null): Promise<RequestBlockKind | null> {
    const rows = await this.load(tenantId);
    if (rows.length === 0) return null;
    const now = this.now();
    const b = ipBytes(ip);
    for (const r of rows) {
      if (r.expiresAt !== null && r.expiresAt <= now) continue;
      if (b && r.from && r.to && r.from.length === b.length && Buffer.compare(r.from, b) <= 0 && Buffer.compare(b, r.to) <= 0) return "IP";
      if (deviceKeyHash && r.deviceKeyHash === deviceKeyHash) return "DEVICE";
    }
    return null;
  }
}

// ---------------- Panel servisleri ----------------

const itemSelect = {
  id: true,
  kind: true,
  ipFrom: true,
  ipTo: true,
  deviceKeyHash: true,
  expiresAt: true,
  note: true,
  createdAt: true,
  creator: { select: { id: true, fullName: true } },
} as const;
type ItemRow = Prisma.RequestBlockGetPayload<{ select: typeof itemSelect }>;

function toItem(r: ItemRow, now: number): RequestBlockItem {
  return {
    id: r.id,
    kind: r.kind as RequestBlockKind,
    cidr: r.ipFrom && r.ipTo ? rangeCidr(r.ipFrom, r.ipTo) : null,
    deviceFingerprint: r.deviceKeyHash ? r.deviceKeyHash.slice(0, 8) : null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    expired: r.expiresAt !== null && r.expiresAt.getTime() <= now,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: { id: r.creator.id, fullName: r.creator.fullName },
  };
}

export interface BlockDeps {
  db: Db;
  cache: RequestBlockCache;
  now: () => number;
}

export async function listBlocks(d: BlockDeps, tenantId: string, q: ListRequestBlocksQuery): Promise<RequestBlockListResponse> {
  const now = d.now();
  const where: Prisma.RequestBlockWhereInput = {
    tenantId,
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.includeExpired === "true" ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] }),
  };
  const [rows, total, used] = await Promise.all([
    d.db.requestBlock.findMany({
      where,
      select: itemSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    d.db.requestBlock.count({ where }),
    d.db.requestBlock.count({ where: { tenantId } }),
  ]);
  return { items: rows.map((r) => toItem(r, now)), page: q.page, pageSize: q.pageSize, total, used, max: REQUEST_BLOCKS_MAX };
}

const isUnique = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

/** Hedef: CIDR ya da talep satırından (tenant kapsamlı; panel IP/cihaz anahtarını görmez). */
async function resolveTarget(
  d: BlockDeps,
  tenantId: string,
  input: CreateRequestBlockData,
): Promise<{ kind: "IP"; cidr: string } | { kind: "DEVICE"; hash: string }> {
  if (input.source === "CIDR") return { kind: "IP", cidr: input.cidr };
  const r = await d.db.supportRequest.findFirst({
    where: { id: input.requestId, tenantId },
    select: { ip: true, deviceHash: true },
  });
  if (!r) throw new AppError("NOT_FOUND");
  if (input.target === "DEVICE") {
    if (!r.deviceHash) throw new AppError("CONFLICT", { message: REQUEST_BLOCK_NO_SOURCE_MESSAGE });
    return { kind: "DEVICE", hash: r.deviceHash };
  }
  const bytes = r.ip ? ipBytes(r.ip) : null;
  if (!r.ip || !bytes) throw new AppError("CONFLICT", { message: REQUEST_BLOCK_NO_SOURCE_MESSAGE });
  const v4 = bytes.length === 4;
  const raw = v4 ? [...bytes].join(".") : (r.ip.split("%")[0] ?? r.ip);
  const c = checkBlockCidr(`${raw}/${input.prefixLen ?? (v4 ? 32 : 128)}`);
  if (!c.ok) throw new AppError("VALIDATION", { fields: { prefixLen: c.message } });
  return { kind: "IP", cidr: c.cidr };
}

export async function createBlock(
  d: BlockDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: CreateRequestBlockData,
): Promise<RequestBlockItem> {
  const target = await resolveTarget(d, tenantId, input);
  const r0 = target.kind === "IP" ? cidrRange(target.cidr) : null;
  const range = r0 ? { from: new Uint8Array(r0.from), to: new Uint8Array(r0.to) } : null; // Prisma Bytes = Uint8Array<ArrayBuffer>
  const now = new Date(d.now());
  const expiresAt = input.durationHours === null ? null : new Date(now.getTime() + input.durationHours * 3_600_000);
  const id = newId();
  try {
    await d.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const sameTarget: Prisma.RequestBlockWhereInput = range
        ? { tenantId, ipFrom: range.from, ipTo: range.to }
        : { tenantId, deviceKeyHash: target.kind === "DEVICE" ? target.hash : "" };
      // Aynı hedefin süresi dolmuş satırı yeniden engellemeyi kilitlemesin (UPDATE yetkisi yok → DELETE + INSERT).
      await tx.requestBlock.deleteMany({ where: { ...sameTarget, expiresAt: { lte: now } } });
      if ((await tx.requestBlock.count({ where: { tenantId } })) >= REQUEST_BLOCKS_MAX)
        throw new AppError("CONFLICT", { message: REQUEST_BLOCKS_LIMIT_MESSAGE });
      await tx.requestBlock.create({
        data: {
          id,
          tenantId,
          kind: target.kind,
          ipFrom: range?.from ?? null,
          ipTo: range?.to ?? null,
          deviceKeyHash: target.kind === "DEVICE" ? target.hash : null,
          expiresAt,
          note: input.note ?? null,
          createdBy: auth.user.id,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        tenantId,
        userId: auth.user.id,
        username: auth.user.email,
        action: REQUEST_BLOCK_AUDIT.CREATED,
        entity: "request_blocks",
        entityId: id,
        result: "success",
        newValue: {
          kind: target.kind,
          ...(target.kind === "IP" ? { cidr: target.cidr } : { deviceFingerprint: target.hash.slice(0, 8) }),
          expiresAt: expiresAt?.toISOString() ?? null,
          source: input.source,
          ...(input.source === "REQUEST" ? { requestId: input.requestId } : {}),
          hasNote: input.note !== undefined,
        },
      });
    });
  } catch (err) {
    if (isUnique(err)) {
      // Alan hedefi: IP engelinde `cidr`, cihaz engelinde `target` (formda ilgili alan işaretlenir).
      const field = target.kind === "IP" ? "cidr" : "target";
      throw new AppError("CONFLICT", { message: REQUEST_BLOCK_EXISTS_MESSAGE, fields: { [field]: REQUEST_BLOCK_EXISTS_MESSAGE } });
    }
    throw err;
  } finally {
    d.cache.invalidate(tenantId);
  }
  const row = await d.db.requestBlock.findUniqueOrThrow({ where: { id }, select: itemSelect });
  return toItem(row, d.now());
}

export async function deleteBlock(d: BlockDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  try {
    await d.db.$transaction(async (tx) => {
      const row = await tx.requestBlock.findFirst({
        where: { id, tenantId },
        select: { kind: true, ipFrom: true, ipTo: true, deviceKeyHash: true },
      });
      if (!row || (await tx.requestBlock.deleteMany({ where: { id, tenantId } })).count === 0) throw new AppError("NOT_FOUND");
      await writeAudit(tx, ctx, {
        tenantId,
        userId: auth.user.id,
        username: auth.user.email,
        action: REQUEST_BLOCK_AUDIT.DELETED,
        entity: "request_blocks",
        entityId: id,
        result: "success",
        oldValue: {
          kind: row.kind,
          ...(row.ipFrom && row.ipTo ? { cidr: rangeCidr(row.ipFrom, row.ipTo) } : {}),
          ...(row.deviceKeyHash ? { deviceFingerprint: row.deviceKeyHash.slice(0, 8) } : {}),
        },
      });
    });
  } finally {
    d.cache.invalidate(tenantId);
  }
}

/** Saklama işi (mimari-e11 §6 kararı): süresi `REQUEST_BLOCK_EXPIRED_RETENTION_DAYS`'ten önce dolmuş satırlar (IP kişisel veri). */
export async function purgeExpiredBlocks(db: Db, tenantId: string, cutoff: Date): Promise<number> {
  const r = await db.requestBlock.deleteMany({ where: { tenantId, expiresAt: { lt: cutoff } } });
  return r.count;
}
