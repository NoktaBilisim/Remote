"use client";

import { Ear, Mic, MicOff, Phone, PhoneOff, UserX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { GuestVoiceView } from "@/lib/voice/guest";
import { freshListeners, type GuestBarModel } from "@/lib/voice/ui";

const pillCls = "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap";

/**
 * P28d müşteri görüşme çubuğu (mimari-p28d r2 §8; AC-374, Y-PD-3). Mikrofon gösterge GERÇEK mikrofona bağlı: kabul ile
 * `voice.state{active}` arasında da görünür ("Mikrofon açılıyor…" → "Mikrofon açık"). "Dinleyen" = listeners − talkers.
 */
export function VoiceBar({ model, onMute, onEnd }: { model: GuestBarModel; onMute: (on: boolean) => void; onEnd: () => void }) {
  if (!model.show) return null;
  const on = model.mic === "on";
  return (
    <section
      aria-labelledby="vg-t"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center"
      data-testid="voice-bar"
      data-mic={model.mic}
      data-muted={model.muted}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="vg-t" className="flex items-center gap-2 text-base font-semibold text-fg">
            <Phone aria-hidden className="size-5 text-fg-muted" />
            {t("vg.barTitle")}
          </h2>
          <span
            role="status"
            aria-live="polite"
            className={`${pillCls} ${on && !model.muted ? "bg-success-surface text-success" : "bg-surface-muted text-fg-muted"}`}
            data-testid="voice-bar-mic"
          >
            {on && model.muted ? <MicOff aria-hidden className="size-3.5" /> : <Mic aria-hidden className="size-3.5" />}
            {t(!on ? "vg.micOpening" : model.muted ? "vg.micMuted" : "vg.micOn")}
          </span>
        </div>
        {model.talkers.length > 0 && (
          <p className="text-sm text-fg" data-testid="voice-bar-talkers">
            {t("vg.talkers", { names: model.talkers.join(", ") })}
          </p>
        )}
        {model.listenersOnly.length > 0 && (
          <p className="text-sm text-fg" data-testid="voice-bar-listeners">
            {t("vg.listeners", { names: model.listenersOnly.join(", ") })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => onMute(!model.muted)} disabled={!on} data-testid="voice-bar-mute">
          {model.muted ? <Mic aria-hidden className="size-4" /> : <MicOff aria-hidden className="size-4" />}
          {t(model.muted ? "vg.unmute" : "vg.mute")}
        </Button>
        <Button variant="danger-ghost" onClick={onEnd} data-testid="voice-bar-end">
          <PhoneOff aria-hidden className="size-4" />
          {t("vg.end")}
        </Button>
      </div>
    </section>
  );
}

/**
 * Yeni dinleyici duyurusu (Y-PD-3): görüşme yokken görülen `announce.seq` işaretlenir; etkin görüşmede bundan büyük seq →
 * hâlâ dinleyen tid'ler. Önceki görüşmenin duyurusu yeni görüşmede yeniden okunmaz (render sırasında türetilen durum).
 */
export function useVoiceAnnounce(v: GuestVoiceView): { seq: number; tids: string[] } {
  const cur = v.announce?.seq ?? 0;
  const [seen, setSeen] = useState(cur);
  if (!v.active && seen !== cur) setSeen(cur);
  const tids = v.active ? freshListeners(v, seen) : [];
  return { seq: cur, tids };
}

/**
 * `aria-live=assertive` bölge HER ZAMAN monte (`sr-only`; içerik değişimi okunur), görünür şerit yalnız duyuru varken:
 * "<Ad> görüşmeyi dinlemeye başladı" + mevcut "Çıkar" onayına doğrudan erişim (oturum sahibi çıkarılamaz → düğme yok).
 */
export function VoiceAnnounce({
  seq,
  items,
  onRemove,
}: {
  seq: number;
  items: { tid: string; name: string; owner: boolean }[];
  onRemove: (tid: string) => void;
}) {
  const text = items.map((e) => t("vg.newListener", { name: e.name })).join(" · ");
  return (
    <>
      <p className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="voice-announce">
        {text && <span key={seq}>{text}</span>}
      </p>
      {items.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-surface p-3 sm:flex-row sm:items-center"
          data-testid="voice-announce-strip"
        >
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm font-medium text-fg">
            <Ear aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {text}
          </p>
          {items
            .filter((e) => !e.owner)
            .map((e) => (
              <Button
                key={e.tid}
                variant="danger-ghost"
                onClick={() => onRemove(e.tid)}
                aria-label={t("mt.g.removeRow", { name: e.name })}
                data-testid="voice-announce-remove"
              >
                <UserX aria-hidden className="size-4" />
                {t("mt.g.remove")}
              </Button>
            ))}
        </div>
      )}
    </>
  );
}
