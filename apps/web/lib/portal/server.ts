import "server-only";
import { PORTAL_TENANT_COOKIE, type PortalMe } from "@remote/contracts/api/portal";
import { cookies } from "next/headers";
import { cache } from "react";
import { serverGet, type ServerResult } from "@/lib/server-api";
import { portalLoginPath, validSlug } from "./paths";

/*
 * P21: sunucu tarafı portal oturum okuması (mimari-p21 §6) — `GET /api/v1/portal/me`, çerezler iletilir (server-api kalıbı).
 * Panel `/auth/me` kullanılmaz; portal guard'ı yalnız `__Host-rs_portal` çerezini okur (ADR-0039).
 */
export type PortalMeState = { kind: "ok"; me: PortalMe } | { kind: "unauthenticated" } | { kind: "error"; status: number };

/** İstek başına tek `/portal/me` (kök layout teması + portal kabuğu + sayfa aynı sonucu paylaşır). */
export const getPortalMe = cache(async (): Promise<PortalMeState> => {
  const r = await serverGet<PortalMe>("/portal/me");
  if (r.kind === "ok") return { kind: "ok", me: r.data };
  if (r.status === 401) return { kind: "unauthenticated" };
  return { kind: "error", status: r.status };
});

export const portalGet = <T>(path: string): Promise<ServerResult<T>> => serverGet<T>(path);

/** Oturum düşünce giriş adresi (son firma kısa adı `rs_portal_tenant` çerezinden). */
export async function portalExpiredLogin(): Promise<string> {
  const slug = validSlug((await cookies()).get(PORTAL_TENANT_COOKIE)?.value);
  return portalLoginPath(slug, "expired");
}
