import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { SupportRequestList } from "@/lib/requests/contract";
import { getMe, serverGet, type MeState, type ServerResult } from "@/lib/server-api";
import { Forbidden, HistorySection, ListError, PendingSection, RequestFilters, RequestsHeader } from "./page-parts";
import { listPath, parseRequestsQuery, type RequestsQuery } from "./query";

export const metadata: Metadata = { title: t("nav.requests") };

type SP = Record<string, string | string[] | undefined>;
type Me = Extract<MeState, { kind: "ok" }>["me"];

/** Seçili müşteri firmanın adı (combobox etiketi): yüklü listede o firmanın ilk talebinden. */
const selectedNameOf = (q: RequestsQuery, res: ServerResult<SupportRequestList>) =>
  q.customer && q.customer !== "general"
    ? res.kind === "ok"
      ? res.data.items.find((i) => i.customerFirm?.id === q.customer)?.customerFirm?.name
      : undefined
    : undefined;

/** Liste çekilmeden önceki kapılar: yetki yok · Super Admin firma seçmemiş. */
function gate(me: Me, perms: readonly string[]) {
  if (!perms.includes("support_requests.view")) {
    return (
      <div className="mt-6 max-w-xl">
        <Forbidden />
      </div>
    );
  }
  if (me.user.role === "SUPER_ADMIN" && !me.actingTenant) {
    return (
      <div className="mt-6">
        <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("rq.pickTenantBody")} testId="requests-pick-tenant" />
      </div>
    );
  }
  return null;
}

/** Kart menüsü yetkileri (Geçmiş ve kuyruk). */
const cardPerms = (perms: readonly string[]) => ({
  // B-P8c-3: sunucu revoke-binding için customers.edit + support_requests.view ister; menü de ikisini birden arar.
  canRevoke: perms.includes("customers.edit") && perms.includes("support_requests.view"),
  // P15 (AC-235): kart menüsünde "Bu kaynağı engelle" + başlıkta Engellenenler bağlantısı
  canBlock: perms.includes("support_requests.block"),
});

/**
 * /requests — müşteri destek talepleri (P8b-1: AC-146..149, 153, 157). Bekleyenler canlı (istemci + /ws/panel),
 * Geçmiş (son 30 gün, durum filtresi) sunucuda çizilir. Kapsam ve yetki arka uçta da denetlenir (tenantScope).
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const q = parseRequestsQuery(await searchParams);
  const blocked = gate(me.me, perms);
  if (blocked)
    return (
      <>
        <RequestsHeader />
        {blocked}
      </>
    );

  const res = await serverGet<SupportRequestList>(listPath(q));
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  const card = cardPerms(perms);
  return (
    <>
      <RequestsHeader />
      <RequestFilters q={q} selectedName={selectedNameOf(q, res)} />
      {res.kind === "error" ? (
        <ListError status={res.status} />
      ) : q.tab === "history" ? (
        <HistorySection q={q} items={res.data.items} total={res.data.total} {...card} />
      ) : (
        <PendingSection q={q} items={res.data.items} perms={perms} meId={me.me.user.id} {...card} />
      )}
    </>
  );
}
