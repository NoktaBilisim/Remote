"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/**
 * Yarı oturum ekranlarında (2FA kodu, zorunlu 2FA kurulumu) çıkış: POST /auth/logout → /login. Hata olsa da (401/403
 * çerezleri sunucu temizler) giriş ekranına dönülür — kullanıcı kapıda sıkışıp kalmaz.
 */
export function AuthExit({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const exit = async () => {
    setPending(true);
    await api<void>("POST", "/auth/logout").catch(() => undefined);
    router.replace("/login?reason=logout");
    router.refresh();
  };
  return (
    <Button type="button" variant="ghost" onClick={() => void exit()} loading={pending} disabled={disabled} className="w-full" data-testid="auth-exit">
      {!pending && <LogOut aria-hidden className="size-4" />}
      {t("mfa.exit")}
    </Button>
  );
}
