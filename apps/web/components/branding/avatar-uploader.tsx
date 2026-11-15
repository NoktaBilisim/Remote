"use client";

import type { AvatarResponse } from "@remote/contracts/api/branding";
import { Save, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import Cropper from "react-easy-crop";
import { FormError } from "@/components/form-error";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import {
  ACCEPT_ATTR,
  AVATAR_PX,
  cropToBlob,
  INVALID_IMAGE_MESSAGE,
  loadImage,
  precheckDimensions,
  precheckFile,
  readAsDataUrl,
  uploadBody,
  uploadError,
  type Area,
} from "@/lib/branding/image";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Pick = { url: string; img: HTMLImageElement; name: string };

const noop = () => () => undefined;

/**
 * Profil resmi yükle / değiştir / kaldır (AC-83, 84). Dosya seçilince tür/boyut ön kontrolü ve tarayıcıda çözme
 * (SVG, sahte uzantı, bozuk dosya burada yakalanır; sunucu yine denetler). Kare kırpma diyaloğu (`react-easy-crop`,
 * yuvarlak önizleme, sürükle/ok tuşları + yakınlaştırma kaydırıcısı) → canvas ile 256×256 WEBP → POST multipart.
 * Kaldırma onaylı (yıkıcı, odak "Vazgeç"te). `userId`: `me` (kendi) veya yönetilen kullanıcının id'si.
 */
export function AvatarUploader({
  userId,
  name,
  avatarUrl,
  canEdit,
  testId = "avatar-uploader",
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  canEdit: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  // Hidrasyon tamamlandı (dosya seçimi olayları ancak bundan sonra işlenir; e2e bekler)
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const [url, setUrl] = useState(avatarUrl);
  const [pick, setPick] = useState<Pick | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [dialogError, setDialogError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ""; // aynı dosya yeniden seçilebilsin
    if (!file) return;
    setError(null);
    const pre = precheckFile(file);
    if (!pre.ok) return setError({ message: pre.message, tone: "danger" });
    try {
      const dataUrl = await readAsDataUrl(file);
      const img = await loadImage(dataUrl);
      const dims = precheckDimensions(img.naturalWidth, img.naturalHeight, "avatar");
      if (!dims.ok) return setError({ message: dims.message, tone: "danger" });
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setArea(null);
      setDialogError(null);
      setPick({ url: dataUrl, img, name: file.name });
    } catch {
      setError({ message: INVALID_IMAGE_MESSAGE, tone: "danger" });
    }
  };

  const done = (next: string | null, message: string) => {
    setUrl(next);
    toast(message);
    router.refresh(); // üst menü avatarı ve listeler
  };

  const save = async () => {
    if (!pick || !area) return;
    setBusy(true);
    setDialogError(null);
    try {
      const blob = await cropToBlob(pick.img, area, AVATAR_PX);
      const ext = blob.type === "image/webp" ? "webp" : "png";
      const r = await api<AvatarResponse>("POST", `/users/${userId}/avatar`, uploadBody(blob, `avatar.${ext}`));
      setPick(null);
      done(r.avatarUrl, t("av.saved"));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setDialogError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await api<AvatarResponse>("DELETE", `/users/${userId}/avatar`);
      setConfirm(false);
      done(r?.avatarUrl ?? null, t("av.removed"));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setDialogError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={testId}
      data-has-avatar={url ? "true" : "false"}
      data-ready={ready ? "true" : "false"}
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} src={url} size="lg" testId={`${testId}-image`} />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-describedby={hintId}
              data-testid={`${testId}-pick`}
            >
              <Upload aria-hidden className="size-4" />
              {url ? t("av.change") : t("av.upload")}
            </Button>
            {url && (
              <Button
                type="button"
                variant="danger-ghost"
                onClick={() => (setDialogError(null), setConfirm(true))}
                disabled={busy}
                data-testid={`${testId}-remove`}
              >
                <Trash2 aria-hidden className="size-4" />
                {t("av.remove")}
              </Button>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <>
          <p id={hintId} className="text-xs text-fg-muted">
            {t("av.hint")}
          </p>
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
        </>
      )}
      {error && (
        <div data-testid={`${testId}-error`}>
          <FormError error={error} />
        </div>
      )}

      <Dialog
        open={pick !== null}
        onClose={() => !busy && setPick(null)}
        title={t("av.cropTitle")}
        description={t("av.cropBody")}
        testId="avatar-crop-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPick(null)} disabled={busy} className="sm:ml-auto">
              {t("av.cancel")}
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!area} data-testid="avatar-crop-save">
              {!busy && <Save aria-hidden className="size-4" />}
              {t("av.save")}
            </Button>
          </>
        }
      >
        {pick && (
          <div className="flex flex-col gap-4">
            <div className="relative h-72 w-full overflow-hidden rounded-md bg-stage" data-testid="avatar-crop-area">
              <Cropper
                image={pick.url}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                disableAutomaticStylesInjection
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, px) => setArea(px)}
                mediaProps={{ alt: t("av.preview") }}
                cropperProps={{ role: "group", "aria-label": t("av.cropArea") }}
              />
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-fg">
              {t("av.zoom")}
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="min-h-11 w-full cursor-pointer accent-primary"
                data-testid="avatar-zoom"
              />
            </label>
            {dialogError && <FormError error={dialogError} />}
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        role="alertdialog"
        size="sm"
        title={t("av.removeTitle")}
        description={t("av.removeBody")}
        testId="avatar-remove-dialog"
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)} disabled={busy} className="sm:ml-auto">
              {t("av.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="avatar-remove-confirm">
              {!busy && <Trash2 aria-hidden className="size-4" />}
              {t("av.remove")}
            </Button>
          </>
        }
      >
        {dialogError && <FormError error={dialogError} />}
      </Dialog>
    </div>
  );
}
