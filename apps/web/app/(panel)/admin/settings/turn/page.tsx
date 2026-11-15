import type { Metadata } from "next";
import type { TurnSettingsView } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { settingsPageError } from "../page-error";
import { TurnForm } from "./turn-form";

export const metadata: Metadata = { title: `${t("sys.tab.turn")} · ${t("sys.title")}` };

/** /admin/settings/turn — TURN adresleri + paylaşılan gizli anahtar; "Ortam değerlerine dön" (AC-78, G-13, ADR-0007). */
export default async function TurnSettingsPage() {
  const res = await serverGet<TurnSettingsView>("/admin/settings/turn");
  if (res.kind === "error") return settingsPageError(res.status);
  return <TurnForm initial={res.data} />;
}
