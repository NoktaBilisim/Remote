"use client";

import { MonitorSmartphone, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t, type MessageKey } from "@/lib/i18n";

const STEPS: MessageKey[] = ["cu.help.s1", "cu.help.s2", "cu.help.s3", "cu.help.s4", "cu.help.s5"];

/**
 * "Müşteriye nasıl gönderilir?" (AC-174): 5 numaralı adım, SmartScreen notu (AC-27) ve tek seferlik destek ayrımı.
 * Native diyalog: klavyeyle açılır, Esc kapatır, odak tetikleyiciye döner (tarayıcı).
 */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      testId="customers-help"
      title={t("cu.help.title")}
      description={t("cu.help.desc")}
      footer={
        <Button variant="secondary" onClick={onClose} data-autofocus className="sm:ml-auto">
          {t("d.close")}
        </Button>
      }
    >
      <ol className="flex flex-col gap-3">
        {STEPS.map((k, i) => (
          <li key={k} className="flex items-start gap-3 text-sm text-fg">
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-semibold text-primary tabular-nums">
              {i + 1}
            </span>
            <span className="pt-0.5">{t(k)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-start gap-3 rounded-md border border-warning/30 bg-warning-surface px-3 py-2.5 text-sm text-warning">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>{t("cu.help.smartscreen")}</p>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
        {t("cu.help.oneOff")}
        <Link href="/sessions" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline">
          <MonitorSmartphone aria-hidden className="size-4" />
          {t("cu.help.oneOffLink")}
        </Link>
      </p>
    </Dialog>
  );
}
