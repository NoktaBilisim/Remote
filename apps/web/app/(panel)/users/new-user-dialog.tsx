"use client";

import { ShieldCheck, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FormDialogActions, FormLeaveDialog, useCloseGuard } from "@/components/form-dialog-parts";
import { FormError } from "@/components/form-error";
import { TemporaryPasswordDialog } from "@/components/temp-password-dialog";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import type { CreateUserResponse } from "@/lib/users/contract";
import { buildCreateUser, emptyUserDraft, type Errors, type UserDraft, type UserField } from "@/lib/users/form";
import { applyRoleDefaults, normalize } from "@/lib/users/permissions";
import { forbiddenMessage, serverFieldErrors, UserFields } from "./user-fields";

/** Kayıt hatası → 400/409 alan hataları (+ form üstü kalan), alansız 409 → e-posta altında, 403 → verilemeyen yetkiler. */
function failHandler(setErrors: (e: Errors<UserField>) => void, setFormError: (e: UiError) => void, focusError: () => void) {
  return (err: unknown) => {
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
}

/** Diyalog formunun durumu ve gönderimi (POST /users); başarıda `created` dolar ve şifre adımına geçilir. */
function useNewUserForm(locked: ReadonlySet<string>, onClose: () => void, focusError: () => void) {
  const [d, setD] = useState<UserDraft>(emptyUserDraft);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateUserResponse | null>(null);
  const guard = useCloseGuard(d.fullName !== "" || d.email !== "" || d.role !== "USER", busy, onClose);
  const onError = failHandler(setErrors, setFormError, focusError);

  const set = (k: UserField) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => ({ ...x, [k]: undefined }));
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
  return { d, setD, errors, formError, busy, guard, created, set, submit };
}

type Props = {
  locked: ReadonlySet<string>;
  onClose: () => void;
  /** Şifre adımı kapanınca; `edit` = "Yetkileri düzenle" ile kapandı. */
  onDone: (userId: string, edit: boolean) => void;
};

/**
 * Yeni kullanıcı (AC-71, 73): ad, e-posta, rol. Yetkiler rol varsayılanı; işlemi yapanın sahip olmadığı anahtar
 * açıkça `false` gider (Admin veremez — sunucu da 403). Başarıda aynı diyalog **geçici şifre** adımına geçer:
 * şifre yalnız bu yanıtta gelir, bileşen kapanınca bellekten düşer, tekrar gösterilmez. Kopyalamadan kapatmaya
 * çalışınca uyarı + "Yine de kapat". Kaydedilmemiş formda kapatma onay ister.
 */
export function NewUserDialog({ locked, onClose, onDone }: Props) {
  const { formRef, focusError } = useFocusFirstError();
  const f = useNewUserForm(locked, onClose, focusError);

  if (f.created) return <PasswordStep created={f.created} onDone={onDone} />;

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        onDismiss={f.guard.requestClose}
        testId="user-form"
        title={t("us.f.newTitle")}
        description={t("us.f.desc")}
      >
        <form ref={formRef} onSubmit={f.submit} noValidate className="flex flex-col gap-4">
          {f.formError && <FormError error={f.formError} />}
          <NewUserFieldset f={f} />
          <FormDialogActions
            busy={f.busy}
            onCancel={f.guard.requestClose}
            submitLabel={t("us.f.create")}
            submitTestId="uf-submit"
            Icon={UserPlus}
          />
        </form>
      </Dialog>
      <FormLeaveDialog
        guard={f.guard}
        testId="user-form-leave"
        title={t("us.f.leaveTitle")}
        body={t("us.f.leaveBody")}
        stayLabel={t("us.f.stay")}
      />
    </>
  );
}

/** Ad, e-posta, rol (rol ipucu seçili rolün varsayılan yetkilerini anlatır). */
function NewUserFieldset({ f }: { f: ReturnType<typeof useNewUserForm> }) {
  return (
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
  );
}

/** Başarı: aynı diyalog geçici şifre adımına geçer ("Yetkileri düzenle" ikincil eylem). */
function PasswordStep({ created, onDone }: { created: CreateUserResponse; onDone: Props["onDone"] }) {
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
