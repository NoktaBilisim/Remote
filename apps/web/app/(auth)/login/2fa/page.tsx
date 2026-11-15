import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { gateOf, getMe } from "@/lib/server-api";
import { MfaVerifyForm } from "./mfa-verify-form";

export const metadata: Metadata = { title: t("mfa.v.title") };

type Search = Promise<{ next?: string }>;

/** /login/2fa — girişin ikinci adımı (AC-67): doğrulama uygulamasındaki 6 haneli kod ya da kurtarma kodu. */
export default async function MfaVerifyPage({ searchParams }: { searchParams: Search }) {
  const { next } = await searchParams;
  const state = await getMe();
  // Yol herkese açık (proxy elemez): hiç giriş yapılmamışsa (oturum çerezi yok) nötr giriş; çerez var ama
  // geçersizse yarı oturumun süresi dolmuştur → "Oturumunuz sona erdi".
  if (state.kind === "unauthenticated") redirect((await cookies()).has(SESSION_COOKIE) ? EXPIRED_LOGIN_PATH : "/login");
  if (state.kind === "error") return <LoadError />;
  const gate = gateOf(state);
  if (gate !== "/login/2fa") redirect(gate ?? "/");
  // Super Admin hiçbir zaman (K-P27a-2); sunucu da false döner, istemci ayrıca eler
  const remember = state.kind === "ok" && state.me.user.role !== "SUPER_ADMIN" && state.me.mfa?.rememberDeviceAvailable === true;
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("mfa.v.title")}</h1>
      {/* P27a (AC-325): kutu yalnız sunucu izin veriyorsa (firma anahtarı açık, Super Admin değil) */}
      <MfaVerifyForm next={next ?? null} rememberAvailable={remember} />
    </>
  );
}
