// Устойчивость к невозможным значениям. Файл проекта можно открыть чужой,
// битый или отредактированный руками; состояние сразу уходит в
// автосохранение, поэтому одно значение вида rows: 0 без проверки оставило
// бы приложение сломанным и после перезагрузки.
import { buildContainer } from "../src/model/build.js";
import { layout, minOuterDim, fitSizes } from "../src/model/layout.js";
import { normalizeProject, makeContainer } from "../src/state/storage.js";

const noConn = { N: null, S: null, W: null, E: null };
let fail = 0;
const ok = (n, cond, extra = "") => { console.log(`${cond ? "OK  " : "FAIL"} ${n}${extra}`); if (!cond) fail++; };

// ── 1. Битые проекты чинятся, а не роняют построение ──
const broken = {
  "rows = 0": { containers: [{ rows: 0 }] },
  "W = null": { containers: [{ W: null }] },
  "строки вместо чисел": { containers: [{ W: "сто", H: "abc", wall: "" }] },
  "отрицательные размеры": { containers: [{ W: -50, wall: -3, cols: -2 }] },
  "Infinity": { containers: [{ W: Infinity, H: 1e400 }] },
  "мусор в walls": { containers: [{ walls: { "o:n:0": { h: "нет", face: "рисунок", rnd: NaN } } }] },
  "walls не объект": { containers: [{ walls: 42 }] },
  "мусор в fixedCells": { containers: [{ fixedCells: [null, { w: "x", anchor: "вверх" }, 5] }] },
  "мусор в cells": { containers: [{ cells: { "0:0": { lvl: "низ", tiltDir: "куда", tiltA: NaN } } }] },
  "запредельные размеры": { containers: [{ W: 1e9, cols: 1e6 }] },
  "битые лимиты": { containers: [{}], limits: { maxW: "нет", layW: -1, connClr: 99 } },
  "мусор в rowColWs": { containers: [{ rowColWs: { 0: [NaN, "x"], 1: "нет" } }] },
};
for (const [name, raw] of Object.entries(broken)) {
  const p = normalizeProject(raw);
  let good = false, note = "";
  if (!p) { good = true; note = " (отвергнут)"; }
  else
    try {
      const s = buildContainer(p.containers[0], noConn, {});
      const nan = s.some((b) => b.tris.some((t) => t.some((q) => q.some((v) => !Number.isFinite(v)))));
      good = !nan;
      note = nan ? " — в геометрии NaN" : ` (построено тел: ${s.length})`;
      for (const v of Object.values(p.limits)) if (!Number.isFinite(v)) { good = false; note = " — битый лимит"; }
    } catch (e) { note = ` — падение: ${e.message}`; }
  ok(`битый проект «${name}»`, good, note);
}

// ── 2. Не-проекты отвергаются ──
ok("null отвергнут", normalizeProject(null) === null);
ok("пустой объект отвергнут", normalizeProject({}) === null);
ok("чужой json отвергнут", normalizeProject({ foo: 1, containers: "нет" }) === null);
ok("пустой список контейнеров отвергнут", normalizeProject({ containers: [] }) === null);

// ── 3. Крайние, но допустимые значения строятся ──
const base = { ...makeContainer(null, 0, 0), W: 100, D: 100, H: 30, cols: 2, rows: 2 };
const builds = (name, patch) => {
  try {
    const s = buildContainer({ ...base, ...patch }, noConn, {});
    const finite = s.every((b) => b.tris.every((t) => t.every((q) => q.every(Number.isFinite))));
    ok(`строится: ${name}`, s.length > 0 && finite, ` (тел ${s.length})`);
  } catch (e) { ok(`строится: ${name}`, false, ` — ${e.message}`); }
};
builds("минимальный контейнер", { W: 30, D: 30, H: 5, cols: 1, rows: 1 });
builds("сетка 20×20", { W: 400, D: 400, cols: 20, rows: 20 });
builds("ячейки меньше стенок", { W: 40, D: 40, cols: 5, rows: 5 });
builds("бокс больше контейнера", { fixedCells: [{ w: 500, d: 500, anchor: "nw", lvl: 0 }] });
builds("уровень пола выше стенок", { cells: { "0:0": { lvl: 100 } } });
builds("стенки нулевой высоты", { walls: { "o:n:0": { h: 0 }, "v:0:0": { h: 0 } } });

// ── 4. Раскладка на краевых входах ──
ok("fitSizes на пустом списке", JSON.stringify(fitSizes([], {}, 100)) === "[]");
const allLocked = fitSizes([40, 40], { 0: true, 1: true }, 60);
ok("fitSizes: все замки сохраняются", allLocked.length === 2 && allLocked.every((v) => v > 0), ` → ${JSON.stringify(allLocked)}`);
ok("minOuterDim положителен", minOuterDim(base, "x") > 0, ` → ${minOuterDim(base, "x").toFixed(1)}`);
ok("layout всегда даёт хотя бы один ряд", layout({ ...base, rows: 1 }).nRows >= 1);

console.log(fail === 0 ? "\nROBUSTNESS TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
