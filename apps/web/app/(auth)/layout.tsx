import { BrandLogo } from "@/components/brand-logo";

/** Giriş ve şifre değiştirme ekranları için ortak, ortalanmış kabuk. AC-82: logo her zaman görünür. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandLogo variant="full" />
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-md sm:p-8">{children}</div>
      </div>
    </main>
  );
}
