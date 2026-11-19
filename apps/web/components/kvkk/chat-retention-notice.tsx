import { ShieldCheck } from "lucide-react";
import { CHAT_RETENTION_LINE } from "@remote/contracts/chat";

/** AC-292 form satırı (K-P18-8): metin tek kaynak contracts `CHAT_RETENTION_LINE(days)` (Go istemciyle aynı; QA P22 Tur 1). */
export function ChatRetentionNotice({ days, id }: { days: number; id?: string }) {
  return (
    <p id={id} data-testid="chat-retention-notice" className="flex items-start gap-2 text-xs text-fg-muted">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      {CHAT_RETENTION_LINE(days)}
    </p>
  );
}
