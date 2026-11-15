"use client";

import type { JoinSessionResponse } from "@remote/contracts/api/sessions";
import { useEffect, useState } from "react";
import { linkTokenFromPath, resumeKey } from "@/lib/guest-resume";
import { GuestSession } from "./guest-session";
import { GuestWelcome } from "./guest-welcome";
import type { ResolveData } from "./join-form";

/** Bu sekmenin F5 dönüş anahtarı (`rs.resume.<özet>`, TEST-P4-1); hesaplanana / desteklenmezse null. */
function useResumeKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const tk = linkTokenFromPath();
    let live = true;
    if (tk) void resumeKey(tk).then((k) => live && setKey(k));
    return () => {
      live = false;
    };
  }, []);
  return key;
}

/** Karşılama → (join) → lobi/oturum. wsTicket yalnız bu bileşenin belleğinde. */
export function GuestFlow({ data, abuseEmail }: { data: ResolveData; abuseEmail: string | null }) {
  const [joined, setJoined] = useState<(JoinSessionResponse & { customerName: string }) | null>(null);
  const storeKey = useResumeKey();
  if (!joined) return <GuestWelcome data={data} abuseEmail={abuseEmail} onJoined={setJoined} />;
  return (
    <GuestSession
      info={joined}
      verifyCode={data.techVerifyCode}
      sessionRef={data.sessionRef}
      cred={{ ticket: joined.wsTicket }}
      storeKey={storeKey}
    />
  );
}
