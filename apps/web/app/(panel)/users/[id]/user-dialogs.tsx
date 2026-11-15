"use client";

import { Archive, ArchiveRestore, KeyRound, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { ConfirmNameDialog } from "@/components/ui/confirm-name-dialog";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { userEtag, type UserDetail } from "@/lib/users/contract";
import { userDeleteErrorOf } from "@/lib/users/delete";
import type { UserAction } from "./use-user-editor";

/** Pasife al / etkinleştir / 2FA sıfırla isteği; başarıda güncel kayıt GET ile alınır, 409'da "zaten" bildirimi. */
function useStatusRun(action: UserAction | null, user: UserDetail, onClose: () => void, onDone: (u: UserDetail) => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const deact = action === "deactivate";
  const mfa = action === "reset-mfa";
  const k = mfa ? "us.m" : deact ? "us.d" : "us.r";

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await api<unknown>("POST", `/users/${user.id}/${action}`, {});
      const next = await api<UserDetail>("GET", `/users/${user.id}`);
      toast(t(`${k}.done` as "us.d.done", { name: user.fullName }));
      onDone(next);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 409) {
        toast(t(mfa ? "us.m.already" : deact ? "us.d.already" : "us.r.already"), "danger");
        onClose();
        router.refresh();
      } else setError(toUiError(e, { 404: t("us.nf.body") }));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, deact, mfa, k, run };
}

/**
 * Pasife al / yeniden etkinleştir onayı (`alertdialog`, varsayılan odak "Vazgeç"). Pasife alma metni etkisini söyler:
 * tüm oturumlar kapanır, açık destek oturumları sonlanır (AC-115). Başarıda güncel kayıt GET ile alınır.
 */
export function StatusDialog({
  action,
  user,
  onClose,
  onDone,
}: {
  action: UserAction | null;
  user: UserDetail;
  onClose: () => void;
  onDone: (u: UserDetail) => void;
}) {
  const { busy, error, setError, deact, mfa, k, run } = useStatusRun(action, user, onClose, onDone);
  const Icon = mfa ? KeyRound : deact ? Archive : ArchiveRestore;
  return (
    <Dialog
      open={action !== null}
      onClose={() => {
        if (!busy) {
          setError(null);
          onClose();
        }
      }}
      role="alertdialog"
      size="sm"
      testId={action ? `user-${action}-dialog` : undefined}
      title={action ? t(`${k}.title` as "us.d.title", { name: user.fullName }) : ""}
      description={action ? t(`${k}.body` as "us.d.body") : undefined}
      footer={
        action && (
          <>
            <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button
              variant={deact || mfa ? "danger" : "primary"}
              loading={busy}
              onClick={() => void run()}
              data-testid="user-action-confirm"
            >
              {!busy && <Icon aria-hidden className="size-4" />}
              {t(`${k}.confirm` as "us.d.confirm")}
            </Button>
          </>
        )
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}

/** Kalıcı silme isteği (If-Match + step-up, lib/api); hata türüne göre alan / diyalog / bayat kayıt. */
function useUserDelete(user: UserDetail, onClose: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [stale, setStale] = useState(false);

  const close = () => {
    setError(null);
    setFieldError(undefined);
    setStale(false);
    onClose();
  };
  const run = async (confirmName: string) => {
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      await api<void>("DELETE", `/users/${user.id}`, { confirmName }, undefined, { headers: { "If-Match": userEtag(user.version) } });
      toast(t("us.x.done"));
      close();
      router.replace("/users");
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = userDeleteErrorOf(e, t("us.x.notFound"));
      if (m?.kind === "field") setFieldError(m.message);
      else {
        setStale(m?.kind === "stale");
        setError(m ? { message: m.message, tone: "danger", requestId: e instanceof ApiError ? e.requestId : undefined } : toUiError(e));
      }
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fieldError, setFieldError, stale, close, run };
}

/**
 * P16 (AC-241): kalıcı silme — ad yazarak onay → DELETE (If-Match + step-up, lib/api) → 204 → liste + toast. Hatalar
 * diyalog içinde (`role=alert`): 409 (aktif / açık oturum), 404, step-up vazgeçme; bayat kayıtta "Sayfayı yenile".
 */
export function DeleteDialog({ open, user, onClose }: { open: boolean; user: UserDetail; onClose: () => void }) {
  const { busy, error, fieldError, setFieldError, stale, close, run } = useUserDelete(user, onClose);
  return (
    <ConfirmNameDialog
      open={open}
      onClose={close}
      testId="user-delete-dialog"
      title={t("us.x.title", { name: user.fullName })}
      description={t("us.x.body")}
      expectedName={user.fullName}
      confirmLabel={t("us.x.confirm")}
      busy={busy}
      error={error}
      fieldError={fieldError}
      onTyped={() => setFieldError(undefined)}
      errorAction={
        stale && (
          <Button variant="secondary" className="self-start" onClick={() => window.location.reload()} data-testid="user-delete-reload">
            <RotateCw aria-hidden className="size-4" />
            {t("us.x.reload")}
          </Button>
        )
      }
      onConfirm={(name) => void run(name)}
    />
  );
}
