"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { lockedKeys } from "@/lib/users/permissions";
import { NewUserDialog } from "./new-user-dialog";

/** "Yeni kullanıcı" (yalnız `users.create`). Geçici şifre adımından sonra liste yenilenir veya yetki ekranına gidilir. */
export function UsersActions({ actor, layout = "header" }: { actor: { role: string; permissions: readonly string[] }; layout?: "header" | "empty" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const locked = useMemo(() => lockedKeys(actor), [actor]);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid={layout === "header" ? "user-new" : "user-new-empty"}>
        <UserPlus aria-hidden className="size-4" />
        {t("us.new")}
      </Button>
      {open && (
        <NewUserDialog
          locked={locked}
          onClose={() => setOpen(false)}
          onDone={(id, edit) => {
            setOpen(false);
            if (edit) router.push(`/users/${id}`);
            else router.refresh();
          }}
        />
      )}
    </>
  );
}
