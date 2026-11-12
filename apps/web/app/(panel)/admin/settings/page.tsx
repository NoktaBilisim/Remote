import { redirect } from "next/navigation";

/** /admin/settings → ilk sekme (MySQL). */
export default function SystemSettingsIndex() {
  redirect("/admin/settings/mysql");
}
