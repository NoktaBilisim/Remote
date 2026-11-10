import { initials } from "@/lib/format";

/** Avatar: resim yoksa baş harf rozeti (std. §1.5). Resim yükleme P12. */
export function Avatar({ name, size = "md", testId }: { name: string; size?: "md" | "lg"; testId?: string }) {
  const cls = size === "lg" ? "size-16 text-xl" : "size-9 text-sm";
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-surface font-semibold text-primary ${cls}`}
    >
      {initials(name)}
    </span>
  );
}
