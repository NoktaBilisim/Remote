"use client";

import { Building, Check, LoaderCircle, LogOut, RotateCw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeMenu, Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { SwitchTenantResponse, TenantListResponse } from "@/lib/users/contract";

type Ref = { id: string; name: string };
type Load = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ok"; items: Ref[] };

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Super Admin firma geçişi (AC-70; POST /admin/switch-tenant). Üst menüde etkin firma göstergesi: ad her genişlikte
 * görünür, dar ekranda kalan yere göre kısaltılır (TO-P9-1/6; tam ad erişilebilir adda ve `title`'da). Liste menü açılınca bir kez yüklenir (GET /admin/tenants, yalnız aktif): yükleniyor / hata +
 * tekrar dene / boş / liste. Seçimde istek → toast + sunucudan yeniden çizim (tüm sayfa yeni bağlamla).
 * Animasyonsuz (sık kullanılan menü).
 */
export function TenantSwitcher({ acting }: { acting: Ref | null }) {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const fetchList = async () => {
    setLoad({ kind: "loading" });
    try {
      const r = await api<TenantListResponse>("GET", "/admin/tenants?status=active&pageSize=100");
      setLoad({ kind: "ok", items: r.items.map((x) => ({ id: x.id, name: x.name })) });
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setLoad({ kind: "error" });
    }
  };

  const go = async (target: Ref | null, el: Element) => {
    setBusy(target?.id ?? "none");
    try {
      const r = await api<SwitchTenantResponse>("POST", "/admin/switch-tenant", { tenantId: target?.id ?? null });
      closeMenu(el);
      toast(r.actingTenant ? t("ts.switched", { name: r.actingTenant.name }) : t("ts.cleared"));
      start(() => router.refresh());
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      toast(t("ts.failed"), "danger");
      setLoad({ kind: "idle" }); // liste bayat olabilir (ör. firma pasife alındı) → bir sonraki açılışta yeniden
    } finally {
      setBusy(null);
    }
  };

  const name = acting?.name ?? t("ts.none");
  return (
    <div className="min-w-0" data-testid="tenant-switcher" data-acting={acting?.id ?? ""}>
      <Menu
        testId="tenant-switcher-menu"
        align="end"
        label={name}
        labelClassName="min-w-0 max-w-48 truncate"
        title={name}
        ariaLabel={acting ? t("ts.trigger", { name: acting.name }) : t("ts.triggerNone")}
        icon={<Building aria-hidden className={`size-4 shrink-0 ${acting ? "text-primary" : "text-warning"}`} />}
        panelLabel={t("ts.panel")}
        onOpen={() => {
          if (load.kind === "idle" || load.kind === "error") void fetchList();
        }}
      >
        <p className="px-3 pt-2 pb-1 text-xs font-medium text-fg-muted">{t("ts.label")}</p>
        {load.kind === "loading" || load.kind === "idle" ? (
          <p role="status" className="flex min-h-11 items-center gap-2 px-3 text-sm text-fg-muted" data-testid="tenant-switcher-loading">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {t("ts.loading")}
          </p>
        ) : load.kind === "error" ? (
          <div className="flex flex-col gap-1 px-1 py-1" data-testid="tenant-switcher-error">
            <p role="alert" className="px-2 text-sm text-danger">
              {t("ts.error")}
            </p>
            <button type="button" className={itemCls} onClick={() => void fetchList()}>
              <RotateCw aria-hidden className="size-4" />
              {t("ts.retry")}
            </button>
          </div>
        ) : load.items.length === 0 ? (
          <p className="flex min-h-11 items-center px-3 text-sm text-fg-muted" data-testid="tenant-switcher-empty">
            {t("ts.empty")}
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto" data-testid="tenant-switcher-list">
            {load.items.map((x) => {
              const current = x.id === acting?.id;
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    className={itemCls}
                    aria-current={current || undefined}
                    disabled={busy !== null || current}
                    onClick={(e) => void go(x, e.currentTarget)}
                  >
                    {busy === x.id ? (
                      <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    ) : (
                      <Check aria-hidden className={`size-4 ${current ? "text-primary" : "invisible"}`} />
                    )}
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-1 border-t border-border pt-1">
          {acting && (
            <button
              type="button"
              className={itemCls}
              disabled={busy !== null}
              onClick={(e) => void go(null, e.currentTarget)}
              data-testid="tenant-switcher-clear"
            >
              {busy === "none" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <LogOut aria-hidden className="size-4" />}
              {t("ts.clear")}
            </button>
          )}
          <Link href="/admin/tenants" className={itemCls} onClick={(e) => closeMenu(e.currentTarget)}>
            <Settings2 aria-hidden className="size-4" />
            {t("ts.manage")}
          </Link>
        </div>
      </Menu>
    </div>
  );
}
