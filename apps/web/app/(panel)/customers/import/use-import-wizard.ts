"use client";

import { useRouter } from "next/navigation";
import { useState, type RefObject } from "react";
import type { CustomerImportConflictMode, ImportPreview, ImportResult } from "@remote/contracts/api/customers";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { checkImportFile, errorReportCsv, importFailure } from "@/lib/customers/import";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/use-leave-guard";

export type Step = "file" | "preview" | "done";

/** Hata raporunu CSV olarak indirir (geçici nesne URL'si 10 sn sonra bırakılır). */
export function downloadErrorReport(errors: ImportPreview["errors"]) {
  const url = URL.createObjectURL(new Blob([errorReportCsv(errors)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "ice-aktarma-hatalari.csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Dosya adımı: seçilen dosya + istemci denetimi (tür / boyut) ve sunucu hatası. */
function useImportFile() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const pick = (f: File | null | undefined) => {
    setFile(f ?? null);
    setFileError(f ? checkImportFile(f) : null);
  };
  return { file, setFile, fileError, setFileError, pick };
}

type Setter<T> = (v: T) => void;
interface CommitDeps {
  preview: ImportPreview | null;
  mode: CustomerImportConflictMode;
  setBusy: Setter<boolean>;
  setStep: Setter<Step>;
  setPreview: Setter<ImportPreview | null>;
  setFileError: Setter<string | null>;
  unauth: (e: unknown) => boolean;
}

/** Onay adımı: içe aktarır; önizleme süresi dolmuşsa dosya adımına döner (neden dosya hatası olarak). */
function useImportCommit({ preview, mode, setBusy, setStep, setPreview, setFileError, unauth }: CommitDeps) {
  const router = useRouter();
  const toast = useToast();
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const failed = (e: unknown) => {
    if (unauth(e)) return;
    const f = importFailure(e, t("err.generic"));
    if (f.kind === "previewExpired") {
      setPreview(null);
      setStep("file");
      setFileError(f.message);
    } else setCommitError(f.message);
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setCommitError(null);
    try {
      const r = await api<ImportResult>("POST", "/customers/import/commit", { previewId: preview.previewId, onConflict: mode });
      setResult(r);
      setStep("done");
      toast(t("cu.imp.doneToast", { n: formatNumber(r.created + r.updated) }));
      router.refresh();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };
  return { commitError, setCommitError, result, setResult, commit };
}

/** Oturum düştüyse girişe yönlendirir ve `true` döner. */
function useUnauth() {
  const router = useRouter();
  return (e: unknown) => {
    if (!isUnauthenticated(e)) return false;
    router.replace(EXPIRED_LOGIN_PATH);
    return true;
  };
}

/**
 * İçe aktarma sihirbazı durumu (AC-263): dosya → önizleme → sonuç. Önizlemedeyken (gönderim yokken) ayrılma uyarısı.
 * `inputRef` bileşende tutulur (React Compiler: ref kanca sonucunda dönmez); "Başka dosya" seçimi temizler.
 */
export function useImportWizard(inputRef: RefObject<HTMLInputElement | null>) {
  const unauth = useUnauth();
  const [step, setStep] = useState<Step>("file");
  const fl = useImportFile();
  const { file, setFileError } = fl;
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<CustomerImportConflictMode>("skip");
  const cm = useImportCommit({ preview, mode, setBusy, setStep, setPreview, setFileError, unauth });
  const guard = useLeaveGuard(step === "preview" && !busy);

  const upload = async () => {
    const err = checkImportFile(file);
    if (err || !file) return setFileError(err);
    setBusy(true);
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const p = await api<ImportPreview>("POST", "/customers/import/preview", fd);
      setPreview(p);
      setMode("skip");
      cm.setCommitError(null);
      setStep("preview");
    } catch (e) {
      if (!unauth(e)) setFileError(importFailure(e, t("err.generic")).message);
    } finally {
      setBusy(false);
    }
  };
  const restart = () => {
    setStep("file");
    setPreview(null);
    cm.setResult(null);
    fl.setFile(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  return { ...fl, ...cm, step, busy, drag, setDrag, preview, mode, setMode, guard, upload, restart };
}

export type ImportWizardState = ReturnType<typeof useImportWizard>;
