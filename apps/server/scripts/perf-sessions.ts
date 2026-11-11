// Yalnız dev/test: P8 oturum geçmişi performans verisi + ölçüm (mimari §10.3 P8 "10.000 kayıt seed ile ilk sayfa
// < 500 ms", AC-60). Prod seed'e (prisma/seed.ts) GİRMEZ; NODE_ENV=production iken veya PERF_SEED_ALLOW=1 yoksa çalışmaz.
//
// Çalıştırma (apps/server; DATABASE_URL = app kullanıcısı — yalnız DML gerekir):
//   PERF_SEED_ALLOW=1 node scripts/perf-sessions.ts seed      # hedef tenant'a 10.000 oturum (+ gürültü tenant'ı)
//   PERF_SEED_ALLOW=1 node scripts/perf-sessions.ts measure   # liste sorgularının süresi + EXPLAIN ANALYZE
// Env (opsiyonel): PERF_TENANT_SLUG (perf-p8; ör. `demo` verilirse panelden görülebilir), PERF_SESSIONS (10000),
//   PERF_NOISE_SESSIONS (5000, ayrı `perf-p8-noise` tenant'ı — tenant kapsamının indeksle ayrıldığını sınar),
//   PERF_TECHNICIANS (10), PERF_RUNS (7).
// İdempotent: tenant/teknisyenler yoksa oluşturulur; oturum sayısı hedefin altındaysa yalnız eksik kadar eklenir
// (app kullanıcısının support_sessions DELETE yetkisi yok — fazla kayıt silinmez; temiz ölçüm için boş DB kullanın).
// Teknisyenlerin password_hash'i doğrulanamaz bir yer tutucudur ('!perf-no-login'): bu hesaplarla giriş yapılamaz.
// Veri: son 365 güne dağılmış ENDED %75 / EXPIRED %15 / CANCELLED %10; mod AGENT/BROWSER; Türkçe karakterli müşteri
// adları, %40 e-posta, %30 ticket no, %20 not. ACTIVE/PENDING üretilmez (sunucu işleri/açılış süpürmesiyle çakışmasın).
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { ulid } from "ulid";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client.ts";

const DAY = 86_400_000;
const FIRST = ["Ayşe", "Mehmet", "Fatma", "Ali", "Zeynep", "Mustafa", "Emine", "Hüseyin", "Hatice", "İbrahim", "Elif", "Ömer", "Şule", "Çağrı", "Gülşen", "Ümit", "Özge", "Ilgaz"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Güneş"];

/** Tekrarlanabilir veri için küçük PRNG (mulberry32). Güvenlik amaçlı değildir. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PerfSeedOptions {
  slug: string;
  sessions: number;
  technicians: number;
  seed?: number;
  now?: Date;
}

/** Tenant + teknisyenleri hazırlar, oturum sayısını hedefe tamamlar. Dönüş: tenant id, eklenen, toplam. */
export async function seedPerfSessions(db: PrismaClient, o: PerfSeedOptions) {
  const now = o.now ?? new Date();
  const tenant =
    (await db.tenant.findUnique({ where: { slug: o.slug }, select: { id: true } })) ??
    (await db.tenant.create({ data: { id: ulid(), name: `Perf ${o.slug}`, slug: o.slug, settings: { create: {} } }, select: { id: true } }));

  const techIds: string[] = [];
  for (let i = 1; i <= o.technicians; i++) {
    const email = `perf-tech-${i}@${o.slug}.invalid`;
    const u =
      (await db.user.findUnique({ where: { email }, select: { id: true } })) ??
      (await db.user.create({
        data: { id: ulid(), tenantId: tenant.id, email, fullName: `Perf Teknisyen ${i}`, role: "USER", passwordHash: "!perf-no-login", mustChangePassword: false },
        select: { id: true },
      }));
    techIds.push(u.id);
  }

  const existing = await db.supportSession.count({ where: { tenantId: tenant.id } });
  const missing = Math.max(0, o.sessions - existing);
  const rnd = prng((o.seed ?? 8) + existing);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const BATCH = 1000;
  for (let done = 0; done < missing; done += BATCH) {
    const rows: Prisma.SupportSessionCreateManyInput[] = [];
    for (let i = 0; i < Math.min(BATCH, missing - done); i++) {
      const createdAt = new Date(now.getTime() - Math.floor(rnd() * 365 * DAY));
      const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
      const r = rnd();
      const status = r < 0.75 ? "ENDED" : r < 0.9 ? "EXPIRED" : "CANCELLED";
      const base: Prisma.SupportSessionCreateManyInput = {
        id: ulid(createdAt.getTime()),
        tenantId: tenant.id,
        technicianId: pick(techIds),
        tokenHash: randomBytes(32).toString("hex"),
        activeCode: null,
        techVerifyCode: String(Math.floor(rnd() * 10_000)).padStart(4, "0"),
        status,
        createdAt,
        expiresAt,
      };
      if (status === "ENDED") {
        const consumedAt = new Date(createdAt.getTime() + Math.floor(rnd() * 10 * 60_000));
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        rows.push({
          ...base,
          consumedAt,
          mode: rnd() < 0.55 ? "BROWSER" : "AGENT",
          endedAt: new Date(consumedAt.getTime() + Math.floor(5 * 60_000 + rnd() * 3 * 3_600_000)),
          endedBy: pick(["TECH", "TECH", "CUSTOMER", "SYSTEM"] as const),
          endReason: pick(["tech", "customer", "timeout"] as const),
          customerName: name,
          customerEmail: rnd() < 0.4 ? `musteri${Math.floor(rnd() * 1e6)}@example.test` : null,
          ticketNo: rnd() < 0.3 ? `INC-${100000 + Math.floor(rnd() * 900000)}` : null,
          note: rnd() < 0.2 ? `Yazıcı sürücüsü güncellendi; ${name} ile görüşüldü.\nKontrol tamam.` : null,
        });
      } else {
        rows.push({ ...base, endedAt: status === "EXPIRED" ? expiresAt : createdAt, endedBy: status === "EXPIRED" ? "SYSTEM" : "TECH", endReason: status === "EXPIRED" ? "expired" : "cancelled" });
      }
    }
    await db.supportSession.createMany({ data: rows });
  }
  return { tenantId: tenant.id, technicianIds: techIds, inserted: missing, total: existing + missing };
}

// ---- Ölçüm: backend'in liste sorgusunun şekli (repo.listInScope: findMany + count aynı where, Promise.all). ----
const listSelect = {
  id: true,
  status: true,
  mode: true,
  createdAt: true,
  consumedAt: true,
  endedAt: true,
  endedBy: true,
  customerName: true,
  ticketNo: true,
  technician: { select: { id: true, fullName: true } },
} satisfies Prisma.SupportSessionSelect;

export async function listPage(db: PrismaClient, where: Prisma.SupportSessionWhereInput, page = 1, pageSize = 25) {
  const [rows, total] = await Promise.all([
    db.supportSession.findMany({ where, select: listSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.supportSession.count({ where }),
  ]);
  return { rows, total };
}

export function scenarios(tenantId: string, techId: string, now: Date) {
  const d = (days: number) => new Date(now.getTime() - days * DAY);
  return [
    { name: "filtresiz (Admin, tenant kapsamı)", where: { tenantId } },
    { name: "USER kapsamı (technician_id)", where: { tenantId, technicianId: techId } },
    { name: "durum=CANCELLED", where: { tenantId, status: "CANCELLED" } },
    { name: "durum=ACTIVE (0 eşleşme)", where: { tenantId, status: "ACTIVE" } },
    { name: "mod=AGENT", where: { tenantId, mode: "AGENT" } },
    { name: "tarih: son 30 gün", where: { tenantId, createdAt: { gte: d(30), lt: now } } },
    { name: "müşteri contains 'Yılmaz'", where: { tenantId, customerName: { contains: "Yılmaz" } } },
    { name: "müşteri contains 'zzqx' (0 eşleşme)", where: { tenantId, customerName: { contains: "zzqx" } } },
    { name: "SUPER_ADMIN tüm tenant'lar (kapsamsız)", where: {} },
    { name: "teknisyen + durum=ENDED + mod=BROWSER + 90 gün + müşteri 'ay'", where: { tenantId, technicianId: techId, status: "ENDED", mode: "BROWSER", createdAt: { gte: d(90), lt: now }, customerName: { contains: "ay" } } },
  ] satisfies { name: string; where: Prisma.SupportSessionWhereInput }[];
}

async function time<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await fn();
  return [performance.now() - t0, r];
}

const SQL_COLS = "s.id, s.status, s.mode, s.created_at, s.consumed_at, s.ended_at, s.ended_by, s.customer_name, s.ticket_no, s.technician_id";
const EXPLAIN_SQL: Record<string, string> = {
  "filtresiz (Admin, tenant kapsamı)": "s.tenant_id = ?",
  "USER kapsamı (technician_id)": "s.tenant_id = ? AND s.technician_id = ?",
  "durum=CANCELLED": "s.tenant_id = ? AND s.status = 'CANCELLED'",
  "mod=AGENT": "s.tenant_id = ? AND s.mode = 'AGENT'",
  "müşteri contains 'zzqx' (0 eşleşme)": "s.tenant_id = ? AND s.customer_name LIKE '%zzqx%'",
  "SUPER_ADMIN tüm tenant'lar (kapsamsız)": "1 = 1",
};

export async function measure(db: PrismaClient, slug: string, runs: number) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
  const tech = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, email: { startsWith: "perf-tech-1@" } }, select: { id: true } });
  const now = new Date();
  const out: string[] = [];
  const all = [...scenarios(tenant.id, tech.id, now).map((s) => ({ ...s, page: 1 })), { name: "derin sayfa (page=400, skip 9975)", where: { tenantId: tenant.id }, page: 400 }];
  for (const s of all) {
    await listPage(db, s.where, s.page); // ısınma (bağlantı + plan önbelleği)
    const ms: number[] = [];
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const [t, r] = await time(() => listPage(db, s.where, s.page));
      ms.push(t);
      total = r.total;
    }
    ms.sort((a, b) => a - b);
    const med = ms[Math.floor(ms.length / 2)] ?? 0;
    const max = ms.at(-1) ?? 0;
    out.push(`${s.name.padEnd(62)} total=${String(total).padStart(5)}  medyan=${med.toFixed(1)} ms  maks=${max.toFixed(1)} ms`);
  }
  const [tExport, rows] = await time(() => db.supportSession.findMany({ where: { tenantId: tenant.id }, select: listSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
  out.push(`${"CSV ön ölçüm: tüm tenant tek findMany (akışsız)".padEnd(62)} rows=${rows.length}  ${tExport.toFixed(1)} ms`);

  for (const [name, where] of Object.entries(EXPLAIN_SQL)) {
    const params = where.includes("technician_id") ? [tenant.id, tech.id] : where.includes("?") ? [tenant.id] : [];
    const sql = `EXPLAIN ANALYZE SELECT ${SQL_COLS} FROM support_sessions s WHERE ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT 25 OFFSET 0`;
    const plan = await db.$queryRawUnsafe<Record<string, string>[]>(sql, ...params);
    out.push(`\n-- EXPLAIN ANALYZE: ${name}\n${Object.values(plan[0] ?? {})[0] ?? ""}`);
    const cnt = await db.$queryRawUnsafe<Record<string, string>[]>(`EXPLAIN ANALYZE SELECT COUNT(*) FROM support_sessions s WHERE ${where}`, ...params);
    out.push(`-- COUNT: ${String(Object.values(cnt[0] ?? {})[0] ?? "").split("\n").slice(0, 3).join(" | ")}`);
  }
  // Detay zaman çizelgesi (mimari-api P8 §3): audit_logs IX(tenant_id, entity, entity_id, created_at).
  const sess = await db.supportSession.findFirstOrThrow({ where: { tenantId: tenant.id }, select: { id: true } });
  const tl = await db.$queryRawUnsafe<Record<string, string>[]>(
    "EXPLAIN ANALYZE SELECT id, created_at, action FROM audit_logs WHERE tenant_id = ? AND entity = 'support_sessions' AND entity_id = ? AND action IN ('guest.admitted','control.granted','session.ended') ORDER BY created_at, id LIMIT 500",
    tenant.id,
    sess.id,
  );
  out.push(`\n-- EXPLAIN ANALYZE: zaman çizelgesi (audit_logs)\n${Object.values(tl[0] ?? {})[0] ?? ""}`);
  return out.join("\n");
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.PERF_SEED_ALLOW !== "1") {
    throw new Error("perf-sessions yalnız dev/test içindir: PERF_SEED_ALLOW=1 gerekir, NODE_ENV=production iken çalışmaz");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const num = (k: string, d: number) => {
    const v = Number(process.env[k] ?? d);
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) throw new Error(`${k} 0..1000000 tamsayı olmalı`);
    return v;
  };
  const slug = process.env.PERF_TENANT_SLUG?.trim() || "perf-p8";
  const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });
  try {
    const cmd = process.argv[2];
    if (cmd === "seed") {
      const techs = Math.max(1, num("PERF_TECHNICIANS", 10));
      const r = await seedPerfSessions(db, { slug, sessions: num("PERF_SESSIONS", 10_000), technicians: techs });
      process.stdout.write(`perf-sessions: ${slug} eklenen=${r.inserted} toplam=${r.total}\n`);
      const noise = num("PERF_NOISE_SESSIONS", 5_000);
      if (noise > 0) {
        const n = await seedPerfSessions(db, { slug: `${slug}-noise`, sessions: noise, technicians: techs, seed: 99 });
        process.stdout.write(`perf-sessions: ${slug}-noise eklenen=${n.inserted} toplam=${n.total}\n`);
      }
    } else if (cmd === "measure") {
      process.stdout.write(`${await measure(db, slug, Math.max(1, num("PERF_RUNS", 7)))}\n`);
    } else {
      throw new Error("kullanım: node scripts/perf-sessions.ts seed|measure");
    }
  } finally {
    await db.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    process.stderr.write(`perf-sessions: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
