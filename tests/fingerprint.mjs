// Отпечаток геометрии: страховка от незаметных изменений при рефакторинге.
// Считает по каждой конфигурации число тел, треугольников, объём и хеш всех
// координат. Ожидаемые значения лежат в tests/fingerprint.json.
// Запуск с --update перезаписывает эталон (делать осознанно!).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildContainer } from "../src/model/build.js";
import { solidsVolume } from "../src/geometry/stl.js";
import { cases } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "fingerprint.json");

const hash = (solids) => {
  // FNV-1a по округлённым до 1e-4 координатам и тегам
  let h = 0x811c9dc5;
  const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const b of solids) {
    mix(b.tag);
    for (const t of b.tris) for (const p of t) for (const v of p) mix(Math.round(v * 1e4) + ",");
  }
  return h.toString(16).padStart(8, "0");
};

const actual = {};
for (const [name, [c, conn]] of Object.entries(cases)) {
  const s = buildContainer(c, conn, {});
  actual[name] = {
    solids: s.length,
    tris: s.reduce((a, x) => a + x.tris.length, 0),
    vol: +solidsVolume(s).toFixed(4),
    hash: hash(s),
  };
}

if (process.argv.includes("--update")) {
  writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
  console.log(`эталон обновлён: ${Object.keys(actual).length} конфигураций`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(file, "utf8"));
let fail = 0;
for (const name of Object.keys(expected)) {
  const a = actual[name], e = expected[name];
  if (!a) { console.log(`FAIL ${name}: конфигурация исчезла`); fail++; continue; }
  const same = a.solids === e.solids && a.tris === e.tris && a.vol === e.vol && a.hash === e.hash;
  console.log(`${same ? "OK  " : "FAIL"} ${name.padEnd(22)} тел ${String(a.solids).padStart(5)} тр ${String(a.tris).padStart(6)} объём ${a.vol}`);
  if (!same) { console.log(`     ожидалось: ${JSON.stringify(e)}\n     получено:  ${JSON.stringify(a)}`); fail++; }
}
for (const name of Object.keys(actual)) if (!expected[name]) console.log(`     (новая конфигурация без эталона: ${name})`);
console.log(fail === 0 ? "\nFINGERPRINT OK" : `\n${fail} РАСХОЖДЕНИЙ`);
process.exit(fail ? 1 : 0);
