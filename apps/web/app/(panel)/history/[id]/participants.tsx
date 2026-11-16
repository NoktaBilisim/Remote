import type { SessionParticipant } from "@remote/contracts/api/sessions";
import { ArrowRightLeft, Users } from "lucide-react";
import { formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { leaveReasonLabel, PARTICIPANT_ROLE_KEY } from "@/lib/multi/timeline";

function At({ at }: { at: string | null }) {
  return at ? <time dateTime={at}>{formatTimeSeconds(at)}</time> : <>—</>;
}

/**
 * P28c (mimari-p28c §9, AC-369): `SessionHistoryDetail.participants` — ad, son rol, katılma–ayrılma, ayrılma nedeni
 * (`removed` = müşteri çıkardı), devir anı. Tek teknisyenli oturumda dizi boştur; bölüm o zaman çizilmez (sayfa).
 */
export function Participants({ items }: { items: readonly SessionParticipant[] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="participants">
      {items.map((p) => (
        <li key={p.userId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="participant" data-role={p.role}>
          <Users aria-hidden className="size-4 self-center text-fg-muted" />
          <span className="font-medium text-fg">{p.name}</span>
          <span className="text-fg-muted">{t(PARTICIPANT_ROLE_KEY[p.role])}</span>
          <span className="tabular-nums text-fg-muted">
            <At at={p.joinedAt} />
            {" – "}
            {p.leftAt ? <At at={p.leftAt} /> : t("mt.h.stillIn")}
          </span>
          {p.leaveReason && (
            <span className="text-fg-muted" data-testid="participant-reason">
              {leaveReasonLabel(p.leaveReason)}
            </span>
          )}
          {p.transferredAt && (
            <span className="inline-flex items-center gap-1 text-fg-muted" data-testid="participant-transfer">
              <ArrowRightLeft aria-hidden className="size-3.5" />
              {t("mt.h.transferred")} <At at={p.transferredAt} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
