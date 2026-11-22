"use client";

import type { PreferencesResponse } from "@remote/contracts/api/branding";
import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated, readCookie } from "@/lib/api";
import { t } from "@/lib/i18n";
import { applyThemeToDocument, cookieToTheme, THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

type Ctx = { theme: Theme; setTheme: (next: Theme) => void; pending: boolean };
const ThemeCtx = createContext<Ctx | null>(null);

const THEME_ICONS: Record<Theme, LucideIcon> = { LIGHT: Sun, DARK: Moon, SYSTEM: Laptop };
const themeOptions = () => THEMES.map((v) => ({ value: v, label: t(`theme.${v}`), Icon: THEME_ICONS[v] }));

/**
 * Kullanıcı tema tercihi (AC-85). İlk değer sunucudan (/auth/me, DB); kök layout aynı değerle `<html>` sınıfını zaten
 * basmıştır. Değişiklik iyimser: sınıf + çerez anında, ardından PATCH /auth/me/preferences; hata olursa önceki tema geri
 * yüklenir ve toast'la söylenir. Açılışta çerez DB'den farklıysa (ör. başka cihazda değişti) çerez eşitlenir → çıkıştan
 * sonra giriş ekranı da son tercihe uyar.
 */
export function ThemeProvider({
  initial,
  children,
  save = (theme) => api<PreferencesResponse>("PATCH", "/auth/me/preferences", { theme }),
  expiredPath = () => EXPIRED_LOGIN_PATH,
}: {
  initial: Theme;
  children: ReactNode;
  /** P21: kaydetme ucu (portal `PATCH /portal/me`); varsayılan panel tercihi. */
  save?: (theme: Theme) => Promise<unknown>;
  /** P21: oturum düşünce gidilecek giriş adresi (portal girişi); varsayılan panel. */
  expiredPath?: () => string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [theme, setState] = useState<Theme>(initial);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (cookieToTheme(readCookie(THEME_COOKIE, document.cookie)) !== initial) applyThemeToDocument(initial);
  }, [initial]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (next === theme) return;
      const prev = theme;
      const my = ++seq.current;
      setState(next);
      applyThemeToDocument(next);
      setPending(true);
      save(next)
        .catch((e: unknown) => {
          if (my !== seq.current) return; // daha yeni bir seçim var; o karar verir
          if (isUnauthenticated(e)) return router.replace(expiredPath());
          setState(prev);
          applyThemeToDocument(prev);
          toast(t("theme.saveFailed"), "danger");
        })
        .finally(() => {
          if (my === seq.current) setPending(false);
        });
    },
    [theme, router, toast, save, expiredPath],
  );

  return <ThemeCtx.Provider value={{ theme, setTheme, pending }}>{children}</ThemeCtx.Provider>;
}

function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("ThemeProvider eksik");
  return c;
}

/** Açık / Koyu / Sistem seçimi (`aria-pressed` düğme grubu, anında). Üst menü (`compact`) ve /account ortak. */
export function ThemePicker({ compact = false, testId = "theme-picker" }: { compact?: boolean; testId?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label={t("theme.label")}
      data-testid={testId}
      data-value={theme}
      className={`grid grid-cols-3 gap-1 rounded-md border border-border bg-surface p-1 ${compact ? "" : "max-w-sm shadow-sm"}`}
    >
      {themeOptions().map(({ value, label, Icon }) => {
        const active = value === theme;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            data-theme-option={value}
            onClick={() => setTheme(value)}
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-medium ${
              active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
            }`}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Tek tıklık düğmenin döngüsü: Açık → Koyu → Sistem → Açık. */
export const nextTheme = (current: Theme): Theme => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? "SYSTEM";

/**
 * Üst çubuktaki tek tıklık tema düğmesi (std. §1.6 "tek tıklık ikon"; Akış taslağı). İkon o anki seçimi gösterir; tıklayınca
 * sıradaki temaya geçer (anında, animasyonsuz). Erişilebilir ad ve ipucu hem şimdikini hem sıradakini söyler. Saf görünüm
 * (bağlamsız; birim testi) — üst çubuklar `ThemeToggle`'ı kullanır.
 */
export function ThemeToggleButton({
  theme,
  onToggle,
  testId,
  className = "inline-flex",
}: {
  theme: Theme;
  onToggle: () => void;
  testId: string;
  /** Görünürlük (`display`) sınıfı; panel 360 px'te gizler (`hidden sm:inline-flex`), tema avatar menüsünde kalır. */
  className?: string;
}) {
  const Icon = THEME_ICONS[theme];
  const label = t("theme.toggle", { current: t(`theme.${theme}`), next: t(`theme.${nextTheme(theme)}`) });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      data-testid={testId}
      data-value={theme}
      className={`${className} size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg active:scale-[0.97]`}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}

/** Panel ve portal üst çubuğu: `ThemeToggleButton` + tema bağlamı (kayıt ucu sağlayıcıdan; panel/portal ayrı). */
export function ThemeToggle({ testId = "theme-toggle", className }: { testId?: string; className?: string }) {
  const { theme, setTheme } = useTheme();
  return <ThemeToggleButton theme={theme} onToggle={() => setTheme(nextTheme(theme))} testId={testId} className={className} />;
}
