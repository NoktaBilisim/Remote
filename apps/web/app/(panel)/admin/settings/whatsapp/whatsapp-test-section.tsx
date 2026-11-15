"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { checkTestPhone, type WhatsappServiceTestResponse } from "@/lib/admin-settings/whatsapp";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { Section } from "../section";

const PATH = "/admin/settings/whatsapp";
type TestResult = { tone: "success" | "danger" | "locked"; title: string; message: string };

/** Test mesajı bölümü (AC-196): kayıtlı etkin adresle tek deneme; sonuç ekranda kalır. */
export function WhatsappTestSection({
  configured,
  canTest,
  dirty,
  ready,
}: {
  configured: boolean;
  canTest: boolean;
  dirty: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const test = async (e: FormEvent) => {
    e.preventDefault();
    if (testing) return;
    setResult(null);
    const c = checkTestPhone(phone);
    if (!c.phoneNumber) {
      setPhoneError(c.error);
      return;
    }
    setPhoneError(undefined);
    setTesting(true);
    try {
      const r = await api<WhatsappServiceTestResponse>("POST", `${PATH}/test`, { phoneNumber: c.phoneNumber });
      setResult(
        r.ok
          ? { tone: "success", title: t("wa.svc.testOk"), message: r.message }
          : { tone: "danger", title: t("wa.svc.testFail"), message: r.message },
      );
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields?.phoneNumber) setPhoneError(err.fields.phoneNumber);
      else if (err instanceof ApiError && err.status === 429)
        setResult({ tone: "locked", title: t("wa.svc.testFail"), message: err.message || t("wa.svc.testRate") });
      else setResult({ tone: "danger", title: t("wa.svc.testFail"), message: toUiError(err).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section id="wa-test" title={t("wa.svc.testTitle")} Icon={Send}>
      <p className="text-sm text-fg-muted" id="wa-test-note">
        {t("wa.svc.testBody")}
      </p>
      {!configured && (
        <p className="text-sm font-medium text-fg" data-testid="wa-test-disabled">
          {t("wa.svc.testDisabled")}
        </p>
      )}
      {configured && dirty && (
        <p className="text-sm text-fg" data-testid="wa-test-dirty">
          {t("wa.svc.testDirty")}
        </p>
      )}
      <form
        noValidate
        onSubmit={test}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        data-testid="wa-test-form"
        data-ready={ready ? "true" : "false"}
      >
        <TextField
          className="min-w-0 flex-1"
          label={t("wa.svc.testPhone")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneError(undefined);
          }}
          error={phoneError}
          hint={t("wa.svc.testPhoneHint")}
          disabled={!canTest || testing}
          maxLength={40}
          data-testid="wa-test-phone"
        />
        <Button
          type="submit"
          variant="secondary"
          className="shrink-0 sm:mt-7"
          loading={testing}
          disabled={!canTest}
          aria-describedby="wa-test-note"
          data-testid="wa-test-send"
        >
          {!testing && <Send aria-hidden className="size-4" />}
          {t("wa.svc.test")}
        </Button>
      </form>
      {testing && (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="wa-test-wait">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("wa.svc.testWait")}
        </p>
      )}
      {result && (
        <Alert tone={result.tone} testId="wa-test-result">
          <p className="font-medium">{result.title}</p>
          {result.message && result.message !== result.title && <p className="mt-1">{result.message}</p>}
        </Alert>
      )}
    </Section>
  );
}
