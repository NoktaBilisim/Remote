"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { isReactivatePurgeConflict } from "@/lib/tenants/purge";
import type { TenantItem } from "@/lib/users/contract";

export type StatusAction = { kind: "deactivate" | "reactivate"; tenant: TenantItem };

/** Kısa ad onay alanı: yazınca hata temizlenir. */
function useTypedSlug() {
  const [typed, setTyped] = useState("");
  const [typedErr, setTypedErr] = useState<string | undefined>();
  const onTyped = (v: string) => {
    setTyped(v);
    setTypedErr(undefined);
  };
  return { typed, typedErr, setTyped, setTypedErr, onTyped };
}

type FailDeps = {
  router: ReturnType<typeof useRouter>;
  toast: ReturnType<typeof useToast>;
  deact: boolean;
  onClose: () => void;
  setError: (e: UiError) => void;
};

/** 401 → giriş; silme işi çakışması diyalogda; diğer 409 → "zaten" bildirimi + kapat + yenile; kalanlar diyalogda. */
function statusFail({ router, toast, deact, onClose, setError }: FailDeps) {
  return (e: unknown) => {
    if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
    // P16 (AC-242): açık silme işi varken yeniden etkinleştirme 409 → neden diyalogda (iş iptal edilmeli / tamamlanmalı)
    if (isReactivatePurgeConflict(e)) setError({ message: e.message, tone: "danger", requestId: e.requestId });
    else if (e instanceof ApiError && e.status === 409) {
      toast(t(deact ? "tn.d.already" : "tn.r.already"), "danger");
      onClose();
      router.refresh();
    } else setError(toUiError(e));
  };
}

/** Durum değişikliği: pasife almada kısa ad onayı; 409 → "zaten" bildirimi, silme işi çakışması diyalogda. */
function useStatusAction(action: StatusAction | null, onClose: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const { typed, typedErr, setTyped, setTypedErr, onTyped } = useTypedSlug();
  const deact = action?.kind === "deactivate";
  const x = action?.tenant;

  const close = () => {
    if (busy) return;
    setTyped("");
    setTypedErr(undefined);
    setError(null);
    onClose();
  };
  const fail = statusFail({ router, toast, deact, onClose, setError });
  const run = async () => {
    if (!action || !x) return;
    if (deact && typed.trim() !== x.slug) return setTypedErr(t("tn.d.typeMismatch"));
    setBusy(true);
    setError(null);
    try {
      await api<unknown>("POST", `/admin/tenants/${x.id}/${action.kind}`, {});
      toast(t(deact ? "tn.d.done" : "tn.r.done", { name: x.name }));
      setTyped("");
      onClose();
      router.refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, typed, typedErr, deact, x, close, run, onTyped };
}

type S = ReturnType<typeof useStatusAction>;

/** Pasife almanın etkileri + kısa adı yazarak onay (Enter = onayla). */
function DeactivateBody({ s, tenant, listId }: { s: S; tenant: TenantItem; listId: string }) {
  return (
    <>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg" aria-labelledby={listId} data-testid="tenant-deactivate-effects">
        <li>{t("tn.d.e1")}</li>
        <li>{t("tn.d.e2")}</li>
        <li>{t("tn.d.e3")}</li>
        <li>{t("tn.d.e4")}</li>
      </ul>
      <TextField
        label={t("tn.d.typeLabel", { slug: tenant.slug })}
        value={s.typed}
        autoComplete="off"
        spellCheck={false}
        error={s.typedErr}
        disabled={s.busy}
        data-testid="tenant-deactivate-type"
        onChange={(e) => s.onTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void s.run();
          }
        }}
      />
    </>
  );
}

function StatusFooter({ s }: { s: S }) {
  return (
    <>
      <Button variant="secondary" data-autofocus onClick={s.close} disabled={s.busy} className="sm:ml-auto">
        {t("rq.rj.cancel")}
      </Button>
      <Button variant={s.deact ? "danger" : "primary"} loading={s.busy} onClick={() => void s.run()} data-testid="tenant-action-confirm">
        {!s.busy && (s.deact ? <Archive aria-hidden className="size-4" /> : <ArchiveRestore aria-hidden className="size-4" />)}
        {t(s.deact ? "tn.d.confirm" : "tn.r.confirm")}
      </Button>
    </>
  );
}

/**
 * Pasife al (etkiler listesi + kısa adı yazarak onay; odak "Vazgeç") / Yeniden etkinleştir onayı. `alertdialog`.
 */
export function StatusDialog({ action, onClose }: { action: StatusAction | null; onClose: () => void }) {
  const s = useStatusAction(action, onClose);
  const listId = useId();
  const { deact, x, error } = s;
  return (
    <Dialog
      open={action !== null}
      onClose={s.close}
      role="alertdialog"
      size="sm"
      testId={action ? `tenant-${action.kind}-dialog` : undefined}
      title={x ? t(deact ? "tn.d.title" : "tn.r.title", { name: x.name }) : ""}
      description={x ? deact ? <span id={listId}>{t("tn.d.intro")}</span> : t("tn.r.body") : undefined}
      footer={action && <StatusFooter s={s} />}
    >
      {(deact || error) && (
        <div className="flex flex-col gap-4">
          {error && <FormError error={error} />}
          {deact && x && <DeactivateBody s={s} tenant={x} listId={listId} />}
        </div>
      )}
    </Dialog>
  );
}
