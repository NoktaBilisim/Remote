"use client";

import { ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { TemporaryPasswordDialog } from "@/components/temp-password-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { USER_EMAIL_MAX, USER_FULL_NAME_MAX, type CreateUserResponse, type ManagedRole } from "@/lib/users/contract";
import {
  buildCreateUser,
  emptyUserDraft,
  splitServerFields,
  USER_FIELDS,
  type Errors,
  type UserDraft,
  type UserField,
} from "@/lib/users/form";
import { applyRoleDefaults, forbiddenPermLabels, normalize } from "@/lib/users/permissions";

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
  const [d, setD] = useState<UserDraft>(emptyUserDraft);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [created, setCreated] = useState<CreateUserResponse | null>(null);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

  const set = (k: UserField) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const dirty = d.fullName !== "" || d.email !== "" || d.role !== "USER";
  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const perms = applyRoleDefaults(d.role, normalize({}), locked);
    const r = buildCreateUser(d, perms);
    if (!r.ok) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      setCreated(await api<CreateUserResponse>("POST", "/users", r.body));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
        const { errors: fe, rest } = splitServerFields(err.fields, USER_FIELDS);
        setErrors(fe);
        setFocusErr((n) => n + 1);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors({ email: err.message || t("us.f.conflict") });
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err, { 403: forbiddenMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  if (created)
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

  return (
    <>
      <Dialog open onClose={onClose} onDismiss={requestClose} testId="user-form" title={t("us.f.newTitle")} description={t("us.f.desc")}>
        <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
          {formError && <FormError error={formError} />}
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <TextField
              label={t("us.f.fullName")}
              value={d.fullName}
              onChange={set("fullName")}
              error={errors.fullName}
              maxLength={USER_FULL_NAME_MAX}
              autoComplete="off"
              required
              data-autofocus
              data-testid="uf-name"
            />
            <TextField
              label={t("us.f.email")}
              type="email"
              value={d.email}
              onChange={set("email")}
              error={errors.email}
              maxLength={USER_EMAIL_MAX}
              autoComplete="off"
              spellCheck={false}
              required
              data-testid="uf-email"
            />
            <SelectField
              label={t("us.f.role")}
              value={d.role}
              onChange={(e) => setD((x) => ({ ...x, role: e.target.value as ManagedRole }))}
              options={[
                { value: "USER", label: t("us.role.USER") },
                { value: "ADMIN", label: t("us.role.ADMIN") },
              ]}
              error={errors.role}
              hint={d.role === "ADMIN" ? t("us.f.defaultsADMIN") : t("us.f.defaultsUSER")}
              data-testid="uf-role"
            />
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>
              {t("rq.rj.cancel")}
            </Button>
            <Button type="submit" loading={busy} data-testid="uf-submit">
              {!busy && <UserPlus aria-hidden className="size-4" />}
              {t("us.f.create")}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        role="alertdialog"
        size="sm"
        testId="user-form-leave"
        title={t("us.f.leaveTitle")}
        description={t("us.f.leaveBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmClose(false)} className="sm:ml-auto">
              {t("us.f.stay")}
            </Button>
            <Button
              variant="danger-ghost"
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              {t("h.n.discard")}
            </Button>
          </>
        }
      />
    </>
  );
}

/** AC-73: 403'te verilemeyen yetkiler adıyla (`fields["permissions.<anahtar>"]`), yoksa genel metin. */
function forbiddenMessage(err: unknown): string {
  const labels = err instanceof ApiError ? forbiddenPermLabels(err.fields) : [];
  return labels.length ? t("us.e.forbiddenGrantKeys", { keys: labels.map((l) => `“${l}”`).join(", ") }) : t("us.e.forbiddenGrant");
}
