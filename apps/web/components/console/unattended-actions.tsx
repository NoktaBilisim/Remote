"use client";

import { Eye, EyeOff, Hand, Lock, LogOut, RefreshCw, UserCheck, UserX, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import { CONSENT_MODE_LABELS, REJOIN_WINDOW_SEC, type ConsentMode, type InterveneLogoffResponse } from "@/lib/unattended/contract";
import { interveneView, type UnattendedInfo } from "@/lib/unattended/consent";
import { unattendedUiError } from "@/lib/unattended/errors";
import type { ControlPhase } from "@/lib/control/machine";

const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";
const MODE: Readonly<Record<ConsentMode, { Icon: LucideIcon; cls: string }>> = {
  asked: { Icon: UserCheck, cls: "bg-success-surface text-success" },
  no_user: { Icon: UserX, cls: "bg-surface-muted text-fg-muted" },
  silent: { Icon: EyeOff, cls: "bg-warning-surface text-warning" },
};

/** Onay diyaloğu (müdahale / oturum kapatma). Yıkıcıda varsayılan odak "Vazgeç" (`data-autofocus`). */
function ConfirmDialog(p: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  Icon: LucideIcon;
  danger?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  testId: string;
}) {
  return (
    <Dialog
      open={p.open}
      onClose={p.onClose}
      title={p.title}
      description={p.body}
      size="sm"
      role="alertdialog"
      testId={p.testId}
      footer={
        <>
          <Button variant="secondary" onClick={p.onClose} disabled={p.busy} data-autofocus data-testid={`${p.testId}-cancel`}>
            {t("c.dismiss")}
          </Button>
          <Button variant={p.danger ? "danger" : "primary"} onClick={p.onConfirm} loading={p.busy} data-testid={`${p.testId}-confirm`}>
            {!p.busy && <p.Icon aria-hidden className="size-4" />}
            {p.confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/** Kilit / oturum kapatma REST çağrıları (§5.3). Hata toast'u sözleşme metniyle (`INTERVENE_FAILED` vb.). */
function useCommands(sessionId: string, onRejoin: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<"lock" | "logoff" | null>(null);
  const run = async (cmd: "lock" | "logoff"): Promise<boolean> => {
    setBusy(cmd);
    try {
      if (cmd === "lock") {
        await api("POST", `/sessions/${sessionId}/unattended/lock`, {});
        toast(t("un.intervene.lockDone"));
      } else {
        const r = await api<InterveneLogoffResponse>("POST", `/sessions/${sessionId}/unattended/logoff`, { confirm: true });
        toast(t("un.intervene.logoffDone"));
        if (r.rejoin) onRejoin();
      }
      return true;
    } catch (e) {
      if (isUnauthenticated(e)) {
        window.location.assign(EXPIRED_LOGIN_PATH);
        return false;
      }
      // D-P28u-2: oturum kapatma süre aşımı (502 INTERVENE_FAILED{timeout}) yine yeniden katılım penceresi açar
      if (cmd === "logoff" && e instanceof ApiError && e.code === "INTERVENE_FAILED" && e.fields?.reason === "timeout") onRejoin();
      toast(unattendedUiError(e).message, "danger");
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Kip rozeti: "İzinli" / "Kullanıcı yok" / "İzinsiz" (ikon + metin; renk tek başına anlam taşımaz). */
function ModeBadge({ mode }: { mode: ConsentMode }) {
  const { Icon, cls } = MODE[mode];
  return (
    <span className={`${pill} ${cls}`} data-testid="un-mode-badge" data-mode={mode}>
      <Icon aria-hidden className="size-3.5" />
      {t("un.intervene.mode", { mode: CONSENT_MODE_LABELS[mode] })}
    </span>
  );
}

/**
 * Konsol gözetimsiz müdahale çubuğu (mimari-p28u §10; AC-439, 442, 443). Katılımlı oturumda çizilmez. İzinsizde kontrol
 * yokken "İzleniyor" + onaylı "Müdahale et" (mevcut kontrol isteği); kontrolde "İzlemeye dön" (kontrolü bırak). Kontrol açıkken
 * (her kip) "Oturumu kilitle" (onaysız) ve "Kullanıcı oturumunu kapat" (onaylı, odak Vazgeç). `intervene:false` → pasif + neden.
 * Oturum kapatma sonrası en çok `REJOIN_WINDOW_SEC` "Cihaz yeniden bağlanıyor…" (sonucu sunucu belirler: katılım ya da bitiş).
 */
export function UnattendedActions({
  sessionId,
  unattended,
  phase,
  live,
  canControl,
  now,
  onIntervene,
  onReturn,
}: {
  sessionId: string;
  unattended: UnattendedInfo | null;
  phase: ControlPhase;
  live: boolean;
  canControl: boolean;
  now: number | null;
  onIntervene: () => void;
  onReturn: () => void;
}) {
  const [ask, setAsk] = useState<"intervene" | "logoff" | null>(null);
  const [rejoinUntil, setRejoinUntil] = useState<number | null>(null);
  const reasonId = useId();
  const cmd = useCommands(sessionId, () => setRejoinUntil(Date.now() + REJOIN_WINDOW_SEC * 1000));
  const v = interveneView(unattended, phase, live);
  if (!v) return null;
  const rejoining = rejoinUntil !== null && now !== null && now < rejoinUntil;
  const off = v.commandsDisabled;
  return (
    <section
      aria-label={t("un.intervene.group")}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
      data-testid="un-actions"
    >
      {v.mode && <ModeBadge mode={v.mode} />}
      {v.monitoring && (
        <>
          <span className={`${pill} bg-surface-muted text-fg-muted`} role="status" data-testid="un-monitoring">
            <Eye aria-hidden className="size-3.5" />
            {t("un.intervene.monitoring")}
          </span>
          <Button
            variant="primary"
            onClick={() => setAsk("intervene")}
            disabled={!canControl || phase === "requested"}
            data-testid="un-intervene"
          >
            <Hand aria-hidden className="size-4" />
            {t("un.intervene.start")}
          </Button>
        </>
      )}
      {v.canReturn && (
        <Button variant="secondary" onClick={onReturn} data-testid="un-return">
          <Eye aria-hidden className="size-4" />
          {t("un.intervene.back")}
        </Button>
      )}
      {v.showCommands && (
        <>
          <Button
            variant="secondary"
            onClick={() => void cmd.run("lock")}
            loading={cmd.busy === "lock"}
            disabled={off || cmd.busy !== null}
            aria-describedby={off ? reasonId : undefined}
            data-testid="un-lock"
          >
            {cmd.busy !== "lock" && <Lock aria-hidden className="size-4" />}
            {t("un.intervene.lock")}
          </Button>
          <Button
            variant="danger-ghost"
            onClick={() => setAsk("logoff")}
            loading={cmd.busy === "logoff"}
            disabled={off || cmd.busy !== null}
            aria-describedby={off ? reasonId : undefined}
            data-testid="un-logoff"
          >
            {cmd.busy !== "logoff" && <LogOut aria-hidden className="size-4" />}
            {t("un.intervene.logoff")}
          </Button>
          {off && (
            <p id={reasonId} className="text-xs text-fg-muted" data-testid="un-intervene-unsupported">
              {t("un.intervene.unsupported")}
            </p>
          )}
        </>
      )}
      {rejoining && (
        <p className="flex w-full items-start gap-2 text-sm text-fg" role="status" data-testid="un-rejoin">
          <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0 text-primary motion-safe:animate-spin" />
          <span>
            <b className="font-medium">{t("un.intervene.rejoin")}</b> {t("un.intervene.rejoinBody", { sec: REJOIN_WINDOW_SEC })}
          </span>
        </p>
      )}
      <ConfirmDialog
        open={ask === "intervene"}
        title={t("un.intervene.startTitle")}
        body={t("un.intervene.startBody")}
        confirmLabel={t("un.intervene.start")}
        Icon={Hand}
        onClose={() => setAsk(null)}
        onConfirm={() => {
          setAsk(null);
          onIntervene();
        }}
        testId="un-intervene-dialog"
      />
      <ConfirmDialog
        open={ask === "logoff"}
        title={t("un.intervene.logoffTitle")}
        body={t("un.intervene.logoffBody")}
        confirmLabel={t("un.intervene.logoffConfirm")}
        Icon={LogOut}
        danger
        busy={cmd.busy === "logoff"}
        onClose={() => setAsk(null)}
        onConfirm={() => void cmd.run("logoff").then(() => setAsk(null))}
        testId="un-logoff-dialog"
      />
    </section>
  );
}
