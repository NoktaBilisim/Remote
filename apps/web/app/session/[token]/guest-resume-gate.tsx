"use client";

import { useEffect, useState } from "react";
import { forgetResume, linkTokenFromPath, readResume, resumeKey, type GuestResume } from "@/lib/guest-resume";
import { GuestEndScreen, type GuestEnd } from "../guest-ui";
import { RetryButton } from "../retry-button";
import { GuestSession } from "./guest-session";

interface Check {
  done: boolean;
  key: string | null;
  resume: GuestResume | null;
}

/**
 * TEST-P4-1: resolve 410/4xx döndüğünde (link tek kullanımlık, F5'te CONSUMED) bu sekmede kabul edilmiş bir oturumun
 * dönüş kaydı varsa doğrudan `rs.reconnect.*` ile oturuma dönülür (lobi yok). Kayıt yoksa veya dönüş reddedilirse
 * sunucunun ekranı gösterilir. "Kullanıldı" dışındaki sonlarda (iptal/süre/hata) kayıt silinir.
 */
export function GuestResumeGate({ kind }: { kind: GuestEnd }) {
  const [check, setCheck] = useState<Check>({ done: kind !== "consumed", key: null, resume: null });

  useEffect(() => {
    let live = true;
    const tk = linkTokenFromPath();
    // Web Crypto/depo yoksa uzun bekleme yerine sunucunun ekranı
    const fallback = setTimeout(() => live && setCheck((c) => (c.done ? c : { ...c, done: true })), 1500);
    void (tk ? resumeKey(tk) : Promise.resolve(null)).then((key) => {
      if (!live) return;
      if (key && kind !== "consumed") forgetResume(key);
      setCheck({ done: true, key, resume: key && kind === "consumed" ? readResume(key) : null });
    });
    return () => {
      live = false;
      clearTimeout(fallback);
    };
  }, [kind]);

  if (!check.done) {
    return <div aria-busy="true" data-testid="guest-resume-check" className="h-48 animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />;
  }
  const { key, resume } = check;
  if (resume && key) {
    return (
      <GuestSession
        info={{ technicianName: resume.technicianName, customerName: resume.customerName, admitCode: null }}
        verifyCode={resume.verifyCode}
        sessionRef={resume.sessionRef}
        cred={{ reconnect: resume.reconnectToken }}
        storeKey={key}
      />
    );
  }
  return <GuestEndScreen kind={kind} action={kind === "error" ? <RetryButton /> : undefined} />;
}
