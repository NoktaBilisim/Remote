"use client";

import { Trash2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { confirmNameMatches } from "@remote/contracts/api/users";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/**
 * Ad yazarak onay (P16, AC-241/242; DESIGN §6): geri alınamaz işlemler için `alertdialog`. Kullanıcı hedefin adını
 * birebir yazar (trim + NFC, harf duyarlı — sunucuyla aynı `confirmNameMatches`); eşleşmezse istek gitmez, alan altında
 * hata. İlk odak "Vazgeç" (yıkıcı onay kuralı). Gönderim sürerken Esc / X / Vazgeç kapatmaz. Sunucu hatası diyalog
 * içinde `role=alert` (`error`), alan hatası `fieldError`. `children` alanın üstünde (ör. silme önizlemesi);
 * `blocked` iken (önizleme yükleniyor/hatalı) alan ve onay pasif.
 */
export function ConfirmNameDialog({
  open,
  onClose,
  title,
  description,
  expectedName,
  confirmLabel,
  Icon = Trash2,
  busy,
  blocked = false,
  error,
  errorAction,
  fieldError,
  onTyped,
  onConfirm,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** Yazılması gereken ad (görünür etikette tırnak içinde). */
  expectedName: string;
  confirmLabel: string;
  Icon?: LucideIcon;
  busy: boolean;
  blocked?: boolean;
  error: UiError | null;
  /** Hata kutusunun altındaki eylem (ör. "Önizlemeyi yenile"). */
  errorAction?: ReactNode;
  /** Sunucudan gelen alan hatası (400 `fields.confirmName`). */
  fieldError?: string;
  /** Kullanıcı yazınca (üst bileşen sunucu alan hatasını temizler). */
  onTyped?: () => void;
  /** Eşleşen ad (kullanıcının yazdığı biçimde; sunucu normalize eder). */
  onConfirm: (typed: string) => void;
  children?: ReactNode;
  testId: string;
}) {
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  // Her açılışta boş başlar (başarı sonrası üst bileşen `open=false` yaptığında eski ad kalmasın)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTyped("");
      setMismatch(false);
    }
  }

  const close = () => {
    if (busy) return;
    setTyped("");
    setMismatch(false);
    onClose();
  };
  const submit = () => {
    if (busy || blocked) return;
    if (!confirmNameMatches(typed, expectedName)) return setMismatch(true);
    onConfirm(typed);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      onDismiss={close}
      role="alertdialog"
      size="sm"
      testId={testId}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="secondary"
            data-autofocus
            onClick={close}
            disabled={busy}
            className="sm:ml-auto"
            data-testid={`${testId}-cancel`}
          >
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={busy} disabled={blocked} onClick={submit} data-testid={`${testId}-confirm`}>
            {!busy && <Icon aria-hidden className="size-4" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {error && (
          <div className="flex flex-col gap-2" data-testid={`${testId}-error`}>
            <FormError error={error} />
            {errorAction}
          </div>
        )}
        <TextField
          label={t("cn.label", { name: expectedName })}
          hint={t("cn.hint")}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || blocked}
          error={fieldError ?? (mismatch ? t("cn.mismatch") : undefined)}
          data-testid={`${testId}-input`}
          onChange={(e) => {
            setTyped(e.target.value);
            setMismatch(false);
            onTyped?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </Dialog>
  );
}
