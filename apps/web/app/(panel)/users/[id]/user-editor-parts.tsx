"use client";

import { Archive, ArchiveRestore, KeyRound, MonitorX, RotateCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { AvatarUploader } from "@/components/branding/avatar-uploader";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { USER_STALE_WRITE_MESSAGE } from "@/lib/users/contract";
import { userDeleteState } from "@/lib/users/delete";
import { StatusPill } from "../user-list";
import { UserFields } from "../user-fields";
import type { UserEditorState } from "./use-user-editor";

type Ed = UserEditorState;

/** Başlık (ad + rol · e-posta · son giriş) ve sağ üstte pasife al / etkinleştir / sil düğmeleri. */
export function EditorHeader({ ed, canEdit, actorPermissions }: { ed: Ed; canEdit: boolean; actorPermissions: readonly string[] }) {
  const { saved } = ed;
  const meta = [
    t(`role.${saved.role}`),
    saved.email,
    saved.lastLoginAt ? t("us.e.lastLogin", { at: formatDateTime(saved.lastLoginAt) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold break-words text-fg" data-testid="user-name">
          {saved.fullName}
        </h1>
        <p className="mt-1 text-sm break-words text-fg-muted">{meta}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {canEdit && saved.canManage && !saved.isSelf && <StatusButton ed={ed} />}
        <DeleteButton ed={ed} actorPermissions={actorPermissions} />
      </div>
    </div>
  );
}

function StatusButton({ ed }: { ed: Ed }) {
  return ed.active ? (
    <Button variant="danger-ghost" onClick={() => ed.setAction("deactivate")} disabled={ed.busy} data-testid="user-deactivate">
      <Archive aria-hidden className="size-4" />
      {t("us.d.open")}
    </Button>
  ) : (
    <Button variant="secondary" onClick={() => ed.setAction("reactivate")} data-testid="user-reactivate">
      <ArchiveRestore aria-hidden className="size-4" />
      {t("us.r.open")}
    </Button>
  );
}

/* P16 (AC-241): kalıcı silme yalnız `users.delete` ile; etkin kullanıcıda pasif düğme + görünür neden */
function DeleteButton({ ed, actorPermissions }: { ed: Ed; actorPermissions: readonly string[] }) {
  const deleteState = userDeleteState(ed.saved, actorPermissions);
  if (deleteState === "hidden") return null;
  const why = deleteState === "needsPassive";
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="danger-ghost"
        onClick={() => ed.setDeleting(true)}
        disabled={why || ed.busy}
        aria-describedby={why ? "user-delete-why" : undefined}
        data-testid="user-delete"
      >
        <Trash2 aria-hidden className="size-4" />
        {t("us.x.open")}
      </Button>
      {why && (
        <p id="user-delete-why" className="max-w-56 text-xs text-fg-muted" data-testid="user-delete-why">
          {t("us.x.needsPassive")}
        </p>
      )}
    </div>
  );
}

/** Bayat kayıt uyarısı (+ Yeniden yükle), kaydetme hatası ve salt okunur / pasif / kendi hesabı notu. */
export function EditorAlerts({ ed, canEdit }: { ed: Ed; canEdit: boolean }) {
  const { saved, formError } = ed;
  const notice = !canEdit || !saved.canManage ? t("us.e.readonly") : !ed.active ? t("us.e.passive") : saved.isSelf ? t("us.e.self") : null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {ed.stale && (
        <Alert tone="warning" testId="user-stale">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>{USER_STALE_WRITE_MESSAGE}.</p>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              loading={ed.reloading}
              onClick={() => void ed.reload()}
              data-testid="user-reload"
            >
              {!ed.reloading && <RotateCw aria-hidden className="size-4" />}
              {t("us.e.reload")}
            </Button>
          </div>
        </Alert>
      )}
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
  );
}

/** Sol sütun: profil resmi, ad/e-posta/rol, hesap durumu ve 2FA. */
export function ProfileSection({ ed, canEdit }: { ed: Ed; canEdit: boolean }) {
  const { saved } = ed;
  return (
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
        canEdit={canEdit && saved.canManage && ed.active}
      />
      <fieldset disabled={!ed.editable || ed.busy} className="flex flex-col gap-4">
        <UserFields
          mode="edit"
          d={ed.d}
          errors={ed.errors}
          set={ed.set}
          onRole={ed.setRole}
          roleHint={t("us.e.roleHint")}
          roleDisabled={!ed.permsEditable}
        />
      </fieldset>
      <AccountFacts ed={ed} canEdit={canEdit} />
    </section>
  );
}

function AccountFacts({ ed, canEdit }: { ed: Ed; canEdit: boolean }) {
  const { saved } = ed;
  return (
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
      {/* K12: eylem düğmesi dar profil sütununda kendi satırında (tek satır etiket; satır kırılması yok) */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <dt className="min-w-0 flex-1 font-medium text-fg">
          {t("us.e.twofa")}
          <span className="block text-xs font-normal text-fg-muted">{t("us.e.twofaHint")}</span>
        </dt>
        <dd className="shrink-0">
          <span className={`text-sm ${saved.totpEnabled ? "text-success" : "text-fg-muted"}`} data-testid="user-2fa">
            {saved.totpEnabled ? t("us.e.twofaOn") : t("us.e.twofaOff")}
          </span>
        </dd>
        {/* P10 (AC-115): yönetici 2FA sıfırlaması — kendi hesabı hariç, yönetebildiği etkin hesapta */}
        {saved.totpEnabled && canEdit && saved.canManage && !saved.isSelf && ed.active && (
          <dd className="basis-full">
            <Button
              type="button"
              variant="secondary"
              onClick={() => ed.setAction("reset-mfa")}
              disabled={ed.busy}
              data-testid="user-reset-mfa"
            >
              <KeyRound aria-hidden className="size-4" />
              {t("us.m.open")}
            </Button>
          </dd>
        )}
      </div>
      <TrustedDevicesFact ed={ed} canEdit={canEdit} />
    </dl>
  );
}

/**
 * P27a (AC-330): hatırlanan cihaz sayısı (ayrıntı yalnız kullanıcının kendi profilinde) + `users.edit` ile onaylı
 * "Hatırlanan cihazları kaldır"; kendi hesabında düğme yok (profil yolu), sayı 0 iken pasif.
 */
function TrustedDevicesFact({ ed, canEdit }: { ed: Ed; canEdit: boolean }) {
  const { saved } = ed;
  const n = saved.trustedDeviceCount ?? 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <dt className="min-w-0 flex-1 font-medium text-fg">
        {t("acc.td.adminLabel")}
        <span className="block text-xs font-normal text-fg-muted">{t("acc.td.adminHint")}</span>
      </dt>
      <dd className="shrink-0 text-sm text-fg tabular-nums" data-testid="user-td-count">
        {t("acc.td.adminCount", { n: formatNumber(n) })}
      </dd>
      {canEdit && saved.canManage && !saved.isSelf && (
        <dd className="basis-full">
          <Button
            type="button"
            variant="danger-ghost"
            onClick={() => ed.setAction("forget-devices")}
            disabled={ed.busy || n === 0}
            data-testid="user-forget-devices"
          >
            <MonitorX aria-hidden className="size-4" />
            {t("acc.td.adminRemove")}
          </Button>
        </dd>
      )}
    </div>
  );
}

/** Sağ sütun: yetki matrisi (rol açıklaması + canlı uygulanır notu). */
export function PermsSection({ ed }: { ed: Ed }) {
  return (
    <section aria-labelledby="perm-t" className="min-w-0 rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-6">
        <h2 id="perm-t" className="flex items-center gap-2 text-base font-semibold text-fg">
          <ShieldCheck aria-hidden className="size-5 text-fg-muted" />
          {t("us.e.perms")}
        </h2>
        <p className="text-sm text-fg-muted">
          {ed.d.role === "ADMIN" ? t("us.e.permsADMIN") : t("us.e.permsUSER")} {t("us.e.permsLive")}
        </p>
      </div>
      <PermissionMatrix value={ed.perms} onChange={ed.setPerms} locked={ed.locked} disabled={!ed.permsEditable || ed.busy} />
    </section>
  );
}
