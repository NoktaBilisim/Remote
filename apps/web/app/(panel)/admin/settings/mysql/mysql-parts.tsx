"use client";

import { LoaderCircle, Lock, PlugZap, Server, ShieldCheck } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { withoutLeadingTitle } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Section, SourceBadge } from "../section";
import type { MysqlFormState, TestResult } from "./use-mysql-form";

type P = { f: MysqlFormState };

/** Kaynak (ortam / panel), çalışan bağlantıyla uyuşmazlık, yeniden başlatma notu ve form üstü hata. */
export function MysqlAlerts({ f }: P) {
  return (
    <>
      {f.saved.source === "env" ? (
        <Alert tone="info" testId="mysql-env-source">
          {t("my.envSource")}
        </Alert>
      ) : (
        !f.saved.matchesRunning &&
        !f.applyNote && (
          <Alert tone="warning" testId="mysql-mismatch">
            {t("my.mismatch")}
          </Alert>
        )
      )}
      {f.applyNote && (
        <Alert tone="warning" testId="mysql-restart">
          {f.applyNote}
        </Alert>
      )}
      {f.formError && <FormError error={f.formError} />}
    </>
  );
}

export function ServerSection({ f }: P) {
  const { st, set, errors, saved } = f;
  return (
    <Section
      id="my-srv"
      title={t("my.server")}
      Icon={Server}
      aside={<SourceBadge source={saved.source} panel={t("sys.sourcePanelBadge")} env={t("sys.sourceEnvBadge")} />}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <TextField
          label={t("my.host")}
          value={st.host}
          onChange={set("host")}
          error={errors.host}
          placeholder="db.ornek.local"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={253}
          data-testid="mysql-host"
        />
        <TextField
          label={t("my.port")}
          value={st.port}
          onChange={set("port")}
          error={errors.port}
          hint={t("my.portHint")}
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          data-testid="mysql-port"
        />
      </div>
      <TextField
        label={t("my.database")}
        value={st.database}
        onChange={set("database")}
        error={errors.database}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={64}
        data-testid="mysql-database"
      />
      {saved.updatedAt && <p className="text-xs text-fg-muted">{t("sys.updatedAt", { at: formatDateTime(saved.updatedAt) })}</p>}
    </Section>
  );
}

export function AuthSection({ f }: P) {
  const { st, set, errors } = f;
  const hasPw = f.saved.hasPassword;
  return (
    <Section id="my-auth" title={t("my.auth")} Icon={Lock}>
      <TextField
        label={t("my.user")}
        value={st.user}
        onChange={set("user")}
        error={errors.user}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={32}
        data-testid="mysql-user"
      />
      <TextField
        label={t("my.password")}
        type="password"
        revealable
        value={st.password}
        onChange={set("password")}
        error={errors.password}
        placeholder={hasPw ? t("sys.secretKept") : undefined}
        hint={hasPw ? t("my.passwordKept") : t("my.passwordHint")}
        autoComplete="new-password"
        maxLength={200}
        data-testid="mysql-password"
      />
    </Section>
  );
}

/** P14a (AC-211): kayıtlı değer forma yüklenir ve her gövdede gönderilir (gönderilmezse sunucu false'a düşürür). */
export function TlsSection({ f }: P) {
  return (
    <Section id="my-tls" title={t("my.tlsTitle")} Icon={ShieldCheck}>
      <Switch
        label={t("my.requireTls")}
        checked={f.st.requireTls}
        onChange={(v) => f.setSt((s) => ({ ...s, requireTls: v }))}
        disabled={f.busy}
        description={t("my.requireTlsHint")}
        onText={t("my.requireTlsOn")}
        offText={t("my.requireTlsOff")}
        testId="mysql-require-tls"
      />
    </Section>
  );
}

function TestResultAlert({ result }: { result: TestResult }) {
  return (
    <Alert tone={result.tone} testId="mysql-test-result">
      <p className="font-medium">{result.title}</p>
      {withoutLeadingTitle(result.message, result.title) && <p className="mt-1">{withoutLeadingTitle(result.message, result.title)}</p>}
      {result.latencyMs !== undefined && (
        <p className="mt-1 tabular-nums" data-testid="mysql-test-latency">
          {t("my.latency", { ms: formatNumber(result.latencyMs) })}
        </p>
      )}
    </Alert>
  );
}

export function TestSection({ f }: P) {
  const { testing, result } = f;
  return (
    <Section id="my-test" title={t("my.testTitle")} Icon={PlugZap}>
      <p className="text-sm text-fg-muted" id="mysql-test-note">
        {t("my.testBody")}
      </p>
      {f.st.requireTls ? (
        <Alert tone="info" testId="mysql-tls-note">
          {t("my.tlsNoteOn")}
        </Alert>
      ) : (
        <Alert tone="warning" testId="mysql-tls-note">
          {t("my.tlsNote")}
        </Alert>
      )}
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        loading={testing}
        disabled={f.busy}
        aria-describedby="mysql-test-note"
        onClick={f.test}
        data-testid="mysql-test"
      >
        {!testing && <PlugZap aria-hidden className="size-4" />}
        {t("my.test")}
      </Button>
      {testing && (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="mysql-test-wait">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("my.testWait")}
        </p>
      )}
      {result && <TestResultAlert result={result} />}
    </Section>
  );
}
