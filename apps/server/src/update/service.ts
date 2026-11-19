// P29 güncelleme servisi (mimari-p29 §2 `apps/server/src/update/*`): manifest deposu, servis belirteçleri, politika (K-P29-7) ve
// hız kovaları tek örnekte (`app.updates`, wiring.ts kurar). Rotalar ve WS işleyicileri yalnız buradan geçer.
import type { DeviceUpdateOutbound } from "@remote/contracts/ws-device";
import type { PublishedUpdate } from "@remote/contracts/api/unattended";
import { UPDATE_LIMITS, type UpdateOffer, type UpdatePlatform, type UpdatePolicy } from "@remote/contracts/api/update";
import { tenantActive } from "../bindings/issue-tx.ts";
import type { Db } from "../lib/db.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";
import { slotOf, type ManifestStore, type Offerable } from "./manifest-store.ts";
import { ServiceTokens } from "./service-token.ts";

const HOUR = 3_600_000;
const MIN = 60_000;
/** Müşteri dosyası ref'i (`NoktaDestek-<label>-<ref>.exe`); desen dışı → DB'de bulunamayacak yer tutucu ile aynı sorgu (T-9). */
const REF_PATTERN = /^[a-z2-7]{16}$/;
const NO_REF = "-";

/** `limit + 1` eşikli saatlik/dakikalık sayaçlar (`takeBudget` ile kullanılır; kilit süresi pencereyle aynı). */
const counter = (limit: number, windowMs: number) => new FixedWindowCounter(limit + 1, windowMs, windowMs);

export function createUpdateLimits() {
  const L = UPDATE_LIMITS;
  return {
    checkIp: counter(L.checkPerHourIp, HOUR),
    eventsReqIp: counter(L.eventsRequestsPerHourIp, HOUR),
    eventsIp: counter(L.eventsPerHourIp, HOUR),
    eventsIdentity: counter(L.eventsPerHourIdentity, HOUR),
    serviceFileIp: counter(L.serviceFilePerMinIp, MIN),
    deviceCheck: counter(L.deviceChecksPerHour, HOUR),
    deviceToken: counter(L.deviceTokenRequestsPerHour, HOUR),
    deviceState: counter(L.deviceChecksPerHour, HOUR),
    deviceEvents: counter(L.deviceEventsPerHour, HOUR),
  };
}
export type UpdateLimits = ReturnType<typeof createUpdateLimits>;

export const toOffer = (o: Offerable, policy: UpdatePolicy): UpdateOffer => ({
  manifest: o.bytes.toString("base64"),
  signature: o.signature,
  policy,
});

export class UpdateService {
  readonly store: ManifestStore;
  readonly tokens: ServiceTokens;
  readonly limits: UpdateLimits;
  readonly db: Db;
  readonly metrics: Metrics;
  readonly now: () => number;

  constructor(d: { store: ManifestStore; db: Db; metrics: Metrics; now: () => number }) {
    this.store = d.store;
    this.db = d.db;
    this.metrics = d.metrics;
    this.now = d.now;
    this.limits = createUpdateLimits();
    this.tokens = new ServiceTokens({
      ttlSec: UPDATE_LIMITS.serviceTokenTtlSec,
      maxStreams: UPDATE_LIMITS.serviceFileMaxStreams,
      now: d.now,
    });
  }

  close(): void {
    for (const c of Object.values(this.limits)) c.close();
  }

  /** Tenant politikası (`tenant_settings.client_auto_update`; satır yoksa varsayılan Açık). */
  async tenantPolicy(tenantId: string): Promise<UpdatePolicy> {
    const s = await this.db.tenantSettings.findUnique({ where: { tenantId }, select: { clientAutoUpdate: true } });
    return s?.clientAutoUpdate === false ? "notify" : "auto";
  }

  /**
   * Müşteri dosyası ref'inin politikası (§4.2, r2 T-9): yalnız aktif ref'in tenant'ı kapalıysa `notify`; yok/desen dışı/geçersiz/
   * pasif → `auto`. Desenden bağımsız her istekte aynı paralel sorgu çifti (Genel + müşteri ref'i; `resolveRef` kalıbı).
   */
  async refPolicy(ref: string | undefined): Promise<UpdatePolicy> {
    const key = ref !== undefined && REF_PATTERN.test(ref) ? ref : NO_REF;
    const tenant = {
      select: {
        status: true,
        deletedAt: true,
        settings: { select: { clientAutoUpdate: true } },
        requestSettings: { select: { tenantId: true } },
      },
    } as const;
    const [general, customer] = await Promise.all([
      this.db.tenantRequestSettings.findUnique({ where: { requestRef: key }, select: { tenant } }),
      this.db.customer.findUnique({ where: { requestRef: key }, select: { status: true, tenant } }),
    ]);
    const t = general ? general.tenant : customer?.status === "ACTIVE" && customer.tenant.requestSettings ? customer.tenant : null;
    if (!t || !tenantActive(t)) return "auto";
    return t.settings?.clientAutoUpdate === false ? "notify" : "auto";
  }

  /** Taşınabilir istemci teklifi (§4.2); sunulabilir manifest yoksa null (204). */
  async clientOffer(platform: UpdatePlatform, ref: string | undefined): Promise<UpdateOffer | null> {
    const [o, policy] = await Promise.all([this.store.offer(slotOf("client", platform)), this.refPolicy(ref)]);
    return o ? toOffer(o, policy) : null;
  }

  /** Servis WS teklifi (§4.3): `update.offer` ya da `update.none` (manifest dizini boşken de — servis kuyruğunu açar). */
  async serviceOutbound(tenantId: string): Promise<DeviceUpdateOutbound> {
    const [o, policy] = await Promise.all([this.store.offer("service-windows"), this.tenantPolicy(tenantId)]);
    return o ? { t: "update.offer", ...toOffer(o, policy) } : { t: "update.none" };
  }

  /** `GET /unattended/versions` `published` alanı (sunulabilir manifestler). */
  async published(): Promise<{ service: PublishedUpdate | null; client: Record<UpdatePlatform, PublishedUpdate | null> }> {
    const sum = (o: Offerable | null): PublishedUpdate | null =>
      o ? { version: o.manifest.version, expiresAt: o.manifest.expiresAt } : null;
    const [service, windows, macos, linux] = await Promise.all([
      this.store.offer("service-windows"),
      this.store.offer("client-windows"),
      this.store.offer("client-macos"),
      this.store.offer("client-linux"),
    ]);
    return { service: sum(service), client: { windows: sum(windows), macos: sum(macos), linux: sum(linux) } };
  }

  /** Rozet için yayındaki servis sürümü (yoksa null). */
  async publishedServiceVersion(): Promise<string | null> {
    return (await this.store.offer("service-windows"))?.manifest.version ?? null;
  }
}
