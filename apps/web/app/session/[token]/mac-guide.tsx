import { CircleHelp, FileCheck2, MousePointerClick, ScreenShare, type LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { t, type MessageKey } from "@/lib/i18n";
import { GuideStep } from "./guide-step";

const PERMS: readonly { Icon: LucideIcon; title: MessageKey; body: MessageKey; testId: string }[] = [
  { Icon: ScreenShare, title: "gm.permScreen", body: "gm.permScreenBody", testId: "mac-perm-screen" },
  { Icon: MousePointerClick, title: "gm.permAx", body: "gm.permAxBody", testId: "mac-perm-ax" },
];

/**
 * P28f (AC-391, AC-396, S-P28f-8): macOS açılış + izin rehberi — Windows SmartScreen rehberiyle aynı düzen (numaralı adım,
 * ekran görüntüsüz). İmzalı (prod) sürümde "Nokta Destek asla 'Yine de Aç' istemez" uyarısı; "Gizlilik ve Güvenlik → Yine de
 * Aç" adımı yalnız `testBuild` (staging, imzasız TEST sürümü) iken görünür ve o zaman TEST uyarısı düğmenin yanındadır.
 */
export function MacGuide({
  id,
  highlight,
  testBuild,
  verifyCode,
  host,
}: {
  id: string;
  highlight: boolean;
  testBuild: boolean;
  verifyCode: string;
  host: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-t`}
      id={id}
      data-testid="mac-guide"
      data-build={testBuild ? "test" : "signed"}
      className={`rounded-lg border bg-surface p-4 text-sm shadow-sm ${highlight ? "border-primary" : "border-border"}`}
    >
      <h3 id={`${id}-t`} className="inline-flex items-center gap-2 font-semibold text-fg">
        <CircleHelp aria-hidden className="size-4 shrink-0 text-primary" />
        {t("gm.guideTitle")}
      </h3>
      <p className="mt-1 text-fg-muted">{t(testBuild ? "gm.guideIntroTest" : "gm.guideIntro")}</p>
      <ol className="mt-3 flex list-none flex-col gap-3">
        <GuideStep n={1} title={t("gm.step1")} body={t("gm.step1Body")} />
        {testBuild ? (
          <GuideStep n={2} title={t("gm.step2Test")} body={t("gm.step2TestBody")} />
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
      {!testBuild && (
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
        <p className="pb-2 text-fg-muted">{t(testBuild ? "gm.verifyBodyTest" : "gm.verifyBody")}</p>
      </details>
    </section>
  );
}
