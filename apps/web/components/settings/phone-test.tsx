"use client";

import { Send } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { normalizePhone } from "@remote/contracts/api/requests";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type TestResult = { ok: boolean; message: string };

/**
 * Telefona test gönderimi (WhatsApp / SMS ayarları): numara E.164'e çevrilir (geçersizse alan hatası), POST `path`
 * `{ phone }`; 400 `fields.phone` alana, diğer hatalar sonuç bandına düşer. 401 `unauth` ile yönlendirilir.
 */
export function usePhoneTest<R>(path: string, toResult: (r: R) => TestResult, unauth: (e: unknown) => boolean) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const send = async () => {
    setResult(null);
    const p = normalizePhone(phone);
    if (!p) return setError(t("srs.err.phone"));
    setError(undefined);
    setTesting(true);
    try {
      const r = await api<R>("POST", path, { phone: p });
      setResult(toResult(r));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields?.phone) setError(err.fields.phone);
      else setResult({ ok: false, message: toUiError(err).message });
    } finally {
      setTesting(false);
    }
  };
  return { phone, setPhone, error, testing, result, send };
}

type FieldProps = Pick<ComponentProps<typeof TextField>, "label" | "type" | "inputMode" | "hint" | "disabled">;

/**
 * Test numarası alanı + gönder düğmesi + sonuç bandı (`resultTestId`). `divided`: satırın üstünde ayraç çizgisi
 * (destek talepleri bildirim bölümü).
 */
type RowProps = {
  test: ReturnType<typeof usePhoneTest>;
  field: FieldProps;
  fieldTestId?: string;
  button?: { disabled?: boolean; testId?: string };
  buttonLabel: string;
  resultTestId: string;
  divided?: boolean;
};

export function PhoneTestRow({ test, field, fieldTestId, button, buttonLabel, resultTestId, divided = false }: RowProps) {
  return (
    <>
      <div
        className={
          divided
            ? "flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-start"
            : "flex flex-col gap-2 sm:flex-row sm:items-start"
        }
      >
        <TextField
          {...field}
          className="min-w-0 flex-1"
          value={test.phone}
          onChange={(e) => test.setPhone(e.target.value)}
          error={test.error}
          data-testid={fieldTestId}
        />
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 sm:mt-7"
          loading={test.testing}
          disabled={button?.disabled}
          onClick={() => void test.send()}
          data-testid={button?.testId}
        >
          {!test.testing && <Send aria-hidden className="size-4" />}
          {buttonLabel}
        </Button>
      </div>
      {test.result && (
        <Alert tone={test.result.ok ? "success" : "danger"} testId={resultTestId}>
          {test.result.message}
        </Alert>
      )}
    </>
  );
}
