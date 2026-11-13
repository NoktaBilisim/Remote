"use client";

import { ImageUp, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { LogoImage } from "@/components/brand-logo";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { ACCEPT_ATTR, INVALID_IMAGE_MESSAGE, isDefaultLogo, loadImage, precheckDimensions, precheckFile, readAsDataUrl, uploadBody, uploadError } from "@/lib/branding/image";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Preview = { url: string; file: File };

const noop = () => () => undefined;

/**
 * Logo yükle / değiştir / kaldır (AC-81 firma, AC-82 sistem). Seçilen dosya ön kontrolden ve tarayıcıda çözmeden geçer,
 * **önizleme** (açık zeminli kart — koyu temada da okunur) gösterilir; "Kaydet" ile ham dosya yüklenir (sunucu
 * 512 px'e küçültür, EXIF siler). `removable` iken kaldırma onaylıdır; kaldırınca sistem logosu gösterilir.
 */
export function LogoUploader({
  endpoint,
  logoUrl,
  alt,
  canEdit,
  removable,
  savedMessage,
  testId = "logo-uploader",
}: {
  endpoint: string;
  logoUrl: string | null;
  alt: string;
  canEdit: boolean;
  removable: boolean;
  savedMessage: string;
  testId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  // Hidrasyon tamamlandı (dosya seçimi olayları ancak bundan sonra işlenir; e2e bekler)
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const [url, setUrl] = useState(logoUrl);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);


  const custom = !isDefaultLogo(url);

  const onFile = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setError(null);
    const pre = precheckFile(file);
    if (!pre.ok) return setError({ message: pre.message, tone: "danger" });
    try {
      const dataUrl = await readAsDataUrl(file);
      const img = await loadImage(dataUrl);
      const dims = precheckDimensions(img.naturalWidth, img.naturalHeight, "logo");
      if (!dims.ok) return setError({ message: dims.message, tone: "danger" });
      setPreview({ url: dataUrl, file });
    } catch {
      setError({ message: INVALID_IMAGE_MESSAGE, tone: "danger" });
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ logoUrl: string | null }>("POST", endpoint, uploadBody(preview.file, preview.file.name));
      setUrl(r.logoUrl);
      setPreview(null);
      toast(savedMessage);
      router.refresh(); // üst menü logosu
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<{ logoUrl: string | null }>("DELETE", endpoint);
      setUrl(null);
      setConfirm(false);
      toast(t("lg.removed"));
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirm(false);
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid={testId} data-custom={custom ? "true" : "false"} data-ready={ready ? "true" : "false"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <figure className="flex flex-col gap-2">
          <figcaption className="text-sm font-medium text-fg">{t("lg.current")}</figcaption>
          <div className="flex min-h-24 items-center rounded-lg border border-border bg-surface-muted p-2">
            <LogoImage variant="full" url={url} alt={custom ? alt : t("app.systemLogoAlt")} testId={`${testId}-current`} />
          </div>
          {!custom && removable && <p className="text-xs text-fg-muted" data-testid={`${testId}-none`}>{t("lg.none")}</p>}
        </figure>
        {preview && (
          <figure className="flex flex-col gap-2" data-testid={`${testId}-preview`}>
            <figcaption className="text-sm font-medium text-fg">{t("lg.preview")}</figcaption>
            <div className="flex min-h-24 items-center rounded-lg border-2 border-dashed border-primary bg-surface-muted p-2">
              <span className="inline-flex h-20 items-center rounded-lg bg-logo-surface px-3 py-2">
                <img src={preview.url} alt={t("lg.previewAlt")} className="h-16 w-auto max-w-64 object-contain" />
              </span>
            </div>
          </figure>
        )}
      </div>

      {error && (
        <div data-testid={`${testId}-error`}>
          <FormError error={error} />
        </div>
      )}

      {canEdit && (
        <>
          <p id={hintId} className="text-xs text-fg-muted">{t("lg.hint")}</p>
          <div className="flex flex-wrap gap-2">
            {preview ? (
              <>
                <Button onClick={() => void save()} loading={busy} data-testid={`${testId}-save`}>
                  {!busy && <Save aria-hidden className="size-4" />}
                  {t("lg.save")}
                </Button>
                <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                  <X aria-hidden className="size-4" />
                  {t("lg.cancel")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy} aria-describedby={hintId} data-testid={`${testId}-pick`}>
                <ImageUp aria-hidden className="size-4" />
                {custom ? t("lg.change") : t("lg.pick")}
              </Button>
            )}
            {removable && custom && !preview && (
              <Button variant="danger-ghost" onClick={() => setConfirm(true)} disabled={busy} data-testid={`${testId}-remove`}>
                <Trash2 aria-hidden className="size-4" />
                {t("lg.remove")}
              </Button>
            )}
          </div>
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

      <Dialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        role="alertdialog"
        size="sm"
        title={t("lg.removeTitle")}
        description={t("lg.removeBody")}
        testId="logo-remove-dialog"
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)} disabled={busy} className="sm:ml-auto">
              {t("lg.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="logo-remove-confirm">
              {!busy && <Trash2 aria-hidden className="size-4" />}
              {t("lg.remove")}
            </Button>
          </>
        }
      />
    </div>
  );
}
