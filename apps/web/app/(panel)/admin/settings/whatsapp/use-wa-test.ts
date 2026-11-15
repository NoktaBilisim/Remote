"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { checkTestPhone, type WhatsappServiceTestResponse } from "@/lib/admin-settings/whatsapp";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

const PATH = "/admin/settings/whatsapp";
export type TestResult = { tone: "success" | "danger" | "locked"; title: string; message: string };

const okResult = (r: WhatsappServiceTestResponse): TestResult =>
  r.ok
    ? { tone: "success", title: t("wa.svc.testOk"), message: r.message }
    : { tone: "danger", title: t("wa.svc.testFail"), message: r.message };

/** Test isteği hatası: 400 `fields.phoneNumber` alana, 429 kilit sonucu, diğerleri hata sonucu. */
function failure(err: unknown): { phoneError: string } | { result: TestResult } {
  if (err instanceof ApiError && err.status === 400 && err.fields?.phoneNumber) return { phoneError: err.fields.phoneNumber };
  if (err instanceof ApiError && err.status === 429)
    return { result: { tone: "locked", title: t("wa.svc.testFail"), message: err.message || t("wa.svc.testRate") } };
  return { result: { tone: "danger", title: t("wa.svc.testFail"), message: toUiError(err).message } };
}

/** Test mesajı formunun durumu (AC-196): telefon ön kontrolü, tek istek, sonuç ekranda kalır. */
export function useWaTest() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const send = async (phoneNumber: string) => {
    setTesting(true);
    try {
      setResult(okResult(await api<WhatsappServiceTestResponse>("POST", `${PATH}/test`, { phoneNumber })));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = failure(err);
      if ("phoneError" in f) setPhoneError(f.phoneError);
      else setResult(f.result);
    } finally {
      setTesting(false);
    }
  };

  const test = async (e: FormEvent) => {
    e.preventDefault();
    if (testing) return;
    setResult(null);
    const c = checkTestPhone(phone);
    if (!c.phoneNumber) return setPhoneError(c.error);
    setPhoneError(undefined);
    await send(c.phoneNumber);
  };

  const changePhone = (value: string) => {
    setPhone(value);
    setPhoneError(undefined);
  };

  return { phone, phoneError, testing, result, test, changePhone };
}
