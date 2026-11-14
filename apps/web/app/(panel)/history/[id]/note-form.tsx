"use client";

import { NOTE_MAX, TICKET_NO_MAX, type SessionHistoryDetail } from "@remote/contracts/api/sessions";
import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { LeaveDialog } from "@/components/leave-dialog";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatNumber } from "@/lib/format";
import { isAnonymizedError } from "@/lib/history/anonymized";
import { buildPatch, validateNote, type Errors, type Fields } from "@/lib/history/note";
import { t } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/use-leave-guard";

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
  // P13a (AC-197): sayfa açıkken saklama işi oturumu anonimleştirdiyse PATCH 409 SESSION_ANONYMIZED → form kilitlenir
  const [locked, setLocked] = useState(false);
  const patch = locked ? null : buildPatch(initial, v);
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
      if (isAnonymizedError(err)) {
        // Değişiklik kaydedilemez → kirli durum ve ayrılma uyarısı kalkar; sayfa yenilenince salt okunur görünüme geçer
        setLocked(true);
        setV(initial);
        setErrors({});
        setServerError({ message: t("h.anon.conflict"), tone: "danger", requestId: err instanceof ApiError ? err.requestId : undefined });
        toast(t("h.anon.conflict"), "danger");
        router.refresh();
      } else if (err instanceof ApiError && err.fields) {
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
        disabled={busy || locked}
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
          disabled={busy || locked}
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
      {!locked && <div className="flex flex-wrap items-center gap-2">
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
      </div>}
      <LeaveDialog guard={guard} body={t("h.n.leaveBody")} />
    </form>
  );
}
