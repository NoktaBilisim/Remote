"use client";

import { Plug } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { DeviceListItem } from "@/lib/unattended/contract";
import { connectBlock } from "@/lib/unattended/errors";

/**
 * "Bağlan" (`Plug`): sunucunun `canConnect`'i false ya da kapı kapalıysa pasif; neden görünür metin olarak altında ve
 * `aria-describedby` ile düğmeye bağlı (pasif düğme odak almaz, ipucu üzerine gelmeye bağlı kalmaz — AC-336).
 */
export function ConnectButton({
  device,
  available,
  busy,
  onConnect,
}: {
  device: Pick<DeviceListItem, "id" | "name" | "canConnect" | "connectBlockedReason">;
  available: boolean;
  busy: boolean;
  onConnect: (id: string) => void;
}) {
  const reasonId = useId();
  const block = connectBlock(device, available);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={block ? "secondary" : "primary"}
        disabled={block !== null}
        loading={busy}
        aria-label={t("un.connectTo", { name: device.name })}
        aria-describedby={block ? reasonId : undefined}
        onClick={() => onConnect(device.id)}
        data-testid="un-connect"
      >
        {!busy && <Plug aria-hidden className="size-4" />}
        {t("un.connect")}
      </Button>
      {block && (
        <p id={reasonId} className="max-w-56 text-xs text-fg-muted" data-testid="un-connect-reason">
          {block}
        </p>
      )}
    </div>
  );
}
