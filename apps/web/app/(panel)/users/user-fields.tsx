"use client";

import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { ApiError } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { USER_EMAIL_MAX, USER_FULL_NAME_MAX, type ManagedRole } from "@/lib/users/contract";
import { splitServerFields, USER_FIELDS, type Errors, type UserDraft, type UserField } from "@/lib/users/form";
import { forbiddenPermLabels } from "@/lib/users/permissions";

const ROLE_OPTIONS = () => [
  { value: "USER", label: t("us.role.USER") },
  { value: "ADMIN", label: t("us.role.ADMIN") },
];

/**
 * Kullanıcı profil alanları (ad, e-posta, rol) — yeni kullanıcı diyaloğu (`mode="new"`: zorunlu, ilk alana odak,
 * `uf-*`) ve düzenleyici (`mode="edit"`: `ue-*`, rol kilitlenebilir) aynı alanları kullanır.
 */
export function UserFields({
  mode,
  d,
  errors,
  set,
  onRole,
  roleHint,
  roleDisabled,
}: {
  mode: "new" | "edit";
  d: UserDraft;
  errors: Errors<UserField>;
  set: (k: "fullName" | "email") => (e: { target: { value: string } }) => void;
  onRole: (role: ManagedRole) => void;
  roleHint: string;
  roleDisabled?: boolean;
}) {
  const p = mode === "new" ? "uf" : "ue";
  const isNew = mode === "new";
  return (
    <>
      <TextField
        label={t("us.f.fullName")}
        value={d.fullName}
        onChange={set("fullName")}
        error={errors.fullName}
        maxLength={USER_FULL_NAME_MAX}
        autoComplete="off"
        required={isNew || undefined}
        data-autofocus={isNew || undefined}
        data-testid={`${p}-name`}
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
        required={isNew || undefined}
        data-testid={`${p}-email`}
      />
      <SelectField
        label={t("us.f.role")}
        value={d.role}
        disabled={roleDisabled}
        onChange={(e) => onRole(e.target.value as ManagedRole)}
        options={ROLE_OPTIONS()}
        error={errors.role}
        hint={roleHint}
        data-testid={`${p}-role`}
      />
    </>
  );
}

/** Sunucu 400/409 `fields` → alan hataları + form üstü kalan mesaj (yoksa `null`). */
export function serverFieldErrors(err: ApiError, fields: Record<string, string>): { errors: Errors<UserField>; formError: UiError | null } {
  const { errors, rest } = splitServerFields(fields, USER_FIELDS);
  return { errors, formError: rest.length ? { message: rest.join(" "), tone: "danger", requestId: err.requestId } : null };
}

/** AC-73: 403'te verilemeyen yetkiler adıyla (`fields["permissions.<anahtar>"]`), yoksa genel metin. */
export function forbiddenMessage(err: unknown): string {
  const labels = err instanceof ApiError ? forbiddenPermLabels(err.fields) : [];
  return labels.length ? t("us.e.forbiddenGrantKeys", { keys: labels.map((l) => `“${l}”`).join(", ") }) : t("us.e.forbiddenGrant");
}
