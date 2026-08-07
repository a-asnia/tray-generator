#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// Офлайн-сборка одного самодостаточного tray-generator.html.
//
// Никаких npm-зависимостей: JSX транспилируется глобально
// установленным tsc (React.createElement), модули склеиваются в
// один классический <script> в порядке определений исходного
// монолита, React/ReactDOM/three инлайнятся из vendor/ (это
// официальные UMD-сборки тех же версий, что раньше грузились с CDN:
// React 18.2.0, three.js r128).
//
// Запуск:  node build.mjs                     → tray-generator.html в корне
//          node build.mjs --artifact <файл>   → дополнительно фрагмент для
//              публикации как Claude-артефакт (без <html>/<head>/<body> —
//              их добавляет платформа при публикации)
//
// (Параллельно существует путь через Vite — package.json,
// vite.config.js — для сред, где доступен npm; результат
// эквивалентен. Канонический артефакт собирает этот скрипт.)
// ══════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// порядок конкатенации = порядок определений в исходном монолите v31;
// каждый модуль объявляет только новые имена, коллизий нет
const MODULES = [
  "src/geometry/vec.js",
  "src/geometry/solids.js",
  "src/geometry/random.js",
  "src/geometry/stl.js",
  "src/geometry/manifold.js",
  "src/model/connectors.js",
  "src/model/solver.js",
  "src/model/inserts.js",
  "src/model/layout.js",
  "src/model/cardholder.js",
  "src/model/build.js",
  "src/model/presets.js",
  "src/state/storage.js",
  "src/model/laymagnet.js",
  "src/model/laymove.js",
  "src/ui/theme.js",
  "src/ui/controls.jsx",
  "src/ui/Schematic.jsx",
  "src/scene/useTrayScene.js",
  "src/App.jsx",
  "src/main.jsx",
];

// 0. Проверка полноты списка: модули склеиваются в один скрипт, поэтому
//    забытый в MODULES файл не даёт ошибки сборки — страница просто падает
//    в браузере с ReferenceError. Ловим это здесь.
{
  const known = new Set(MODULES.map((m) => resolve(ROOT, m)));
  const missing = [];
  for (const m of MODULES) {
    const src = readFileSync(join(ROOT, m), "utf8");
    for (const [, spec] of src.matchAll(/^\s*import\s[^"']*["'](\.[^"']+)["']/gm)) {
      const target = resolve(dirname(join(ROOT, m)), spec);
      if (!known.has(target)) missing.push(`${m} → ${spec}`);
    }
  }
  if (missing.length) {
    console.error("Модули не попали в MODULES (страница упала бы в браузере):");
    for (const x of missing) console.error("  " + x);
    process.exit(1);
  }
}

// 1. Транспиляция JSX → React.createElement (без даунлевела: es2020,
//    как и раньше при Babel в браузере)
const out = mkdtempSync(join(tmpdir(), "tray-build-"));
try {
  execFileSync(
    "tsc",
    [
      "--allowJs", "--jsx", "react", "--target", "es2020", "--module", "esnext",
      "--noResolve", "--outDir", out,
      ...MODULES.map((m) => join(ROOT, m)),
    ],
    { stdio: "inherit" }
  );

  // 2. Склейка: убираем import-строки и ключевые слова export;
  //    зависимости между модулями становятся обычной областью видимости
  const stripModule = (code) =>
    code
      .split("\n")
      .filter((line) => !/^\s*import\s/.test(line))
      .map((line) => line.replace(/^export default /, "").replace(/^export /, ""))
      .join("\n")
      .trim();

  const emitted = (m) => join(out, m.replace(/^src\//, "").replace(/\.jsx$/, ".js"));
  const pieces = MODULES.map((m) => {
    const code = stripModule(readFileSync(emitted(m), "utf8"));
    return `// ── ${m} ──\n${code}`;
  });

  const appBundle = [
    '"use strict";',
    "const { useState, useRef, useEffect, useMemo, useCallback } = React;",
    "",
    ...pieces,
  ].join("\n");

  // 3. Единственный HTML: библиотеки и приложение инлайном
  const lib = (f) => readFileSync(join(ROOT, "vendor", f), "utf8");
  const guard = (js) => js.replace(/<\/script/gi, "<\\/script"); // безопасный инлайн в <script>
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Генератор лотков — система контейнеров для 3D-печати</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script>/* React 18.2.0 (vendor/react.min.js) */
${guard(lib("react.min.js"))}</script>
<script>/* ReactDOM 18.2.0 (vendor/react-dom.min.js) */
${guard(lib("react-dom.min.js"))}</script>
<script>/* three.js r128 (vendor/three.min.js) */
${guard(lib("three.min.js"))}</script>
<script>
${guard(appBundle)}
</script>
</body>
</html>
`;

  const target = join(ROOT, "tray-generator.html");
  writeFileSync(target, html);
  console.log(`OK: ${target} (${(statSync(target).size / 1024).toFixed(0)} КБ)`);

  const ai = process.argv.indexOf("--artifact");
  if (ai !== -1 && process.argv[ai + 1]) {
    const fragment = `<title>Генератор лотков — система контейнеров для 3D-печати</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  #root { height: 100%; }
</style>
<div id="root"></div>
<script>
${guard(lib("react.min.js"))}</script>
<script>
${guard(lib("react-dom.min.js"))}</script>
<script>
${guard(lib("three.min.js"))}</script>
<script>
${guard(appBundle)}
</script>
`;
    writeFileSync(process.argv[ai + 1], fragment);
    console.log(`OK: артефакт-фрагмент → ${process.argv[ai + 1]}`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
