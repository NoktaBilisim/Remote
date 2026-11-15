#!/usr/bin/env node
// PT-K0 ölçüm özeti (scripts/pt-olcum.sh çağırır; yalnız Node standart kütüphanesi).
//   node ozet.mjs topla <kök> <ham-dizin> <çıktı-dizini>   ham araç çıktılarını özet JSON'lara çevirir, Markdown özet basar
//   node ozet.mjs karsilastir <eski-dizin> <yeni-dizin>    iki ölçümü karşılaştırır (K17 kapanışı), Markdown basar
// Ham çıktısı olmayan adım atlanır (o JSON yazılmaz).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const AREAS = {
  server: ["apps/server/src"],
  web: ["apps/web/app", "apps/web/components", "apps/web/lib"],
  contracts: ["packages/contracts/src"],
  go: ["apps/agent-win"],
};
const TEST_AREAS = {
  server: ["apps/server/test"],
  web: ["apps/web/lib", "apps/web/e2e"],
  contracts: ["packages/contracts/test"],
  go: ["apps/agent-win"],
};
const SKIP = new Set(["node_modules", "generated", ".next", "bin", "__snapshots__", "test-results"]);
const isTest = (p) => /(^|\/)(test|e2e)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || p.endsWith("_test.go");
const areaOf = (p) =>
  p.startsWith("apps/server/")
    ? "server"
    : p.startsWith("apps/web/")
      ? "web"
      : p.startsWith("packages/contracts/")
        ? "contracts"
        : p.startsWith("apps/agent-win/")
          ? "go"
          : "diger";
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const has = (f) => existsSync(f) && statSync(f).size > 0;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|go)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function boyut(root) {
  const res = {};
  for (const [kind, map] of [
    ["uretim", AREAS],
    ["test", TEST_AREAS],
  ]) {
    for (const [area, dirs] of Object.entries(map)) {
      const files = dirs
        .flatMap((d) => walk(join(root, d)))
        .map((f) => relative(root, f))
        .filter((f) => isTest(f) === (kind === "test"));
      const rows = files.map((f) => ({ file: f, lines: readFileSync(join(root, f), "utf8").split("\n").length - 1 }));
      res[`${area}.${kind}`] = {
        dosya: rows.length,
        satir: rows.reduce((s, r) => s + r.lines, 0),
        ust300: rows.filter((r) => r.lines > 300).length,
        ust500: rows.filter((r) => r.lines > 500).length,
        liste300: rows.filter((r) => r.lines > 300).sort((a, b) => b.lines - a.lines),
      };
    }
  }
  return res;
}

// ESLint: max-lines-per-function (40, boş/yorum hariç) ve complexity (15) uyarıları.
function fonksiyon(raw, root) {
  const res = {};
  for (const f of readdirSync(raw).filter((n) => /^eslint-.*\.json$/.test(n))) {
    for (const r of readJson(join(raw, f))) {
      const file = relative(root, r.filePath);
      const key = `${areaOf(file)}.${isTest(file) ? "test" : "uretim"}`;
      const a = (res[key] ??= { uzun: [], karmasik: [] });
      for (const m of r.messages) {
        const n = Number((m.message.match(/\((\d+)\)|complexity of (\d+)/) ?? []).slice(1).find(Boolean));
        const name = (m.message.match(/^(?:Async )?(?:[Aa]rrow f|F|Method |Async f)?[^']*'([^']+)'/) ?? [])[1] ?? "(anonim)";
        const row = { file, line: m.line, name, n };
        if (m.ruleId === "max-lines-per-function") a.uzun.push(row);
        if (m.ruleId === "complexity") a.karmasik.push(row);
      }
    }
  }
  for (const a of Object.values(res)) {
    a.uzun.sort((x, y) => y.n - x.n);
    a.karmasik.sort((x, y) => y.n - x.n);
    Object.assign(a, sayac(a.uzun.map((r) => r.n)), { cx15: a.karmasik.length });
  }
  return res;
}
const sayac = (ns) => ({
  ust40: ns.filter((n) => n > 40).length,
  ust80: ns.filter((n) => n > 80).length,
  ust150: ns.filter((n) => n > 150).length,
});

function go(raw, root) {
  const res = {};
  if (has(join(raw, "go-fonk.json"))) {
    const fns = readJson(join(raw, "go-fonk.json"));
    for (const t of [false, true]) {
      const sel = fns.filter((f) => f.test === t).map((f) => ({ file: `apps/agent-win/${f.file}`, name: f.name, n: f.lines }));
      res[t ? "fonk.test" : "fonk.uretim"] = {
        islev: sel.length,
        ...sayac(sel.map((f) => f.n)),
        uzun: sel.filter((f) => f.n > 40).sort((a, b) => b.n - a.n),
      };
    }
  }
  for (const os of ["linux", "windows"]) {
    const sc = join(raw, `staticcheck-${os}.json`);
    if (existsSync(sc)) {
      res[`staticcheck.${os}`] = readFileSync(sc, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((d) => ({ code: d.code, file: d.location.file.replace("/src/", ""), line: d.location.line, message: d.message }));
    }
    const vet = join(raw, `vet-${os}.txt`);
    if (existsSync(vet))
      res[`vet.${os}`] = readFileSync(vet, "utf8")
        .split("\n")
        .filter((l) => /\.go:\d+/.test(l));
    const dc = (n) =>
      existsSync(join(raw, n))
        ? readFileSync(join(raw, n), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => l.replace(/^\/src\//, "").replace(/:\d+:\d+:/, ":"))
        : null;
    const withTest = dc(`deadcode-test-${os}.txt`);
    const noTest = dc(`deadcode-${os}.txt`);
    if (withTest) res[`deadcode.${os}`] = withTest;
    if (withTest && noTest) res[`yalnizTestte.${os}`] = noTest.filter((l) => !withTest.includes(l));
  }
  res.testler = goTestler(raw, root);
  return res;
}

// go list çıktısı (paket|dizin|test dosyaları) + kaynakta `func TestX(` → GOOS başına sıralı test adı listesi.
function goTestler(raw, root) {
  const out = {};
  for (const os of ["linux", "windows"]) {
    const f = join(raw, `go-list-${os}.txt`);
    if (!existsSync(f)) continue;
    const names = [];
    for (const line of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const [pkg, dir, ...lists] = line.split("|");
      for (const tf of lists.join(",").split(",").filter(Boolean)) {
        const src = readFileSync(join(root, dir.replace(/^\/src\/?/, ""), tf), "utf8");
        for (const m of src.matchAll(/^func ((?:Test|Fuzz|Example|Benchmark)\w*)\(/gm)) names.push(`${pkg} ${m[1]}`);
      }
    }
    out[os] = names.sort();
  }
  return out;
}

function knip(raw) {
  const f = join(raw, "knip.json");
  if (!has(f)) return null;
  const j = readJson(f);
  const res = { dosya: j.files.length, ...{} };
  const add = (k, file, items) => {
    if (!items.length) return;
    const key = `${areaOf(file)}${isTest(file) ? "-test" : ""}.${k}`;
    (res[key] ??= []).push(...items.map((i) => `${file} ${i.name ?? i.map?.((x) => x.name).join("=")}`));
  };
  for (const i of j.issues) {
    for (const k of ["exports", "types", "duplicates", "dependencies", "devDependencies", "unlisted", "unresolved"]) {
      add(k, i.file, i[k] ?? []);
    }
    for (const [en, ms] of Object.entries(i.enumMembers ?? {}))
      add(
        "enumMembers",
        i.file,
        ms.map((m) => ({ name: `${en}.${m.name}` })),
      );
  }
  return res;
}

function jscpd(raw) {
  const f = join(raw, "jscpd", "jscpd-report.json");
  if (!has(f)) return null;
  const j = readJson(f);
  const clones = j.duplicates.map((d) => ({
    a: `${d.firstFile.name}:${d.firstFile.start}-${d.firstFile.end}`,
    b: `${d.secondFile.name}:${d.secondFile.start}-${d.secondFile.end}`,
    lines: d.lines,
    test: isTest(d.firstFile.name) || isTest(d.secondFile.name),
  }));
  const sum = (cs) => ({ klon: cs.length, satir: cs.reduce((s, c) => s + c.lines, 0) });
  return {
    toplam: { ...sum(clones), yuzde: j.statistics.total.percentage },
    uretim: sum(clones.filter((c) => !c.test)),
    test: sum(clones.filter((c) => c.test)),
    klonlar: clones.sort((x, y) => Number(x.test) - Number(y.test) || y.lines - x.lines),
  };
}

// i18n: messages/tr.json anahtarının web kaynağında (test hariç) tırnaklı geçişi; geçmeyen ama dinamik bir önekle
// (`önek.${…}` veya "önek." + …) eşleşen anahtar "dinamik aday", hiçbiriyle eşleşmeyen "ölü aday".
function i18n(root) {
  const keys = Object.keys(readJson(join(root, "apps/web/messages/tr.json")));
  const src = AREAS.web
    .flatMap((d) => walk(join(root, d)))
    .filter((f) => !isTest(relative(root, f)))
    .concat([join(root, "apps/web/proxy.ts")].filter(existsSync))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const quoted = new Set([...src.matchAll(/["'`]([A-Za-z0-9_.-]+)["'`]/g)].map((m) => m[1]));
  const prefixes = new Set([
    ...[...src.matchAll(/`([A-Za-z0-9_.-]*\.)\$\{/g)].map((m) => m[1]),
    ...[...src.matchAll(/["']([A-Za-z0-9_.-]+\.)["']\s*\+/g)].map((m) => m[1]),
  ]);
  const unused = keys.filter((k) => !quoted.has(k));
  const dyn = unused.filter((k) => [...prefixes].some((p) => k.startsWith(p)));
  return {
    anahtar: keys.length,
    dinamikOnek: [...prefixes].sort(),
    oluAday: unused.filter((k) => !dyn.includes(k)),
    dinamikAday: dyn,
  };
}

function testler(raw) {
  const res = {};
  for (const pkg of ["server", "web", "contracts"]) {
    const f = join(raw, `vitest-${pkg}.json`);
    if (!has(f)) continue;
    // vitest JSON raporlayıcısı (kapsam koşusu): it.each açılmış gerçek test adları + durum.
    const rows = readJson(f).testResults.flatMap((r) =>
      r.assertionResults.map((a) => ({
        name: [r.name.replace(/^.*?\/(apps|packages)\//, "$1/"), ...a.ancestorTitles, a.title].join(" > "),
        status: a.status,
      })),
    );
    res[`vitest.${pkg}`] = rows.map((r) => r.name).sort();
    res[`durum.${pkg}`] = Object.fromEntries(
      [...new Set(rows.map((r) => r.status))].map((st) => [st, rows.filter((r) => r.status === st).length]),
    );
  }
  const pw = join(raw, "playwright.json");
  if (has(pw)) {
    const names = [];
    const visit = (s, path) => {
      for (const sp of s.specs ?? []) for (const t of sp.tests) names.push(`[${t.projectName}] ${[...path, sp.title].join(" › ")}`);
      for (const c of s.suites ?? []) visit(c, [...path, c.title]);
    };
    for (const s of readJson(pw).suites) visit(s, [s.title]);
    res.playwright = names.sort();
  }
  return res;
}

function kapsam(raw) {
  const res = {};
  for (const pkg of ["server", "web", "contracts"]) {
    const f = join(raw, `kapsam-${pkg}.json`);
    if (!has(f)) continue;
    const t = readJson(f).total;
    res[pkg] = Object.fromEntries(["lines", "branches", "functions", "statements"].map((k) => [k, t[k].pct]));
  }
  const g = join(raw, "go-cover.txt");
  if (has(g)) {
    res.go = {};
    for (const l of readFileSync(g, "utf8").split("\n")) {
      const m = l.match(/^(?:ok\s+)?\s*(\S+)\s.*coverage: ([\d.]+)% of statements/);
      if (m) res.go[m[1]] = Number(m[2]);
    }
  }
  return res;
}

function topla(root, raw, out) {
  const parts = {
    boyut: boyut(root),
    fonksiyon: readdirSync(raw).some((n) => n.startsWith("eslint-")) ? fonksiyon(raw, root) : null,
    go: readdirSync(raw).some((n) => /^(go-|staticcheck|deadcode|vet)/.test(n)) ? go(raw, root) : null,
    knip: knip(raw),
    jscpd: jscpd(raw),
    i18n: i18n(root),
    testler: testler(raw),
    kapsam: kapsam(raw),
  };
  for (const [k, v] of Object.entries(parts)) {
    if (!v || !Object.keys(v).length) continue;
    // Adım adım koşuda önceki sonuçlar korunur (ör. yalnız `knip` koşusu kapsamdan gelen vitest listelerini silmez).
    const f = join(out, `${k}.json`);
    writeFileSync(f, `${JSON.stringify(existsSync(f) ? { ...readJson(f), ...v } : v, null, 2)}\n`);
  }
  console.log(ozet(out));
}

// Tek ölçüm dizininden sayılar (karşılaştırma ve özet aynı tabloyu kullanır).
function sayilar(dir) {
  const r = (n) => (existsSync(join(dir, `${n}.json`)) ? readJson(join(dir, `${n}.json`)) : {});
  const [b, f, g, k, j, i, t, c] = ["boyut", "fonksiyon", "go", "knip", "jscpd", "i18n", "testler", "kapsam"].map(r);
  const s = {};
  for (const [key, v] of Object.entries(b))
    Object.assign(s, {
      [`boyut ${key} dosya`]: v.dosya,
      [`boyut ${key} satır`]: v.satir,
      [`boyut ${key} >300`]: v.ust300,
      [`boyut ${key} >500`]: v.ust500,
    });
  for (const [key, v] of Object.entries(f))
    Object.assign(s, {
      [`işlev ${key} >40`]: v.ust40,
      [`işlev ${key} >80`]: v.ust80,
      [`işlev ${key} >150`]: v.ust150,
      [`işlev ${key} cx>15`]: v.cx15,
    });
  for (const kind of ["uretim", "test"]) {
    const v = g[`fonk.${kind}`];
    if (v)
      Object.assign(s, {
        [`işlev go.${kind} toplam`]: v.islev,
        [`işlev go.${kind} >40`]: v.ust40,
        [`işlev go.${kind} >80`]: v.ust80,
        [`işlev go.${kind} >150`]: v.ust150,
      });
  }
  for (const key of Object.keys(g).filter((x) => /^(staticcheck|vet|deadcode|yalnizTestte)\./.test(x))) s[`go ${key}`] = g[key].length;
  for (const [key, v] of Object.entries(k)) s[`knip ${key}`] = Array.isArray(v) ? v.length : v;
  if (j.toplam)
    Object.assign(s, {
      "jscpd toplam klon": j.toplam.klon,
      "jscpd toplam satır": j.toplam.satir,
      "jscpd üretim klon": j.uretim.klon,
      "jscpd üretim satır": j.uretim.satir,
      "jscpd test klon": j.test.klon,
    });
  if (i.anahtar)
    Object.assign(s, {
      "i18n anahtar": i.anahtar,
      "i18n ölü aday": i.oluAday.length,
      "i18n dinamik aday": i.dinamikAday.length,
      "i18n dinamik önek": i.dinamikOnek.length,
    });
  for (const [key, v] of Object.entries(t)) {
    if (Array.isArray(v)) s[`test ${key}`] = v.length;
    else for (const [st, n] of Object.entries(v)) s[`test ${key} ${st}`] = n;
  }
  for (const [os, v] of Object.entries(g.testler ?? {})) s[`test go.${os}`] = v.length;
  for (const [pkg, v] of Object.entries(c)) {
    if (pkg === "go") for (const [p, pct] of Object.entries(v)) s[`kapsam go ${p.replace("remote-support/agent-win/", "")} %`] = pct;
    else for (const [m, pct] of Object.entries(v)) s[`kapsam ${pkg} ${m} %`] = pct;
  }
  return { s, t, g };
}

function ozet(dir) {
  const { s } = sayilar(dir);
  return ["| Ölçüt | Değer |", "| --- | ---: |", ...Object.entries(s).map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function karsilastir(a, b) {
  const x = sayilar(a);
  const y = sayilar(b);
  const keys = [...new Set([...Object.keys(x.s), ...Object.keys(y.s)])];
  const lines = ["| Ölçüt | Baseline | Son | Fark |", "| --- | ---: | ---: | ---: |"];
  for (const k of keys) {
    const d = typeof x.s[k] === "number" && typeof y.s[k] === "number" ? Math.round((y.s[k] - x.s[k]) * 100) / 100 : "";
    lines.push(`| ${k} | ${x.s[k] ?? "—"} | ${y.s[k] ?? "—"} | ${d === 0 ? "=" : d} |`);
  }
  // AC-317: test adı listeleri eşit olmalı (eksik = baseline'da olup sonda olmayan).
  const lists = { ...x.t, ...Object.fromEntries(Object.entries(x.g.testler ?? {}).map(([o, v]) => [`go.${o}`, v])) };
  const lists2 = { ...y.t, ...Object.fromEntries(Object.entries(y.g.testler ?? {}).map(([o, v]) => [`go.${o}`, v])) };
  lines.push("", "Test listesi farkı (AC-317):");
  for (const k of Object.keys(lists).filter((n) => Array.isArray(lists[n]))) {
    const now = new Set(lists2[k] ?? []);
    const missing = lists[k].filter((n) => !now.has(n));
    lines.push(`- ${k}: eksik ${missing.length}${missing.length ? ` → ${missing.slice(0, 20).join("; ")}` : ""}`);
  }
  return lines.join("\n");
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "topla" && args.length === 3) topla(...args);
else if (cmd === "karsilastir" && args.length === 2) console.log(karsilastir(...args));
else {
  console.error("kullanım: ozet.mjs topla <kök> <ham> <çıktı> | karsilastir <eski> <yeni>");
  process.exit(2);
}
