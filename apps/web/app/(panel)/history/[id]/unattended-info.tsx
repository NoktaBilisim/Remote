import type { SessionUnattendedInfo, UnattendedTimelineKind } from "@remote/contracts/api/sessions";
import { Eye, Hand, Lock, LogOut, RefreshCw, UserCheck, type LucideIcon } from "lucide-react";
import { formatNumber, formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CONSENT_MODE_LABELS } from "@/lib/unattended/contract";
import { Muted } from "./sections";

const ICONS: Readonly<Record<UnattendedTimelineKind, LucideIcon>> = {
  consent: UserCheck,
  control_on: Hand,
  control_off: Eye,
  lock: Lock,
  logoff: LogOut,
  rejoin: RefreshCw,
};

function Item({ e }: { e: SessionUnattendedInfo["timeline"][number] }) {
  const Icon = ICONS[e.kind];
  const extra = [
    e.decision ? t(`h.un.d.${e.decision}`) : null,
    e.ms !== undefined ? t("h.un.secs", { s: formatNumber(e.ms / 1000, 1) }) : null,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-2 text-sm" data-testid="un-timeline-item" data-kind={e.kind}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${e.result === "fail" ? "text-danger" : "text-primary"}`} />
      <p className="flex flex-wrap items-baseline gap-x-2">
        <time dateTime={e.at} className="tabular-nums text-fg-muted">
          {formatTimeSeconds(e.at)}
        </time>
        <span className="font-medium text-fg">{t(`h.un.k.${e.kind}`)}</span>
        {extra.length > 0 && <span className="text-fg-muted">{extra.join(" · ")}</span>}
        {e.result === "fail" && <span className="text-xs font-medium text-danger">({t("h.un.fail")})</span>}
      </p>
    </li>
  );
}

/**
 * P28u (§10, AC-446): geçmiş ayrıntısında gözetimsiz bağlantı kipi, gerekçe (yalnız `silent`; anonimleştirmede yok) ve müdahale
 * zaman çizelgesi. Metinler React metin düğümü (gerekçe kullanıcı girdisi; HTML yorumlanmaz).
 */
export function UnattendedInfoSection({ u }: { u: SessionUnattendedInfo }) {
  return (
    <div className="flex flex-col gap-4" data-testid="un-history">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-muted">{t("h.un.mode")}</dt>
        <dd className="text-fg" data-testid="un-history-mode">
          {u.consentMode ? CONSENT_MODE_LABELS[u.consentMode] : t("h.un.modeUnknown")}
        </dd>
        {u.consentMode === "silent" && u.silentReason && (
          <>
            <dt className="text-fg-muted">{t("h.un.reason")}</dt>
            <dd className="whitespace-pre-wrap text-fg wrap-anywhere" data-testid="un-history-reason">
              {u.silentReason}
            </dd>
          </>
        )}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">{t("h.un.timeline")}</h3>
        {u.timeline.length === 0 ? (
          <Muted testId="un-timeline-empty">{t("h.un.empty")}</Muted>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="un-timeline">
            {u.timeline.map((e, i) => (
              <Item key={`${e.at}-${i}`} e={e} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
