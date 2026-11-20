"use client";

import {
  BellRing,
  Copy,
  Flag,
  Globe,
  KeyRound,
  Link2,
  Mail,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { SLA_MINUTES_MAX, SLA_MINUTES_MIN } from "@remote/contracts/api/requests";
import { labelOf, PRIORITY_LABELS } from "@remote/contracts/labels";
import { FormError } from "@/components/form-error";
import { SettingsSection } from "@/components/settings/section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { WAIT_MAX, WAIT_MIN, type SupportRequestSettings } from "@/lib/requests/contract";
import { REQUEST_PRIORITIES, type RequestPriority } from "@/lib/requests/p18";
import type { SettingsState } from "@/lib/requests/settings-form";
import { errText, SettingsList } from "./list-editor";
import type { SettingsCtx, useRotateRef } from "./use-settings-form";

/** Anahtar metinleri (Açık / Kapalı) — tüm bölüm anahtarlarında aynı. */
export const onOff = () => ({ onText: t("rq.on"), offText: t("rq.off") });

/** Kopyalanabilir adres satırı (indirme bağlantısı, web form adresi). */
function UrlRow({ url, testId, label, onCopy }: { url: string; testId: string; label: string; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code
        data-testid={testId}
        className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2.5 font-mono text-sm text-fg break-all"
      >
        {url}
      </code>
      <Button type="button" variant="secondary" onClick={onCopy} className="shrink-0" data-testid={`${testId}-copy`}>
        <Copy aria-hidden className="size-4" />
        {label}
      </Button>
    </div>
  );
}

export function DownloadSection({
  saved,
  onCopy,
  onRotate,
}: {
  saved: SupportRequestSettings;
  onCopy: (url?: string) => void;
  onRotate: () => void;
}) {
  return (
    <SettingsSection id="dl" title={t("srs.dl.title")} Icon={Link2}>
      <p className="text-sm text-fg-muted">{t("srs.dl.body")}</p>
      <UrlRow url={saved.downloadUrl} testId="download-url" label={t("srs.dl.copy")} onCopy={() => void onCopy()} />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-muted">{t("srs.dl.fileName")}</dt>
        <dd className="font-mono text-fg break-all" data-testid="download-file-name">
          {saved.fileName}
        </dd>
        <dt className="text-fg-muted">{t("srs.dl.rotatedAt")}</dt>
        <dd className="text-fg tabular-nums">{saved.refRotatedAt ? formatDateTime(saved.refRotatedAt) : t("srs.dl.never")}</dd>
      </dl>
      {/* P31 (AC-520): aynı bağlantı Mac'te .zip indirir (sunucu seçer) */}
      <p className="text-sm text-fg-muted" data-testid="download-mac-note">
        {t("rq.linkMacNote")}
      </p>
      <Button type="button" variant="danger-ghost" className="self-start" onClick={onRotate}>
        <RefreshCw aria-hidden className="size-4" />
        {t("srs.dl.rotate")}
      </Button>
    </SettingsSection>
  );
}

export function WaitSection({ ctx: { st, set, errors } }: { ctx: SettingsCtx }) {
  return (
    <SettingsSection id="wait" title={t("srs.wait.title")} Icon={Timer}>
      <TextField
        label={t("srs.wait.label")}
        type="number"
        inputMode="numeric"
        min={WAIT_MIN}
        max={WAIT_MAX}
        className="max-w-48"
        value={st.waitMinutes}
        onChange={(e) => set({ waitMinutes: e.target.value })}
        error={errText(errors.waitMinutes)}
        hint={t("srs.wait.hint", { min: WAIT_MIN, max: WAIT_MAX })}
      />
    </SettingsSection>
  );
}

/** P18 (AC-257): firma varsayılan önceliği ve SLA hedefi (müşteri tanımı öncelikli). */
export function PrioritySection({ ctx: { st, set, errors } }: { ctx: SettingsCtx }) {
  return (
    <SettingsSection id="prio" title={t("srs.prio.title")} Icon={Flag}>
      <p className="text-sm text-fg-muted">{t("srs.prio.body")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("srs.prio.label")}
          value={st.priority}
          onChange={(e) => set({ priority: e.target.value as RequestPriority })}
          options={[...REQUEST_PRIORITIES].reverse().map((p) => ({ value: p, label: labelOf(PRIORITY_LABELS, p) }))}
          data-testid="default-priority"
        />
        <TextField
          label={t("srs.sla.label")}
          type="number"
          inputMode="numeric"
          min={SLA_MINUTES_MIN}
          max={SLA_MINUTES_MAX}
          value={st.slaMinutes}
          onChange={(e) => set({ slaMinutes: e.target.value })}
          error={errText(errors.defaultSlaMinutes)}
          hint={t("srs.sla.hint", { min: SLA_MINUTES_MIN, max: SLA_MINUTES_MAX })}
          data-testid="default-sla"
        />
      </div>
      <Link
        href="/settings/business-hours"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-primary hover:underline"
      >
        <Timer aria-hidden className="size-4" />
        {t("srs.sla.hoursLink")}
      </Link>
    </SettingsSection>
  );
}

/** P15 (AC-239): kabul kodu — açıkken kabul, müşteri ekranındaki 4 haneli kodla tamamlanır (AC-112). */
export function AcceptCodeSection({ ctx: { st, set } }: { ctx: SettingsCtx }) {
  return (
    <SettingsSection id="ac" title={t("srs.ac.title")} Icon={KeyRound}>
      <Switch
        label={t("srs.ac.label")}
        checked={st.acceptCode}
        onChange={(v) => set({ acceptCode: v })}
        description={t("srs.ac.desc")}
        {...onOff()}
        testId="accept-code-switch"
      />
    </SettingsSection>
  );
}

/** P19 (AC-259): web talep formu — kapalıyken /r/<ref> tek tip 404 (kill switch, S-P19-T9). */
export function WebFormSection({ ctx: { st, set, saved }, onCopy }: { ctx: SettingsCtx; onCopy: (url?: string) => void }) {
  return (
    <SettingsSection id="wf" title={t("srs.wf.title")} Icon={Globe}>
      <Switch
        label={t("srs.wf.label")}
        checked={st.webForm}
        onChange={(v) => set({ webForm: v })}
        description={t("srs.wf.desc")}
        {...onOff()}
        testId="web-form-switch"
      />
      <UrlRow url={saved.webFormUrl} testId="web-form-url" label={t("srs.wf.copy")} onCopy={() => void onCopy(saved.webFormUrl)} />
      {!saved.webFormEnabled && (
        <p className="text-xs text-fg-muted" data-testid="web-form-off-hint">
          {t("srs.wf.offHint")}
        </p>
      )}
    </SettingsSection>
  );
}

const CHANNELS = [
  ["sms", "notifySms", MessageSquareText, "/settings/sms"],
  ["whatsapp", "notifyWa", MessageCircle, null],
  ["email", "notifyEmail", Mail, "/settings/smtp"],
] as const;

function ChannelRow({ ctx: { st, set }, ch, warn }: { ctx: SettingsCtx; ch: (typeof CHANNELS)[number]; warn: boolean }) {
  const [name, key, Icon, href] = ch;
  return (
    <div className="flex flex-col gap-2" data-testid={`notify-${name}`}>
      <Switch
        label={t(`srs.cn.${name}` as MessageKey)}
        checked={st[key]}
        onChange={(v) => set({ [key]: v } as Partial<SettingsState>)}
        {...onOff()}
        testId={`notify-${name}-switch`}
      />
      {warn && (
        <Alert tone="warning" testId={`channel-warning-${name}`}>
          <span className="flex flex-col gap-1">
            <span>{t(`srs.cn.warn.${name}` as MessageKey)}</span>
            {href && (
              <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium underline">
                <Icon aria-hidden className="size-4" />
                {t(`srs.cn.go.${name}` as MessageKey)}
              </Link>
            )}
          </span>
        </Alert>
      )}
    </div>
  );
}

/** P19 (AC-261): müşteriye durum bildirimi kanalları; açık ama kullanılamayan kanal → uyarı bandı. */
export function ChannelsSection({ ctx }: { ctx: SettingsCtx }) {
  const warnings = new Set(ctx.saved.channelWarnings ?? []);
  return (
    <SettingsSection id="cn" title={t("srs.cn.title")} Icon={BellRing}>
      <p className="text-sm text-fg-muted">{t("srs.cn.body")}</p>
      {CHANNELS.map((ch) => (
        <ChannelRow key={ch[0]} ctx={ctx} ch={ch} warn={warnings.has(ch[0])} />
      ))}
    </SettingsSection>
  );
}

export function CidrSection({ ctx }: { ctx: SettingsCtx }) {
  return (
    <SettingsSection id="cidr" title={t("srs.cidr.title")} Icon={ShieldCheck}>
      <p className="text-sm text-fg-muted">{t("srs.cidr.body")}</p>
      <SettingsList ctx={ctx} kind="cidr" />
    </SettingsSection>
  );
}

export function RotateDialog({ rot }: { rot: ReturnType<typeof useRotateRef> }) {
  return (
    <Dialog
      open={rot.open}
      onClose={() => !rot.busy && rot.setOpen(false)}
      size="sm"
      role="alertdialog"
      testId="rotate-dialog"
      title={t("srs.dl.rotateTitle")}
      description={t("srs.dl.rotateBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => rot.setOpen(false)} disabled={rot.busy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={rot.busy} onClick={() => void rot.rotate()}>
            {!rot.busy && <RefreshCw aria-hidden className="size-4" />}
            {t("srs.dl.rotateConfirm")}
          </Button>
        </>
      }
    >
      {rot.error && <FormError error={rot.error} />}
    </Dialog>
  );
}
