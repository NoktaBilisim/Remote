// P14a (AC-217): üretimde saklama işi tenant döngüsünü `jobs/retention.ts` içinde kurar; tüm tenant'ları gezen global
// sarmalayıcılar (anonymizeRequests/anonymizeCustomers/expireIdleBindings) çağrılmadığı için silindi. Eski testler aynı
// davranışı bu yardımcıyla tenant başına (`*Of`) fonksiyonlar üzerinden sınar.
import * as rrepo from "../../src/requests/repo.ts";
import type { RequestService } from "../../src/requests/service.ts";

type PerTenant = (svc: RequestService, t: { tenantId: string; retentionDays: number }, now: Date) => Promise<number>;

export async function forEachRetentionTenant(svc: RequestService, step: PerTenant, now = new Date(svc.d.clock.now())): Promise<number> {
  let total = 0;
  for (const t of await rrepo.retentionTenants(svc.d.db)) total += await step(svc, t, now);
  return total;
}
