import { SettingsTabs } from "./settings-tabs";

/** Ayarlar bölümü: sayfa içeriğinin üstünde alt menü (Destek talepleri · E-posta (SMTP) · Güvenlik). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
