import { formatSessionCode } from "@/lib/format";

/**
 * Kod gösterimi (DESIGN.md §6.1): 8 haneli oturum kodu 4+4 gruplu, 4 haneli doğrulama kodu,
 * `xl`: müşteri lobisindeki 4 haneli kabul kodu kutuları (P4). Ekran okuyucu rakamları tek tek okur.
 */
export function CodeDisplay({
  code,
  size = "lg",
  testId,
}: {
  code: string;
  size?: "sm" | "lg" | "xl";
  testId?: string;
}) {
  const label = code.split("").join(" ");
  if (size === "xl") {
    return (
      <span data-testid={testId} role="img" aria-label={label} className="flex gap-2 sm:gap-3">
        {code.split("").map((d, i) => (
          <span
            key={i}
            aria-hidden
            className="inline-flex h-16 w-12 items-center justify-center rounded-md border border-border bg-surface-muted font-mono text-4xl font-bold text-fg tabular-nums sm:h-20 sm:w-16 sm:text-5xl"
          >
            {d}
          </span>
        ))}
      </span>
    );
  }
  const cls = size === "lg" ? "text-3xl tracking-wider" : "text-sm tracking-wide";
  return (
    <span data-testid={testId} aria-label={label} className={`font-mono font-bold whitespace-pre text-fg tabular-nums ${cls}`}>
      {formatSessionCode(code)}
    </span>
  );
}
