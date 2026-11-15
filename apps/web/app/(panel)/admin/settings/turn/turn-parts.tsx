"use client";

import { KeyRound, Plus, Trash2, Waypoints } from "lucide-react";
import type { RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TURN_URLS_MAX } from "@/lib/admin-settings/contract";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EnvResetDialog } from "../env-reset";
import { Section, SourceBadge } from "../section";
import type { TurnFormState } from "./use-turn-form";

type P = { f: TurnFormState };

/** Ortam kaynağı bilgisi, secret uyarısı (her zaman) ve form üstü hata. */
export function TurnAlerts({ f }: P) {
  return (
    <>
      {f.saved.source === "env" && (
        <Alert tone="info" testId="turn-env-source">
          {t("tu.envSource")}
        </Alert>
      )}
      <Alert tone="warning" testId="turn-secret-warning">
        {t("tu.secretWarn")}
      </Alert>
      {f.formError && <FormError error={f.formError} />}
    </>
  );
}

function UrlRows({ f }: P) {
  return (
    <ol className="flex flex-col gap-3" data-testid="turn-urls">
      {f.st.urls.map((u, i) => (
        <li key={i} className="flex items-start gap-2">
          <TextField
            className="min-w-0 flex-1"
            label={t("tu.url", { n: i + 1 })}
            value={u}
            onChange={(e) => f.setUrl(i, e.target.value)}
            error={f.errors.url?.[i] || undefined}
            placeholder="turns:turn.ornek.com:443?transport=tcp"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={255}
            data-testid="turn-url"
          />
          <Button
            type="button"
            variant="ghost"
            className="mt-6 w-11 shrink-0 px-0 text-danger"
            aria-label={t("tu.remove", { n: i + 1 })}
            onClick={() => f.removeRow(i)}
            data-testid="turn-url-remove"
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </li>
      ))}
    </ol>
  );
}

export function UrlsSection({ f, addRef }: P & { addRef: RefObject<HTMLButtonElement | null> }) {
  const { st, errors, saved } = f;
  const filled = st.urls.filter((u) => u.trim() !== "").length;
  return (
    <Section
      id="tu-urls"
      title={t("tu.urls")}
      Icon={Waypoints}
      aside={<SourceBadge source={saved.source} panel={t("sys.sourcePanelBadge")} env={t("sys.sourceEnvBadge")} />}
    >
      <p className="text-sm text-fg-muted" id="turn-urls-hint">
        {t("tu.urlsHint")}
      </p>
      <UrlRows f={f} />
      {errors.urls && (
        <p className="text-xs font-medium text-danger" role="alert" data-testid="turn-urls-error">
          {errors.urls}
        </p>
      )}
      {filled === 0 && (
        <p className="text-sm text-fg-muted" data-testid="turn-no-urls">
          {t("tu.noUrls")}
        </p>
      )}
      <Button
        ref={addRef}
        type="button"
        variant="secondary"
        className="self-start"
        disabled={st.urls.length >= TURN_URLS_MAX}
        onClick={f.addRow}
        data-testid="turn-url-add"
      >
        <Plus aria-hidden className="size-4" />
        {t("tu.add")}
      </Button>
      {saved.updatedAt && <p className="text-xs text-fg-muted">{t("sys.updatedAt", { at: formatDateTime(saved.updatedAt) })}</p>}
    </Section>
  );
}

export function SecretSection({ f }: P) {
  const hasSecret = f.saved.hasSecret;
  return (
    <Section id="tu-secret" title={t("tu.secretTitle")} Icon={KeyRound}>
      <TextField
        label={t("tu.secret")}
        type="password"
        revealable
        value={f.st.secret}
        onChange={(e) => f.setSecret(e.target.value)}
        error={f.errors.secret}
        placeholder={hasSecret ? t("sys.secretKept") : undefined}
        hint={hasSecret ? t("tu.secretKeptHint") : t("tu.secretHint")}
        autoComplete="new-password"
        maxLength={256}
        data-testid="turn-secret"
      />
    </Section>
  );
}

/** "Ortam değerlerine dön" onayı (odak Vazgeç'te; işlem sürerken kapanmaz). */
export function ResetDialog({ f }: P) {
  return (
    <EnvResetDialog
      open={f.confirmReset}
      busy={f.busy}
      onCancel={() => f.setConfirmReset(false)}
      onConfirm={() => void f.doReset()}
      texts={{ title: t("tu.resetTitle"), body: t("tu.resetBody"), action: t("tu.reset") }}
      testId="turn-reset"
    />
  );
}
