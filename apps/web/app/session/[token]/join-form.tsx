"use client";

import { joinSessionInputSchema, type JoinSessionResponse, type ResolveSessionResponse } from "@remote/contracts/api/sessions";
import { ScreenShare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { RecordingConsent } from "@/components/consent/recording-consent";
import { ChatRetentionNotice } from "@/components/kvkk/chat-retention-notice";
import { FormError } from "@/components/form-error";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { setRecConsent } from "@/lib/rec/consent-choice";
import { t } from "@/lib/i18n";
import type { GuestEnd } from "../guest-ui";
import { AgentDownload } from "./agent-download";
import { AgentSkeleton, type AgentOffer } from "./agent-offer";

export type ResolveData = ResolveSessionResponse;

const NONCE_MARGIN_MS = 5000;
const noop = () => () => undefined;
const END_CODES: Record<string, GuestEnd> = { SESSION_EXPIRED: "expired", SESSION_CANCELLED: "cancelled", SESSION_CONSUMED: "consumed" };

/**
 * Ad + aydınlatma onayı + "tarayıcıdan paylaş" (AC-26, 125, 127). joinNonce 60 sn: eskiyse sayfa sunucuda yeniden resolve edilir.
 * AC-27: Windows masaüstünde birincil yol "Hızlı Destek uygulamasını indir" (+ SmartScreen rehberi), tarayıcı ikincil.
 * İndirme ad/onaya bağlı değildir: istemci kendi karşılamasında onay ister (AC-98); buradaki ad yalnız tarayıcı modu içindir.
 */
export function JoinForm({
  data,
  agent = { state: "none" },
  onJoined,
  onEnd,
}: {
  data: ResolveData;
  /** AC-27 / P28f AC-396: indirme seçeneği (Windows / macOS); `none` → tarayıcı yolu birincil. */
  agent?: AgentOffer;
  onJoined: (r: JoinSessionResponse & { customerName: string }) => void;
  onEnd: (e: GuestEnd) => void;
}) {
  const router = useRouter();
  const windows = agent.state !== "none"; // indirme (ya da iskeleti) var → tarayıcı yolu ikincil
  const hintId = useId();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  /** P28e (AC-381): ayrı, işaretsiz kayıt rızası — yalnız bellekte; join başarılı olunca oturuma devredilir. */
  const [recConsent, setRecChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<string | undefined>();
  const [formErr, setFormErr] = useState<UiError | null>(null);
  const waitNonce = useRef<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const browserRef = useRef<HTMLButtonElement>(null);
  // Hidrasyon öncesi tıklama yerel form gönderimi (sayfa yenileme) yapmasın
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const retId = useId();
  // P22 (AC-292, mimari-p22 §8.2): saklama satırı çizilmeden (gün sayısı yok / < 1) tarayıcı yolu etkinleşmez
  const days = data.chatRetentionDays;
  const retentionShown = typeof days === "number" && Number.isInteger(days) && days >= 1;
  const ready = hydrated && name.trim().length >= 2 && consent && retentionShown;

  const submit = async () => {
    const input = {
      joinNonce: data.joinNonce,
      customerName: name,
      consentAccepted: consent,
      consentTextId: data.consentText.id,
    };
    const parsed = joinSessionInputSchema.safeParse(input);
    if (!parsed.success) {
      const nameIssue = parsed.error.issues.find((i) => i.path[0] === "customerName");
      if (nameIssue) setFieldErr(nameIssue.message);
      else setFormErr({ message: t("gj.err.nonce"), tone: "danger" });
      return;
    }
    setBusy(true);
    setFormErr(null);
    setFieldErr(undefined);
    if (Date.parse(data.nonceExpiresAt) - Date.now() < NONCE_MARGIN_MS) {
      waitNonce.current = data.joinNonce;
      return router.refresh();
    }
    try {
      const r = await api<JoinSessionResponse>("POST", "/public/sessions/join", parsed.data);
      setRecConsent(recConsent);
      onJoined({ ...r, customerName: parsed.data.customerName });
    } catch (e) {
      // 400'de nonce yanar (backend P4): metin güncellendiyse yeniden resolve edilir, kullanıcı yeniden onaylar
      if (e instanceof ApiError && e.fields?.consentTextId) {
        waitNonce.current = null;
        setBusy(false);
        setConsent(false);
        setFormErr({ message: e.fields.consentTextId, tone: "danger" });
        return router.refresh();
      }
      if (e instanceof ApiError && e.code === "NONCE_INVALID" && waitNonce.current === null) {
        waitNonce.current = data.joinNonce;
        return router.refresh();
      }
      waitNonce.current = null;
      setBusy(false);
      if (e instanceof ApiError && END_CODES[e.code]) return onEnd(END_CODES[e.code]!);
      if (e instanceof ApiError && e.fields?.customerName) return setFieldErr(e.fields.customerName);
      setFormErr(toUiError(e, { 403: t("gj.err.forbidden"), 409: t("gj.err.lobbyFull"), 410: t("gj.err.nonce") }));
    }
  };

  // router.refresh() sonrası yeni nonce geldi → aynı gönderimi sürdür
  useEffect(() => {
    if (waitNonce.current !== null && waitNonce.current !== data.joinNonce) {
      waitNonce.current = "retried";
      void submit();
    }
  });

  // 503 NOT_READY → tarayıcı modu: eksik varsa ad alanına, hazırsa paylaş düğmesine odak
  const toBrowser = () => {
    const el = ready ? browserRef.current : nameRef.current;
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && ready) void submit();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="join-form" data-ready={hydrated || undefined}>
      <section aria-labelledby="bilgi-t" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <h2 id="bilgi-t" className="text-lg font-semibold text-fg">
          {t("gj.infoTitle")}
        </h2>
        {formErr && <FormError error={formErr} />}
        <TextField
          label={t("gj.name")}
          hint={t("gj.nameHint")}
          placeholder={t("gj.namePlaceholder")}
          autoComplete="name"
          maxLength={100}
          ref={nameRef}
          value={name}
          error={fieldErr}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          data-testid="guest-name"
        />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
            data-testid="guest-consent"
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
          />
          <span>{t("gj.consent")}</span>
        </label>
        {
          <details className="rounded-md border border-border bg-canvas px-3 py-2 text-sm" data-testid="consent-text">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
              {t("gj.consentRead")}{" "}
              <span className="font-normal text-fg-muted">{t("gj.consentVersion", { v: data.consentText.version })}</span>
            </summary>
            <p className="pb-2 whitespace-pre-line text-fg-muted">{data.consentText.body}</p>
          </details>
        }
        <RecordingConsent consentText={data.consentText} checked={recConsent} disabled={busy} onChange={setRecChoice} />
      </section>

      <section aria-labelledby="yol-t" className="flex flex-col gap-3">
        <h2 id="yol-t" className="text-lg font-semibold text-fg">
          {t("gj.howTitle")}
        </h2>
        {agent.state === "loading" && <AgentSkeleton />}
        {agent.state === "ready" && (
          <AgentDownload
            sessionRef={data.sessionRef}
            verifyCode={data.techVerifyCode}
            os={agent.os}
            testBuild={agent.testBuild}
            onEnd={onEnd}
            onBrowser={toBrowser}
          />
        )}
        {retentionShown && <ChatRetentionNotice days={days} id={retId} />}
        <button
          ref={browserRef}
          type="submit"
          disabled={!ready || busy}
          aria-describedby={[retentionShown ? retId : "", ready ? "" : hintId].filter(Boolean).join(" ") || undefined}
          aria-busy={busy || undefined}
          data-testid="join-browser"
          className={`flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg bg-surface p-4 ${windows ? "border border-border" : "border-2 border-primary"} text-left shadow-sm transition-[transform,opacity] duration-150 ease-out hover:bg-primary-surface active:scale-[0.99] disabled:cursor-not-allowed disabled:border-border disabled:opacity-60 disabled:active:scale-100`}
        >
          <span className="inline-flex items-center gap-2 font-semibold text-fg">
            <ScreenShare aria-hidden className="size-5 text-primary" />
            {busy ? t("gj.joining") : t(windows ? "gj.browserWin" : "gj.browser")}
          </span>
          <span className="text-sm text-fg-muted">{t(windows ? "gj.browserWinBody" : "gj.browserBody")}</span>
        </button>
        {!ready && (
          <p id={hintId} className="text-xs text-fg-muted">
            {t("gj.missing")}
          </p>
        )}
      </section>
    </form>
  );
}
