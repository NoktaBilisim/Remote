"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { ToastViewport } from "@/components/ui/toast";
import { t } from "@/lib/i18n";

/**
 * Native <dialog> + showModal(): odak tuzağı, Esc ve arka plan "inert" tarayıcıdan gelir (DESIGN.md §6.1).
 * Giriş: scale(.95)+opacity → 1 (@starting-style), ease-out; reduced-motion'da yalnız opacity.
 * İlk odak: içerikte `data-autofocus` olan öğe (yıkıcı onayda "Vazgeç"), yoksa ilk odaklanabilir öğe.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  testId,
  role,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
  testId?: string;
  role?: "alertdialog";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // React autoFocus kapalı <dialog> içinde etkisiz → işaretli öğeye showModal sonrası odak
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const width = size === "sm" ? "sm:max-w-md" : "sm:max-w-xl";
  return (
    <dialog
      ref={ref}
      role={role}
      data-testid={testId}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      // "close" olayı kuyruktan (asenkron) gelir: kapandıktan hemen sonra yeniden açılan diyaloğa eski olay ulaşırsa yok say
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-border bg-surface p-0 text-fg shadow-lg transition-[opacity,transform] duration-200 ease-out backdrop:bg-overlay starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100 ${width}`}
    >
      {open && (
        <>
          <div className="flex items-start gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="text-lg font-semibold text-fg">
                {title}
              </h2>
              {description && (
                <div id={`${id}-d`} className="mt-1 text-sm text-fg-muted">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("d.closeIcon")}
              className="-mt-1 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children && <div className="px-4 py-4 sm:px-6">{children}</div>}
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:px-6">
              {footer}
            </div>
          )}
          <ToastViewport />
        </>
      )}
    </dialog>
  );
}
