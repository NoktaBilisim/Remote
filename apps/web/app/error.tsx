"use client";

import { LoadError } from "@/components/load-error";

/** Beklenmeyen render hatası (500) — "Tekrar dene" segmenti yeniden çizer. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <LoadError onRetry={reset} />
    </main>
  );
}
