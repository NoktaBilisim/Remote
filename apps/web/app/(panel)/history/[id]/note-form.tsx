"use client";

import { NOTE_MAX, TICKET_NO_MAX, type SessionHistoryDetail } from "@remote/contracts/api/sessions";
import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatNumber } from "@/lib/format";
import { buildPatch, validateNote, type Errors, type Fields } from "@/lib/history/note";
import { t } from "@/lib/i18n";

const BACK = "__back__";

/**
 * Kaydedilmemiş değişiklikte ayrılma uyarısı: sekme kapatma/yenileme (beforeunload), uygulama içi bağlantılar
 * (yakalama aşaması) ve tarayıcı geri tuşu. Geri için: form kirlenince aynı URL'ye bir "nöbetçi" geçmiş kaydı
 * eklenir (Next'in desteklediği yerel `history.pushState`); geri basılınca sayfa yerinde kalır (aynı URL) ve
 * diyalog açılır. "Kaydetmeden ayrıl" bir adım daha geri gider; temiz formda nöbetçiden geri basılırsa
 * kullanıcı ikinci kez basmak zorunda kalmasın diye otomatik bir adım daha geri gidilir.
 */
function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const onSentinel = useRef(false);
  const dirtyRef = useRef(dirty);
  const here = useRef("");

  useEffect(() => {
    dirtyRef.current = dirty;
    if (dirty && !onSentinel.current) {
      here.current = location.pathname + location.search;
      window.history.pushState(window.history.state, "", location.href);
      onSentinel.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    const pop = () => {
      if (!onSentinel.current) return;
      onSentinel.current = false;
      if (location.pathname + location.search !== here.current) return; // birden çok adım geri: engellenemez
      if (dirtyRef.current) setTarget(BACK);
      else window.history.back();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      if (a.pathname === location.pathname && a.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(a.pathname + a.search + a.hash);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  const stay = () => {
    if (target === BACK) {
      // Geri tuşu nöbetçiyi tüketti; bir sonraki geri de yakalansın.
      window.history.pushState(window.history.state, "", location.href);
      onSentinel.current = true;
    }
    setTarget(null);
  };
  const leave = () => {
    if (!target) return;
    if (target === BACK) {
      dirtyRef.current = false;
      setTarget(null);
      window.history.back();
    } else if (onSentinel.current) {
      onSentinel.current = false;
      router.replace(target); // nöbetçinin yerine geçer; hedeften geri → bu sayfa (çift kayıt yok)
    } else router.push(target);
  };
  return { target, stay, leave };
}

/** Ticket no + not düzenleme (AC-63). Sayaç, istemci doğrulaması, kaydetme durumu, sunucu hatası forma, toast. */
export function NoteForm({ session }: { session: Pick<SessionHistoryDetail, "id" | "ticketNo" | "note"> }) {
  const router = useRouter();
  const toast = useToast();
  const noteId = useId();
  const [initial, setInitial] = useState<Fields>({ ticketNo: session.ticketNo ?? "", note: session.note ?? "" });
  const [v, setV] = useState<Fields>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = buildPatch(initial, v);
  const guard = useLeaveGuard(patch !== null && !busy);
  const noteLen = v.note.length;
  const noteOver = noteLen > NOTE_MAX;

  const change = (k: keyof Fields) => (e: { target: { value: string } }) => {
    setV((x) => ({ ...x, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!patch) return;
    const errs = validateNote(patch);
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const saved = await api<SessionHistoryDetail>("PATCH", `/sessions/${encodeURIComponent(session.id)}`, patch);
      const next = { ticketNo: saved.ticketNo ?? "", note: saved.note ?? "" };
      setInitial(next);
      setV(next);
      toast(t("h.n.saved"));
      router.refresh();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.fields) {
        const f: Errors = {};
        if (err.fields.ticketNo) f.ticketNo = err.fields.ticketNo;
        if (err.fields.note) f.note = err.fields.note;
        setErrors(f);
        if (!f.ticketNo && !f.note) setServerError(toUiError(err));
      } else setServerError(toUiError(err, { 404: t("h.d.notFoundTitle") }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="note-form" aria-busy={busy || undefined}>
      <FormError error={serverError} />
      <TextField
        label={t("h.n.ticket")}
        name="ticketNo"
        value={v.ticketNo}
        onChange={change("ticketNo")}
        error={errors.ticketNo}
        hint={`${t("h.n.ticketHint")} · ${t("h.n.count", { n: formatNumber(v.ticketNo.trim().length), max: TICKET_NO_MAX })}`}
        disabled={busy}
        autoComplete="off"
        data-testid="ticket-input"
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-sm font-medium text-fg">{t("h.n.note")}</label>
        <textarea
          id={noteId}
          name="note"
          rows={6}
          value={v.note}
          onChange={change("note")}
          disabled={busy}
          aria-invalid={errors.note || noteOver ? true : undefined}
          aria-describedby={`${noteId}-count${errors.note ? ` ${noteId}-err` : ""}`}
          data-testid="note-input"
          className={`w-full resize-y rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 sm:text-sm ${errors.note || noteOver ? "border-danger" : "border-border"}`}
        />
        <div className="flex flex-wrap justify-between gap-2 text-xs">
          {errors.note ? <p id={`${noteId}-err`} className="font-medium text-danger">{errors.note}</p> : <span />}
          <p id={`${noteId}-count`} className={`tabular-nums ${noteOver ? "font-medium text-danger" : "text-fg-muted"}`} data-testid="note-count" aria-live={noteLen > NOTE_MAX - 200 ? "polite" : "off"}>
            {t("h.n.count", { n: formatNumber(noteLen), max: formatNumber(NOTE_MAX) })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={!patch} data-testid="note-save">
          {!busy && <Save aria-hidden className="size-4" />}
          {t("h.n.save")}
        </Button>
        {patch && !busy && (
          <>
            <Button type="button" variant="ghost" onClick={() => { setV(initial); setErrors({}); setServerError(null); }}>
              <RotateCcw aria-hidden className="size-4" />
              {t("h.n.reset")}
            </Button>
            <p className="text-xs font-medium text-warning" role="status" data-testid="note-dirty">{t("h.n.unsaved")}</p>
          </>
        )}
      </div>
      <Dialog
        open={guard.target !== null}
        onClose={guard.stay}
        role="alertdialog"
        size="sm"
        testId="leave-dialog"
        title={t("h.n.leaveTitle")}
        description={t("h.n.leaveBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={guard.stay} className="sm:ml-auto">{t("h.n.stay")}</Button>
            <Button variant="danger-ghost" onClick={guard.leave}>{t("h.n.discard")}</Button>
          </>
        }
      />
    </form>
  );
}
