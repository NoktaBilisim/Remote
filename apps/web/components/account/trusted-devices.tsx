"use client";

import { Laptop, MonitorCheck, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { TrustedDeviceListResponse, TrustedDeviceRevokeResponse, TrustedDeviceView } from "@/lib/account/contract";
import { deviceMeta } from "@/lib/account/trusted-devices";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Load = { kind: "loading" } | { kind: "error"; error: UiError } | { kind: "ok"; items: TrustedDeviceView[] };

/** GET /auth/trusted-devices; `reloadKey` değişince (şifre değişimi, tüm cihazlardan çıkış) ve "Yeniden dene"de yeniden. */
function useDeviceList(reloadKey: number) {
  const router = useRouter();
  const [nonce, setNonce] = useState(0);
  const key = `${reloadKey}|${nonce}`;
  const [res, setRes] = useState<{ key: string; state: Load } | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    api<TrustedDeviceListResponse>("GET", "/auth/trusted-devices").then(
      (d) => live && setRes({ key, state: { kind: "ok", items: d.items } }),
      (e: unknown) => {
        if (!live) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        setRes({ key, state: { kind: "error", error: toUiError(e) } });
      },
    );
    return () => {
      live = false;
    };
  }, [key, router]);
  const raw: Load = res?.key === key ? res.state : { kind: "loading" };
  const state: Load = raw.kind === "ok" ? { kind: "ok", items: raw.items.filter((d) => !gone.has(d.id)) } : raw;
  const drop = useCallback((ids: readonly string[]) => setGone((g) => new Set([...g, ...ids])), []);
  return { state, retry: useCallback(() => setNonce((n) => n + 1), []), drop };
}

/** Tek cihazı kaldır (onaysız, satır içi): başarısızsa satır kalır + hata toast'ı (kısmi durum); 404 → zaten kaldırılmış. */
function useRemoveOne(drop: (ids: readonly string[]) => void) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const remove = async (d: TrustedDeviceView) => {
    setPending(d.id);
    try {
      await api<TrustedDeviceRevokeResponse>("DELETE", `/auth/trusted-devices/${d.id}`);
      drop([d.id]);
      toast(t("acc.td.removed"));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 404) {
        drop([d.id]);
        toast(t("acc.td.alreadyGone"));
      } else toast(t("acc.td.removeFailed", { msg: toUiError(e).message }), "danger");
    } finally {
      setPending(null);
    }
  };
  return { pending, remove };
}

/** Tümünü kaldır (onay diyaloğu): hata diyalog içinde kalır. */
function useRemoveAll(items: readonly TrustedDeviceView[], drop: (ids: readonly string[]) => void) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<TrustedDeviceRevokeResponse>("DELETE", "/auth/trusted-devices");
      drop(items.map((d) => d.id));
      setOpen(false);
      toast(t("acc.td.removedAll", { n: r.revoked }));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => !busy && (setOpen(false), setError(null));
  return { open, setOpen, busy, error, run, close };
}

function DeviceRow({ d, pending, onRemove }: { d: TrustedDeviceView; pending: boolean; onRemove: () => void }) {
  const meta = deviceMeta(d);
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center" data-testid="td-row" data-current={d.current || undefined}>
      <Laptop aria-hidden className="hidden size-5 shrink-0 text-fg-muted sm:block" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium break-words text-fg">
          {d.uaSummary}
          {d.current && (
            <span className="rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary" data-testid="td-current">
              {t("acc.td.current")}
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {meta.join(" · ")} · <span className="font-mono break-all">{t("acc.td.ip", { ip: d.ip })}</span>
        </p>
      </div>
      <Button
        variant="danger-ghost"
        className="self-start sm:self-center"
        loading={pending}
        onClick={onRemove}
        aria-label={t("acc.td.removeAria", { name: d.uaSummary })}
        data-testid="td-remove"
      >
        {!pending && <Trash2 aria-hidden className="size-4" />}
        {t("acc.td.remove")}
      </Button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" data-testid="td-loading">
      <span className="sr-only" role="status">
        {t("panel.loading")}
      </span>
      {[0, 1].map((i) => (
        <Skeleton key={i} className="mb-2 h-14 w-full" />
      ))}
    </div>
  );
}

function ListError({ error, retry }: { error: UiError; retry: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="td-error">
      <FormError error={error} />
      <Button variant="secondary" onClick={retry} className="self-start">
        <RotateCw aria-hidden className="size-4" />
        {t("err.retry")}
      </Button>
    </div>
  );
}

function RemoveAllDialog({ all }: { all: ReturnType<typeof useRemoveAll> }) {
  return (
    <Dialog
      open={all.open}
      onClose={all.close}
      role="alertdialog"
      size="sm"
      testId="td-remove-all-dialog"
      title={t("acc.td.confirmTitle")}
      description={t("acc.td.confirmBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={all.close} disabled={all.busy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={all.busy} onClick={() => void all.run()} data-testid="td-remove-all-confirm">
            {!all.busy && <Trash2 aria-hidden className="size-4" />}
            {t("acc.td.removeAll")}
          </Button>
        </>
      }
    >
      {all.error && <FormError error={all.error} />}
    </Dialog>
  );
}

/**
 * Hesabım → "Hatırlanan cihazlar" (AC-329, mimari-p27a §6): kullanıcının 2FA'yı atlatan tarayıcıları; tek tek "Kaldır" ve
 * onaylı "Tümünü kaldır". Durumlar: iskelet (2 satır) · boş · hata + yeniden dene · kısmi (silme başarısız satır kalır) ·
 * başarılı (toast). Yalnız firma kullanıcılarında render edilir (Super Admin cihaz hatırlayamaz, K-P27a-2).
 */
export function TrustedDevices({ reloadKey = 0 }: { reloadKey?: number }) {
  const { state, retry, drop } = useDeviceList(reloadKey);
  const items = state.kind === "ok" ? state.items : [];
  const one = useRemoveOne(drop);
  const all = useRemoveAll(items, drop);
  return (
    <section aria-labelledby="td-h" className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid="acc-td">
      <h2 id="td-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <MonitorCheck aria-hidden className="size-5 text-fg-muted" />
        {t("acc.td")}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t("acc.td.body")}</p>
      <div className="mt-4">
        {state.kind === "loading" && <ListSkeleton />}
        {state.kind === "error" && <ListError error={state.error} retry={retry} />}
        {state.kind === "ok" && items.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-fg-muted" data-testid="td-empty">
            {t("acc.td.empty")}
          </p>
        )}
        {items.length > 0 && (
          <>
            <ul className="divide-y divide-border" aria-label={t("acc.td")}>
              {items.map((d) => (
                <DeviceRow key={d.id} d={d} pending={one.pending === d.id} onRemove={() => void one.remove(d)} />
              ))}
            </ul>
            <Button variant="danger-ghost" className="mt-3" onClick={() => all.setOpen(true)} data-testid="td-remove-all">
              <Trash2 aria-hidden className="size-4" />
              {t("acc.td.removeAll")}
            </Button>
          </>
        )}
      </div>
      <RemoveAllDialog all={all} />
    </section>
  );
}
