"use client";

import type { AvatarResponse } from "@remote/contracts/api/branding";
import { useState } from "react";
import { useImagePick, useUploadRun, type PickedImage } from "@/components/branding/image-pick";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { AVATAR_PX, cropToBlob, uploadBody, type Area } from "@/lib/branding/image";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type AvatarPick = { url: string; img: HTMLImageElement; name: string };

/** Kırpma diyaloğu durumu: seçilen resim, konum, yakınlaştırma, kırpılan alan (yeni seçimde sıfırlanır). */
function useAvatarCrop() {
  const [pick, setPick] = useState<AvatarPick | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  const reset = (picked: PickedImage) => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    return { url: picked.url, img: picked.img, name: picked.file.name };
  };

  return { pick, setPick, crop, setCrop, zoom, setZoom, area, setArea, reset };
}

/** Kaydet (kırp → 256 px → POST) ve kaldır (DELETE) istekleri; başarıda URL güncellenir, bildirim ve sayfa yenileme. */
function useAvatarRequests(userId: string, avatarUrl: string | null, setDialogError: (e: UiError | null) => void) {
  const toast = useToast();
  const { busy, run, router } = useUploadRun(setDialogError);
  const [url, setUrl] = useState(avatarUrl);

  const done = (next: string | null, message: string) => {
    setUrl(next);
    toast(message);
    router.refresh(); // üst menü avatarı ve listeler
  };

  const upload = (pick: AvatarPick, area: Area, onSaved: () => void) =>
    run(async () => {
      const blob = await cropToBlob(pick.img, area, AVATAR_PX);
      const ext = blob.type === "image/webp" ? "webp" : "png";
      const r = await api<AvatarResponse>("POST", `/users/${userId}/avatar`, uploadBody(blob, `avatar.${ext}`));
      onSaved();
      done(r.avatarUrl, t("av.saved"));
    });

  const remove = (onRemoved: () => void) =>
    run(async () => {
      const r = await api<AvatarResponse>("DELETE", `/users/${userId}/avatar`);
      onRemoved();
      done(r?.avatarUrl ?? null, t("av.removed"));
    });

  return { url, busy, upload, remove };
}

/**
 * Profil resmi yükleyicisinin durumu (AC-83, 84): dosya seçimi (`useImagePick`), kırpma diyaloğu, kaldırma onayı ve
 * istekler. Seçim hatası `error` (bileşen altında), istek hatası `dialogError` (açık diyalogda) olarak ayrı tutulur.
 */
export function useAvatarUploader(userId: string, avatarUrl: string | null) {
  const [error, setError] = useState<UiError | null>(null);
  const [dialogError, setDialogError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const cropper = useAvatarCrop();
  const req = useAvatarRequests(userId, avatarUrl, setDialogError);
  const picker = useImagePick("avatar", setError, (picked) => {
    const next = cropper.reset(picked);
    setDialogError(null);
    cropper.setPick(next);
  });

  const save = async () => {
    if (!cropper.pick || !cropper.area) return;
    await req.upload(cropper.pick, cropper.area, () => cropper.setPick(null));
  };
  const remove = () => req.remove(() => setConfirm(false));
  const askRemove = () => (setDialogError(null), setConfirm(true));

  return { ...picker, ...cropper, url: req.url, busy: req.busy, error, dialogError, confirm, setConfirm, save, remove, askRemove };
}

export type AvatarUploaderState = ReturnType<typeof useAvatarUploader>;
