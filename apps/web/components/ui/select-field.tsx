import { ChevronDown } from "lucide-react";
import { useId, type SelectHTMLAttributes } from "react";

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  options: readonly { value: string; label: string }[];
  /** P11: seçeneklerden SONRA `<optgroup>` grupları (ör. audit işlem grupları). */
  groups?: readonly { label: string; options: readonly { value: string; label: string }[] }[];
  hint?: string;
  error?: string;
  /** Etiket görünmez (yalnız ekran okuyucu) — ör. sayfalama çubuğundaki "Sayfa başına". */
  hideLabel?: boolean;
}

/** Etiketli yerel <select> (P8): TextField ile aynı çerçeve/odak/44 px; klavye ve mobil seçici tarayıcıdan gelir. */
export function SelectField({ label, options, groups, hint, error, hideLabel, className = "", ...rest }: Props) {
  const id = useId();
  const showHint = Boolean(hint) && !error;
  const describedBy = [showHint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-medium text-fg"}>
        {label}
      </label>
      <div className="relative">
        <select
          {...rest}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-11 w-full cursor-pointer appearance-none rounded-md border bg-surface pr-10 pl-3 text-base text-fg shadow-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${
            error ? "border-danger" : "border-border"
          }`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted" />
      </div>
      {showHint && (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
