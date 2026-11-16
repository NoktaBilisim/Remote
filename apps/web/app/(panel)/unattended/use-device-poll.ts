"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { type DeviceListResponse, type DeviceListState } from "@/lib/unattended/contract";
import { appendPage, devicesApiPath, mergePoll, pollLimit } from "@/lib/unattended/query";

/**
 * P28u (§10, K-P28u-6; AC-429 ≤ 10 sn): panel yoklaması 8 sn (contracts `DEVICE_POLL_MS` 15 sn P27 değeri değiştirilmedi).
 * Yalnız sayfa açık ve sekme görünürken.
 */
export const UN_DEVICE_POLL_MS = 8_000;

type More = "idle" | "busy" | "error";
type Filter = { q: string | undefined; customerId: string | undefined; state: DeviceListState };

/** "Daha fazla yükle": keyset imleciyle sonraki sayfayı ekler; 401 dışı hatada `more=error`. */
function useLoadMore(
  cursor: string | null,
  setData: Dispatch<SetStateAction<DeviceListResponse>>,
  filter: Filter,
  fail: (e: unknown) => boolean,
) {
  const [more, setMore] = useState<More>("idle");
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setMore("busy");
    try {
      const next = await api<DeviceListResponse>("GET", devicesApiPath(filter, { cursor }));
      setData((prev) => appendPage(prev, next));
      setMore("idle");
    } catch (e) {
      if (!fail(e)) setMore("error");
    }
  }, [cursor, setData, filter, fail]);
  return { more, loadMore };
}

/**
 * Cihaz listesi verisi: ilk sayfa sunucudan (SSR), sonra 8 sn REST yoklaması (ADR-0029 kalıbı; sekme gizliyken
 * yoklanmaz). Yoklama hatasında son veri kalır ve `stale` bandı görünür (kısmi durum); sonraki başarılı yoklamada kalkar.
 * "Daha fazla yükle" keyset imleciyle ekler.
 */
export function useDevicePoll(initial: DeviceListResponse, q: string | undefined, customerId: string | undefined, state: DeviceListState) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const loaded = useRef(initial.items.length);
  useEffect(() => {
    loaded.current = data.items.length;
  }, [data]);

  const fail = useCallback(
    (e: unknown): boolean => {
      if (!isUnauthenticated(e)) return false;
      router.replace(EXPIRED_LOGIN_PATH);
      return true;
    },
    [router],
  );
  const filter = useMemo(() => ({ q, customerId, state }), [q, customerId, state]);

  const poll = useCallback(async () => {
    const limit = pollLimit(loaded.current);
    try {
      const next = await api<DeviceListResponse>("GET", devicesApiPath(filter, { limit }));
      setData((prev) => mergePoll(prev, next, limit));
      setStale(false);
    } catch (e) {
      if (!fail(e)) setStale(true);
    }
  }, [filter, fail]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, UN_DEVICE_POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const { more, loadMore } = useLoadMore(data.nextCursor, setData, filter, fail);
  return { data, stale, more, poll, loadMore };
}
