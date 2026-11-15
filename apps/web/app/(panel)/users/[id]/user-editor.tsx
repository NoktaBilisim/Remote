"use client";

import { SaveBar } from "@/components/ui/save-bar";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import type { UserDetail } from "@/lib/users/contract";
import { useUserEditor } from "./use-user-editor";
import { DeleteDialog, StatusDialog } from "./user-dialogs";
import { EditorAlerts, EditorHeader, PermsSection, ProfileSection } from "./user-editor-parts";

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
  const { formRef, focusError } = useFocusFirstError();
  const ed = useUserEditor(user, actor, canEdit, focusError);
  return (
    <>
      <EditorHeader ed={ed} canEdit={canEdit} actorPermissions={actor.permissions} />
      <EditorAlerts ed={ed} canEdit={canEdit} />
      <form id={FORM_ID} ref={formRef} onSubmit={ed.submit} noValidate className="mt-4 grid items-start gap-6 xl:grid-cols-[20rem_1fr]">
        <ProfileSection ed={ed} canEdit={canEdit} />
        <PermsSection ed={ed} />
      </form>
      {ed.editable && (
        <SaveBar
          dirty={ed.dirty}
          busy={ed.busy}
          formId={FORM_ID}
          onReset={ed.reset}
          message={t("us.e.unsaved")}
          leaveBody={t("us.e.leaveBody")}
        />
      )}
      <DeleteDialog open={ed.deleting} user={ed.saved} onClose={() => ed.setDeleting(false)} />
      <StatusDialog action={ed.action} user={ed.saved} onClose={() => ed.setAction(null)} onDone={ed.onStatusDone} />
    </>
  );
}
