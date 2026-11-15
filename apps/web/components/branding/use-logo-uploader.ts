"use client";

import { useState } from "react";
import { useImagePick, useUploadRun } from "@/components/branding/image-pick";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { isDefaultLogo, uploadBody } from "@/lib/branding/image";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Preview = { url: string; file: File };

/**
 * Logo yükleyicisinin durumu (AC-81, 82): dosya seçimi → önizleme, "Kaydet" ile ham dosya POST, onaylı kaldırma (DELETE).
 * Seçim ve istek hataları tek `error` alanında; kaldırma başarısızsa onay diyaloğu kapanır, hata bileşen altında görünür.
 */
export function useLogoUploader(endpoint: string, logoUrl: string | null, savedMessage: string, removedMessage?: string) {
  const toast = useToast();
  const [url, setUrl] = useState(logoUrl);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { busy, run, router } = useUploadRun(setError);
  const picker = useImagePick("logo", setError, (picked) => setPreview({ url: picked.url, file: picked.file }));

  const save = async () => {
    if (!preview) return;
    await run(async () => {
      const r = await api<{ logoUrl: string | null }>("POST", endpoint, uploadBody(preview.file, preview.file.name));
      setUrl(r.logoUrl);
      setPreview(null);
      toast(savedMessage);
      router.refresh(); // üst menü logosu
    });
  };

  const remove = () =>
    run(
      async () => {
        const r = await api<{ logoUrl: string | null } | undefined>("DELETE", endpoint);
        setUrl(r?.logoUrl ?? null);
        setConfirm(false);
        toast(removedMessage ?? t("lg.removed"));
        router.refresh();
      },
      () => setConfirm(false),
    );

  return { ...picker, url, custom: !isDefaultLogo(url), preview, setPreview, busy, error, confirm, setConfirm, save, remove };
}

export type LogoUploaderState = ReturnType<typeof useLogoUploader>;
