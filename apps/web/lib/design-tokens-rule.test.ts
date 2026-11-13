import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../eslint-rules/design-tokens.mjs";

// AC-87: className'de ham renk / sabit px lint kuralıyla yakalanır
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("remote/design-tokens", plugin.rules["design-tokens"], {
  valid: [
    { code: `<div className="bg-surface text-fg-muted grid-cols-[18rem_1fr] max-h-[calc(100dvh-2rem)] scale-[0.97]" />` },
    { code: `<div className={\`p-4 \${a ? "bg-primary" : "bg-[var(--rs-stage)]"}\`} />` },
    { code: `const href = "#icerik";` },
  ],
  invalid: [
    { code: `<div className="bg-[#0a6cb0]" />`, errors: 1 },
    { code: `<div className="text-[13px]" />`, errors: 1 },
    { code: `<div className={cond ? "w-[200px]" : "w-4"} />`, errors: 1 },
    { code: `<div className={\`border-[rgb(0_0_0)] \${x}\`} />`, errors: 1 },
    { code: `<div className="text-[color:var(--x)] fill-[red]" />`, errors: 1 },
    { code: `const itemCls = "shadow-[0_1px_2px_#000]";`, errors: 1 },
    { code: `const variants = { a: "bg-[hsl(0_0%_0%)]" };`, errors: 1 },
  ],
});
