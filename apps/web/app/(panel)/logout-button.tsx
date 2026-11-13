"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { clearSessionData } from "@/lib/session-storage";

/** AC-65: POST /auth/logout (CSRF başlıklı) → /login. 401 = zaten düşmüş oturum, çıkış sayılır. Üst menü düğmesi ve hesap menüsü ortak. */
export function useLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    try {
      await api<void>("POST", "/auth/logout");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setFailed(true);
        setPending(false);
        return;
      }
    }
    clearSessionData(); // S-P4-4: paylaşımlı bilgisayarda müşteri adı sekmede kalmasın
    router.replace("/login?reason=logout");
    router.refresh();
  }
  return { logout, pending, failed };
}

export function LogoutButton({ userName }: { userName: string }) {
  const { logout, pending, failed } = useLogout();

  return (
    <div className="flex shrink-0 items-center gap-2">
      {failed && (
        <span role="alert" className="text-xs font-medium text-danger">
          {t("panel.logoutFailed")}
        </span>
      )}
      <Button
        variant="ghost"
        onClick={logout}
        loading={pending}
        aria-label={`${t("panel.logout")} (${userName})`}
        className="px-3"
      >
        {!pending && <LogOut aria-hidden className="size-4" />}
        <span className="hidden sm:inline">{pending ? t("panel.loggingOut") : t("panel.logout")}</span>
      </Button>
    </div>
  );
}
