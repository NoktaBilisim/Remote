"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { FormError } from "@/components/form-error";
import { EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import {
  ACCEPT_ATTR,
  INVALID_IMAGE_MESSAGE,
  loadImage,
  precheckDimensions,
  precheckFile,
  readAsDataUrl,
  uploadError,
} from "@/lib/branding/image";
import type { UiError } from "@/lib/error-message";

/** Seçilip ön kontrolden geçmiş resim: data URL, çözülmüş `img`, ham dosya. */
export type PickedImage = { url: string; img: HTMLImageElement; file: File };

type SetError = (error: UiError | null) => void;

const noop = () => () => undefined;

/**
 * Logo / avatar yükleyicilerinin ortak dosya seçimi: gizli `input` ref'i, hidrasyon bayrağı (dosya seçimi olayları
 * ancak bundan sonra işlenir; e2e `data-ready` bekler) ve `onFile` — tür/boyut ön kontrolü → data URL → tarayıcıda
 * çözme → piksel boyutu kontrolü. Hata `setError`'a, başarı `onPicked`'e gider.
 */
export function useImagePick(kind: "logo" | "avatar", setError: SetError, onPicked: (picked: PickedImage) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const onFile = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ""; // aynı dosya yeniden seçilebilsin
    if (!file) return;
    setError(null);
    const pre = precheckFile(file);
    if (!pre.ok) return setError({ message: pre.message, tone: "danger" });
    try {
      const url = await readAsDataUrl(file);
      const img = await loadImage(url);
      const dims = precheckDimensions(img.naturalWidth, img.naturalHeight, kind);
      if (!dims.ok) return setError({ message: dims.message, tone: "danger" });
      onPicked({ url, img, file });
    } catch {
      setError({ message: INVALID_IMAGE_MESSAGE, tone: "danger" });
    }
  };

  return { inputRef, ready, onFile };
}

/**
 * Yükleme / kaldırma isteği sarmalayıcısı: meşgul bayrağı, hata temizliği, oturum düşmüşse giriş sayfasına yönlendirme,
 * aksi halde `onFail` ardından `uploadError` → `setError`.
 */
export function useUploadRun(setError: SetError) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, onFail?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      onFail?.();
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  return { busy, run, router };
}

/** Görünmez dosya girişi (düğme ile açılır; ekran okuyucudan ve sekme sırasından gizli). */
export function HiddenFileInput({
  inputRef,
  testId,
  onFile,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  testId: string;
  onFile: (file: File | undefined) => Promise<void>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT_ATTR}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid={`${testId}-input`}
      onChange={(e) => void onFile(e.target.files?.[0])}
    />
  );
}

/** Seçim / yükleme hatası (yükleyicinin altında; `${testId}-error`). */
export function UploadError({ error, testId }: { error: UiError | null; testId: string }) {
  if (!error) return null;
  return (
    <div data-testid={`${testId}-error`}>
      <FormError error={error} />
    </div>
  );
}
