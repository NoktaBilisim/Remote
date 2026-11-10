import { formatSessionCode } from "@/lib/format";

/**
 * Kod gösterimi (DESIGN.md §6.1): 8 haneli oturum kodu 4+4 gruplu, 4 haneli doğrulama kodu.
 * Ekran okuyucu rakamları tek tek okur (aria-label boşluklu hane dizisi).
 */
export function CodeDisplay({
  code,
  size = "lg",
  testId,
}: {
  code: string;
  size?: "sm" | "lg";
  testId?: string;
}) {
  const shown = formatSessionCode(code);
  const cls = size === "lg" ? "text-3xl tracking-wider" : "text-sm tracking-wide";
  return (
    <span
      data-testid={testId}
      aria-label={code.split("").join(" ")}
      className={`font-mono font-bold whitespace-pre text-fg tabular-nums ${cls}`}
    >
      {shown}
    </span>
  );
}
