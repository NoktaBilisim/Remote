"use client";

import { Hand, Keyboard, Monitor, MousePointerBan, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { closeMenu, Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { formatRemaining, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { SPECIAL_COMBOS, type SpecialComboId } from "@/lib/control/input";
import {
  canRequestMonitor,
  cooldownLeft,
  MAX_CONTROL_REQUESTS,
  monitorBlockLeft,
  requestsLeft,
  type ControlState,
  type Monitor as Mon,
} from "@/lib/control/machine";

/**
 * "Kontrol iste" durum makinesi görünümü (DESIGN §6 `console/control-button.tsx`; AC-47, 50, 99, 116).
 * Durumlar metinle anlatılır (renge dayanmaz, DESIGN §8): istek yok → "Kontrol bekleniyor" (spinner + Vazgeç) →
 * kontrol sizde → bıraktınız ("Kontrole devam" = yeni istek) / müşteri kapattı / reddetti (30 sn geri sayım,
 * kalan istek) / hak doldu / yetki yok. Bırak ve Vazgeç müşteri kapısını da kapatır (§3.3 K1–K2).
 * Durum metni tek `role=status` öğesindedir; düğme ona `aria-describedby` ile bağlanır.
 */
export function ControlButton({
  s,
  now,
  available,
  onRequest,
  onRelease,
  onCancel,
  onKeys,
  releaseRef,
}: {
  s: ControlState;
  now: number | null;
  /** Görüntü geliyor ve müşteri bağlı (istek anlamlı). */
  available: boolean;
  onRequest: () => void;
  onRelease: () => void;
  onCancel: () => void;
  onKeys: (id: SpecialComboId) => void;
  releaseRef: RefObject<HTMLButtonElement | null>;
}) {
  const noteId = useId();
  const mainRef = useRef<HTMLButtonElement>(null);
  // Bırak/Vazgeç düğmesi kaybolunca odak sayfaya düşmesin: yeni istek düğmesine geçer (klavye kullanımı)
  const selfEnded = s.phase === "ended" && (s.endedBy === "tech" || s.endedBy === "cancel");
  useEffect(() => {
    const a = document.activeElement;
    if (selfEnded && (a === null || a === document.body)) mainRef.current?.focus();
  }, [selfEnded, s.endedAt]);
  const cd = now === null ? 0 : cooldownLeft(s, now);
  const left = requestsLeft(s);
  const at = (ms: number | null) => (ms === null ? "" : ` · ${formatTime(ms)}`);

  let body: ReactNode = null;
  const note: string[] = [];
  if (s.forbidden) {
    note.push(t("p7.forbidden"));
  } else if (s.phase === "granted") {
    body = (
      <>
        <span
          data-testid="control-on"
          className="inline-flex items-center gap-1.5 rounded-full bg-control-frame px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-on-control"
        >
          {/* İkonsuz: şerit 1280 px'te tek satır kalsın (TEST-P7-2); durum metin + kırmızı çerçeveyle verilir */}
          {t("p7.on")}
        </span>
        <Button ref={releaseRef} variant="secondary" onClick={onRelease} aria-describedby={noteId} data-testid="control-release">
          <MousePointerBan aria-hidden className="size-4" />
          {t("p7.release")}
        </Button>
        <SpecialKeys onKeys={onKeys} />
      </>
    );
    note.push(t("p7.kbHint"));
  } else if (s.phase === "requested") {
    // AC-47 metni birebir "Kontrol bekleniyor"; açıklama alt satırda (QA-P7-6)
    body = (
      <>
        <Button variant="secondary" loading aria-describedby={noteId} data-testid="control-request">
          {t("p7.waiting")}
        </Button>
        <Button variant="secondary" onClick={onCancel} aria-describedby={noteId} data-testid="control-cancel">
          <X aria-hidden className="size-4" />
          {t("p7.cancel")}
        </Button>
      </>
    );
    note.push(s.notice ?? t("p7.waitingNote"));
  } else {
    const denied = s.phase === "denied";
    const released = s.phase === "ended" && s.endedBy === "tech";
    const disabled = !available || cd > 0 || left === 0;
    body = (
      <Button
        ref={mainRef}
        variant={disabled ? "secondary" : "primary"}
        disabled={disabled}
        onClick={onRequest}
        aria-describedby={noteId}
        data-testid="control-request"
      >
        <Hand aria-hidden className="size-4" />
        {denied ? (cd > 0 ? t("p7.retryIn", { time: formatRemaining(cd) }) : t("p7.retry")) : released ? t("p7.resume") : t("p7.request")}
      </Button>
    );
    if (denied) note.push(t("p7.denied") + at(s.deniedAt));
    // Kopma/yenileme `idle`'a döndürür; neden yine yazılır (gözlem: kontrol açıkken müşteri koptu)
    else if (s.endedBy && (s.phase === "ended" || s.endedBy === "peer")) note.push(t(`p7.end.${s.endedBy}`) + at(s.endedAt));
    else note.push(t("p7.viewOnly"));
    if (left === 0) note.push(t("p7.exhausted", { max: MAX_CONTROL_REQUESTS }));
    else if (s.requests > 0) note.push(t("p7.left", { n: left }));
    if (!available && left > 0) note.push(t("p7.noVideo"));
  }
  if (s.error === "rate" && s.phase !== "granted") note.push(t("p7.rate"));

  return (
    // `contents`: öğeler sahne şeridinde doğrudan akar (dar ekranda "Görünüm" menüsüyle aynı satıra sarabilir)
    <div className="contents" data-testid="control-bar" data-phase={s.forbidden ? "forbidden" : s.phase}>
      {body}
      <p
        id={noteId}
        role="status"
        data-testid="control-note"
        className={`${s.phase === "granted" && !s.forbidden ? "sr-only" : "line-clamp-2 max-w-64 min-w-0 text-xs"} ${s.error || s.notice || s.forbidden ? "text-warning" : "text-fg-muted"}`}
      >
        {note.join(" · ")}
      </p>
    </div>
  );
}

/**
 * Tarayıcının yakaladığı tuş kombinasyonları (Alt+Tab, Win …) için açılır liste (`ui/menu`). Klavyeyi bırakma
 * ipucu (Ctrl+Alt+Shift) da burada görünür — şerit tek satır kalsın diye not satırında yalnız ekran okuyucuya
 * verilir (TEST-P7-2).
 */
function SpecialKeys({ onKeys }: { onKeys: (id: SpecialComboId) => void }) {
  return (
    <Menu label={t("p7.keys")} icon={<Keyboard aria-hidden className="size-4" />} testId="special-keys">
      <>
        <ul aria-label={t("p7.keys")}>
          {SPECIAL_COMBOS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid={`key-${c.id}`}
                onClick={(e) => {
                  onKeys(c.id);
                  closeMenu(e.currentTarget);
                }}
                className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted"
              >
                {t(`p7.combo.${c.id}`)}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">{t("p7.kbHint")}</p>
      </>
    </Menu>
  );
}

export const monitorName = (m: Mon, i: number): string => m.name.trim() || t("p7.monitorName", { n: i + 1 });

/** Çoklu monitörde görüntülenen ekranı değiştirme isteği (AC-43; yalnız Hızlı Destek, müşteri onayı gerekir). */
export function MonitorPicker({ s, now, onRequest }: { s: ControlState; now: number | null; onRequest: (id: number) => void }) {
  if (s.monitors.length < 2) return null;
  const pending = s.monitorPending ? s.monitors.findIndex((m) => m.id === s.monitorPending?.id) : -1;
  // K7: bekleyen istek veya sunucu beklemesi (30 sn + 1 sn pay) sürerken seçim pasif; kalan süre yazılır
  const at = now ?? 0;
  const blockLeft = monitorBlockLeft(s, at);
  const disabled = now !== null && !canRequestMonitor(s, at);
  const outcome =
    pending >= 0
      ? t("p7.monitorWait", { name: monitorName(s.monitors[pending]!, pending) })
      : s.monitorOutcome === "denied"
        ? t("p7.monitorDenied")
        : s.monitorOutcome === "noAnswer"
          ? t("p7.monitorNoAnswer")
          : s.monitorOutcome === "rate"
            ? t("p7.monitorRate")
            : s.monitorOutcome === "already"
              ? t("p7.monitorAlready")
              : t("p7.monitorHint");
  const note = pending < 0 && blockLeft > 0 ? `${outcome} · ${t("p7.monitorRetryIn", { time: formatRemaining(blockLeft) })}` : outcome;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="monitor-picker">
      <Segmented<string>
        label={t("p7.monitor")}
        value={s.activeMonitor === null ? "" : String(s.activeMonitor)}
        onChange={(v) => onRequest(Number(v))}
        disabled={disabled}
        options={s.monitors.map((m, i) => ({
          value: String(m.id),
          label: monitorName(m, i),
          icon: <Monitor aria-hidden className="size-4" />,
        }))}
      />
      {/* Sabit ipucu yalnız ekran okuyucuya (şerit dar ekranda satır kırmasın); bekleme/sonuç görünür yazılır */}
      <p
        role="status"
        data-testid="monitor-note"
        className={
          pending >= 0 || (s.monitorOutcome !== null && s.monitorOutcome !== "switched") ? "max-w-44 text-xs text-fg-muted" : "sr-only"
        }
      >
        {note}
      </p>
    </div>
  );
}
