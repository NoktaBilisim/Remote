"use client";

import { LoaderCircle, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n";
import { Section } from "../section";
import { useWaTest, type TestResult } from "./use-wa-test";

type TestState = ReturnType<typeof useWaTest>;

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
  const s = useWaTest();

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
      <TestForm s={s} canTest={canTest} ready={ready} />
      {s.testing && (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="wa-test-wait">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("wa.svc.testWait")}
        </p>
      )}
      {s.result && <TestResultAlert result={s.result} />}
    </Section>
  );
}

function TestForm({ s, canTest, ready }: { s: TestState; canTest: boolean; ready: boolean }) {
  return (
    <form
      noValidate
      onSubmit={s.test}
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
        value={s.phone}
        onChange={(e) => s.changePhone(e.target.value)}
        error={s.phoneError}
        hint={t("wa.svc.testPhoneHint")}
        disabled={!canTest || s.testing}
        maxLength={40}
        data-testid="wa-test-phone"
      />
      <Button
        type="submit"
        variant="secondary"
        className="shrink-0 sm:mt-7"
        loading={s.testing}
        disabled={!canTest}
        aria-describedby="wa-test-note"
        data-testid="wa-test-send"
      >
        {!s.testing && <Send aria-hidden className="size-4" />}
        {t("wa.svc.test")}
      </Button>
    </form>
  );
}

function TestResultAlert({ result }: { result: TestResult }) {
  return (
    <Alert tone={result.tone} testId="wa-test-result">
      <p className="font-medium">{result.title}</p>
      {result.message && result.message !== result.title && <p className="mt-1">{result.message}</p>}
    </Alert>
  );
}
