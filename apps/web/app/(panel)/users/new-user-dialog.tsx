"use client";

import { ShieldCheck, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { TemporaryPasswordDialog } from "@/components/temp-password-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import type { CreateUserResponse } from "@/lib/users/contract";
import { buildCreateUser, emptyUserDraft, type Errors, type UserDraft, type UserField } from "@/lib/users/form";
import { applyRoleDefaults, normalize } from "@/lib/users/permissions";
import { forbiddenMessage, serverFieldErrors, UserFields } from "./user-fields";

/** Diyalog formunun durumu ve gönderimi (POST /users); başarıda `created` dolar ve şifre adımına geçilir. */
function useNewUserForm(locked: ReadonlySet<string>, focusError: () => void) {
  const [d, setD] = useState<UserDraft>(emptyUserDraft);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [created, setCreated] = useState<CreateUserResponse | null>(null);

  const set = (k: UserField) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const dirty = d.fullName !== "" || d.email !== "" || d.role !== "USER";

  const onError = (err: unknown) => {
    if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
      const r = serverFieldErrors(err, err.fields);
      setErrors(r.errors);
      focusError();
      if (r.formError) setFormError(r.formError);
    } else if (err instanceof ApiError && err.status === 409) {
      setErrors({ email: err.message || t("us.f.conflict") });
      focusError();
    } else setFormError(toUiError(err, { 403: forbiddenMessage(err) }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = buildCreateUser(d, applyRoleDefaults(d.role, normalize({}), locked));
    if (!r.ok) {
      setErrors(r.errors);
      focusError();
      return;
    }
    setBusy(true);
    try {
      setCreated(await api<CreateUserResponse>("POST", "/users", r.body));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return { d, setD, errors, formError, busy, confirmClose, setConfirmClose, created, set, dirty, submit };
}

/**
 * Yeni kullanıcı (AC-71, 73): ad, e-posta, rol. Yetkiler rol varsayılanı; işlemi yapanın sahip olmadığı anahtar
 * açıkça `false` gider (Admin veremez — sunucu da 403). Başarıda aynı diyalog **geçici şifre** adımına geçer:
 * şifre yalnız bu yanıtta gelir, bileşen kapanınca bellekten düşer, tekrar gösterilmez. Kopyalamadan kapatmaya
 * çalışınca uyarı + "Yine de kapat". Kaydedilmemiş formda kapatma onay ister.
 */
export function NewUserDialog({
  locked,
  onClose,
  onDone,
}: {
  locked: ReadonlySet<string>;
  onClose: () => void;
  /** Şifre adımı kapanınca; `edit` = "Yetkileri düzenle" ile kapandı. */
  onDone: (userId: string, edit: boolean) => void;
}) {
  const { formRef, focusError } = useFocusFirstError();
  const f = useNewUserForm(locked, focusError);
  const requestClose = () => {
    if (f.busy) return;
    if (f.dirty) f.setConfirmClose(true);
    else onClose();
  };

  if (f.created) {
    const created = f.created;
    return (
      <TemporaryPasswordDialog
        password={created.temporaryPassword}
        title={t("us.pw.title", { name: created.user.fullName })}
        description={t("us.pw.desc")}
        secondary={{ label: t("us.pw.editPerms"), Icon: ShieldCheck, testId: "pw-edit-perms" }}
        testId="user-temp-password"
        onDone={(edit) => onDone(created.user.id, edit)}
      />
    );
  }

  return (
    <>
      <Dialog open onClose={onClose} onDismiss={requestClose} testId="user-form" title={t("us.f.newTitle")} description={t("us.f.desc")}>
        <form ref={formRef} onSubmit={f.submit} noValidate className="flex flex-col gap-4">
          {f.formError && <FormError error={f.formError} />}
          <fieldset disabled={f.busy} className="flex flex-col gap-4">
            <UserFields
              mode="new"
              d={f.d}
              errors={f.errors}
              set={f.set}
              onRole={(role) => f.setD((x) => ({ ...x, role }))}
              roleHint={f.d.role === "ADMIN" ? t("us.f.defaultsADMIN") : t("us.f.defaultsUSER")}
            />
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={requestClose} disabled={f.busy}>
              {t("rq.rj.cancel")}
            </Button>
            <Button type="submit" loading={f.busy} data-testid="uf-submit">
              {!f.busy && <UserPlus aria-hidden className="size-4" />}
              {t("us.f.create")}
            </Button>
          </div>
        </form>
      </Dialog>
      <LeaveDialog open={f.confirmClose} onStay={() => f.setConfirmClose(false)} onLeave={onClose} />
    </>
  );
}

/** Kaydedilmemiş formu kapatma onayı ("Kal" / "Vazgeç ve kapat"). */
function LeaveDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onStay}
      role="alertdialog"
      size="sm"
      testId="user-form-leave"
      title={t("us.f.leaveTitle")}
      description={t("us.f.leaveBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onStay} className="sm:ml-auto">
            {t("us.f.stay")}
          </Button>
          <Button
            variant="danger-ghost"
            onClick={() => {
              onStay();
              onLeave();
            }}
          >
            {t("h.n.discard")}
          </Button>
        </>
      }
    />
  );
}
