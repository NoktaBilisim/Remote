"use client";

import { Bell, CircleAlert, CircleCheck, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";

/*
 * Küçük toast (DESIGN.md §6.1 "ui/toast"). Sonner yerine: Sonner çalışma anında nonce'suz <style>
 * enjekte eder (CSP style-src 'nonce-…' ihlali). Kuyruk en çok 3, 4 sn sonra kapanır, aria-live polite.
 * Modal <dialog> üst katmanda olduğundan ve dışını inert yaptığından, açık diyalog kendi
 * <ToastViewport>'unu taşır; o anda yalnız en son bağlanan görünüm çizilir.
 */
type Tone = "success" | "danger" | "info";
/** P8b-1: isteğe bağlı eylem bağlantısı (ör. yeni talep → "Görüntüle") ve süre (vars. 4 sn). */
interface ToastOptions {
  action?: { label: string; href: string };
  durationMs?: number;
}
interface Item {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastOptions["action"];
}
interface Ctx {
  push: (message: string, tone?: Tone, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
  items: Item[];
  hosts: string[];
  setHosts: (fn: (h: string[]) => string[]) => void;
}

const ToastCtx = createContext<Ctx>({ push: () => {}, dismiss: () => {}, items: [], hosts: [], setHosts: () => {} });

export function useToast() {
  return useContext(ToastCtx).push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, tone: Tone = "success", opts: ToastOptions = {}) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { id, message, tone, action: opts.action }]);
      setTimeout(() => dismiss(id), opts.durationMs ?? 4000);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ push, dismiss, items, hosts, setHosts }}>
      {children}
      <ToastViewport root />
    </ToastCtx.Provider>
  );
}

/** Toast'ların çizildiği bölge. `root` = sağlayıcının varsayılanı; diyaloglar `root`'suz kullanır. */
export function ToastViewport({ root = false }: { root?: boolean }) {
  const { items, dismiss, hosts, setHosts } = useContext(ToastCtx);
  const id = useId();
  useEffect(() => {
    if (root) return;
    setHosts((h) => [...h, id]);
    return () => setHosts((h) => h.filter((x) => x !== id));
  }, [root, id, setHosts]);

  const active = root ? hosts.length === 0 : hosts[hosts.length - 1] === id;
  if (!active) return null;
  return (
    // P13b-L (AC-307): role="status" — bölge zaten aria-live=polite; rol ekran okuyucuya durum bildirimi olduğunu söyler
    <section
      role="status"
      aria-label={t("toast.region")}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end"
    >
      {items.map((it) => {
        const Icon = it.tone === "success" ? CircleCheck : it.tone === "info" ? Bell : CircleAlert;
        const color = it.tone === "success" ? "text-success" : it.tone === "info" ? "text-primary" : "text-danger";
        return (
          <div
            key={it.id}
            data-testid="toast"
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md border border-border bg-surface py-1 pr-1 pl-3 text-sm text-fg shadow-lg transition-[opacity,transform] duration-200 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0"
          >
            <Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
            <p className="min-w-0 flex-1 wrap-anywhere">{it.message}</p>
            {it.action && (
              <Link
                href={it.action.href}
                onClick={() => dismiss(it.id)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 font-medium text-primary hover:bg-surface-muted"
              >
                {it.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(it.id)}
              aria-label={t("toast.close")}
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
