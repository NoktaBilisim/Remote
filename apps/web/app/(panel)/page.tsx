import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumb } from "@/components/breadcrumb";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("panel.home") };

/** P1 boş panel: modül henüz yok → yönlendirici boş durum. */
export default function HomePage() {
  return (
    <>
      <Breadcrumb items={[]} />
      <h1 className="text-2xl font-semibold text-fg">{t("panel.home")}</h1>
      <section
        data-testid="empty-state"
        className="mt-6 flex max-w-xl flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-surface p-6"
      >
        <span className="flex size-10 items-center justify-center rounded-md bg-surface-muted text-primary">
          <MonitorSmartphone aria-hidden className="size-5" />
        </span>
        <h2 className="text-base font-semibold text-fg">{t("home.emptyTitle")}</h2>
        <p className="text-sm text-fg-muted">{t("home.emptyBody")}</p>
      </section>
    </>
  );
}
