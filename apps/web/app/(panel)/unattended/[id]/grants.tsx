"use client";

import { ShieldQuestion, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SaveBar } from "@/components/ui/save-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleSwitch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DeviceGrant, DeviceGrantsResponse } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";
import type { UserOptionsResponse } from "@/lib/users/contract";

type Person = { id: string; name: string; avatarUrl: string | null };
type Options = { kind: "loading" } | { kind: "error" } | { kind: "ok"; items: Person[] };

/** Yetki verilebilir kullanıcılar (etkin, `unattended.connect`; `manage` ile açık) ∪ mevcut grant'lar; liste alınamazsa yalnız mevcut grant'lar (kısmi durum). */
function usePeople(grants: DeviceGrant[]) {
  const [opts, setOpts] = useState<Options>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    api<UserOptionsResponse>("GET", "/users/options?unattendedGrantable=1").then(
      (r) =>
        live &&
        setOpts({
          kind: "ok",
          items: r.items.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, name: u.fullName, avatarUrl: null })),
        }),
      () => live && setOpts({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, []);
  const people = useMemo(() => {
    const byId = new Map<string, Person>(grants.map((g) => [g.userId, { id: g.userId, name: g.name, avatarUrl: g.avatarUrl }]));
    if (opts.kind === "ok") for (const p of opts.items) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [grants, opts]);
  return { opts, people };
}

function useGrantForm(deviceId: string, grants: DeviceGrant[]) {
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => grants.map((g) => g.userId).sort(), [grants]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const dirty = [...selected].sort().join() !== initial.join();
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api<DeviceGrantsResponse>("PUT", `/unattended/devices/${deviceId}/grants`, { userIds: [...selected] });
      toast(t("un.grants.saved"));
      router.refresh();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const field = err instanceof ApiError ? err.fields?.userIds : undefined;
      setError(field ? { message: field, tone: "danger" } : unattendedUiError(err));
    } finally {
      setBusy(false);
    }
  };
  return {
    selected,
    toggle,
    clear: () => setSelected(new Set()),
    reset: () => (setSelected(new Set(initial)), setError(null)),
    dirty,
    busy,
    error,
    submit,
  };
}

/** Kayıt doğrulama satırı (O-P27-5, AC-337): kayıt zamanı ve IP'si; doğrulanmamışsa uyarı tonu. */
function Registration({ at, ip, verified }: { at: string | null; ip: string | null; verified: boolean }) {
  const text = t("un.grants.registered", { at: at ? formatDateTime(at) : "—", ip: ip ?? "—" });
  return verified ? (
    <p className="text-sm text-fg-muted" data-testid="un-registered">
      {text}
    </p>
  ) : (
    <Alert tone="warning" testId="un-registered">
      <p className="flex items-start gap-2">
        <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
    </Alert>
  );
}

function GrantList(p: {
  loading: boolean;
  people: Person[];
  deviceName: string;
  selected: ReadonlySet<string>;
  busy: boolean;
  onToggle: (id: string) => void;
}) {
  if (p.loading && p.people.length === 0)
    return (
      <div aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mb-2 h-12 w-full" />
        ))}
      </div>
    );
  if (p.people.length === 0)
    return <EmptyState Icon={Users} title={t("un.grants.empty")} body={t("un.grants.emptyBody")} testId="un-grants-empty" />;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      {p.people.map((u) => (
        <li key={u.id} className="flex items-center gap-3 px-3 py-1" data-testid="un-grant-row">
          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{u.name}</span>
          <ToggleSwitch
            label={t("un.grants.toggle", { name: u.name, device: p.deviceName })}
            checked={p.selected.has(u.id)}
            onChange={() => p.onToggle(u.id)}
            disabled={p.busy}
            testId="un-grant-toggle"
          />
        </li>
      ))}
    </ul>
  );
}

function GrantActions({ f, formId }: { f: ReturnType<typeof useGrantForm>; formId: string }) {
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={f.clear}
        disabled={f.busy || f.selected.size === 0}
        className="self-start"
        data-testid="un-grants-clear"
      >
        {t("un.grants.clear")}
      </Button>
      <SaveBar
        dirty={f.dirty}
        busy={f.busy}
        formId={formId}
        onReset={f.reset}
        message={t("un.grants.dirty")}
        leaveBody={t("un.grants.leave")}
        testId="un-grants-bar"
      />
    </>
  );
}

type GrantsProps = {
  deviceId: string;
  deviceName: string;
  grants: DeviceGrant[];
  registeredAt: string | null;
  registeredIp: string | null;
  verified: boolean;
};

/**
 * Teknisyen yetkileri (AC-293, `manage`): kişi başına anahtar, "Tümünü kapat", Kaydet = PUT tam küme. Ekleme varsa sunucu
 * step-up ister (`lib/api` diyaloğu, bir kez yinelenir). Kaydedilmemiş değişiklikte ayrılma uyarısı (SaveBar).
 */
export function GrantsEditor(p: GrantsProps) {
  const { opts, people } = usePeople(p.grants);
  const f = useGrantForm(p.deviceId, p.grants);
  const formId = "un-grants-form";
  return (
    <form id={formId} noValidate onSubmit={(e) => void f.submit(e)} className="flex flex-col gap-3" data-testid="un-grants">
      <Registration at={p.registeredAt} ip={p.registeredIp} verified={p.verified} />
      {opts.kind === "error" && (
        <Alert tone="info" testId="un-grants-partial">
          {t("un.grants.partial")}
        </Alert>
      )}
      <FormError error={f.error} />
      <GrantList
        loading={opts.kind === "loading"}
        people={people}
        deviceName={p.deviceName}
        selected={f.selected}
        busy={f.busy}
        onToggle={f.toggle}
      />
      <GrantActions f={f} formId={formId} />
    </form>
  );
}
