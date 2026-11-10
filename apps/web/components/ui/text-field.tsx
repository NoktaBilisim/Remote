"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { t } from "@/lib/i18n";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  /** type="password" alanlarda göster/gizle düğmesi ekler. */
  revealable?: boolean;
}

/** Etiketli metin alanı: label–input eşleşmesi, alan bazlı hata (aria-invalid + aria-describedby). */
export function TextField({ label, error, hint, revealable, type = "text", className = "", ...rest }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const showHint = Boolean(hint) && !error;
  const describedBy = [showHint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          {...rest}
          id={id}
          type={revealable && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-11 w-full rounded-md border bg-surface px-3 text-base text-fg shadow-sm transition-colors duration-150 ease-out placeholder:text-fg-muted focus-visible:border-ring disabled:opacity-60 sm:text-sm ${
            error ? "border-danger" : "border-border"
          } ${revealable ? "pr-12" : ""}`}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? t("login.hidePassword") : t("login.showPassword")}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-fg-muted hover:text-fg"
          >
            {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        )}
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
