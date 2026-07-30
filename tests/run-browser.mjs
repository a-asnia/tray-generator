// Прогон проверок собранного tray-generator.html в настоящем Chromium.
// Нужен playwright (глобально или локально) и собранный файл:
//   node build.mjs && node tests/run-browser.mjs
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = join(here, "..", "tray-generator.html");
if (!existsSync(html)) {
  console.error("Сначала соберите файл: node build.mjs");
  process.exit(1);
}
// playwright может быть установлен глобально — подсказываем node, где искать
const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout?.trim();
const env = { ...process.env };
if (globalRoot) env.NODE_PATH = [env.NODE_PATH, globalRoot].filter(Boolean).join(":");

const dir = join(here, "browser");
const files = readdirSync(dir).filter((f) => f.endsWith(".cjs")).sort();
let failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: "utf8", env });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (r.status !== 0) { failed.push(f); console.log(`\n══════ ${f} ══════\n${out}`); }
  else console.log(`  ✓ ${f.padEnd(24)} ${out.split("\n").filter(Boolean).pop() || ""}`);
}
console.log(
  failed.length === 0
    ? `\nВСЕ БРАУЗЕРНЫЕ ПРОВЕРКИ ПРОЙДЕНЫ (${files.length} наборов)`
    : `\nПРОВАЛИЛИСЬ: ${failed.join(", ")}`
);
process.exit(failed.length ? 1 : 0);
