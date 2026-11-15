"use client";

import { Building, LoaderCircle, LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { closeMenu, Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { EXPIRED_LOGIN_PATH, isUnauthenticated, api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { SwitchTenantResponse } from "@/lib/users/contract";
import { loadTenantOptions, TENANT_COMBO_DEBOUNCE_MS } from "@/lib/users/tenant-options";

type Ref = { id: string; name: string };

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Super Admin firma geçişi (AC-70; POST /admin/switch-tenant). Üst menüde etkin firma göstergesi: ad her genişlikte
 * görünür, dar ekranda kalan yere göre kısaltılır (TO-P9-1/6; tam ad erişilebilir adda ve `title`'da).
 * P14b (AC-226): firma listesi aramalı seçici — `GET /admin/tenants/options?q=&limit=20` (sunucu süzer, yalnız aktif
 * firmalar seçilebilir), WAI-ARIA combobox (↑↓ Enter Esc), 250 ms gecikme. Menü açılınca arama alanına odaklanır ve
 * ilk 20 firma listelenir; yükleniyor / hata / boş durumları combobox'ın durum satırında. Seçimde istek → toast +
 * sunucudan yeniden çizim. Animasyonsuz (sık kullanılan menü).
 */
export function TenantSwitcher({ acting }: { acting: Ref | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [comboKey, setComboKey] = useState(0);
  const [, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> => {
      try {
        const items = await loadTenantOptions(q, signal);
        return items
          .filter((x) => x.status === "ACTIVE")
          .map((x) => ({ id: x.id, label: x.name, hint: x.id === acting?.id ? t("ts.current") : undefined }));
      } catch (e) {
        if (isUnauthenticated(e)) router.replace(EXPIRED_LOGIN_PATH);
        throw e;
      }
    },
    [acting?.id, router],
  );

  const go = async (target: Ref | null) => {
    setBusy(target?.id ?? "none");
    try {
      const r = await api<SwitchTenantResponse>("POST", "/admin/switch-tenant", { tenantId: target?.id ?? null });
      closeMenu(boxRef.current?.querySelector("summary") ?? null);
      toast(r.actingTenant ? t("ts.switched", { name: r.actingTenant.name }) : t("ts.cleared"));
      start(() => router.refresh());
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      toast(t("ts.failed"), "danger");
    } finally {
      setBusy(null);
      setComboKey((k) => k + 1); // seçim alanı temiz başlasın (liste bayat olabilir: ör. firma pasife alındı)
    }
  };

  const name = acting?.name ?? t("ts.none");
  return (
    <div className="min-w-0" data-testid="tenant-switcher" data-acting={acting?.id ?? ""} ref={boxRef}>
      <Menu
        testId="tenant-switcher-menu"
        align="end"
        label={name}
        labelClassName="min-w-0 max-w-48 truncate"
        title={name}
        ariaLabel={acting ? t("ts.trigger", { name: acting.name }) : t("ts.triggerNone")}
        icon={<Building aria-hidden className={`size-4 shrink-0 ${acting ? "text-primary" : "text-warning"}`} />}
        panelLabel={t("ts.panel")}
        onOpen={() => requestAnimationFrame(() => inputRef.current?.focus())}
      >
        <div className="w-72 max-w-[calc(100vw-2rem)] px-2 pt-2 pb-1">
          <Combobox
            key={comboKey}
            label={t("ts.label")}
            placeholder={t("ts.searchPh")}
            value={null}
            onChange={(o) => {
              if (o && o.id !== acting?.id) void go({ id: o.id, name: o.label });
            }}
            load={load}
            debounceMs={TENANT_COMBO_DEBOUNCE_MS}
            openOnFocus
            inline
            inputRef={inputRef}
            disabled={busy !== null}
            testId="tenant-switcher-combobox"
          />
          {busy !== null && busy !== "none" && (
            <p role="status" className="flex min-h-11 items-center gap-2 px-1 text-sm text-fg-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {t("ts.switching")}
            </p>
          )}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          {acting && (
            <button
              type="button"
              className={itemCls}
              disabled={busy !== null}
              onClick={() => void go(null)}
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
