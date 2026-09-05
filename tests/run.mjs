// Прогон всех проверок геометрии и модели (без браузера).
//   node tests/run.mjs
// Браузерные проверки собранного HTML — отдельно: node tests/run-browser.mjs
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(["run.mjs", "run-browser.mjs", "fixtures.mjs", "reference-v31.mjs"]);
const files = readdirSync(here).filter((f) => f.endsWith(".mjs") && !SKIP.has(f)).sort();

const quiet = process.argv.includes("--quiet");
let failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [join(here, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const bad = r.status !== 0;
  if (bad) failed.push(f);
  if (quiet && !bad) {
    const last = out.trim().split("\n").filter(Boolean).pop() || "";
    console.log(`  ✓ ${f.padEnd(20)} ${last}`);
  } else {
    console.log(`\n══════ ${f} ══════`);
    console.log(out.trim());
  }
}
console.log(
  failed.length === 0
    ? `\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (${files.length} наборов)`
    : `\nПРОВАЛИЛИСЬ: ${failed.join(", ")}`
);
process.exit(failed.length ? 1 : 0);
