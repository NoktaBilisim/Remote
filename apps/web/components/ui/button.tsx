import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-muted",
  ghost: "text-fg hover:bg-surface-muted",
  // P4: yıkıcı eylem (Oturumu bitir / Zorla sonlandır) ve ikincil yıkıcı (Vazgeç ve çık, Reddet)
  danger: "bg-danger text-on-primary hover:opacity-90 shadow-sm",
  "danger-ghost": "bg-surface text-danger border border-danger/40 hover:bg-danger-surface",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  /** React 19: ref düz prop olarak iletilir (P7 "Kontrolü bırak"a odak). */
  ref?: Ref<HTMLButtonElement>;
}

/** Tek buton primitifi. Dokunma hedefi ≥ 44px (min-h-11); Akış görsel dili: hap (rounded-full); basınca scale(0.97). */
export function Button({ variant = "primary", loading = false, disabled, className = "", children, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-[transform,background-color,opacity] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {loading && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
