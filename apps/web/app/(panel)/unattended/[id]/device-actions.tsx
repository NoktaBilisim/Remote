"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmNameDialog } from "@/components/ui/confirm-name-dialog";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { DeviceListItem } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";
import { ConnectButton } from "../connect-button";
import { useConnect } from "../use-connect";

/** Ayrıntıdaki Bağlan: hata sonrası sayfa sunucuda yeniden çizilir (güncel durum/neden). */
export function DetailConnect({ device, available }: { device: DeviceListItem; available: boolean }) {
  const router = useRouter();
  const { connect, busyId } = useConnect(() => router.refresh());
  return <ConnectButton device={device} available={available} busy={busyId === device.id} onConnect={(id) => void connect(id)} />;
}

function useRevoke(id: string, name: string) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/unattended/devices/${id}/revoke`, {});
      toast(t("un.revoke.done", { name }));
      setOpen(false);
      router.push("/unattended");
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(unattendedUiError(e));
    } finally {
      setBusy(false);
    }
  };
  return { open, setOpen, busy, error, setError, confirm };
}

/** "Cihazı iptal et" (`Ban`, AC-275): cihaz adı yazılarak onay; başarıda listeye dönülür. */
export function RevokeButton({ id, name }: { id: string; name: string }) {
  const { open, setOpen, busy, error, setError, confirm } = useRevoke(id, name);
  return (
    <>
      <Button variant="danger-ghost" onClick={() => (setError(null), setOpen(true))} data-testid="un-revoke">
        <Ban aria-hidden className="size-4" />
        {t("un.revoke")}
      </Button>
      <ConfirmNameDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("un.revoke.title")}
        description={t("un.revoke.body")}
        expectedName={name}
        confirmLabel={t("un.revoke")}
        Icon={Ban}
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        testId="un-revoke-dialog"
      />
    </>
  );
}
