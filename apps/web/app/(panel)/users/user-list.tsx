import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { UserListItem } from "@/lib/users/contract";

/** Aktif/Pasif hapı: renk tek başına anlam taşımaz — metin + nokta (müşteri rozetiyle aynı görünüm). Firmalarda da kullanılır. */
export function StatusPill({ status, testId = "status-pill" }: { status: "ACTIVE" | "PASSIVE"; testId?: string }) {
  const cls = status === "ACTIVE" ? "bg-success-surface text-success" : "bg-surface-muted text-fg-muted";
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {t(`us.status.${status}`)}
    </span>
  );
}

const roleText = (r: UserListItem["role"]) => t(`role.${r}`);
const lastLogin = (u: UserListItem) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-fg-muted">—</span>);

/** Ad bağlantısı (avatar + ad, kendisi ise "(siz)"); kartta e-posta ve ok da gösterilir. */
function NameCell({ u, selfId, card = false }: { u: UserListItem; selfId: string; card?: boolean }) {
  return (
    <Link href={`/users/${u.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 font-medium text-primary hover:underline">
      <Avatar name={u.fullName} src={u.avatarUrl ?? null} testId="user-avatar" />
      <span className="min-w-0">
        <span className="block truncate" title={u.fullName}>
          {u.fullName}
          {u.id === selfId && <span className="ml-1 font-normal text-fg-muted">({t("us.you")})</span>}
        </span>
        {card && <span className="block truncate text-xs font-normal text-fg-muted">{u.email}</span>}
      </span>
      {card && <ChevronRight aria-hidden className="size-4 shrink-0" />}
    </Link>
  );
}

type ListProps = { items: UserListItem[]; selfId: string };

const COLS = ["us.col.name", "us.col.email", "us.col.role", "us.col.lastLogin", "us.col.status"] as const;

function UserTable({ items, selfId }: ListProps) {
  return (
    <div
      className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block"
      tabIndex={0}
      role="region"
      aria-label={t("us.tableRegion")}
    >
      <table className="w-full text-left text-sm" data-testid="users-table">
        <caption className="sr-only">{t("us.title")}</caption>
        <thead className="bg-surface-muted text-xs text-fg-muted">
          <tr>
            {COLS.map((k) => (
              <th key={k} scope="col" className="px-3 py-3 font-medium">
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((u) => (
            <UserRow key={u.id} u={u} selfId={selfId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ u, selfId }: { u: UserListItem; selfId: string }) {
  return (
    <tr data-testid="user-row" className="hover:bg-surface-muted">
      <td className="max-w-72 px-3 py-1">
        <NameCell u={u} selfId={selfId} />
      </td>
      <td className="max-w-64 truncate px-3 py-1 text-fg" title={u.email}>
        {u.email}
      </td>
      <td className="px-3 py-1 whitespace-nowrap text-fg" data-testid="user-role">
        {roleText(u.role)}
      </td>
      <td className="px-3 py-1 whitespace-nowrap tabular-nums text-fg">{lastLogin(u)}</td>
      <td className="px-3 py-1">
        <StatusPill status={u.status} testId="user-status" />
      </td>
    </tr>
  );
}

function UserCards({ items, selfId }: ListProps) {
  return (
    <ul className="flex flex-col gap-2 md:hidden" data-testid="users-cards">
      {items.map((u) => (
        <li key={u.id} data-testid="user-card" className="rounded-lg border border-border bg-surface p-3">
          <NameCell u={u} selfId={selfId} card />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="text-fg">{roleText(u.role)}</span>
            <StatusPill status={u.status} testId="user-status" />
            <span className="tabular-nums">{t("us.e.lastLogin", { at: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—" })}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Kullanıcı listesi: ≥ md tablo (kendi kabında yatay kayar), dar ekranda kart. Satırın tek bağlantısı ad (detay/düzenleme). */
export function UserList(props: ListProps) {
  return (
    <>
      <UserTable {...props} />

      <UserCards {...props} />
    </>
  );
}
