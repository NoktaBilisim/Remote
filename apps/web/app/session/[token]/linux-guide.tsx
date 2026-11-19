import { CircleHelp, FileCheck2, FolderOpen, SquareTerminal } from "lucide-react";
import { CopyLink } from "@/components/copy-link";
import { Alert } from "@/components/ui/alert";
import { t } from "@/lib/i18n";
import { LINUX_RUN_COMMAND } from "@/lib/linux-command";
import { GuideStep } from "./guide-step";

/**
 * P28g (AC-397, AC-403, S-P28g-6): Linux (Ubuntu GNOME, x86_64) açılış rehberi — Windows/macOS rehberiyle aynı düzen (numaralı
 * adım, ekran görüntüsüz). 2. adımda çalıştırma izni için iki yol: Dosyalar → Özellikler → "Program olarak çalıştır" (kılavuzun
 * birincil yolu) ve kopyalanabilir tek satır komut. Komut sabit metindir (`LINUX_RUN_COMMAND`); görünen metin = kopyalanan
 * bayt dizisi. "Nokta Destek size bundan başka komut vermez" uyarısı kopyala düğmesinin hemen yanında, her zaman görünür.
 */
export function LinuxGuide({ id, highlight, verifyCode, host }: { id: string; highlight: boolean; verifyCode: string; host: string }) {
  return (
    <section
      aria-labelledby={`${id}-t`}
      id={id}
      data-testid="linux-guide"
      className={`rounded-lg border bg-surface p-4 text-sm shadow-sm ${highlight ? "border-primary" : "border-border"}`}
    >
      <h3 id={`${id}-t`} className="inline-flex items-center gap-2 font-semibold text-fg">
        <CircleHelp aria-hidden className="size-4 shrink-0 text-primary" />
        {t("gl.guideTitle")}
      </h3>
      <p className="mt-1 text-fg-muted">{t("gl.guideIntro")}</p>
      <ol className="mt-3 flex list-none flex-col gap-3">
        <GuideStep n={1} title={t("gl.step1")} body={t("gl.step1Body")} />
        <GuideStep n={2} title={t("gl.step2")} body={t("gl.step2Body")}>
          <ul className="mt-2 flex flex-col gap-2">
            <li data-testid="linux-path-files" className="flex gap-2 rounded-md border border-border bg-canvas p-3">
              <FolderOpen aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-medium text-fg">{t("gl.pathFiles")}</p>
                <p className="text-fg-muted">{t("gl.pathFilesBody")}</p>
              </div>
            </li>
            <li data-testid="linux-path-terminal" className="flex gap-2 rounded-md border border-border bg-canvas p-3">
              <SquareTerminal aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <p className="font-medium text-fg">{t("gl.pathTerminal")}</p>
                  <p className="text-fg-muted">{t("gl.pathTerminalBody")}</p>
                </div>
                <figure className="min-w-0">
                  <figcaption className="sr-only">{t("gl.cmdLabel")}</figcaption>
                  {/* CSS ile sarılır (pre-wrap + break-all): araya karakter eklenmez, kopyalanan metin = görünen metin */}
                  <pre className="rounded-md border border-border bg-surface-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-fg">
                    <code data-testid="linux-command">{LINUX_RUN_COMMAND}</code>
                  </pre>
                </figure>
                <CopyLink url={LINUX_RUN_COMMAND} srLabel={t("gl.copyCmd")} manualLabel={t("gl.copyManual")} testId="linux-copy" />
                <Alert tone="warning" testId="linux-never-command">
                  <p className="font-semibold text-fg">{t("gl.never")}</p>
                </Alert>
              </div>
            </li>
          </ul>
        </GuideStep>
        <GuideStep n={3} title={t("gl.step3")} body={t("gl.step3Body")} />
        <GuideStep n={4} title={t("gl.step4")} body={t("gl.step4Body", { code: verifyCode, host: host || "—" })} />
      </ol>
      <details className="mt-3 rounded-md border border-border bg-canvas px-3 py-2" data-testid="agent-verify">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
          <FileCheck2 aria-hidden className="mr-1.5 inline size-4 align-[-0.1875em]" />
          {t("ga.verifyTitle")}
        </summary>
        <p className="pb-2 text-fg-muted">{t("gl.verifyBody")}</p>
      </details>
    </section>
  );
}
