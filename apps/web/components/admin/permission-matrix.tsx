"use client";

import {
  Building2,
  History,
  Inbox,
  Lock,
  MonitorSmartphone,
  MousePointerClick,
  Paperclip,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PERMISSION_DESCRIPTIONS } from "@remote/contracts/permissions";
import { useId, useMemo } from "react";
import { ToggleSwitch } from "@/components/ui/switch";
import { t } from "@/lib/i18n";
import {
  actionLabel,
  buildMatrix,
  groupLocked,
  groupState,
  moduleLabel,
  STANDARD_ACTIONS,
  toggleGroup,
  type MatrixRow,
  type PermModule,
  type PermState,
} from "@/lib/users/permissions";

/** Modül ikonları (std. 1.8; menüdekilerle aynı anlam). Tanıma yeni eklenen modülün ikonu yoksa nötr `ShieldCheck`. */
const ICONS: Record<string, LucideIcon> = {
  sessions: MonitorSmartphone,
  remote_control: MousePointerClick,
  file_transfer: Paperclip,
  session_history: History,
  support_requests: Inbox,
  customers: Building2,
  users: Users,
  settings: Settings,
  audit: ScrollText,
};

interface Props {
  value: PermState;
  onChange: (next: PermState) => void;
  locked: ReadonlySet<string>;
  disabled?: boolean;
  /** Test/AC-72: tanım dışarıdan verilebilir; varsayılan `PERMISSION_MODULES`. */
  modules?: readonly PermModule[];
}

/**
 * Yetki toggle matrisi (DESIGN §6.1 `admin/permission-matrix.tsx`, AC-71..73). Satırlar `PERMISSION_MODULES`'tan;
 * sütunlar Tümü / Görüntüle / Ekle / Düzenle / Sil / Dışa aktar / Diğer. Modülde olmayan eylem "—" (Uygulanmaz).
 * Grup anahtarı karışıkta `aria-checked="mixed"`. Kilitli (işlemi yapanın sahip olmadığı) anahtar `aria-disabled` +
 * `Lock` + açıklama. ≥ lg tablo, dar ekranda modül başına kart (her anahtarın görünür etiketi var).
 */
export function PermissionMatrix({ value, onChange, locked, disabled = false, modules }: Props) {
  const rows = useMemo(() => buildMatrix(modules), [modules]);
  const reasonId = useId();
  const anyLocked = rows.some((r) => r.keys.some((k) => locked.has(k)));
  const set = (key: string) => onChange({ ...value, [key]: !value[key] });
  const group = (r: MatrixRow) => onChange(toggleGroup(r.keys, value, locked));

  const sw = (key: string, label: string) => (
    <ToggleSwitch
      label={label}
      checked={value[key] === true}
      onChange={() => set(key)}
      locked={locked.has(key)}
      lockedReasonId={reasonId}
      disabled={disabled}
      testId={`perm-${key}`}
    />
  );
  const groupSwitch = (r: MatrixRow) => (
    <ToggleSwitch
      label={t("perm.groupLabel", { module: moduleLabel(r.module) })}
      checked={groupState(r.keys, value)}
      onChange={() => group(r)}
      locked={groupLocked(r.keys, locked)}
      lockedReasonId={reasonId}
      disabled={disabled}
      testId={`perm-group-${r.module}`}
    />
  );
  const na = (
    <span className="inline-flex min-h-11 min-w-11 items-center justify-center text-fg-muted" aria-label={t("perm.na")}>
      —
    </span>
  );
  const Icon = (m: string) => ICONS[m] ?? ShieldCheck;
  // Alt yetki açıklamaları (contracts PERMISSION_DESCRIPTIONS; yalnız adından anlaşılmayan anahtarlar)
  const notes = rows.flatMap((r) =>
    r.keys.flatMap((k) => {
      const text = (PERMISSION_DESCRIPTIONS as Readonly<Record<string, string | undefined>>)[k];
      return text
        ? [
            {
              key: k,
              label: t("perm.itemLabel", { module: moduleLabel(r.module), action: actionLabel(k.slice(r.module.length + 1)) }),
              text,
            },
          ]
        : [];
    }),
  );

  return (
    <div data-testid="permission-matrix">
      <p id={reasonId} className={anyLocked ? "flex items-start gap-2 px-4 pb-3 text-xs text-fg-muted sm:px-6" : "sr-only"}>
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {t("perm.lockedReason")}
      </p>

      <div className="hidden overflow-x-auto lg:block" role="region" aria-label={t("perm.region")} tabIndex={0}>
        <table className="w-full text-left text-sm" data-testid="permission-table">
          <caption className="sr-only">{t("perm.caption")}</caption>
          <thead className="border-y border-border bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium sm:px-6">
                {t("perm.col.module")}
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("perm.col.all")}
              </th>
              {STANDARD_ACTIONS.map((a) => (
                <th key={a} scope="col" className="px-2 py-2 text-center font-medium">
                  {actionLabel(a)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 font-medium">
                {t("perm.col.other")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const I = Icon(r.module);
              return (
                <tr key={r.module} data-testid={`perm-row-${r.module}`}>
                  <th scope="row" className="px-4 py-1 font-medium text-fg sm:px-6">
                    <span className="flex items-center gap-2">
                      <I aria-hidden className="size-5 shrink-0 text-fg-muted" />
                      {moduleLabel(r.module)}
                    </span>
                  </th>
                  <td className="bg-surface-muted px-2 py-1 text-center">{groupSwitch(r)}</td>
                  {STANDARD_ACTIONS.map((a) => {
                    const key = r.cells[a];
                    return (
                      <td key={a} className="px-2 py-1 text-center">
                        {key ? sw(key, t("perm.itemLabel", { module: moduleLabel(r.module), action: actionLabel(a) })) : na}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1">
                    {r.other.length === 0 ? (
                      na
                    ) : (
                      <span className="flex flex-col">
                        {r.other.map((o) => (
                          <span key={o.key} className="flex items-center gap-1 whitespace-nowrap text-xs text-fg">
                            {sw(o.key, t("perm.itemLabel", { module: moduleLabel(r.module), action: actionLabel(o.action) }))}
                            <span aria-hidden>{actionLabel(o.action)}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col divide-y divide-border border-t border-border lg:hidden" data-testid="permission-cards">
        {rows.map((r) => {
          const I = Icon(r.module);
          const items = [...STANDARD_ACTIONS.flatMap((a) => (r.cells[a] ? [{ key: r.cells[a], action: a as string }] : [])), ...r.other];
          return (
            <li key={r.module} className="px-4 py-3" data-testid={`perm-card-${r.module}`}>
              <div className="flex items-center gap-2">
                <I aria-hidden className="size-5 shrink-0 text-fg-muted" />
                <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg">{moduleLabel(r.module)}</h3>
                <span className="text-xs text-fg-muted" aria-hidden>
                  {t("perm.col.all")}
                </span>
                {groupSwitch(r)}
              </div>
              <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {items.map((it) => (
                  <li key={it.key} className="flex items-center justify-between gap-2 text-sm text-fg">
                    <span aria-hidden>{actionLabel(it.action)}</span>
                    {sw(it.key, t("perm.itemLabel", { module: moduleLabel(r.module), action: actionLabel(it.action) }))}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      {notes.length > 0 && (
        <section aria-labelledby={`${reasonId}-n`} className="border-t border-border px-4 py-3 sm:px-6" data-testid="permission-notes">
          <h3 id={`${reasonId}-n`} className="text-xs font-medium text-fg-muted">
            {t("perm.notes")}
          </h3>
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            {notes.map((n) => (
              <div key={n.key} className="contents">
                <dt className="font-medium text-fg">{n.label}</dt>
                <dd className="text-fg-muted">{n.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
