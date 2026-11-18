"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { StoredRequest } from "@/lib/web-request/flow";
import { RequestEndScreen } from "./request-end";
import { GuestSession } from "../../session/[token]/guest-session";
import { RequestChat } from "./request-chat";
import { useWaitingRoom } from "./use-waiting-room";
import { AcceptedCard, ClosedScreen, LostBanner, WaitingCard } from "./waiting-parts";

interface WaitingRoomProps {
  request: StoredRequest;
  downloadHref: string;
  retentionDays: number | null;
  onFinished: () => void;
  onNewRequest: () => void;
}

/**
 * Bekleme sayfası (AC-259): sıra/kalan süre (sunucu saati ofsetiyle), sohbet, iptal; kabulde teknisyen adı + doğrulama
 * kodu (+ kabul kodu) → "Ekranımı paylaş" → `GuestSession` (tarayıcı modu); kapanış ekranları; bağlantı koptu bandı
 * (üstel 1→30 sn; 4xxx/1008'de durur).
 */
export function WaitingRoom({ request, downloadHref, retentionDays, onFinished, onNewRequest }: WaitingRoomProps) {
  const w = useWaitingRoom(request, onFinished);
  const { phase } = w;
  const newBtn = (
    <Button onClick={onNewRequest} data-testid="wr-new">
      <RefreshCw aria-hidden className="size-4" />
      {t("wr.new")}
    </Button>
  );

  if (phase.kind === "sharing")
    return (
      <GuestSession
        info={{ technicianName: phase.technicianName, customerName: request.customerName, admitCode: phase.admitCode }}
        verifyCode={phase.techVerifyCode}
        sessionRef=""
        cred={{ ticket: phase.wsTicket }}
        storeKey={null}
      />
    );
  if (phase.kind === "gone") return <RequestEndScreen end="gone" action={newBtn} />;
  if (phase.kind === "closed") return <ClosedScreen phase={phase} action={newBtn} />;
  if (phase.kind === "accepted")
    return (
      <AcceptedCard phase={phase} downloadHref={downloadHref} onShare={() => w.setPhase({ ...phase, kind: "sharing" })} onDecline={w.decline} />
    );
  return (
    <div className="flex flex-col gap-4">
      {w.lost && <LostBanner />}
      <WaitingCard phase={phase} requestCode={request.requestCode} now={w.now} cancelling={w.cancelling} onCancel={() => void w.cancel()} />
      <RequestChat
        items={w.chat}
        enabled={w.chatOn && phase.kind === "pending" && !w.lost}
        retentionDays={retentionDays}
        onSend={w.sendChat}
      />
    </div>
  );
}
