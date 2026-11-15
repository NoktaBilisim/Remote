"use client";

import { ImageUp, Save, Trash2, X } from "lucide-react";
import { useId } from "react";
import { LogoImage } from "@/components/brand-logo";
import { HiddenFileInput, UploadError } from "@/components/branding/image-pick";
import { useLogoUploader, type LogoUploaderState } from "@/components/branding/use-logo-uploader";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

/** P15 (AC-233): kaldırma metinleri (sistem logosu: "varsayılan Nokta logosu"); verilmezse firma logosu metinleri. */
type LogoTexts = { none: string; removeTitle: string; removeBody: string; removed: string };

type LogoUploaderProps = {
  endpoint: string;
  logoUrl: string | null;
  alt: string;
  canEdit: boolean;
  removable: boolean;
  savedMessage: string;
  texts?: LogoTexts;
  testId?: string;
};

/**
 * Logo yükle / değiştir / kaldır (AC-81 firma, AC-82 sistem). Seçilen dosya ön kontrolden ve tarayıcıda çözmeden geçer,
 * **önizleme** (açık zeminli kart — koyu temada da okunur) gösterilir; "Kaydet" ile ham dosya yüklenir (sunucu
 * 512 px'e küçültür, EXIF siler). `removable` iken kaldırma onaylıdır; kaldırınca sistem logosu gösterilir (sistem logosu
 * kaldırılınca varsayılan Nokta logosu — P15, AC-233).
 */
export function LogoUploader({
  endpoint,
  logoUrl,
  alt,
  canEdit,
  removable,
  savedMessage,
  texts,
  testId = "logo-uploader",
}: LogoUploaderProps) {
  const s = useLogoUploader(endpoint, logoUrl, savedMessage, texts?.removed);
  const hintId = useId();

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={testId}
      data-custom={s.custom ? "true" : "false"}
      data-ready={s.ready ? "true" : "false"}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <CurrentLogo s={s} alt={alt} none={removable ? (texts?.none ?? t("lg.none")) : null} testId={testId} />
        {s.preview && <PreviewLogo url={s.preview.url} testId={testId} />}
      </div>

      <UploadError error={s.error} testId={testId} />

      {canEdit && (
        <>
          <p id={hintId} className="text-xs text-fg-muted">
            {t("lg.hint")}
          </p>
          <LogoActions s={s} removable={removable} hintId={hintId} testId={testId} />
          <HiddenFileInput inputRef={s.inputRef} testId={testId} onFile={s.onFile} />
        </>
      )}

      <RemoveDialog s={s} texts={texts} />
    </div>
  );
}

/** Geçerli logo; `none` verilmişse (kaldırılabilir) ve özel logo yoksa "logo yok" notu. */
function CurrentLogo({ s, alt, none, testId }: { s: LogoUploaderState; alt: string; none: string | null; testId: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-fg">{t("lg.current")}</figcaption>
      <div className="flex min-h-24 items-center rounded-lg border border-border bg-surface-muted p-2">
        <LogoImage variant="full" url={s.url} alt={s.custom ? alt : t("app.systemLogoAlt")} testId={`${testId}-current`} />
      </div>
      {!s.custom && none !== null && (
        <p className="text-xs text-fg-muted" data-testid={`${testId}-none`}>
          {none}
        </p>
      )}
    </figure>
  );
}

function PreviewLogo({ url, testId }: { url: string; testId: string }) {
  return (
    <figure className="flex flex-col gap-2" data-testid={`${testId}-preview`}>
      <figcaption className="text-sm font-medium text-fg">{t("lg.preview")}</figcaption>
      <div className="flex min-h-24 items-center rounded-lg border-2 border-dashed border-primary bg-surface-muted p-2">
        <span className="inline-flex h-20 items-center rounded-lg bg-logo-surface px-3 py-2">
          <img src={url} alt={t("lg.previewAlt")} className="h-16 w-auto max-w-64 object-contain" />
        </span>
      </div>
    </figure>
  );
}

function LogoActions({ s, removable, hintId, testId }: { s: LogoUploaderState; removable: boolean; hintId: string; testId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {s.preview ? (
        <>
          <Button onClick={() => void s.save()} loading={s.busy} data-testid={`${testId}-save`}>
            {!s.busy && <Save aria-hidden className="size-4" />}
            {t("lg.save")}
          </Button>
          <Button variant="secondary" onClick={() => s.setPreview(null)} disabled={s.busy}>
            <X aria-hidden className="size-4" />
            {t("lg.cancel")}
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={() => s.inputRef.current?.click()}
          disabled={s.busy}
          aria-describedby={hintId}
          data-testid={`${testId}-pick`}
        >
          <ImageUp aria-hidden className="size-4" />
          {s.custom ? t("lg.change") : t("lg.pick")}
        </Button>
      )}
      {removable && s.custom && !s.preview && (
        <Button variant="danger-ghost" onClick={() => s.setConfirm(true)} disabled={s.busy} data-testid={`${testId}-remove`}>
          <Trash2 aria-hidden className="size-4" />
          {t("lg.remove")}
        </Button>
      )}
    </div>
  );
}

function RemoveDialog({ s, texts }: { s: LogoUploaderState; texts: LogoTexts | undefined }) {
  return (
    <Dialog
      open={s.confirm}
      onClose={() => !s.busy && s.setConfirm(false)}
      role="alertdialog"
      size="sm"
      title={texts?.removeTitle ?? t("lg.removeTitle")}
      description={texts?.removeBody ?? t("lg.removeBody")}
      testId="logo-remove-dialog"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => s.setConfirm(false)} disabled={s.busy} className="sm:ml-auto">
            {t("lg.cancel")}
          </Button>
          <Button variant="danger" loading={s.busy} onClick={() => void s.remove()} data-testid="logo-remove-confirm">
            {!s.busy && <Trash2 aria-hidden className="size-4" />}
            {t("lg.remove")}
          </Button>
        </>
      }
    />
  );
}
