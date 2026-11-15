"use client";

import type { RequestBlockItem } from "@remote/contracts/api/request-blocks";
import { Clock, Globe, MonitorSmartphone, Plus, ShieldBan, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { AddBlockDialog } from "@/components/request-blocks/block-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { blockTarget } from "@/lib/requests/blocks";

/** "Engel ekle" düğmesi + diyaloğu (başlık ve boş durum). Sınır doluysa pasif. */
export function AddBlockButton({ disabled = false, testId = "block-add" }: { disabled?: boolean; testId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled} className="shrink-0 self-start" data-testid={testId}>
        <Plus aria-hidden className="size-4" />
        {t("bl.add")}
      </Button>
      <AddBlockDialog
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          toast(t("bl.added"));
          router.refresh();
        }}
      />
    </>
  );
}

export function BlocksEmpty({ expired, canAdd }: { expired: boolean; canAdd: boolean }) {
  return (
    <EmptyState
      Icon={ShieldBan}
      title={t(expired ? "bl.emptyAllTitle" : "bl.emptyTitle")}
      body={t("bl.emptyBody")}
      testId="blocks-empty"
      action={canAdd ? <AddBlockButton testId="block-add-empty" /> : undefined}
    />
  );
}

/**
 * Engel listesi (P15, AC-235): tek liste (dar ekranda da aynı satır düzeni sarar → yatay kaydırma yok). Satır: tür ikonu,
 * hedef (mono), süre ("Süresiz" / bitiş zamanı / "Süresi doldu"), not, ekleyen + zaman; "Kaldır" onaylı (`alertdialog`).
 */
export function BlockList({ items }: { items: RequestBlockItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<RequestBlockItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const close = () => {
    if (busy) return;
    setTarget(null);
    setError(null);
  };
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/request-blocks/${target.id}`);
      setTarget(null);
      toast(t("bl.removed"));
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 404) {
        setTarget(null);
        toast(t("bl.gone"), "danger");
        router.refresh();
      } else setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" aria-label={t("bl.listLabel")}>
        {items.map((b) => {
          const text = blockTarget(b);
          return (
            <li
              key={b.id}
              data-testid="block-row"
              data-kind={b.kind}
              data-expired={b.expired ? "true" : "false"}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
                  {b.kind === "IP" ? <Globe aria-hidden className="size-5" /> : <MonitorSmartphone aria-hidden className="size-5" />}
                  <span className="sr-only">{t(b.kind === "IP" ? "bl.kind.IP" : "bl.kind.DEVICE")}</span>
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium break-all text-fg" data-testid="block-target">
                    {text}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1" data-testid="block-expiry">
                      <Clock aria-hidden className="size-3.5" />
                      {b.expired ? (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-fg">{t("bl.expired")}</span>
                      ) : b.expiresAt ? (
                        t("bl.until", { at: formatDateTime(b.expiresAt) })
                      ) : (
                        t("bl.dur.none")
                      )}
                    </span>
                    <span>{t("bl.by", { name: b.createdBy.fullName, at: formatDateTime(b.createdAt) })}</span>
                  </p>
                  {b.note && <p className="mt-1 text-sm whitespace-pre-wrap text-fg wrap-anywhere">{b.note}</p>}
                </div>
              </div>
              <Button
                variant="danger-ghost"
                className="shrink-0 self-start sm:self-center"
                onClick={() => setTarget(b)}
                aria-label={t("bl.removeFor", { target: text })}
                data-testid="block-remove"
              >
                <Trash2 aria-hidden className="size-4" />
                <span aria-hidden>{t("bl.remove")}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={target !== null}
        onClose={close}
        role="alertdialog"
        size="sm"
        testId="block-remove-dialog"
        title={t("bl.removeTitle")}
        description={t("bl.removeBody", { target: target ? blockTarget(target) : "" })}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
              {t("su.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="block-remove-confirm">
              {!busy && <Trash2 aria-hidden className="size-4" />}
              {t("bl.remove")}
            </Button>
          </>
        }
      >
        {error && <FormError error={error} />}
      </Dialog>
    </>
  );
}
