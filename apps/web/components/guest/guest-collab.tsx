"use client";

import { PictureInPicture2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/collab/chat-panel";
import { FilesPanel } from "@/components/collab/files-panel";
import { chatFilesOptions } from "@/components/collab/tab-options";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import type { Collab } from "@/lib/dc/use-collab";
import { t } from "@/lib/i18n";

type Tab = "chat" | "files";

/** Müşteri sayfası: teknisyenle sohbet + dosyalar. `file_transfer` yeteneği yoksa Dosyalar sekmesi gizli (G-09). */
export function GuestCollab({
  collab,
  filesAllowed,
  techName,
  onChatVisible,
}: {
  collab: Collab;
  filesAllowed: boolean;
  techName: string;
  onChatVisible: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  // Gelen dosya teklifi: kabul diyaloğu Dosyalar sekmesinde → yeni teklifte oraya geç (render sırasında, efektsiz)
  const offer = collab.transfers.find((x) => x.dir === "in" && x.status === "pending")?.fid ?? null;
  const [seenOffer, setSeenOffer] = useState<string | null>(null);
  if (offer !== seenOffer) {
    setSeenOffer(offer);
    if (offer) setTab("files");
  }
  const cur = filesAllowed ? tab : "chat";
  useEffect(() => onChatVisible(cur === "chat"), [cur, onChatVisible]);
  return (
    <section
      aria-labelledby="iletisim-t"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="guest-collab"
    >
      <h2 id="iletisim-t" className="text-lg font-semibold text-fg">
        {t("p5.g.collab")}
      </h2>
      {filesAllowed && <Segmented<Tab> label={t("p5.side")} value={cur} onChange={setTab} options={chatFilesOptions(collab.chat.unread)} />}
      {cur === "chat" ? (
        <ChatPanel collab={collab} peerName={techName} />
      ) : (
        <FilesPanel collab={collab} allowed={filesAllowed} peerName={techName} />
      )}
      {/* Teklif yetkisiz gelse bile FilesPanel kapalıyken diyalog açılmaz: FileTransfers otomatik reddeder */}
    </section>
  );
}

interface DocPip {
  requestWindow(o: { width: number; height: number }): Promise<Window>;
}
const docPip = (): DocPip | undefined => (globalThis as { documentPictureInPicture?: DocPip }).documentPictureInPicture;

/** Document Picture-in-Picture (AC-37): yalnız destekleyen tarayıcıda; stiller kopyalanır, kapanınca geri döner. */
export function usePip() {
  const [win, setWin] = useState<Window | null>(null);
  // Canlı aşama yalnız WS sonrası istemcide çizilir (SSR/hydration'da bu bileşen yok)
  const supported = typeof window !== "undefined" && Boolean(docPip());
  const open = useCallback(async () => {
    const api = docPip();
    if (!api) return;
    try {
      const w = await api.requestWindow({ width: 480, height: 300 });
      for (const n of document.querySelectorAll('link[rel="stylesheet"], style')) w.document.head.append(n.cloneNode(true));
      w.document.documentElement.className = document.documentElement.className;
      w.document.body.className = "m-0 bg-stage p-2";
      w.addEventListener("pagehide", () => setWin(null), { once: true });
      setWin(w);
    } catch {
      setWin(null); // kullanıcı etkileşimi yok / reddedildi
    }
  }, []);
  const close = useCallback(() => win?.close(), [win]);
  return { win, supported, open, close };
}

export function PipButton({ pip }: { pip: ReturnType<typeof usePip> }) {
  if (!pip.supported) return null;
  return pip.win ? (
    <Button variant="secondary" onClick={pip.close} data-testid="pip-close" className="self-start">
      <X aria-hidden className="size-4" />
      {t("p5.g.pipClose")}
    </Button>
  ) : (
    <Button variant="secondary" onClick={() => void pip.open()} data-testid="pip-open" className="self-start">
      <PictureInPicture2 aria-hidden className="size-4" />
      {t("p5.g.pip")}
    </Button>
  );
}
