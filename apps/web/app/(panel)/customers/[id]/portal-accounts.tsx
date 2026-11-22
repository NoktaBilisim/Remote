"use client";

import type {
  PortalAccountCreateResponse,
  PortalAccountItem,
  PortalAccountListResponse,
  PortalPasswordResetResponse,
} from "@remote/contracts/api/portal";
import { Archive, ArchiveRestore, Ellipsis, Hourglass, KeyRound, Link2, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CopyLink } from "@/components/copy-link";
import { FormDialogActions, FormLeaveDialog, useCloseGuard } from "@/components/form-dialog-parts";
import { FormError } from "@/components/form-error";
import { LoadError } from "@/components/load-error";
import { TemporaryPasswordDialog } from "@/components/temp-password-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { closeMenu, Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { accountBadges, createState, validateAccount, type AccountBadge } from "@/lib/portal/accounts";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "forbidden" } | { kind: "ok"; data: PortalAccountListResponse };

const base = (customerId: string) => `/customers/${customerId}/portal-accounts`;

function useAccounts(customerId: string) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    api<PortalAccountListResponse>("GET", base(customerId)).then(
      (data) => live && setLoad({ kind: "ok", data }),
      (e: unknown) => {
        if (!live) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        setLoad({ kind: e instanceof ApiError && e.status === 403 ? "forbidden" : "error" });
      },
    );
    return () => {
      live = false;
    };
  }, [customerId, nonce, router]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setNonce((n) => n + 1);
  }, []);
  return { load, reload, retry };
}

const BADGE: Record<AccountBadge, { cls: string; key: MessageKey; Icon: typeof KeyRound }> = {
  mfa: { cls: "bg-success-surface text-success", key: "pa.mfa", Icon: ShieldCheck },
  mustChange: { cls: "bg-accent-surface text-accent-fg", key: "pa.mustChange", Icon: KeyRound },
  tempExpired: { cls: "bg-warning-surface text-warning", key: "pa.tempExpired", Icon: Hourglass },
};
const pill = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

function AccountBadges({ a }: { a: PortalAccountItem }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span
        data-testid="pa-status"
        className={`${pill} ${a.status === "ACTIVE" ? "bg-success-surface text-success" : "bg-surface-muted text-fg-muted"}`}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {t(`pa.st.${a.status}`)}
      </span>
      {accountBadges(a).map((b) => {
        const { cls, key, Icon } = BADGE[b];
        return (
          <span key={b} className={`${pill} ${cls}`} data-testid={`pa-badge-${b}`}>
            <Icon aria-hidden className="size-3.5" />
            {t(key)}
          </span>
        );
      })}
    </span>
  );
}

type Act = { kind: "deactivate" | "reset"; account: PortalAccountItem };

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";

function RowMenu({
  a,
  busy,
  onAct,
  onReactivate,
}: {
  a: PortalAccountItem;
  busy: boolean;
  onAct: (x: Act) => void;
  onReactivate: () => void;
}) {
  const pick = (e: React.MouseEvent<HTMLButtonElement>, fn: () => void) => {
    closeMenu(e.currentTarget);
    fn();
  };
  return (
    <Menu
      align="end"
      label={t("pa.col.actions")}
      ariaLabel={t("pa.actions", { name: a.fullName })}
      icon={<Ellipsis aria-hidden className="size-4" />}
      labelClassName="sr-only"
      testId="pa-menu"
    >
      {a.status === "ACTIVE" ? (
        <>
          <button
            type="button"
            className={itemCls}
            disabled={busy}
            onClick={(e) => pick(e, () => onAct({ kind: "reset", account: a }))}
            data-testid="pa-reset"
          >
            <KeyRound aria-hidden className="size-4" />
            {t("pa.reset")}
          </button>
          <button
            type="button"
            className={`${itemCls} text-danger`}
            disabled={busy}
            onClick={(e) => pick(e, () => onAct({ kind: "deactivate", account: a }))}
            data-testid="pa-deactivate"
          >
            <Archive aria-hidden className="size-4" />
            {t("pa.deact")}
          </button>
        </>
      ) : (
        <button type="button" className={itemCls} disabled={busy} onClick={(e) => pick(e, onReactivate)} data-testid="pa-reactivate">
          <ArchiveRestore aria-hidden className="size-4" />
          {t("pa.react")}
        </button>
      )}
    </Menu>
  );
}

function AccountList({
  items,
  busy,
  onAct,
  onReactivate,
}: {
  items: PortalAccountItem[];
  busy: boolean;
  onAct: (x: Act) => void;
  onReactivate: (a: PortalAccountItem) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" data-testid="pa-list">
      {items.map((a) => (
        <li key={a.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid="pa-row" data-status={a.status}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-medium text-fg wrap-anywhere">{a.fullName}</span>
            <span className="text-sm text-fg-muted wrap-anywhere">{a.email}</span>
            <AccountBadges a={a} />
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs text-fg-muted tabular-nums">
              <span className="sr-only">{t("pa.col.lastLogin")}: </span>
              {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : t("pa.never")}
            </span>
            <RowMenu a={a} busy={busy} onAct={onAct} onReactivate={() => onReactivate(a)} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CreateDialog({
  customerId,
  onClose,
  onCreated,
}: {
  customerId: string;
  onClose: () => void;
  onCreated: (r: PortalAccountCreateResponse) => void;
}) {
  const router = useRouter();
  const [v, setV] = useState({ fullName: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useCloseGuard(Boolean(v.fullName || v.email), busy, onClose);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = validateAccount(v);
    setErrors(r.errors);
    setFailure(null);
    if (!r.body) return;
    setBusy(true);
    try {
      onCreated(await api<PortalAccountCreateResponse>("POST", base(customerId), r.body));
    } catch (err) {
      setBusy(false);
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      if (!(err instanceof ApiError && err.fields?.email)) setFailure(toUiError(err));
    }
  };
  const field = (k: "fullName" | "email") => ({
    name: k,
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value })),
    error: errors[k],
    disabled: busy,
  });
  return (
    <>
      <Dialog
        open
        onClose={guard.requestClose}
        onDismiss={guard.requestClose}
        title={t("pa.createTitle")}
        description={t("pa.createDesc")}
        testId="pa-create-dialog"
      >
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <FormError error={failure} />
          <TextField label={t("pa.f.fullName")} autoComplete="off" required data-autofocus {...field("fullName")} data-testid="pa-f-name" />
          <TextField
            label={t("pa.f.email")}
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            {...field("email")}
            data-testid="pa-f-email"
          />
          <FormDialogActions
            busy={busy}
            onCancel={guard.requestClose}
            submitLabel={t("pa.create")}
            submitTestId="pa-create-submit"
            Icon={UserPlus}
          />
        </form>
      </Dialog>
      <FormLeaveDialog
        guard={guard}
        testId="pa-create-leave"
        title={t("pa.createTitle")}
        body={t("pa.leaveBody")}
        stayLabel={t("pa.leaveStay")}
      />
    </>
  );
}

function ConfirmDialog({
  act,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  act: Act | null;
  busy: boolean;
  error: UiError | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const deact = act?.kind === "deactivate";
  const name = act?.account.fullName ?? "";
  return (
    <Dialog
      open={act !== null}
      onClose={() => !busy && onClose()}
      role="alertdialog"
      size="sm"
      testId={act ? `pa-${act.kind}-dialog` : undefined}
      title={act ? t(deact ? "pa.deactTitle" : "pa.resetTitle", { name }) : ""}
      description={act ? t(deact ? "pa.deactBody" : "pa.resetBody") : undefined}
      footer={
        act && (
          <>
            <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy} className="sm:ml-auto">
              {t("pa.cancel")}
            </Button>
            <Button variant={deact ? "danger" : "primary"} loading={busy} onClick={onConfirm} data-testid="pa-confirm">
              {!busy && (deact ? <Archive aria-hidden className="size-4" /> : <KeyRound aria-hidden className="size-4" />)}
              {t(deact ? "pa.deact" : "pa.resetConfirm")}
            </Button>
          </>
        )
      }
    >
      {deact && (
        <Alert tone="warning" testId="pa-deact-note">
          {t("pa.deactNote")}
        </Alert>
      )}
      {error && <FormError error={error} />}
    </Dialog>
  );
}

/** Hesap eylemleri: pasife al / şifre sıfırla (onaylı), etkinleştir (doğrudan). 409 → liste yenilenir + toast. */
function useActions(customerId: string, reload: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [act, setAct] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const post = async <T,>(a: PortalAccountItem, path: string): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await api<T>("POST", `${base(customerId)}/${a.id}/${path}`, {});
    } catch (e) {
      if (isUnauthenticated(e)) router.replace(EXPIRED_LOGIN_PATH);
      else if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        toast(e.message || t("pa.err.conflict"), "danger");
        setAct(null);
        reload();
      } else setError(toUiError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!act) return;
    const a = act.account;
    if (act.kind === "deactivate") {
      if (await post<PortalAccountItem>(a, "deactivate")) {
        toast(t("pa.deactDone"));
        setAct(null);
        reload();
      }
      return;
    }
    const r = await post<PortalPasswordResetResponse>(a, "reset-password");
    if (r) {
      setAct(null);
      setTemp({ name: a.fullName, password: r.temporaryPassword });
      reload();
    }
  };
  const reactivate = async (a: PortalAccountItem) => {
    if (await post<PortalAccountItem>(a, "reactivate")) {
      toast(t("pa.reactDone"));
      reload();
    }
  };
  const open = (x: Act) => {
    setError(null);
    setAct(x);
  };
  return { act, busy, error, temp, setTemp, confirm, reactivate, open, close: () => setAct(null) };
}

function Header({ loginUrl, create, onCreate }: { loginUrl: string; create: ReturnType<typeof createState>; onCreate: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" data-testid="pa-login-url">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Link2 aria-hidden className="size-4 text-fg-muted" />
          {t("pa.loginUrl")}
        </p>
        <code className="font-mono text-sm text-fg break-all" data-testid="pa-login-url-value">
          {loginUrl}
        </code>
        <p className="text-xs text-fg-muted">{t("pa.loginUrlHint")}</p>
        <CopyLink url={loginUrl} srLabel={t("pa.copyUrl")} testId="pa-login-url-copy" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          onClick={onCreate}
          disabled={!create.enabled}
          className="self-start"
          data-testid="pa-create"
          aria-describedby={create.reason ? "pa-create-reason" : undefined}
        >
          <UserPlus aria-hidden className="size-4" />
          {t("pa.create")}
        </Button>
        {create.reason && (
          <p id="pa-create-reason" className="text-sm text-fg-muted" data-testid="pa-create-reason">
            {create.reason}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Müşteri → "Portal hesapları" (AC-262; mimari-p21 §6; yalnız `customers.portal`): portal adresi (kopyala), liste (durum,
 * 2FA, "Geçici şifre süresi doldu" rozeti, son giriş), Hesap oluştur → geçici şifre (bir kez), Pasife al (onaylı; S-P21-10 notu),
 * Etkinleştir, Şifreyi sıfırla (onaylı → geçici şifre). 403 → bölüm gizlenir (yetki sonradan alındıysa).
 */
export function PortalAccounts({ customerId, customerActive }: { customerId: string; customerActive: boolean }) {
  const toast = useToast();
  const { load, reload, retry } = useAccounts(customerId);
  const x = useActions(customerId, reload);
  const [creating, setCreating] = useState(false);
  if (load.kind === "forbidden") return null;
  const items = load.kind === "ok" ? load.data.items : [];
  const create = createState(customerActive, items.length);
  return (
    <section
      id="portal-hesaplari"
      aria-labelledby="portal-hesaplari-h"
      className="flex flex-col gap-3 border-t border-border pt-6"
      data-testid="portal-accounts"
    >
      <h2 id="portal-hesaplari-h" className="flex items-center gap-2 text-lg font-semibold text-fg">
        <KeyRound aria-hidden className="size-5 text-primary" />
        {t("pa.title")}
      </h2>
      <p className="text-sm text-fg-muted">{t("pa.desc")}</p>
      {load.kind === "loading" && (
        <div aria-busy="true" data-testid="pa-loading" className="flex flex-col gap-2">
          <span className="sr-only">{t("panel.loading")}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {load.kind === "error" && <LoadError onRetry={retry} />}
      {load.kind === "ok" && (
        <>
          <Header loginUrl={load.data.loginUrl} create={create} onCreate={() => setCreating(true)} />
          {x.error && !x.act && <FormError error={x.error} />}
          {items.length === 0 ? (
            <EmptyState Icon={KeyRound} title={t("pa.empty")} body={t("pa.emptyBody")} testId="pa-empty" />
          ) : (
            <AccountList items={items} busy={x.busy} onAct={x.open} onReactivate={(a) => void x.reactivate(a)} />
          )}
        </>
      )}
      {creating && (
        <CreateDialog
          customerId={customerId}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            toast(t("pa.created"));
            x.setTemp({ name: r.account.fullName, password: r.temporaryPassword });
            reload();
          }}
        />
      )}
      <ConfirmDialog act={x.act} busy={x.busy} error={x.error} onClose={x.close} onConfirm={() => void x.confirm()} />
      {x.temp && (
        <TemporaryPasswordDialog
          password={x.temp.password}
          title={t("pa.pwTitle", { name: x.temp.name })}
          description={t("pa.pwDesc")}
          testId="pa-temp-password"
          onDone={() => x.setTemp(null)}
        />
      )}
    </section>
  );
}
