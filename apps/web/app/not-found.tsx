import { House, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nf.title") };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <SearchX aria-hidden className="size-10 text-fg-muted" />
      <h1 className="text-xl font-semibold">{t("nf.title")}</h1>
      <p className="text-sm text-fg-muted">{t("nf.body")}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover"
      >
        <House aria-hidden className="size-4" />
        {t("nf.home")}
      </Link>
    </main>
  );
}
