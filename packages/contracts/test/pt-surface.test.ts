// PT-K1 sözleşme korkuluğu (mimari-temizlik §5 K1, §3.7-1; AC-318). Temizlik sırasında `@remote/contracts`'ın dışa açık
// yüzeyi değişirse bu test kırılır: her `exports` yolunun ad kümesi (değer/tip), WS/DC mesaj `t` listesi, hata kodları.
// Ayrıca `src/` içinde import döngüsü (tip importları dahil) kalmadığını doğrular. Ek bağımlılık yok: `typescript` API
// (paket @types/node kullanmaz; dosya erişimi `ts.sys` ile, kök = paket dizini — `pnpm --filter @remote/contracts test`).
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ERROR_STATUS } from "../src/errors.ts";

const ROOT = ts.sys.getCurrentDirectory();
const read = (rel: string): string => {
  const text = ts.sys.readFile(`${ROOT}/${rel}`);
  if (text === undefined) throw new Error(`okunamadı: ${ROOT}/${rel}`);
  return text;
};
const pkg = JSON.parse(read("package.json")) as { name: string; exports: Record<string, string> };
if (pkg.name !== "@remote/contracts") throw new Error(`test paket dizininden koşmalı (cwd: ${ROOT})`);
const EXPORT_PATHS = Object.entries(pkg.exports).sort(([a], [b]) => a.localeCompare(b));
const SRC_FILES = ts.sys.readDirectory(`${ROOT}/src`, [".ts"]).sort();
const OPTIONS = ts.parseJsonConfigFileContent(ts.readConfigFile(`${ROOT}/tsconfig.json`, ts.sys.readFile).config, ts.sys, ROOT).options;

/** Bir modülün dışa verdiği adlar; yalnız tip olanlar "(tip)" ekiyle (yeniden dışa aktarımlar asıl sembole çözülür). */
function exportedNames(p: ts.Program, file: string): string[] {
  const checker = p.getTypeChecker();
  const sf = p.getSourceFile(file);
  const mod = sf && checker.getSymbolAtLocation(sf);
  if (!mod) throw new Error(`modül bulunamadı: ${file}`);
  return checker
    .getExportsOfModule(mod)
    .map((s) => {
      const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
      return target.flags & ts.SymbolFlags.Value ? s.name : `${s.name} (tip)`;
    })
    .sort();
}

/** Dosyadaki `t: z.literal("...")` mesaj türleri (WS/DC tel protokolü). */
function messageTypes(rel: string): string[] {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === "t" &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === "z.literal"
    ) {
      const arg = n.initializer.arguments[0];
      if (arg && ts.isStringLiteral(arg)) found.add(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...found].sort();
}

/** `src/` içi göreli import/yeniden dışa aktarım grafiği (tip importları dahil; graphify ile aynı görüş). */
function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of SRC_FILES) {
    const info = ts.preProcessFile(ts.sys.readFile(file) ?? "", true, true);
    const deps = info.importedFiles
      .filter((f) => f.fileName.startsWith("."))
      .map((f) => ts.resolveModuleName(f.fileName, file, OPTIONS, ts.sys).resolvedModule?.resolvedFileName ?? `${f.fileName} (çözülemedi)`);
    graph.set(file, [...new Set(deps)].sort());
  }
  return graph;
}

/** Basit döngüler (en küçük düğümden başlayan kanonik biçim; küçük grafikte DFS yeterli). */
function cycles(graph: Map<string, string[]>): string[][] {
  const nodes = [...graph.keys()].sort();
  const out: string[][] = [];
  for (const start of nodes) {
    const walk = (node: string, path: string[]): void => {
      for (const next of graph.get(node) ?? []) {
        if (next === start) out.push([...path]);
        else if (next > start && !path.includes(next)) walk(next, [...path, next]);
      }
    };
    walk(start, [start]);
  }
  return out.map((c) => c.map((f) => f.slice(ROOT.length + 1)));
}

describe("PT-K1 contracts yüzeyi", () => {
  it("AC-318: her exports yolunun dışa verdiği ad kümesi anlık görüntüyle aynı", { timeout: 60_000 }, () => {
    const p = ts.createProgram(SRC_FILES, OPTIONS);
    const surface = Object.fromEntries(EXPORT_PATHS.map(([key, rel]) => [key, exportedNames(p, `${ROOT}/${rel.replace(/^\.\//, "")}`)]));
    expect(surface).toMatchSnapshot();
  });

  it("AC-318: ws.ts / ws-request.ts / dc.ts mesaj `t` listesi anlık görüntüyle aynı", () => {
    const types = Object.fromEntries(["ws.ts", "ws-request.ts", "dc.ts"].map((f) => [f, messageTypes(`src/${f}`)]));
    expect(types).toMatchSnapshot();
  });

  it("AC-318: errors.ts hata kodu → HTTP durum listesi anlık görüntüyle aynı", () => {
    expect(ERROR_STATUS).toMatchSnapshot();
  });

  it("AC-318: src/ içinde import döngüsü yok (tip importları dahil)", () => {
    expect(cycles(importGraph())).toEqual([]);
  });
});
