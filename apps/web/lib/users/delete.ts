/*
 * P16 (AC-237/241): kullanıcı kalıcı silme — düğme görünürlüğü ve hata eşlemesi (saf; vitest `lib/p16.test.ts`).
 * Uç: DELETE /users/:id `{confirmName}` + `If-Match: userEtag(version)` + step-up (lib/api).
 */
import { ApiError } from "@/lib/api";
import { USER_DELETE_CONFIRM_MISMATCH_MESSAGE, USER_STALE_WRITE_MESSAGE, type UserDetail } from "./contract";

/** "Kalıcı sil" düğmesi: yok (`hidden`), pasif + neden (`needsPassive`) ya da etkin. */
export function userDeleteState(
  u: Pick<UserDetail, "status" | "canManage" | "isSelf">,
  permissions: readonly string[],
): "hidden" | "needsPassive" | "enabled" {
  if (!permissions.includes("users.delete") || !u.canManage || u.isSelf) return "hidden";
  return u.status === "ACTIVE" ? "needsPassive" : "enabled";
}

/** DELETE /users/:id hatası → diyalog içi gösterim: ad alanı, bayat kayıt (yeniden yükle) ya da genel mesaj. */
export type UserDeleteError =
  { kind: "field"; message: string } | { kind: "stale"; message: string } | { kind: "message"; message: string };

export function userDeleteErrorOf(e: unknown, notFound: string): UserDeleteError | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 400 && e.fields?.confirmName)
    return { kind: "field", message: e.fields.confirmName || USER_DELETE_CONFIRM_MISMATCH_MESSAGE };
  if (e.code === "STALE_WRITE" || e.status === 428) return { kind: "stale", message: `${USER_STALE_WRITE_MESSAGE}.` };
  if (e.status === 404) return { kind: "message", message: notFound };
  if (e.status === 409 || e.status === 403 || e.status === 401) return { kind: "message", message: e.message };
  return null;
}
