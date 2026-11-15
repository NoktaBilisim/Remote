"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { userEtag, type ManagedRole, type UserDetail } from "@/lib/users/contract";
import { buildUpdateUser, userDraftDirty, userDraftOf, type Errors, type UserDraft, type UserField } from "@/lib/users/form";
import { changedKeys, lockedKeys, normalize, permsForRole, type PermState } from "@/lib/users/permissions";
import { forbiddenMessage, serverFieldErrors } from "../user-fields";

type Actor = { role: string; permissions: readonly string[] };
export type UserAction = "deactivate" | "reactivate" | "reset-mfa";

/** Kayıtlı kayıt + profil taslağı + yetki haritası + alan/form hataları. */
function useUserDraft(user: UserDetail, actor: Actor) {
  const [saved, setSaved] = useState(user);
  const base = useMemo(() => userDraftOf(saved), [saved]);
  const basePerms = useMemo(() => normalize(saved.permissions), [saved]);
  const [d, setD] = useState<UserDraft>(base);
  const [perms, setPerms] = useState<PermState>(basePerms);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const locked = useMemo(() => lockedKeys(actor), [actor]);

  const set = (k: "fullName" | "email") => (e: { target: { value: string } }) => {
    setD((x) => ({ ...x, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const setRole = (role: ManagedRole) => {
    setD((x) => ({ ...x, role }));
    // AC-206: kayıtlı role dönülünce kayıtlı ezmeler geri gelir (kayıtlı harita `basePerms`, taslaktan ayrı)
    setPerms((p) => permsForRole(role, { role: base.role, perms: basePerms }, p, locked));
  };
  const reset = () => {
    setD(base);
    setPerms(basePerms);
    setErrors({});
    setFormError(null);
  };
  /** Sunucudan gelen güncel kayıt taslağın yerine geçer. */
  const adopt = (next: UserDetail) => {
    setSaved(next);
    setD(userDraftOf(next));
    setPerms(normalize(next.permissions));
  };
  const dirty = userDraftDirty(d, base) || changedKeys(perms, basePerms).length > 0;
  const body = () => buildUpdateUser(d, base, perms, basePerms);
  return { saved, d, perms, setPerms, errors, setErrors, formError, setFormError, locked, set, setRole, reset, adopt, dirty, body };
}
type Draft = ReturnType<typeof useUserDraft>;

/** PATCH hatası: 401 → giriş, 409 STALE_WRITE / 428 → bayat, 400/409 `fields` → alanlar, diğeri form üstü. */
function useSaveError(draft: Draft, setStale: (v: boolean) => void, focusError: () => void) {
  const router = useRouter();
  return (err: unknown) => {
    if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
    if (err instanceof ApiError && (err.code === "STALE_WRITE" || err.status === 428)) {
      setStale(true);
      return;
    }
    if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
      const r = serverFieldErrors(err, err.fields);
      draft.setErrors(r.errors);
      if (Object.keys(r.errors).length) focusError();
      if (r.formError) draft.setFormError(r.formError);
    } else draft.setFormError(toUiError(err, { 403: forbiddenMessage(err), 404: t("us.nf.body") }));
  };
}

/** Kaydet (iyimser kilit `If-Match`, AC-206) ve bayat kayıtta "Yeniden yükle". */
function useUserSave(draft: Draft, editable: boolean, focusError: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const onSaveError = useSaveError(draft, setStale, focusError);
  const id = draft.saved.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    draft.setFormError(null);
    const r = draft.body();
    if (!r.ok) {
      draft.setErrors(r.errors);
      focusError();
      return;
    }
    if (Object.keys(r.body).length === 0) return draft.reset();
    setBusy(true);
    try {
      // AC-206: iyimser kilit — okunan sürüm `If-Match` ile gider; araya giren yazımda 409, başlıksız 428
      const next = await api<UserDetail>("PATCH", `/users/${id}`, r.body, undefined, {
        headers: { "If-Match": userEtag(draft.saved.version) },
      });
      draft.adopt(next);
      toast(t("us.e.saved", { name: next.fullName }));
      router.refresh();
    } catch (err) {
      onSaveError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Güncel kaydı alır; taslak (kaydedilmemiş değişiklikler) atılır — üzerine yazmak yerine kullanıcı yeniden düzenler. */
  const reload = async () => {
    setReloading(true);
    try {
      draft.adopt(await api<UserDetail>("GET", `/users/${id}`));
      draft.setErrors({});
      draft.setFormError(null);
      setStale(false);
      toast(t("us.e.reloaded"));
      router.refresh();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      draft.setFormError(toUiError(err, { 404: t("us.nf.body") }));
    } finally {
      setReloading(false);
    }
  };
  return { busy, stale, reloading, submit, reload };
}

/**
 * Kullanıcı düzenleyicinin durumu: taslak (`useUserDraft`), kaydet/yeniden yükle (`useUserSave`), durum ve silme
 * diyalogları (`focusError`: bileşendeki `useFocusFirstError`). Kurallar: kendi rolü/yetkisi değişmez (`isSelf`), yönetilemeyen veya pasif hesap salt okunur.
 */
export function useUserEditor(user: UserDetail, actor: Actor, canEdit: boolean, focusError: () => void) {
  const router = useRouter();
  const draft = useUserDraft(user, actor);
  const [action, setAction] = useState<UserAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { saved } = draft;
  const active = saved.status === "ACTIVE";
  const editable = canEdit && saved.canManage && active;
  const save = useUserSave(draft, editable, focusError);

  const onStatusDone = (next: UserDetail) => {
    setAction(null);
    draft.adopt(next);
    router.refresh();
  };
  return {
    ...draft,
    ...save,
    action,
    setAction,
    deleting,
    setDeleting,
    active,
    editable,
    permsEditable: editable && !saved.isSelf,
    onStatusDone,
  };
}

export type UserEditorState = ReturnType<typeof useUserEditor>;
