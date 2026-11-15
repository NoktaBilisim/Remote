"use client";

import { CircleHelp, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CsvExportButton } from "@/components/csv-export-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { CustomerFormDialog } from "./customer-form-dialog";
import { HelpDialog } from "./help-dialog";

type Openers = { openHelp: () => void; openForm: () => void };
const ActionsContext = createContext<Openers | null>(null);

/**
 * AC-223: "Müşteriye nasıl gönderilir?" ve "Yeni müşteri" diyalogları sayfa düzeyinde TEK örnek. Üst eylemler ve boş
 * durumdaki tetikleyiciler bu sağlayıcıdan açar (iki ayrı diyalog DOM'da birikmez; odak, native <dialog> ile tetikleyen
 * düğmeye döner). Başarıda toast + müşteri detayına yönlendirme (bağlantı orada kopyalanır).
 */
export function CustomersActionsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(false);
  const [help, setHelp] = useState(false);
  const openers = useMemo<Openers>(() => ({ openHelp: () => setHelp(true), openForm: () => setForm(true) }), []);
  return (
    <ActionsContext.Provider value={openers}>
      {children}
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
    </ActionsContext.Provider>
  );
}

/**
 * Müşteriler eylem tetikleyicileri (AC-166, AC-174): yardım + "Yeni müşteri" (yalnız `customers.create`).
 * `layout="empty"`: boş durumdaki birincil eylem + yardım bağlantısı. `CustomersActionsProvider` içinde kullanılır.
 */
export function CustomersActions({
  canCreate,
  layout = "header",
  canExport = false,
  canImport = false,
  exportStatus = "all",
}: {
  canCreate: boolean;
  layout?: "header" | "empty";
  /** P19 (AC-263): `customers.export` (+ view). */
  canExport?: boolean;
  /** P19 (S-P19-14): `customers.import` + `create` + `view` birlikte. */
  canImport?: boolean;
  /** Listenin durum filtresi (dışa aktarma aynı kapsamla). */
  exportStatus?: "active" | "passive" | "all";
}) {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("CustomersActions, CustomersActionsProvider içinde kullanılmalı");
  const { openHelp, openForm } = ctx;
  return (
    <div className={layout === "header" ? "flex flex-wrap items-center gap-2" : "flex flex-col items-center gap-1"}>
      {layout === "empty" && canCreate && (
        <Button onClick={openForm} data-testid="customer-new-empty">
          <Plus aria-hidden className="size-4" />
          {t("cu.new")}
        </Button>
      )}
      <Button
        variant={layout === "header" ? "secondary" : "ghost"}
        onClick={openHelp}
        data-testid={layout === "header" ? "customers-help-open" : "customers-help-open-empty"}
      >
        <CircleHelp aria-hidden className="size-4" />
        {t("cu.help.open")}
      </Button>
      {layout === "header" && canImport && (
        <Link
          href="/customers/import"
          data-testid="customers-import-open"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg shadow-sm hover:bg-surface-muted active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <Upload aria-hidden className="size-4" />
          {t("cu.csv.import")}
        </Link>
      )}
      {layout === "header" && canCreate && (
        <Button onClick={openForm} data-testid="customer-new">
          <Plus aria-hidden className="size-4" />
          {t("cu.new")}
        </Button>
      )}
      {layout === "header" && canExport && (
        <div className="basis-full sm:basis-auto">
          <CsvExportButton
            path={`/customers/export.csv?status=${exportStatus}`}
            label={t("cu.csv.export")}
            hint={t("cu.csv.exportHint")}
            fallbackName="musteriler.csv"
            testId="customers-export"
            errorTestId="customers-export-error"
          />
        </div>
      )}
    </div>
  );
}
