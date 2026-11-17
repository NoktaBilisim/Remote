"use client";

import { useEffect, useRef } from "react";
import { monitorName } from "@/components/console/control-button";
import type { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import type { ControlState } from "@/lib/control/machine";

const MONITOR_OUTCOME_KEY = {
  denied: "p7.monitorDenied",
  noAnswer: "p7.monitorNoAnswer",
  rate: "p7.monitorRate",
  already: "p7.monitorAlready",
} as const;

/** Kontrol durum geçiş bildirimleri (AC-50 ≤ 1 sn, AC-99 "Kontrol reddedildi") ve monitör sonucu (TEST-P7-2). */
export function useControlToasts(control: ControlState, toast: ReturnType<typeof useToast>) {
  const prev = useRef(control);
  useEffect(() => {
    const p = prev.current;
    prev.current = control;
    phaseToast(p, control, toast);
    if (!p.forbidden && control.forbidden) toast(t("p7.forbidden"), "danger");
    monitorToast(p, control, toast);
  }, [control, toast]);
}

function phaseToast(p: ControlState, c: ControlState, toast: ReturnType<typeof useToast>) {
  if (p.phase !== "granted" && c.phase === "granted") toast(t("p7.toast.granted"), "success");
  else if (p.phase !== "denied" && c.phase === "denied") toast(t("p7.toast.denied"), "danger");
  // Teknisyenin kendi bırakması/iptali bildirim üretmez (not satırında yazar)
  else if (p.phase === "granted" && c.phase !== "granted" && c.endedBy && c.endedBy !== "tech") toast(t(`p7.end.${c.endedBy}`), "danger");
  // P28f AC-391 / P28g AC-399: macOS Erişilebilirlik izni ya da Wayland kontrol izni yok — not satırı dar şeritte kısalabilir, tam metin bildirimde
  else if (p.phase === "requested" && c.phase === "ended" && (c.endedBy === "osPermission" || c.endedBy === "waylandNoControl"))
    toast(t(`p7.end.${c.endedBy}`), "info");
}

function monitorToast(p: ControlState, c: ControlState, toast: ReturnType<typeof useToast>) {
  // Dar sahnede monitör seçimi menüde: sonuç menü kapalıyken de duyurulsun (TEST-P7-2)
  if (p.monitorOutcome !== c.monitorOutcome && c.monitorOutcome && c.monitorOutcome !== "switched")
    toast(t(MONITOR_OUTCOME_KEY[c.monitorOutcome]), "danger");
  if (p.monitorOutcome !== "switched" && c.monitorOutcome === "switched") {
    const i = c.monitors.findIndex((m) => m.id === c.activeMonitor);
    if (i >= 0) toast(t("p7.monitorSwitched", { name: monitorName(c.monitors[i]!, i) }), "success");
  }
}
