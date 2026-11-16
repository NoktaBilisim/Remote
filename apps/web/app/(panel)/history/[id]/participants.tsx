import { Users } from "lucide-react";
import { formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Muted, type D } from "./sections";

/**
 * P28c (mimari-p28c §9, AC-369): `GET /sessions/:id/history` `participants` — contracts `SessionHistoryDetail` tipinde henüz yok
 * (K2 notu); yerel tip mimari §9'a göre, alan yoksa bölüm çizilmez (eski sunucu / tek teknisyen).
 */
export interface Participant {
  name: string;
  role: "OWNER" | "PARTICIPANT" | "OBSERVER";
  joinedAt: string;
  leftAt: string | null;
}

const ROLES = new Set(["OWNER", "PARTICIPANT", "OBSERVER"]);

/** Savunmacı okuma: biçimi bozuk satır atlanır (sunucu sözleşmesi K1'de; web uydurmaz). */
export function participantsOf(s: D): Participant[] | null {
  const raw = (s as { participants?: unknown }).participants;
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (p): p is Participant =>
      !!p &&
      typeof p === "object" &&
      typeof (p as Participant).name === "string" &&
      ROLES.has((p as Participant).role) &&
      typeof (p as Participant).joinedAt === "string" &&
      ((p as Participant).leftAt === null || typeof (p as Participant).leftAt === "string"),
  );
}

export function Participants({ items }: { items: Participant[] }) {
  if (items.length === 0) return <Muted testId="participants-empty">{t("h.d.none")}</Muted>;
  return (
    <ul className="flex flex-col gap-2" data-testid="participants">
      {items.map((p, i) => (
        <li
          key={`${p.name}-${p.joinedAt}-${i}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
          data-testid="participant"
        >
          <Users aria-hidden className="size-4 self-center text-fg-muted" />
          <span className="font-medium text-fg">{p.name}</span>
          <span className="text-fg-muted">{t(`mt.h.role.${p.role}`)}</span>
          <span className="tabular-nums text-fg-muted">
            <time dateTime={p.joinedAt}>{formatTimeSeconds(p.joinedAt)}</time>
            {" – "}
            {p.leftAt ? <time dateTime={p.leftAt}>{formatTimeSeconds(p.leftAt)}</time> : t("mt.h.stillIn")}
          </span>
        </li>
      ))}
    </ul>
  );
}
