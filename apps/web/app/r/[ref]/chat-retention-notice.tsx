import { ShieldCheck } from "lucide-react";
import { t } from "@/lib/i18n";

/** AC-292 form satırı (K-P18-8): "Sohbet mesajları kayıt altına alınır ve N gün saklanır". Tek kaynak bileşen. */
export function ChatRetentionNotice({ days, id }: { days: number; id?: string }) {
  return (
    <p id={id} data-testid="chat-retention-notice" className="flex items-start gap-2 text-xs text-fg-muted">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      {t("wr.retention", { days })}
    </p>
  );
}
