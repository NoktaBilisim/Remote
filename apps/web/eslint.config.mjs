import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import remote from "./eslint-rules/design-tokens.mjs";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
  {
    plugins: { remote },
    rules: {
      // AC-87: className'de ham renk / sabit px yok (token dışı) — eslint-rules/design-tokens.mjs
      "remote/design-tokens": "error",
      // CSP nonce: SSR'daki style="" öznitelikleri nonce kapsamına girmez (mimari §5.4, G-19)
      "react/forbid-dom-props": ["error", { forbid: ["style"] }],
      "react/forbid-component-props": ["error", { forbid: ["style"] }],
      // next/image satır içi style="" üretir (CSP ihlali); logolar sabit boyutlu <img> ile verilir
      "@next/next/no-img-element": "off",
    },
  },
  {
    // D-P28aK-1 (mimari-p28 §6): pano içeriği / dosya adı console.*'a yazılmaz — tarayıcı kodunda console yasak.
    // lib/clip/**, lib/print/**, lib/dc/chunk-sender.ts ve components/collab/clip-print-panel.tsx bu kapsamın içinde.
    files: ["lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["lib/startup-check.ts"], // sunucu açılış hatası (Node günlüğü, tarayıcıya gitmez)
    rules: { "no-console": "error" },
  },
  {
    // P21 r2 S-P21-13 (mimari-p21 §5.4 P6): müşteri portalında dış kişinin gördüğü adlar (müşteri, kişi, teknisyen, ticket)
    // yalnız React metin bağlamasıyla basılır — `dangerouslySetInnerHTML` yasak. (Proje genelinde böyle bir kural yoktu.)
    files: ["app/portal/**/*.{ts,tsx}", "lib/portal/**/*.{ts,tsx}", "app/(panel)/customers/[[]id]/portal-accounts.tsx"],
    rules: { "react/no-danger": "error" },
  },
];

export default config;
