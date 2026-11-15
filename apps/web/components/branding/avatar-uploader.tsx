"use client";

import { Save, Trash2, Upload } from "lucide-react";
import { useId } from "react";
import Cropper from "react-easy-crop";
import { HiddenFileInput, UploadError } from "@/components/branding/image-pick";
import { useAvatarUploader, type AvatarUploaderState } from "@/components/branding/use-avatar-uploader";
import { FormError } from "@/components/form-error";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

/**
 * Profil resmi yükle / değiştir / kaldır (AC-83, 84). Dosya seçilince tür/boyut ön kontrolü ve tarayıcıda çözme
 * (SVG, sahte uzantı, bozuk dosya burada yakalanır; sunucu yine denetler). Kare kırpma diyaloğu (`react-easy-crop`,
 * yuvarlak önizleme, sürükle/ok tuşları + yakınlaştırma kaydırıcısı) → canvas ile 256×256 WEBP → POST multipart.
 * Kaldırma onaylı (yıkıcı, odak "Vazgeç"te). `userId`: `me` (kendi) veya yönetilen kullanıcının id'si.
 */
type AvatarUploaderProps = { userId: string; name: string; avatarUrl: string | null; canEdit: boolean; testId?: string };

export function AvatarUploader({ userId, name, avatarUrl, canEdit, testId = "avatar-uploader" }: AvatarUploaderProps) {
  const s = useAvatarUploader(userId, avatarUrl);
  const hintId = useId();

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={testId}
      data-has-avatar={s.url ? "true" : "false"}
      data-ready={s.ready ? "true" : "false"}
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} src={s.url} size="lg" testId={`${testId}-image`} />
        {canEdit && <AvatarActions s={s} hintId={hintId} testId={testId} />}
      </div>
      {canEdit && (
        <>
          <p id={hintId} className="text-xs text-fg-muted">
            {t("av.hint")}
          </p>
          <HiddenFileInput inputRef={s.inputRef} testId={testId} onFile={s.onFile} />
        </>
      )}
      <UploadError error={s.error} testId={testId} />
      <CropDialog s={s} />
      <RemoveDialog s={s} />
    </div>
  );
}

function AvatarActions({ s, hintId, testId }: { s: AvatarUploaderState; hintId: string; testId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => s.inputRef.current?.click()}
        disabled={s.busy}
        aria-describedby={hintId}
        data-testid={`${testId}-pick`}
      >
        <Upload aria-hidden className="size-4" />
        {s.url ? t("av.change") : t("av.upload")}
      </Button>
      {s.url && (
        <Button type="button" variant="danger-ghost" onClick={s.askRemove} disabled={s.busy} data-testid={`${testId}-remove`}>
          <Trash2 aria-hidden className="size-4" />
          {t("av.remove")}
        </Button>
      )}
    </div>
  );
}

function CropDialog({ s }: { s: AvatarUploaderState }) {
  return (
    <Dialog
      open={s.pick !== null}
      onClose={() => !s.busy && s.setPick(null)}
      title={t("av.cropTitle")}
      description={t("av.cropBody")}
      testId="avatar-crop-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={() => s.setPick(null)} disabled={s.busy} className="sm:ml-auto">
            {t("av.cancel")}
          </Button>
          <Button onClick={() => void s.save()} loading={s.busy} disabled={!s.area} data-testid="avatar-crop-save">
            {!s.busy && <Save aria-hidden className="size-4" />}
            {t("av.save")}
          </Button>
        </>
      }
    >
      {s.pick && <CropBody s={s} url={s.pick.url} />}
    </Dialog>
  );
}

function CropBody({ s, url }: { s: AvatarUploaderState; url: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-72 w-full overflow-hidden rounded-md bg-stage" data-testid="avatar-crop-area">
        <Cropper
          image={url}
          crop={s.crop}
          zoom={s.zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          disableAutomaticStylesInjection
          onCropChange={s.setCrop}
          onZoomChange={s.setZoom}
          onCropComplete={(_, px) => s.setArea(px)}
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
          value={s.zoom}
          onChange={(e) => s.setZoom(Number(e.target.value))}
          className="min-h-11 w-full cursor-pointer accent-primary"
          data-testid="avatar-zoom"
        />
      </label>
      {s.dialogError && <FormError error={s.dialogError} />}
    </div>
  );
}

function RemoveDialog({ s }: { s: AvatarUploaderState }) {
  return (
    <Dialog
      open={s.confirm}
      onClose={() => !s.busy && s.setConfirm(false)}
      role="alertdialog"
      size="sm"
      title={t("av.removeTitle")}
      description={t("av.removeBody")}
      testId="avatar-remove-dialog"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => s.setConfirm(false)} disabled={s.busy} className="sm:ml-auto">
            {t("av.cancel")}
          </Button>
          <Button variant="danger" loading={s.busy} onClick={() => void s.remove()} data-testid="avatar-remove-confirm">
            {!s.busy && <Trash2 aria-hidden className="size-4" />}
            {t("av.remove")}
          </Button>
        </>
      }
    >
      {s.dialogError && <FormError error={s.dialogError} />}
    </Dialog>
  );
}
