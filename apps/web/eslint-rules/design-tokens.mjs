/**
 * AC-87 / DESIGN §1: className'de token dışı ham renk ve sabit px yasağı. Renkler yalnız `globals.css` token'larından
 * gelen anlamsal sınıflarla (`bg-surface`, `text-fg-muted` …), boşluklar 4 px ızgarasından yazılır.
 *
 * Yakalananlar (className / class değişkenlerindeki dize ve şablon dizelerinde):
 *  - hex renk (`#fff`, `bg-[#0a6cb0]`), `rgb()/rgba()/hsl()/hsla()/oklch()/oklab()/color-mix()`;
 *  - renk yardımcılarında keyfi değer (`bg-[…]`, `text-[…]`, `border-[…]`, `fill-[…]`, `ring-[…]` …) — `var(--…)` hariç;
 *  - herhangi bir keyfi değerde `px` (`text-[13px]`, `w-[200px]`, `align-[-3px]`) — rem/%/fr/vh ve calc serbest.
 * Gerekçeli istisna: satıra `// eslint-disable-next-line remote/design-tokens -- <gerekçe>`.
 */
const COLOR_UTIL = /(?:^|[\s:])(?:bg|text|border(?:-[trblxyse])?|outline|ring|ring-offset|fill|stroke|from|via|to|decoration|accent|caret|divide|placeholder|shadow)-\[(?!var\(--)[^\]]+\]/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/;
const ARBITRARY_PX = /-\[[^\]]*\d(?:\.\d+)?px[^\]]*\]/;
const CLASS_NAME_ATTR = /^(?:className|class)$/;
const CLASS_VAR = /(?:cls|Cls|class|Class|variants|VARIANTS|COLS|tones|TONES)$/;

function problem(text) {
  if (RAW_COLOR.test(text)) return "Ham renk yasak: globals.css token'ından gelen anlamsal sınıf kullanın (DESIGN §2).";
  if (COLOR_UTIL.test(text)) return "Renk yardımcısında keyfi değer yasak: token sınıfı kullanın (DESIGN §2).";
  if (ARBITRARY_PX.test(text)) return "Sabit px yasak: Tailwind ölçeği (4 px ızgarası) veya rem kullanın (DESIGN §3).";
  return null;
}

/** Bir ifadenin altındaki tüm dize parçalarını gezer (koşul, mantıksal, çağrı argümanı, dizi, nesne değeri). */
function collect(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push([node, node.value]);
      return;
    case "TemplateLiteral":
      for (const q of node.quasis) out.push([q, q.value.cooked ?? q.value.raw]);
      for (const e of node.expressions) collect(e, out);
      return;
    case "JSXExpressionContainer":
      return collect(node.expression, out);
    case "ConditionalExpression":
      collect(node.consequent, out);
      return collect(node.alternate, out);
    case "LogicalExpression":
    case "BinaryExpression":
      collect(node.left, out);
      return collect(node.right, out);
    case "CallExpression":
      for (const a of node.arguments) collect(a, out);
      return;
    case "ArrayExpression":
      for (const el of node.elements) collect(el, out);
      return;
    case "ObjectExpression":
      for (const p of node.properties) if (p.type === "Property") collect(p.value, out);
      return;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return collect(node.expression, out);
    default:
      return;
  }
}

const rule = {
  meta: { type: "problem", docs: { description: "Token dışı ham renk / sabit px yasağı (AC-87)" }, schema: [] },
  create(context) {
    const check = (root) => {
      const parts = [];
      collect(root, parts);
      for (const [node, text] of parts) {
        const msg = problem(text);
        if (msg) context.report({ node, message: msg });
      }
    };
    return {
      JSXAttribute(node) {
        if (node.name?.type === "JSXIdentifier" && CLASS_NAME_ATTR.test(node.name.name)) check(node.value);
      },
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && CLASS_VAR.test(node.id.name)) check(node.init);
      },
    };
  },
};

const plugin = { rules: { "design-tokens": rule } };
export default plugin;
