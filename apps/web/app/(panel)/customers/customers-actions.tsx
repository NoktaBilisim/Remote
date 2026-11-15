"use client";

import { CircleHelp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { CustomerFormDialog } from "./customer-form-dialog";
import { HelpDialog } from "./help-dialog";

/**
 * Müşteriler üst eylemleri (AC-166, AC-174): "Müşteriye nasıl gönderilir?" yardım + "Yeni müşteri" (yalnız
 * `customers.create`). Başarıda toast + müşteri detayına yönlendirme (bağlantı orada kopyalanır).
 * `layout="empty"`: boş durumdaki birincil eylem + yardım bağlantısı.
 */
export function CustomersActions({ canCreate, layout = "header" }: { canCreate: boolean; layout?: "header" | "empty" }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <div className={layout === "header" ? "flex flex-wrap items-center gap-2" : "flex flex-col items-center gap-1"}>
      {layout === "empty" && canCreate && (
        <Button onClick={() => setForm(true)} data-testid="customer-new-empty">
          <Plus aria-hidden className="size-4" />
          {t("cu.new")}
        </Button>
      )}
      <Button
        variant={layout === "header" ? "secondary" : "ghost"}
        onClick={() => setHelp(true)}
        data-testid={layout === "header" ? "customers-help-open" : "customers-help-open-empty"}
      >
        <CircleHelp aria-hidden className="size-4" />
        {t("cu.help.open")}
      </Button>
      {layout === "header" && canCreate && (
        <Button onClick={() => setForm(true)} data-testid="customer-new">
          <Plus aria-hidden className="size-4" />
          {t("cu.new")}
        </Button>
      )}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      {form && (
        <CustomerFormDialog
          onClose={() => setForm(false)}
          onSaved={(c) => {
            setForm(false);
            toast(t("cu.created", { name: c.name }));
            router.push(`/customers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
