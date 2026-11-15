import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { UserDetail } from "@/lib/users/contract";
import { UserEditor } from "./user-editor";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!ULID.test(id)) return { title: t("us.nf.title") };
  const r = await serverGet<UserDetail>(`/users/${id}`);
  return { title: r.kind === "ok" ? `${r.data.fullName} · ${t("nav.users")}` : t("nav.users") };
}

const crumbs = (name?: string) => <Breadcrumb items={[{ label: t("nav.users"), href: "/users" }, { label: name ?? t("us.title") }]} />;

const forbidden = () => (
  <Alert tone="warning" testId="users-forbidden">
    {t("us.forbidden")}
  </Alert>
);

/** Breadcrumb + dar uyarı / hata alanı. */
function notice(body: ReactNode) {
  return (
    <>
      {crumbs()}
      <div className="max-w-xl">{body}</div>
    </>
  );
}

/** /users/[id] — kullanıcı düzenleme + yetki toggle ekranı (AC-71..74, 115). Kapsam dışı/yok id → 404 (tek mesaj). */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  if (!ULID.test(id)) notFound();

  if (!perms.includes("users.view")) return notice(forbidden());
  const r = await serverGet<UserDetail>(`/users/${id}`);
  if (r.kind === "error") {
    if (r.status === 401) redirect(EXPIRED_LOGIN_PATH);
    if (r.status === 404) notFound();
    return notice(r.status === 403 ? forbidden() : <LoadError />);
  }
  return (
    <>
      {crumbs(r.data.fullName)}
      <UserEditor user={r.data} actor={{ role: me.me.user.role, permissions: perms }} canEdit={perms.includes("users.edit")} />
    </>
  );
}
