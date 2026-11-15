"use client";

import { Archive, ArchiveRestore, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { AvatarUploader } from "@/components/branding/avatar-uploader";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { USER_EMAIL_MAX, USER_FULL_NAME_MAX, type ManagedRole, type UserDetail } from "@/lib/users/contract";
import {
  buildUpdateUser,
  splitServerFields,
  USER_FIELDS,
  userDraftDirty,
  userDraftOf,
  type Errors,
  type UserDraft,
  type UserField,
} from "@/lib/users/form";
import { applyRoleDefaults, changedKeys, forbiddenPermLabels, lockedKeys, normalize, type PermState } from "@/lib/users/permissions";
import { StatusPill } from "../user-list";

const FORM_ID = "user-edit-form";

/**
 * Kullanıcı düzenleme (taslak 07): sol profil (ad, e-posta, rol, hesap durumu, 2FA), sağ yetki matrisi; kirliyken
 * yapışkan kaydet çubuğu + ayrılma uyarısı. Kurallar (sunucuyla aynı): kendi rolü/yetkisi değişmez (`isSelf`),
 * kendinden geniş yetkili hesap yönetilemez (`canManage=false` → salt okunur), işlemi yapanın sahip olmadığı yetki
 * kilitli (AC-73). PATCH yalnız değişen alanları ve değişen anahtarları gönderir; 403'te form korunur.
 */
export function UserEditor({
  user,
  actor,
  canEdit,
}: {
  user: UserDetail;
  actor: { role: string; permissions: readonly string[] };
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(user);
  const base = useMemo(() => userDraftOf(saved), [saved]);
  const basePerms = useMemo(() => normalize(saved.permissions), [saved]);
  const [d, setD] = useState<UserDraft>(base);
  const [perms, setPerms] = useState<PermState>(basePerms);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"deactivate" | "reactivate" | "reset-mfa" | null>(null);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const locked = useMemo(() => lockedKeys(actor), [actor]);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

  const active = saved.status === "ACTIVE";
  const editable = canEdit && saved.canManage && active;
  const permsEditable = editable && !saved.isSelf;
  const dirty = userDraftDirty(d, base) || changedKeys(perms, basePerms).length > 0;

  const set = (k: "fullName" | "email") => (e: { target: { value: string } }) => {
    setD((x) => ({ ...x, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const setRole = (role: ManagedRole) => {
    setD((x) => ({ ...x, role }));
    setPerms((p) => applyRoleDefaults(role, p, locked));
  };
  const reset = () => {
    setD(base);
    setPerms(basePerms);
    setErrors({});
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    setFormError(null);
    const r = buildUpdateUser(d, base, perms, basePerms);
    if (!r.ok) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
      return;
    }
    if (Object.keys(r.body).length === 0) return reset();
    setBusy(true);
    try {
      const next = await api<UserDetail>("PATCH", `/users/${saved.id}`, r.body);
      setSaved(next);
      setD(userDraftOf(next));
      setPerms(normalize(next.permissions));
      toast(t("us.e.saved", { name: next.fullName }));
      router.refresh();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
        const { errors: fe, rest } = splitServerFields(err.fields, USER_FIELDS);
        setErrors(fe);
        if (Object.keys(fe).length) setFocusErr((n) => n + 1);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      } else setFormError(toUiError(err, { 403: forbiddenMessage(err), 404: t("us.nf.body") }));
    } finally {
      setBusy(false);
    }
  };

  const meta = [
    t(`role.${saved.role}`),
    saved.email,
    saved.lastLoginAt ? t("us.e.lastLogin", { at: formatDateTime(saved.lastLoginAt) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const notice = !canEdit || !saved.canManage ? t("us.e.readonly") : !active ? t("us.e.passive") : saved.isSelf ? t("us.e.self") : null;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold break-words text-fg" data-testid="user-name">
            {saved.fullName}
          </h1>
          <p className="mt-1 text-sm break-words text-fg-muted">{meta}</p>
        </div>
        {canEdit &&
          saved.canManage &&
          !saved.isSelf &&
          (active ? (
            <Button variant="danger-ghost" onClick={() => setAction("deactivate")} disabled={busy} data-testid="user-deactivate">
              <Archive aria-hidden className="size-4" />
              {t("us.d.open")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setAction("reactivate")} data-testid="user-reactivate">
              <ArchiveRestore aria-hidden className="size-4" />
              {t("us.r.open")}
            </Button>
          ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {formError && (
          <div data-testid="user-save-error">
            <FormError error={{ ...formError, message: `${t("us.e.saveFailed")}. ${formError.message}` }} />
          </div>
        )}
        {notice && (
          <Alert tone="warning" testId="user-notice">
            {notice}
          </Alert>
        )}
      </div>

      <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate className="mt-4 grid items-start gap-6 xl:grid-cols-[20rem_1fr]">
        <section aria-labelledby="prof-t" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 id="prof-t" className="flex items-center gap-2 text-base font-semibold text-fg">
            <UserRound aria-hidden className="size-5 text-fg-muted" />
            {t("us.e.profile")}
          </h2>
          {/* P12 (AC-83): yönetici, yönetebildiği etkin kullanıcının profil resmini değiştirir/kaldırır (kendi hesabı dahil) */}
          <AvatarUploader
            userId={saved.id}
            name={saved.fullName}
            avatarUrl={saved.avatarUrl ?? null}
            canEdit={canEdit && saved.canManage && active}
          />
          <fieldset disabled={!editable || busy} className="flex flex-col gap-4">
            <TextField
              label={t("us.f.fullName")}
              value={d.fullName}
              onChange={set("fullName")}
              error={errors.fullName}
              maxLength={USER_FULL_NAME_MAX}
              autoComplete="off"
              data-testid="ue-name"
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
              data-testid="ue-email"
            />
            <SelectField
              label={t("us.f.role")}
              value={d.role}
              disabled={!permsEditable}
              onChange={(e) => setRole(e.target.value as ManagedRole)}
              options={[
                { value: "USER", label: t("us.role.USER") },
                { value: "ADMIN", label: t("us.role.ADMIN") },
              ]}
              error={errors.role}
              hint={t("us.e.roleHint")}
              data-testid="ue-role"
            />
          </fieldset>
          <dl className="flex flex-col gap-3 border-t border-border pt-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="font-medium text-fg">
                {t("us.e.account")}
                <span className="block text-xs font-normal text-fg-muted">{t("us.e.accountHint")}</span>
              </dt>
              <dd>
                <StatusPill status={saved.status} testId="user-status" />
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="font-medium text-fg">
                {t("us.e.twofa")}
                <span className="block text-xs font-normal text-fg-muted">{t("us.e.twofaHint")}</span>
              </dt>
              <dd className="flex flex-col items-end gap-2">
                <span className={`text-sm ${saved.totpEnabled ? "text-success" : "text-fg-muted"}`} data-testid="user-2fa">
                  {saved.totpEnabled ? t("us.e.twofaOn") : t("us.e.twofaOff")}
                </span>
                {/* P10 (AC-115): yönetici 2FA sıfırlaması — kendi hesabı hariç, yönetebildiği etkin hesapta */}
                {saved.totpEnabled && canEdit && saved.canManage && !saved.isSelf && active && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAction("reset-mfa")}
                    disabled={busy}
                    data-testid="user-reset-mfa"
                  >
                    <KeyRound aria-hidden className="size-4" />
                    {t("us.m.open")}
                  </Button>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="perm-t" className="min-w-0 rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-6">
            <h2 id="perm-t" className="flex items-center gap-2 text-base font-semibold text-fg">
              <ShieldCheck aria-hidden className="size-5 text-fg-muted" />
              {t("us.e.perms")}
            </h2>
            <p className="text-sm text-fg-muted">
              {d.role === "ADMIN" ? t("us.e.permsADMIN") : t("us.e.permsUSER")} {t("us.e.permsLive")}
            </p>
          </div>
          <PermissionMatrix value={perms} onChange={setPerms} locked={locked} disabled={!permsEditable || busy} />
        </section>
      </form>

      {editable && (
        <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("us.e.unsaved")} leaveBody={t("us.e.leaveBody")} />
      )}

      <StatusDialog
        action={action}
        user={saved}
        onClose={() => setAction(null)}
        onDone={(next) => {
          setAction(null);
          setSaved(next);
          setD(userDraftOf(next));
          setPerms(normalize(next.permissions));
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Pasife al / yeniden etkinleştir onayı (`alertdialog`, varsayılan odak "Vazgeç"). Pasife alma metni etkisini söyler:
 * tüm oturumlar kapanır, açık destek oturumları sonlanır (AC-115). Başarıda güncel kayıt GET ile alınır.
 */
function StatusDialog({
  action,
  user,
  onClose,
  onDone,
}: {
  action: "deactivate" | "reactivate" | "reset-mfa" | null;
  user: UserDetail;
  onClose: () => void;
  onDone: (u: UserDetail) => void;
}) {
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
              {!busy &&
                (mfa ? (
                  <KeyRound aria-hidden className="size-4" />
                ) : deact ? (
                  <Archive aria-hidden className="size-4" />
                ) : (
                  <ArchiveRestore aria-hidden className="size-4" />
                ))}
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

/** AC-73: 403'te verilemeyen yetkiler adıyla (`fields["permissions.<anahtar>"]`), yoksa genel metin. */
function forbiddenMessage(err: unknown): string {
  const labels = err instanceof ApiError ? forbiddenPermLabels(err.fields) : [];
  return labels.length ? t("us.e.forbiddenGrantKeys", { keys: labels.map((l) => `“${l}”`).join(", ") }) : t("us.e.forbiddenGrant");
}
