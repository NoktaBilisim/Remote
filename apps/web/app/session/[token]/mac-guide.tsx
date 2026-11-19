import { CircleHelp, FileCheck2, MousePointerClick, ScreenShare, Trash2, type LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import type { MacVariant } from "@/lib/agent-download";
import { t, type MessageKey } from "@/lib/i18n";
import { GuideStep } from "./guide-step";

const PERMS: readonly { Icon: LucideIcon; title: MessageKey; body: MessageKey; testId: string }[] = [
  { Icon: ScreenShare, title: "gm.permScreen", body: "gm.permScreenBody", testId: "mac-perm-screen" },
  { Icon: MousePointerClick, title: "gm.permAx", body: "gm.permAxBody", testId: "mac-perm-ax" },
];

const INTRO: Record<MacVariant, MessageKey> = { test: "gm.guideIntroTest", adhoc: "gm.guideIntroAdhoc", notarized: "gm.guideIntro" };
const VERIFY: Record<MacVariant, MessageKey> = { test: "gm.verifyBodyTest", adhoc: "gm.verifyBodyAdhoc", notarized: "gm.verifyBody" };

/**
 * P28f (AC-391, AC-396) + P28f-r4 (AC-503, K-P28f-r4-6): macOS açılış + izin rehberi — Windows SmartScreen rehberiyle aynı düzen
 * (numaralı adım, ekran görüntüsüz). `notarized`: bugünkü metin + "asla 'Yine de Aç' istemez" uyarısı. `test` ve `adhoc`: ortak
 * 2. adım (Gizlilik ve Güvenlik → Yine de Aç; zararlı uyarısında Çöp Sepeti — S-r4-2). TEST uyarısı (`test`) ve yalnız-bu-sayfa
 * uyarısı (`adhoc`, S-r4-1) indirme düğmesinin yanında (`AgentDownload`), rehberden önce.
 */
export function MacGuide({
  id,
  highlight,
  variant,
  verifyCode,
  host,
}: {
  id: string;
  highlight: boolean;
  variant: MacVariant;
  verifyCode: string;
  host: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-t`}
      id={id}
      data-testid="mac-guide"
      data-build={variant}
      className={`rounded-lg border bg-surface p-4 text-sm shadow-sm ${highlight ? "border-primary" : "border-border"}`}
    >
      <h3 id={`${id}-t`} className="inline-flex items-center gap-2 font-semibold text-fg">
        <CircleHelp aria-hidden className="size-4 shrink-0 text-primary" />
        {t("gm.guideTitle")}
      </h3>
      <p className="mt-1 text-fg-muted">{t(INTRO[variant])}</p>
      <ol className="mt-3 flex list-none flex-col gap-3">
        <GuideStep n={1} title={t("gm.step1")} body={t("gm.step1Body")} />
        {variant !== "notarized" ? (
          <GuideStep n={2} title={t("gm.step2Unsigned")} body={t("gm.step2UnsignedBody")}>
            <p className="mt-2 flex gap-2 rounded-md border border-danger/30 bg-danger-surface p-3 text-fg" data-testid="mac-harmful">
              <Trash2 aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <span>{t("gm.step2Harmful")}</span>
            </p>
          </GuideStep>
        ) : (
          <GuideStep n={2} title={t("gm.step2")} body={t("gm.step2Body")} />
        )}
        <GuideStep n={3} title={t("gm.step3")} body={t("gm.step3Body")}>
          <ul className="mt-2 flex flex-col gap-2" data-testid="mac-perms">
            {PERMS.map(({ Icon, title, body, testId }) => (
              <li key={testId} data-testid={testId} className="flex gap-2 rounded-md border border-border bg-canvas p-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="font-medium text-fg">{t(title)}</p>
                  <p className="text-fg-muted">{t(body)}</p>
                </div>
              </li>
            ))}
          </ul>
        </GuideStep>
        <GuideStep n={4} title={t("gm.step4")} body={t("gm.step4Body", { code: verifyCode, host: host || "—" })} />
      </ol>
      {variant === "notarized" && (
        <div className="mt-3">
          <Alert tone="warning" testId="mac-never-open-anyway">
            <p className="font-semibold">{t("gm.neverTitle")}</p>
            <p className="text-fg">{t("gm.neverBody")}</p>
          </Alert>
        </div>
      )}
      <details className="mt-3 rounded-md border border-border bg-canvas px-3 py-2" data-testid="agent-verify">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
          <FileCheck2 aria-hidden className="mr-1.5 inline size-4 align-[-0.1875em]" />
          {t("ga.verifyTitle")}
        </summary>
        <p className="pb-2 text-fg-muted">{t(VERIFY[variant])}</p>
      </details>
    </section>
  );
}
